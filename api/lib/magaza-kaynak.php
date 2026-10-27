<?php
/*
 * VoltGuard Magaza tedarikci fiyat okuma (tasarim: api/MAGAZA.md).
 *  - SSRF korumali, IP'ye sabitlenmis HTTPS getirme (yalnizca kaynak kaydindaki alan adi, en fazla 3 yonlendirme)
 *  - teklif ayristirma: JSON-LD > microdata > OG meta > dar platform yedekleri; celisen fiyatta "ambiguous_price"
 *  - TCMB doviz satis kuru (today.xml)
 *  - zamanlanmis (cron) ve canli (sepet adimi) fiyat yenileme: ag islemi kilit DISINDA, her urunun sonucu kisa
 *    yazma kilidiyle islenir
 * Tedarikci adresleri yalnizca ozel veri klasorundeki kaynaklar.json'dan gelir. Bu dosya hicbir tedarikci adi
 * icermez; hata kodlari ve ozetler adres, alan adi veya maliyet icermez.
 * Test modu: VG_MAGAZA_FIXTURE_DIR verilirse ag yerine <dizin>/<sha1(url)>.html (200), .403/.404/.410/.429/.500/.503
 * (durum kodu) ve .redirect (Location) okunur; TCMB icin <dizin>/tcmb-today.xml.
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

const VGM_FETCH_UA = 'Mozilla/5.0 (compatible; VoltGuardFiyat/1.0; +https://voltguard.com.tr/magaza/)';
const VGM_FETCH_MAX_BYTES = 2097152;     // 2 MiB (acilmis govde)
const VGM_FETCH_TIMEOUT = 12;
const VGM_FETCH_CONNECT_TIMEOUT = 6;
const VGM_RATE_FETCH_TIMEOUT = 30;       // TCMB kuru: tek kaynak, yavas TLS el sikismasina tolerans
const VGM_FETCH_MAX_REDIRECTS = 3;
const VGM_TCMB_URL = 'https://www.tcmb.gov.tr/kurlar/today.xml';
const VGM_RATE_REFRESH_AFTER = 21600;    // cron kuru 6 saatten eskiyse yeniler
const VGM_VALUE_MAX = 1000000000;
const VGM_HEALTHY_AFTER = 46800;         // son zamanlanmis calisma en fazla 13 saat once

/* ------------------------------------------------------------------ sayi ayristirma */

/**
 * Fiyat metnini sayiya cevirir. $machine: JSON-LD/meta icerigi (nokta ondalik; "1.234,56" da kabul edilir);
 * degilse ekranda gorunen Turk metni ("1.234,56 TL", "12.345 TL" = 12345, "1,234.56 $"). <=0, sonsuz ve > 1e9 reddedilir.
 * Tek ayiricili ve tam uc haneli "1,234" belirsizdir (null).
 */
function vgm_parse_number(string $s, bool $machine): ?float
{
    $s = str_replace(["\xC2\xA0", "\xE2\x80\xAF", "\xE2\x80\x89", "\xE2\x80\x87", "\xE2\x80\x88", "\xE2\x80\x8B"], ' ', $s);
    $s = trim($s);
    if ($s === '' || strlen($s) > 200 || preg_match('/^(?:-|\xE2\x88\x92)/', $s) === 1) {
        return null;
    }
    if ($machine && preg_match('/^[0-9]+(?:\.[0-9]+)?[eE][+-]?[0-9]{1,3}$/D', $s) === 1) {
        $v = (float)$s;
        return is_finite($v) && $v > 0 && $v <= VGM_VALUE_MAX ? $v : null;
    }
    // uc haneli gruplar bosluk ile ayrilmis: "12 345,60"
    $s = (string)preg_replace('/(?<=[0-9]) (?=[0-9]{3}(?![0-9]))/', '', $s);
    if (preg_match('/[.,]?[0-9][0-9.,]*/', $s, $m) !== 1) {
        return null;
    }
    $t = rtrim($m[0], '.,');
    if ($t === '' || $t === '.' || $t === ',') {
        return null;
    }
    if ($t[0] === '.' || $t[0] === ',') {
        $t = '0' . $t;
    }
    $dots = substr_count($t, '.');
    $commas = substr_count($t, ',');
    if ($dots > 0 && $commas > 0) {
        $decimal = strrpos($t, '.') > strrpos($t, ',') ? '.' : ',';
        $group = $decimal === '.' ? ',' : '.';
        if (substr_count($t, $decimal) !== 1) {
            return null;
        }
        $parts = explode($decimal, $t, 2);
        if (preg_match('/^[0-9]{1,3}(?:' . preg_quote($group, '/') . '[0-9]{3})+$/D', $parts[0]) !== 1
            || preg_match('/^[0-9]{1,8}$/D', $parts[1]) !== 1) {
            return null;
        }
        $num = str_replace($group, '', $parts[0]) . '.' . $parts[1];
    } elseif ($dots > 0 || $commas > 0) {
        $sep = $dots > 0 ? '.' : ',';
        if (($dots > 0 ? $dots : $commas) > 1) {
            // yalniz binlik ayirici: 1.234.567
            if (preg_match('/^[0-9]{1,3}(?:' . preg_quote($sep, '/') . '[0-9]{3}){2,}$/D', $t) !== 1) {
                return null;
            }
            $num = str_replace($sep, '', $t);
        } else {
            $parts = explode($sep, $t, 2);
            $thousandsLike = strlen($parts[1]) === 3 && strlen($parts[0]) <= 3 && ltrim($parts[0], '0') !== '';
            if (!$thousandsLike) {
                $num = $parts[0] . '.' . $parts[1];
            } elseif ($sep === '.') {
                $num = $machine ? $parts[0] . '.' . $parts[1] : $parts[0] . $parts[1];
            } else {
                return null;
            }
        }
    } else {
        $num = $t;
    }
    $v = (float)$num;
    return is_finite($v) && $v > 0 && $v <= VGM_VALUE_MAX ? $v : null;
}

/** JSON-LD degeri (sayi veya metin) -> fiyat. */
function vgm_price_value($v): ?float
{
    if (is_int($v) || is_float($v)) {
        $f = (float)$v;
        return is_finite($f) && $f > 0 && $f <= VGM_VALUE_MAX ? $f : null;
    }
    return is_string($v) ? vgm_parse_number($v, true) : null;
}

/** Para birimi: TRY|USD|EUR; bos/yok -> null; desteklenmeyen -> false. */
function vgm_currency($v)
{
    if (!is_string($v) || trim($v) === '') {
        return null;
    }
    $c = strtoupper(trim($v));
    if (in_array($c, ['TRY', 'TL', 'TRL', "\xE2\x82\xBA", 'TURK LIRASI'], true)) {
        return 'TRY';
    }
    if (in_array($c, ['USD', '$', 'US$', 'US DOLLAR'], true)) {
        return 'USD';
    }
    if (in_array($c, ['EUR', "\xE2\x82\xAC", 'EURO'], true)) {
        return 'EUR';
    }
    return false;
}

/** Ekran metnindeki para birimi simgesi (yalniz platform yedeklerinde). */
function vgm_currency_in_text(string $t): ?string
{
    if (strpos($t, "\xE2\x82\xBA") !== false || preg_match('/(?<![A-Za-z])(?:TL|TRY)(?![A-Za-z])/', $t) === 1) {
        return 'TRY';
    }
    if (strpos($t, '$') !== false || preg_match('/(?<![A-Za-z])USD(?![A-Za-z])/', $t) === 1) {
        return 'USD';
    }
    if (strpos($t, "\xE2\x82\xAC") !== false || preg_match('/(?<![A-Za-z])EUR(?![A-Za-z])/', $t) === 1) {
        return 'EUR';
    }
    return null;
}

/** schema.org stok durumu: yalniz yapisal veriden. true/false/null (bilinmiyor). */
function vgm_availability($v): ?bool
{
    if (!is_string($v) || trim($v) === '') {
        return null;
    }
    $t = strtolower((string)preg_replace('~^.*[/#:]~', '', trim($v)));
    $t = str_replace([' ', '_', '-'], '', $t);
    if (in_array($t, ['instock', 'limitedavailability', 'onlineonly'], true)) {
        return true;
    }
    if (in_array($t, ['outofstock', 'soldout', 'discontinued', 'preorder', 'backorder', 'instoreonly', 'presale'], true)) {
        return false;
    }
    return null;
}

/* ------------------------------------------------------------------ SSRF korumasi */

/** Ozel, yerel, link-local, CGNAT, coklu yayin ve ayrilmis adresler engellenir (vh_ip_blocked ile ayni araliklar). */
function vgm_ip_blocked(string $ip): bool
{
    if (filter_var($ip, FILTER_VALIDATE_IP) === false) {
        return true;
    }
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
        return true;
    }
    $blocked = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
        '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24',
        '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4', '255.255.255.255/32',
        '::/128', '::1/128', '::ffff:0:0/96', '64:ff9b::/96', '100::/64', '2001::/23', '2001:db8::/32', '2002::/16',
        'fc00::/7', 'fe80::/10', 'fec0::/10', 'ff00::/8'];
    foreach ($blocked as $cidr) {
        if (vg_ip_in_cidr($ip, $cidr)) {
            return true;
        }
    }
    return false;
}

/** Adi cozer; tum adresler herkese acik olmali. Dondurur: kullanilacak IP. Hata kodu $why'a yazilir. */
function vgm_resolve_public(string $host, string &$why): string
{
    $why = '';
    $ips = [];
    if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
        $ips = [$host];
    } else {
        $v4 = @gethostbynamel($host);
        if (is_array($v4)) {
            $ips = $v4;
        }
        if (function_exists('dns_get_record')) {
            $v6 = @dns_get_record($host, DNS_AAAA);
            if (is_array($v6)) {
                foreach ($v6 as $r) {
                    if (!empty($r['ipv6'])) {
                        $ips[] = (string)$r['ipv6'];
                    }
                }
            }
        }
    }
    if (!$ips) {
        $why = 'dns_failed';
        return '';
    }
    foreach ($ips as $ip) {
        if (vgm_ip_blocked($ip)) {
            $why = 'blocked_address';
            return '';
        }
    }
    foreach ($ips as $ip) {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
            return $ip;
        }
    }
    return $ips[0];
}

/** Izinli alan adlari: kucuk harf, "www." atilmis. */
function vgm_allow_list(array $hosts): array
{
    $out = [];
    foreach ($hosts as $h) {
        if (is_string($h) && trim($h) !== '') {
            $out[] = (string)preg_replace('/^www\./', '', strtolower(trim($h)));
        }
    }
    return $out;
}

/**
 * URL getirmeye uygun mu? Dondurur: [host, ip, path] veya hata ([] + $why). Yalniz https, 443, kimlik bilgisiz,
 * host izinli listede (bos liste: hicbir sey izinli degil), ad cozulunce tum adresler herkese acik.
 * $skipDns (yalniz test modu): ad cozulmez.
 */
function vgm_check_fetch_url(string $url, string &$why, array $allowHosts, bool $skipDns = false): array
{
    $why = '';
    $p = strlen($url) <= 1000 && preg_match('/[\x00-\x20\x7F<>"\'`\\\\]/', $url) !== 1 ? parse_url($url) : false;
    if (!is_array($p) || strtolower((string)($p['scheme'] ?? '')) !== 'https' || empty($p['host'])) {
        $why = 'scheme_not_allowed';
        return [];
    }
    if (isset($p['user']) || isset($p['pass']) || (isset($p['port']) && (int)$p['port'] !== 443)) {
        $why = 'url_not_allowed';
        return [];
    }
    $host = strtolower(trim((string)$p['host'], '[]'));
    $bare = (string)preg_replace('/^www\./', '', $host);
    if (!in_array($bare, vgm_allow_list($allowHosts), true)) {
        $why = 'host_not_allowed';
        return [];
    }
    $isIp = filter_var($host, FILTER_VALIDATE_IP) !== false;
    if (!$isIp && (preg_match('/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/D', $host) !== 1 || strpos($host, '.') === false)) {
        $why = 'url_not_allowed';
        return [];
    }
    if ($host === 'localhost' || substr($host, -6) === '.local' || substr($host, -10) === '.localhost'
        || substr($host, -9) === '.internal') {
        $why = 'blocked_address';
        return [];
    }
    $ip = '';
    if ($skipDns && !$isIp) {
        $ip = 'fixture';
    } else {
        $ip = vgm_resolve_public($host, $why);
        if ($ip === '') {
            return [];
        }
    }
    $path = (string)($p['path'] ?? '/') . (isset($p['query']) ? '?' . $p['query'] : '');
    $path = (string)preg_replace_callback('/[\x80-\xFF]/', function (array $m): string {
        return rawurlencode($m[0]);
    }, $path);
    return [$host, $ip, $path === '' ? '/' : $path];
}

/** Konum (Location) basligini mevcut adrese gore mutlak adrese cevirir. */
function vgm_resolve_location(string $base, string $loc): string
{
    $loc = trim($loc);
    if ($loc === '') {
        return '';
    }
    if (preg_match('#^[a-z][a-z0-9+.-]*:#i', $loc) === 1) {
        return $loc;
    }
    $b = parse_url($base);
    $origin = 'https://' . (is_array($b) ? (string)($b['host'] ?? '') : '');
    $bpath = is_array($b) ? (string)($b['path'] ?? '/') : '/';
    if (strpos($loc, '//') === 0) {
        return 'https:' . $loc;
    }
    if ($loc[0] === '/') {
        return $origin . vgm_dot_segments($loc);
    }
    if ($loc[0] === '?') {
        return $origin . $bpath . $loc;
    }
    if ($loc[0] === '#') {
        return $origin . $bpath;
    }
    return $origin . vgm_dot_segments((string)preg_replace('#/[^/]*$#', '/', $bpath) . $loc);
}

/** "/a/b/../c" -> "/a/c" (sorgu dizesi korunur). */
function vgm_dot_segments(string $path): string
{
    $query = '';
    $q = strpos($path, '?');
    if ($q !== false) {
        $query = substr($path, $q);
        $path = substr($path, 0, $q);
    }
    $out = [];
    foreach (explode('/', $path) as $seg) {
        if ($seg === '..') {
            array_pop($out);
        } elseif ($seg !== '.') {
            $out[] = $seg;
        }
    }
    $joined = implode('/', $out);
    return ($joined === '' || $joined[0] !== '/' ? '/' : '') . $joined . $query;
}

/* ------------------------------------------------------------------ HTTP */

/**
 * Tek istegin zaman asimi (sn). vgm_refresh canli kontrolde butce kalanina gore kisar; TCMB kuru (tek kaynak, TLS el
 * sikismasi yavas olabilir) daha uzun sure alir ($ceiling). Baglanti zaman asimi: en fazla 6 sn, uzun surede yarisi.
 */
function vgm_fetch_limit(?int $seconds = null, int $ceiling = VGM_FETCH_TIMEOUT): int
{
    static $limit = VGM_FETCH_TIMEOUT;
    if ($seconds !== null) {
        $limit = max(2, min($ceiling, $seconds));
    }
    return $limit;
}

/**
 * Mutlak son an (microtime) ya da null. Canli kontrolde butce asilamaz: her yonlendirme adiminda kalan sure yeniden
 * hesaplanir (vgm_fetch / vgm_http_once). $set verilirse ayarlanir; $clear ile kaldirilir.
 */
function vgm_fetch_deadline(?float $set = null, bool $clear = false): ?float
{
    static $deadline = null;
    if ($clear) {
        $deadline = null;
    } elseif ($set !== null) {
        $deadline = $set;
    }
    return $deadline;
}

/** Test modu klasoru (bos: gercek ag). Degisken verilmisse klasor olmasa bile ASLA gercek aga cikilmaz. */
function vgm_fixture_dir(): string
{
    $d = getenv('VG_MAGAZA_FIXTURE_DIR');
    return is_string($d) && trim($d) !== '' ? rtrim(str_replace('\\', '/', trim($d)), '/') : '';
}

/** Test modu tek istek: <sha1(url)>.html / .<durum> / .redirect; TCMB icin tcmb-today.xml. */
function vgm_fixture_once(string $dir, string $url, string &$why): array
{
    $isRate = $url === VGM_TCMB_URL;
    $base = $dir . '/' . ($isRate ? 'tcmb-today' : sha1($url));
    foreach ([403, 404, 410, 429, 500, 503] as $code) {
        if (is_file($base . '.' . $code)) {
            return ['status' => $code, 'location' => '', 'body' => ''];
        }
    }
    if (is_file($base . '.redirect')) {
        return ['status' => 302, 'location' => trim((string)file_get_contents($base . '.redirect')), 'body' => ''];
    }
    $file = $base . ($isRate ? '.xml' : '.html');
    if (!is_file($file)) {
        $why = 'fixture_missing';
        return [];
    }
    $body = (string)file_get_contents($file, false, null, 0, VGM_FETCH_MAX_BYTES + 1);
    if (strlen($body) > VGM_FETCH_MAX_BYTES) {
        $why = 'too_large';
        return [];
    }
    return ['status' => 200, 'location' => '', 'body' => $body];
}

/** Tek GET istegi, cozulmus IP'ye sabitlenmis. Dondurur: ['status','location','body'] veya hata ([] + $why). */
function vgm_http_once(string $host, string $ip, string $path, string &$why): array
{
    $accept = 'text/html,application/xhtml+xml;q=0.9,application/xml;q=0.8';
    $lang = 'tr-TR,tr;q=0.9,en;q=0.5';
    $timeout = vgm_fetch_limit();
    $timeoutMs = $timeout * 1000;
    $deadline = vgm_fetch_deadline();
    if ($deadline !== null) {
        $timeoutMs = max(300, min($timeoutMs, (int)floor(($deadline - microtime(true)) * 1000)));
        $timeout = max(1, (int)ceil($timeoutMs / 1000));
    }
    if (function_exists('curl_init')) {
        $buf = '';
        $status = 0;
        $location = '';
        $tooBig = false;
        $ch = curl_init('https://' . $host . $path);
        $pin = strpos($ip, ':') !== false ? '[' . $ip . ']' : $ip;
        $options = [
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_TIMEOUT_MS => $timeoutMs,
            CURLOPT_CONNECTTIMEOUT_MS => $timeoutMs > VGM_FETCH_TIMEOUT * 1000 ? intdiv($timeoutMs, 2) : min(VGM_FETCH_CONNECT_TIMEOUT * 1000, $timeoutMs),
            CURLOPT_USERAGENT => VGM_FETCH_UA,
            CURLOPT_RESOLVE => [$host . ':443:' . $pin],
            CURLOPT_HTTPHEADER => ['Accept: ' . $accept, 'Accept-Language: ' . $lang],
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_ENCODING => '',
            CURLOPT_NOSIGNAL => true,
            CURLOPT_HEADERFUNCTION => function ($c, $line) use (&$status, &$location) {
                if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m) === 1) {
                    $status = (int)$m[1];
                    $location = '';
                } elseif (stripos($line, 'location:') === 0) {
                    $location = trim(substr($line, 9));
                }
                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION => function ($c, $chunk) use (&$buf, &$tooBig) {
                if (strlen($buf) + strlen($chunk) > VGM_FETCH_MAX_BYTES) {
                    $tooBig = true;
                    return -1;
                }
                $buf .= $chunk;
                return strlen($chunk);
            },
        ];
        if (defined('CURLOPT_PROTOCOLS_STR')) {
            $options[CURLOPT_PROTOCOLS_STR] = 'https';
        } elseif (defined('CURLPROTO_HTTPS')) {
            $options[CURLOPT_PROTOCOLS] = CURLPROTO_HTTPS;
        }
        if (PHP_OS_FAMILY === 'Windows' && defined('CURLSSLOPT_NATIVE_CA')) {
            $options[CURLOPT_SSL_OPTIONS] = CURLSSLOPT_NATIVE_CA;
        }
        curl_setopt_array($ch, $options);
        $ok = curl_exec($ch);
        $err = curl_errno($ch);
        curl_close($ch);
        if ($tooBig) {
            $why = 'too_large';
            return [];
        }
        if ($ok === false) {
            $why = 'network_error_' . $err;
            return [];
        }
        return ['status' => $status, 'location' => $location, 'body' => $buf];
    }
    // curl yoksa: PHP akis sarmalayicisi; IP'ye baglanip SNI/sertifika adi olarak gercek ad kullanilir.
    $ctx = stream_context_create([
        'http' => ['method' => 'GET', 'timeout' => $timeoutMs / 1000, 'follow_location' => 0, 'max_redirects' => 0,
            'ignore_errors' => true, 'protocol_version' => 1.0,
            'header' => "Host: " . $host . "\r\nUser-Agent: " . VGM_FETCH_UA . "\r\nAccept: " . $accept
                . "\r\nAccept-Language: " . $lang . "\r\nConnection: close\r\n"],
        'ssl' => ['peer_name' => $host, 'verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true],
    ]);
    $target = 'https://' . (strpos($ip, ':') !== false ? '[' . $ip . ']' : $ip) . $path;
    $fp = @fopen($target, 'rb', false, $ctx);
    if ($fp === false) {
        $why = 'network_error';
        return [];
    }
    $buf = '';
    while (!feof($fp)) {
        $chunk = fread($fp, 65536);
        if ($chunk === false) {
            break;
        }
        $buf .= $chunk;
        if (strlen($buf) > VGM_FETCH_MAX_BYTES) {
            fclose($fp);
            $why = 'too_large';
            return [];
        }
    }
    $meta = stream_get_meta_data($fp);
    fclose($fp);
    $status = 0;
    $location = '';
    $gzip = false;
    foreach ((array)($meta['wrapper_data'] ?? []) as $line) {
        $line = (string)$line;
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m) === 1) {
            $status = (int)$m[1];
        } elseif (stripos($line, 'location:') === 0) {
            $location = trim(substr($line, 9));
        } elseif (stripos($line, 'content-encoding:') === 0 && stripos($line, 'gzip') !== false) {
            $gzip = true;
        }
    }
    if ($gzip && function_exists('gzdecode')) {
        $plain = @gzdecode($buf, VGM_FETCH_MAX_BYTES + 1);
        if (is_string($plain)) {
            $buf = strlen($plain) > VGM_FETCH_MAX_BYTES ? '' : $plain;
            if ($buf === '') {
                $why = 'too_large';
                return [];
            }
        }
    }
    return ['status' => $status, 'location' => $location, 'body' => $buf];
}

/**
 * GET: yonlendirmeleri (en fazla 3) her adimda yeniden denetleyerek getirir. Basarisizlikta '' doner; neden $why'da
 * (kod, adres icermez), son HTTP durumu $status'ta. Yalnizca https ve $allowHosts icindeki alan adlari.
 */
function vgm_fetch(string $url, array $allowHosts, string &$why, int &$status): string
{
    $status = 0;
    $why = '';
    $fixture = vgm_fixture_dir();
    for ($hop = 0; $hop <= VGM_FETCH_MAX_REDIRECTS; $hop++) {
        $deadline = vgm_fetch_deadline();
        if ($deadline !== null && $deadline - microtime(true) < 1.0) {
            $why = 'budget';
            return '';
        }
        $target = vgm_check_fetch_url($url, $why, $allowHosts, $fixture !== '');
        if (!$target) {
            return '';
        }
        $res = $fixture !== '' ? vgm_fixture_once($fixture, $url, $why) : vgm_http_once($target[0], $target[1], $target[2], $why);
        if (!$res) {
            return '';
        }
        $status = (int)$res['status'];
        if ($status >= 300 && $status < 400 && (string)$res['location'] !== '') {
            $url = vgm_resolve_location($url, (string)$res['location']);
            continue;
        }
        if ($status !== 200) {
            $why = 'http_' . $status;
            return '';
        }
        return (string)$res['body'];
    }
    $why = 'too_many_redirects';
    return '';
}

/* ------------------------------------------------------------------ HTML yardimcilari */

function vgm_is_list(array $a): bool
{
    return $a === [] || array_keys($a) === range(0, count($a) - 1);
}

/** Gecerli UTF-8 degilse (eski Turkce siteler) Windows-1254'ten cevirir. */
function vgm_utf8(string $s): string
{
    if (preg_match('//u', $s) === 1) {
        return $s;
    }
    if (function_exists('iconv')) {
        $c = @iconv('Windows-1254', 'UTF-8//IGNORE', $s);
        if (is_string($c) && $c !== '') {
            return $c;
        }
    }
    return (string)preg_replace('/[^\x00-\x7F]+/', '?', $s);
}

function vgm_clip(string $s, int $max): string
{
    if (preg_match('//u', $s) !== 1) {
        return '';
    }
    if (function_exists('mb_substr')) {
        return mb_substr($s, 0, $max, 'UTF-8');
    }
    preg_match('/^.{0,' . $max . '}/us', $s, $m);
    return $m[0] ?? '';
}

/** HTML varliklarini cozer, kontrol karakterlerini atar, bosluklari sadelestirir, kirpar. */
function vgm_plain(string $s, int $max = 200): string
{
    $s = html_entity_decode($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $s = (string)preg_replace('/[\x00-\x1F\x7F]+/', ' ', $s);
    $s = (string)preg_replace('/[ \t\x{00A0}]+/u', ' ', $s);
    return vgm_clip(trim($s), $max);
}

/** <!-- ... --> yorumlarini atar (kapanmayan yorum: gerisi de). */
function vgm_strip_comments(string $html): string
{
    $out = '';
    $pos = 0;
    while (($s = strpos($html, '<!--', $pos)) !== false) {
        $out .= substr($html, $pos, $s - $pos);
        $e = strpos($html, '-->', $s + 4);
        if ($e === false) {
            return $out;
        }
        $pos = $e + 3;
    }
    return $out . substr($html, $pos);
}

/** Verilen etiketleri (icerikleriyle) atar: script, style, template. */
function vgm_strip_elements(string $html, array $names): string
{
    foreach ($names as $name) {
        $open = '<' . $name;
        $out = '';
        $pos = 0;
        while (($s = stripos($html, $open, $pos)) !== false) {
            $after = $html[$s + strlen($open)] ?? '';
            if ($after !== '' && !ctype_space($after) && $after !== '>' && $after !== '/') {
                $out .= substr($html, $pos, $s + strlen($open) - $pos);
                $pos = $s + strlen($open);
                continue;
            }
            $out .= substr($html, $pos, $s - $pos);
            $e = stripos($html, '</' . $name, $s);
            if ($e === false) {
                $pos = strlen($html);
                break;
            }
            $gt = strpos($html, '>', $e);
            $pos = $gt === false ? strlen($html) : $gt + 1;
        }
        $html = $out . substr($html, $pos);
    }
    return $html;
}

/** <script type="application/ld+json"> govdeleri. */
function vgm_script_blocks(string $html): array
{
    $out = [];
    $pos = 0;
    while (count($out) < 40 && ($s = stripos($html, '<script', $pos)) !== false) {
        $gt = strpos($html, '>', $s);
        if ($gt === false) {
            break;
        }
        $e = stripos($html, '</script', $gt);
        if ($e === false) {
            break;
        }
        $attrs = substr($html, $s + 7, $gt - $s - 7);
        if (preg_match('#\btype\s*=\s*["\']?\s*application/ld\+json#i', $attrs) === 1 && $e - $gt <= 524288) {
            $out[] = substr($html, $gt + 1, $e - $gt - 1);
        }
        $pos = $e + 8;
    }
    return $out;
}

/** Etiket oznitelikleri: ad (kucuk harf) => deger (varliklar cozulmus). */
function vgm_attrs(string $s): array
{
    $out = [];
    if (preg_match_all('/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s"\'<>=`]+)))?/', $s, $m, PREG_SET_ORDER) === false) {
        return $out;
    }
    foreach ($m as $a) {
        $name = strtolower($a[1]);
        if (!isset($out[$name])) {
            $out[$name] = html_entity_decode(($a[2] ?? '') . ($a[3] ?? '') . ($a[4] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        }
    }
    return $out;
}

/**
 * Oznitelik metninde $needleRegex (hazir kacisli desen) gecen etiketleri tarar. Dondurur: [['tag','attrs','text'], ...];
 * text, etiketin icerigi (ayni etiketin ilk kapanisina kadar, en fazla 400 bayt) sade metin olarak.
 */
function vgm_scan_tags(string $html, string $needleRegex, int $limit = 400): array
{
    $out = [];
    $re = '/<([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*' . $needleRegex . '[^<>]*)>/i';
    if (preg_match_all($re, $html, $m, PREG_SET_ORDER | PREG_OFFSET_CAPTURE) === false) {
        return $out;
    }
    foreach ($m as $hit) {
        if (count($out) >= $limit) {
            break;
        }
        $tag = strtolower($hit[1][0]);
        $chunk = (string)substr($html, $hit[0][1] + strlen($hit[0][0]), 400);
        $close = stripos($chunk, '</' . $tag);
        if ($close !== false) {
            $chunk = substr($chunk, 0, $close);
        }
        $out[] = ['tag' => $tag, 'attrs' => vgm_attrs($hit[2][0]), 'text' => vgm_plain(strip_tags($chunk))];
    }
    return $out;
}

/* ------------------------------------------------------------------ JSON-LD */

/** Bozuk JSON'u bosluk/varlik/virgul onarimlariyla kademeli cozer; cozulemezse null. */
function vgm_json_lenient(string $raw): ?array
{
    $raw = trim(str_replace(['<![CDATA[', ']]>'], '', (string)preg_replace('/^\xEF\xBB\xBF/', '', trim($raw))));
    if ($raw === '') {
        return null;
    }
    $spaced = (string)preg_replace('/[\x00-\x1F]+/', ' ', $raw);
    $decoded = (string)preg_replace('/[\x00-\x1F]+/', ' ', html_entity_decode($raw, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    $attempts = [$raw, $spaced, $decoded, (string)preg_replace('/,\s*([}\]])/', '$1', $spaced)];
    foreach ($attempts as $a) {
        $d = json_decode($a, true, 64, JSON_INVALID_UTF8_SUBSTITUTE);
        if (is_array($d)) {
            return $d;
        }
    }
    return null;
}

/** @type degeri (metin veya liste) -> sade, kucuk harfli tur adlari (on ek ve ad alani atilir). */
function vgm_types($t): array
{
    $out = [];
    foreach ((is_array($t) ? $t : [$t]) as $x) {
        if (is_string($x)) {
            $out[] = strtolower((string)preg_replace('~^.*[/#:]~', '', trim($x)));
        }
    }
    return $out;
}

/** Product dugumlerini ve @id dizinini toplar (yalniz ust duzey: kok, @graph, mainEntity). */
function vgm_ld_collect($node, array &$products, array &$index, int $depth): void
{
    if ($depth > 6 || !is_array($node)) {
        return;
    }
    if (vgm_is_list($node)) {
        foreach (array_slice($node, 0, 100) as $child) {
            vgm_ld_collect($child, $products, $index, $depth + 1);
        }
        return;
    }
    if (is_string($node['@id'] ?? null) && count($node) > 1) {
        $index[$node['@id']] = $node;
    }
    if (array_intersect(vgm_types($node['@type'] ?? []), ['product', 'individualproduct']) !== []) {
        $products[] = $node;
    }
    foreach (['@graph', 'mainEntity', 'mainEntityOfPage'] as $k) {
        if (isset($node[$k])) {
            vgm_ld_collect($node[$k], $products, $index, $depth + 1);
        }
    }
}

function vgm_entry(float $price, $currency, ?bool $available, bool $range): array
{
    return ['price' => $price, 'currency' => $currency, 'available' => $available, 'range' => $range];
}

/** Product.offers -> fiyat kayitlari (Offer, liste, AggregateOffer yalniz lowPrice=highPrice/offerCount=1, priceSpecification). */
function vgm_ld_offer_entries($offers, array &$entries, array $index, int $depth, $parentCurrency, ?bool $parentAvail): void
{
    if ($depth > 4 || !is_array($offers)) {
        return;
    }
    if (vgm_is_list($offers)) {
        foreach (array_slice($offers, 0, 50) as $o) {
            vgm_ld_offer_entries($o, $entries, $index, $depth + 1, $parentCurrency, $parentAvail);
        }
        return;
    }
    if (count($offers) === 1 && is_string($offers['@id'] ?? null) && isset($index[$offers['@id']])) {
        $offers = $index[$offers['@id']];
    }
    $types = vgm_types($offers['@type'] ?? []);
    $currency = array_key_exists('priceCurrency', $offers) ? vgm_currency($offers['priceCurrency']) : null;
    if ($currency === null) {
        $currency = $parentCurrency;
    }
    $avail = vgm_availability($offers['availability'] ?? null);
    if ($avail === null) {
        $avail = $parentAvail;
    }
    if (in_array('aggregateoffer', $types, true)) {
        $before = count($entries);
        vgm_ld_offer_entries($offers['offers'] ?? null, $entries, $index, $depth + 1, $currency, $avail);
        if (count($entries) > $before) {
            return;
        }
        $low = vgm_price_value($offers['lowPrice'] ?? null);
        $high = vgm_price_value($offers['highPrice'] ?? null);
        $single = is_numeric($offers['offerCount'] ?? null) && (int)$offers['offerCount'] === 1;
        if ($low !== null && $high !== null && abs($low - $high) < 0.005) {
            $entries[] = vgm_entry($low, $currency, $avail, false);
        } elseif ($single && ($low ?? $high) !== null) {
            $entries[] = vgm_entry((float)($low ?? $high), $currency, $avail, false);
        } else {
            foreach (array_unique(array_filter([$low, $high], function ($v) {
                return $v !== null;
            })) as $v) {
                $entries[] = vgm_entry((float)$v, $currency, $avail, true);
            }
        }
        return;
    }
    $price = vgm_price_value($offers['price'] ?? null);
    if ($price !== null) {
        $entries[] = vgm_entry($price, $currency, $avail, false);
        return;
    }
    $specs = $offers['priceSpecification'] ?? null;
    if (!is_array($specs)) {
        return;
    }
    foreach (array_slice(vgm_is_list($specs) ? $specs : [$specs], 0, 10) as $sp) {
        if (!is_array($sp)) {
            continue;
        }
        if (array_intersect(vgm_types($sp['@type'] ?? []), ['deliverychargespecification', 'paymentchargespecification']) !== []) {
            continue;
        }
        $ptype = is_string($sp['priceType'] ?? null) ? strtolower($sp['priceType']) : '';
        if ($ptype !== '' && preg_match('/list|msrp|srp|strike|minimumadvertised|invoice/', $ptype) === 1) {
            continue;
        }
        $sv = vgm_price_value($sp['price'] ?? null);
        if ($sv === null) {
            continue;
        }
        $cur = array_key_exists('priceCurrency', $sp) ? vgm_currency($sp['priceCurrency']) : null;
        $entries[] = vgm_entry($sv, $cur === null ? $currency : $cur, $avail, false);
    }
}

/** Dugumdeki metin degeri (metin, sayi, liste ilk eleman, nesne icin $keys). */
function vgm_ld_str($v, array $keys = ['name'], int $max = 200): ?string
{
    if (is_int($v) || is_float($v)) {
        $v = (string)$v;
    }
    if (is_string($v)) {
        $t = vgm_plain($v, $max);
        return $t === '' ? null : $t;
    }
    if (is_array($v)) {
        if (vgm_is_list($v)) {
            foreach (array_slice($v, 0, 10) as $x) {
                $t = vgm_ld_str($x, $keys, $max);
                if ($t !== null) {
                    return $t;
                }
            }
            return null;
        }
        foreach ($keys as $k) {
            if (isset($v[$k])) {
                $t = vgm_ld_str($v[$k], $keys, $max);
                if ($t !== null) {
                    return $t;
                }
            }
        }
    }
    return null;
}

function vgm_ld_identity(array $node): array
{
    $gtin = null;
    foreach (['gtin', 'gtin14', 'gtin13', 'gtin12', 'gtin8'] as $k) {
        $g = vgm_ld_str($node[$k] ?? null, ['value'], 30);
        if ($g !== null && preg_match('/[0-9]/', $g) === 1) {
            $gtin = $g;
            break;
        }
    }
    $offer = $node['offers'] ?? null;
    if (is_array($offer) && vgm_is_list($offer) && isset($offer[0])) {
        $offer = $offer[0];
    }
    $fromOffer = function (string $key) use ($offer): ?string {
        return is_array($offer) ? vgm_ld_str($offer[$key] ?? null, ['value'], 60) : null;
    };
    return [
        'name' => vgm_ld_str($node['name'] ?? null, ['name'], 200),
        'brand' => vgm_ld_str($node['brand'] ?? null, ['name'], 100),
        'gtin' => $gtin ?? $fromOffer('gtin13') ?? $fromOffer('gtin'),
        'mpn' => vgm_ld_str($node['mpn'] ?? null, ['value'], 60) ?? $fromOffer('mpn'),
        'sku' => vgm_ld_str($node['sku'] ?? null, ['value'], 60) ?? $fromOffer('sku'),
        'image' => vgm_ld_str($node['image'] ?? null, ['url', 'contentUrl'], 500),
    ];
}

/** "https://www.x.test/a/b/#frag" -> "x.test/a/b" (sayfa adresiyle eslestirme). */
function vgm_url_key(string $u, string $base): string
{
    $p = parse_url(vgm_resolve_location($base, (string)preg_replace('/#.*$/', '', $u)));
    if (!is_array($p) || empty($p['host'])) {
        return '';
    }
    return strtolower((string)preg_replace('/^www\./', '', (string)$p['host'])) . rtrim((string)($p['path'] ?? ''), '/');
}

function vgm_ld_url_matches(array $node, string $page): bool
{
    $key = vgm_url_key($page, $page);
    $urls = [$node['url'] ?? null, $node['@id'] ?? null];
    $offer = $node['offers'] ?? null;
    if (is_array($offer) && !vgm_is_list($offer)) {
        $urls[] = $offer['url'] ?? null;
    }
    foreach ($urls as $u) {
        if (is_string($u) && $u !== '' && $key !== '' && vgm_url_key($u, $page) === $key) {
            return true;
        }
    }
    return false;
}

/** JSON-LD seviyesi: bulunan fiyat kayitlari + kimlik; hic fiyat yoksa null. */
function vgm_level_jsonld(string $html, string $url): ?array
{
    $products = [];
    $index = [];
    foreach (vgm_script_blocks($html) as $raw) {
        $data = vgm_json_lenient($raw);
        if ($data !== null) {
            vgm_ld_collect($data, $products, $index, 0);
        }
    }
    $cands = [];
    foreach ($products as $node) {
        $entries = [];
        vgm_ld_offer_entries($node['offers'] ?? null, $entries, $index, 0, null, null);
        if ($entries) {
            $cands[] = ['node' => $node, 'entries' => $entries];
        }
    }
    if (!$cands) {
        return null;
    }
    $chosen = $cands[0];
    $merged = $cands[0]['entries'];
    if (count($cands) > 1) {
        $sig = function (array $c): string {
            $p = [];
            foreach ($c['entries'] as $e) {
                $p[(string)(int)round($e['price'] * 100)] = 1;
            }
            ksort($p);
            return implode(',', array_keys($p)) . (count(array_filter($c['entries'], function (array $e): bool {
                return $e['range'];
            })) > 0 ? 'r' : '');
        };
        $sigs = array_unique(array_map($sig, $cands));
        if (count($sigs) > 1) {
            $byUrl = array_values(array_filter($cands, function (array $c) use ($url): bool {
                return vgm_ld_url_matches($c['node'], $url);
            }));
            if (count($byUrl) === 1) {
                $chosen = $byUrl[0];
                $merged = $byUrl[0]['entries'];
            } else {
                $merged = [];
                foreach ($cands as $c) {
                    $merged = array_merge($merged, $c['entries']);
                }
            }
        }
    }
    return ['method' => 'jsonld', 'entries' => $merged, 'ident' => vgm_ld_identity($chosen['node'])];
}

/* ------------------------------------------------------------------ microdata, OG, platform yedekleri */

/**
 * itemprop/itemscope ogeleri (belge sirasiyla): ['names' => 'price', 'value' => ..., 'machine' => bool, 'scope' => bool].
 * scope: etiket yeni bir itemscope baslatir (kapanislar izlenmez; kapsam parcalari itemscope sinirlariyla ayrilir).
 */
function vgm_itemprops(string $html): array
{
    $out = [];
    foreach (vgm_scan_tags($html, '\bitem(?:prop|scope)\b') as $el) {
        $a = $el['attrs'];
        $scope = isset($a['itemscope']);
        $names = strtolower(trim((string)($a['itemprop'] ?? '')));
        $row = ['names' => $names, 'value' => '', 'machine' => false, 'scope' => $scope];
        if ($names === '') {
            if ($scope) {
                $out[] = $row;
            }
            continue;
        }
        if (isset($a['content'])) {
            $row['value'] = $a['content'];
            $row['machine'] = true;
        } elseif (isset($a['href']) && in_array($el['tag'], ['link', 'a'], true)) {
            $row['value'] = $a['href'];
            $row['machine'] = true;
        } elseif (isset($a['value']) && in_array($el['tag'], ['data', 'meter', 'input'], true)) {
            $row['value'] = $a['value'];
            $row['machine'] = true;
        } elseif (!in_array($el['tag'], ['meta', 'link', 'img', 'input'], true)) {
            $row['value'] = $el['text'];
        }
        $out[] = $row;
    }
    return $out;
}

/**
 * microdata seviyesi. Fiyat ayrintisi (priceSpecification) liste/ustu cizili/onerilen fiyat turundeyse
 * (itemprop="priceType") o kapsamdaki fiyat sayilmaz; kalan farkli fiyatlar "ambiguous_price" olur.
 */
function vgm_level_microdata(string $html): ?array
{
    if (stripos($html, 'itemprop') === false) {
        return null;
    }
    $prices = [];
    $lows = [];
    $highs = [];
    $reference = [];
    $currencies = [];
    $avail = [];
    $ident = [];
    $seg = 0;
    foreach (vgm_itemprops($html) as $prop) {
        if ($prop['scope']) {
            $seg++;
        }
        $val = (string)$prop['value'];
        foreach (preg_split('/\s+/', $prop['names']) ?: [] as $n) {
            switch ($n) {
                case 'pricetype':
                    if (preg_match('/list|msrp|srp|strike|minimumadvertised|invoice/', strtolower($val)) === 1) {
                        $reference[$seg] = true;
                    }
                    break;
                case 'price':
                case 'lowprice':
                case 'highprice':
                    $v = vgm_parse_number($val, $prop['machine']);
                    if ($v !== null) {
                        if ($n === 'price') {
                            $prices[] = [$seg, $v];
                        } elseif ($n === 'lowprice') {
                            $lows[] = [$seg, $v];
                        } else {
                            $highs[] = [$seg, $v];
                        }
                    }
                    break;
                case 'pricecurrency':
                    $c = vgm_currency($val);
                    if ($c !== null) {
                        $currencies[] = $c;
                    }
                    break;
                case 'availability':
                    $a = vgm_availability($val);
                    if ($a !== null) {
                        $avail[] = $a;
                    }
                    break;
                case 'name':
                case 'mpn':
                case 'sku':
                case 'brand':
                    if (!isset($ident[$n]) && $val !== '') {
                        $ident[$n] = vgm_plain($val, 200);
                    }
                    break;
                case 'gtin':
                case 'gtin8':
                case 'gtin12':
                case 'gtin13':
                case 'gtin14':
                    if (!isset($ident['gtin']) && preg_match('/[0-9]/', $val) === 1) {
                        $ident['gtin'] = vgm_plain($val, 30);
                    }
                    break;
            }
        }
    }
    $keep = function (array $rows) use ($reference): array {
        $out = [];
        foreach ($rows as $r) {
            if (!isset($reference[$r[0]])) {
                $out[] = $r[1];
            }
        }
        return $out;
    };
    $entries = [];
    foreach ($keep($prices) as $v) {
        $entries[] = vgm_entry($v, null, null, false);
    }
    $low = $keep($lows);
    $high = $keep($highs);
    if ($low && !$entries) {
        $lowV = min($low);
        $highV = $high ? max($high) : null;
        $entries[] = vgm_entry($lowV, null, null, $highV === null || abs($lowV - $highV) >= 0.005);
    }
    if (!$entries) {
        return null;
    }
    $currencies = array_values(array_unique($currencies));
    $cur = count($currencies) === 1 ? $currencies[0] : null;
    foreach ($entries as $i => $e) {
        $entries[$i]['currency'] = $cur;
        $entries[$i]['available'] = $avail ? in_array(true, $avail, true) : null;
    }
    if (count($currencies) > 1) {
        // celisen para birimleri: ambiguous_price olarak isaretle
        $entries[] = vgm_entry($entries[0]['price'], $currencies[0], null, true);
    }
    return ['method' => 'microdata', 'entries' => $entries, 'ident' => $ident];
}

function vgm_level_meta(string $html): ?array
{
    if (stripos($html, 'price:amount') === false) {
        return null;
    }
    $metas = [];
    if (preg_match_all('/<meta\b([^<>]*)>/i', $html, $m) !== false) {
        foreach ($m[1] as $attrs) {
            $a = vgm_attrs($attrs);
            $key = strtolower((string)($a['property'] ?? ($a['name'] ?? '')));
            if ($key !== '' && isset($a['content'])) {
                $metas[$key][] = $a['content'];
            }
        }
    }
    foreach ([['product:price:amount', 'product:price:currency'], ['og:price:amount', 'og:price:currency']] as $pair) {
        if (!isset($metas[$pair[0]])) {
            continue;
        }
        $cur = vgm_currency($metas[$pair[1]][0] ?? null);
        $entries = [];
        foreach ($metas[$pair[0]] as $v) {
            $price = vgm_parse_number($v, true);
            if ($price !== null) {
                $entries[] = vgm_entry($price, $cur, null, false);
            }
        }
        if ($entries) {
            return ['method' => 'og', 'entries' => $entries, 'ident' => [
                'name' => isset($metas['og:title'][0]) ? vgm_plain($metas['og:title'][0], 200) : null,
                'image' => isset($metas['og:image'][0]) ? vgm_plain($metas['og:image'][0], 500) : null,
            ]];
        }
    }
    return null;
}

/**
 * Dar platform yedekleri (WooCommerce, OpenCart, Ticimax, IdeaSoft, T-Soft). Her biri yalniz kendi ayirt edici
 * sinif adini okur; birden cok fiyat bulunursa ayristirici "ambiguous_price" der (tahmin yok).
 */
function vgm_level_platform(string $html): ?array
{
    $classText = function (array $classes) use ($html): array {
        $texts = [];
        foreach ($classes as $cls) {
            foreach (vgm_scan_tags($html, preg_quote($cls, '/'), 80) as $el) {
                $tokens = preg_split('/\s+/', (string)($el['attrs']['class'] ?? '') . ' ' . (string)($el['attrs']['id'] ?? '')) ?: [];
                if (in_array($cls, $tokens, true) && $el['text'] !== '') {
                    $texts[] = $el['text'];
                }
            }
        }
        return $texts;
    };
    $finders = [
        'woocommerce' => function () use ($html): array {
            $texts = [];
            if (stripos($html, 'woocommerce-Price-amount') === false
                || preg_match_all('~<p\b[^>]*\bclass\s*=\s*(["\'])([^"\']*)\1[^>]*>(.*?)</p>~is', $html, $m, PREG_SET_ORDER) === false) {
                return $texts;
            }
            foreach ($m as $blk) {
                if (!in_array('price', preg_split('/\s+/', $blk[2]) ?: [], true)) {
                    continue;
                }
                $block = $blk[3];
                if (preg_match_all('~<ins\b[^>]*>(.*?)</ins>~is', $block, $ins) > 0) {
                    $block = implode(' ', $ins[1]);
                }
                foreach (array_slice(explode('woocommerce-Price-amount', $block), 1) as $seg) {
                    $gt = strpos($seg, '>');
                    $texts[] = vgm_plain(strip_tags($gt === false ? $seg : substr($seg, $gt + 1)), 80);
                }
            }
            return $texts;
        },
        'opencart' => function () use ($classText, $html): array {
            $texts = $classText(['price-new']);
            if (!$texts && preg_match_all('~<li>\s*<h2[^>]*>\s*([^<]{1,40}?)\s*</h2>\s*</li>~i', $html, $m) > 0) {
                foreach ($m[1] as $t) {
                    $t = vgm_plain($t, 40);
                    if (preg_match('/^(?:[\x{20BA}$\x{20AC}]\s*)?[0-9][0-9.,\s]*\s*(?:TL|TRY|USD|EUR|[\x{20BA}$\x{20AC}])?$/u', $t) === 1) {
                        $texts[] = $t;
                    }
                }
            }
            return $texts;
        },
        'ticimax' => function () use ($classText): array {
            return $classText(['spanFiyat', 'spnFiyat']);
        },
        'ideasoft' => function () use ($classText): array {
            return $classText(['product-current-price', 'product-price']);
        },
        'tsoft' => function () use ($classText): array {
            return $classText(['currentPrice', 'product-detail-price']);
        },
    ];
    foreach ($finders as $name => $find) {
        $entries = [];
        foreach ($find() as $t) {
            $price = vgm_parse_number($t, false);
            if ($price !== null) {
                $cur = vgm_currency_in_text($t);
                $entries[] = vgm_entry($price, $cur, null, false);
            }
        }
        if ($entries) {
            return ['method' => 'platform:' . $name, 'entries' => $entries, 'ident' => []];
        }
    }
    return null;
}

/* ------------------------------------------------------------------ teklif ayristirma */

function vgm_offer_blank(): array
{
    return ['ok' => false, 'price' => null, 'currency' => null, 'available' => null, 'name' => null, 'brand' => null,
        'gtin' => null, 'mpn' => null, 'sku' => null, 'image' => null, 'method' => null, 'candidates' => [], 'error' => ''];
}

/** Seviye sonucunu ayristirici ciktisina cevirir: tek fiyat, para birimi, stok; celiskide ambiguous_price. */
function vgm_level_result(array $level, string $url): array
{
    $r = vgm_offer_blank();
    $r['method'] = $level['method'];
    foreach (['name', 'brand', 'gtin', 'mpn', 'sku', 'image'] as $k) {
        $v = $level['ident'][$k] ?? null;
        $r[$k] = is_string($v) && $v !== '' ? $v : null;
    }
    if ($r['image'] !== null && preg_match('#^https?://#i', $r['image']) !== 1) {
        $r['image'] = vgm_resolve_location($url, $r['image']);
    }
    $prices = [];
    $range = false;
    $cur = [];
    $avail = [];
    foreach ($level['entries'] as $e) {
        $prices[(string)(int)round($e['price'] * 100)] = $e['price'];
        $range = $range || !empty($e['range']);
        if ($e['currency'] !== null) {
            $cur[$e['currency'] === false ? '?' : $e['currency']] = true;
        }
        if ($e['available'] !== null) {
            $avail[] = $e['available'];
        }
    }
    $values = array_values($prices);
    sort($values);
    $r['candidates'] = $values;
    if (count($values) !== 1 || $range || count($cur) > 1) {
        $r['error'] = 'ambiguous_price';
        return $r;
    }
    if (isset($cur['?'])) {
        $r['error'] = 'unsupported_currency';
        return $r;
    }
    $r['currency'] = $cur ? (string)array_key_first($cur) : null;
    $r['price'] = $values[0];
    $r['available'] = $avail ? in_array(true, $avail, true) : null;
    $r['ok'] = true;
    return $r;
}

/**
 * Urun sayfasindan tek bir teklif cikarir. Oncelik: JSON-LD Product > microdata > meta product:price:amount /
 * og:price:amount > dar platform yedekleri; kazanan seviyede celisen fiyat varsa ok=false, error='ambiguous_price'.
 * Fiyat hic bulunamazsa error='no_price'. Stok yalniz yapisal veriden (schema.org availability).
 */
function vgm_parse_offer(string $html, string $url): array
{
    $r = vgm_offer_blank();
    if (trim($html) === '') {
        $r['error'] = 'empty_page';
        return $r;
    }
    if (strlen($html) > VGM_FETCH_MAX_BYTES) {
        $html = substr($html, 0, VGM_FETCH_MAX_BYTES);
    }
    $html = vgm_strip_comments(vgm_utf8($html));
    $level = vgm_level_jsonld($html, $url);
    if ($level === null) {
        $plain = vgm_strip_elements($html, ['script', 'style', 'template']);
        $level = vgm_level_microdata($plain) ?? vgm_level_meta($plain) ?? vgm_level_platform($plain);
    }
    if ($level === null) {
        $r['error'] = 'no_price';
        return $r;
    }
    return vgm_level_result($level, $url);
}

/* ------------------------------------------------------------------ kimlik dogrulama ve tedarikci teklifi */

/** GTIN: yalniz rakam; 8/12/13/14 hane degilse bos; basindaki sifirlar atilir (GTIN-12/13/14 es sayilir). */
function vgm_norm_gtin($v): string
{
    $d = (string)preg_replace('/[^0-9]+/', '', is_scalar($v) ? (string)$v : '');
    return in_array(strlen($d), [8, 12, 13, 14], true) ? ltrim($d, '0') : '';
}

/** Uretici parca numarasi: harf/rakam disindakiler atilir, buyuk harf. */
function vgm_norm_code($v): string
{
    return strtoupper((string)preg_replace('/[^A-Za-z0-9]+/', '', is_scalar($v) ? (string)$v : ''));
}

/** Sayfadaki kimlik urunle celismiyor mu (GTIN ikisinde de varsa GTIN; yoksa MPN, sayfa SKU'su kurtarabilir)? */
function vgm_identity_ok(array $page, array $product): bool
{
    $pg = vgm_norm_gtin($page['gtin'] ?? '');
    $cg = vgm_norm_gtin($product['gtin'] ?? '');
    if ($pg !== '' && $cg !== '') {
        return $pg === $cg;
    }
    $cm = vgm_norm_code($product['mpn'] ?? '');
    $pm = vgm_norm_code($page['mpn'] ?? '');
    if ($cm !== '' && $pm !== '') {
        return $pm === $cm || vgm_norm_code($page['sku'] ?? '') === $cm;
    }
    return true;
}

/**
 * Kaynak kaydindan teklif: vgm_apply_check'e uygun dizi veya hata ['error'=>kod, 'gone'=>true (404/410)].
 * Yalniz kaynagin kendi alan adi izinlidir. Kimlik (GTIN/MPN) celisirse 'identity_mismatch'.
 */
function vgm_fetch_offer(array $src, array $product): array
{
    $url = is_string($src['url'] ?? null) ? $src['url'] : '';
    $supplier = is_string($src['supplier'] ?? null) ? $src['supplier'] : '';
    if ($url === '' || $supplier === '') {
        return ['error' => 'bad_source'];
    }
    $why = '';
    $status = 0;
    $html = vgm_fetch($url, [$supplier], $why, $status);
    if ($html === '') {
        if ($status === 404 || $status === 410) {
            return ['error' => 'http_' . $status, 'gone' => true];
        }
        return ['error' => $why !== '' ? $why : 'empty_response'];
    }
    $o = vgm_parse_offer($html, $url);
    if (!$o['ok']) {
        return ['error' => $o['error'] !== '' ? $o['error'] : 'parse_failed'];
    }
    if (!vgm_identity_ok($o, $product)) {
        return ['error' => 'identity_mismatch'];
    }
    $fallback = is_string($src['currency'] ?? null) ? strtoupper($src['currency']) : 'TRY';
    $discount = $src['discount'] ?? 0;
    return [
        'price' => (float)$o['price'],
        'currency' => is_string($o['currency']) ? $o['currency'] : $fallback,
        'vatIncluded' => ($src['vatIncluded'] ?? true) !== false,
        'discount' => is_int($discount) || is_float($discount) ? $discount : 0,
        'available' => $o['available'] ?? true,
        'method' => (string)$o['method'],
    ];
}

/* ------------------------------------------------------------------ TCMB kuru */

/** today.xml -> kur dizisi (USD ve EUR ForexSelling). Hata kodu $why'da. */
function vgm_parse_tcmb(string $xml, string &$why): ?array
{
    $why = '';
    if (preg_match('/<Tarih_Date\b[^>]*\bTarih\s*=\s*"([0-9]{2})\.([0-9]{2})\.([0-9]{4})"/', $xml, $d) !== 1) {
        $why = 'rate_date_missing';
        return null;
    }
    if (!checkdate((int)$d[2], (int)$d[1], (int)$d[3])) {
        $why = 'rate_date_invalid';
        return null;
    }
    $date = $d[3] . '-' . $d[2] . '-' . $d[1];
    $ts = strtotime($date . 'T12:00:00+03:00');
    if ($ts === false || $ts > time() + 2 * 86400) {
        $why = 'rate_date_invalid';
        return null;
    }
    $get = function (string $code) use ($xml): ?float {
        if (preg_match('~<Currency\b[^>]*\b(?:Kod|CurrencyCode)\s*=\s*"' . $code . '"[^>]*>(.*?)</Currency>~s', $xml, $m) !== 1
            || preg_match('~<ForexSelling>\s*([0-9.,]+)\s*</ForexSelling>~', $m[1], $v) !== 1) {
            return null;
        }
        $rate = vgm_parse_number($v[1], true);
        $unit = preg_match('~<Unit>\s*([0-9]+)\s*</Unit>~', $m[1], $u) === 1 ? max(1, (int)$u[1]) : 1;
        return $rate === null ? null : $rate / $unit;
    };
    $usd = $get('USD');
    $eur = $get('EUR');
    if ($usd === null || $usd < 1 || $usd > 1000) {
        $why = 'rate_usd_invalid';
        return null;
    }
    if ($eur !== null && ($eur < 1 || $eur > 1000)) {
        $eur = null;
    }
    if ($eur !== null && ($eur / $usd < 0.5 || $eur / $usd > 2.0)) {
        $why = 'rate_inconsistent';
        return null;
    }
    return ['version' => 1, 'usdTry' => round($usd, 4), 'eurTry' => $eur === null ? null : round($eur, 4), 'date' => $date,
        'fetchedAt' => time(), 'source' => 'TCMB today.xml ForexSelling'];
}

/**
 * TCMB gunluk kurlar (today.xml). Basarisizlikta null ve $why. $timeout (sn): varsayilan 30 (TCMB'nin TLS el
 * sikismasi bazen 10 sn'yi bulur); canli kontrol butce kalanini verir.
 */
function vgm_fetch_rates(string &$why, ?int $timeout = null): ?array
{
    $status = 0;
    $previous = vgm_fetch_limit();
    vgm_fetch_limit($timeout ?? VGM_RATE_FETCH_TIMEOUT, VGM_RATE_FETCH_TIMEOUT);
    try {
        $xml = vgm_fetch(VGM_TCMB_URL, ['tcmb.gov.tr'], $why, $status);
    } finally {
        vgm_fetch_limit($previous, VGM_RATE_FETCH_TIMEOUT);
    }
    if ($xml === '') {
        if ($why === '') {
            $why = 'empty_response';
        }
        return null;
    }
    return vgm_parse_tcmb($xml, $why);
}

/* ------------------------------------------------------------------ fiyat yenileme (cron ve canli) */

/** Kaynaklari oncelik sirasiyla dondurur; anahtar kaynagin kaynaklar.json'daki sirasidir. */
function vgm_sources_ordered(array $sources): array
{
    $keys = array_keys($sources);
    usort($keys, function ($a, $b) use ($sources): int {
        $pa = is_int($sources[$a]['priority'] ?? null) ? $sources[$a]['priority'] : 100;
        $pb = is_int($sources[$b]['priority'] ?? null) ? $sources[$b]['priority'] : 100;
        return $pa <=> $pb ?: $a <=> $b;
    });
    $out = [];
    foreach ($keys as $k) {
        $out[$k] = $sources[$k];
    }
    return $out;
}

/** Ayni sunucuya istekler arasi bekleme; butce yetmezse false. */
function vgm_wait_host(array $lastHit, string $host, float $spacing, float $deadline): bool
{
    if ($spacing <= 0 || !isset($lastHit[$host])) {
        return true;
    }
    $wait = $lastHit[$host] + $spacing - microtime(true);
    if ($wait <= 0) {
        return true;
    }
    if (microtime(true) + $wait >= $deadline) {
        return false;
    }
    usleep((int)ceil($wait * 1000000));
    return true;
}

/**
 * Fiyat/kur yenileme. opts: ids (dizi|null = kaynagi olan tum urunler), live (bool), budget (sn), max (getirme sayisi),
 * spacing (ayni sunucuya istekler arasi sn; cron 2, canli 0), rates (false: kur hic getirilmez), forceRates (kur yasina
 * bakmadan yenile), heartbeat (lastRunAt/lastRunSummary yaz; varsayilan: canli degil ve ids null).
 * Canli: yalniz checkedAt'i VGM_LIVE_RECHECK_AFTER'dan eski ve lastAttemptAt'i VGM_LIVE_MIN_INTERVAL'dan eski urunler,
 * kur yalniz yoksa; ayrica vg_rl_hit('vgm_live', 'all', 30, 60). Ag islemi kilit DISINDA; her sonuc kisa yazma kilidiyle.
 * Dondurur: {checked, ok, held, error, unavailable, skipped, rateUpdated, seconds} (+ rateError).
 */
function vgm_refresh(array $opts): array
{
    $start = microtime(true);
    $live = ($opts['live'] ?? false) === true;
    $budget = isset($opts['budget']) && is_numeric($opts['budget']) ? max(1.0, (float)$opts['budget']) : ($live ? 8.0 : 900.0);
    $maxFetch = isset($opts['max']) && is_numeric($opts['max']) ? max(0, (int)$opts['max']) : ($live ? 6 : PHP_INT_MAX);
    $spacing = isset($opts['spacing']) && is_numeric($opts['spacing']) ? max(0.0, (float)$opts['spacing']) : ($live ? 0.0 : 2.0);
    $ids = isset($opts['ids']) && is_array($opts['ids']) ? array_values(array_filter($opts['ids'], 'is_string')) : null;
    $deadline = $start + $budget;
    if ($live) {
        vgm_fetch_deadline($deadline);
    }
    $summary = ['checked' => 0, 'ok' => 0, 'held' => 0, 'error' => 0, 'unavailable' => 0, 'skipped' => 0,
        'rateUpdated' => false, 'seconds' => 0.0];
    try {
        list($config, $state, $rate) = vgm_locked(false, function (string $dir): array {
            return [vgm_config($dir), vgm_prices_state($dir), vgm_rate_state($dir)];
        });
        // urunler
        $catalog = vgm_catalog()['products'];
        $candidates = [];
        foreach ($ids ?? array_keys($catalog) as $id) {
            if (isset($catalog[$id]) && !isset($candidates[$id]) && ($sources = vgm_sources($config, $id)) !== []) {
                $candidates[$id] = vgm_sources_ordered($sources);
            }
        }
        // kur (ag islemi kilit disinda)
        $needRate = $rate === null || ($opts['forceRates'] ?? false) === true
            || (!$live && time() - (int)($rate['fetchedAt'] ?? 0) > VGM_RATE_REFRESH_AFTER);
        // canli kontrolde kaynakli urun yoksa ya da kur getirmesi sik tekrarlaniyorsa herkese acik istek TCMB'ye cikmaz
        if ($live && $needRate && ($opts['forceRates'] ?? false) !== true
            && ($candidates === [] || vg_rl_hit('vgm_live_rate', 'all', 2, 300) > 0)) {
            $needRate = false;
        }
        if (($opts['rates'] ?? true) !== false && $needRate) {
            $why = '';
            // canli kontrolde musteri bekler: kur getirmesi de toplam butceyi asmaz
            $fresh = vgm_fetch_rates($why, $live ? max(2, (int)ceil($deadline - microtime(true))) : null);
            if ($fresh !== null) {
                vgm_locked(true, function (string $dir) use ($fresh): void {
                    vgm_write($dir, 'kur.json', $fresh);
                });
                $rate = $fresh;
                $summary['rateUpdated'] = true;
            } else {
                $summary['rateError'] = $why;
            }
        }
        if (!vgm_rate_ok($rate, time())) {
            // guvenilir kur yokken maliyet USD'ye cevrilemez; bos yere getirme yapilmaz
            if ($candidates) {
                $summary['rateError'] = $summary['rateError'] ?? 'no_rate';
            }
            $summary['skipped'] = count($candidates);
            $candidates = [];
        }
        uksort($candidates, function ($a, $b) use ($state): int {
            $x = (int)($state['items'][$a]['lastAttemptAt'] ?? 0);
            $y = (int)($state['items'][$b]['lastAttemptAt'] ?? 0);
            return $x <=> $y ?: strcmp((string)$a, (string)$b);
        });
        $rates = ['USD' => (float)($rate['usdTry'] ?? 0), 'EUR' => is_numeric($rate['eurTry'] ?? null) ? (float)$rate['eurTry'] : null];
        $queue = array_keys($candidates);
        $lastHit = [];
        $fetches = 0;
        while ($queue) {
            if (microtime(true) >= $deadline || $fetches >= $maxFetch) {
                break;
            }
            $pick = 0;
            if ($spacing > 0) {
                foreach ($queue as $qi => $qid) {
                    $first = reset($candidates[$qid]);
                    $h = vgm_host((string)($first['url'] ?? ''));
                    if (!isset($lastHit[$h]) || microtime(true) - $lastHit[$h] >= $spacing) {
                        $pick = $qi;
                        break;
                    }
                }
            }
            $id = $queue[$pick];
            array_splice($queue, $pick, 1);
            if ($live) {
                $item = $state['items'][$id] ?? null;
                $checkedAt = is_array($item) && is_int($item['checkedAt'] ?? null) ? $item['checkedAt'] : 0;
                $attemptAt = is_array($item) && is_int($item['lastAttemptAt'] ?? null) ? $item['lastAttemptAt'] : 0;
                $now = time();
                if ($now - $checkedAt <= VGM_LIVE_RECHECK_AFTER || $now - $attemptAt <= VGM_LIVE_MIN_INTERVAL) {
                    $summary['skipped']++;
                    continue;
                }
                if (vg_rl_hit('vgm_live', 'all', 30, 60) > 0) {
                    $summary['skipped'] += 1 + count($queue);
                    $queue = [];
                    break;
                }
            }
            $p = $catalog[$id];
            $errors = [];
            $result = null;
            $gone = null;
            $used = null;
            foreach ($candidates[$id] as $idx => $src) {
                $host = vgm_host((string)($src['url'] ?? ''));
                if ($fetches >= $maxFetch || microtime(true) >= $deadline || !vgm_wait_host($lastHit, $host, $spacing, $deadline)) {
                    break;
                }
                $fetches++;
                vgm_fetch_limit((int)ceil($deadline - microtime(true)));
                $offer = vgm_fetch_offer($src, $p);
                $lastHit[$host] = microtime(true);
                if (isset($offer['error'])) {
                    /* Kaldirilmis (404/410) kaynak sonraki kaynagi gizlemez; tum kaynaklar kaldirilmissa urun stokta yok. */
                    if (!empty($offer['gone'])) {
                        $gone = $gone ?? $offer;
                    } else {
                        $errors[] = (string)$offer['error'];
                    }
                    $used = $used ?? $idx;
                    continue;
                }
                $result = $offer;
                $used = $idx;
                break;
            }
            if ($result === null && $errors === [] && $gone !== null) {
                $result = $gone;
            }
            if ($result === null && $errors === []) {
                $summary['skipped']++;
                continue;
            }
            if ($result === null) {
                $result = ['error' => implode(', ', array_values(array_unique($errors)))];
            }
            $applied = vgm_locked(true, function (string $dir) use ($id, $p, $used, $result, $rates): array {
                $st = vgm_prices_state($dir);
                $new = vgm_apply_check($st['items'][$id] ?? null, $p, (int)$used, $result, $rates, time());
                $st['items'][$id] = $new;
                vgm_write($dir, 'fiyatlar.json', $st);
                return $new;
            });
            $summary['checked']++;
            $status = (string)($applied['status'] ?? 'error');
            $summary[in_array($status, ['ok', 'held', 'unavailable'], true) ? $status : 'error']++;
        }
        $summary['skipped'] += count($queue);
        $summary['seconds'] = round(microtime(true) - $start, 1);
        $heartbeat = array_key_exists('heartbeat', $opts) ? $opts['heartbeat'] === true : (!$live && $ids === null);
        if ($heartbeat) {
            vgm_locked(true, function (string $dir) use ($summary): void {
                $st = vgm_prices_state($dir);
                $st['lastRunAt'] = time();
                $st['lastRunSummary'] = $summary;
                vgm_write($dir, 'fiyatlar.json', $st);
            });
        }
        return $summary;
    } finally {
        vgm_fetch_limit(VGM_FETCH_TIMEOUT);
        vgm_fetch_deadline(null, true);
    }
}

/** Zamanlanmis calisma ozeti (cron --status ve panel): son calisma, sayimlar, bayat urun sayisi, kur. */
function vgm_refresh_status(int $now): array
{
    list($config, $state, $rate) = vgm_locked(false, function (string $dir): array {
        return [vgm_config($dir), vgm_prices_state($dir), vgm_rate_state($dir)];
    });
    $counts = ['ok' => 0, 'held' => 0, 'error' => 0, 'unavailable' => 0, 'unchecked' => 0];
    $stale = 0;
    $products = 0;
    foreach (vgm_catalog()['products'] as $id => $p) {
        if (vgm_sources($config, $id) === []) {
            continue;
        }
        $products++;
        $item = $state['items'][$id] ?? null;
        $st = is_array($item) ? (string)($item['status'] ?? 'error') : 'unchecked';
        $counts[isset($counts[$st]) ? $st : 'error']++;
        $at = is_array($item) && is_int($item['checkedAt'] ?? null) ? $item['checkedAt'] : 0;
        if ($at === 0 || $now - $at > VGM_PRICE_MAX_AGE) {
            $stale++;
        }
    }
    $last = is_int($state['lastRunAt'] ?? null) ? $state['lastRunAt'] : null;
    return [
        'lastRunAt' => $last,
        'lastRunAtIso' => $last !== null ? vg_iso($last) : null,
        'summary' => $state['lastRunSummary'] ?? null,
        'healthy' => $last !== null && $now - $last <= VGM_HEALTHY_AFTER,
        'products' => $products,
        'counts' => $counts,
        'stale' => $stale,
        'rate' => $rate === null ? null : [
            'usdTry' => (float)$rate['usdTry'],
            'eurTry' => is_numeric($rate['eurTry'] ?? null) ? (float)$rate['eurTry'] : null,
            'date' => $rate['date'] ?? null,
            'fetchedAt' => $rate['fetchedAt'] ?? null,
            'ok' => vgm_rate_ok($rate, $now),
        ],
    ];
}

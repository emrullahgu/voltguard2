<?php
/*
 * VoltGuard Magaza tedarikci fiyat okuma (tasarim: api/MAGAZA.md).
 *  - SSRF korumali, IP'ye sabitlenmis HTTPS getirme (yalnizca kaynak kaydindaki alan adi, en fazla 3 yonlendirme);
 *    zamanlayicida farkli sunuculara curl_multi ile es zamanli (vgm_fetch_start / vgm_fetch_drive)
 *  - teklif ayristirma: JSON-LD > microdata > OG meta > dar platform yedekleri; celisen fiyatta "ambiguous_price"
 *  - TCMB doviz satis kuru (today.xml)
 *  - zamanlanmis (cron) ve canli (sepet adimi) fiyat yenileme: ag islemi kilit DISINDA, her urunun sonucu kisa
 *    yazma kilidiyle islenir
 * Tedarikci adresleri yalnizca ozel veri klasorundeki kaynak/<parca>.json dosyalarindan gelir. Bu dosya hicbir tedarikci adi
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
const VGM_FETCH_MAX_BYTES = 8388608;     // 8 MiB (acilmis govde; mega menulu sayfalar 2-3 MiB olabilir)
const VGM_FETCH_PARALLEL = 6;            // zamanlayicida ayni anda en cok bu kadar (farkli sunucu) istek; bellek sinirina gore azalir
const VGM_FETCH_TIMEOUT = 12;
const VGM_FETCH_CONNECT_TIMEOUT = 6;
const VGM_RATE_FETCH_TIMEOUT = 30;       // TCMB kuru: tek kaynak, yavas TLS el sikismasina tolerans
const VGM_FETCH_MAX_REDIRECTS = 3;
const VGM_TCMB_URL = 'https://www.tcmb.gov.tr/kurlar/today.xml';
const VGM_RATE_REFRESH_AFTER = 21600;    // cron kuru 6 saatten eskiyse yeniler
const VGM_VALUE_MAX = 1000000000;
const VGM_HEALTHY_AFTER = 1800;          // son zamanlanmis calisma en fazla 30 dakika once (cron her 10 dakikada)
const VGM_CRON_BUDGET = 540;             // zamanlanmis calisma suresi (sn; magaza-cron.php --sure); cron */10, cron.lock ust uste binmeyi onler
const VGM_RECHECK_AGE = 72000;           // basarili kontrolden 20 saat sonra yeniden kontrol (48 saat penceresinin icinde)
const VGM_RETRY_AFTER = 7200;            // ilk basarisiz denemeden 2 saat sonra yeniden dene; her ardisik hatada iki katina (en cok $age)
const VGM_CRON_WINDOW = 6000;            // bir calismada kuyruga alinan en cok urun (tum sunucular)
const VGM_HOST_SLACK = 20;               // sunucu basina kuyruk: ceil(butce / aralik) + bu kadar
const VGM_DNS_TTL = 300;                 // ayni calismada cozulmus adres bu kadar sn yeniden kullanilir

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
    /* Ayni sunucuya ard arda istekler (zamanlayici) her seferinde A + AAAA sorgusu yapmaz: basarili cozum VGM_DNS_TTL sn
       saklanir. Engelli adres ya da cozum hatasi saklanmaz. */
    static $cache = [];
    $why = '';
    $hit = $cache[$host] ?? null;
    if (is_array($hit) && microtime(true) - $hit[1] < VGM_DNS_TTL) {
        return $hit[0];
    }
    $ip = vgm_resolve_public_once($host, $why);
    if ($ip !== '') {
        if (count($cache) >= 256) {
            array_shift($cache);
        }
        $cache[$host] = [$ip, microtime(true)];
    }
    return $ip;
}

function vgm_resolve_public_once(string $host, string &$why): string
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

/** Test modu: <dizin>/gecikme (sn, en cok 5) her istegi o kadar surdurur; es zamanli istekler birlikte beklenir. */
function vgm_fixture_delay(string $dir): float
{
    return is_file($dir . '/gecikme') ? max(0.0, min(5.0, (float)trim((string)file_get_contents($dir . '/gecikme')))) : 0.0;
}

/** Test modu tek istek: <sha1(url)>.html / .<durum> / .redirect; TCMB icin tcmb-today.xml. Beklemez (vgm_fetch_drive bekler). */
function vgm_fixture_once(string $dir, string $url, string &$why): array
{
    $isRate = $url === VGM_TCMB_URL;
    if (!$isRate && is_file($dir . '/getirme.log')) {
        /* Yalniz testler: her istek "baslangic-zamani alan-adi" satiri olarak eklenir (sunucu araligi, serpistirme, es
           zamanlilik ve son tarih testleri). */
        @file_put_contents($dir . '/getirme.log', sprintf("%.4f %s\n", microtime(true), (string)parse_url($url, PHP_URL_HOST)), FILE_APPEND);
    }
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

/** curl tutamaci anahtari (PHP 8: nesne, PHP 7: kaynak). */
function vgm_curl_key($ch): int
{
    return is_object($ch) ? spl_object_id($ch) : (int)$ch;
}

/**
 * Sunucu basina yeniden kullanilan curl tutamaclari (ayni calismada keep-alive: her istekte yeni TLS el sikismasi yok).
 * 'take': havuzdan alir (yoksa yeni acar; alinan tutamac havuzda kalmaz, ayni sunucuya ikinci es zamanli istek yeni
 * tutamac alir). 'give': geri koyar ($ok degilse kapatir; havuz 16'yi asarsa en eskisi kapatilir). Secenekler her
 * istekte curl_reset ile sifirlanir (acik baglanti korunur).
 */
function vgm_curl_pool(string $op, string $host, string $ip, $ch = null, bool $ok = true)
{
    static $pool = [];
    $key = $host . '|' . $ip;
    if ($op === 'take') {
        if (isset($pool[$key])) {
            $ch = $pool[$key];
            unset($pool[$key]);
            curl_reset($ch);
            return $ch;
        }
        return curl_init();
    }
    if ($ch === null) {
        return null;
    }
    if (!$ok || isset($pool[$key])) {
        curl_close($ch);
        return null;
    }
    if (count($pool) >= 16) {
        $oldKey = array_key_first($pool);
        curl_close($pool[$oldKey]);
        unset($pool[$oldKey]);
    }
    $pool[$key] = $ch;
    return null;
}

/** Tek curl_multi tutamaci (butun es zamanli istekler). */
function vgm_multi()
{
    static $mh = null;
    if ($mh === null) {
        $mh = curl_multi_init();
    }
    return $mh;
}

/** Ucusta olan istekler (curl tutamaci anahtari => istek): tamamlanma bildirimi hangi surus cagrisinda gelirse gelsin islenir. */
function &vgm_req_registry(): array
{
    static $reg = [];
    return $reg;
}

/** Istegin etkin zaman asimi (ms): vgm_fetch_limit, canli son tarih (vgm_fetch_deadline) ile kisalir. */
function vgm_req_timeout_ms(): int
{
    $timeoutMs = vgm_fetch_limit() * 1000;
    $deadline = vgm_fetch_deadline();
    if ($deadline !== null) {
        $timeoutMs = max(300, min($timeoutMs, (int)floor(($deadline - microtime(true)) * 1000)));
    }
    return $timeoutMs;
}

/** Tek GET isteginin curl secenekleri: cozulmus IP'ye sabitlenmis, yalniz https, govde siniri VGM_FETCH_MAX_BYTES. */
function vgm_curl_options(stdClass $r): array
{
    $timeoutMs = vgm_req_timeout_ms();
    $pin = strpos($r->ip, ':') !== false ? '[' . $r->ip . ']' : $r->ip;
    $options = [
        CURLOPT_URL => 'https://' . $r->host . $r->path,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_TIMEOUT_MS => $timeoutMs,
        CURLOPT_CONNECTTIMEOUT_MS => $timeoutMs > VGM_FETCH_TIMEOUT * 1000 ? intdiv($timeoutMs, 2) : min(VGM_FETCH_CONNECT_TIMEOUT * 1000, $timeoutMs),
        CURLOPT_USERAGENT => VGM_FETCH_UA,
        CURLOPT_RESOLVE => [$r->host . ':443:' . $pin],
        CURLOPT_HTTPHEADER => ['Accept: text/html,application/xhtml+xml;q=0.9,application/xml;q=0.8', 'Accept-Language: tr-TR,tr;q=0.9,en;q=0.5'],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_ENCODING => '',
        CURLOPT_NOSIGNAL => true,
        CURLOPT_HEADERFUNCTION => function ($c, $line) use ($r) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m) === 1) {
                $r->status = (int)$m[1];
                $r->location = '';
            } elseif (stripos($line, 'location:') === 0) {
                $r->location = trim(substr($line, 9));
            }
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION => function ($c, $chunk) use ($r) {
            if (strlen($r->buf) + strlen($chunk) > VGM_FETCH_MAX_BYTES) {
                $r->big = true;
                return -1;
            }
            $r->buf .= $chunk;
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
    return $options;
}

/** curl yoksa: PHP akis sarmalayicisi (es zamansiz); IP'ye baglanip SNI/sertifika adi olarak gercek ad kullanilir. */
function vgm_http_stream(string $host, string $ip, string $path, string &$why): array
{
    $timeoutMs = vgm_req_timeout_ms();
    $ctx = stream_context_create([
        'http' => ['method' => 'GET', 'timeout' => $timeoutMs / 1000, 'follow_location' => 0, 'max_redirects' => 0,
            'ignore_errors' => true, 'protocol_version' => 1.0,
            'header' => "Host: " . $host . "\r\nUser-Agent: " . VGM_FETCH_UA . "\r\nAccept: text/html,application/xhtml+xml;q=0.9,application/xml;q=0.8"
                . "\r\nAccept-Language: tr-TR,tr;q=0.9,en;q=0.5\r\nConnection: close\r\n"],
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
 * Es zamanli getirme istegi baslatir (nesne: url, allow, hop, done, why, status, body ...). Her adimda (ilk istek ve her
 * yonlendirme) adres yeniden denetlenir (https, izinli alan adi, herkese acik IP) ve istek o IP'ye sabitlenir. Sonuc
 * vgm_fetch_drive ile beklenir: done=true olunca why ('' basarili) / status / body okunur. Yalniz izinli alan adlari.
 */
function vgm_fetch_start(string $url, array $allowHosts): stdClass
{
    $r = new stdClass();
    $r->url = $url;
    $r->allow = $allowHosts;
    $r->hop = 0;
    $r->done = false;
    $r->why = '';
    $r->status = 0;
    $r->location = '';
    $r->body = '';
    $r->buf = '';
    $r->big = false;
    $r->host = '';
    $r->ip = '';
    $r->path = '/';
    $r->ch = null;
    $r->pending = null;   // test modu: hazir yanit
    $r->readyAt = null;   // test modu: yanitin hazir olacagi an
    vgm_req_begin($r);
    return $r;
}

/** Istegi (ya da yonlendirme adimini) baslatir. */
function vgm_req_begin(stdClass $r): void
{
    $deadline = vgm_fetch_deadline();
    if ($deadline !== null && $deadline - microtime(true) < 1.0) {
        vgm_req_finish($r, 'budget');
        return;
    }
    if ($r->hop > VGM_FETCH_MAX_REDIRECTS) {
        vgm_req_finish($r, 'too_many_redirects');
        return;
    }
    $fixture = vgm_fixture_dir();
    $why = '';
    $target = vgm_check_fetch_url($r->url, $why, $r->allow, $fixture !== '');
    if (!$target) {
        vgm_req_finish($r, $why);
        return;
    }
    list($r->host, $r->ip, $r->path) = $target;
    if ($fixture !== '') {
        $res = vgm_fixture_once($fixture, $r->url, $why);
        if (!$res) {
            vgm_req_finish($r, $why);
            return;
        }
        $r->pending = $res;
        $r->readyAt = microtime(true) + vgm_fixture_delay($fixture);
        return;
    }
    if (!function_exists('curl_multi_init')) {
        $res = vgm_http_stream($r->host, $r->ip, $r->path, $why);
        if (!$res) {
            vgm_req_finish($r, $why);
            return;
        }
        vgm_req_response($r, $res);
        return;
    }
    $r->buf = '';
    $r->big = false;
    $r->status = 0;
    $r->location = '';
    $r->ch = vgm_curl_pool('take', $r->host, $r->ip);
    curl_setopt_array($r->ch, vgm_curl_options($r));
    $reg = &vgm_req_registry();
    $reg[vgm_curl_key($r->ch)] = $r;
    curl_multi_add_handle(vgm_multi(), $r->ch);
}

/** Istek hata ile biter (govde yok). */
function vgm_req_finish(stdClass $r, string $why): void
{
    $r->why = $why;
    $r->body = '';
    $r->buf = '';
    $r->pending = null;
    $r->readyAt = null;
    $r->done = true;
}

/** Bir adimin yaniti: yonlendirme ise sonraki adim (yeniden denetim), 200 ise govde, degilse http_<durum>. */
function vgm_req_response(stdClass $r, array $res): void
{
    $r->status = (int)$res['status'];
    $r->pending = null;
    $r->readyAt = null;
    if ($r->status >= 300 && $r->status < 400 && (string)$res['location'] !== '') {
        $r->url = vgm_resolve_location($r->url, (string)$res['location']);
        $r->hop++;
        vgm_req_begin($r);
        return;
    }
    if ($r->status !== 200) {
        vgm_req_finish($r, 'http_' . $r->status);
        return;
    }
    $r->body = (string)$res['body'];
    $r->buf = '';
    $r->done = true;
}

/** curl adimi tamamlandi: tutamac cokludan alinir, havuza doner; hata / cok buyuk / yanit islenir. */
function vgm_curl_finish(stdClass $r, int $errno): void
{
    $ch = $r->ch;
    $r->ch = null;
    $reg = &vgm_req_registry();
    unset($reg[vgm_curl_key($ch)]);
    curl_multi_remove_handle(vgm_multi(), $ch);
    vgm_curl_pool('give', $r->host, $r->ip, $ch, $errno === 0 && !$r->big);
    if ($r->big) {
        vgm_req_finish($r, 'too_large');
        return;
    }
    if ($errno !== 0) {
        vgm_req_finish($r, 'network_error_' . $errno);
        return;
    }
    $body = $r->buf;
    $r->buf = '';
    vgm_req_response($r, ['status' => $r->status, 'location' => $r->location, 'body' => $body]);
}

/** Ucustaki istegi birakir (son tarih): tutamac kapatilir, istek 'abandoned' ile biter. */
function vgm_fetch_abort(stdClass $r): void
{
    if ($r->ch !== null) {
        $ch = $r->ch;
        $r->ch = null;
        $reg = &vgm_req_registry();
        unset($reg[vgm_curl_key($ch)]);
        curl_multi_remove_handle(vgm_multi(), $ch);
        vgm_curl_pool('give', $r->host, $r->ip, $ch, false);
    }
    if (!$r->done) {
        vgm_req_finish($r, 'abandoned');
    }
}

/**
 * Istekleri surer: curl_multi ile tum ucustaki istekler ilerletilir (bu listede olmayanlar da), yonlendirmeler yeniden
 * baslatilir; test modunda hazir yanitlar readyAt gelince islenir (es zamanli isteklerin gecikmeleri birlikte beklenir).
 * $until (microtime) verilirse o ana kadar; verilmezse $reqs'in hepsi bitene kadar doner.
 */
function vgm_fetch_drive(array $reqs, ?float $until = null): void
{
    while (true) {
        $now = microtime(true);
        $wake = INF;
        $active = 0;
        foreach ($reqs as $r) {
            if ($r->done) {
                continue;
            }
            if ($r->pending !== null && $now >= $r->readyAt) {
                vgm_req_response($r, $r->pending);
            }
            if ($r->done) {
                continue;
            }
            if ($r->pending !== null) {
                $wake = min($wake, (float)$r->readyAt);
            } elseif ($r->ch !== null) {
                $active++;
            }
        }
        $running = 0;
        if ($active > 0) {
            $mh = vgm_multi();
            do {
                $mrc = curl_multi_exec($mh, $running);
            } while ($mrc === CURLM_CALL_MULTI_PERFORM);
            $finished = 0;
            while (($info = curl_multi_info_read($mh)) !== false) {
                $reg = &vgm_req_registry();
                $hit = $reg[vgm_curl_key($info['handle'])] ?? null;
                if ($hit instanceof stdClass) {
                    vgm_curl_finish($hit, (int)$info['result']);
                } else {
                    curl_multi_remove_handle($mh, $info['handle']);
                }
                $finished++;
            }
            if ($finished > 0) {
                continue;   // yanitlar yonlendirme baslatmis ya da istekleri bitirmis olabilir: tur basa doner
            }
        }
        $allDone = true;
        foreach ($reqs as $r) {
            if (!$r->done) {
                $allDone = false;
                break;
            }
        }
        if ($allDone) {
            return;
        }
        $now = microtime(true);
        if ($until !== null && $now >= $until) {
            return;
        }
        $sleepUntil = $until === null ? $wake : min($wake, $until);
        if ($active > 0) {
            $t = $sleepUntil === INF ? 1.0 : max(0.0, min(1.0, $sleepUntil - $now));
            if ($running > 0) {
                if (curl_multi_select(vgm_multi(), $t) === -1) {
                    usleep(10000);
                }
            }
        } elseif ($sleepUntil === INF) {
            return;
        } else {
            usleep((int)ceil(max(0.0, $sleepUntil - $now) * 1000000));
        }
    }
}

/**
 * GET: yonlendirmeleri (en fazla 3) her adimda yeniden denetleyerek getirir. Basarisizlikta '' doner; neden $why'da
 * (kod, adres icermez), son HTTP durumu $status'ta. Yalnizca https ve $allowHosts icindeki alan adlari.
 */
function vgm_fetch(string $url, array $allowHosts, string &$why, int &$status): string
{
    $r = vgm_fetch_start($url, $allowHosts);
    vgm_fetch_drive([$r], null);
    $why = $r->why;
    $status = $r->status;
    return $r->why === '' ? $r->body : '';
}

/**
 * Zamanlayicida ayni anda kac (farkli sunucu) istek: VGM_FETCH_PARALLEL, bellek sinirina gore azalir. Her ucustaki istek
 * en cok VGM_FETCH_MAX_BYTES govde tutar; ayristirma (sirayla, tek sayfa) icin 8 x sinir pay birakilir. Sinirsiz
 * bellekte (memory_limit -1) tam sayi.
 */
function vgm_fetch_parallel(?string $memoryLimit = null): int
{
    $limit = trim((string)($memoryLimit ?? ini_get('memory_limit')));
    if ($limit === '' || $limit === '-1') {
        return VGM_FETCH_PARALLEL;
    }
    $unit = strtoupper(substr($limit, -1));
    $bytes = (float)$limit;
    if ($unit === 'K') {
        $bytes *= 1024;
    } elseif ($unit === 'M') {
        $bytes *= 1048576;
    } elseif ($unit === 'G') {
        $bytes *= 1073741824;
    }
    $free = $bytes - memory_get_usage() - 8 * VGM_FETCH_MAX_BYTES;
    return max(1, min(VGM_FETCH_PARALLEL, (int)floor($free / VGM_FETCH_MAX_BYTES)));
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

/**
 * Etiketleri atar (strip_tags yerine). PHP strip_tags bir oznitelik icindeki tek tirnaktan ("L'oreal") sonra eslesen
 * tirnaga kadar her seyi etiket sayar ve sayfanin kalanini yutar; o zaman KDV ve adet denetimleri metni goremez.
 */
function vgm_strip_tags(string $s): string
{
    $t = preg_replace('/<[^<>]*>/', ' ', $s);
    return is_string($t) ? $t : strip_tags($s);
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
 * text, etiketin icerigi (ayni etiketin ilk kapanisina kadar, en fazla 400 bayt) sade metin olarak; at: etiketin bayt konumu.
 */
function vgm_scan_tags(string $html, string $needleRegex, int $limit = 400): array
{
    $out = [];
    // sinirli tekrar: cok uzun oznitelikli (satir ici base64 gorsel) etiketlerde PCRE geri izleme siniri asilip tum tarama
    // bos donmesin
    $re = '/<([a-zA-Z][a-zA-Z0-9]*)\b([^<>]{0,4000}?' . $needleRegex . '[^<>]{0,4000})>/i';
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
        $out[] = ['tag' => $tag, 'attrs' => vgm_attrs($hit[2][0]), 'text' => vgm_plain(vgm_strip_tags($chunk)), 'at' => (int)$hit[0][1]];
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
function vgm_ld_offer_entries($offers, array &$entries, array $index, int $depth, $parentCurrency, ?bool $parentAvail, bool &$zero = false): void
{
    if ($depth > 4 || !is_array($offers)) {
        return;
    }
    if (vgm_is_list($offers)) {
        foreach (array_slice($offers, 0, 50) as $o) {
            vgm_ld_offer_entries($o, $entries, $index, $depth + 1, $parentCurrency, $parentAvail, $zero);
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
        vgm_ld_offer_entries($offers['offers'] ?? null, $entries, $index, $depth + 1, $currency, $avail, $zero);
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
    if (vgm_is_zero($offers['price'] ?? null)) {
        // acikca 0 fiyat ("fiyat sorunuz", fiyatsiz urun): sayfanin kendi fiyati yok; yedek seviyelere dusulmez
        $zero = true;
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
            if (vgm_is_zero($sp['price'] ?? null)) {
                $zero = true;
            }
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
    foreach (is_array($offer) ? (vgm_is_list($offer) ? array_slice($offer, 0, 10) : [$offer]) : [] as $o) {
        if (is_array($o)) {
            $urls[] = $o['url'] ?? null;
        }
    }
    foreach ($urls as $u) {
        if (is_string($u) && $u !== '' && $key !== '' && vgm_url_key($u, $page) === $key) {
            return true;
        }
    }
    return false;
}

/**
 * JSON-LD seviyesi: bulunan fiyat kayitlari + kimlik; hic fiyat yoksa null. Urunun teklifi acikca 0 ise (ve hicbir Product
 * pozitif fiyat vermiyorsa) 'zero' => true doner: ayristirici no_price der, microdata/platform yedeklerine DUSMEZ (yoksa
 * sayfadaki baska urun kartinin fiyati okunabilir).
 * Fiyatlari farkli birden cok Product varsa: (1) fiyati platformun kendi varyant verisindeki ($variantPrices,
 * vgm_variant_prices) fiyatlardan olan tek aday, (2) fiyati sayfanin JSON-LD disindaki verisinde (platform durumu, gizli
 * fiyat alani, gorunen metin; $evidence) da gecen tek aday, (3) adresi sayfanin kendisi olan tek aday secilir; hicbiri tek
 * aday vermezse tum fiyatlar birlesir (ambiguous_price). Aciklamaya elle yapistirilmis eski bir Product boylece platformun
 * kendi teklifini ezemez.
 */
function vgm_level_jsonld(string $html, string $url, string $evidence = '', ?array $variantPrices = null): ?array
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
    $zeroNode = null;
    foreach ($products as $node) {
        $entries = [];
        $zero = false;
        vgm_ld_offer_entries($node['offers'] ?? null, $entries, $index, 0, null, null, $zero);
        if ($entries) {
            $cands[] = ['node' => $node, 'entries' => $entries];
        } elseif ($zero && $zeroNode === null) {
            $zeroNode = $node;
        }
    }
    if (!$cands) {
        return $zeroNode === null ? null : ['method' => 'jsonld', 'entries' => [], 'ident' => vgm_ld_identity($zeroNode), 'zero' => true];
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
            $pick = [];
            if ($variantPrices) {
                $pick = array_values(array_filter($cands, function (array $c) use ($variantPrices): bool {
                    foreach ($c['entries'] as $e) {
                        $hit = false;
                        foreach ($variantPrices as $vp) {
                            $hit = $hit || abs($vp - $e['price']) < 0.005;
                        }
                        if (!$hit) {
                            return false;
                        }
                    }
                    return true;
                }));
                if (count(array_unique(array_map($sig, $pick))) > 1) {
                    $pick = [];
                }
            }
            if (!$pick && $evidence !== '') {
                $pick = array_values(array_filter($cands, function (array $c) use ($evidence): bool {
                    foreach ($c['entries'] as $e) {
                        if (!vgm_price_seen($evidence, (float)$e['price'])) {
                            return false;
                        }
                    }
                    return true;
                }));
                if (count(array_unique(array_map($sig, $pick))) > 1) {
                    $pick = [];
                }
            }
            if (!$pick) {
                $pick = array_values(array_filter($cands, function (array $c) use ($url): bool {
                    return vgm_ld_url_matches($c['node'], $url);
                }));
                if (count($pick) !== 1) {
                    $pick = [];
                }
            }
            if ($pick) {
                $chosen = $pick[0];
                $merged = $pick[0]['entries'];
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
    $zeros = [];
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
                    if ($v === null && $n === 'price' && vgm_is_zero($val)) {
                        $zeros[] = [$seg, 0.0];
                    }
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
        // urunun kendi fiyati acikca 0: no_price (OG/platform yedeklerine dusulmez)
        return $keep($zeros) ? ['method' => 'microdata', 'entries' => [], 'ident' => $ident, 'zero' => true] : null;
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
 * Dar platform yedekleri (WooCommerce, OpenCart, Ticimax, IdeaSoft, T-Soft). Her biri yalniz urunun ANA fiyat ogesinin
 * kendi ayirt edici sinif adini okur: urun kartlari / ilgili urunler (farkli sarmalayici siniflar) ve ustu cizili, liste,
 * "indirimsiz" fiyat siniflari hic okunmaz. Birden cok fiyat bulunursa ayristirici "ambiguous_price" der (tahmin yok).
 * Ana fiyat ogesi acikca 0 gosteriyorsa 'zero' => true (no_price; baska yedege gecilmez).
 */
function vgm_level_platform(string $html): ?array
{
    $cards = null;
    $inCard = function (int $at) use (&$cards, $html): bool {
        if ($cards === null) {
            $cards = vgm_card_ranges($html);
        }
        foreach ($cards as $r) {
            if ($at >= $r[0] && $at < $r[1]) {
                return true;
            }
        }
        return false;
    };
    $classText = function (array $classes) use ($html, $inCard): array {
        $texts = [];
        foreach ($classes as $cls) {
            foreach (vgm_scan_tags($html, preg_quote($cls, '/'), 200) as $el) {
                $tokens = preg_split('/\s+/', (string)($el['attrs']['class'] ?? '') . ' ' . (string)($el['attrs']['id'] ?? '')) ?: [];
                if (in_array($cls, $tokens, true) && $el['text'] !== '' && !vgm_reference_class($tokens) && !$inCard($el['at'])) {
                    $texts[] = $el['text'];
                }
            }
        }
        return $texts;
    };
    $finders = [
        'woocommerce' => function () use ($html, $inCard): array {
            $texts = [];
            if (stripos($html, 'woocommerce-Price-amount') === false
                || preg_match_all('~<p\b[^>]*\bclass\s*=\s*(["\'])([^"\']*)\1[^>]*>(.*?)</p>~is', $html, $m, PREG_SET_ORDER | PREG_OFFSET_CAPTURE) === false) {
                return $texts;
            }
            foreach ($m as $blk) {
                if (!in_array('price', preg_split('/\s+/', $blk[2][0]) ?: [], true) || $inCard((int)$blk[0][1])) {
                    continue;
                }
                $block = $blk[3][0];
                if (preg_match_all('~<ins\b[^>]*>(.*?)</ins>~is', $block, $ins) > 0) {
                    $block = implode(' ', $ins[1]);
                }
                $block = (string)preg_replace('~<del\b.*?</del>~is', ' ', $block);
                foreach (array_slice(explode('woocommerce-Price-amount', $block), 1) as $seg) {
                    $gt = strpos($seg, '>');
                    $texts[] = vgm_plain(vgm_strip_tags($gt === false ? $seg : substr($seg, $gt + 1)), 80);
                }
            }
            return $texts;
        },
        'opencart' => function () use ($classText, $html, $inCard): array {
            $texts = $classText(['price-new']);
            if (!$texts && preg_match_all('~<li>\s*<h2[^>]*>\s*([^<]{1,40}?)\s*</h2>\s*</li>~i', $html, $m, PREG_OFFSET_CAPTURE) > 0) {
                foreach ($m[1] as $hit) {
                    if ($inCard((int)$hit[1])) {
                        continue;
                    }
                    $t = vgm_plain($hit[0], 40);
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
            // yalniz ana fiyat ogesi; "product-price" sarmalayicisi kartlarda da kullanilir ve once ustu cizili fiyati icerir
            return $classText(['product-current-price', 'product-price-new']);
        },
        'tsoft' => function () use ($classText): array {
            return $classText(['currentPrice', 'product-detail-price']);
        },
    ];
    foreach ($finders as $name => $find) {
        $entries = [];
        $zero = false;
        foreach ($find() as $t) {
            $price = vgm_parse_number($t, false);
            if ($price !== null) {
                $cur = vgm_currency_in_text($t);
                $entries[] = vgm_entry($price, $cur, null, false);
            } elseif (vgm_is_zero($t)) {
                $zero = true;
            }
        }
        if ($entries) {
            return ['method' => 'platform:' . $name, 'entries' => $entries, 'ident' => []];
        }
        if ($zero) {
            return ['method' => 'platform:' . $name, 'entries' => [], 'ident' => [], 'zero' => true];
        }
    }
    return null;
}

/**
 * Urun karti / ilgili urunler / menu kapsayicilarinin bayt araliklari [[bas, son], ...]: sinifi ya da kimligi kart,
 * vitrin, kaydirici, "benzer/ilgili/onerilen urunler", mega menu, mini sepet olan ogeler ile header/nav/footer/aside.
 * Kapanis etiketleri yigitla izlenir; kapanmayan oge sayfa sonuna kadar sayilir (ihtiyatli: en kotu no_price). Platform
 * yedekleri bu araliklardaki fiyatlari okumaz; urunun kendi fiyati yokken baska urunun kart fiyati fiyat sanilmaz.
 */
function vgm_card_ranges(string $html): array
{
    $ranges = [];
    if (preg_match_all('~<(/?)(div|section|article|aside|nav|header|footer|ul|ol|li|form)\b([^<>]{0,4000}?)(/?)>~i', $html, $m, PREG_SET_ORDER | PREG_OFFSET_CAPTURE) === false) {
        return $ranges;
    }
    $cardRe = '/related|similar|recommend|benzer|ilgili|onerilen|\x{00F6}nerilen|cross-?sell|up-?sell|complementary|carousel|showcase|vitrin|mega-?menu|dropdown|owl-|swiper|slick|product-?(?:item|card|thumb|grid|layout|tile|box)\b|productitem|productcard|urun-?kart|mini-?cart|cart-?(?:dropdown|preview|summary)/iu';
    $stack = [];
    foreach ($m as $t) {
        $name = strtolower($t[2][0]);
        if ($t[1][0] === '/') {
            for ($k = count($stack) - 1; $k >= 0; $k--) {
                if ($stack[$k][0] === $name) {
                    if ($stack[$k][1]) {
                        $ranges[] = [$stack[$k][2], (int)$t[0][1]];
                    }
                    array_splice($stack, $k);
                    break;
                }
            }
            continue;
        }
        if ($t[4][0] === '/') {
            continue;
        }
        $card = in_array($name, ['nav', 'header', 'footer', 'aside'], true);
        if (!$card && preg_match('/\b(?:class|id)\s*=/i', $t[3][0]) === 1) {
            $a = vgm_attrs($t[3][0]);
            $card = preg_match($cardRe, (string)($a['class'] ?? '') . ' ' . (string)($a['id'] ?? '')) === 1;
        }
        $stack[] = [$name, $card, (int)$t[0][1]];
    }
    foreach ($stack as $open) {
        if ($open[1]) {
            $ranges[] = [$open[2], strlen($html)];
        }
    }
    return $ranges;
}

/** Sinif/kimlik belirtecleri ustu cizili, liste, eski ya da indirimsiz fiyati mi gosteriyor? */
function vgm_reference_class(array $tokens): bool
{
    foreach ($tokens as $t) {
        if ($t !== '' && preg_match('/old|eski|not-?discounted|indirimsiz|strike|line-?through|list-?price|piyasa|regular|was-?price|compare/i', $t) === 1) {
            return true;
        }
    }
    return false;
}

/* ------------------------------------------------------------------ sayfa baglami: sifir fiyat, KDV, adet, secenek */

/** Acikca sifir fiyat mi ("0", "0.00", "0,00 TL", 0)? Bos deger sifir sayilmaz. */
function vgm_is_zero($v): bool
{
    if (is_int($v) || is_float($v)) {
        return (float)$v === 0.0;
    }
    if (!is_string($v)) {
        return false;
    }
    $v = trim(str_replace("\xC2\xA0", ' ', $v));
    return $v !== '' && strlen($v) <= 40 && preg_match('/^[^0-9]{0,12}0+(?:[.,]0+)?[^0-9]{0,24}$/D', $v) === 1;
}

/** Satir ici base64 gorseller (data: URI) yer tutucuya indirgenir: bellek ve PCRE geri izleme siniri (buyuk sayfalar). */
function vgm_drop_data_uris(string $html): string
{
    if (stripos($html, 'data:') === false) {
        return $html;
    }
    $out = preg_replace('~data:[a-z0-9.+-]{1,40}/[a-z0-9.+-]{1,80}(?:;[a-z0-9=._-]{1,40}){0,4},[^"\'\s<>()]{256,}+~i', 'data:,', $html);
    return is_string($out) ? $out : $html;
}

/** Etiketleri atilmis, varliklari cozulmus, bosluklari sadelestirilmis sayfa metni (scriptsiz HTML'den). */
function vgm_page_text(string $plain): string
{
    $t = vgm_strip_tags($plain);
    $t = html_entity_decode($t, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $t = str_replace(["\xC2\xA0", "\xE2\x80\xAF", "\xE2\x80\x89"], ' ', $t);
    $t = preg_replace('/\s+/', ' ', $t);
    return is_string($t) ? $t : '';
}

/** Fiyatin sayfada yazilabilecegi bicimler (1.254,83, 1254,83, 1,254.83; makinede 1254.83; tam sayida 1254 ve 1.254). */
function vgm_price_forms(float $p, bool $machine): array
{
    $cents = (int)round($p * 100);
    $int = intdiv($cents, 100);
    $frac = sprintf('%02d', $cents % 100);
    $forms = [number_format($p, 2, ',', '.'), $int . ',' . $frac, number_format($p, 2, '.', ',')];
    if ($machine) {
        $forms[] = $int . '.' . $frac;
        if ($frac[1] === '0') {
            $forms[] = $int . '.' . $frac[0];
        }
    }
    if ($frac === '00') {
        $forms[] = (string)$int;
        $forms[] = number_format($p, 0, ',', '.');
    }
    return array_values(array_unique($forms));
}

/** Fiyat metinde (sayi siniriyla) geciyor mu? */
function vgm_price_seen(string $text, float $p): bool
{
    foreach (vgm_price_forms($p, true) as $f) {
        if (preg_match('/(?<![0-9.,])' . preg_quote($f, '/') . '(?![0-9]|[.,][0-9])/', $text) === 1) {
            return true;
        }
    }
    return false;
}

/**
 * Sayfanin gosterdigi KDV durumu, secilen fiyatin GORUNEN yazimina gore: hemen ardinda "+ KDV" / "KDV haric" / "KDV'siz"
 * ya da onunde "KDV haric:" etiketi varsa false (net fiyat); "KDV dahil" ise true; iz yoksa platform verisindeki acik
 * bayrak (kdvDahil / vatIncluded / valueAddedTaxIncluded; tum gecisler ayni olmali); o da yoksa null.
 * Ayni fiyatin herhangi bir yaziminda net isareti varsa sonuc false olur (ihtiyatli).
 */
function vgm_vat_flag(string $text, string $raw, float $price): ?bool
{
    $i = '(?:I|i|\xC4\xB0|\xC4\xB1)';
    // "KDV Haric: 1.242,00" bir sonraki degerin etiketidir, bu fiyatin eki degil (iki nokta ile ayrilir)
    $netAfter = '/^\s*(?:TL|TRY|\xE2\x82\xBA|USD|EUR|\$|\xE2\x82\xAC)?\s*(?:\+\s*KDV|\(?\s*KDV\s*HAR' . $i . '(?:\xC3\x87|\xC3\xA7|C)(?!\s*:)|KDV\'?\s*S' . $i . 'Z)/i';
    $grossAfter = '/^\s*(?:TL|TRY|\xE2\x82\xBA|USD|EUR|\$|\xE2\x82\xAC)?\s*\(?\s*KDV\s*DAH' . $i . 'L(?!\s*:)/i';
    $netBefore = '/KDV\s*HAR' . $i . '(?:\xC3\x87|\xC3\xA7|C)\s*(?:F' . $i . 'YAT' . $i . '?)?\s*:?\s*(?:TL|\xE2\x82\xBA)?\s*$/i';
    $grossBefore = '/KDV\s*DAH' . $i . 'L\s*(?:F' . $i . 'YAT' . $i . '?)?\s*:?\s*(?:TL|\xE2\x82\xBA)?\s*$/i';
    $net = false;
    $gross = false;
    foreach (vgm_price_forms($price, false) as $f) {
        if (preg_match_all('/(?<![0-9.,])' . preg_quote($f, '/') . '(?![0-9]|[.,][0-9])/', $text, $m, PREG_OFFSET_CAPTURE) < 1) {
            continue;
        }
        foreach (array_slice($m[0], 0, 50) as $hit) {
            $at = (int)$hit[1];
            $after = substr($text, $at + strlen($hit[0]), 40);
            $before = substr($text, max(0, $at - 40), min(40, $at));
            if (preg_match($netAfter, $after) === 1 || preg_match($netBefore, $before) === 1) {
                $net = true;
            } elseif (preg_match($grossAfter, $after) === 1 || preg_match($grossBefore, $before) === 1) {
                $gross = true;
            }
        }
    }
    if ($net) {
        return false;
    }
    if ($gross) {
        return true;
    }
    if ($raw !== '' && preg_match_all('/"(?:kdvDahil|kdv_dahil|vatIncluded|valueAddedTaxIncluded)"\s*:\s*(true|false)\b/i', $raw, $fm) > 0) {
        $flags = array_values(array_unique(array_map('strtolower', $fm[1])));
        if (count($flags) === 1) {
            return $flags[0] === 'true';
        }
    }
    return null;
}

/** Sayfanin kendi gizli fiyat alanlari (product-price, product-price-vat-include, ...) var, hepsi 0 ya da bos, en az biri 0 mi? */
function vgm_own_price_zero(string $plain): bool
{
    if (preg_match_all('/<input\b[^<>]{0,600}\b(?:id|name)\s*=\s*["\']?(?:product[-_]?price(?:[-_]vat[-_]include)?|productPrice|urun[-_]?fiyat)["\'\s\/>][^<>]{0,600}>/i', $plain, $m) < 1) {
        return false;
    }
    $zero = false;
    foreach (array_slice($m[0], 0, 10) as $tag) {
        $a = vgm_attrs(substr($tag, 6, -1));
        $v = trim((string)($a['value'] ?? ''));
        if (strtolower((string)($a['type'] ?? '')) !== 'hidden' || ($v !== '' && !vgm_is_zero($v))) {
            return false;
        }
        $zero = $zero || $v !== '';
    }
    return $zero;
}

/**
 * En az siparis / kat adedi (>1) ya da null. Kaynaklar: "N adet ve katlariyla", "en az N adet", "minimum siparis N" metni;
 * sayfadaki ILK adet girdisinin (urun kartlarindan once gelen ana form) min / step / value / data-minimum... oznitelikleri
 * ve hemen onundeki sarmalayicinin data-market-price / data-increment / data-minimum oznitelikleri.
 */
function vgm_min_qty(string $plain, string $text): ?int
{
    $best = 0;
    $take = function ($v) use (&$best): void {
        $v = trim(str_replace(',', '.', (string)$v));
        if (preg_match('/^[0-9]{1,6}(?:\.0+)?$/D', $v) === 1 && (int)$v > 1) {
            $best = max($best, (int)$v);
        }
    };
    $i = '(?:I|i|\xC4\xB0|\xC4\xB1)';
    if (preg_match('/([0-9]{1,6})\s*(?:adet|metre|mt|paket|koli|kutu|rulo)?\s*ve\s*katlar/i', $text, $m) === 1) {
        $take($m[1]);
    }
    if (preg_match('/en\s*az\s*([0-9]{1,6})\s*(?:adet|metre|mt|paket|koli|kutu|rulo)\b/i', $text, $m) === 1) {
        $take($m[1]);
    }
    if (preg_match('/minimum\s*(?:s' . $i . 'par' . $i . '\S*\s*)?(?:m' . $i . 'ktar\S*|adet\S*)\s*:?\s*([0-9]{1,6})\b/i', $text, $m) === 1) {
        $take($m[1]);
    }
    if (preg_match_all('/<input\b[^<>]{0,2000}>/i', $plain, $tags, PREG_OFFSET_CAPTURE) > 0) {
        foreach (array_slice($tags[0], 0, 400) as $tag) {
            $a = vgm_attrs(substr($tag[0], 6, -1));
            $type = strtolower((string)($a['type'] ?? 'text'));
            $key = (string)($a['name'] ?? '') . ' ' . (string)($a['id'] ?? '');
            if (in_array($type, ['hidden', 'checkbox', 'radio', 'submit', 'button', 'email', 'password', 'search', 'tel'], true)
                || preg_match('/quantity|qty|productcount|(?:^|[-_\[\s])(?:adet|miktar)(?:$|[-_\]\s])/i', $key) !== 1) {
                continue;
            }
            foreach (['min', 'step', 'value', 'data-min', 'data-minimum', 'data-min-qty', 'data-minqty', 'data-minimum-multiple', 'data-step'] as $k) {
                if (isset($a[$k])) {
                    $take($a[$k]);
                }
            }
            $lead = substr($plain, max(0, (int)$tag[1] - 600), min(600, (int)$tag[1]));
            if (preg_match_all('/\bdata-(?:market-price|increment|minimum|min|min-qty|step)\s*=\s*["\']?([0-9]+(?:[.,][0-9]+)?)/i', $lead, $w) > 0) {
                foreach ($w[1] as $v) {
                    $take($v);
                }
            }
            break;   // yalniz ilk (ana) adet girdisi
        }
    }
    return $best > 1 ? $best : null;
}

/** $s[$at] '{' ya da '[' iken dengeli JSON parcasini dondurur (dizeler dikkate alinir); bulunamazsa null. */
function vgm_json_slice(string $s, int $at, int $max = 2097152): ?string
{
    $depth = 0;
    $inStr = false;
    $n = min(strlen($s), $at + $max);
    for ($k = $at; $k < $n; $k++) {
        $c = $s[$k];
        if ($inStr) {
            if ($c === '\\') {
                $k++;
            } elseif ($c === '"') {
                $inStr = false;
            }
            continue;
        }
        if ($c === '"') {
            $inStr = true;
        } elseif ($c === '{' || $c === '[') {
            $depth++;
        } elseif ($c === '}' || $c === ']') {
            $depth--;
            if ($depth === 0) {
                return substr($s, $at, $k - $at + 1);
            }
        }
    }
    return null;
}

/** Fiyat anahtari mi (price, fiyat, sellPrice, discountPrice, finalPrice...; liste/piyasa/net/alis fiyatlari degil)? */
function vgm_variant_price_key(string $k): bool
{
    $k = strtolower(str_replace(['_', '-'], '', $k));
    return in_array($k, ['price', 'fiyat', 'sellprice', 'saleprice', 'salesprice', 'discountprice', 'discountedprice', 'finalprice',
        'indirimlifiyat', 'indirimlifiyati', 'satisfiyati', 'satisfiyat'], true);
}

/** Bir varyant kaydindaki odenecek fiyat: fiyat anahtarlarindaki pozitif degerlerin en kucugu (indirimli < satis). */
function vgm_variant_price($v, int $depth = 0): ?float
{
    if (!is_array($v) || $depth > 3) {
        return null;
    }
    $best = null;
    foreach (array_slice($v, 0, 60, true) as $k => $x) {
        $p = null;
        if (is_string($k) && vgm_variant_price_key($k) && !is_array($x)) {
            if (is_int($x) || is_float($x)) {
                $p = vgm_price_value($x);
            } elseif (is_string($x)) {
                $p = preg_match('/[\s,]|TL|\xE2\x82\xBA/', $x) === 1 ? vgm_parse_number($x, false) : vgm_parse_number($x, true);
            }
        } elseif (is_array($x)) {
            $p = vgm_variant_price($x, $depth + 1);
        }
        if ($p !== null && ($best === null || $p < $best)) {
            $best = $p;
        }
    }
    return $best;
}

/** Varyant kayitlari: liste ya da nesne; tek alt nesneli sarmalayicilar ({count, summary: {...}}) acilir. */
function vgm_variant_entries($v, int $depth = 0): array
{
    if (!is_array($v)) {
        return [];
    }
    $kids = array_values(array_filter(array_slice($v, 0, 200), 'is_array'));
    if (!vgm_is_list($v) && count($kids) === 1 && $depth < 2) {
        return vgm_variant_entries($kids[0], $depth + 1);
    }
    return $kids;
}

/**
 * Urunun kendi varyant verisindeki varyant fiyatlari (her varyant icin odenecek fiyat) ya da null (varyant verisi yok).
 * Kaynaklar: Next.js __NEXT_DATA__ props.pageProps.{product, pageSpecificData}.variants ve satir ici script'te
 * "variants: {...}" / "variants = [...]" JS nesnesi (ilk cozulebilen). Ilgili urunlerin verisi okunmaz.
 */
function vgm_variant_prices(string $raw): ?array
{
    $sets = [];
    if (preg_match('~<script\b[^>]*\bid\s*=\s*["\']__NEXT_DATA__["\'][^>]*>(.*?)</script~is', $raw, $nd) === 1) {
        $data = json_decode($nd[1], true, 128);
        $pp = is_array($data) ? ($data['props']['pageProps'] ?? null) : null;
        if (is_array($pp)) {
            foreach (['product', 'pageSpecificData'] as $k) {
                $node = $pp[$k] ?? null;
                if (is_array($node) && !isset($node['variants']) && is_array($node['product'] ?? null)) {
                    $node = $node['product'];
                }
                if (is_array($node) && is_array($node['variants'] ?? null)) {
                    $sets[] = $node['variants'];
                    break;
                }
            }
        }
    }
    if (!$sets) {
        $js = (string)preg_replace('~<script\b[^>]*(?:__NEXT_DATA__|application/ld\+json)[^>]*>.*?</script>~is', '', $raw);
        if (preg_match_all('/[{,;\s]["\']?variants["\']?\s*[:=]\s*(?=[\[{])/', $js, $m, PREG_OFFSET_CAPTURE) > 0) {
            foreach (array_slice($m[0], 0, 5) as $hit) {
                $slice = vgm_json_slice($js, (int)$hit[1] + strlen($hit[0]));
                $data = $slice === null ? null : json_decode($slice, true, 64);
                if (is_array($data)) {
                    $sets[] = $data;
                    break;
                }
            }
        }
    }
    if (!$sets) {
        return null;
    }
    $prices = [];
    foreach (vgm_variant_entries($sets[0]) as $entry) {
        $p = vgm_variant_price($entry);
        if ($p !== null) {
            $prices[] = $p;
        }
    }
    return $prices ?: null;
}

/**
 * Fiyati degistirebilen urun secenegi var mi? Dondurur: null ya da neden ('variants', 'variant_mismatch', 'option').
 * 1) Urunun varyant verisi varsa: farkli varyant fiyatlari ya da sayfa fiyatinin hicbir varyantla tutmamasi -> secenek;
 *    tum varyantlar sayfa fiyatinda ise secenekler fiyati degistirmiyor demektir.
 * 2) Varyant verisi yoksa: urun secenegi <select>'leri (variant/option/secenek/drpN...; siralama, para birimi, taksit,
 *    dil vb. degil) en az iki gercek secenekle. Yalniz renk / renk sicakligi secimi fiyat degistirmez sayilir; fiyat farki
 *    yazan ("+150 TL") ya da adet, metre, paket, guc, boy vb. (ve bilinmeyen) secimler ihtiyatla secenek sayilir.
 */
function vgm_price_options(?array $vp, string $plain, float $price): ?string
{
    if ($vp !== null) {
        $distinct = [];
        foreach ($vp as $p) {
            $distinct[(string)(int)round($p * 100)] = $p;
        }
        if (count($distinct) > 1) {
            return 'variants';
        }
        return abs((float)reset($distinct) - $price) > 0.011 ? 'variant_mismatch' : null;
    }
    if (stripos($plain, '<select') === false
        || preg_match_all('~<select\b([^<>]{0,3000})>(.*?)</select\s*>~is', $plain, $sel, PREG_SET_ORDER | PREG_OFFSET_CAPTURE) < 1) {
        return null;
    }
    foreach (array_slice($sel, 0, 60) as $s) {
        $a = vgm_attrs($s[1][0]);
        $ident = '';
        foreach ($a as $k => $v) {
            $ident .= ' ' . $k . '=' . $v;
        }
        if (preg_match('/variant|varyas|option|se(?:c|\xC3\xA7)enek|drp[0-9]|attribute|ozellik|\xC3\xB6zellik/i', $ident) !== 1
            || preg_match('/sort|s(?:i|\xC4\xB1)rala|order|currency|d(?:o|\xC3\xB6)viz|lang|country|(?:u|\xC3\xBC)lke|city|(?:s|\xC5\x9F)ehir|il(?:c|\xC3\xA7)e|taksit|bank|rating|puan|yorum|review|comment|filt|kategori|categor|limit|per-?page|sayfa/i', $ident) === 1) {
            continue;
        }
        $real = [];
        if (preg_match_all('~<option\b([^<>]*)>(.*?)(?=<option\b|$)~is', $s[2][0], $opts, PREG_SET_ORDER) > 0) {
            foreach (array_slice($opts, 0, 100) as $o) {
                $oa = vgm_attrs($o[1]);
                $text = vgm_plain(vgm_strip_tags($o[2]), 120);
                $value = trim((string)($oa['value'] ?? $text));
                if ($text === '' || in_array($value, ['', '0', '-1'], true) || isset($oa['disabled'])
                    || preg_match('/^\W*(?:se(?:\x{00E7}|\x{00C7}|c|C)(?:i|I|\x{0130}|\x{0131})n(?:i|I|\x{0130}|\x{0131})z|l(?:\x{00FC}|\x{00DC}|u|U)tfen|choose|select|please)/iu', $text) === 1) {
                    continue;
                }
                $real[] = $text;
            }
        }
        if (count($real) < 2) {
            continue;
        }
        $joined = implode(' | ', $real);
        if (preg_match('/[+\-]\s*[0-9][0-9.,]*\s*(?:TL|TRY|\x{20BA}|USD|EUR|\$|\x{20AC})|\(\s*\+\s*[0-9]/iu', $joined) === 1) {
            return 'option';
        }
        $lead = vgm_page_text(substr($plain, max(0, (int)$s[0][1] - 400), min(400, (int)$s[0][1])));
        $label = (string)($a['title'] ?? '') . ' ' . (string)($a['aria-label'] ?? '') . ' ' . (string)($a['data-variant-name'] ?? '')
            . ' ' . substr($lead, -80);
        $colour = preg_match('/renk|color|colour|desen|pattern/i', $label) === 1;
        $kelvin = count(array_filter($real, function (string $t): bool {
            return preg_match('/^\s*[0-9]{4,5}\s*K\b/i', $t) === 1;
        })) === count($real);
        if ($colour || $kelvin) {
            continue;
        }
        return 'option';
    }
    return null;
}

/** Yer tutucu urun gorseli ("gorsel hazirlaniyor", nopic, no-image, placeholder...) mi? */
function vgm_placeholder_image(string $u): bool
{
    return preg_match('~(?:gorsel|g\xC3\xB6rsel|resim)[-_]?(?:hazirlaniyor|haz\xC4\xB1rlan\xC4\xB1yor|yok)|urun[-_]?gorseli[-_]?hazir|nopic|no[-_]?(?:image|photo|picture|img)|noimage|placeholder|default[-_](?:product|image)|resimyok|image[-_]?coming|coming[-_]?soon~i', $u) === 1;
}

/* ------------------------------------------------------------------ teklif ayristirma */

function vgm_offer_blank(): array
{
    return ['ok' => false, 'price' => null, 'currency' => null, 'available' => null, 'name' => null, 'brand' => null,
        'gtin' => null, 'mpn' => null, 'sku' => null, 'image' => null, 'method' => null, 'candidates' => [], 'error' => '',
        'vatIncluded' => null, 'minQty' => null];
}

/** Seviye sonucunu ayristirici ciktisina cevirir: tek fiyat, para birimi, stok; celiskide ambiguous_price. */
function vgm_level_result(array $level, string $url): array
{
    $r = vgm_offer_blank();
    $r['method'] = $level['method'];
    foreach (['name', 'brand', 'gtin', 'mpn', 'sku', 'image'] as $k) {
        $v = $level['ident'][$k] ?? null;
        $r[$k] = is_string($v) && $v !== '' && !in_array(strtolower(trim($v)), ['false', 'null', 'undefined', 'none', 'n/a', '-'], true) ? $v : null;
    }
    if ($r['image'] !== null && preg_match('#^https?://#i', $r['image']) !== 1) {
        $r['image'] = vgm_resolve_location($url, $r['image']);
    }
    if ($r['image'] !== null && vgm_placeholder_image($r['image'])) {
        $r['image'] = null;
    }
    if (!empty($level['zero'])) {
        $r['error'] = 'no_price';
        return $r;
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
 * Ek kurallar (yanlis fiyat = maliyetin altinda satis; emin olunamayan her durumda ok=false):
 *  - urunun kendi fiyati acikca 0 (JSON-LD/microdata teklifi, ana fiyat ogesi ya da gizli fiyat alani): 'no_price';
 *    yedek seviyeye (baska urun kartinin fiyatina) dusulmez
 *  - en az siparis / kat adedi > 1: 'min_quantity' (minQty dolu)
 *  - fiyati degistiren secenek/varyant: 'price_options'
 *  - vatIncluded: sayfanin gosterdigi KDV durumu (true/false/null; vgm_vat_flag). Ayni urunun net (+ KDV) ve KDV dahil
 *    iki fiyati belirsizlik yaratiyorsa ve oran gecerli bir KDV oraniysa KDV dahil olan alinir.
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
    $html = vgm_strip_comments(vgm_utf8(vgm_drop_data_uris($html)));
    $plain = vgm_strip_elements($html, ['script', 'style', 'template']);
    $evidence = (string)preg_replace('~<script\b[^>]*application/ld\+json[^>]*>.*?</script\s*>~is', ' ', $html);
    $variants = vgm_variant_prices($html);
    $level = vgm_level_jsonld($html, $url, $evidence, $variants);
    unset($evidence);
    if ($level === null) {
        $level = vgm_level_microdata($plain) ?? vgm_level_meta($plain) ?? vgm_level_platform($plain);
    }
    if ($level === null) {
        $r['error'] = 'no_price';
        return $r;
    }
    $r = vgm_level_result($level, $url);
    if ($r['image'] === null && preg_match('~<meta\b[^<>]*\bproperty\s*=\s*["\']og:image["\'][^<>]*>~i', $plain, $og) === 1) {
        $img = vgm_plain((string)(vgm_attrs(substr($og[0], 5, -1))['content'] ?? ''), 500);
        if ($img !== '' && !vgm_placeholder_image($img)) {
            $r['image'] = preg_match('#^https?://#i', $img) === 1 ? $img : vgm_resolve_location($url, $img);
        }
    }
    if ($r['error'] === 'no_price') {
        return $r;
    }
    if (vgm_own_price_zero($plain)) {
        // sayfanin kendi fiyat alani 0 ("fiyat sorunuz"): baska bir okumaya guvenilmez
        $r['ok'] = false;
        $r['price'] = null;
        $r['error'] = 'no_price';
        return $r;
    }
    $text = vgm_page_text($plain);
    if (!$r['ok'] && $r['error'] === 'ambiguous_price' && count($r['candidates']) === 2) {
        list($lo, $hi) = $r['candidates'];
        $vatRatio = false;
        foreach ([1.01, 1.08, 1.10, 1.18, 1.20] as $k) {
            $vatRatio = $vatRatio || abs($hi / $lo - $k) <= 0.002;
        }
        if ($vatRatio && vgm_vat_flag($text, '', $lo) === false && vgm_vat_flag($text, '', $hi) === true) {
            $level['entries'] = array_values(array_filter($level['entries'], function (array $e) use ($hi): bool {
                return abs($e['price'] - $hi) < 0.005;
            }));
            $image = $r['image'];
            $r = vgm_level_result($level, $url);
            $r['image'] = $image;
        }
    }
    if (!$r['ok']) {
        return $r;
    }
    $r['vatIncluded'] = vgm_vat_flag($text, $html, (float)$r['price']);
    $min = vgm_min_qty($plain, $text);
    if ($min !== null) {
        $r['ok'] = false;
        $r['minQty'] = $min;
        $r['error'] = 'min_quantity';
        return $r;
    }
    if (vgm_price_options($variants, $plain, (float)$r['price']) !== null) {
        $r['ok'] = false;
        $r['error'] = 'price_options';
        return $r;
    }
    return $r;
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
 * Yalniz kaynagin kendi alan adi izinlidir. Kimlik (GTIN/MPN) celisirse 'identity_mismatch'; sayfanin gosterdigi KDV
 * durumu kaynak kaydindaki vatIncluded ile celisirse 'vat_mismatch' (net fiyat KDV dahil sanilip maliyetin altina
 * satilmaz). Zamanlayici ayni mantigi es zamanli getirmeyle vgm_offer_from_fetch uzerinden kullanir.
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
    return vgm_offer_from_fetch($html, $why, $status, $src, $product);
}

/** Getirme sonucundan (govde, hata kodu, HTTP durumu) teklif: vgm_fetch_offer'in ayristirma ve denetim yarisi. */
function vgm_offer_from_fetch(string $html, string $why, int $status, array $src, array $product): array
{
    $url = is_string($src['url'] ?? null) ? $src['url'] : '';
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
    $vatIncluded = ($src['vatIncluded'] ?? true) !== false;
    if ($o['vatIncluded'] !== null && $o['vatIncluded'] !== $vatIncluded) {
        return ['error' => 'vat_mismatch'];
    }
    $fallback = is_string($src['currency'] ?? null) ? strtoupper($src['currency']) : 'TRY';
    $discount = $src['discount'] ?? 0;
    return [
        'price' => (float)$o['price'],
        'currency' => is_string($o['currency']) ? $o['currency'] : $fallback,
        'vatIncluded' => $vatIncluded,
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

/** Kaynaklari oncelik sirasiyla dondurur; anahtar kaynagin kaynak listesindeki sirasidir. */
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

/**
 * Zamanlayici sirasi: kontrol zamani gelen urunler, aciliyet sirasiyla. Once hic denenmemisler; sonra dogrulanmis fiyati
 * olanlar en eski dogrulamadan (48 saat sinirina en yakin) baslayarak; en sonda hic dogrulanamamislar. Basarili son kontrol
 * $age sn bekler; basarisiz deneme geri cekilir: min($retry x 2^(ardisik hata - 1), $age). Boylece kalici hatali urunler
 * sunucunun kapasitesini tuketmez ve dogrulanmis urunler 48 saat penceresinin icinde kalir.
 * $queue: fiyat-sira.json items (id => [checkedAt, lastAttemptAt, durum, sunucu, ardisikHata]).
 */
function vgm_due_order(array $queue, int $now, int $age, int $retry): array
{
    $ids = [];
    $group = [];
    $key = [];
    foreach ($queue as $id => $e) {
        $checked = is_array($e) ? (int)($e[0] ?? 0) : 0;
        $attempt = is_array($e) ? (int)($e[1] ?? 0) : 0;
        $succeeded = $checked > 0 && $checked >= $attempt;
        $fails = $succeeded ? 0 : max(1, is_array($e) ? (int)($e[4] ?? 1) : 1);
        $wait = $succeeded ? $age : (int)min($age, $retry * (2 ** min(16, $fails - 1)));
        if ($attempt > 0 && $now - $attempt < $wait) {
            continue;
        }
        $ids[] = (string)$id;
        $group[] = $attempt === 0 ? 0 : ($checked > 0 ? 1 : 2);
        $key[] = $checked > 0 ? $checked : $attempt;
    }
    if (!$ids) {
        return [];
    }
    $names = $ids;
    array_multisort($group, SORT_ASC, SORT_NUMERIC, $key, SORT_ASC, SORT_NUMERIC, $names, SORT_ASC, SORT_STRING, $ids);
    return $ids;
}

/**
 * Bekleyen sonuclari isler: her urunun guncel kaydina vgm_apply_check uygulanir, parcalar/sira/durum tek yazma kilidinde
 * yazilir. $pending: id => [urun, kaynak indeksi, sonuc, kurlar, zaman]. Dondurur: id => yeni durum.
 */
function vgm_refresh_flush(array $pending): array
{
    if (!$pending) {
        return [];
    }
    return (array)vgm_locked(true, function (string $dir) use ($pending): array {
        $current = vgm_price_items($dir, array_keys($pending));
        $new = [];
        $statuses = [];
        foreach ($pending as $id => $row) {
            list($p, $used, $result, $rates, $at) = $row;
            $new[$id] = vgm_apply_check($current[$id] ?? null, $p, (int)$used, $result, $rates, $at);
            $statuses[$id] = (string)($new[$id]['status'] ?? 'error');
        }
        vgm_prices_put($dir, $new);
        return $statuses;
    });
}

/**
 * Fiyat/kur yenileme.
 * opts: ids (dizi = yalnizca bu urunler; null = zamanlayici: kontrol zamani gelen urunler, vgm_due_order), live (bool),
 * budget (sn; cron 540, canli 8), max (getirme sayisi), spacing (ayni sunucuya istekler arasi varsayilan sn; kaynaklar.json
 * suppliers.<alan>.spacing her zaman once gelir; verilmezse 1, canli kontrolde 0), age (basarili kontrolden sonra yeniden
 * kontrol, sn; varsayilan VGM_RECHECK_AGE), rates (false: kur hic getirilmez), forceRates, heartbeat (lastRunAt/
 * lastRunSummary yaz; varsayilan: canli degil ve ids null).
 * Sunucular arasi serpistirme ve es zamanlilik: siradaki urunler ilk kaynaklarinin sunucusuna gore kuyruklanir; farkli
 * sunuculara ayni anda en cok `parallel` (varsayilan vgm_fetch_parallel: VGM_FETCH_PARALLEL, bellege gore) istek
 * curl_multi ile yurutulur, her sunucuda tek istek ve kendi araligi. Bos yuvaya bekleme suresi dolmus sunucularin en
 * oncelikli urunu alinir; hicbiri hazir degilse en erken hazir olan beklenir. Son tarihte durur (ucustaki istekler
 * birakilir, left); ilerleme her 20 sonucta ya da 15 sn'de bir (ve sonda) parca parca yazilir.
 * Canli: yalniz checkedAt'i VGM_LIVE_RECHECK_AFTER'dan eski ve lastAttemptAt'i VGM_LIVE_MIN_INTERVAL'dan eski urunler,
 * kur yalniz yoksa; ayrica vg_rl_hit('vgm_live', 'all', 30, 60). Ag islemi kilit DISINDA.
 * Dondurur: {checked, ok, held, error, unavailable, skipped (denenemeyen: kaynak/urun/kur yok, canlida taze ya da hiz
 * siniri), left (sure ya da getirme siniri yuzunden sirasi gelmeyen; sonraki calismaya kalir), due (zamani gelen ya da
 * istenen urun sayisi), rateUpdated, seconds} (+ rateError).
 */
function vgm_refresh(array $opts): array
{
    $start = microtime(true);
    $live = ($opts['live'] ?? false) === true;
    $budget = isset($opts['budget']) && is_numeric($opts['budget']) ? max(1.0, (float)$opts['budget']) : ($live ? 8.0 : (float)VGM_CRON_BUDGET);
    $maxFetch = isset($opts['max']) && is_numeric($opts['max']) ? max(0, (int)$opts['max']) : ($live ? 6 : PHP_INT_MAX);
    $defaultSpacing = isset($opts['spacing']) && is_numeric($opts['spacing']) ? max(0.0, (float)$opts['spacing']) : ($live ? 0.0 : 1.0);
    $age = isset($opts['age']) && is_numeric($opts['age']) ? max(0, (int)$opts['age']) : VGM_RECHECK_AGE;
    $ids = isset($opts['ids']) && is_array($opts['ids']) ? array_values(array_unique(array_filter($opts['ids'], 'is_string'))) : null;
    $deadline = $start + $budget;
    if ($live) {
        vgm_fetch_deadline($deadline);
    }
    $summary = ['checked' => 0, 'ok' => 0, 'held' => 0, 'error' => 0, 'unavailable' => 0, 'skipped' => 0, 'left' => 0, 'due' => 0,
        'rateUpdated' => false, 'seconds' => 0.0];
    try {
        // aday urunler: verilen kimlikler ya da zamanlayici sirasi
        if ($ids === null) {
            list($config, $rate, $queue) = vgm_locked(true, function (string $dir): array {
                return [vgm_config($dir), vgm_rate_state($dir), vgm_queue_read($dir, true)['items']];
            });
            $order = vgm_due_order($queue, time(), $age, VGM_RETRY_AFTER);
            $hostOf = [];
            foreach ($order as $id) {
                $hostOf[$id] = is_array($queue[$id] ?? null) ? (string)($queue[$id][3] ?? '') : '';
            }
            unset($queue);
            $items = [];
        } else {
            list($config, $rate, $items) = vgm_locked(false, function (string $dir) use ($ids): array {
                return [vgm_config($dir), vgm_rate_state($dir), vgm_price_items($dir, $ids)];
            });
            $order = $ids;
            usort($order, function (string $a, string $b) use ($items): int {
                $x = (int)($items[$a]['lastAttemptAt'] ?? 0);
                $y = (int)($items[$b]['lastAttemptAt'] ?? 0);
                return $x <=> $y ?: strcmp($a, $b);
            });
        }
        $summary['due'] = count($order);
        // kur (ag islemi kilit disinda)
        $needRate = $rate === null || ($opts['forceRates'] ?? false) === true
            || (!$live && time() - (int)($rate['fetchedAt'] ?? 0) > VGM_RATE_REFRESH_AFTER);
        // canli kontrolde kaynakli urun yoksa ya da kur getirmesi sik tekrarlaniyorsa herkese acik istek TCMB'ye cikmaz
        if ($live && $needRate && ($opts['forceRates'] ?? false) !== true) {
            $hasSource = false;
            foreach ($order as $id) {
                if (vgm_product($id) !== null && vgm_sources($config, $id) !== []) {
                    $hasSource = true;
                    break;
                }
            }
            if (!$hasSource || vg_rl_hit('vgm_live_rate', 'all', 2, 300) > 0) {
                $needRate = false;
            }
        }
        if (($opts['rates'] ?? true) !== false && $needRate) {
            $why = '';
            // canli kontrolde musteri bekler: kur getirmesi de toplam butceyi asmaz
            $fresh = vgm_fetch_rates($why, $live ? max(2, (int)ceil($deadline - microtime(true))) : null);
            if ($fresh !== null) {
                vgm_locked(true, function (string $dir) use ($fresh): void {
                    vgm_write($dir, 'kur.json', $fresh);
                    vgm_status_update($dir, ['rate' => ['at' => time(), 'ok' => true, 'error' => null]]);
                });
                $rate = $fresh;
                $summary['rateUpdated'] = true;
            } else {
                $summary['rateError'] = $why;
                vgm_locked(true, function (string $dir) use ($why): void {
                    vgm_status_update($dir, ['rate' => ['at' => time(), 'ok' => false, 'error' => $why]]);
                });
            }
        }
        // sunucu kuyruklari: zamanlayicida sirasi gelen ilk VGM_CRON_WINDOW urun (bir calismada getirilebilecekten fazlasi),
        // ids verildiyse hepsi. Kaynaklar parca parca okunur (her kaynak parcasi bir kez); urun kaydi yalnizca getirme
        // aninda okunur (katalogdan kaldirilmis urun orada atlanir ve siradan silinir).
        $hosts = [];
        $sourcesOf = [];
        $rank = [];
        $spacingOf = function (string $host) use ($config, $defaultSpacing, $live): float {
            return $live ? $defaultSpacing : vgm_spacing($config, $host, $defaultSpacing);
        };
        if ($ids === null) {
            /* Pencere sunucu basina kuyruklanir: her sunucudan en cok bu calismada getirilebilecek kadar (butce / aralik +
               pay) urun alinir. Sira basini tek bir tedarikci doldursa da diger sunucular ayni calismada islenir. */
            $total = max(50, $maxFetch === PHP_INT_MAX ? VGM_CRON_WINDOW : $maxFetch * 2);
            $taken = [];
            $window = [];
            foreach ($order as $id) {
                $h = $hostOf[$id] ?? '';
                $cap = (int)ceil($budget / max(0.25, $spacingOf($h))) + VGM_HOST_SLACK;
                if (($taken[$h] ?? 0) >= $cap) {
                    continue;
                }
                $taken[$h] = ($taken[$h] ?? 0) + 1;
                $window[] = $id;
                if (count($window) >= $total) {
                    break;
                }
            }
        } else {
            $window = $order;
        }
        $summary['left'] = count($order) - count($window);
        $lists = vgm_sources_many($config, $window);
        $n = 0;
        foreach ($window as $id) {
            $sources = $lists[$id] ?? [];
            if ($sources === []) {
                if ($ids === null) {
                    $summary['skipped']++;
                }
                continue;
            }
            $sourcesOf[$id] = vgm_sources_ordered($sources);
            $first = reset($sourcesOf[$id]);
            $host = vgm_host((string)($first['url'] ?? ''));
            $hosts[$host][] = $id;
            $rank[$id] = $n++;
        }
        unset($lists);
        if (!vgm_rate_ok($rate, time())) {
            // guvenilir kur yokken maliyet USD'ye cevrilemez; bos yere getirme yapilmaz
            if ($sourcesOf) {
                $summary['rateError'] = $summary['rateError'] ?? 'no_rate';
            }
            $summary['skipped'] += count($sourcesOf);
            $hosts = [];
        }
        $dead = [];
        $rates = ['USD' => (float)($rate['usdTry'] ?? 0), 'EUR' => is_numeric($rate['eurTry'] ?? null) ? (float)$rate['eurTry'] : null];
        $lastHit = [];
        $fetches = 0;
        $pending = [];
        $lastFlush = microtime(true);
        $record = function (array $statuses) use (&$summary): void {
            foreach ($statuses as $status) {
                $summary['checked']++;
                $summary[in_array($status, ['ok', 'held', 'unavailable'], true) ? $status : 'error']++;
            }
        };
        /* Es zamanli getirme: farkli sunuculara ayni anda en cok $parallel istek (curl_multi), her sunucuda tek istek ve
           kendi araligi. Urun isi: siradaki kaynak indeksi, biriken hatalar; kaynak basarisizsa is bir sonraki kaynagin
           sunucu kuyrugunun basina doner (oncelik sirasi korunur). */
        $parallel = isset($opts['parallel']) && is_numeric($opts['parallel']) ? max(1, min(VGM_FETCH_PARALLEL, (int)$opts['parallel'])) : vgm_fetch_parallel();
        $jobs = [];      // id => ['idx', 'errors', 'gone', 'used', 'p']
        $flight = [];    // sunucu => ['id', 'key', 'src', 'req']
        $stop = false;   // canli hiz siniri: yeni getirme baslatilmaz
        $readyAtOf = function (string $h) use (&$lastHit, $spacingOf): float {
            return isset($lastHit[$h]) ? $lastHit[$h] + $spacingOf($h) : 0.0;
        };
        $settle = function (string $id, $key, array $offer) use (&$jobs, &$hosts, &$pending, &$lastFlush, &$sourcesOf, &$rates, &$record): void {
            $result = null;
            if (isset($offer['error'])) {
                /* Kaldirilmis (404/410) kaynak sonraki kaynagi gizlemez; tum kaynaklar kaldirilmissa urun stokta yok. */
                if (!empty($offer['gone'])) {
                    $jobs[$id]['gone'] = $jobs[$id]['gone'] ?? $offer;
                } else {
                    $jobs[$id]['errors'][] = (string)$offer['error'];
                }
                $jobs[$id]['used'] = $jobs[$id]['used'] ?? $key;
                $jobs[$id]['idx']++;
                $keys = array_keys($sourcesOf[$id]);
                if (isset($keys[$jobs[$id]['idx']])) {
                    // siradaki kaynak: o sunucunun kuyrugunun basina
                    $nextHost = vgm_host((string)($sourcesOf[$id][$keys[$jobs[$id]['idx']]]['url'] ?? ''));
                    if (!isset($hosts[$nextHost])) {
                        $hosts[$nextHost] = [];
                    }
                    array_unshift($hosts[$nextHost], $id);
                    return;
                }
                $result = $jobs[$id]['errors'] === [] && $jobs[$id]['gone'] !== null
                    ? $jobs[$id]['gone']
                    : ['error' => implode(', ', array_values(array_unique($jobs[$id]['errors'])))];
            } else {
                $result = $offer;
                $jobs[$id]['used'] = $key;
            }
            $pending[$id] = [$jobs[$id]['p'], (int)$jobs[$id]['used'], $result, $rates, time()];
            unset($jobs[$id]);
            if (count($pending) >= 20 || microtime(true) - $lastFlush >= 15) {
                $record(vgm_refresh_flush($pending));
                $pending = [];
                $lastFlush = microtime(true);
            }
        };
        while ($hosts || $flight) {
            $now = microtime(true);
            // 1) bos yuvalara, bekleme suresi dolmus sunuculardan en oncelikli urunlerin istekleri
            while (!$stop && $hosts && count($flight) < $parallel && $now < $deadline && $fetches < $maxFetch) {
                $pickHost = null;
                $bestRank = PHP_INT_MAX;
                foreach ($hosts as $h => $list) {
                    if (!isset($flight[$h]) && $readyAtOf((string)$h) <= $now && $rank[$list[0]] < $bestRank) {
                        $pickHost = (string)$h;
                        $bestRank = $rank[$list[0]];
                    }
                }
                if ($pickHost === null) {
                    break;
                }
                $id = array_shift($hosts[$pickHost]);
                if (!$hosts[$pickHost]) {
                    unset($hosts[$pickHost]);
                }
                if (!isset($jobs[$id])) {
                    if ($live) {
                        $item = $items[$id] ?? null;
                        $checkedAt = is_array($item) && is_int($item['checkedAt'] ?? null) ? $item['checkedAt'] : 0;
                        $attemptAt = is_array($item) && is_int($item['lastAttemptAt'] ?? null) ? $item['lastAttemptAt'] : 0;
                        $t = time();
                        if ($t - $checkedAt <= VGM_LIVE_RECHECK_AFTER || $t - $attemptAt <= VGM_LIVE_MIN_INTERVAL) {
                            $summary['skipped']++;
                            continue;
                        }
                        if (vg_rl_hit('vgm_live', 'all', 30, 60) > 0) {
                            $left = 1;
                            foreach ($hosts as $list) {
                                $left += count($list);
                            }
                            $summary['skipped'] += $left;
                            $hosts = [];
                            $stop = true;
                            break;
                        }
                    }
                    $p = vgm_product($id);
                    if ($p === null) {
                        // katalogdan kaldirilmis (kaynak/fiyat kaydi kalmis) urun: getirilmez, zamanlayici sirasindan silinir
                        $summary['skipped']++;
                        $dead[] = $id;
                        continue;
                    }
                    $jobs[$id] = ['idx' => 0, 'errors' => [], 'gone' => null, 'used' => null, 'p' => $p];
                }
                $keys = array_keys($sourcesOf[$id]);
                $key = $keys[$jobs[$id]['idx']];
                $src = $sourcesOf[$id][$key];
                $url = is_string($src['url'] ?? null) ? $src['url'] : '';
                $supplier = is_string($src['supplier'] ?? null) ? $src['supplier'] : '';
                if ($url === '' || $supplier === '') {
                    $settle($id, $key, ['error' => 'bad_source']);
                    continue;
                }
                $fetches++;
                vgm_fetch_limit((int)ceil($deadline - $now));
                $flight[$pickHost] = ['id' => $id, 'key' => $key, 'src' => $src, 'req' => vgm_fetch_start($url, [$supplier])];
                $now = microtime(true);
            }
            if (!$flight) {
                // ucusta istek yok: en erken hazir olacak sunucu beklenir; son tarih ya da getirme siniri ise bitti
                if (!$hosts || $stop || $now >= $deadline || $fetches >= $maxFetch) {
                    break;
                }
                $earliestAt = INF;
                foreach ($hosts as $h => $list) {
                    $earliestAt = min($earliestAt, $readyAtOf((string)$h));
                }
                if ($earliestAt >= $deadline) {
                    break;
                }
                usleep((int)ceil(max(0.0, $earliestAt - $now) * 1000000));
                continue;
            }
            // 2) surus: bos yuva varsa en erken hazir olacak sunucuya, yoksa en cok 1 sn ya da son tarihe kadar
            $until = $deadline;
            if (!$stop && count($flight) < $parallel && $fetches < $maxFetch) {
                foreach ($hosts as $h => $list) {
                    if (!isset($flight[$h])) {
                        $until = min($until, max($now, $readyAtOf((string)$h)));
                    }
                }
            }
            vgm_fetch_drive(array_column($flight, 'req'), min($until, $now + 1.0));
            // 3) tamamlananlar: ayristirma ve sonuc (hata ise siradaki kaynak)
            foreach ($flight as $h => $f) {
                if (!$f['req']->done) {
                    continue;
                }
                unset($flight[$h]);
                $lastHit[$h] = microtime(true);
                $req = $f['req'];
                $settle($f['id'], $f['key'], vgm_offer_from_fetch($req->body, $req->why, $req->status, $f['src'], $jobs[$f['id']]['p']));
                $req->body = '';
            }
            if (microtime(true) >= $deadline) {
                break;
            }
        }
        // son tarihte ucusta kalan istekler birakilir; yarim kalan isler ve sirasi gelmeyenler bir sonraki calismaya kalir (left)
        foreach ($flight as $f) {
            vgm_fetch_abort($f['req']);
            $summary['left']++;
        }
        $record(vgm_refresh_flush($pending));
        foreach ($hosts as $list) {
            $summary['left'] += count($list);
        }
        if ($dead && $ids === null) {
            vgm_locked(true, function (string $dir) use ($dead): void {
                vgm_queue_forget($dir, $dead);
            });
        }
        $summary['seconds'] = round(microtime(true) - $start, 1);
        $summary['fetches'] = $fetches;
        $summary['budget'] = $budget;
        $heartbeat = array_key_exists('heartbeat', $opts) ? $opts['heartbeat'] === true : (!$live && $ids === null);
        if ($heartbeat) {
            vgm_locked(true, function (string $dir) use ($summary): void {
                vgm_status_update($dir, ['lastRunAt' => time(), 'lastRunSummary' => $summary]);
            });
        }
        return $summary;
    } finally {
        vgm_fetch_limit(VGM_FETCH_TIMEOUT);
        vgm_fetch_deadline(null, true);
    }
}

/**
 * Zamanlanmis calisma ozeti (cron --status ve panel): son calisma, sayimlar, bayat urun sayisi, taze kontrol orani, kur.
 * Yalnizca fiyat-sira.json ve fiyat-durum.json okunur. healthy: son calisma 30 dakika icinde.
 */
function vgm_refresh_status(int $now): array
{
    vgm_queue_ensure();
    list($queue, $status, $rate) = vgm_locked(false, function (string $dir): array {
        return [vgm_queue_read($dir)['items'], vgm_status_read($dir), vgm_rate_state($dir)];
    });
    $counts = ['ok' => 0, 'held' => 0, 'error' => 0, 'unavailable' => 0, 'unchecked' => 0];
    $stale = 0;
    foreach ($queue as $e) {
        $st = is_array($e) && is_string($e[2] ?? null) ? $e[2] : 'unchecked';
        $counts[isset($counts[$st]) ? $st : 'error']++;
        $at = is_array($e) ? (int)($e[0] ?? 0) : 0;
        if ($at === 0 || $now - $at > VGM_PRICE_MAX_AGE) {
            $stale++;
        }
    }
    $products = count($queue);
    $last = is_int($status['lastRunAt'] ?? null) ? $status['lastRunAt'] : null;
    /* Kapasite tahmini: son calismanin getirme hizi (getirme / sn) x saatte 6 calisma x butce. Tum urunlerin bir turu
       bu hizla 48 saati asiyorsa fiyatlar bayatlar: saglikli sayilmaz. Az ornekli (< 20 getirme) calismada tahmin yok. */
    $sum = is_array($status['lastRunSummary'] ?? null) ? $status['lastRunSummary'] : [];
    $fetches = (int)($sum['fetches'] ?? 0);
    $secs = (float)($sum['seconds'] ?? 0);
    $runBudget = (float)($sum['budget'] ?? VGM_CRON_BUDGET);
    $perHour = $fetches >= 20 && $secs > 0 ? $fetches / $secs * min(3600.0, $runBudget * 6) : null;
    $cycleHours = $perHour !== null && $perHour > 0 ? round($products / $perHour, 1) : null;
    $capacityOk = $cycleHours === null || $cycleHours * 3600 <= VGM_PRICE_MAX_AGE;
    return [
        'lastRunAt' => $last,
        'lastRunAtIso' => $last !== null ? vg_iso($last) : null,
        'summary' => $status['lastRunSummary'] ?? null,
        'healthy' => $last !== null && $now - $last <= VGM_HEALTHY_AFTER && $capacityOk,
        'capacity' => ['fetchesPerHour' => $perHour !== null ? (int)round($perHour) : null, 'cycleHours' => $cycleHours, 'ok' => $capacityOk],
        'products' => $products,
        'counts' => $counts,
        'stale' => $stale,
        'fresh' => $products - $stale,
        'freshShare' => $products > 0 ? round(($products - $stale) / $products, 4) : null,
        'rate' => $rate === null ? null : [
            'usdTry' => (float)$rate['usdTry'],
            'eurTry' => is_numeric($rate['eurTry'] ?? null) ? (float)$rate['eurTry'] : null,
            'date' => $rate['date'] ?? null,
            'fetchedAt' => $rate['fetchedAt'] ?? null,
            'ok' => vgm_rate_ok($rate, $now),
        ],
    ];
}

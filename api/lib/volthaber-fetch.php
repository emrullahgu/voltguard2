<?php
/*
 * VoltHaber kaynak tarayici: RSS/Atom akislarindan YALNIZCA baslik, baglanti, tarih ve kaynak adi alinir.
 * Govde, ozet ve gorsel hicbir zaman saklanmaz. Ogeler editorun "Gelen kutusu"na taslak olarak duser.
 * Guvenlik: yalnizca https:443; ad cozumlenir ve ozel/yerel/ayrilmis adresler engellenir; baglanti cozulmus IP'ye
 * sabitlenir (DNS yeniden baglama yok); yonlendirmeler elle ve her adimda yeniden denetlenir; zaman asimi ve boyut siniri;
 * DOCTYPE/ENTITY iceren XML reddedilir; kaynak basina hiz siniri; hata gunlugu.
 * Izinli kaynak listesi: yalnizca kayittaki kaynaklar taranir ve her istek (yonlendirmeler dahil) o kaynagin kendi
 * alan adlarinda kalmak zorundadir. Kullanim kosullari bir yildan uzun suredir kontrol edilmemis kaynak taranmaz.
 * Tarama hatasi hicbir kaydin tarihini degistirmez; son basarili tarama zamani (lastOkAt) korunur.
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

const VH_FETCH_UA = 'VoltGuardHaberBot/1.0 (+https://voltguard.com.tr/volthaber/yayin-ilkeleri.html; yalnizca baslik ve baglanti)';
const VH_FETCH_MAX_BYTES = 2097152;   // 2 MiB
const VH_FETCH_TIMEOUT = 12;
const VH_FETCH_MAX_ITEMS = 50;
const VH_FETCH_MAX_AGE = 3888000;     // 45 gunden eski ogeler alinmaz
const VH_FETCH_MIN_INTERVAL = 1800;   // zamanlanmis tarama: kaynak basina 30 dk
const VH_FETCH_FORCE_INTERVAL = 300;  // editor "Simdi tara": kaynak basina 5 dk

/* ------------------------------------------------------------------ kaynaklar */

function vh_source_fields(): array
{
    return ['id', 'name', 'homepage', 'feedUrl', 'format', 'category', 'permission', 'termsUrl', 'fallbackLink', 'licenseNote', 'notes', 'enabled',
        'contentTerms', 'imageTerms', 'termsCheckedAt'];
}

/** Metin ve gorsel kullanim kosulu degerleri (kaynak kaydinda). */
function vh_content_terms(): array
{
    return ['baslik-baglanti' => 'Yalnızca başlık ve bağlantı', 'resmi-metin' => 'Resmî metin (telif koruması dışı)',
        'acik-lisans' => 'Açık lisans (koşullarıyla)', 'yazili-izin' => 'Yazılı izinle', 'kullanilamaz' => 'Kullanılamaz'];
}

function vh_image_terms(): array
{
    return ['yok' => 'Görsel kullanılmaz', 'tek-tek' => 'Her görsel ayrıca doğrulanır', 'izinli' => 'Yazılı izinle'];
}

/** Saklanan kaynaklar + kayitta olup henuz saklanmamis olanlar. */
function vh_sources(string $dir): array
{
    $state = vh_read($dir, 'sources.json', ['version' => 1, 'sources' => [], 'runtime' => []], 4194304);
    $sources = is_array($state['sources'] ?? null) ? $state['sources'] : [];
    $known = array_column($sources, 'id');
    foreach (vh_registry() as $r) {
        if (!in_array($r['id'], $known, true)) {
            $sources[] = $r;
        }
    }
    $runtime = is_array($state['runtime'] ?? null) ? $state['runtime'] : [];
    // Kosul alanlari olmadan saklanmis kaynaklar kayittaki degerle (yoksa en kisitli degerle) tamamlanir.
    $defaults = array_column(vh_registry(), null, 'id');
    foreach ($sources as $i => $s) {
        foreach (['contentTerms' => 'baslik-baglanti', 'imageTerms' => 'yok', 'termsCheckedAt' => ''] as $k => $v) {
            if (!isset($s[$k])) {
                $sources[$i][$k] = $defaults[$s['id'] ?? ''][$k] ?? $v;
            }
        }
    }
    return ['version' => 1, 'sources' => array_values($sources), 'runtime' => $runtime,
        'scheduler' => is_array($state['scheduler'] ?? null) ? $state['scheduler'] : null];
}

function vh_find_source(array $state, string $id): ?array
{
    foreach ($state['sources'] as $s) {
        if (($s['id'] ?? '') === $id) {
            return $s;
        }
    }
    return null;
}

/** Editorun gonderdigi kaynak kaydini dogrular. */
function vh_clean_source(array $in, ?array $existing): array
{
    foreach (array_keys($in) as $k) {
        if (!in_array($k, vh_source_fields(), true)) {
            vg_fail(400, 'invalid_request', 'Kaynak alanlarından biri desteklenmiyor.');
        }
    }
    $id = $existing['id'] ?? ($in['id'] ?? '');
    if (!is_string($id) || preg_match('/^[a-z0-9]+(-[a-z0-9]+)*$/', $id) !== 1 || strlen($id) > 40) {
        vg_fail(422, 'invalid_field', 'Kaynak kimliği küçük harf, rakam ve tire olmalı.', ['id' => 'Geçersiz.']);
    }
    $feed = (string)($in['feedUrl'] ?? ($existing['feedUrl'] ?? ''));
    if (vh_https_url($feed) === '') {
        vg_fail(422, 'invalid_field', 'Akış adresi https ile başlamalı.', ['feedUrl' => 'Yalnızca https.']);
    }
    $home = (string)($in['homepage'] ?? ($existing['homepage'] ?? ''));
    $terms = (string)($in['termsUrl'] ?? ($existing['termsUrl'] ?? ''));
    $fallback = (string)($in['fallbackLink'] ?? ($existing['fallbackLink'] ?? ''));
    foreach (['homepage' => $home, 'termsUrl' => $terms, 'fallbackLink' => $fallback] as $k => $u) {
        if ($u !== '' && vh_https_url($u) === '') {
            vg_fail(422, 'invalid_field', 'Adresler https ile başlamalı.', [$k => 'Yalnızca https.']);
        }
    }
    $format = (string)($in['format'] ?? ($existing['format'] ?? 'rss'));
    if (!in_array($format, ['rss', 'atom', 'etkb', 'none'], true)) {
        vg_fail(422, 'invalid_field', 'Biçim rss, atom, etkb veya none (taranmayan başvuru kaynağı) olmalı.', ['format' => 'Geçersiz.']);
    }
    $cat = (string)($in['category'] ?? ($existing['category'] ?? ''));
    if (!isset(vh_categories()[$cat])) {
        vg_fail(422, 'invalid_field', 'Kategori seçin.', ['category' => 'Geçersiz.']);
    }
    $perm = (string)($in['permission'] ?? ($existing['permission'] ?? 'izin-gerekli'));
    if (!in_array($perm, ['kamu', 'lisansli', 'izinli', 'izin-gerekli', 'reddedildi'], true)) {
        vg_fail(422, 'invalid_field', 'İzin durumu geçersiz.', ['permission' => 'Geçersiz.']);
    }
    $ct = (string)($in['contentTerms'] ?? ($existing['contentTerms'] ?? 'baslik-baglanti'));
    if (!isset(vh_content_terms()[$ct])) {
        vg_fail(422, 'invalid_field', 'Metin kullanım koşulu geçersiz.', ['contentTerms' => 'Geçersiz.']);
    }
    $it = (string)($in['imageTerms'] ?? ($existing['imageTerms'] ?? 'yok'));
    if (!isset(vh_image_terms()[$it])) {
        vg_fail(422, 'invalid_field', 'Görsel kullanım koşulu geçersiz.', ['imageTerms' => 'Geçersiz.']);
    }
    $tc = (string)($in['termsCheckedAt'] ?? ($existing['termsCheckedAt'] ?? ''));
    if ($tc !== '' && (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $tc, $m) !== 1 || !checkdate((int)$m[2], (int)$m[3], (int)$m[1]) || $tc > gmdate('Y-m-d', vg_now() + 86400))) {
        vg_fail(422, 'invalid_field', 'Koşul kontrol tarihi YYYY-AA-GG ve bugün ya da öncesi olmalı.', ['termsCheckedAt' => 'YYYY-AA-GG']);
    }
    $enabled = array_key_exists('enabled', $in) ? $in['enabled'] === true : !empty($existing['enabled']);
    if ($enabled && in_array($perm, ['izin-gerekli', 'reddedildi'], true)) {
        vg_fail(422, 'permission_required', 'İzin durumu "izin gerekli" veya "reddedildi" olan kaynak etkinleştirilemez. Önce yazılı izni kaydedin.', ['enabled' => 'İzin gerekli.']);
    }
    if ($enabled && $format === 'none') {
        vg_fail(422, 'invalid_field', 'Başvuru kaynağı (none) taranmaz, etkinleştirilemez.', ['enabled' => 'Taranmaz.']);
    }
    if ($enabled && ($ct === 'kullanilamaz' || !vh_terms_fresh(['termsCheckedAt' => $tc]))) {
        vg_fail(422, 'terms_check_required', 'Kaynağı etkinleştirmeden önce kullanım koşullarını kontrol edip tarihini girin (en fazla 1 yıl önce).', ['termsCheckedAt' => 'Kontrol tarihi gerekli.']);
    }
    return [
        'id' => $id,
        'name' => vh_line($in['name'] ?? ($existing['name'] ?? ''), 'name', 'Kaynak adı', 2, 120),
        'homepage' => $home,
        'feedUrl' => $feed,
        'format' => $format,
        'category' => $cat,
        'permission' => $perm,
        'termsUrl' => $terms,
        'fallbackLink' => $fallback,
        'licenseNote' => vh_line($in['licenseNote'] ?? ($existing['licenseNote'] ?? ''), 'licenseNote', 'Kullanım notu', 0, 300, false),
        'notes' => vh_multiline($in['notes'] ?? ($existing['notes'] ?? ''), 'notes', 'Notlar', 2000),
        'enabled' => $enabled,
        'contentTerms' => $ct,
        'imageTerms' => $it,
        'termsCheckedAt' => $tc,
    ];
}

/* ------------------------------------------------------------------ SSRF korumasi */

/** Ozel, yerel, link-local, CGNAT, coklu yayin ve ayrilmis adresler engellenir. */
function vh_ip_blocked(string $ip): bool
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

/** Adi cozer; tum adresler herkese acik olmali. Dondurur: kullanilacak IP. Hata metni $why'a yazilir. */
function vh_resolve_public(string $host, string &$why): string
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
        if (vh_ip_blocked($ip)) {
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

/** URL tarama icin uygun mu? Dondurur: [host, ip, path] veya hata. */
function vh_check_fetch_url(string $url, string &$why, array $allowHosts = []): array
{
    $why = '';
    $p = strlen($url) <= 600 && preg_match('/[\x00-\x20\x7F<>"\'`\\\\]/', $url) !== 1 ? parse_url($url) : false;
    if (!is_array($p) || strtolower((string)($p['scheme'] ?? '')) !== 'https' || empty($p['host'])) {
        $why = 'scheme_not_allowed';
        return [];
    }
    if (isset($p['user']) || isset($p['pass']) || (isset($p['port']) && (int)$p['port'] !== 443)) {
        $why = 'url_not_allowed';
        return [];
    }
    $host = strtolower(trim((string)$p['host'], '[]'));
    // Izinli liste: kaynagin kendi alan adlari disina (yonlendirmeyle bile) cikilmaz. Ad cozulmeden once denetlenir.
    if ($allowHosts && !in_array((string)preg_replace('/^www\./', '', $host), $allowHosts, true)) {
        $why = 'host_not_allowed';
        return [];
    }
    if ($host === 'localhost' || substr($host, -6) === '.local' || substr($host, -10) === '.localhost' || substr($host, -9) === '.internal') {
        $why = 'blocked_address';
        return [];
    }
    $ip = vh_resolve_public($host, $why);
    if ($ip === '') {
        return [];
    }
    $path = ($p['path'] ?? '/') . (isset($p['query']) ? '?' . $p['query'] : '');
    return [$host, $ip, $path === '' ? '/' : $path];
}

/* ------------------------------------------------------------------ HTTP */

/**
 * Tek GET istegi, cozulmus IP'ye sabitlenmis. Dondurur: ['status'=>int,'location'=>string,'body'=>string] veya hata.
 */
function vh_http_once(string $host, string $ip, string $path, string &$why): array
{
    $accept = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8';
    if (function_exists('curl_init')) {
        $buf = '';
        $status = 0;
        $location = '';
        $tooBig = false;
        $ch = curl_init('https://' . $host . $path);
        $pin = strpos($ip, ':') !== false ? '[' . $ip . ']' : $ip;
        curl_setopt_array($ch, [
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_TIMEOUT => VH_FETCH_TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => 6,
            CURLOPT_USERAGENT => VH_FETCH_UA,
            CURLOPT_RESOLVE => [$host . ':443:' . $pin],
            CURLOPT_HTTPHEADER => ['Accept: ' . $accept],
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_ENCODING => '',
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
                if (strlen($buf) + strlen($chunk) > VH_FETCH_MAX_BYTES) {
                    $tooBig = true;
                    return -1;
                }
                $buf .= $chunk;
                return strlen($chunk);
            },
        ]);
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
    // curl yoksa: PHP akis sarmalayicisi, IP'ye baglanip SNI/sertifika adi olarak gercek ad kullanilir.
    $ctx = stream_context_create([
        'http' => ['method' => 'GET', 'timeout' => VH_FETCH_TIMEOUT, 'follow_location' => 0, 'max_redirects' => 0,
            'ignore_errors' => true, 'protocol_version' => 1.0,
            'header' => "Host: " . $host . "\r\nUser-Agent: " . VH_FETCH_UA . "\r\nAccept: " . $accept . "\r\nConnection: close\r\n"],
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
        if (strlen($buf) > VH_FETCH_MAX_BYTES) {
            fclose($fp);
            $why = 'too_large';
            return [];
        }
    }
    $meta = stream_get_meta_data($fp);
    fclose($fp);
    $status = 0;
    $location = '';
    foreach ((array)($meta['wrapper_data'] ?? []) as $line) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', (string)$line, $m) === 1) {
            $status = (int)$m[1];
        } elseif (stripos((string)$line, 'location:') === 0) {
            $location = trim(substr((string)$line, 9));
        }
    }
    return ['status' => $status, 'location' => $location, 'body' => $buf];
}

/** Yonlendirmeleri (en fazla 3) her adimda yeniden denetleyerek getirir. */
function vh_http_get(string $url, string &$why, int &$status, array $allowHosts = []): string
{
    $status = 0;
    for ($hop = 0; $hop < 4; $hop++) {
        $target = vh_check_fetch_url($url, $why, $allowHosts);
        if (!$target) {
            return '';
        }
        $res = vh_http_once($target[0], $target[1], $target[2], $why);
        if (!$res) {
            return '';
        }
        $status = $res['status'];
        if ($status >= 300 && $status < 400 && $res['location'] !== '') {
            $loc = $res['location'];
            if (strpos($loc, '//') === 0) {
                $loc = 'https:' . $loc;
            } elseif (strpos($loc, '/') === 0) {
                $loc = 'https://' . $target[0] . $loc;
            }
            $url = $loc;
            continue;
        }
        if ($status !== 200) {
            $why = 'http_' . $status;
            return '';
        }
        return $res['body'];
    }
    $why = 'too_many_redirects';
    return '';
}

/* ------------------------------------------------------------------ ayrıştırma */

function vh_clean_title(string $raw): string
{
    $t = html_entity_decode(strip_tags($raw), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $t = html_entity_decode($t, ENT_QUOTES | ENT_HTML5, 'UTF-8'); // cift kacislanmis akislar
    if (preg_match('//u', $t) !== 1) {
        return '';
    }
    $t = (string)preg_replace('/[\x00-\x1F\x7F\x{202A}-\x{202E}\x{2066}-\x{2069}]+/u', ' ', $t);
    $t = trim((string)preg_replace('/\s+/u', ' ', $t));
    return vg_strlen($t) > VH_TITLE_MAX ? rtrim(vg_substr($t, VH_TITLE_MAX - 1)) . '…' : $t;
}

function vh_parse_date(string $raw): ?int
{
    $raw = trim($raw);
    if ($raw === '') {
        return null;
    }
    // enerji.gov.tr: "10/23/2026 12:00:00 AM"
    if (preg_match('#^(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?$#i', $raw, $m) === 1) {
        $h = isset($m[4]) && $m[4] !== '' ? (int)$m[4] % 12 : 0;
        if (isset($m[7]) && strtoupper($m[7]) === 'PM') {
            $h += 12;
        }
        try {
            $d = new DateTime(sprintf('%04d-%02d-%02d %02d:%02d:%02d', (int)$m[3], (int)$m[1], (int)$m[2], $h, (int)($m[5] ?? 0), (int)($m[6] ?? 0)), new DateTimeZone('Europe/Istanbul'));
            return $d->getTimestamp();
        } catch (Throwable $e) {
            return null;
        }
    }
    $ts = strtotime($raw);
    return $ts === false ? null : $ts;
}

function vh_child_text(DOMElement $el, array $names): string
{
    foreach ($el->childNodes as $c) {
        if ($c instanceof DOMElement && in_array(strtolower($c->localName), $names, true)) {
            return (string)$c->textContent;
        }
    }
    return '';
}

/**
 * Akisi ayristirir. Dondurur: [['title','link','publishedAt'(int|null)]...]. Hata: $why.
 * Yalnizca baslik, baglanti ve tarih okunur; aciklama/icerik/gorsel alanlari BILEREK okunmaz.
 */
function vh_parse_feed(string $xml, string &$why): array
{
    $why = '';
    if ($xml === '' || stripos($xml, '<!DOCTYPE') !== false || stripos($xml, '<!ENTITY') !== false) {
        $why = 'xml_rejected';
        return [];
    }
    if (PHP_VERSION_ID < 80000 && function_exists('libxml_disable_entity_loader')) {
        @libxml_disable_entity_loader(true);
    }
    $prev = libxml_use_internal_errors(true);
    $doc = new DOMDocument();
    $ok = $doc->loadXML($xml, LIBXML_NONET | LIBXML_NOCDATA | LIBXML_COMPACT);
    libxml_clear_errors();
    libxml_use_internal_errors($prev);
    if (!$ok || !$doc->documentElement) {
        $why = 'xml_invalid';
        return [];
    }
    $root = strtolower($doc->documentElement->localName);
    $out = [];
    if ($root === 'feed') {
        foreach ($doc->getElementsByTagNameNS('*', 'entry') as $e) {
            $link = '';
            foreach ($e->childNodes as $c) {
                if ($c instanceof DOMElement && $c->localName === 'link') {
                    $rel = $c->getAttribute('rel');
                    if ($rel === '' || $rel === 'alternate') {
                        $link = $c->getAttribute('href');
                        break;
                    }
                }
            }
            $out[] = ['title' => vh_clean_title(vh_child_text($e, ['title'])), 'link' => trim($link),
                'publishedAt' => vh_parse_date(vh_child_text($e, ['published', 'updated']))];
            if (count($out) >= 200) {
                break;
            }
        }
    } elseif ($root === 'rss' || $root === 'rdf') {
        foreach ($doc->getElementsByTagNameNS('*', 'item') as $e) {
            $link = trim(vh_child_text($e, ['link']));
            if ($link === '') {
                foreach ($e->childNodes as $c) {
                    if ($c instanceof DOMElement && $c->localName === 'guid' && strtolower($c->getAttribute('isPermaLink')) !== 'false') {
                        $link = trim((string)$c->textContent);
                    }
                }
            }
            $out[] = ['title' => vh_clean_title(vh_child_text($e, ['title'])), 'link' => $link,
                'publishedAt' => vh_parse_date(vh_child_text($e, ['pubdate', 'date', 'publishstartdate', 'published']))];
            if (count($out) >= 200) {
                break;
            }
        }
        // Ad alani olmayan RSS'te getElementsByTagNameNS('*') de calisir; yine de bos ise duz ada bak.
        if (!$out) {
            foreach ($doc->getElementsByTagName('item') as $e) {
                $out[] = ['title' => vh_clean_title(vh_child_text($e, ['title'])), 'link' => trim(vh_child_text($e, ['link'])),
                    'publishedAt' => vh_parse_date(vh_child_text($e, ['pubdate', 'publishstartdate']))];
            }
        }
    } else {
        $why = 'not_a_feed';
        return [];
    }
    $clean = [];
    foreach ($out as $i) {
        if (vg_strlen($i['title']) < 5) {
            continue;
        }
        // Yalnizca https baglantilar saklanir; http veya bozuk adres bos kalir (editor tamamlar).
        $i['link'] = vh_https_url($i['link']);
        $clean[] = $i;
    }
    usort($clean, function ($a, $b) {
        return (int)($b['publishedAt'] ?? 0) <=> (int)($a['publishedAt'] ?? 0);
    });
    return array_slice($clean, 0, VH_FETCH_MAX_ITEMS);
}

/** Basliktan kategori tahmini (editor degistirebilir). */
function vh_guess_category(string $title, string $default): string
{
    $t = vh_fold_words($title);
    $rules = [
        'mevzuat' => '/\b(yonetmelik|resmi gazete|kurul karari|teblig|kanun|usul ve esas|mevzuat|regulation|directive)\b/',
        'e-mobilite' => '/\b(sarj|elektrikli arac|e mobilite|charging|electric vehicle)\b/',
        'yenilenebilir' => '/\b(gunes|ges|ruzgar|res|yenilenebilir|yeka|depolama|solar|wind|renewable|storage|hidrojen|hydrogen)\b/',
        'kompanzasyon' => '/\b(reaktif|kompanzasyon|verimlilik|efficiency)\b/',
        'tesisat-guvenlik' => '/\b(is guvenligi|periyodik kontrol|topraklama|yangin|kaza)\b/',
        'enerji-piyasasi' => '/\b(piyasa|fiyat|ptf|tarife|serbest tuketici|market|price|gaz|petrol|oil)\b/',
    ];
    foreach ($rules as $cat => $re) {
        if (preg_match($re, $t) === 1) {
            return $cat;
        }
    }
    return isset(vh_categories()[$default]) ? $default : 'enerji-piyasasi';
}

/* ------------------------------------------------------------------ tarama */

/** Test/gelistirme: VG_VOLTHABER_TEST_FEEDS klasoru verilirse ag kullanilmaz, <kaynak-id>.xml okunur. */
function vh_test_feed_dir(): string
{
    $d = getenv('VG_VOLTHABER_TEST_FEEDS');
    return is_string($d) && $d !== '' && is_dir($d) ? rtrim($d, '/\\') : '';
}

function vh_fetch_body(array $source, string &$why, int &$status): string
{
    $test = vh_test_feed_dir();
    if ($test !== '') {
        // <kaynak>.error: ag hatasi benzetimi (ör. "network_error_28" = zaman asimi, "http_503").
        $err = $test . '/' . $source['id'] . '.error';
        if (is_file($err)) {
            $why = trim((string)file_get_contents($err, false, null, 0, 64));
            $status = preg_match('/^http_(\d{3})$/', $why, $m) === 1 ? (int)$m[1] : 0;
            return '';
        }
        $file = $test . '/' . $source['id'] . '.xml';
        $status = is_file($file) ? 200 : 404;
        if (!is_file($file)) {
            $why = 'fixture_missing';
            return '';
        }
        $raw = (string)file_get_contents($file, false, null, 0, VH_FETCH_MAX_BYTES + 1);
        if (strlen($raw) > VH_FETCH_MAX_BYTES) {
            $why = 'too_large';
            return '';
        }
        return $raw;
    }
    return vh_http_get($source['feedUrl'], $why, $status, vh_source_hosts($source));
}

/**
 * Etkin kaynaklari tarar. $opts: sourceId (tek kaynak), force (editor; 5 dk), trigger ('cron'|'editor'), budget (sn).
 * Ag istekleri kilit DISINDA yapilir; sonuclar tek ozel kilitte birlestirilir.
 */
function vh_run_fetch(array $opts): array
{
    $now = vg_now();
    $only = (string)($opts['sourceId'] ?? '');
    $interval = !empty($opts['force']) ? VH_FETCH_FORCE_INTERVAL : VH_FETCH_MIN_INTERVAL;
    $budget = (float)($opts['budget'] ?? 25);
    $trigger = (string)($opts['trigger'] ?? 'cron');
    $plan = vh_locked(false, function (string $dir) use ($only) {
        return vh_sources($dir);
    });
    $results = [];
    $start = microtime(true);
    foreach ($plan['sources'] as $src) {
        if ($only !== '' && $src['id'] !== $only) {
            continue;
        }
        if ($only === '' && empty($src['enabled'])) {
            continue;
        }
        if (($src['format'] ?? '') === 'none') {
            $results[] = ['sourceId' => $src['id'], 'name' => $src['name'], 'ok' => false, 'error' => 'not_fetchable', 'items' => 0, 'added' => 0, 'httpStatus' => 0, 'ms' => 0];
            continue;
        }
        if (in_array($src['permission'] ?? '', ['izin-gerekli', 'reddedildi'], true)) {
            $results[] = ['sourceId' => $src['id'], 'name' => $src['name'], 'ok' => false, 'error' => 'permission_required', 'items' => 0, 'added' => 0, 'httpStatus' => 0, 'ms' => 0];
            continue;
        }
        if (($src['contentTerms'] ?? '') === 'kullanilamaz' || !vh_terms_fresh($src)) {
            $results[] = ['sourceId' => $src['id'], 'name' => $src['name'], 'ok' => false, 'error' => 'terms_check_required', 'items' => 0, 'added' => 0, 'httpStatus' => 0, 'ms' => 0];
            continue;
        }
        $last = (int)($plan['runtime'][$src['id']]['lastFetchAt'] ?? 0);
        if ($now - $last < $interval) {
            $results[] = ['sourceId' => $src['id'], 'name' => $src['name'], 'ok' => false, 'error' => 'rate_limited', 'items' => 0, 'added' => 0, 'httpStatus' => 0, 'ms' => 0, 'retryAfter' => $interval - ($now - $last)];
            continue;
        }
        if (microtime(true) - $start > $budget) {
            $results[] = ['sourceId' => $src['id'], 'name' => $src['name'], 'ok' => false, 'error' => 'time_budget', 'items' => 0, 'added' => 0, 'httpStatus' => 0, 'ms' => 0];
            continue;
        }
        $t0 = microtime(true);
        $why = '';
        $status = 0;
        $body = vh_fetch_body($src, $why, $status);
        $items = $body !== '' ? vh_parse_feed($body, $why) : [];
        $results[] = ['sourceId' => $src['id'], 'name' => $src['name'], 'ok' => $why === '', 'error' => $why, 'items' => count($items),
            'added' => 0, 'httpStatus' => $status, 'ms' => (int)round((microtime(true) - $t0) * 1000), '_items' => $items, '_src' => $src, 'fetched' => true];
    }
    // Sonuclari birlestir.
    return vh_locked(true, function (string $dir) use ($results, $now, $trigger) {
        $sources = vh_sources($dir);
        $state = vh_articles($dir);
        $published = vh_materialize_schedule($state, $now);
        $changed = $published > 0;
        $out = [];
        foreach ($results as $r) {
            if (!empty($r['fetched'])) {
                $rt = $sources['runtime'][$r['sourceId']] ?? [];
                $rt['lastFetchAt'] = $now;
                $rt['lastStatus'] = $r['ok'] ? 'ok' : $r['error'];
                $seen = is_array($rt['seen'] ?? null) ? $rt['seen'] : [];
                if ($r['ok']) {
                    $rt['lastOkAt'] = $now;
                    foreach ($r['_items'] as $item) {
                        $key = $item['link'] !== '' ? 'u:' . vh_url_key($item['link']) : 't:' . substr(sha1(vh_fold_words($item['title'])), 0, 20);
                        if (in_array($key, $seen, true)) {
                            continue;
                        }
                        $seen[] = $key;
                        if ($item['publishedAt'] !== null && $item['publishedAt'] < $now - VH_FETCH_MAX_AGE) {
                            continue;
                        }
                        if (vh_ingest_exists($state, $item)) {
                            continue;
                        }
                        vh_add_ingest_draft($state, $r['_src'], $item, $now);
                        $r['added']++;
                        $changed = true;
                    }
                    $rt['seen'] = array_slice($seen, -600);
                }
                $sources['runtime'][$r['sourceId']] = $rt;
                vh_log($dir, 'fetchlog.json', ['at' => $now, 'sourceId' => $r['sourceId'], 'name' => $r['name'], 'ok' => $r['ok'],
                    'error' => $r['error'], 'httpStatus' => $r['httpStatus'], 'items' => $r['items'], 'added' => $r['added'], 'ms' => $r['ms'], 'trigger' => $trigger], 300);
            }
            unset($r['_items'], $r['_src'], $r['fetched']);
            $out[] = $r;
        }
        if ($changed) {
            vh_prune_inbox($state);
            vh_save_articles($dir, $state);
        }
        // Zamanlayici kalp atisi: panel ve durum bilgisi zamanlanmis taramanin gercekten calisip calismadigini buradan okur.
        $sched = is_array($sources['scheduler'] ?? null) ? $sources['scheduler'] : [];
        $sched['lastRunAt'] = $now;
        $sched['lastTrigger'] = $trigger;
        if ($trigger === 'cron') {
            $sched['lastCronAt'] = $now;
        }
        $sources['scheduler'] = $sched;
        vh_write($dir, 'sources.json', $sources, 4194304);
        return ['results' => $out, 'scheduledPublished' => $published];
    });
}

function vh_ingest_exists(array $state, array $item): bool
{
    $key = $item['link'] !== '' ? vh_url_key($item['link']) : '';
    foreach ($state['articles'] as $a) {
        if ($key !== '' && $a['source'] && $a['source']['url'] !== '' && vh_url_key($a['source']['url']) === $key) {
            return true;
        }
        if ($key === '' && vh_titles_similar($a['title'], $item['title'])) {
            return true;
        }
    }
    return false;
}

function vh_add_ingest_draft(array &$state, array $src, array $item, int $now): void
{
    $id = 'a' . bin2hex(random_bytes(8));
    $title = $item['title'];
    if (vg_strlen($title) < VH_TITLE_MIN) {
        $title = $title . ' – ' . $src['name'];
    }
    $slug = vh_slugify($title);
    if (strlen($slug) < 3) {
        $slug = 'haber';
    }
    $base = $slug;
    $n = 2;
    while (vh_find_slug($state, $slug) !== null || in_array($slug, VH_RESERVED_SLUGS, true)) {
        $slug = substr($base, 0, 84) . '-' . $n++;
    }
    $link = $item['link'] !== '' ? $item['link'] : (string)($src['fallbackLink'] ?? '');
    $state['articles'][$id] = vh_normalize_article([
        'id' => $id, 'slug' => $slug, 'title' => vg_substr($title, VH_TITLE_MAX), 'summary' => '', 'summaryBy' => null, 'body' => '', 'bodyHtml' => '',
        'category' => vh_guess_category($item['title'], (string)$src['category']), 'tags' => [], 'type' => 'kaynak',
        'source' => ['name' => $src['name'], 'url' => $link,
            'publishedAt' => $item['publishedAt'] !== null ? gmdate('Y-m-d', $item['publishedAt']) : '', 'licenseNote' => (string)($src['licenseNote'] ?? '')],
        'image' => null, 'status' => 'draft', 'publishAt' => null, 'publishedAt' => null,
        'author' => ['id' => null, 'name' => 'Kaynak tarayıcı'], 'editor' => null, 'seo' => [], 'related' => [],
        'origin' => 'ingest', 'ingest' => ['sourceId' => $src['id'], 'fetchedAt' => $now, 'originalTitle' => $item['title'], 'linkMissing' => $item['link'] === ''],
        'flags' => $item['link'] === '' ? ['link_missing'] : [], 'createdAt' => $now, 'updatedAt' => $now,
    ]);
}

/** Gelen kutusu siniri: dokunulmamis en eski otomatik taslaklar silinir (60 gun veya 500 ustu). */
function vh_prune_inbox(array &$state): void
{
    $now = vg_now();
    $untouched = [];
    foreach ($state['articles'] as $id => $a) {
        if ($a['origin'] === 'ingest' && $a['status'] === 'draft' && $a['updatedAt'] === $a['createdAt']) {
            if ($a['createdAt'] < $now - 5184000) {
                unset($state['articles'][$id]);
                continue;
            }
            $untouched[$id] = $a['createdAt'];
        }
    }
    asort($untouched);
    $excess = count($untouched) - VH_MAX_INGEST_DRAFTS;
    foreach (array_keys($untouched) as $id) {
        if ($excess-- <= 0) {
            break;
        }
        unset($state['articles'][$id]);
    }
}

/* ------------------------------------------------------------------ guncellik ve zamanlayici durumu */

/** Zamanlanmis tarama gercekten calisiyor mu? Yalnizca kayitli calismalara dayanir; tahmin yapilmaz. */
function vh_scheduler_status(array $sourcesState): array
{
    $s = is_array($sourcesState['scheduler'] ?? null) ? $sourcesState['scheduler'] : [];
    $cron = (int)($s['lastCronAt'] ?? 0);
    $healthy = $cron > 0 && vg_now() - $cron <= 2 * 3600;
    return [
        'lastCronAt' => $cron ? vg_iso($cron) : null,
        'lastRunAt' => isset($s['lastRunAt']) ? vg_iso((int)$s['lastRunAt']) : null,
        'healthy' => $healthy,
        'message' => $cron === 0 ? 'Zamanlanmış tarama hiç çalışmamış: sunucuda cron görevi kurulu değil veya çalışmıyor. Tarama yalnızca "Şimdi tara" ile yapılır.'
            : ($healthy ? 'Zamanlanmış tarama çalışıyor.' : 'Zamanlanmış tarama 2 saatten uzun süredir çalışmadı; cron görevini kontrol edin.'),
    ];
}

/**
 * Okura gosterilen guncellik bilgisi. Kaynak kesilse de son dogrulanmis icerik gosterilir ve hicbir tarih yeni veri
 * gelmis gibi degistirilmez. lastVerifiedAt: yayindaki iceriklerdeki en son yayin onayi.
 */
function vh_freshness(array $live): array
{
    $verified = 0;
    foreach ($live as $a) {
        $c = $a['review']['checks']['approval'] ?? null;
        if ($c && $c['at'] > $verified) {
            $verified = (int)$c['at'];
        }
    }
    $state = vh_locked(false, function (string $dir) {
        return vh_sources($dir);
    });
    $sources = [];
    $degraded = false;
    foreach ($state['sources'] as $src) {
        if (empty($src['enabled'])) {
            continue;
        }
        $rt = $state['runtime'][$src['id']] ?? [];
        $tried = isset($rt['lastFetchAt']);
        $okNow = ($rt['lastStatus'] ?? '') === 'ok';
        $degraded = $degraded || ($tried && !$okNow);
        $sources[] = ['name' => $src['name'], 'reachable' => $tried ? $okNow : null,
            'lastOkAt' => isset($rt['lastOkAt']) ? vg_iso((int)$rt['lastOkAt']) : null,
            'lastCheckedAt' => $tried ? vg_iso((int)$rt['lastFetchAt']) : null];
    }
    return ['lastVerifiedAt' => $verified ? vg_iso($verified) : null, 'degraded' => $degraded, 'sources' => $sources,
        'scheduler' => ['healthy' => vh_scheduler_status($state)['healthy']]];
}

<?php
/*
 * VoltGuard birinci taraf (first-party) ölçüm: çerezsiz ve anonim günlük toplamlar.
 *
 * - Ziyaretçiye çerez yazılmaz, oturum açılmaz, istemcide kimlik tutulmaz.
 * - IP adresi ve tarayıcı kimliği (User-Agent) hiçbir yere yazılmaz. IP yalnızca bellekte, hız sınırı için
 *   günlük değişen bir tuzla (salt) HMAC'lenir. Tuz diske yazılmaz: kurulum anahtarı + tarihten bellekte türetilir;
 *   özetlenmiş sayaç anahtarları en geç ertesi gün silinir.
 * - Saklanan tek şey günlük toplamlardır: metrics/days/YYYY-MM-DD.json (sayfa yolu, kaynak kategorisi, cihaz sınıfı,
 *   olay adı başına sayaç). Tek bir ziyaretçiye bağlanabilecek hiçbir satır yoktur.
 * - DNT / Sec-GPC başlığı gelen istekler sayılmaz (istemci de bu durumda hiç istek göndermez).
 * - Yönetici paneli verisi yalnızca tools/metrics-admin.php ile yetkilendirilmiş üye hesaplarına verilir.
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

const VG_METRICS_SERVICE = 'vg-metrics/1';
const VG_METRICS_MAX_BODY = 4096;
const VG_METRICS_MAX_EVENTS = 20;
const VG_METRICS_KEEP_DAYS = 400;
const VG_METRICS_DAY_BYTES = 1048576;
/* Hız sınırı (hashlenmiş IP başına): 10 dakikada 120 olay, günde 1500 olay. */
const VG_METRICS_RL_WINDOW = 600;
const VG_METRICS_RL_WINDOW_MAX = 120;
const VG_METRICS_RL_DAY_MAX = 1500;
const VG_METRICS_RL_KEYS = 100000;
const VG_METRICS_EVENTS = ['pageview', 'sim_start', 'sim_complete', 'tool_use', 'tool_quote', 'quote_submit',
    'whatsapp_click', 'tel_click', 'newsletter_subscribe'];
const VG_METRICS_REF = ['ic', 'dogrudan', 'arama', 'sosyal', 'diger'];
const VG_METRICS_SE = ['google', 'bing', 'yandex', 'duckduckgo', 'yahoo', 'ecosia', 'baidu', 'diger'];
const VG_METRICS_DEV = ['mobil', 'tablet', 'masaustu'];
const VG_METRICS_VIA = ['arac', 'form'];
const VG_METRICS_OTHER = '(diğer)';
const VG_METRICS_UNKNOWN_PATH = '(bilinmeyen sayfa)';
/* Boyut başına en fazla farklı anahtar (gün dosyası sınırsız büyümesin; fazlası "(diğer)" altında toplanır). */
const VG_METRICS_CAPS = ['pages' => 600, 'vh' => 300, 'sim_start' => 80, 'sim_complete' => 80, 'tool' => 200,
    'quote' => 60, 'quote_via' => 4, 'ref' => 8, 'se' => 10, 'dev' => 4, 'sec' => 20, 'ev' => 20, 'tool_quote' => 200];

function vg_metrics_tz(): DateTimeZone
{
    static $tz = null;
    return $tz ?: ($tz = new DateTimeZone('Europe/Istanbul'));
}

/** Türkiye saatine göre gün (YYYY-MM-DD); $offset gün geri/ileri. Testler VG_METRICS_TODAY ile günü sabitleyebilir. */
function vg_metrics_day(int $offset = 0): string
{
    $fixed = getenv('VG_METRICS_TODAY');
    $base = is_string($fixed) && preg_match('/^\d{4}-\d{2}-\d{2}$/D', $fixed) === 1
        ? new DateTimeImmutable($fixed . ' 12:00:00', vg_metrics_tz())
        : new DateTimeImmutable('now', vg_metrics_tz());
    if ($offset !== 0) {
        $base = $base->modify(($offset > 0 ? '+' : '') . $offset . ' day');
    }
    return $base->format('Y-m-d');
}

function vg_metrics_dir(): string
{
    $base = vg_private_data_directory(vg_data_dir());
    $dir = vg_private_data_directory($base . '/metrics', $base);
    vg_protect_dir($dir);
    return $dir;
}

function vg_metrics_subdir(string $name): string
{
    $dir = vg_metrics_dir();
    return vg_private_data_directory($dir . '/' . $name, $dir);
}

/** Tüm ölçüm dosyaları tek kilit altında okunup yazılır (yarış durumunda sayaç kaybı olmaz). */
function vg_metrics_locked(callable $work)
{
    $file = vg_metrics_dir() . '/store.lock';
    $fp = @fopen($file, 'c+');
    if ($fp === false) {
        vg_unavailable('metrics lock cannot be opened');
    }
    @chmod($file, 0600);
    $deadline = microtime(true) + 3;
    do {
        $locked = flock($fp, LOCK_EX | LOCK_NB);
        if (!$locked) {
            usleep(15000);
        }
    } while (!$locked && microtime(true) < $deadline);
    if (!$locked) {
        fclose($fp);
        vg_unavailable('metrics lock timed out');
    }
    try {
        return $work();
    } finally {
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}

function vg_metrics_read_json(string $file, array $empty, int $max = VG_METRICS_DAY_BYTES): array
{
    if (!is_file($file)) {
        return $empty;
    }
    $raw = @file_get_contents($file, false, null, 0, $max + 1);
    if (!is_string($raw) || strlen($raw) > $max) {
        return $empty;
    }
    $data = json_decode($raw, true, 16);
    return is_array($data) ? $data : $empty;
}

/** Atomik yazım: geçici dosya + rename; canlı dosya hiçbir zaman yarım kalmaz. */
function vg_metrics_write_json(string $file, array $data): void
{
    $json = vg_json_encode($data);
    $tmp = $file . '.' . bin2hex(random_bytes(6)) . '.tmp';
    if (@file_put_contents($tmp, $json, LOCK_EX) !== strlen($json)) {
        @unlink($tmp);
        vg_unavailable('metrics write failed');
    }
    @chmod($tmp, 0600);
    if (!@rename($tmp, $file)) {
        @unlink($tmp);
        vg_unavailable('metrics atomic replacement failed');
    }
}

/* ------------------------------------------------------------------ doğrulama */

/** Basit bot / otomasyon sezgisi (User-Agent yalnızca bellekte incelenir, saklanmaz). */
function vg_metrics_is_bot(string $ua): bool
{
    if (strlen($ua) < 12 || strlen($ua) > 1000) {
        return true;
    }
    return preg_match('~bot\b|bot/|crawl|spider|slurp|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed'
        . '|gtmetrix|pingdom|uptime|monitor|curl/|wget|python|httpclient|http_request|java/|go-http|axios|node-fetch|undici|okhttp'
        . '|scrapy|facebookexternalhit|whatsapp/|telegrambot|preview|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|gptbot'
        . '|claudebot|ccbot|yandexbot|bingpreview|feedfetcher|validator|checker|scan~i', $ua) === 1;
}

/** Tarayıcı gizlilik sinyali: DNT: 1 veya Sec-GPC: 1 ise hiçbir şey sayılmaz. */
function vg_metrics_opted_out(): bool
{
    return trim((string)($_SERVER['HTTP_DNT'] ?? '')) === '1' || trim((string)($_SERVER['HTTP_SEC_GPC'] ?? '')) === '1';
}

function vg_metrics_slug($value, int $max = 60): string
{
    return is_string($value) && preg_match('/^[a-z0-9][a-z0-9-]{0,' . ($max - 1) . '}$/D', $value) === 1 ? $value : '';
}

function vg_metrics_pick($value, array $allowed): string
{
    return is_string($value) && in_array($value, $allowed, true) ? $value : '';
}

/**
 * Sayfa yolunu normalize eder ve gerçekten var olan bir sayfaya karşılık geliyorsa döndürür. Böylece rastgele yollarla
 * gün dosyası şişirilemez. Hesap sayfaları tek "/hesap/" kaydında toplanır; /calisan/ ve /api/ hiç sayılmaz (null).
 */
function vg_metrics_path($raw): ?string
{
    if (!is_string($raw) || $raw === '' || strlen($raw) > 160 || $raw[0] !== '/') {
        return VG_METRICS_UNKNOWN_PATH;
    }
    $path = strtolower($raw);
    if (preg_match('~^/(calisan|api)(/|$)~', $path) === 1) {
        return null;
    }
    if (preg_match('~^/hesap(/|$)~', $path) === 1) {
        return '/hesap/';
    }
    if (preg_match('~^/[a-z0-9/._-]*$~D', $path) !== 1 || strpos($path, '..') !== false || strpos($path, '//') !== false) {
        return VG_METRICS_UNKNOWN_PATH;
    }
    $path = (string)preg_replace('~/index\.html$~', '/', $path);
    if (preg_match('~^/hesaplama/([a-z0-9-]+)\.html$~', $path, $m) === 1) {
        $path = '/hesaplama/' . $m[1] . '/';
    }
    return vg_metrics_page_exists($path) ? $path : VG_METRICS_UNKNOWN_PATH;
}

function vg_metrics_page_exists(string $path): bool
{
    static $seen = [];
    if (isset($seen[$path])) {
        return $seen[$path];
    }
    $root = vg_doc_root();
    $rel = ltrim($path, '/');
    $rewrites = ['hesaplama-araclari/' => 'teklif-araclari.html'];
    $candidates = [];
    if ($rel === '') {
        $candidates[] = 'index.html';
    } elseif (isset($rewrites[$rel])) {
        $candidates[] = $rewrites[$rel];
    } elseif (substr($rel, -1) === '/') {
        $candidates[] = substr($rel, 0, -1) . '.html';
        $candidates[] = $rel . 'index.html';
    } elseif (preg_match('/\.html$/', $rel) === 1) {
        $candidates[] = $rel;
    } else {
        $candidates[] = $rel . '.html';
        $candidates[] = $rel . '/index.html';
    }
    foreach ($candidates as $candidate) {
        if (is_file($root . '/' . $candidate)) {
            return $seen[$path] = true;
        }
    }
    return $seen[$path] = false;
}

/** Sayfa yolundan site bölümü. */
function vg_metrics_section(string $path): string
{
    $map = [
        '~^/$~' => 'ana-sayfa', '~^/hizmetler/~' => 'hizmetler', '~^/hesaplama(-araclari)?/~' => 'hesap-araclari',
        '~^/araclar/~' => 'muhendislik-uygulamalari', '~^/voltsim/~' => 'voltsim', '~^/volthaber/~' => 'volthaber',
        '~^/bilgi/|^/bilgi-bankasi~' => 'bilgi-bankasi', '~^/akademi~' => 'akademi', '~^/sor(/|\.html)~' => 'voltguarda-sor',
        '~^/mm/|^/muhendis-merkezi~' => 'muhendis-merkezi', '~^/fabrika-cozumleri~' => 'fabrika-cozumleri', '~^/hesap/~' => 'hesap',
    ];
    foreach ($map as $re => $name) {
        if (preg_match($re, $path) === 1) {
            return $name;
        }
    }
    return 'diger';
}

/**
 * İstemci olayını doğrulayıp yalnızca izin verilen alanlarla döndürür; geçersizse null.
 * Olay biçimi: {e, p, r?, se?, d?, sim?, tool?, svc?, via?}
 */
function vg_metrics_clean_event($raw): ?array
{
    if (!is_array($raw)) {
        return null;
    }
    $name = vg_metrics_pick($raw['e'] ?? null, VG_METRICS_EVENTS);
    if ($name === '') {
        return null;
    }
    $path = vg_metrics_path($raw['p'] ?? null);
    if ($path === null) {
        return null;
    }
    $event = ['e' => $name, 'p' => $path];
    if ($name === 'pageview') {
        $event['r'] = vg_metrics_pick($raw['r'] ?? null, VG_METRICS_REF) ?: 'diger';
        if ($event['r'] === 'arama') {
            $event['se'] = vg_metrics_pick($raw['se'] ?? null, VG_METRICS_SE) ?: 'diger';
        }
        $event['d'] = vg_metrics_pick($raw['d'] ?? null, VG_METRICS_DEV) ?: 'masaustu';
    } elseif ($name === 'sim_start' || $name === 'sim_complete') {
        $event['sim'] = vg_metrics_slug($raw['sim'] ?? null, 40);
        if ($event['sim'] === '') {
            return null;
        }
    } elseif ($name === 'tool_use' || $name === 'tool_quote') {
        $event['tool'] = vg_metrics_slug($raw['tool'] ?? null, 80);
        if ($event['tool'] === '') {
            return null;
        }
    } elseif ($name === 'quote_submit') {
        $event['svc'] = vg_metrics_slug($raw['svc'] ?? null, 60) ?: 'belirtilmedi';
        $event['via'] = vg_metrics_pick($raw['via'] ?? null, VG_METRICS_VIA) ?: 'form';
    }
    return $event;
}

/* ------------------------------------------------------------------ toplama */

function vg_metrics_empty_day(string $day): array
{
    return ['v' => 1, 'date' => $day, 'pv' => 0, 'entries' => 0, 'bots' => 0, 'limited' => 0,
        'ev' => [], 'pages' => [], 'sec' => [], 'ref' => [], 'se' => [], 'dev' => [], 'sim_start' => [], 'sim_complete' => [],
        'tool' => [], 'tool_quote' => [], 'quote' => [], 'quote_via' => [], 'vh' => []];
}

function vg_metrics_bump(array &$day, string $dim, string $key, int $by = 1): void
{
    if (!isset($day[$dim]) || !is_array($day[$dim])) {
        $day[$dim] = [];
    }
    $cap = VG_METRICS_CAPS[$dim] ?? 50;
    if (!isset($day[$dim][$key]) && count($day[$dim]) >= $cap) {
        $key = VG_METRICS_OTHER;
    }
    $day[$dim][$key] = (int)($day[$dim][$key] ?? 0) + $by;
}

function vg_metrics_day_file(string $day): string
{
    return vg_metrics_subdir('days') . '/' . $day . '.json';
}

function vg_metrics_load_day(string $day): array
{
    $data = vg_metrics_read_json(vg_metrics_day_file($day), vg_metrics_empty_day($day));
    return ($data['v'] ?? null) === 1 ? $data + vg_metrics_empty_day($day) : vg_metrics_empty_day($day);
}

function vg_metrics_apply(array &$day, array $event): void
{
    $name = $event['e'];
    vg_metrics_bump($day, 'ev', $name);
    if ($name === 'pageview') {
        $day['pv'] = (int)$day['pv'] + 1;
        vg_metrics_bump($day, 'pages', $event['p']);
        vg_metrics_bump($day, 'sec', vg_metrics_section($event['p']));
        vg_metrics_bump($day, 'dev', $event['d']);
        if ($event['r'] !== 'ic') {
            // Siteye dışarıdan (veya doğrudan) giriş: çerezsiz ziyaret sayısının yaklaşığı.
            $day['entries'] = (int)$day['entries'] + 1;
            vg_metrics_bump($day, 'ref', $event['r']);
            if (isset($event['se'])) {
                vg_metrics_bump($day, 'se', $event['se']);
            }
        }
        if (strpos($event['p'], '/volthaber/') === 0) {
            vg_metrics_bump($day, 'ev', 'volthaber_view');
            vg_metrics_bump($day, 'vh', $event['p']);
        }
    } elseif ($name === 'sim_start' || $name === 'sim_complete') {
        vg_metrics_bump($day, $name, $event['sim']);
    } elseif ($name === 'tool_use') {
        vg_metrics_bump($day, 'tool', $event['tool']);
    } elseif ($name === 'tool_quote') {
        vg_metrics_bump($day, 'tool_quote', $event['tool']);
    } elseif ($name === 'quote_submit') {
        vg_metrics_bump($day, 'quote', $event['svc']);
        vg_metrics_bump($day, 'quote_via', $event['via']);
    }
}

/** Günlük, tuzu bellekte türetilen IP özeti. Tuz ve ham IP hiçbir zaman yazılmaz. */
function vg_metrics_client_key(string $day): string
{
    $salt = hash_hmac('sha256', 'vg-metrics-daily-salt|' . $day, vg_secret(), true);
    return substr(hash_hmac('sha256', vg_rl_ip_key(), $salt), 0, 24);
}

/**
 * Hız sınırı: kabul edilebilecek olay sayısını döndürür (0 = sınır aşıldı). Sayaç dosyası güne özeldir ve önceki
 * günlerin dosyaları silinir; özetlenmiş anahtarlar en fazla bir gün yaşar. Kilit çağıran tarafta tutulur.
 */
function vg_metrics_rate(string $day, int $wanted): int
{
    $dir = vg_metrics_subdir('rl');
    $file = $dir . '/' . $day . '.json';
    foreach ((array)@glob($dir . '/*.json') as $old) {
        if (is_string($old) && basename($old) !== $day . '.json') {
            @unlink($old);
        }
    }
    $state = vg_metrics_read_json($file, [], 8388608);
    $key = vg_metrics_client_key($day);
    $now = vg_now();
    $limitWindow = vg_rate_scale(VG_METRICS_RL_WINDOW_MAX);
    $limitDay = vg_rate_scale(VG_METRICS_RL_DAY_MAX);
    $entry = isset($state[$key]) && is_array($state[$key]) && count($state[$key]) === 3 ? array_map('intval', $state[$key]) : null;
    if ($entry === null) {
        if (count($state) >= VG_METRICS_RL_KEYS) {
            return 0; // sayaç tablosu dolu: güvenli tarafta kal, sayma
        }
        $entry = [$now, 0, 0];
    }
    if ($now - $entry[0] >= VG_METRICS_RL_WINDOW) {
        $entry[0] = $now;
        $entry[1] = 0;
    }
    $allowed = max(0, min($wanted, $limitWindow - $entry[1], $limitDay - $entry[2]));
    $entry[1] += $allowed;
    $entry[2] += $allowed;
    $state[$key] = $entry;
    vg_metrics_write_json($file, $state);
    return $allowed;
}

function vg_metrics_collect(): array
{
    $ua = (string)($_SERVER['HTTP_USER_AGENT'] ?? '');
    if (vg_metrics_opted_out()) {
        return ['ok' => true, 'service' => VG_METRICS_SERVICE, 'accepted' => 0, 'reason' => 'opt_out'];
    }
    $ct = strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ($_SERVER['HTTP_CONTENT_TYPE'] ?? '')), 2)[0]));
    if (!in_array($ct, ['text/plain', 'application/json'], true)) {
        vg_fail(415, 'unsupported_media_type', 'İstek biçimi desteklenmiyor.');
    }
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > VG_METRICS_MAX_BODY) {
        vg_fail(413, 'too_large', 'Gönderilen veri çok büyük.');
    }
    $raw = file_get_contents('php://input', false, null, 0, VG_METRICS_MAX_BODY + 1);
    if (!is_string($raw) || strlen($raw) > VG_METRICS_MAX_BODY) {
        vg_fail(413, 'too_large', 'Gönderilen veri çok büyük.');
    }
    $body = json_decode($raw, true, 8);
    if (!is_array($body) || ($body['v'] ?? null) !== 1 || !is_array($body['ev'] ?? null)
        || count($body['ev']) < 1 || count($body['ev']) > VG_METRICS_MAX_EVENTS) {
        vg_fail(400, 'invalid_request', 'Ölçüm verisi okunamadı.');
    }
    $events = [];
    foreach ($body['ev'] as $item) {
        $clean = vg_metrics_clean_event($item);
        if ($clean !== null) {
            $events[] = $clean;
        }
    }
    $bot = vg_metrics_is_bot($ua);
    $day = vg_metrics_day();
    return vg_metrics_locked(function () use ($events, $bot, $day) {
        $data = vg_metrics_load_day($day);
        if ($bot) {
            // Otomasyon trafiği yalnızca tek bir toplam olarak sayılır; hiçbir boyuta yansımaz. Bot döngüleri de
            // aynı hız sınırına tabidir (sınır aşılınca dosyaya yazılmaz).
            if (vg_metrics_rate($day, 1) === 0) {
                return ['ok' => true, 'service' => VG_METRICS_SERVICE, 'accepted' => 0, 'reason' => 'filtered'];
            }
            $data['bots'] = (int)$data['bots'] + 1;
            vg_metrics_write_json(vg_metrics_day_file($day), $data);
            return ['ok' => true, 'service' => VG_METRICS_SERVICE, 'accepted' => 0, 'reason' => 'filtered'];
        }
        if (!$events) {
            return ['ok' => true, 'service' => VG_METRICS_SERVICE, 'accepted' => 0, 'reason' => 'invalid'];
        }
        $allowed = vg_metrics_rate($day, count($events));
        if ($allowed < count($events)) {
            $data['limited'] = (int)$data['limited'] + (count($events) - $allowed);
        }
        foreach (array_slice($events, 0, $allowed) as $event) {
            vg_metrics_apply($data, $event);
        }
        vg_metrics_write_json(vg_metrics_day_file($day), $data);
        if ($allowed === 0) {
            vg_fail(429, 'rate_limited', 'Çok fazla ölçüm isteği.', [], ['Retry-After: 600'], ['retryAfter' => 600]);
        }
        return ['ok' => true, 'service' => VG_METRICS_SERVICE, 'accepted' => $allowed];
    });
}

/* ------------------------------------------------------------------ yöneticiler */

function vg_metrics_user_id($value): bool
{
    return is_string($value) && preg_match('/^u[a-f0-9]{24}$/D', $value) === 1;
}

function vg_metrics_admins(): array
{
    $state = vg_metrics_read_json(vg_metrics_dir() . '/admins.json', ['version' => 1, 'admins' => []], 65536);
    $ids = is_array($state['admins'] ?? null) ? $state['admins'] : [];
    return array_values(array_unique(array_filter($ids, 'vg_metrics_user_id')));
}

function vg_metrics_save_admins(array $ids): void
{
    vg_metrics_write_json(vg_metrics_dir() . '/admins.json', ['version' => 1, 'admins' => array_values($ids)]);
}

/* ------------------------------------------------------------------ rapor */

function vg_metrics_merge(array &$into, array $from, string $dim): void
{
    foreach ((array)($from[$dim] ?? []) as $key => $count) {
        if (is_string($key) || is_int($key)) {
            $into[(string)$key] = (int)($into[(string)$key] ?? 0) + (int)$count;
        }
    }
}

function vg_metrics_top(array $map, int $limit): array
{
    arsort($map);
    $out = [];
    foreach (array_slice($map, 0, $limit, true) as $key => $count) {
        $out[] = [(string)$key, (int)$count];
    }
    return $out;
}

/** Tarih aralığındaki gün dosyalarını okur (eski → yeni). Kilit gerekmez: dosyalar atomik değişir. */
function vg_metrics_range(int $days, int $endOffset = 0): array
{
    $out = [];
    for ($i = $days - 1; $i >= 0; $i--) {
        $day = vg_metrics_day($endOffset - $i);
        $file = vg_metrics_day_file($day);
        $out[$day] = is_file($file) ? vg_metrics_load_day($day) : null;
    }
    return $out;
}

/** Bir dönemin özet göstergeleri (ölçüm planı tabanı için de kullanılır). */
function vg_metrics_summary(array $days): array
{
    $sum = ['days' => 0, 'pv' => 0, 'entries' => 0, 'organic' => 0, 'quotes' => 0, 'quotesFromTools' => 0, 'toolUse' => 0,
        'simStart' => 0, 'simComplete' => 0, 'whatsapp' => 0, 'tel' => 0, 'newsletter' => 0, 'volthaber' => 0];
    foreach ($days as $d) {
        if ($d === null) {
            continue;
        }
        $sum['days']++;
        $sum['pv'] += (int)$d['pv'];
        $sum['entries'] += (int)$d['entries'];
        $sum['organic'] += (int)($d['ref']['arama'] ?? 0);
        $sum['quotes'] += (int)($d['ev']['quote_submit'] ?? 0);
        $sum['quotesFromTools'] += (int)($d['quote_via']['arac'] ?? 0);
        $sum['toolUse'] += (int)($d['ev']['tool_use'] ?? 0);
        $sum['simStart'] += (int)($d['ev']['sim_start'] ?? 0);
        $sum['simComplete'] += (int)($d['ev']['sim_complete'] ?? 0);
        $sum['whatsapp'] += (int)($d['ev']['whatsapp_click'] ?? 0);
        $sum['tel'] += (int)($d['ev']['tel_click'] ?? 0);
        $sum['newsletter'] += (int)($d['ev']['newsletter_subscribe'] ?? 0);
        $sum['volthaber'] += (int)($d['ev']['volthaber_view'] ?? 0);
    }
    return $sum;
}

/** En eski veri günü (ölçüm planının taban dönemini belirler); veri yoksa null. */
function vg_metrics_first_day(): ?string
{
    $files = (array)@glob(vg_metrics_subdir('days') . '/*.json');
    $days = [];
    foreach ($files as $f) {
        if (is_string($f) && preg_match('/(\d{4}-\d{2}-\d{2})\.json$/', $f, $m) === 1) {
            $days[] = $m[1];
        }
    }
    sort($days);
    return $days ? $days[0] : null;
}

function vg_metrics_dashboard(): array
{
    $days = 30;
    if (isset($_GET['days'])) {
        if (!is_string($_GET['days']) || !in_array($_GET['days'], ['7', '30', '90', '365'], true)) {
            vg_fail(422, 'invalid_range', 'Geçersiz tarih aralığı.');
        }
        $days = (int)$_GET['days'];
    }
    $range = vg_metrics_range($days);
    $series = [];
    $agg = ['pages' => [], 'ref' => [], 'se' => [], 'dev' => [], 'sec' => [], 'sim_start' => [], 'sim_complete' => [],
        'tool' => [], 'tool_quote' => [], 'quote' => [], 'quote_via' => [], 'vh' => []];
    $bots = 0;
    $limited = 0;
    foreach ($range as $day => $d) {
        $series[] = $d === null ? ['d' => $day, 'pv' => 0, 'en' => 0, 'q' => 0, 'tq' => 0, 'wa' => 0, 'tel' => 0, 'nl' => 0, 'ss' => 0, 'sc' => 0, 'tu' => 0, 'vh' => 0, 'none' => true]
            : ['d' => $day, 'pv' => (int)$d['pv'], 'en' => (int)$d['entries'], 'q' => (int)($d['ev']['quote_submit'] ?? 0),
                'tq' => (int)($d['ev']['tool_quote'] ?? 0), 'wa' => (int)($d['ev']['whatsapp_click'] ?? 0),
                'tel' => (int)($d['ev']['tel_click'] ?? 0), 'nl' => (int)($d['ev']['newsletter_subscribe'] ?? 0),
                'ss' => (int)($d['ev']['sim_start'] ?? 0), 'sc' => (int)($d['ev']['sim_complete'] ?? 0),
                'tu' => (int)($d['ev']['tool_use'] ?? 0), 'vh' => (int)($d['ev']['volthaber_view'] ?? 0)];
        if ($d === null) {
            continue;
        }
        foreach (array_keys($agg) as $dim) {
            vg_metrics_merge($agg[$dim], $d, $dim);
        }
        $bots += (int)$d['bots'];
        $limited += (int)$d['limited'];
    }
    $sims = [];
    foreach (array_unique(array_merge(array_keys($agg['sim_start']), array_keys($agg['sim_complete']))) as $sim) {
        $sims[] = ['sim' => (string)$sim, 'start' => (int)($agg['sim_start'][$sim] ?? 0), 'complete' => (int)($agg['sim_complete'][$sim] ?? 0)];
    }
    usort($sims, function (array $a, array $b): int { return $b['start'] <=> $a['start'] ?: strcmp($a['sim'], $b['sim']); });

    $first = vg_metrics_first_day();
    $daysWithData = 0;
    $baseline = null;
    if ($first !== null) {
        $today = new DateTimeImmutable(vg_metrics_day() . ' 12:00:00', vg_metrics_tz());
        $start = new DateTimeImmutable($first . ' 12:00:00', vg_metrics_tz());
        $daysWithData = (int)$start->diff($today)->days + 1;
        if ($daysWithData >= 30) {
            // Taban: ölçümün ilk 30 günü. Hedefler bu tabana göre (yüzde değişim) izlenir; sabit sayı uydurulmaz.
            $offset = -((int)$start->diff($today)->days - 29);
            $baseline = vg_metrics_summary(vg_metrics_range(30, $offset));
            $baseline['from'] = $first;
        }
    }
    return ['ok' => true, 'service' => VG_METRICS_SERVICE,
        'range' => ['days' => $days, 'from' => array_key_first($range), 'to' => vg_metrics_day()],
        'firstDate' => $first, 'daysWithData' => $daysWithData,
        'series' => $series, 'totals' => vg_metrics_summary($range), 'bots' => $bots, 'limited' => $limited,
        'pages' => vg_metrics_top($agg['pages'], 25), 'sections' => vg_metrics_top($agg['sec'], 20),
        'ref' => $agg['ref'], 'se' => $agg['se'], 'dev' => $agg['dev'], 'sims' => $sims,
        'tools' => vg_metrics_top($agg['tool'], 20), 'toolQuotes' => vg_metrics_top($agg['tool_quote'], 20),
        'quotes' => vg_metrics_top($agg['quote'], 20), 'quoteVia' => $agg['quote_via'], 'volthaber' => vg_metrics_top($agg['vh'], 20),
        'kpi' => ['today' => vg_metrics_summary(vg_metrics_range(1)), 'last7' => vg_metrics_summary(vg_metrics_range(7)),
            'last30' => vg_metrics_summary(vg_metrics_range(30))],
        'plan' => ['baseline' => $baseline, 'current' => $daysWithData >= 60 ? vg_metrics_summary(vg_metrics_range(30)) : null],
        // Google Search Console bağlantısı yok: gösterim / tıklama verisi uydurulmaz.
        'searchConsole' => null];
}

/** Herkese açık: son 30 günün en çok kullanılan araçları. Yeterli veri yoksa boş liste (istemci "Öne çıkan" gösterir). */
function vg_metrics_popular(): array
{
    $cache = vg_metrics_dir() . '/popular.json';
    $cached = vg_metrics_read_json($cache, [], 65536);
    if (($cached['day'] ?? '') === vg_metrics_day() && (int)($cached['at'] ?? 0) > vg_now() - 3600 && is_array($cached['items'] ?? null)) {
        return ['ok' => true, 'service' => VG_METRICS_SERVICE, 'items' => $cached['items'], 'basis' => $cached['basis'] ?? 0];
    }
    $counts = [];
    foreach (vg_metrics_range(30) as $d) {
        if ($d === null) {
            continue;
        }
        vg_metrics_merge($counts, $d, 'tool');
        foreach ((array)$d['sim_start'] as $sim => $n) {
            $counts['sim-' . $sim] = (int)($counts['sim-' . $sim] ?? 0) + (int)$n;
        }
    }
    unset($counts[VG_METRICS_OTHER], $counts['sim-' . VG_METRICS_OTHER]);
    $basis = array_sum($counts);
    $items = [];
    if ($basis >= 20) {
        foreach (vg_metrics_top($counts, 8) as [$slug, $n]) {
            if ($n >= 3) {
                $items[] = ['slug' => $slug, 'uses' => $n];
            }
        }
    }
    vg_metrics_locked(function () use ($cache, $items, $basis) {
        vg_metrics_write_json($cache, ['day' => vg_metrics_day(), 'at' => vg_now(), 'items' => $items, 'basis' => $basis]);
    });
    return ['ok' => true, 'service' => VG_METRICS_SERVICE, 'items' => $items, 'basis' => $basis];
}

/** Günde bir kez: saklama süresini aşan gün dosyaları silinir. */
function vg_metrics_gc(): void
{
    $dir = vg_metrics_dir();
    $marker = $dir . '/gc.last';
    if (@file_get_contents($marker) === vg_metrics_day()) {
        return;
    }
    @file_put_contents($marker, vg_metrics_day());
    $limit = vg_metrics_day(-VG_METRICS_KEEP_DAYS);
    foreach ((array)@glob($dir . '/days/*.json') as $file) {
        if (is_string($file) && preg_match('/(\d{4}-\d{2}-\d{2})\.json$/', $file, $m) === 1 && $m[1] < $limit) {
            @unlink($file);
        }
    }
}

/* ------------------------------------------------------------------ yönlendirici */

function vg_metrics_run(): void
{
    ob_start();
    try {
        $action = vg_action();
        $routes = ['collect' => 'POST', 'dashboard' => 'GET', 'popular' => 'GET'];
        if (!isset($routes[$action])) {
            vg_fail(404, 'unknown_action', 'Geçersiz işlem.');
        }
        $request = vg_method();
        if ($request === 'HEAD' && $routes[$action] === 'GET') {
            $request = 'GET';
        }
        if ($request !== $routes[$action]) {
            vg_fail(405, 'method_not_allowed', 'Bu işlem için istek yöntemi desteklenmiyor.', [], ['Allow: ' . $routes[$action]]);
        }
        vg_check_fetch_site();
        $headers = [];
        if ($action === 'collect') {
            vg_require_same_origin();
            $result = vg_metrics_collect();
        } elseif ($action === 'popular') {
            $result = vg_metrics_popular();
            $headers[] = 'Cache-Control: public, max-age=3600';
        } else {
            // Yönetici verisi: oturum + CSRF + aynı köken + yetki listesi. Çerezsiz istekte oturum hiç açılmaz.
            vg_require_same_origin();
            if (!isset($_COOKIE[VG_SESSION_NAME]) || (string)($_SERVER['HTTP_X_VG_CSRF'] ?? '') === '') {
                vg_fail(401, 'unauthorized', 'Bu panel için yönetici hesabıyla giriş yapmanız gerekiyor.');
            }
            $retry = vg_rl_hit('metrics_dashboard', vg_rl_ip_key(), 60, 60);
            if ($retry > 0) {
                vg_too_many($retry);
            }
            $store = vg_store();
            vg_session_start();
            vg_require_csrf();
            $user = vg_require_user($store);
            session_write_close();
            if (!in_array($user['id'], vg_metrics_admins(), true)) {
                vg_fail(403, 'forbidden', 'Büyüme paneli yalnızca yetkilendirilmiş yöneticilere açıktır.');
            }
            $result = vg_metrics_dashboard();
        }
        vg_send(200, $result, $headers);
        vg_after_response('vg_metrics_gc');
        if ($action === 'dashboard') {
            vg_schedule_gc();
        }
    } catch (VgHttpError $error) {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        $payload = ['ok' => false, 'error' => $error->errCode, 'message' => $error->getMessage()];
        vg_send($error->status, $payload + $error->extra, $error->headers);
    } catch (Throwable $error) {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        error_log('VoltGuard metrics: ' . get_class($error) . ' at ' . basename($error->getFile()) . ':' . $error->getLine());
        vg_send(500, ['ok' => false, 'error' => 'server_error', 'message' => 'Ölçüm servisi şu anda kullanılamıyor.']);
    }
    vg_finish_and_run_jobs();
}

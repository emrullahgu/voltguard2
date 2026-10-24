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
const VG_METRICS_TEST_KEEP_DAYS = 30;
/*
 * Olay sözlüğü (sürüm 2). Tetikleme kuralları api/METRICS.md "Olay sözlüğü" bölümündedir; burada yalnızca izin verilen
 * adlar ve alanlar vardır. quote_submit_success ve quote_server_reject İSTEMCİDEN KABUL EDİLMEZ: yalnızca contact.php,
 * talebi gerçekten kabul ettiğinde / reddettiğinde sunucu tarafında yazar (vg_metrics_record_contact).
 */
const VG_METRICS_EVENTS = ['pageview', 'simulation_open', 'simulation_run', 'simulation_result', 'simulation_error',
    'task_complete', 'scenario_save', 'report_download', 'tool_use', 'tool_result', 'service_cta_click', 'quote_start',
    'quote_step', 'quote_validation_error', 'quote_abandon', 'quote_submit_fail', 'contact_click', 'newsletter_subscribe'];
/* Önbellekteki eski istemcilerin (sürüm 1) olay adları yeni sözlüğe çevrilir. quote_submit istemci bildirimi olduğu
   için sayılmaz; kabul edilen talep yalnızca sunucuda sayılır (çift sayım olmaz). */
const VG_METRICS_LEGACY = ['sim_start' => 'simulation_run', 'sim_complete' => 'task_complete', 'tool_quote' => 'service_cta_click',
    'tel_click' => 'contact_click', 'whatsapp_click' => 'contact_click', 'quote_submit' => ''];
const VG_METRICS_REF = ['ic', 'dogrudan', 'arama', 'sosyal', 'diger'];
const VG_METRICS_SE = ['google', 'bing', 'yandex', 'duckduckgo', 'yahoo', 'ecosia', 'baidu', 'diger'];
const VG_METRICS_DEV = ['mobil', 'tablet', 'masaustu'];
const VG_METRICS_FORMS = ['iletisim', 'teklif'];
/* Doğrulama hatası / terk edilen alan adları: yalnızca alanın KİMLİĞİ, asla değeri. */
const VG_METRICS_FIELDS = ['ad', 'telefon', 'eposta', 'konu', 'hizmet', 'mesaj', 'guvenlik', 'sektor', 'trafo', 'hizmetler',
    'aciliyet', 'il', 'not', 'diger'];
const VG_METRICS_FAILS = ['ag', 'zaman-asimi', 'gecersiz-yanit'];
const VG_METRICS_SIM_ERRORS = ['webgl', 'sahne', 'hesap', 'calisma', 'rapor', 'dosya'];
const VG_METRICS_FORMATS = ['pdf', 'csv', 'yazdir'];
const VG_METRICS_SAVES = ['dosya', 'hesap', 'tarayici'];
const VG_METRICS_CHANNELS = ['tel', 'whatsapp', 'eposta'];
const VG_METRICS_DRAFT = ['sonuc', 'yok'];
/* contact.php hata kodları: yalnızca gerçek ziyaretçi düzeltmesi/engeli olabilecekler sayılır (yöntem, köken gibi
   saldırı/bozuk istek kodları sayılmaz). */
const VG_METRICS_REJECT_CODES = ['invalid_name', 'invalid_phone', 'invalid_email', 'contact_required', 'invalid_subject', 'invalid_message',
    'invalid_form', 'captcha_required', 'captcha_invalid', 'captcha_unavailable', 'rate_limited', 'mail_unavailable', 'rejected'];
const VG_METRICS_SUBJECTS = ['elektrik', 'elektronik', 'otomasyon', 'mekanik', 'diger'];
const VG_METRICS_OTHER = '(diğer)';
const VG_METRICS_UNKNOWN_PATH = '(bilinmeyen sayfa)';
const VG_METRICS_NO_SOURCE = '(bilinmiyor)';
/* Boyut başına en fazla farklı anahtar (gün dosyası sınırsız büyümesin; fazlası "(diğer)" altında toplanır). */
const VG_METRICS_CAPS = ['pages' => 600, 'vh' => 300, 'ref' => 8, 'se' => 10, 'dev' => 4, 'sec' => 20, 'ev' => 40,
    'sim_open' => 80, 'sim_run' => 80, 'sim_result' => 80, 'task_done' => 80, 'sim_err' => 200, 'save' => 200, 'report' => 300,
    'tool' => 200, 'tool_result' => 200, 'cta' => 400, 'q_start' => 40, 'q_src' => 300, 'q_step' => 30, 'q_err' => 40,
    'q_ab' => 40, 'q_fail' => 10, 'q_ok' => 200, 'q_ok_src' => 300, 'q_rej' => 30, 'contact' => 60, 'legacy' => 10];
const VG_METRICS_DIMS = ['pages', 'vh', 'ref', 'se', 'dev', 'sec', 'sim_open', 'sim_run', 'sim_result', 'task_done', 'sim_err',
    'save', 'report', 'tool', 'tool_result', 'cta', 'q_start', 'q_src', 'q_step', 'q_err', 'q_ab', 'q_fail', 'q_ok', 'q_ok_src',
    'q_rej', 'contact', 'legacy'];

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

/** Simülasyon (sim-<id>) ya da hesap aracı kimliği; geçersizse boş. */
function vg_metrics_item(array $raw): string
{
    $sim = vg_metrics_slug($raw['sim'] ?? null, 40);
    if ($sim !== '') {
        return 'sim-' . $sim;
    }
    return vg_metrics_slug($raw['tool'] ?? null, 80);
}

/**
 * İstemci olayını doğrulayıp yalnızca izin verilen alanlarla döndürür; geçersizse null.
 * Olay biçimi: {e, p, r?, se?, d?, sim?, tool?, kind?, fmt?, to?, form?, step?, field?, last?, reason?, ch?, src?, tas?}
 * Hiçbir alan serbest metin taşıyamaz: her değer ya izin listesinden, ya [a-z0-9-] kısaltması, ya da sitede var olan bir
 * sayfa yoludur. Eski (sürüm 1) adlar VG_METRICS_LEGACY ile çevrilir; karşılığı boş olan ad yalnızca "legacy" sayacına yazılır.
 */
function vg_metrics_clean_event($raw): ?array
{
    if (!is_array($raw) || !is_string($raw['e'] ?? null)) {
        return null;
    }
    $name = $raw['e'];
    $legacy = '';
    if (array_key_exists($name, VG_METRICS_LEGACY)) {
        $legacy = $name;
        $name = VG_METRICS_LEGACY[$name];
        if ($name === '') {
            return ['e' => '', 'legacy' => $legacy];
        }
    }
    if (!in_array($name, VG_METRICS_EVENTS, true)) {
        return null;
    }
    $path = vg_metrics_path($raw['p'] ?? null);
    if ($path === null) {
        return null;
    }
    $event = ['e' => $name, 'p' => $path];
    if ($legacy !== '') {
        $event['legacy'] = $legacy;
    }
    $form = vg_metrics_pick($raw['form'] ?? null, VG_METRICS_FORMS);
    switch ($name) {
        case 'pageview':
            $event['r'] = vg_metrics_pick($raw['r'] ?? null, VG_METRICS_REF) ?: 'diger';
            if ($event['r'] === 'arama') {
                $event['se'] = vg_metrics_pick($raw['se'] ?? null, VG_METRICS_SE) ?: 'diger';
            }
            $event['d'] = vg_metrics_pick($raw['d'] ?? null, VG_METRICS_DEV) ?: 'masaustu';
            return $event;
        case 'simulation_open':
        case 'simulation_run':
        case 'simulation_result':
        case 'task_complete':
            $event['sim'] = vg_metrics_slug($raw['sim'] ?? null, 40);
            return $event['sim'] === '' ? null : $event;
        case 'simulation_error':
            $event['sim'] = vg_metrics_slug($raw['sim'] ?? null, 40);
            $event['kind'] = vg_metrics_pick($raw['kind'] ?? null, VG_METRICS_SIM_ERRORS);
            return $event['sim'] === '' || $event['kind'] === '' ? null : $event;
        case 'tool_use':
        case 'tool_result':
            $event['tool'] = vg_metrics_slug($raw['tool'] ?? null, 80);
            return $event['tool'] === '' ? null : $event;
        case 'scenario_save':
            $event['item'] = vg_metrics_item($raw);
            $event['kind'] = vg_metrics_pick($raw['kind'] ?? null, VG_METRICS_SAVES) ?: 'dosya';
            return $event['item'] === '' ? null : $event;
        case 'report_download':
            $event['item'] = vg_metrics_item($raw);
            $event['fmt'] = vg_metrics_pick($raw['fmt'] ?? null, VG_METRICS_FORMATS);
            return $event['item'] === '' || $event['fmt'] === '' ? null : $event;
        case 'service_cta_click':
            $event['to'] = vg_metrics_pick($raw['to'] ?? null, VG_METRICS_FORMS) ?: 'iletisim';
            return $event;
        case 'quote_start':
            if ($form === '') {
                return null;
            }
            $src = isset($raw['src']) ? vg_metrics_path($raw['src']) : $path;
            $event += ['form' => $form, 'd' => vg_metrics_pick($raw['d'] ?? null, VG_METRICS_DEV) ?: 'masaustu',
                'tas' => vg_metrics_pick($raw['tas'] ?? null, VG_METRICS_DRAFT) ?: 'yok', 'src' => $src ?? $path];
            return $event;
        case 'quote_step':
            $step = $raw['step'] ?? null;
            if ($form === '' || !is_int($step) || $step < 1 || $step > 9) {
                return null;
            }
            return $event + ['form' => $form, 'step' => $step];
        case 'quote_validation_error':
            $field = vg_metrics_pick($raw['field'] ?? null, VG_METRICS_FIELDS);
            return $form === '' || $field === '' ? null
                : $event + ['form' => $form, 'field' => $field, 'd' => vg_metrics_pick($raw['d'] ?? null, VG_METRICS_DEV) ?: 'masaustu'];
        case 'quote_abandon':
            $last = $raw['last'] ?? null;
            $last = is_string($last) && preg_match('/^adim-[1-9]$/D', $last) === 1 ? $last : vg_metrics_pick($last, VG_METRICS_FIELDS);
            return $form === '' ? null : $event + ['form' => $form, 'last' => $last ?: 'baslangic',
                'd' => vg_metrics_pick($raw['d'] ?? null, VG_METRICS_DEV) ?: 'masaustu'];
        case 'quote_submit_fail':
            $reason = vg_metrics_pick($raw['reason'] ?? null, VG_METRICS_FAILS);
            return $form === '' || $reason === '' ? null : $event + ['form' => $form, 'reason' => $reason];
        case 'contact_click':
            $channel = $legacy === 'tel_click' ? 'tel' : ($legacy === 'whatsapp_click' ? 'whatsapp'
                : vg_metrics_pick($raw['ch'] ?? null, VG_METRICS_CHANNELS));
            return $channel === '' ? null : $event + ['ch' => $channel];
    }
    return $event; // newsletter_subscribe: yalnızca sayfa
}

/* ------------------------------------------------------------------ toplama */

function vg_metrics_empty_day(string $day): array
{
    $data = ['v' => 2, 'date' => $day, 'pv' => 0, 'entries' => 0, 'bots' => 0, 'limited' => 0, 'ev' => []];
    foreach (VG_METRICS_DIMS as $dim) {
        $data[$dim] = [];
    }
    return $data;
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

/** Canlı veri metrics/days/, test verisi metrics/test-days/ altında durur; ikisi hiçbir raporda birleşmez. */
function vg_metrics_day_file(string $day, bool $test = false): string
{
    return vg_metrics_subdir($test ? 'test-days' : 'days') . '/' . $day . '.json';
}

/** Sürüm 1 gün dosyası (istemci tarafı quote_submit sayan eski şema) yeni boyutlara çevrilir. */
function vg_metrics_migrate_v1(array $old, string $day): array
{
    $data = vg_metrics_empty_day($day);
    foreach (['pv', 'entries', 'bots', 'limited'] as $k) {
        $data[$k] = (int)($old[$k] ?? 0);
    }
    foreach (['pages', 'vh', 'ref', 'se', 'dev', 'sec', 'tool'] as $dim) {
        $data[$dim] = is_array($old[$dim] ?? null) ? $old[$dim] : [];
    }
    $data['sim_run'] = is_array($old['sim_start'] ?? null) ? $old['sim_start'] : [];
    $data['task_done'] = is_array($old['sim_complete'] ?? null) ? $old['sim_complete'] : [];
    $rename = ['sim_start' => 'simulation_run', 'sim_complete' => 'task_complete', 'tool_quote' => 'service_cta_click',
        'tel_click' => 'contact_click', 'whatsapp_click' => 'contact_click'];
    foreach ((array)($old['ev'] ?? []) as $name => $n) {
        $name = (string)$name;
        if ($name === 'quote_submit') {
            // Eski istemci bildirimi: backend kabulü değildir; yalnızca "eski olay" olarak tutulur.
            $data['legacy']['quote_submit'] = (int)$n;
            continue;
        }
        $to = $rename[$name] ?? $name;
        $data['ev'][$to] = (int)($data['ev'][$to] ?? 0) + (int)$n;
    }
    foreach (['tel_click' => 'tel', 'whatsapp_click' => 'whatsapp'] as $name => $ch) {
        if (!empty($old['ev'][$name])) {
            $data['contact'][$ch . '|(eski kayıt)'] = (int)$old['ev'][$name];
        }
    }
    foreach ((array)($old['tool_quote'] ?? []) as $tool => $n) {
        $data['cta']['(eski kayıt: ' . $tool . ')|iletisim'] = (int)$n;
    }
    return $data;
}

function vg_metrics_load_day(string $day, bool $test = false): array
{
    $data = vg_metrics_read_json(vg_metrics_day_file($day, $test), vg_metrics_empty_day($day));
    $version = $data['v'] ?? null;
    if ($version === 1) {
        return vg_metrics_migrate_v1($data, $day);
    }
    return $version === 2 ? $data + vg_metrics_empty_day($day) : vg_metrics_empty_day($day);
}

function vg_metrics_apply(array &$day, array $event): void
{
    $name = $event['e'];
    if ($name === '') {
        vg_metrics_bump($day, 'legacy', $event['legacy']);
        return;
    }
    vg_metrics_bump($day, 'ev', $name);
    if (isset($event['legacy'])) {
        vg_metrics_bump($day, 'legacy', $event['legacy']);
    }
    $p = $event['p'];
    switch ($name) {
        case 'pageview':
            $day['pv'] = (int)$day['pv'] + 1;
            vg_metrics_bump($day, 'pages', $p);
            vg_metrics_bump($day, 'sec', vg_metrics_section($p));
            vg_metrics_bump($day, 'dev', $event['d']);
            if ($event['r'] !== 'ic') {
                // Siteye dışarıdan (veya doğrudan) giriş: çerezsiz ziyaret sayısının yaklaşığı.
                $day['entries'] = (int)$day['entries'] + 1;
                vg_metrics_bump($day, 'ref', $event['r']);
                if (isset($event['se'])) {
                    vg_metrics_bump($day, 'se', $event['se']);
                }
            }
            if (strpos($p, '/volthaber/') === 0) {
                vg_metrics_bump($day, 'ev', 'volthaber_view');
                vg_metrics_bump($day, 'vh', $p);
            }
            break;
        case 'simulation_open':
            vg_metrics_bump($day, 'sim_open', $event['sim']);
            break;
        case 'simulation_run':
            vg_metrics_bump($day, 'sim_run', $event['sim']);
            break;
        case 'simulation_result':
            vg_metrics_bump($day, 'sim_result', $event['sim']);
            break;
        case 'task_complete':
            vg_metrics_bump($day, 'task_done', $event['sim']);
            break;
        case 'simulation_error':
            vg_metrics_bump($day, 'sim_err', $event['sim'] . '|' . $event['kind']);
            break;
        case 'tool_use':
            vg_metrics_bump($day, 'tool', $event['tool']);
            break;
        case 'tool_result':
            vg_metrics_bump($day, 'tool_result', $event['tool']);
            break;
        case 'scenario_save':
            vg_metrics_bump($day, 'save', $event['item'] . '|' . $event['kind']);
            break;
        case 'report_download':
            vg_metrics_bump($day, 'report', $event['item'] . '|' . $event['fmt']);
            break;
        case 'service_cta_click':
            vg_metrics_bump($day, 'cta', $p . '|' . $event['to']);
            break;
        case 'quote_start':
            vg_metrics_bump($day, 'q_start', $event['form'] . '|' . $event['d'] . '|' . $event['tas']);
            vg_metrics_bump($day, 'q_src', $event['form'] . '|' . $event['src']);
            break;
        case 'quote_step':
            vg_metrics_bump($day, 'q_step', $event['form'] . '|' . $event['step']);
            break;
        case 'quote_validation_error':
            vg_metrics_bump($day, 'q_err', $event['form'] . '|' . $event['field'] . '|' . $event['d']);
            break;
        case 'quote_abandon':
            vg_metrics_bump($day, 'q_ab', $event['form'] . '|' . $event['last'] . '|' . $event['d']);
            break;
        case 'quote_submit_fail':
            vg_metrics_bump($day, 'q_fail', $event['form'] . '|' . $event['reason']);
            break;
        case 'contact_click':
            vg_metrics_bump($day, 'contact', $event['ch'] . '|' . vg_metrics_section($p));
            break;
    }
}

/**
 * Canlı alan adları (VG_METRICS_LIVE_HOSTS, virgülle; varsayılan voltguard.com.tr ve www). Başka bir adresten (yerel
 * önizleme, hazırlık sunucusu) gelen her olay test verisidir ve canlı rapora karışmaz.
 */
function vg_metrics_live_host(): bool
{
    $env = getenv('VG_METRICS_LIVE_HOSTS');
    $hosts = is_string($env) && trim($env) !== '' ? array_map('trim', explode(',', strtolower($env)))
        : ['voltguard.com.tr', 'www.voltguard.com.tr'];
    $host = strtolower(vg_strip_default_port((string)($_SERVER['HTTP_HOST'] ?? '')));
    return $host !== '' && in_array($host, $hosts, true);
}

/**
 * contact.php sonucu sunucu tarafında sayılır: kabul edilen talep (quote_submit_success) ya da ziyaretçinin düzeltebileceği
 * bir nedenle reddedilen talep (quote_server_reject, hata kodu). Yazılanlar: form türü, hizmet alanı kategorisi (5 sabit
 * değer), VoltSim/araç özeti eklenip eklenmediği ve istemcinin isteğe bağlı vg_ctx_* bağlamı (önceki site içi sayfa yolu,
 * cihaz sınıfı, test bayrağı). Ad, telefon, e-posta, mesaj ve simülasyon içeriği hiçbir koşulda yazılmaz.
 * Yanıt gönderildikten sonra çalışır (vg_after_response); ölçüm hatası talebi asla etkilemez.
 */
function vg_metrics_contact_outcome(?string $rejectCode): void
{
    try {
        if (vg_metrics_is_bot((string)($_SERVER['HTTP_USER_AGENT'] ?? ''))) {
            return;
        }
        if ($rejectCode !== null && !in_array($rejectCode, VG_METRICS_REJECT_CODES, true)) {
            return;
        }
        $post = function (string $key): string {
            $v = $_POST[$key] ?? '';
            return is_string($v) ? $v : '';
        };
        $form = $post('kind') === 'quote' ? 'teklif' : 'iletisim';
        $src = $post('vg_ctx_src') !== '' ? vg_metrics_path($post('vg_ctx_src')) : null;
        $src = $src === null || $src === VG_METRICS_UNKNOWN_PATH ? VG_METRICS_NO_SOURCE : $src;
        $dev = vg_metrics_pick($post('vg_ctx_dev'), VG_METRICS_DEV) ?: VG_METRICS_NO_SOURCE;
        $draft = ($post('simulationConsent') === '1' && trim($post('simulation')) !== '') || $post('vg_ctx_tas') === 'sonuc';
        $subject = vg_metrics_pick($post('subject'), VG_METRICS_SUBJECTS) ?: 'diger';
        $test = $post('vg_ctx_t') === '1' || getenv('VG_MAIL_OUTBOX') === '1' || !vg_metrics_live_host();
        $day = vg_metrics_day();
        vg_metrics_locked(function () use ($rejectCode, $form, $src, $dev, $draft, $subject, $test, $day) {
            $data = vg_metrics_load_day($day, $test);
            if ($rejectCode === null) {
                vg_metrics_bump($data, 'ev', 'quote_submit_success');
                vg_metrics_bump($data, 'q_ok', $form . '|' . $dev . '|' . ($draft ? 'sonuc' : 'yok') . '|' . $subject);
                vg_metrics_bump($data, 'q_ok_src', $form . '|' . $src);
            } else {
                vg_metrics_bump($data, 'ev', 'quote_server_reject');
                vg_metrics_bump($data, 'q_rej', $form . '|' . $rejectCode);
            }
            vg_metrics_write_json(vg_metrics_day_file($day, $test), $data);
        });
    } catch (Throwable $error) {
        error_log('VoltGuard metrics: contact outcome not recorded (' . get_class($error) . ')');
    }
}

/** Günlük, tuzu bellekte türetilen IP özeti. Tuz ve ham IP hiçbir zaman yazılmaz. */
function vg_metrics_client_key(string $day): string
{
    $salt = hash_hmac('sha256', 'vg-metrics-daily-salt|' . $day, vg_secret(), true);
    // IPv6'da /48: tek musteri blogu gunluk sayac tablosunu (VG_METRICS_RL_KEYS) dolduramasin.
    return substr(hash_hmac('sha256', vg_rl_ip_key(48), $salt), 0, 24);
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
    if (!is_array($body) || !in_array($body['v'] ?? null, [1, 2], true) || !is_array($body['ev'] ?? null)
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
    // Test verisi: istemci test bayrağı (?vg_test=1, yerel adres) ya da canlı olmayan alan adı. Canlıya hiç yazılmaz.
    $test = ($body['t'] ?? 0) === 1 || !vg_metrics_live_host();
    $bot = vg_metrics_is_bot($ua);
    $day = vg_metrics_day();
    return vg_metrics_locked(function () use ($events, $bot, $day, $test) {
        $data = vg_metrics_load_day($day, $test);
        $file = vg_metrics_day_file($day, $test);
        $meta = ['ok' => true, 'service' => VG_METRICS_SERVICE, 'bucket' => $test ? 'test' : 'live'];
        if ($bot) {
            // Otomasyon trafiği yalnızca tek bir toplam olarak sayılır; hiçbir boyuta yansımaz. Bot döngüleri de
            // aynı hız sınırına tabidir (sınır aşılınca dosyaya yazılmaz).
            if (vg_metrics_rate($day, 1) === 0) {
                return $meta + ['accepted' => 0, 'reason' => 'filtered'];
            }
            $data['bots'] = (int)$data['bots'] + 1;
            vg_metrics_write_json($file, $data);
            return $meta + ['accepted' => 0, 'reason' => 'filtered'];
        }
        if (!$events) {
            return $meta + ['accepted' => 0, 'reason' => 'invalid'];
        }
        $allowed = vg_metrics_rate($day, count($events));
        if ($allowed < count($events)) {
            $data['limited'] = (int)$data['limited'] + (count($events) - $allowed);
        }
        foreach (array_slice($events, 0, $allowed) as $event) {
            vg_metrics_apply($data, $event);
        }
        vg_metrics_write_json($file, $data);
        if ($allowed === 0) {
            vg_fail(429, 'rate_limited', 'Çok fazla ölçüm isteği.', [], ['Retry-After: 600'], ['retryAfter' => 600]);
        }
        return $meta + ['accepted' => $allowed];
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

/* ------------------------------------------------------------------ doğrulanmış iş sonuçları */

/**
 * Nitelikli teklif ve kazanılan iş sayıları sitenin ölçümünden ÇIKARILAMAZ. Yalnızca iş takip sisteminden aktarılan ya da
 * yetkili bir kişinin doğruladığı aylık toplamlar tools/metrics-admin.php ile girilir (metrics/outcomes.json). Kayıt yoksa
 * panel "doğrulanmış veri yok" gösterir; hiçbir oran veya tahmin üretilmez.
 * Biçim: {version:1, months:{"YYYY-MM":{qualified,won,source,verifiedBy,at}}, changes:[{date,label}]}
 */
const VG_METRICS_OUTCOME_SOURCES = ['is-takip', 'yetkili'];

function vg_metrics_outcomes(): array
{
    $state = vg_metrics_read_json(vg_metrics_dir() . '/outcomes.json', [], 262144);
    $months = [];
    foreach ((array)($state['months'] ?? []) as $month => $row) {
        if (!is_string($month) || preg_match('/^\d{4}-(0[1-9]|1[0-2])$/D', $month) !== 1 || !is_array($row)) {
            continue;
        }
        $months[$month] = ['qualified' => is_int($row['qualified'] ?? null) ? $row['qualified'] : null,
            'won' => is_int($row['won'] ?? null) ? $row['won'] : null,
            'source' => vg_metrics_pick($row['source'] ?? null, VG_METRICS_OUTCOME_SOURCES) ?: 'yetkili',
            'verifiedBy' => is_string($row['verifiedBy'] ?? null) ? $row['verifiedBy'] : '',
            'at' => is_string($row['at'] ?? null) ? $row['at'] : ''];
    }
    ksort($months);
    $changes = [];
    foreach ((array)($state['changes'] ?? []) as $row) {
        if (is_array($row) && is_string($row['date'] ?? null) && preg_match('/^\d{4}-\d{2}-\d{2}$/D', $row['date']) === 1
            && is_string($row['label'] ?? null)) {
            $changes[] = ['date' => $row['date'], 'label' => $row['label']];
        }
    }
    usort($changes, function (array $a, array $b): int { return strcmp($a['date'], $b['date']); });
    return ['version' => 1, 'months' => $months, 'changes' => $changes];
}

function vg_metrics_save_outcomes(array $state): void
{
    vg_metrics_write_json(vg_metrics_dir() . '/outcomes.json', $state);
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
function vg_metrics_range(int $days, int $endOffset = 0, bool $test = false): array
{
    $out = [];
    for ($i = $days - 1; $i >= 0; $i--) {
        $day = vg_metrics_day($endOffset - $i);
        $out[$day] = is_file(vg_metrics_day_file($day, $test)) ? vg_metrics_load_day($day, $test) : null;
    }
    return $out;
}

/** Bir dönemin özet göstergeleri (ölçüm planı tabanı için de kullanılır). */
function vg_metrics_summary(array $days): array
{
    $ev = function (array $d, string $name): int { return (int)($d['ev'][$name] ?? 0); };
    $sum = ['days' => 0, 'pv' => 0, 'entries' => 0, 'organic' => 0, 'toolUse' => 0, 'toolResult' => 0, 'simOpen' => 0,
        'simRun' => 0, 'simResult' => 0, 'simErrors' => 0, 'tasks' => 0, 'reports' => 0, 'saves' => 0, 'ctaClicks' => 0,
        'quoteStart' => 0, 'quoteAccepted' => 0, 'quoteRejected' => 0, 'quoteFail' => 0, 'contactClicks' => 0,
        'newsletter' => 0, 'volthaber' => 0];
    $map = ['toolUse' => 'tool_use', 'toolResult' => 'tool_result', 'simOpen' => 'simulation_open', 'simRun' => 'simulation_run',
        'simResult' => 'simulation_result', 'simErrors' => 'simulation_error', 'tasks' => 'task_complete',
        'reports' => 'report_download', 'saves' => 'scenario_save', 'ctaClicks' => 'service_cta_click', 'quoteStart' => 'quote_start',
        'quoteAccepted' => 'quote_submit_success', 'quoteRejected' => 'quote_server_reject', 'quoteFail' => 'quote_submit_fail',
        'contactClicks' => 'contact_click', 'newsletter' => 'newsletter_subscribe', 'volthaber' => 'volthaber_view'];
    foreach ($days as $d) {
        if ($d === null) {
            continue;
        }
        $sum['days']++;
        $sum['pv'] += (int)$d['pv'];
        $sum['entries'] += (int)$d['entries'];
        $sum['organic'] += (int)($d['ref']['arama'] ?? 0);
        foreach ($map as $key => $name) {
            $sum[$key] += $ev($d, $name);
        }
    }
    return $sum;
}

/** Bir kovadaki gün dosyaları (eski → yeni). */
function vg_metrics_day_list(bool $test = false): array
{
    $days = [];
    foreach ((array)@glob(vg_metrics_subdir($test ? 'test-days' : 'days') . '/*.json') as $f) {
        if (is_string($f) && preg_match('/(\d{4}-\d{2}-\d{2})\.json$/', $f, $m) === 1) {
            $days[] = $m[1];
        }
    }
    sort($days);
    return $days;
}

/** En eski veri günü (ölçüm planının taban dönemini belirler); veri yoksa null. */
function vg_metrics_first_day(bool $test = false): ?string
{
    $days = vg_metrics_day_list($test);
    return $days ? $days[0] : null;
}

/** Olay sözlüğü sürüm 2'nin (huni olayları) ilk kaydedildiği gün; öncesinde huni adımları ölçülmüyordu. */
function vg_metrics_schema_since(bool $test = false): ?string
{
    foreach (vg_metrics_day_list($test) as $day) {
        $raw = vg_metrics_read_json(vg_metrics_day_file($day, $test), []);
        if (($raw['v'] ?? null) === 2) {
            return $day;
        }
    }
    return null;
}

/** "a|b|c" anahtarlı toplamı parçalara ayırır. */
function vg_metrics_split(array $map): array
{
    $out = [];
    foreach ($map as $key => $n) {
        $out[] = [explode('|', (string)$key), (int)$n];
    }
    return $out;
}

function vg_metrics_forms(array $agg): array
{
    $forms = [];
    $blank = function (): array {
        return ['start' => 0, 'accepted' => 0, 'rejected' => 0, 'fail' => 0, 'devices' => [], 'draft' => [], 'steps' => [],
            'errors' => [], 'abandon' => [], 'fails' => [], 'rejects' => [], 'subjects' => [], 'errorsByDevice' => [],
            'abandonByDevice' => []];
    };
    $add = function (array &$map, string $key, string $field, int $n) {
        $map[$key] = $map[$key] ?? ['start' => 0, 'accepted' => 0];
        $map[$key][$field] += $n;
    };
    foreach (VG_METRICS_FORMS as $form) {
        $forms[$form] = $blank();
    }
    foreach (vg_metrics_split($agg['q_start']) as [$k, $n]) {
        if (!isset($forms[$k[0]]) || count($k) < 3) {
            continue;
        }
        $forms[$k[0]]['start'] += $n;
        $add($forms[$k[0]]['devices'], $k[1], 'start', $n);
        $add($forms[$k[0]]['draft'], $k[2], 'start', $n);
    }
    foreach (vg_metrics_split($agg['q_ok']) as [$k, $n]) {
        if (!isset($forms[$k[0]]) || count($k) < 4) {
            continue;
        }
        $forms[$k[0]]['accepted'] += $n;
        $add($forms[$k[0]]['devices'], $k[1], 'accepted', $n);
        $add($forms[$k[0]]['draft'], $k[2], 'accepted', $n);
        $forms[$k[0]]['subjects'][$k[3]] = ($forms[$k[0]]['subjects'][$k[3]] ?? 0) + $n;
    }
    foreach (['q_step' => 'steps', 'q_err' => 'errors', 'q_ab' => 'abandon', 'q_fail' => 'fails', 'q_rej' => 'rejects'] as $dim => $field) {
        foreach (vg_metrics_split($agg[$dim]) as [$k, $n]) {
            if (isset($forms[$k[0]]) && isset($k[1])) {
                $forms[$k[0]][$field][$k[1]] = ($forms[$k[0]][$field][$k[1]] ?? 0) + $n;
                if (isset($k[2]) && ($field === 'errors' || $field === 'abandon')) {
                    $byDev = $field . 'ByDevice';
                    $forms[$k[0]][$byDev][$k[2]] = ($forms[$k[0]][$byDev][$k[2]] ?? 0) + $n;
                }
            }
        }
    }
    foreach ($forms as &$f) {
        $f['rejected'] = array_sum($f['rejects']);
        $f['fail'] = array_sum($f['fails']);
        foreach (['errors', 'abandon', 'fails', 'rejects', 'subjects'] as $field) {
            arsort($f[$field]);
        }
        ksort($f['steps']);
    }
    unset($f);
    return $forms;
}

/** Araç ve simülasyonlar tek listede: kullanım, sonuç, rapor/kaydetme ve (simülasyonda) hata sayıları. */
function vg_metrics_items(array $agg): array
{
    $items = [];
    $get = function (string $id, string $type) use (&$items): string {
        if (!isset($items[$id])) {
            $items[$id] = ['id' => $id, 'type' => $type, 'open' => 0, 'use' => 0, 'result' => 0, 'tasks' => 0, 'reports' => 0,
                'saves' => 0, 'errors' => 0];
        }
        return $id;
    };
    foreach (['sim_open' => 'open', 'sim_run' => 'use', 'sim_result' => 'result', 'task_done' => 'tasks'] as $dim => $field) {
        foreach ($agg[$dim] as $sim => $n) {
            $items[$get('sim-' . $sim, 'voltsim')][$field] += (int)$n;
        }
    }
    foreach (['tool' => 'use', 'tool_result' => 'result'] as $dim => $field) {
        foreach ($agg[$dim] as $tool => $n) {
            $items[$get((string)$tool, 'arac')][$field] += (int)$n;
        }
    }
    foreach (['report' => 'reports', 'save' => 'saves'] as $dim => $field) {
        foreach (vg_metrics_split($agg[$dim]) as [$k, $n]) {
            $items[$get($k[0], strpos($k[0], 'sim-') === 0 ? 'voltsim' : 'arac')][$field] += $n;
        }
    }
    foreach (vg_metrics_split($agg['sim_err']) as [$k, $n]) {
        $items[$get('sim-' . $k[0], 'voltsim')]['errors'] += $n;
    }
    unset($items['sim-' . VG_METRICS_OTHER]);
    $list = array_values($items);
    usort($list, function (array $a, array $b): int {
        return ($b['use'] + $b['open']) <=> ($a['use'] + $a['open']) ?: strcmp($a['id'], $b['id']);
    });
    return array_slice($list, 0, 40);
}

/** Teklif akışına geçiş sağlayan sayfalar: CTA tıklaması, teklif başlangıcının ve kabul edilen talebin kaynak sayfası. */
function vg_metrics_entry_pages(array $agg): array
{
    $pages = [];
    $add = function (string $page, string $field, int $n) use (&$pages) {
        $pages[$page] = $pages[$page] ?? ['page' => $page, 'cta' => 0, 'starts' => 0, 'accepted' => 0];
        $pages[$page][$field] += $n;
    };
    foreach (vg_metrics_split($agg['cta']) as [$k, $n]) {
        $add($k[0], 'cta', $n);
    }
    foreach (vg_metrics_split($agg['q_src']) as [$k, $n]) {
        if (isset($k[1])) {
            $add($k[1], 'starts', $n);
        }
    }
    foreach (vg_metrics_split($agg['q_ok_src']) as [$k, $n]) {
        if (isset($k[1])) {
            $add($k[1], 'accepted', $n);
        }
    }
    $list = array_values($pages);
    usort($list, function (array $a, array $b): int {
        return [$b['accepted'], $b['starts'], $b['cta']] <=> [$a['accepted'], $a['starts'], $a['cta']] ?: strcmp($a['page'], $b['page']);
    });
    return array_slice($list, 0, 30);
}

/**
 * Deney göstergeleri (api/METRICS.md "İyileştirme hipotezleri"). Paylar/paydalar sayı olarak döner; oran, gereken
 * örneklem ve anlamlılık istemcide önceden tanımlı ölçütlerle hesaplanır.
 */
function vg_metrics_exp(array $days): array
{
    $agg = array_fill_keys(['sec', 'cta', 'q_start', 'q_ok', 'q_ok_src', 'q_rej'], []);
    $out = ['days' => 0, 'simResult' => 0];
    foreach ($days as $d) {
        if ($d === null) {
            continue;
        }
        $out['days']++;
        $out['simResult'] += (int)($d['ev']['simulation_result'] ?? 0);
        foreach (array_keys($agg) as $dim) {
            vg_metrics_merge($agg[$dim], $d, $dim);
        }
    }
    $sumWhere = function (array $map, callable $keep): int {
        $n = 0;
        foreach (vg_metrics_split($map) as [$k, $c]) {
            $n += $keep($k) ? $c : 0;
        }
        return $n;
    };
    $isService = function (string $p): bool { return strpos($p, '/hizmetler/') === 0 && $p !== '/hizmetler/'; };
    return $out + [
        // H1: VoltSim/araç sonucu eklenmiş teklif talebi
        'draftStart' => $sumWhere($agg['q_start'], function ($k) { return ($k[2] ?? '') === 'sonuc'; }),
        'draftAccepted' => $sumWhere($agg['q_ok'], function ($k) { return ($k[2] ?? '') === 'sonuc'; }),
        'teklifRejected' => $sumWhere($agg['q_rej'], function ($k) { return $k[0] === 'teklif'; }),
        'teklifAccepted' => $sumWhere($agg['q_ok'], function ($k) { return $k[0] === 'teklif'; }),
        // H2: hizmet sayfaları
        'servicePv' => (int)($agg['sec']['hizmetler'] ?? 0),
        'serviceCta' => $sumWhere($agg['cta'], function ($k) use ($isService) { return $isService($k[0]); }),
        'serviceAccepted' => $sumWhere($agg['q_ok_src'], function ($k) use ($isService) { return $isService($k[1] ?? ''); }),
        // H3: mobil form
        'mobileStart' => $sumWhere($agg['q_start'], function ($k) { return ($k[1] ?? '') === 'mobil'; }),
        'mobileAccepted' => $sumWhere($agg['q_ok'], function ($k) { return ($k[1] ?? '') === 'mobil'; }),
        'desktopStart' => $sumWhere($agg['q_start'], function ($k) { return ($k[1] ?? '') === 'masaustu'; }),
        'desktopAccepted' => $sumWhere($agg['q_ok'], function ($k) { return ($k[1] ?? '') === 'masaustu'; })];
}

/**
 * Her hipotez (H1/H2/H3) için değişiklik kaydındaki ("change add <tarih> H2: ...") en son girişin öncesi ve sonrası:
 * 28 günlük eşit pencereler. Değişiklik kaydı yoksa yalnızca seçili aralığın değeri (taban) döner.
 */
function vg_metrics_experiments(array $range, array $changes, bool $test): array
{
    $out = [];
    $today = new DateTimeImmutable(vg_metrics_day() . ' 12:00:00', vg_metrics_tz());
    foreach (['H1', 'H2', 'H3'] as $h) {
        $change = null;
        foreach ($changes as $c) {
            if (stripos($c['label'], $h . ':') === 0 || stripos($c['label'], $h . ' ') === 0) {
                $change = $c;
            }
        }
        $row = ['id' => $h, 'change' => $change, 'current' => vg_metrics_exp($range), 'before' => null, 'after' => null, 'daysAfter' => 0];
        if ($change !== null) {
            $at = new DateTimeImmutable($change['date'] . ' 12:00:00', vg_metrics_tz());
            $since = (int)$at->diff($today)->format('%r%a');
            if ($since >= 0) {
                $row['before'] = vg_metrics_exp(vg_metrics_range(28, -$since - 1, $test));
                $after = min(28, $since + 1);
                $row['daysAfter'] = $after;
                $row['after'] = vg_metrics_exp(vg_metrics_range($after, -$since + $after - 1, $test));
            }
        }
        $out[] = $row;
    }
    return $out;
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
    $mode = $_GET['mode'] ?? 'live';
    if (!is_string($mode) || !in_array($mode, ['live', 'test'], true)) {
        vg_fail(422, 'invalid_mode', 'Geçersiz veri kümesi.');
    }
    $test = $mode === 'test';
    $range = vg_metrics_range($days, 0, $test);
    $series = [];
    $agg = array_fill_keys(VG_METRICS_DIMS, []);
    $bots = 0;
    $limited = 0;
    $missing = [];
    $sum = function (array $map): int { return array_sum(array_map('intval', $map)); };
    foreach ($range as $day => $d) {
        if ($d === null) {
            $missing[] = $day;
            $series[] = ['d' => $day, 'pv' => 0, 'en' => 0, 'use' => 0, 'res' => 0, 'qs' => 0, 'ok' => 0, 'cta' => 0, 'err' => 0, 'none' => true];
            continue;
        }
        $e = function (string $n) use ($d): int { return (int)($d['ev'][$n] ?? 0); };
        $series[] = ['d' => $day, 'pv' => (int)$d['pv'], 'en' => (int)$d['entries'],
            'use' => $e('tool_use') + $e('simulation_run'), 'res' => $e('tool_result') + $e('simulation_result'),
            'qs' => $e('quote_start'), 'ok' => $e('quote_submit_success'), 'cta' => $e('service_cta_click'), 'err' => $e('simulation_error')];
        foreach (VG_METRICS_DIMS as $dim) {
            vg_metrics_merge($agg[$dim], $d, $dim);
        }
        $bots += (int)$d['bots'];
        $limited += (int)$d['limited'];
    }
    $totals = vg_metrics_summary($range);
    $simErrors = [];
    foreach (vg_metrics_split($agg['sim_err']) as [$k, $n]) {
        $simErrors[] = ['sim' => $k[0], 'kind' => $k[1] ?? '', 'n' => $n];
    }
    usort($simErrors, function (array $a, array $b): int { return $b['n'] <=> $a['n']; });
    $contacts = array_fill_keys(VG_METRICS_CHANNELS, 0);
    foreach (vg_metrics_split($agg['contact']) as [$k, $n]) {
        if (isset($contacts[$k[0]])) {
            $contacts[$k[0]] += $n;
        }
    }

    $first = vg_metrics_first_day($test);
    $daysWithData = 0;
    $baseline = null;
    if ($first !== null) {
        $today = new DateTimeImmutable(vg_metrics_day() . ' 12:00:00', vg_metrics_tz());
        $start = new DateTimeImmutable($first . ' 12:00:00', vg_metrics_tz());
        $daysWithData = (int)$start->diff($today)->days + 1;
        if ($daysWithData >= 30) {
            // Taban: ölçümün ilk 30 günü. Karşılaştırmalar bu tabana göre yapılır; sabit sayı hedefi uydurulmaz.
            $offset = -((int)$start->diff($today)->days - 29);
            $baseline = vg_metrics_summary(vg_metrics_range(30, $offset, $test));
            $baseline['from'] = $first;
        }
    }
    $outcomes = vg_metrics_outcomes();
    return ['ok' => true, 'service' => VG_METRICS_SERVICE, 'mode' => $mode,
        'range' => ['days' => $days, 'from' => array_key_first($range), 'to' => vg_metrics_day()],
        'coverage' => ['firstDate' => $first, 'schemaSince' => vg_metrics_schema_since($test), 'daysInRange' => $days,
            'daysWithData' => $days - count($missing), 'missingDays' => count($missing), 'missingSample' => array_slice($missing, -10),
            'bots' => $bots, 'limited' => $limited, 'legacy' => $agg['legacy']],
        'firstDate' => $first, 'daysWithData' => $daysWithData,
        'series' => $series, 'totals' => $totals, 'bots' => $bots, 'limited' => $limited,
        'funnel' => [
            ['id' => 'content', 'n' => $totals['pv']],
            ['id' => 'use', 'n' => $totals['toolUse'] + $totals['simRun']],
            ['id' => 'result', 'n' => $totals['toolResult'] + $totals['simResult']],
            ['id' => 'quote_start', 'n' => $totals['quoteStart']],
            ['id' => 'accepted', 'n' => $totals['quoteAccepted']]],
        'items' => vg_metrics_items($agg), 'entryPages' => vg_metrics_entry_pages($agg), 'forms' => vg_metrics_forms($agg),
        'simErrors' => array_slice($simErrors, 0, 40), 'contacts' => $contacts,
        'outcomes' => $outcomes['months'] ?: null, 'changes' => $outcomes['changes'],
        'experiments' => vg_metrics_experiments($range, $outcomes['changes'], $test),
        'pages' => vg_metrics_top($agg['pages'], 25), 'sections' => vg_metrics_top($agg['sec'], 20),
        'ref' => $agg['ref'], 'se' => $agg['se'], 'dev' => $agg['dev'], 'volthaber' => vg_metrics_top($agg['vh'], 20),
        'kpi' => ['today' => vg_metrics_summary(vg_metrics_range(1, 0, $test)), 'last7' => vg_metrics_summary(vg_metrics_range(7, 0, $test)),
            'last30' => vg_metrics_summary(vg_metrics_range(30, 0, $test))],
        'plan' => ['baseline' => $baseline, 'current' => $daysWithData >= 60 ? vg_metrics_summary(vg_metrics_range(30, 0, $test)) : null],
        // Google Search Console bağlantısı yok: gösterim / tıklama verisi uydurulmaz.
        'searchConsole' => null];
}

/** Herkese açık: son 30 günün en çok kullanılan araçları (yalnızca canlı veri). Yeterli veri yoksa boş liste. */
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
        foreach ((array)$d['sim_run'] as $sim => $n) {
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

/** Günde bir kez: saklama süresini aşan gün dosyaları silinir (canlı 400 gün, test 30 gün). */
function vg_metrics_gc(): void
{
    $dir = vg_metrics_dir();
    $marker = $dir . '/gc.last';
    if (@file_get_contents($marker) === vg_metrics_day()) {
        return;
    }
    @file_put_contents($marker, vg_metrics_day());
    foreach (['days' => VG_METRICS_KEEP_DAYS, 'test-days' => VG_METRICS_TEST_KEEP_DAYS] as $sub => $keep) {
        $limit = vg_metrics_day(-$keep);
        foreach ((array)@glob($dir . '/' . $sub . '/*.json') as $file) {
            if (is_string($file) && preg_match('/(\d{4}-\d{2}-\d{2})\.json$/', $file, $m) === 1 && $m[1] < $limit) {
                @unlink($file);
            }
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

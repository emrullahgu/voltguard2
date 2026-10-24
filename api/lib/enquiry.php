<?php
/*
 * VoltGuard talep yardimcilari (contact.php): talep numarasi, tekrar gonderim korumasi (idempotency) ve
 * kullanicinin acikca ekledigi VoltSim ozeti. Teklif sihirbazi ve iletisim formu ayni uc noktayi kullanir.
 *
 * Tekrar gonderim: istemci her talep icin bir requestId uretir ve ayni talebi yeniden denerken ayni kimligi yollar.
 * Kimlik basina veri klasorundeki requests/ altinda (HMAC adli) kucuk bir kayit tutulur: talep numarasi, icerik ozeti
 * ve zaman. Kayit flock altinda okunur/yazilir; cift tiklama veya baglanti kopmasindan sonraki yeniden deneme ikinci
 * e-posta uretmez, ilk talep numarasi geri doner. Kayitta kisisel veri bulunmaz; 7 gun sonra silinir.
 */
declare(strict_types=1);

if (!defined('VG_API')) {
    http_response_code(404);
    exit;
}

const VG_ENQ_KEEP = 604800;                 // tekrar gonderim kaydi: 7 gun
const VG_ENQ_SIM_MAX = 16000;               // simulasyon ozeti JSON ust siniri (bayt)
/* Teklif akisina baglanan VoltSim modulleri (js/voltsim/core.js QUOTE ile ayni anahtarlar). */
const VG_ENQ_SIM_KINDS = ['trafo' => 'Trafo', 'pano' => 'Elektrik pano', 'komp' => 'Kompanzasyon', 'ges' => 'GES'];
const VG_ENQ_REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Turkiye telefonu: cep (5xx), sabit hat (2xx-4xx) veya 850; 0 / 90 / +90 onekli ya da oneksiz. */
function vg_enquiry_phone_ok(string $phone): bool
{
    if (strlen($phone) > 32 || preg_match('/^\+?[0-9 ()\-.]+$/D', $phone) !== 1) return false;
    $digits = (string)preg_replace('/\D+/', '', $phone);
    return preg_match('/^(?:90|0)?(?:[2-5][0-9]{9}|850[0-9]{7})$/D', $digits) === 1;
}

/** Istemcinin urettigi talep kimligi. Bos dize: eski istemci (tekrar gonderim korumasi yok). */
function vg_enquiry_request_id(string $value): string
{
    if ($value === '') return '';
    if (preg_match('/^[A-Za-z0-9_-]{16,64}$/D', $value) !== 1) {
        vg_fail(400, 'invalid_request', 'Form bilgisi eksik. Lütfen sayfayı yenileyip yeniden deneyin.');
    }
    return $value;
}

/** Tek satirlik, kontrol karakteri icermeyen metin; sinir asilirsa ya da metin degilse null. */
function vg_enquiry_line($value, int $max): ?string
{
    if (is_int($value) || is_float($value)) $value = (string)$value;
    if (!is_string($value) || preg_match('//u', $value) !== 1 || preg_match('/[\x00-\x1F\x7F]/', $value)) return null;
    $value = trim((string)preg_replace('/\s{2,}/u', ' ', $value));
    return vg_strlen($value) <= $max ? $value : null;
}

/**
 * Kullanicinin onayladigi simulasyon ozeti. Bos dize: ek yok. Bicim (istemci: js/vg-quote.js):
 * {v:1, kind, title, page, version, inputs:[[etiket, deger]], results:[[etiket, deger]], assumptions:[metin]}
 */
function vg_enquiry_simulation(string $raw, string $consent): ?array
{
    if ($raw === '') return null;
    if ($consent !== '1') {
        vg_fail(422, 'simulation_consent', 'Simülasyon bilgilerini eklemek için onay kutusunu işaretleyin ya da eki talepten çıkarın.');
    }
    $bad = static function (): void {
        vg_fail(422, 'invalid_simulation', 'Simülasyon özeti okunamadı. Eki talepten çıkarıp yeniden deneyin.');
    };
    if (strlen($raw) > VG_ENQ_SIM_MAX) $bad();
    $data = json_decode($raw, true, 6);
    if (!is_array($data) || ($data['v'] ?? null) !== 1 || !is_string($data['kind'] ?? null) || !isset(VG_ENQ_SIM_KINDS[$data['kind']])) $bad();
    $title = vg_enquiry_line($data['title'] ?? '', 120);
    $version = is_string($data['version'] ?? null) && preg_match('/^[0-9A-Za-z._-]{1,32}$/D', $data['version']) === 1 ? $data['version'] : null;
    $page = is_string($data['page'] ?? null) && preg_match('#^/voltsim/[a-z0-9-]{2,40}/$#D', $data['page']) === 1 ? $data['page'] : null;
    if ($title === null || $title === '' || $version === null || $page === null) $bad();
    $pairs = static function ($list, int $count) use ($bad): array {
        if (!is_array($list) || count($list) > $count || array_keys($list) !== range(0, count($list) - 1)) $bad();
        $out = [];
        foreach ($list as $row) {
            if (!is_array($row) || count($row) !== 2 || !array_key_exists(0, $row) || !array_key_exists(1, $row)) $bad();
            $label = vg_enquiry_line($row[0], 100);
            $value = vg_enquiry_line($row[1], 160);
            if ($label === null || $value === null || $label === '') $bad();
            $out[] = [$label, $value];
        }
        return $out;
    };
    $inputs = $pairs($data['inputs'] ?? null, 60);
    $results = $pairs($data['results'] ?? null, 40);
    $assumptions = [];
    $list = $data['assumptions'] ?? [];
    if (!is_array($list) || count($list) > 20) $bad();
    foreach ($list as $item) {
        $text = vg_enquiry_line($item, 300);
        if ($text === null) $bad();
        if ($text !== '') $assumptions[] = $text;
    }
    if (!$inputs && !$results) $bad();
    return ['kind' => $data['kind'], 'title' => $title, 'page' => $page, 'version' => $version,
        'inputs' => $inputs, 'results' => $results, 'assumptions' => $assumptions];
}

function vg_enquiry_simulation_text(array $sim): string
{
    $lines = ['Simülasyon özeti (ziyaretçi göndermeden önce gördü ve ekledi)',
        'Simülasyon: ' . VG_ENQ_SIM_KINDS[$sim['kind']] . ' – ' . $sim['title'],
        'Sayfa: ' . vg_site_url() . $sim['page'],
        'Hesaplama sürümü: ' . $sim['version'], ''];
    if ($sim['inputs']) {
        $lines[] = 'Seçilen girdiler:';
        foreach ($sim['inputs'] as $row) $lines[] = '- ' . $row[0] . ': ' . $row[1];
        $lines[] = '';
    }
    if ($sim['results']) {
        $lines[] = 'Sonuç özeti:';
        foreach ($sim['results'] as $row) $lines[] = '- ' . $row[0] . ': ' . $row[1];
        $lines[] = '';
    }
    if ($sim['assumptions']) {
        $lines[] = 'Varsayımlar:';
        foreach ($sim['assumptions'] as $text) $lines[] = '- ' . $text;
        $lines[] = '';
    }
    $lines[] = 'Not: Simülasyon ön değerlendirmedir; keşif ve ölçüm yapılmadan fiyat, tasarruf veya uygulama uygunluğu taahhüdü verilmez.';
    return implode("\n", $lines);
}

/** Ornek: VG-261024-7K3QX (TSI tarihi + 5 karakter; karisan 0/O, 1/I harfleri yok). */
function vg_enquiry_reference(): string
{
    try {
        $date = (new DateTime('now', new DateTimeZone('Europe/Istanbul')))->format('ymd');
    } catch (Throwable $e) {
        $date = gmdate('ymd');
    }
    $suffix = '';
    for ($i = 0; $i < 5; $i++) $suffix .= VG_ENQ_REF_CHARS[random_int(0, strlen(VG_ENQ_REF_CHARS) - 1)];
    return 'VG-' . $date . '-' . $suffix;
}

/**
 * Talebi en fazla bir kez teslim eder. $deliver(string $reference): void basarisizsa vg_fail ile cikar; kayit yalnizca
 * teslimden sonra yazilir. Ayni kimlik ayni icerikle tekrar gelirse ilk talep numarasi doner; farkli icerikle gelirse
 * 409 (degisiklikler sessizce kaybolmasin). Kilit, ayni anda gelen iki istegi siraya sokar.
 * @return array{reference: string, duplicate: bool}
 */
function vg_enquiry_once(string $requestId, string $fingerprint, callable $deliver): array
{
    if ($requestId === '') {
        $reference = vg_enquiry_reference();
        $deliver($reference);
        return ['reference' => $reference, 'duplicate' => false];
    }
    $base = vg_private_data_directory(vg_data_dir());
    $dir = vg_private_data_directory($base . '/requests', $base);
    $file = $dir . '/' . hash_hmac('sha256', 'enquiry' . "\0" . $requestId, vg_secret()) . '.json';
    $fp = @fopen($file, 'c+');
    if ($fp === false) vg_unavailable('request record cannot be opened');
    try {
        if (!flock($fp, LOCK_EX)) vg_unavailable('request record cannot be locked');
        $raw = stream_get_contents($fp);
        $record = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
        if (is_array($record) && is_string($record['reference'] ?? null) && is_string($record['fp'] ?? null)) {
            if (hash_equals($record['fp'], $fingerprint)) return ['reference' => $record['reference'], 'duplicate' => true];
            vg_fail(409, 'already_received', 'Bu talep ' . $record['reference'] . ' numarasıyla daha önce alındı. Yaptığınız değişiklikleri ayrı bir talep olarak iletmek için yeniden gönderin.',
                [], [], ['reference' => $record['reference']]);
        }
        $reference = vg_enquiry_reference();
        $deliver($reference);
        $encoded = vg_json_encode(['reference' => $reference, 'fp' => $fingerprint, 'at' => vg_now()]);
        /* Teslim edildi; kayit yazilamazsa talep yine alinmistir (yalnizca tekrar korumasi zayiflar). */
        if (!(rewind($fp) && ftruncate($fp, 0) && fwrite($fp, $encoded) === strlen($encoded) && fflush($fp))) {
            error_log('VoltGuard contact: request record write failed');
        }
        @chmod($file, 0600);
        return ['reference' => $reference, 'duplicate' => false];
    } finally {
        /* Teslim edilemeyen talebin bos kaydi silinmez: bekleyen ikinci istek ayni dosyayi kilitliyor olabilir (GC siler). */
        @flock($fp, LOCK_UN);
        fclose($fp);
    }
}

function vg_enquiry_schedule_gc(): void
{
    if (vg_gc_due('gc-requests')) vg_after_response('vg_enquiry_gc');
}

function vg_enquiry_gc(): void
{
    $dir = vg_data_dir() . '/requests';
    $dh = @opendir($dir);
    if ($dh === false) return;
    $start = microtime(true);
    $limit = time() - VG_ENQ_KEEP;
    while (($f = readdir($dh)) !== false) {
        if (microtime(true) - $start > VG_GC_BUDGET) break;
        if (substr($f, -5) !== '.json') continue;
        $mt = @filemtime($dir . '/' . $f);
        if ($mt !== false && $mt < $limit) @unlink($dir . '/' . $f);
    }
    closedir($dh);
}

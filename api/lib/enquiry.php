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

/** Resolve the same private directory for writers and GC; never traverse a requests symlink. */
function vg_enquiry_directory(bool $create): ?string
{
    $base = vg_private_data_directory(vg_data_dir());
    $candidate = $base . '/requests';
    clearstatcache(true, $candidate);
    $actual = realpath($candidate);
    $normalize = static function (string $path): string { return strtolower(rtrim(str_replace('\\', '/', $path), '/')); };
    // Windows junctions may not report is_link(); reject aliases even when their target is another private child.
    if (is_link($candidate) || ($actual !== false && $normalize($actual) !== $normalize($candidate))) {
        if ($create) vg_unavailable('request directory cannot be a symbolic link');
        return null;
    }
    if (!$create && !is_dir($candidate)) return null;
    return vg_private_data_directory($candidate, $base);
}

/** Both the opened handle and its current path must name the same regular, non-symlink file. */
function vg_enquiry_regular_handle($fp, string $file): bool
{
    clearstatcache(true, $file);
    if (is_link($file)) return false;
    $opened = fstat($fp);
    $named = @lstat($file);
    return is_array($opened) && is_array($named)
        && ($opened['mode'] & 0170000) === 0100000 && ($named['mode'] & 0170000) === 0100000
        && $opened['dev'] === $named['dev'] && $opened['ino'] === $named['ino'];
}

/**
 * Permanent coordination inode: writers hold SH before opening a record, including while waiting on its EX lock.
 * GC takes EX non-blocking, so it cannot detach an inode from an active or queued writer. Never unlink this file.
 * @return resource|null
 */
function vg_enquiry_coordination(string $dir, bool $gc = false)
{
    $file = $dir . '/.records.lock';
    clearstatcache(true, $file);
    if (is_link($file) || (file_exists($file) && !is_file($file))) {
        if (!$gc) vg_unavailable('request coordination file is invalid');
        return null;
    }
    // x+ creates without following a link; r+ never creates the target of a concurrently introduced dangling link.
    $fp = @fopen($file, 'x+');
    if ($fp === false) {
        clearstatcache(true, $file);
        if (!is_link($file) && is_file($file)) $fp = @fopen($file, 'r+');
    }
    if ($fp === false) {
        if (!$gc) vg_unavailable('request coordination file cannot be opened');
        return null;
    }
    if (!vg_enquiry_regular_handle($fp, $file) || !flock($fp, $gc ? LOCK_EX | LOCK_NB : LOCK_SH)) {
        fclose($fp);
        if (!$gc) vg_unavailable('request coordination file cannot be locked');
        return null;
    }
    if (!vg_enquiry_regular_handle($fp, $file)) {
        flock($fp, LOCK_UN);
        fclose($fp);
        if (!$gc) vg_unavailable('request coordination file changed');
        return null;
    }
    @chmod($file, 0600);
    return $fp;
}

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
    $dir = vg_enquiry_directory(true);
    $file = $dir . '/' . hash_hmac('sha256', 'enquiry' . "\0" . $requestId, vg_secret()) . '.json';
    $coordination = vg_enquiry_coordination($dir);
    $fp = null;
    try {
        clearstatcache(true, $file);
        if (is_link($file) || (file_exists($file) && !is_file($file))) vg_unavailable('request record is invalid');
        $fp = @fopen($file, 'c+');
        if ($fp === false) vg_unavailable('request record cannot be opened');
        if (!flock($fp, LOCK_EX)) vg_unavailable('request record cannot be locked');
        if (!vg_enquiry_regular_handle($fp, $file)) vg_unavailable('request record changed');
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
        /* Close the record before releasing SH, including failed delivery and a writer queued on its EX lock. */
        if (is_resource($fp)) {
            @flock($fp, LOCK_UN);
            fclose($fp);
        }
        @flock($coordination, LOCK_UN);
        fclose($coordination);
    }
}

function vg_enquiry_schedule_gc(): void
{
    if (vg_gc_due('gc-requests')) vg_after_response('vg_enquiry_gc');
}

function vg_enquiry_gc(): void
{
    try { $dir = vg_enquiry_directory(false); } catch (Throwable $error) { return; }
    if ($dir === null) return;
    $coordination = vg_enquiry_coordination($dir, true);
    if ($coordination === null) return;
    $dh = false;
    try {
        $dh = @opendir($dir);
        if ($dh === false) return;
        $start = microtime(true);
        $limit = time() - VG_ENQ_KEEP;
        while (($f = readdir($dh)) !== false) {
            if (microtime(true) - $start > VG_GC_BUDGET) break;
            if (preg_match('/^[a-f0-9]{64}\.json$/D', $f) !== 1) continue;
            $file = $dir . '/' . $f;
            clearstatcache(true, $file);
            if (is_link($file) || !is_file($file)) continue;
            $mt = @filemtime($file);
            if ($mt !== false && $mt < $limit) @unlink($file);
        }
    } finally {
        if (is_resource($dh)) closedir($dh);
        @flock($coordination, LOCK_UN);
        fclose($coordination);
    }
}

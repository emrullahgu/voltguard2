<?php
/** Public enquiry endpoint. PHP 7.4+, no optional extensions required. */
declare(strict_types=1);
define('VG_API', 1);
require __DIR__ . '/api/lib/bootstrap.php';
require __DIR__ . '/api/lib/security.php';
require __DIR__ . '/api/lib/validate.php';
require __DIR__ . '/api/lib/mailer.php';
require __DIR__ . '/api/lib/enquiry.php';
require __DIR__ . '/api/lib/metrics.php';
require __DIR__ . '/api/lib/turnstile.php';

function vg_contact_string(string $key): string
{
    $value = $_POST[$key] ?? '';
    if (!is_string($value) || preg_match('//u', $value) !== 1) {
        vg_fail(400, 'invalid_request', 'Gönderilen form okunamadı. Lütfen alanları kontrol edin.');
    }
    return trim($value);
}

/** Allow only the published site; additional staging origins require explicit configuration. */
function vg_contact_origin_allowed(string $url, bool $originOnly): bool
{
    $parts = parse_url($url);
    if (!is_array($parts) || !isset($parts['scheme'], $parts['host'])
        || isset($parts['user']) || isset($parts['pass']) || isset($parts['fragment'])
        || ($originOnly && (isset($parts['query']) || !in_array($parts['path'] ?? '', ['', '/'], true)))) return false;
    $scheme = strtolower($parts['scheme']);
    if (!in_array($scheme, ['http', 'https'], true)) return false;
    $origin = $scheme . '://' . strtolower($parts['host']);
    $port = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);
    if ($port !== ($scheme === 'https' ? 443 : 80)) $origin .= ':' . $port;
    $allowed = ['https://voltguard.com.tr', 'https://www.voltguard.com.tr'];
    $extra = getenv('VG_CONTACT_ALLOWED_ORIGINS');
    if (is_string($extra)) foreach (explode(',', $extra) as $value) $allowed[] = rtrim(trim($value), '/');
    return in_array($origin, $allowed, true);
}

/** Magaza talep niyetleri (iletisim.html magazaTalep.intent) ve e-posta konusundaki etiketleri. */
const VG_CONTACT_MAGAZA_INTENTS = ['teklif' => 'Teklif', 'proforma' => 'Proforma', 'nakliye' => 'Nakliye', 'alternatif' => 'Alternatif',
    'haber' => 'Haber ver', 'tedarik' => 'Tedarik', 'sepet' => 'Sepet teklifi'];
/** Sepet teklifinde satirin gosterilen fiyat dayanagi (js/magaza.js; api/lib/magaza.php vgm_price_display). */
const VG_CONTACT_MAGAZA_BASIS = ['verified' => 'doğrulanmış fiyat', 'list' => 'liste fiyatı, siparişte teyit edilir', 'last' => 'son doğrulanan fiyat, siparişte teyit edilir', 'none' => 'fiyat teklifle bildirilir'];

/**
 * Magaza talebi (P1-12): iletisim.html gizli "magazaTalep" alani, {"v":1,"intent","items":[{id,mpn,qty,url}],"q"}.
 * Sepet teklifi (intent "sepet", /magaza/sepet.html) satirlari ayrica urun adini (name), gosterilen KDV dahil birim TL
 * fiyatini (price; yoksa null), fiyat dayanagini (basis) ve nakliye haric fiyat isaretini (freight) tasir; bunlar bilgi amaclidir, fiyat teklifi personel verir.
 * Bicim bozuksa null (talep yine mesaj metniyle iletilir). Gecersiz satirlar atlanir; kimligi ve modeli olmayan satir
 * tutulmaz; en cok 40 satir. Kisisel veri tasimaz (urun kimligi, model, ad, adet, fiyat, urun adresi, aranan metin).
 */
function vg_contact_magaza_talep(string $raw): ?array
{
    if ($raw === '' || strlen($raw) > 16384) return null;
    $data = json_decode($raw, true, 6);
    if (!is_array($data) || ($data['v'] ?? null) !== 1 || !is_string($data['intent'] ?? null)
        || !isset(VG_CONTACT_MAGAZA_INTENTS[$data['intent']]) || !is_array($data['items'] ?? null)) return null;
    $items = [];
    foreach (array_slice(array_values($data['items']), 0, 40) as $it) {
        if (!is_array($it)) continue;
        $id = is_string($it['id'] ?? null) ? $it['id'] : '';
        $url = is_string($it['url'] ?? null) ? $it['url'] : '';
        $mpn = is_string($it['mpn'] ?? null) ? trim($it['mpn']) : '';
        $qty = $it['qty'] ?? null;
        if (($id !== '' && preg_match('/^vgm-[0-9]{4,6}$/D', $id) !== 1)
            || ($url !== '' && preg_match('#^/magaza/urun/[a-z0-9-]{3,90}/$#D', $url) !== 1)
            || !is_int($qty) || $qty < 1 || $qty > 99999
            || vg_strlen($mpn) > 80 || preg_match('/[\x00-\x1F\x7F<>]/', $mpn) === 1
            || ($id === '' && $mpn === '')) continue;
        $row = ['id' => $id, 'mpn' => $mpn, 'qty' => $qty, 'url' => $url];
        if ($data['intent'] === 'sepet') {
            $name = is_string($it['name'] ?? null) ? trim(preg_replace('/\s+/u', ' ', $it['name']) ?? '') : '';
            if (vg_strlen($name) > 160 || preg_match('/[\x00-\x1F\x7F<>]/', $name) === 1) $name = '';
            $price = $it['price'] ?? null;
            $price = (is_int($price) || is_float($price)) && $price > 0 && $price < 1e9 ? round((float)$price, 2) : null;
            $basis = is_string($it['basis'] ?? null) && isset(VG_CONTACT_MAGAZA_BASIS[$it['basis']]) ? $it['basis'] : 'none';
            if ($price === null) $basis = 'none';
            $row += ['name' => $name, 'price' => $price, 'basis' => $basis];
            /* Agir/hacimli urun (vgm_price reason "freight"): gosterilen fiyata nakliye dahil degildir. */
            if (($it['freight'] ?? null) === true) $row['freight'] = true;
        }
        $items[] = $row;
    }
    $q = is_string($data['q'] ?? null) ? trim($data['q']) : '';
    if (vg_strlen($q) > 80 || preg_match('/[\x00-\x1F\x7F<>]/', $q) === 1) $q = '';
    if (!$items && $q === '') return null;
    return ['v' => 1, 'intent' => $data['intent'], 'items' => $items, 'q' => $q];
}

/** E-posta govdesi icin magaza talebi bolumu (insan okunur satirlar + yapilandirilmis JSON). */
function vg_contact_magaza_text(array $t): string
{
    $lines = ['Mağaza talebi (' . VG_CONTACT_MAGAZA_INTENTS[$t['intent']] . '):'];
    foreach ($t['items'] as $i => $it) {
        $lines[] = ($i + 1) . '. ' . ($it['id'] !== '' ? $it['id'] : 'kimliksiz') . ($it['mpn'] !== '' ? ' · model ' . $it['mpn'] : '')
            . (($it['name'] ?? '') !== '' ? ' · ' . $it['name'] : '')
            . ' · adet ' . $it['qty']
            . (array_key_exists('basis', $it) ? ' · ' . ($it['price'] !== null ? number_format((float)$it['price'], 2, ',', '.') . ' TL (KDV dahil, ' . VG_CONTACT_MAGAZA_BASIS[$it['basis']] . (!empty($it['freight']) ? ', nakliye hariç' : '') . ')' : VG_CONTACT_MAGAZA_BASIS['none']) : '')
            . ($it['url'] !== '' ? ' · https://voltguard.com.tr' . $it['url'] : '');
    }
    if ($t['q'] !== '') $lines[] = 'Aranan: ' . $t['q'];
    $lines[] = 'Yapılandırılmış veri: ' . vg_json_encode($t);
    return implode("\n", $lines);
}

/** Magaza talep kaydi: ozel veri klasorunde aylik JSON satirlari (talep no, zaman, talep; kisisel veri yok). */
function vg_contact_magaza_store(string $reference, array $t): void
{
    try {
        $base = vg_private_data_directory(vg_data_dir());
        $dir = vg_private_data_directory($base . '/magaza-talep', $base);
        $file = $dir . '/' . gmdate('Y-m') . '.jsonl';
        if (is_file($file) && (int)@filesize($file) > 8388608) {
            error_log('VoltGuard contact: magaza talep log is full (' . basename($file) . ')');
            return;
        }
        if (@file_put_contents($file, vg_json_encode(['ref' => $reference, 'at' => vg_now()] + $t) . "\n", FILE_APPEND | LOCK_EX) === false) {
            error_log('VoltGuard contact: magaza talep record write failed');
        }
        @chmod($file, 0600);
    } catch (Throwable $e) {
        error_log('VoltGuard contact: magaza talep record failed (' . get_class($e) . ')');
    }
}

/**
 * Iletisim formu (kind=contact) ve teklif sihirbazi (kind=quote) ayni dogrulama, hiz siniri ve teslim yolunu kullanir.
 * Basari yaniti yalnizca e-posta gonderim sistemine (onizlemede outbox/) teslim edildikten sonra verilir ve talep
 * numarasi icerir; ayni requestId ile yeniden deneme ikinci e-posta uretmez (api/lib/enquiry.php).
 */
function vg_contact_submit(): array
{
    if (vg_method() !== 'POST') vg_fail(405, 'method_not_allowed', 'Bu adres yalnızca form gönderimi kabul eder.', [], ['Allow: POST']);
    vg_check_fetch_site();
    $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
    $referer = (string)($_SERVER['HTTP_REFERER'] ?? '');
    if (($origin !== '' && !vg_contact_origin_allowed($origin, true))
        || ($origin === '' && ($referer === '' || !vg_contact_origin_allowed($referer, false)))) {
        vg_fail(403, 'forbidden_origin', 'Formun gönderildiği adres doğrulanamadı. Lütfen site üzerindeki iletişim formunu kullanın.');
    }
    $type = strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''), 2)[0]));
    if (!in_array($type, ['application/x-www-form-urlencoded', 'multipart/form-data'], true)) {
        vg_fail(415, 'unsupported_media_type', 'İstek biçimi desteklenmiyor.');
    }
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 32768) vg_fail(413, 'too_large', 'Gönderilen form çok büyük.');
    if (!$_POST || $_FILES) vg_fail(400, 'invalid_request', 'Gönderilen form okunamadı.');
    $kind = vg_contact_string('kind') === 'quote' ? 'quote' : 'contact';
    $name = vg_contact_string('name');
    $phone = vg_contact_string('phone');
    $email = vg_contact_string('email');
    $subject = vg_contact_string('subject');
    $message = str_replace(["\r\n", "\r"], "\n", vg_contact_string('message'));
    $website = vg_contact_string('website');
    $timestamp = vg_contact_string('formTimestamp');
    $captcha = vg_contact_string('cf-turnstile-response');
    $requestId = vg_enquiry_request_id(vg_contact_string('requestId'));
    $subjects = ['elektrik' => 'Elektrik Hizmetleri', 'elektronik' => 'Elektronik ve Gömülü Sistemler',
        'otomasyon' => 'Otomasyon Sistemleri', 'mekanik' => 'Mekanik Sistemler', 'diger' => 'Diğer / Genel Danışmanlık',
        'magaza' => 'Mağaza / Ürün Teklifi'];
    if ($website !== '') vg_fail(422, 'rejected', 'Form gönderilemedi. Lütfen alanları kontrol edin.');
    if (vg_strlen($name) < 2 || vg_strlen($name) > 100 || preg_match('/[\x00-\x1F\x7F<>]/', $name)) {
        vg_fail(422, 'invalid_name', 'Lütfen geçerli bir ad soyad girin.');
    }
    /* Teklif talebinde telefon ya da e-postadan biri yeterli; iletişim formunda geri arama için telefon gerekir. */
    if (($phone !== '' || $kind === 'contact') && !vg_enquiry_phone_ok($phone)) {
        vg_fail(422, 'invalid_phone', 'Geçerli bir telefon numarası girin (cep veya sabit hat).');
    }
    if ($email !== '' && (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false || preg_match('/[\r\n]/', $email))) {
        vg_fail(422, 'invalid_email', 'Geçerli bir e-posta adresi girin.');
    }
    if ($phone === '' && $email === '') vg_fail(422, 'contact_required', 'Size ulaşabilmemiz için telefon veya e-posta adresinden birini yazın.');
    if (!isset($subjects[$subject])) vg_fail(422, 'invalid_subject', 'Lütfen hizmet alanını seçin.');
    if (vg_strlen($message) < 20 || vg_strlen($message) > 1000 || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $message)) {
        vg_fail(422, 'invalid_message', 'Mesaj 20–1000 karakter olmalı ve kontrol karakteri içermemeli.');
    }
    $simulation = $kind === 'quote' ? vg_enquiry_simulation(vg_contact_string('simulation'), vg_contact_string('simulationConsent')) : null;
    $talep = $subject === 'magaza' ? vg_contact_magaza_talep(vg_contact_string('magazaTalep')) : null;
    // The visitor's clock is untrusted; this is a form marker, never proof of human interaction.
    if (preg_match('/^[1-9][0-9]{0,15}$/D', $timestamp) !== 1) vg_fail(422, 'invalid_form', 'Form bilgisi eksik. Lütfen sayfayı yenileyip yeniden deneyin.');
    // A contact request does not require a general-purpose personal-data consent checkbox.
    // The privacy notice remains visible in the form; legacy consent=on is accepted but not required.
    vg_private_data_directory(vg_data_dir());
    vg_schedule_gc();
    vg_enquiry_schedule_gc();
    $preview = getenv('VG_MAIL_OUTBOX') === '1';
    $fingerprint = hash('sha256', vg_json_encode([$kind, $name, $phone, $email, $subject, $message, $simulation, $talep]));
    $label = $kind === 'quote' ? 'Teklif talebi' : 'İletişim talebi';
    $outcome = vg_enquiry_once($requestId, $fingerprint, function (string $reference) use ($name, $phone, $email, $subject, $subjects, $message, $captcha, $simulation, $talep, $label, $preview): void {
        $retry = vg_rl_hit('contact_ip', vg_rl_ip_key(), 5, 600);
        if ($retry > 0) vg_too_many($retry, 'Çok fazla mesaj gönderdiniz. Lütfen birkaç dakika sonra yeniden deneyin.');
        $turnstile = vg_turnstile_config();
        $captchaOn = $turnstile['secretKey'] !== '';
        /* Site-wide ceiling protects the mailbox from distributed floods; stricter while bot verification is off. */
        $global = vg_rl_hit('contact_global', 'all', $captchaOn ? 120 : 40, 3600);
        if ($global > 0) vg_too_many($global, 'Şu anda çok sayıda mesaj alınıyor. Lütfen biraz sonra tekrar deneyin veya bizi telefonla arayın.');
        if ($captchaOn) vg_turnstile_verify($turnstile, $captcha);
        elseif (!$preview) error_log('VoltGuard contact: TURNSTILE_SECRET_KEY is not configured; bot verification is off (see api/README.md)');
        if (!vg_mail_can_send()) vg_fail(503, 'mail_unavailable', 'Talebiniz şu anda iletilemedi. Lütfen telefonla iletişime geçin.');
        $body = "Yeni {$label} ({$reference}):\n\nAd Soyad: {$name}\nTelefon: " . ($phone ?: '-') . "\nE-posta: " . ($email ?: '-')
            . "\nHizmet Alanı: {$subjects[$subject]}\nTarih: " . vg_local_time(time()) . " (TSİ)\n\nMesaj:\n{$message}\n"
            . ($simulation ? "\n" . vg_enquiry_simulation_text($simulation) . "\n" : '')
            . ($talep ? "\n" . vg_contact_magaza_text($talep) . "\n" : '');
        $tag = $talep ? '[' . VG_CONTACT_MAGAZA_INTENTS[$talep['intent']] . '] ' : '';
        if (!vg_mail_send('info@voltguard.com.tr', 'VoltGuard ' . $label . ' ' . $reference . ' - ' . $tag . $subjects[$subject], $body, 'contact', $email ?: null)) {
            vg_fail(503, 'mail_unavailable', 'Talebiniz iletilemedi. Lütfen telefonla iletişime geçin.');
        }
        if ($talep) vg_contact_magaza_store($reference, $talep);
    });
    $ref = $outcome['reference'];
    $text = $preview
        ? "Önizleme sunucusu talebi kabul etti (talep no {$ref}). Bu önizlemede e-posta gönderilmez; gerçek talep için canlı sitedeki formu kullanın."
        : ($outcome['duplicate']
            ? "Bu talep daha önce {$ref} numarasıyla alınmıştı; tekrar kaydedilmedi. En kısa sürede sizinle iletişime geçeceğiz."
            : "Talebiniz {$ref} numarasıyla alındı. En kısa sürede sizinle iletişime geçeceğiz.");
    return ['message' => $text, 'reference' => $ref, 'duplicate' => $outcome['duplicate'], 'preview' => $preview];
}

ob_start();
try {
    $result = vg_contact_submit();
    vg_discard_output();
    vg_common_headers(200, []);
    echo vg_json_encode(['success' => true] + $result);
    // quote_submit_success yalnızca burada sayılır: talep kabul edildi ve teslim edildi (aynı requestId tekrarı sayılmaz).
    if (empty($result['duplicate'])) vg_after_response(function () { vg_metrics_contact_outcome(null); });
} catch (VgHttpError $error) {
    $code = $error->errCode;
    vg_after_response(function () use ($code) { vg_metrics_contact_outcome($code); });
    vg_discard_output();
    vg_common_headers($error->status, $error->headers);
    echo vg_json_encode(['success' => false, 'code' => $error->errCode, 'message' => $error->getMessage()]
        + array_intersect_key($error->extra, ['reference' => 1, 'retryAfter' => 1]));
} catch (Throwable $error) {
    error_log('VoltGuard contact: request failed (' . get_class($error) . ')');
    vg_discard_output();
    vg_common_headers(503, []);
    echo vg_json_encode(['success' => false, 'code' => 'unavailable', 'message' => 'Talep gönderimi şu anda kullanılamıyor. Lütfen telefonla iletişime geçin.']);
}
vg_finish_and_run_jobs();

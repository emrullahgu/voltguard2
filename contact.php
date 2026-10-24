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

/** Server verification is mandatory whenever Turnstile is configured. */
function vg_contact_verify_captcha(string $secret, string $token): void
{
    if ($token === '') {
        /* A configured secret with no token usually means the public site key in the HTML is still a placeholder,
           so no widget could be shown. Fail closed (spam protection stays on) but make the cause visible. */
        error_log('VoltGuard contact: Turnstile secret is set but the form sent no token (check data-sitekey in index.html, sor.html, fabrika-cozumleri.html)');
        vg_fail(422, 'captcha_required', 'Güvenlik doğrulaması yüklenemedi. Sayfayı yenileyip tekrar deneyin; sorun sürerse bizi telefonla veya info@voltguard.com.tr adresinden arayın.');
    }
    if (strlen($token) > 2048) {
        vg_fail(422, 'captcha_required', 'Lütfen güvenlik doğrulamasını tamamlayın.');
    }
    $payload = http_build_query(['secret' => $secret, 'response' => $token, 'remoteip' => vg_client_ip()]);
    $raw = false;
    $status = 0;
    if (function_exists('curl_init')) {
        $curl = curl_init('https://challenges.cloudflare.com/turnstile/v0/siteverify');
        if ($curl !== false) {
            curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $payload,
                CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 10,
                CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded']]);
            $raw = curl_exec($curl);
            $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
            curl_close($curl);
        }
    } else {
        $context = stream_context_create(['http' => ['method' => 'POST',
            'header' => "Content-Type: application/x-www-form-urlencoded\r\n", 'content' => $payload,
            'timeout' => 10, 'follow_location' => 0, 'ignore_errors' => true]]);
        $raw = @file_get_contents('https://challenges.cloudflare.com/turnstile/v0/siteverify', false, $context, 0, 16385);
        if (isset($http_response_header[0]) && preg_match('/\s([0-9]{3})\s/', $http_response_header[0], $match)) $status = (int)$match[1];
    }
    if (!is_string($raw) || strlen($raw) > 16384 || $status !== 200) {
        vg_fail(502, 'captcha_unavailable', 'Güvenlik doğrulama servisine erişilemedi. Lütfen yeniden deneyin.');
    }
    $result = json_decode($raw, true);
    $expected = strtolower(getenv('TURNSTILE_EXPECTED_HOSTNAME') ?: 'voltguard.com.tr');
    $host = is_array($result) && is_string($result['hostname'] ?? null) ? strtolower($result['hostname']) : '';
    if (!is_array($result) || ($result['success'] ?? null) !== true
        || !in_array($host, [$expected, 'www.' . $expected], true)) {
        vg_fail(422, 'captcha_invalid', 'Güvenlik doğrulaması geçersiz. Lütfen yeniden deneyin.');
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
        'otomasyon' => 'Otomasyon Sistemleri', 'mekanik' => 'Mekanik Sistemler', 'diger' => 'Diğer / Genel Danışmanlık'];
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
    // The visitor's clock is untrusted; this is a form marker, never proof of human interaction.
    if (preg_match('/^[1-9][0-9]{0,15}$/D', $timestamp) !== 1) vg_fail(422, 'invalid_form', 'Form bilgisi eksik. Lütfen sayfayı yenileyip yeniden deneyin.');
    // A contact request does not require a general-purpose personal-data consent checkbox.
    // The privacy notice remains visible in the form; legacy consent=on is accepted but not required.
    vg_private_data_directory(vg_data_dir());
    vg_schedule_gc();
    vg_enquiry_schedule_gc();
    $preview = getenv('VG_MAIL_OUTBOX') === '1';
    $fingerprint = hash('sha256', vg_json_encode([$kind, $name, $phone, $email, $subject, $message, $simulation]));
    $label = $kind === 'quote' ? 'Teklif talebi' : 'İletişim talebi';
    $outcome = vg_enquiry_once($requestId, $fingerprint, function (string $reference) use ($name, $phone, $email, $subject, $subjects, $message, $captcha, $simulation, $label, $preview): void {
        $retry = vg_rl_hit('contact_ip', vg_rl_ip_key(), 5, 600);
        if ($retry > 0) vg_too_many($retry, 'Çok fazla mesaj gönderdiniz. Lütfen birkaç dakika sonra yeniden deneyin.');
        $secret = getenv('TURNSTILE_SECRET_KEY');
        $captchaOn = is_string($secret) && $secret !== '' && $secret !== 'REPLACE_WITH_TURNSTILE_SECRET_KEY';
        /* Site-wide ceiling protects the mailbox from distributed floods; stricter while bot verification is off. */
        $global = vg_rl_hit('contact_global', 'all', $captchaOn ? 120 : 40, 3600);
        if ($global > 0) vg_too_many($global, 'Şu anda çok sayıda mesaj alınıyor. Lütfen biraz sonra tekrar deneyin veya bizi telefonla arayın.');
        if ($captchaOn) vg_contact_verify_captcha($secret, $captcha);
        elseif (!$preview) error_log('VoltGuard contact: TURNSTILE_SECRET_KEY is not configured; bot verification is off (see api/README.md)');
        if (!vg_mail_can_send()) vg_fail(503, 'mail_unavailable', 'Talebiniz şu anda iletilemedi. Lütfen telefonla iletişime geçin.');
        $body = "Yeni {$label} ({$reference}):\n\nAd Soyad: {$name}\nTelefon: " . ($phone ?: '-') . "\nE-posta: " . ($email ?: '-')
            . "\nHizmet Alanı: {$subjects[$subject]}\nTarih: " . vg_local_time(time()) . " (TSİ)\n\nMesaj:\n{$message}\n"
            . ($simulation ? "\n" . vg_enquiry_simulation_text($simulation) . "\n" : '');
        if (!vg_mail_send('info@voltguard.com.tr', 'VoltGuard ' . $label . ' ' . $reference . ' - ' . $subjects[$subject], $body, 'contact', $email ?: null)) {
            vg_fail(503, 'mail_unavailable', 'Talebiniz iletilemedi. Lütfen telefonla iletişime geçin.');
        }
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

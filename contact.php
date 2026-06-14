<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=UTF-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()');

function respond(int $statusCode, bool $success, string $message): void
{
    http_response_code($statusCode);
    echo json_encode([
        'success' => $success,
        'message' => $message,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, false, 'Method not allowed.');
}

$turnstileSecret = getenv('TURNSTILE_SECRET_KEY') ?: 'REPLACE_WITH_TURNSTILE_SECRET_KEY';

// Turnstile is OPTIONAL until keys are configured. When the secret is not set, the
// form still works but falls back to honeypot + server-side rate limiting + validation.
// As soon as TURNSTILE_SECRET_KEY is provided, CAPTCHA verification is enforced again.
$captchaConfigured = ($turnstileSecret !== 'REPLACE_WITH_TURNSTILE_SECRET_KEY' && $turnstileSecret !== '');
if (!$captchaConfigured) {
    error_log('VoltGuard contact.php: Turnstile not configured; proceeding without CAPTCHA (honeypot + rate limit active).');
}

/* --- Basic per-IP rate limiting (file-based, best-effort) --- */
$rateLimitMax = 5;          // allowed submissions
$rateLimitWindow = 600;     // per 10 minutes (seconds)
// Prefer the real client IP when the site is proxied (e.g. Cloudflare), so the
// rate-limit bucket is per-visitor rather than per-proxy.
$clientIp = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$rateDir = sys_get_temp_dir() . '/vg_rate';
if (!is_dir($rateDir)) {
    @mkdir($rateDir, 0700, true);
}
$rateFile = $rateDir . '/' . hash('sha256', $clientIp);
$nowTs = time();
$hits = [];
if (is_file($rateFile)) {
    $rawHits = @file_get_contents($rateFile);
    if (is_string($rawHits) && $rawHits !== '') {
        $decodedHits = json_decode($rawHits, true);
        if (is_array($decodedHits)) {
            $hits = array_values(array_filter($decodedHits, static function ($t) use ($nowTs, $rateLimitWindow) {
                return is_int($t) && ($nowTs - $t) < $rateLimitWindow;
            }));
        }
    }
}
if (count($hits) >= $rateLimitMax) {
    respond(429, false, 'Çok fazla deneme yaptınız. Lütfen birkaç dakika sonra tekrar deneyin.');
}
$hits[] = $nowTs;
@file_put_contents($rateFile, json_encode($hits), LOCK_EX);

$name = trim((string)($_POST['name'] ?? ''));
$phone = trim((string)($_POST['phone'] ?? ''));
$email = trim((string)($_POST['email'] ?? ''));
$subject = trim((string)($_POST['subject'] ?? ''));
$message = trim((string)($_POST['message'] ?? ''));
$consent = (string)($_POST['consent'] ?? '');
$websiteTrap = trim((string)($_POST['website'] ?? ''));
$formTimestamp = (int)($_POST['formTimestamp'] ?? 0);
$captchaToken = trim((string)($_POST['cf-turnstile-response'] ?? ''));

if ($websiteTrap !== '') {
    respond(200, true, 'Mesajınız alındı.');
}

if ($name === '' || $phone === '' || $subject === '' || $message === '') {
    respond(422, false, 'Lütfen zorunlu alanları doldurun.');
}

if (mb_strlen($name) > 100) {
    respond(422, false, 'Ad soyad çok uzun.');
}

$allowedSubjects = ['elektrik', 'elektronik', 'otomasyon', 'mekanik', 'diger'];
if (!in_array($subject, $allowedSubjects, true)) {
    respond(422, false, 'Geçersiz hizmet alanı seçimi.');
}

if ($consent !== 'on') {
    respond(422, false, 'KVKK onayı gereklidir.');
}

if (mb_strlen($message) < 20 || mb_strlen($message) > 1000) {
    respond(422, false, 'Mesaj uzunluğu 20-1000 karakter arasında olmalıdır.');
}

$phoneDigits = preg_replace('/\D+/', '', $phone);
$validPhone = false;
if ($phoneDigits !== null) {
    $validPhone = (
        (strlen($phoneDigits) === 10 && str_starts_with($phoneDigits, '5')) ||
        (strlen($phoneDigits) === 11 && str_starts_with($phoneDigits, '05')) ||
        (strlen($phoneDigits) === 12 && str_starts_with($phoneDigits, '905'))
    );
}

if (!$validPhone) {
    respond(422, false, 'Geçerli bir telefon numarası giriniz.');
}

if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(422, false, 'Geçerli bir e-posta adresi giriniz.');
}

$nowMs = (int)floor(microtime(true) * 1000);
$formAge = $nowMs - $formTimestamp;
/* Allow up to ~2 minutes of client/server clock skew ($formAge may be slightly negative),
   and reject only clearly invalid timestamps (missing or older than 24h). The "submitted
   too fast" heuristic is dropped: it is client-controlled (no real bot value) and caused
   false rejections for users whose device clock is ahead. Real bot defense is Turnstile +
   the server-side rate limit above. */
if ($formTimestamp <= 0 || $formAge < -120000 || $formAge > 86400000) {
    respond(422, false, 'Form doğrulaması başarısız oldu. Lütfen tekrar deneyin.');
}

if ($captchaConfigured) {

if ($captchaToken === '') {
    respond(422, false, 'Lütfen güvenlik doğrulamasını tamamlayın.');
}

$verifyPayload = http_build_query([
    'secret' => $turnstileSecret,
    'response' => $captchaToken,
    'remoteip' => ($clientIp !== 'unknown' ? $clientIp : ''),
]);

$verifyRaw = false;

if (function_exists('curl_init')) {
    $ch = curl_init('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $verifyPayload);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    $verifyRaw = curl_exec($ch);
    curl_close($ch);
} else {
    $opts = [
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
            'content' => $verifyPayload,
            'timeout' => 10,
        ],
    ];
    $context = stream_context_create($opts);
    $verifyRaw = @file_get_contents('https://challenges.cloudflare.com/turnstile/v0/siteverify', false, $context);
}

if ($verifyRaw === false) {
    respond(502, false, 'Güvenlik doğrulama servisine erişilemedi.');
}

$verifyResult = json_decode($verifyRaw, true);
if (!is_array($verifyResult) || empty($verifyResult['success'])) {
    if (is_array($verifyResult) && !empty($verifyResult['error-codes'])) {
        error_log('VoltGuard contact.php: Turnstile errors: ' . implode(',', (array)$verifyResult['error-codes']));
    }
    respond(422, false, 'Güvenlik doğrulaması geçersiz. Lütfen tekrar deneyin.');
}

/* Bind the token to our hostname (defense against token reuse from another origin).
   Only enforced when Cloudflare returns a hostname; configurable via env. */
$expectedHost = getenv('TURNSTILE_EXPECTED_HOSTNAME') ?: 'voltguard.com.tr';
$verifiedHost = isset($verifyResult['hostname']) ? (string)$verifyResult['hostname'] : '';
if ($verifiedHost !== '' && $expectedHost !== ''
    && strcasecmp($verifiedHost, $expectedHost) !== 0
    && strcasecmp($verifiedHost, 'www.' . $expectedHost) !== 0) {
    error_log('VoltGuard contact.php: Turnstile hostname mismatch: ' . $verifiedHost);
    respond(422, false, 'Güvenlik doğrulaması geçersiz. Lütfen tekrar deneyin.');
}

} // end if ($captchaConfigured)

$subjectMap = [
    'elektrik' => 'Elektrik Hizmetleri',
    'elektronik' => 'Elektronik ve Gömülü Sistemler',
    'otomasyon' => 'Otomasyon Sistemleri',
    'mekanik' => 'Mekanik Sistemler',
    'diger' => 'Diğer / Genel Danışmanlık',
];
$subjectLabel = $subjectMap[$subject] ?? $subject;

$safeName = str_replace(["\r", "\n"], ' ', $name);
$safeEmail = str_replace(["\r", "\n"], '', $email);
$safePhone = str_replace(["\r", "\n"], ' ', $phone);

$mailTo = 'info@voltguard.com.tr';
$mailSubject = 'VoltGuard İletişim Formu - ' . $subjectLabel;
$mailBody = "Yeni iletişim formu mesajı:\n\n"
    . "Ad Soyad: {$safeName}\n"
    . "Telefon: {$safePhone}\n"
    . "E-posta: " . ($safeEmail !== '' ? $safeEmail : '-') . "\n"
    . "Hizmet Alanı: {$subjectLabel}\n"
    . "IP: " . $clientIp . "\n"
    . "Tarih: " . date('Y-m-d H:i:s') . "\n\n"
    . "Mesaj:\n{$message}\n";

$fromAddress = 'noreply@voltguard.com.tr';
$mailHeaders = [
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'From: VoltGuard <' . $fromAddress . '>',
    'Reply-To: ' . ($safeEmail !== '' ? $safeEmail : $fromAddress),
    'X-Mailer: PHP/' . phpversion(),
];

$mailSent = @mail($mailTo, '=?UTF-8?B?' . base64_encode($mailSubject) . '?=', $mailBody, implode("\r\n", $mailHeaders));

if (!$mailSent) {
    // Persist the lead to the server log so it is recoverable if mail delivery failed.
    error_log(sprintf(
        'VoltGuard contact.php: mail() failed; lead not delivered. Name=%s Phone=%s Email=%s Subject=%s',
        $safeName,
        $safePhone,
        ($safeEmail !== '' ? $safeEmail : '-'),
        $subjectLabel
    ));
    respond(500, false, 'Mesaj gönderilemedi. Lütfen telefon ile iletişime geçin.');
}

respond(200, true, 'Mesajınız alındı. En kısa sürede sizinle iletişime geçeceğiz.');

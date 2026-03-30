<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=UTF-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
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

if ($turnstileSecret === 'REPLACE_WITH_TURNSTILE_SECRET_KEY') {
    respond(500, false, 'Turnstile secret key is not configured on server.');
}

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
if ($formTimestamp <= 0 || ($nowMs - $formTimestamp) < 2500 || ($nowMs - $formTimestamp) > 86400000) {
    respond(422, false, 'Form doğrulaması başarısız oldu. Lütfen tekrar deneyin.');
}

if ($captchaToken === '') {
    respond(422, false, 'Lütfen güvenlik doğrulamasını tamamlayın.');
}

$verifyPayload = http_build_query([
    'secret' => $turnstileSecret,
    'response' => $captchaToken,
    'remoteip' => $_SERVER['REMOTE_ADDR'] ?? '',
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
    respond(422, false, 'Güvenlik doğrulaması geçersiz. Lütfen tekrar deneyin.');
}

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

$mailTo = 'info@voltguard.com.tr';
$mailSubject = 'VoltGuard İletişim Formu - ' . $subjectLabel;
$mailBody = "Yeni iletişim formu mesajı:\n\n"
    . "Ad Soyad: {$safeName}\n"
    . "Telefon: {$phone}\n"
    . "E-posta: " . ($safeEmail !== '' ? $safeEmail : '-') . "\n"
    . "Hizmet Alanı: {$subjectLabel}\n"
    . "IP: " . ($_SERVER['REMOTE_ADDR'] ?? '-') . "\n"
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
    respond(500, false, 'Mesaj gönderilemedi. Lütfen telefon ile iletişime geçin.');
}

respond(200, true, 'Mesajınız alındı. En kısa sürede sizinle iletişime geçeceğiz.');

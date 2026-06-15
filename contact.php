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

/* IPv4/IPv6 CIDR eşleşmesi (inet_pton + bit maskesi). */
function vg_ip_in_cidr(string $ip, string $cidr): bool
{
    if (strpos($cidr, '/') === false) {
        return false;
    }
    [$subnet, $bits] = explode('/', $cidr, 2);
    $bits = (int)$bits;
    $ipBin = @inet_pton($ip);
    $subBin = @inet_pton($subnet);
    if ($ipBin === false || $subBin === false || strlen($ipBin) !== strlen($subBin)) {
        return false;
    }
    $bytes = intdiv($bits, 8);
    $rem = $bits % 8;
    if ($bytes > 0 && strncmp($ipBin, $subBin, $bytes) !== 0) {
        return false;
    }
    if ($rem === 0) {
        return true;
    }
    $mask = 0xff << (8 - $rem) & 0xff;
    return (ord($ipBin[$bytes]) & $mask) === (ord($subBin[$bytes]) & $mask);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, false, 'Method not allowed.');
}

/* Cross-origin POST koruması (defense-in-depth): Origin/Referer mevcutsa host eşleşmeli.
   Hiç gönderilmediğinde (eski tarayıcı/privacy) reddetme — yalnızca yanlış host'u reddet. */
$allowedHosts = ['voltguard.com.tr', 'www.voltguard.com.tr'];
$reqOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
$refHost = $reqOrigin !== ''
    ? parse_url($reqOrigin, PHP_URL_HOST)
    : parse_url((string)($_SERVER['HTTP_REFERER'] ?? ''), PHP_URL_HOST);
if (is_string($refHost) && $refHost !== '' && !in_array(strtolower($refHost), $allowedHosts, true)) {
    respond(403, false, 'Geçersiz istek kaynağı.');
}

/* İstek gövdesi boyutu üst sınırı. post_max_size aşıldığında $_POST boş gelir;
   bunu ayrıca yakalayıp yanıltıcı "zorunlu alan" hatası yerine net mesaj döneriz. */
$contentLength = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
if ($contentLength > 32768 || (empty($_POST) && $contentLength > 0)) {
    respond(413, false, 'İstek çok büyük.');
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
// CF-Connecting-IP başlığına YALNIZCA istek gerçek bir Cloudflare IP aralığından
// geliyorsa güven; aksi halde başlık istemci tarafından sahte gönderilip rate-limit
// kovası ve Turnstile remoteip atlatılabilir. Liste: https://www.cloudflare.com/ips/
$cfRanges = [
    '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
    '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
    '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
    '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
    '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
    '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];
$remoteAddr = $_SERVER['REMOTE_ADDR'] ?? '';
$cfHeaderIp = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? '';
$isFromCloudflare = false;
if ($remoteAddr !== '') {
    foreach ($cfRanges as $range) {
        if (vg_ip_in_cidr($remoteAddr, $range)) {
            $isFromCloudflare = true;
            break;
        }
    }
}
if ($isFromCloudflare && $cfHeaderIp !== '' && filter_var($cfHeaderIp, FILTER_VALIDATE_IP)) {
    $clientIp = $cfHeaderIp;
} elseif ($remoteAddr !== '') {
    $clientIp = $remoteAddr;
} else {
    $clientIp = 'unknown';
}
$rateDir = sys_get_temp_dir() . '/vg_rate';
if (!is_dir($rateDir)) {
    @mkdir($rateDir, 0700, true);
}
$rateFile = $rateDir . '/' . hash('sha256', $clientIp);
$nowTs = time();
// Tek tutamaç üzerinde flock ile atomik oku-değiştir-yaz: eşzamanlı isteklerin
// aynı eski sayacı okuyup limiti aşmasını (TOCTOU) engeller.
$rateFp = @fopen($rateFile, 'c+');
if ($rateFp !== false && flock($rateFp, LOCK_EX)) {
    $rawHits = stream_get_contents($rateFp);
    $hits = [];
    if (is_string($rawHits) && $rawHits !== '') {
        $decodedHits = json_decode($rawHits, true);
        if (is_array($decodedHits)) {
            $hits = array_values(array_filter($decodedHits, static function ($t) use ($nowTs, $rateLimitWindow) {
                return is_int($t) && ($nowTs - $t) < $rateLimitWindow;
            }));
        }
    }
    if (count($hits) >= $rateLimitMax) {
        flock($rateFp, LOCK_UN);
        fclose($rateFp);
        respond(429, false, 'Çok fazla deneme yaptınız. Lütfen birkaç dakika sonra tekrar deneyin.');
    }
    $hits[] = $nowTs;
    rewind($rateFp);
    ftruncate($rateFp, 0);
    fwrite($rateFp, json_encode($hits));
    fflush($rateFp);
    flock($rateFp, LOCK_UN);
    fclose($rateFp);
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

if (mb_strlen($name) < 2 || mb_strlen($name) > 100) {
    respond(422, false, 'Lütfen geçerli bir ad soyad giriniz.');
}

if (mb_strlen($phone) > 32) {
    respond(422, false, 'Geçerli bir telefon numarası giriniz.');
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

// CRLF + diğer kontrol karakterlerini temizle (mail gövdesi/başlık ve log hijyeni).
$cleanCtrl = static function (string $v): string {
    // Bayt düzeyinde (u bayrağı yok): kontrol baytları ASCII tek bayttır, çok baytlı
    // UTF-8 dizilerini (>=0x80) etkilemez; geçersiz UTF-8'de veri kaybı riski olmaz.
    return (string)preg_replace('/[\x00-\x1F\x7F]/', ' ', $v);
};
$safeName = $cleanCtrl($name);
$safeEmail = str_replace(["\r", "\n", "\t"], '', $email);
$safePhone = $cleanCtrl($phone);

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
    // Mesaj gövdesini de logla ki mail teslimi başarısız olsa bile lead kurtarılabilsin.
    error_log(sprintf(
        'VoltGuard contact.php: mail() failed; lead not delivered. Name=%s Phone=%s Email=%s Subject=%s Message=%.500s',
        $safeName,
        $safePhone,
        ($safeEmail !== '' ? $safeEmail : '-'),
        $subjectLabel,
        $cleanCtrl($message)
    ));
    respond(500, false, 'Mesaj gönderilemedi. Lütfen telefon ile iletişime geçin.');
}

respond(200, true, 'Mesajınız alındı. En kısa sürede sizinle iletişime geçeceğiz.');

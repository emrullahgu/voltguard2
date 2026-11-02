<?php
declare(strict_types=1);
if (!defined('VG_API')) { http_response_code(404); exit; }

/** Configuration errors never include the private file contents or credentials. */
function vg_turnstile_configuration_invalid(): void
{
    vg_fail(503, 'configuration_invalid', 'Güvenlik doğrulaması yapılandırılamadı. Lütfen daha sonra yeniden deneyin.');
}

function vg_turnstile_secret_value($value): string
{
    if (!is_string($value)) vg_turnstile_configuration_invalid();
    $value = trim($value);
    if ($value === '' || strlen($value) > 4096 || preg_match('/[\x00-\x20\x7f]/', $value)
        || $value === 'REPLACE_WITH_TURNSTILE_SECRET_KEY') vg_turnstile_configuration_invalid();
    return $value;
}

function vg_turnstile_hostname_value($value): string
{
    if (!is_string($value)) vg_turnstile_configuration_invalid();
    $value = strtolower(trim($value));
    if (strlen($value) > 253 || !preg_match('/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/D', $value)) {
        vg_turnstile_configuration_invalid();
    }
    return $value;
}

/** Read only the dedicated bounded, regular file in the resolved private storage root. */
function vg_turnstile_file_config(): array
{
    $base = vg_private_data_directory(vg_data_dir());
    $file = $base . '/turnstile-config.json';
    clearstatcache(true, $file);
    if (is_link($file)) vg_turnstile_configuration_invalid();
    if (!file_exists($file)) return [];
    $actual = realpath($file);
    if (!is_file($file) || $actual === false
        || strtolower(str_replace('\\', '/', dirname($actual))) !== strtolower($base)) vg_turnstile_configuration_invalid();
    $handle = @fopen($file, 'rb');
    if ($handle === false) vg_turnstile_configuration_invalid();
    $raw = false;
    try {
        $info = fstat($handle);
        if (!is_array($info) || ($info['mode'] & 0170000) !== 0100000 || $info['size'] > 8192
            || !flock($handle, LOCK_SH)) vg_turnstile_configuration_invalid();
        $raw = stream_get_contents($handle, 8193);
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
    if (!is_string($raw) || strlen($raw) > 8192) vg_turnstile_configuration_invalid();
    $settings = json_decode($raw);
    if (!$settings instanceof stdClass
        || array_diff(array_keys(get_object_vars($settings)), ['secretKey', 'expectedHostname'])
        || !property_exists($settings, 'secretKey')) vg_turnstile_configuration_invalid();
    $config = ['secretKey' => vg_turnstile_secret_value($settings->secretKey)];
    if (property_exists($settings, 'expectedHostname')) {
        $config['expectedHostname'] = vg_turnstile_hostname_value($settings->expectedHostname);
    }
    return $config;
}

/** Environment values override the private file; an invalid configured file always fails closed. */
function vg_turnstile_config(): array
{
    $config = vg_turnstile_file_config();
    $secret = getenv('TURNSTILE_SECRET_KEY');
    if (is_string($secret) && trim($secret) !== '' && $secret !== 'REPLACE_WITH_TURNSTILE_SECRET_KEY') {
        $config['secretKey'] = vg_turnstile_secret_value($secret);
    }
    $hostname = getenv('TURNSTILE_EXPECTED_HOSTNAME');
    if (is_string($hostname) && trim($hostname) !== '') {
        $config['expectedHostname'] = vg_turnstile_hostname_value($hostname);
    }
    if (in_array($config['secretKey'] ?? '', [
        '1x0000000000000000000000000000000AA',
        '2x0000000000000000000000000000000AA',
        '3x0000000000000000000000000000000AA',
    ], true) && getenv('VG_MAIL_OUTBOX') !== '1') vg_turnstile_configuration_invalid();
    return ['secretKey' => $config['secretKey'] ?? '', 'expectedHostname' => $config['expectedHostname'] ?? 'voltguard.com.tr'];
}

/** Return zero before retaining an oversized chunk, which aborts the cURL transfer. */
function vg_turnstile_append_response(string &$body, string $chunk): int
{
    $length = strlen($chunk);
    if (strlen($body) + $length > 16384) return 0;
    $body .= $chunk;
    return $length;
}

/** Fixed HTTPS endpoint; credentials cannot be redirected to another host. */
function vg_turnstile_request(string $payload): array
{
    $raw = false;
    $status = 0;
    $url = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        if ($curl !== false) {
            $body = '';
            $headerBytes = 0;
            curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $payload,
                CURLOPT_RETURNTRANSFER => false, CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 10,
                CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
                CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
                CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$headerBytes): int {
                    $length = strlen($line);
                    $headerBytes += $length;
                    return $headerBytes <= 32768 ? $length : 0;
                },
                CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body): int {
                    return vg_turnstile_append_response($body, $chunk);
                }]);
            $ok = curl_exec($curl);
            $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
            curl_close($curl);
            if ($ok !== false) $raw = $body;
        }
    } else {
        $context = stream_context_create(['http' => ['method' => 'POST',
            'header' => "Content-Type: application/x-www-form-urlencoded\r\n", 'content' => $payload,
            'timeout' => 10, 'follow_location' => 0, 'ignore_errors' => true],
            'ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
        $raw = @file_get_contents($url, false, $context, 0, 16385);
        if (isset($http_response_header[0]) && preg_match('/\s([0-9]{3})\s/', $http_response_header[0], $match)) $status = (int)$match[1];
    }
    return ['body' => $raw, 'status' => $status];
}

/** Pure response validation also makes provider failures reproducible without a network request. */
function vg_turnstile_validate_response($raw, int $status, string $expectedHostname): void
{
    if (!is_string($raw) || strlen($raw) > 16384 || $status !== 200) {
        vg_fail(502, 'captcha_unavailable', 'Güvenlik doğrulama servisine erişilemedi. Lütfen yeniden deneyin.');
    }
    $result = json_decode($raw, true);
    if (!is_array($result) || !is_bool($result['success'] ?? null)) {
        vg_fail(502, 'captcha_unavailable', 'Güvenlik doğrulama servisinin yanıtı doğrulanamadı. Lütfen yeniden deneyin.');
    }
    $expected = vg_turnstile_hostname_value($expectedHostname);
    if (strpos($expected, 'www.') === 0) $expected = substr($expected, 4);
    $host = is_string($result['hostname'] ?? null) ? strtolower($result['hostname']) : '';
    if ($result['success'] !== true || !in_array($host, [$expected, 'www.' . $expected], true)) {
        vg_fail(422, 'captcha_invalid', 'Güvenlik doğrulaması geçersiz. Lütfen yeniden deneyin.');
    }
}

/** Server verification is mandatory whenever a secret is configured. */
function vg_turnstile_verify(array $config, string $token): void
{
    if ($token === '') {
        error_log('VoltGuard contact: Turnstile is configured but no token was sent (check data-sitekey in iletisim.html, sor.html, fabrika-cozumleri.html)');
        vg_fail(422, 'captcha_required', 'Güvenlik doğrulaması yüklenemedi. Sayfayı yenileyip tekrar deneyin; sorun sürerse bizi telefonla veya info@voltguard.com.tr adresinden arayın.');
    }
    if (strlen($token) > 2048) vg_fail(422, 'captcha_required', 'Lütfen güvenlik doğrulamasını tamamlayın.');
    $response = vg_turnstile_request(http_build_query(['secret' => $config['secretKey'], 'response' => $token, 'remoteip' => vg_client_ip()]));
    vg_turnstile_validate_response($response['body'], $response['status'], $config['expectedHostname']);
}

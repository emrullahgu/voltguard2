<?php
/** Private CLI-only synthetic HMAC/TLS/config contract. No external services or real business data. */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
define('VG_API', 1);
$root = dirname(__DIR__, 2);
require $root . '/api/lib/bootstrap.php';
require $root . '/api/lib/security.php';
require $root . '/api/lib/staff.php';
require $root . '/api/lib/company.php';
$checks = 0;
function https_check($actual, $expected, string $message): void {
    global $checks;
    if ($actual !== $expected) throw new RuntimeException($message);
    $checks++;
}
function https_reject(callable $action, ?string $code, string $message): void {
    try { $action(); }
    catch (Throwable $error) {
        if ($code !== null) {
            https_check($error instanceof VgHttpError, true, $message . ' controlled status');
            https_check($error->errCode, $code, $message . ' code');
        }
        global $checks; $checks++; return;
    }
    throw new RuntimeException($message . ' was accepted');
}
function https_headers(array $lines): array {
    $headers = [];
    foreach ($lines as $line) { [$key, $value] = explode(':', $line, 2); $headers[strtolower($key)] = trim($value); }
    return $headers;
}

// Exercise the real cURL option path without network access in this isolated
// -n process. This does not define an application hook or relax TLS verification.
if (!function_exists('curl_init')) {
    foreach (['CURLOPT_POST','CURLOPT_POSTFIELDS','CURLOPT_HTTPHEADER','CURLOPT_CONNECTTIMEOUT','CURLOPT_TIMEOUT','CURLOPT_FOLLOWLOCATION','CURLOPT_MAXREDIRS','CURLOPT_SSL_VERIFYPEER','CURLOPT_SSL_VERIFYHOST','CURLOPT_PROTOCOLS','CURLOPT_REDIR_PROTOCOLS','CURLOPT_WRITEFUNCTION','CURLOPT_HEADERFUNCTION','CURLINFO_RESPONSE_CODE','CURLPROTO_HTTPS'] as $index => $name) if (!defined($name)) define($name, 10000 + $index);
    function curl_init($endpoint) { $GLOBALS['https_curl_endpoint'] = $endpoint; return (object)[]; }
    function curl_setopt_array($handle, $options) { $GLOBALS['https_curl_options'] = $options; return true; }
    function curl_exec($handle) { ($GLOBALS['https_curl_options'][CURLOPT_WRITEFUNCTION])($handle, '{"protocol":"vg-ubuntu-company/1","ok":true,"healthy":true}'); return true; }
    function curl_getinfo($handle, $option) { return 200; }
    function curl_close($handle): void { $GLOBALS['https_curl_closed'] = true; }
}

try {
    https_check(function_exists('proc_open'), false, 'HTTPS fixture does not need shell process support');
    $config = ['version' => 2, 'transport' => 'https', 'endpoint' => VG_COMPANY_HTTPS_ENDPOINT,
        'keyId' => 'voltguard-site-v1', 'secret' => str_repeat('12', 32), 'site' => str_repeat('a', 32), 'timeout' => 25];
    $file = vg_company_dir() . '/ubuntu.json';
    file_put_contents($file, vg_json_encode($config));
    $parsed = vg_company_ubuntu_config();
    https_check($parsed, $config, 'Strict version-two file works without SSH executable');
    $invalid = [];
    foreach (['http://sunucu.tail0e7d76.ts.net/voltguard-company/v1','https://sunucu.tail0e7d76.ts.net:443/voltguard-company/v1',
        'https://sunucu.tail0e7d76.ts.net.evil.invalid/voltguard-company/v1','https://127.0.0.1/voltguard-company/v1',
        'https://user:pass@sunucu.tail0e7d76.ts.net/voltguard-company/v1',VG_COMPANY_HTTPS_ENDPOINT . '?next=evil',
        VG_COMPANY_HTTPS_ENDPOINT . '#fragment',VG_COMPANY_HTTPS_ENDPOINT . '/',"https://sunucu.tail0e7d76.ts.net/voltguard-company/v1\nX-Test: injected"] as $endpoint) $invalid[] = array_replace($config, ['endpoint' => $endpoint]);
    foreach ([['version' => '2'],['version' => 3],['transport' => 'ssh'],['keyId' => "key\nheader"],['keyId' => ''],['secret' => str_repeat('x',64)],['secret' => str_repeat('a',63)],['site' => str_repeat('b',64)],['site' => '../private'],['timeout' => '25'],['timeout' => 4],['timeout' => 46],['sahaSource' => true],['helper' => '/home/fixture/helper.py'],['sshExecutable' => '/usr/bin/ssh'],['host' => 'outside.invalid']] as $fields) $invalid[] = array_replace($config, $fields);
    foreach (array_keys($config) as $missing) { $copy = $config; unset($copy[$missing]); $invalid[] = $copy; }
    foreach ($invalid as $value) {
        file_put_contents($file, vg_json_encode($value));
        https_reject(static function () { vg_company_ubuntu_config(); }, null, 'Malformed or alternate HTTP target must be rejected');
    }
    file_put_contents($file, vg_json_encode($config));
    $saha = vg_company_saha_remote_config($parsed);
    https_check($saha['sahaSource'], true, 'HTTPS source route is an internal marker');
    https_check(array_key_exists('helper', $saha), false, 'HTTPS does not synthesize an SSH helper');
    $seen = []; $captured = [];
    $verifier = static function (string $endpoint, string $body, array $lines, int $timeout, callable $write) use ($config, &$seen, &$captured): int {
        $headers = https_headers($lines);
        https_check($endpoint, VG_COMPANY_HTTPS_ENDPOINT, 'Signed exchange uses only fixed TLS target');
        https_check($timeout, 25, 'Configured total timeout reaches exchange');
        https_check($headers['content-length'], (string)strlen($body), 'Content length signs actual UTF-8 bytes');
        https_check($headers['content-type'], 'application/json', 'No alternate form encoding');
        https_check($headers['x-vg-bridge-key'], $config['keyId'], 'Key identifier remains exact');
        https_check(preg_match('/^[a-f0-9]{32}$/D', $headers['x-vg-bridge-nonce']), 1, 'Fresh cryptographic nonce uses required shape');
        https_check(abs(time() - (int)$headers['x-vg-bridge-time']) < 5, true, 'Timestamp is current Unix time');
        $canonical = "POST\n/voltguard-company/v1\n" . $headers['x-vg-bridge-key'] . "\n" . $headers['x-vg-bridge-time'] . "\n" . $headers['x-vg-bridge-nonce'] . "\n" . hash('sha256', $body);
        https_check(hash_equals(hash_hmac('sha256', $canonical, hex2bin($config['secret'])), $headers['x-vg-bridge-signature']), true, 'HMAC covers exact canonical body and uses decoded 32-byte key');
        https_check(isset($seen[$headers['x-vg-bridge-nonce']]), false, 'A second call cannot reuse a captured nonce');
        $seen[$headers['x-vg-bridge-nonce']] = true;
        $envelope = json_decode($body, true);
        https_check(array_keys($envelope), ['route','request'], 'Only documented envelope fields are sent');
        https_check($envelope['request']['site'], $config['site'], 'Private configured site overrides caller-provided site');
        $captured[] = ['body' => $body, 'headers' => $headers, 'envelope' => $envelope];
        $write('{"protocol":"vg-ubuntu-company/1",'); $write('"ok":true,"healthy":true}');
        return 200;
    };
    $transport = static function (array $value, array $request) use ($verifier): array { return vg_company_ubuntu_https_transport($value, $request, $verifier); };
    $request = ['op' => 'health', 'site' => 'caller-cannot-select-site', 'actor' => ['id' => 'synthetic-employee', 'role' => 'employee'], 'text' => 'Türkçe / doğrulama'];
    https_check(vg_company_ubuntu_call($parsed, $request, $transport)['healthy'], true, 'Company signed request returns verified protocol');
    https_check($captured[0]['envelope']['route'], 'company', 'Main workspace retains company routing');
    https_check(vg_company_ubuntu_call($saha, $request, $transport)['healthy'], true, 'Original source route uses the same signed contract');
    https_check($captured[1]['envelope']['route'], 'saha', 'Source workspace selects only its fixed server route');
    https_check($captured[0]['body'] !== $captured[1]['body'], true, 'The signed route cannot be swapped after signing');
    $original = $captured[0]; $headers = $original['headers'];
    $canonicalChanged = "POST\n/voltguard-company/v1\n" . $headers['x-vg-bridge-key'] . "\n" . $headers['x-vg-bridge-time'] . "\n" . $headers['x-vg-bridge-nonce'] . "\n" . hash('sha256', $original['body'] . ' ');
    https_check(hash_equals(hash_hmac('sha256', $canonicalChanged, hex2bin($config['secret'])), $headers['x-vg-bridge-signature']), false, 'Even valid-JSON whitespace alteration fails the original signature');
    https_check(isset($seen[$headers['x-vg-bridge-nonce']]), true, 'Captured request replay is detectable by the server nonce fence');
    foreach ([302,401,403,500] as $status) {
        $attempts = 0;
        https_reject(static function () use ($parsed, $request, $status, &$attempts) {
            vg_company_ubuntu_call($parsed, $request, static function ($value, $input) use ($status, &$attempts) {
                return vg_company_ubuntu_https_transport($value, $input, static function ($endpoint, $body, $headers, $timeout, $write) use ($status, &$attempts) { $attempts++; $write('{"protocol":"vg-ubuntu-company/1","ok":true}'); return $status; });
            });
        }, 'company_ubuntu_unavailable', 'Redirect/authentication/HTTP failure is generic and never trusted as successful JSON');
        https_check($attempts, 1, 'HTTP transport does not retry, redirect, invoke SSH or fall back locally');
    }
    https_reject(static function () use ($parsed, $request) { vg_company_ubuntu_call($parsed, $request, static function ($value, $input) { return vg_company_ubuntu_https_transport($value, $input, static function ($endpoint, $body, $headers, $timeout, $write) { $write('<html>Generic success page</html>'); return 200; }); }); }, 'company_ubuntu_unavailable', 'Generic HTML cannot masquerade as bridge success');
    https_reject(static function () use ($parsed, $request) { vg_company_ubuntu_call($parsed, $request, static function ($value, $input) { return vg_company_ubuntu_https_transport($value, $input, static function ($endpoint, $body, $headers, $timeout, $write) { $write('{"ok":true}'); return 200; }); }); }, 'company_ubuntu_response', 'Valid JSON must retain the native bridge protocol');
    try { vg_company_ubuntu_call($parsed, $request, static function () use ($config) { throw new RuntimeException($config['secret'] . $config['site']); }); }
    catch (VgHttpError $error) { https_check(strpos($error->getMessage(), $config['secret']) === false && strpos($error->getMessage(), $config['site']) === false, true, 'Transport exceptions never disclose private key/site material'); }
    $streamOptions = vg_company_ubuntu_https_stream_options('{}', ['Content-Type: application/json']);
    https_check($streamOptions['ssl'], ['verify_peer' => true,'verify_peer_name' => true,'allow_self_signed' => false,'peer_name' => 'sunucu.tail0e7d76.ts.net','SNI_enabled' => true], 'Fallback stream explicitly validates CA chain, hostname and SNI');
    https_check($streamOptions['http']['follow_location'], 0, 'Stream fallback never follows Location');
    https_check($streamOptions['http']['timeout'], 7, 'Stream TLS connection phase is bounded to seven seconds');
    https_check(vg_company_ubuntu_https_stream_options('{}', [], 5)['http']['timeout'], 5, 'Stream connect phase cannot exceed a shorter total request budget');
    https_check($streamOptions['http']['max_redirects'], 0, 'Stream redirect allowance is zero');
    $stream = fopen('php://temp', 'w+b'); $bytes = VG_COMPANY_REMOTE_OUTPUT_LIMIT - 1;
    https_check(vg_company_ubuntu_https_write($stream, $bytes, 'x'), 1, 'Response limit includes its exact final allowed byte');
    https_reject(static function () use ($stream, &$bytes) { vg_company_ubuntu_https_write($stream, $bytes, 'x'); }, null, 'Response cap rejects bytes beyond 128 MiB before writing');
    https_check($bytes, VG_COMPANY_REMOTE_OUTPUT_LIMIT, 'Rejected response bytes do not alter its accepted counter'); fclose($stream);
    $calls = 0;
    https_reject(static function () use ($parsed, &$calls) { vg_company_ubuntu_https_transport($parsed, ['padding' => str_repeat('x', VG_COMPANY_REMOTE_INPUT_LIMIT)], static function () use (&$calls) { $calls++; return 200; }); }, 'company_remote_size', 'Oversized envelope is rejected before network/signing');
    https_check($calls, 0, 'Oversized body cannot start a request');
    vg_company_ubuntu_transport($parsed, $request);
    $options = $GLOBALS['https_curl_options'];
    https_check($GLOBALS['https_curl_endpoint'], VG_COMPANY_HTTPS_ENDPOINT, 'Primary cURL branch uses fixed target');
    https_check($options[CURLOPT_SSL_VERIFYPEER], true, 'Primary cURL validates certificate chain');
    https_check($options[CURLOPT_SSL_VERIFYHOST], 2, 'Primary cURL requires matching certificate hostname');
    https_check($options[CURLOPT_CONNECTTIMEOUT], 7, 'Primary cURL bounds connection time');
    https_check($options[CURLOPT_TIMEOUT], 25, 'Primary cURL bounds the whole exchange');
    https_check($options[CURLOPT_FOLLOWLOCATION], false, 'Primary cURL never follows redirects');
    https_check($options[defined('CURLOPT_PROTOCOLS_STR') ? CURLOPT_PROTOCOLS_STR : CURLOPT_PROTOCOLS], defined('CURLOPT_PROTOCOLS_STR') ? 'https' : CURLPROTO_HTTPS, 'Primary cURL restricts scheme to HTTPS');
    https_check($options[CURLOPT_MAXREDIRS], 0, 'Primary cURL has no redirect allowance');
    https_check(($options[CURLOPT_HEADERFUNCTION])(null, 'Content-Length: 134217729' . "\r\n"), 0, 'Oversized declared response length aborts before accepting body');
    https_check($GLOBALS['https_curl_closed'], true, 'Primary cURL resources close after completion');
    https_check(is_file(vg_company_dir() . '/state.json'), false, 'HTTPS transport never creates a local business source');
    echo vg_json_encode(['ok' => true, 'checks' => $checks, 'synthetic' => true, 'networkAccess' => false]);
} catch (Throwable $error) {
    fwrite(STDERR, get_class($error) . ': ' . $error->getMessage() . "\n" . $error->getTraceAsString() . "\n");
    exit(1);
}

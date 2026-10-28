<?php
declare(strict_types=1);
if (!defined('VG_API')) { http_response_code(404); exit; }

const VG_COMPANY_HTTPS_ENDPOINT = 'https://sunucu.tail0e7d76.ts.net/voltguard-company/v1';
const VG_COMPANY_HTTPS_PATH = '/voltguard-company/v1';
const VG_COMPANY_REMOTE_INPUT_LIMIT = 33554432;
const VG_COMPANY_REMOTE_OUTPUT_LIMIT = 134217728;

/** Internal marker is added by routing, never accepted from a private config file. */
function vg_company_ubuntu_https_config(array $config, bool $internal = false): array {
    $keys = ['version','transport','endpoint','keyId','secret','site','timeout'];
    $allowed = $internal ? array_merge($keys, ['sahaSource']) : $keys;
    if (array_diff($keys, array_keys($config)) || array_diff(array_keys($config), $allowed)
        || ($config['version'] ?? null) !== 2 || ($config['transport'] ?? null) !== 'https'
        || ($config['endpoint'] ?? null) !== VG_COMPANY_HTTPS_ENDPOINT
        || !is_string($config['keyId'] ?? null) || preg_match('/^[A-Za-z0-9_-]{1,64}$/D', $config['keyId']) !== 1
        || !is_string($config['secret'] ?? null) || preg_match('/^[a-f0-9]{64}$/D', $config['secret']) !== 1
        || !is_string($config['site'] ?? null) || preg_match('/^[a-f0-9]{32}$/D', $config['site']) !== 1
        || !is_int($config['timeout'] ?? null) || $config['timeout'] < 5 || $config['timeout'] > 45
        || (array_key_exists('sahaSource', $config) && $config['sahaSource'] !== true)) throw new RuntimeException('invalid ubuntu https configuration');
    return $config;
}

function vg_company_ubuntu_config(): ?array {
    $directory = vg_company_dir(); $file = $directory . '/ubuntu.json';
    if (!file_exists($file) && !is_link($file)) return null;
    if (!is_file($file) || is_link($file)) throw new RuntimeException('invalid ubuntu configuration file');
    $actual = realpath($file); $base = realpath($directory);
    if ($actual === false || $base === false || strpos(strtolower(str_replace('\\', '/', $actual)), strtolower(str_replace('\\', '/', $base)) . '/') !== 0 || filesize($file) > 8192) throw new RuntimeException('invalid ubuntu configuration');
    $config = json_decode((string)file_get_contents($file), true);
    if (is_array($config) && ($config['version'] ?? null) === 2) return vg_company_ubuntu_https_config($config);
    if (!is_array($config) || ($config['version'] ?? null) !== 1 || array_diff(array_keys($config), ['version','host','helper','sahaHelper','site','sshExecutable','timeout'])) throw new RuntimeException('invalid ubuntu configuration');
    if (!is_string($config['host'] ?? null) || !preg_match('/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/D', $config['host']) || !is_string($config['helper'] ?? null) || !preg_match('#^/home/[A-Za-z0-9_-]+/[A-Za-z0-9_./-]+\.py$#D', $config['helper']) || strpos($config['helper'], '..') !== false || !is_string($config['site'] ?? null) || !preg_match('/^[a-f0-9]{32,64}$/D', $config['site'])) throw new RuntimeException('invalid ubuntu target');
    $config['timeout'] = $config['timeout'] ?? 25;
    if (isset($config['sahaHelper']) && (!is_string($config['sahaHelper']) || !preg_match('#^/home/[A-Za-z0-9_-]+/[A-Za-z0-9_./-]+\.py$#D', $config['sahaHelper']) || strpos($config['sahaHelper'], '..') !== false)) throw new RuntimeException('invalid saha ubuntu target');
    if (!is_int($config['timeout']) || $config['timeout'] < 5 || $config['timeout'] > 45) throw new RuntimeException('invalid ubuntu timeout');
    $executable = $config['sshExecutable'] ?? (PHP_OS_FAMILY === 'Windows' ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' : '/usr/bin/ssh');
    if (!is_string($executable) || strpos($executable, "\0") !== false || !is_file($executable) || !is_readable($executable)) throw new RuntimeException('ubuntu ssh unavailable');
    $config['sshExecutable'] = $executable;
    return $config;
}

function vg_company_ubuntu_transport(array $config, array $request): array {
    if (($config['version'] ?? null) === 2) return vg_company_ubuntu_https_transport($config, $request);
    $directory = vg_company_dir(); $prefix = $directory . '/ssh-' . bin2hex(random_bytes(12));
    $input = $prefix . '.in'; $output = $prefix . '.out'; $error = $prefix . '.err'; $process = null;
    try {
        $json = vg_json_encode(vg_company_wire($request));
        if (strlen($json) > 33554432) vg_company_fail(413, 'company_remote_size', 'Kayıt paketi sunucu sınırını aşıyor.');
        if (file_put_contents($input, $json, LOCK_EX) !== strlen($json)) throw new RuntimeException('ubuntu input unavailable');
        foreach ([$input, $output, $error] as $file) { if (!is_file($file)) file_put_contents($file, ''); @chmod($file, 0600); }
        $command = [$config['sshExecutable'], '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=7', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2', $config['host'], 'python3 ' . $config['helper']];
        $descriptors = [0 => ['file', $input, 'r'], 1 => ['file', $output, 'w'], 2 => ['file', $error, 'w']];
        $process = @proc_open($command, $descriptors, $pipes, null, null, ['bypass_shell' => true, 'suppress_errors' => true, 'create_process_group' => true]);
        if (!is_resource($process)) throw new RuntimeException('ubuntu process unavailable');
        $deadline = microtime(true) + $config['timeout']; $exitCode = -1;
        while (true) {
            $status = proc_get_status($process);
            clearstatcache(true, $output); clearstatcache(true, $error);
            if (filesize($output) > 134217728 || filesize($error) > 1048576) throw new RuntimeException('ubuntu response size');
            if (!$status['running']) { $exitCode = $status['exitcode']; break; }
            if (microtime(true) >= $deadline) throw new RuntimeException('ubuntu timeout');
            usleep(20000);
        }
        $closed = proc_close($process); $process = null;
        if ($exitCode !== 0 && $closed !== 0) throw new RuntimeException('ubuntu transport unavailable');
        $raw = file_get_contents($output); $response = is_string($raw) ? json_decode($raw, true, 128) : null;
        if (!is_array($response)) throw new RuntimeException('ubuntu response invalid');
        return $response;
    } finally {
        if (is_resource($process)) { @proc_terminate($process); @proc_close($process); }
        foreach ([$input, $output, $error] as $file) if (is_file($file)) @unlink($file);
    }
}

/** A bounded writer shared by cURL and stream transports; large responses spill to private temporary storage. */
function vg_company_ubuntu_https_write($stream, int &$bytes, string $chunk): int {
    $length = strlen($chunk);
    if ($bytes > VG_COMPANY_REMOTE_OUTPUT_LIMIT - $length) throw new RuntimeException('ubuntu https response size');
    if (fwrite($stream, $chunk) !== $length) throw new RuntimeException('ubuntu https response unavailable');
    $bytes += $length;
    return $length;
}

function vg_company_ubuntu_https_stream_options(string $body, array $headers, int $timeout = 25): array {
    return ['http' => ['method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => $body,
        'timeout' => min(7, $timeout), 'follow_location' => 0, 'max_redirects' => 0, 'ignore_errors' => true, 'protocol_version' => 1.1],
        'ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'allow_self_signed' => false,
            'peer_name' => 'sunucu.tail0e7d76.ts.net', 'SNI_enabled' => true]];
}

/** No shell execution or SSH configuration is involved in the HTTPS route. */
function vg_company_ubuntu_https_exchange(string $endpoint, string $body, array $headers, int $timeout, callable $write): int {
    if ($endpoint !== VG_COMPANY_HTTPS_ENDPOINT) throw new RuntimeException('invalid ubuntu https target');
    if (function_exists('curl_init')) {
        $curl = curl_init($endpoint);
        if ($curl === false) throw new RuntimeException('ubuntu https unavailable');
        try {
            $options = [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => $headers,
                CURLOPT_CONNECTTIMEOUT => 7, CURLOPT_TIMEOUT => $timeout, CURLOPT_FOLLOWLOCATION => false, CURLOPT_MAXREDIRS => 0,
                CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
                CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use ($write): int { return $write($chunk); },
                CURLOPT_HEADERFUNCTION => static function ($handle, string $line): int {
                    if (preg_match('/^Content-Length:\s*([0-9]+)\s*$/iD', trim($line), $matches) && (float)$matches[1] > VG_COMPANY_REMOTE_OUTPUT_LIMIT) return 0;
                    return strlen($line);
                }];
            if (defined('CURLOPT_PROTOCOLS_STR')) {
                $options[CURLOPT_PROTOCOLS_STR] = 'https'; $options[CURLOPT_REDIR_PROTOCOLS_STR] = 'https';
            } else {
                $options[CURLOPT_PROTOCOLS] = CURLPROTO_HTTPS; $options[CURLOPT_REDIR_PROTOCOLS] = CURLPROTO_HTTPS;
            }
            if (!curl_setopt_array($curl, $options)) throw new RuntimeException('ubuntu https unavailable');
            if (curl_exec($curl) === false) throw new RuntimeException('ubuntu https unavailable');
            return (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        } finally { curl_close($curl); }
    }
    if (!extension_loaded('openssl') || !in_array('https', stream_get_wrappers(), true)) throw new RuntimeException('ubuntu https unavailable');
    $deadline = microtime(true) + $timeout;
    $context = stream_context_create(vg_company_ubuntu_https_stream_options($body, $headers, $timeout));
    $stream = @fopen($endpoint, 'rb', false, $context);
    if ($stream === false) throw new RuntimeException('ubuntu https unavailable');
    try {
        $meta = stream_get_meta_data($stream); $status = 0;
        foreach ($meta['wrapper_data'] ?? [] as $line) {
            if (preg_match('#^HTTP/\S+ ([0-9]{3})(?:\s|$)#D', $line, $matches)) $status = (int)$matches[1];
            if (preg_match('/^Content-Length:\s*([0-9]+)\s*$/iD', trim($line), $matches) && (float)$matches[1] > VG_COMPANY_REMOTE_OUTPUT_LIMIT) throw new RuntimeException('ubuntu https response size');
        }
        if ($status !== 200) return $status;
        while (!feof($stream)) {
            $remaining = $deadline - microtime(true);
            if ($remaining <= 0) throw new RuntimeException('ubuntu https unavailable');
            stream_set_timeout($stream, (int)$remaining, (int)(($remaining - (int)$remaining) * 1000000));
            $chunk = fread($stream, 65536);
            $meta = stream_get_meta_data($stream);
            if ($chunk === false || !empty($meta['timed_out'])) throw new RuntimeException('ubuntu https unavailable');
            if ($chunk !== '') $write($chunk);
        }
        return $status;
    } finally { fclose($stream); }
}

/** Injectable exchange is used by private CLI contract tests, never supplied by an HTTP caller. */
function vg_company_ubuntu_https_transport(array $config, array $request, ?callable $exchange = null): array {
    $config = vg_company_ubuntu_https_config($config, true);
    $body = vg_json_encode(vg_company_wire(['route' => ($config['sahaSource'] ?? false) === true ? 'saha' : 'company', 'request' => $request]));
    if (strlen($body) > VG_COMPANY_REMOTE_INPUT_LIMIT) vg_company_fail(413, 'company_remote_size', 'Kayıt paketi sunucu sınırını aşıyor.');
    $timestamp = (string)time(); $nonce = bin2hex(random_bytes(16));
    $canonical = "POST\n" . VG_COMPANY_HTTPS_PATH . "\n" . $config['keyId'] . "\n" . $timestamp . "\n" . $nonce . "\n" . hash('sha256', $body);
    $signature = hash_hmac('sha256', $canonical, hex2bin($config['secret']));
    $headers = ['Content-Type: application/json', 'Accept: application/json', 'Cache-Control: no-store', 'Expect:',
        'Content-Length: ' . strlen($body), 'X-VG-Bridge-Key: ' . $config['keyId'], 'X-VG-Bridge-Time: ' . $timestamp,
        'X-VG-Bridge-Nonce: ' . $nonce, 'X-VG-Bridge-Signature: ' . $signature];
    $stream = fopen('php://temp/maxmemory:1048576', 'w+b');
    if ($stream === false) throw new RuntimeException('ubuntu https unavailable');
    try {
        $bytes = 0;
        $write = static function (string $chunk) use ($stream, &$bytes): int { return vg_company_ubuntu_https_write($stream, $bytes, $chunk); };
        $status = ($exchange ?? 'vg_company_ubuntu_https_exchange')($config['endpoint'], $body, $headers, $config['timeout'], $write);
        if ($status !== 200) throw new RuntimeException('ubuntu https unavailable');
        rewind($stream); $raw = stream_get_contents($stream);
        $response = is_string($raw) ? json_decode($raw, true, 128) : null;
        if (!is_array($response)) throw new RuntimeException('ubuntu https response invalid');
        return $response;
    } finally { fclose($stream); }
}

function vg_company_saha_remote_config(array $config): array {
    if (($config['version'] ?? null) === 2) {
        $config = vg_company_ubuntu_https_config($config);
        $config['sahaSource'] = true;
        return $config;
    }
    $helper = $config['sahaHelper'] ?? null;
    if ($helper === null && basename($config['helper']) === 'company_store.py') $helper = dirname($config['helper']) . '/saha_store.py';
    if (!is_string($helper) || !preg_match('#^/home/[A-Za-z0-9_-]+/[A-Za-z0-9_./-]+\.py$#D', $helper) || strpos($helper, '..') !== false) vg_company_fail(503, 'company_saha_source', 'SahaTakip veri bağlantısı henüz yapılandırılmadı.');
    $config['helper'] = $helper;
    // Internal routing marker; ubuntu.json must never be able to relax the company catalog contract.
    $config['sahaSource'] = true;
    return $config;
}

function vg_company_ubuntu_call(array $config, array $request, ?callable $transport = null): array {
    $request['site'] = $config['site'];
    try { $response = $transport ? $transport($config, $request) : vg_company_ubuntu_transport($config, $request); }
    catch (VgHttpError $e) { throw $e; }
    catch (Throwable $e) { vg_company_fail(503, 'company_ubuntu_unavailable', 'Ubuntu veri sunucusuna ulaşılamıyor. Kayıtlarınızı yeniden bağlandıktan sonra kontrol edin.'); }
    if (!is_array($response) || ($response['protocol'] ?? null) !== 'vg-ubuntu-company/1' || !is_bool($response['ok'] ?? null)) vg_company_fail(503, 'company_ubuntu_response', 'Ubuntu veri sunucusu yanıtı doğrulanamadı.');
    if (!$response['ok']) {
        $status = $response['status'] ?? 503; $code = $response['code'] ?? 'company_ubuntu_unavailable';
        if (!in_array($status, [400,403,404,409,413,422,503], true)) $status = 503;
        if (!is_string($code) || !preg_match('/^[A-Za-z0-9_]{1,80}$/D', $code)) $code = 'company_ubuntu_unavailable';
        vg_company_fail($status, $code, $status === 409 ? 'Sunucudaki kayıt değişti. Güncel kaydı yükleyip karşılaştırın.' : 'Ubuntu veri sunucusu işlemi tamamlayamadı. Kayıtlarınızı kontrol edip yeniden deneyin.');
    }
    return $response;
}

function vg_company_ubuntu_token($value): bool { return is_string($value) && preg_match('/^[a-f0-9]{64}$/D', $value) === 1; }
function vg_company_ubuntu_same_actor(array $before, int $expectedEpoch): array {
    $after = vg_staff_require_user();
    if ($after['id'] !== $before['id'] || ($_SESSION['staff']['epoch'] ?? null) !== $expectedEpoch || $after['role'] !== $before['role']) vg_company_fail(401, 'staff_identity', 'Çalışan oturumu değişti. Yeniden giriş yapın.');
    return $after;
}
function vg_company_ubuntu_result($result, array $canonical) {
    if (!is_array($result) || !array_key_exists('data', $result)) return $result;
    // Only refresh values the caller may already see: the response row was masked (hidden personal fields unset)
    // and projected (select) for this actor, so the canonical database row must never add keys back.
    $replace = function ($row) use ($canonical) {
        if (!is_array($row) || !is_string($row['id'] ?? null)) return $row;
        foreach ($canonical as $records) if (is_array($records) && isset($records[$row['id']]) && is_array($records[$row['id']])) return array_replace($row, array_intersect_key($records[$row['id']], $row));
        return $row;
    };
    if (is_array($result['data']) && array_is_list_compat($result['data'])) $result['data'] = array_map($replace, $result['data']);
    elseif (is_array($result['data']) && isset($result['data']['id'])) $result['data'] = $replace($result['data']);
    elseif (is_array($result['data']) && isset($result['data']['payroll'])) $result['data']['payroll'] = $replace($result['data']['payroll']);
    return $result;
}

function vg_company_ubuntu_store(callable $fn, array $config, ?callable $transport = null) {
    $actor = vg_staff_require_user();
    $epoch = $_SESSION['staff']['epoch'] ?? null;
    if (!is_int($epoch)) vg_company_fail(401, 'staff_identity');
    $wireActor = ['id' => $actor['id'], 'role' => $actor['role']];
    $response = vg_company_ubuntu_call($config, ['op' => 'snapshot', 'actor' => $wireActor], $transport);
    $state = $response['state'] ?? null; $tokens = $response['snapshot'] ?? null;
    if (!is_array($state) || ($state['version'] ?? null) !== 1 || !is_array($state['tables'] ?? null) || !is_array($state['storage'] ?? null) || !is_array($state['audit'] ?? null) || !is_int($state['sequence'] ?? null) || !is_array($tokens['rows'] ?? null) || !is_array($tokens['prefs'] ?? null)) vg_company_fail(503, 'company_ubuntu_response');
    if (array_diff(array_keys($state['tables']), array_keys(vg_company_schema())) || isset($state['tables']['users']) || array_diff(array_keys($state['storage']), [$actor['id']])) vg_company_fail(503, 'company_ubuntu_scope');
    foreach (vg_company_schema() as $table => $_) if ($table !== 'users') {
        if (!isset($state['tables'][$table])) $state['tables'][$table] = [];
        if (!is_array($state['tables'][$table])) vg_company_fail(503, 'company_ubuntu_response');
        foreach ($state['tables'][$table] as $id => $row) if (!is_array($row) || (string)$id !== (string)($row['id'] ?? '') || !vg_company_ubuntu_token($tokens['rows'][$table][(string)$id] ?? null)) vg_company_fail(503, 'company_ubuntu_response');
    }
    if (($config['sahaSource'] ?? false) !== true) {
        $catalog = $response['catalog'] ?? null;
        $catalogKeys = ['historicalInvoice1','historicalInvoice2','cablePrices','packages'];
        if (!is_array($catalog) || array_diff(array_keys($catalog), $catalogKeys) || array_diff($catalogKeys, array_keys($catalog))) vg_company_fail(503, 'company_ubuntu_catalog');
        foreach ($catalog as $value) if (!is_array($value)) vg_company_fail(503, 'company_ubuntu_catalog');
        $GLOBALS['vg_company_ubuntu_catalog'] = $catalog;
    }
    $GLOBALS['vg_company_data_source'] = 'ubuntu';
    vg_company_ubuntu_same_actor($actor, $epoch); $before = $state;
    $result = $fn($state, $actor);
    $changes = [];
    foreach ($state['tables'] as $table => $records) {
        foreach (array_unique(array_merge(array_keys($before['tables'][$table]), array_keys($records))) as $id) {
            $old = $before['tables'][$table][$id] ?? null; $new = $records[$id] ?? null;
            if ($old === $new) continue;
            if ($old !== null && !vg_company_ubuntu_token($tokens['rows'][$table][$id] ?? null)) vg_company_fail(503, 'company_ubuntu_revision');
            $changes[] = ['table' => $table, 'id' => (string)$id, 'before' => $old === null ? null : $tokens['rows'][$table][$id], 'row' => $new];
        }
    }
    if (array_diff(array_keys($state['storage']), [$actor['id']])) vg_company_fail(403, 'company_storage_owner');
    $preferences = []; $oldPreferences = $before['storage'][$actor['id']] ?? []; $newPreferences = $state['storage'][$actor['id']] ?? [];
    foreach (array_unique(array_merge(array_keys($oldPreferences), array_keys($newPreferences))) as $key) {
        $old = $oldPreferences[$key] ?? null; $new = $newPreferences[$key] ?? null;
        if ($old === $new) continue;
        if ($old !== null && !vg_company_ubuntu_token($tokens['prefs'][$key] ?? null)) vg_company_fail(503, 'company_ubuntu_revision');
        $preferences[] = ['key' => $key, 'before' => $old === null ? null : $tokens['prefs'][$key], 'value' => $new];
    }
    $oldEvents = array_map('vg_json_encode', $before['audit']);
    $audit = array_values(array_filter($state['audit'], function ($event) use ($oldEvents) { return !in_array(vg_json_encode($event), $oldEvents, true); }));
    if (!$changes && !$preferences && !$audit && $state['sequence'] === $before['sequence']) return $result;
    vg_company_ubuntu_same_actor($actor, $epoch);
    $commit = vg_company_ubuntu_call($config, ['op' => 'commit', 'actor' => $wireActor, 'requestId' => vg_company_id(), 'changes' => $changes, 'storageChanges' => $preferences, 'audit' => $audit, 'expectedSequence' => $before['sequence'], 'sequence' => $state['sequence']], $transport);
    if (!is_array($commit['rows'] ?? null)) vg_company_fail(503, 'company_ubuntu_response');
    return vg_company_ubuntu_result($result, $commit['rows']);
}

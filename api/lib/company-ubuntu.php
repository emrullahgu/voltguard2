<?php
declare(strict_types=1);
if (!defined('VG_API')) { http_response_code(404); exit; }

function vg_company_ubuntu_config(): ?array {
    $directory = vg_company_dir(); $file = $directory . '/ubuntu.json';
    if (!file_exists($file) && !is_link($file)) return null;
    if (!is_file($file) || is_link($file)) throw new RuntimeException('invalid ubuntu configuration file');
    $actual = realpath($file); $base = realpath($directory);
    if ($actual === false || $base === false || strpos(strtolower(str_replace('\\', '/', $actual)), strtolower(str_replace('\\', '/', $base)) . '/') !== 0 || filesize($file) > 8192) throw new RuntimeException('invalid ubuntu configuration');
    $config = json_decode((string)file_get_contents($file), true);
    if (!is_array($config) || ($config['version'] ?? null) !== 1 || array_diff(array_keys($config), ['version','host','helper','site','sshExecutable','timeout'])) throw new RuntimeException('invalid ubuntu configuration');
    if (!is_string($config['host'] ?? null) || !preg_match('/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/D', $config['host']) || !is_string($config['helper'] ?? null) || !preg_match('#^/home/[A-Za-z0-9_-]+/[A-Za-z0-9_./-]+\.py$#D', $config['helper']) || strpos($config['helper'], '..') !== false || !is_string($config['site'] ?? null) || !preg_match('/^[a-f0-9]{32,64}$/D', $config['site'])) throw new RuntimeException('invalid ubuntu target');
    $config['timeout'] = $config['timeout'] ?? 25;
    if (!is_int($config['timeout']) || $config['timeout'] < 5 || $config['timeout'] > 45) throw new RuntimeException('invalid ubuntu timeout');
    $executable = $config['sshExecutable'] ?? (PHP_OS_FAMILY === 'Windows' ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' : '/usr/bin/ssh');
    if (!is_string($executable) || strpos($executable, "\0") !== false || !is_file($executable) || !is_readable($executable)) throw new RuntimeException('ubuntu ssh unavailable');
    $config['sshExecutable'] = $executable;
    return $config;
}

function vg_company_ubuntu_transport(array $config, array $request): array {
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
    $replace = function ($row) use ($canonical) {
        if (!is_array($row) || !is_string($row['id'] ?? null)) return $row;
        foreach ($canonical as $records) if (is_array($records) && isset($records[$row['id']]) && is_array($records[$row['id']])) return $records[$row['id']];
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
    $catalog = $response['catalog'] ?? null;
    $catalogKeys = ['historicalInvoice1','historicalInvoice2','cablePrices','packages'];
    if (!is_array($catalog) || array_diff(array_keys($catalog), $catalogKeys) || array_diff($catalogKeys, array_keys($catalog))) vg_company_fail(503, 'company_ubuntu_catalog');
    foreach ($catalog as $value) if (!is_array($value)) vg_company_fail(503, 'company_ubuntu_catalog');
    $GLOBALS['vg_company_ubuntu_catalog'] = $catalog;
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

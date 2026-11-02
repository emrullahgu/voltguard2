<?php
/** Copied to a temporary loopback docroot by company-session.test.cjs only. */
declare(strict_types=1);
if (PHP_SAPI !== 'cli-server' || getenv('VG_ISOLATED_SESSION_FIXTURE') !== 'company-session-regression'
    || !in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) { http_response_code(404); exit; }
define('VG_API', 1);
$root = (string)getenv('VG_SESSION_TEST_ROOT');
require $root . '/api/lib/bootstrap.php';
require $root . '/api/lib/security.php';
require $root . '/api/lib/staff.php';
require $root . '/api/lib/company.php';
ob_start();

function session_fixture_id(string $code): string { return 's' . str_repeat($code === 'b' ? '2' : '1', 24); }
function session_fixture_actor(array $user): string { return $user['id'] === session_fixture_id('a') ? 'a' : 'b'; }
function session_fixture_mark(string $tag, string $phase, array $extra = []): void {
    if (!preg_match('/^[a-z0-9-]{1,80}$/D', $tag)) throw new RuntimeException('invalid fixture tag');
    file_put_contents(vg_data_dir() . '/marker-' . $tag . '-' . $phase . '.json', json_encode(['timeMs' => microtime(true) * 1000] + $extra));
}
function session_fixture_seed(string $code): array {
    vg_staff_session_start();
    $users = vg_staff_store(static function (array &$state): array {
        $users = [];
        foreach (['a', 'b'] as $code) {
            $id = session_fixture_id($code);
            $users[$code] = ['id' => $id, 'name' => 'Synthetic employee', 'email' => $code . '@example.test',
                'role' => 'admin', 'status' => 'active', 'mfaSecret' => 'JBSWY3DPEHPK3PXP', 'epoch' => 1,
                'password' => password_hash('SyntheticExisting123!', PASSWORD_BCRYPT, ['cost' => 4]),
                'createdAt' => vg_iso(time()), 'trustedDevices' => []];
            $state['users'][$id] = $users[$code];
        }
        return $users;
    });
    $login = vg_staff_finish_login($users[$code]);
    return ['ok' => true, 'actor' => $code, 'csrf' => $login['csrf']];
}

try {
    $operation = $_GET['op'] ?? 'ping';
    if ($operation === 'ping') $result = ['ok' => true];
    elseif ($operation === 'seed') $result = session_fixture_seed(($_GET['actor'] ?? 'a') === 'b' ? 'b' : 'a');
    elseif ($operation === 'me') $result = ['ok' => true, 'actor' => session_fixture_actor(vg_staff_require_user())];
    elseif ($operation === 'logout') { vg_staff_session_start(); vg_staff_dispatch('logout', []); $result = ['ok' => true]; }
    elseif ($operation === 'read_csrf') { vg_staff_require_user(); $result = ['ok' => true, 'csrf' => $_SESSION['staff_csrf'] ?? null]; }
    elseif (in_array($operation, ['epoch', 'role', 'disable', 'expire', 'csrf', 'clear_csrf', 'principal'], true)) {
        $user = vg_staff_require_user();
        if ($operation === 'expire') $_SESSION['staff']['last'] = time() - VG_STAFF_IDLE - 1;
        elseif ($operation === 'csrf') $_SESSION['staff_csrf'] = bin2hex(random_bytes(32));
        elseif ($operation === 'clear_csrf') unset($_SESSION['staff_csrf']);
        elseif ($operation === 'principal') $_SESSION['staff']['uid'] = session_fixture_id('b');
        else vg_staff_store(static function (array &$state) use ($user, $operation): void {
            if ($operation === 'epoch') $state['users'][$user['id']]['epoch']++;
            if ($operation === 'role') $state['users'][$user['id']]['role'] = 'employee';
            if ($operation === 'disable') $state['users'][$user['id']]['status'] = 'disabled';
        });
        $result = ['ok' => true];
    } elseif ($operation === 'native') {
        // This malformed remote configuration makes accidental adapter entry fail.
        file_put_contents(vg_company_dir() . '/ubuntu.json', '{');
        vg_company_run();
        exit;
    } elseif ($operation === 'held') {
        vg_staff_require_user();
        session_fixture_mark((string)($_GET['tag'] ?? ''), 'snapshot', ['unlocked' => false]);
        usleep(800000);
        $result = ['ok' => true];
    } elseif ($operation === 'remote') {
        $tag = (string)($_GET['tag'] ?? '');
        $mutate = ($_GET['mutate'] ?? '') === '1';
        $revoke = ($_GET['revoke'] ?? '') === '1';
        $transport = static function (array $config, array $request) use ($tag): array {
            if ($request['op'] === 'commit') {
                session_fixture_mark($tag, 'commit', ['locked' => session_status() === PHP_SESSION_ACTIVE]);
                return ['protocol' => 'vg-ubuntu-company/1', 'ok' => true, 'rows' => []];
            }
            session_fixture_mark($tag, 'snapshot', ['unlocked' => session_status() !== PHP_SESSION_ACTIVE]);
            usleep(800000);
            $tables = [];
            foreach (vg_company_schema() as $table => $_) if ($table !== 'users') $tables[$table] = [];
            return ['protocol' => 'vg-ubuntu-company/1', 'ok' => true,
                'state' => ['version' => 1, 'tables' => $tables, 'storage' => [$request['actor']['id'] => []], 'sequence' => 0, 'audit' => []],
                'snapshot' => ['rows' => [], 'prefs' => []]];
        };
        $handler = static function (array &$state, array $user) use ($tag, $mutate, $revoke): array {
            session_fixture_mark($tag, 'handler', ['locked' => session_status() === PHP_SESSION_ACTIVE]);
            if ($mutate) $state['sequence']++;
            if ($revoke) vg_staff_store(static function (array &$staff) use ($user): void { $staff['users'][$user['id']]['epoch']++; });
            return ['ok' => true, 'actor' => session_fixture_actor($user)];
        };
        $result = vg_company_ubuntu_store($handler, ['site' => str_repeat('a', 32), 'sahaSource' => true], $transport);
        // vg_company_run builds its wire response while the resumed lock is
        // still active; a legitimately absent CSRF token must be saved there.
        if (($_GET['mint_csrf'] ?? '') === '1') $result['csrf'] = vg_staff_csrf();
    } else vg_fail(404, 'fixture_unknown', 'Synthetic fixture endpoint.');
    vg_discard_output();
    header('Content-Type: application/json');
    echo json_encode($result);
} catch (VgHttpError $error) {
    vg_discard_output();
    http_response_code($error->status); header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'code' => $error->errCode]);
} finally {
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
}

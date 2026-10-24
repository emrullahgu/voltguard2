<?php
/* Büyüme paneli (hesap/buyume-paneli.html) yöneticileri. Yalnızca sunucu terminalinden çalışır; HTTP ile asla. */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

define('VG_API', 1);
require dirname(__DIR__) . '/api/lib/bootstrap.php';
require dirname(__DIR__) . '/api/lib/store.php';
require dirname(__DIR__) . '/api/lib/metrics.php';

// DOCUMENT_ROOT is often absent in CLI. Resolve the same deployment root as the API.
$_SERVER['DOCUMENT_ROOT'] = dirname(__DIR__);
$action = $argv[1] ?? '';
$id = $argv[2] ?? '';
if (!in_array($action, ['grant', 'revoke', 'list'], true)
    || ($action !== 'list' && (!vg_metrics_user_id($id) || count($argv) !== 3))
    || ($action === 'list' && count($argv) !== 2)) {
    fwrite(STDERR, "Usage: php tools/metrics-admin.php grant|revoke <existing-user-id>\n       php tools/metrics-admin.php list\n");
    exit(2);
}

// A repository checkout may differ from public_html. Never silently select a different account store.
if (!is_string(getenv('VG_DATA_DIR')) || trim((string)getenv('VG_DATA_DIR')) === '') {
    fwrite(STDERR, "Set VG_DATA_DIR to the API's existing private data directory before administration.\n");
    exit(2);
}

try {
    $store = vg_store();
    if ($action === 'grant' && $store->findUserById($id) === null) {
        fwrite(STDERR, "Account not found. Create a normal membership account first.\n");
        exit(2);
    }
    $admins = vg_metrics_locked(function () use ($action, $id) {
        $ids = vg_metrics_admins();
        if ($action === 'grant' && !in_array($id, $ids, true)) {
            if (count($ids) >= 50) {
                vg_fail(422, 'limit', 'Admin limit reached.');
            }
            $ids[] = $id;
        } elseif ($action === 'revoke') {
            $ids = array_values(array_filter($ids, function (string $known) use ($id) {
                return $known !== $id;
            }));
        }
        if ($action !== 'list') {
            vg_metrics_save_admins($ids);
        }
        return $ids;
    });
    if ($action === 'list') {
        if (!$admins) {
            echo "No growth dashboard admins configured.\n";
        }
        foreach ($admins as $known) {
            echo $known . ($store->findUserById($known) === null ? '  (account deleted; revoke recommended)' : '') . "\n";
        }
    } else {
        echo "Growth dashboard permission updated.\n";
    }
} catch (Throwable $error) {
    fwrite(STDERR, "Metrics administration failed. Check private data configuration and server logs.\n");
    exit(1);
}

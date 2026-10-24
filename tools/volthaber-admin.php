<?php
/* VoltHaber editor yetkisi. Yalnizca sunucu terminalinden; HTTP ile asla calismaz (tools/community-admin.php ile ayni kalip). */
declare(strict_types=1);
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

define('VG_API', 1);
require dirname(__DIR__) . '/api/lib/bootstrap.php';
require dirname(__DIR__) . '/api/lib/store.php';
require dirname(__DIR__) . '/api/lib/security.php';
require dirname(__DIR__) . '/api/lib/validate.php';
require dirname(__DIR__) . '/api/lib/volthaber.php';

$_SERVER['DOCUMENT_ROOT'] = dirname(__DIR__);
$action = $argv[1] ?? '';
$id = $argv[2] ?? '';
if (!in_array($action, ['grant', 'revoke', 'list'], true)
    || ($action !== 'list' && (!vh_user_id_valid($id) || count($argv) !== 3))
    || ($action === 'list' && count($argv) !== 2)) {
    fwrite(STDERR, "Usage: php tools/volthaber-admin.php grant|revoke <existing-user-id>\n       php tools/volthaber-admin.php list\n");
    exit(2);
}
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
    $editors = vh_locked($action !== 'list', function (string $dir) use ($action, $id) {
        $ids = vh_editors($dir);
        if ($action === 'grant' && !in_array($id, $ids, true)) {
            if (count($ids) >= 50) {
                vg_fail(422, 'limit', 'Editor limit reached.');
            }
            $ids[] = $id;
        } elseif ($action === 'revoke') {
            $ids = array_values(array_filter($ids, function (string $known) use ($id) {
                return $known !== $id;
            }));
        }
        if ($action !== 'list') {
            vh_write($dir, 'editors.json', ['version' => 1, 'editors' => $ids], 65536);
        }
        return $ids;
    });
    if ($action === 'list') {
        echo $editors ? implode("\n", $editors) . "\n" : "No VoltHaber editors configured.\n";
    } else {
        echo "VoltHaber editor permission updated.\n";
    }
} catch (Throwable $error) {
    fwrite(STDERR, "VoltHaber administration failed. Check private data configuration and server logs.\n");
    exit(1);
}

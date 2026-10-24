<?php
/* PHP built-in server router: execute only explicit application entrypoints. Never serve files. */
declare(strict_types=1);

ini_set('display_errors', '0');
$known = getenv('VG_PREVIEW_INTERNAL_TOKEN');
$sent = $_SERVER['HTTP_X_VG_PREVIEW_INTERNAL'] ?? '';
if (!is_string($known) || strlen($known) !== 64 || !is_string($sent) || !hash_equals($known, $sent)) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo 'Sayfa bulunamadı.';
    exit;
}

$rawPath = parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$pathname = is_string($rawPath) ? rawurldecode($rawPath) : '';
$routes = [
    '/api/auth.php' => '/api/auth.php',
    '/api/community.php' => '/api/community.php',
    '/api/metrics.php' => '/api/metrics.php',
    '/api/staff.php' => '/api/staff.php',
    '/api/company.php' => '/api/company.php',
    '/api/company-asset.php' => '/api/company-asset.php',
    '/api/company-connectors.php' => '/api/company-connectors.php',
    '/contact.php' => '/contact.php',
    '/calisan/' => '/calisan/index.php',
    '/calisan/index.php' => '/calisan/index.php',
    '/calisan/uygulama' => '/calisan/uygulama/index.php',
    '/calisan/uygulama/' => '/calisan/uygulama/index.php',
];
if (!isset($routes[$pathname]) || strpos($pathname, "\0") !== false || strpos($pathname, '\\') !== false) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo 'Sayfa bulunamadı.';
    exit;
}
$root = dirname(__DIR__);
$target = $routes[$pathname];
$_SERVER['DOCUMENT_ROOT'] = $root;
$_SERVER['SCRIPT_NAME'] = $target;
$_SERVER['PHP_SELF'] = $target;
$_SERVER['SCRIPT_FILENAME'] = $root . $target;
unset($_SERVER['PATH_INFO']);
header('X-Content-Type-Options: nosniff');
if (!is_file($root . $target)) {
    http_response_code(503);
    header('Cache-Control: no-store');
    if (strpos($target, '/api/company') === 0) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['api' => 'vg-company/1', 'ok' => false, 'error' => 'unavailable', 'message' => 'Çalışan hizmeti şu anda kullanılamıyor.']);
    } else {
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Çalışan hizmeti şu anda kullanılamıyor.';
    }
    exit;
}
require $root . $target;

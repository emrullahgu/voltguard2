<?php
/*
 * PHP built-in server router: execute only explicit application entrypoints. Never serve repository files.
 * Tek istisna: /magaza-gorsel/<2 hane>/<ad>.<ozet>(-t).webp magaza medya deposundan (VG_MAGAZA_MEDIA; varsayilan
 * %LOCALAPPDATA%/VoltGuard/magaza-gorsel, Windows disinda ~/.voltguard/magaza-gorsel) WebP olarak sunulur.
 */
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
if (strpos($pathname, '/magaza-gorsel/') === 0 || $pathname === '/magaza-gorsel') {
    $media = getenv('VG_MAGAZA_MEDIA');
    if (!is_string($media) || $media === '') {
        $local = getenv('LOCALAPPDATA');
        $home = getenv('HOME') ?: getenv('USERPROFILE');
        $media = DIRECTORY_SEPARATOR === '\\' && is_string($local) && $local !== ''
            ? $local . '/VoltGuard/magaza-gorsel' : (string)$home . '/.voltguard/magaza-gorsel';
    }
    $file = preg_match('#^/magaza-gorsel/([0-9a-f]{2}/[a-z0-9-]{3,90}\.[0-9a-f]{8}(?:-t)?\.webp)$#D', $pathname, $mm) === 1
        ? rtrim($media, '/\\') . '/' . $mm[1] : '';
    if ($file === '' || !is_file($file)) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        header('Cache-Control: no-store');
        echo 'Görsel bulunamadı.';
        exit;
    }
    header('Content-Type: image/webp');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: public, max-age=31536000, immutable');
    header('Content-Length: ' . (string)filesize($file));
    readfile($file);
    exit;
}
$routes = [
    '/api/integrations.php' => '/api/integrations.php',
    '/api/auth.php' => '/api/auth.php',
    '/api/community.php' => '/api/community.php',
    '/api/metrics.php' => '/api/metrics.php',
    '/api/volthaber.php' => '/api/volthaber.php',
    '/api/magaza.php' => '/api/magaza.php',
    '/api/staff.php' => '/api/staff.php',
    '/api/company.php' => '/api/company.php',
    '/api/company-asset.php' => '/api/company-asset.php',
    '/api/saha-asset.php' => '/api/saha-asset.php',
    '/api/company-connectors.php' => '/api/company-connectors.php',
    '/contact.php' => '/contact.php',
    '/calisan/' => '/calisan/index.php',
    '/calisan/index.php' => '/calisan/index.php',
    '/calisan/uygulama' => '/calisan/uygulama/index.php',
    '/calisan/uygulama/' => '/calisan/uygulama/index.php',
    '/calisan/uygulama/saha.php' => '/calisan/uygulama/saha.php',
];
/* Magaza sayfalari magaza/index.php tarafindan REQUEST_URI'ye gore uretilir (.htaccess ile ayni yollar). */
if (preg_match('#^/magaza/(?:(?:kategori|urun)/[a-z0-9-]+/?|ara/?|odeme\.html|(?:on-bilgilendirme-formu|mesafeli-satis-sozlesmesi|iade-ve-cayma|kvkk-aydinlatma|odeme-ve-teslimat)\.html|sitemap(?:-[0-9]{1,4})?\.xml)?$#D', $pathname) === 1) {
    $routes[$pathname] = '/magaza/index.php';
}
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
    if (strpos($target, '/api/company') === 0 || $target === '/api/saha-asset.php') {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['api' => 'vg-company/1', 'ok' => false, 'error' => 'unavailable', 'message' => 'Çalışan hizmeti şu anda kullanılamıyor.']);
    } else {
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Çalışan hizmeti şu anda kullanılamıyor.';
    }
    exit;
}
require $root . $target;

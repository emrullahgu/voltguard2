<?php
/*
 * Yalnizca yerel gelistirme/test: PHP gomulu sunucusunda VoltHaber .htaccess kurallarini taklit eder.
 *   php -S 127.0.0.1:8090 -t . tools/volthaber-dev-router.php
 * Canli sunucuda kullanilmaz (tools/ deploy edilmez ve web'e kapalidir).
 */
declare(strict_types=1);
if (PHP_SAPI !== 'cli-server') {
    http_response_code(404);
    exit;
}
$path = (string)parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
if (preg_match('#^/volthaber(/((kategori|etiket)/[a-z0-9-]+/?|[a-z0-9-]+/?|(sitemap|rss)\.xml|index\.php)?)?$#', $path) === 1) {
    $_SERVER['SCRIPT_NAME'] = '/volthaber/index.php';
    require __DIR__ . '/../volthaber/index.php';
    return true;
}
if ($path === '/volthaber/index.html') {
    // Canlida /volthaber/ adresine 301; yerelde statik yedek gorunumu incelemek icin sunulur.
    return false;
}
if (preg_match('#^/(tools|\.qa|\.git)(/|$)#', $path) === 1) {
    http_response_code(404);
    return true;
}
return false;

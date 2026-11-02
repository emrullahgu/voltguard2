<?php
/*
 * php -S yonlendiricisi (yalniz testler): .htaccess'teki /magaza/ kurallarinin ayni yollarini magaza/index.php'ye verir.
 * Diger her sey (statik dosyalar, /api/magaza.php) php -S tarafindan normal sunulur.
 */
$path = parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$path = is_string($path) ? rawurldecode($path) : '/';
if ($path === '/magaza' || preg_match('#^/magaza/(?:(?:kategori|urun)/[a-z0-9-]+/?|ara/?|odeme\.html|(?:on-bilgilendirme-formu|mesafeli-satis-sozlesmesi|iade-ve-cayma|kvkk-aydinlatma|odeme-ve-teslimat)\.html|sitemap(?:-[0-9]{1,4})?\.xml)?$#D', $path) === 1) {
    require rtrim((string)$_SERVER['DOCUMENT_ROOT'], '/\\') . '/magaza/index.php';
    return true;
}
return false;

<?php
/*
 * VoltGuard Magaza herkese acik sayfalari (sunucu tarafi uretim; api/MAGAZA.md). .htaccess su adresleri buraya yonlendirir:
 *   /magaza/  /magaza/kategori/<id>/  /magaza/urun/<slug>/  /magaza/sitemap.xml
 * Yol REQUEST_URI'den okunur. Sablon: magaza/index.html. Fiyatlar her istekte vgm_price() ile hesaplanir (onbellek yok).
 * Sepet, odeme, siparis takibi ve hukuki sayfalar magaza/ altinda statik .html dosyalaridir.
 */
declare(strict_types=1);

define('VG_API', 1);
$vgmRoot = dirname(__DIR__);
require $vgmRoot . '/api/lib/bootstrap.php';
require $vgmRoot . '/api/lib/magaza.php';
require $vgmRoot . '/api/lib/magaza-render.php';

function vgmr_out(int $status, string $type, string $body, array $headers = []): void
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    http_response_code($status);
    header('Content-Type: ' . $type);
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header_remove('X-Powered-By');
    foreach ($headers as $h) {
        header($h);
    }
    if (vg_method() !== 'HEAD') {
        echo $body;
    }
}

function vgmr_html(array $page): void
{
    $status = (int)($page['status'] ?? 200);
    $headers = ['Cache-Control: no-cache'];
    if ($status >= 400) {
        $headers = ['Cache-Control: no-store', 'X-Robots-Tag: noindex'];
    }
    vgmr_out($status, 'text/html; charset=utf-8', vgmr_page_html($page['meta'], $page['main']), $headers);
}

function vgmr_not_found(): void
{
    vgmr_html(vgmr_render_message(404, 'Sayfa bulunamadı', 'Aradığınız ürün veya kategori kaldırılmış ya da adresi değişmiş olabilir. Mağazanın ana sayfasından devam edebilirsiniz.'));
}

ob_start();
try {
    $method = vg_method();
    if ($method !== 'GET' && $method !== 'HEAD') {
        vgmr_out(405, 'text/plain; charset=utf-8', 'Yöntem desteklenmiyor.', ['Allow: GET, HEAD']);
        exit;
    }
    $path = parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
    $path = is_string($path) ? rawurldecode($path) : '/';
    if ($path === '/magaza/index.php' || $path === '/magaza') {
        $path = '/magaza/';
    }

    // Sondaki "/" eksikse kanonik adrese yonlendir.
    if (preg_match('#^/magaza/(?:kategori|urun)/[a-z0-9-]+$#D', $path) === 1) {
        $qs = (string)($_SERVER['QUERY_STRING'] ?? '');
        vgmr_out(301, 'text/plain; charset=utf-8', '', ['Location: ' . $path . '/' . ($qs !== '' ? '?' . $qs : '')]);
        exit;
    }

    if ($path === '/magaza/sitemap.xml') {
        vgmr_out(200, 'application/xml; charset=utf-8', vgmr_sitemap(), ['Cache-Control: public, max-age=900']);
        exit;
    }
    if ($path === '/magaza/') {
        vgmr_html(vgmr_render_hub(vgmr_context(vg_now())));
        exit;
    }
    if (preg_match('#^/magaza/kategori/([a-z0-9-]{2,60})/$#D', $path, $m) === 1) {
        $page = vgmr_render_category(vgmr_context(vg_now()), $m[1]);
        $page !== null ? vgmr_html($page) : vgmr_not_found();
        exit;
    }
    if (preg_match('#^/magaza/urun/([a-z0-9-]{3,90})/$#D', $path, $m) === 1) {
        $page = vgmr_render_product(vgmr_context(vg_now()), $m[1]);
        $page !== null ? vgmr_html($page) : vgmr_not_found();
        exit;
    }
    vgmr_not_found();
} catch (Throwable $e) {
    error_log('Magaza page: ' . get_class($e) . ' at ' . basename($e->getFile()) . ':' . $e->getLine());
    try {
        vgmr_html(vgmr_render_message(503, 'Mağaza şu anda kullanılamıyor', 'Lütfen biraz sonra tekrar deneyin veya bizi telefonla arayın.'));
    } catch (Throwable $e2) {
        vgmr_out(503, 'text/plain; charset=utf-8', 'Mağaza şu anda kullanılamıyor.', ['Cache-Control: no-store']);
    }
}

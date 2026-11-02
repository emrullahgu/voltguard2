<?php
/*
 * VoltGuard Magaza herkese acik sayfalari (sunucu tarafi uretim; api/MAGAZA.md). .htaccess su adresleri buraya yonlendirir:
 *   /magaza/  /magaza/kategori/<id>/[?marka=&kutup=&akim=&egri=&ka=&kesit=&faz=&kw=&sirala=&sayfa=]  /magaza/urun/<slug>/
 *   /magaza/ara/?q=[&kategori=&marka=&sayfa=]
 *   /magaza/sitemap.xml (dizin)  /magaza/sitemap-<n>.xml (en cok 10.000 adreslik parcalar)
 *   /magaza/odeme.html (statik sablon + firma.json Turnstile site anahtari; vgmr_render_checkout_html)
 *   /magaza/{on-bilgilendirme-formu,mesafeli-satis-sozlesmesi,iade-ve-cayma,kvkk-aydinlatma,odeme-ve-teslimat}.html
 *     (statik sablon + firma.json satici tablosu ve belge surumu; vgmr_render_legal_html)
 * Yol REQUEST_URI'den okunur. Sablon: magaza/index.html. Fiyatlar her istekte vgm_price() ile hesaplanir (onbellek yok).
 * Sepet ve siparis takibi magaza/ altinda statik .html dosyalaridir.
 */
declare(strict_types=1);

define('VG_API', 1);
$vgmRoot = dirname(__DIR__);
require $vgmRoot . '/api/lib/bootstrap.php';
require $vgmRoot . '/api/lib/store.php';
require $vgmRoot . '/api/lib/security.php';
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

function vgmr_html(array $page, array $extra = []): void
{
    $status = (int)($page['status'] ?? 200);
    $headers = ['Cache-Control: no-cache'];
    if ($status >= 400) {
        $headers = ['Cache-Control: no-store', 'X-Robots-Tag: noindex'];
    }
    $headers = array_merge($headers, $extra);
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
    if (preg_match('#^/magaza/(?:(?:kategori|urun)/[a-z0-9-]+|ara)$#D', $path) === 1) {
        $qs = (string)($_SERVER['QUERY_STRING'] ?? '');
        vgmr_out(301, 'text/plain; charset=utf-8', '', ['Location: ' . $path . '/' . ($qs !== '' ? '?' . $qs : '')]);
        exit;
    }

    if ($path === '/magaza/sitemap.xml') {
        vgmr_out(200, 'application/xml; charset=utf-8', vgmr_sitemap_index(), ['Cache-Control: public, max-age=900']);
        exit;
    }
    if (preg_match('#^/magaza/sitemap-([1-9][0-9]{0,3})\.xml$#D', $path, $m) === 1) {
        $xml = vgmr_sitemap_part((int)$m[1]);
        $xml !== null ? vgmr_out(200, 'application/xml; charset=utf-8', $xml, ['Cache-Control: public, max-age=900']) : vgmr_not_found();
        exit;
    }
    if ($path === '/magaza/ara/') {
        $q = isset($_GET['q']) && is_string($_GET['q']) ? $_GET['q'] : '';
        /* Her arama tum arama dizinini tarar ve onbellege alinamaz: IP basina dakikada en cok 30 arama. */
        if (trim($q) !== '' && ($retry = vg_rl_hit('vgm_search', vg_rl_ip_key(), 30, 60)) > 0) {
            vgmr_html(vgmr_render_message(429, 'Çok fazla arama', 'Kısa sürede çok sayıda arama yaptınız. Lütfen biraz bekleyip yeniden deneyin veya kategorilere göz atın.'),
                ['Retry-After: ' . max(1, (int)$retry)]);
            exit;
        }
        vgmr_html(vgmr_render_search(vgmr_context(vg_now()), $q, $_GET));
        exit;
    }
    if ($path === '/magaza/') {
        vgmr_html(vgmr_render_hub(vgmr_context(vg_now())));
        exit;
    }
    if ($path === '/magaza/odeme.html') {
        vgmr_out(200, 'text/html; charset=utf-8', vgmr_render_checkout_html(), ['Cache-Control: no-cache']);
        exit;
    }
    if (preg_match('#^/magaza/([a-z-]{8,40})\.html$#D', $path, $m) === 1 && ($legal = vgmr_render_legal_html($m[1])) !== null) {
        vgmr_out(200, 'text/html; charset=utf-8', $legal, ['Cache-Control: no-cache']);
        exit;
    }
    if (preg_match('#^/magaza/kategori/([a-z0-9-]{2,60})/$#D', $path, $m) === 1) {
        $page = vgmr_render_category(vgmr_context(vg_now()), $m[1], $_GET);
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

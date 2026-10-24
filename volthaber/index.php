<?php
/*
 * VoltHaber herkese acik sayfalari (sunucu tarafi uretim). .htaccess su adresleri buraya yonlendirir:
 *   /volthaber/  /volthaber/<slug>/  /volthaber/kategori/<id>/  /volthaber/etiket/<etiket>/  /volthaber/sitemap.xml  /volthaber/rss.xml
 * Yol REQUEST_URI'den okunur (sorgu parametresiyle yonlendirme yapilmaz). Sablon: volthaber/index.html.
 */
declare(strict_types=1);

define('VG_API', 1);
$vhRoot = dirname(__DIR__);
require $vhRoot . '/api/lib/bootstrap.php';
require $vhRoot . '/api/lib/store.php';
require $vhRoot . '/api/lib/security.php';
require $vhRoot . '/api/lib/validate.php';
require $vhRoot . '/api/lib/volthaber.php';
require $vhRoot . '/api/lib/volthaber-render.php';

function vh_out(int $status, string $type, string $body, array $headers = []): void
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

function vh_html(array $page, int $status = 200): void
{
    $status = (int)($page['status'] ?? $status);
    $headers = ['Cache-Control: no-cache'];
    if ($status >= 400) {
        $headers = ['Cache-Control: no-store', 'X-Robots-Tag: noindex'];
    }
    vh_out($status, 'text/html; charset=utf-8', vh_page_html($page['meta'], $page['main']), $headers);
}

function vh_not_found(): void
{
    vh_html(vh_render_message(404, 'Sayfa bulunamadı', 'Aradığınız VoltHaber sayfası kaldırılmış veya adresi değişmiş olabilir.'));
}

ob_start();
try {
    $method = vg_method();
    if ($method !== 'GET' && $method !== 'HEAD') {
        vh_out(405, 'text/plain; charset=utf-8', 'Yöntem desteklenmiyor.', ['Allow: GET, HEAD']);
        exit;
    }
    $path = parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
    $path = is_string($path) ? rawurldecode($path) : '/';
    if ($path === '/volthaber/index.php' || $path === '/volthaber') {
        $path = '/volthaber/';
    }
    $page = 1;
    if (isset($_GET['sayfa'])) {
        if (!is_string($_GET['sayfa']) || preg_match('/^[1-9][0-9]{0,2}$/', $_GET['sayfa']) !== 1) {
            vh_not_found();
            exit;
        }
        $page = (int)$_GET['sayfa'];
    }
    $q = isset($_GET['q']) && is_string($_GET['q']) && preg_match('//u', $_GET['q']) === 1 ? trim(vg_substr($_GET['q'], 80)) : '';

    // Sondaki "/" eksikse kanonik adrese yonlendir.
    if (preg_match('#^/volthaber/((?:kategori|etiket)/[a-z0-9-]+|[a-z0-9-]{3,90})$#', $path) === 1) {
        $qs = (string)($_SERVER['QUERY_STRING'] ?? '');
        vh_out(301, 'text/plain; charset=utf-8', '', ['Location: ' . $path . '/' . ($qs !== '' ? '?' . $qs : '')]);
        exit;
    }

    list($state, $views) = vh_locked(false, function (string $dir) {
        return [vh_articles($dir), vh_views($dir)];
    });

    if ($path === '/volthaber/sitemap.xml') {
        vh_out(200, 'application/xml; charset=utf-8', vh_sitemap($state), ['Cache-Control: public, max-age=900']);
        exit;
    }
    if ($path === '/volthaber/rss.xml') {
        vh_out(200, 'application/rss+xml; charset=utf-8', vh_rss($state), ['Cache-Control: public, max-age=900']);
        exit;
    }
    if ($path === '/volthaber/') {
        $result = vh_render_home($state, $views, $page, $q);
        $result ? vh_html($result) : vh_not_found();
        exit;
    }
    if (preg_match('#^/volthaber/(kategori|etiket)/([a-z0-9-]{1,90})/$#', $path, $m) === 1) {
        $result = vh_render_listing($state, $views, $m[1], $m[2], $page);
        $result ? vh_html($result) : vh_not_found();
        exit;
    }
    if (preg_match('#^/volthaber/([a-z0-9-]{3,90})/$#', $path, $m) === 1) {
        $article = vh_find_slug($state, $m[1]);
        if ($article === null || !vh_is_live($article, vg_now())) {
            vh_not_found();
            exit;
        }
        // Toplam okunma sayaci: botlar ve HEAD sayilmaz, kisi bazli kayit tutulmaz.
        $ua = (string)($_SERVER['HTTP_USER_AGENT'] ?? '');
        if ($method === 'GET' && $ua !== '' && preg_match('/bot|crawl|spider|slurp|preview|fetch|monitor|curl|wget|python|headless|lighthouse/i', $ua) !== 1
            && strtolower((string)($_SERVER['HTTP_SEC_PURPOSE'] ?? $_SERVER['HTTP_PURPOSE'] ?? '')) === '') {
            try {
                vh_count_view($article['id']);
            } catch (Throwable $e) {
                // sayac hatasi sayfayi bozmaz
            }
        }
        vh_html(vh_render_article($state, $views, $article));
        exit;
    }
    vh_not_found();
} catch (Throwable $e) {
    error_log('VoltHaber page: ' . get_class($e) . ' at ' . basename($e->getFile()) . ':' . $e->getLine());
    try {
        vh_html(vh_render_message(503, 'VoltHaber şu anda kullanılamıyor', 'Lütfen biraz sonra tekrar deneyin.'));
    } catch (Throwable $e2) {
        vh_out(503, 'text/plain; charset=utf-8', 'VoltHaber şu anda kullanılamıyor.', ['Cache-Control: no-store']);
    }
}

<?php
declare(strict_types=1);
define('VG_API', 1);
require dirname(__DIR__, 2).'/api/lib/bootstrap.php';
require dirname(__DIR__, 2).'/api/lib/security.php';
require dirname(__DIR__, 2).'/api/lib/staff.php';
header('Cache-Control: no-store, private, max-age=0');
header('X-Robots-Tag: noindex, nofollow, noarchive');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: same-origin');
try {
    vg_check_fetch_site();
    vg_staff_require_user();
    if (!in_array(vg_method(), ['GET', 'HEAD'], true)) vg_fail(405, 'method_not_allowed', 'İstek yöntemi desteklenmiyor.');
} catch (VgHttpError $e) {
    if ($e->status === 401) { header('Location: /calisan/giris.html', true, 303); exit; }
    http_response_code($e->status); header('Content-Type: text/plain; charset=utf-8');
    echo 'Saha Takip şu anda kullanılamıyor.'; exit;
} catch (Throwable $e) {
    http_response_code(503); header('Content-Type: text/plain; charset=utf-8');
    echo 'Saha Takip şu anda kullanılamıyor.'; exit;
}
session_write_close();
header('Location: /calisan/uygulama/?module=uygulamalar', true, 303);
exit;

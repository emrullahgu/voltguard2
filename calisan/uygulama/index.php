<?php
declare(strict_types=1);
define('VG_API',1);
require dirname(__DIR__,2).'/api/lib/bootstrap.php';
require dirname(__DIR__,2).'/api/lib/security.php';
require dirname(__DIR__,2).'/api/lib/staff.php';
header('Cache-Control: no-store, private, max-age=0');
header('X-Robots-Tag: noindex, nofollow, noarchive');
header('Referrer-Policy: same-origin');
try { vg_staff_require_user(); }
catch(VgHttpError $e){if($e->status===401){header('Location: /calisan/giris.html',true,303);exit;}http_response_code($e->status);header('Content-Type: text/plain; charset=utf-8');echo 'Çalışan uygulamaları şu anda kullanılamıyor.';exit;}
catch(Throwable $e){http_response_code(503);header('Content-Type: text/plain; charset=utf-8');echo 'Çalışan uygulamaları şu anda kullanılamıyor.';exit;}
if(!is_file(__DIR__.'/entry-tags.html')){http_response_code(503);echo 'Çalışan uygulamaları hazırlanıyor.';exit;}
header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Çalışan Uygulamaları | VoltGuard</title><meta name="theme-color" content="#0a1628"><link rel="icon" href="/public/favicon-32.png"><link rel="stylesheet" href="/css/fonts.css?v=2912feacba52"><link rel="stylesheet" href="/css/fa-subset.css?v=875de322c835"><link rel="stylesheet" href="/css/vg-shell.css?v=eff46729ea12"><link rel="stylesheet" href="/css/company.css?v=1a1b76bd5918"><script src="/js/vg-shell.js?v=f4956253830f" defer></script>
<?php readfile(__DIR__.'/entry-tags.html'); ?>
</head><body class="company-page"><?php readfile(dirname(__DIR__).'/shared-header.html'); ?><main id="main" tabindex="-1"><div id="vg-company-workspace"><p role="status">Çalışan uygulamaları yükleniyor…</p></div></main><?php readfile(dirname(__DIR__).'/shared-footer.html'); ?></body></html>

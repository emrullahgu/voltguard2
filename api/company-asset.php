<?php
declare(strict_types=1);
define('VG_API',1);
require __DIR__.'/lib/bootstrap.php';
require __DIR__.'/lib/security.php';
require __DIR__.'/lib/staff.php';
try {
    vg_check_fetch_site(); vg_staff_require_user();
    if(!in_array(vg_method(),['GET','HEAD'],true)) vg_fail(405,'method_not_allowed','İstek yöntemi desteklenmiyor.');
    $name=$_GET['file']??'';
    if(!is_string($name)||strlen($name)>260||preg_match('#^[A-Za-z0-9/_., -]+$#D',$name)!==1||strpos($name,'..')!==false||$name[0]==='/') vg_fail(404,'not_found','Dosya bulunamadı.');
    if(!preg_match('#^(assets|fonts|licenses)/#D',$name)&&$name!=='fatura_logo.png')vg_fail(404,'not_found','Dosya bulunamadı.');
    $root=realpath(dirname(__DIR__).'/calisan/uygulama');
    $file=realpath($root.'/'.$name);
    $mime=['js'=>'text/javascript; charset=utf-8','css'=>'text/css; charset=utf-8','png'=>'image/png','jpg'=>'image/jpeg','jpeg'=>'image/jpeg','webp'=>'image/webp','svg'=>'image/svg+xml','ico'=>'image/x-icon','woff2'=>'font/woff2','woff'=>'font/woff','ttf'=>'font/ttf','txt'=>'text/plain; charset=utf-8','json'=>'application/json; charset=utf-8','html'=>'text/html; charset=utf-8'];
    $extension=strtolower(pathinfo($name,PATHINFO_EXTENSION));
    if(preg_match('#^licenses/[A-Za-z0-9_.-]+/(LICENSE|LICENCE|NOTICE|COPYING|license|licence)(\.(txt|md))?$#D',$name)) { $mime[$extension]='text/plain; charset=utf-8'; }
    if(!$root||!$file||strpos(strtolower(str_replace('\\','/',$file)),strtolower(str_replace('\\','/',$root)).'/')!==0||!is_file($file)||!isset($mime[$extension])||in_array(strtolower($name),['entry-tags.html','index.html'],true)) vg_fail(404,'not_found','Dosya bulunamadı.');
    vg_common_headers(200,[]);
    header('Content-Type: '.$mime[$extension]);
    header('Content-Length: '.filesize($file));
    if($extension==='html')header("Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'");
    session_write_close();
    if(vg_method()!=='HEAD')readfile($file);
}catch(VgHttpError $e){vg_common_headers($e->status,[]);echo vg_json_encode(['api'=>'vg-company/1','ok'=>false,'error'=>$e->errCode,'message'=>$e->getMessage()]);}
catch(Throwable $e){vg_common_headers(503,[]);echo vg_json_encode(['api'=>'vg-company/1','ok'=>false,'error'=>'unavailable','message'=>'Çalışan dosyası şu anda kullanılamıyor.']);}

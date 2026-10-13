<?php
/** External collectors remain disabled while the company uses file imports. */
declare(strict_types=1);
define('VG_API',1);
require __DIR__.'/lib/bootstrap.php';require __DIR__.'/lib/security.php';require __DIR__.'/lib/staff.php';
try {
    vg_check_fetch_site();vg_staff_require_user();
    if(vg_method()!=='GET'||vg_action()!=='status')vg_fail(409,'connector_disabled','Canlı bağlantılar kapalı. OSOS dosyasını Excel veya JSON olarak içe aktarın.');
    vg_common_headers(200,[]);echo vg_json_encode(['api'=>'vg-company/1','ok'=>true,'data'=>['mode'=>'file_import','kosbi'=>false,'worktracker'=>false,'automaticCollector'=>false]]);
}catch(VgHttpError $e){vg_common_headers($e->status,[]);echo vg_json_encode(['api'=>'vg-company/1','ok'=>false,'error'=>$e->errCode,'message'=>$e->getMessage()]);}
catch(Throwable $e){vg_common_headers(503,[]);echo vg_json_encode(['api'=>'vg-company/1','ok'=>false,'error'=>'unavailable','message'=>'Şirket bağlantı durumu şu anda kullanılamıyor.']);}

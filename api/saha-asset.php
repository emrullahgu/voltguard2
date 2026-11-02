<?php
/** Private SahaTakip attachments are never public or service-worker cacheable. */
declare(strict_types=1);
define('VG_API',1);
require __DIR__.'/lib/bootstrap.php';require __DIR__.'/lib/security.php';require __DIR__.'/lib/staff.php';require __DIR__.'/lib/company.php';
ob_start();
try {
    vg_check_fetch_site();vg_staff_session_start();$user=vg_staff_require_user();if(!in_array(vg_method(),['GET','HEAD'],true))vg_company_fail(405,'saha_asset_method');
    try {
        $result=vg_company_store(function(array &$s,array $u){return vg_saha_storage($s,$u,['operation'=>'download','bucket'=>$_GET['bucket']??'','path'=>$_GET['path']??'']);}, true);
    } catch (VgHttpError $missing) {
        if ($missing->status !== 404 || $missing->errCode !== 'saha_storage_missing') throw $missing;
        $config=vg_company_ubuntu_config();
        if ($config === null) throw $missing;
        $current=vg_staff_require_user();
        $config=vg_company_saha_remote_config($config);
        $result=vg_company_ubuntu_call($config,['op'=>'file','actor'=>['id'=>$current['id'],'role'=>$current['role']],'bucket'=>$_GET['bucket']??'','path'=>$_GET['path']??'']);
    }
    $body=base64_decode($result['base64'],true);if($body===false)vg_company_fail(503,'saha_asset_invalid');vg_discard_output();vg_common_headers(200,[]);
    header('Content-Type: '.$result['contentType']);header('Content-Length: '.strlen($body));header('Content-Disposition: inline; filename="sahatakip-attachment"');header("Content-Security-Policy: default-src 'none'; sandbox");header('Cross-Origin-Resource-Policy: same-origin');if(vg_method()!=='HEAD')echo $body;
} catch(VgHttpError $e){vg_discard_output();vg_common_headers($e->status,$e->headers);echo vg_json_encode(['api'=>'vg-company/1','ok'=>false,'error'=>$e->errCode,'message'=>$e->getMessage()]);}
catch(Throwable $e){vg_discard_output();vg_common_headers(503,[]);echo vg_json_encode(['api'=>'vg-company/1','ok'=>false,'error'=>'saha_asset_unavailable','message'=>'Dosyaya şu anda ulaşılamıyor.']);}
finally{if(session_status()===PHP_SESSION_ACTIVE)session_write_close();}

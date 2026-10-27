<?php
/** SahaTakip web adapter. Native employee sessions, reviewed columns and CAS records only. */
declare(strict_types=1);
if (!defined('VG_API')) { http_response_code(404); exit; }
require_once __DIR__ . '/sahatakip-schema.php';

const VG_SAHA_DENIED = ['api_keys','app_settings','einvoice_config','webhooks','pending_user_approvals','push_tokens','ai_ingest_queue','erp_adapters'];
const VG_SAHA_HR = ['employees','attendance','payroll_records','bordro_aylik','leave_requests'];
const VG_SAHA_PERSONAL = ['locations','latest_locations','location_checkins','shifts','geofence_events','vehicle_route_points','notification_preferences','notifications','app_usage','ai_chat_sessions','ai_chat_messages','email_schedules','email_dispatch_log','sales_visits','visits'];
const VG_SAHA_ACTOR_FIELDS = ['created_by','updated_by','uploaded_by','sender_id','actor_id'];
// Canonical company lists that the imported app originally stored only in
// AsyncStorage. All other cache keys remain personal preferences/caches.
const VG_SAHA_SHARED_CACHE = ['tasks_v1','product_items_v1','task_comments_v1','task_attachments_v1','transformer_quotes_v1','osos_readings_v1','weekly_reports_v1','osos_alarms_v1','osos_alarm_rules_v1','osos_auto_report_v1','osos_daily_summary_v1','@SahaTakip:recurring_templates','office_pages_v1','office_boards_v1','office_meetings_v1','@SahaTakip:import_history','ges_quotes_v1','calendar_events_v1','@SahaTakip:maintenance_plans','eq_assets_v1','eq_maint_v1','eq_fault_v1','eq_plans_v1','fo_jobs_v1','fo_check_v1','fo_qc_v1','fo_perf_v1','fo_zones_v1','fo_plan_v1','fo_emerg_v1','feedback_entries_v1','gov_departments_v1','gov_regions_v1','gov_approvals_v1','cx_quote_approvals_v1','cx_customer_comments_v1','cx_satisfaction_surveys_v1','cx_auto_reports_v1','@SahaTakip:customer_documents','lo_heat_v1','lo_personnel_v1','lo_routes_v1','lo_eta_v1','lo_perf_v1'];
const VG_SAHA_MANAGED_CACHE = ['timesheet_v1','payroll_runs_v1','bordro_v1','@SahaTakip:cash_entries'];
// Bulk location histories have no per-user row identity. Share them only with
// the administrator rather than bypassing the normal location owner checks.
const VG_SAHA_ADMIN_CACHE = ['lo_entities_v1','lo_devs_v1','lo_events_v1','lo_replay_v1'];
function vg_saha_shared_cache_keys(): array { return array_merge(VG_SAHA_SHARED_CACHE,VG_SAHA_MANAGED_CACHE,VG_SAHA_ADMIN_CACHE); }
function vg_saha_cache_managed(string $key): bool { return in_array($key,VG_SAHA_MANAGED_CACHE,true); }
function vg_saha_cache_record(array $s,string $key): ?array { return vg_saha_find($s,'_cache',hash('sha256',$key)); }

function vg_saha_uuid(string $staff): string {
    $h = hash('sha256', 'voltguard-sahatakip-staff:' . $staff); $h[12] = '5'; $h[16] = dechex((hexdec($h[16]) & 3) | 8);
    return substr($h,0,8).'-'.substr($h,8,4).'-'.substr($h,12,4).'-'.substr($h,16,4).'-'.substr($h,20,12);
}
function vg_saha_profile(array $record, array $actor): array {
    $role = $record['role'] === 'admin' ? 'admin' : ($record['role'] === 'payroll' ? 'manager' : 'engineer');
    return ['id'=>vg_saha_uuid($record['id']),'full_name'=>$record['name'],'name'=>$record['name'],'email'=>($record['id']===$actor['id'] || $actor['role']==='admin') ? $record['email'] : null,'role'=>$role,'approval_status'=>'approved','approved'=>true,'phone'=>null,'avatar_url'=>null,'created_at'=>$record['createdAt']??null];
}
function vg_saha_profiles(array $actor): array {
    return vg_staff_store(function(array &$staff) use($actor) { $out=[]; foreach($staff['users'] as $record) if(($record['status']??'')==='active' && !empty($record['password']) && !empty($record['mfaSecret'])) $out[]=vg_saha_profile($record,$actor); return $out; });
}
function vg_saha_public_user(array $u): array {
    $p=vg_saha_profile($u,$u); return ['id'=>$p['id'],'email'=>$u['email'],'user_metadata'=>['full_name'=>$u['name']],'app_metadata'=>['role'=>$p['role']],'role'=>'authenticated'];
}
function vg_saha_key(string $table,string $id): string { return hash('sha256',$table.':'.$id); }
function vg_saha_all(array $s,string $table): array {
    $out=[]; foreach($s['tables']['saha_records']??[] as $record) if(($record['collection']??null)===$table && is_array($record['payload']??null)) $out[$record['record_id']]=$record;
    return $out;
}
function vg_saha_find(array $s,string $table,$id): ?array { return is_string($id) ? ($s['tables']['saha_records'][vg_saha_key($table,$id)]??null) : null; }
function vg_saha_members(array $s,string $conversation): array {
    $ids=[]; foreach(vg_saha_all($s,'conversation_participants') as $row) if(($row['payload']['conversation_id']??null)===$conversation) $ids[]=$row['payload']['user_id']??null; return $ids;
}
function vg_saha_user_id(array $u): string { return vg_saha_uuid($u['id']); }
function vg_saha_visible(array $s,array $u,string $table,array $record): bool {
    $p=$record['payload']??[]; $me=vg_saha_user_id($u); $admin=$u['role']==='admin';
    if(in_array($table,VG_SAHA_HR,true)) {
        if(vg_company_manage($u)) return true;
        if($table==='employees') return true; // Public employee directory is redacted before projection below.
        $employee=vg_saha_find($s,'employees',$p['employee_id']??null);
        return ($p['user_id']??null)===$me || ($employee && ($employee['payload']['user_id']??null)===$me);
    }
    if($table==='conversations') return ($p['created_by']??null)===$me || in_array($me,vg_saha_members($s,$p['id']??''),true);
    if(in_array($table,['conversation_participants','messages'],true)) return in_array($me,vg_saha_members($s,$p['conversation_id']??''),true) || (($conversation=vg_saha_find($s,'conversations',$p['conversation_id']??null)) && ($conversation['payload']['created_by']??null)===$me);
    if(in_array($table,VG_SAHA_PERSONAL,true)) return $admin || ($p['user_id']??$p['created_by']??null)===$me;
    if($table==='audit_log') return $admin || ($p['user_id']??null)===$me;
    return true;
}
function vg_saha_writable(array $s,array $u,string $table,?array $record,array $row,string $operation): void {
    $me=vg_saha_user_id($u); $admin=$u['role']==='admin'; $old=$record['payload']??null;
    if($table==='visits')vg_company_fail(403,'saha_visit_rpc','Ziyaretler giriş ve çıkış işlemleriyle kaydedilir.');
    if(in_array($table,VG_SAHA_DENIED,true) || in_array($table,['profiles','latest_locations'],true)) vg_company_fail(403,'saha_readonly','Bu alan mevcut çalışan yönetiminden veya sunucu bağlantısından yönetilir.');
    if(in_array($table,VG_SAHA_HR,true) && !vg_company_manage($u)) vg_company_fail(403,'saha_payroll','Personel ve bordro yönetim yetkisi gerekiyor.');
    if($record && !vg_saha_visible($s,$u,$table,$record)) vg_company_fail(403,'saha_scope','Bu kayıt için erişiminiz yok.');
    if($table==='conversation_participants') {
        $cid=$row['conversation_id']??$old['conversation_id']??null; $conversation=vg_saha_find($s,'conversations',$cid);
        $selfRead=$old&&($old['user_id']??null)===$me&&$operation==='update'&&!array_diff(array_keys($row),['last_read_at']);
        if(!$selfRead&&(!$conversation || ($conversation['payload']['created_by']??null)!==$me)) vg_company_fail(403,'saha_participant','Görüşmenin katılımcılarını yalnızca görüşmeyi başlatan çalışan yönetebilir.');
        $allowed=array_column(vg_saha_profiles($u),'id'); if(!in_array($row['user_id']??$old['user_id']??null,$allowed,true)) vg_company_fail(422,'saha_participant','Etkin bir çalışan seçin.');
    } elseif($table==='messages') {
        $probe=['payload'=>array_merge($old??[],$row)]; if(!vg_saha_visible($s,$u,$table,$probe)) vg_company_fail(403,'saha_participant','Yalnızca katıldığınız görüşmeye mesaj yazabilirsiniz.');
        if($old && ($old['sender_id']??null)!==$me) vg_company_fail(403,'saha_owner','Yalnızca kendi mesajınızı değiştirebilirsiniz.');
    } elseif(in_array($table,VG_SAHA_PERSONAL,true)) {
        $owner=$row['user_id']??$old['user_id']??$me; if($owner!==$me && !$admin) vg_company_fail(403,'saha_owner','Yalnızca kendi kaydınızı değiştirebilirsiniz.');
    } elseif($old && !$admin && !vg_company_manage($u) && ($old['created_by']??null)!==$me && !in_array($table,['stock_balances','stock_movements','form_responses'],true)) {
        $assigned=$old['assigned_to_id']??null; $employee=vg_saha_find($s,'employees',$assigned);
        if($assigned!==$me && (!$employee || ($employee['payload']['user_id']??null)!==$me)) vg_company_fail(403,'saha_owner','Bu kaydı oluşturan veya atanan çalışan olmalısınız.');
    }
    if(in_array($table,['audit_log','app_usage'],true) && $operation!=='insert') vg_company_fail(403,'saha_readonly','İşlem geçmişi değiştirilemez.');
    $parentMap=['quote_lines'=>['quotes','quote_id'],'quote_revisions'=>['quotes','quote_id'],'work_order_materials'=>['work_orders','work_order_id'],'work_order_photos'=>['work_orders','work_order_id']];
    if(isset($parentMap[$table])) {[$parentTable,$parentField]=$parentMap[$table];$parent=vg_saha_find($s,$parentTable,$row[$parentField]??$old[$parentField]??null);if(!$parent)vg_company_fail(422,'saha_reference','Bağlı kayıt bulunamadı.');vg_saha_writable($s,$u,$parentTable,$parent,[],'update');}
}
function vg_saha_references(array $s,array $u,string $table,array $row): void {
    $schema=vg_saha_schema();$profiles=null;
    foreach($schema[$table]??[]as $field=>$meta){$value=$row[$field]??null;if($value===null||$value===''||!isset($meta['references']))continue;$target=$meta['references'][0];
        if($target==='profiles'){if($profiles===null)$profiles=array_column(vg_saha_profiles($u),'id');if(!in_array($value,$profiles,true))vg_company_fail(422,'saha_reference','Etkin bir çalışan seçin.');continue;}
        if(!isset($schema[$target]))continue;$related=vg_saha_find($s,$target,$value);if(!$related||!vg_saha_visible($s,$u,$target,$related))vg_company_fail(422,'saha_reference','Bağlı kayıt bulunamadı veya erişiminiz yok.');
    }
}
function vg_saha_delete_references(array $s,string $table,string $id): void {
    foreach(vg_saha_schema()as $other=>$fields)foreach($fields as $field=>$meta)if(($meta['references'][0]??null)===$table)foreach(vg_saha_all($s,$other)as $record)if(($record['payload'][$field]??null)===$id&&empty($record['payload']['deleted_at']))vg_company_conflict('Bu kayıt geçmiş iş kayıtlarıyla ilişkili. Silmek yerine pasif yapın.');
}
function vg_saha_field(string $table,$field): string {
    $schema=vg_saha_schema(); $common=['id','created_at','updated_at','created_by','updated_by','deleted_at'];
    if(!is_string($field) || (!isset($schema[$table][$field]) && !in_array($field,$common,true))) vg_company_fail(400,'saha_field','Desteklenmeyen SahaTakip alanı.');
    if(preg_match('/(?:password|secret|api_key|access_token|refresh_token|service_role|credential|totp)/i',$field)) vg_company_fail(403,'saha_secret','Gizli bağlantı bilgileri çalışan uygulamasında saklanamaz.');
    return $field;
}
function vg_saha_validate(string $table,array $row): void {
    $schema=vg_saha_schema()[$table]??[];
    if(strlen(vg_json_encode($row))>1048576) vg_company_fail(413,'saha_record_size','Kayıt 1 MB sınırını aşıyor.');
    foreach($row as $field=>$value) {
        vg_saha_field($table,$field); if($value===null) continue; $type=$schema[$field]['type']??'text';
        if(is_string($value) && (!preg_match('//u',$value)||strpos($value,"\0")!==false||strlen($value)>1048576)) vg_company_fail(422,'saha_value');
        if(in_array($type,['json','jsonb'],true) || substr($type,-2)==='[]') { if(!is_array($value) && !is_scalar($value)) vg_company_fail(422,'saha_value'); continue; }
        if(in_array($type,['numeric','decimal','real','double precision','integer','bigint','smallint','int','int2','int4','int8','float','float4','float8'],true)) { if(is_bool($value)||!is_numeric($value)||!is_finite((float)$value)||abs((float)$value)>1000000000000) vg_company_fail(422,'saha_number'); continue; }
        if(in_array($type,['boolean','bool'],true)) { if(!is_bool($value)) vg_company_fail(422,'saha_boolean'); continue; }
        if($type==='date') { vg_company_date($value); continue; }
        if(strpos($type,'timestamp')===0 || $type==='timestamptz') { if(!is_string($value)||strlen($value)>40||!preg_match('/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/', $value)||strtotime($value)===false) vg_company_fail(422,'saha_date'); continue; }
        if(is_array($value) || (!is_string($value) && !is_numeric($value) && !is_bool($value))) vg_company_fail(422,'saha_value');
    }
    foreach($schema as $field=>$meta) if(!empty($meta['required']) && (!array_key_exists($field,$row)||$row[$field]===null||$row[$field]==='')) vg_company_fail(422,'saha_required','Zorunlu alanları doldurun: '.$field);
    if($table==='quotes' && !in_array($row['status']??'Taslak',['Taslak','Onay Bekliyor','Müşteriye Gönderildi','Kabul Edildi','Reddedildi','Faturalandırıldı'],true)) vg_company_fail(422,'saha_status');
    if($table==='work_orders' && !in_array($row['status']??'Bekliyor',['Bekliyor','Atandı','Yolda','Başladı','Tamamlandı','İptal','Onay Bekliyor','Teklif Gönderildi','Faturalandırıldı','Servis Açıldı','Devam Ediyor','Müşteri Onayı'],true)) vg_company_fail(422,'saha_status');
    foreach(['latitude','start_lat','end_lat','lat'] as $field) if(isset($row[$field]) && abs((float)$row[$field])>90) vg_company_fail(422,'saha_location');
    foreach(['longitude','start_lng','end_lng','lng'] as $field) if(isset($row[$field]) && abs((float)$row[$field])>180) vg_company_fail(422,'saha_location');
}
function vg_saha_defaults(string $table): array {
    $defaults=['quotes'=>['status'=>'Taslak','date'=>date('Y-m-d'),'subtotal'=>0,'vat_total'=>0,'grand_total'=>0,'revision'=>0,'images'=>[]], 'work_orders'=>['status'=>'Bekliyor','date'=>date('Y-m-d'),'job_type'=>'FIELD','priority'=>'Normal','assignment_status'=>'Atanmadı','materials_json'=>[],'time_logs_json'=>[],'other_cost'=>0,'labor_cost'=>0,'material_cost'=>0,'quote_amount'=>0,'profit'=>0], 'employees'=>['active'=>true,'daily_wage'=>0,'monthly_wage'=>0,'attendance_json'=>[]], 'quote_lines'=>['unit'=>'Adet','quantity'=>1,'material_price'=>0,'install_price'=>0,'dismantle_price'=>0,'with_dismantle'=>false,'overhead_pct'=>10,'profit_pct'=>15,'vat_pct'=>20,'discount_pct'=>0], 'shifts'=>['end_at'=>null,'break_minutes'=>0], 'notifications'=>['read'=>false], 'assets'=>['status'=>'active']];
    return $defaults[$table]??[];
}
function vg_saha_filters(string $table,$filters): array {
    if(!is_array($filters)||count($filters)>32) vg_company_fail(400,'saha_filter');
    foreach($filters as $f) { if(!is_array($f)||!in_array($f['op']??'', ['eq','neq','is','in','gt','gte','lt','lte','like','ilike','not'],true)) vg_company_fail(400,'saha_filter'); vg_saha_field($table,$f['field']??null); $v=$f['value']??null; if($f['op']==='in') { if(!is_array($v)||count($v)>1000) vg_company_fail(400,'saha_filter'); foreach($v as $item) if(!is_scalar($item)&&$item!==null) vg_company_fail(400,'saha_filter'); } elseif($f['op']==='not') { if(!is_array($v)||($v['op']??null)!=='is'||($v['value']??null)!==null) vg_company_fail(400,'saha_filter'); } elseif(!is_scalar($v)&&$v!==null) vg_company_fail(400,'saha_filter'); }
    return $filters;
}
function vg_saha_matches(array $row,array $filters): bool {
    foreach($filters as $f) { $op=$f['op']; $value=$row[$f['field']]??null; $expected=$f['value']??null;
        if($op==='like'||$op==='ilike') { $pattern='/^'.str_replace(['%','_'],['.*','.'],preg_quote((string)$expected,'/')).'$/'.($op==='ilike'?'iu':'u'); if(strlen((string)$expected)>240 || !is_scalar($value)||preg_match($pattern,(string)$value)!==1) return false; }
        elseif(!vg_company_matches($row,[$f])) return false;
    } return true;
}
function vg_saha_put(array &$s,array $u,string $table,array $payload,?array $old): array {
    $id=$payload['id']; $outer=['id'=>vg_saha_key($table,$id),'collection'=>$table,'record_id'=>$id,'payload'=>$payload,'revision'=>$old?$old['revision']+1:1];
    $outer=vg_company_stamp($u,$outer,$old); $s['tables']['saha_records'][$outer['id']]=$outer;
    vg_company_audit($s,$u,'saha:'.($old?'update:':'insert:').$table,$id); return $outer;
}
function vg_saha_expect_version(?array $old,array $versions,string $id): void {
    if($old && (!isset($versions[$id])||!is_int($versions[$id])||$versions[$id]!==$old['revision'])) vg_company_conflict('SahaTakip kaydı değişti. Güncel kaydı yükleyip yeniden deneyin.');
}
function vg_saha_relation(array $s,array $u,string $table,array $row,string $token,array &$versions): array {
    if(!preg_match('/^(?:(\w+):)?([a-z_][a-z0-9_]*)(?:![a-zA-Z0-9_]+)?\((.*)\)$/D',$token,$m)) vg_company_fail(400,'saha_select');
    $alias=$m[1]?:$m[2]; $other=$m[2]; $selection=$m[3]; $schema=vg_saha_schema(); if(!isset($schema[$other]) || in_array($other,VG_SAHA_DENIED,true)) vg_company_fail(400,'saha_select');
    $forward=null; foreach($schema[$table]??[] as $field=>$meta) if(($meta['references'][0]??null)===$other) { $forward=$field; break; }
    $reverse=null; foreach($schema[$other]??[] as $field=>$meta) if(($meta['references'][0]??null)===$table) { $reverse=$field; break; }
    if(!$forward&&!$reverse) vg_company_fail(400,'saha_relation','Desteklenmeyen kayıt ilişkisi.');
    $values=[]; $records=$other==='profiles'?array_map(function($p){return ['payload'=>$p,'revision'=>1];},vg_saha_profiles($u)):array_values(vg_saha_all($s,$other));
    foreach($records as $record) { $p=$record['payload']; if($other!=='profiles'&&!vg_saha_visible($s,$u,$other,$record))continue; if($forward?vg_company_equal($p['id']??null,$row[$forward]??null):vg_company_equal($p[$reverse]??null,$row['id']??null)) { $values[]=vg_saha_project($s,$u,$other,$p,$selection,$versions); if($other!=='profiles')$versions[$other][$p['id']]=$record['revision']; } }
    return [$alias,$forward?($values[0]??null):$values];
}
function vg_saha_project(array $s,array $u,string $table,array $row,string $selection,array &$versions): array {
    if($table==='employees'&&!vg_company_manage($u)){
        $safe=['id','full_name','role','active','created_at','updated_at'];
        if($selection!=='*')foreach(explode(',',$selection)as $field)if(!in_array(trim($field),$safe,true))vg_company_fail(403,'saha_payroll','Maaş ve puantaj alanları için bordro yönetim yetkisi gerekiyor.');
        $row=array_intersect_key($row,array_flip($safe));
    }
    if(strlen($selection)>2000 || substr_count($selection,'(')>3 || substr_count($selection,')')!==substr_count($selection,'('))vg_company_fail(400,'saha_select');
    $out=[]; foreach(preg_split('/,(?![^()]*\))/',trim($selection)?:'*') as $field) { $field=trim($field); if($field==='*') { $out+=$row; continue; } if(strpos($field,'(')!==false){[$alias,$related]=vg_saha_relation($s,$u,$table,$row,preg_replace('/\s+/','',$field),$versions);$out[$alias]=$related;continue;} vg_saha_field($table,$field);$out[$field]=$row[$field]??null; }
    return $out;
}
function vg_saha_query(array &$s,array $u,array $a): array {
    $table=$a['table']??'';$op=$a['operation']??'select';$schema=vg_saha_schema();$latest=$table==='latest_locations';
    if(!is_string($table)||(!isset($schema[$table])&&$table!=='latest_locations')||in_array($table,VG_SAHA_DENIED,true))vg_company_fail(403,'saha_table','Bu bağlantı mevcut çalışan hesabıyla kullanılamıyor.');
    if(!in_array($op,['select','insert','update','upsert','delete'],true))vg_company_fail(400,'saha_operation');
    if($table==='latest_locations'){$table='locations';$op==='select'?:vg_company_fail(403,'saha_readonly');}
    if($table==='profiles'&&$op!=='select')vg_company_fail(403,'saha_readonly','Hesaplar mevcut çalışan yönetiminden düzenlenir.');
    $filters=vg_saha_filters($table,$a['filters']??[]);$selection=$a['select']??'*';if(!is_string($selection))vg_company_fail(400,'saha_select');
    if($table==='employees'&&!vg_company_manage($u)){foreach(array_merge($filters,$a['order']??[])as $used)if(!in_array($used['field']??null,['id','full_name','role','active','created_at','updated_at'],true))vg_company_fail(403,'saha_payroll');}
    $all=$table==='profiles'?array_combine(array_column($profiles=vg_saha_profiles($u),'id'),array_map(function($p){return ['payload'=>$p,'revision'=>1];},$profiles)):vg_saha_all($s,$table);
    if($latest){$newest=[];foreach($all as $record){$p=$record['payload'];$owner=$p['user_id']??$p['id'];$time=strtotime($p['recorded_at']??$p['created_at']??'')?:0;$old=$newest[$owner]??null;if(!$old||$time>(strtotime($old['payload']['recorded_at']??$old['payload']['created_at']??'')?:0))$newest[$owner]=$record;}$all=$newest;}
    $selected=[];foreach($all as $id=>$r)if(($table==='profiles'||vg_saha_visible($s,$u,$table,$r))&&vg_saha_matches($r['payload'],$filters))$selected[$id]=$r;
    $versions=$a['versions']??[];if(!is_array($versions))vg_company_fail(400,'saha_revision');$affected=[];
    if($op!=='select'){
        if(in_array($op,['update','delete'],true)&&!$filters)vg_company_fail(400,'saha_filter_required','Değiştirilecek kayıt seçilmelidir.');
        $raw=$a['rows']??null;$items=$op==='update'?[$raw]:(is_array($raw)&&array_is_list_compat($raw)?$raw:[$raw]);if($op==='delete')$items=[[]];if(count($items)>500)vg_company_fail(413,'saha_batch');
        foreach($items as $item){if(!is_array($item)||($item!==[]&&array_is_list_compat($item)))vg_company_fail(422,'saha_record');$targets=$op==='update'||$op==='delete'?$selected:[null];
            if($op==='upsert'){$keys=explode(',',str_replace(' ','',(string)($a['onConflict']??'id')));foreach($keys as $field)vg_saha_field($table,$field);$targets=[null];foreach($all as $existing){$same=true;foreach($keys as $key)if(!array_key_exists($key,$item)||!vg_company_equal($item[$key],$existing['payload'][$key]??null))$same=false;if($same){$targets=[$existing];break;}}}
            foreach($targets as $old){$payload=$old?array_merge($old['payload'],$item):array_merge(vg_saha_defaults($table),$item);$id=$old['payload']['id']??($payload['id']??vg_company_id());
                if(!is_string($id)||!preg_match('/^[A-Za-z0-9_:.-]{1,128}$/D',$id)||($old&&isset($item['id'])&&$item['id']!==$id))vg_company_fail(422,'saha_id');
                if(!$old&&isset($all[$id]))vg_company_fail(409,'23505','Bu kayıt zaten var.');
                vg_saha_writable($s,$u,$table,$old,$item,$op);vg_saha_expect_version($old,$versions,$id);
                if($op==='delete'){vg_saha_delete_references($s,$table,$id);unset($s['tables']['saha_records'][$old['id']]);vg_company_audit($s,$u,'saha:delete:'.$table,$id);$affected[$id]=$old;continue;}
                $now=vg_company_time($old['payload']['updated_at']??null);$me=vg_saha_user_id($u);$payload['id']=$id;$payload['created_at']=$old['payload']['created_at']??$now;$payload['updated_at']=$now;$payload['created_by']=$old['payload']['created_by']??$me;$payload['updated_by']=$me;
                foreach(VG_SAHA_ACTOR_FIELDS as $field)if(array_key_exists($field,$payload))$payload[$field]=$old['payload'][$field]??$me;
                if(in_array($table,VG_SAHA_PERSONAL,true)||$table==='audit_log')$payload['user_id']=$old['payload']['user_id']??($u['role']==='admin'?($payload['user_id']??$me):$me);
                if($table==='messages')$payload['sender_id']=$me;
                foreach(['number'] as $unique)if(in_array($table,['quotes','work_orders'],true)&&isset($payload[$unique]))foreach($all as $other)if(($other['payload']['id']??null)!==$id&&($other['payload'][$unique]??null)===$payload[$unique])vg_company_fail(409,'23505','Kayıt numarası zaten kullanılıyor.');
                vg_saha_validate($table,$payload);vg_saha_references($s,$u,$table,$payload);$affected[$id]=vg_saha_put($s,$u,$table,$payload,$old);$all[$id]=$affected[$id];
            }
        }
        if(empty($a['returning']))return ['data'=>null,'count'=>count($affected),'versions'=>array_map(function($r){return $r['revision'];},$affected),'tableVersions'=>[$table=>array_map(function($r){return $r['revision'];},$affected)]];
        $selected=$affected;
    }
    $rows=array_values($selected);$order=$a['order']??[];if(!is_array($order)||count($order)>5)vg_company_fail(400,'saha_order');foreach($order as $o)vg_saha_field($table,$o['field']??null);
    usort($rows,function($x,$y)use($order){foreach($order as $o){$a=$x['payload'][$o['field']]??null;$b=$y['payload'][$o['field']]??null;$cmp=is_numeric($a)&&is_numeric($b)?((float)$a<=>(float)$b):strcmp((string)$a,(string)$b);if($cmp)return ($o['ascending']??true)?$cmp:-$cmp;}return strcmp((string)($x['payload']['id']??''),(string)($y['payload']['id']??''));});
    $count=count($rows);$from=0;$limit=$a['limit']??1000;if(!is_int($limit)||$limit<1||$limit>5000)vg_company_fail(400,'saha_limit');if(isset($a['range'])){$range=$a['range'];if(!is_array($range)||count($range)!==2||!is_int($range[0])||!is_int($range[1])||$range[0]<0||$range[1]<$range[0]||$range[1]-$range[0]>=5000)vg_company_fail(400,'saha_range');$from=$range[0];$limit=min($limit,$range[1]-$from+1);}
    $rows=array_slice($rows,$from,$limit);$single=$a['single']??null;if(!in_array($single,[null,'one','maybe'],true))vg_company_fail(400,'saha_single');if(($single==='one'&&count($rows)!==1)||($single==='maybe'&&count($rows)>1))vg_company_fail(406,'PGRST116','Tek kayıt beklenirken farklı sayıda kayıt bulundu.');
    $tableVersions=[];$data=[];foreach($rows as $r){$p=$r['payload'];if($table!=='profiles')$tableVersions[$table][$p['id']]=$r['revision'];$data[]=vg_saha_project($s,$u,$table,$p,$selection,$tableVersions);}
    return ['data'=>$single!==null?($data[0]??null):$data,'count'=>$count,'versions'=>$tableVersions[$table]??(object)[],'tableVersions'=>$tableVersions?: (object)[]];
}
function vg_saha_cache(array &$s,array $u,array $a): array {
    $op=$a['operation']??'';$key=$a['key']??'';$prefix='saha:';$storage=&$s['storage'][$u['id']];if(!is_array($storage))$storage=[];
    if(!in_array($op,['get','set','remove','keys','clear'],true))vg_company_fail(400,'saha_cache');
    if(in_array($op,['get','set','remove'],true)&&(!is_string($key)||!preg_match('/^[A-Za-z0-9_.:@-]{1,120}$/D',$key)||preg_match('/auth|session|token|csrf|password|secret|credential/i',$key)))vg_company_fail(403,'saha_cache_key','Oturum ve gizli anahtarlar yerel kayıt alanında saklanamaz.');
    $shared=in_array($key,vg_saha_shared_cache_keys(),true);
    if($shared&&vg_saha_cache_managed($key)&&!vg_company_manage($u))vg_company_fail(403,'saha_payroll','Bu kayıt için bordro veya yönetim yetkisi gerekiyor.');
    if($shared&&in_array($key,VG_SAHA_ADMIN_CACHE,true)&&$u['role']!=='admin')vg_company_fail(403,'saha_location_scope','Toplu konum ve hareket geçmişi için yönetici yetkisi gerekiyor.');
    if($shared){
        $old=vg_saha_cache_record($s,$key);$revision=$old['revision']??0;
        if(in_array($op,['set','remove'],true)){
            if(!isset($a['revision'])||!is_int($a['revision'])||$a['revision']!==$revision)vg_company_conflict('Ortak kayıt başka bir çalışanda değişti. Güncel kaydı yükleyip yeniden deneyin.');
            $value=$op==='remove'?null:($a['value']??null);
            if($op==='set'&&(!is_string($value)||strlen($value)>2097152||strpos($value,"\0")!==false))vg_company_fail(413,'saha_cache_size');
            if($op!=='remove'||$old){
                // A removal is a versioned tombstone: delete/recreate cannot
                // reset the CAS revision and accept a stale writer (ABA).
                $payload=['id'=>hash('sha256',$key),'key'=>$key,'value'=>$value];
                $old=vg_saha_put($s,$u,'_cache',$payload,$old);$revision=$old['revision'];
            }
        }
        return ['value'=>$old['payload']['value']??null,'revision'=>$revision,'shared'=>true];
    }
    if($op==='set'){$value=$a['value']??null;if(!is_string($value)||strlen($value)>2097152||strpos($value,"\0")!==false)vg_company_fail(413,'saha_cache_size');$storage[$prefix.$key]=$value;}
    if($op==='remove')unset($storage[$prefix.$key]);if($op==='clear')foreach(array_keys($storage)as $name)if(strpos($name,$prefix)===0)unset($storage[$name]);
    if(count($storage)>2000||strlen(vg_json_encode($storage))>16777216)vg_company_fail(409,'saha_cache_capacity');
    $keys=[];foreach($storage as $name=>$_)if(strpos($name,$prefix)===0&&!in_array(substr($name,strlen($prefix)),vg_saha_shared_cache_keys(),true))$keys[]=substr($name,strlen($prefix));
    foreach(vg_saha_shared_cache_keys()as $sharedKey){if(vg_saha_cache_managed($sharedKey)&&!vg_company_manage($u))continue;if(in_array($sharedKey,VG_SAHA_ADMIN_CACHE,true)&&$u['role']!=='admin')continue;$r=vg_saha_cache_record($s,$sharedKey);if($r&&($r['payload']['value']??null)!==null)$keys[]=$sharedKey;}
    return ['value'=>$storage[$prefix.$key]??null,'keys'=>$keys,'shared'=>false];
}
function vg_saha_asset_url(string $bucket,string $path): string {return '/api/saha-asset.php?bucket='.rawurlencode($bucket).'&path='.rawurlencode($path);}
function vg_saha_asset_visible(array $s,array $u,array $record): bool {
    $p=$record['payload'];if($p['bucket']!=='chat-attachments'||($record['created_by']??null)===$u['id'])return true;
    foreach(vg_saha_all($s,'messages')as $message)if(($message['payload']['attachment_url']??$message['payload']['attachment_path']??null)===$p['path']&&vg_saha_visible($s,$u,'messages',$message))return true;return false;
}
function vg_saha_storage(array &$s,array $u,array $a): array {
    $op=$a['operation']??'';$bucket=$a['bucket']??'';$path=$a['path']??'';
    if(!in_array($bucket,['photos','customer-docs','chat-attachments'],true)||!in_array($op,['upload','download','remove','list','url'],true))vg_company_fail(400,'saha_storage');
    $paths=$op==='remove'?($a['paths']??[]):($op==='list'?[]:[$path]);if(!is_array($paths)||count($paths)>100)vg_company_fail(400,'saha_storage');foreach($paths as $name)if(!is_string($name)||!preg_match('/^[A-Za-z0-9_-][A-Za-z0-9_.\/-]{0,300}$/D',$name)||strpos($name,'..')!==false||strpos($name,'//')!==false)vg_company_fail(400,'saha_storage_path');
    $records=vg_saha_all($s,'_files');$old=vg_saha_find($s,'_files',$bucket.':'.$path);
    if($op==='list'){$prefix=$a['path']??'';if(!is_string($prefix)||($prefix!==''&&(!preg_match('/^[A-Za-z0-9_-][A-Za-z0-9_.\/-]{0,300}$/D',$prefix)||strpos($prefix,'..')!==false||strpos($prefix,'//')!==false)))vg_company_fail(400,'saha_storage_path');$data=[];foreach($records as $record)if($record['payload']['bucket']===$bucket&&($prefix===''||strpos($record['payload']['path'],rtrim($prefix,'/').'/')===0)&&vg_saha_asset_visible($s,$u,$record))$data[]=['name'=>$record['payload']['path'],'id'=>$record['record_id'],'metadata'=>['size'=>$record['payload']['size'],'mimetype'=>$record['payload']['contentType']]];return ['data'=>$data];}
    if($op==='remove'){foreach($paths as $name){$r=vg_saha_find($s,'_files',$bucket.':'.$name);if(!$r)continue;if(($r['created_by']??null)!==$u['id']&&$u['role']!=='admin')vg_company_fail(403,'saha_storage_owner');unset($s['tables']['saha_records'][$r['id']]);vg_company_audit($s,$u,'saha:file:delete',$r['id']);}return ['data'=>null];}
    if($op==='upload'){
        if($old&&empty($a['upsert']))vg_company_fail(409,'23505','Bu dosya zaten var.');if($old){if(($old['created_by']??null)!==$u['id'])vg_company_fail(403,'saha_storage_owner');vg_saha_expect_version($old,$a['versions']??[],$old['record_id']);}
        $base64=$a['base64']??null;$data=is_string($base64)?base64_decode($base64,true):false;if($data===false||strlen($data)<1||strlen($data)>1048576)vg_company_fail(413,'saha_storage_size','Dosya en fazla 1 MB olabilir.');
        $mime=(new finfo(FILEINFO_MIME_TYPE))->buffer($data);$requested=$a['contentType']??'application/octet-stream';$allowed=['image/jpeg','image/png','image/gif','image/webp','application/pdf','text/plain','text/csv','application/zip','application/msword','application/vnd.ms-excel','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','audio/ogg','audio/mpeg','audio/mp4','audio/webm','audio/wav','audio/x-wav','video/mp4','video/webm','application/octet-stream'];if(!in_array($mime,$allowed,true)||!in_array($requested,$allowed,true))vg_company_fail(415,'saha_storage_type','Bu dosya türü desteklenmiyor.');
        $payload=['id'=>$bucket.':'.$path,'bucket'=>$bucket,'path'=>$path,'size'=>strlen($data),'contentType'=>$mime,'base64'=>$base64];$record=vg_saha_put($s,$u,'_files',$payload,$old);return ['path'=>$path,'fullPath'=>$bucket.'/'.$path,'revision'=>$record['revision']];
    }
    if(!$old||!vg_saha_asset_visible($s,$u,$old))vg_company_fail(404,'saha_storage_missing','Dosya bulunamadı.');
    if($op==='download')return ['base64'=>$old['payload']['base64'],'contentType'=>$old['payload']['contentType']];$url=vg_saha_asset_url($bucket,$path);return ['signedUrl'=>$url,'publicUrl'=>$url];
}
function vg_saha_bump_usage(array &$s,array $u,array $a): array {
    $date=$a['p_date']??(new DateTimeImmutable('now',new DateTimeZone('Europe/Istanbul')))->format('Y-m-d');vg_company_date($date);
    $deltas=[];foreach(['screen_views'=>'p_screens','actions'=>'p_actions','sessions'=>'p_sessions']as $field=>$parameter){$delta=$a[$parameter]??0;if(!is_int($delta)||$delta<0||$delta>100000)vg_company_fail(422,'saha_usage','Kullanım artışlarını kontrol edin.');$deltas[$field]=$delta;}
    $me=vg_saha_user_id($u);$old=null;foreach(vg_saha_all($s,'app_usage')as $record)if(($record['payload']['user_id']??null)===$me&&($record['payload']['date']??null)===$date){$old=$record;break;}
    $now=vg_company_time($old['payload']['updated_at']??null);$payload=$old['payload']??['id'=>vg_saha_uuid('usage:'.$me.':'.$date),'user_id'=>$me,'date'=>$date,'created_at'=>$now,'created_by'=>$me];
    foreach($deltas as $field=>$delta)$payload[$field]=(int)($payload[$field]??0)+$delta;
    $payload['user_name']=$u['name'];$payload['last_active']=$now;$payload['updated_at']=$now;$payload['updated_by']=$me;
    vg_saha_validate('app_usage',$payload);return vg_saha_put($s,$u,'app_usage',$payload,$old)['payload'];
}
function vg_saha_run_due_templates(array &$s,array $u): array {
    $today=(new DateTimeImmutable('now',new DateTimeZone('Europe/Istanbul')))->format('Y-m-d');$me=vg_saha_user_id($u);$orders=[];$versions=[];$due=[];
    foreach(vg_saha_all($s,'recurring_templates')as $record){$p=$record['payload'];if(($p['active']??true)!==true||($p['next_run_date']??'9999-12-31')>$today)continue;if(!vg_company_manage($u)&&($p['created_by']??null)!==$me)continue;$due[]=$record;}
    if(count($due)>100)vg_company_fail(413,'saha_recurring_capacity','Bir seferde en fazla 100 periyodik iş oluşturulabilir.');
    foreach($due as $record){
        $p=$record['payload'];$date=$p['next_run_date'];vg_company_date($date);$interval=$p['interval_days']??30;if(!is_int($interval)&&!(is_string($interval)&&ctype_digit($interval)))vg_company_fail(422,'saha_interval');$interval=(int)$interval;if($interval<1||$interval>3660)vg_company_fail(422,'saha_interval','Tekrar süresi 1–3660 gün arasında olmalıdır.');
        $number='RT-'.$date.'-'.substr(hash('sha256',$p['id']),0,10);$existing=null;foreach(vg_saha_all($s,'work_orders')as $work)if(($work['payload']['number']??null)===$number){$existing=$work;break;}
        if($existing){$orders[]=$existing['payload'];$versions['work_orders'][$existing['record_id']]=$existing['revision'];}
        else{
            $row=['number'=>$number,'title'=>$p['service_name']??$p['title'],'service_name'=>$p['service_name']??'','customer_name'=>$p['client']??'','date'=>$today,'engineer'=>$p['default_engineer']??'','status'=>'Bekliyor','priority'=>$p['priority']??'Normal','template_id'=>$p['id'],'notes'=>'Otomatik üretildi (şablon: '.($p['title']??'').')'];
            $result=vg_saha_query($s,$u,['table'=>'work_orders','operation'=>'insert','rows'=>[$row],'returning'=>true,'single'=>'one']);$orders[]=$result['data'];$versions['work_orders']=array_merge($versions['work_orders']??[],$result['versions']);
        }
        // One actionable work order covers an overdue template. Move its next
        // run into the future in this same transaction, so retries cannot create
        // a backlog of duplicate overdue jobs or advance a template without a job.
        $start=new DateTimeImmutable($date,new DateTimeZone('Europe/Istanbul'));$elapsed=(int)$start->diff(new DateTimeImmutable($today,new DateTimeZone('Europe/Istanbul')))->days;$next=$start->modify('+'.((intdiv($elapsed,$interval)+1)*$interval).' days')->format('Y-m-d');
        $result=vg_saha_query($s,$u,['table'=>'recurring_templates','operation'=>'update','rows'=>['next_run_date'=>$next],'filters'=>[['op'=>'eq','field'=>'id','value'=>$p['id']]],'versions'=>[$p['id']=>$record['revision']],'returning'=>true,'single'=>'one']);$versions['recurring_templates']=array_merge($versions['recurring_templates']??[],$result['versions']);
    }
    return ['orders'=>$orders,'tableVersions'=>$versions?: (object)[]];
}
function vg_saha_visit_result(?array $record,array $checks=[]): array {
    if(!$record)return ['visit'=>null,'revision'=>0];
    return ['visit'=>$record['payload'],'revision'=>$record['revision'],'tableVersions'=>['visits'=>[$record['record_id']=>$record['revision']]]+($checks?['location_checkins'=>$checks]:[])];
}
function vg_saha_visit(array &$s,array $u,string $operation,array $a): array {
    $me=vg_saha_user_id($u);$active=null;
    foreach(vg_saha_all($s,'visits')as $record)if(($record['payload']['user_id']??null)===$me&&empty($record['payload']['end_at'])){
        if($active)vg_company_conflict('Birden fazla açık ziyaret bulundu. Kayıtlarınızı yöneticiyle kontrol edin.');
        $active=$record;
    }
    if($operation==='visit_active')return vg_saha_visit_result($active);
    $lat=$a['lat']??null;$lng=$a['lng']??null;
    if((!is_int($lat)&&!is_float($lat))||(!is_int($lng)&&!is_float($lng))||!is_finite((float)$lat)||!is_finite((float)$lng)||$lat < -90||$lat > 90||$lng < -180||$lng > 180)vg_company_fail(422,'saha_visit_location','Geçerli konum bilgisi gerekiyor.');
    $now=vg_company_time();$checks=[];
    if($operation==='visit_check_in'){
        $customer=vg_saha_find($s,'customers',$a['customer_id']??null);
        if(!$customer||!empty($customer['payload']['deleted_at'])||!vg_saha_visible($s,$u,'customers',$customer))vg_company_fail(422,'saha_reference','Ziyaret için kayıtlı bir müşteri seçin.');
        if($active){if($active['payload']['customer_id']!==$customer['record_id'])vg_company_conflict('Önce açık ziyaretinizi tamamlayın.');return vg_saha_visit_result($active);}
        $id=vg_company_id();$payload=['id'=>$id,'user_id'=>$me,'customer_id'=>$customer['record_id'],'customer_name'=>$customer['payload']['short_name']??$customer['payload']['title']??'','start_at'=>$now,'start_lat'=>$lat,'start_lng'=>$lng,'end_at'=>null,'status'=>'active','notes'=>'','photos'=>[],'created_at'=>$now,'updated_at'=>$now,'created_by'=>$me,'updated_by'=>$me];
        $saved=vg_saha_put($s,$u,'visits',$payload,null);$kind='start';
    }else{
        $old=vg_saha_find($s,'visits',$a['id']??null);
        if(!$old||($old['payload']['user_id']??null)!==$me)vg_company_fail(404,'saha_visit_missing','Ziyaret kaydı bulunamadı.');
        // Retry of a confirmed checkout is idempotent and never adds another check-in event.
        if(!empty($old['payload']['end_at']))return vg_saha_visit_result($old);
        vg_saha_expect_version($old,[$old['record_id']=>$a['revision']??null],$old['record_id']);
        $notes=$a['notes']??'';$photos=$a['photos']??[];
        if(!is_string($notes)||strlen($notes)>8000||!is_array($photos)||($photos!==[]&&!array_is_list_compat($photos))||count($photos)>20)vg_company_fail(422,'saha_visit_notes','Ziyaret notu veya görsellerini kontrol edin.');
        foreach($photos as $photo)if(!is_string($photo)||strlen($photo)>2000||strpos($photo,'/api/saha-asset.php?')!==0)vg_company_fail(422,'saha_visit_photos','Yalnız şirket dosya alanındaki görseller eklenebilir.');
        $payload=array_merge($old['payload'],['end_at'=>$now,'end_lat'=>$lat,'end_lng'=>$lng,'status'=>'completed','notes'=>$notes,'photos'=>$photos,'updated_at'=>$now,'updated_by'=>$me]);
        $saved=vg_saha_put($s,$u,'visits',$payload,$old);$id=$old['record_id'];$kind='end';
    }
    $checkId=vg_saha_uuid('visit-'.$kind.':'.$id);
    $check=['id'=>$checkId,'user_id'=>$me,'customer_id'=>$saved['payload']['customer_id'],'site_code'=>'visit:'.$id.':'.$kind,'method'=>'manual','lat'=>$lat,'lng'=>$lng,'recorded_at'=>$now,'created_at'=>$now,'updated_at'=>$now,'created_by'=>$me,'updated_by'=>$me];
    $checkRecord=vg_saha_put($s,$u,'location_checkins',$check,null);$checks[$checkId]=$checkRecord['revision'];
    return vg_saha_visit_result($saved,$checks);
}
function vg_saha_rpc(array &$s,array $u,string $name,array $a){
    if($name==='app_saha_bootstrap'){
        $cache=[];$sharedKeys=vg_saha_shared_cache_keys();foreach($s['storage'][$u['id']]??[]as $key=>$value)if(strpos($key,'saha:')===0&&!in_array(substr($key,5),$sharedKeys,true))$cache[substr($key,5)]=$value;
        return ['user'=>vg_saha_public_user($u),'profile'=>vg_saha_profile($u,$u),'capabilities'=>['private'=>true,'dataSource'=>$GLOBALS['vg_company_data_source']??'local','externalAI'=>false,'externalServices'=>false,'maxUploadBytes'=>1048576,'sharedRecords'=>true,'sharedCacheKeys'=>$sharedKeys],'sharedCacheKeys'=>$sharedKeys,'cache'=>$cache?: (object)[]];
    }
    if($name==='app_saha_query')return vg_saha_query($s,$u,$a);
    if($name==='app_saha_cache')return vg_saha_cache($s,$u,$a);
    if($name==='app_saha_storage')return vg_saha_storage($s,$u,$a);
    if($name==='app_saha_rpc'){
        $source=$a['name']??'';$args=$a['args']??[];if(!is_string($source)||!is_array($args))vg_company_fail(400,'saha_rpc');
        if($source==='list_all_users'){if($u['role']!=='admin')vg_company_fail(403,'saha_admin');return vg_saha_profiles($u);}
        if($source==='bump_app_usage')return vg_saha_bump_usage($s,$u,$args);
        if(in_array($source,['visit_active','visit_check_in','visit_check_out'],true))return vg_saha_visit($s,$u,$source,$args);
        if($source==='run_due_templates')return vg_saha_run_due_templates($s,$u);
        if($source==='is_name_available'){$requested=$args['p_name']??$args['name']??'';if(!is_string($requested)||strlen($requested)>120)vg_company_fail(400,'saha_name');foreach(vg_saha_profiles($u)as $p)if(strcasecmp($p['full_name'],$requested)===0)return false;return true;}
        vg_company_fail(503,'saha_service_unavailable','Bu işlem mevcut çalışan yönetiminden veya yapılandırılmış sunucu bağlantısından yürütülmelidir.');
    }
    vg_company_fail(404,'saha_rpc_unknown');
}

<?php
declare(strict_types=1);
if (!defined('VG_API')) { http_response_code(404); exit; }
require_once __DIR__.'/integration-http.php';
require_once __DIR__.'/integration-energy.php';
require_once __DIR__.'/integration-currency.php';
require_once __DIR__.'/integration-ai.php';

function vg_int_services(): array {
    $spec=[
        'pvgis'=>['PVGIS',[],false,'Konuma göre uzun dönem GES üretim tahmini; ölçülmüş üretim değildir.'],
        'nasa_power'=>['NASA POWER',[],false,'Geçmiş dönem iklim ortalaması; hava tahmini değildir.'],
        'tcmb'=>['TCMB',[],false,'Günlük gösterge kuru; tarih, alış/satış ve birim bilgisiyle.'],
        'frankfurter'=>['Frankfurter',[],false,'Günlük kur; seçilen kaynak ve gözlem tarihi gösterilir.'],
        'exchange_rate'=>['ExchangeRate-API',[],false,'Günlük döviz dönüşümü; veri kaynağına atıf gerekir.'],
        'epias'=>['EPİAŞ PTF',[],true,'EPİAŞ hesabı gerekir. Saatlik piyasa takas fiyatı; perakende elektrik tarifesi değildir.'],
        'openweather'=>['OpenWeather',['VG_OPENWEATHER_API_KEY'],false,'Anlık hava verisi; ücretsiz Current Weather uç noktası kullanılır.'],
        'ipinfo'=>['IPinfo Lite',['VG_IPINFO_TOKEN'],true,'Elle girilen genel IP için ülke ve ASN; ziyaretçiler otomatik izlenmez.'],
        'nominatim'=>['Nominatim / OpenStreetMap',[],false,'Tesis adresini düğmeyle arayın. Otomatik tamamlama yok; uygulama genelinde saniyede en fazla bir istek.'],
        'coingecko'=>['CoinGecko',[],false,'BTC ve ETH gösterge fiyatları; sağlayıcının güncelleme zamanı gösterilir.'],
        'github'=>['GitHub',[],true,'Yalnız herkese açık depo bilgisi. Özel depo ve hesap verisi aktarılmaz.'],
        'unsplash'=>['Unsplash',['VG_UNSPLASH_ACCESS_KEY'],true,'Fotoğraf arama ve kaynak bağlantısı; fotoğrafçı ve Unsplash atıflarıyla.'],
        'tmdb'=>['TMDB',['VG_TMDB_TOKEN'],true,'Ticari kullanım lisansı gerekir; lisans onayı olmadan yalnız yerel geliştirme.'],
        'newsapi'=>['NewsAPI',['VG_NEWSAPI_KEY'],true,'Ücretsiz Developer plan yalnız yerel geliştirmede kullanılabilir. Üretim için uygun plan gerekir.'],
        'jsonplaceholder'=>['JSONPlaceholder',[],true,'Sentetik gönderiler; gerçek müşteri ve şirket kayıtlarına kaydedilmez.'],
        'dummyjson'=>['DummyJSON',[],true,'Sentetik ürünler; gerçek stok ve satış kayıtlarına kaydedilmez.'],
    ];$out=[];
    foreach($spec as $id=>[$label,$keys,$private,$notice]) {
        $configured=true;try{foreach($keys as $key)$configured=$configured&&vg_int_secret($key)!=='';if($id==='epias')$configured=vg_int_secret('VG_EPIAS_TGT')!==''||(vg_int_secret('VG_EPIAS_USERNAME')!==''&&vg_int_secret('VG_EPIAS_PASSWORD')!=='');}catch(VgIntegrationError $e){$configured=false;}
        $available=$configured;
        try{if($id==='tmdb')$available=$available&&(vg_int_development()||vg_int_secret('VG_TMDB_COMMERCIAL_LICENSE')==='1');
        if($id==='newsapi')$available=$available&&(vg_int_development()||vg_int_secret('VG_NEWSAPI_PRODUCTION_ALLOWED')==='1');}catch(VgIntegrationError $e){$available=false;}
        $out[$id]=['label'=>$label,'configured'=>$configured,'available'=>$available,'private'=>$private,'notice'=>$notice,'access'=>$id==='epias'?'staff':($private?'admin':'public')];
    }return $out;
}
function vg_int_epias(array $input,?callable $fetch=null): array {
    $fetch=$fetch??'vg_int_http';$date=$input['date']??(new DateTimeImmutable('now',new DateTimeZone('Europe/Istanbul')))->format('Y-m-d');
    if(!is_string($date)||!preg_match('/^\d{4}-\d{2}-\d{2}$/D',$date))throw new VgIntegrationError(422,'date_invalid','Geçerli bir gün seçin.');
    $day=DateTimeImmutable::createFromFormat('!Y-m-d',$date,new DateTimeZone('Europe/Istanbul'));$tomorrow=(new DateTimeImmutable('tomorrow',new DateTimeZone('Europe/Istanbul')))->format('Y-m-d');
    if(!$day||$day->format('Y-m-d')!==$date||$date<'2015-07-01'||$date>$tomorrow)throw new VgIntegrationError(422,'date_invalid','Tarih 1 Temmuz 2015 ile yarın arasında olmalı.');
    $tgt=vg_int_secret('VG_EPIAS_TGT');
    if($tgt==='') {
        $username=vg_int_secret('VG_EPIAS_USERNAME');$password=vg_int_secret('VG_EPIAS_PASSWORD');
        if($username===''||$password==='')throw new VgIntegrationError(503,'provider_not_configured','EPİAŞ hesabı sunucuda yapılandırılmadı.');
        $login=static function()use($fetch,$username,$password){$r=$fetch('POST','https://giris.epias.com.tr/cas/v1/tickets',['headers'=>['Content-Type'=>'application/x-www-form-urlencoded','Accept'=>'text/plain'],'body'=>http_build_query(['username'=>$username,'password'=>$password],'','&',PHP_QUERY_RFC3986),'timeout'=>10,'maxBytes'=>8192]);if(!in_array($r['status']??0,[200,201],true))throw new VgIntegrationError(502,'epias_auth','EPİAŞ oturumu açılamadı. Hesap yapılandırmasını kontrol edin.');$ticket=trim((string)($r['body']??''));if(!preg_match('/^TGT-[A-Za-z0-9._-]{8,2048}$/D',$ticket))throw new VgIntegrationError(502,'epias_auth','EPİAŞ oturum yanıtı doğrulanamadı.');return ['ticket'=>$ticket];};
        // Test adapters do not touch runtime credentials or cache. Real tickets stay outside web root.
        $session=$fetch==='vg_int_http'?vg_int_cache('epias-ticket:'.hash('sha256',$username."\0".$password),6600,$login):$login();$tgt=$session['ticket'];
    }
    if(!preg_match('/^TGT-[A-Za-z0-9._-]{8,2048}$/D',$tgt))throw new VgIntegrationError(503,'configuration_invalid','EPİAŞ oturum yapılandırması geçersiz.');
    $body=json_encode(['startDate'=>$date.'T00:00:00+03:00','endDate'=>$date.'T23:59:59+03:00'],JSON_UNESCAPED_SLASHES);
    $r=$fetch('POST','https://seffaflik.epias.com.tr/electricity-service/v1/markets/dam/data/mcp',['headers'=>['TGT'=>$tgt,'Content-Type'=>'application/json'],'body'=>$body,'timeout'=>14,'maxBytes'=>262144]);
    if(in_array($r['status']??0,[401,403],true))throw new VgIntegrationError(502,'epias_auth','EPİAŞ oturumu kabul edilmedi. Oturumun süresini ve hesabı kontrol edin.');
    $json=vg_int_json($r);$items=$json['items']??$json['body']['items']??null;
    if(!is_array($items)||count($items)>25)throw new VgIntegrationError(502,'upstream_invalid','EPİAŞ fiyat yanıtı doğrulanamadı.');
    $rows=[];$seen=[];
    foreach($items as $item){$stamp=$item['date']??null;$price=$item['price']??null;if(!is_string($stamp)||!preg_match('/^'.preg_quote($date,'/').'T(?:[01]\d|2[0-3]):00:00(?:\.\d+)?\+03:00$/D',$stamp)||!is_numeric($price)||is_bool($price)||!is_finite((float)$price)||abs((float)$price)>1000000)throw new VgIntegrationError(502,'upstream_invalid','EPİAŞ saatlik fiyatı doğrulanamadı.');$hour=substr($stamp,0,13);if(isset($seen[$hour]))throw new VgIntegrationError(502,'upstream_invalid','EPİAŞ aynı saat için birden fazla fiyat döndürdü.');$seen[$hour]=true;$rows[]=['date'=>$hour.':00:00+03:00','priceTryPerMwh'=>(float)$price,'priceTryPerKwh'=>(float)$price/1000];}
    usort($rows,static function($a,$b){return strcmp($a['date'],$b['date']);});
    return ['provider'=>'EPİAŞ','source'=>['name'=>'EPİAŞ Şeffaflık Platformu','url'=>'https://seffaflik.epias.com.tr/electricity/electricity-markets/day-ahead-market-dam/market-clearing-price-mcp'],'retrievedAt'=>gmdate('c'),'date'=>$date,'timezone'=>'Europe/Istanbul','items'=>$rows,'complete'=>count($rows)===24,'notice'=>'PTF toptan piyasa fiyatıdır. Dağıtım, vergi ve diğer perakende bedellerini içermez. Boş veya eksik gün yayımlanmamış olabilir.'];
}
function vg_integrations_run(): void {
    try {
        vg_check_fetch_site();$method=$_SERVER['REQUEST_METHOD']??'GET';$action=$_GET['action']??'status';
        if(!is_string($action)||!preg_match('/^[a-z_]{2,30}$/D',$action))throw new VgIntegrationError(404,'action_unknown','Bu veri işlemi bulunamadı.');
        if(!in_array($method,['GET','POST'],true))throw new VgIntegrationError(405,'method','Bu yöntem desteklenmiyor.');
        if(($retry=vg_rl_hit('integrations-client',vg_client_ip(),60,60))>0)throw new VgIntegrationError(429,'rate_limit','Çok sık istek gönderildi. Biraz bekleyin.',['retryAfter'=>$retry]);
        if($action==='status') {if($method!=='GET')throw new VgIntegrationError(405,'method','Bu işlem GET gerektirir.');$data=['services'=>vg_int_services(),'ai'=>vg_int_ai_status()];}
        else {
            $services=vg_int_services();$ai=$action==='ai_chat';if(!$ai&&!isset($services[$action]))throw new VgIntegrationError(404,'action_unknown','Bu veri işlemi bulunamadı.');
            if(($ai?'POST':'GET')!==$method)throw new VgIntegrationError(405,'method','Bu istek yöntemi desteklenmiyor.');
            if($ai||$services[$action]['private']){$user=vg_staff_require_user();if(!$ai&&$action!=='epias'&&$user['role']!=='admin')throw new VgIntegrationError(403,'admin_required','Bu deneme alanı yönetici hesabı gerektirir.');if($ai)vg_staff_write_guard();if(session_status()===PHP_SESSION_ACTIVE)session_write_close();}
            if($ai){$raw=file_get_contents('php://input',false,null,0,65537);if(strlen((string)$raw)>65536)throw new VgIntegrationError(413,'request_size','İstek boyutu sınırı aşıldı.');$input=json_decode((string)$raw,true);if(!is_array($input))throw new VgIntegrationError(400,'json_invalid','Geçerli bir JSON isteği gönderin.');$data=vg_int_ai($input);}
            else {
                if(!$services[$action]['available'])throw new VgIntegrationError(503,'provider_not_configured',$services[$action]['notice'].' Sunucu yapılandırması veya kullanım izni eksik.');
                $input=$_GET;unset($input['action']);foreach($input as $value)if(!is_scalar($value)||strlen((string)$value)>512)throw new VgIntegrationError(422,'input_invalid','Girdi biçimi veya uzunluğu geçersiz.');ksort($input);
                $ttls=['pvgis'=>86400,'nasa_power'=>86400,'tcmb'=>3600,'frankfurter'=>3600,'exchange_rate'=>3600,'epias'=>900,'openweather'=>600,'nominatim'=>86400,'coingecko'=>120,'ipinfo'=>86400,'github'=>900,'unsplash'=>3600,'tmdb'=>3600,'newsapi'=>900,'jsonplaceholder'=>86400,'dummyjson'=>86400];
                $scope=isset($user)?$user['id']:'public';$data=vg_int_cache('v1:'.$action.':'.$scope.':'.vg_json_encode($input),$ttls[$action],static function()use($action,$input){if(in_array($action,['pvgis','nasa_power'],true))return vg_int_energy($action,$input);if(in_array($action,['tcmb','frankfurter','exchange_rate'],true))return vg_int_currency($action,$input);if($action==='epias')return vg_int_epias($input);require_once __DIR__.'/integration-misc.php';return vg_int_misc($action,$input);});
            }
        }
        vg_send_raw(200,vg_json_encode(['api'=>'vg-integrations/1','ok'=>true,'data'=>$data]));
    }catch(VgIntegrationError $e){$headers=isset($e->details['retryAfter'])?['Retry-After: '.(int)$e->details['retryAfter']]:[];vg_send_raw($e->status,vg_json_encode(['api'=>'vg-integrations/1','ok'=>false,'error'=>$e->errCode,'message'=>$e->getMessage()]),$headers);}
    catch(VgHttpError $e){vg_send_raw($e->status,vg_json_encode(['api'=>'vg-integrations/1','ok'=>false,'error'=>$e->errCode,'message'=>$e->getMessage()]),$e->headers);}
    catch(Throwable $e){vg_send_raw(503,vg_json_encode(['api'=>'vg-integrations/1','ok'=>false,'error'=>'unavailable','message'=>'Veri bağlantısı şu anda kullanılamıyor.']));}
}

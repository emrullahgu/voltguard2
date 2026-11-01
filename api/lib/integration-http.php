<?php
declare(strict_types=1);
if (!defined('VG_API')) { http_response_code(404); exit; }
require_once __DIR__.'/volthaber-fetch.php';

final class VgIntegrationError extends RuntimeException {
    public $status; public $errCode; public $details;
    public function __construct(int $status,string $code,string $message,array $details=[]) { parent::__construct($message);$this->status=$status;$this->errCode=$code;$this->details=$details; }
}
function vg_int_secret(string $name): string {
    if (!preg_match('/^VG_[A-Z0-9_]{2,70}$/D',$name)) return '';
    $value=getenv($name);
    if ($value===false) {
        $base=vg_private_data_directory(vg_data_dir());$file=$base.'/integrations-secrets.json';
        if (is_file($file)) {
            $actual=realpath($file);
            if ($actual===false||is_link($file)||strtolower(str_replace('\\','/',dirname($actual)))!==strtolower($base)||filesize($file)>65536) throw new VgIntegrationError(503,'configuration_invalid','Bağlantı yapılandırması doğrulanamadı.');
            $settings=json_decode((string)file_get_contents($file),true);
            if (!is_array($settings)) throw new VgIntegrationError(503,'configuration_invalid','Bağlantı yapılandırması doğrulanamadı.');
            $value=$settings[$name]??'';
        }
    }
    if (!is_scalar($value)||is_bool($value)) return '';
    $value=trim((string)$value);
    if (strlen($value)>4096||strpbrk($value,"\r\n\0")!==false) throw new VgIntegrationError(503,'configuration_invalid','Bağlantı yapılandırması doğrulanamadı.');
    return $value;
}
function vg_int_dir(): string { $base=vg_private_data_directory(vg_data_dir());return vg_private_data_directory($base.'/integrations',$base); }
/** Bound disposable cached results; never enumerate or remove operational records. */
function vg_int_cache_store(string $file,string $entry,int $now): void {
    $dir=vg_int_dir();if(dirname($file)!==$dir||!preg_match('/^[a-f0-9]{64}\.json$/D',basename($file))||strlen($entry)>4194304)return;
    $lockFile=$dir.'/.cache.lock';if(is_link($lockFile))return;$lock=@fopen($lockFile,'c+');if(!$lock)return;
    $tmp=false;
    try {
        if(!flock($lock,LOCK_EX))return;$entries=[];$bytes=0;
        foreach(glob($dir.'/*.json')?:[] as $path){if(!preg_match('/^[a-f0-9]{64}\.json$/D',basename($path))||is_link($path)||!is_file($path))continue;
            $size=(int)filesize($path);$head=$size<=4194304?json_decode((string)file_get_contents($path),true):null;
            if($path!==$file&&(!is_array($head)||($head['expires']??0)<=$now)){@unlink($path);continue;}
            if($path!==$file){$entries[]=['path'=>$path,'size'=>$size,'stored'=>(int)($head['stored']??0)];$bytes+=$size;}
        }
        usort($entries,static function($a,$b){return $a['stored']<=>$b['stored'];});
        while($entries&&(count($entries)>=512||$bytes+strlen($entry)>33554432)){$old=array_shift($entries);if(@unlink($old['path']))$bytes-=$old['size'];}
        if($bytes+strlen($entry)>33554432||is_link($file))return;
        $tmp=tempnam($dir,'cache-');if($tmp===false)return;@chmod($tmp,0600);
        if(file_put_contents($tmp,$entry,LOCK_EX)!==false)@rename($tmp,$file);
    } finally {if($tmp!==false&&is_file($tmp))@unlink($tmp);flock($lock,LOCK_UN);fclose($lock);}
}
function vg_int_development(): bool {
    return getenv('VG_INTEGRATIONS_LOCAL')==='1' && in_array($_SERVER['REMOTE_ADDR']??'', ['127.0.0.1','::1'],true)
        && in_array(strtolower($_SERVER['SERVER_NAME']??''),['localhost','127.0.0.1','::1'],true);
}
function vg_int_cache(string $key,int $ttl,callable $read): array {
    $file=vg_int_dir().'/'.hash('sha256',$key).'.json';
    if (is_link($file)) throw new VgIntegrationError(503,'cache_invalid','Veri önbelleği doğrulanamadı.');
    $old=is_file($file)&&filesize($file)<=4194304?json_decode((string)file_get_contents($file),true):null;
    if (is_array($old)&&($old['expires']??0)>time()&&is_array($old['data']??null)) { $data=$old['data'];$data['cache']=['hit'=>true,'storedAt'=>gmdate('c',(int)$old['stored']),'expiresAt'=>gmdate('c',(int)$old['expires'])];return $data; }
    $data=$read();$now=time();$entry=json_encode(['stored'=>$now,'expires'=>$now+$ttl,'data'=>$data],JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
    vg_int_cache_store($file,$entry,$now);
    $data['cache']=['hit'=>false,'storedAt'=>gmdate('c',$now),'expiresAt'=>gmdate('c',$now+$ttl)];return $data;
}
function vg_int_spacing(string $provider,float $seconds): void {
    $file=vg_int_dir().'/slot-'.hash('sha256',$provider).'.lock';if(is_link($file))throw new VgIntegrationError(503,'cache_invalid','Veri önbelleği doğrulanamadı.');
    $fp=fopen($file,'c+');if(!$fp||!flock($fp,LOCK_EX))throw new VgIntegrationError(503,'busy','Bağlantı şu anda meşgul.');
    try { $last=(float)stream_get_contents($fp);$now=microtime(true);if($now-$last<$seconds)throw new VgIntegrationError(429,'provider_rate_limit','Kaynak istek sınırı nedeniyle birkaç saniye bekleyin.',['retryAfter'=>(int)ceil($seconds)]);rewind($fp);ftruncate($fp,0);fwrite($fp,(string)$now);fflush($fp); }
    finally {flock($fp,LOCK_UN);fclose($fp);}
}
function vg_int_allowed_hosts(): array {return ['re.jrc.ec.europa.eu','power.larc.nasa.gov','www.tcmb.gov.tr','api.frankfurter.dev','open.er-api.com','giris.epias.com.tr','seffaflik.epias.com.tr','generativelanguage.googleapis.com','api.groq.com','openrouter.ai','api.cloudflare.com','api.openweathermap.org','api.ipinfo.io','nominatim.openstreetmap.org','api.coingecko.com','api.github.com','api.unsplash.com','api.themoviedb.org','newsapi.org','jsonplaceholder.typicode.com','dummyjson.com'];}
function vg_int_target(string $url): array {
    $p=strlen($url)<=4096&&!preg_match('/[\x00-\x20\x7f\\\\]/',$url)?parse_url($url):false;
    if(!is_array($p)||($p['scheme']??'')!=='https'||!in_array(strtolower($p['host']??''),vg_int_allowed_hosts(),true)||isset($p['user'])||isset($p['pass'])||isset($p['fragment'])||isset($p['port'])&&(int)$p['port']!==443)throw new VgIntegrationError(400,'upstream_not_allowed','Bu veri kaynağına erişilemiyor.');
    $host=strtolower($p['host']);$why='';$target=vh_check_fetch_url('https://'.$host.'/',$why,[(string)preg_replace('/^www\./','',$host)]);
    if(!$target)throw new VgIntegrationError(502,'upstream_dns','Veri kaynağının güvenli bağlantısı kurulamadı.');
    return [$host,$target[1],($p['path']??'/').(isset($p['query'])?'?'.$p['query']:'')];
}
function vg_int_dechunk(string $body,int $limit): string {
    $out='';$offset=0;
    while(true){$end=strpos($body,"\r\n",$offset);if($end===false||$end-$offset>80)throw new VgIntegrationError(502,'upstream_invalid','Veri kaynağının yanıtı doğrulanamadı.');$line=explode(';',substr($body,$offset,$end-$offset))[0];if(!preg_match('/^[0-9a-f]{1,8}$/iD',$line))throw new VgIntegrationError(502,'upstream_invalid','Veri kaynağının yanıtı doğrulanamadı.');$size=hexdec($line);$offset=$end+2;if($size===0){$tail=substr($body,$offset);if(strlen($tail)>32768||!preg_match('/^(?:[A-Za-z0-9-]{1,64}:[^\r\n\x00]*\r\n)*\r\n$/D',$tail))throw new VgIntegrationError(502,'upstream_invalid','Veri kaynağının yanıtı tamamlanmadı.');return $out;}if(strlen($out)+$size>$limit||$offset+$size+2>strlen($body)||substr($body,$offset+$size,2)!=="\r\n")throw new VgIntegrationError(502,'upstream_size','Veri kaynağı yanıtı sınırı aştı.');$out.=substr($body,$offset,$size);$offset+=$size+2;}
}
/** Fixed-provider HTTPS only; credentials never follow redirects or enter logs. */
function vg_int_http(string $method,string $url,array $options=[]): array {
    if(!in_array($method,['GET','POST'],true))throw new VgIntegrationError(400,'upstream_method','Bu işlem desteklenmiyor.');
    [$host,$ip,$target]=vg_int_target($url);$max=max(1024,min(4194304,(int)($options['maxBytes']??2097152)));$timeout=max(2,min(25,(int)($options['timeout']??20)));
    $headers=['Accept'=>'application/json','User-Agent'=>'VoltGuard/1.0 (+https://voltguard.com.tr/iletisim.html)','Accept-Encoding'=>'identity'];
    foreach($options['headers']??[] as $name=>$value){if(!is_string($name)||!preg_match('/^[A-Za-z0-9-]{1,64}$/D',$name)||!is_scalar($value)||preg_match('/[\r\n\x00]/',(string)$value))throw new VgIntegrationError(503,'configuration_invalid','Bağlantı yapılandırması doğrulanamadı.');if(in_array(strtolower($name),['host','content-length','connection','transfer-encoding'],true))throw new VgIntegrationError(400,'upstream_header','İstek başlığı desteklenmiyor.');$headers[$name]=(string)$value;}
    $body=(string)($options['body']??'');if(strlen($body)>131072)throw new VgIntegrationError(413,'request_size','İstek boyutu sınırı aşıldı.');
    $daily=in_array($host,['generativelanguage.googleapis.com','api.groq.com','openrouter.ai','api.cloudflare.com'],true)?100:500;
    foreach([[60,30],[86400,$daily]] as [$window,$budget])if(($retry=vg_rl_hit('integration-upstream-'.$window,$host,$budget,$window))>0)throw new VgIntegrationError(429,'provider_rate_limit','Kaynak kullanım sınırına ulaşıldı. Daha sonra tekrar deneyin.',['retryAfter'=>$retry]);
    if($host==='nominatim.openstreetmap.org')vg_int_spacing('nominatim',1.1);
    $responseHeaders=[];$result='';$status=0;$headerBytes=0;$deadline=microtime(true)+$timeout;
    if(function_exists('curl_init')){
        $ch=curl_init($url);$lines=[];foreach($headers as $key=>$value)$lines[]=$key.': '.$value;
        $resolve=$host.':443:'.(strpos($ip,':')!==false?'['.$ip.']':$ip);
        curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>false,CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_HTTPHEADER=>$lines,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>min(8,$timeout),CURLOPT_TIMEOUT=>$timeout,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,CURLOPT_RESOLVE=>[$resolve],CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_HEADERFUNCTION=>static function($ch,$line)use(&$responseHeaders,&$headerBytes){$length=strlen($line);$headerBytes+=$length;if($headerBytes>32768)return 0;$parts=explode(':',$line,2);if(count($parts)===2)$responseHeaders[strtolower(trim($parts[0]))]=trim($parts[1]);return $length;},CURLOPT_WRITEFUNCTION=>static function($ch,$chunk)use(&$result,$max){if(strlen($result)+strlen($chunk)>$max)return 0;$result.=$chunk;return strlen($chunk);}]);
        if($method==='POST')curl_setopt($ch,CURLOPT_POSTFIELDS,$body);
        $ok=curl_exec($ch);$status=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);curl_close($ch);
        if($ok===false)throw new VgIntegrationError(502,'upstream_unavailable','Veri kaynağına ulaşılamadı veya yanıt boyutu sınırı aşıldı.');
    }else{
        if(!extension_loaded('openssl'))throw new VgIntegrationError(503,'https_unavailable','Sunucuda güvenli dış bağlantı desteği etkin değil.');
        $context=stream_context_create(['ssl'=>['verify_peer'=>true,'verify_peer_name'=>true,'peer_name'=>$host,'SNI_enabled'=>true,'disable_compression'=>true]]);
        $address=strpos($ip,':')!==false?'['.$ip.']':$ip;$errno=0;$error='';$fp=@stream_socket_client('tls://'.$address.':443',$errno,$error,min(8,$timeout),STREAM_CLIENT_CONNECT,$context);
        if(!$fp)throw new VgIntegrationError(502,'upstream_unavailable','Veri kaynağına güvenli bağlantı kurulamadı.');
        try {$remaining=static function()use($fp,$deadline){$left=$deadline-microtime(true);if($left<=0)throw new VgIntegrationError(504,'upstream_timeout','Veri kaynağı zamanında yanıt vermedi.');$sec=(int)$left;stream_set_timeout($fp,$sec,(int)(($left-$sec)*1000000));};$remaining();$request=$method.' '.$target." HTTP/1.1\r\nHost: ".$host."\r\nConnection: close\r\n";foreach($headers as $name=>$value)$request.=$name.': '.$value."\r\n";if($method==='POST')$request.='Content-Length: '.strlen($body)."\r\n";$request.="\r\n".$body;
            $offset=0;while($offset<strlen($request)){$remaining();$written=fwrite($fp,substr($request,$offset));if(!$written)throw new VgIntegrationError(502,'upstream_unavailable','Veri kaynağı isteği tamamlanamadı.');$offset+=$written;}
            $head='';while(!feof($fp)){$remaining();$line=fgets($fp,8192);if(stream_get_meta_data($fp)['timed_out'])throw new VgIntegrationError(504,'upstream_timeout','Veri kaynağı zamanında yanıt vermedi.');if($line===false)break;$head.=$line;if(strlen($head)>32768)throw new VgIntegrationError(502,'upstream_invalid','Yanıt başlıkları doğrulanamadı.');if($line==="\r\n")break;}
            if(!preg_match('/^HTTP\/1\.[01] (\d{3})/',$head,$m))throw new VgIntegrationError(502,'upstream_invalid','Veri kaynağının yanıtı doğrulanamadı.');$status=(int)$m[1];foreach(explode("\r\n",$head)as $line){$p=explode(':',$line,2);if(count($p)===2)$responseHeaders[strtolower(trim($p[0]))]=trim($p[1]);}
            while(!feof($fp)){$remaining();$chunk=fread($fp,16384);if($chunk===false||stream_get_meta_data($fp)['timed_out'])throw new VgIntegrationError(504,'upstream_timeout','Veri kaynağı zamanında yanıt vermedi.');$result.=$chunk;if(strlen($result)>$max+65536)throw new VgIntegrationError(502,'upstream_size','Veri kaynağı yanıtı sınırı aştı.');}
            if(strtolower($responseHeaders['transfer-encoding']??'')==='chunked')$result=vg_int_dechunk($result,$max);
        }finally{fclose($fp);}
    }
    if(strlen($result)>$max)throw new VgIntegrationError(502,'upstream_size','Veri kaynağı yanıtı sınırı aştı.');
    if($status>=300&&$status<400)throw new VgIntegrationError(502,'upstream_redirect','Veri kaynağı beklenmeyen bir yönlendirme döndürdü.');
    return ['status'=>$status,'headers'=>$responseHeaders,'body'=>$result];
}
function vg_int_json(array $response): array {
    if(($response['status']??0)===429)throw new VgIntegrationError(429,'provider_rate_limit','Veri kaynağının kullanım sınırına ulaşıldı.');
    if(($response['status']??0)<200||($response['status']??0)>=300)throw new VgIntegrationError(502,'upstream_unavailable','Veri kaynağı isteği tamamlanamadı.');
    $value=json_decode((string)($response['body']??''),true);if(!is_array($value))throw new VgIntegrationError(502,'upstream_invalid','Veri kaynağının yanıtı doğrulanamadı.');return $value;
}

<?php
/** Read-only indicative exchange-rate adapters. No customer or proposal writes. */
declare(strict_types=1);
if (!defined('VG_API')) { http_response_code(404); exit; }

function vg_int_currency_code($value, string $fallback = ''): string {
    if ($value === null || $value === '') $value = $fallback;
    if (!is_string($value) || !preg_match('/^[A-Za-z]{3}$/D', $value)) throw new VgIntegrationError(422, 'currency_code', 'Para birimini üç harfli kodla seçin.');
    return strtoupper($value);
}
function vg_int_currency_quotes(array $input, array $fallback = ['TRY']): array {
    $raw = $input['quotes'] ?? $input['quote'] ?? implode(',', $fallback);
    if (!is_string($raw) || strlen($raw) > 100) throw new VgIntegrationError(422, 'currency_quotes', 'Hedef para birimleri geçersiz.');
    $result = [];
    foreach (explode(',', $raw) as $code) $result[] = vg_int_currency_code(trim($code));
    $result = array_values(array_unique($result));
    if (!$result || count($result) > 12) throw new VgIntegrationError(422, 'currency_quotes', 'En fazla 12 hedef para birimi seçin.');
    return $result;
}
function vg_int_currency_date($value, string $format = 'Y-m-d'): string {
    if (!is_string($value) || strlen($value) > 10) throw new VgIntegrationError(422, 'currency_date', 'Geçerli bir tarih girin.');
    $date = DateTimeImmutable::createFromFormat('!' . $format, $value, new DateTimeZone('UTC'));
    $errors = DateTimeImmutable::getLastErrors();
    if (!$date || ($errors !== false && ($errors['warning_count'] || $errors['error_count'])) || $date->format($format) !== $value) throw new VgIntegrationError(422, 'currency_date', 'Geçerli bir tarih girin.');
    $iso = $date->format('Y-m-d');
    if ($iso < '1948-01-01' || $iso > gmdate('Y-m-d')) throw new VgIntegrationError(422, 'currency_date', 'Tarih 1948 ile bugün arasında olmalı.');
    return $iso;
}
function vg_int_currency_number($value, bool $zeroAllowed = false): float {
    if (is_bool($value) || (!is_int($value) && !is_float($value) && !(is_string($value) && preg_match('/^\d+(?:\.\d+)?$/D', trim($value))))) throw new VgIntegrationError(502, 'currency_response', 'Kur kaynağının sayısal yanıtı doğrulanamadı.');
    $number = (float)$value;
    if (!is_finite($number) || ($zeroAllowed ? $number < 0 : $number <= 0) || $number > 1000000000000) throw new VgIntegrationError(502, 'currency_response', 'Kur kaynağının sayısal yanıtı doğrulanamadı.');
    return $number;
}
function vg_int_currency_get(callable $fetch, string $url, string $accept, int $maxBytes = 1048576): string {
    $response = $fetch('GET', $url, ['headers' => ['Accept' => $accept], 'timeout' => 15, 'maxBytes' => $maxBytes]);
    $status = (int)($response['status'] ?? 0);
    if ($status === 404) throw new VgIntegrationError(404, 'currency_date_unavailable', 'Seçilen tarih veya para birimi için kur yayımlanmamış olabilir.');
    if ($status === 429) throw new VgIntegrationError(503, 'currency_rate_limited', 'Kur kaynağının istek sınırına ulaşıldı. Bir süre sonra yeniden deneyin.');
    if ($status < 200 || $status >= 300 || !is_string($response['body'] ?? null) || strlen($response['body']) > $maxBytes) throw new VgIntegrationError(502, 'currency_unavailable', 'Kur kaynağından doğrulanmış yanıt alınamadı.');
    return $response['body'];
}
function vg_int_currency_json(string $body): array {
    $value = json_decode($body, true, 64);
    if (json_last_error() !== JSON_ERROR_NONE || !is_array($value)) throw new VgIntegrationError(502, 'currency_response', 'Kur kaynağının JSON yanıtı doğrulanamadı.');
    return $value;
}
function vg_int_currency_result(string $provider, string $name, string $url, string $base, array $rates, array $observations, array $extra = []): array {
    if (!$rates || !$observations) throw new VgIntegrationError(502, 'currency_empty', 'Seçilen para birimleri için kullanılabilir kur bulunamadı.');
    return array_merge([
        'provider' => $provider, 'providerName' => $name, 'sourceUrl' => $url,
        'base' => $base, 'rates' => $rates, 'observations' => $observations,
        'date' => $observations[count($observations)-1]['date'], 'frequency' => 'daily', 'indicative' => true,
        'retrievedAt' => gmdate('c'), 'notice' => 'Gösterge niteliğindeki dönemsel kurdur; anlık piyasa veya işlem kuru değildir.',
    ], $extra);
}

function vg_int_currency_tcmb(array $input, callable $fetch): array {
    if (isset($input['from']) || isset($input['to'])) throw new VgIntegrationError(422, 'currency_range', 'TCMB için tek bir tarih seçin.');
    $base = vg_int_currency_code($input['base'] ?? null, 'USD');
    $quotes = vg_int_currency_quotes($input);
    $types = ['forex_buying' => 'ForexBuying', 'forex_selling' => 'ForexSelling', 'banknote_buying' => 'BanknoteBuying', 'banknote_selling' => 'BanknoteSelling'];
    $kind = $input['rateType'] ?? $input['rate_type'] ?? 'forex_selling';
    if (!is_string($kind) || !isset($types[$kind])) throw new VgIntegrationError(422, 'currency_rate_type', 'Döviz veya efektif alış/satış kur türünü seçin.');
    $requestedDate = $input['date'] ?? 'latest';
    if ($requestedDate === '' || $requestedDate === 'latest') $url = 'https://www.tcmb.gov.tr/kurlar/today.xml';
    else {
        $requestedDate = vg_int_currency_date($requestedDate);
        $url = 'https://www.tcmb.gov.tr/kurlar/' . substr($requestedDate, 0, 4) . substr($requestedDate, 5, 2) . '/' . substr($requestedDate, 8, 2) . substr($requestedDate, 5, 2) . substr($requestedDate, 0, 4) . '.xml';
    }
    $body = vg_int_currency_get($fetch, $url, 'application/xml,text/xml');
    if (preg_match('/<\s*!(?:DOCTYPE|ENTITY)\b/i', $body)) throw new VgIntegrationError(502, 'currency_xml', 'Kur kaynağının XML yanıtı güvenli biçimde doğrulanamadı.');
    if (!function_exists('simplexml_load_string')) throw new VgIntegrationError(503, 'currency_xml_support', 'Sunucunun XML okuma desteği etkin değil.');
    $before = libxml_use_internal_errors(true);
    try { $xml = simplexml_load_string($body, 'SimpleXMLElement', LIBXML_NONET); }
    finally { libxml_clear_errors(); libxml_use_internal_errors($before); }
    if ($xml === false || $xml->getName() !== 'Tarih_Date') throw new VgIntegrationError(502, 'currency_xml', 'TCMB kur yanıtı doğrulanamadı.');
    try {
        $date = isset($xml['Tarih']) ? vg_int_currency_date((string)$xml['Tarih'], 'd.m.Y') : vg_int_currency_date((string)$xml['Date'], 'm/d/Y');
        if (isset($xml['Date']) && vg_int_currency_date((string)$xml['Date'], 'm/d/Y') !== $date) throw new RuntimeException('Inconsistent source dates');
    } catch (Throwable $error) { throw new VgIntegrationError(502, 'currency_date_response', 'TCMB yayın tarihi doğrulanamadı.'); }
    if ($requestedDate !== '' && $requestedDate !== 'latest' && $date !== $requestedDate) throw new VgIntegrationError(502, 'currency_date_response', 'TCMB yanıt tarihi istenen tarihle eşleşmiyor.');
    $map = ['TRY' => ['unit' => 1, 'perUnit' => array_fill_keys(array_keys($types), 1.0)]];
    foreach ($xml->Currency as $row) {
        $code = strtoupper((string)($row['CurrencyCode'] ?? $row['Kod'] ?? ''));
        if (!preg_match('/^[A-Z]{3}$/D', $code) || isset($map[$code])) throw new VgIntegrationError(502, 'currency_xml', 'TCMB para birimi satırları doğrulanamadı.');
        $unit = vg_int_currency_number((string)$row->Unit);
        if (floor($unit) !== $unit || $unit > 1000000) throw new VgIntegrationError(502, 'currency_unit', 'TCMB kur birimi doğrulanamadı.');
        $values = [];
        foreach ($types as $type => $tag) { $raw = trim((string)$row->{$tag}); $values[$type] = $raw === '' ? null : vg_int_currency_number($raw, true) / $unit; }
        $map[$code] = ['unit' => (int)$unit, 'perUnit' => $values];
    }
    $baseValue = $map[$base]['perUnit'][$kind] ?? null;
    if (!is_numeric($baseValue) || $baseValue <= 0) throw new VgIntegrationError(422, 'currency_unavailable', 'Seçilen kaynak para birimi için bu kur türü yayımlanmamış.');
    $rates = []; $rows = []; $warnings = []; $details = [];
    foreach (array_unique(array_merge([$base], $quotes)) as $code) if (isset($map[$code])) $details[$code] = $map[$code];
    foreach ($quotes as $quote) {
        $value = $map[$quote]['perUnit'][$kind] ?? null;
        if (!is_numeric($value) || $value <= 0) { $warnings[] = $quote . ' için seçilen kur türü eksik veya sıfır; dönüşüme dahil edilmedi.'; continue; }
        $rate = $baseValue / $value; $rates[$quote] = $rate;
        $rows[] = ['date' => $date, 'base' => $base, 'quote' => $quote, 'rate' => $rate, 'providers' => ['tcmb']];
    }
    return vg_int_currency_result('tcmb', 'Türkiye Cumhuriyet Merkez Bankası', $url, $base, $rates, $rows, [
        'date' => $date, 'requestedDate' => $requestedDate, 'quoteType' => $kind, 'rateTypeLabel' => ['forex_buying'=>'Döviz alış','forex_selling'=>'Döviz satış','banknote_buying'=>'Efektif alış','banknote_selling'=>'Efektif satış'][$kind],
        'currencyDetails' => $details, 'warnings' => $warnings, 'attribution' => ['label' => 'Kaynak: TCMB — gösterge niteliğindeki kurlar', 'url' => 'https://www.tcmb.gov.tr/kurlar/today.xml'],
    ]);
}

function vg_int_currency_frankfurter(array $input, callable $fetch): array {
    $base = vg_int_currency_code($input['base'] ?? null, 'USD'); $quotes = vg_int_currency_quotes($input);
    $providers = $input['providers'] ?? 'ecb';
    if (!is_string($providers) || strlen($providers) > 120 || !preg_match('/^[A-Za-z][A-Za-z0-9_-]*(?:,[A-Za-z][A-Za-z0-9_-]*){0,3}$/D', $providers)) throw new VgIntegrationError(422, 'currency_provider', 'En fazla dört geçerli Frankfurter veri sağlayıcısı seçin.');
    $query = ['base'=>$base, 'quotes'=>implode(',', $quotes), 'providers'=>$providers, 'expand'=>'providers'];
    $date = $input['date'] ?? '';
    if (isset($input['from']) || isset($input['to'])) {
        if ($date !== '' && $date !== 'latest') throw new VgIntegrationError(422, 'currency_range', 'Tek tarih veya tarih aralığından birini seçin.');
        $from = vg_int_currency_date($input['from'] ?? null); $to = vg_int_currency_date($input['to'] ?? null);
        if ($to < $from || (new DateTimeImmutable($to))->diff(new DateTimeImmutable($from))->days > 366) throw new VgIntegrationError(422, 'currency_range', 'Kur aralığı en fazla 366 gün olmalı.');
        $query['from']=$from; $query['to']=$to;
    } elseif ($date !== '' && $date !== 'latest') $query['date']=vg_int_currency_date($date);
    if (isset($input['group']) && $input['group'] !== '') { if (!in_array($input['group'], ['week','month'], true)) throw new VgIntegrationError(422,'currency_group','Kur grubu hafta veya ay olabilir.'); $query['group']=$input['group']; }
    $url = 'https://api.frankfurter.dev/v2/rates?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
    $payload = vg_int_currency_json(vg_int_currency_get($fetch, $url, 'application/json', 2097152));
    if (!vg_int_currency_is_list($payload)) throw new VgIntegrationError(502, 'currency_response', 'Frankfurter kur listesi doğrulanamadı.');
    $rows=[]; $seen=[];
    foreach ($payload as $row) {
        if (!is_array($row) || ($row['base'] ?? null) !== $base || !in_array($row['quote'] ?? null, $quotes, true)) throw new VgIntegrationError(502, 'currency_response', 'Frankfurter para birimleri istekle eşleşmiyor.');
        try { $rowDate=vg_int_currency_date($row['date'] ?? null); } catch (Throwable $error) { throw new VgIntegrationError(502,'currency_response','Frankfurter yayın tarihi doğrulanamadı.'); }
        if (isset($query['from']) && ($rowDate < $query['from'] || $rowDate > $query['to'])) throw new VgIntegrationError(502,'currency_response','Frankfurter yanıtı seçilen aralığın dışında.');
        $key=$rowDate.'|'.$row['quote'];if(isset($seen[$key]))throw new VgIntegrationError(502,'currency_response','Frankfurter aynı tarih ve para birimini iki kez döndürdü.');$seen[$key]=true;
        $actual=$row['providers']??[];if(!is_array($actual)||!vg_int_currency_is_list($actual)||count($actual)>120)throw new VgIntegrationError(502,'currency_response','Frankfurter kaynak atfı doğrulanamadı.');
        $providerDetails=[];$providerKeys=[];
        foreach($actual as $provider){
            if(!is_array($provider)||!is_string($provider['key']??null)||!preg_match('/^[A-Za-z][A-Za-z0-9_-]{0,40}$/D',$provider['key']))throw new VgIntegrationError(502,'currency_response','Frankfurter kaynak atfı doğrulanamadı.');
            try{$providerDate=vg_int_currency_date($provider['date']??null);}catch(Throwable $error){throw new VgIntegrationError(502,'currency_response','Frankfurter sağlayıcı tarihi doğrulanamadı.');}
            if(!in_array(strtolower($provider['key']),array_map('strtolower',explode(',',$providers)),true))throw new VgIntegrationError(502,'currency_response','Frankfurter sağlayıcısı seçilen kaynakla eşleşmiyor.');
            $providerKeys[]=$provider['key'];$providerDetails[]=['key'=>$provider['key'],'date'=>$providerDate,'rate'=>vg_int_currency_number($provider['rate']??null)];
        }
        $rows[]=['date'=>$rowDate,'base'=>$base,'quote'=>$row['quote'],'rate'=>vg_int_currency_number($row['rate']??null),'providers'=>array_values(array_unique($providerKeys)),'providerDetails'=>$providerDetails];
    }
    usort($rows,static function($a,$b){return strcmp($a['date'].'|'.$a['quote'],$b['date'].'|'.$b['quote']);});
    if(!$rows)throw new VgIntegrationError(404,'currency_empty','Seçilen tarih ve para birimi için Frankfurter verisi bulunamadı.');
    $latest=$rows[count($rows)-1]['date'];$rates=[];foreach($rows as $row)if($row['date']===$latest)$rates[$row['quote']]=$row['rate'];
    $warnings=[];foreach($quotes as $quote)if(!isset($rates[$quote]))$warnings[]=$quote.' için son gözlem tarihinde kur yok.';
    return vg_int_currency_result('frankfurter','Frankfurter',$url,$base,$rates,$rows,['quoteType'=>'reference_mid','requestedProviders'=>explode(',',$providers),'warnings'=>$warnings,'attribution'=>['label'=>'Kaynak: Frankfurter; veri sağlayıcıları gözlem bazında gösterilir','url'=>'https://frankfurter.dev/']]);
}
function vg_int_currency_is_list(array $array): bool { return $array === [] || array_keys($array) === range(0, count($array)-1); }

function vg_int_currency_exchange_rate(array $input, callable $fetch): array {
    if ((!empty($input['date']) && $input['date'] !== 'latest') || isset($input['from']) || isset($input['to'])) throw new VgIntegrationError(422,'currency_history_unavailable','ExchangeRate-API açık erişimde yalnız son günlük dönüşümü sağlar.');
    $base=vg_int_currency_code($input['base']??null,'USD');$quotes=vg_int_currency_quotes($input);
    if(count($quotes)!==1)throw new VgIntegrationError(422,'currency_quotes','ExchangeRate-API için tek hedef para birimi seçin.');
    $amount=$input['amount']??1;
    if(is_string($amount)&&!preg_match('/^\d+(?:\.\d+)?$/D',$amount)||is_bool($amount)||!is_numeric($amount)||!is_finite((float)$amount)||(float)$amount<0||(float)$amount>1000000000000)throw new VgIntegrationError(422,'currency_amount','Dönüştürülecek tutar sıfır ile 1 trilyon arasında olmalı.');
    $url='https://open.er-api.com/v6/latest/'.$base;
    $payload=vg_int_currency_json(vg_int_currency_get($fetch,$url,'application/json'));
    if(($payload['result']??null)!=='success'||($payload['base_code']??null)!==$base||!is_array($payload['rates']??null))throw new VgIntegrationError(502,'currency_response','ExchangeRate-API yanıtı doğrulanamadı.');
    $last=$payload['time_last_update_unix']??null;$next=$payload['time_next_update_unix']??null;
    if(!is_int($last)||$last<315532800||$last>time()+86400||!is_int($next)||$next<=$last)throw new VgIntegrationError(502,'currency_response','ExchangeRate-API güncelleme tarihi doğrulanamadı.');
    $quote=$quotes[0];if(!array_key_exists($quote,$payload['rates']))throw new VgIntegrationError(422,'currency_unavailable','Hedef para birimi ExchangeRate-API kaynağında bulunamadı.');
    $rate=vg_int_currency_number($payload['rates'][$quote]);$converted=(float)$amount*$rate;
    if(!is_finite($converted)||$converted>1000000000000000)throw new VgIntegrationError(422,'currency_amount','Dönüşüm sonucu desteklenen tutar aralığını aşıyor.');
    $date=gmdate('Y-m-d',$last);
    // Open-access terms permit conversions, not bulk data redistribution. Return
    // only the selected pair/amount; never mirror the provider's complete rates.
    return vg_int_currency_result('exchange_rate','ExchangeRate-API',$url,$base,[$quote=>$rate],[['date'=>$date,'base'=>$base,'quote'=>$quote,'rate'=>$rate,'providers'=>['exchange_rate']]],[
        'quote'=>$quote,'amount'=>(float)$amount,'convertedAmount'=>$converted,'quoteType'=>'indicative','updatedAt'=>gmdate('c',$last),'nextUpdateAt'=>gmdate('c',$next),'eolAt'=>!empty($payload['time_eol_unix'])?gmdate('c',(int)$payload['time_eol_unix']):null,
        'attribution'=>['label'=>'Rates By Exchange Rate API','url'=>'https://www.exchangerate-api.com'],'termsUrl'=>'https://www.exchangerate-api.com/terms','warnings'=>[],
    ]);
}
function vg_int_currency(string $action, array $input, ?callable $fetch = null): array {
    $fetch=$fetch??'vg_int_http';
    if($action==='tcmb')return vg_int_currency_tcmb($input,$fetch);
    if($action==='frankfurter')return vg_int_currency_frankfurter($input,$fetch);
    if($action==='exchange_rate')return vg_int_currency_exchange_rate($input,$fetch);
    throw new VgIntegrationError(404,'currency_action','Kur servisi bulunamadı.');
}

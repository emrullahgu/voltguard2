'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),local=path.join(root,'.qa/php/runtime/php.exe');
const php=process.env.VG_TEST_PHP||(fs.existsSync(local)?local:'php');
const source=Buffer.from(path.join(root,'api/lib/integrations.php')).toString('base64');
const date='2026-10-01';
function row(hour,price=1000,fraction=''){return{date:`${date}T${String(hour).padStart(2,'0')}:00:00${fraction}+03:00`,price};}
function fixture(items,input={date},status=200){
  const script=`define('VG_API',1);putenv('VG_EPIAS_TGT=TGT-synthetic-fixture-12345678');require base64_decode('${source}');
  $fixture=json_decode(stream_get_contents(STDIN),true,64,JSON_THROW_ON_ERROR);$requests=[];
  $fetch=static function($method,$url,$options)use($fixture,&$requests){$requests[]=['method'=>$method,'url'=>$url,'headers'=>$options['headers'],'body'=>json_decode($options['body'],true)];return ['status'=>$fixture['status'],'body'=>json_encode(['items'=>$fixture['items']],JSON_THROW_ON_ERROR)];};
  try{$data=vg_int_epias($fixture['input'],$fetch);$out=['ok'=>true,'data'=>$data,'requests'=>$requests];}
  catch(VgIntegrationError $e){$out=['ok'=>false,'status'=>$e->status,'code'=>$e->errCode,'message'=>$e->getMessage(),'requests'=>$requests];}
  echo json_encode($out,JSON_THROW_ON_ERROR);`;
  const child=spawnSync(php,['-r',script],{input:JSON.stringify({items,input,status}),encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(child.status,0,child.stderr);assert.equal(child.stderr,'');return JSON.parse(child.stdout);
}
test('EPİAŞ normalizes a complete day, preserving zero/negative prices and MWh-to-kWh units',()=>{
  const rows=Array.from({length:24},(_,hour)=>row(hour,hour===0?0:hour===1?-100:1500));
  const r=fixture(rows.reverse());assert.equal(r.ok,true);assert.equal(r.data.complete,true);assert.equal(r.data.items.length,24);
  assert.equal(r.data.items[0].date,row(0).date);assert.equal(r.data.items[0].priceTryPerKwh,0);assert.equal(r.data.items[1].priceTryPerKwh,-0.1);assert.equal(r.data.items[2].priceTryPerKwh,1.5);
  assert.equal(r.data.timezone,'Europe/Istanbul');assert.equal(r.requests.length,1);assert.equal(r.requests[0].method,'POST');assert.match(r.requests[0].url,/\/markets\/dam\/data\/mcp$/);
  assert.deepEqual(r.requests[0].body,{startDate:`${date}T00:00:00+03:00`,endDate:`${date}T23:59:59+03:00`});
  assert.equal(JSON.stringify(r.data).includes('TGT-synthetic'),false);
});
test('An empty/unpublished or partial EPİAŞ day is explicitly incomplete',()=>{
  for(const rows of [[],[row(0,42)]]){const r=fixture(rows);assert.equal(r.ok,true);assert.equal(r.data.complete,false);assert.equal(r.data.items.length,rows.length);}
});
test('EPİAŞ rejects impossible calendar dates and out-of-range requests before contacting the provider',()=>{
  for(const date of ['2026-02-30','2015-06-30','2099-01-01','not-a-date']){const r=fixture([],{date});assert.equal(r.ok,false);assert.equal(r.code,'date_invalid');assert.equal(r.requests.length,0);}
});
test('EPİAŞ rejects hours outside00–23 and malformed minute/timezone values',()=>{
  for(const stamp of [`${date}T24:00:00+03:00`,`${date}T99:00:00+03:00`,`${date}T00:01:00+03:00`,`${date}T00:00:00Z`]){
    const r=fixture([{date:stamp,price:1000}]);assert.equal(r.ok,false);assert.equal(r.code,'upstream_invalid');assert.equal(r.requests.length,1);
  }
});
test('Equivalent fractional timestamp representations cannot count one hour twice',()=>{
  for(const duplicate of [[row(0),row(0,1000,'.000')],[row(1,1000,'.0'),row(1,1000,'.000')]]){
    const r=fixture(duplicate);assert.equal(r.ok,false);assert.equal(r.code,'upstream_invalid');
  }
});
test('Malformed prices and oversized daily responses are rejected without partial success',()=>{
  for(const price of [null,true,[],1000001,'1e9999']){const r=fixture([row(0,price)]);assert.equal(r.ok,false);assert.equal(r.code,'upstream_invalid');}
  const tooMany=fixture(Array.from({length:26},(_,i)=>row(i)));assert.equal(tooMany.ok,false);assert.equal(tooMany.code,'upstream_invalid');
});
test('Provider session rejection is a clear failure and never leaks ticket or provider body',()=>{
  for(const status of [401,403]){const r=fixture([row(0)],{date},status);assert.equal(r.ok,false);assert.equal(r.code,'epias_auth');assert.equal(r.requests.length,1);assert.equal(r.message.includes('TGT-synthetic'),false);}
});

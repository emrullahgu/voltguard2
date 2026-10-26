'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const reader = require('../../js/home-volthaber.js');
const origin = 'https://voltguard.com.tr';
const entry = (n, extra = {}) => ({url:`/volthaber/yayindaki-yazi-${n}/`,title:`Yayımlanmış teknik yazı ${n}`,summary:'Herkese açık kısa açıklama.',...extra});
const payload = (items, page=1, total=items.length) => ({ok:true,service:'vg-volthaber/1',items,page,pages:Math.max(1,Math.ceil(total/12)),total});
const response = data => ({ok:true,json:async()=>data});

test('public VoltHaber entries allow only exact canonical same-origin article URLs and plain text metadata', () => {
  assert.deepEqual(reader.normalizeEntry(entry(1,{author:'hidden',editor:'hidden',views:42,body:'not copied'}),origin),{
    u:'/volthaber/yayindaki-yazi-1/',t:'Yayımlanmış teknik yazı 1',keywords:'Yayımlanmış teknik yazı 1 Herkese açık kısa açıklama.',c:'haberler',kind:'VoltHaber'
  });
  assert.equal(reader.normalizeEntry(entry(1,{url:origin+'/volthaber/yayindaki-yazi-1/'}),origin).u,'/volthaber/yayindaki-yazi-1/');
  assert.equal(reader.normalizeEntry(entry(1,{title:'<b>Güvenli</b> başlık\n',summary:'<img src=x> metin'}),origin).keywords,'Güvenli başlık metin');
  for (const url of ['/api/volthaber.php?action=list','/calisan/uygulama/','/hesap/panel.html','https://external.invalid/volthaber/yazilar/','//voltguard.com.tr/volthaber/yazilar/',origin+'/volthaber/yazilar/?token=secret','/volthaber/yazilar/#token','/volthaber/constructor/','/volthaber/prototype/','/volthaber/__proto__/','/volthaber/abonelik/','/volthaber/kategori/','/volthaber/%61pi/','/volthaber/../api/','/volthaber\\yazilar/','/volthaber/yazilar','/volthaber/Yazilar/','/volthaber/---/','/volthaber/-abc/','/volthaber/abc-/']) assert.equal(reader.normalizeEntry(entry(1,{url}),origin),null,url);
  for (const extra of [{status:'draft'},{status:'scheduled'},{draft:true},{visibility:'private'},{title:' '},{summary:{}},{title:'x'.repeat(161)}]) assert.equal(reader.normalizeEntry(entry(1,extra),origin),null);
  assert.equal(reader.normalizeEntries([entry(1),entry(1),entry(2)],origin).length,2);
});

test('public reader follows all 12-item pages without cookies or writes and returns a complete replacement set', async () => {
  const calls=[];
  const result=await reader.readEntries({origin,fetch:async(url,options)=>{calls.push({url,options});const page=Number(new URL(url,origin).searchParams.get('page'));return response(payload(page===1?Array.from({length:12},(_,i)=>entry(i+1)):[entry(13)],page,13));}});
  assert.equal(result.ok,true);assert.equal(result.complete,true);assert.equal(result.total,13);assert.equal(result.entries.at(-1).u,'/volthaber/yayindaki-yazi-13/');
  assert.deepEqual(calls.map(call=>call.url),['/api/volthaber.php?action=list&page=1','/api/volthaber.php?action=list&page=2']);
  assert.ok(calls.every(call=>call.options.method==='GET'&&call.options.credentials==='omit'&&call.options.mode==='same-origin'&&call.options.redirect==='error'));
  const empty=await reader.readEntries({origin,fetch:async()=>response(payload([]))});assert.equal(empty.ok,true);assert.deepEqual(empty.entries,[]);assert.equal(empty.total,0);
});

test('unsafe entries are excluded, while unstable pagination and duplicate moving rows never replace the snapshot', async () => {
  const filtered=await reader.readEntries({origin,fetch:async()=>response(payload([entry(1),entry(2,{url:'/api/auth.php'}),entry(3,{status:'draft'})]))});
  assert.equal(filtered.ok,true);assert.equal(filtered.sourceTotal,3);assert.equal(filtered.entries.length,1);
  for (const bad of [{ok:false},{...payload([]),service:'wrong'},{...payload([entry(1)]),page:2},{...payload([entry(1)]),pages:999},{...payload([entry(1)]),total:Infinity},payload([entry(1),entry(1)]),{...payload([entry(1)]),total:2}]) {
    const result=await reader.readEntries({origin,fetch:async()=>response(bad)});assert.deepEqual(result,{ok:false,complete:false,entries:[]});
  }
  const changing=await reader.readEntries({origin,fetch:async url=>response(url.endsWith('page=1')?payload(Array.from({length:12},(_,i)=>entry(i)),1,13):payload([entry(13),entry(14)],2,14))});
  assert.equal(changing.ok,false);assert.deepEqual(changing.entries,[]);
});

test('network, JSON, timeout and caller abort return a quiet failure with no partial list', async () => {
  for (const fetcher of [async()=>{throw new Error('private technical error');},async()=>({ok:false}),async()=>({ok:true,json:async()=>{throw new Error('bad JSON');}})]) {
    assert.deepEqual(await reader.readEntries({origin,fetch:fetcher}),{ok:false,complete:false,entries:[]});
  }
  const timed=await reader.readEntries({origin,timeoutMs:15,fetch:async()=>new Promise(()=>{})});assert.equal(timed.ok,false);
  const controller=new AbortController();controller.abort();let called=false;
  const aborted=await reader.readEntries({origin,signal:controller.signal,fetch:async()=>{called=true;return response(payload([]));}});assert.equal(aborted.ok,false);assert.equal(called,false);
  const pending=new AbortController();
  const inflight=reader.readEntries({origin,signal:pending.signal,fetch:async()=>new Promise(()=>{})});
  pending.abort();assert.deepEqual(await inflight,{ok:false,complete:false,entries:[]});
});

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('../saha-app/node_modules/typescript'),root=path.resolve(__dirname,'../saha-app/src');
function load(file,deps,globals){
  const filename=path.join(root,file),module={exports:{}};
  const source=file==='portal/api.ts'&&process.env.VG_SESSION_SOURCE_BASELINE?fs.readFileSync(process.env.VG_SESSION_SOURCE_BASELINE,'utf8'):fs.readFileSync(filename,'utf8');
  const code=ts.transpileModule(source,{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(!(name in deps))throw Error('Unexpected dependency '+name);return deps[name];},Error,Promise,JSON,Map,Set,TextEncoder,AbortController,URLSearchParams,setTimeout,clearTimeout,...globals},{filename});return module.exports;
}
const watch=promise=>Promise.resolve(promise).then(value=>({value}),error=>({error}));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
function fixture(){
  const requests=[],events=[],redirects=[],notices=[];
  const window={location:{hostname:'127.0.0.1',origin:'http://127.0.0.1'},top:{location:{replace:url=>redirects.push(url)}},parent:{},addEventListener(){},dispatchEvent:event=>notices.push(event)};
  class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail;}}
  const globals={window,CustomEvent};
  const api=load('portal/api.ts',{'./networkPolicy':{scopedFetch:(url,options)=>{const pending=deferred();requests.push({url,options,...pending});return pending.promise;}},'./moduleHostBridge':{emitModuleEvent:(...args)=>events.push(args)}},globals);
  async function count(n){for(let i=0;i<100&&requests.length<n;i++)await Promise.resolve();assert.equal(requests.length,n,'Expected exact native transport request count');}
  const csrf=user=>(user==='a'?'a':'b').repeat(64);
  const response=(data,user='a',status=200)=>({ok:status<400,status,json:async()=>({api:'vg-company/1',ok:status<400,csrf:csrf(user),...(status<400?{data}:{error:'unauthorized',message:'Old session expired'})})});
  const identity=(user,cache={})=>({user:{id:'actor-'+user},profile:{id:'actor-'+user,approval_status:'approved'},capabilities:{dataSource:'local'},cache});
  const reply=(i,data,user='a',status=200)=>requests[i].resolve(response(data,user,status));
  async function boot(user='a',force=false,cache={}){const start=requests.length,p=api.bootstrapPortal(force);await count(start+1);reply(start,identity(user,cache),user);return p;}
  return{api,requests,events,redirects,notices,globals,csrf,response,identity,reply,count,boot};
}

test('A delayed bootstrap cannot restore a previous employee after reset and a newer login',async()=>{
  const f=fixture(),old=watch(f.api.bootstrapPortal());await f.count(1);f.api.clearPortalMemory();await f.boot('b');
  f.reply(0,f.identity('a'),'a');const outcome=await old;
  assert.equal(outcome.error?.code,'portal_session_changed');assert.equal(f.api.currentPortalIdentity().user.id,'actor-b');assert.equal(f.redirects.length,0);
});

test('Integration GET queries preserve the selected action and encode provider parameters through guarded transport',async()=>{
  const f=fixture();await f.boot();
  const pending=f.api.transport('github',undefined,'/api/integrations.php','vg-integrations/1',true,{owner:'a/b?',repo:'a & b',action:'ai_chat'});
  await f.count(2);const request=f.requests[1],url=new URL(request.url,'https://voltguard.com.tr');
  assert.equal(url.pathname,'/api/integrations.php');assert.equal(url.searchParams.get('action'),'github');
  assert.equal(url.searchParams.get('owner'),'a/b?');assert.equal(url.searchParams.get('repo'),'a & b');
  assert.equal(request.options.method,'GET');assert.equal(request.options.credentials,'same-origin');
  request.resolve({ok:true,status:200,json:async()=>({api:'vg-integrations/1',ok:true,data:{provider:'github'}})});
  assert.equal((await pending).provider,'github');
});

test('Completion of an obsolete bootstrap cannot release the current bootstrap single-flight promise',async()=>{
  const f=fixture(),old=watch(f.api.bootstrapPortal());await f.count(1);f.api.clearPortalMemory();const current=f.api.bootstrapPortal();await f.count(2);
  f.reply(0,f.identity('a'),'a');await old;const joined=f.api.bootstrapPortal();
  f.reply(1,f.identity('b'),'b');await Promise.all([current,joined]);assert.equal(joined,current);assert.equal(f.requests.length,2);
});

test('A delayed old read cannot disclose its payload or replace the current employee CSRF token',async()=>{
  const f=fixture();await f.boot();const old=watch(f.api.portalRpc('app_saha_cache',{operation:'get',key:'personal_notes_v1'}));await f.count(2);
  f.api.clearPortalMemory();await f.boot('b');f.reply(1,{value:'old employee private note'},'a');const outcome=await old;
  const next=watch(f.api.portalRpc('app_saha_query',{operation:'select',table:'customers'}));await f.count(4);const token=f.requests[3].options.headers['X-VG-STAFF-CSRF'];f.reply(3,{data:[]},'b');await next;
  assert.equal(outcome.error?.code,'portal_session_changed');assert.equal(token,f.csrf('b'));assert.equal(f.api.currentPortalIdentity().user.id,'actor-b');
});

test('A late unauthorized response from the old employee cannot sign out the current employee',async()=>{
  const f=fixture();await f.boot();const old=watch(f.api.portalRpc('app_saha_cache',{operation:'get',key:'personal_notes_v1'}));await f.count(2);
  f.api.clearPortalMemory();await f.boot('b');f.reply(1,null,'a',401);const outcome=await old;
  assert.equal(outcome.error?.code,'portal_session_changed');assert.equal(f.api.currentPortalIdentity()?.user.id,'actor-b');assert.equal(f.redirects.length,0);
});

test('A forced bootstrap detecting another employee invalidates still-running previous-employee requests',async()=>{
  const f=fixture();await f.boot();const old=watch(f.api.portalRpc('app_saha_cache',{operation:'get',key:'personal_notes_v1'}));await f.count(2);
  await f.boot('b',true);f.reply(1,{value:'old employee private note'},'a');const outcome=await old;
  assert.equal(outcome.error?.code,'portal_session_changed');assert.equal(f.api.currentPortalIdentity().user.id,'actor-b');
});

test('Session changes during JSON decoding also discard the obsolete response',async()=>{
  const f=fixture();await f.boot();const old=watch(f.api.portalRpc('app_saha_cache',{operation:'get',key:'personal_notes_v1'}));await f.count(2);
  const body=deferred();f.requests[1].resolve({ok:true,status:200,json:()=>body.promise});for(let i=0;i<8;i++)await Promise.resolve();
  f.api.clearPortalMemory();await f.boot('b');body.resolve({api:'vg-company/1',ok:true,csrf:f.csrf('a'),data:{value:'old decoded note'}});
  const outcome=await old;assert.equal(outcome.error?.code,'portal_session_changed');assert.equal(f.api.currentPortalIdentity().user.id,'actor-b');
});

test('An obsolete private cache read cannot repopulate the new employee memory cache',async()=>{
  const f=fixture();await f.boot();const storage=load('portal/privateStorage.ts',{'./api':f.api},f.globals).default;
  const old=watch(storage.getItem('personal_notes_v1'));await f.count(2);f.api.clearPortalMemory();
  await f.boot('b',false,{personal_notes_v1:'Current employee private note'});f.reply(1,{value:'Previous employee private note',shared:false},'a');const outcome=await old;
  const current=await storage.getItem('personal_notes_v1');assert.equal(outcome.error?.code,'portal_session_changed');assert.equal(current,'Current employee private note');
});

test('An obsolete native query cannot advance the new employee mutation revision',async()=>{
  const f=fixture();await f.boot();const native=load('portal/nativeClient.ts',{'./api':f.api},f.globals);
  const old=watch(native.supabase.from('assets').select('*'));await f.count(2);f.api.clearPortalMemory();await f.boot('b');
  const current=watch(native.supabase.from('assets').select('*'));await f.count(4);f.reply(3,{data:[{id:'record',name:'Current employee row'}],versions:{record:7}},'b');await current;
  f.reply(1,{data:[{id:'record',name:'Previous employee row'}],versions:{record:99}},'a');const outcome=await old;
  const update=watch(native.supabase.from('assets').update({name:'Current edit'}).eq('id','record'));await f.count(5);
  const version=f.requests[4].options.body;f.reply(4,{data:null,versions:{record:8}},'b');await update;
  assert.equal(outcome.value?.error?.code,'portal_session_changed');assert.equal(JSON.parse(version).args.versions.record,7);
});

test('An obsolete mutation retains unknown outcome without publishing its error into the new employee session',async()=>{
  const f=fixture();await f.boot();const old=watch(f.api.portalRpc('app_saha_query',{operation:'insert',table:'assets',rows:[{name:'Previous employee draft'}]}));await f.count(2);
  f.api.clearPortalMemory();await f.boot('b');const before=f.notices.length;f.reply(1,{data:{id:'accepted-under-original-account'}},'a');const outcome=await old;
  assert.equal(outcome.error?.code,'portal_session_changed');assert.equal(outcome.error.writeOutcome,'unknown');
  assert.equal(f.api.getWriteStatus().pending,0);assert.equal(f.api.getWriteStatus().error,null);assert.equal(f.api.getWriteStatus().outcome,null);assert.equal(f.notices.length,before);assert.equal(f.requests.length,3,'A stale mutation is never replayed');
});

test('A current unauthorized response still clears identity and redirects to the employee login',async()=>{
  const f=fixture();await f.boot();const read=watch(f.api.portalRpc('app_saha_cache',{operation:'get',key:'personal_notes_v1'}));await f.count(2);f.reply(1,null,'a',401);
  const outcome=await read;assert.equal(outcome.error?.status,401);assert.equal(f.api.currentPortalIdentity(),null);assert.deepEqual(f.redirects,['/calisan/giris.html']);
});

test('A same-employee forced refresh does not discard a valid in-flight read',async()=>{
  const f=fixture();await f.boot();const read=watch(f.api.portalRpc('app_saha_cache',{operation:'get',key:'personal_notes_v1'}));await f.count(2);
  await f.boot('a',true);f.reply(1,{value:'Current employee note'},'a');const outcome=await read;
  assert.equal(outcome.error,undefined);assert.equal(outcome.value.value,'Current employee note');assert.equal(f.api.currentPortalIdentity().user.id,'actor-a');
});

test('A different employee with an unavailable company source cannot retain the prior verified identity',async()=>{
  const f=fixture();await f.boot();const change=watch(f.api.bootstrapPortal(true));await f.count(2);
  const next=f.identity('b');next.capabilities.dataSource='unavailable';f.reply(1,next,'b');const outcome=await change;
  assert.equal(outcome.error?.code,'company_source_unavailable');assert.equal(f.api.currentPortalIdentity(),null);assert.equal(f.redirects.length,0);
  await f.boot('b');assert.equal(f.api.currentPortalIdentity().user.id,'actor-b');
});

'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let ts;
try { ts=require('../saha-app/node_modules/typescript'); }
catch(error) {
 if(error.code!=='MODULE_NOT_FOUND'||!error.message.includes("'../saha-app/node_modules/typescript'"))throw error;
 ts=require('typescript'); // Pinned compiler supplied by the offline CI image.
}
const root=path.resolve(__dirname,'../saha-app/src');
function load(relative,stubs={},globals={}){
 const code=ts.transpileModule(fs.readFileSync(path.join(root,relative),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,require:ref=>{if(ref in stubs)return stubs[ref];throw new Error('Unexpected dependency '+ref);},console,Date,Math,Map,Set,JSON,Object,Array,Error,Promise,TextEncoder,crypto:require('node:crypto').webcrypto,...globals},{filename:relative});
 return module.exports;
}
const identity={user:{id:'synthetic-staff'},profile:{id:'synthetic-staff',approval_status:'approved'}};
const baseApi={reportPortalError:error=>error,onPortalReset:()=>()=>{},reportWriteFailure:()=>{},bootstrapPortal:async()=>identity};
function importsFixture(){
 const calls=[];let fail=false,historyFail=false;
 const supabase={from:table=>{const q={insert(payload){calls.push({table,payload});q.payload=payload;return q;},select(){return q;},then(resolve,reject){const result=fail||(historyFail&&table==='import_history')?{data:null,error:new Error('Synthetic write refused')}:{data:Array.isArray(q.payload)?q.payload.map((_,i)=>({id:'synthetic-'+i})):[],error:null};return Promise.resolve(result).then(resolve,reject);}};return q;}};
 return {service:load('services/integrations.ts',{'../portal/api':baseApi,'@react-native-async-storage/async-storage':{},'./supabase':{supabase,SUPABASE_CONFIGURED:true}}),calls,fail:()=>{fail=true;},historyFail:()=>{historyFail=true;}};
}

test('CSV parser supports quoted multiline, semicolon decimal comma, BOM and escaped quotes',()=>{
 const {service:s}=importsFixture();
 const parsed=s.parseCsvOrTsv('\uFEFFPOZ Kodu;İş Tanımı;Birim;Birim Fiyat\r\nP1;"Kablo; \"\"özel\"\"\nHat";m;1.234,50\r\n');
 assert.equal(parsed.rows.length,1);assert.equal(parsed.rows[0][1],'Kablo; "özel"\nHat');
 assert.equal(s.validateImport('poz',parsed.headers,parsed.rows).errors.length,0);
 assert.throws(()=>s.parseCsvOrTsv('name,title\n"unfinished'),/kapanmamış/);
});
test('Invalid import aborts the entire batch and never reports validation as committed data',async()=>{
 const f=importsFixture();const result=await f.service.importRecords('poz','pozId;name;unit;unitPrice\nP1;Valid;m;10\nP2;Invalid;m;NaN');
 assert.equal(result.rowsImported,0);assert.equal(result.rowsSkipped,2);assert.ok(result.errors.length);assert.equal(f.calls.length,0);
});
test('CSV success requires committed native rows; failed native writes never return success',async()=>{
 const f=importsFixture();f.fail();
 await assert.rejects(f.service.importRecords('customers','shortName;title\nSynthetic;Synthetic Customer'),/Synthetic write refused/);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].table,'customers');
 const ok=importsFixture();ok.historyFail();
 const result=await ok.service.importRecords('poz','pozId;name;unit;unitPrice\nP1;Synthetic cable;m;1.234,50');
 assert.equal(result.rowsImported,1);assert.equal(ok.calls[0].table,'catalog_custom_products');assert.equal(ok.calls[0].payload[0].price,1234.5);assert.match(result.warning,/tekrar göndermeyin/);
});
test('Shared private storage refreshes shared values and rejects stale revision writes',async()=>{
 let revision=1,value='["synthetic-old"]';const calls=[];
 const api={...baseApi,bootstrapPortal:async()=>({...identity,sharedCacheKeys:['tasks_v1'],cache:{theme:'light'}}),portalRpc:async(_name,args)=>{
  calls.push(args);
  if(args.operation==='get')return {shared:true,value,revision};
  if(args.operation==='set'){if(args.revision!==revision)throw new Error('Synthetic stale version');value=args.value;return {shared:true,revision:++revision};}
  if(args.operation==='clear')return {};
 }};
 const storage=load('portal/privateStorage.ts',{'./api':api}).default;
 assert.equal(await storage.getItem('tasks_v1'),'["synthetic-old"]');
 revision=2;value='["synthetic-concurrent"]';
 await assert.rejects(storage.setItem('tasks_v1','["must not overwrite"]'),/Synthetic stale version/);
 assert.equal(value,'["synthetic-concurrent"]');
 assert.equal(await storage.getItem('tasks_v1'),'["synthetic-concurrent"]');
 await storage.setItem('tasks_v1','["synthetic-new"]');assert.equal(revision,3);
 await storage.clear();assert.equal(await storage.getItem('tasks_v1'),'["synthetic-new"]');
 assert.equal(calls.filter(c=>c.operation==='get').length,3);
});
test('Native query preserves not-is-null protocol and recurring RPC revision tokens',async()=>{
 const calls=[];
 const api={...baseApi,portalRpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='app_saha_rpc')return {orders:[],tableVersions:{work_orders:{'synthetic-order':9}}};
  return {data:[],versions:{}};
 }};
 const {supabase}=load('portal/nativeClient.ts',{'./api':api});
 await supabase.from('work_orders').select('*').not('finished_at','is',null);
 assert.equal(calls[0].args.filters[0].value.op,'is');assert.equal(calls[0].args.filters[0].value.value,null);
 await supabase.rpc('run_due_templates');
 await supabase.from('work_orders').update({status:'Bitti'}).eq('id','synthetic-order');
 assert.equal(calls[2].args.versions['synthetic-order'],9);
});

test('Unconfigured external notifications make no API request and never claim delivery',async()=>{
 const calls=[];
 const api={...baseApi,bootstrapPortal:async()=>({...identity,capabilities:{externalServices:false}}),portalRpc:async(name,args)=>{calls.push({name,args});return {sent:1};}};
 const {supabase}=load('portal/nativeClient.ts',{'./api':api});
 const result=await supabase.functions.invoke('notify-push',{body:{all:true}});
 assert.equal(calls.length,0);assert.equal(result.data,null);assert.equal(result.error.code,'service_unavailable');
 assert.match(result.error.message,/Gönderim yapılmadı/);
});

test('Employee mapping keeps explicitly chosen portal identity through payroll edits',()=>{
 const mapper=load('services/data/mappers.ts');
 const employee=mapper.employeeFromRow({id:'synthetic-employee',full_name:'Synthetic Employee',user_id:'synthetic-explicit-binding',monthly_wage:2200,daily_wage:100});
 assert.equal(employee.userId,'synthetic-explicit-binding');
 assert.equal(mapper.employeeToRow({...employee,monthlyWage:2400}).user_id,'synthetic-explicit-binding');
 assert.equal(mapper.employeeToRow({...employee,userId:null}).user_id,null);
});
test('Calendar and knowledge edits do not overwrite a list after a failed server read',async()=>{
 let writes=0;const storage={getItem:async()=>{throw new Error('Synthetic read unavailable');},setItem:async()=>{writes++;}};
 const stubs={'../portal/api':baseApi,'@react-native-async-storage/async-storage':storage};
 const calendar=load('services/calendar.ts',stubs),knowledge=load('services/aiKnowledgeBase.ts',stubs);
 await assert.rejects(calendar.saveEvent({title:'Synthetic event',startAt:'2026-10-27T10:00:00Z'}),/Synthetic read unavailable/);
 await assert.rejects(knowledge.upsertDoc({title:'Synthetic note',content:'Must not overwrite',tags:[]}),/Synthetic read unavailable/);
 assert.equal(writes,0);
});
test('Expense failures never create a phantom successful cache entry',async()=>{
 const failure=new Error('Synthetic expense refused');
 const supabase={auth:{getUser:async()=>({data:{user:{id:'synthetic-staff'}},error:null})},from:()=>{
  const query={insert(){return query;},select(){return query;},single:async()=>({data:null,error:failure}),delete(){return query;},eq(){return query;},then(resolve,reject){return Promise.resolve({data:null,error:failure}).then(resolve,reject);}};return query;
 }};
 const expenses=load('services/expenses.ts',{'./supabase':{supabase},'./data/auditRepo':{auditRepo:{log:async()=>{throw new Error('Audit must not run');}}}});
 await assert.rejects(expenses.addExpense({type:'Synthetic',amount:10,date:'2026-10-27',description:'Synthetic'}),/Synthetic expense refused/);
 await assert.rejects(expenses.deleteExpense('synthetic-missing'),/Synthetic expense refused/);
 await assert.rejects(expenses.addExpense({type:'Synthetic',amount:NaN,date:'2026-10-27',description:'Invalid'}),/geçerli/);
});
test('Own payroll reads use the protected database without writing an admin-only shared cache',async()=>{
 const supabase={from:()=>({select(){return this;},order:async()=>({data:[{id:'synthetic-payroll',employee_id:'synthetic-employee',full_name:'Synthetic Employee',period:'2026-10',agreed_net:100}],error:null})})};
 const forbiddenCache={getItem:async()=>{throw new Error('Shared payroll cache must not be read');},setItem:async()=>{throw new Error('Shared payroll cache must not be written');}};
 const payroll=load('services/bordro.ts',{'./supabase':{supabase,SUPABASE_CONFIGURED:true},'@react-native-async-storage/async-storage':forbiddenCache,'./data/repository':{newUuid:()=>''},'./bordroEngine':{calcBordro:()=>({})}});
 assert.equal((await payroll.listBordro())[0].id,'synthetic-payroll');
 await payroll.clearBordroCache();
});
test('Customer documents require a successful private upload and persist a protected URL',async()=>{
 const values=new Map();let fail=true,uploads=0;
 const storage={getItem:async key=>values.get(key)||null,setItem:async(key,value)=>{values.set(key,value);}};
 const supabase={storage:{from:()=>({upload:async()=>{uploads++;return {error:fail?new Error('Synthetic upload refused'):null};},getPublicUrl:path=>({data:{publicUrl:'/api/saha-asset.php?bucket=customer-docs&path='+encodeURIComponent(path)}})})}};
 const documents=load('services/customerDocuments.ts',{'@react-native-async-storage/async-storage':storage,'./supabase':{supabase}},{window:{location:{origin:'https://synthetic.invalid'}},URL,fetch:async()=>new Response(new Blob(['Synthetic PDF'],{type:'application/pdf'}))});
 const doc={customerId:'synthetic-customer',name:'Synthetic.pdf',uri:'blob:synthetic-file'};
 await assert.rejects(documents.addDocument(doc),/Synthetic upload refused/);assert.equal(values.size,0);
 fail=false;const saved=await documents.addDocument(doc);assert.match(saved.uri,/^\/api\/saha-asset\.php/);assert.equal((await documents.listDocuments()).length,1);assert.equal(uploads,2);
 await assert.rejects(documents.addDocument({...doc,uri:'https://external.invalid/Synthetic.pdf'}),/Dosya yüklenmedi/);
});

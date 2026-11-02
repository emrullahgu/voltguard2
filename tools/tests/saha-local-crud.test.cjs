'use strict';
// Exercise maintained service code with isolated in-memory transport only.
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
function fixture(){
 const values=new Map(),modules=new Map(),uploads=[],calls=[];let fail=false,fetches=0;
 const storage={getItem:async key=>{if(fail)throw new Error('Synthetic server unavailable');return values.get(key)||null;},setItem:async(key,value)=>{if(fail)throw new Error('Synthetic server unavailable');values.set(key,value);},removeItem:async key=>values.delete(key),getAllKeys:async()=>[...values.keys()]};
 const api={reportPortalError:error=>error,bootstrapPortal:async()=>({user:{id:'synthetic-staff'}})};
 const buckets={upload:async(key,blob)=>{uploads.push({key,blob});if(fail)throw new Error('Synthetic upload unavailable');return {data:{path:key},error:null};},getPublicUrl:key=>({data:{publicUrl:'/api/saha-asset.php?bucket=photos&path='+key}})};
 const native={supabase:{rpc:async(name,args)=>{calls.push({name,args});return {data:{orders:[{id:'synthetic-id',number:'RT-SYNTHETIC',date:'2026-10-27',status:'Bekliyor'}]},error:null};},storage:{from:()=>buckets}},SUPABASE_CONFIGURED:true};
 function load(name){
  const filename=path.resolve(root,name);if(modules.has(filename))return modules.get(filename).exports;
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  const module={exports:{}};modules.set(filename,module);
  const localRequire=ref=>{
   if(ref==='@react-native-async-storage/async-storage')return storage;
   if(ref.endsWith('/portal/api')||ref==='../portal/api')return api;
   if(ref==='./supabase')return native;
   if(ref==='./channels')return {broadcast:async()=>{throw new Error('Synthetic delivery not configured');}};
   if(ref==='./catalogOverrides')return {listSharedPoz:async()=>[],setSharedPozActive:async()=>{}};
   if(ref==='./data/mappers')return {workOrderFromRow:row=>({id:row.number,date:row.date,status:row.status})};
   if(ref.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(filename),ref.endsWith('.ts')?ref:ref+'.ts')));
   throw new Error('Unexpected test dependency '+ref);
  };
  const context={module,exports:module.exports,require:localRequire,console,Date,Math,Map,Set,JSON,Object,Array,Error,Promise,Blob,Response,URL,TextEncoder,crypto:require('node:crypto').webcrypto,window:{location:{origin:'https://synthetic.invalid'}},fetch:async()=>{fetches++;return new Response(new Blob(['Synthetic private attachment'],{type:'text/plain'}));}};
  vm.runInNewContext(code,context,{filename});return module.exports;
 }
 return {load:name=>load('services/'+name+'.ts'),values,uploads,calls,fail:()=>{fail=true;},fetches:()=>fetches};
}

test('Saha tasks, tracked products and transformer quotes persist edits and deletions',async()=>{
 const f=fixture(),tasks=f.load('tasks'),products=f.load('productItems'),quotes=f.load('transformerProposals');
 const t=await tasks.saveTask({title:'Synthetic task',status:'todo',priority:'normal'});
 assert.equal((await tasks.getTask(t.id)).title,'Synthetic task');
 await tasks.saveTask({...t,status:'done'});assert.ok((await tasks.getTask(t.id)).completedAt);
 const p=await products.saveProductItem({name:'Synthetic meter',code:'SYNTHETIC',status:'in_stock'});
 await products.saveProductItem({...p,status:'maintenance'});assert.equal((await products.getProductItem(p.id)).status,'maintenance');
 const q=await quotes.saveTransformerQuote({customerName:'Synthetic customer',monthlyFee:10,totalFee:120});
 assert.equal((await quotes.getTransformerQuote(q.id)).totalFee,120);
 await tasks.deleteTask(t.id);await products.deleteProductItem(p.id);await quotes.deleteTransformerQuote(q.id);
 assert.equal((await tasks.listTasks()).length,0);assert.equal((await products.listProductItems()).length,0);assert.equal((await quotes.listTransformerQuotes()).length,0);
});
test('Saha task comments/attachments and payroll save real persisted records',async()=>{
 const f=fixture(),collab=f.load('taskCollab'),payroll=f.load('payroll');
 const c=await collab.addComment({taskId:'synthetic-task',text:'Hello @synthetic-user'});assert.equal((await collab.listComments('synthetic-task'))[0].mentions[0],'synthetic-user');
 const a=await collab.addAttachment({taskId:'synthetic-task',name:'Synthetic.pdf',uri:'/api/saha-asset.php?synthetic'});assert.equal((await collab.listAttachments('synthetic-task'))[0].id,a.id);
 const ts=await payroll.saveTimesheetEntry({employeeId:'synthetic',date:'2026-10-27',status:'present'});
 await payroll.saveTimesheetEntry({employeeId:'synthetic',date:'2026-10-27',status:'leave'});assert.equal((await payroll.listTimesheet()).length,1);assert.equal((await payroll.listTimesheet())[0].id,ts.id);assert.equal((await payroll.listTimesheet())[0].status,'leave');
 const run=await payroll.savePayrollRun({employeeId:'synthetic',periodMonth:'2026-10',net:100});assert.equal((await payroll.getPayrollRun(run.id)).net,100);
});
test('Saha imported meter data generates weekly and daily reports without external delivery',async()=>{
 const f=fixture(),osos=f.load('osos');
 const count=await osos.bulkImportReadings([{meterNo:'SYNTHETIC-METER',readingAt:'2026-10-20T12:00:00Z',activeImportKwh:10,activeExportKwh:1,demandKw:5},{meterNo:'SYNTHETIC-METER',readingAt:'2026-10-21T12:00:00Z',activeImportKwh:20,activeExportKwh:2,demandKw:6}]);
 assert.equal(count,2);assert.equal((await osos.listReadings()).length,2);
 const weekly=await osos.generateWeeklyReport('2026-10-19T00:00:00Z');assert.equal(weekly.totalImportKwh,30);assert.equal(weekly.peakDemandKw,6);
 const daily=await osos.generateDailySummary('2026-10-20T12:00:00Z');assert.equal(daily.totalReadings,1);assert.equal(daily.totalImportKwh,10);
 assert.equal((await osos.listWeeklyReports()).length,1);assert.equal((await osos.listDailySummaries()).length,1);
});
test('Saha writes fail visibly rather than reporting success after server failure',async()=>{
 const f=fixture(),tasks=f.load('tasks'),smart=f.load('smartQuote');f.fail();
 await assert.rejects(tasks.saveTask({title:'Must not save',status:'todo'}),/Synthetic server unavailable/);
 await assert.rejects(smart.createSurvey('Synthetic','Must not save'),/Synthetic server unavailable/);
 assert.equal(f.values.size,0);
});
test('Recurring generation uses one atomic server RPC and returns only persisted work orders',async()=>{
 const f=fixture(),recurring=f.load('recurringTasks');const orders=await recurring.runDueTemplates();
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'run_due_templates');assert.equal(orders[0].id,'RT-SYNTHETIC');
 assert.equal(f.values.size,0);
});
test('Existing staff MFA cannot be replaced by six-digit mock verification or fake backups',async()=>{
 const f=fixture(),security=f.load('security');assert.equal((await security.getTwoFactorSettings()).enabled,true);
 await assert.rejects(security.confirmTwoFactor('123456'),/çalışan girişinde/);
 await assert.rejects(security.disableTwoFactor(),/kapatılamaz/);await assert.rejects(security.createBackup(),/Yedek oluşturulmadı/);
 assert.equal(f.values.size,0);assert.equal(security.validateIpRule('999.1.1.1'),false);assert.equal(security.validateIpRule('10.0.0.1/33'),false);assert.equal(security.validateIpRule('10.0.0.1/24'),true);
});
test('Stored platform records are listed without introducing synthetic companies',async()=>{
 const f=fixture(),platform=f.load('platform');assert.equal((await platform.listTenants()).length,0);
 const saved=await platform.saveTenant({name:'Synthetic isolated tenant'});assert.equal((await platform.listTenants())[0].id,saved.id);
});
test('Private attachment uploads return gated URLs and never fetch external file URLs',async()=>{
 const f=fixture(),photo=f.load('photoUpload');const url=await photo.uploadAttachment('blob:synthetic-attachment','tasks/synthetic','Synthetic.txt');
 assert.match(url,/^\/api\/saha-asset\.php/);assert.equal(f.uploads.length,1);
 await assert.rejects(photo.uploadAttachment('https://external.invalid/private.pdf','tasks/synthetic','private.pdf'),/Dış bağlantı/);assert.equal(f.fetches(),1);
});

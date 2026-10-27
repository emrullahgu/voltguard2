'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let ts;try{ts=require('../saha-app/node_modules/typescript');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;ts=require('typescript');}
const root=path.resolve(__dirname,'../saha-app/src');
function load(file,stubs){const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(!(name in stubs))throw Error('Unexpected dependency '+name);return stubs[name];},console,Date,Number,Error,Promise,Map,Set,Math,Object,Array,JSON});return module.exports;}
function fixture(table,file){
 let row=null,revision=0,rejectWrite=false,rejectRead=false;const cache=new Map(),calls=[];let cacheWrites=0;
 const storage={getItem:async key=>cache.get(key)||null,setItem:async(key,value)=>{cacheWrites++;cache.set(key,value);}};
 const api={onPortalReset:()=>{},reportPortalError:e=>e,portalRpc:async(name,args)=>{
  assert.equal(name,'app_saha_query');assert.equal(args.table,table);calls.push(args);
  if(args.operation==='select'){if(rejectRead)throw Error('Synthetic server read failure');return {data:row?[{...row}]:[],versions:row?{[row.id]:revision}:{}};}
  if(rejectWrite)throw Object.assign(Error('Synthetic rejected write'),{status:409});
  if(args.operation==='insert'){row={...args.rows[0],id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',created_at:'2026-10-27T10:00:00Z',updated_at:'2026-10-27T10:00:00Z'};revision=1;}
  else{
   if(!row||args.versions[row.id]!==revision)throw Object.assign(Error('Synthetic stale revision'),{status:409});
   if(args.operation==='delete'){const deleted=row;row=null;return {data:[{id:deleted.id}],versions:{}};}
   row={...row,...args.rows};revision++;
  }
  return {data:{...row},versions:{[row.id]:revision}};
 }};
 const native=load('portal/nativeClient.ts',{'./api':api});
 const service=load('services/'+file,{'./supabase':native,'@react-native-async-storage/async-storage':storage,'./data/auditRepo':{auditRepo:{logCurrent:async()=>{}}}});
 return {service,cache,calls,cacheWrites:()=>cacheWrites,row:()=>row,rejectWrite:value=>{rejectWrite=value;},rejectRead:value=>{rejectRead=value;},remoteEdit:()=>{row.notes='Other employee edit';revision++;}};
}
const cases=[
 {table:'assets',file:'assets.ts',create:'createAsset',list:'listAssets',update:'updateAsset',remove:'deleteAsset',input:{name:'Synthetic transformer',type:'transformer'},patch:{name:'Confirmed edit'}},
 {table:'energy_readings',file:'energyReadings.ts',create:'createReading',list:'listReadings',update:'updateReading',remove:'deleteReading',input:{kind:'meter',date:'2026-10-27',meterActiveKwh:10},patch:{meterActiveKwh:20}},
 {table:'sales_visits',file:'salesVisits.ts',create:'createVisit',list:'listVisits',update:'updateVisit',remove:'deleteVisit',input:{customerId:'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',customerName:'Synthetic',outcome:'opportunity'},patch:{summary:'Confirmed edit'}},
 {table:'form_responses',file:'formResponses.ts',create:'createResponse',list:'listResponses',update:'updateResponse',remove:'deleteResponse',input:{templateId:'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',templateName:'Synthetic',values:{a:'first'}},patch:{a:'confirmed'}},
];
for(const c of cases)test(c.table+': denied writes/read failures keep cache intact; confirmed saves survive reread and stale edits/deletes fail CAS',async()=>{
 const f=fixture(c.table,c.file),s=f.service;f.rejectWrite(true);
 await assert.rejects(s[c.create](c.input),e=>e.status===409);assert.equal(f.cacheWrites(),0);assert.equal(f.row(),null);
 f.rejectWrite(false);const created=await s[c.create](c.input);assert.equal(created.id,f.row().id);assert.ok(f.cacheWrites()>0);
 assert.equal((await s[c.list]())[0].id,created.id);f.remoteEdit();
 const snapshot=JSON.stringify([...f.cache]),before=f.calls.length;
 await assert.rejects(s[c.update](created.id,c.patch),e=>e.status===409);assert.equal(JSON.stringify([...f.cache]),snapshot);
 assert.equal(f.calls.length,before+1,'Mutation must not refresh away the form CAS revision');assert.equal(f.calls.at(-1).operation,'update');
 await s[c.list]();assert.ok(await s[c.update](created.id,c.patch));f.remoteEdit();
 const cacheBeforeDelete=JSON.stringify([...f.cache]);await assert.rejects(s[c.remove](created.id),e=>e.status===409);assert.ok(f.row());assert.equal(JSON.stringify([...f.cache]),cacheBeforeDelete);
 f.rejectRead(true);const writes=f.cacheWrites();await assert.rejects(s[c.list](),/Synthetic server read failure/);assert.equal(f.cacheWrites(),writes);assert.equal(JSON.stringify([...f.cache]),cacheBeforeDelete);
 f.rejectRead(false);await s[c.list]();await s[c.remove](created.id);assert.equal(f.row(),null);
});

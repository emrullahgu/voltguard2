'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let ts;try{ts=require('../saha-app/node_modules/typescript');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;ts=require('typescript');}
const root=path.resolve(__dirname,'../saha-app/src');
function load(file,stubs){const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(!(name in stubs))throw Error('Unexpected dependency '+name);return stubs[name];},console,Date,Number,Error,Promise,Map,Set,Math,Object,Array});return module.exports;}
function fixture(){
 let revision=1,row={id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',plate:'35 SYN 01',brand:'Original'},failRead=false,emptyDelete=false;
 const calls=[],api={onPortalReset:()=>{},reportPortalError:e=>e,portalRpc:async(name,args)=>{
  assert.equal(name,'app_saha_query');calls.push(args);
  if(args.operation==='select'){if(failRead)throw Error('Synthetic server offline');return {data:row?[{...row}]:[],versions:row?{[row.id]:revision}:{},tableVersions:{}};}
  if(!row||args.versions[row.id]!==revision)throw Object.assign(Error('Synthetic stale vehicle revision'),{status:409,code:'PT409'});
  if(args.operation==='upsert'){row={...row,...args.rows[0]};return {data:{...row},versions:{[row.id]:++revision},tableVersions:{}};}
  if(emptyDelete)return {data:[],versions:{},tableVersions:{}};
  const deleted=row;row=null;return {data:[{id:deleted.id}],versions:{},tableVersions:{}};
 }};
 const native=load('portal/nativeClient.ts',{'./api':api});
 const service=load('services/vehicles.ts',{'./supabase':native});
 return {service,calls,remoteEdit:()=>{row.brand='Other employee';revision++;},row:()=>row,offline:()=>{failRead=true;},emptyDelete:()=>{emptyDelete=true;}};
}
test('A stale vehicle form is rejected by real native CAS transport and does not overwrite another employee',async()=>{
 const f=fixture(),original=(await f.service.listVehicles())[0];f.remoteEdit();
 await assert.rejects(f.service.upsertVehicle({...original,brand:'Stale form'}),e=>e.status===409&&e.code==='PT409');
 assert.equal(f.row().brand,'Other employee');assert.equal(f.calls.length,2);assert.equal(f.calls[1].operation,'upsert');
 assert.equal(f.calls[1].versions[original.id],1,'Write keeps the revision originally loaded by the form');
 const latest=(await f.service.listVehicles())[0];const saved=await f.service.upsertVehicle({...latest,brand:'Confirmed edit'});assert.equal(saved.brand,'Confirmed edit');assert.equal(f.row().brand,'Confirmed edit');
});
test('Vehicle deletion propagates native CAS failure and cannot claim success for zero affected rows',async()=>{
 const f=fixture(),vehicle=(await f.service.listVehicles())[0];f.remoteEdit();
 await assert.rejects(f.service.deleteVehicle(vehicle.id),e=>e.status===409);assert.ok(f.row());assert.equal(f.calls.at(-1).operation,'delete');
 await f.service.listVehicles();f.emptyDelete();await assert.rejects(f.service.deleteVehicle(vehicle.id),/doğrulanamadı/);assert.ok(f.row());
});
test('Vehicle read failures remain errors instead of returning an empty or stale cached list',async()=>{
 const f=fixture();assert.equal((await f.service.listVehicles()).length,1);f.offline();
 await assert.rejects(f.service.listVehicles(),/Synthetic server offline/);assert.equal(f.row().plate,'35 SYN 01');
});

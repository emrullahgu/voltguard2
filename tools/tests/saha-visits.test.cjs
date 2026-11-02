'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let ts;try{ts=require('../saha-app/node_modules/typescript');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;ts=require('typescript');}
const root=path.resolve(__dirname,'../saha-app/src');
function load(file,stubs){const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(!(name in stubs))throw Error(name);return stubs[name];},console,Date,Number,Error,Promise});return module.exports;}
const visit={id:'synthetic-visit',user_id:'synthetic-owner',customer_id:'synthetic-customer',customer_name:'Synthetic customer',start_at:'2026-10-27T10:00:00Z',start_lat:38,start_lng:27,end_at:null,status:'active'};
const settled=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function provider(repo){
 const values=[],refs=[],effects=[],alerts=[];let cursor=0,refCursor=0,effectCursor=0,user={id:'synthetic-owner'},permission='granted';
 const react={createContext:()=>({Provider:'provider'}),createElement:(type,props)=>({type,props}),useState:initial=>{const i=cursor++;if(!(i in values))values[i]=initial;return [values[i],next=>{values[i]=typeof next==='function'?next(values[i]):next;}];},useRef:initial=>refs[refCursor++]||((refs[refCursor-1]={current:initial})),useContext:()=>{},useEffect:(fn,deps)=>{const i=effectCursor++,key=JSON.stringify(deps);if(effects[i]?.key!==key){effects[i]?.cleanup?.();effects[i]={key,fn};}}};
 const component=load('context/VisitContext.tsx',{'react':react,'expo-location':{Accuracy:{High:1},requestForegroundPermissionsAsync:async()=>({status:permission}),getCurrentPositionAsync:async()=>({coords:{latitude:38,longitude:27}})},'react-native':{Alert:{alert:(...args)=>alerts.push(args)}},'../services/data/visitsRepo':{visitsRepo:repo},'./AuthContext':{useAuth:()=>({user})}}).VisitProvider;
 const render=()=>{cursor=0;refCursor=0;effectCursor=0;const result=component({children:null}).props.value;for(const e of effects)if(e.fn){const fn=e.fn;e.fn=null;e.cleanup=fn();}return result;};
 return {render,alerts,user:id=>{user=id?{id}:null;},deny:()=>{permission='denied';}};
}
test('Visit state changes only after server acknowledgement; failed checkout keeps the persisted active visit',async()=>{
 let finishFails=true,resolveStart,startCalls=0;
 const f=provider({active:async()=>({visit:null,revision:0}),start:async()=>{startCalls++;return new Promise(resolve=>{resolveStart=resolve;});},finish:async()=>{if(finishFails)throw Error('Synthetic server refused checkout');return {visit:{...visit,status:'completed',end_at:'2026-10-27T11:00:00Z'},revision:2};}});
 f.render();await settled();let ctx=f.render();const saving=ctx.checkIn(visit.customer_id,'Untrusted display name');await settled();
 assert.equal(f.render().activeVisit,null);assert.equal(await f.render().checkIn(visit.customer_id,''),false);assert.equal(startCalls,1);
 resolveStart({visit,revision:1});assert.equal(await saving,true);ctx=f.render();assert.equal(ctx.activeVisit.id,visit.id);assert.equal(ctx.activeVisit.customerName,visit.customer_name);
 assert.equal(await ctx.checkOut('Synthetic note'),false);assert.equal(f.render().activeVisit.id,visit.id);assert.equal(f.alerts.some(a=>a[0]==='Başarılı'),false);
 finishFails=false;assert.equal(await f.render().checkOut(),true);assert.equal(f.render().activeVisit,null);assert.equal(f.alerts.at(-1)[0],'Başarılı');
});
test('Reload restores server visit; stale identity responses and denied location cannot start another visit',async()=>{
 let resolveOld,starts=0;const f=provider({active:()=>new Promise(resolve=>{resolveOld=resolve;}),start:async()=>{starts++;return {visit,revision:1};}});
 f.render();f.user(null);f.render();resolveOld({visit,revision:1});await settled();assert.equal(f.render().activeVisit,null);
 const restored=provider({active:async()=>({visit,revision:1}),start:async()=>{starts++;return {visit,revision:1};}});restored.render();await settled();assert.equal(restored.render().activeVisit.id,visit.id);
 restored.deny();assert.equal(await restored.render().checkIn(visit.customer_id,''),false);assert.equal(starts,0);
});
test('A rejected location check-in never enters cache or grants a recent-check-in gate',async()=>{
 const cache=new Map();let writes=0;
 const q={insert(){return q;},select(){return q;},single:async()=>({data:null,error:Error('Synthetic write refused')}),eq(){return q;},order(){return q;},limit(){return q;},then:resolve=>Promise.resolve({data:null,error:Error('Synthetic read refused')}).then(resolve)};
 const repo=load('services/data/checkinsRepo.ts',{'./repository':{supabase:{from:()=>q},cacheGet:async k=>cache.get(k),cacheSet:async(k,v)=>{writes++;cache.set(k,v);},newUuid:()=> 'synthetic-checkin'},'../../portal/api':{bootstrapPortal:async()=>({user:{id:'synthetic-owner'}})}}).checkinsRepo;
 await assert.rejects(repo.create({userId:'synthetic-owner',siteCode:'Synthetic',method:'manual'}),/Synthetic write refused/);assert.equal(writes,0);
 await assert.rejects(repo.hasRecentCheckin('synthetic-job'),/Synthetic read refused/);
 await assert.rejects(repo.create({userId:'forged-owner',siteCode:'Synthetic',method:'manual'}),/kendi çalışan/);
});

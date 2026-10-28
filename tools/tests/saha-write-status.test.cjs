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
 const source=fs.readFileSync(path.join(root,relative),'utf8');
 const code=ts.transpileModule(source,{fileName:relative,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,require:ref=>{if(ref in stubs)return stubs[ref];throw new Error('Unexpected dependency '+ref);},console,Date,Math,Map,Set,JSON,Object,Array,Error,Promise,TextEncoder,AbortController,setTimeout,clearTimeout,...globals},{filename:relative});
 return module.exports;
}
function transportFixture(){
 const notices=[],calls=[];let next=async()=>({api:'vg-company/1',ok:true,data:{saved:true}});
 const child={location:{origin:'https://synthetic.invalid'},top:{location:{replace:()=>{}}},dispatchEvent:()=>{},addEventListener:()=>{}};
 const fetch=async(url,options)=>{
  calls.push({url,options});
  if(url.includes('action=saha_bootstrap'))return {ok:true,status:200,json:async()=>({api:'vg-company/1',ok:true,csrf:'a'.repeat(64),data:{user:{id:'synthetic-staff'},profile:{id:'synthetic-staff',approval_status:'approved'},capabilities:{dataSource:'ubuntu'}}})};
  const payload=await next();return {ok:payload.ok,status:payload.status||200,json:async()=>payload};
 };
 const api=load('portal/api.ts',{'./networkPolicy':{scopedFetch:fetch},'./moduleHostBridge':{emitModuleEvent:(type,fields)=>notices.push({...fields,type})}}, {window:child,CustomEvent:class{constructor(type,args){this.type=type;this.detail=args?.detail;}}});
 return {api,notices,calls,setNext:fn=>{next=fn;}};
}
const mutation=api=>api.portalRpc('app_saha_query',{operation:'insert',table:'synthetic',payload:{label:'Synthetic isolated record'}});
function heldTransport(f){
 let complete,enter;
 const entered=new Promise(resolve=>{enter=resolve;});
 f.setNext(()=>new Promise(resolve=>{complete=resolve;enter();}));
 return {
  async wait(running){
   let timer;
   try{
    await Promise.race([entered,running.then(()=>{throw new Error('Request completed before entering the held transport');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Held transport was not entered within 10 seconds')),10000);})]);
    assert.equal(typeof complete,'function','The real transport must be entered before asserting an in-flight counter');
   }finally{clearTimeout(timer);}
  },
  release(){assert.equal(typeof complete,'function');complete({api:'vg-company/1',ok:true,data:{}});},
 };
}

test('Rejected validation and unsupported requests finish cleanly without trapping later work',async()=>{
 const f=transportFixture();
 for(const status of [400,403]){
  f.setNext(async()=>({api:'vg-company/1',ok:false,status,error:'synthetic_rejection',message:'Synthetic rejected request'}));
  await assert.rejects(mutation(f.api),/Synthetic rejected/);
  assert.equal(f.api.getPendingWrites(),0);assert.equal(f.api.getWriteStatus().outcome,'rejected');
  assert.equal(f.api.clearWriteFailure(),true);assert.equal(f.api.getWriteStatus().error,null);
 }
 f.setNext(async()=>({api:'vg-company/1',ok:true,data:{saved:true}}));
 assert.equal((await mutation(f.api)).saved,true);
 assert.equal(f.calls.filter(c=>c.url.includes('action=rpc')).length,3);
});
test('Actual in-flight writes still prevent logout and cannot be dismissed early',async()=>{
 const f=transportFixture();await f.api.bootstrapPortal();
 let complete;f.setNext(()=>new Promise(resolve=>{complete=resolve;}));
 const running=mutation(f.api);
 await Promise.resolve();await Promise.resolve();
 assert.equal(f.api.getPendingWrites(),1);assert.equal(f.api.clearWriteFailure(),false);
 await assert.rejects(f.api.logoutPortal(),/tamamlanana kadar/);
 assert.equal(f.calls.some(c=>c.url.includes('logout')),false);
 complete({api:'vg-company/1',ok:true,data:{saved:true}});await running;
 assert.equal(f.api.getPendingWrites(),0);assert.equal(f.api.clearWriteFailure(),true);
});
test('Only known usage telemetry and visit_active reads are excluded from the business pending guard',async()=>{
 const f=transportFixture();await f.api.bootstrapPortal();
 const requests=[['app_saha_cache',{key:'app_usage_buffer_v1',operation:'get'}],['app_saha_cache',{key:'app_usage_buffer_v1',operation:'set',value:'{}'}],['app_saha_rpc',{name:'bump_app_usage',args:{}}],['app_saha_rpc',{name:'visit_active',args:{}}]];
 for(const [name,args]of requests){
  const held=heldTransport(f),running=f.api.portalRpc(name,args);await held.wait(running);
  try{assert.equal(f.api.getPendingWrites(),0,name+'/'+(args.operation||args.name));}finally{held.release();await running;}
 }
 for(const name of ['run_due_templates','visit_check_in','visit_check_out']){
  const held=heldTransport(f),running=f.api.portalRpc('app_saha_rpc',{name,args:{}});await held.wait(running);
  try{assert.equal(f.api.getPendingWrites(),1,name);}finally{held.release();await running;}
 }
});
test('Failed telemetry stays quiet through private storage; visit_active and business errors remain visible',async()=>{
 const f=transportFixture();await f.api.bootstrapPortal();f.setNext(async()=>({api:'vg-company/1',ok:false,status:503,message:'Synthetic telemetry unavailable'}));
 const storage=load('portal/privateStorage.ts',{'./api':f.api});
 await assert.rejects(storage.default.setItem('app_usage_buffer_v1','{}'),/Synthetic telemetry unavailable/);
 await assert.rejects(f.api.portalRpc('app_saha_rpc',{name:'bump_app_usage',args:{}}),/Synthetic telemetry unavailable/);
 assert.equal(f.api.getPendingWrites(),0);assert.equal(f.api.getWriteStatus().error,null);assert.equal(f.notices.length,0);
 await assert.rejects(f.api.portalRpc('app_saha_rpc',{name:'visit_active',args:{}}),/Synthetic telemetry unavailable/);
 assert.ok(f.notices.some(event=>event.type==='vg:saha-notice'));assert.equal(f.api.getWriteStatus().error,null);
 await assert.rejects(mutation(f.api),/Synthetic telemetry unavailable/);assert.match(f.api.getWriteStatus().error,/Synthetic telemetry unavailable/);
});
test('Timed-out responses are marked uncertain and never claim the write was not committed',async()=>{
 const f=transportFixture();f.setNext(async()=>{throw Object.assign(new Error('Synthetic abort'),{name:'AbortError'});});
 await assert.rejects(mutation(f.api),/sonucu doğrulanamadı/);
 assert.equal(f.api.getPendingWrites(),0);assert.equal(f.api.getWriteStatus().outcome,'unknown');
 assert.doesNotMatch(f.api.getWriteStatus().error,/İşlem kaydedilmedi/);
 assert.equal(f.calls.filter(c=>c.url.includes('action=rpc')).length,1);
 assert.equal(f.api.clearWriteFailure(),true);
});
test('Private storage keeps committed memory after a rejected write without retaining a replay queue',async()=>{
 const values=new Map([['synthetic-key','committed']]);let sets=0;const failures=[];
 const api={bootstrapPortal:async()=>({user:{id:'synthetic-staff'},cache:{'synthetic-key':'committed'},capabilities:{}}),onPortalReset:()=>()=>{},reportPortalError:e=>e,reportWriteFailure:(e,outcome)=>failures.push({error:e,outcome}),portalRpc:async(_name,args)=>{
  if(args.operation==='set'){sets++;throw Object.assign(new Error('Synthetic forbidden write'),{status:403});}
  return {value:values.get(args.key)||null};
 }};
 const storage=load('portal/privateStorage.ts',{'./api':api}).default;
 await assert.rejects(storage.setItem('synthetic-key','must not be cached'),/Synthetic forbidden/);
 assert.equal(await storage.getItem('synthetic-key'),'committed');assert.equal(sets,1);
 assert.equal(failures[0].error.status,403);
});
test('The native employee host blocks active writes and releases its notice after controller completion',async()=>{
 const handlers=new Map(),states=[],refs=[],effects=[];let stateIndex=0,refIndex=0,effectIndex=0,onEvent;
 const controller={canGoBack:()=>false,setRoute:()=>{},clearWriteFailure:()=>{},unmount:()=>{}};
 const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useRef:initial=>{
  const index=refIndex++;if(!refs[index])refs[index]={current:index===0?{}:initial};return refs[index];
 },useState:initial=>{const index=stateIndex++;if(!(index in states))states[index]=initial;return [states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];},useEffect:(effect,deps)=>{const index=effectIndex++,previous=effects[index];if(!previous||deps.some((value,i)=>value!==previous[i])){effects[index]=deps;effect();}}};
 const window={addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:()=>{}};
 const runtime={mount:async(host,options)=>{assert.equal(host,refs[0].current);assert.equal(options.route,'Customers');onEvent=options.onEvent;return controller;}};
 const Wrapper=load('../../staff-app/src/EmployeeModule.jsx',{'react':react,'./employeeRuntime':{loadEmployeeRuntime:async()=>({runtime,styles:[]})}},{window,document:{documentElement:{dataset:{theme:'light'}}}}).default;
 const render=refreshKey=>{stateIndex=0;refIndex=0;effectIndex=0;return Wrapper({route:'Customers',title:'Müşteriler',refreshKey});};
 render(0);
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.equal(typeof onEvent,'function');assert.equal(handlers.has('message'),false,'window messages cannot forge native controller events');
 const receive=data=>onEvent({type:'vg:saha-storage',...data});
 const leave=()=>{const event={defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};handlers.get('vg:before-module-change')(event);return event.defaultPrevented;};
 receive({pending:1,error:'Previous synthetic failure',outcome:'rejected'});assert.equal(leave(),true);assert.match(states[1],/sunucuya yazılıyor/);render(1);assert.equal(states.at(-1),0,'Parent refresh cannot unmount an in-flight write');
 receive({pending:0,error:'Synthetic validation failed',outcome:'rejected'});assert.equal(states[1],'','The saving notice clears when the active request ends');assert.equal(leave(),false);render(2);assert.equal(states.at(-1),1,'Parent refresh remounts the native runtime after completion');
 receive({pending:0,error:'Synthetic timeout',outcome:'unknown'});assert.equal(leave(),false);
});
test('Central theme matches site navy/amber and legacy white-label controls retain readable contrast',()=>{
 const theme=load('theme.ts');
 const hook=load('themeMode.ts',{'react':{},'react-native':{},'@react-native-async-storage/async-storage':{},'./theme':theme});
 const site=fs.readFileSync(path.resolve(__dirname,'../staff-app/src/site-theme.css'),'utf8');
 assert.ok(site.includes('--portal-navy:'+theme.brand.blue));assert.ok(site.includes('--portal-amber:'+theme.brand.amber));
 assert.equal(hook.getPalette('dark').bg.primary,theme.getThemeTokens('dark').bg.primary);
 assert.equal(hook.getPalette('light').bg.primary,theme.getThemeTokens('light').bg.primary);
 const luminance=hex=>{const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;};
 const contrast=(a,b)=>{const values=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (values[0]+0.05)/(values[1]+0.05);};
 assert.ok(contrast('#ffffff',theme.brand.green)>=4.5);
 assert.ok(contrast(theme.brand.amber,theme.brand.onAmber)>=4.5);
 assert.ok(contrast('#ffffff',theme.getThemeTokens('light').text.faint)>=4.5);
});
test('Embedded module colors inherit live site CSS variables while standalone theme tokens remain plain colors',()=>{
 const plain=load('theme.ts');
 const embedded=load('theme.ts',{}, {window:{VoltGuardEmployeeModules:{version:1}}});
 for(const mode of ['light','dark'])for(const group of ['bg','text','border'])for(const [name,value] of Object.entries(plain.getThemeTokens(mode)[group])){
  assert.equal(plain.getDisplayTokens(mode)[group][name],value,'standalone output keeps the original color');
  const displayed=embedded.getDisplayTokens(mode)[group][name];assert.ok(displayed.startsWith('var(--vg-module-'+group+'-'+name+', '));assert.match(displayed,/, #[a-f0-9]{6}\)$/);
 }
 assert.match(embedded.colors.bg.primary,/^var\(--vg-module-bg-primary,/);
 assert.match(embedded.colors.text.primary,/^var\(--vg-module-text-primary,/);
 const css=fs.readFileSync(path.resolve(__dirname,'../staff-app/src/site-theme.css'),'utf8');
 for(const mode of ['light','dark'])for(const group of ['bg','text','border'])for(const name of Object.keys(plain.getThemeTokens(mode)[group]))assert.ok(css.includes('--vg-module-'+group+'-'+name+':'+plain.getThemeTokens(mode)[group][name]),'host defines '+mode+' '+group+'.'+name);
});

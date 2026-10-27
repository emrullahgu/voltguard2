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
 const child={location:{origin:'https://synthetic.invalid'},parent:{postMessage:message=>notices.push(message)},top:{location:{replace:()=>{}}},dispatchEvent:()=>{},addEventListener:()=>{}};
 const api=load('portal/api.ts',{}, {window:child,CustomEvent:class{constructor(type,args){this.type=type;this.detail=args?.detail;}},fetch:async(url,options)=>{
  calls.push({url,options});
  if(url.includes('action=saha_bootstrap'))return {ok:true,status:200,json:async()=>({api:'vg-company/1',ok:true,csrf:'a'.repeat(64),data:{user:{id:'synthetic-staff'},profile:{id:'synthetic-staff',approval_status:'approved'},capabilities:{}}})};
  const payload=await next();return {ok:payload.ok,status:payload.status||200,json:async()=>payload};
 }});
 return {api,notices,calls,setNext:fn=>{next=fn;}};
}
const mutation=api=>api.portalRpc('app_saha_query',{operation:'insert',table:'synthetic',payload:{label:'Synthetic isolated record'}});

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
test('The employee wrapper blocks only active writes and permits refresh/navigation after rejection',()=>{
 const handlers=new Map(),states=[],refs=[];let stateIndex=0,refIndex=0;
 const iframe={postMessage:()=>{}};
 const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useRef:initial=>{
  const ref={current:refIndex++===0?{contentWindow:iframe}:initial};refs.push(ref);return ref;
 },useState:initial=>{const index=stateIndex++;states[index]=initial;return [initial,value=>{states[index]=typeof value==='function'?value(states[index]):value;}];},useEffect:effect=>{effect();}};
 const location={origin:'https://synthetic.invalid',replace:()=>{}};
 const window={addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:()=>{}};
 const Wrapper=load('../../staff-app/src/SahaTakip.jsx',{'react':react,'lucide-react':{MapPin:()=>null,RefreshCw:()=>null,Maximize2:()=>null,Minimize2:()=>null}},{window,location,setTimeout:()=>1,clearTimeout:()=>{}}).default;
 const tree=Wrapper();
 const receive=data=>handlers.get('message')({origin:location.origin,source:iframe,data:{type:'vg:saha-storage',...data}});
 const leave=()=>{const event={defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};handlers.get('vg:before-module-change')(event);return event.defaultPrevented;};
 function findButton(node){if(!node||typeof node!=='object')return null;if(node.type==='button'&&node.props.children.includes(' Yenile'))return node;for(const child of node.props?.children||[]){const found=findButton(child);if(found)return found;}return null;}
 const refresh=findButton(tree);assert.ok(refresh);
 receive({pending:1,error:'Previous synthetic failure',outcome:'rejected'});assert.equal(leave(),true);refresh.props.onClick();assert.equal(states[1],0);
 receive({pending:0,error:'Synthetic validation failed',outcome:'rejected'});assert.equal(leave(),false);refresh.props.onClick();assert.equal(states[1],1);
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

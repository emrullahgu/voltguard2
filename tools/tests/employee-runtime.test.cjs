'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const crypto=require('node:crypto');
let ts;try{ts=require('../saha-app/node_modules/typescript');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;ts=require('typescript');}
const source=path.resolve(__dirname,'../saha-app');
function evaluate(file,requireModule,globals={}){
 const code=ts.transpileModule(fs.readFileSync(path.join(source,file),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 const module={exports:{}},scope={module,exports:module.exports,require:requireModule,console,URL,Promise,Map,Set,Array,Object,Error,Date,queueMicrotask,setTimeout,clearTimeout,...globals};
 vm.runInNewContext(code,scope,{filename:file});return {exports:module.exports,scope};
}
function fixture({role='engineer',externalAI=false}={}){
 const calls={register:0,mount:0,unmount:0,fonts:0,routes:[],events:[]};let pending=0,listener,hostCallback;
 const react={createElement:(type,props)=>({type,props})};
 const api={bootstrapPortal:async()=>({user:{id:'synthetic-native-staff'},profile:{id:'synthetic-native-staff',role,approval_status:'approved'},capabilities:{externalAI}}),clearPortalMemory:()=>{},getPendingWrites:()=>pending,getWriteStatus:()=>({pending,error:null}),clearWriteFailure:()=>pending===0,postParent:(type,fields)=>hostCallback?.({type,...fields})};
 const native={AppRegistry:{registerComponent:()=>{calls.register++;},runApplication:(_key,options)=>{calls.mount++;calls.root=options.rootTag;calls.initial=options.initialProps;return {unmount:()=>{calls.unmount++;}};}}};
 const navigation={normalizeModuleRoute:name=>name==='MainTabs'?'WorkOrders':name==='OfficeHub'?'Office':name,setModuleRoute:(route,params)=>{calls.routes.push({route,params});},navigationRef:{isReady:()=>true,canGoBack:()=>false},goBackInModule:()=>{}};
 const gate=evaluate('src/portal/moduleEntryGate.ts',name=>{if(name==='../../../employee-modules.json')return JSON.parse(fs.readFileSync(path.resolve(__dirname,'../employee-modules.json'),'utf8'));throw new Error('Unexpected gate dependency '+name);}).exports;
 const bridge={connectModuleHost:(_node,onEvent)=>{hostCallback=onEvent;return()=>{hostCallback=null;};},subscribeModuleEvents:callback=>{listener=callback;return()=>{listener=null;};}};
 const shadow={children:[],appendChild(node){this.children.push(node);node.parent=this;if(node.tag==='link')queueMicrotask(()=>{node.sheet={};node.listeners.load?.();});},querySelectorAll(){return this.children.filter(n=>n.tag==='link');}};
 const document={documentElement:{dataset:{theme:'dark'}},createElement:tag=>({tag,dataset:{},listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}}),getElementById(){throw new Error('Parent root must never be queried');}};
 const host={nodeType:1,isConnected:true,shadowRoot:null,attachShadow(){this.shadowRoot=shadow;return shadow;}};
 const window={location:{origin:'https://synthetic.invalid'}};
 const runtime=evaluate('index.js',name=>{
  if(name==='expo'||name==='./portal.css')return {};
  if(name==='react')return react;if(name==='react-native')return native;
  if(name==='expo-font')return {loadAsync:async()=>{calls.fonts++;}};
  if(name==='./src/portal/api')return api;if(name==='./src/portal/moduleHostBridge')return bridge;
  if(name==='./src/portal/moduleEntryGate')return gate;
  if(name==='./src/navigation')return navigation;if(name==='./App')return {default:()=>null};
  if(name.endsWith('.woff2'))return 'synthetic-font';throw new Error('Unexpected dependency '+name);
 },{document,window});
 return {runtime:window.VoltGuardEmployeeModules,scope:runtime.scope,host,calls,setPending:value=>{pending=value;},settled:()=>listener?.({type:'vg:saha-storage',pending:0})};
}

test('Protected runtime registers without automount and mounts only into the supplied ShadowRoot',async()=>{
 const f=fixture();assert.equal(f.calls.register,1);assert.equal(f.calls.mount,0);assert.equal(f.calls.fonts,0);
 const controller=await f.runtime.mount(f.host,{route:'Customers',styles:['/calisan/uygulama/assets/saha/portal.css'],theme:'light',onEvent:e=>f.calls.events.push(e)});
 assert.equal(f.calls.mount,1);assert.equal(f.calls.root.parent,f.host.shadowRoot);assert.equal(f.calls.initial.initialRoute,'Customers');assert.equal(f.scope.__SAHATAKIP_THEME__,'light');
 controller.setRoute('Quotes',{synthetic:true});assert.equal(f.calls.routes[0].route,'Quotes');
 assert.equal(controller.unmount(),true);assert.equal(f.calls.unmount,1);
});
test('Unmount defers until a real in-flight write settles and calls the returned React root',async()=>{
 const f=fixture(),controller=await f.runtime.mount(f.host,{route:'WorkOrders'});
 f.setPending(1);assert.equal(controller.unmount(),false);assert.equal(f.calls.unmount,0);
 f.setPending(0);f.settled();await Promise.resolve();assert.equal(f.calls.unmount,1);
 assert.equal(controller.unmount(),true);assert.equal(f.calls.unmount,1);
});
test('Detached hosts and external style URLs never start a React root',async()=>{
 const f=fixture();f.host.isConnected=false;await assert.rejects(f.runtime.mount(f.host,{route:'Customers'}),/kapatıldı/);assert.equal(f.calls.mount,0);
 f.host.isConnected=true;await assert.rejects(f.runtime.mount(f.host,{styles:['https://external.invalid/injected.css']}),/doğrulanamadı/);assert.equal(f.calls.mount,0);
});
test('Public mount/setRoute enforce the catalogue role and capability gate before opening an entry',async()=>{
 const employee=fixture();await assert.rejects(employee.runtime.mount(employee.host,{route:'Employees'}),/erişiminiz/);assert.equal(employee.calls.mount,0);
 const admin=fixture({role:'admin'});await assert.rejects(admin.runtime.mount(admin.host,{route:'AiHub'}),/servis bağlantısı/);assert.equal(admin.calls.mount,0);
 const controller=await employee.runtime.mount(employee.host,{route:'WorkOrders'});
 assert.throws(()=>controller.setRoute('GovernanceHub'),/erişiminiz/);assert.throws(()=>controller.navigate('CustomerForm'),/doğrudan açılabilen/);assert.equal(employee.calls.routes.length,0);controller.unmount();
 const payroll=fixture({role:'manager'}),allowed=await payroll.runtime.mount(payroll.host,{route:'Employees'});assert.equal(payroll.calls.mount,1);allowed.unmount();
 const configured=fixture({role:'admin',externalAI:true}),ai=await configured.runtime.mount(configured.host,{route:'AiHub'});assert.equal(configured.calls.mount,1);ai.unmount();
});
test('Source-scoped requests deny external destinations without replacing host browser APIs',async()=>{
 const calls=[];const fetch=async(input,init)=>{calls.push({input,init});return {ok:true};};
 class XHR {open(...args){this.args=args;}}
 const window={location:{origin:'https://synthetic.invalid'},fetch,XMLHttpRequest:XHR,WebSocket:function HostWebSocket(){}};
 const {exports:policy}=evaluate('src/portal/networkPolicy.ts',()=>{}, {fetch,window,XMLHttpRequest:XHR});
 assert.equal(window.fetch,fetch);assert.equal(window.XMLHttpRequest,XHR);assert.equal(window.WebSocket.name,'HostWebSocket');
 await policy.scopedFetch('/api/company.php?action=rpc');assert.equal(calls[0].init.credentials,'same-origin');
 await assert.rejects(policy.scopedFetch('https://external.invalid/private'),/İstek gönderilmedi/);assert.equal(calls.length,1);
 const request=new policy.ScopedXMLHttpRequest();assert.throws(()=>request.open('GET','https://external.invalid/private'),/İstek gönderilmedi/);request.open('GET','/api/saha-asset.php?synthetic');
 assert.throws(()=>new policy.ScopedWebSocket('wss://external.invalid'),/Harici bağlantı kurulmadı/);
});
test('Every catalogue native route resolves in the flat navigator without the old app landing',()=>{
 let pending=0;const resets=[];
 const nav=evaluate('src/navigation/index.tsx',name=>{
  if(name==='react')return {};
  if(name==='react-native')return {};
  if(name==='react-native-safe-area-context'||name==='@expo/vector-icons')return {};
  if(name==='@react-navigation/native')return {createNavigationContainerRef:()=>({isReady:()=>true,resetRoot:value=>resets.push(value)})};
  if(name==='@react-navigation/native-stack')return {createNativeStackNavigator:()=>({})};
  if(name==='../theme')return {};
  if(name==='../context/AuthContext')return {};
  if(name==='../portal/api')return {getPendingWrites:()=>pending};
  if(name==='../portal/moduleHostBridge'||name==='../services/usageTracker')return {};
  if(name.startsWith('../screens/')||name.startsWith('../components/'))return {default:()=>null};
  throw new Error('Unexpected navigation dependency '+name);
 }).exports;
 const catalogue=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../employee-modules.json'),'utf8'));
 for(const module of catalogue.modules)for(const variant of module.variants)if(variant.route)assert.doesNotThrow(()=>nav.normalizeModuleRoute(variant.route),module.id+'/'+variant.id);
 assert.equal(nav.normalizeModuleRoute('MainTabs'),'WorkOrders');assert.equal(nav.normalizeModuleRoute('Dashboard'),'KpiOverview');assert.equal(nav.normalizeModuleRoute('Employees'),'Employees');
 nav.setModuleRoute('Customers');assert.equal(resets[0].routes[0].name,'Customers');
 pending=1;assert.throws(()=>nav.setModuleRoute('Quotes'),/tamamlandıktan sonra/);
});
test('Responsive module dimensions follow the host and resize without changing window dimensions',()=>{
 let width=1200,height=640,value,resize,cleanup,disconnected=false;
 const node={getBoundingClientRect:()=>({width,height})};
 const window={innerWidth:1440,innerHeight:900,devicePixelRatio:2,addEventListener:()=>{},removeEventListener:()=>{}};
 const react={useState:initial=>{value=initial();return [value,updater=>{value=updater(value);}];},useEffect:effect=>{cleanup=effect();}};
 class Observer{constructor(callback){resize=callback;}observe(target){assert.equal(target,node);}disconnect(){disconnected=true;}}
 const dimensions=evaluate('src/portal/moduleDimensions.ts',name=>name==='react'?react:{getModuleRoot:()=>node},{window,ResizeObserver:Observer}).exports;
 assert.equal(dimensions.getModuleDimensions().width,1200);dimensions.useModuleDimensions();
 width=366;height=630;resize();assert.equal(value.width,366);assert.equal(value.height,630);assert.equal(window.innerWidth,1440);
 cleanup();assert.equal(disconnected,true);
});
let babel;
try{babel=require('../saha-app/node_modules/@babel/core');}
catch(error){
 if(error.code!=='MODULE_NOT_FOUND'||!error.message.includes("'../saha-app/node_modules/@babel/core'"))throw error;
 babel=require('@babel/core'); // Mandatory pinned compiler in the offline CI image.
}
test('Build transform scopes only unbound requests in imported module source',()=>{
 const plugin=require('../saha-app/src/portal/scopedNetworkPlugin.cjs');
 const compile=(code,filename)=>babel.transformSync(code,{filename,configFile:false,babelrc:false,plugins:[plugin]}).code;
 const own=compile('fetch("/api/company.php"); new XMLHttpRequest(); new WebSocket("wss://external.invalid");',path.join(source,'src/services/synthetic-policy.js'));
 assert.match(own,/scopedFetch/);assert.match(own,/ScopedXMLHttpRequest/);assert.match(own,/ScopedWebSocket/);
 assert.doesNotMatch(compile('fetch("/public");',path.resolve(__dirname,'../staff-app/src/synthetic-host.js')),/networkPolicy/);
 assert.doesNotMatch(compile('function local(fetch){ return fetch("/custom"); }',path.join(source,'src/services/synthetic-local.js')),/networkPolicy/);
 const responsive=compile('import { View, useWindowDimensions as size } from "react-native"; size();',path.join(source,'src/screens/synthetic-responsive.js'));
 assert.match(responsive,/useModuleDimensions as size/);assert.match(responsive,/moduleDimensions/);
 assert.doesNotMatch(compile('import { useWindowDimensions } from "react-native";',path.resolve(__dirname,'../staff-app/src/synthetic-host.js')),/moduleDimensions/);
});
test('Trusted CI runtime pins both mandatory compilers and protects manifest hashes',()=>{
 const ci=path.resolve(__dirname,'../ci');
 const manifest=fs.readFileSync(path.join(ci,'runtime/package.json'));
 const lock=fs.readFileSync(path.join(ci,'runtime/package-lock.json'));
 const dependencies=JSON.parse(manifest).dependencies,packages=JSON.parse(lock).packages;
 const sourcePackages=JSON.parse(fs.readFileSync(path.join(source,'package-lock.json'),'utf8')).packages;
 assert.equal(dependencies.typescript,'6.0.3');assert.equal(dependencies['@babel/core'],'7.29.0');
 for(const name of ['typescript','@babel/core']){
  assert.equal(packages['node_modules/'+name].version,sourcePackages['node_modules/'+name].version);
  assert.equal(packages['node_modules/'+name].integrity,sourcePackages['node_modules/'+name].integrity);
 }
 for(const [name,entry]of Object.entries(packages))if(name){assert.match(entry.resolved,/^https:\/\/registry\.npmjs\.org\//);assert.match(entry.integrity,/^sha512-/);}
 const dockerfile=fs.readFileSync(path.join(ci,'Dockerfile'),'utf8');
 for(const bytes of [manifest,lock])assert.ok(dockerfile.includes(crypto.createHash('sha256').update(bytes).digest('hex')));
 assert.match(dockerfile,/sha256sum -c -/);assert.match(dockerfile,/npm ci[^\n]*--ignore-scripts/);
});

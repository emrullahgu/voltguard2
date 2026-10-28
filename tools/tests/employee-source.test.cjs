'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let ts;try{ts=require('../saha-app/node_modules/typescript');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;ts=require('typescript');}
const root=path.resolve(__dirname,'../..');
function load(file,stubs={},globals={}){
 const module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(!(name in stubs))throw new Error('Unexpected dependency '+name);return stubs[name];},console,Promise,Map,Set,Array,Object,String,Error,AbortController,setTimeout,clearTimeout,...globals},{filename:file});
 return module.exports;
}
const policy=load('tools/staff-app/src/sourceConnection.js');
function nativeFixture(hostname,initialSource){
 let source=initialSource,redirects=0,requests=0;
 const window={location:{hostname},top:{location:{replace(){redirects++;}}},addEventListener(){},dispatchEvent(){}};
 const api=load('tools/saha-app/src/portal/api.ts',{
  './networkPolicy':{scopedFetch:async()=>{requests++;return {ok:true,json:async()=>({api:'vg-company/1',ok:true,csrf:'a'.repeat(64),data:{user:{id:'synthetic-native-user'},profile:{id:'synthetic-native-user',approval_status:'approved'},capabilities:{dataSource:source}}})};}},
  './moduleHostBridge':{emitModuleEvent(){}},
 },{window,CustomEvent:class{}});
 return {api,get requests(){return requests;},get redirects(){return redirects;},setSource(value){source=value;}};
}

test('Native production bootstrap rejects local or unknown sources without signing out, then permits a verified source retry',async()=>{
 const f=nativeFixture('voltguard.com.tr','local');
 await assert.rejects(f.api.bootstrapPortal(),error=>error.code==='company_source_unavailable');
 assert.equal(f.api.currentPortalIdentity(),null);assert.equal(f.redirects,0);
 f.setSource(undefined);await assert.rejects(f.api.bootstrapPortal(),error=>error.code==='company_source_unavailable');
 f.setSource('ubuntu');assert.equal((await f.api.bootstrapPortal()).capabilities.dataSource,'ubuntu');assert.equal(f.requests,3);
});

test('Local source is allowed only for explicit loopback development, never LAN or lookalike hostnames',async()=>{
 for(const hostname of ['localhost','127.0.0.1','::1','[::1]']){
  assert.equal((await nativeFixture(hostname,'local').api.bootstrapPortal()).capabilities.dataSource,'local');
  assert.equal(policy.employeeSourceStatus('local',hostname).development,true);
 }
 for(const hostname of ['localhost.attacker.test','192.168.1.10','voltguard2.netlify.app','']){
  await assert.rejects(nativeFixture(hostname,'local').api.bootstrapPortal(),error=>error.code==='company_source_unavailable');
  assert.equal(policy.employeeSourceStatus('local',hostname).available,false);
 }
 await assert.rejects(nativeFixture('localhost',undefined).api.bootstrapPortal(),error=>error.code==='company_source_unavailable');
 assert.equal(policy.employeeSourceStatus(undefined,'localhost').available,false);
});

test('Company source label distinguishes Ubuntu, development and missing Saha configuration without claiming health',()=>{
 assert.equal(policy.employeeSourceStatus('ubuntu','voltguard.com.tr').message,'');
 const unavailable=policy.employeeSourceStatus('local','voltguard.com.tr');
 assert.equal(unavailable.available,false);assert.match(unavailable.message,/Ubuntu/);assert.match(unavailable.message,/boş listeler/);
 const missing=policy.employeeSourceStatus('ubuntu','voltguard.com.tr',{required:true,configured:false,mode:'unconfigured',ready:null});
 assert.equal(missing.available,false);
 assert.equal(policy.employeeSourceStatus('ubuntu','voltguard.com.tr',{required:true,configured:true,ready:null}).available,true);
});

const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useRef:()=>({current:null}),useEffect(){}};
const allNodes=value=>Array.isArray(value)?value.flatMap(allNodes):value&&typeof value==='object'?[value,...allNodes(value.props?.children||[])]:[];
const content=value=>Array.isArray(value)?value.map(content).join(' '):value&&typeof value==='object'?content(value.props?.children||[]):String(value??'');
test('Portal navigation displays an accessible source warning while a disconnected dashboard cannot publish healthy zero counts',()=>{
 let capabilities={dataSource:'local'};
 const dependencies={react,'./supabaseClient':{getStaffCapabilities:()=>capabilities},'./sourceConnection':policy};
 const globals={window:{location:{hostname:'voltguard.com.tr'},matchMedia:()=>({matches:false})},document:{documentElement:{dataset:{theme:'light'}}}};
 const navigation=load('tools/staff-app/src/PortalNavigation.jsx',{
  ...dependencies,'./SimpleAuth':{useAuth:()=>({currentUser:{name:'Synthetic employee',role:'employee'},signOut:async()=>{}})},
  './employeeModules':{EMPLOYEE_MODULES:[],initialEmployeeModule:()=>'',employeeModuleURL:()=>''},
 },globals).default;
 const nodes=allNodes(navigation({}));
 assert.ok(nodes.some(node=>node.props.role==='alert'&&/Ubuntu/.test(content(node))));
 let summaryCalls=0;
 const dashboard=load('tools/staff-app/src/CompanyDashboard.jsx',{
  ...dependencies,'./dashboardSummary.mjs':{dashboardSummary(){summaryCalls++;throw new Error('Disconnected data must not reach healthy statistics');}},
 },globals).default;
 const unavailable=dashboard({});assert.equal(unavailable.props['data-company-source-unavailable'],'');assert.equal(summaryCalls,0);
 capabilities={dataSource:'ubuntu'};
 const connected=allNodes(navigation({}));assert.equal(connected.some(node=>node.props.role==='alert'),false);
 assert.ok(connected.some(node=>node.props.className==='portal-navigation__source'&&/şirket sunucusu/.test(content(node))));
});

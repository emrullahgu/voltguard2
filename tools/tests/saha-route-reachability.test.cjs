'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let ts;try{ts=require('../saha-app/node_modules/typescript');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;ts=require('typescript');}
const root=path.resolve(__dirname,'../..');
const catalogue=JSON.parse(fs.readFileSync(path.join(root,'tools/employee-modules.json'),'utf8'));
function load(file,requireModule){
 const module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:requireModule,console,URLSearchParams,window:{location:{search:''}}},{filename:file});return module.exports;
}
const navigation=load('tools/saha-app/src/navigation/index.tsx',name=>{
 if(name==='react'||name==='react-native'||name==='react-native-safe-area-context'||name==='@expo/vector-icons'||name==='../theme'||name==='../context/AuthContext'||name==='../portal/api'||name==='../portal/moduleHostBridge'||name==='../services/usageTracker')return {};
 if(name==='@react-navigation/native')return {createNavigationContainerRef:()=>({})};
 if(name==='@react-navigation/native-stack')return {createNativeStackNavigator:()=>({})};
 if(name.startsWith('../screens/')||name.startsWith('../components/'))return {default:()=>null};
 throw Error('Unexpected navigator dependency: '+name);
});
const normalize=navigation.normalizeModuleRoute;
const gate=load('tools/saha-app/src/portal/moduleEntryGate.ts',name=>{
 if(name==='../../../employee-modules.json')return catalogue;throw Error('Unexpected gate dependency: '+name);
}).assertModuleEntry;
const menu=load('tools/staff-app/src/employeeModules.js',name=>{
 if(name==='../../employee-modules.json')return catalogue;
 if(name==='./supabaseClient')return {getStaffCapabilities:()=>({externalAI:false})};
 throw Error('Unexpected menu dependency: '+name);
});
const identity=role=>({user:{id:'qa-route-user'},profile:{id:'qa-route-user',role,approval_status:'approved'},capabilities:{externalAI:false}});
const entries=new Set(catalogue.modules.flatMap(module=>module.variants.filter(v=>v.route).map(v=>normalize(v.route))));

test('Every registered internal/detail route rejects a forged direct public entry for all employee roles',()=>{
 const internal=[...new Set(navigation.moduleRouteNames.map(normalize))].filter(route=>!entries.has(route));
 assert.ok(internal.length>400,'Exercise the full imported detail-route surface, not a representative sample');
 for(const role of ['admin','manager','engineer'])for(const route of internal)assert.throws(()=>gate(route,identity(role),normalize),/doğrudan açılabilen/,role+'/'+route);
});

test('The actual menu and native entry gate agree for every catalogue entry and role',()=>{
 for(const [staffRole,nativeRole]of [['admin','admin'],['payroll','manager'],['employee','engineer']]){
  const user={id:'qa-route-user',approved:true,role:staffRole};
  for(const module of catalogue.modules)for(const variant of module.variants)if(variant.route){
   const visible=menu.availableModules(user).some(m=>m.id===module.id)&&menu.moduleVariants(module,user).some(v=>v.id===variant.id);
   if(visible)assert.equal(gate(variant.route,identity(nativeRole),normalize),normalize(variant.route));
   else assert.throws(()=>gate(variant.route,identity(nativeRole),normalize),/erişiminiz veya gerekli servis/);
  }
 }
});

test('Disabled AI entries cannot be unlocked by truthy capability values or URL section names',()=>{
 const module=catalogue.modules.find(m=>m.id==='yapay-zeka');assert.equal(module.capability,'externalAI');
 for(const role of ['admin','manager','engineer'])for(const capability of [undefined,false,0,1,'true',{},[]]){
  const actor=identity(role);actor.capabilities.externalAI=capability;
  for(const variant of module.variants)assert.throws(()=>gate(variant.route,actor,normalize),/erişiminiz veya gerekli servis/);
 }
 const user={id:'qa-route-user',approved:true,role:'admin'};
 for(const variant of module.variants)assert.equal(menu.initialEmployeeModule(user,'?module=yapay-zeka&bolum='+variant.id),'uygulamalar');
});

test('Session identity mismatch and pending approval reject even otherwise public catalogue routes',()=>{
 for(const invalid of [null,{}, {...identity('admin'),user:{id:'different-user'}},{...identity('admin'),profile:{...identity('admin').profile,approval_status:'pending'}},identity('unknown-role')]){
  for(const route of ['WorkOrders','Customers','AiHub'])assert.throws(()=>gate(route,invalid,normalize),/Onaylanmış çalışan oturumu/);
 }
});

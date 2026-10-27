'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let ts;
try { ts=require('../saha-app/node_modules/typescript'); }
catch(error) {
 if(error.code!=='MODULE_NOT_FOUND'||!error.message.includes("'../saha-app/node_modules/typescript'"))throw error;
 ts=require('typescript');
}
const root=path.resolve(__dirname,'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'tools/employee-modules.json'),'utf8'));
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function helpers(capabilities={externalAI:false}) {
 const code=ts.transpileModule(read('tools/staff-app/src/employeeModules.js'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,URLSearchParams,window:{location:{search:''}},require:name=>{
  if(name==='../../employee-modules.json')return manifest;
  if(name==='./supabaseClient')return {getStaffCapabilities:()=>capabilities};
  throw Error('Unexpected module mapping dependency: '+name);
 }});
 return module.exports;
}
const user=role=>({id:'synthetic-native-employee',approved:true,role});

test('Employee module manifest covers each imported native hub through a parent domain',()=>{
 const ids=new Set(),nativeRoutes=new Set();
 assert.equal(manifest.modules.length,37);
 assert.equal(new Set(manifest.groups).size,manifest.groups.length);
 for(const module of manifest.modules){
  assert.match(module.id,/^[a-z][a-z0-9-]+$/);assert.ok(!ids.has(module.id),'duplicate employee domain');ids.add(module.id);
  assert.ok(module.label&&module.description);assert.ok(manifest.groups.includes(module.group));
  assert.ok(module.variants.length>0);const variants=new Set();
  for(const item of module.variants){
   assert.ok(!variants.has(item.id));variants.add(item.id);assert.ok(item.label);
   assert.notEqual(Boolean(item.route),Boolean(item.legacy),'variant selects one implementation');
   if(item.route){assert.match(item.route,/^[A-Z][A-Za-z0-9]+$/);nativeRoutes.add(item.route);}
   for(const role of item.roles||[])assert.ok(['employee','payroll','admin'].includes(role));
  }
  for(const role of module.roles||[])assert.ok(['employee','payroll','admin'].includes(role));
 }
 assert.equal(ids.has('saha-takip'),false,'old project is not a separate employee application');
 assert.ok(nativeRoutes.size>=60,'native route coverage must retain all imported work domains');
 const screens=fs.readdirSync(path.join(root,'tools/saha-app/src/screens')).filter(name=>name.endsWith('HubScreen.tsx')).map(name=>name.replace(/Screen\.tsx$/,''));
 assert.equal(screens.length,46);
 assert.deepEqual(screens.filter(name=>!nativeRoutes.has(name)),[],'each native hub is reachable from an employee domain');
 const stack=read('tools/saha-app/src/navigation/index.tsx');
 const registered=new Set([...stack.matchAll(/name=['"]([A-Za-z0-9]+)['"]/g)].map(match=>match[1]));
 for(const route of nativeRoutes)assert.ok(registered.has(route),'native route registered: '+route);
});

test('Employee domains and variants preserve role boundaries without hiding ordinary work modules',()=>{
 const h=helpers(),employee=user('employee'),admin=user('admin'),payroll=user('payroll');
 for(const actor of [employee,payroll,admin]){
  const domains=h.availableModules(actor).map(item=>item.id);
  for(const id of ['uygulamalar','musteriler','is-emirleri','gorev','bordro'])assert.ok(domains.includes(id),actor.role+' sees '+id);
  assert.equal(h.initialEmployeeModule(actor,''),'uygulamalar');
 }
 for(const id of ['admin','yonetim-araclari','ekip-takibi','finans','siparisler'])assert.equal(h.findEmployeeModule(id,employee),undefined,'employee cannot enter '+id);
 assert.ok(h.findEmployeeModule('ekip-takibi',payroll));assert.equal(h.findEmployeeModule('admin',payroll),undefined);
 assert.equal(h.initialEmployeeModule(employee,'?module=admin'),'uygulamalar');
 const customers=h.findEmployeeModule('musteriler',employee);
 assert.equal(h.selectedVariant(customers,employee,'?bolum=deneyim').id,'liste');
 assert.equal(h.selectedVariant(customers,employee,'?bolum=paylasim').id,'liste');
 assert.equal(h.moduleVariants(customers,employee).length,1);
 assert.equal(h.availableModules({...admin,approved:false}).length,0);
 assert.equal(h.availableModules(null).length,0);
});

test('Employee route links keep domain and selected section in one native portal URL',()=>{
 const h=helpers();
 const url=new URL(h.employeeModuleURL('musteriler','liste'),'https://synthetic.invalid');
 assert.equal(url.pathname,'/calisan/uygulama/');assert.equal(url.searchParams.get('module'),'musteriler');assert.equal(url.searchParams.get('bolum'),'liste');
 assert.equal(h.initialEmployeeModule(user('admin'),url.search),'musteriler');
 assert.equal(h.initialEmployeeModule(user('employee'),'?module=saha-takip'),'uygulamalar');
});

test('Unconfigured AI domains and direct links remain unavailable for every employee role',()=>{
 for(const capabilities of [{},{externalAI:false}]){
  const h=helpers(capabilities);
  for(const role of ['employee','payroll','admin']){
   assert.equal(h.findEmployeeModule('yapay-zeka',user(role)),undefined);
   assert.equal(h.initialEmployeeModule(user(role),'?module=yapay-zeka&bolum=asistan'),'uygulamalar');
  }
 }
 const h=helpers({externalAI:true});
 assert.equal(h.findEmployeeModule('yapay-zeka',user('admin')).id,'yapay-zeka');
});

test('Native employee host mounts in the existing DOM with one parent navigation',()=>{
 const host=read('tools/staff-app/src/EmployeeModule.jsx');
 assert.match(host,/data-employee-module-host/);assert.match(host,/runtime\.mount\(host\.current/);
 assert.match(host,/data-module-route=\{route\}/);assert.match(host,/controller\.current\.setRoute\(route\)/);
 assert.doesNotMatch(host,/<iframe\b|window\.addEventListener\(['"]message['"]|postMessage\(/);
 const home=read('tools/staff-app/src/EmployeeHome.jsx');
 assert.match(home,/data-employee-applications/);assert.match(home,/availableModules\(user\)/);
 assert.match(home,/type="search"/);assert.doesNotMatch(home,/SahaTakip.i aç|saha-launcher|<iframe\b/);
 assert.doesNotMatch(read('tools/staff-app/src/CompanyDashboard.jsx'),/SahaTakip|saha-launcher|<iframe\b/);
 assert.doesNotMatch(read('tools/staff-app/src/App.jsx'),/<SahaTakip\b|import[^\n]+SahaTakip|<iframe\b/);
});

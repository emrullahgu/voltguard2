'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('./test-dependencies.cjs').testDependency('typescript');
const source=path.resolve(__dirname,'../saha-app/src');
const flush=async()=>{for(let index=0;index<24;index++)await Promise.resolve();};
function load(file,dependencies){
  const filename=path.join(source,file),module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:name=>{
    if(!(name in dependencies))throw Error('Unexpected dependency: '+name);
    return dependencies[name];
  },Date,Math,JSON,Promise,Object,Error,console},{filename});return module.exports;
}
function serviceFixture(initial={}){
  const values=new Map(Object.entries(initial)),writes=[];
  const service=load('services/saas.ts',{'@react-native-async-storage/async-storage':{
    getItem:async key=>values.get(key)??null,
    setItem:async(key,value)=>{writes.push({key,value});values.set(key,value);},
  }});
  return {service,values,writes};
}
function screenFixture(name,service){
  const states=[];let cursor=0,focus,tree;
  const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useCallback:callback=>callback,useState:initial=>{
    const index=cursor++;if(!(index in states))states[index]=initial;
    return [states[index],next=>{states[index]=typeof next==='function'?next(states[index]):next;}];
  }};
  const dependencies={react,'react-native':{View:'View',Text:'Text',TextInput:'TextInput',ScrollView:'ScrollView',TouchableOpacity:'TouchableOpacity',StyleSheet:{create:styles=>styles}},
    'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Ionicons'},
    '@react-navigation/native':{useFocusEffect:callback=>{focus=callback;},useNavigation:()=>({navigate(){}})},
    '../theme':{colors:{bg:{},text:{},border:{}},spacing:{},radius:{},typography:{}},'../services/saas':service,
    '../portal/useMeasuredGrid':{useMeasuredGrid:()=>({tileWidth:400,onGridLayout(){}})},'../portal/siteHubStyles':{siteHubStyles:styles=>styles}};
  const screen=load('screens/'+name+'Screen.tsx',dependencies);
  const render=()=>{cursor=0;tree=screen.default();return tree;};
  const nodes=()=>{const walk=value=>Array.isArray(value)?value.flatMap(walk):value&&typeof value==='object'?[value,...walk(value.props?.children||[])]:[value];return walk(tree);};
  return {render,focus:()=>focus(),nodes};
}

test('Empty SaaS branding contains no invented company or verified domain',async()=>{
  const f=serviceFixture(),branding=await f.service.getSaasBranding();
  assert.equal(branding.tenantId,'');assert.equal(branding.tenantName,'');assert.equal(branding.emailFromName,'');
  assert.equal(branding.customDomain,'');assert.equal(branding.customDomainVerified,false);
  assert.equal(JSON.stringify(branding).includes('ACME'),false);assert.equal(f.writes.length,0,'A read cannot seed a fictional company');
});

test('Saved SaaS branding is preserved and ordinary preference updates do not invent domain verification',async()=>{
  const configured={tenantId:'synthetic-tenant',tenantName:'Synthetic Company',primaryColor:'#123456',accentColor:'#abcdef',emailFromName:'Synthetic Sender',customDomain:'unverified.example.invalid',customDomainVerified:false};
  const f=serviceFixture({saas_branding_v1:JSON.stringify(configured)});
  assert.equal(JSON.stringify(await f.service.getSaasBranding()),JSON.stringify(configured));
  const saved=await f.service.updateSaasBranding({primaryColor:'#654321'});
  assert.equal(saved.tenantName,configured.tenantName);assert.equal(saved.customDomainVerified,false);assert.equal(saved.primaryColor,'#654321');
});

test('SaaS metrics never invent a comparison trend for empty or populated current-period data',async()=>{
  const empty=serviceFixture(),first=await empty.service.getSaasSuperAdminMetrics();
  assert.ok(first.length>0);assert.equal(first.every(metric=>metric.delta===undefined),true);
  assert.equal(first.find(metric=>metric.label==='Toplam MRR').value,'₺0');
  const f=serviceFixture({saas_tenants_v1:JSON.stringify([{id:'synthetic-tenant',status:'active',mrr:100,users:3,storageMb:2048}])});
  const metrics=await f.service.getSaasSuperAdminMetrics();
  assert.equal(metrics.find(metric=>metric.label==='Toplam MRR').value,'₺100');
  assert.equal(metrics.find(metric=>metric.label==='Aktif Firma').value,'1');
  assert.equal(metrics.every(metric=>metric.delta===undefined),true,'Current data alone is not a prior-period comparison');
  assert.equal(f.writes.length,0);
});

test('SaaS metric UI states that no comparison exists instead of drawing unsupported percentage trends',async()=>{
  const f=serviceFixture(),screen=screenFixture('SaasSuperAdmin',f.service);
  screen.render();screen.focus();await flush();screen.render();
  const text=screen.nodes().filter(node=>typeof node==='string');
  assert.equal(text.filter(value=>value==='Karşılaştırma yok').length,6);
  assert.equal(text.some(value=>/^%/.test(value)),false);
});

test('SaaS branding UI has an honest empty identity and no simulated DNS verification action',async()=>{
  const empty=screenFixture('SaasBranding',serviceFixture().service);
  empty.render();empty.focus();await flush();empty.render();
  assert.ok(empty.nodes().includes('Firma kimliği yapılandırılmadı'));assert.ok(empty.nodes().includes('Alan adı tanımlanmadı'));
  const f=serviceFixture({saas_branding_v1:JSON.stringify({tenantId:'synthetic-tenant',tenantName:'Synthetic Company',primaryColor:'#123456',accentColor:'#abcdef',customDomain:'unverified.example.invalid',customDomainVerified:false})});
  const screen=screenFixture('SaasBranding',f.service);screen.render();screen.focus();await flush();screen.render();
  assert.ok(screen.nodes().includes('DNS doğrulama servisi bağlı değil. Alan adı doğrulanmadı.'));
  assert.equal(screen.nodes().includes('Alan Adını Doğrula'),false,'No click may manufacture a successful DNS result');
  assert.equal(f.writes.length,0);
});

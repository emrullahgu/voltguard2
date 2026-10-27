'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let ts;try{ts=require('../saha-app/node_modules/typescript');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;ts=require('typescript');}
const root=path.resolve(__dirname,'../saha-app');
function load(file,requireModule){
 const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,require:requireModule,console:{...console,warn:()=>{}},Promise,Date,Math,Set,Map,Object,Array,Error,setTimeout,clearTimeout},{filename:file});return module.exports;
}
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function providerFixture(initialMode='pending'){
 const states=[],effects=[];let stateIndex=0,effectIndex=0,mode=initialMode;const pending=[];
 const react={createContext:()=>({Provider:'AppContext'}),createElement:(type,props,...children)=>({type,props:{...props,children}}),useContext:()=>{},useState:initial=>{const index=stateIndex++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return [states[index],update=>{states[index]=typeof update==='function'?update(states[index]):update;}];},useEffect:(effect,deps)=>{const index=effectIndex++;if(!effects[index]||deps.some((value,i)=>value!==effects[index].deps[i]))effects[index]={effect,deps,pending:true};}};
 // Refs share the persistent hook slots without scheduling a state update.
 react.useRef=initial=>react.useState(()=>({current:initial}))[0];
 const repo=name=>({list:()=>mode==='pending'?new Promise(resolve=>pending.push(()=>resolve([{id:'synthetic-'+name}]))):mode==='fail'&&name==='customers'?Promise.reject(new Error('Synthetic canonical read failed')):Promise.resolve([{id:'synthetic-'+name}])});
 const data={isOnlineMode:()=>true,quotesRepo:repo('quotes'),customersRepo:repo('customers'),workOrdersRepo:repo('workOrders'),employeesRepo:repo('employees'),drainSyncQueue:async()=>({ok:0,failed:0})};
 const app=load('src/context/AppContext.tsx',name=>{
  if(name==='react')return react;if(name==='react-native')return {Alert:{}};
  if(name==='../services/data')return data;
  if(name==='./AuthContext')return {useAuth:()=>({session:{user:{id:'synthetic-native-staff'}},isDemoMode:false})};
  if(name==='../data/initialData')return {INITIAL_WORK_ORDERS:[],INITIAL_EMPLOYEES:[]};
  if(name==='../services/recurringTasks')return {runDueTemplates:async()=>[]};
  if(name==='../services/slaWatcher')return {checkSlaBreaches:async()=>{}};
  if(name==='../utils/date')return {localDateISO:()=> '2026-10-28'};
  if(name.startsWith('../services/')||name.startsWith('../utils/'))return {};
  throw new Error('Unexpected provider dependency '+name);
 });
 const render=()=>{stateIndex=0;effectIndex=0;return app.AppProvider({children:null}).props.value;};
 return {render,start:()=>{for(const item of effects)if(item.pending){item.pending=false;item.effect();}},resolve:()=>pending.forEach(release=>release()),pending,setMode:value=>{mode=value;}};
}
test('Canonical provider starts syncing and confirms all four repository reads before readiness',async()=>{
 const f=providerFixture();const initial=f.render();assert.equal(initial.syncState,'syncing');assert.equal(initial.hasCanonicalData,false);
 f.start();assert.equal(f.pending.length,4);assert.equal(f.render().hasCanonicalData,false);
 f.resolve();await tick();const ready=f.render();assert.equal(ready.syncState,'idle');assert.equal(ready.hasCanonicalData,true);assert.equal(ready.customers[0].id,'synthetic-customers');
 f.setMode('fail');const refresh=ready.refresh();assert.equal(f.render().syncState,'syncing');assert.equal(f.render().hasCanonicalData,true);
 await refresh;const retained=f.render();assert.equal(retained.syncState,'error');assert.equal(retained.hasCanonicalData,true);assert.equal(retained.customers[0].id,'synthetic-customers');
});
test('A failed first canonical read remains an error instead of empty successful data',async()=>{
 const f=providerFixture('fail');f.render();f.start();await tick();const failed=f.render();assert.equal(failed.syncState,'error');assert.equal(failed.hasCanonicalData,false);
});
test('Workspace never mounts navigation before canonical readiness, and keeps it during later refresh',()=>{
 let context={syncState:'syncing',hasCanonicalData:false,refresh:async()=>{}};
 function NativeNavigator(){}
 const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:()=>['',()=>{}],useEffect:()=>{}};
 const app=load('App.tsx',name=>{
  if(name==='react')return react;if(name==='react-native')return {View:'View',Text:'Text',Pressable:'Pressable',StyleSheet:{create:styles=>styles}};
  if(name==='./src/context/AuthContext')return {useAuth:()=>({loading:false,user:{id:'synthetic-native-staff'}})};
  if(name==='./src/context/AppContext')return {useAppContext:()=>context};
  if(name==='./src/navigation')return NativeNavigator;
  if(name==='./src/theme')return {colors:{bg:{primary:'#fff'}}};
  if(name==='./src/utils/webAlertShim')return {installWebAlertShim:()=>{}};
  if(name==='react-native-safe-area-context'||name.startsWith('./src/'))return {};
  throw new Error('Unexpected workspace dependency '+name);
 });
 const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children||[])]:[];
 const hasNavigator=()=>nodes(app.Workspace({initialRoute:'Customers'})).some(node=>node.type===NativeNavigator);
 assert.equal(hasNavigator(),false);context={...context,syncState:'error'};assert.equal(hasNavigator(),false);
 context={...context,syncState:'offline'};assert.equal(hasNavigator(),false);
 context={...context,syncState:'idle',hasCanonicalData:true};assert.equal(hasNavigator(),true);
 context={...context,syncState:'syncing'};assert.equal(hasNavigator(),true);
 context={...context,syncState:'error'};assert.equal(hasNavigator(),true);
});

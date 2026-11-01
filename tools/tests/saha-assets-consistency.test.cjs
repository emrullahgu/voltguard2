'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let ts;try{ts=require('../saha-app/node_modules/typescript');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;ts=require('typescript');}
const sourceRoot=path.resolve(__dirname,'../saha-app/src'),id='11111111-2222-4333-8444-555555555555',cacheKey='@SahaTakip:assets';
function load(file,deps,source){
 const module={exports:{}},filename=path.join(sourceRoot,file);
 const code=ts.transpileModule(source??fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(!(name in deps))throw Error('Unexpected dependency '+name);return deps[name];},console,Date,Number,Math,Object,Array,JSON,Map,Set,Error,Promise},{filename});return module.exports;
}
function fixture(options={}){
 let canonical={id,name:'Original asset',type:'transformer',notes:'Original note',created_at:'2026-11-01T00:00:00Z'},revision=3,cacheReadFails=false,cacheWriteFails=false,rejectMutation=false,rejectRead=false;
 const requests=[],cacheWrites=[],audits=[],cache=new Map([[cacheKey,JSON.stringify([{id,name:canonical.name,type:canonical.type,notes:canonical.notes,serverRevision:revision}])]]);
 const api={onPortalReset(){},reportPortalError:error=>error,portalRpc:async(name,args)=>{
  assert.equal(name,'app_saha_query');assert.equal(args.table,'assets');requests.push(args);
  if(args.operation==='select'){
   if(rejectRead)throw Object.assign(Error('Synthetic asset read failure'),{status:503});
   return {data:canonical?[{...canonical}]:[],versions:canonical?{[id]:revision}:{}};
  }
  if(rejectMutation)throw Object.assign(Error('Synthetic asset write rejection'),{status:409});
  if(args.operation==='insert'){canonical={...args.rows[0],id,created_at:'2026-11-01T00:00:00Z'};revision++;}
  else{
   if(!canonical||args.versions[id]!==revision)throw Object.assign(Error('Synthetic stale asset revision'),{status:409});
   if(args.operation==='delete'){canonical=null;return {data:[{id}],versions:{}};}
   canonical={...canonical,...args.rows};revision++;
  }
  return {data:{...canonical},versions:{[id]:revision}};
 }};
 const native=load('portal/nativeClient.ts',{'./api':api});
 const service=load('services/assets.ts',{'./supabase':native,'@react-native-async-storage/async-storage':{
  getItem:async key=>{if(cacheReadFails)throw Error('Synthetic cache read failure');return cache.get(key)||null;},
  setItem:async(key,value)=>{cacheWrites.push({key,value});if(cacheWriteFails)throw Error('Synthetic cache write failure');cache.set(key,value);},
 },'./data/auditRepo':{auditRepo:{logCurrent:async event=>audits.push(event)}}},options.source);
 return {service,native,requests,cacheWrites,audits,cache,canonical:()=>canonical,revision:()=>revision,failCacheRead:value=>{cacheReadFails=value;},failCacheWrite:value=>{cacheWriteFails=value;},rejectMutation:value=>{rejectMutation=value;},rejectRead:value=>{rejectRead=value;},remoteEdit:()=>{canonical={...canonical,name:'Other employee',notes:'Remote note'};revision=9;}};
}

for(const kind of ['read','write'])test('A confirmed asset create still returns its canonical record when optional cache '+kind+' fails',async()=>{
 const f=fixture();if(kind==='read')f.failCacheRead(true);else f.failCacheWrite(true);
 const saved=await f.service.createAsset({name:'Accepted create',type:'transformer',customerName:'Local display label'});
 assert.equal(saved.id,id);assert.equal(saved.name,'Accepted create');assert.equal(saved.serverRevision,f.revision());assert.equal(f.requests.filter(r=>r.operation==='insert').length,1);assert.equal(f.canonical().name,saved.name);
});

test('A successful canonical asset read is not hidden by a corrupt optional cache',async()=>{
 const f=fixture();f.cache.set(cacheKey,'{broken json');f.failCacheWrite(true);
 const list=await f.service.listAssets();assert.equal(list.length,1);assert.equal(list[0].name,'Original asset');assert.equal(list[0].serverRevision,3);
});

test('An asset editor retains its loaded revision after another reader advances the global native query token',async()=>{
 const f=fixture(),loaded=(await f.service.listAssets())[0];f.remoteEdit();await f.native.supabase.from('assets').select('*');
 await assert.rejects(f.service.updateAsset(id,{name:'Stale draft',serverRevision:loaded.serverRevision}),error=>error.status===409);
 assert.equal(f.requests.at(-1).versions[id],3);assert.equal(f.canonical().name,'Other employee');assert.equal(f.canonical().notes,'Remote note');
});

test('An asset delete retains the selected DTO revision after another reader advances the global native query token',async()=>{
 const f=fixture(),loaded=(await f.service.listAssets())[0];f.remoteEdit();await f.native.supabase.from('assets').select('*');
 await assert.rejects(f.service.deleteAsset(id,loaded.serverRevision),error=>error.status===409);assert.equal(f.requests.at(-1).versions[id],3);assert.ok(f.canonical());
});

test('Missing asset editor or delete revision blocks a write before contacting the canonical server',async()=>{
 const f=fixture();await f.service.listAssets();const before=f.requests.length;
 await assert.rejects(f.service.updateAsset(id,{name:'Unsafe draft'}),/sürüm/);await assert.rejects(f.service.deleteAsset(id),/sürüm/);assert.equal(f.requests.length,before);
});

test('A confirmed partial asset update returns its new revision despite cache failure and keeps untouched canonical fields',async()=>{
 const f=fixture(),loaded=(await f.service.listAssets())[0];f.failCacheRead(true);f.failCacheWrite(true);
 const saved=await f.service.updateAsset(id,{name:'Confirmed edit',serverRevision:loaded.serverRevision});
 assert.equal(saved.name,'Confirmed edit');assert.equal(saved.notes,'Original note');assert.equal(saved.serverRevision,4);assert.equal(f.requests.at(-1).versions[id],3);
 assert.equal('serverRevision' in f.requests.at(-1).rows,false,'Client revision metadata is never submitted as a server column');
});

test('A confirmed asset delete remains successful when optional cache refresh fails',async()=>{
 const f=fixture(),loaded=(await f.service.listAssets())[0];f.failCacheRead(true);f.failCacheWrite(true);
 await f.service.deleteAsset(id,loaded.serverRevision);assert.equal(f.canonical(),null);assert.equal(f.requests.filter(r=>r.operation==='delete').length,1);
});

test('Rejected asset create, edit and delete cannot modify cache or report audit success',async()=>{
 const f=fixture(),loaded=(await f.service.listAssets())[0],before=JSON.stringify([...f.cache]);const writes=f.cacheWrites.length;f.rejectMutation(true);
 await assert.rejects(f.service.createAsset({name:'Denied create',type:'meter'}),error=>error.status===409);
 await assert.rejects(f.service.updateAsset(id,{name:'Denied update',serverRevision:loaded.serverRevision}),error=>error.status===409);
 await assert.rejects(f.service.deleteAsset(id,loaded.serverRevision),error=>error.status===409);
 assert.equal(JSON.stringify([...f.cache]),before);assert.equal(f.cacheWrites.length,writes);assert.equal(f.audits.length,0);assert.equal(f.canonical().name,'Original asset');
});

test('A failed asset server read rejects and leaves the prior cache intact',async()=>{
 const f=fixture(),before=JSON.stringify([...f.cache]);f.rejectRead(true);await assert.rejects(f.service.listAssets(),/Synthetic asset read failure/);assert.equal(JSON.stringify([...f.cache]),before);assert.equal(f.cacheWrites.length,0);
});

function screenFixture(name,assets={}){
 const slots=[],effects=[],alerts=[],navigation=[];let cursor=0,tree;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const useState=initial=>{const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];};
 const useMemo=(factory,deps)=>{const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:factory(),deps};return slots[i].value;};
 const useEffect=(effect,deps)=>{const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){slots[i]={deps};effects.push(effect);}};
 const react={createElement:(type,props,...children)=>({type,props:{...props,children:children.flat()}}),useState,useMemo,useCallback:(fn,deps)=>useMemo(()=>fn,deps),useRef:initial=>useMemo(()=>({current:initial}),[]),useEffect};
 const native={StyleSheet:{create:styles=>styles},Platform:{OS:'web'},Alert:{alert:(...args)=>alerts.push(args)}};
 for(const key of ['View','Text','ScrollView','FlatList','TouchableOpacity','TextInput','ActivityIndicator','KeyboardAvoidingView'])native[key]=key;
 const colors=new Proxy({},{get:()=>new Proxy({},{get:()=>'#123456'})}),numbers=new Proxy({},{get:()=>12});
 const dependencies={react,'react-native':native,'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Icon'},
  '@react-navigation/native':{useNavigation:()=>({goBack:()=>navigation.push('back'),navigate:(...args)=>navigation.push(args)}),useRoute:()=>({params:{assetId:id}}),useFocusEffect:callback=>useEffect(callback,[callback])},
  '../theme':{colors,spacing:numbers,radius:numbers,typography:numbers,brand:{}},'../services/assets':{ASSET_TYPES:[],ASSET_TYPE_LABEL:{transformer:'Trafo'},...assets},
  '../services/energyReadings':{listByAsset:async()=>[],READING_KIND_LABEL:{}},'../services/maintenancePlans':{listByAsset:async()=>[],MAINTENANCE_KIND_LABEL:{}},'../services/inspections':{listInspections:async()=>[],listNonconformities:async()=>[],INSPECTION_TYPE_LABEL:{},SEVERITY_COLOR:{},NC_STATUS_LABEL:{}},
  '../components/ErrorState':{default:'ErrorState',__esModule:true},'../components/EmptyState':{default:'EmptyState',__esModule:true},'../utils/perf':{FLATLIST_DEFAULTS:{}},'../utils/a11y':{a11yButton:label=>({accessibilityLabel:label}),a11yInput:label=>({accessibilityLabel:label})},'../context/AppContext':{useAppContext:()=>({customers:[]})}};
 const component=load('screens/'+name+'Screen.tsx',dependencies).default;
 const flat=value=>Array.isArray(value)?value.flatMap(flat):value&&typeof value==='object'?[value,...flat(value.props?.children||[])]:[value];
 const render=()=>{cursor=0;tree=component();while(effects.length)effects.shift()();};
 const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve();render();};
 render();return {render,flush,nodes:()=>flat(tree),flat,alerts,navigation};
}

for(const outcome of ['failure','missing'])test('Asset details replace an indefinite loader with a controlled retriable '+outcome+' state',async()=>{
 const f=screenFixture('AssetDetail',{getAsset:async()=>{if(outcome==='failure')throw Error('Synthetic detail load failure');return undefined;}});await f.flush();
 const error=f.nodes().find(node=>node?.type==='ErrorState');assert.ok(error);assert.equal(typeof error.props.onRetry,'function');assert.match(error.props.message,outcome==='failure'?/Synthetic detail load failure/:/bulunamadı/);
});

test('Asset detail delete uses its displayed revision and retains the screen on rejection',async()=>{
 const deletes=[],f=screenFixture('AssetDetail',{getAsset:async()=>({id,name:'Visible device',type:'transformer',serverRevision:3}),deleteAsset:async(...args)=>{deletes.push(args);throw Error('Synthetic detail delete conflict');}});await f.flush();
 f.nodes().find(node=>node?.props?.label==='Sil').props.onPress();await f.alerts[0][2].find(action=>action.text==='Sil').onPress();f.render();
 assert.deepEqual(deletes,[[id,3]]);assert.equal(f.navigation.length,0);assert.ok(f.nodes().some(node=>node?.type==='ErrorState'&&node.props.message==='Synthetic detail delete conflict'));
});

test('Asset list read failure shows retry rather than fabricated empty-list success',async()=>{
 let fail=true,reads=0;const f=screenFixture('Assets',{listAssets:async()=>{reads++;if(fail)throw Error('Synthetic list read failure');return [];}});await f.flush();
 const error=f.nodes().find(node=>node?.type==='ErrorState');assert.ok(error);assert.equal(f.nodes().some(node=>node?.type==='FlatList'),false);
 fail=false;await error.props.onRetry();await f.flush();assert.equal(reads,2);assert.ok(f.nodes().some(node=>node?.type==='FlatList'));assert.equal(f.navigation.length,0);
});

test('Asset list delete passes the selected row revision and retains it after rejection',async()=>{
 const selected={id,name:'Selected device',type:'transformer',serverRevision:3},deletes=[];
 const f=screenFixture('Assets',{listAssets:async()=>[selected],deleteAsset:async(...args)=>{deletes.push(args);throw Error('Synthetic list delete conflict');}});await f.flush();
 const list=f.nodes().find(node=>node?.type==='FlatList'),item=list.props.renderItem({item:list.props.data[0]});
 f.flat(item).find(node=>node?.props?.accessibilityLabel==='Cihazı sil').props.onPress();await f.alerts[0][2].find(action=>action.text==='Sil').onPress();f.render();
 assert.deepEqual(deletes,[[id,3]]);assert.ok(f.alerts.some(alert=>alert[1]==='Synthetic list delete conflict'));assert.equal(f.nodes().find(node=>node?.type==='FlatList').props.data[0].name,'Selected device');assert.equal(f.navigation.length,0);
});

test('Asset form submits its loaded editor revision and keeps the edited form on rejection',async()=>{
 const updates=[],f=screenFixture('AssetForm',{getAsset:async()=>({id,name:'Loaded device',type:'transformer',notes:'Loaded notes',createdAt:'2026-11-01',serverRevision:3}),updateAsset:async(...args)=>{updates.push(args);throw Error('Synthetic form revision conflict');}});await f.flush();
 const button=f.nodes().find(node=>node?.type==='TouchableOpacity'&&f.flat(node.props.children).includes('Güncelle'));assert.ok(button);await button.props.onPress();f.render();
 assert.equal(updates.length,1);assert.equal(updates[0][0],id);assert.equal(updates[0][1].serverRevision,3);assert.equal(f.navigation.length,0);assert.ok(f.nodes().includes('Synthetic form revision conflict'));assert.ok(f.nodes().some(node=>node?.type==='TextInput'&&node.props.value==='Loaded device'));
});

module.exports={fixture,load};

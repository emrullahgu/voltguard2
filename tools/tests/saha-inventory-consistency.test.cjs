'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('./test-dependencies.cjs').testDependency('typescript'),source=path.resolve(__dirname,'../saha-app/src');
const originalId='10000000-0000-4000-8000-000000000001',createdId='20000000-0000-4000-8000-000000000002';
function load(file,deps){const filename=path.join(source,file),module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(!(name in deps))throw Error('Unexpected dependency '+name);return deps[name];},Date,Math,JSON,Promise,Error,console},{filename});return module.exports;
}
function fixture(name,options={}){
  const row={id:originalId,name:'Existing record',code:'OLD',unit:'adet',kind:'depo',created_at:'2026-11-01T00:00:00.000Z'},key='@SahaTakip:'+name;
  const initial={id:originalId,name:row.name,code:row.code,unit:row.unit,kind:row.kind,createdAt:row.created_at,serverRevision:3};
  const cache=new Map([[key,JSON.stringify([initial])]]),requests=[],writes=[],audits=[];let canonical=row,revision=3;
  const from=()=>{const args={operation:'select'},q={select(){return q;},order(){return q;},single(){args.single=true;return q;},eq(field,value){args.id=value;return q;},expectVersions(value){args.versions=value;return q;},upsert(value){args.operation='upsert';args.row=value;return q;},delete(){args.operation='delete';return q;},then(resolve,reject){
    requests.push(args);let result;
    if(args.operation==='select')result={data:[canonical],versions:{[canonical.id]:revision},error:null};
    else if(options.throwWrite)return Promise.reject(Error('Synthetic transport rejection')).then(resolve,reject);
    else if(options.rejectWrite)result={data:null,error:{message:'Synthetic write rejection'}};
    else if(options.noAcknowledgement)result={data:args.operation==='delete'?[]:null,error:null};
    else if(args.operation==='upsert'){canonical={...canonical,...args.row,id:args.row.id||createdId};revision++;result={data:canonical,versions:{[canonical.id]:revision},error:null};}
    else result={data:[{id:args.id}],error:null};
    return Promise.resolve(result).then(resolve,reject);
  }};return q;};
  const service=load('services/'+name+'.ts',{'@react-native-async-storage/async-storage':{getItem:async key=>cache.get(key)||null,setItem:async(k,v)=>{writes.push({key:k,value:v});if(options.cacheFailure)throw Error('Synthetic cache failure');cache.set(k,v);}},'./supabase':{supabase:{from},SUPABASE_CONFIGURED:true},'./data/auditRepo':{auditRepo:{logCurrent:async event=>audits.push(event)}}});
  return{service,requests,writes,audits,initial,cache:()=>JSON.parse(cache.get(key)),change:(name,version)=>{canonical={...canonical,name};revision=version;}};
}
for(const [name,singular] of [['materials','Material'],['warehouses','Warehouse']]){
  const save='upsert'+singular,remove='delete'+singular,list='list'+(name==='materials'?'Materials':'Warehouses');
  test(name+': rejected canonical save never becomes cache success',async()=>{
    const f=fixture(name,{rejectWrite:true});await assert.rejects(f.service[save]({...f.initial,name:'Rejected edit'}),error=>error.message==='Synthetic write rejection');
    assert.equal(f.cache()[0].name,'Existing record');assert.equal(f.writes.length,0);assert.equal(f.audits.length,0);assert.equal(f.requests.length,1);
  });
  test(name+': thrown transport save failure preserves the cache',async()=>{
    const f=fixture(name,{throwWrite:true});await assert.rejects(f.service[save]({...f.initial,name:'Rejected edit'}),/Synthetic transport rejection/);assert.equal(f.writes.length,0);
  });
  test(name+': stale editor revision stays pinned after an independent newer read',async()=>{
    const f=fixture(name),loaded=(await f.service[list]())[0];f.change('Other editor',9);await f.service[list]();await f.service[save]({...loaded,name:'Local draft'});
    const request=f.requests.find(request=>request.operation==='upsert');assert.equal(request.versions[originalId],3);assert.equal(f.requests.filter(request=>request.operation==='select').length,2,'Saving never refreshes its own CAS token');
  });
  test(name+': missing editor revision blocks an unsafe overwrite',async()=>{
    const f=fixture(name);await assert.rejects(f.service[save]({...f.initial,serverRevision:undefined}),/sürümü|sürüm/);assert.equal(f.requests.length,0);assert.equal(f.writes.length,0);
  });
  test(name+': new record cache uses the acknowledged canonical id',async()=>{
    const f=fixture(name);await f.service[save]({...f.initial,id:'local-new',serverRevision:undefined,name:'New record'});
    const saved=f.cache().find(row=>row.name==='New record');assert.equal(saved.id,createdId);assert.equal(saved.serverRevision,4);assert.equal(Object.keys(f.requests[0].versions).length,0);assert.equal(f.requests.length,1);
  });
  test(name+': rejected delete retains canonical-looking cached record',async()=>{
    const f=fixture(name,{rejectWrite:true});await assert.rejects(f.service[remove](originalId,3),error=>error.message==='Synthetic write rejection');assert.equal(f.cache().length,1);assert.equal(f.writes.length,0);assert.equal(f.audits.length,0);assert.equal(f.requests[0].versions[originalId],3);
  });
  test(name+': unacknowledged save and zero-row delete are not success',async()=>{
    const f=fixture(name,{noAcknowledgement:true});await assert.rejects(f.service[save](f.initial),/doğrulanamadı/);await assert.rejects(f.service[remove](originalId,3),/doğrulanamadı/);assert.equal(f.writes.length,0);
  });
  test(name+': cache failure after confirmed save cannot induce a duplicate retry',async()=>{
    const f=fixture(name,{cacheFailure:true});await f.service[save](f.initial);assert.equal(f.requests.filter(request=>request.operation==='upsert').length,1);
  });
}

function formFixture(kind,rejectSave=true){
  const states=[],refs=[];let cursor=0,refCursor=0,saves=0,back=0,tree;
  const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef:initial=>{const i=refCursor++;return refs[i]||={current:initial};},useEffect(){}};
  const native={StyleSheet:{create:value=>value},Platform:{OS:'web'},Alert:{alert(){}}};for(const key of ['View','Text','TextInput','ScrollView','TouchableOpacity','KeyboardAvoidingView'])native[key]=key;
  const singular=kind==='materials'?'Material':'Warehouse',service={['new'+singular]:()=>({id:'new-local',name:'Preserved name',code:'PRESERVE',unit:'adet',kind:'depo',notes:'Preserved note'}),['upsert'+singular]:async()=>{saves++;await Promise.resolve();if(rejectSave)throw Error('Synthetic form save rejection');}};
  const screen=load('screens/'+singular+'FormScreen.tsx',{react,'react-native':native,'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Ionicons'},'@react-navigation/native':{useRoute:()=>({params:undefined}),useNavigation:()=>({goBack:()=>{back++;}})},'../theme':{colors:{bg:{},text:{},border:{},rose:{}},spacing:{},radius:{},typography:{},brand:{}},['../services/'+kind]:service,'../utils/numInput':{}});
  const render=()=>{cursor=0;refCursor=0;tree=screen.default();};const flat=value=>Array.isArray(value)?value.flatMap(flat):value&&typeof value==='object'?[value,...flat(value.props?.children||[])]:[value];
  const action=()=>flat(tree).find(node=>node?.type==='TouchableOpacity'&&flat(node.props.children).some(value=>['Malzeme Ekle','Kaydet'].includes(value)));
  return {render,action,nodes:()=>flat(tree),counts:()=>({saves,back})};
}
for(const kind of ['materials','warehouses']){
  test(kind+': form save failure preserves draft and does not navigate back or submit twice',async()=>{
    const f=formFixture(kind);f.render();await Promise.all([f.action().props.onPress(),f.action().props.onPress()]);f.render();
    assert.equal(f.counts().saves,1);assert.equal(f.counts().back,0);assert.ok(f.nodes().includes('Synthetic form save rejection'));
    assert.ok(f.nodes().some(node=>node?.type==='TextInput'&&node.props.value==='Preserved name'));assert.ok(f.nodes().some(node=>node?.type==='TextInput'&&node.props.value==='Preserved note'));
  });
  test(kind+': confirmed form save navigates back exactly once',async()=>{
    const f=formFixture(kind,false);f.render();await f.action().props.onPress();assert.equal(f.counts().saves,1);assert.equal(f.counts().back,1);
  });
}

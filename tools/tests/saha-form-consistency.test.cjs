'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let ts;try{ts=require('../saha-app/node_modules/typescript');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;ts=require('typescript');}
const root=path.resolve(__dirname,'../saha-app/src');
const templateId='10000000-0000-4000-8000-000000000001',responseId='20000000-0000-4000-8000-000000000002',createdId='30000000-0000-4000-8000-000000000003';
function load(file,deps){
 const replacement=process.env.VG_FORMS_SOURCE_DIR&&path.join(process.env.VG_FORMS_SOURCE_DIR,path.basename(file));
 const filename=replacement&&fs.existsSync(replacement)?replacement:path.join(root,file),module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true,jsx:ts.JsxEmit.React}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(!(name in deps))throw Error('Unexpected dependency '+name);return deps[name];},console,Date,Math,Number,Object,Array,Map,Set,JSON,Promise,Error},{filename});return module.exports;
}
function fixture(){
 const stamp='2026-11-01T00:00:00Z',rows={form_templates:{id:templateId,name:'Original template',category:'Bakım',fields:[{id:'a',type:'text',label:'Original field'}],created_at:stamp,updated_at:stamp},form_responses:{id:responseId,template_id:templateId,template_name:'Original template',values:{a:'Original answer'},revision:1,created_at:stamp,updated_at:stamp}};
 const versions={form_templates:3,form_responses:3},cache=new Map(),calls=[],cacheWrites=[];let rejectRead=false,rejectWrite=false,cacheReadFails=false,cacheWriteFails=false,noAcknowledgement=false;
 cache.set('@SahaTakip:form_templates',JSON.stringify([{id:templateId,name:'Original template',category:'Bakım',fields:rows.form_templates.fields,serverRevision:3}]));
 cache.set('@SahaTakip:form_responses',JSON.stringify([{id:responseId,templateId,templateName:'Original template',values:{a:'Original answer'},revision:1,serverRevision:3}]));
 const api={onPortalReset(){},reportPortalError:error=>error,portalRpc:async(name,args)=>{
  assert.equal(name,'app_saha_query');calls.push(args);let row=rows[args.table];
  if(args.operation==='select'){
   if(rejectRead)throw Error('Synthetic canonical form read failed');
   return {data:row?[structuredClone(row)]:[],versions:row?{[row.id]:versions[args.table]}:{}};
  }
  if(rejectWrite)throw Object.assign(Error('Synthetic canonical form write rejected'),{status:409});
  if(noAcknowledgement)return {data:args.operation==='delete'?[]:null,versions:{}};
  const item=Array.isArray(args.rows)?args.rows[0]:args.rows;
  if(args.operation==='insert'||args.operation==='upsert'&&!item.id){row={...item,id:createdId,created_at:stamp,updated_at:stamp};versions[args.table]=1;}
  else{
   if(!row||args.versions[row.id]!==versions[args.table])throw Object.assign(Error('Synthetic stale form revision'),{status:409});
   if(args.operation==='delete'){rows[args.table]=null;return {data:[{id:row.id}],versions:{}};}
   row={...row,...item};versions[args.table]++;
  }
  rows[args.table]=row;return {data:structuredClone(row),versions:{[row.id]:versions[args.table]}};
 }};
 const native=load('portal/nativeClient.ts',{'./api':api});
 const storage={getItem:async key=>{if(cacheReadFails)throw Error('Synthetic optional form cache read failed');return cache.get(key)||null;},setItem:async(key,value)=>{cacheWrites.push({key,value});if(cacheWriteFails)throw Error('Synthetic optional form cache write failed');cache.set(key,value);}};
 const deps={'./supabase':native,'@react-native-async-storage/async-storage':storage};
 return {templates:load('services/formTemplates.ts',deps),responses:load('services/formResponses.ts',deps),native,cache,calls,cacheWrites,rows,versions,
  rejectRead:value=>{rejectRead=value;},rejectWrite:value=>{rejectWrite=value;},failCacheRead:value=>{cacheReadFails=value;},failCacheWrite:value=>{cacheWriteFails=value;},noAcknowledgement:value=>{noAcknowledgement=value;},
  remoteEdit:table=>{rows[table]={...rows[table],name:'Other employee',values:{a:'Other answer'},revision:2};versions[table]=9;}};
}

test('Template rejection cannot become cache success or a resolved save',async()=>{
 const f=fixture(),loaded=(await f.templates.listTemplates())[0],before=JSON.stringify([...f.cache]);f.rejectWrite(true);
 await assert.rejects(f.templates.upsertTemplate({...loaded,name:'Rejected template'}),error=>error.status===409);
 assert.equal(JSON.stringify([...f.cache]),before);assert.equal(f.rows.form_templates.name,'Original template');
});
test('Template delete rejection preserves the current cached record',async()=>{
 const f=fixture(),loaded=(await f.templates.listTemplates())[0],before=JSON.stringify([...f.cache]);f.rejectWrite(true);
 await assert.rejects(f.templates.deleteTemplate(templateId,loaded.serverRevision),error=>error.status===409);assert.equal(JSON.stringify([...f.cache]),before);
});
test('Template editor revision stays pinned after another global native read',async()=>{
 const f=fixture(),loaded=(await f.templates.listTemplates())[0];f.remoteEdit('form_templates');await f.native.supabase.from('form_templates').select('*');
 await assert.rejects(f.templates.upsertTemplate({...loaded,name:'Stale template'}),error=>error.status===409);
 assert.equal(f.calls.at(-1).versions[templateId],3);assert.equal(f.rows.form_templates.name,'Other employee');
});
test('Template delete uses the selected DTO revision after a newer read',async()=>{
 const f=fixture(),loaded=(await f.templates.listTemplates())[0];f.remoteEdit('form_templates');await f.native.supabase.from('form_templates').select('*');
 await assert.rejects(f.templates.deleteTemplate(templateId,loaded.serverRevision),error=>error.status===409);assert.ok(f.rows.form_templates);
});
test('New template creation returns and caches its acknowledged canonical ID',async()=>{
 const f=fixture(),draft=f.templates.newEmptyTemplate();draft.name='New template';draft.fields=[{id:'a',label:'Answer',type:'text'}];
 const saved=await f.templates.upsertTemplate(draft);assert.equal(saved.id,createdId);assert.equal(saved.serverRevision,1);
 assert.equal(JSON.parse(f.cache.get('@SahaTakip:form_templates')).find(x=>x.name==='New template').id,createdId);
});
for(const kind of ['read','write'])test('Confirmed template save survives optional cache '+kind+' failure',async()=>{
 const f=fixture(),loaded=(await f.templates.listTemplates())[0];kind==='read'?f.failCacheRead(true):f.failCacheWrite(true);
 const saved=await f.templates.upsertTemplate({...loaded,name:'Confirmed template'});assert.equal(saved.name,'Confirmed template');assert.equal(saved.serverRevision,4);assert.equal(f.rows.form_templates.name,'Confirmed template');
});
test('Canonical template read rejection is visible and never falls back to stale cache success',async()=>{
 const f=fixture(),before=JSON.stringify([...f.cache]);f.rejectRead(true);await assert.rejects(f.templates.listTemplates(),/canonical form read failed/);assert.equal(JSON.stringify([...f.cache]),before);
});
test('Missing template editor/delete revision blocks unsafe mutation before transport',async()=>{
 const f=fixture();await assert.rejects(f.templates.upsertTemplate({id:templateId,name:'Unsafe',fields:[],category:'Bakım'}),/sürüm/);await assert.rejects(f.templates.deleteTemplate(templateId),/sürüm/);assert.equal(f.calls.length,0);
});
test('Response editor revision and document revision belong to its loaded DTO, not later cache/global reads',async()=>{
 const f=fixture(),loaded=(await f.responses.listResponses())[0];f.remoteEdit('form_responses');await f.responses.listResponses();
 await assert.rejects(f.responses.updateResponse(responseId,{a:'Stale answer'},undefined,'Edit',loaded),error=>error.status===409);
 assert.equal(f.calls.at(-1).versions[responseId],3);assert.equal(f.calls.at(-1).rows.revision,2);assert.equal(f.rows.form_responses.values.a,'Other answer');
});
test('Response delete uses displayed revision even after a newer query',async()=>{
 const f=fixture(),loaded=(await f.responses.listResponses())[0];f.remoteEdit('form_responses');await f.native.supabase.from('form_responses').select('*');
 await assert.rejects(f.responses.deleteResponse(responseId,loaded.serverRevision),error=>error.status===409);assert.ok(f.rows.form_responses);
});
for(const kind of ['read','write'])test('Confirmed response creation cannot become a failed save when optional cache '+kind+' fails',async()=>{
 const f=fixture();kind==='read'?f.failCacheRead(true):f.failCacheWrite(true);
 const saved=await f.responses.createResponse({templateId,templateName:'Created response',values:{a:'Confirmed answer'}});
 assert.equal(saved.id,createdId);assert.equal(saved.serverRevision,1);assert.equal(f.rows.form_responses.values.a,'Confirmed answer');assert.equal(f.calls.filter(x=>x.operation==='insert').length,1);
});
test('Confirmed response update returns its acknowledged new revision despite optional cache failure',async()=>{
 const f=fixture(),loaded=(await f.responses.listResponses())[0];f.failCacheRead(true);f.failCacheWrite(true);
 const saved=await f.responses.updateResponse(responseId,{a:'Confirmed answer'},undefined,'Edit',loaded);
 assert.equal(saved.serverRevision,4);assert.equal(saved.revision,2);assert.equal(f.rows.form_responses.values.a,'Confirmed answer');
 assert.equal('serverRevision' in f.calls.at(-1).rows,false);
});
test('Confirmed response delete remains successful despite optional cache and history failure',async()=>{
 const f=fixture(),loaded=(await f.responses.listResponses())[0];f.failCacheRead(true);f.failCacheWrite(true);await f.responses.deleteResponse(responseId,loaded.serverRevision);assert.equal(f.rows.form_responses,null);
});
test('Response save/delete rejection never mutates cache or history',async()=>{
 const f=fixture(),loaded=(await f.responses.listResponses())[0],before=JSON.stringify([...f.cache]);f.rejectWrite(true);
 await assert.rejects(f.responses.updateResponse(responseId,{a:'Rejected answer'},undefined,'Edit',loaded),error=>error.status===409);await assert.rejects(f.responses.deleteResponse(responseId,loaded.serverRevision),error=>error.status===409);
 assert.equal(JSON.stringify([...f.cache]),before);
});
test('Missing response snapshot cannot submit an unsafe overwrite',async()=>{
 const f=fixture();await assert.rejects(f.responses.updateResponse(responseId,{a:'Unsafe answer'}),/sürüm|kayıt/);await assert.rejects(f.responses.deleteResponse(responseId),/sürüm/);assert.equal(f.calls.length,0);
});
test('Null acknowledgement and zero-row delete are not reported as successful form writes',async()=>{
 const f=fixture(),tpl=(await f.templates.listTemplates())[0],resp=(await f.responses.listResponses())[0];f.noAcknowledgement(true);
 await assert.rejects(f.templates.upsertTemplate(tpl),/doğrulanamadı/);await assert.rejects(f.templates.deleteTemplate(templateId,tpl.serverRevision),/doğrulanamadı/);
 await assert.rejects(f.responses.updateResponse(responseId,{a:'No acknowledgement'},undefined,'Edit',resp),/doğrulanamadı/);await assert.rejects(f.responses.deleteResponse(responseId,resp.serverRevision),/doğrulanamadı/);
});

function screenFixture(name,options={}){
 const slots=[],effects=[],alerts=[],navigation=[],calls=[];let cursor=0,tree,readFails=!!options.readFails;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const useState=initial=>{const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value;}];};
 const useMemo=(factory,deps)=>{const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={value:factory(),deps};return slots[i].value;};
 const useEffect=(effect,deps)=>{const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){slots[i]={deps};effects.push(effect);}};
 const react={createElement:(type,props,...children)=>({type,props:{...props,children:children.flat()}}),useState,useMemo,useCallback:(fn,deps)=>useMemo(()=>fn,deps),useRef:initial=>useMemo(()=>({current:initial}),[]),useEffect};
 const native={StyleSheet:{create:styles=>styles},Platform:{OS:'web'},Alert:{alert:(...args)=>alerts.push(args)}};
 for(const key of ['View','Text','ScrollView','FlatList','TouchableOpacity','TextInput','ActivityIndicator','KeyboardAvoidingView','Image','RefreshControl','Modal'])native[key]=key;
 const colors=new Proxy({},{get:()=>new Proxy({},{get:()=>'#123456'})}),numbers=new Proxy({},{get:()=>12});
 const template={id:templateId,name:'Loaded template',category:'Bakım',fields:[{id:'a',type:options.number?'number':'text',label:'Loaded field',required:true}],serverRevision:3};
 const response={id:responseId,templateId,templateName:template.name,values:{a:'Loaded answer'},revision:1,serverRevision:3,createdAt:'2026-11-01',updatedAt:'2026-11-01'};
 const read=async value=>{calls.push({kind:'read'});if(readFails)throw Error('Synthetic screen read rejected');return structuredClone(value);};
 const write=async(kind,...args)=>{calls.push({kind,args});await Promise.resolve();if(options.rejectWrite!==false)throw Error('Synthetic screen write rejected');return kind==='template'?{...args[0],id:templateId,serverRevision:4}:{...response,id:kind==='create'?createdId:responseId,serverRevision:4};};
 const params={templateId,...(options.create?{}:{responseId}),workOrderId:'QA-WO'};
 const deps={react,'react-native':native,'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Icon'},'expo-image-picker':{},
  '@react-navigation/native':{useNavigation:()=>({goBack:()=>navigation.push('back'),navigate:(...args)=>navigation.push(args),replace:(...args)=>navigation.push(args)}),useRoute:()=>({params}),useFocusEffect:callback=>useEffect(callback,[callback])},
  '../theme':{colors,spacing:numbers,radius:numbers,typography:numbers,brand:{}},'../components/ErrorState':{default:'ErrorState',__esModule:true},'../components/EmptyState':{default:'EmptyState',__esModule:true},'../components/MiniBarChart':{default:'MiniBarChart',__esModule:true},'../utils/perf':{FLATLIST_DEFAULTS:{}},'../utils/a11y':{a11yButton:label=>({accessibilityLabel:label})},
  '../portal/useMeasuredGrid':{useMeasuredGrid:()=>({tileWidth:200,onGridLayout(){}})},'../portal/siteHubStyles':{siteHubStyles:styles=>styles,siteHubCardStyle:()=>({}),siteHubIconStyle:()=>({}),siteHubIconColor:color=>color,siteHubIconSize:size=>size,siteHubStatStyle:()=>({}),siteHubStatColor:color=>color},'../utils/date':{localDateISO:()=> '2026-11-01'},
  '../services/formTemplates':{getTemplate:()=>read(template),listTemplates:()=>read([template]),ensureSeeded:async()=>{},newEmptyTemplate:()=>structuredClone(template),newField:type=>({id:'b',label:'New field',type}),upsertTemplate:(...args)=>write('template',...args),deleteTemplate:(...args)=>write('delete-template',...args)},
  '../services/formResponses':{getResponse:()=>read(response),listResponses:()=>read([response]),listResponsesByWorkOrder:()=>read([response]),listRevisionsByResponse:async()=>[],createResponse:(...args)=>write('create',...args),updateResponse:(...args)=>write('update',...args),deleteResponse:(...args)=>write('delete-response',...args)}};
 const component=load('screens/'+name+'Screen.tsx',deps).default;
 const flat=value=>Array.isArray(value)?value.flatMap(flat):value&&typeof value==='object'?[value,...flat(value.props?.children||[])]:[value];
 const render=()=>{cursor=0;tree=component();while(effects.length)effects.shift()();};
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();render();};render();
 return {render,flush,nodes:()=>flat(tree),flat,alerts,navigation,calls,readFails:value=>{readFails=value;},template,response};
}
test('Template editor rejects once, keeps draft and displayed revision, and never claims success',async()=>{
 const f=screenFixture('FormBuilder');await f.flush();const input=f.nodes().find(x=>x?.type==='TextInput'&&x.props.placeholder==='Örn: Aylık Bakım Formu');input.props.onChangeText('Preserved template draft');f.render();
 const save=f.nodes().find(x=>x?.type==='TouchableOpacity'&&f.flat(x.props.children).includes('Güncelle'));
 await Promise.all([save.props.onPress(),save.props.onPress()]);f.render();
 const writes=f.calls.filter(x=>x.kind==='template');assert.equal(writes.length,1);assert.equal(writes[0].args[0].serverRevision,3);assert.equal(f.navigation.length,0);assert.equal(f.alerts.some(x=>x[0]==='Kaydedildi'),false);assert.ok(f.nodes().includes('Synthetic screen write rejected'));assert.ok(f.nodes().some(x=>x?.type==='TextInput'&&x.props.value==='Preserved template draft'));
});
test('Response editor submits its loaded snapshot, retains answer/reason and does not replay a failed save',async()=>{
 const f=screenFixture('FormFill');await f.flush();f.nodes().find(x=>typeof x?.type==='function'&&x.type.name==='FieldRenderer').props.onChange('Preserved response draft');f.nodes().find(x=>x?.type==='TextInput'&&x.props.placeholder==='Neden düzenlendi?').props.onChangeText('Preserved reason');f.render();
 const save=f.nodes().find(x=>x?.type==='TouchableOpacity'&&f.flat(x.props.children).includes('Revizyonu Kaydet'));await Promise.all([save.props.onPress(),save.props.onPress()]);f.render();
 const writes=f.calls.filter(x=>x.kind==='update');assert.equal(writes.length,1);assert.equal(writes[0].args[4].serverRevision,3);assert.equal(writes[0].args[4].values.a,'Loaded answer');assert.equal(writes[0].args[1].a,'Preserved response draft');assert.equal(writes[0].args[3],'Preserved reason');assert.equal(f.navigation.length,0);assert.ok(f.nodes().includes('Synthetic screen write rejected'));
});
test('A completed new form cannot create a second response after the success notice is dismissed',async()=>{
 const f=screenFixture('FormFill',{create:true,rejectWrite:false});await f.flush();f.nodes().find(x=>typeof x?.type==='function'&&x.type.name==='FieldRenderer').props.onChange('Single committed answer');f.render();
 const submit=f.nodes().find(x=>x?.type==='TouchableOpacity'&&f.flat(x.props.children).includes('Formu Tamamla'));await submit.props.onPress();await submit.props.onPress();f.render();assert.equal(f.calls.filter(x=>x.kind==='create').length,1);assert.ok(f.nodes().includes('Form kaydedildi.'));assert.equal(f.nodes().some(x=>typeof x?.type==='function'&&x.type.name==='FieldRenderer'),false);
});
test('Nonfinite numeric form input cannot be converted silently into a saved null response',async()=>{
 const f=screenFixture('FormFill',{create:true,number:true});await f.flush();f.nodes().find(x=>typeof x?.type==='function'&&x.type.name==='FieldRenderer').props.onChange(NaN);f.render();const submit=f.nodes().find(x=>x?.type==='TouchableOpacity'&&f.flat(x.props.children).includes('Formu Tamamla'));await submit.props.onPress();assert.equal(f.calls.some(x=>x.kind==='create'),false);assert.ok(f.alerts.some(x=>/geçerli bir sayı/.test(x[1])));
});
for(const name of ['FormBuilder','FormFill','FormTemplates','FormResponses','FormStats','WorkOrderForms','FormResponseDetail','FormHub'])test(name+': rejected reads produce controlled read-only retry, never success or a replayed write',async()=>{
 const f=screenFixture(name,{readFails:true});await f.flush();let error=f.nodes().find(x=>x?.type==='ErrorState');assert.ok(error);assert.equal(typeof error.props.onRetry,'function');assert.match(error.props.message,/Synthetic screen read rejected/);assert.equal(f.calls.some(x=>x.kind!=='read'),false);
 f.readFails(false);await error.props.onRetry();await f.flush();await f.flush();assert.equal(f.nodes().some(x=>x?.type==='ErrorState'),false);assert.equal(f.calls.some(x=>x.kind!=='read'),false);
});
test('Response detail delete submits its selected revision and stays on a rejected delete',async()=>{
 const f=screenFixture('FormResponseDetail');await f.flush();const button=f.nodes().find(x=>x?.type==='TouchableOpacity'&&x.props.style?.backgroundColor===undefined&&f.flat(x.props.children).some(y=>y?.props?.name==='trash-outline'));assert.ok(button);button.props.onPress();await f.alerts[0][2].find(x=>x.text==='Sil').onPress();f.render();const call=f.calls.find(x=>x.kind==='delete-response');assert.equal(call.args[1],3);assert.equal(f.navigation.length,0);assert.ok(f.nodes().some(x=>x?.type==='ErrorState'));
});

module.exports={fixture,load,templateId,responseId};

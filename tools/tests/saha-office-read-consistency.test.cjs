'use strict';
// Execute the real TSX screens with deferred service reads. No server or live records.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('../saha-app/node_modules/typescript');
const root=path.resolve(__dirname,'../saha-app/src');
function load(file,deps,globals={}){
 const filename=path.join(root,file),module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true,jsx:ts.JsxEmit.React}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(!(name in deps))throw Error('Unexpected dependency '+name);return deps[name];},console,Date,Math,Number,Object,Array,Map,Set,JSON,Promise,Error,...globals},{filename});
 return module.exports;
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const clone=value=>structuredClone(value);
function sample(kind,id='office-a',title='Confirmed office record'){
 const common={id,title,serverRevision:3,icon:'📄',createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'};
 if(kind==='Page')return{...common,blocks:[{id:'block-a',type:'text',text:'Confirmed paragraph'}],parentId:null,orderIndex:1,isFavorite:false};
 if(kind==='Board')return{...common,columns:[{id:'column-a',title:'Todo',cards:[]}],description:''};
 return{...common,date:'2026-11-01',time:'10:00',attendees:[],notes:'Confirmed meeting notes',actionItems:[]};
}
const flat=node=>!node||typeof node!=='object'?[node]:[node,...(node.props?.children||[]).flat(Infinity).flatMap(flat)];
function fixture(kind,initialRead){
 const slots=[],effects=[],subscriptions=new Map(),focusEntries=new Map(),timers=new Map(),writes=[],alerts=[];
 let cursor=0,tree,mounted=true,dirty=true,read=initialRead,readCount=0,routeId='office-a',nextTimer=1,afterUnmountWrites=0;
 const equal=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
 const React={
  createElement:(type,props,...children)=>({type,props:{...props,children:children.flat(Infinity)}}),
  useState(initial){const at=cursor++;if(!slots[at])slots[at]={value:typeof initial==='function'?initial():initial};return[slots[at].value,value=>{if(!mounted)afterUnmountWrites++;slots[at].value=typeof value==='function'?value(slots[at].value):value;dirty=true;}];},
  useRef(initial){const at=cursor++;if(!slots[at])slots[at]={value:{current:initial}};return slots[at].value;},
  useCallback(callback,deps){return React.useMemo(()=>callback,deps);},
  useMemo(factory,deps){const at=cursor++;if(!slots[at]||!equal(slots[at].deps,deps))slots[at]={value:factory(),deps};return slots[at].value;},
  useEffect(callback,deps){const at=cursor++,previous=slots[at];if(!previous||!equal(previous.deps,deps)){slots[at]={deps,cleanup:previous?.cleanup};effects.push(()=>{slots[at].cleanup?.();slots[at].cleanup=callback();});}},
  memo:component=>component,
 };
 const theme=new Proxy({}, {get:()=>new Proxy({}, {get:()=>({})})});
 const serviceRead=async()=>{readCount++;return await read(kind,routeId,readCount);};
 const save=async input=>{writes.push(clone(input));return{...clone(input),serverRevision:(input.serverRevision||0)+1,updatedAt:'2026-11-01T01:00:00Z'};};
 const workspace={
  listPages:kind==='Hub'?async()=>(await serviceRead()).pages:serviceRead,listBoards:serviceRead,listMeetings:serviceRead,
  officeStats:async()=>(await serviceRead()).stats,recentPageIds:async()=>[],orderByRecent:all=>all,
  getPage:async()=>{const value=await serviceRead();return value[0];},getBoard:serviceRead,getMeeting:serviceRead,
  savePage:save,saveBoard:save,saveMeeting:save,deletePage:async()=>{},deleteBoard:async()=>{},deleteMeeting:async()=>{},
  childrenOf:(all,parent)=>all.filter(row=>row.parentId===parent),touchRecent:async()=>{},newBlock:(type,text)=>({id:'new-block',type,text}),
  subscribeOffice:(table,callback)=>{subscriptions.set(table,callback);return()=>subscriptions.delete(table);},
  newActionItem:text=>({id:'new-action',text,done:false}),PRIORITY_LABEL:{},PRIORITY_COLOR:{},LABEL_COLORS:[],BLOCK_LABEL:{},BLOCK_ICON:{},BLOCK_MENU:[],
  PAGE_TEMPLATES:[{key:'blank',label:'Blank',icon:'📄',build:()=>[]}],countCards:row=>row.columns.reduce((sum,column)=>sum+column.cards.length,0),searchPages:()=>[],
 };
 const native={View:'View',Text:'Text',TextInput:'TextInput',ScrollView:'ScrollView',TouchableOpacity:'Button',ActivityIndicator:'Spinner',Modal:'Modal',Pressable:'Pressable',KeyboardAvoidingView:'Keyboard',Platform:{OS:'web'},StyleSheet:{create:value=>value,hairlineWidth:1},Alert:{alert:(...args)=>alerts.push(args)},useWindowDimensions:()=>({width:1440})};
 const navigation={goBack(){},navigate(){},push(){}};
 const params=()=>({[kind==='Page'?'pageId':kind==='Board'?'boardId':'meetingId']:routeId});
 const deps={react:React,'react-native':native,'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Icon'},
  '@react-navigation/native':{useRoute:()=>({params:params()}),useNavigation:()=>navigation,useFocusEffect:callback=>{const key=cursor;React.useEffect(()=>{focusEntries.set(key,{callback,cleanup:callback()});return()=>{focusEntries.get(key)?.cleanup?.();focusEntries.delete(key);};},[callback]);}},
  '../theme':{colors:theme,spacing:{},radius:{},typography:{},brand:{}},'../services/officeWorkspace':workspace,
  '../portal/snapshotSaveQueue':load('portal/snapshotSaveQueue.ts',{}),'../components/OfficeWriteRecovery':{__esModule:true,default:'OfficeWriteRecovery'},'../components/ErrorState':{__esModule:true,default:'ErrorState'},
  '../context/AuthContext':{useAuth:()=>({user:{id:'synthetic-actor'},profile:{full_name:'Synthetic Actor'}})},'../context/AppContext':{useAppContext:()=>({employees:[],showToast(){}})},
  '../services/notifications':{notifyUsers:async()=>{}},'../services/photoUpload':{},'../services/data/repository':{newUuid:()=> 'synthetic-uuid'},'../utils/date':{localDateISO:()=> '2026-11-01'},
  '../components/EmptyState':{__esModule:true,default:'EmptyState'},
  '../portal/useMeasuredGrid':{useMeasuredGrid:()=>({tileWidth:280,onGridLayout(){}})},
  '../portal/siteHubStyles':{siteHubStyles:value=>value,siteHubCardStyle:()=>({}),siteHubIconStyle:()=>({}),siteHubIconColor:value=>value,siteHubIconSize:value=>value,siteHubStatStyle:()=>({}),siteHubStatColor:value=>value},
  'expo-image-picker':{},'expo-document-picker':{},
 };
 const Screen=load('screens/Office'+kind+'Screen.tsx',deps,{setTimeout:callback=>{const id=nextTimer++;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:callback=>{callback();return 1;}}).default;
 const render=()=>{cursor=0;dirty=false;tree=Screen();while(effects.length)effects.shift()();return tree;};
 const settle=async()=>{for(let i=0;i<8;i++){await new Promise(resolve=>setImmediate(resolve));if(dirty)render();}return tree;};
 render();
 return{
  settle,writes,alerts,get readCount(){return readCount;},get tree(){return tree;},get afterUnmountWrites(){return afterUnmountWrites;},
  changeRead:fn=>{read=fn;},nodes:()=>flat(tree),title:()=>flat(tree).find(node=>node?.type==='TextInput'&&node.props.placeholder===({Page:'Adsız sayfa',Board:'Pano adı',Meeting:'Toplantı başlığı'}[kind])),
  refresh:()=>{if(kind==='Meeting'){for(const entry of focusEntries.values()){entry.cleanup?.();entry.cleanup=entry.callback();}}else subscriptions.get(['Page','Pages','Hub'].includes(kind)?'office_pages':['Board','Boards'].includes(kind)?'office_boards':'office_meetings')();},
  changeRoute:id=>{routeId=id;render();},flushTimers:async()=>{const scheduled=[...timers.values()];timers.clear();scheduled.forEach(callback=>callback());await settle();},
  captureRefresh:()=>subscriptions.get(['Page','Pages','Hub'].includes(kind)?'office_pages':['Board','Boards'].includes(kind)?'office_boards':'office_meetings'),
  unmount:()=>{mounted=false;for(const slot of slots)slot?.cleanup?.();},
 };
}

function entryResponse(kind,title='Confirmed entry record'){
 if(kind==='Hub')return{stats:{pages:7,boards:3,openCards:4,meetings:5,openActions:2},pages:[sample('Page','entry-a',title)]};
 return[sample({Pages:'Page',Boards:'Board',Meetings:'Meeting'}[kind],'entry-a',title)];
}
for(const kind of ['Pages','Boards','Meetings','Hub']){
 test('Office'+kind+' entry reports a failed initial read without empty success and permits read-only retry',async()=>{
  const f=fixture(kind,async()=>{throw Error('Synthetic office entry read failed');});await f.settle();
  const error=f.nodes().find(node=>node?.type==='ErrorState');assert(error);assert.match(error.props.message,/entry read failed/);
  assert.equal(f.nodes().some(node=>node?.type==='Spinner'||node?.type==='EmptyState'||node?.type?.name==='Pill'),false);
  f.changeRead(async()=>entryResponse(kind));error.props.onRetry();await f.settle();assert(f.nodes().includes('Confirmed entry record'));assert.equal(f.nodes().some(node=>node?.type==='ErrorState'),false);assert.deepEqual(f.writes,[]);
  if(kind==='Hub')assert(f.nodes().some(node=>node?.props?.label==='7 Sayfa'));
 });
 test('Office'+kind+' refresh failure preserves the confirmed rows and shows a retryable error',async()=>{
  const f=fixture(kind,async()=>entryResponse(kind));await f.settle();f.changeRead(async()=>{throw Error('Synthetic refresh failed');});f.refresh();await f.settle();
  assert(f.nodes().includes('Confirmed entry record'));const error=f.nodes().find(node=>node?.type==='ErrorState');assert(error);assert.match(error.props.message,/Son doğrulanmış görünüm korunuyor/);
  f.changeRead(async()=>entryResponse(kind,'Freshly confirmed record'));error.props.onRetry();await f.settle();assert(f.nodes().includes('Freshly confirmed record'));assert(!f.nodes().includes('Confirmed entry record'));assert.deepEqual(f.writes,[]);
 });
 test('Office'+kind+' deferred older reads cannot replace a newer confirmed view or report an obsolete error',async()=>{
  const f=fixture(kind,async()=>entryResponse(kind));await f.settle();const old=deferred();f.changeRead(()=>old.promise);f.refresh();await f.settle();f.changeRead(async()=>entryResponse(kind,'Latest confirmed view'));f.refresh();await f.settle();
  assert(f.nodes().includes('Latest confirmed view'));old.reject(Error('Obsolete request failed'));await f.settle();assert(f.nodes().includes('Latest confirmed view'));assert.equal(f.nodes().some(node=>node?.type==='ErrorState'),false);assert.deepEqual(f.writes,[]);
 });
 test('Office'+kind+' delayed response after unmount updates no state',async()=>{
  const pending=deferred(),f=fixture(kind,()=>pending.promise);await f.settle();f.unmount();pending.resolve(entryResponse(kind));await f.settle();assert.equal(f.afterUnmountWrites,0);assert.deepEqual(f.writes,[]);
 });
 test('Office'+kind+' queued subscription callback after teardown starts no request and updates no state',async()=>{
  const f=fixture(kind,async()=>entryResponse(kind));await f.settle();const queued=f.captureRefresh(),before=f.readCount;f.unmount();await queued();assert.equal(f.afterUnmountWrites,0);assert.equal(f.readCount,before);assert.deepEqual(f.writes,[]);
 });
}
const response=(kind,record)=>kind==='Page'?[record]:record;

for(const kind of ['Page','Board','Meeting']){
 test('Office'+kind+' initial read rejection releases loading and retries a read without writing',async()=>{
  const f=fixture(kind,async()=>{throw Error('Synthetic office read unavailable');});await f.settle();
  assert.equal(f.nodes().some(node=>node?.type==='Spinner'),false);
  const error=f.nodes().find(node=>node?.type==='ErrorState');assert(error);assert.match(error.props.message,/Synthetic office read unavailable/);assert.equal(typeof error.props.onRetry,'function');
  f.changeRead(async()=>response(kind,sample(kind)));error.props.onRetry();await f.settle();
  assert.equal(f.title().props.value,'Confirmed office record');assert.deepEqual(f.writes,[]);assert.equal(f.readCount,2);
 });
 test('Office'+kind+' deferred refresh cannot clear edits typed while its read is pending',async()=>{
  const f=fixture(kind,async()=>response(kind,sample(kind)));await f.settle();const pending=deferred();f.changeRead(()=>pending.promise);f.refresh();await f.settle();
  f.title().props.onChangeText('Draft typed during pending refresh');await f.settle();
  pending.resolve(response(kind,sample(kind,'office-a','Older server snapshot')));await f.settle();
  assert.equal(f.title().props.value,'Draft typed during pending refresh');
  if(kind==='Meeting'){const save=f.nodes().find(node=>node?.type==='Button'&&flat(node).includes('Kaydet'));assert(save);await save.props.onPress();await f.settle();}
  else await f.flushTimers();
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].title,'Draft typed during pending refresh');assert.equal(f.writes[0].serverRevision,3);
 });
 test('Office'+kind+' later reads from another route cannot replace the current record',async()=>{
  const first=deferred(),second=deferred();let count=0;const f=fixture(kind,()=>++count===1?first.promise:second.promise);await f.settle();f.changeRoute('office-b');await f.settle();
  second.resolve(response(kind,sample(kind,'office-b','Current route record')));await f.settle();assert.equal(f.title().props.value,'Current route record');
  first.resolve(response(kind,sample(kind,'office-a','Obsolete route record')));await f.settle();assert.equal(f.title().props.value,'Current route record');assert.deepEqual(f.writes,[]);
 });
 test('Office'+kind+' late initial response after unmount does not write state',async()=>{
  const pending=deferred(),f=fixture(kind,()=>pending.promise);await f.settle();f.unmount();pending.resolve(response(kind,sample(kind)));await f.settle();assert.equal(f.afterUnmountWrites,0);assert.deepEqual(f.writes,[]);
 });
 test('Office'+kind+' missing existing record is a read error and never becomes a new blank editor',async()=>{
  const f=fixture(kind,async()=>kind==='Page'?[]:undefined);await f.settle();assert(f.nodes().some(node=>node?.type==='ErrorState'));assert.equal(f.title(),undefined);assert.deepEqual(f.writes,[]);
 });
}

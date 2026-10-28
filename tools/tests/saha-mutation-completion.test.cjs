'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let ts;try{ts=require('../saha-app/node_modules/typescript');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;ts=require('typescript');}
const root=path.resolve(__dirname,'../saha-app/src');
function load(file,stubs={},globals={}){
 const module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(!(name in stubs))throw Error('Unexpected '+name);return stubs[name];},console:{warn:()=>{}},setTimeout,clearTimeout,Date,Math,JSON,Object,Map,Set,Promise,Error,AbortController,...globals},{filename:file});
 return module.exports;
}
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const order={id:'synthetic-work-order',client:'Synthetic company',serviceName:'Synthetic maintenance',status:'Bekliyor'};
const customer={id:'synthetic-customer',shortName:'Synthetic company',title:'Synthetic company'};
const quote={id:'synthetic-quote',number:'TK-2026-0001',customerName:customer.shortName,title:'Synthetic quote',status:'Taslak',grandTotal:60,lines:[]};
function fixture({primaryFailure=false,notificationFailure=false,holdPrimary=false,revisionHistory=false,rejectTables=[]}={}){
 const requests=[],held=new Map(),values=[],refs=[],notices=[];
 let rejected=new Set(rejectTables);
 let rejectPrimary=primaryFailure;
 const api=load('portal/api.ts',{
  './networkPolicy':{scopedFetch:async(url,options)=>{
   if(url.includes('action=saha_bootstrap'))return {ok:true,status:200,json:async()=>({api:'vg-company/1',ok:true,csrf:'a'.repeat(64),data:{user:{id:'synthetic-native-user'},profile:{id:'synthetic-native-user',approval_status:'approved'},capabilities:{dataSource:'ubuntu'}}})};
   const args=JSON.parse(options.body).args;requests.push(args);
   const table=args.table;
   const optional=['audit_log','notifications','recent_pozes'].includes(table);
   if(optional||holdPrimary)await new Promise(resolve=>{const queue=held.get(table)||[];queue.push(resolve);held.set(table,queue);});
   const failed=rejectPrimary&&!optional||rejected.has(table)||notificationFailure&&table==='notifications';
   return {ok:!failed,status:failed?409:200,json:async()=>failed?{api:'vg-company/1',ok:false,message:'Synthetic server rejection'}:{api:'vg-company/1',ok:true,data:{...args.payload,saved:true}}};
  }},'./moduleHostBridge':{emitModuleEvent:(type,fields)=>notices.push({type,...fields})},
 });
 const write=(table,operation,payload)=>api.portalRpc('app_saha_query',{table,operation,payload});
 const repo=table=>({insert:row=>write(table,'insert',row).then(()=>row),update:(id,row)=>write(table,'update',{...row,id}),delete:id=>write(table,'delete',{id})});
 let cursor=0,refCursor=0;
 const react={createContext:()=>({Provider:'provider'}),createElement:(type,props)=>({type,props}),useEffect:()=>{},useContext:()=>{},useRef:initial=>{const index=refCursor++;return refs[index]||(refs[index]={current:initial});},useState:initial=>{
  const index=cursor++;if(!(index in values))values[index]=index===0?[order]:index===2?[quote]:index===3?[customer]:initial;
  return [values[index],next=>{values[index]=typeof next==='function'?next(values[index]):next;}];
 }};
 const notify=()=>write('notifications','insert',{id:'synthetic-notification'});
 const Context=load('context/AppContext.tsx',{
  react,'react-native':{Alert:{alert:()=>{}}},'../services/workOrderFlow':{recomputeWorkOrderCosts:x=>x,canTransition:()=>true,requiresCheckIn:()=>false},
  '../services/data/checkinsRepo':{checkinsRepo:{}},'../services/recurringTasks':{runDueTemplates:async()=>[]},'../services/quoteRevisions':{recordRevision:()=>revisionHistory?write('revision_history','insert',{id:'synthetic-revision'}):Promise.resolve({})},'../services/recentPozes':{recordQuoteLines:()=>write('recent_pozes','insert',{id:'synthetic-recents'})},
  '../data/initialData':{INITIAL_WORK_ORDERS:[],INITIAL_EMPLOYEES:[]},'../services/data':{
   isOnlineMode:()=>true,isWriteQueued:()=>false,quotesRepo:repo('quotes'),customersRepo:repo('customers'),workOrdersRepo:repo('work_orders'),employeesRepo:repo('employees'),
   auditRepo:{log:()=>write('audit_log','insert',{id:'synthetic-audit'})},serverMaxQuoteSeq:async()=>1,
  },'./AuthContext':{useAuth:()=>({session:{user:{id:'synthetic-native-user'}},isDemoMode:false})},'../utils/date':{localDateISO:()=> '2026-10-28'},
  '../services/pushNotifications':{},'../services/notifications':{Notify:{customerCreated:notify,quoteCreated:notify,quoteSent:notify,quoteAccepted:notify,workOrderStarted:notify,workOrderCompleted:notify,workOrderCreated:notify}},
  '../services/slaWatcher':{},'../utils/quoteMath':{},'../utils/quoteInsert':{insertQuoteWithNumberRetry:async(row,_prefix,deps)=>{await deps.insert(row);return row;}},'../services/quoteFlow':{canTransitionQuote:()=>true},
 });
 const render=()=>{cursor=0;refCursor=0;return Context.AppProvider({children:null}).props.value;};
 return {api,write,held,requests,notices,render,setPrimaryFailure:value=>{rejectPrimary=value;},rejectTables:tables=>{rejected=new Set(tables);},release:table=>{const queue=held.get(table);assert.ok(queue?.length,'Expected suspended '+table);held.delete(table);for(const resolve of queue)resolve();}};
}

for(const [method,args,table,notification] of [
 ['addWorkOrder',[{...order,id:'synthetic-new-work-order'}],'work_orders',false],
 ['addCustomer',[{...customer,id:'synthetic-new-customer'}],'customers',true],
 ['updateCustomer',[{...customer,shortName:'Synthetic updated company'}],'customers',false],
 ['addQuote',[{...quote,id:'synthetic-new-quote'}],'quotes',true],
 ['updateQuote',[{...quote,title:'Synthetic updated quote'}],'quotes',false],
 ['setQuoteStatus',[quote.id,'Müşteriye Gönderildi'],'quotes',true],
 ['updateWorkOrderStatus',[order.id,'Tamamlandı'],'work_orders',true],
 ['deleteCustomer',[customer.id],'customers',false],
 ['deleteWorkOrder',[order.id],'work_orders',false],
])test(method+' resolves success only after its acknowledged write and every optional server effect settle',async()=>{
 const f=fixture();let completion=0,pendingAtCompletion;
 const running=f.render()[method](...args).then(result=>{completion++;pendingAtCompletion=f.api.getPendingWrites();return result;});
 await flush();
 assert.equal(f.requests.filter(item=>item.table===table).length,1,'Exactly one primary mutation is issued');
 assert.equal(f.held.has('audit_log'),true);assert.equal(completion,0,'A success callback must not navigate while audit is writing');
 assert.equal(f.render().toast,null,'No premature success toast');
 f.release('audit_log');await flush();
 if(notification){assert.equal(completion,0,'The delayed notification remains part of the save lifecycle');f.release('notifications');await flush();}
 if(['addQuote','updateQuote'].includes(method)){assert.equal(completion,0,'Quote recent-item storage is awaited once');assert.equal(f.requests.filter(item=>item.table==='recent_pozes').length,1);f.release('recent_pozes');}
 const result=await running;
 assert.equal(result.ok,true);assert.equal(completion,1);assert.equal(pendingAtCompletion,0,'Native beforeRemove guard can allow automatic form completion');
 assert.equal(f.requests.filter(item=>item.table===table).length,1,'Completing audit/notifications never retries the primary record');
 assert.ok(f.render().toast.message);
});

test('A rejected optional notification reports saved-with-notice without resubmitting or rolling back its primary customer',async()=>{
 const f=fixture({notificationFailure:true});const running=f.render().addCustomer({...customer,id:'synthetic-saved-customer'});await flush();
 f.release('audit_log');f.release('notifications');const result=await running;
 assert.equal(result.ok,true);assert.match(result.notice,/ana kayıt kaydedildi, tekrar göndermeyin/);
 assert.equal(f.render().customers.some(row=>row.id==='synthetic-saved-customer'),true);
 assert.equal(f.requests.filter(item=>item.table==='customers').length,1);assert.equal(f.api.getPendingWrites(),0);
});
test('A primary rejection surfaces the error, rolls back its optimistic customer and never starts audit or notification writes',async()=>{
 const f=fixture({primaryFailure:true});const result=await f.render().addCustomer({...customer,id:'synthetic-rejected-customer'});
 assert.equal(result.ok,false);assert.match(result.error,/Synthetic server rejection/);
 assert.equal(f.render().customers.some(row=>row.id==='synthetic-rejected-customer'),false);
 assert.equal(f.requests.length,1);assert.equal(f.api.getPendingWrites(),0);
});

function notificationsFixture({localFailure=false}={}){
 let resolveRemote,remoteStarted=0;const cache=new Map();
 const query={select(){return query;},eq(){return query;},order(){return query;},limit(){return query;},insert(){return query;},single:async()=>({data:{id:'synthetic-notification',channels:[],created_at:'2026-10-28'},error:null}),then:resolve=>Promise.resolve({data:[],error:null}).then(resolve)};
 const Notify=load('services/notifications.ts',{
  '@react-native-async-storage/async-storage':{getItem:async key=>cache.get(key)||null,setItem:async(key,value)=>{if(localFailure)throw Error('Synthetic cache refused');cache.set(key,value);}},
  './notificationPrefs':{loadPrefs:async()=>({}),effectiveChannels:()=>[]},'./pushNotifications':{sendLocalPush:async()=>null},
  './supabase':{SUPABASE_CONFIGURED:true,getCurrentUser:async()=>({id:'synthetic-native-user'}),supabase:{from:()=>query,functions:{invoke:()=>{remoteStarted++;return new Promise(resolve=>{resolveRemote=resolve;});}}}},
 }).Notify;
 return {Notify,started:()=>remoteStarted,release:result=>{assert.equal(typeof resolveRemote,'function');resolveRemote(result||{data:{sent:1},error:null});}};
}
test('Notify waits for its delayed remote branch after its local record is ready; a delivery failure is explicit optional metadata',async()=>{
 const f=notificationsFixture();let done=false;const running=f.Notify.customerCreated('Synthetic company','synthetic-customer').then(result=>{done=true;return result;});await flush();
 assert.equal(f.started(),1);assert.equal(done,false,'The former detached notifyEveryone write is awaited');
 f.release({data:null,error:{message:'Synthetic remote unavailable'}});const result=await running;
 assert.match(result.deliveryErrors[0],/Synthetic remote unavailable/);assert.equal(done,true);
});
test('Notify waits for an in-flight remote write even when its local record fails first',async()=>{
 const f=notificationsFixture({localFailure:true});let done=false;const running=f.Notify.quoteCreated('Synthetic company','Synthetic quote','synthetic-quote').then(()=>{done=true;},error=>{done=true;throw error;});
 await flush();assert.equal(f.started(),1);assert.equal(done,false);f.release();await assert.rejects(running,/Synthetic cache refused/);assert.equal(done,true);
});

function screenFixture(name,f){
 const values=[],refs=[],alerts=[],navigations=[];let cursor=0,refCursor=0;
 const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useEffect:()=>{},useLayoutEffect:()=>{},useMemo:fn=>fn(),useRef:initial=>{const index=refCursor++;return refs[index]||(refs[index]={current:initial});},useState:initial=>{
  const index=cursor++;
  if(!(index in values))values[index]=name==='CustomerForm'&&index===0?{...customer,id:'synthetic-new-customer',shortName:'Synthetic new company',title:'Synthetic new company'}:name==='NewWorkOrder'&&index===0?customer:name==='NewWorkOrder'&&index===1?'Synthetic new maintenance':typeof initial==='function'?initial():initial;
  return [values[index],next=>{values[index]=typeof next==='function'?next(values[index]):next;}];
 }};
 const native={};for(const label of ['View','Text','TextInput','TouchableOpacity','ScrollView','KeyboardAvoidingView','ActivityIndicator','Modal','FlatList','Switch','Image'])native[label]=label;
 Object.assign(native,{StyleSheet:{create:styles=>styles,hairlineWidth:1},Platform:{OS:'web'},Alert:{alert:(...args)=>alerts.push(args)}});
 const theme=load('theme.ts');
 const stubs={
  react,'react-native':native,'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Ionicons'},
  '@react-navigation/native':{useNavigation:()=>({goBack:()=>navigations.push({pending:f.api.getPendingWrites()}),navigate:()=>{},setOptions:()=>{}}),useRoute:()=>({params:{prefill:{customerName:customer.shortName,title:'Synthetic quote',lines:[{id:'synthetic-line',quantity:1,materialPrice:50}]}}})},
  '../theme':theme,'../context/AppContext':{useAppContext:()=>({...f.render(),generateQuoteNumber:()=>quote.number}),calcQuoteTotals:()=>({subtotal:50,vatTotal:10,grandTotal:60}),calcLineTotal:()=>50},
  '../context/VisitContext':{useVisit:()=>({activeVisit:null,loading:false})},'../components/RoleGuard':{useHasRole:()=>true},
  '../context/AuthContext':{useAuth:()=>({profile:{full_name:'Synthetic employee'},user:{id:'synthetic-native-user'}})},
  '../services/data/repository':{newUuid:()=> 'synthetic-generated-id'},'../services/apollo':{},'../utils/validators':{phoneTR:()=>null,email:()=>null,vergiNo:()=>null},
  '../utils/date':{localDateISO:()=> '2026-10-28'},'../components/CustomerPicker':{default:'CustomerPicker'},'../services/workOrderFlow':{WORK_ORDER_JOB_TYPES:[],priorityColor:()=> '#000000'},
  'expo-image-picker':{},'../utils/image':{},'../services/photoUpload':{},'../utils/quoteWarnings':{quotePricingWarnings:()=>[]},'../utils/a11y':{},'../utils/money':{formatTRY:value=>String(value)},
  '../data/pozCatalog':{POZ_CATALOG:[],POZ_CATEGORIES:[]},'../services/recentPozes':{},'../data/initialData':{MATERIAL_CATALOG:[],MATERIAL_CATEGORIES:[],MATERIAL_BRANDS:[]},
  '../services/catalogOverrides':{applyOverrides:items=>items},'../services/materials':{},'../services/productPricing':{applyPricingRules:items=>items},'../utils/search':{matchesAnyField:()=>true},'../hooks/useDebouncedValue':{useDebouncedValue:value=>value},
 };
 const Component=load('screens/'+name+'Screen.tsx',stubs).default;
 const render=()=>{cursor=0;refCursor=0;return Component();};
 const nodes=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];
 const text=node=>node==null?'':typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):text(node.props?.children);
 const button=()=>{const tree=render();const found=nodes(tree).find(node=>node.type==='TouchableOpacity'&&/^(Kaydediliyor…|Müşteri Ekle|İş Emrini Oluştur|Teklifi Kaydet)$/.test(text(node)));assert.ok(found,'Primary submit button must be present');return found;};
 return {button,alerts,navigations};
}
for(const [name,table] of [['CustomerForm','customers'],['NewWorkOrder','work_orders'],['NewQuote','quotes']]){
 test(name+' ignores two immediate save clicks until primary acknowledgement and optional writes complete, then closes once at zero pending',async()=>{
  const f=fixture({holdPrimary:true}),s=screenFixture(name,f);const handler=s.button().props.onPress;
  const saving=handler(),duplicate=handler();await flush();await duplicate;
  assert.equal(f.requests.filter(row=>row.table===table).length,1,'A synchronous ref guards a click before React rerenders');
  assert.equal(s.button().props.disabled,true);assert.equal(s.button().props.accessibilityState.busy,true);assert.equal(s.navigations.length,0);
  f.release(table);await flush();assert.equal(s.navigations.length,0,'Primary ACK alone cannot close while side effects are writing');
  for(const optional of ['audit_log','notifications','recent_pozes'])if(f.held.has(optional)){f.release(optional);await flush();}
  await saving;
  assert.equal(s.navigations.length,1);assert.equal(s.navigations[0].pending,0);assert.equal(f.requests.filter(row=>row.table===table).length,1);
 });
 test(name+' keeps its form after a rejected primary write and releases the submit lock for an explicit successful retry',async()=>{
  const f=fixture({holdPrimary:true,primaryFailure:true}),s=screenFixture(name,f);let saving=s.button().props.onPress();await flush();f.release(table);await saving;
  assert.equal(s.navigations.length,0);assert.equal(s.button().props.disabled,false);assert.equal(f.held.size,0,'No optional writes after a primary rejection');
  f.setPrimaryFailure(false);saving=s.button().props.onPress();await flush();assert.equal(f.requests.filter(row=>row.table===table).length,2,'Exactly one explicit retry is permitted');
  f.release(table);await flush();for(const optional of ['audit_log','notifications','recent_pozes'])if(f.held.has(optional)){f.release(optional);await flush();}await saving;
  assert.equal(s.navigations.length,1);assert.equal(s.navigations[0].pending,0);
 });
}

test('Quote acceptance coalesces simultaneous calls and awaits both required records and all four optional effects before returning its work-order id',async()=>{
 const f=fixture({holdPrimary:true}),ctx=f.render();let done=0;
 const first=ctx.acceptQuoteAndCreateWorkOrder(quote.id,'Synthetic employee').then(id=>{done++;assert.equal(f.api.getPendingWrites(),0);return id;});
 const duplicate=ctx.acceptQuoteAndCreateWorkOrder(quote.id,'Synthetic employee');await flush();
 assert.equal(f.requests.filter(row=>row.table==='work_orders').length,1);
 f.release('work_orders');await flush();assert.equal(f.requests.filter(row=>row.table==='quotes').length,1);assert.equal(done,0);
 f.release('quotes');await flush();assert.equal(f.held.get('audit_log').length,2);assert.equal(f.held.get('notifications').length,2);assert.equal(done,0);
 f.release('audit_log');await flush();assert.equal(done,0);f.release('notifications');
 const id=await first;assert.equal(await duplicate,id);assert.match(id,/^IE-/);assert.equal(done,1);
 assert.equal(f.render().quotes.find(row=>row.id===quote.id).status,'Kabul Edildi');assert.equal(f.requests.filter(row=>row.table==='work_orders').length,1);
});
test('A failed related quote update reports the saved work order honestly and explicit retry reuses it without duplicate creation',async()=>{
 const f=fixture({holdPrimary:true,rejectTables:['quotes']});let running=f.render().acceptQuoteAndCreateWorkOrder(quote.id);
 await flush();f.release('work_orders');await flush();f.release('quotes');await flush();f.release('audit_log');f.release('notifications');
 assert.equal(await running,null,'Callers cannot claim that the quote was accepted');assert.equal(f.api.getPendingWrites(),0);
 assert.equal(f.render().quotes.find(row=>row.id===quote.id).status,'Taslak');assert.match(f.render().toast.message,/İş emri .* kaydedildi; teklif kabul durumu kaydedilemedi/);
 assert.doesNotMatch(f.render().toast.message,/Teklif kabul edildi/);
 const savedOrder=f.render().workOrders.find(row=>row.sourceQuoteId===quote.id);assert.ok(savedOrder);
 f.rejectTables([]);running=f.render().acceptQuoteAndCreateWorkOrder(quote.id);await flush();
 assert.equal(f.requests.filter(row=>row.table==='work_orders').length,1,'The existing source-linked order is reused');
 f.release('quotes');await flush();f.release('audit_log');f.release('notifications');
 assert.equal(await running,savedOrder.id);assert.equal(f.api.getPendingWrites(),0);assert.equal(f.requests.filter(row=>row.table==='work_orders').length,1);
});
test('A rejected acceptance work-order insert never changes the quote or starts optional effects',async()=>{
 const f=fixture({holdPrimary:true,rejectTables:['work_orders']});const running=f.render().acceptQuoteAndCreateWorkOrder(quote.id);await flush();f.release('work_orders');
 assert.equal(await running,null);assert.equal(f.requests.length,1);assert.equal(f.render().workOrders.some(row=>row.sourceQuoteId===quote.id),false);assert.equal(f.render().quotes[0].status,'Taslak');assert.equal(f.api.getPendingWrites(),0);
});
test('Revision flow awaits required history before updating its quote and reports a history rejection without a phantom update',async()=>{
 const f=fixture({holdPrimary:true,revisionHistory:true});let finished=false;
 const running=f.render().reviseQuote(quote).then(result=>{finished=true;assert.equal(f.api.getPendingWrites(),0);return result;});await flush();
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].table,'revision_history');assert.equal(finished,false);
 f.release('revision_history');await flush();assert.equal(f.requests.filter(row=>row.table==='quotes').length,1);f.release('quotes');await flush();f.release('audit_log');f.release('recent_pozes');assert.equal((await running).ok,true);
 const rejected=fixture({holdPrimary:true,revisionHistory:true,rejectTables:['revision_history']});const fail=rejected.render().reviseQuote(quote);await flush();rejected.release('revision_history');
 const result=await fail;assert.equal(result.ok,false);assert.match(result.error,/Revizyon geçmişi kaydedilemedi/);assert.equal(rejected.requests.length,1);assert.equal(rejected.api.getPendingWrites(),0);
});
test('The real revision helper awaits its additional table write and returns an explicit notice when the acknowledged shared snapshot is already saved',async()=>{
 const f=fixture({holdPrimary:true,rejectTables:['quote_revisions']});let done=false;
 const revisions=load('services/quoteRevisions.ts',{
  '@react-native-async-storage/async-storage':{getItem:async()=>null,setItem:(_key,value)=>f.write('revision_snapshot','insert',{value})},
  './data/repository':{isOnlineMode:()=>true},'./supabase':{supabase:{from:table=>({insert:row=>f.write(table,'insert',row).then(()=>({error:null}),error=>({error}))})}},
 });
 const running=revisions.recordRevision(quote).then(result=>{done=true;return result;});await flush();assert.equal(done,false);f.release('revision_snapshot');await flush();assert.equal(done,false,'The former detached remote branch remains awaited');
 f.release('quote_revisions');const result=await running;assert.match(result.notice,/Revizyon geçmişi kaydedildi; ek revizyon tablosu güncellenemedi/);assert.equal(f.api.getPendingWrites(),0);assert.equal(f.requests.length,2);
});
test('A revision-history read failure cannot be replaced with an empty shared history or a fabricated successful revision',async()=>{
 let writes=0;
 const revisions=load('services/quoteRevisions.ts',{
  '@react-native-async-storage/async-storage':{getItem:async()=>{throw Error('Synthetic shared history unavailable');},setItem:async()=>{writes++;}},
  './data/repository':{isOnlineMode:()=>true},'./supabase':{supabase:{from:()=>{writes++;throw Error('No mutation expected');}}},
 });
 await assert.rejects(revisions.recordRevision(quote),/Synthetic shared history unavailable/);assert.equal(writes,0);
});

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('../saha-app/node_modules/typescript'),root=path.resolve(__dirname,'../saha-app/src');
const ID='10000000-0000-4000-8000-000000000001',CUSTOMER='20000000-0000-4000-8000-000000000002',stamp='2026-11-01T08:00:00.000Z';
function load(file,deps){const filename=path.join(root,file),module={exports:{}};const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true,jsx:ts.JsxEmit.React}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(!(name in deps))throw Error('Unexpected dependency '+name);return deps[name];},console,Date,Math,JSON,Number,Error,Promise,Map,Set,Object,Array},{filename});return module.exports;}
function fixture(kind,options={}){
 let row=options.empty?null:kind==='vehicles'?{id:ID,plate:'35 QA 001',brand:'Original',created_at:stamp}:kind==='vehicle_logs'?{id:ID,vehicle_id:CUSTOMER,kind:'km',km:10,note:'Original log',created_at:stamp}:{id:ID,customer_id:CUSTOMER,customer_name:'QA Customer',amount:42,currency:'TRY',method:'cash',status:'received',received_at:stamp,receipt_no:'MBZ-QA-001',created_at:stamp},revision=3;
 let rejectRead=!!options.rejectRead,rejectWrite=!!options.rejectWrite;
 const calls=[],writes=[],cache=new Map(),key='@SahaTakip:'+kind;
 if(kind==='payments'&&row)cache.set(key,JSON.stringify([{id:ID,customerId:CUSTOMER,customerName:'QA Customer',amount:42,currency:'TRY',method:'cash',status:'received',receivedAt:stamp,receiptNo:'MBZ-QA-001',createdAt:stamp}]));
 const api={onPortalReset(){},reportPortalError:error=>error,portalRpc:async(name,args)=>{
  assert.equal(name,'app_saha_query');assert.equal(args.table,kind);calls.push(args);
  if(args.operation==='select'){if(rejectRead)throw Error('Synthetic canonical read rejected');return {data:row?[{...row}]:[],versions:row?{[ID]:revision}:{},tableVersions:{}};}
  if(rejectWrite)throw Object.assign(Error('Synthetic canonical mutation rejected'),{status:409,code:'PT409'});
  if(row&&args.versions[ID]!==revision)throw Object.assign(Error('Synthetic stale editor'),{status:409,code:'PT409'});
  if(args.operation==='delete'){if(options.zeroDelete)return {data:[],versions:{}};row=null;return {data:[{id:ID}],versions:{}};}
  const value=Array.isArray(args.rows)?args.rows[0]:args.rows;
  row={...row,...value,id:value.id||ID,created_at:row?.created_at||stamp};revision++;
  return {data:options.noAck?null:{...row},versions:{[ID]:revision},tableVersions:{}};
 }};
 const native=load('portal/nativeClient.ts',{'./api':api});
 const service=load('services/'+(kind==='vehicle_logs'?'vehicleLogs':kind)+'.ts',{'./supabase':native,'@react-native-async-storage/async-storage':{getItem:async key=>{if(options.cacheReadFailure)throw Error('Synthetic cache read failure');return cache.get(key)||null;},setItem:async(key,value)=>{writes.push({key,value});if(options.cacheFailure)throw Error('Synthetic cache write failure');cache.set(key,value);}},'./data/auditRepo':{auditRepo:{logCurrent:async()=>{}}},'./data/repository':{newUuid:()=>ID},'./vehicles':{getVehicle:async()=>({id:CUSTOMER,plate:'35 QA 001',kmTotal:1,serverRevision:7}),upsertVehicle:async()=>{if(options.vehicleSyncFailure)throw Error('Synthetic vehicle update failed');}}});
 return {service,calls,writes,row:()=>row,cache:()=>cache.get(key),revision:()=>revision,remote:patch=>{row={...row,...patch};revision++;},failRead:()=>{rejectRead=true;},rejectWrite:()=>{rejectWrite=true;}};
}
test('Vehicle editor CAS stays pinned when a newer list is read elsewhere',async()=>{
 const f=fixture('vehicles'),loaded=(await f.service.listVehicles())[0];f.remote({brand:'Other employee'});await f.service.listVehicles();
 await assert.rejects(f.service.upsertVehicle({...loaded,brand:'Dirty editor'}),e=>e.status===409);assert.equal(f.row().brand,'Other employee');assert.equal(f.calls.at(-1).versions[ID],3);
});
test('Vehicle delete uses the visible row revision after an independent refresh',async()=>{
 const f=fixture('vehicles'),loaded=(await f.service.listVehicles())[0];f.remote({brand:'Other employee'});await f.service.listVehicles();
 await assert.rejects(f.service.deleteVehicle(ID,loaded.serverRevision),e=>e.status===409);assert.equal(f.row().brand,'Other employee');
});
test('New vehicle inserts use an explicit empty snapshot and return a server revision',async()=>{
 const f=fixture('vehicles',{empty:true});const result=await f.service.upsertVehicle({...f.service.newVehicle(),id:ID,plate:'35 QA NEW'});
 assert.equal(result.plate,'35 QA NEW');assert.ok(Number.isSafeInteger(result.serverRevision));assert.equal(Object.keys(f.calls.at(-1).versions).length,0);
});
test('Payment editor never refreshes its revision before committing a dirty form',async()=>{
 const f=fixture('payments'),loaded=(await f.service.listPayments())[0];f.remote({amount:99});await f.service.listPayments();const before=f.calls.length;
 await assert.rejects(f.service.updatePayment(ID,{amount:20,serverRevision:loaded.serverRevision}),e=>e.status===409);assert.equal(f.row().amount,99);assert.equal(f.calls.length,before+1);assert.equal(f.calls.at(-1).operation,'update');assert.equal(f.calls.at(-1).versions[ID],3);
});
test('Payment update without an editor snapshot never overwrites an existing row',async()=>{
 const f=fixture('payments');await f.service.listPayments();const before=f.calls.length;
 await assert.rejects(f.service.updatePayment(ID,{amount:20}),/sürüm|yeniden aç/);assert.equal(f.calls.length,before);assert.equal(f.row().amount,42);
});
test('Rejected payment reads are errors rather than a stale financial success',async()=>{
 const f=fixture('payments');await f.service.listPayments();f.failRead();await assert.rejects(f.service.listPayments(),/Synthetic canonical read rejected/);assert.equal(f.row().amount,42);
});
test('Confirmed payment creation cannot become a failed save because cache writes fail',async()=>{
 const f=fixture('payments',{empty:true,cacheFailure:true});const result=await f.service.createPayment({id:ID,customerId:CUSTOMER,customerName:'QA Customer',amount:10,currency:'TRY',method:'cash',status:'received',receivedAt:stamp});assert.equal(result.id,ID);assert.equal(f.row().amount,10);assert.ok(result.serverRevision);
});
test('Payment creation requires a canonical row acknowledgement',async()=>{
 const f=fixture('payments',{empty:true,noAck:true});await assert.rejects(f.service.createPayment({id:ID,customerId:CUSTOMER,customerName:'QA Customer',amount:10,currency:'TRY',method:'cash',status:'received',receivedAt:stamp}),/doğrulanamadı/);
});
test('A stable payment retry acknowledges the identical row without rewriting it',async()=>{
 const f=fixture('payments'),loaded=(await f.service.listPayments())[0],version=f.revision();const saved=await f.service.createPayment(loaded);
 assert.equal(saved.id,ID);assert.equal(f.revision(),version);assert.equal(f.calls.filter(call=>call.operation!=='select').length,0);
});
test('A changed stable-id payment retry cannot overwrite a previously committed payment',async()=>{
 const f=fixture('payments'),loaded=(await f.service.listPayments())[0];await assert.rejects(f.service.createPayment({...loaded,amount:99}),/kaydedilmiş|mevcut|yeniden aç/);assert.equal(f.row().amount,42);
});
test('Zero-row payment deletion is not confirmed success',async()=>{
 const f=fixture('payments',{zeroDelete:true}),loaded=(await f.service.listPayments())[0],before=f.cache();await assert.rejects(f.service.deletePayment(ID,loaded.serverRevision),/doğrulanamadı/);assert.equal(f.cache(),before);assert.ok(f.row());
});
test('Payment delete stays pinned to the selected row after another list refresh',async()=>{
 const f=fixture('payments'),loaded=(await f.service.listPayments())[0];f.remote({amount:99});await f.service.listPayments();await assert.rejects(f.service.deletePayment(ID,loaded.serverRevision),e=>e.status===409);assert.equal(f.row().amount,99);
});
test('Rejected vehicle log creation never becomes a cached successful log',async()=>{
 const f=fixture('vehicle_logs',{empty:true,rejectWrite:true});await assert.rejects(f.service.addLog({vehicleId:CUSTOMER,kind:'km',km:20}),e=>e.status===409);assert.equal(f.row(),null);assert.equal(f.writes.length,0);
});
test('Vehicle log update retains the editor revision after an independent newer read',async()=>{
 const f=fixture('vehicle_logs'),loaded=(await f.service.listLogs())[0];f.remote({note:'Other employee'});await f.service.listLogs();await assert.rejects(f.service.updateLog({...loaded,note:'Dirty editor'}),e=>e.status===409);assert.equal(f.row().note,'Other employee');
});
test('Vehicle log rejected delete never removes its cached record',async()=>{
 const f=fixture('vehicle_logs'),loaded=(await f.service.listLogs())[0],before=f.cache();f.rejectWrite();await assert.rejects(f.service.deleteLog(ID,loaded.serverRevision),e=>e.status===409);assert.equal(f.cache(),before);assert.ok(f.row());
});
test('Confirmed log save reports optional vehicle sync failure without becoming a failed log save',async()=>{
 const f=fixture('vehicle_logs',{empty:true,vehicleSyncFailure:true});const saved=await f.service.addLog({vehicleId:CUSTOMER,kind:'km',km:20});assert.equal(saved.id,ID);assert.equal(f.row().km,20);assert.match(saved.vehicleSyncWarning,/kaydedildi/);assert.match(saved.vehicleSyncWarning,/araç/i);assert.equal(f.calls.filter(call=>call.operation==='insert').length,1);
});
test('A confirmed vehicle log is still returned when only the cache write fails',async()=>{
 const f=fixture('vehicle_logs',{empty:true,cacheFailure:true});const saved=await f.service.addLog({vehicleId:CUSTOMER,kind:'km',km:20});assert.equal(saved.id,ID);assert.equal(f.row().km,20);assert.ok(saved.serverRevision);
});

function screenFixture(screen,options={}){
 const state=[],refs=[],dependencies=[],effects=[],alerts=[],calls=[],navigation=[];let cursor=0,refCursor=0,effectCursor=0,tree;
 const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:initial=>{const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},useRef:initial=>{const i=refCursor++;return refs[i]||={current:initial};},useMemo:fn=>fn(),useEffect:(fn,deps)=>{const i=effectCursor++,key=JSON.stringify(deps);if(dependencies[i]!==key){dependencies[i]=key;effects.push(fn);}}};
 const native={StyleSheet:{create:value=>value},Platform:{OS:'web'},Alert:{alert:(title,message,buttons)=>alerts.push({title,message,buttons})}};for(const key of ['View','Text','TextInput','ScrollView','TouchableOpacity','KeyboardAvoidingView','Image','ActivityIndicator'])native[key]=key;
 const loadedPayment={id:ID,customerId:CUSTOMER,customerName:'QA Customer',amount:42,currency:'TRY',method:'cash',status:'received',receivedAt:stamp,createdAt:stamp,serverRevision:3};
 const loadedLog={id:ID,vehicleId:CUSTOMER,kind:'km',km:10,note:'Original note',createdAt:stamp,serverRevision:3};
 const paymentService={PAYMENT_METHODS:[],PAYMENT_STATUS_LABEL:{received:'Alındı'},getPayment:async()=>{calls.push({kind:'load'});if(options.rejectLoad)throw Error('Synthetic form load rejection');return loadedPayment;},createPayment:async data=>{calls.push({kind:'create',data});if(options.rejectSave)throw Error('Synthetic form save rejection');return {...data,createdAt:stamp,serverRevision:4};},updatePayment:async(id,data)=>{calls.push({kind:'update',data,id});if(options.rejectSave)throw Error('Synthetic form save rejection');return {...loadedPayment,...data,serverRevision:4};}};
 const logService={getLog:async()=>{calls.push({kind:'load'});if(options.rejectLoad)throw Error('Synthetic form load rejection');return loadedLog;},addLog:async data=>{calls.push({kind:'create',data});if(options.rejectSave)throw Error('Synthetic form save rejection');return {...data,id:ID,createdAt:stamp,vehicleSyncWarning:options.partialLog?'Kayıt kaydedildi ancak araç bilgileri güncellenemedi.':undefined};},updateLog:async data=>{calls.push({kind:'update',data});if(options.rejectSave)throw Error('Synthetic form save rejection');return {...data,serverRevision:4};}};
 let cashAttempts=0;
 const component=load('screens/'+screen+'.tsx',{react,'react-native':native,'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Ionicons'},'@react-navigation/native':{useNavigation:()=>({goBack:()=>navigation.push('back'),replace:(...args)=>navigation.push(args)}),useRoute:()=>({params:screen==='PaymentFormScreen'?{customerId:CUSTOMER,paymentId:options.edit?ID:undefined}:{vehicleId:CUSTOMER,logId:options.edit?ID:undefined}})},'../theme':{colors:{bg:{},text:{},border:{},rose:{}},spacing:{},radius:{},typography:{},brand:{}},'../services/payments':paymentService,'../services/cashRegister':{addEntry:async data=>{calls.push({kind:'cash',data});cashAttempts++;if(options.cashFirstFailure&&cashAttempts===1)throw Error('Synthetic cash rejection');}},'../services/data':{newUuid:()=>ID},'../services/notifications':{Notify:{paymentReceived:async()=>{if(options.notifyFailure)throw Error('Synthetic notification rejection');}}},'../context/AppContext':{useAppContext:()=>({customers:[{id:CUSTOMER,shortName:'QA Customer'}],workOrders:[],employees:[{id:ID,name:'QA Collector'}]})},'../services/vehicleLogs':logService,'../services/photoUpload':{uploadPhoto:async()=>{calls.push({kind:'upload'});if(options.uploadFailure)throw Error('Synthetic photo upload rejection');return '/api/saha-asset.php?bucket=photos&path=QA';}},'../utils/numInput':{parseNonNeg:value=>{if(value==='')return undefined;const n=Number(value.replace(',','.'));return Number.isFinite(n)&&n>=0?n:undefined;}},'expo-image-picker':{launchImageLibraryAsync:async()=>({canceled:false,assets:[{uri:options.imageUri||'blob:qa-receipt'}]})}});
 const flat=value=>Array.isArray(value)?value.flatMap(flat):value&&typeof value==='object'?[value,...flat(value.props?.children||[])]:[value];
 const render=()=>{cursor=0;refCursor=0;effectCursor=0;tree=component.default();};
 const nodes=()=>flat(tree);
 const action=()=>nodes().find(node=>node?.type==='TouchableOpacity'&&flat(node.props.children).includes('Kaydet'));
 const flush=async()=>{for(const fn of effects.splice(0))fn();for(let i=0;i<10;i++)await Promise.resolve();render();};
 const input=(placeholder,value)=>{const node=nodes().find(node=>node?.type==='TextInput'&&node.props.placeholder===placeholder);assert.ok(node,'Input '+placeholder+' exists');node.props.onChangeText(value);render();};
 return {render,flush,nodes,action,input,calls,alerts,navigation,clickAsync:async label=>{const node=nodes().find(node=>node?.type==='TouchableOpacity'&&flat(node.props.children).includes(label));assert.ok(node);await node.props.onPress();render();},click:label=>{const node=nodes().find(node=>node?.type==='TouchableOpacity'&&flat(node.props.children).includes(label));assert.ok(node,'Control '+label+' exists');node.props.onPress();render();}};
}
test('Payment form rejects failed edits without leaving the screen or losing entered amount',async()=>{
 const f=screenFixture('PaymentFormScreen',{edit:true,rejectSave:true});f.render();await f.flush();f.input('0.00','43');await f.action().props.onPress();f.render();assert.equal(f.navigation.length,0);assert.ok(f.nodes().includes('Synthetic form save rejection'));assert.ok(f.nodes().some(node=>node?.type==='TextInput'&&node.props.value==='43'));
});
test('Payment form sends its loaded snapshot and preserves original receipt time',async()=>{
 const f=screenFixture('PaymentFormScreen',{edit:true});f.render();await f.flush();f.input('0.00','43');await f.action().props.onPress();const write=f.calls.find(call=>call.kind==='update');assert.equal(write.data.serverRevision,3);assert.equal(write.data.receivedAt,stamp);assert.equal(f.calls.filter(call=>call.kind==='load').length,1);
});
test('Payment form failed load prevents a blank editor from becoming a write',async()=>{
 const f=screenFixture('PaymentFormScreen',{edit:true,rejectLoad:true});f.render();await f.flush();f.input('0.00','43');await f.action().props.onPress();assert.equal(f.calls.filter(call=>call.kind==='update'||call.kind==='create').length,0);assert.equal(f.navigation.length,0);assert.ok(f.nodes().includes('Synthetic form load rejection'));
});
test('Payment form cash retry keeps stable timestamp and payment identity',async()=>{
 const f=screenFixture('PaymentFormScreen',{cashFirstFailure:true});f.render();await f.flush();f.input('0.00','43');f.click('QA Collector');await f.action().props.onPress();f.render();await f.action().props.onPress();const saves=f.calls.filter(call=>call.kind==='create');assert.equal(saves.length,2);assert.equal(saves[0].data.id,saves[1].data.id);assert.equal(saves[0].data.receivedAt,saves[1].data.receivedAt);assert.equal(f.calls.filter(call=>call.kind==='cash').length,2);assert.ok(f.alerts.some(alert=>alert.title==='Kısmen tamam'));assert.ok(f.alerts.some(alert=>alert.title==='Tamam'));
});
test('Vehicle log editor keeps its loaded revision and never reloads it immediately before save',async()=>{
 const f=screenFixture('VehicleLogFormScreen',{edit:true});f.render();await f.flush();await f.action().props.onPress();const write=f.calls.find(call=>call.kind==='update');assert.equal(write.data.serverRevision,3);assert.equal(f.calls.filter(call=>call.kind==='load').length,1);
});
test('Vehicle log rejection preserves visible fields and blocks simultaneous duplicate submissions',async()=>{
 const f=screenFixture('VehicleLogFormScreen',{edit:true,rejectSave:true});f.render();await f.flush();await Promise.all([f.action().props.onPress(),f.action().props.onPress()]);f.render();assert.equal(f.calls.filter(call=>call.kind==='update').length,1);assert.equal(f.navigation.length,0);assert.ok(f.nodes().includes('Synthetic form save rejection'));
});
test('Acknowledged log with optional vehicle-sync failure cannot be inserted a second time',async()=>{
 const f=screenFixture('VehicleLogFormScreen',{partialLog:true});f.render();await f.flush();f.input('0','20');await f.action().props.onPress();f.render();await f.action().props.onPress();assert.equal(f.calls.filter(call=>call.kind==='create').length,1);assert.equal(f.navigation.length,0);assert.ok(f.alerts.some(alert=>alert.title==='Kayıt tamamlandı'&&alert.message.includes('kaydedildi')));f.alerts.find(alert=>alert.title==='Kayıt tamamlandı').buttons[0].onPress();assert.equal(f.navigation.length,1);
});
test('Failed vehicle receipt upload preserves the draft without committing a device-only URI',async()=>{
 const f=screenFixture('VehicleLogFormScreen',{edit:true,uploadFailure:true});f.render();await f.flush();f.click('Bakım/Servis');await f.clickAsync('Galeriden');await f.action().props.onPress();f.render();assert.equal(f.calls.filter(call=>call.kind==='upload').length,1);assert.equal(f.calls.filter(call=>call.kind==='update').length,0);assert.equal(f.navigation.length,0);assert.ok(f.nodes().includes('Synthetic photo upload rejection'));assert.ok(f.nodes().some(node=>node?.type==='Image'&&node.props.source.uri==='blob:qa-receipt'));
});
test('An acknowledged protected receipt URL is preserved without uploading it again',async()=>{
 const uri='/api/saha-asset.php?bucket=photos&path=already';const f=screenFixture('VehicleLogFormScreen',{edit:true,imageUri:uri});f.render();await f.flush();f.click('Bakım/Servis');await f.clickAsync('Galeriden');await f.action().props.onPress();assert.equal(f.calls.filter(call=>call.kind==='upload').length,0);assert.equal(f.calls.find(call=>call.kind==='update').data.receiptUri,uri);
});
for(const link of ['quote-to-order','order-to-quote'])test('Customer balance counts the later work-order amount once for explicit '+link+' conversion',async()=>{
 const f=fixture('payments',{empty:true}),customer={id:CUSTOMER,shortName:'QA Customer'},quote={id:'quote',customerId:CUSTOMER,status:'Kabul Edildi',grandTotal:100,...(link==='quote-to-order'?{generatedWorkOrderId:'work'}:{})},order={id:'work',client:'QA Customer',status:'Tamamlandı',quoteAmount:150,...(link==='order-to-quote'?{sourceQuoteId:'quote'}:{})};const [balance]=await f.service.computeCustomerBalances([customer],[order],[quote]);assert.equal(balance.totalInvoiced,150);
});
test('Customer balance keeps independent same-amount quote and work-order records',async()=>{
 const f=fixture('payments',{empty:true}),[balance]=await f.service.computeCustomerBalances([{id:CUSTOMER,shortName:'QA Customer'}],[{id:'work',client:'QA Customer',status:'Tamamlandı',quoteAmount:100}],[{id:'quote',customerId:CUSTOMER,status:'Kabul Edildi',grandTotal:100}]);assert.equal(balance.totalInvoiced,200);
});
for(const scenario of ['missing','unfinished','other-customer'])test('Customer balance retains accepted quote when its linked work order is '+scenario,async()=>{
 const f=fixture('payments',{empty:true}),orders=scenario==='missing'?[]:[{id:'work',client:scenario==='other-customer'?'Other Customer':'QA Customer',status:scenario==='unfinished'?'Bekliyor':'Tamamlandı',quoteAmount:150,sourceQuoteId:'quote'}];const [balance]=await f.service.computeCustomerBalances([{id:CUSTOMER,shortName:'QA Customer'}],orders,[{id:'quote',customerId:CUSTOMER,status:'Kabul Edildi',grandTotal:100,generatedWorkOrderId:'work'}]);assert.equal(balance.totalInvoiced,100);
});

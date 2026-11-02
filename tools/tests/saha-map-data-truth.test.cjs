'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process');
let ts;try{ts=require('../saha-app/node_modules/typescript');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;ts=require('typescript');}
const filename=path.resolve(__dirname,'../saha-app/src/screens/MapScreen.tsx');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function fixture({workOrders=[],staff=[],position=null,positionError=null,staffError=null,permission=true}={}){
  const state=[],effects=[],effectKeys=new Set();let cursor=0,focus,tree;
  const animations=[],dialogs=[];
  const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),
    useState:initial=>{const index=cursor++;if(!(index in state))state[index]=initial;return [state[index],next=>{state[index]=typeof next==='function'?next(state[index]):next;}];},
    useRef:initial=>{const index=cursor++;if(!(index in state))state[index]={current:initial};return state[index];},
    useEffect:callback=>{const index=cursor++;if(!effectKeys.has(index)){effectKeys.add(index);effects.push(callback);}},
    useCallback:callback=>callback};
  const dependencies={react,
    'react-native':{View:'View',Text:'Text',TouchableOpacity:'TouchableOpacity',ActivityIndicator:'ActivityIndicator',Platform:{OS:'web'},Alert:{alert:(...args)=>dialogs.push(args)},Linking:{openSettings:async()=>{}},StyleSheet:{create:s=>s}},
    'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Ionicons'},
    '@react-navigation/native':{useFocusEffect:callback=>{focus=callback;}},
    'react-native-maps':{__esModule:true,default:'MapView',Marker:'Marker'},
    '../theme':{colors:{bg:{},text:{},amber:{},border:{}},spacing:{},radius:{},typography:{},brand:{}},
    '../context/AppContext':{useAppContext:()=>({workOrders,employees:[{id:'employee-1',name:'QA Personel'}]})},
    '../context/AuthContext':{useAuth:()=>({hasPermission:()=>permission})},
    '../services/location':{requestAndGetPosition:async()=>{if(positionError)throw Error(positionError);return position;}},
    '../services/data/locationsRepo':{locationsRepo:{latestAll:async()=>{if(staffError)throw Error(staffError);return staff;},subscribeRealtime:()=>()=>{}}},
  };
  const source=process.env.VG_MAP_BASELINE==='1'?execFileSync('git',['show','HEAD:tools/saha-app/src/screens/MapScreen.tsx'],{encoding:'utf8'}):fs.readFileSync(filename,'utf8');
  const code=ts.transpileModule(source,{fileName:filename,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(!(name in dependencies))throw Error('Unexpected dependency '+name);return dependencies[name];},console,Date,Number,setInterval:()=>1,clearInterval(){}},{filename});
  const render=()=>{cursor=0;tree=module.exports.default();return tree;};
  const nodes=()=>{const walk=value=>Array.isArray(value)?value.flatMap(walk):value&&typeof value==='object'?[value,...walk(value.props?.children||[])]:[value];return walk(tree);};
  const text=()=>nodes().filter(x=>typeof x==='string'||typeof x==='number').join('');
  const markers=()=>nodes().filter(x=>x?.type==='Marker');
  return {render,nodes,text,markers,dialogs,async mount(){render();for(const effect of effects)effect();focus?.();await flush();render();},animations};
}

test('Map never fabricates work-order coordinates and accurately counts unfinished orders',async()=>{
  const f=fixture({workOrders:[
    {id:'active',client:'QA Active Customer',serviceName:'QA Work',status:'Bekliyor'},
    {id:'done',client:'QA Completed Customer',status:'Tamamlandı'},
    {id:'cancelled',client:'QA Cancelled Customer',status:'İptal'},
    {id:'billed',client:'QA Billed Customer',status:'Faturalandırıldı'},
  ]});await f.mount();
  assert.equal(f.markers().length,0,'Names/list positions must never become geographic markers');
  assert.ok(f.text().includes('1 iş emrinin doğrulanmış konumu yok; haritada gösterilmedi.'));
  assert.equal(f.text().includes('4 iş emrinin'),false,'Finished/cancelled/billed orders are not active');
  const map=f.nodes().find(x=>x?.type==='MapView');assert.equal(map.props.initialRegion.latitude,38.4192,'A default viewport is allowed without claiming an order location');
});

test('Map renders only finite in-range staff coordinates and preserves legitimate zero coordinates',async()=>{
  const stamp=new Date().toISOString();
  const f=fixture({staff:[
    {userId:'zero',employeeId:'employee-1',lat:0,lng:0,recordedAt:stamp},
    {userId:'valid',lat:38.41,lng:27.12,recordedAt:stamp},
    {userId:'nan',lat:NaN,lng:27,recordedAt:stamp},
    {userId:'range',lat:91,lng:27,recordedAt:stamp},
    {userId:'infinity',lat:38,lng:Infinity,recordedAt:stamp},
    {userId:'string',lat:'38',lng:27,recordedAt:stamp},
  ]});await f.mount();
  assert.deepEqual(f.markers().map(marker=>[marker.props.coordinate.latitude,marker.props.coordinate.longitude]),[[0,0],[38.41,27.12]]);
  assert.ok(f.text().includes('4 personel konumu geçersiz olduğu için haritada gösterilmedi.'));
});

test('Map handles rejected personal and staff location reads with visible errors and clears its spinner',async()=>{
  const f=fixture({positionError:'QA cihaz yanıt vermiyor',staffError:'QA personel servisi reddetti'});await f.mount();
  const alerts=f.nodes().filter(x=>x?.props?.accessibilityRole==='alert');
  assert.equal(alerts.length,2);assert.ok(f.text().includes('Cihaz konumu alınamadı: QA cihaz yanıt vermiyor'));
  assert.ok(f.text().includes('Personel konumları alınamadı: QA personel servisi reddetti'));
  assert.equal(f.nodes().some(x=>x?.type==='ActivityIndicator'),false);assert.equal(f.markers().length,0);
  const button=f.nodes().find(x=>x?.props?.accessibilityLabel==='Konumumu göster');assert.equal(button.props.disabled,false,'Read failure leaves an explicit retry available');
});

test('Map validates device position and never exposes staff positions to an unauthorized viewer',async()=>{
  const f=fixture({permission:false,position:{latitude:500,longitude:27},staff:[{userId:'private',lat:38,lng:27,recordedAt:new Date().toISOString()}]});await f.mount();
  assert.equal(f.markers().length,0);assert.ok(f.text().includes('Cihaz geçerli bir konum döndürmedi.'));
  const map=f.nodes().find(x=>x?.type==='MapView');assert.equal(map.props.showsUserLocation,false);
});

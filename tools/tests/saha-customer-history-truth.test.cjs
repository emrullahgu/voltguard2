'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('../saha-app/node_modules/typescript');

function renderCustomer(customerId){
  const customer={id:'synthetic-customer',shortName:'Sentetik Firma',title:'Sentetik Firma A.Ş.'},navigations=[],alerts=[];
  const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:initial=>[initial,()=>{}],useRef:value=>({current:value})};
  const native={StyleSheet:{create:value=>value},Platform:{OS:'web'},Alert:{alert:(...args)=>alerts.push(args)}};
  for(const name of ['View','Text','TextInput','TouchableOpacity','ScrollView','KeyboardAvoidingView','ActivityIndicator'])native[name]=name;
  const deps={react,'react-native':native,'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Ionicons'},
    '@react-navigation/native':{useNavigation:()=>({navigate:(...args)=>navigations.push(args)}),useRoute:()=>({params:customerId?{customerId}:undefined})},
    '../theme':{colors:{text:{},bg:{},border:{},indigo:{},rose:{},amber:{}},spacing:{},radius:{},typography:{},brand:{}},
    '../context/AppContext':{useAppContext:()=>({customers:[customer],addCustomer(){},updateCustomer(){}})},
    '../context/VisitContext':{useVisit:()=>({activeVisit:null,loading:false})},'../components/RoleGuard':{useHasRole:()=>true},
    '../services/data/repository':{newUuid:()=> 'new-synthetic-customer'},'../services/apollo':{isApolloConfigured:async()=>{throw Error('Sentetik Apollo servisi kapalı.');},enrichOrganization:async()=>{throw Error('Unexpected enrichment call');}},'../utils/validators':{}};
  const file=path.resolve(__dirname,'../saha-app/src/screens/CustomerFormScreen.tsx'),module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(!(name in deps))throw Error('Unexpected dependency '+name);return deps[name];},console},{filename:file});
  const tree=module.exports.default();
  const flatten=value=>Array.isArray(value)?value.flatMap(flatten):value&&typeof value==='object'?[value,...flatten(value.props?.children||[])]:[value];
  return {nodes:flatten(tree),navigations,customer,alerts,flatten};
}

test('Editing a customer never fabricates visit or service events',()=>{
  const f=renderCustomer('synthetic-customer');
  const texts=f.nodes.filter(node=>typeof node==='string');
  assert.equal(texts.includes('Ziyaret Geçmişi'),false);
  for(const event of ['Bugün 09:45','Check-in Yapıldı','22 May 2026','Teklif Sunuldu','15 May 2026','Periyodik Bakım'])assert.equal(texts.includes(event),false,event+' must come from an actual customer record');
  const history=f.nodes.find(node=>node?.props?.label==='Geçmiş');
  assert.ok(history,'The existing real customer timeline remains accessible');
  history.props.onPress();
  assert.equal(JSON.stringify(f.navigations),JSON.stringify([['CustomerHistory',{customerId:f.customer.id}]]));
});

test('A new customer has no history link or invented past events',()=>{
  const f=renderCustomer();
  assert.equal(f.nodes.some(node=>node?.props?.label==='Geçmiş'),false);
  assert.equal(f.nodes.includes('Check-in Yapıldı'),false);
});

test('Customer enrichment handles a rejected configuration read without losing the editor',async()=>{
  const f=renderCustomer('synthetic-customer');
  const action=f.nodes.find(node=>node?.type==='TouchableOpacity'&&f.flatten(node.props.children).includes("Apollo'dan Zenginleştir (telefon, sektör, adres)"));
  assert.ok(action);await action.props.onPress();
  assert.equal(JSON.stringify(f.alerts),JSON.stringify([['Apollo hatası','Sentetik Apollo servisi kapalı.']]));
  assert.equal(f.navigations.length,0);
});

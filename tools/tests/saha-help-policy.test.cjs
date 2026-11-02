'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let ts;
try { ts=require('../saha-app/node_modules/typescript'); }
catch(error) {
 if(error.code!=='MODULE_NOT_FOUND'||!error.message.includes("'../saha-app/node_modules/typescript'"))throw error;
 ts=require('typescript');
}
const root=path.resolve(__dirname,'../saha-app/src');
function load(relative,stubs={}){
 const code=ts.transpileModule(fs.readFileSync(path.join(root,relative),'utf8'),{fileName:relative,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,require:ref=>{if(ref in stubs)return stubs[ref];throw new Error('Unexpected dependency '+ref);},console,Date,Math,Map,Set,JSON,Object,Array,Error,Promise,setTimeout:()=>1,clearTimeout:()=>{}},{filename:relative});
 return module.exports;
}
function fixture(externalAI){
 const states=[],calls={ai:0,attachmentAI:0,navigation:0,picker:0};let index=0;
 const react={Fragment:'Fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),useRef:()=>({current:null}),useEffect:()=>{},useState:initial=>{
  const current=index++;if(!(current in states))states[current]=typeof initial==='function'?initial():initial;
  return [states[current],value=>{states[current]=typeof value==='function'?value(states[current]):value;}];
 }};
 const policy=load('components/sahaHelpPolicy.ts');
 const theme=load('theme.ts');
 const native={View:'View',Text:'Text',TextInput:'TextInput',TouchableOpacity:'TouchableOpacity',Modal:'Modal',ScrollView:'ScrollView',ActivityIndicator:'ActivityIndicator',StyleSheet:{create:styles=>styles},Keyboard:{addListener:()=>({remove:()=>{}})},Platform:{OS:'web'},useWindowDimensions:()=>({height:800})};
 const Component=load('components/ChatbotFAB.tsx',{
  'react':react,'react-native':native,'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:0,bottom:0})},'@expo/vector-icons':{Ionicons:'Ionicons'},'@react-navigation/native':{useNavigation:()=>({navigate:()=>{calls.navigation++;}})},'../theme':theme,
  'expo-image-picker':{launchImageLibraryAsync:async()=>{calls.picker++;return {canceled:true};}},'expo-document-picker':{getDocumentAsync:async()=>{calls.picker++;return {canceled:true};}},
  '../context/AppContext':{useAppContext:()=>({workOrders:[],customers:[],quotes:[],employees:[]})},'../context/AuthContext':{useAuth:()=>({profile:{full_name:'Synthetic Employee'},user:{email:'synthetic@example.invalid'}})},
  '../services/aiCopilot':{askCopilot:async()=>{calls.ai++;return {reply:'Synthetic configured AI response'};},askCopilotWithAttachment:async()=>{calls.attachmentAI++;return {reply:'Synthetic attachment response'};},extractQuoteDraft:text=>({text,draft:null})},
  '../services/data/repository':{newUuid:()=>''},'./MarkdownText':{default:'MarkdownText'},'../utils/image':{resizeForUpload:async()=>({})},'../portal/api':{currentPortalIdentity:()=>({capabilities:{externalAI}})},'./sahaHelpPolicy':policy,
 }).default;
 let tree;
 const render=()=>{index=0;tree=Component();return tree;};
 const flatten=node=>Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...flatten(node.props?.children||[])]:[];
 const find=predicate=>flatten(tree).find(predicate);
 const send=async text=>{find(n=>n.type==='TextInput').props.onChangeText(text);render();await find(n=>n.props.accessibilityLabel===(externalAI===true?'Asistana gönder':'Rehbere sor')).props.onPress();render();};
 render();return {states,calls,find,send};
}

test('Basic helper hides AI, file and agent controls and answers guidance without any AI call',async()=>{
 const f=fixture(false);
 assert.match(f.states[1][0].text,/temel kullanım rehberiyim/);
 assert.match(f.states[1][0].text,/bağlantısı şu anda etkin değil/);
 assert.equal(f.find(n=>['Otonom ajan','Fotoğraf ekle','PDF ekle'].includes(n.props.accessibilityLabel)),undefined);
 assert.doesNotMatch(f.find(n=>n.type==='TextInput').props.placeholder,/PDF|foto/);
 await f.send('takvim etkinliği nasıl eklenir?');
 assert.match(f.states[1].at(-1).text,/servis bağlantısı olmadan gönderilmez/);
 assert.equal(f.calls.ai,0);assert.equal(f.calls.attachmentAI,0);assert.equal(f.calls.picker,0);assert.equal(f.calls.navigation,0);
 await f.send('PDF analiz et');assert.match(f.states[1].at(-1).text,/dosya analizi ve ajan işlemleri yapmaz/);assert.equal(f.calls.ai,0);
});
test('Only an explicit true AI capability preserves the configured assistant path',async()=>{
 const disabled=fixture('true');assert.equal(disabled.find(n=>n.props.accessibilityLabel==='Otonom ajan'),undefined);
 const f=fixture(true);assert.ok(f.find(n=>n.props.accessibilityLabel==='Otonom ajan'));assert.ok(f.find(n=>n.props.accessibilityLabel==='Fotoğraf ekle'));assert.ok(f.find(n=>n.props.accessibilityLabel==='PDF ekle'));
 await f.send('Synthetic question');assert.equal(f.calls.ai,1);assert.equal(f.states[1].at(-1).text,'Synthetic configured AI response');
});
test('Account guidance uses native staff activation and never promises automatic calendar notifications',()=>{
 const {getReply}=load('components/sahaHelpPolicy.ts');
 assert.match(getReply('şifremi unuttum'),/mevcut VoltGuard çalışan hesabınızı/);
 assert.match(getReply('şifremi unuttum'),/etkinleştirme daveti/);
 assert.doesNotMatch(getReply('takvim'),/otomatik bildirim gider/);
 assert.match(getReply('bildirim'),/servis yapılandırılmadan yapılmaz/);
});

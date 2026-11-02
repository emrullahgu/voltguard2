'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let ts;try{ts=require('../saha-app/node_modules/typescript');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;ts=require('typescript');}
function fixture({hosted=true,shareToken,source}={}){
 const calls={tokens:[],shares:[],toasts:[]};
 const quote={id:'synthetic-quote',number:'QA-1',title:'Synthetic quote',status:'Taslak',date:'2026-11-01',customerName:'Synthetic customer',customerTitle:'Synthetic customer',engineer:'QA',lines:[],subtotal:100,vatTotal:20,grandTotal:120,shareToken};
 const app={quotes:[quote],toast:null,generateQuoteShareToken:id=>{calls.tokens.push(id);quote.shareToken='synthetic-token';return quote.shareToken;},showToast:(...args)=>calls.toasts.push(args)};
 const react={createElement:(type,props,...children)=>({type,props:{...props,children:children.flat()}}),useState:value=>[value,()=>{}],useLayoutEffect:()=>{}};
 const colors=new Proxy({},{get:()=>new Proxy({},{get:()=>'#123456'})}),numbers=new Proxy({},{get:()=>12});
 const dependencies={react,'react-native':{View:'View',Text:'Text',ScrollView:'Scroll',TouchableOpacity:'Button',ActivityIndicator:'Loading',Modal:'Modal',Alert:{alert(){}},Platform:{OS:hosted?'web':'ios'},StyleSheet:{create:styles=>styles},Share:{share:async payload=>{calls.shares.push(payload);return {};}}},
  'react-native-safe-area-context':{SafeAreaView:'Safe'},'@expo/vector-icons':{Ionicons:'Icon'},'@react-navigation/native':{useNavigation:()=>({setOptions(){}}),useRoute:()=>({params:{quoteId:quote.id}})},
  '../theme':{colors,spacing:numbers,radius:numbers,typography:numbers,brand:{}},'../context/AppContext':{useAppContext:()=>app,calcLineTotal:()=>({total:0})},
  '../components/EmptyState':{default:'Empty',__esModule:true},'../services/pdf':{generateAndShareQuotePdf:async()=>{}},'../services/quoteEmail':{sendQuoteEmail:async()=>({ok:false})},'../services/data/repository':{newUuid:()=>''},'../utils/date':{localDateISO:()=>''}};
 const file='QuoteDetailScreen.tsx',module={exports:{}};
 source??=fs.readFileSync(path.resolve(__dirname,'../saha-app/src/screens/'+file),'utf8');
 const code=ts.transpileModule(source,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(!(name in dependencies))throw Error('Unexpected dependency '+name);return dependencies[name];},String,Date,Math,...(hosted?{window:{VoltGuardEmployeeModules:{}}}:{})},{filename:file});
 const tree=module.exports.default(),flatten=value=>Array.isArray(value)?value.flatMap(flatten):value&&typeof value==='object'?[value,...flatten(value.props?.children||[])]:[value];
 const button=flatten(tree).find(node=>node?.type==='Button'&&flatten(node.props.children).some(value=>typeof value==='string'&&/Müşteri Kabul Linki Oluştur ve Paylaş|Kabul Linkini Tekrar Paylaş/.test(value)));
 assert.ok(button,'The real quote detail renders its natural acceptance-share control');
 return {calls,quote,press:()=>button.props.onPress()};
}

for(const shareToken of [undefined,'existing-server-token'])test('Hosted quote acceptance sharing reports unavailable without changing or exposing its token: '+(shareToken?'existing token':'new token'),async()=>{
 const f=fixture({shareToken}),before=JSON.stringify(f.quote);await f.press();
 assert.equal(f.calls.tokens.length,0,'No optimistic share-token mutation is started');assert.equal(f.calls.shares.length,0,'No unsupported acceptance URL is handed to the share API');
 assert.equal(JSON.stringify(f.quote),before);assert.equal(f.calls.toasts.length,1);assert.equal(f.calls.toasts[0][1],'error');
 assert.match(f.calls.toasts[0][0],/bu portalda kullanılamıyor/);assert.match(f.calls.toasts[0][0],/değiştirilmedi ve bağlantı paylaşılmadı/);
});

test('The hosted-only guard preserves the existing native-mobile acceptance sharing flow',async()=>{
 const f=fixture({hosted:false});await f.press();assert.equal(f.calls.tokens.length,1);assert.equal(f.calls.shares.length,1);
 assert.equal(f.calls.shares[0].url,'https://sahatakip.app/quote/synthetic-token');assert.match(f.calls.shares[0].message,/sahatakip:\/\/quote-accept\/synthetic-token/);
 assert.equal(f.calls.toasts.at(-1)[0],'Kabul linki paylaşıldı.');
});

module.exports={fixture};

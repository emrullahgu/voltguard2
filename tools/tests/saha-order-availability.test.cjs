'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let ts;try{ts=require('../saha-app/node_modules/typescript');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;ts=require('typescript');}
function screenFixture(source){
 const slots=[],alerts=[],navigation=[];let cursor=0,tree;
 const react={createElement:(type,props,...children)=>({type,props:{...props,children:children.flat()}}),useState:initial=>{
  const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;
  return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];
 }};
 const colors=new Proxy({},{get:()=>new Proxy({},{get:()=>'#123456'})}),numbers=new Proxy({},{get:()=>12});
 const dependencies={react,'react-native':{View:'View',Text:'Text',TextInput:'Input',ScrollView:'Scroll',TouchableOpacity:'Button',KeyboardAvoidingView:'Keyboard',Platform:{OS:'web'},StyleSheet:{create:styles=>styles},Alert:{alert:(...args)=>alerts.push(args)}},
  '@expo/vector-icons':{Ionicons:'Icon'},'react-native-safe-area-context':{SafeAreaView:'Safe'},'../theme':{colors,spacing:numbers,radius:numbers,typography:numbers},
  '@react-navigation/native':{useNavigation:()=>({goBack:()=>navigation.push('back')})}};
 const file='OrdFormScreen.tsx',module={exports:{}};
 source??=fs.readFileSync(path.resolve(__dirname,'../saha-app/src/screens/'+file),'utf8');
 const code=ts.transpileModule(source,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>{if(!(name in dependencies))throw Error('Unexpected dependency '+name);return dependencies[name];},Date,Math,Object,Array,String},{filename:file});
 const render=()=>{cursor=0;tree=module.exports.default();};
 const flatten=value=>Array.isArray(value)?value.flatMap(flatten):value&&typeof value==='object'?[value,...flatten(value.props?.children||[])]:[value];
 const nodes=()=>flatten(tree),input=placeholder=>nodes().find(node=>node?.type==='Input'&&node.props.placeholder===placeholder);
 const change=(placeholder,value)=>{input(placeholder).props.onChangeText(value);render();};
 const button=label=>nodes().find(node=>node?.type==='Button'&&flatten(node.props.children).includes(label));
 render();return {render,nodes,input,change,button,alerts,navigation};
}

test('The order form reports unavailable persistence before the user enters an order',()=>{
 const f=screenFixture(),notice=f.nodes().find(node=>node?.props?.accessibilityRole==='alert');
 assert.ok(notice);assert.match(notice.props.children.join(''),/sunucuya kaydedilmedi ve gönderilmedi/);
});

for(const label of ['Taslak Kaydet','Gönder'])test('Unavailable order persistence preserves the full draft and never reports success: '+label,()=>{
 const f=screenFixture();
 f.change('Müşteri adı girin','QA Sentetik Müşteri');f.change('Ürün/hizmet adı','QA Hizmet');f.change('Sipariş notu (opsiyonel)','QA korunan not');
 const before=f.nodes().filter(node=>node?.type==='Input').map(node=>node.props.value);
 f.button(label).props.onPress();f.render();
 assert.equal(f.alerts.length,1);assert.equal(f.alerts[0][0],'Sipariş kaydedilemedi');assert.match(f.alerts[0][1],/kayıt servisi henüz kullanılamıyor/);
 for(const action of f.alerts[0][2]||[])action.onPress?.();
 assert.deepEqual(f.nodes().filter(node=>node?.type==='Input').map(node=>node.props.value),before,'Every entered field stays available after dismissing the failure');
 assert.deepEqual(f.navigation,[],'Neither draft-save nor send navigates away from unsaved inputs');
 assert.equal(f.alerts.some(alert=>/Taslak Kaydedildi|Sipariş Gönderildi/.test(alert[0])),false);
});

module.exports={screenFixture};

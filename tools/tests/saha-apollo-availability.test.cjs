'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('./test-dependencies.cjs').testDependency('typescript');
const source=path.resolve(__dirname,'../saha-app/src');
function load(name,deps){const filename=path.join(source,name),module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:key=>{if(!(key in deps))throw Error('Unexpected dependency '+key);return deps[key];},console,Set,Promise,Error},{filename});return module.exports;
}
function fixture(configured){
  const states=[],refs=[],effects=[];let cursor=0,refCursor=0,effected=false,calls=0,searches=0;
  const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef:initial=>{const i=refCursor++;return refs[i]||=( {current:initial});},useCallback:callback=>callback,useEffect:fn=>{if(!effected)effects.push(fn);}};
  const service=load('portal/useServiceLoad.ts',{react});
  const native={StyleSheet:{create:value=>value}};for(const key of ['View','Text','FlatList','TextInput','TouchableOpacity','ActivityIndicator'])native[key]=key;
  const screen=load('screens/ApolloLeadsScreen.tsx',{react,'react-native':native,'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Ionicons'},'@react-navigation/native':{useNavigation:()=>({})},
    '../theme':{colors:{text:{},bg:{},border:{},amber:{},indigo:{},emerald:{}},spacing:{},radius:{},typography:{}},
    '../context/AppContext':{useAppContext:()=>({customers:[],showToast(){},addCustomer:async()=>{throw Error('Unexpected customer mutation');}})},'../services/data/repository':{newUuid:()=> 'unused'},
    '../components/EmptyState':{default:'EmptyState',__esModule:true},'../components/ErrorState':{default:'ErrorState',__esModule:true},'../portal/useServiceLoad':service,
    '../services/apollo':{isApolloConfigured:async()=>{calls++;if(configured instanceof Error)throw configured;return configured;},searchOrganizations:async()=>{searches++;return[];},searchPeople:async()=>{searches++;return[];}}});
  let tree;const render=()=>{cursor=0;refCursor=0;tree=screen.default();return tree;};
  const flatten=value=>Array.isArray(value)?value.flatMap(flatten):value&&typeof value==='object'?[value,...flatten(value.props?.children||[])]:[value];
  return {render,nodes:()=>flatten(tree),start:async()=>{for(const fn of effects)fn();effected=true;for(let i=0;i<15;i++)await Promise.resolve();},counts:()=>({calls,searches})};
}
test('Apollo configuration rejection is a retryable visible error, never an empty search success',async()=>{
  const f=fixture(Error('Sentetik dış hizmet kapalı.'));f.render();await f.start();f.render();
  const error=f.nodes().find(node=>node?.type==='ErrorState');assert.ok(error);assert.equal(error.props.message,'Sentetik dış hizmet kapalı.');
  assert.equal(f.nodes().some(node=>node?.type==='FlatList'),false);
  await error.props.onRetry();f.render();assert.equal(f.counts().calls,2);assert.equal(f.counts().searches,0);
});
test('A successful missing-key configuration retains the explicit configuration instruction',async()=>{
  const f=fixture(false);f.render();await f.start();f.render();
  assert.ok(f.nodes().includes('Apollo API anahtarı yok. Ayarlar → Harici API Anahtarları → Apollo.'));
  assert.equal(f.nodes().some(node=>node?.type==='ErrorState'),false);assert.equal(f.counts().searches,0);
});

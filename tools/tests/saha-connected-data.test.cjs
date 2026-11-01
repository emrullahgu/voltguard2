'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('../saha-app/node_modules/typescript');
const source=path.resolve(__dirname,'../saha-app/src');
function load(name,deps){const filename=path.join(source,name),module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:key=>{if(!(key in deps))throw Error('Unexpected dependency '+key);return deps[key];},console,Set,Promise,Error},{filename});return module.exports;
}
const services=['epias','ipinfo','github','unsplash','tmdb','newsapi','jsonplaceholder','dummyjson'];
function status(available=true){return Object.fromEntries(services.map(service=>[service,{label:service,configured:true,available,notice:`${service} kullanım koşulları`,private:service!=='epias'}]));}
function result(provider='github'){return{provider,source:{name:provider,url:`https://example.invalid/${provider}`},retrievedAt:'2026-11-01T10:00:00Z',items:[{name:'Sentetik test verisi'}]};}
async function flush(){for(let i=0;i<20;i++)await Promise.resolve();}
function deferred(){let resolve;const promise=new Promise(a=>{resolve=a;});return{promise,resolve};}
function fixture({role='admin',getStatus=async()=>status(),request=async service=>result(service)}={}){
  const states=[],refs=[],effects=[],resets=new Set(),calls=[],links=[];let cursor=0,refCursor=0,effected=false,tree;
  const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:initial=>{const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef:initial=>{const i=refCursor++;return refs[i]||=({current:initial});},useCallback:callback=>callback,useEffect:fn=>{if(!effected)effects.push(fn);}};
  const native={StyleSheet:{create:value=>value},Linking:{openURL:async url=>{links.push(url);}}};for(const key of ['View','Text','ScrollView','TextInput','TouchableOpacity','ActivityIndicator','Image'])native[key]=key;
  const service=load('services/connectedData.ts',{'../portal/api':{}});
  const screen=load('screens/ConnectedDataScreen.tsx',{react,'react-native':native,'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},
    '../theme':{colors:{text:{},bg:{},border:{},indigo:{},rose:{}},spacing:{},radius:{},typography:{}},'../context/AuthContext':{useAuth:()=>({profile:{role}})},
    '../portal/api':{onPortalReset:fn=>{resets.add(fn);return()=>resets.delete(fn);}},
    '../services/connectedData':{CONNECTED_DATA_SERVICES:services,connectedDataParams:service.connectedDataParams,getConnectedDataStatus:getStatus,requestConnectedData:(...args)=>{calls.push(args);return request(...args);}}});
  const flatten=value=>Array.isArray(value)?value.flatMap(flatten):value&&typeof value==='object'?[value,...flatten(value.props?.children||[])]:[value];
  const render=()=>{cursor=0;refCursor=0;tree=screen.default();return tree;},nodes=()=>flatten(tree),byLabel=label=>nodes().find(node=>node?.props?.accessibilityLabel===label);
  return {render,nodes,byLabel,calls,links,start:async()=>{for(const fn of effects)fn();effected=true;await flush();},reset:()=>{for(const fn of resets)fn();},
    select:label=>{byLabel(label).props.onPress();render();},input:(label,value)=>{byLabel(label).props.onChangeText(value);render();},run:()=>byLabel('Seçili veri kaynağını sorgula').props.onPress()};
}
test('Data tools load status only and keep unconfigured/unavailable sources disabled',async()=>{
  const f=fixture({getStatus:async()=>status(false)});f.render();await f.start();f.render();
  assert.equal(f.calls.length,0);assert.equal(f.byLabel('Seçili veri kaynağını sorgula').props.disabled,true);f.run();await flush();assert.equal(f.calls.length,0);assert.ok(f.nodes().includes('Kullanıma kapalı'));
});
test('A non-admin employee can inspect EPİAŞ but cannot send private laboratory queries',async()=>{
  const f=fixture({role:'engineer'});f.render();await f.start();f.render();assert.equal(f.byLabel('Seçili veri kaynağını sorgula').props.disabled,false);
  f.select('GitHub · depo bilgisi');assert.equal(f.byLabel('Seçili veri kaynağını sorgula').props.disabled,true);assert.ok(f.nodes().includes('Bu sorgu için yönetici yetkisi gerekiyor.'));
  f.run();await flush();assert.equal(f.calls.length,0);
});
test('A configured NewsAPI development key does not turn an unavailable production source into success',async()=>{
  const next=status();next.newsapi.available=false;next.newsapi.notice='Ücretsiz geliştirme planı üretimde kullanılamaz.';
  const f=fixture({getStatus:async()=>next});f.render();await f.start();f.render();f.select('NewsAPI · haber arama');f.input('Haber arama sözcüğü','güneş enerjisi');
  assert.ok(f.nodes().includes(next.newsapi.notice));assert.equal(f.byLabel('Seçili veri kaynağını sorgula').props.disabled,true);assert.equal(f.calls.length,0);
});
test('TMDB credits use the unchanged approved local logo and a prominent endorsement notice without a query',async()=>{
  const f=fixture({getStatus:async()=>status(false)});f.render();await f.start();f.render();
  assert.equal(f.byLabel('TMDB logosu'),undefined);f.select('TMDB · film arama');
  const logo=f.byLabel('TMDB logosu');assert.ok(logo);assert.equal(logo.type,'Image');assert.equal(logo.props.source.uri,'/assets/tmdb-logo.svg');assert.equal(logo.props.resizeMode,'contain');
  assert.ok(f.nodes().includes('Hakkında ve kaynakça · TMDB'));assert.ok(f.nodes().includes('This product uses the TMDB API but is not endorsed or certified by TMDB.'));assert.ok(f.nodes().includes('tmdb kullanım koşulları'));
  f.byLabel('TMDB resmi sitesini aç').props.onPress();await flush();assert.deepEqual(f.links,['https://www.themoviedb.org']);assert.equal(f.calls.length,0);
  const asset=fs.readFileSync(path.resolve(__dirname,'../../assets/tmdb-logo.svg'));
  assert.equal(require('node:crypto').createHash('sha256').update(asset).digest('hex'),'8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c');
});
test('TMDB credits remain visible while a retained TMDB result is shown after choosing another service',async()=>{
  const f=fixture();f.render();await f.start();f.render();f.select('TMDB · film arama');f.input('Film arama sözcüğü','Sentetik film');f.run();await flush();f.render();f.select('GitHub · depo bilgisi');
  assert.ok(f.byLabel('TMDB logosu'));assert.ok(f.nodes().includes('This product uses the TMDB API but is not endorsed or certified by TMDB.'));assert.equal(f.calls.length,1);
});
test('Query rejection retains form fields and never fabricates a result or retries',async()=>{
  const f=fixture({request:async()=>{throw Error('Sentetik kota hatası');}});f.render();await f.start();f.render();f.select('IPinfo · IP konumu');f.input('Genel IP adresi','8.8.8.8');f.run();await flush();f.render();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'ipinfo');assert.equal(f.calls[0][1].ip,'8.8.8.8');assert.equal(f.byLabel('Genel IP adresi').props.value,'8.8.8.8');assert.ok(f.nodes().includes('Sentetik kota hatası'));
  assert.equal(f.nodes().some(node=>node?.props?.accessibilityLabel==='Veri kaynağını aç'),false);
});
test('An explicit query has one request and keeps source/parameters attached to its result',async()=>{
  const pending=deferred(),f=fixture({request:()=>pending.promise});f.render();await f.start();f.render();f.select('GitHub · depo bilgisi');f.run();f.run();assert.equal(f.calls.length,1);f.render();
  assert.equal(f.byLabel('IPinfo · IP konumu').props.disabled,true);pending.resolve(result());await flush();f.render();f.select('DummyJSON · sentetik ürünler');
  assert.ok(f.nodes().includes('GitHub · depo bilgisi'));assert.ok(f.nodes().some(node=>typeof node==='string'&&node.includes('owner: public-apis')));
  assert.ok(f.nodes().some(node=>typeof node==='string'&&node.includes('Sentetik test verisi')));assert.ok(f.nodes().includes('Bu kaynak sentetik örnek veri döndürür. Sonuçlar şirket kaydı olarak kaydedilmez.'));
});
test('Reset clears private query fields and discards late results from the previous session',async()=>{
  const pending=deferred(),f=fixture({request:()=>pending.promise});f.render();await f.start();f.render();f.select('IPinfo · IP konumu');f.input('Genel IP adresi','8.8.8.8');f.run();f.reset();pending.resolve(result('ipinfo'));await flush();f.render();
  assert.equal(f.byLabel('Genel IP adresi').props.value,'');assert.equal(f.byLabel('Seçili veri kaynağını sorgula').props.disabled,true);assert.equal(f.nodes().some(node=>node?.props?.accessibilityLabel==='Veri kaynağını aç'),false);
});
test('Parameter validation allows only each selected service contract and rejects malformed dates',()=>{
  const s=load('services/connectedData.ts',{'../portal/api':{}}),plain=value=>JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(s.connectedDataParams('newsapi',{q:' güneş enerjisi ',apiKey:'never-send',country:'tr'})),{q:'güneş enerjisi'});
  assert.deepEqual(plain(s.connectedDataParams('github',{owner:'openai',repo:'example',q:'never-send'})),{owner:'openai',repo:'example'});
  assert.deepEqual(plain(s.connectedDataParams('dummyjson',{limit:'5'})),{limit:'5'});
  assert.deepEqual(plain(s.connectedDataParams('dummyjson',{limit:'20'})),{limit:'20'});
  for(const date of ['2026-02-30','2026-13-01','not-a-date'])assert.throws(()=>s.connectedDataParams('epias',{date}),/tarih/);
  assert.throws(()=>s.connectedDataParams('ipinfo',{ip:'https://attacker.invalid'}),/IP/);assert.throws(()=>s.connectedDataParams('github',{owner:'../bad',repo:'x'}),/GitHub/);
  assert.throws(()=>s.connectedDataParams('unsplash',{q:'x'.repeat(101)}),/100/);for(const limit of ['1','4','21','10000'])assert.throws(()=>s.connectedDataParams('jsonplaceholder',{limit}),/5–20/);
});
test('Private data service uses guarded GET query transport and verifies source URLs',async()=>{
  const calls=[],portal={bootstrapPortal:async()=>{calls.push(['bootstrap']);},transport:async(...args)=>{calls.push(args);return args[0]==='status'?{services:status()}:result(args[0]);}};
  const s=load('services/connectedData.ts',{'../portal/api':portal});await s.getConnectedDataStatus();await s.requestConnectedData('unsplash',{q:'solar panels',apiKey:'do-not-forward'});
  const call=calls[3];assert.equal(call[0],'unsplash');assert.equal(call[1],undefined);assert.equal(call[2],'/api/integrations.php');assert.equal(call[3],'vg-integrations/1');assert.deepEqual(JSON.parse(JSON.stringify(call[5])),{q:'solar panels'});
  portal.transport=async()=>({...result(),source:{name:'Unsafe',url:'javascript:alert(1)'}});await assert.rejects(s.requestConnectedData('github',{owner:'x',repo:'x'}),/yanıtı doğrulanamadı/);
  portal.transport=async()=>({services:{}});await assert.rejects(s.getConnectedDataStatus(),/durumu doğrulanamadı/);
});

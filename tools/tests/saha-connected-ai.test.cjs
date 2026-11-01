'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('../saha-app/node_modules/typescript');
const source=path.resolve(__dirname,'../saha-app/src');
function load(name,deps){const filename=path.join(source,name),module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:key=>{if(!(key in deps))throw Error('Unexpected dependency '+key);return deps[key];},console,Set,Promise,Error},{filename});return module.exports;
}
const providers=['gemini','groq','openrouter','cloudflare'];
function status(configured=true){return Object.fromEntries(providers.map(provider=>[provider,{provider,label:provider,configured,model:`fixture-${provider}`,privacyUrl:`https://example.invalid/${provider}`,notice:`${provider} veri kullanımı açıklaması`}]));}
function reply(provider='gemini',text='Sentetik teknik yanıt'){return{text,provider,model:'fixture-model',generatedAt:'2026-11-01T10:00:00Z',truncated:false,usage:{inputTokens:10,outputTokens:5,totalTokens:15}};}
async function flush(){for(let i=0;i<20;i++)await Promise.resolve();}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function fixture({getStatus=async()=>status(),send=async()=>reply()}={}){
  const states=[],refs=[],effects=[],resetters=new Set(),calls=[];let cursor=0,refCursor=0,effected=false,tree;
  const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef:initial=>{const i=refCursor++;return refs[i]||=({current:initial});},useCallback:callback=>callback,useEffect:fn=>{if(!effected)effects.push(fn);}};
  const native={StyleSheet:{create:value=>value},Linking:{openURL:async()=>{}}};for(const key of ['View','Text','ScrollView','TextInput','TouchableOpacity','ActivityIndicator'])native[key]=key;
  const screen=load('screens/ConnectedAiScreen.tsx',{react,'react-native':native,'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},
    '../theme':{colors:{text:{},bg:{},border:{},indigo:{},rose:{}},spacing:{},radius:{},typography:{}},
    '../portal/api':{onPortalReset:fn=>{resetters.add(fn);return()=>resetters.delete(fn);}},
    '../services/connectedAi':{CONNECTED_AI_PROVIDERS:providers,getConnectedAiStatus:getStatus,sendConnectedAi:(...args)=>{calls.push(args);return send(...args);}}});
  const flatten=value=>Array.isArray(value)?value.flatMap(flatten):value&&typeof value==='object'?[value,...flatten(value.props?.children||[])]:[value];
  const render=()=>{cursor=0;refCursor=0;tree=screen.default();return tree;};
  const nodes=()=>flatten(tree),byLabel=label=>nodes().find(node=>node?.props?.accessibilityLabel===label);
  const cleanups=[];
  return {render,nodes,byLabel,calls,start:async()=>{for(const fn of effects)cleanups.push(fn());effected=true;await flush();},
    reset:()=>{for(const fn of resetters)fn();},unmount:()=>{for(const fn of cleanups)fn?.();},
    input:value=>{byLabel('Yapay zekâ iletisi').props.onChangeText(value);render();},
    send:()=>byLabel('Seçili sağlayıcıya gönder').props.onPress(),
    select:label=>{byLabel(label).props.onPress();render();}};
}

test('AI provider status never triggers inference, and missing server credentials disable sending',async()=>{
  const f=fixture({getStatus:async()=>status(false)});f.render();await f.start();f.render();f.input('Sentetik soru');
  assert.equal(f.byLabel('Seçili sağlayıcıya gönder').props.disabled,true);assert.equal(f.calls.length,0);
  f.send();await flush();assert.equal(f.calls.length,0);
  assert.ok(f.nodes().includes('Sunucu ayarı gerekiyor'));assert.equal(f.nodes().includes('Bağlandı'),false);
});
test('Status loading errors stay visible and retry preserves an unsent prompt',async()=>{
  let attempts=0;const f=fixture({getStatus:async()=>{if(++attempts===1)throw Error('Sentetik durum hatası');return status();}});
  f.render();await f.start();f.render();f.input('Kaybolmaması gereken taslak');
  assert.ok(f.nodes().includes('Sentetik durum hatası'));assert.equal(f.byLabel('Seçili sağlayıcıya gönder').props.disabled,true);
  f.byLabel('Bağlantı durumunu yenile').props.onPress();await flush();f.render();
  assert.equal(attempts,2);assert.equal(f.byLabel('Yapay zekâ iletisi').props.value,'Kaybolmaması gereken taslak');
  assert.equal(f.byLabel('Seçili sağlayıcıya gönder').props.disabled,false);assert.equal(f.calls.length,0);
});
test('Quota errors retain the draft, show failure and never retry or switch providers',async()=>{
  const f=fixture({send:async()=>{throw Error('Kullanım sınırına ulaşıldı.');}});f.render();await f.start();f.render();f.input('Sadece benim yazdığım metin');f.send();await flush();f.render();
  assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0],['gemini','Sadece benim yazdığım metin']);
  assert.equal(f.byLabel('Yapay zekâ iletisi').props.value,'Sadece benim yazdığım metin');assert.ok(f.nodes().includes('Kullanım sınırına ulaşıldı.'));
  assert.equal(f.nodes().some(node=>node==='Son yanıt · '),false);assert.equal(f.byLabel('Seçili sağlayıcıya gönder').props.disabled,false);
});
test('An immediate double press produces one explicit send and preserves a draft edited during inference',async()=>{
  const pending=deferred(),f=fixture({send:()=>pending.promise});f.render();await f.start();f.render();f.input('İlk soru');
  f.send();f.send();assert.equal(f.calls.length,1);f.render();assert.equal(f.byLabel('Cloudflare Workers AI').props.disabled,true);
  f.input('İkinci taslak');pending.resolve(reply());await flush();f.render();
  assert.equal(f.byLabel('Yapay zekâ iletisi').props.value,'İkinci taslak');assert.ok(f.nodes().includes('Sentetik teknik yanıt'));assert.equal(f.calls.length,1);
});
test('Successful sending clears only the submitted draft and labels the actual source model',async()=>{
  const f=fixture({send:async provider=>reply(provider,'<script>yalın metin</script>')});f.render();await f.start();f.render();f.select('Groq');f.input('Tek soru');f.send();await flush();f.render();
  assert.deepEqual(f.calls,[['groq','Tek soru']]);assert.equal(f.byLabel('Yapay zekâ iletisi').props.value,'');
  assert.ok(f.nodes().includes('<script>yalın metin</script>'));assert.ok(f.nodes().includes('fixture-model'));assert.ok(f.nodes().includes('Groq'));
  assert.equal(f.nodes().some(node=>node?.props?.dangerouslySetInnerHTML),false);
});
test('Session reset clears prompts/results and discards a late inference response',async()=>{
  const pending=deferred(),f=fixture({send:()=>pending.promise});f.render();await f.start();f.render();f.input('Eski hesabın taslağı');f.send();
  f.reset();pending.resolve(reply('gemini','Eski hesabın yanıtı'));await flush();f.render();
  assert.equal(f.byLabel('Yapay zekâ iletisi').props.value,'');assert.equal(f.nodes().includes('Eski hesabın yanıtı'),false);
  assert.equal(f.byLabel('Seçili sağlayıcıya gönder').props.disabled,true);assert.equal(f.calls.length,1);
});
test('A late status result cannot repopulate provider availability after session reset',async()=>{
  const pending=deferred(),f=fixture({getStatus:()=>pending.promise});f.render();await f.start();f.input('Eski taslak');f.reset();pending.resolve(status());await flush();f.render();
  assert.equal(f.byLabel('Yapay zekâ iletisi').props.value,'');assert.ok(f.nodes().includes('Çalışan oturumu değişti. Ekranı yeniden açın.'));assert.equal(f.nodes().includes('Sunucu ayarı mevcut'),false);
});
test('Dedicated service uses the authenticated portal transport and validates provider response identity',async()=>{
  const calls=[],portal={bootstrapPortal:async()=>{calls.push(['bootstrap']);},transport:async(...args)=>{calls.push(args);return args[0]==='status'?{ai:status()}:reply(args[1].provider);}};
  const service=load('services/connectedAi.ts',{'../portal/api':portal});
  const result=await service.getConnectedAiStatus();assert.equal(result.gemini.configured,true);
  await service.sendConnectedAi('groq','Yalnızca açık ileti');
  assert.equal(calls[1][0],'status');assert.equal(calls[1][2],'/api/integrations.php');assert.equal(calls[1][3],'vg-integrations/1');
  const send=calls[3];assert.equal(send[0],'ai_chat');assert.deepEqual(JSON.parse(JSON.stringify(send[1])),{provider:'groq',prompt:'Yalnızca açık ileti',maxOutputTokens:1024});
  portal.transport=async()=>reply('gemini');await assert.rejects(service.sendConnectedAi('groq','x'),/yanıtı doğrulanamadı/);
});
test('Dedicated service rejects malformed status and invalid prompts before inference',async()=>{
  let sent=0;const service=load('services/connectedAi.ts',{'../portal/api':{bootstrapPortal:async()=>{},transport:async()=>{sent++;return{ai:{}};}}});
  await assert.rejects(service.getConnectedAiStatus(),/durumu doğrulanamadı/);assert.equal(sent,1);
  for(const args of [['unknown','x'],['groq',''],['groq','ğ'.repeat(12001)]])await assert.rejects(service.sendConnectedAi(...args),/12.000/);
  assert.equal(sent,1);
});

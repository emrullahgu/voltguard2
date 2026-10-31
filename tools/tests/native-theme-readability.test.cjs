'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('../saha-app/node_modules/typescript');

function theme(hosted=false){
 const file=path.resolve(__dirname,'../saha-app/src/theme.ts');
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,...(hosted?{window:{VoltGuardEmployeeModules:{}}}: {})});
 return module.exports;
}
const rgb=value=>value.slice(1).match(/\w\w/g).map(channel=>parseInt(channel,16));
const luminance=channels=>channels.map(channel=>{channel/=255;return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;}).reduce((sum,channel,index)=>sum+channel*[.2126,.7152,.0722][index],0);
const contrast=(foreground,background)=>{const a=luminance(rgb(foreground)),b=luminance(background);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
const composite=(foreground,background,alpha)=>rgb(foreground).map((channel,index)=>channel*alpha+rgb(background)[index]*(1-alpha));

test('All shared text tiers are readable on every normal surface in both themes',()=>{
 const tokens=theme();
 for(const mode of ['light','dark']){
  const palette=tokens.getThemeTokens(mode);
  for(const [name,color] of Object.entries(palette.text))for(const [surface,background] of Object.entries(palette.bg)){
   assert.ok(contrast(color,rgb(background))>=4.5,`${mode} ${name} on ${surface}`);
  }
 }
});

test('Semantic status text keeps normal-text contrast after its tinted badge is composited',()=>{
 const tokens=theme();
 const tints={accent:['#f59e0b',.12],info:['#1e3a5f',.12],warning:['#fbbf24',.12],danger:['#f43f5e',.12]};
 for(const mode of ['light','dark'])for(const background of Object.values(tokens.getThemeTokens(mode).bg)){
  for(const [name,foreground] of Object.entries(tokens.getStatusTextTokens(mode))){
   const [tint,alpha]=tints[name];
   assert.ok(contrast(foreground,composite(tint,background,alpha))>=4.5,`${mode} ${name} on ${background}`);
  }
 }
});

test('Hosted foregrounds stay live CSS bindings while filled controls retain their existing palette',()=>{
 const tokens=theme(true);
 for(const mode of ['light','dark']){
  const palette=tokens.getDisplayTokens(mode);
  assert.match(palette.text.primary,/^var\(--vg-module-text-primary,/);
  assert.match(palette.text.faint,/^var\(--vg-module-text-faint,/);
 }
 for(const name of ['emerald','indigo','blue','amber','rose'])assert.match(tokens.colors[name].foreground,/^var\(--vg-module-/);
 assert.equal(tokens.colors.emerald.default,'#b45309');
 assert.equal(tokens.colors.indigo.default,'#0a1628');
});

test('Imported theme settings use the site theme without reloading or replacing the active form',async()=>{
 const file=path.resolve(__dirname,'../saha-app/src/themeMode.ts');
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 function settings(hosted,site){
  const calls={themes:[],reloads:0,saved:[],events:[]},module={exports:{}};
  const dependencies={react:{},'react-native':{Appearance:{getColorScheme:()=> 'dark'},Platform:{OS:'web'}},'@react-native-async-storage/async-storage':{setItem:async(...args)=>calls.saved.push(args)},'./theme':{brand:{},__activeThemeMode:'dark',THEME_STORAGE_KEY:'source-theme',getThemeTokens:()=>({}),getDisplayTokens:()=>({})}};
  const document={documentElement:{dataset:{}},dispatchEvent:event=>calls.events.push(event)};
  const window={...(hosted?{VoltGuardEmployeeModules:{}}:{}),...(site?{VGTheme:{set:value=>calls.themes.push(value)}}:{}),location:{reload:()=>calls.reloads++}};
  class CustomEvent{constructor(type,init){this.type=type;this.detail=init.detail;}}
  vm.runInNewContext(code,{module,exports:module.exports,require:name=>dependencies[name],window,document,CustomEvent,localStorage:{setItem(){},removeItem(){}}});
  return {calls,document,api:module.exports};
 }
 const hosted=settings(true,true);
 await hosted.api.setThemeMode('light');await hosted.api.setThemeMode('system');
 assert.deepEqual(hosted.calls.themes,['light',null]);assert.equal(hosted.calls.reloads,0);
 assert.equal(hosted.calls.saved.length,2,'Preference writes remain explicit and awaited');
 const fallback=settings(true,false);await fallback.api.setThemeMode('light');
 assert.equal(fallback.document.documentElement.dataset.theme,'light');assert.equal(fallback.calls.events[0].type,'vg:theme');assert.equal(fallback.calls.reloads,0);
 const standalone=settings(false,false);await standalone.api.setThemeMode('light');
 assert.equal(standalone.calls.reloads,1,'Standalone source keeps its original reload behavior');
});

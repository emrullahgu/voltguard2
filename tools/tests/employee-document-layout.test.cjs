'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let ts;
try { ts = require('../saha-app/node_modules/typescript'); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; ts = require('typescript'); }
const file = path.resolve(__dirname,'../saha-app/src/portal/documentLayout.ts');
const code = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;

function fixture(route='StockHub') {
  let contentHeight=1200, header=0, raf=null, resize, mutation, disconnected=0, removed=false;
  const properties = new Map();
  const style = () => { const values=new Map(); return {getPropertyValue:key=>values.get(key)||'',setProperty:(key,value)=>values.set(key,value),removeProperty:key=>values.delete(key)}; };
  const host={dataset:{},style:{setProperty:(key,value)=>properties.set(key,value),removeProperty:key=>properties.delete(key)}};
  const frameHeight=()=>Number.parseInt(properties.get('--vg-module-content-height')||'640');
  const rect=(height,width=1000,top=100)=>({width,height,top,bottom:top+height});
  const content={style:style(),getBoundingClientRect:()=>rect(contentHeight),closest:()=>null};
  const viewport={children:[content],firstElementChild:content,getBoundingClientRect:()=>rect(frameHeight()-header,1000,100+header),closest:()=>null};
  const horizontal={children:[content],firstElementChild:content,getBoundingClientRect:()=>rect(40),closest:()=>null};
  const hidden={children:[content],firstElementChild:content,getBoundingClientRect:()=>rect(640),closest:()=>true};
  const root={isConnected:true,getBoundingClientRect:()=>rect(frameHeight()),querySelectorAll:()=>[hidden,horizontal,viewport]};
  class Resize { constructor(callback){resize=callback;}observe(){}disconnect(){disconnected++;} }
  class Mutations {constructor(callback){mutation=callback;}observe(){}disconnect(){disconnected++;} }
  const events=[],module={exports:{}};
  const window={innerHeight:1000,requestAnimationFrame:callback=>{raf=callback;return 1;},cancelAnimationFrame:()=>{raf=null;},addEventListener(){},removeEventListener(){removed=true;}};
  const getComputedStyle=node=>({visibility:'visible',overflowY:'auto',flexDirection:node===horizontal?'row':'column'});
  vm.runInNewContext(code,{module,exports:module.exports,window,getComputedStyle,ResizeObserver:Resize,MutationObserver:Mutations,console},{filename:file});
  const controller=module.exports.observeModuleDocument(root,host,route,event=>events.push(event));
  const flush=()=>{const callback=raf;raf=null;callback?.();};
  return {controller,properties,host,content,events,flush,resize:()=>{resize();flush();},mutate:()=>{mutation();flush();},setHeight:value=>{contentHeight=value;},setHeader:value=>{header=value;},get disconnected(){return disconnected;},get removed(){return removed;}};
}

test('Ordinary module content grows and shrinks the document without a phone viewport',()=>{
  const f=fixture(); f.flush();
  assert.equal(f.properties.get('--vg-module-content-height'),'1202px');
  assert.equal(f.host.dataset.moduleLayout,'document');
  assert.equal(f.content.style.getPropertyValue('flex-grow'),'0');
  f.setHeight(500); f.resize();
  assert.equal(f.properties.get('--vg-module-content-height'),'502px');
  f.setHeader(56);f.mutate();
  assert.equal(f.properties.get('--vg-module-content-height'),'558px');
  const events=f.events.length;f.resize();assert.equal(f.events.length,events,'Unchanged layout cannot create a resize feedback loop');
});

test('Workspace navigation restores its viewport and a subsequent document route can shrink again',()=>{
  const f=fixture();f.flush();
  f.controller.setRoute('WorkOrderKanban');f.flush();
  assert.equal(f.properties.has('--vg-module-content-height'),false);
  assert.equal(f.host.dataset.moduleLayout,'workspace');
  assert.equal(f.content.style.getPropertyValue('flex-grow'),'');
  f.setHeight(300);f.controller.setRoute('CustomerForm');f.flush();
  assert.equal(f.properties.get('--vg-module-content-height'),'302px');
  assert.equal(f.host.dataset.moduleLayout,'document');
});

test('Large virtualized content keeps bounded scrolling and teardown removes observers and layout state',()=>{
  const f=fixture();f.setHeight(30000);f.flush();
  assert.equal(f.properties.get('--vg-module-content-height'),'4000px');
  assert.equal(f.host.dataset.moduleLayout,'workspace');
  f.controller.disconnect();
  assert.equal(f.properties.has('--vg-module-content-height'),false);
  assert.equal(f.host.dataset.moduleLayout,undefined);
  assert.equal(f.content.style.getPropertyValue('flex-grow'),'');
  assert.ok(f.disconnected>=2);assert.equal(f.removed,true);
  const eventCount=f.events.length;f.setHeight(200);f.resize();assert.equal(f.events.length,eventCount);
});

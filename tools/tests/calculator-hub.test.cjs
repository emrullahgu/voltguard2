'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'teklif-araclari.html'), 'utf8');
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).find(code => code.includes('var technicalCalc ='));

function harness() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const el = {id, value:'', textContent:'', dataset:{}, attrs:{}, listeners:{}, disabled:false, hidden:false, options:[], tagName:'INPUT',
        setAttribute(name,value) {this.attrs[name]=String(value);}, removeAttribute(name) {delete this.attrs[name];},
        addEventListener(name,listener) {this.listeners[name]=listener;},
        closest(selector) {return selector === '.tool-panel' && id.endsWith('-request') ? element(id.slice(0,-8)) : element(id+'-field');}, appendChild(child) {this.textContent += child.textContent || '';},
        querySelector(selector) { if(selector === '.tool-share-status') return element(id+'-status'); if(selector === '.tool-result__amount') return element({'ges-panel':'ges-amount','trafo-panel':'trafo-amount','kontrol-panel':'control-amount','teknik-panel':'technical-amount'}[id]); return null; },
        querySelectorAll(selector) {
          if (selector === '.tool-download,.tool-share,.tool-request') return [element(id+'-pdf'),element(id+'-share'),element(id+'-request')];
          if (selector === 'input,select') { const prefix = { 'ges-panel':'ges-', 'trafo-panel':'trafo-', 'kontrol-panel':'control-', 'teknik-panel':'technical-' }[id]; return [...elements.values()].filter(item => prefix && item.id.startsWith(prefix) && !/-field|-label|-status|-pdf|-share$/.test(item.id)); }
          return [];
        }};
      elements.set(id,el);
    }
    return elements.get(id);
  }
  for (const match of html.matchAll(/<input\b[^>]*\bid="([^"]+)"[^>]*>/g)) element(match[1]).value = match[0].match(/\bvalue="([^"]*)"/)?.[1] || '';
  for (const match of html.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const el = element(match[1]); el.tagName='SELECT';
    el.options = [...match[2].matchAll(/<option\b[^>]*value="([^"]+)"([^>]*)>([^<]*)/g)].map(option => ({value:option[1], selected:/\bselected\b/.test(option[2]), text:option[3]}));
    el.value=(el.options.find(option=>option.selected)||el.options[0]).value;
  }
  for(const match of html.matchAll(/<label\b[^>]*for="([^"]+)"[^>]*>([^<]*)<\/label>/g)) element(match[1]+'-label').textContent=match[2];
  const document = {getElementById:element,
    querySelectorAll(selector) {return selector === '.tool-request' ? ['ges-panel','trafo-panel','kontrol-panel','teknik-panel'].map(id=>element(id+'-request')) : [];},
    querySelector(selector) {
      const label = selector.match(/^label\[for="([^"]+)"\]$/); if(label)return element(label[1]+'-label');
      if(selector === '#teknik-panel .tool-download')return element('teknik-panel-pdf');
      if(selector === '#teknik-panel .tool-request')return element('teknik-panel-request');
      return null;
    }, createElement() {return element('created-'+elements.size);}, createTextNode(text) {return {textContent:text};}};
  const context=vm.createContext({document, window:{}, Intl, Number, Math, console});
  vm.runInContext(fs.readFileSync(path.join(root,'js/calculator-config.js'),'utf8'),context);
  vm.runInContext(script.slice(0,script.indexOf('      var updates =')) + '\n globalThis.hub={parse:trNum,ges:updateGes,trafo:updateTrafo,control:updateControl,technical:technicalResult,configure:configureTechnical,tools:technicalTools,rules:technicalRules};\n}());',context);
  return {hub:context.hub, config:context.window.VoltGuardCalculatorConfig, el:element, context,
    set(values) {Object.entries(values).forEach(([id,value])=>element(id).value=String(value));},
    valid(panel) {return element(panel).dataset.calculationValid==='true';},
    blocked(panel) {return element(panel+'-pdf').disabled&&element(panel+'-share').disabled&&element(panel+'-request').disabled;}};
}

test('Calculator hub parses decimal commas and thousands, rejecting malformed and nonfinite input',()=>{
  const h=harness();
  for(const [input,expected] of [['35.000',35000],['3,50',3.5],['1.234,50',1234.5],['1500.5',1500.5],['0,95',.95],['-12,5',-12.5],['0.001',.001],['0.123',.123],[',5',.5]])assert.equal(h.hub.parse(input),expected,input);
  for(const input of ['','abc','NaN','Infinity','1,2,3','1.2,3','1 000','1e999','1e3','--2','9'.repeat(400)])assert.ok(Number.isNaN(h.hub.parse(input)),input);
});

test('GES screenshot values produce finite capacity, production and user-priced investment',()=>{
  const h=harness();h.set({'ges-bill':'15.000','ges-consumption':'35.000','ges-unit-price':'3,50','ges-area':'1.500','ges-type':'cati','ges-city':'1600','ges-cost':''});h.hub.ges();
  assert.equal(h.el('ges-amount').textContent,'26 kWp');assert.match(h.el('ges-production').textContent,/39\.520 kWh/);assert.match(h.el('ges-equipment').textContent,/48 panel.*21 kW/);
  assert.ok(h.valid('ges-panel'));assert.equal(h.blocked('ges-panel'),false);
  assert.equal(h.el('ges-panel-request').disabled,false,'A valid physical capacity can be used for a quote even without a supplied investment price');
  h.set({'ges-cost':'10.000'});h.hub.ges();assert.match(h.el('ges-amount').textContent,/260\.000/);assert.match(h.el('ges-detail').textContent,/1,9 yıl/);
  assert.doesNotMatch(h.el('ges-detail').textContent,/NaN|Infinity/);
  h.set({'ges-bill':'','ges-consumption':'50000'});h.hub.ges();assert.match(h.el('ges-detail').textContent,/272 kWp/);assert.ok(272*5.5<=1500,'Installed capacity must fit the entered roof area');
});

test('GES clears stale outputs and blocks exports for invalid inputs or missing model data',()=>{
  for(const [id,value] of [['ges-area',''],['ges-area','-10'],['ges-area','9999999999999'],['ges-bill','oops'],['ges-unit-price','1,2,3'],['ges-cost','Infinity'],['ges-consumption','0']]){
    const h=harness();h.set({'ges-unit-price':'3,50','ges-cost':'10.000'});h.hub.ges();assert.ok(h.valid('ges-panel'));
    h.set({[id]:value});h.hub.ges();assert.equal(h.valid('ges-panel'),false,id);assert.ok(h.blocked('ges-panel'));assert.equal(h.el('ges-amount').textContent,'-');
    for(const detail of ['ges-production','ges-coverage','ges-savings','ges-equipment'])assert.equal(h.el(detail).textContent,'',detail);
    assert.doesNotMatch(h.el('ges-detail').textContent,/NaN|Infinity/);
  }
  const h=harness();h.set({'ges-bill':'15000','ges-unit-price':''});h.hub.ges();assert.ok(h.blocked('ges-panel'));assert.match(h.el('ges-detail').textContent,/birim bedelini girin/);
  h.config.pricing.performanceRatio=NaN;h.hub.ges();assert.match(h.el('ges-detail').textContent,/model bilgileri/);assert.equal(h.el('ges-assumptions').textContent,'');
  const tiny=harness();tiny.set({'ges-area':'5'});tiny.hub.ges();assert.ok(tiny.blocked('ges-panel'));assert.match(tiny.el('ges-detail').textContent,/en az 1 kWp/);
});

test('All 23 technical hub tools retain valid calculations and reject malformed or out-of-domain inputs',()=>{
  const h=harness();assert.equal(Object.keys(h.hub.tools).length,23);
  for(const key of Object.keys(h.hub.tools)){
    h.set({'technical-tool':key});h.hub.configure();
    h.hub.tools[key][5].forEach((value,index)=>{if(value===null)h.set({['technical-'+['a','b','c','d'][index]]:index===3?'10000':'3,50'});});
    h.hub.technical();assert.ok(h.valid('teknik-panel'),key+' valid defaults');assert.doesNotMatch(h.el('technical-amount').textContent,/NaN|Infinity|^-$|^₺0 başlangıç bütçesi/);
    const saved=h.el('technical-a').value;
    for(const value of ['','oops','-5','Infinity','9999999999999']){
      h.set({'technical-a':value});h.hub.technical();assert.equal(h.valid('teknik-panel'),false,key+': '+value);assert.ok(h.blocked('teknik-panel'));assert.equal(h.el('technical-amount').textContent,'-');assert.equal(h.el('technical-scope').textContent,'');
    }
    h.set({'technical-a':saved});h.hub.technical();assert.ok(h.valid('teknik-panel'),key+' recovered');
  }
});

test('Project fee screenshot is rejected with units; valid prices and numerical boundaries stay explicit',()=>{
  const h=harness();h.set({'technical-tool':'project'});h.hub.configure();h.set({'technical-a':'1000','technical-b':'25','technical-c':'100','technical-d':'100'});h.hub.technical();assert.match(h.el('technical-amount').textContent,/25\.000/);
  h.set({'technical-a':'9999999999999'});h.hub.technical();assert.ok(h.blocked('teknik-panel'));assert.match(h.el('technical-detail').textContent,/Yapı alanı \(m²\).*1\.000\.000\.000/);
  h.set({'technical-a':'1000000000','technical-b':'1','technical-c':'100','technical-d':'100'});h.hub.technical();assert.ok(h.valid('teknik-panel'));
  h.set({'technical-a':'1000000001'});h.hub.technical();assert.ok(h.blocked('teknik-panel'));
  h.set({'technical-a':'1000000000','technical-b':'1000000000','technical-c':'1000000000','technical-d':'1000000000'});h.hub.technical();assert.ok(h.blocked('teknik-panel'));assert.match(h.el('technical-detail').textContent,/güvenilir bir sayısal sonuç/);
  for(const [key,id] of [['ev','technical-a'],['fire','technical-b'],['grounding','technical-c']]){h.set({'technical-tool':key});h.hub.configure();h.set({[id]:'2,5'});h.hub.technical();assert.ok(h.blocked('teknik-panel'));assert.match(h.el('technical-detail').textContent,/tam sayı/);}
});

test('Quote request revalidates a changed result and never opens a destination for invalid input',()=>{
  const h=harness();h.set({'technical-tool':'project'});h.hub.configure();h.set({'technical-b':'25'});h.hub.technical();assert.ok(h.valid('teknik-panel'));
  let opened=0;h.context.window.open=()=>{opened++;};h.context.updates=[h.hub.ges,h.hub.trafo,h.hub.control,h.hub.technical];
  const start=script.indexOf("document.querySelectorAll('.tool-request')"), end=script.indexOf('      var restoreCalculation =');
  vm.runInContext(script.slice(start,end),h.context);
  // Changing the value without firing an input event leaves an old displayed
  // result, which the request handler must still reject when invoked directly.
  h.set({'technical-a':'9999999999999'});h.el('teknik-panel-request').listeners.click();
  assert.equal(opened,0);assert.ok(h.blocked('teknik-panel'));assert.equal(h.el('technical-amount').textContent,'-');
});

test('Trafo and periodic control reject nonfinite values, missing inputs and fractional counts',()=>{
  const h=harness();h.hub.trafo();assert.equal(h.el('trafo-amount').textContent,'12.006 TL / ay');assert.ok(h.valid('trafo-panel'));
  h.set({'trafo-power':'Infinity'});h.hub.trafo();assert.ok(h.blocked('trafo-panel'));assert.equal(h.el('trafo-amount').textContent,'-');
  h.hub.control();assert.ok(h.valid('kontrol-panel'));h.set({'control-panels':'2,5'});h.hub.control();assert.ok(h.blocked('kontrol-panel'));assert.equal(h.el('control-scope').textContent,'');
  for(const values of [{kva:Infinity},{kva:9999999999999},{feederYa:NaN},{feederSk:Infinity},{enhM:Infinity},{bk:0},{type:'invalid'}])assert.equal(h.config.calcIsletmeUcreti({type:'bina',kva:1000,...values}).ok,false,JSON.stringify(values));
  assert.equal(h.config.calcIsletmeUcreti({type:'bina',kva:1000}).total,12006);
});

test('Positive efficiency payback periods never round to a misleading zero years',()=>{
  const h=harness();h.set({'technical-tool':'efficiency'});h.hub.configure();
  h.set({'technical-a':'600000','technical-b':'3,50','technical-c':'12','technical-d':'10000'});h.hub.technical();
  assert.ok(h.valid('teknik-panel'));assert.match(h.el('technical-detail').textContent,/0,1 yıldan kısa geri dönüş/);assert.doesNotMatch(h.el('technical-detail').textContent,/yaklaşık 0 yıl/);
  h.set({'technical-d':'100000'});h.hub.technical();assert.match(h.el('technical-detail').textContent,/yaklaşık 0,4 yıl geri dönüş/);
  h.set({'technical-d':'0'});h.hub.technical();assert.match(h.el('technical-detail').textContent,/yatırım tutarını girin/);
});

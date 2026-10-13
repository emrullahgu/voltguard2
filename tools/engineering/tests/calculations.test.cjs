const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'src', 'tools');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
function between(text, start, end) {
  const a=text.indexOf(start), b=text.indexOf(end,a);
  assert.ok(a>=0&&b>a, `Source markers: ${start} / ${end}`);
  return text.slice(a,b);
}
function elements(values={}) {
  const map={};
  for(const [key,value] of Object.entries(values)) map[key]={value,style:{},dataset:{},setAttribute(){},innerHTML:'',textContent:''};
  return new Proxy(map,{get:(m,k)=>m[k]??(m[k]={value:'',style:{},setAttribute(){},innerHTML:'',textContent:''})});
}
function evaluate(code, extra={}) {
  const context=vm.createContext({document:{documentElement:{dataset:{}}},...extra});
  vm.runInContext(code,context);
  return context;
}

test('Coordinate decimal commas, semicolon CSV, quoted fields, and exact column count', () => {
  const text=source('Koordinat_Dönüşümü.html');
  const c=evaluate(between(text,'  function num(t)','  function applyP('));
  for(const line of ['P1 500000,25 4500000,50','P1;500000,25;4500000,50','P1,500000.25,4500000.50']) {
    const row=c.coordinateRow(c.coordinateFields(line));
    assert.equal(row.y,500000.25); assert.equal(row.x,4500000.5); assert.equal(row.nm,'P1');
  }
  assert.equal(c.coordinateRow(c.coordinateFields('"P;""1";500000.25;4500000.5')).nm,'P;"1');
  assert.equal(c.coordinateRow(c.coordinateFields('P1 500000 4500000 77')),null);
  assert.equal(c.coordinateRow(c.coordinateFields('P1 500000oops 4500000')),null);
  assert.equal(c.coordinateRow(c.coordinateFields('P1 500000,25,4500000,50')),null);
});

test('Coordinate comma and dot produce same transformation; same system remains exportable', () => {
  const text=source('Koordinat_Dönüşümü.html');
  const el=elements({koSrc:'ED50_3',koDst:'ITRF96_3_39',koIn:'P1 500000,25 4500000,50'});
  const c=evaluate(between(text,'  var KO_PARAMS',"  $('mAdd').addEventListener"),{document:{getElementById:id=>el[id],documentElement:{dataset:{}}}});
  c.convert();
  const expected=el.koOut.value;
  assert.match(expected,/499986\.99\t4499815\.44/);
  el.koIn.value='P1 500000.25 4500000.50'; c.convert(); assert.equal(el.koOut.value,expected);
  el.koDst.value=el.koSrc.value; c.convert(); assert.equal(c.lastRows.length,1); assert.equal(c.lastRows[0].y,500000.25);
  el.koIn.value='P1 500000oops 4500000'; c.convert(); assert.equal(c.lastRows.length,0); assert.equal(c.document.documentElement.dataset.vgInvalid,'true');
});

test('CSV import retains invalid data for a visible error instead of silently dropping rows', () => {
  const text=source('Koordinat_Dönüşümü.html');
  const el=elements();
  const c=evaluate(between(text,'  var KO_PARAMS',"  $('mAdd').addEventListener"),{document:{getElementById:id=>el[id],documentElement:{dataset:{}}}});
  c.readCells([['Nokta No','Y','X'],['P1','invalid','4500000'],['P2','500000','4500000']]);
  assert.match(el.koIn.value,/P1\tinvalid/);
  assert.doesNotMatch(el.koIn.value,/Nokta No/);
});

function sehim() {
  const text=source('ENH_Sehim_Hesabı.html');
  const el=elements({cS:'62.38',cD:'10.11',cP0:'0.2159',cE:'6500',cB:'0.0000191',cSig:'11',cT1t:'-5',cP1:'0.5',cPn:'0.5',cTs:'-5;12,5;40',cHal:'man',cK:'0.3',cQ:'53'});
  const c=evaluate(between(text,'function fn(v)','/* ---------- Tablolar ---------- */'),{$:id=>el[id]});
  return {c,el};
}
test('Temperature lists preserve decimal comma and reject malformed or empty entries', () => {
  const {c}=sehim();
  assert.deepEqual(Array.from(c.parseTemperatures('-5; 12,5; 40; 12,5')),[-5,12.5,40]);
  assert.deepEqual(Array.from(c.parseTemperatures('-5, 0, 5, 10')),[-5,0,5,10]);
  assert.deepEqual(Array.from(c.parseTemperatures('12,5')),[12.5]);
  for(const value of ['12,5;abc;','-5;;40','1,2,3','']) assert.throws(()=>c.parseTemperatures(value));
  assert.ok(Number.isNaN(c.fn('42oops'))); assert.ok(Number.isNaN(c.fn('')));
});
test('Sehim reference state returns original tension and invalid physical inputs yield no result', () => {
  const {c,el}=sehim();
  assert.ok(Math.abs(c.cozT(-5,120)-11*62.38)<1e-7);
  assert.equal(c.sehimErrors(false).length,0);
  el.cPn.value=''; assert.ok(Number.isNaN(c.cozT(-5,120))); assert.ok(c.sehimErrors(false).length>0);
  el.cPn.value='0.5'; el.cB.value='-0.01'; assert.ok(Number.isNaN(c.cozT(20,120)));
  el.cB.value='0.0000191'; el.cTs.value='12,5;abc;'; assert.ok(c.sehimErrors(false).length>0);
  c.M.direk=[{dn:'1',tip:'D',a:-80},{dn:'2',tip:'D',a:0}]; assert.ok(c.sehimErrors(true).some(e=>e.includes('açıklık')));
});

test('Uplift validates domain before making any suitability claim; force and margin agree', () => {
  const text=source('ENH_Uplift_Hesabı.html');
  const c=evaluate(between(text,'function parseUpliftNumber','var state =')+between(text,'function solve(','function heights('));
  assert.equal(c.parseUpliftNumber('138,53'),138.53);
  const r=c.solve(.2159,600,138.53,123.03,6,4);
  assert.equal(r.valid,true);
  assert.ok(Math.abs(r.fmin-(.2159*138.53*123.03/1200))<1e-10);
  assert.equal(r.ok,r.R>0);
  for(const args of [[0,600,100,100,1,1],[.2,0,100,100,1,1],[.2,600,-100,100,1,1],[.2,600,100,100,NaN,1]]) {
    const invalid=c.solve(...args); assert.equal(invalid.valid,false); assert.equal(invalid.ok,null);
  }
});

function ag() {
  const text=source('AG_Kısa_Devre_Simülatörü.html');
  return evaluate(between(text,'const TRAFO =','/* ============ ANA HESAP ============ */'));
}
test('AG transformer impedance rejects RT > ZT and zero/negative/missing essential inputs', () => {
  const c=ag(), good=c.transformerImpedance(400,400,4.5,5850);
  assert.equal(good.valid,true); assert.equal(good.ZT,18); assert.equal(good.RT,5.85);
  assert.ok(Math.abs(Math.hypot(good.RT,good.XT)-18)<1e-10);
  assert.equal(c.transformerImpedance(400,400,4.5,50000).valid,false);
  for(const args of [[0,400,4.5,5850],[400,-400,4.5,5850],[400,400,0,5850],[400,400,4.5,-1],[400,400,NaN,5850]]) assert.equal(c.transformerImpedance(...args).valid,false);
});
test('AG conductor impedance preserves valid calculations and rejects invalid circuit data', () => {
  const c=ag(), s=c.defaultSeg(), rx=c.segRX(s);
  assert.ok(Math.abs(rx.R-(1000*20/(56*95)))<1e-10); assert.equal(rx.X,.0795*20);
  assert.equal(c.segmentErrors(s).length,0);
  for(const change of [{L:0},{L:-1},{adet:1.5},{kesit:0},{penKesit:0},{tkd:0},{icu:-1},{tip:'missing'},{tip:'havai',iletken:'missing'}]) {
    assert.throws(()=>c.segRX({...s,...change}));
  }
  const comma=c.segRX({...s,L:'20,5',kesit:'95,5'});
  assert.ok(Math.abs(comma.R-(1000*20.5/(56*95.5)))<1e-10);
});

test('Every executable script in the four changed tools compiles', () => {
  for(const file of ['Koordinat_Dönüşümü.html','ENH_Sehim_Hesabı.html','ENH_Uplift_Hesabı.html','AG_Kısa_Devre_Simülatörü.html']) {
    for(const [,attributes,code] of source(file).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if(/application\/json|ld\+json/i.test(attributes)||/\bsrc=/i.test(attributes)) continue;
      assert.doesNotThrow(()=>new vm.Script(code,{filename:file}));
    }
  }
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/tools/Elektrik_Sembol_Kutuphanesi.html'),'utf8');
const library=JSON.parse(source.match(/<script id="sg-library-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const context=vm.createContext({});vm.runInContext(source.split('/* SG_CORE_START */')[1].split('/* SG_CORE_END */')[0],context);const core=context.SGCore;
const model=()=>({format:'voltguard-symbol-diagram',version:1,title:'Örnek devre',notes:'',nodes:[{id:'n1',symbol:library[0].id,x:200,y:200,rotation:0,label:'R1 · 10 Ω'},{id:'n2',symbol:library[0].id,x:500,y:300,rotation:90,label:'R2'}],edges:[{id:'w1',from:'n1',to:'n2',fromPort:1,toPort:3}]});
test('261 licensed symbols have finite nonempty geometry and safe local artwork',()=>{
 assert.equal(library.length,261);assert.equal(library.filter(s=>s.source==='basverdoes').length,74);assert.equal(library.filter(s=>s.source==='upb-lea').length,187);assert.equal(new Set(library.map(s=>s.id)).size,261);
 for(const symbol of library){const box=symbol.viewBox.split(/\s+/).map(Number);assert.equal(box.length,4,symbol.id);assert.ok(box.every(Number.isFinite),symbol.id);assert.ok(box[2]>0&&box[3]>0,symbol.id);assert.ok(symbol.body.length>10,symbol.id);assert.doesNotMatch(symbol.body,/<(?:script|image|foreignObject|iframe)|\bon[a-z]+\s*=|javascript:|href="[^#]/i,symbol.id)}
});
test('diagram JSON roundtrip keeps nodes, labels and anchored edges',()=>{const state=model(),actual=core.validate(JSON.parse(JSON.stringify(state)),library);assert.equal(JSON.stringify(actual),JSON.stringify(state));assert.equal(actual.nodes[0].label,'R1 · 10 Ω')});
test('imports reject unknown symbols, duplicate IDs and invalid numeric geometry',()=>{
 for(const mutate of [s=>s.nodes[0].symbol='not-a-symbol',s=>s.nodes[1].id='n1',s=>s.nodes[0].x=NaN,s=>s.nodes[0].x='200',s=>s.nodes[0].y=900,s=>s.nodes[0].rotation=45,s=>s.nodes[0].label='x'.repeat(81)]){const s=model();mutate(s);assert.throws(()=>core.validate(s,library))}
});
test('imports reject dangling edges, invalid ports, duplicate edge IDs and oversized models',()=>{
 for(const mutate of [s=>s.edges[0].to='n999',s=>s.edges[0].to='n1',s=>s.edges[0].fromPort=4,s=>s.edges.push({...s.edges[0]}),s=>s.nodes=Array(501).fill(s.nodes[0]),s=>s.title='x'.repeat(161)]){const s=model();mutate(s);assert.throws(()=>core.validate(s,library))}
});
test('wires follow moved and rotated symbols while remaining orthogonal',()=>{const s=model();assert.match(core.wirePath(s.edges[0],s.nodes),/^M240,200 H370 V260 H500$/);s.nodes[0].rotation=90;const p=core.portPosition(s.nodes[0],1);assert.equal(p.x,200);assert.equal(p.y,240);s.nodes[0].x=220;assert.match(core.wirePath(s.edges[0],s.nodes),/^M220,240 V250 H500 V260$/)});
test('SVG remains vector and imported user labels cannot create executable SVG',()=>{const s=model();s.title='<script>alert(1)</script>';s.nodes[0].label='<image onload="alert(1)">';s.notes='A & B';const svg=core.makeSVG(s,library);assert.match(svg,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);assert.match(svg,/&lt;image onload=&quot;alert\(1\)&quot;&gt;/);assert.doesNotMatch(svg,/<script|<image|<foreignObject/i);assert.match(svg,/<path/);assert.match(svg,/<metadata>VoltGuard diagram · CC0/);const ids=[...svg.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length)});
test('symbol download includes standalone SVG geometry and provenance',()=>{const svg=core.symbolSVG(library[0]);assert.match(svg,/xmlns="http:\/\/www.w3.org\/2000\/svg"/);assert.match(svg,/<metadata>CC0 1.0/);assert.match(svg,new RegExp(library[0].source));assert.doesNotMatch(svg,/<image|https:\/\/cdn/)});
test('imported extra object keys cannot change any prototype',()=>{const s=JSON.parse(JSON.stringify(model()).replace('"notes":""','"notes":"","__proto__":{"polluted":true}'));const valid=core.validate(s,library);assert.equal(Object.prototype.polluted,undefined);assert.equal(Object.prototype.hasOwnProperty.call(valid,'__proto__'),false)});

if(process.env.VOLTGUARD_SYMBOL_BROWSER_QA==='1')test('browser: search, edit, download, import, undo, mobile layout and print report',{timeout:120000},async()=>{
 const {chromium}=require(process.env.VOLTGUARD_PLAYWRIGHT||'C:/Users/emrul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
 const {pathToFileURL}=require('node:url'),os=require('node:os');
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'voltguard-symbol-qa-'));
 const browser=await chromium.launch({executablePath:process.env.VOLTGUARD_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(__dirname,'../src/tools/Elektrik_Sembol_Kutuphanesi.html')).href);
  assert.equal(await page.locator('.sg-card').count(),261);
  await page.locator('#sg-search').fill('direnç');const matches=await page.locator('.sg-card').count();assert.ok(matches>=6&&matches<30);
  await page.locator('#sg-standard').selectOption('IEC');assert.ok(await page.locator('.sg-card').count()>0);
  await page.locator('#sg-search').fill('');await page.locator('#sg-standard').selectOption('');
  const geometries=await page.locator('.sg-card svg').evaluateAll(elements=>elements.map(el=>{const box=el.getBBox();return [box.width,box.height]}));assert.equal(geometries.length,261);assert.ok(geometries.every(b=>b[0]>0||b[1]>0));
  await page.locator('[data-node="n1"] [data-port="1"]').click();await page.locator('[data-node="n3"] [data-port="3"]').click();assert.equal((await page.evaluate(()=>window.VoltGuardSymbols.getState())).edges.length,4);await page.locator('#sg-undo').click();assert.equal((await page.evaluate(()=>window.VoltGuardSymbols.getState())).edges.length,3);
  await page.locator('#sg-add').click();assert.equal((await page.evaluate(()=>window.VoltGuardSymbols.getState())).nodes.length,4);
  await page.locator('#sg-label').fill('T1 <test> · 400 kVA');await page.locator('#sg-label').press('Tab');assert.equal((await page.evaluate(()=>window.VoltGuardSymbols.getState())).nodes[3].label,'T1 <test> · 400 kVA');
  await page.locator('#sg-rotation').selectOption('90');assert.equal((await page.evaluate(()=>window.VoltGuardSymbols.getState())).nodes[3].rotation,90);
  await page.locator('#sg-undo').click();assert.equal((await page.evaluate(()=>window.VoltGuardSymbols.getState())).nodes[3].rotation,0);
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#sg-svg').click()]);await download.saveAs(path.join(out,'diagram.svg'));const svg=fs.readFileSync(path.join(out,'diagram.svg'),'utf8');assert.match(svg,/T1 &lt;test&gt; · 400 kVA/);assert.doesNotMatch(svg,/<script/);
  const good=await page.evaluate(()=>window.VoltGuardSymbols.getState());await page.locator('#sg-clear').click();assert.equal((await page.evaluate(()=>window.VoltGuardSymbols.getState())).nodes.length,0);
  await page.locator('#sg-import').setInputFiles({name:'test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(good))});await page.waitForFunction(()=>window.VoltGuardSymbols.getState().nodes.length===4);assert.equal((await page.evaluate(()=>window.VoltGuardSymbols.getState())).nodes.length,4);
  const bad=JSON.parse(JSON.stringify(good));bad.nodes[0].symbol='unknown';await page.locator('#sg-import').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bad))});await page.waitForFunction(()=>document.getElementById('sg-status').dataset.error==='true');assert.equal((await page.evaluate(()=>window.VoltGuardSymbols.getState())).nodes.length,4);
  await page.locator('#sg-demo').click();await page.screenshot({path:path.join(out,'desktop.png'),fullPage:true});
  await page.evaluate(()=>window.VoltGuardSymbols.buildReport());await page.emulateMedia({media:'print'});assert.equal(await page.locator('#printReport > svg').count(),1);await page.pdf({path:path.join(out,'report.pdf'),format:'A4',printBackground:true});assert.ok(fs.statSync(path.join(out,'report.pdf')).size>10000);
  await page.emulateMedia({media:'screen'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);console.log('Symbols browser QA artifacts: '+out);
 }finally{await browser.close()}
});

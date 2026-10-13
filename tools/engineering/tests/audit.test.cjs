const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourceDir = path.join(__dirname, '..', 'src', 'tools');
const read = name => fs.readFileSync(path.join(sourceDir, name), 'utf8');
const scripts = html => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(m => {
  const type=m[1].match(/\btype\s*=\s*["']([^"']+)/i)?.[1];
  return !type||['text/javascript','application/javascript','module'].includes(type);
}).map(m => m[2]);
const between = (source, first, last) => {
  const start = source.indexOf(first), end = source.indexOf(last, start + first.length);
  assert.ok(start >= 0 && end > start, `Function boundaries: ${first} → ${last}`);
  return source.slice(start, end);
};

test('All 25 tools contain syntactically valid executable scripts', () => {
  let count = 0;
  for (const name of fs.readdirSync(sourceDir).filter(name => name.endsWith('.html'))) {
    for (const [index, script] of scripts(read(name)).entries()) {
      new vm.Script(script, { filename: `${name}:${index + 1}` });
      count++;
    }
  }
  assert.ok(count >= 39);
});

function cbsContext() {
  const html = read('CBS_Veri_Giriş_Sistemi.html');
  const tags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const templates = Object.fromEntries(tags.filter(tag => /application\/octet-stream/.test(tag[1])).map(tag => [tag[1].match(/id="([^"]+)"/)[1], {textContent: tag[2]}]));
  const store = new Map();
  const context = vm.createContext({
    window: {}, console, Blob, Buffer, Uint8Array, setTimeout, clearTimeout, setImmediate, clearImmediate, atob, btoa,
    document: { getElementById: id => templates[id] || {value: '', textContent: '', classList: {add(){}, remove(){}}} },
    localStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) },
  });
  vm.runInContext(tags[0][2], context);
  context.JSZip=context.window.JSZip;
  vm.runInContext(tags[3][2], context);
  vm.runInContext(tags[4][2].replace(/\binit\(\);\s*$/, ''), context);
  return context;
}

test('CBS safely escapes user text and rejects malformed project state', () => {
  const context = cbsContext();
  assert.equal(vm.runInContext(`htmlEsc('<img src=x onerror="alert(1)"> &')`, context), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp;');
  for (const input of ['null', '{}', '{data:[]}', '{data:{hucre:{}}}', '{data:{bina:[]}}', '{data:{bina:{adi:{bad:1}}}}', '{data:{},customOpts:[]}', '{data:{},customOpts:{"@adi":[1]}}']) {
    // The last key may not be a defined select pool; unknown pools are discarded.
    if (input.includes('@adi')) continue;
    assert.throws(() => vm.runInContext(`normalizeState(${input})`, context));
  }
  const normalized = vm.runInContext(`normalizeState({proj:'A',data:{hucre:[],bina:{adi:'<script>',unknown:'discard'}}})`, context);
  assert.equal(normalized.proj, 'A');
  assert.ok(normalized.data.hucre.length >= 1);
  assert.equal(normalized.data.bina.adi, '<script>');
  assert.equal(normalized.data.bina.unknown, undefined);
  const html = vm.runInContext(`fieldCell(SCHEMA[0],{key:'test',type:'select',opts:['<img src=x>','A & B']},{test:'<img src=x>'},0)`, context);
  assert.ok(html.includes('&lt;img src=x&gt;'));
  assert.ok(!html.includes('<img'));
});

test('CBS Excel export retains every line beyond template capacity', async () => {
  const context = cbsContext();
  vm.runInContext(`STATE=blankState();
    STATE.proj='Regression';
    STATE.data.direk=[{d_no:'D/1:[2]'}];
    STATE.data.hat=Array.from({length:8},(_,i)=>({arasi:'HAT-'+i,t_tipi:i<5?'Havai':'Yeraltı',kesit:String(95+i)}));
    downloadZip=async(zip,name)=>{window.exportedZip=zip;window.exportedName=name;};`, context);
  await vm.runInContext('exportFile2()', context);
  const zip = context.window.exportedZip;
  const workbook = await zip.file('xl/workbook.xml').async('string');
  assert.ok(workbook.includes('EK_2 Hat-Kablo 2'));
  assert.ok(workbook.includes('D_1__2_'));
  let allSheets = '';
  for (const name of Object.keys(zip.files).filter(name => /^xl\/worksheets\/.*\.xml$/.test(name))) allSheets += await zip.file(name).async('string');
  for (let i = 0; i < 8; i++) assert.ok(allSheets.includes('HAT-' + i), `Missing line ${i}`);
  const bytes = await zip.generateAsync({type:'nodebuffer'});
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  assert.ok(bytes.length > 10000);
});

test('Coordinate DXF preserves decimal commas and rejects invalid Z or extra columns', () => {
  const source = read('Koordinat_DXF.html');
  const context = vm.createContext({rows:[],errs:[],bosK:0,render(){}});
  vm.runInContext(between(source, 'function num(t)', '/* ---------- dosya okuma'), context);
  vm.runInContext(`parsePaste('P1 500000,25 4500000,50 12,5')`, context);
  assert.equal(context.rows[0].x, 500000.25);
  assert.equal(context.rows[0].y, 4500000.5);
  assert.equal(context.rows[0].z, 12.5);
  vm.runInContext(`parsePaste('P1 500000 4500000 bad')`, context);
  assert.equal(context.rows.length, 0);
  assert.equal(context.errs.length, 1);
  vm.runInContext(`parsePaste('P1 500000 4500000 4 5')`, context);
  assert.equal(context.rows.length, 0);
  assert.equal(context.errs.length, 1);
  vm.runInContext(`parsePaste('P1 bad 4500000')`, context);
  assert.equal(context.errs.length, 1, 'Invalid first row must not be mistaken for a heading');
});

test('OG line validation rejects omitted and malformed physical inputs', () => {
  const source = read('OG_Kisa_Devre_Simulatoru.html');
  const fields = {
    h1_l:{value:'1,5'},h1_R:{value:'0'},h1_X:{value:'0,2'},h1_R0:{value:'0'},h1_X0:{value:'0,6'},
    h1_dv:{value:'1'},h1_nk:{value:'N1'},h1_tip:{value:'test',selectedIndex:0,options:[{text:'Test'}]},
  };
  const context = vm.createContext({$:id=>fields[id], document:{querySelectorAll:()=>[{id:'hat1'}]}});
  vm.runInContext(between(source,'function num(id)', 'function fmt('), context);
  vm.runInContext(between(source,'function hatListesi()', '/* ================= ANA HESAP'), context);
  assert.equal(vm.runInContext('hatListesi()[0].l',context),1.5, 'Zero resistance must not discard a valid reactive line');
  for (const [field,value] of [['h1_l',''],['h1_l','-1'],['h1_R','abc'],['h1_dv','1.5']]) {
    const previous=fields[field].value;fields[field].value=value;
    assert.throws(()=>vm.runInContext('hatListesi()',context));fields[field].value=previous;
  }
});

test('AG voltage-drop rejects invalid data while preserving a verified nominal result', () => {
  const source=read('AG_Gerilim_Düşümü_ve_Güç_Kaybı_Hesabı.html');
  const context=vm.createContext({
    gU:{value:'400'},gDiv:{value:'1'},gCos:{value:'0.8'},
    CABLES:[{ad:'Test',tip:'Yeralti',faz:'Tri',toprak:100,hava:100,k:1,m:1}],kols:[],
  });
  vm.runInContext(between(source,'function numeric(','function fmt('),context);
  vm.runInContext(`kols=[{cable:'Test',tip:'Yeralti',devre:1,length:'100',yuk:['10000','','','']}]`,context);
  const result=vm.runInContext('calc(kols[0],0)',context);
  assert.ok(Math.abs(result.I-10000/(Math.sqrt(3)*400*0.8))<1e-9);
  assert.equal(result.P,10000);
  context.gCos.value='0';assert.throws(()=>vm.runInContext('calc(kols[0],0)',context));
  context.gCos.value='0.8';
  vm.runInContext(`kols[0].yuk[0]='-100'`,context);assert.throws(()=>vm.runInContext('calc(kols[0],0)',context));
  vm.runInContext(`kols[0].yuk[0]='100abc'`,context);assert.throws(()=>vm.runInContext('calc(kols[0],0)',context));
});

test('Kabul Excel engine is available locally and writes a Turkish workbook', () => {
  const html=read('Kabul_Tutanağı_Genel.html');
  assert.ok(html.includes('src="../../vendor/xlsx.bundle.js"'));
  assert.ok(!/<script[^>]+src="https?:/i.test(html));
  const context=vm.createContext({console,Uint8Array,ArrayBuffer});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/vendor/xlsx.bundle.js'),'utf8'),context);
  const xlsx=context.XLSX;
  const workbook=xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook,xlsx.utils.aoa_to_sheet([['VoltGuard','İşletme Şebekesi'],['Gerilim',34.5]]),'Tutanak');
  const bytes=xlsx.write(workbook,{type:'array',bookType:'xlsx'});
  const reopened=xlsx.read(bytes,{type:'array'});
  assert.equal(reopened.Sheets.Tutanak.B1.v,'İşletme Şebekesi');
  assert.equal(reopened.Sheets.Tutanak.B2.v,34.5);
});

test('Broken-conductor result never passes an exceeded tensile limit', () => {
  const source=read('İletken_Kopma_Hesabı.html');
  const fields={cond:{value:'3/0'},zone:{value:'3'},a1:{value:'100'},a2:{value:'100'},hproje:{value:'1'}};
  const document={
    documentElement:{dataset:{}},querySelectorAll:()=>[],
    getElementById:id=>fields[id]||(fields[id]={textContent:'',className:'',querySelector:()=>({textContent:''})}),
  };
  const context=vm.createContext({document,renderSteps(){},drawViz(){}});
  vm.runInContext(between(source,'const COND =','function initUI()'),context);
  vm.runInContext(between(source,'const E_CONST','function renderSteps('),context);
  vm.runInContext(`solveCubic=()=>({root:3000,kase:'test',detail:{}});calc();`,context);
  assert.equal(vm.runInContext('last.pass',context),false);
  assert.ok(fields.verdictSub.textContent.includes('emniyet sınırını aşıyor'));
  fields.a1.value='';vm.runInContext('calc()',context);
  assert.equal(vm.runInContext('last',context),null);
  assert.equal(document.documentElement.dataset.vgInvalid,'true');
});

test('Residential PV refuses malformed custom irradiance instead of substituting another city', () => {
  const source=read('Mesken_GES_Depolama_Simülatörü.html');
  const fields={};
  for(const tag of source.matchAll(/<input\b([^>]+)>/g)){
    const id=tag[1].match(/\bid="([^"]+)"/)?.[1];if(!id)continue;
    fields[id]={value:tag[1].match(/\bvalue="([^"]*)"/)?.[1]||'',min:tag[1].match(/\bmin="([^"]*)"/)?.[1]||'',max:tag[1].match(/\bmax="([^"]*)"/)?.[1]||'',closest:()=>null};
  }
  Object.assign(fields,{il:{value:'__ozel'},oz_veri:{value:'10 10bad 10 10 10 10 10 10 10 10 10 10'},oz_birim:{value:'ay'},yon:{value:'0'},kim:{value:'li'},tay:{value:'min'},mahsup:{value:'1'}});
  const days=[31,28,31,30,31,30,31,31,30,31,30,31];
  const row={on:true,n:1,w:100,h:2,z:'gun',s:'yil',k:1,kr:false};
  const context=vm.createContext({$:id=>fields[id],S:{rows:[row],man:{off:{},hib:{},ong:{}}},ILLER:{Trabzon:[41,Array(12).fill(4)]},MEVSIM:{yil:Array(12).fill(1)},GECE:{gun:.1},GUN:days,AY:Array(12).fill('Ay'),INV:[1,2,3,5],egik:()=>Array(12).fill(4)});
  vm.runInContext(between(source,'function hesap(man)','function ciz(R)'),context);
  assert.throws(()=>vm.runInContext('hesap()',context),/12 pozitif/);
  fields.oz_veri.value=Array(12).fill('100').join(' ');
  const result=vm.runInContext('hesap()',context);
  assert.ok(Math.abs(result.yil-73)<1e-9);
  fields.pr.value='0';assert.throws(()=>vm.runInContext('hesap()',context),/geçerli aralıkta/);
  fields.pr.value='.78';row.h=25;assert.throws(()=>vm.runInContext('hesap()',context),/Cihaz/);
});

test('OG voltage-drop never reports success with missing conductor coefficients', () => {
  const source=read('OG_Gerilim_Düşümü_ve_Güç_Kaybı_Hesabı.html');
  const inputs={gerilim:'34.5',cosPhi:'.8',isletme:'normal',c_1_kesit:'Test',c_1_ad:'A',c_1_l_m:'1000',c_1_trafo:'1000',c_1_diger:'',c_1_div:'100'};
  const outputs={s_genel:{textContent:'',setAttribute(){}}};
  const document={documentElement:{dataset:{}},querySelectorAll:()=>[],getElementById:id=>outputs[id]||null};
  let summary;
  const coefficients=[1,1];
  const context=vm.createContext({document,getV:id=>inputs[id]??'',segs:[{id:1}],tabloKC:()=>coefficients,setCell(){},updOvCell(){},fmt:(x,d)=>x.toFixed(d),updateSummary:(...values)=>{summary=values;}});
  vm.runInContext(between(source,'function ogNumber(', 'function updOvCell('),context);
  vm.runInContext('hesapla()',context);
  assert.equal(document.documentElement.dataset.vgInvalid,'false');
  assert.ok(Math.abs(summary[0]-.1)<1e-9);
  assert.ok(Math.abs(summary[2]-1)<1e-9);
  coefficients[0]=null;vm.runInContext('hesapla()',context);
  assert.equal(document.documentElement.dataset.vgInvalid,'true');
  assert.ok(outputs.s_genel.textContent.includes('K ve C'));
  coefficients[0]=1;inputs.gerilim='0';vm.runInContext('hesapla()',context);
  assert.equal(document.documentElement.dataset.vgInvalid,'true');
});

test('Channel import preserves current project when migration fails', () => {
  const source=read('Kanal_Planı.html');
  const previous={tipler:[],sayac:0,secili:-1};
  const context=vm.createContext({state:previous,goc(){}});
  vm.runInContext(between(source,'function validatedChannelState(', 'function importJSON('),context);
  const valid={tipler:[{ad:'K1',katlar:[{kablolar:[{sinif:'AG',adet:3,kesit:'3x240+120',cap:60}]}]}]};
  context.data=valid;vm.runInContext('applyChannelState(data)',context);
  assert.equal(context.state.tipler[0].katlar[0].kablolar[0].adet,3);
  context.state=previous;context.goc=()=>{throw new Error('migration');};
  assert.throws(()=>vm.runInContext('applyChannelState(data)',context));assert.equal(context.state,previous);
  valid.tipler[0].katlar[0].kablolar[0].adet=-1;
  assert.throws(()=>vm.runInContext('validatedChannelState(data)',context));
  assert.throws(()=>vm.runInContext('validatedChannelState({tipler:[{}]})',context));
});

test('Amax state adapter preserves private geometry and custom insulator length', () => {
  const source=read('Amax_Hesabı_son.html');
  const fields=Object.fromEntries(['ilet','bolge','baglanti','trav','U','ar','LizSel'].map(id=>[id,{value:id==='LizSel'?'1.75':'1',tagName:'INPUT'}]));
  let builds=0,calculations=0;
  const context=vm.createContext({window:{},$:id=>fields[id],gv:{a:2.5},buildGeom(){builds++;},calc(){calculations++;}});
  vm.runInContext(between(source,'const FIELDS=',"$('saveBtn').onclick"),context);
  const adapter=context.window.VoltGuardExportAdapter;
  const snapshot=adapter.getState();
  assert.equal(snapshot.fields.LizSel,'1.75');assert.equal(snapshot.geom.a,2.5);
  adapter.setState({fields:{LizSel:'2.25'},geom:{a:3.5}});
  assert.equal(fields.LizSel.value,'2.25');assert.equal(context.gv.a,3.5);assert.equal(builds,1);assert.equal(calculations,1);
  assert.throws(()=>adapter.setState({fields:{},geom:{a:'<img>'}}));
});

test('Amax refuses geometry below the required electrical clearance', () => {
  const source=read('Amax_Hesabı_son.html');
  const fields={ilet:{value:'0'},bolge:{value:'1'},baglanti:{value:'mm'},LizSel:{value:'0'},sina:{value:''}};
  const geometry={Df:1,Ds:1};
  const document={documentElement:{dataset:{}}};
  const window={};
  const context=vm.createContext({document,window,$:id=>fields[id]||(fields[id]={textContent:'',innerHTML:''}),g:id=>id==='U'?34.5:100,selT:{value:'t0'},sinaA:[.5],p0A:[1],gv:{a:1},TRAVERS:{t0:{inp:[['a']],f:()=>geometry,ad:'Test'}},getPnMax:()=>1,getTn:()=>100,getTn5:()=>100,drawTravers:()=>'<svg/>',syncOverlayValues(){},ILET:['Test'],sehimHaliMetni:()=>''});
  vm.runInContext(between(source,'function calc(){','const FIELDS='),context);
  vm.runInContext('calc()',context);
  assert.equal(document.documentElement.dataset.vgInvalid,'false');
  assert.ok(Number.isFinite(window._amaxVal)&&window._amaxVal>0);
  geometry.Df=.1;vm.runInContext('calc()',context);
  assert.equal(document.documentElement.dataset.vgInvalid,'true');
  assert.equal(fields.o_amax.textContent,'–');
  assert.ok(fields.steps.textContent.includes('gerekli mesafeyi sağlamalı'));
});

test('HTML data snapshots escape script-closing input', () => {
  const text=JSON.stringify({name:'</script><script>alert(1)</script>'}).replace(/</g,'\\u003c');
  assert.ok(!text.includes('</script>'));
  assert.equal(JSON.parse(text).name,'</script><script>alert(1)</script>');
  for(const name of ['AG_Gerilim_Düşümü_ve_Güç_Kaybı_Hesabı.html','ENH_ag-aw_Bağıntı_Hesabı.html','Kabul_Tutanağı_Genel.html']) assert.ok(read(name).includes("replace(/</g,'\\\\u003c')"),name);
});

test('Public report defaults contain no real project or committee identity', () => {
  const html=read('Kabul_Tutanağı_Genel.html');
  const main=scripts(html).find(script=>script.includes('const VARSAYILAN ='));
  const context=vm.createContext({});
  vm.runInContext(main.slice(0,main.indexOf('const MAKS_KISI')),context);
  const defaults=vm.runInContext('VARSAYILAN',context);
  for(const field of ['kurum','il','ilce','tesis','tarih','dayanak','komTarih','komSayi'])assert.equal(defaults[field],'',field);
  for(const member of defaults.kurul){assert.equal(member.ad,'');assert.equal(member.kurulus,'');}
  assert.equal(defaults.trSayfalar[0].trafolar[0].ad,'');
  assert.equal(defaults.trSayfalar[0].trafolar[0].seriNo,'');
  assert.equal(defaults.trSayfalar[0].trafolar[0].gerilim,'36 kV');
  assert.equal(defaults.agSayfalar[0].yeralti.length,0);
  assert.equal(defaults.ogSayfalar[0].yeralti.length,0);
  for(const privateName of ['Serap KURU','M.Ertürk MEMİŞ','UZUNGÖL MİLLET BAHÇESİ','JANDARMA YANI TR'])assert.ok(!html.includes(privateName));
  const agaw=read('ENH_ag-aw_Bağıntı_Hesabı.html');
  assert.ok(agaw.includes('kim:"", unv:""'));
  assert.ok(!agaw.includes('M.kim||"BAKİ SONAY"'));
  assert.ok(read('Bina_Yerleşim_Planı.html').includes('proje:""'));
  assert.ok(!read('OG_Kisa_Devre_Simulatoru.html').includes('value="TRABZON TM"'));
  for(const name of fs.readdirSync(sourceDir).filter(name=>name.endsWith('.html'))){
    if(['Koordinat_Dönüşümü.html','ENH_Sehim_Hesabı.html','ENH_Uplift_Hesabı.html','AG_Kısa_Devre_Simülatörü.html'].includes(name))continue;
    const lines=read(name).split(/\r?\n/).filter(line=>line.length<2500&&/Baki|SONAY/.test(line));
    assert.ok(!lines.some(line=>/Hazırlayan\s*:/.test(line)),name);
  }
});

'use strict';

/* Actual compiled React UI + actual private PHP APIs. Uses only an isolated temporary employee dataset. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const ownWhiteOnly=process.argv.includes('--own-white-only');
const workflowArgument=process.argv.find(argument=>argument.startsWith('--workflows='));
const selectedWorkflows=workflowArgument?new Set(workflowArgument.slice(12).split(',')):null;
const output = path.join(root, process.env.VG_COMPANY_ADMIN_OUTPUT_FOCUS==='1'?'.qa/company-admin-outputs':process.env.VG_COMPANY_OUTPUT_FOCUS==='1'?(process.argv.includes('--payroll-only')?'.qa/company-payroll-outputs':process.env.VG_COMPANY_PROPOSAL_OUTPUT_FOCUS==='1'?'.qa/company-proposal-outputs':'.qa/company-outputs'):process.env.VG_COMPANY_SUBMIT_FOCUS==='1'?(process.argv.includes('--weekly-pdf-only')?'.qa/company-weekly-pdf':'.qa/company-submit'):ownWhiteOnly?'.qa/company-own-white':selectedWorkflows?'.qa/company-focused':'.qa/company-real');
const php = process.env.VG_PHP || path.join(root, '.qa/php/runtime/php.exe');
const packages = process.env.VG_NODE_MODULES || process.env.VOLTGUARD_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(path.join(packages, 'playwright'));
const XLSX = require(path.join(root,'tools/staff-app/node_modules/xlsx'));
const chrome = [process.env.VOLTGUARD_CHROME, process.env.VG_CHROME,
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe')].filter(Boolean).find(file => fs.existsSync(file));
const employeeManifest=JSON.parse(fs.readFileSync(path.join(root,'tools/employee-modules.json'),'utf8'));
const allModules = ['uygulamalar',...employeeManifest.modules.filter(item=>!item.draftOnly&&!item.capability).map(item=>item.id)];
const requestedModules = process.argv.find(argument=>argument.startsWith('--modules='))?.slice(10).split(',');
const modules = requestedModules || allModules;
for(const id of modules)assert.ok(allModules.includes(id),'Known module: '+id);
const report = { isolated: true, dataset: 'Temporary synthetic employees and records only', checks: 0, mounts: [], workflows: [], findings: [], pageErrors: [], consoleErrors: [], apiErrors: [], downloads: [] };
function check(actual, expected, reason) { assert.deepEqual(actual, expected, reason); report.checks++; }
function redact(text) { return String(text).replace(/[a-f0-9]{64}/gi, '[redacted-token]').replace(/\b[A-Z2-7]{32}\b/g, '[redacted-secret]'); }
async function freePort() { const listener = net.createServer(); await new Promise(resolve => listener.listen(0,'127.0.0.1',resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve)); return port; }
function totp(secret) {
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; const bits=[...secret].map(c=>alphabet.indexOf(c).toString(2).padStart(5,'0')).join('');
  const key=Buffer.from(bits.match(/.{8}/g).map(byte=>parseInt(byte,2))), counter=Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const hash=crypto.createHmac('sha1',key).update(counter).digest(), at=hash[19]&15;
  return String((hash.readUInt32BE(at)&0x7fffffff)%1000000).padStart(6,'0');
}

async function run() {
  fs.mkdirSync(output,{recursive:true});
  if (!fs.existsSync(path.join(root,'calisan/uygulama/entry-tags.html'))) throw Error('Build company assets before this real integration check.');
  const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'voltguard-company-browser-'));
  const hash=crypto.createHash('sha256').update(fs.realpathSync(root).toLowerCase()).digest('hex').slice(0,20);
  const dataDir=path.join(sandbox,'VoltGuard/preview-data',hash);
  const base=`http://127.0.0.1:${await freePort()}`;
  const environment={...process.env,LOCALAPPDATA:sandbox,VG_PREVIEW_PORT:base.split(':').at(-1),VG_PHP:php,
    VG_DATA_DIR:dataDir,VG_STAFF_SITE_URL:base,VG_SITE_URL:base,VG_MAIL_OUTBOX:'1'};
  const server=spawn(process.execPath,[path.join(root,'tools/preview.cjs')],{cwd:root,env:environment,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
  server.stdout.resume(); server.stderr.resume();
  let browser;
  const actor=()=>({cookies:new Map(),csrf:''}); const admin=actor(), employee=actor();
  async function api(who,endpoint,action,body,query={}) {
    const headers={Cookie:[...who.cookies].map(([k,v])=>`${k}=${v}`).join('; ')};
    if(body!==undefined){headers.Origin=base;headers['Content-Type']='application/json';headers['X-VG-STAFF-CSRF']=who.csrf;}
    const response=await fetch(`${base}/api/${endpoint}.php?${new URLSearchParams({action,...query})}`,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
    for(const cookie of response.headers.getSetCookie()){const first=cookie.split(';')[0],i=first.indexOf('=');who.cookies.set(first.slice(0,i),first.slice(i+1));}
    const payload=await response.json();if(payload.csrf)who.csrf=payload.csrf;
    if(!response.ok||!payload.ok)throw Error(`${endpoint}/${action}: ${response.status} ${payload.error||''} ${payload.message||''}`);
    return payload;
  }
  async function activate(who,invite) {
    await api(who,'staff','me');
    const token=new URL(invite.activationUrl).hash.slice(3);
    const setup=await api(who,'staff','activate',{token,password:'IsolatedBrowserPass123!'});
    check(setup.mode,'enroll','Synthetic account enrolls mandatory MFA');
    const finished=await api(who,'staff','mfa_enroll',{code:totp(setup.secret)});
    who.user=finished.user; return finished.user;
  }
  const query=(table,filters=[])=>api(admin,'company','query',{table,operation:'select',select:'*',filters,order:[],limit:1000,range:null,single:null,rows:null,onConflict:null,returning:false});
  async function rows(table) { return (await query(table)).data || []; }
  async function waitRow(table,predicate,timeout=8000) {
    const end=Date.now()+timeout;
    do {const found=(await rows(table)).find(predicate);if(found)return found;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<end);
    throw Error(`Expected saved record not found in ${table}.`);
  }
  let page,phase='setup';
  async function mount(id) {
    phase=id;
    await page.goto(base+'/calisan/uygulama/?module='+id,{waitUntil:'domcontentloaded',timeout:15000});
    await page.locator('[data-portal-module], .company-load-error').waitFor({state:'visible',timeout:15000});
    if(await page.locator('.company-load-error').count())throw Error(await page.locator('.company-load-error').innerText());
    check(await page.locator('[data-portal-module]').getAttribute('data-portal-module'),id,'Requested real module is mounted');
    await page.waitForTimeout(600);
  }
  async function fill(label,value,scope=page) {
    const labelNode=scope.locator('label').filter({hasText:label}).first();
    let input=labelNode.locator('input,select,textarea').first();
    if(!await input.count())input=labelNode.locator('xpath=..').locator('input,select,textarea').first();
    if(!await input.count())throw Error('Control not found for label: '+label);
    const tag=await input.evaluate(element=>element.tagName);
    if(tag==='SELECT') {try{await input.selectOption(String(value));}catch{await input.selectOption({label:String(value)});}}
    else await input.fill(String(value));
  }
  async function workflow(name,fn) {
    if(selectedWorkflows&&!selectedWorkflows.has(name))return;
    phase=name;
    const before=report.apiErrors.length;
    try {await fn();report.workflows.push({name,ok:true,apiErrors:report.apiErrors.length-before});}
    catch(error){report.workflows.push({name,ok:false,error:redact(error.message)});report.findings.push({phase:name,message:redact(error.message)});if(page)await page.screenshot({path:path.join(output,name.replace(/[^a-z0-9-]/gi,'-')+'-failure.png')}).catch(()=>{});}
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({phase:name,...report.workflows.at(-1)}));
  }
  async function download(label,click) {
    const started=Date.now();const pending=page.waitForEvent('download',{timeout:60000});await click();const file=await pending;
    const destination=path.join(output,label+'-'+file.suggestedFilename());await file.saveAs(destination);
    const bytes=fs.readFileSync(destination);report.downloads.push({label,name:file.suggestedFilename(),bytes:bytes.length,elapsedMs:Date.now()-started});console.log(JSON.stringify({download:label,bytes:bytes.length,elapsedMs:Date.now()-started}));
    if(destination.toLowerCase().endsWith('.pdf'))check(bytes.subarray(0,5).toString(),'%PDF-','Real PDF export has PDF header');
    if(/\.(?:docx|xlsx)$/i.test(destination)){check(bytes.subarray(0,2).toString(),'PK','Office export is a ZIP document');check(bytes.length>1000,true,'Office document contains nonempty data');if(/\.xlsx$/i.test(destination))check(XLSX.read(bytes,{type:'buffer'}).SheetNames.length>0,true,'Exported workbook opens with a populated sheet');}
    return bytes;
  }
  try {
    let ready=false;for(let i=0;i<140;i++){try{await fetch(base);ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,50));}}
    assert.ok(ready,'Isolated preview starts');
    const cli=spawnSync(php,['-n',path.join(root,'tools/staff-admin.php'),'bootstrap-invite','--email=qa-admin@example.invalid','--name=QA Yönetici'],{env:environment,encoding:'utf8',windowsHide:true});
    if(cli.status!==0)throw Error('Synthetic administrator invitation setup failed.');
    const invitation=JSON.parse(cli.stdout);await activate(admin,invitation);
    const employeeInvite=await api(admin,'staff','create_invite',{name:'QA Çalışan',email:'qa-employee@example.invalid',role:'employee'});await activate(employee,employeeInvite);
    const bootstrap=await api(admin,'company','bootstrap');
    check(bootstrap.data.user.role,'admin','Real private identity is administrator');
    check(bootstrap.data.catalog.historicalInvoice1.length,0,'Synthetic dataset never loads real historical invoice catalog');
    check(bootstrap.data.catalog.historicalInvoice2.length,0,'No second real historical invoice catalog');
    check(Object.keys(bootstrap.data.catalog.cablePrices).length,0,'No real cable catalog in isolated dataset');
    browser=await chromium.launch({executablePath:chrome,headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:1050},locale:'tr-TR',timezoneId:'Europe/Istanbul',acceptDownloads:true,serviceWorkers:'block'});
    await context.addCookies([...admin.cookies].filter(([name])=>name==='VGSTAFF').map(([name,value])=>({name,value,url:base,httpOnly:true,sameSite:'Strict'})));
    page=await context.newPage();page.setDefaultTimeout(10000);
    page.on('dialog',dialog=>{report.dialogs ||= [];report.dialogs.push({phase,type:dialog.type(),message:redact(dialog.message())});const action=dialog.type()==='confirm'&&/otomatik olarak doldurulsun/i.test(dialog.message())?dialog.dismiss():dialog.type()==='prompt'?dialog.accept(dialog.defaultValue()||'QA teklif'):dialog.accept();action.catch(error=>{if(!/Not attached to an active page|Target (page|context|browser).*closed/i.test(error.message))report.pageErrors.push({phase,message:redact(error.message)});});});
    page.on('pageerror',error=>report.pageErrors.push({phase,message:redact(error.message)}));
    page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push({phase,message:redact(message.text())});});
    page.on('response',async response=>{
      const pathname=new URL(response.url()).pathname;
      if(response.status()>=400&&pathname.startsWith('/api/')){
        let payload;try{payload=await response.json();}catch{payload={};}
        const request=response.request();let input={};try{input=request.postDataJSON()||{};}catch{}
        report.apiErrors.push({phase,path:pathname,status:response.status(),error:payload.error,message:redact(payload.message||''),action:new URL(response.url()).searchParams.get('action'),table:input.table,operation:input.operation,select:input.select,filters:input.filters?.map(({op,field})=>({op,field})),rpc:input.name,sahaFunction:input.name==='app_saha_function'?input.args?.name:undefined});
      }
    });
    if(ownWhiteOnly){
      await workflow('employee-white-mobile-host-css',async()=>{
        await api(admin,'company','query',{table:'beyaz_yaka_employees',operation:'insert',select:'*',rows:[{name:'QA Beyaz Personel',monthly_salary:50000,start_date:'2026-10-01',active:true,user_id:employee.user.id}],filters:[],order:[],limit:null,range:null,single:'one',returning:true,onConflict:null});
        const own=await browser.newContext({viewport:{width:390,height:844},locale:'tr-TR',timezoneId:'Europe/Istanbul',serviceWorkers:'block'});
        await own.addCookies([...employee.cookies].filter(([name])=>name==='VGSTAFF').map(([name,value])=>({name,value,url:base,httpOnly:true,sameSite:'Strict'})));
        page=await own.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>report.pageErrors.push({phase,message:redact(error.message)}));page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push({phase,message:redact(message.text())});});
        await page.goto(base+'/calisan/uygulama/?module=beyaz-yaka',{waitUntil:'domcontentloaded'});await page.locator('[data-payroll-access="own"]').waitFor({state:'visible'});await page.getByText('QA Beyaz Personel',{exact:true}).first().waitFor({state:'visible'});await page.waitForTimeout(600);
        const dimensions=await page.evaluate(()=>{const header=document.querySelector('header').getBoundingClientRect();return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,margin:getComputedStyle(document.body).margin,headerLeft:header.left,headerRight:header.right};});
        check(dimensions.margin,'0px','Company host page removes browser default body margin');check(dimensions.headerLeft,0,'Mobile shared header begins at left viewport edge');check(dimensions.headerRight,390,'Mobile shared header ends at right viewport edge');check(dimensions.scrollWidth<=dimensions.viewport,true,'Own white payroll does not overflow mobile viewport');
        check(await page.locator('[data-payroll-access="manage"]').count(),0,'Own employee has no payroll management mode');check(await page.getByRole('button',{name:/Yeni çalışan/i}).count(),0,'Own employee cannot create payroll employee');
        report.mounts.push({id:'beyaz-yaka',identity:'ordinary employee',...dimensions});await page.screenshot({path:path.join(output,'employee-beyaz-yaka-390-real.png'),fullPage:true});
      });
      return;
    }
    if(process.env.VG_COMPANY_ADMIN_OUTPUT_FOCUS==='1'){
      await require('./company-output-admin.cjs')({page,admin,employee,api,rows,waitRow,mount,fill,workflow,check,report,download,output,base,browser});
      return;
    }
    if(process.env.VG_COMPANY_SUBMIT_FOCUS==='1'){
      await require('./company-submit-scenarios.cjs')({page,admin,api,rows,waitRow,mount,fill,workflow,check,report,download,output});
      return;
    }
    if(process.env.VG_COMPANY_OUTPUT_FOCUS==='1'){
      await require('./company-output-scenarios.cjs')({page,admin,employee,api,rows,waitRow,mount,fill,workflow,check,report,download,output,base,browser});
      return;
    }
    for(const id of modules){
      const before=report.apiErrors.length;
      await workflow('mount:'+id,async()=>{await mount(id);const bounds=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));report.mounts.push({id,...bounds,apiErrors:report.apiErrors.length-before});if(['dashboard','bordro','beyaz-yaka'].includes(id))await page.screenshot({path:path.join(output,id+'-real.png')});});
    }
    if(process.argv.includes('--mount-only'))return;
    if(modules.some(id=>id==='uygulamalar'||employeeManifest.modules.some(item=>item.id===id&&item.variants.some(variant=>variant.route)))) await require('./saha-browser-scenarios.cjs')({page,admin,employee,api,mount,workflow,check,report,output,base,browser});
    await workflow('work-employee-location-material-record-crud',async()=>{
      await mount('is-takip');await page.getByRole('button',{name:/^Çalışanlar/}).click();await page.getByRole('button',{name:'Yeni Çalışan',exact:true}).click();
      await page.getByPlaceholder('Örn: Ahmet Yılmaz').fill('QA Teknik Personel');await page.getByPlaceholder('Örn: Teknisyen, Usta, Mühendis').fill('QA Teknisyen');await page.getByRole('button',{name:'Kaydet',exact:true}).click();
      const worker=await waitRow('is_takip_calisanlar',row=>row.ad_soyad==='QA Teknik Personel');
      await page.getByRole('button',{name:/^Lokasyonlar/}).click();await page.getByRole('button',{name:'Yeni Lokasyon',exact:true}).click();await page.getByPlaceholder('Örn: Fabrika 1, Şantiye A').fill('QA Test Lokasyonu');await page.getByRole('button',{name:'Kaydet',exact:true}).click();
      const location=await waitRow('is_takip_lokasyonlar',row=>row.ad==='QA Test Lokasyonu');
      await page.getByRole('button',{name:/^Malzemeler/}).click();await page.getByRole('button',{name:'Yeni Malzeme',exact:true}).click();await page.getByPlaceholder('Örn: Vida, Boya, Kablo').fill('QA Test Malzemesi');await page.getByRole('button',{name:'Kaydet',exact:true}).click();
      const material=await waitRow('is_takip_malzemeler',row=>row.ad==='QA Test Malzemesi');
      await page.getByRole('button',{name:'İş Kayıtları',exact:true}).click();await page.getByRole('button',{name:'İş Kaydı Ekle',exact:true}).click();const form=page.locator('form');
      await fill('Çalışan',worker.id,form);await fill('Lokasyon',location.id,form);await fill('Başlangıç Saati','09:00',form);await fill('Bitiş Saati','10:30',form);await page.getByPlaceholder('Yapılan işi detaylı açıklayınız...').fill('QA doğrulama işi');await page.getByRole('button',{name:'Kaydet',exact:true}).click();
      const record=await waitRow('is_takip_kayitlar',row=>row.yapilan_is==='QA doğrulama işi');check(record.toplam_sure,1.5,'Work duration remains numeric through actual PHP');
      await page.locator('tr').filter({hasText:'QA doğrulama işi'}).locator('button').first().click();await page.getByPlaceholder('Yapılan işi detaylı açıklayınız...').fill('QA düzenlenen iş');await page.getByRole('button',{name:'Güncelle',exact:true}).click();await waitRow('is_takip_kayitlar',row=>row.id===record.id&&row.yapilan_is==='QA düzenlenen iş');
      await download('work-excel',()=>page.getByRole('button',{name:'Excel',exact:true}).click());await download('work-pdf',()=>page.getByRole('button',{name:'PDF',exact:true}).click());
      await page.locator('tr').filter({hasText:'QA düzenlenen iş'}).locator('button').last().click();await page.waitForTimeout(250);check((await rows('is_takip_kayitlar')).some(row=>row.id===record.id),false,'Work record deletion persists');
      for(const [tab,text,table,id] of [['Malzemeler','QA Test Malzemesi','is_takip_malzemeler',material.id],['Lokasyonlar','QA Test Lokasyonu','is_takip_lokasyonlar',location.id],['Çalışanlar','QA Teknik Personel','is_takip_calisanlar',worker.id]]){await page.getByRole('button',{name:new RegExp('^'+tab)}).click();await page.locator('tr').filter({hasText:text}).locator('button').last().click();await page.waitForTimeout(250);check((await rows(table)).some(row=>row.id===id),false,'Associated work entity deletion persists: '+table);}
    });
    await workflow('task-create-update-delete',async()=>{
      await mount('gorev');await page.getByRole('button',{name:'Yeni Görev',exact:true}).click();
      await page.getByPlaceholder('Görev başlığını girin...').fill('QA görev kaydı');
      await page.getByPlaceholder('Görev detaylarını girin...').fill('Yalnızca geçici veri.');
      await page.getByRole('button',{name:'Kaydet',exact:true}).click();
      const item=await waitRow('gorevler',row=>row.baslik==='QA görev kaydı');
      await page.getByRole('button',{name:'Düzenle',exact:true}).first().click();
      await page.getByPlaceholder('Görev başlığını girin...').fill('QA görev düzenlendi');
      await page.getByRole('button',{name:'Güncelle',exact:true}).click();
      await waitRow('gorevler',row=>row.id===item.id&&row.baslik==='QA görev düzenlendi');
      const card=page.getByRole('heading',{name:'QA görev düzenlendi',exact:true}).locator('xpath=../..');
      await card.locator('button').last().click();
      await page.waitForTimeout(300);check((await rows('gorevler')).some(row=>row.id===item.id),false,'Real task deletion persists');
    });
    await workflow('inventory-create-update-pdf-delete',async()=>{
      await mount('urun-takip');await page.getByRole('button',{name:/Yeni ürün Ekle|Yeni Ürün Ekle/i}).click();
      await page.getByPlaceholder('örn: Panel, Trafo, Kablo vb.').fill('QA Ürün');
      await page.getByPlaceholder('örn: Elektrik Malzemesi').fill('QA Kategori');
      await page.getByRole('button',{name:'Kaydet',exact:true}).click();
      const item=await waitRow('urun_takip',row=>row.urun_adi==='QA Ürün');
      const row=page.locator('tr').filter({hasText:'QA Ürün'});await row.locator('button').first().click();
      await page.getByPlaceholder('örn: Panel, Trafo, Kablo vb.').fill('QA Ürün Güncellendi');await page.getByRole('button',{name:'Güncelle',exact:true}).click();
      await waitRow('urun_takip',row=>row.id===item.id&&row.urun_adi==='QA Ürün Güncellendi');
      await download('urun',()=>page.getByRole('button',{name:/PDF.*indir|PDF.*İndir/i}).click());
      await page.locator('tr').filter({hasText:'QA Ürün Güncellendi'}).locator('button').last().click();await page.waitForTimeout(300);
      check((await rows('urun_takip')).some(row=>row.id===item.id),false,'Real inventory deletion persists');
    });
    await workflow('fuel-create-update-excel-pdf-delete',async()=>{
      await mount('akaryakit');await page.getByRole('button',{name:'Yakıt Kaydı Ekle',exact:true}).click();
      await page.locator('form').getByPlaceholder('34 ABC 123').fill('34 QA 001');await page.locator('form').getByPlaceholder('Ahmet Yılmaz').fill('QA Sürücü');await page.getByPlaceholder('0.00').fill('1234.56');
      await page.getByRole('button',{name:'Kaydet',exact:true}).click();
      const item=await waitRow('fuel_records',row=>Number(row.total_amount)===1234.56);
      await download('fuel-excel',()=>page.getByRole('button',{name:"Excel'e Aktar",exact:true}).click());
      await download('fuel-pdf',()=>page.getByRole('button',{name:"PDF'e Aktar",exact:true}).click());
      const row=page.locator('tr').filter({hasText:'34 QA 001'});await row.locator('button').first().click();await page.getByPlaceholder('0.00').fill('1300');await page.getByRole('button',{name:'Güncelle',exact:true}).click();
      await waitRow('fuel_records',row=>row.id===item.id&&Number(row.total_amount)===1300);
      await page.locator('tr').filter({hasText:'34 QA 001'}).locator('button').last().click();await page.waitForTimeout(300);check((await rows('fuel_records')).some(row=>row.id===item.id),false,'Real fuel deletion persists');
    });
    await workflow('yg-proposal-save-open-pdf-delete',async()=>{
      await mount('manual');await page.getByPlaceholder('Örn: ABC Endüstri San. ve Tic. A.Ş.').fill('QA Test Tesisi');await page.getByPlaceholder('Örn: Ahmet Yilmaz').fill('QA Yetkili');await page.getByPlaceholder('Örn: Tekstil, Güçda').fill('QA Sektör');await page.getByPlaceholder('Örn: 1600 veya 1000+630').fill('630');
      await page.getByRole('button',{name:'Kaydet',exact:true}).click();const item=await waitRow('proposals',row=>row.type==='yg'&&row.name.includes('QA Test Tesisi'));
      await mount('saved');await page.getByRole('button',{name:/Yükle|Yikle/}).first().click();
      await page.locator('[data-portal-module="proposal"]').waitFor({state:'visible'});
      await download('yg-proposal',()=>page.getByRole('button',{name:/PDF/}).first().click());
      await download('yg-word',()=>page.getByRole('button',{name:/Word.*İndir/}).click());
      await download('yg-excel',()=>page.getByRole('button',{name:/Excel.*İndir/}).click());
      await mount('saved');await page.getByRole('heading',{name:item.name,exact:true}).locator('xpath=..').locator('button').last().click();await page.waitForTimeout(300);check((await rows('proposals')).some(row=>row.id===item.id),false,'Real saved proposal deletion persists');
    });
    await workflow('weekly-three-excel-import-save-export-delete',async()=>{
      await mount('haftalik-raporlama');await page.getByRole('button',{name:'Yeni Rapor',exact:true}).click();await page.getByPlaceholder('Örn: ABC Fabrikası').fill('QA Haftalık Tesis');await page.getByRole('button',{name:'Bu Hafta',exact:true}).click();await page.getByPlaceholder('0.920').fill('0.95');await page.locator('#ilkKayit').check();await page.getByPlaceholder('327.06').fill('100');await page.getByPlaceholder('Örn: Otomatik kompanzasyon aktif, 3 kademe çalışıyor').fill('Sentetik QA kaydı');
      const inputs=page.locator('input[type="file"][accept=".xls,.xlsx"]');check(await inputs.count(),3,'Weekly editor provides all three energy spreadsheets');
      for(let index=0;index<3;index++){const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet([{Tarih:'2026-10-12 00:00:00','Tüketim':100/(index+1),'Çarpan':1},{Tarih:'2026-10-13 00:00:00','Tüketim':200/(index+1),'Çarpan':1}]),'QA');await inputs.nth(index).setInputFiles({name:'qa-energy-'+index+'.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(workbook,{type:'buffer',bookType:'xlsx'})});await page.waitForTimeout(150);}
      await page.getByRole('button',{name:'Kaydet',exact:true}).click();const record=await waitRow('haftalik_raporlar',row=>row.fabrika_adi==='QA Haftalık Tesis');for(const field of ['excel_data_aktif','excel_data_enduktif','excel_data_kapasitif'])check(JSON.parse(record[field]).length,2,'Excel import persists both records: '+field);check(record.enerji_tuketimi,300,'Active import retains numeric consumption');
      await page.getByRole('button',{name:'PDF',exact:true}).first().click();await download('weekly-pdf',()=>page.getByRole('button',{name:'PDF İndir',exact:true}).click());
      await mount('haftalik-raporlama');await page.getByRole('button',{name:'Düzenle',exact:true}).first().locator('xpath=..').locator('button').last().click();await page.waitForTimeout(250);check((await rows('haftalik_raporlar')).some(row=>row.id===record.id),false,'Weekly report deletion persists');
    });
    await workflow('osos-measurement-json-and-energy-import-save',async()=>{
      await mount('osos');const direct=[{sayac_no:'QA-TEST-001',olcum_zamani:'2026-10-13T09:00:00+03:00',aktif_guc:12.5,gerilim_l1:230,guc_faktoru:0.95,frekans:50}];
      await page.locator('input[type="file"]').first().setInputFiles({name:'qa-measurement.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(direct))});const record=await waitRow('osos_olcumler',row=>row.sayac_no==='QA-TEST-001');check(record.aktif_guc,12.5,'OSOS direct JSON retains measured numeric value');
      await mount('osos');const energy=[{Tarih:'2026-10-12 00:00:00','Tüketim ()':'100','Çarpan':'1','Endeks Kodu':'1.8.0'},{Tarih:'2026-10-13 00:00:00','Tüketim ()':'200','Çarpan':'1','Endeks Kodu':'1.8.0'}];await page.locator('input[type="file"]').first().setInputFiles({name:'qa-energy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(energy))});await page.getByRole('button',{name:'İçe Aktar',exact:true}).click();await waitRow('company_documents',row=>row.kind==='osos_fabrika');
      await page.getByRole('button',{name:'Kaydet',exact:true}).first().click();await waitRow('company_documents',row=>row.kind==='osos_rapor');
    });
    await workflow('blue-employee-association-month-save',async()=>{
      await mount('bordro');await page.getByRole('button',{name:'YENİ PERSONEL',exact:true}).click();
      await fill('Çalışan hesabı',employee.user.id);await fill('Ad Soyad','QA Mavi Personel');await fill('Anlaşılan Net Maaş','50000');await fill('Muhasebe bordrosundaki maaş tutarı','40000');
      await page.getByRole('button',{name:'KAYDET',exact:true}).click();const item=await waitRow('bordro_employees',row=>row.name==='QA Mavi Personel');check(item.user_id,employee.user.id,'Blue payroll retains real staff association');
      const save=page.getByRole('button',{name:'Ayı Kapat & Kaydet',exact:true});await save.click();
      await waitRow('monthly_payroll_summary',row=>row.employee_id===item.id);
    });
    await workflow('white-employee-association-payroll-save',async()=>{
      await mount('beyaz-yaka');await page.getByRole('button',{name:/Yeni Çalışan|Yeni Personel|Çalışan Ekle/i}).first().click();
      await fill('Çalışan hesabı',employee.user.id);await fill('Ad Soyad','QA Beyaz Personel');await fill('İşe Başlama Tarihi','2026-10-01');await fill('Aylık Net Maaş','50000');
      await page.getByRole('button',{name:'Kaydet',exact:true}).click();const item=await waitRow('beyaz_yaka_employees',row=>row.name==='QA Beyaz Personel');check(item.user_id,employee.user.id,'White payroll retains real staff association');
      await page.locator('tr').filter({hasText:'QA Beyaz Personel'}).getByRole('button',{name:/Detay/}).click();
      const save=page.getByRole('button',{name:'Kaydet',exact:true}).first();await save.click();await waitRow('beyaz_yaka_monthly_payroll',row=>row.employee_id===item.id);
    });
    await workflow('ordinary-employee-only-own-payroll-ui',async()=>{
      const own=await browser.newContext({viewport:{width:390,height:844},locale:'tr-TR',timezoneId:'Europe/Istanbul',serviceWorkers:'block'});
      await own.addCookies([...employee.cookies].filter(([name])=>name==='VGSTAFF').map(([name,value])=>({name,value,url:base,httpOnly:true,sameSite:'Strict'})));
      const ownPage=await own.newPage();ownPage.setDefaultTimeout(10000);ownPage.on('pageerror',error=>report.pageErrors.push({phase:'employee-own-payroll',message:redact(error.message)}));ownPage.on('console',message=>{if(message.type()==='error')report.consoleErrors.push({phase:'employee-own-payroll',message:redact(message.text())});});
      for(const [id,name] of [['bordro','QA Mavi Personel'],['beyaz-yaka','QA Beyaz Personel']]){await ownPage.goto(base+'/calisan/uygulama/?module='+id,{waitUntil:'domcontentloaded'});await ownPage.locator('[data-payroll-access="own"]').waitFor({state:'visible'});await ownPage.getByText(name,{exact:true}).first().waitFor({state:'visible'});check(await ownPage.locator('[data-payroll-access="manage"]').count(),0,'Ordinary employee never receives payroll management UI');check(await ownPage.getByRole('button',{name:'YENİ PERSONEL',exact:true}).count(),0,'Ordinary employee cannot create payroll person');check(await ownPage.getByRole('button',{name:/Yeni çalışan/i}).count(),0,'Ordinary employee cannot create white payroll person');await ownPage.screenshot({path:path.join(output,'employee-'+id+'-390-real.png')});}
      await own.close();
    });
    await workflow('admin-role-and-payroll-toggle-persist',async()=>{
      await mount('admin');const card=page.locator('article').filter({hasText:'qa-employee@example.invalid'});await card.getByRole('button',{name:'Yetkileri düzenle',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Çalışan yetkileri'});await fill('Rol','payroll',dialog);check(await dialog.getByRole('checkbox').isChecked(),true,'Payroll role automatically checks management permission');await dialog.getByRole('button',{name:'Yetkileri kaydet',exact:true}).click();await waitRow('users',row=>row.id===employee.user.id&&row.role==='payroll'&&row.can_access_bordro===true);
      await card.getByRole('button',{name:'Yetkileri düzenle',exact:true}).click();await dialog.getByRole('checkbox').uncheck();check(await dialog.locator('select').inputValue(),'employee','Unchecking management permission returns ordinary employee role');await dialog.getByRole('button',{name:'Yetkileri kaydet',exact:true}).click();await waitRow('users',row=>row.id===employee.user.id&&row.role==='employee'&&row.can_access_bordro===false);
    });
    if(selectedWorkflows&&!report.workflows.length)throw Error('Requested workflow was not found.');
  } finally {
    if(page)await page.screenshot({path:path.join(output,'last-real.png')}).catch(()=>{});
    if(browser)await browser.close();
    if(server.connected)server.send('vg-preview-shutdown');else server.kill();
    await new Promise(resolve=>{if(server.exitCode!==null)resolve();else{server.once('exit',resolve);setTimeout(()=>{if(server.exitCode===null)server.kill();resolve();},3000);}});
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
    const actual=fs.realpathSync(sandbox),relative=path.relative(fs.realpathSync(os.tmpdir()),actual);
    assert.ok(relative.startsWith('voltguard-company-browser-')&&!relative.includes(path.sep),'Cleanup limited to synthetic temporary dataset');fs.rmSync(actual,{recursive:true,force:true});
    console.log(JSON.stringify({checks:report.checks,mounts:report.mounts.length,workflows:report.workflows,apiErrors:report.apiErrors,pageErrors:report.pageErrors,consoleErrors:report.consoleErrors,findings:report.findings,downloads:report.downloads}));
  }
}
run().then(()=>{if(report.findings.length||report.pageErrors.length||report.consoleErrors.length||report.apiErrors.length)process.exitCode=1;}).catch(error=>{console.error(redact(error.message));process.exitCode=1;});

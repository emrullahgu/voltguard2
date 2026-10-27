'use strict';
const path=require('node:path');
// Actual portal DOM/compiled roots/PHP API; caller owns a disposable synthetic dataset.
module.exports=async function employeeScenarios({page,admin,api,mount,workflow,check,report,output,base}){
 const host=()=>page.locator('[data-employee-module-host]');
 async function ready(route){try{
  await page.locator('[data-employee-native-module][data-module-route="'+route+'"]').waitFor({state:'visible',timeout:90000});
  await page.waitForFunction(()=>!!document.querySelector('[data-employee-module-host]')?.shadowRoot?.childElementCount,null,{timeout:90000});
  await page.getByText('Modül yükleniyor…',{exact:true}).waitFor({state:'hidden',timeout:90000});
  // Initial module effects may still persist usage/cache data after rendering.
  // Normal navigation is tested after those real requests settle; the separate
  // held-write scenario verifies the busy boundary without bypassing it.
  await page.waitForLoadState('networkidle',{timeout:30000});
 }catch(error){(report.employeeModuleDiagnostics||=[]).push({route,...await page.locator('[data-portal-module]').evaluate(node=>({url:location.search,activeRoute:node.querySelector('[data-employee-native-module]')?.dataset.moduleRoute,outer:node.innerText.slice(0,5000),native:node.querySelector('[data-employee-module-host]')?.shadowRoot?.querySelector('[data-vg-module-root]')?.innerText.slice(0,10000)})).catch(e=>({error:e.message}))});throw error;}}
 async function rows(table){return(await api(admin,'company','rpc',{name:'app_saha_query',args:{table,operation:'select',select:'*',filters:[],order:[],limit:1000}})).data.data||[];}
 async function saved(table,predicate){for(let i=0;i<80;i++){const row=(await rows(table)).find(predicate);if(row)return row;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Employee record not committed: '+table);}
 async function reload(route){const previous=await host().locator('[data-vg-module-root]').elementHandle();await page.getByRole('button',{name:'Kayıtları yenile',exact:true}).click();if(previous)await page.waitForFunction(node=>!node.isConnected,previous);await ready(route);}
 async function customerForm(name){
  await host().getByRole('button',{name:'Yeni müşteri ekle',exact:true}).click();
  await host().getByPlaceholder('EGEBORU',{exact:true}).fill(name);
  await host().getByPlaceholder('ABC SANAYİ VE TİCARET A.Ş.',{exact:true}).fill(name+' Sentetik Test Şirketi');
  await host().getByPlaceholder('info@firma.com',{exact:true}).fill('native-employee@example.invalid');
 }
 async function noSecondShell(){
  check(await page.locator('[data-portal-module] iframe').count(),0,'Employee modules mount directly in the portal DOM');
  check(await host().getByText('Keşfet',{exact:true}).count(),0,'No imported second navigation is rendered');
  check(await host().getByText('Yönetici Dashboard',{exact:true}).count(),0,'No imported project dashboard wraps employee work');
  check(await page.getByText('SahaTakip’i aç',{exact:false}).count(),0,'No separate-project launcher remains');
 }
 async function liveThemePreservesForm(){
  const input=host().getByPlaceholder('EGEBORU',{exact:true}),element=await input.elementHandle();
  const original=await input.inputValue(),theme=await page.locator('html').getAttribute('data-theme');
  const before=await input.evaluate(node=>({color:getComputedStyle(node).color,background:getComputedStyle(node).backgroundColor}));
  report.employeeTheme={before};
  await page.locator('[data-vg-theme-toggle]:visible').first().click();
  await page.waitForFunction(previous=>document.documentElement.dataset.theme!==previous,theme);
  try{await page.waitForFunction(previous=>{const input=document.querySelector('[data-employee-module-host]').shadowRoot.querySelector('input[placeholder="EGEBORU"]');return getComputedStyle(input).color!==previous.color||getComputedStyle(input).backgroundColor!==previous.background;},before);}
  finally{report.employeeTheme.after=await input.evaluate(node=>({color:getComputedStyle(node).color,background:getComputedStyle(node).backgroundColor}));report.employeeTheme.mode=await page.locator('html').getAttribute('data-theme');}
  check(await input.inputValue(),original,'Site theme toggle preserves the unsaved customer name');check(await element.evaluate(node=>node.isConnected),true,'Theme changes do not replace the native form root');
  report.employeeTheme={before,after:await input.evaluate(node=>({color:getComputedStyle(node).color,background:getComputedStyle(node).backgroundColor}))};
  await page.locator('[data-vg-theme-toggle]:visible').first().click();await page.waitForFunction(previous=>document.documentElement.dataset.theme===previous,theme);
 }
 await workflow('employee-native-discovery',async()=>{
  await page.setViewportSize({width:1440,height:1000});await mount('uygulamalar');const home=page.locator('[data-employee-applications]');await home.waitFor({state:'visible'});
  check(await page.locator('[data-portal-module] iframe').count(),0,'Employee home is native portal content');
  for(const label of ['Müşteriler','İş emirleri','Görev takibi'])check(await home.getByRole('button',{name:new RegExp('^'+label)}).count(),1,'Work module is directly discoverable: '+label);
  await page.screenshot({path:path.join(output,'employee-home-desktop.png'),fullPage:false});
  await home.getByRole('searchbox',{name:'Uygulamalarda ara',exact:true}).fill('müşteri');
  check(await home.getByRole('button',{name:/^Müşteriler/}).isVisible(),true,'Module search finds customer work');
  await home.getByRole('button',{name:/^Müşteriler/}).click();await ready('Customers');
  check(await page.locator('[data-portal-module]').getAttribute('data-portal-module'),'musteriler','Customer domain opens from employee home');
  check(await host().evaluate(node=>node.shadowRoot?.mode),'open','The native runtime uses an inspectable isolated DOM root');
  check(await host().locator('input[type="password"]').count(),0,'The employee session is reused without a second login');
  check((await rows('customers')).length,0,'No customer seeds are inserted');check((await rows('work_orders')).length,0,'No work-order seeds are inserted');
  await noSecondShell();await page.screenshot({path:path.join(output,'employee-native-desktop.png'),fullPage:true});
 });
 await workflow('employee-customer-work-order',async()=>{
  await mount('musteriler');await ready('Customers');await customerForm('QA Doğal Portal Müşteri');await liveThemePreservesForm();await host().getByText('Müşteri Ekle',{exact:true}).click();
  const customer=await saved('customers',row=>row.short_name==='QA Doğal Portal Müşteri');check(customer.title,'QA Doğal Portal Müşteri Sentetik Test Şirketi','Customer form commits through existing private API');
  await host().getByRole('button',{name:'Yeni müşteri ekle',exact:true}).waitFor({state:'visible'});
  await reload('Customers');await host().getByText(customer.short_name,{exact:true}).first().waitFor({state:'visible'});check(await host().getByText(customer.short_name,{exact:true}).first().isVisible(),true,'Customer survives a native remount');await page.screenshot({path:path.join(output,'employee-customer-desktop.png'),fullPage:true});
  await mount('is-emirleri');await ready('WorkOrders');await host().getByRole('button',{name:'İş emri ekle',exact:true}).click();
  await host().getByPlaceholder('Müşteri ara (ad, ünvan, vergi no)...',{exact:true}).fill('QA Doğal Portal');await host().getByText(customer.short_name,{exact:true}).first().click();
  await host().getByPlaceholder('Örn. Trafo periyodik bakımı, pano montajı...',{exact:true}).fill('QA Doğal Portal İş Emri');await host().getByText('Ofis İşi',{exact:true}).click();await host().getByText('İş Emrini Oluştur',{exact:true}).click();
  const order=await saved('work_orders',row=>row.service_name==='QA Doğal Portal İş Emri');check(order.job_type,'OFFICE','Work type survives native adapter');check(order.customer_name,customer.short_name,'Work order retains customer');
  await host().getByText('Yeni İş Emri',{exact:true}).waitFor({state:'hidden'});await host().getByRole('button',{name:'İş emri ekle',exact:true}).waitFor({state:'visible'});
  await reload('WorkOrders');await host().getByText(order.service_name,{exact:true}).first().waitFor({state:'visible'});check(await host().getByText(order.service_name,{exact:true}).first().isVisible(),true,'Work order survives native remount');
  await noSecondShell();report.employeeCustomerId=customer.id;report.employeeOrderId=order.id;
 });
 await workflow('employee-mobile-write-guard',async()=>{
  await page.setViewportSize({width:390,height:844});await mount('musteriler');await ready('Customers');const bounds=await page.evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth}));check(bounds.content<=bounds.width+2,true,'Native work fits mobile viewport');
  const nativeBounds=await host().evaluate(node=>{const root=node.shadowRoot.querySelector('[data-vg-module-root]'),box=node.getBoundingClientRect();return {hostWidth:box.width,rootWidth:root.getBoundingClientRect().width,contentWidth:root.scrollWidth,clipped:[...node.shadowRoot.querySelectorAll('input,textarea,button,[role="button"]')].filter(control=>{const rect=control.getBoundingClientRect();return rect.width&&rect.height&&!control.closest('[aria-hidden="true"]')&&getComputedStyle(control).visibility!=='hidden'&&(rect.left<box.left-2||rect.right>box.right+2);}).map(control=>({label:control.getAttribute('aria-label'),text:control.textContent.slice(0,80)}))};});
  (report.employeeNativeBounds||=[]).push(nativeBounds);check(nativeBounds.rootWidth<=nativeBounds.hostWidth+2,true,'Native root measures the available portal host rather than the full browser window');check(nativeBounds.contentWidth<=nativeBounds.hostWidth+2,true,'Native content fits its actual ShadowRoot host');check(nativeBounds.clipped,[],'Mobile native controls are not hidden by the outer overflow boundary');
  await customerForm('QA Bekleyen Portal Kaydı');let release,started;const held=new Promise(resolve=>{release=resolve;}),captured=new Promise(resolve=>{started=resolve;});let intercepted=false;
  const intercept=async route=>{let body;try{body=route.request().postDataJSON();}catch{}if(!intercepted&&body?.name==='app_saha_query'&&body.args?.table==='customers'&&body.args?.operation==='insert'){intercepted=true;started();await held;}await route.continue();};
  await page.route('**/api/company.php?action=rpc',intercept);
  try{
   await host().getByText('Müşteri Ekle',{exact:true}).click();let timer;try{await Promise.race([captured,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Real pending customer request did not start')),10000);})]);}finally{clearTimeout(timer);}
   await page.getByRole('button',{name:'Modüller',exact:true}).click();await page.locator('#portal-modules').getByRole('button',{name:'Görev takibi',exact:true}).click();check(await page.locator('[data-portal-module]').getAttribute('data-portal-module'),'musteriler','Real in-flight save prevents parent module unmount');
   const warning=page.getByText('Kaydınız sunucuya yazılıyor. İşlem tamamlandığında bölüm değiştirebilirsiniz.',{exact:true});await warning.waitFor({state:'visible'});release();await saved('customers',row=>row.short_name==='QA Bekleyen Portal Kaydı');await warning.waitFor({state:'hidden'});await host().getByRole('button',{name:'Yeni müşteri ekle',exact:true}).waitFor({state:'visible'});check(await warning.isVisible(),false,'Saving notice clears after actual write, without reload');
   // Capture the settled list after the normal transient saved/partial-notify
   // toast expires; never hide the real save guard or alter product DOM.
   await host().getByText(/^QA Bekleyen Portal Kaydı eklendi\./).waitFor({state:'hidden',timeout:8000});
   await page.screenshot({path:path.join(output,'employee-native-mobile.png'),fullPage:true});await page.getByRole('button',{name:'Modüller',exact:true}).click();await page.locator('#portal-modules').getByRole('button',{name:'Görev takibi',exact:true}).click();check(await page.locator('[data-portal-module]').getAttribute('data-portal-module'),'gorev','Parent navigation continues after confirmed completion');
  }finally{release();await page.unroute('**/api/company.php?action=rpc',intercept);await page.setViewportSize({width:1440,height:1050});}
 });
 await workflow('employee-module-variants',async()=>{
  await mount('gorev');const variants=page.locator('[data-employee-module-variants]');await variants.getByRole('button',{name:'Görev planı ve kanban',exact:true}).click();await ready('TaskHub');check(new URL(page.url()).searchParams.get('bolum'),'planlama','Parent section is represented in employee URL');
  await page.goto(base+'/calisan/uygulama/?module=gorev&bolum=planlama',{waitUntil:'domcontentloaded'});await ready('TaskHub');check(await page.locator('[data-portal-module]').getAttribute('data-portal-module'),'gorev','Direct section URL retains parent domain');
  await variants.getByRole('button',{name:'Yapılacaklar',exact:true}).click();await ready('Todo');await page.getByRole('button',{name:'Modüller',exact:true}).click();await page.locator('#portal-modules').getByRole('button',{name:'Müşteriler',exact:true}).click();await ready('Customers');await noSecondShell();await page.screenshot({path:path.join(output,'employee-native-parent-navigation.png'),fullPage:true});
 });
 await workflow('employee-quote-smoke',async()=>{
  await mount('musteriler');await ready('Customers');await customerForm('QA Teklif Portal Müşteri');await host().getByText('Müşteri Ekle',{exact:true}).click();
  const customer=await saved('customers',row=>row.short_name==='QA Teklif Portal Müşteri');await host().getByRole('button',{name:'Yeni müşteri ekle',exact:true}).waitFor({state:'visible'});
  await mount('musteri-teklifleri');await ready('Quotes');await host().getByRole('button',{name:'Yeni teklif oluştur',exact:true}).click();
  await host().getByText('Müşteri seçiniz...',{exact:true}).click();await host().getByPlaceholder('Müşteri adı, unvan, vergi no veya telefon...',{exact:true}).fill('QA Teklif Portal');await host().getByText(customer.short_name,{exact:true}).last().click();
  await host().getByPlaceholder('Örn: S.NO.0184 Kompanzasyon Panosu Revizyon İşleri',{exact:true}).fill('QA Doğal Portal Teklifi');await host().getByText('Manuel Kalem',{exact:true}).click();await host().getByPlaceholder('Kalem adı giriniz…',{exact:true}).fill('QA sentetik test hizmeti');
  const amount=await host().getByText('Malzeme B.F.',{exact:true}).evaluateHandle(node=>node.parentElement.querySelector('input'));if(!amount.asElement())throw Error('Manual quote price control not found');await amount.asElement().fill('100');
  await host().getByText('Teklifi Kaydet',{exact:true}).click();const quote=await saved('quotes',row=>row.title==='QA Doğal Portal Teklifi');
  check(quote.customer_name,customer.short_name,'Quote commits its selected customer');check(Number(quote.grand_total)>0,true,'Quote persists its real calculated positive total');
  const lines=(await rows('quote_lines')).filter(line=>line.quote_id===quote.id);check(lines.length,1,'The real quote line is committed with its parent quote');check(Number(lines[0].material_price),100,'Manual line price survives private API serialization');
  await host().getByRole('button',{name:'Yeni teklif oluştur',exact:true}).waitFor({state:'visible'});await reload('Quotes');await host().getByText(quote.title,{exact:true}).first().waitFor({state:'visible'});check(await host().getByText(quote.title,{exact:true}).first().isVisible(),true,'Saved quote returns automatically to the list and survives remount');
  report.employeeQuoteId=quote.id;await page.screenshot({path:path.join(output,'employee-quote-desktop.png'),fullPage:true});
 });
};

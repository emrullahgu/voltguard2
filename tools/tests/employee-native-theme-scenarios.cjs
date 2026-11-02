'use strict';
const path=require('node:path');

module.exports=async function nativeThemeScenarios({page,mount,workflow,check,report,output}){
 const host=()=>page.locator('[data-employee-module-host]');
 async function settle(){
  await page.getByText('Modül yükleniyor…',{exact:true}).waitFor({state:'hidden',timeout:60000});
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(()=>!document.documentElement.classList.contains('vg-theme-anim'));
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
 }
 async function theme(mode){
  if(await page.locator('html').getAttribute('data-theme')!==mode){
   if(!await page.locator('[data-vg-theme-toggle]:visible').count())await page.getByRole('button',{name:'Çalışan menüsü',exact:true}).click();
   await page.locator('[data-vg-theme-toggle]:visible').first().click();
   await page.waitForFunction(mode=>document.documentElement.dataset.theme===mode,mode);
  }
  await settle();
  if(await page.locator('#portal-account-toggle[aria-expanded="true"]').count())await page.getByRole('button',{name:'Çalışan menüsü',exact:true}).click();
 }
 async function contrast(locator,placeholder=false){
  return locator.evaluate((node,placeholder)=>{
   const parse=value=>{const channels=value.match(/[\d.]+/g)?.map(Number)||[0,0,0];return [...channels.slice(0,3),channels.length>3?channels[3]:1];};
   const merge=(a,b)=>a.slice(0,3).map((channel,index)=>channel*a[3]+b[index]*(1-a[3]));
   const ancestors=[];let current=node;
   while(current){ancestors.push(current);current=current.parentElement||current.getRootNode().host||null;}
   const background=ancestors.reverse().reduce((background,element)=>merge(parse(getComputedStyle(element).backgroundColor),background),[255,255,255]);
   const style=getComputedStyle(node,placeholder?'::placeholder':null),rgba=parse(style.color);
   rgba[3]*=Number(style.opacity);
   const foreground=merge(rgba,background);
   const lum=channels=>channels.map(channel=>{channel/=255;return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;}).reduce((sum,channel,index)=>sum+channel*[.2126,.7152,.0722][index],0);
   const a=lum(foreground),b=lum(background);
   return {foreground:style.color,background,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
  },placeholder);
 }
 report.nativeThemeContrast=[];
 for(const width of [1440,390])for(const mode of ['light','dark'])await workflow(`native-customer-theme-${width}-${mode}`,async()=>{
  await page.setViewportSize({width,height:1000});await mount('musteriler');await settle();await theme(mode);
  check(await page.locator('[data-portal-theme-toggle]').isVisible(),true,'Portal theme control is visible without opening the account menu');
  check(await page.locator('#portal-account-toggle[aria-expanded="true"]').count(),0,'Account menu remains closed while the theme control is available');
  const controls={search:await contrast(host().getByRole('textbox',{name:'Müşteri ara',exact:true})),placeholder:await contrast(host().getByRole('textbox',{name:'Müşteri ara',exact:true}),true),heading:await contrast(host().getByText('Müşteri yok',{exact:true})),description:await contrast(host().getByText('İlk müşterinizi eklemek için + butonuna basın.',{exact:true})),action:await contrast(host().getByText('Yeni Müşteri',{exact:true}))};
  report.nativeThemeContrast.push({width,mode,controls});
  for(const [name,metric] of Object.entries(controls))check(metric.ratio>=4.5,true,`${mode} customer ${name} normal text has at least4.5:1 contrast`);
  await page.locator('.employee-domain-heading').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,`customers-${width}-${mode}.png`)});
 });
 await workflow('native-customer-draft-survives-live-theme',async()=>{
  await page.setViewportSize({width:390,height:1000});await mount('musteriler');await settle();
  await host().getByRole('button',{name:'Yeni müşteri ekle',exact:true}).click();
  const input=host().getByPlaceholder('EGEBORU',{exact:true});await input.waitFor();
  await input.fill('QA Kaydedilmemiş Tema Kontrolü');const element=await input.elementHandle();
  for(const mode of ['light','dark']){
   await theme(mode);
   check(await input.inputValue(),'QA Kaydedilmemiş Tema Kontrolü','Theme change retains the unsaved customer value');
   check(await element.evaluate(node=>node.isConnected),true,'Theme change keeps the existing form element mounted');
   const field=await contrast(input),placeholder=await contrast(input,true);
   report.nativeThemeContrast.push({name:'unsaved-customer-field',mode,field,placeholder});
   check(field.ratio>=4.5,true,`${mode} form value is readable`);check(placeholder.ratio>=4.5,true,`${mode} form placeholder is readable`);
  }
  await page.getByRole('button',{name:'Tüm uygulamalar',exact:true}).click();
  await page.getByRole('button',{name:/^Stok ve zimmet/}).click();await settle();
  check(await page.locator('html').getAttribute('data-theme'),'dark','Selected theme survives a module change');
  check(await page.locator('[data-portal-theme-toggle]').isVisible(),true,'Theme control stays visible on another module');
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('.portal-app').waitFor();await settle();
  check(await page.locator('html').getAttribute('data-theme'),'dark','Selected theme persists after reload');
  check(await page.locator('[data-portal-theme-toggle]').isVisible(),true,'Theme control remains visible after reload');
 });
};

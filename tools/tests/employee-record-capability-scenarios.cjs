'use strict';
// The real service-off states and menu gates are browser-tested separately from
// rendered detail screens. No AI/service capability is enabled by this suite.
module.exports=async function({page,admin,api,workflow,check,report,base,ui}){
 report.capabilityCoverage={apiCapabilities:null,disabledAiDeepLinks:[],closedServiceRetries:[]};
 await workflow('record-capability-disabled-ai',async()=>{
  const bootstrap=(await api(admin,'company','saha_bootstrap')).data;
  check(bootstrap.capabilities.externalAI,false,'Real isolated API reports AI unavailable');
  check(bootstrap.capabilities.externalServices,false,'Real isolated API reports external integrations unavailable');
  const checks=[];
  for(const section of ['analiz','asistan']){
   await page.goto(base+'/calisan/uygulama/?module=yapay-zeka&bolum='+section,{waitUntil:'domcontentloaded'});
   await page.locator('[data-employee-applications]').waitFor({state:'visible'});
   check(await page.locator('[data-portal-module]').getAttribute('data-portal-module'),'uygulamalar','Disabled AI deep link safely opens available applications: '+section);
   check(await page.getByRole('button',{name:/Yapay zekâ araçları/}).count(),0,'AI catalogue card stays absent when service is unavailable');
   check(await page.locator('[data-employee-module-host]').count(),0,'Disabled AI deep link never mounts a hidden native module');
   checks.push({section,state:'catalogue-gate-fallback'});
  }
  report.capabilityCoverage={apiCapabilities:{externalAI:false,externalServices:false},disabledAiDeepLinks:checks,closedServiceRetries:[]};
 });
 for(const [route,label,title,hiddenTargets]of [
  ['ErpConnections','ERP Bağlantıları','ERP bağlantı servisi kullanılamıyor',['ErpConnectionForm']],
  ['IntegrationWebhooks','Webhooks','Entegrasyon servisi kullanılamıyor',['IntegrationWebhookForm','IntegrationWebhookDeliveries']],
 ])await workflow('record-capability-closed-'+route,async()=>{
  await ui.open('EnterpriseIntegrationsHub');await ui.click(label,route);
  await ui.host().getByText(title,{exact:true}).waitFor({state:'visible'});
  await ui.inspect(route);
  check(await ui.host().locator('[data-testid="site-hub-card"]:visible').count(),0,'Unavailable service exposes no fabricated detail cards: '+route);
  await ui.host().getByRole('button',{name:'Yeniden kontrol et',exact:true}).click();
  await ui.host().getByText(title,{exact:true}).waitFor({state:'visible'});
  await ui.inspect(route);
  report.capabilityCoverage.closedServiceRetries.push({route,hiddenTargets,state:'service-unavailable-after-real-retry'});
 });
 await workflow('record-capability-closed-extensions',async()=>{
  await ui.open('ExtHub');await ui.host().getByText('Dış hizmetler kullanılamıyor',{exact:true}).waitFor({state:'visible'});await ui.inspect('ExtHub');
  check(await ui.host().getByText('Eklenti yok',{exact:true}).count(),0,'Closed extension service is not reported as a successfully loaded empty list');
  await ui.host().getByRole('button',{name:'Yeniden kontrol et',exact:true}).click();
  await ui.host().getByText('Dış hizmetler kullanılamıyor',{exact:true}).waitFor({state:'visible'});await ui.inspect('ExtHub');
  report.capabilityCoverage.closedServiceRetries.push({route:'ExtHub',hiddenTargets:['ExtConfig','ExtLogs'],state:'service-unavailable-after-real-retry'});
 });
 await workflow('record-capability-unavailable-order-save',async()=>{
  await ui.open('OrdHub');await ui.click('Yeni Sipariş','OrdForm');
  await ui.host().getByText('Sipariş kayıt servisi henüz kullanılamıyor. Bilgileriniz bu ekranda duruyor; sunucuya kaydedilmedi ve gönderilmedi.',{exact:true}).waitFor({state:'visible'});
  await ui.host().getByPlaceholder('Müşteri adı girin',{exact:true}).fill('QA Korunan Sipariş Müşterisi');
  await ui.host().getByPlaceholder('Ürün/hizmet adı',{exact:true}).fill('QA Sentetik Hizmet');
  await ui.host().getByPlaceholder('Sipariş notu (opsiyonel)',{exact:true}).fill('Kaydedilmeyen taslak ekranda korunmalı.');
  const controls=ui.host().locator('input:visible,textarea:visible');
  const beforeValues=await controls.evaluateAll(inputs=>inputs.map(input=>input.value));
  const writes=[];
  const observe=request=>{
   let body;try{body=request.postDataJSON();}catch{return;}
   if(body?.name==='app_saha_query'&&body.args?.operation!=='select')writes.push({table:body.args?.table,operation:body.args?.operation});
  };
  page.on('request',observe);
  try{
   for(const label of ['Taslak Kaydet','Gönder']){
    const dialogs=report.dialogs?.length||0;
    await ui.host().getByText(label,{exact:true}).click();
    await ui.settle('OrdForm');
    check(await controls.evaluateAll(inputs=>inputs.map(input=>input.value)),beforeValues,'Unavailable '+label+' preserves all visible order inputs');
    const recent=(report.dialogs||[]).slice(dialogs);
    check(recent.length,1,'Unavailable '+label+' shows one explicit failure notice');
    check(recent[0].message.includes('Sipariş kaydedilemedi'),true,'Unavailable '+label+' never claims a successful save/send');
    check(recent[0].message.includes('sunucuya kaydedilmedi ve gönderilmedi'),true,'Failure notice states that persistence did not occur');
    await ui.inspect('OrdForm');
   }
   check(writes.length,0,'Unavailable order submit never fabricates or attempts a business-row write');
  }finally{page.off('request',observe);}
  report.capabilityCoverage.closedServiceRetries.push({route:'OrdForm',hiddenTargets:['OrdDetail'],state:'both-save-actions-preserve-draft-and-report-unavailable'});
 });
};

'use strict';
const {randomUUID}=require('node:crypto');

// Real compiled UI and actual private PHP APIs, using only the harness's
// disposable authenticated employee dataset. No navigation gate is bypassed.
module.exports=async function({page,ui,workflow,check,report}){
 const host=ui.host;
 async function open(target){
  const queue=ui.source.entries.filter(entry=>entry.enabled).map(entry=>({entry,route:entry.route,steps:[]})),seen=new Set();
  while(queue.length){const item=queue.shift();if(seen.has(item.route))continue;seen.add(item.route);
   if(item.route===target){await ui.open(item.entry.route);for(const step of item.steps)await ui.click(step.label,step.route);return;}
   for(const card of ui.source.routes.find(route=>route.route===item.route)?.cards||[])if(!ui.source.routes.find(route=>route.route===card.route)?.parameters?.required)queue.push({...item,route:card.route,steps:[...item.steps,card]});
  }
  throw Error('No natural form entry: '+target);
 }
 const body=request=>{try{return request.postDataJSON()||{};}catch{return {};}};
 const queryIs=(request,table,operation)=>body(request).name==='app_saha_query'&&body(request).args?.table===table&&body(request).args.operation===operation;
 const rowsOf=async(table,filters=[])=>ui.rpc('app_saha_query',{table,operation:'select',select:'*',filters,order:[],returning:true});
 const visibleText=text=>host().getByText(text,{exact:true}).filter({visible:true}).first();
 async function inputValue(input,value,reason){
  const end=Date.now()+10000;while(Date.now()<end&&await input.inputValue()!==value)await page.waitForTimeout(50);
  check(await input.inputValue(),value,reason);
 }
 await workflow('deep-forms-rejected-template-create',async()=>{
  const title='QA Derin Korunan Şablon',message='QA sentetik şablon kaydı reddedildi.';
  await open('FormHub');await ui.click('Yeni Şablon','FormBuilder');
  const name=host().getByPlaceholder('Örn: Aylık Bakım Formu',{exact:true});await name.fill(title);
  await visibleText('Metin').click();await host().getByPlaceholder('Etiket *',{exact:true}).fill('QA Şablon Sorusu');
  const matches=request=>queryIs(request,'form_templates','insert')&&body(request).args.rows?.[0]?.name===title;
  let injected=0;
  const handler=async route=>{if(!injected&&matches(route.request())){injected++;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({api:'vg-company/1',ok:false,error:'PT409',message})});}else await route.continue();};
  await page.route('**/api/company.php?action=rpc',handler);
  try{
   const before={api:report.apiErrors.length,console:report.consoleErrors.length},pending=page.waitForResponse(response=>matches(response.request()));
   await visibleText('Şablonu Kaydet').click();await ui.expectedConflict(await pending,before,'Explicit template create rejection');
   await host().getByRole('alert').filter({hasText:message}).filter({visible:true}).first().waitFor({state:'visible'});
   await inputValue(name,title,'Rejected template save preserves the entered name');
   check(await host().getByPlaceholder('Etiket *',{exact:true}).inputValue(),'QA Şablon Sorusu','Rejected template save preserves its field definition');
   check((await rowsOf('form_templates')).data.some(row=>row.name===title),false,'Rejected template save creates no canonical record');
   const cache=await ui.rpc('app_saha_cache',{operation:'get',key:'@SahaTakip:form_templates'});
   check((cache.value?JSON.parse(cache.value):[]).some(row=>row.name===title),false,'Rejected template save creates no cached success');
   await ui.inspect('FormBuilder');
  }finally{await page.unroute('**/api/company.php?action=rpc',handler);}
  await visibleText('Şablonu Kaydet').click();await ui.settle('FormHub');
  const saved=(await rowsOf('form_templates')).data.filter(row=>row.name===title);
  check(saved.length,1,'Explicit template retry creates exactly one actual server record');
  check(saved[0].fields[0].label,'QA Şablon Sorusu','Template retry persists the preserved field definition');
  await open('FormTemplates');await visibleText(title).waitFor({state:'visible'});await ui.click(title,'FormBuilder');
  await inputValue(host().getByPlaceholder('Örn: Aylık Bakım Formu',{exact:true}),title,'Accepted template survives a full native remount');
  await ui.inspect('FormBuilder');
 });
 await workflow('deep-forms-stale-response-preserves-draft',async()=>{
  const templateId=randomUUID(),responseId=randomUUID(),stamp=new Date().toISOString(),title='QA Derin Form Yanıtı';
  await ui.seed('form_templates',{id:templateId,name:title,category:'Bakım',fields:[{id:'a',label:'QA Yanıt',type:'text',required:true},{id:'b',label:'QA Sayı',type:'number'}],is_seed:false,created_at:stamp,updated_at:stamp});
  await ui.seed('form_responses',{id:responseId,template_id:templateId,template_name:title,values:{a:'QA İlk Yanıt'},revision:1,created_at:stamp,updated_at:stamp});
  const initial=await rowsOf('form_responses',[{op:'eq',field:'id',value:responseId}]);
  await open('FormResponses');await visibleText(title).waitFor({state:'visible'});await ui.click(title,'FormResponseDetail');
  await visibleText('QA İlk Yanıt').waitFor({state:'visible'});await ui.click('Düzenle / Revize Et','FormFill');
  const answer=host().getByPlaceholder('Metin girin',{exact:true}),number=host().getByPlaceholder('0',{exact:true}),reason=host().getByPlaceholder('Neden düzenlendi?',{exact:true});
  await inputValue(answer,'QA İlk Yanıt','Response editor loads its canonical starting answer');
  await answer.fill('QA Korunan Yanıt Taslağı');await reason.fill('QA Korunan Düzenleme Sebebi');
  const mutations=[];const observe=request=>{if(queryIs(request,'form_responses','update'))mutations.push(request);};page.on('request',observe);
  try{
   await number.fill('geçersiz');const dialogs=report.dialogs?.length||0;await visibleText('Revizyonu Kaydet').click();
   check((report.dialogs||[]).slice(dialogs).some(dialog=>/geçerli bir sayı/.test(dialog.message)),true,'Nonfinite form number shows validation error');
   check(mutations.length,0,'Nonfinite form value cannot serialize silently to a submitted null');
   await number.fill('12.5');
   const remote=await ui.rpc('app_saha_query',{table:'form_responses',operation:'update',select:'*',rows:{values:{a:'QA Diğer İstemci Yanıtı'},revision:2},filters:[{op:'eq',field:'id',value:responseId}],order:[],versions:initial.versions,returning:true,single:'one'});
   const before={api:report.apiErrors.length,console:report.consoleErrors.length},pending=page.waitForResponse(response=>queryIs(response.request(),'form_responses','update'));
   await visibleText('Revizyonu Kaydet').click();const rejected=await pending;await ui.expectedConflict(rejected,before,'Actual stale response revision rejection');
   check(body(rejected.request()).args.versions[responseId],initial.versions[responseId],'Form submit pins the revision loaded with its visible answer');
   await host().getByRole('alert').filter({hasText:'değişti'}).filter({visible:true}).first().waitFor({state:'visible'});
   await inputValue(answer,'QA Korunan Yanıt Taslağı','Stale response rejection keeps the visible draft');await inputValue(reason,'QA Korunan Düzenleme Sebebi','Stale response rejection keeps its reason');
   const after=await rowsOf('form_responses',[{op:'eq',field:'id',value:responseId}]);
   check(after.data[0].values.a,'QA Diğer İstemci Yanıtı','Rejected stale form cannot overwrite the other client answer');
   check(after.versions[responseId],remote.versions[responseId],'Rejected stale form cannot advance canonical revision');
   await page.waitForTimeout(800);check(mutations.length,1,'A stale form never automatically replays its failed mutation');await ui.inspect('FormFill');
   await ui.back('FormResponseDetail');await visibleText('QA Diğer İstemci Yanıtı').waitFor({state:'visible'});
   await ui.click('Düzenle / Revize Et','FormFill');await inputValue(host().getByPlaceholder('Metin girin',{exact:true}),'QA Diğer İstemci Yanıtı','Explicit reload accepts the current canonical response');
   await host().getByPlaceholder('Metin girin',{exact:true}).fill('QA Onaylanan Son Yanıt');await visibleText('Revizyonu Kaydet').click();await ui.settle('FormResponseDetail');
   await visibleText('QA Onaylanan Son Yanıt').waitFor({state:'visible'});await ui.inspect('FormResponseDetail');
   const final=await rowsOf('form_responses',[{op:'eq',field:'id',value:responseId}]);check(final.data.length,1,'Explicit retry updates the existing form once');check(final.data[0].revision,3,'Document revision increments from the explicitly reloaded snapshot');check(final.data[0].values.a,'QA Onaylanan Son Yanıt','Accepted form edit survives fresh canonical read');
  }finally{page.off('request',observe);}
 });
};

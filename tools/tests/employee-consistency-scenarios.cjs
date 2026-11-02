'use strict';
const crypto = require('node:crypto');
const path = require('node:path');

// Runs against the caller's actual compiled UI and disposable PHP dataset.
// No test-only product exports, storage injection, or replacement DOM are used.
module.exports = async function consistencyScenarios({page,admin,api,mount,workflow,check,report,output,ready,host,rows,saved}) {
  const rpc = async (name,args) => (await api(admin,'company','rpc',{name,args})).data;
  const query = (table,operation,extra={}) => rpc('app_saha_query',{table,operation,select:'*',filters:[],order:[],returning:true,...extra});
  const requestBody = request => {try{return request.postDataJSON()||{};}catch{return {};}};
  const isQuery = (request,table,operation) => {
    const url=new URL(request.url()),body=requestBody(request);
    return url.pathname==='/api/company.php'&&url.searchParams.get('action')==='rpc'&&body.name==='app_saha_query'&&body.args?.table===table&&body.args?.operation===operation;
  };
  const rowOf = request => {const value=requestBody(request).args?.rows;return Array.isArray(value)?value[0]:value;};
  const cache = async key => {const result=await rpc('app_saha_cache',{operation:'get',key});return result.value?JSON.parse(result.value):[];};
  async function valueIs(input,expected,reason) {
    const until=Date.now()+10000;
    while(Date.now()<until){if(await input.inputValue()===expected)break;await page.waitForTimeout(50);}
    check(await input.inputValue(),expected,reason);
  }
  async function expectedConflict(response,phase,before,description) {
    check(response.status(),409,description+' has the exact expected HTTP status');
    const payload=await response.json();check(payload.error,'PT409',description+' is a revision conflict');
    const requestKey=crypto.createHash('sha256').update(response.request().postData()||'').digest('hex');
    const until=Date.now()+3000;
    while(Date.now()<until&&!report.apiErrors.some(e=>e.phase===phase&&e.requestKey===requestKey))await page.waitForTimeout(25);
    const errors=report.apiErrors.slice(before.api);
    check(errors.length,1,description+' produces exactly one API failure; unrelated failures remain fatal');
    const error=errors[0];
    check(error.requestKey,requestKey,description+' matches the exact submitted POST body');
    check(error.phase,phase,description+' belongs to this workflow');
    check(error.status,409,description+' is the sole expected rejection');
    check(error.error,'PT409',description+' retains its error code');
    // Chromium reports the failed resource separately from the response event.
    // Only the sole 409 resource message for this exact URL/workflow is exempt;
    // all other console/page/API errors stay in the caller's fatal collections.
    await page.waitForTimeout(100);
    const resourceMessage='Failed to load resource: the server responded with a status of 409 (Conflict)';
    const console=report.consoleErrors.slice(before.console).filter(e=>e.phase===phase&&e.url===response.url()&&e.message===resourceMessage);
    check(console.length<=1,true,description+' has at most one attributable browser resource error');
    (report.expectedApiErrors||=[]).push({...error,description,consoleErrors:console});
    report.apiErrors.splice(report.apiErrors.indexOf(error),1);
    for(const item of console)report.consoleErrors.splice(report.consoleErrors.indexOf(item),1);
    return payload;
  }

  await workflow('employee-office-concurrency',async()=>{
    const phase='employee-office-concurrency',id=crypto.randomUUID(),initialTitle='QA Ofis Sürüm Denetimi',remoteTitle='QA Ofis Başka İstemci',remoteContent='QA Ofis Sunucudaki Güncel İçerik',draft='QA Ofis Korunan Taslak',finalTitle='QA Ofis Doğrulanan Son Kayıt';
    const stamp=new Date().toISOString();
    const inserted=await query('office_pages','insert',{rows:[{id,title:initialTitle,icon:'📄',blocks:[{id:crypto.randomUUID(),type:'text',text:'Yalnız sentetik ofis kaydı.'}],is_favorite:false,archived:false,order_index:1,created_at:stamp,updated_at:stamp}],single:'one'});
    const revision=inserted.versions[id];check(Number.isSafeInteger(revision)&&revision>0,true,'Office fixture is inserted through actual app_saha_query with a server revision');
    await mount('ofis');await ready('OfficeHub');await host().getByText(initialTitle,{exact:true}).first().click();
    const title=host().getByPlaceholder('Adsız sayfa',{exact:true});await valueIs(title,initialTitle,'Office editor loads the canonical fixture');
    await page.waitForLoadState('networkidle');
    const writes=[];
    const observe=request=>{if(isQuery(request,'office_pages','upsert')&&rowOf(request)?.id===id)writes.push(request);};
    page.on('request',observe);
    let editing=true,editError;
    const editingTask=(async()=>{let serial=0;while(editing){await title.fill(draft+' '+serial++);await page.waitForTimeout(150);}})().catch(error=>{editError=error;});
    try{
      // Keep the editor dirty for the real 20-second channel poll. Holding a
      // network write would freeze an already captured token and miss the bug.
      const refreshed=page.waitForResponse(async response=>{
        if(!response.ok()||!isQuery(response.request(),'office_pages','select'))return false;
        const body=await response.json().catch(()=>null);
        return body?.data?.versions?.[id]>revision&&body.data.data?.some(row=>row.id===id&&row.title===remoteTitle);
      },{timeout:35000});
      const changed=await query('office_pages','update',{rows:{title:remoteTitle,blocks:[{id:crypto.randomUUID(),type:'text',text:remoteContent}],updated_at:new Date().toISOString()},filters:[{op:'eq',field:'id',value:id}],versions:{[id]:revision},single:'one'});
      const remoteRevision=changed.versions[id];check(remoteRevision>revision,true,'Independent API client advances the canonical office revision');
      await refreshed;
      editing=false;await editingTask;if(editError)throw editError;
      check(writes.length,0,'No office autosave is submitted before the background SELECT observes the newer revision');
      const before={api:report.apiErrors.length,console:report.consoleErrors.length};
      const rejected=page.waitForResponse(response=>isQuery(response.request(),'office_pages','upsert')&&rowOf(response.request())?.id===id&&rowOf(response.request())?.title===draft);
      await title.fill(draft);const response=await rejected;
      check(requestBody(response.request()).args.versions[id],revision,'Dirty form retains its loaded revision after background SELECT/poll');
      await expectedConflict(response,phase,before,'Stale office editor save');
      await host().getByText('Kayıt doğrulanamadı. Taslak bu ekranda duruyor. Yeniden göndermeden önce güncel kaydı kontrol edin.',{exact:true}).waitFor({state:'visible'});
      await valueIs(title,draft,'The visible office conflict preserves the unsaved draft');
      const canonical=(await rows('office_pages')).find(row=>row.id===id);check(canonical.title,remoteTitle,'Rejected stale form never overwrites the other client canonical row');
      await page.waitForTimeout(900);check(writes.length,1,'Office conflict does not replay the failed payload automatically');
      await page.screenshot({path:path.join(output,'employee-office-conflict.png'),fullPage:true});
      await host().getByRole('button',{name:'Güncel kaydı kontrol et',exact:true}).click();
      await host().getByText('Sunucudaki kayıt: '+remoteTitle,{exact:true}).waitFor({state:'visible'});
      await host().getByText(remoteContent,{exact:true}).waitFor({state:'visible'});
      await valueIs(title,draft,'Reading the recovery preview preserves the local office draft');
      check((await rows('office_pages')).find(row=>row.id===id).title,remoteTitle,'Recovery preview never overwrites the canonical office record');
      await page.waitForTimeout(900);check(writes.length,1,'Recovery preview does not retry or rebase the failed save');
      await page.screenshot({path:path.join(output,'employee-office-current-preview.png'),fullPage:true});
      await host().getByRole('button',{name:'Güncel kaydı aç',exact:true}).click();
      await valueIs(title,remoteTitle,'Explicit office reload accepts the current server snapshot');
      const accepted=page.waitForResponse(response=>isQuery(response.request(),'office_pages','upsert')&&rowOf(response.request())?.id===id&&rowOf(response.request())?.title===finalTitle);
      await title.fill(finalTitle);const success=await accepted;check(success.ok(),true,'Normal office edit succeeds after the current revision is loaded');
      check(requestBody(success.request()).args.versions[id],remoteRevision,'Fresh office save uses the accepted remote revision');
      await saved('office_pages',row=>row.id===id&&row.title===finalTitle);
      await page.waitForLoadState('networkidle');await mount('ofis');await ready('OfficeHub');await host().getByText(finalTitle,{exact:true}).first().click();
      await valueIs(host().getByPlaceholder('Adsız sayfa',{exact:true}),finalTitle,'Confirmed office save survives a full native remount');
      report.employeeOfficeConsistency={id,initialRevision:revision,remoteRevision,rejectedDraftPreserved:true,previewPreservesDraft:true,previewDoesNotWrite:true,finalTitle};
    }finally{editing=false;await editingTask;page.off('request',observe);}
  });

  await workflow('employee-maintenance-reject',async()=>{
    const phase='employee-maintenance-reject',name='QA Reddedilen Bakım Planı',notes='Sunucu reddinde korunması gereken sentetik taslak.',message='QA bakım planı isteği reddedildi (sentetik 409).';
    await mount('ekipman');await ready('AssetHub');
    await page.locator('[data-employee-module-variants]').getByRole('button',{name:'Tesis varlıkları ve denetimler',exact:true}).click();await ready('SectorHub');
    await host().getByText('Bakım Planı',{exact:true}).click();
    const nameInput=host().getByPlaceholder('ör. Aylık Trafo Bakımı',{exact:true}),frequency=host().getByPlaceholder('30',{exact:true}),noteInput=host().getByPlaceholder('Açıklama',{exact:true});
    await nameInput.waitFor({state:'visible'});await page.waitForLoadState('networkidle');
    await nameInput.fill(name);await frequency.fill('49');await noteInput.fill(notes);
    let injected=0;
    const reject=async route=>{
      if(injected===0&&isQuery(route.request(),'maintenance_plans','insert')&&rowOf(route.request())?.name===name){
        injected++;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({api:'vg-company/1',ok:false,error:'PT409',message})});return;
      }
      await route.continue();
    };
    const before={api:report.apiErrors.length,console:report.consoleErrors.length};
    await page.route('**/api/company.php?action=rpc',reject);
    try{
      const rejected=page.waitForResponse(response=>isQuery(response.request(),'maintenance_plans','insert')&&rowOf(response.request())?.name===name);
      await host().getByText('Plan Ekle',{exact:true}).click();const response=await rejected;
      const payload=await expectedConflict(response,phase,before,'Injected maintenance insert rejection');check(payload.message,message,'Maintenance rejection is the explicitly injected response');
      await page.getByText(message,{exact:true}).first().waitFor({state:'visible'});
      await valueIs(nameInput,name,'Rejected maintenance insert retains the plan name');await valueIs(frequency,'49','Rejected maintenance insert retains its frequency');await valueIs(noteInput,notes,'Rejected maintenance insert retains the notes');
      check((await rows('maintenance_plans')).some(row=>row.name===name),false,'Rejected maintenance insert creates no canonical row');
      check((await cache('@SahaTakip:maintenance_plans')).some(row=>row.name===name),false,'Rejected maintenance insert creates no cache ghost');
      check(await host().getByText(name,{exact:true}).count(),0,'Rejected maintenance plan is absent from the visible plan list');
      check(injected,1,'Only the intended maintenance POST was rejected');
      await page.screenshot({path:path.join(output,'employee-maintenance-rejected.png'),fullPage:true});
    }finally{await page.unroute('**/api/company.php?action=rpc',reject);}
    const accepted=page.waitForResponse(response=>isQuery(response.request(),'maintenance_plans','insert')&&rowOf(response.request())?.name===name);
    await host().getByText('Plan Ekle',{exact:true}).click();check((await accepted).ok(),true,'Maintenance retry reaches and is accepted by the actual PHP API');
    const plan=await saved('maintenance_plans',row=>row.name===name);
    check(plan.frequency_days,49,'Actual maintenance retry persists the preserved frequency');check(plan.notes,notes,'Actual maintenance retry persists the preserved notes');
    await host().getByText(name,{exact:true}).waitFor({state:'visible'});
    await valueIs(nameInput,'','Maintenance name clears only after canonical success');await valueIs(noteInput,'','Maintenance notes clear only after canonical success');await valueIs(frequency,'30','Maintenance frequency resets only after canonical success');
    const confirmed=(await cache('@SahaTakip:maintenance_plans')).filter(row=>row.name===name);check(confirmed.length,1,'Confirmed maintenance cache has exactly one plan');check(confirmed[0].id,plan.id,'Confirmed cache uses the canonical server ID');
    await page.waitForLoadState('networkidle');await mount('ekipman');await ready('AssetHub');await page.locator('[data-employee-module-variants]').getByRole('button',{name:'Tesis varlıkları ve denetimler',exact:true}).click();await ready('SectorHub');await host().getByText('Bakım Planı',{exact:true}).click();
    await host().getByText(name,{exact:true}).waitFor({state:'visible'});check((await rows('maintenance_plans')).filter(row=>row.name===name).length,1,'Maintenance retry remains a single canonical record after native remount');
    report.employeeMaintenanceConsistency={id:plan.id,rejectedDraftPreserved:true,cacheGhost:false,frequency:plan.frequency_days};
  });
};

'use strict';
const crypto=require('node:crypto');

module.exports=async function({page,admin,employee,api,workflow,check,report,ui}){
  const {host,click,inspect,settle,seed,cache}=ui;
  async function list(route){
    const queue=ui.source.entries.filter(x=>x.enabled).map(x=>({route:x.route,entry:x.route,steps:[]})),seen=new Set();
    while(queue.length){const item=queue.shift();if(seen.has(item.route))continue;seen.add(item.route);
      if(item.route===route){await ui.open(item.entry);for(const step of item.steps)await click(step.label,step.route);return;}
      for(const card of ui.source.routes.find(x=>x.route===item.route)?.cards||[])if(!ui.source.routes.find(x=>x.route===card.route)?.parameters?.required)queue.push({...item,route:card.route,steps:[...item.steps,card]});
    }
    throw Error('No enabled visible card path found: '+route);
  }
  await workflow('record-personnel-detail-history',async()=>{
    const id=crypto.randomUUID();
    await seed('employees',{id,full_name:'QA Ayrıntı Personeli',role:'Teknisyen',active:true});
    await ui.open('Employees');await click('QA Ayrıntı Personeli','EmployeeDetail');await inspect('EmployeeDetail');
    await ui.open('PersonnelTrackingHub');await click('Konum Geçmişi','LocationHistory');await inspect('LocationHistory');
    await ui.open('AdminShiftDashboard');await click('Mesai Geçmişi','ShiftHistory');await inspect('ShiftHistory');
  });
  await workflow('record-browser-device-fallbacks',async()=>{
    await ui.open('PersonnelTrackingHub');await click('QR Check-in','CheckinScanner');await inspect('CheckinScanner');
    check(await host().getByText('Kamera İzni Gerekli',{exact:true}).isVisible(),true,'Browser QR scan presents permission fallback without pretending a scan');
    await ui.open('PersonnelTrackingHub');await click('NFC Check-in','NfcCheckin');await inspect('NfcCheckin');
    await host().getByText('NFC Oku',{exact:true}).click();
    check((report.dialogs||[]).some(x=>/NFC modülü eksik/.test(x.message)),true,'Browser NFC action reports missing native module');
    report.recordCoverage.hardware={camera:'permission fallback only; no physical QR scan',nfc:'missing native module fallback; no physical tag scan'};ui.save();
  });
  await workflow('record-assets-forms-and-detail',async()=>{
    const id=crypto.randomUUID();
    await seed('assets',{id,name:'QA Sentetik Sayaç',type:'meter',serial_no:'QA-METER-001',created_at:new Date().toISOString(),notes:'İzole detay kontrolü'});
    await list('Assets');await click('Yeni','AssetForm');await inspect('AssetForm');
    await list('Assets');await click('QA Sentetik Sayaç','AssetDetail');
    await host().getByText('QA-METER-001',{exact:true}).filter({visible:true}).waitFor({state:'visible'});await inspect('AssetDetail');
    check(await host().getByText('QA-METER-001',{exact:true}).isVisible(),true,'Asset detail displays the canonical serial number');
    await click('Denetim','InspectionForm');await inspect('InspectionForm');
    await list('SalesVisits');await click('Yeni Ziyaret','SalesVisitForm');await inspect('SalesVisitForm');
  });
  await workflow('record-proposal-forms',async()=>{
    await list('TransformerProposals');await click('Yeni','TransformerProposalForm');await inspect('TransformerProposalForm');
    await list('GesProposals');await click('Yeni','GesProposalForm');await inspect('GesProposalForm');
  });
  await workflow('record-asset-rejected-save-retains-draft',async()=>{
    await list('Assets');await click('Yeni','AssetForm');
    const input=host().getByPlaceholder('ör. Trafo TR-1',{exact:true}),name='QA Reddedilen Cihaz Taslağı';
    await input.fill(name);
    const matches=request=>{let body;try{body=request.postDataJSON();}catch{return false;}
      return body?.name==='app_saha_query'&&body.args?.table==='assets'&&body.args.operation==='insert';};
    let rejected=0;
    const handler=async route=>{if(!rejected&&matches(route.request())){rejected++;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({api:'vg-company/1',ok:false,error:'PT409',message:'QA sentetik cihaz kaydı reddedildi.'})});}else await route.continue();};
    const before={api:report.apiErrors.length,console:report.consoleErrors.length};
    await page.route('**/api/company.php?action=rpc',handler);
    try{
      const pending=page.waitForResponse(response=>matches(response.request()));
      await host().getByText('Kaydet',{exact:true}).filter({visible:true}).click();
      await ui.expectedConflict(await pending,before,'Asset insert rejection');
      await host().getByRole('alert').filter({hasText:'QA sentetik cihaz kaydı reddedildi.'}).filter({visible:true}).first().waitFor({state:'visible'});
      check(await input.inputValue(),name,'Rejected asset form keeps its visible draft');
      await inspect('AssetForm');
      const data=await ui.rpc('app_saha_query',{table:'assets',operation:'select',select:'*',filters:[],order:[]});
      check(data.data.some(x=>x.name===name),false,'Rejected asset save creates no canonical row');
    }finally{await page.unroute('**/api/company.php?action=rpc',handler);}
    await host().getByText('Kaydet',{exact:true}).filter({visible:true}).click();await settle('Assets');
    await host().getByText(name,{exact:true}).waitFor({state:'visible'});
    const persisted=await ui.rpc('app_saha_query',{table:'assets',operation:'select',select:'*',filters:[],order:[]});
    check(persisted.data.filter(x=>x.name===name).length,1,'Explicit asset retry saves exactly one canonical record');
  });
  await workflow('record-field-job-and-subforms',async()=>{
    const id=crypto.randomUUID();
    await cache('fo_jobs_v1',[{id,customerName:'QA Saha Ayrıntı Müşterisi',address:'Sentetik Saha',priority:'normal',stage:'assigned',assignedUserId:admin.user.id,assignedUserName:'QA Yönetici',scheduledAt:new Date().toISOString(),estimatedMinutes:45}]);
    await ui.open('FieldOpsHub');await click('Bugün','FieldToday');await click('QA Saha Ayrıntı Müşterisi','FieldJobDetail');await inspect('FieldJobDetail');
    await click('Checklist','FieldChecklist');await inspect('FieldChecklist');await ui.back('FieldJobDetail');
    await click('Kalite','FieldQualityCheck');await inspect('FieldQualityCheck');
  });
  await workflow('record-survey-detail',async()=>{
    const id=crypto.randomUUID(),stamp=new Date().toISOString();
    await cache('sq_surveys_v1',[{id,title:'QA Keşif Ayrıntısı',customerName:'QA Keşif Müşterisi',items:[],createdAt:stamp,updatedAt:stamp}]);
    await list('SurveyForms');await click('QA Keşif Ayrıntısı','SurveyFormDetail');await inspect('SurveyFormDetail');
  });
  await workflow('record-coverage-categories',async()=>{
    await list('CovMatrix');
    const labels=await host().getByText(/^\d+\. /).allTextContents();
    check(labels.length,23,'Coverage matrix has all 23 actual category controls');
    for(const label of labels){await click(label,'CovCategory');await inspect('CovCategory');await ui.back('CovMatrix');}
  });
  await workflow('record-energy-types-navigation',async()=>{
    for(const label of ['Trafo','Pano','Sayaç','İnverter','UPS','Jeneratör','Kompanzasyon','Kablo','Diğer']){
      await list('EnergyAssetTypes');await click(label,'AssetList');await inspect('AssetList');
    }
  });
  await workflow('record-map-from-default-favorites',async()=>{
    await list('FieldFavorites');await click('Harita','Map');await inspect('Map');
  });
};

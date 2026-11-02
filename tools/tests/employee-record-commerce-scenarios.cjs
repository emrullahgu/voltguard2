'use strict';
const {randomUUID,createHash}=require('node:crypto');

// Real visible navigation and actual private APIs on the runner's disposable data.
module.exports=async function({page,workflow,check,report,ui}){
  const stamp=new Date().toISOString(),day=stamp.slice(0,10);
  const ids=Object.fromEntries(['customer','work','quote','material','warehouse','vehicle','payment','template'].map(key=>[key,randomUUID()]));
  const names={customer:'QA Kayıt Müşterisi',work:'QA Kayıt İş Emri',quote:'QA Kayıt Teklifi',warehouse:'QA Kayıt Deposu',material:'QA Kayıt Malzemesi',plate:'35 QA 447',template:'QA Kayıt Kontrol Formu'};
  const map=new Map(ui.source.routes.map(route=>[route.route,route]));
  async function open(route){
    const queue=ui.source.entries.filter(entry=>entry.enabled).map(entry=>({entry,path:[],route:entry.route})),seen=new Set();
    while(queue.length){const item=queue.shift();if(seen.has(item.route))continue;seen.add(item.route);
      if(item.route===route){await ui.open(item.entry.route);for(const step of item.path)await ui.click(step.label,step.route);return;}
      for(const card of map.get(item.route)?.cards||[])if(!map.get(card.route)?.parameters?.required)queue.push({...item,route:card.route,path:[...item.path,card]});
    }
    throw Error('No natural catalogue/card path to '+route);
  }
  const button=async(name,route)=>{await ui.host().getByRole('button',{name,exact:true}).click();await ui.settle(route);};
  const inspect=route=>ui.inspect(route);
  await workflow('record-commerce-fixtures',async()=>{
    await ui.seed('customers',{id:ids.customer,short_name:names.customer,title:'QA Sentetik Müşteri A.Ş.',city:'İzmir',deleted_at:null,created_at:stamp});
    await ui.seed('work_orders',{id:ids.work,number:'QA-WORK-447',service_name:names.work,title:names.work,customer_name:names.customer,status:'Tamamlandı',date:day,engineer:'QA Sentetik Teknisyen',materials_json:[],other_cost:0,labor_cost:0,material_cost:0,quote_amount:100,profit:100,deleted_at:null,created_at:stamp});
    await ui.seed('quotes',{id:ids.quote,number:'QA-QUOTE-447',title:names.quote,customer_name:names.customer,date:day,engineer:'QA Sentetik Teknisyen',status:'Taslak',subtotal:100,vat_total:20,grand_total:120,deleted_at:null,created_at:stamp});
    await ui.seed('materials',{id:ids.material,name:names.material,code:'QA-MAT-447',unit:'adet',category:'Diğer',min_stock:0,created_at:stamp});
    await ui.seed('warehouses',{id:ids.warehouse,name:names.warehouse,kind:'depo',code:'QA-DEP-447',created_at:stamp});
    await ui.seed('vehicles',{id:ids.vehicle,plate:names.plate,brand:'QA Sentetik',model:'Test',km_total:1000,created_at:stamp});
    await ui.seed('payments',{id:ids.payment,customer_id:ids.customer,customer_name:names.customer,amount:100,currency:'TRY',method:'cash',status:'received',received_at:stamp,receipt_no:'QA-RECEIPT-447',created_at:stamp});
    await ui.seed('form_templates',{id:ids.template,name:names.template,category:'Diğer',description:'İzole kontrol formu',fields:[{id:randomUUID(),label:'Kontrol Notu',type:'text',required:false}],is_seed:false,created_at:stamp,updated_at:stamp});
    check(Object.values(ids).every(id=>/^[a-f0-9-]{36}$/.test(id)),true,'Every detail fixture has a distinct server UUID');
  });
  await workflow('record-commerce-customer-forms-and-details',async()=>{
    await open('Customers');await button('Yeni müşteri ekle','CustomerForm');await inspect('CustomerForm');
    await ui.back('Customers');await ui.click(names.customer,'CustomerForm');await inspect('CustomerForm');
    check(await ui.host().getByText('Check-in Yapıldı',{exact:true}).count(),0,'Editing a real customer does not invent a check-in event');
    for(const [label,route] of [['Sahalar','CustomerSites'],['Belgeler','CustomerDocuments'],['Geçmiş','CustomerHistory'],['Müşteri Portalı','CustomerPortal']]){
      await ui.click(label,route);await inspect(route);await ui.back('CustomerForm');
    }
  });
  await workflow('record-commerce-work-order-forms-and-details',async()=>{
    await open('WorkOrders');await button('İş emri ekle','NewWorkOrder');await inspect('NewWorkOrder');
    await ui.back('WorkOrders');await ui.click(names.work,'WorkOrderDetail');await inspect('WorkOrderDetail');
    await ui.click('Müşteri Memnuniyet Puanı Al','JobRating');await inspect('JobRating');await ui.back('WorkOrderDetail');
    await ui.click('Formlar / Kontrol Listeleri','WorkOrderForms');await inspect('WorkOrderForms');
    await ui.host().getByText('Form Doldur',{exact:true}).click();await page.getByText(names.template,{exact:true}).click();await ui.settle('FormFill');await inspect('FormFill');
    await ui.host().getByPlaceholder('Metin girin',{exact:true}).fill('QA doğrulanan form yanıtı');
    await ui.host().getByText('Formu Tamamla',{exact:true}).filter({visible:true}).click();await ui.settle('WorkOrderForms');
    const responses=(await ui.rpc('app_saha_query',{table:'form_responses',operation:'select',select:'*',filters:[{op:'eq',field:'template_id',value:ids.template}],order:[],returning:true})).data;
    check(responses.length,1,'Completed form creates exactly one actual server response');
    check(responses[0].work_order_id,'QA-WORK-447','Completed form retains its natural work-order association');
    check(Object.values(responses[0].values).includes('QA doğrulanan form yanıtı'),true,'Completed form persists the entered field value');
    await ui.back('WorkOrderDetail');await ui.click('Malzeme Kullanımı','StockMovement');await inspect('StockMovement');
    await open('FormResponses');await ui.click(names.template,'FormResponseDetail');
    await ui.host().getByText('QA doğrulanan form yanıtı',{exact:true}).filter({visible:true}).first().waitFor({state:'visible'});
    await inspect('FormResponseDetail');
    check(await ui.host().getByText('QA doğrulanan form yanıtı',{exact:true}).filter({visible:true}).count()>0,true,'Natural response detail displays the confirmed form answer');
  });
  await workflow('record-commerce-quote-details',async()=>{
    await open('Quotes');await ui.click(names.quote,'QuoteDetail');await inspect('QuoteDetail');
    const quoteState=await ui.rpc('app_saha_query',{table:'quotes',operation:'select',select:'*',filters:[{op:'eq',field:'id',value:ids.quote}],order:[],returning:true});
    const writes=[];const observe=request=>{let body;try{body=request.postDataJSON();}catch{return;}if(body?.name==='app_saha_query'&&body.args?.table==='quotes'&&body.args.operation!=='select')writes.push(body.args.operation);};
    page.on('request',observe);
    try{
      await ui.host().getByText('Müşteri Kabul Linki Oluştur ve Paylaş',{exact:true}).filter({visible:true}).click();
      await page.getByText('Müşteri kabul bağlantısı bu portalda kullanılamıyor. Teklif kaydı değiştirilmedi ve bağlantı paylaşılmadı.',{exact:true}).filter({visible:true}).waitFor({state:'visible'});
      await page.waitForLoadState('networkidle');
      const after=await ui.rpc('app_saha_query',{table:'quotes',operation:'select',select:'*',filters:[{op:'eq',field:'id',value:ids.quote}],order:[],returning:true});
      check(after.data[0].share_token||null,null,'Hosted unsupported acceptance sharing creates no misleading token');
      check(after.versions[ids.quote],quoteState.versions[ids.quote],'Hosted unsupported acceptance sharing never changes quote revision');
      check(writes.length,0,'Hosted unsupported acceptance sharing submits no quote write');
    }finally{page.off('request',observe);}
    await ui.click('Revizyon Geçmişi','QuoteRevisions');await inspect('QuoteRevisions');
    await ui.back('QuoteDetail');await ui.click('AI Ajan: Açıklamayı otomatik doldur','AgentConsole');await inspect('AgentConsole');
    await ui.click('Öneriler','AgentSuggestions');await inspect('AgentSuggestions');
  });
  await workflow('record-commerce-material-and-warehouse-forms',async()=>{
    await open('Materials');await ui.click(names.material,'MaterialForm');await inspect('MaterialForm');
    await open('Warehouses');await ui.click('Yeni','WarehouseForm');await inspect('WarehouseForm');await ui.back('Warehouses');
    await ui.click(names.warehouse,'WarehouseDetail');await inspect('WarehouseDetail');
  });
  for(const [table,parent,form,namePlaceholder,newButton,saveLabel] of [
    ['materials','Materials','MaterialForm','Malzeme adı','Yeni malzeme ekle','Malzeme Ekle'],
    ['warehouses','Warehouses','WarehouseForm','Depo adı','Yeni depo/zimmet noktası ekle','Kaydet'],
  ])await workflow('record-commerce-'+table+'-rejected-save',async()=>{
    const phase='record-commerce-'+table+'-rejected-save',name='QA Korunan '+table,note='QA reddedilen kayıt taslağı',message='QA sentetik '+table+' kayıt reddi';
    await open(parent);await button(newButton,form);
    const input=ui.host().getByPlaceholder(namePlaceholder,{exact:true}),notes=ui.host().getByPlaceholder('Açıklama',{exact:true});
    await input.fill(name);await notes.fill(note);
    if(table==='materials')await ui.host().getByPlaceholder('MAL-001',{exact:true}).fill('QA-REJECT-447');
    const matches=request=>{let body;try{body=request.postDataJSON();}catch{return false;}return body?.name==='app_saha_query'&&body.args?.table===table&&body.args.operation==='upsert'&&body.args.rows?.[0]?.name===name;};
    let injected=0;
    const reject=async route=>{if(injected===0&&matches(route.request())){injected++;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({api:'vg-company/1',ok:false,error:'PT409',message})});}else await route.continue();};
    await page.route('**/api/company.php?action=rpc',reject);
    try{
      const apiBefore=report.apiErrors.length,consoleBefore=report.consoleErrors.length;
      const pending=page.waitForResponse(response=>matches(response.request()));await ui.host().getByText(saveLabel,{exact:true}).filter({visible:true}).click();const response=await pending;
      check(response.status(),409,'Intended inventory save receives exact synthetic conflict');
      await ui.host().getByRole('alert').filter({hasText:message}).filter({visible:true}).first().waitFor({state:'visible'});
      const requestKey=createHash('sha256').update(response.request().postData()||'').digest('hex');
      const end=Date.now()+3000;while(Date.now()<end&&!report.apiErrors.some(item=>item.requestKey===requestKey))await page.waitForTimeout(25);
      const errors=report.apiErrors.slice(apiBefore);check(errors.length,1,'Only the injected inventory save fails');
      check(errors[0].requestKey,requestKey,'Expected error belongs to exact submitted POST');check(errors[0].phase,phase,'Expected error belongs to this workflow');check(errors[0].error,'PT409','Expected inventory response retains its conflict code');
      await page.waitForTimeout(100);
      const consoleErrors=report.consoleErrors.slice(consoleBefore).filter(item=>item.phase===phase&&item.url===response.url()&&item.message==='Failed to load resource: the server responded with a status of 409 (Conflict)');
      check(consoleErrors.length<=1,true,'No extra inventory resource failure is exempted');
      (report.expectedApiErrors||=[]).push({...errors[0],description:'Explicit synthetic inventory write rejection',consoleErrors});
      report.apiErrors.splice(report.apiErrors.indexOf(errors[0]),1);for(const error of consoleErrors)report.consoleErrors.splice(report.consoleErrors.indexOf(error),1);
      check(await input.inputValue(),name,'Rejected inventory save preserves name');check(await notes.inputValue(),note,'Rejected inventory save preserves notes');
      const canonical=(await ui.rpc('app_saha_query',{table,operation:'select',select:'*',filters:[],order:[],returning:true})).data;
      check(canonical.some(row=>row.name===name),false,'Rejected inventory save creates no canonical record');
      const cache=await ui.rpc('app_saha_cache',{operation:'get',key:'@SahaTakip:'+table});check(JSON.parse(cache.value||'[]').some(row=>row.name===name),false,'Rejected inventory save creates no shared-cache ghost');
      await inspect(form);
    }finally{await page.unroute('**/api/company.php?action=rpc',reject);}
    const pending=page.waitForResponse(response=>matches(response.request()));await ui.host().getByText(saveLabel,{exact:true}).filter({visible:true}).click();check((await pending).ok(),true,'Manual inventory retry is accepted by actual PHP');
    await ui.settle(parent);await ui.host().getByText(name,{exact:true}).filter({visible:true}).waitFor({state:'visible'});
    await open(parent);await ui.host().getByText(name,{exact:true}).filter({visible:true}).first().waitFor({state:'visible'});
    check(await ui.host().getByText(name,{exact:true}).filter({visible:true}).count(),1,'Confirmed inventory retry survives a full remount exactly once');
    const canonical=(await ui.rpc('app_saha_query',{table,operation:'select',select:'*',filters:[],order:[],returning:true})).data.filter(row=>row.name===name);
    check(canonical.length,1,'Inventory retry has exactly one canonical server row');check(canonical[0].notes,note,'Confirmed inventory retry saves preserved notes');
  });
  await workflow('record-commerce-payment-form-and-detail',async()=>{
    await open('Payments');await ui.click('Yeni','PaymentForm');await inspect('PaymentForm');await ui.back('Payments');
    await ui.click(names.customer,'PaymentDetail');await inspect('PaymentDetail');
  });
  await workflow('record-commerce-vehicle-forms-and-details',async()=>{
    await open('Vehicles');await button('Yeni araç ekle','VehicleForm');await inspect('VehicleForm');await ui.back('Vehicles');
    await ui.click(names.plate,'VehicleDetail');await inspect('VehicleDetail');
    await ui.click('Km','VehicleLogForm');await inspect('VehicleLogForm');
    for(const kind of ['Yakıt','Bakım/Servis','Muayene','Sigorta']){await ui.host().getByText(kind,{exact:true}).filter({visible:true}).first().click();await inspect('VehicleLogForm');}
    await ui.back('VehicleDetail');
    await ui.click('Hasarlar','VehicleDamages');await ui.click('Yeni','VehicleDamageForm');await inspect('VehicleDamageForm');await ui.back('VehicleDamages');await ui.back('VehicleDetail');
    await ui.click('Rota Geçmişi','VehicleRoute');await inspect('VehicleRoute');
  });
  await workflow('record-commerce-chat-thread',async()=>{
    await open('Messages');await ui.host().getByText('Yeni',{exact:true}).click();await page.getByText('QA Çalışan',{exact:true}).click();await ui.settle('ChatThread');await inspect('ChatThread');
  });
  await workflow('record-commerce-barcode-permission-state',async()=>{
    await open('InventoryHub');await ui.click('Barkod Tarat','BarcodeScan');await inspect('BarcodeScan');
    check(await ui.host().getByText('Kamera İzni Gerekli',{exact:true}).isVisible(),true,'Browser without a camera receives a clear permission state');
    report.recordCoverage.deviceLimitations=[{route:'BarcodeScan',verified:'Permission screen in browser without camera permission',notVerified:'Real camera barcode decoding'}];ui.save();
  });
  await workflow('record-commerce-apollo-service-state',async()=>{
    await open('Customers');await button('Apollo ile lead bul','ApolloLeads');await inspect('ApolloLeads');
  });
};

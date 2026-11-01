'use strict';
const {randomUUID}=require('node:crypto');

// Actual compiled screens, normal visible navigation and the caller's isolated
// synthetic PHP dataset. Only the explicitly rejected POST is intercepted.
module.exports=async function({page,workflow,check,report,ui}){
 const customerId=randomUUID(),vehicleId=randomUUID(),paymentId=randomUUID(),stamp=new Date().toISOString();
 const host=ui.host;
 const query=(table,operation='select',extra={})=>ui.rpc('app_saha_query',{table,operation,select:'*',filters:[],order:[],returning:true,...extra});
 const byId=id=>[{op:'eq',field:'id',value:id}];
 async function open(target){
  const queue=ui.source.entries.filter(entry=>entry.enabled).map(entry=>({route:entry.route,entry:entry.route,steps:[]})),seen=new Set();
  while(queue.length){const item=queue.shift();if(seen.has(item.route))continue;seen.add(item.route);if(item.route===target){await ui.open(item.entry);for(const edge of item.steps)await ui.click(edge.label,edge.route);return;}
   for(const edge of ui.source.routes.find(row=>row.route===item.route)?.cards||[])if(!ui.source.routes.find(row=>row.route===edge.route)?.parameters?.required)queue.push({...item,route:edge.route,steps:[...item.steps,edge]});
  }
  throw Error('No normal enabled path found: '+target);
 }
 async function value(input,expected,label){await input.waitFor({state:'visible'});const deadline=Date.now()+15000;while(Date.now()<deadline&&await input.inputValue()!==expected)await page.waitForTimeout(50);check(await input.inputValue(),expected,label);}
 const requestBody=request=>{try{return request.postDataJSON();}catch{return null;}};
 const mutation=(request,table,operation)=>{const body=requestBody(request);return body?.name==='app_saha_query'&&body.args?.table===table&&body.args?.operation===operation;};
 async function submit(table,operation,label='Kaydet'){
  const [response]=await Promise.all([
   page.waitForResponse(response=>mutation(response.request(),table,operation),{timeout:20000}),
   host().getByText(label,{exact:true}).filter({visible:true}).click(),
  ]);
  return response;
 }
 async function editVehicle(){await open('Vehicles');await ui.click('35 QA DERİN','VehicleDetail');await host().getByRole('button',{name:'Aracı düzenle',exact:true}).click();await ui.settle('VehicleForm');}
 async function editPayment(){await open('Payments');await ui.click('QA Derin Müşteri','PaymentDetail');await ui.click('Düzenle','PaymentForm');}
 await workflow('operational-fixtures',async()=>{
  await ui.seed('customers',{id:customerId,short_name:'QA Derin Müşteri',title:'QA Derin İzole Müşteri'});
  await ui.seed('vehicles',{id:vehicleId,plate:'35 QA DERİN',brand:'QA İlk Marka',km_total:10});
  await ui.seed('payments',{id:paymentId,customer_id:customerId,customer_name:'QA Derin Müşteri',amount:42,currency:'TRY',method:'cash',status:'received',received_at:stamp,receipt_no:'QA DERİN MAKBUZ'});
 });
 await workflow('operational-vehicle-stale-edit',async()=>{
  await editVehicle();const input=host().getByPlaceholder('Ford',{exact:true});await value(input,'QA İlk Marka','Vehicle editor loads the fixture snapshot');await input.fill('QA Korunan Araç Taslağı');
  const initial=await query('vehicles','select',{filters:byId(vehicleId),single:'one'});
  await query('vehicles','update',{rows:{brand:'QA Diğer İstemci'},filters:byId(vehicleId),versions:initial.versions,single:'one'});
  const before={api:report.apiErrors.length,console:report.consoleErrors.length};
  await ui.expectedConflict(await submit('vehicles','upsert','Güncelle'),before,'Stale vehicle form');await value(input,'QA Korunan Araç Taslağı','Rejected vehicle edit preserves the visible draft');await ui.inspect('VehicleForm');
  check((await query('vehicles','select',{filters:byId(vehicleId),single:'one'})).data.brand,'QA Diğer İstemci','Stale vehicle edit never overwrites the canonical other-client edit');
  await editVehicle();await value(input,'QA Diğer İstemci','Explicit vehicle reopen accepts the current canonical snapshot');await input.fill('QA Doğrulanan Araç');
  check((await submit('vehicles','upsert','Güncelle')).ok(),true,'Fresh vehicle edit is accepted by the actual API');await ui.settle('VehicleDetail');
  check((await query('vehicles','select',{filters:byId(vehicleId),single:'one'})).data.brand,'QA Doğrulanan Araç','Fresh vehicle edit persists canonically');
 });
 await workflow('operational-payment-stale-edit',async()=>{
  await editPayment();const input=host().getByPlaceholder('0.00',{exact:true});await value(input,'42','Payment editor loads the initial amount');await input.fill('43');
  const initial=await query('payments','select',{filters:byId(paymentId),single:'one'});
  await query('payments','update',{rows:{amount:99},filters:byId(paymentId),versions:initial.versions,single:'one'});
  const before={api:report.apiErrors.length,console:report.consoleErrors.length};
  await ui.expectedConflict(await submit('payments','update'),before,'Stale payment form');await value(input,'43','Rejected payment edit keeps the amount draft');await ui.inspect('PaymentForm');
  check((await query('payments','select',{filters:byId(paymentId),single:'one'})).data.amount,99,'Payment stale form leaves the other canonical amount intact');
  await editPayment();await value(input,'99','Explicit payment reopen loads the current amount');await input.fill('100');check((await submit('payments','update')).ok(),true,'Fresh payment edit is accepted');await ui.settle('PaymentDetail');
  const saved=(await query('payments','select',{filters:byId(paymentId),single:'one'})).data;check(saved.amount,100,'Fresh payment amount persists');check(saved.received_at,stamp,'Editing a payment preserves the original receipt timestamp');
 });
 await workflow('operational-log-reject-and-retry',async()=>{
  await open('Vehicles');await ui.click('35 QA DERİN','VehicleDetail');await ui.click('Km','VehicleLogForm');
  const input=host().getByPlaceholder('0',{exact:true}).filter({visible:true}).first();await input.fill('123');
  let injected=0;const handler=async route=>{if(!injected&&mutation(route.request(),'vehicle_logs','insert')){injected++;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({api:'vg-company/1',ok:false,error:'PT409',message:'QA izole araç kaydı reddedildi.'})});}else await route.continue();};
  const before={api:report.apiErrors.length,console:report.consoleErrors.length};await page.route('**/api/company.php?action=rpc',handler);
  try{await ui.expectedConflict(await submit('vehicle_logs','insert'),before,'Injected vehicle-log insert');await value(input,'123','Rejected vehicle-log insert preserves the kilometre draft');await ui.inspect('VehicleLogForm');check((await query('vehicle_logs')).data.length,0,'Rejected log insert creates no canonical log');check((await query('vehicles','select',{filters:byId(vehicleId),single:'one'})).data.km_total,10,'Rejected primary log never advances the vehicle odometer');}
  finally{await page.unroute('**/api/company.php?action=rpc',handler);}
  check((await submit('vehicle_logs','insert')).ok(),true,'Explicit log retry reaches the real PHP API');await ui.settle('VehicleDetail');
  const logs=(await query('vehicle_logs')).data;check(logs.length,1,'Explicit log retry saves exactly one record');check(logs[0].km,123,'Confirmed log keeps the entered kilometre value');check((await query('vehicles','select',{filters:byId(vehicleId),single:'one'})).data.km_total,123,'Confirmed log advances the separate canonical vehicle odometer');
 });
};

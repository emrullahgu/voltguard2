'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const source=path.resolve(__dirname,'../staff-app/src');
const moduleAt=name=>import(pathToFileURL(path.join(source,name)).href);

test('Imported Turkish amounts and quote lines retain decimals and reject invalid values',async()=>{
 const {parseDecimal,saleUnitPrice,saleLineTotal,mergeCartItems}=await moduleAt('operations.mjs');
 assert.equal(parseDecimal('1.234,56',null),1234.56);
 assert.equal(parseDecimal('2,5',null),2.5);
 assert.equal(parseDecimal('1,234.56',null),1234.56);
 assert.equal(parseDecimal('12 kg',null),null);
 assert.equal(parseDecimal('',null),null);
 const item={name:'Sentetik ürün',category:'Test',price:'100,00',quantity:'2,5'};
 assert.equal(saleUnitPrice(item,10,20),108);
 assert.equal(saleLineTotal(item,10,20),270);
 assert.throws(()=>saleUnitPrice({...item,price:-1},0,0));
 assert.throws(()=>saleUnitPrice(item,101,0));
 const merged=mergeCartItems([item],[{...item,quantity:'0,5'}]);
 assert.equal(merged[0].quantity,3);
 assert.equal(item.quantity,'2,5');
});

test('Advance installments preserve every cent over month and year boundaries',async()=>{
 const {installmentAmount,monthlyAdvanceAmount}=await moduleAt('operations.mjs');
 const cents=Array.from({length:3},(_,i)=>Math.round(installmentAmount('100,01',3,i)*100));
 assert.deepEqual(cents,[3334,3334,3333]);assert.equal(cents.reduce((a,b)=>a+b),10001);
 assert.equal(installmentAmount(100,0,0),0);
 const advance={advance_date:'2026-12-15',amount:'100,01',installment_count:3};
 assert.equal(monthlyAdvanceAmount(advance,2026,10),0);
 assert.equal(monthlyAdvanceAmount(advance,2026,11),33.34);
 assert.equal(monthlyAdvanceAmount(advance,2027,0),33.34);
 assert.equal(monthlyAdvanceAmount(advance,2027,1),33.33);
 assert.equal(monthlyAdvanceAmount(advance,2027,2),0);
 assert.equal(monthlyAdvanceAmount({...advance,is_fully_paid:true},2027,0),0);
});

test('Monthly payroll snapshots isolate employee and period; save requests preserve the exact revision',async()=>{
 const {buildMonthlyPayrollData,buildPayrollSaveRequest,isPayrollConflict}=await moduleAt('payrollPersistence.mjs');
 const rows=[{employee_id:'one',month:9,year:2026,day:1,type:'Normal',overtime_hours:'2,5'},
 {employee_id:'other',month:9,year:2026,day:2,type:'Normal'},
 {employee_id:'one',month:8,year:2026,day:3,type:'Normal'}];
 const expenses=[{id:'advance',employee_id:'one',date:'2026-09-10',type:'Avans',amount:'100,01',installment_total:3},
 {employee_id:'other',date:'invalid',amount:-1}];
 const snapshot=buildMonthlyPayrollData('one',rows,expenses,9,2026);
 assert.deepEqual(Object.keys(snapshot.logs),['1']);assert.equal(snapshot.logs[1].overtimeHours,2.5);
 assert.equal(snapshot.expenses.length,1);assert.equal(snapshot.expenses[0].installment_current,2);
 const payroll={id:'p',employee_id:'one',month:9,year:2026,updated_at:'2026-10-13T12:01:02.123456Z',base_salary:100,expenses:[{amount:999}],payment_date:''};
 const request=buildPayrollSaveRequest(payroll,snapshot.logs);
 assert.equal(request.p_expected_updated_at,payroll.updated_at);
 assert.equal(request.p_payload.payment_date,null);assert.equal(request.p_payload.expenses,undefined);
 assert.equal(buildPayrollSaveRequest(payroll,{}, {logsOnly:true}).p_payload.base_salary,undefined);
 assert.throws(()=>buildPayrollSaveRequest({...payroll,updated_at:null},{}));
 assert.equal(isPayrollConflict({code:'PT409'}),true);assert.equal(isPayrollConflict({code:'422'}),false);
});

test('OSOS imports use measured values, validate calendars, and never fabricate missing categories',async()=>{
 const {directOsosMeasurements,prepareEnergyRows,parseEnergySpreadsheet,parseImportDate,cosPhiFromEnergy,workDurationHours}=await moduleAt('operations.mjs');
 const data=directOsosMeasurements([{tarih:'13.10.2026 12:00',frekans:'50,1'}],'Sentetik tesis');
 assert.equal(data[0].frekans,50.1);assert.equal(data[0].aktif_guc,null);assert.equal(data[0].gerilim_l1,null);
 assert.throws(()=>directOsosMeasurements([{tarih:'31.02.2026',frekans:50}],'Tesis'));
 assert.throws(()=>directOsosMeasurements([{tarih:'13.10.2026',guc_faktoru:1.2}],'Tesis'));
 assert.equal(parseImportDate('31.02.2026'),null);
 const energy=prepareEnergyRows([{Tarih:'13.10.2026','Tüketim (kWh)':'12,5'}],'aktif');
 assert.equal(energy.aktifData[0].tuketim,12.5);assert.deepEqual(energy.induktifData,[]);assert.deepEqual(energy.kapasitifData,[]);
 const counters=parseEnergySpreadsheet([{Tarih:'13.10.2026 00:00','Okunan Değer':100,Çarpan:2},{Tarih:'14.10.2026 00:00','Okunan Değer':106,Çarpan:2}]);
 assert.equal(counters.length,1);assert.equal(counters[0].tuketim,12);
 assert.throws(()=>parseEnergySpreadsheet([{Tarih:'13.10.2026','Okunan Değer':100},{Tarih:'14.10.2026','Okunan Değer':90}]));
 assert.equal(cosPhiFromEnergy(4,3),'0.800');assert.equal(cosPhiFromEnergy(null,3),null);
 assert.equal(workDurationHours('08:00','10:30'),2.5);assert.equal(workDurationHours('22:00','06:00'),null);
});

test('Archived discovery snapshots retain saved unit prices and report references without mutating the source',async()=>{
 const {normalizeKesifSnapshot}=await moduleAt('proposalSnapshots.mjs');
 const original={componentSnapshot:{teklifForm:{musteriAdi:'Sentetik müşteri',kdvOrani:20,teklifNo:'OLD'},cart:[{name:'Ürün',price:'79,99',quantity:'2,5'}],discount:0,profit:0,reportHtml:'<p>Kaydedilen rapor</p>'}};
 const snapshot=normalizeKesifSnapshot(original,'QA-REF');
 assert.equal(snapshot.cart[0].alis_fiyati,79.99);assert.equal(snapshot.cart[0].quantity,2.5);
 assert.equal(snapshot.teklifForm.teklifNo,'QA-REF');assert.equal(snapshot.reportHtml,'<p>Kaydedilen rapor</p>');
 assert.equal(original.componentSnapshot.cart[0].price,'79,99');assert.equal(original.componentSnapshot.teklifForm.teklifNo,'OLD');
 assert.throws(()=>normalizeKesifSnapshot({componentSnapshot:{teklifForm:{},cart:[{name:'Ürün',price:100,quantity:-1}],discount:0,profit:0}},'QA'));
});

'use strict';
// Real UI downloads using only the existing isolated temporary PHP/MFA fixture.
const path=require('node:path'),fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const XLSX=require(path.join(root,'tools/staff-app/node_modules/xlsx'));
async function runOutputScenarios(ctx){
  if(process.argv.includes('--payroll-only'))return require('./company-output-payrollextras.cjs')(ctx);
  const {page,admin,employee,api,rows,waitRow,mount,fill,workflow,check,report,download,output}=ctx;
  const now=new Date(),month=now.getMonth(),year=now.getFullYear();
  const insert=async(table,row)=>(await api(admin,'company','query',{table,operation:'insert',select:'*',rows:[row],filters:[],order:[],limit:null,range:null,single:'one',returning:true,onConflict:null})).data;
  const white=await insert('beyaz_yaka_employees',{name:'QA Çıktı Beyaz',monthly_salary:40000,gross_salary:50000,start_date:'2026-01-01',position:'QA Uzmanı',department:'Sentetik Test',user_id:employee.user.id});
  const unsavedWhite=await insert('beyaz_yaka_employees',{name:'QA Dönem Kaydı Yok',monthly_salary:36000,start_date:'2026-01-01'});
  const savedWhite=(await api(admin,'company','rpc',{name:'app_beyaz_yaka_payroll_save',args:{p_employee_id:white.id,p_month:month,p_year:year,p_payload:{base_salary:50000,bonus:2500,other_deductions:1750,sgk_employer:3000,logs:{},notes:'Sentetik çıktı testi; gerçek personel verisi değildir.'},p_expected_updated_at:null}})).data;
  const blue=await insert('bordro_employees',{name:'QA Çıktı Mavi A',agreed_salary:45000,official_salary:30000,user_id:employee.user.id});
  await insert('bordro_employees',{name:'QA Çıktı Mavi B',agreed_salary:36000,official_salary:28000});
  await api(admin,'company','rpc',{name:'app_bordro_daily_log_save',args:{p_employee_id:blue.id,p_day:1,p_month:month,p_year:year,p_log:{type:'Normal',start_time:'08:00',end_time:'18:00',overtime_hours:1,description:'Sentetik gerçek gün kaydı'},p_expected_updated_at:null}});
  function workbookRows(bytes){const workbook=XLSX.read(bytes,{type:'buffer'});return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);}
  function pdfInfo(bytes){const result=spawnSync(process.env.VG_PYTHON||'python',['-c','import io,json,sys;from pypdf import PdfReader;r=PdfReader(io.BytesIO(sys.stdin.buffer.read()));print(json.dumps({"pages":len(r.pages),"text":"\\n".join(p.extract_text() or "" for p in r.pages)},ensure_ascii=True))'],{input:bytes,encoding:'utf8',windowsHide:true,timeout:30000});check(result.status,0,'Generated PDF parses structurally');return JSON.parse(result.stdout);}
  async function printButton(button,label,selector){
    await page.evaluate(()=>{window.__qaPrintCount=0;window.print=()=>window.__qaPrintCount++;});
    await button.click();await page.waitForFunction(()=>window.__qaPrintCount>0);
    check(await page.evaluate(()=>window.__qaPrintCount),1,label+': browser print requested once');
    report.downloads.push({label,kind:'browser-print-invocation',note:'Native print dialog not automated; exported PDF has separate verification.'});
    await page.emulateMedia({media:'print'});
    try {
      const destination=path.join(output,label+'-browser.pdf');await page.pdf({path:destination,format:'A4',printBackground:true});
      report.downloads.push({label:label+'-browser',name:path.basename(destination),bytes:fs.statSync(destination).size,kind:'chromium-print-css'});
      check(await page.locator(selector).evaluate(element=>getComputedStyle(element).visibility),'visible',label+': print stylesheet exposes the current report');
      const info=pdfInfo(fs.readFileSync(destination));
      check(info.text.includes(label==='control-print'?'QA Kontrol Çıktısı':'QA Periyodik Teklif'),true,label+': browser PDF contains actual current report text');
    }finally{await page.emulateMedia({media:null});}
  }
  await workflow('white-saved-payroll-excel-values',async()=>{
    await mount('beyaz-yaka');
    let requests=0;
    const handler=async route=>{const body=route.request().postDataJSON();if(body.table==='beyaz_yaka_monthly_payroll'&&Array.isArray(body.range)){requests++;await new Promise(resolve=>setTimeout(resolve,350));}await route.continue();};
    await page.route('**/api/company.php?action=query',handler);
    let bytes;
    try{bytes=await download('white-summary',async()=>{await page.getByRole('button',{name:'Excel indir',exact:true}).click();const busy=page.getByRole('button',{name:'Excel hazırlanıyor…',exact:true});check(await busy.isDisabled(),true,'Pending Excel disables duplicate export');await busy.evaluate(button=>button.click());});}
    finally{await page.unroute('**/api/company.php?action=query',handler);}
    check(requests,1,'Repeated click produces one period-summary request');
    const record=workbookRows(bytes).find(row=>row['çalışan']===white.name);
    check(!!record,true,'White summary exports seeded employee');
    check(record['Net Ödeme'],savedWhite.net_payment,'White Excel uses actual selected-period saved net amount');
    check(record['İşveren Maliyeti'],savedWhite.total_employer_cost,'White Excel uses actual selected-period saved employer cost');
    const unsaved=workbookRows(bytes).find(row=>row['çalışan']===unsavedWhite.name);
    check(unsaved['Kayıt durumu'],'Dönem kaydı yok','Unsaved period is explicitly marked');
    check(unsaved['Net Ödeme']??null,null,'Unsaved period never invents a net payment');
  });
  await workflow('white-excel-request-error-no-false-download-retry',async()=>{
    await mount('beyaz-yaka');let downloads=0;const observed=()=>downloads++;page.on('download',observed);
    const handler=async route=>{const body=route.request().postDataJSON();if(body.table==='beyaz_yaka_monthly_payroll'&&Array.isArray(body.range))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({api:'vg-company/1',ok:false,error:'qa_summary_failure',message:'QA dönem kayıtları alınamadı.'})});await route.continue();};
    await page.route('**/api/company.php?action=query',handler);
    try{await page.getByRole('button',{name:'Excel indir',exact:true}).click();await page.getByText('Excel oluşturulamadı: QA dönem kayıtları alınamadı.',{exact:true}).waitFor();await page.waitForTimeout(150);check(downloads,0,'Failed period query never downloads fabricated payroll totals');check(await page.getByRole('button',{name:'Excel indir',exact:true}).isEnabled(),true,'Failed Excel request releases lock for retry');}
    finally{await page.unroute('**/api/company.php?action=query',handler);page.off('download',observed);}
    const bytes=await download('white-summary-retry',()=>page.getByRole('button',{name:'Excel indir',exact:true}).click());
    check(workbookRows(bytes).find(row=>row['çalışan']===white.name)['Net Ödeme'],savedWhite.net_payment,'Retry downloads actual persisted payroll amounts');
  });
  await workflow('white-saved-payroll-pdf',async()=>{
    await mount('beyaz-yaka');await page.locator('tr').filter({hasText:white.name}).getByTitle('Bordro Detayı',{exact:true}).click();
    await page.getByRole('button',{name:'PDF',exact:true}).waitFor();
    const bytes=await download('white-payroll',()=>page.getByRole('button',{name:'PDF',exact:true}).click());const pdf=pdfInfo(bytes);
    check(pdf.pages,1,'Normal white-payroll summary fits one A4 page without a notes-only continuation');
    check(pdf.text.includes('50.750,00'),true,'White payroll PDF retains saved net payment');
    await page.screenshot({path:path.join(output,'white-payroll-preview.png'),fullPage:true});
  });
  await workflow('blue-all-single-pdf-excel',async()=>{
    await mount('bordro');await page.getByText(blue.name,{exact:true}).first().waitFor();
    const bytes=await download('blue-summary',()=>page.getByRole('button',{name:'EXCEL',exact:true}).click());
    check(workbookRows(bytes).length,2,'Blue Excel contains both active synthetic employees');
    await download('blue-all',()=>page.getByRole('button',{name:'TOPLU PDF',exact:true}).click());
    await download('blue-single',()=>page.getByTitle('Bordro PDF İndir',{exact:true}).first().click());
  });
  await workflow('blue-payroll-excel-import-without-fabricated-days',async()=>{
    await mount('bordro');const before=await rows('bordro_daily_logs');
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet([{'AD SOYAD':'QA Excel Yeni','ANLAŞILAN MAAŞ':'48.000,50','RESMİ MAAŞ':'32.000,25','GÜN':30}]),'QA');
    await page.locator('input[type=file][accept*=".xlsx"]').setInputFiles({name:'qa-payroll-import.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})});
    const imported=await waitRow('bordro_employees',row=>row.name==='QA Excel Yeni');
    check(imported.agreed_salary,48000.5,'Payroll import parses entered net salary');check(imported.official_salary,32000.25,'Payroll import parses official salary');
    check((await rows('bordro_daily_logs')).length,before.length,'A GÜN summary never fabricates daily attendance');
  });
  await workflow('blue-payroll-excel-export-import-roundtrip',async()=>{
    await mount('bordro');const before=await rows('bordro_employees');
    const bytes=await download('blue-roundtrip',()=>page.getByRole('button',{name:'EXCEL',exact:true}).click());
    const notice=page.waitForEvent('dialog',{predicate:dialog=>/aktarımı tamamlandı|aktarımı tamamlanamadı/.test(dialog.message())});
    await page.locator('input[type=file][accept*=".xlsx"]').setInputFiles({name:'qa-exported-payroll.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:bytes});
    const dialog=await notice;check(/aktarımı tamamlandı/.test(dialog.message()),true,'The application accepts its own exported payroll column headings');
    check((await rows('bordro_employees')).length,before.length,'Roundtrip updates existing employees without duplicates');
  });
  await workflow('control-reports-save-pdf-print-open-delete',async()=>{
    await mount('kontrol');
    for(const [name,value]of Object.entries({firmaAdi:'QA Kontrol Çıktısı',raporNo:'QA-ZPKR-001',kontrolYapanAd:'QA Kontrol Uzmanı'}))await page.locator('[name="'+name+'"]').fill(value);
    await page.locator('select[name="sebekeTipi"]').selectOption('TN-S');
    await page.getByPlaceholder('Nokta Adı',{exact:true}).fill('QA Pano');await page.getByPlaceholder('In (A)',{exact:true}).fill('16');
    await page.locator('select').filter({has:page.locator('option[value="B"]')}).selectOption('B');
    check(await page.getByPlaceholder('Ia (A), üretici açma akımı',{exact:true}).inputValue(),'80','Control editor derives entered B16 comparison current');
    await page.getByPlaceholder('Zx / Rx',{exact:true}).fill('1');check(Number(await page.getByPlaceholder('Limit',{exact:true}).inputValue()),2.875,'Control editor derives comparison limit from entered TN-S/current data');
    await page.getByRole('button',{name:'+ Yeni Ölçüm Ekle',exact:true}).click();check(await page.getByPlaceholder('Nokta Adı',{exact:true}).count(),2,'Grounding editor adds a second measurement row');
    await page.getByRole('button',{name:'Kayıtlardan Özet Oluştur',exact:true}).click();
    check((await page.getByPlaceholder('Otomatik oluşturulan veya manuel girilen sonuç metni burada görünecek...',{exact:true}).inputValue()).includes('2 ölçüm/kontrol satırı'),true,'Summary is generated from actually entered measurement count');
    await page.getByPlaceholder('Otomatik oluşturulan veya manuel girilen sonuç metni burada görünecek...',{exact:true}).fill('Sentetik test kaydı. Tamamlanmamış değerlendirme; teknik kabul değildir.');
    await page.getByRole('button',{name:'Sunucuya Kaydet',exact:true}).click();
    const saved=await waitRow('company_documents',row=>row.kind==='periyodik_rapor');check(saved.payload.commonData.raporNo,'QA-ZPKR-001','Control report persisted through actual PHP');
    check(saved.payload.logo,'/calisan/uygulama/fatura_logo.png','Bundled logo uses shared URL instead of an oversized embedded PNG');
    check(saved.payload.commonData.sonucKanaat.includes('Sentetik test kaydı'),true,'PDF prerequisite conclusion is entered and persisted');
    await download('control-grounding',()=>page.getByRole('button',{name:'PDF İndir',exact:true}).click());
    await printButton(page.getByRole('button',{name:'Yazdır / PDF',exact:true}),'control-print','#periodic-control-report');
    await page.getByRole('button',{name:'Gözle Kontrol Raporu (ZPKR02)',exact:true}).click();
    for(const [placeholder,value]of Object.entries({'Pano Adı':'QA Pano','Linye No':'QA-1','Ib (Yük A)':'10','In (Sigorta A)':'16','Iz (Kablo Akım A)':'20'}))await page.getByPlaceholder(placeholder,{exact:true}).fill(value);
    check(await page.getByPlaceholder('Sonuç Notu',{exact:true}).inputValue(),'Ön kontrol uygun','Visual/circuit editor only labels the numeric coordination as preliminary');
    await page.getByRole('button',{name:'+ Yeni Devre Ekle',exact:true}).click();check(await page.getByPlaceholder('Pano Adı',{exact:true}).count(),2,'Visual editor adds a second circuit row');
    const visual=page.getByRole('heading',{name:'Görsel kontrol kayıtları',exact:true}).locator('xpath=..').locator('select');
    for(let i=0;i<await visual.count();i++)await visual.nth(i).selectOption('Uygulanamaz');
    await page.getByRole('button',{name:'Sunucuya Kaydet',exact:true}).click();
    const revised=await waitRow('company_documents',row=>row.id===saved.id&&row.revision===2);check(revised.payload.circuitMeasurements.length,2,'Control update stores both circuit rows');check(Object.values(revised.payload.visualChecks).every(value=>value==='Uygulanamaz'),true,'Every visual checklist selector persists its explicit choice');
    await download('control-visual',()=>page.getByRole('button',{name:'PDF İndir',exact:true}).click());
    await page.locator('[name="firmaAdi"]').fill('QA Kaydedilmemiş Değişiklik');
    await page.getByRole('button',{name:'Şirket Raporları',exact:true}).click();await page.getByRole('button',{name:'Aç',exact:true}).click();
    check(await page.locator('[name="firmaAdi"]').inputValue(),'QA Kontrol Çıktısı','Saved control report reopens persisted form');
    await page.getByRole('button',{name:'Yeni Kayıt / Kopya',exact:true}).click();await page.locator('[name="raporNo"]').fill('QA-ZPKR-COPY');await page.getByRole('button',{name:'Sunucuya Kaydet',exact:true}).click();
    const copy=await waitRow('company_documents',row=>row.kind==='periyodik_rapor'&&row.payload.commonData.raporNo==='QA-ZPKR-COPY');check(copy.id!==saved.id,true,'New copy saves a separate report instead of replacing its source');
    await page.getByRole('button',{name:'Şirket Raporları',exact:true}).click();
    for(let i=0;i<2;i++){await page.getByRole('button',{name:'Sil',exact:true}).first().click();await page.waitForTimeout(300);}
    check((await rows('company_documents')).filter(row=>row.kind==='periyodik_rapor').length,0,'Original control report and copied report delete independently');
  });
  await workflow('periodic-quote-save-open-pdf-print',async()=>{
    await mount('periodic');await page.getByPlaceholder('Firma adı',{exact:true}).fill('QA Periyodik Teklif');
    await page.locator('.portal-app input[type=number]').nth(2).fill('10');
    await page.getByRole('button',{name:'Hesapla',exact:true}).click();
    await download('periodic-quote',()=>page.getByRole('button',{name:'PDF İndir',exact:true}).click());
    await printButton(page.getByRole('button',{name:'Yazdır',exact:true}),'periodic-print','#periodic-printable-paper');
    await page.getByRole('button',{name:'Kaydet',exact:true}).click();
    const saved=await waitRow('proposals',row=>row.type==='periodic');check(saved.data.customer.name,'QA Periyodik Teklif','Periodic quote saved server-side');
    await mount('saved');await page.getByRole('heading',{name:saved.name,exact:true}).locator('xpath=..').getByRole('button').first().click();
    check(await page.getByPlaceholder('Firma adı',{exact:true}).inputValue(),'QA Periyodik Teklif','Saved periodic quote reopens its entered customer');
  });
  await workflow('weekly-excel-saved-values',async()=>{
    await insert('haftalik_raporlar',{fabrika_adi:'QA Excel Haftalık',hafta_baslangic:'2026-10-05',hafta_bitis:'2026-10-11',guc_faktoru:0.97,enerji_tuketimi:123.5,maliyet:456.75});
    await mount('haftalik-raporlama');const bytes=await download('weekly-summary',()=>page.getByRole('button',{name:'Excel',exact:true}).click());
    const record=workbookRows(bytes).find(row=>row.Fabrika==='QA Excel Haftalık');check(record['Enerji Tüketimi (kWh)'],123.5,'Weekly Excel preserves saved consumption');check(record['Maliyet (₺)'],456.75,'Weekly Excel preserves saved cost');
    await page.getByRole('button',{name:'PDF',exact:true}).first().click();
    const preview=page.locator('.fixed').filter({has:page.getByRole('heading',{name:'Haftalık Enerji Raporu - Ön İzleme',exact:true})});
    await preview.getByRole('button',{name:'Düzenle',exact:true}).click();await page.locator('#haftalik-rapor-printable [contenteditable=true]').first().fill('QA Excel Haftalık Düzenlendi');
    await preview.getByRole('heading',{name:'Haftalık Enerji Raporu - Ön İzleme',exact:true}).click();
    await preview.getByRole('button',{name:'Kaydet',exact:true}).click();
    await waitRow('haftalik_raporlar',row=>row.fabrika_adi==='QA Excel Haftalık Düzenlendi');
    await download('weekly-edited',()=>preview.getByRole('button',{name:'PDF İndir',exact:true}).click());
    check((await page.locator('#haftalik-rapor-printable').innerText()).includes('QA Excel Haftalık Düzenlendi'),true,'Weekly report editor persists and re-renders entered report text');
    check((await page.locator('#haftalik-rapor-printable').innerText()).includes('Ölçüm veya hedef bilgisi eksik.'),true,'Missing target never becomes an urgent equipment conclusion');
    await preview.locator('button').last().click();await page.getByRole('heading',{name:'QA Excel Haftalık Düzenlendi',exact:true}).waitFor();
    check(report.pageErrors.length,0,'Weekly edited-save callback refreshes the actual list without JavaScript errors');
  });
  await workflow('weekly-report-missing-input-and-comparison-copy',async()=>{
    const variants=[['NullTarget',0.97,null,'VERİ EKSİK'],['ZeroTarget',0.97,0,'VERİ EKSİK'],['NullMeasurement',null,0.95,'VERİ EKSİK'],['BelowTarget',0.8,0.95,'UYGUN DEĞİL'],['MeetsTarget',0.98,0.95,'UYGUN']];
    for(const [name,value,target]of variants)await insert('haftalik_raporlar',{fabrika_adi:'QA Weekly '+name,hafta_baslangic:'2026-10-05',hafta_bitis:'2026-10-11',guc_faktoru:value,hedef_guc_faktoru:target});
    await mount('haftalik-raporlama');
    check((await page.locator('.portal-app').innerText()).includes('NaN'),false,'Missing measurement does not poison weekly summary averages');
    for(const [name,value,target,status]of variants){
      const card=page.locator('.bg-white.rounded-xl.shadow-lg').filter({has:page.getByRole('heading',{name:'QA Weekly '+name,exact:true})});
      await card.getByRole('button',{name:'PDF',exact:true}).click();const paper=page.locator('#haftalik-rapor-printable');await paper.waitFor();const text=await paper.innerText();
      check(text.includes(status),true,name+': report uses the actual available comparison status');
      check(/reaktif enerji cezası|ek kompanzasyon ekipmanı gerekli|sistemi yetersiz|ACİL/.test(text),false,name+': report does not invent a financial penalty or equipment diagnosis');
      if(status==='VERİ EKSİK')check(text.includes('Ölçüm veya hedef bilgisi eksik.'),true,name+': report requests missing inputs');
      const preview=page.locator('.fixed').filter({has:page.getByRole('heading',{name:'Haftalık Enerji Raporu - Ön İzleme',exact:true})});await preview.locator('button').last().click();
    }
  });
  await require('./company-output-ososcases.cjs')(ctx);
  if(process.env.VG_COMPANY_PROPOSAL_OUTPUT_FOCUS==='1')await require('./company-output-proposal-utilities.cjs')(ctx);
}
module.exports=runOutputScenarios;
if(require.main===module){process.env.VG_COMPANY_OUTPUT_FOCUS='1';require('./company-real-browser.cjs');}

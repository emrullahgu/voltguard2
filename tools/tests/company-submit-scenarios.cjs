'use strict';

/* Run with node tools/tests/company-submit-scenarios.cjs after building company assets.
   Add --weekly-pdf-only for weekly preview and raster PDF content regressions.
   Reuses the real browser harness's isolated temporary PHP dataset and MFA setup. */
async function runSubmitScenarios(context) {
  if(process.argv.includes('--weekly-pdf-only'))return runWeeklyPdfScenarios(context);
  const {page,admin,api,rows,waitRow,mount,fill,workflow,check,report}=context;
  const insert = async (table,record) => (await api(admin,'company','query',{
    table,operation:'insert',select:'*',rows:[record],filters:[],order:[],limit:null,range:null,
    single:'one',returning:true,onConflict:null
  })).data;
  const worker = await insert('is_takip_calisanlar',{ad_soyad:'QA Submit Worker'});
  const location = await insert('is_takip_lokasyonlar',{ad:'QA Submit Location'});
  await insert('vehicles',{plate:'34 QA 999',brand:'-',model:'-'});
  await insert('drivers',{full_name:'QA Submit Driver',active:true});

  async function scenario(name,table,prepare,values,predicate) {
    await workflow(name,async()=>{
      await prepare();
      const form=page.locator('form'),save=form.locator('button[type="submit"]');
      check(await form.evaluate(element=>element.checkValidity()),true,name+': completed form is valid');
      const expectedValues=[];
      for(const control of values)expectedValues.push(await control.inputValue());
      let insertRequests=0,forwardedRequests=0;
      const marker='QA_SAVE_RETRY_'+table;
      const pattern='**/api/company.php?action=query';
      const routeHandler=async route=>{
        const body=route.request().postDataJSON();
        if(body?.table!==table||body.operation!=='insert')return route.continue();
        insertRequests++;
        if(insertRequests===1){
          await new Promise(resolve=>setTimeout(resolve,450));
          return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
            api:'vg-company/1',ok:false,error:'qa_retry',message:marker
          })});
        }
        await new Promise(resolve=>setTimeout(resolve,900));
        forwardedRequests++;
        await route.continue();
      };
      await page.route(pattern,routeHandler);
      try{
        const failed=page.waitForEvent('dialog',{predicate:dialog=>dialog.message().includes(marker)});
        await save.click();
        await failed;
        await page.waitForFunction(()=>document.querySelector('form')?.getAttribute('aria-busy')==='false');
        check(await form.isVisible(),true,name+': failed request keeps editor open');
        check(await save.isEnabled(),true,name+': failed request releases save lock');
        for(let index=0;index<values.length;index++)check(await values[index].inputValue(),expectedValues[index],name+': failed request retains input '+index);
        check((await rows(table)).filter(predicate).length,0,name+': rejected request persists no record');
        // The application logs caught save errors. Consume exactly this deliberate error,
        // retaining every unrelated console, page or API error in the harness report.
        const expectedError=report.consoleErrors.findIndex(error=>error.message.includes(marker));
        check(expectedError>=0,true,name+': expected synthetic save error is visible in console');
        report.consoleErrors.splice(expectedError,1);

        await save.click();
        check(await save.isDisabled(),true,name+': pending request disables submit');
        check(await form.getAttribute('aria-busy'),'true',name+': pending state is announced');
        for(const control of values)check(await control.isDisabled(),true,name+': pending request freezes form fields');
        check(await form.getByRole('button',{name:'İptal',exact:true}).isDisabled(),true,name+': cancel cannot clear a pending form');
        // A second physical click is suppressed by disabled controls. Dispatch submit as
        // well to prove the synchronous guard protects events before/without a rerender.
        await page.waitForTimeout(120);
        await save.evaluate(button=>button.click());
        await form.evaluate(element=>element.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
        await waitRow(table,predicate);
        await form.waitFor({state:'hidden'});
        await page.waitForTimeout(180);
        check(insertRequests,2,name+': one rejected attempt plus one retry POST');
        check(forwardedRequests,1,name+': repeated submit forwards one actual PHP insert');
        check((await rows(table)).filter(predicate).length,1,name+': repeated submit persists exactly one record');
        console.log(JSON.stringify({scenario:name,rejectedAttempts:1,successfulInsertPosts:forwardedRequests,durableRecords:1}));
      }finally{await page.unroute(pattern,routeHandler);}
    });
  }

  await scenario('submit-fuel','fuel_records',async()=>{
    await mount('akaryakit');await page.getByRole('button',{name:'Yakıt Kaydı Ekle',exact:true}).click();
    await page.locator('form').getByPlaceholder('34 ABC 123').fill('34 QA 999');
    await page.locator('form').getByPlaceholder('Ahmet Yılmaz').fill('QA Submit Driver');
    await page.getByPlaceholder('0.00').fill('1234.56');
  },[page.locator('form').getByPlaceholder('34 ABC 123'),page.locator('form').getByPlaceholder('Ahmet Yılmaz'),page.getByPlaceholder('0.00')],row=>Number(row.total_amount)===1234.56);

  await scenario('submit-work','is_takip_kayitlar',async()=>{
    await mount('is-takip');await page.getByRole('button',{name:'İş Kaydı Ekle',exact:true}).click();
    const form=page.locator('form');await fill('Çalışan',worker.id,form);await fill('Lokasyon',location.id,form);
    await fill('Başlangıç Saati','09:00',form);await fill('Bitiş Saati','10:30',form);
    await page.getByPlaceholder('Yapılan işi detaylı açıklayınız...').fill('QA Submit Work');
  },[page.getByPlaceholder('Yapılan işi detaylı açıklayınız...')],row=>row.yapilan_is==='QA Submit Work');

  await scenario('submit-weekly','haftalik_raporlar',async()=>{
    await mount('haftalik-raporlama');await page.getByRole('button',{name:'Yeni Rapor',exact:true}).click();
    await page.getByPlaceholder('Örn: ABC Fabrikası').fill('QA Submit Weekly');
    await page.getByRole('button',{name:'Bu Hafta',exact:true}).click();
    await page.getByPlaceholder('0.920').fill('0.95');await page.locator('#ilkKayit').check();
    await page.getByPlaceholder('327.06').fill('100');await page.getByPlaceholder('70044.66').fill('300');
    await page.getByPlaceholder('Örn: Otomatik kompanzasyon aktif, 3 kademe çalışıyor').fill('QA measured data');
  },[page.getByPlaceholder('Örn: ABC Fabrikası'),page.getByPlaceholder('70044.66')],row=>row.fabrika_adi==='QA Submit Weekly');

  for(const [name,table,tab,button,placeholder,value,field] of [
    ['submit-work-employee','is_takip_calisanlar','Çalışanlar','Yeni Çalışan','Örn: Ahmet Yılmaz','QA Submit Employee','ad_soyad'],
    ['submit-work-location','is_takip_lokasyonlar','Lokasyonlar','Yeni Lokasyon','Örn: Fabrika 1, Şantiye A','QA Submit Location 2','ad'],
    ['submit-work-material','is_takip_malzemeler','Malzemeler','Yeni Malzeme','Örn: Vida, Boya, Kablo','QA Submit Material','ad']
  ])await scenario(name,table,async()=>{
    await mount('is-takip');await page.getByRole('button',{name:new RegExp('^'+tab)}).click();
    await page.getByRole('button',{name:button,exact:true}).click();await page.getByPlaceholder(placeholder).fill(value);
  },[page.getByPlaceholder(placeholder)],row=>row[field]===value);
}

async function runWeeklyPdfScenarios({page,admin,api,mount,workflow,check,download,output}) {
  const path=require('node:path');
  for(const [name,previous,cost] of [['first',null,null],['numeric',0.9,1234.5]]){
    const factory='QA Weekly PDF '+name;
    await api(admin,'company','query',{table:'haftalik_raporlar',operation:'insert',select:'*',rows:[{
      fabrika_adi:factory,hafta_baslangic:'2026-10-26',hafta_bitis:'2026-11-01',guc_faktoru:0.95,
      onceki_hafta_guc_faktoru:previous,hedef_guc_faktoru:0.95,aktif_guc:100,enerji_tuketimi:300,
      kompanzasyon_durumu:'QA measured data',maliyet:cost
    }],filters:[],order:[],limit:null,range:null,single:'one',returning:true,onConflict:null});
    await workflow('weekly-pdf-'+name,async()=>{
      await mount('haftalik-raporlama');
      await page.getByRole('heading',{name:factory,exact:true}).locator('xpath=../../..').getByRole('button',{name:'PDF',exact:true}).click();
      const printable=page.locator('#haftalik-rapor-printable');await printable.waitFor({state:'visible'});
      const text=await printable.innerText();
      const costText=await printable.locator('tr').filter({has:page.getByText('Maliyet',{exact:true})}).locator('td').nth(1).innerText();
      check(/NaN|Infinity/.test(text),false,name+': preview contains no invalid numeric text');
      if(previous===null){
        check(text.includes('Önceki hafta ölçümü olmadığı için karşılaştırma yapılamıyor.'),true,'First record explains unavailable comparison');
        check(/Önceki haftaya göre (?:artış|düşüş)/.test(text),false,'First record invents no increase or decrease');
        check(costText,'Belirtilmedi','Missing cost is explicit, never a fabricated zero');
      }else{
        check(text.includes('artış göstermiştir (5.0%)'),true,'Numeric previous reading preserves actual upward trend');
        check(costText,'1.234,5 ₺','Numeric cost retains Turkish number formatting');
      }
      await page.screenshot({path:path.join(output,'weekly-'+name+'-preview.png'),fullPage:true});
      // This exporter rasterizes HTML; PDF text extraction cannot read its JPEGs.
      // Capture the sanitized DOM actually handed to html2canvas during download.
      await page.evaluate(()=>{
        window.__qaWeeklyExportText=[];
        window.__qaWeeklyExportObserver?.disconnect();
        const seen=new WeakSet();
        window.__qaWeeklyExportObserver=new MutationObserver(records=>{
          for(const record of records)for(const added of record.addedNodes){
            if(added.nodeType!==Node.ELEMENT_NODE)continue;
            const clones=[...(added.matches('.pdf-exporting')?[added]:[]),...added.querySelectorAll('.pdf-exporting')];
            for(const clone of clones)if(!seen.has(clone)){seen.add(clone);window.__qaWeeklyExportText.push(clone.innerText);}
          }
        });
        window.__qaWeeklyExportObserver.observe(document.body,{childList:true,subtree:true});
      });
      const bytes=await download('weekly-'+name,()=>page.getByRole('button',{name:'PDF İndir',exact:true}).click());
      const exported=await page.evaluate(()=>{window.__qaWeeklyExportObserver.disconnect();return window.__qaWeeklyExportText;});
      check(exported.length>0,true,name+': actual raster export pages were observed');
      const exportedText=exported.join('\n');
      check(/NaN|Infinity/.test(exportedText),false,name+': actual exported page content contains no invalid number');
      check(bytes.length>10000,true,name+': downloaded PDF contains rendered page data');
      if(previous===null){
        check(exportedText.includes('karşılaştırma yapılamıyor.'),true,'Downloaded first report renders comparison explanation');
        check(exportedText.includes('Belirtilmedi'),true,'Downloaded first report renders missing cost honestly');
        check(/Önceki haftaya göre (?:artış|düşüş)/.test(exportedText),false,'Downloaded first report invents no trend');
      }else{
        check(exportedText.includes('artış göstermiştir (5.0%)'),true,'Downloaded numeric report retains trend');
        check(exportedText.includes('1.234,5 ₺'),true,'Downloaded numeric report retains cost');
      }
    });
  }
}

module.exports=runSubmitScenarios;
if(require.main===module){
  process.env.VG_COMPANY_SUBMIT_FOCUS='1';
  require('./company-real-browser.cjs');
}

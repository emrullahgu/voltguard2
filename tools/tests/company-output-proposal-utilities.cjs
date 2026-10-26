'use strict';
// Visible quotation editor/archive/print utilities against the isolated real PHP fixture.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
module.exports=async function(ctx){
  const {page,mount,workflow,check,rows,waitRow,download,report,output,base}=ctx;
  const saved={};
  const card=name=>page.getByRole('heading',{name,exact:true}).locator('xpath=..');
  const pdfText=bytes=>{const result=spawnSync(process.env.VG_PYTHON||'python',['-c','import io,json,sys;from pypdf import PdfReader;r=PdfReader(io.BytesIO(sys.stdin.buffer.read()));print(json.dumps({"pages":len(r.pages),"text":"\\n".join(p.extract_text() or "" for p in r.pages)},ensure_ascii=True))'],{input:bytes,encoding:'utf8',windowsHide:true});check(result.status,0,'Quotation browser PDF parses');return JSON.parse(result.stdout);};
  async function edit(rootId,marker){
    await page.getByRole('button',{name:/Düzenleme Modu/}).first().click();
    const root=page.locator('#'+rootId);check(await root.getAttribute('contenteditable'),'true','Editor activates the visible report');
    await root.locator('p').filter({hasNot:page.locator('[data-vg-reference]')}).first().click();await page.keyboard.press('End');await page.keyboard.type(' '+marker);
    check((await root.innerText()).includes(marker),true,'Keyboard edit changes report content');
    await page.getByRole('button',{name:/Düzenleme Modundan/}).first().click();
    check(await root.getAttribute('contenteditable'),'false','Editor saves and exits editing');check((await root.innerText()).includes(marker),true,'Edited text remains visible after editor closes');
  }
  async function printReport(rootId,marker,label){
    await page.evaluate(()=>{window.__qaPrint=0;window.print=()=>window.__qaPrint++;});
    await page.getByRole('button',{name:/Yazdır/}).first().click();check(await page.evaluate(()=>window.__qaPrint),1,'Print button requests one browser print');
    await page.emulateMedia({media:'print'});
    try{
      check(await page.locator('#'+rootId).evaluate(e=>getComputedStyle(e).visibility),'visible','Print CSS exposes the current quotation');
      const target=path.join(output,label+'.pdf');const bytes=await page.pdf({path:target,format:'A4',printBackground:true});
      const parsed=pdfText(bytes);check(parsed.text.includes(marker),true,'Actual print-media PDF retains the edited quotation text');
      check(parsed.pages,2,'The ordinary two-page quotation prints as exactly two A4 pages');
      report.downloads.push({label,name:path.basename(target),bytes:bytes.length,kind:'chromium-print-css',pages:parsed.pages});
    }finally{await page.emulateMedia({media:null});}
  }
  await workflow('yg-editor-archive-local-draft-copy-and-print',async()=>{
    await mount('manual');await page.getByPlaceholder('Örn: ABC Endüstri San. ve Tic. A.Ş.').fill('QA Editör YG');
    await page.getByPlaceholder('Örn: Ahmet Yilmaz').fill('QA Yetkili');await page.getByPlaceholder('Örn: Tekstil, Güçda').fill('QA Sektör');await page.getByPlaceholder('Örn: 1600 veya 1000+630').fill('630');
    await page.getByRole('button',{name:'Hesapla ve Teklif Oluştur',exact:true}).click();
    await page.locator('#printable-paper').waitFor();
    const draft=page.getByRole('button',{name:/Teklif Sunum E-postası Yaz/});await draft.click();
    const text=await page.locator('pre').innerText(),draftReference=await page.locator('#printable-paper [data-vg-reference]').first().innerText();check(text.includes('QA Editör YG')&&text.includes(draftReference),true,'Email draft uses the entered customer and current reference');
    await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
    await page.getByRole('button',{name:'Kopyala',exact:true}).click();
    check((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n'),text.replace(/\r\n/g,'\n'),'Copy button writes the complete locally generated draft');
    await edit('printable-paper','QA-YG-EDITOR');
    await page.getByRole('button',{name:/Kaydet/}).last().click();
    saved.yg=await waitRow('proposals',r=>r.type==='yg'&&r.name.includes('QA Editör YG')&&r.data.reportHtml.includes('QA-YG-EDITOR'));
    await mount('saved');await card(saved.yg.name).getByRole('button').first().click();
    check((await page.locator('#printable-paper').innerText()).includes('QA-YG-EDITOR'),true,'YG archive reopens persisted editor content');
    check(pdfText(await download('yg-edited-pdf',()=>page.getByRole('button',{name:/PDF.*İndir/}).first().click())).pages,2,'The edited yg PDF keeps its two intended pages');
    await printReport('printable-paper','QA-YG-EDITOR','yg-edited-print');
  });
  await workflow('periodic-editor-archive-and-print',async()=>{
    await mount('periodic');await page.getByPlaceholder('Firma adı',{exact:true}).fill('QA Editör Periyodik');
    await page.locator('.portal-app input[type=number]').nth(2).fill('5');await page.getByRole('button',{name:'Hesapla',exact:true}).click();
    await edit('periodic-printable-paper','QA-PERIODIC-EDITOR');await page.getByRole('button',{name:'Kaydet',exact:true}).click();
    saved.periodic=await waitRow('proposals',r=>r.type==='periodic'&&r.name.includes('QA Editör Periyodik')&&r.data.reportHtml.includes('QA-PERIODIC-EDITOR'));
    await mount('saved');await card(saved.periodic.name).getByRole('button').first().click();
    check((await page.locator('#periodic-printable-paper').innerText()).includes('QA-PERIODIC-EDITOR'),true,'Periodic archive reopens persisted editor content');
    check(pdfText(await download('periodic-edited-pdf',()=>page.getByRole('button',{name:'PDF İndir',exact:true}).click())).pages,2,'The edited periodic PDF keeps its two intended pages');
    await printReport('periodic-printable-paper','QA-PERIODIC-EDITOR','periodic-edited-print');
  });
  await workflow('ges-editor-archive-and-print',async()=>{
    await mount('ges');await page.getByPlaceholder('Müşteri adı').fill('QA Editör GES');
    const packageButton=page.getByRole('button',{name:'Ev Tipi',exact:true});await packageButton.click();
    await page.locator('#ges-printable-area .ges-pdf-page').first().waitFor();
    await edit('ges-printable-area','QA-GES-EDITOR');await page.getByRole('button',{name:'Teklifi Kaydet',exact:true}).click();
    saved.ges=await waitRow('proposals',r=>r.type==='ges'&&r.name.includes('QA Editör GES')&&r.data.reportHtml.includes('QA-GES-EDITOR'));
    await mount('saved');await card(saved.ges.name).getByRole('button').first().click();
    check((await page.locator('#ges-printable-area').innerText()).includes('QA-GES-EDITOR'),true,'GES archive reopens persisted editor content');
    check(pdfText(await download('ges-edited-pdf',()=>page.getByRole('button',{name:'PDF İndir',exact:true}).click())).pages,2,'The edited ges PDF keeps its two intended pages');
    await printReport('ges-printable-area','QA-GES-EDITOR','ges-edited-print');
  });
  await workflow('saved-quotation-type-filters-and-delete',async()=>{
    await mount('saved');
    for(const [type,name] of [['yg',/^YG Teklifleri/],['periodic',/^Periyodik Kontrol \(/],['ges',/^GES Teklifleri/]]){
      await page.getByRole('button',{name}).click();
      check(await card(saved[type].name).count()>0,true,'Archive filter retains its matching quotation: '+type);
      for(const other of Object.keys(saved).filter(k=>k!==type))check(await card(saved[other].name).count(),0,'Archive filter excludes another quotation type: '+other);
    }
    await page.getByRole('button',{name:/^Tümü \(/}).click();
    for(const record of Object.values(saved)){
      const match=card(record.name);await match.getByRole('button').last().click();
      await page.waitForTimeout(180);check((await rows('proposals')).some(row=>row.id===record.id),false,'Archive deletion removes the exact saved editor snapshot');
    }
  });
};
if(require.main===module){process.env.VG_COMPANY_OUTPUT_FOCUS='1';process.env.VG_COMPANY_PROPOSAL_OUTPUT_FOCUS='1';require('./company-real-browser.cjs');}

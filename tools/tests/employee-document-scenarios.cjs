'use strict';
const path = require('node:path');

module.exports = async function documentScenarios({page,mount,workflow,check,report,output,base}) {
  const host=()=>page.locator('[data-employee-module-host]');
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');await cdp.send('CSS.enable');
  async function platformFonts() {
    const {nodes}=await cdp.send('DOM.getFlattenedDocument',{depth:-1,pierce:true});
    const forTestId=async testId=>{
      const node=nodes.find(node=>node.attributes?.some((value,index,array)=>index%2===0&&value==='data-testid'&&array[index+1]===testId));
      if(!node)throw Error('Rendered font target not found: '+testId);
      return (await cdp.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId})).fonts;
    };
    return {title:await forTestId('site-hub-title'),description:await forTestId('site-hub-description')};
  }
  async function settle() {
    await page.getByText('Modül yükleniyor…',{exact:true}).waitFor({state:'hidden',timeout:60000});
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(()=>!document.documentElement.classList.contains('vg-theme-anim'));
    await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  }
  async function metrics() {
    return host().evaluate(host=>{
      const root=host.shadowRoot.querySelector('[data-vg-module-root]');
      const rootRect=root.getBoundingClientRect();
      const viewport=[...root.querySelectorAll('div')].find(node=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect();return ['auto','scroll'].includes(style.overflowY)&&style.flexDirection==='column'&&rect.width>=rootRect.width*.85&&node.children.length===1&&rect.height>0&&!node.closest('[aria-hidden="true"]');});
      const title=root.querySelector('[data-testid=site-hub-title]'),description=root.querySelector('[data-testid=site-hub-description]'),card=root.querySelector('[data-testid=site-hub-card]'),icon=root.querySelector('[data-testid=site-hub-icon]');
      const text=root.innerText;
      return {mode:host.dataset.moduleLayout,height:Math.round(host.getBoundingClientRect().height),property:host.style.getPropertyValue('--vg-module-content-height'),scrolling:viewport?{height:viewport.clientHeight,content:viewport.scrollHeight,overflow:getComputedStyle(viewport).overflowY}:null,hasTechnicalLabels:/POZ-(?:DEV|CAT)-|\bCRUD\b/.test(text),title:title?{font:getComputedStyle(title).fontFamily,size:getComputedStyle(title).fontSize,color:getComputedStyle(title).color}:null,description:description?{font:getComputedStyle(description).fontFamily,size:getComputedStyle(description).fontSize,color:getComputedStyle(description).color}:null,card:card?getComputedStyle(card).backgroundColor:null,icon:icon?getComputedStyle(icon).backgroundColor:null};
    });
  }
  report.documentLayouts=[];
  for(const width of [1440,390])for(const theme of ['light','dark'])await workflow(`site-stock-document-${width}-${theme}`,async()=>{
    await page.setViewportSize({width,height:1000});await mount('stok');
    await host().getByTestId('site-hub-card').first().waitFor();await settle();
    if(await page.locator('html').getAttribute('data-theme')!==theme){
      if(!await page.locator('[data-vg-theme-toggle]:visible').count())await page.getByRole('button',{name:'Çalışan menüsü',exact:true}).click();
      await page.locator('[data-vg-theme-toggle]:visible').first().click();await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);await settle();
      if(await page.locator('#portal-account-toggle[aria-expanded="true"]').count())await page.getByRole('button',{name:'Çalışan menüsü',exact:true}).click();
    }
    const state=await metrics();state.renderedFonts=await platformFonts();report.documentLayouts.push({width,theme,...state});
    check(state.mode,'document','Stock module uses document layout');
    check(state.scrolling.content<=state.scrolling.height+2,true,'Stock overview has no nested vertical scrollbar');
    check(state.hasTechnicalLabels,false,'No mobile development codes or CRUD jargon is displayed');
    check(/Outfit/.test(state.title.font),true,'Hub titles use site heading font');
    check(/Inter/.test(state.description.font),true,'Hub descriptions use site body font');
    check(state.renderedFonts.title.some(font=>/Outfit/.test(font.familyName)&&font.glyphCount>0),true,'Title glyphs are rendered by the actual Outfit font');
    check(state.renderedFonts.description.length>0&&state.renderedFonts.description.every(font=>/Inter/.test(font.familyName)),true,'All description glyphs are rendered by Inter without serif fallback');
    check(Number.parseFloat(state.description.size)>=14,true,'Hub descriptions are readable desktop text');
    await page.locator('.employee-domain-heading').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,`stock-web-${width}-${theme}.png`)});
  });
  await workflow('site-customer-form-document-grow-shrink',async()=>{
    await page.setViewportSize({width:390,height:1000});await mount('musteriler');await settle();
    const list=await metrics();
    await host().getByRole('button',{name:'Yeni müşteri ekle',exact:true}).click();
    await host().getByPlaceholder('EGEBORU',{exact:true}).waitFor();await settle();
    await host().getByPlaceholder('EGEBORU',{exact:true}).fill('QA Belge Düzeni');
    const form=await metrics();report.documentLayouts.push({name:'customer-list',...list},{name:'customer-form',...form});
    check(form.mode,'document','Customer form uses document layout');
    check(form.height>list.height+200,true,'Host grows from empty list to the full customer form');
    check(form.scrolling.content<=form.scrolling.height+2,true,'Full form has no nested vertical scrolling');
    await page.getByRole('button',{name:'Tüm uygulamalar',exact:true}).click();
    await page.getByRole('button',{name:/^Stok ve zimmet/}).click();await host().getByTestId('site-hub-card').first().waitFor();await settle();
    const smaller=await metrics();report.documentLayouts.push({name:'stock-after-form',...smaller});
    check(smaller.height<form.height,true,'Switching away from a long form shrinks the host');
    check(smaller.mode,'document','Navigation preserves document layout for ordinary overview');
  });
  await workflow('site-board-workspace-modal-focus',async()=>{
    await page.setViewportSize({width:1440,height:1000});await mount('ofis');await settle();
    await host().getByTestId('site-hub-card').filter({hasText:'Panolar'}).click();
    await host().getByText('Yeni Pano',{exact:true}).waitFor();await settle();
    const before=await metrics();check(before.mode,'workspace','Board routes keep an independent workspace');
    await host().getByText('Yeni Pano',{exact:true}).click();
    const input=host().getByPlaceholder('Pano adı (ör. Q3 Girişimleri)',{exact:true});await input.waitFor();
    await host().getByRole('dialog').waitFor({state:'visible'});
    const focus=()=>host().evaluate(host=>{const active=host.shadowRoot.activeElement;return {inside:!!active?.closest('[data-employee-module-portal]'),tag:active?.tagName,placeholder:active?.getAttribute('placeholder'),html:active?.outerHTML.slice(0,500),documentActive:document.activeElement?.tagName,portals:host.shadowRoot.querySelectorAll('[data-employee-module-portal]').length};});
    await input.fill('QA Web Pano');
    report.modalFocus=[await focus()];
    for(let i=0;i<4;i++){await page.keyboard.press('Tab');const current=await focus();report.modalFocus.push(current);check(current.inside,true,'Modal tab focus remains in the module portal');}
    const during=await metrics();check(during.height,before.height,'Modal does not resize the document behind it');
    await page.keyboard.press('Escape');await input.waitFor({state:'hidden'});
    check(await host().getByText('Yeni Pano',{exact:true}).isVisible(),true,'Modal dismiss restores the workspace');
    await host().getByText('Yeni Pano',{exact:true}).click();await host().getByRole('dialog').waitFor({state:'visible'});await input.fill('QA Web Pano');await host().getByText('Oluştur',{exact:true}).click();
    await host().getByPlaceholder('Pano adı',{exact:true}).waitFor();await settle();
    check(await host().getByPlaceholder('Pano adı',{exact:true}).inputValue(),'QA Web Pano','Created board is visible in its actual title field');
    const board=await metrics();report.documentLayouts.push({name:'board-list',...before},{name:'board-detail',...board});
    check(board.mode,'workspace','Actual kanban board retains workspace sizing');
    check(board.property,'','Actual board uses the bounded host fallback');
    await page.screenshot({path:path.join(output,'board-web-workspace.png')});
  });
};

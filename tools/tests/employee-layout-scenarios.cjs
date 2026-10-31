'use strict';

// Exercise the shipped portal and its embedded roots with disposable PHP data.
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function employeeLayouts({page, mount, workflow, check, report, output, base, modules, catalog, widths}) {
  report.layouts = [];
  async function ready(route) {
    if (!route) return;
    await page.locator('[data-employee-native-module][data-module-route="'+route+'"]').waitFor({state:'visible',timeout:60000});
    await page.getByText('Modül yükleniyor…',{exact:true}).waitFor({state:'hidden',timeout:60000});
    await page.waitForFunction(() => !!document.querySelector('[data-employee-module-host]')?.shadowRoot?.querySelector('[data-vg-module-root]'), null, {timeout:60000});
  }
  async function inspect(id, variant, width) {
    const metrics = await page.evaluate(() => {
      const workspace = document.querySelector('#vg-company-workspace');
      const elements = [];
      function collect(root) { for (const node of root.querySelectorAll('*')) { elements.push(node); if (node.shadowRoot) collect(node.shadowRoot); } }
      collect(workspace);
      const visible = node => {
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && !node.closest('[hidden],[aria-hidden="true"]');
      };
      const findings = [];
      for (const node of elements) {
        if (!node.matches('button,input,select,textarea,[role="button"]') || !visible(node)) continue;
        if (node.closest('.overflow-x-auto,.overflow-auto,.overflow-x-scroll,#printable-paper,.pdf-page')) continue;
        const rect = node.getBoundingClientRect();
        const host = node.getRootNode().host;
        const bounds = host ? host.getBoundingClientRect() : {left:0,right:innerWidth};
        const label = (node.getAttribute('aria-label') || node.textContent || node.getAttribute('placeholder') || node.tagName).trim().replace(/\s+/g,' ').slice(0,100);
        let scroller = node.parentElement;
        while (scroller && !(['auto','scroll'].includes(getComputedStyle(scroller).overflowX) && scroller.scrollWidth > scroller.clientWidth + 3)) scroller = scroller.parentElement;
        if (!scroller && (rect.left < bounds.left - 2 || rect.right > bounds.right + 2)) findings.push({kind:'control-outside',label,left:Math.round(rect.left),right:Math.round(rect.right)});
        if (node.matches('input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=range]):not([type=hidden]),select,textarea') && rect.width < 40) findings.push({kind:'collapsed-field',label,width:Math.round(rect.width),parentWidth:Math.round(node.parentElement.getBoundingClientRect().width)});
        if (node.matches('button') && getComputedStyle(node).textOverflow !== 'ellipsis' && (node.scrollWidth > node.clientWidth + 3 || node.scrollHeight > node.clientHeight + 3)) findings.push({kind:'button-text-clipped',label,width:node.clientWidth,content:node.scrollWidth,height:node.clientHeight,contentHeight:node.scrollHeight});
      }
      const hubCards=elements.filter(node=>node.matches('[data-testid="site-hub-card"],[data-testid="site-hub-row"]')&&visible(node));
      const webCards=hubCards.map(node=>{
        const title=node.querySelector('[data-testid="site-hub-title"]'),description=node.querySelector('[data-testid="site-hub-description"]');
        const icon=node.querySelector('[data-testid="site-hub-icon"]');
        const glyph=icon&&[icon,...icon.querySelectorAll('*')].find(child=>!child.childElementCount&&/[\ue000-\uf8ff]/.test(child.textContent));
        return {title:title?.textContent,titleFont:title&&getComputedStyle(title).fontFamily,descriptionFont:description&&getComputedStyle(description).fontFamily,background:getComputedStyle(node).backgroundColor,iconFont:glyph&&getComputedStyle(glyph).fontFamily};
      });
      for(const card of webCards){
        if(!/Outfit/.test(card.titleFont||''))findings.push({kind:'hub-title-font',...card});
        if(card.descriptionFont&&!/Inter/.test(card.descriptionFont))findings.push({kind:'hub-body-font',...card});
        if(card.iconFont&&/Inter|Outfit/.test(card.iconFont))findings.push({kind:'icon-font-overridden',...card});
      }
      const nativeHost=workspace.querySelector('[data-employee-module-host]');
      return {viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,findings,webCards,moduleLayout:nativeHost?.dataset.moduleLayout};
    });
    report.layouts.push({id,variant,width,...metrics});
    if (metrics.findings.length || metrics.pageWidth > width + 2) {
      const target = path.join(output,`layout-${id}-${variant||'default'}-${width}.png`);
      await page.screenshot({path:target,fullPage:true});
      throw Error(JSON.stringify(metrics));
    }
    check(metrics.findings.length,0,'Visible controls and their labels fit the available layout');
    check(metrics.pageWidth <= width + 2,true,'Portal fits viewport');
  }
  for (const width of widths) {
    await page.setViewportSize({width,height:1000});
    for (const id of modules) {
      const item = catalog.modules.find(item => item.id === id);
      const variants = item?.variants?.length ? item.variants : [{id:'default'}];
      for (const variant of variants) await workflow(`layout:${id}:${variant.id}:${width}`,async () => {
        const query = new URLSearchParams({module:id});
        if (variant.id !== variants[0].id) query.set('bolum',variant.id);
        await page.goto(base+'/calisan/uygulama/?'+query,{waitUntil:'domcontentloaded'});
        await page.locator('[data-portal-module="'+id+'"]').waitFor({state:'visible'});
        await ready(variant.route);
        await page.waitForLoadState('networkidle');
        await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
        await inspect(id,variant.id,width);
        if(id==='stok'){
          const host=page.locator('[data-employee-module-host]');
          await page.waitForFunction(()=>document.querySelector('[data-employee-module-host]')?.dataset.moduleLayout==='document');
          const overview=await host.evaluate(node=>({text:node.shadowRoot.querySelector('[data-vg-module-root]').innerText,scrollers:[...node.shadowRoot.querySelectorAll('div')].filter(child=>{const style=getComputedStyle(child),rect=child.getBoundingClientRect();return rect.width>=node.clientWidth*.85&&['auto','scroll'].includes(style.overflowY)&&child.scrollHeight>child.clientHeight+3;}).length}));
          check(/POZ-(?:DEV|CAT)-|\bCRUD\b/.test(overview.text),false,'Stock overview contains business language without development labels');
          check(overview.scrollers,0,'Stock overview participates in the site document without a phone viewport scrollbar');
          await page.screenshot({path:path.join(output,`stock-site-${width}.png`),fullPage:true});
        }
        if (id === 'manual') {
          const target = path.join(output,`manual-fixed-${width}.png`);
          await page.locator('.portal-quote-footer__actions').scrollIntoViewIfNeeded();
          await page.screenshot({path:target});
          await page.locator('.portal-app > header button').click();
          await inspect(id,'parameters',width);
        }
      });
    }
    fs.writeFileSync(path.join(output,'layout-report.json'),JSON.stringify(report.layouts,null,2));
  }
};

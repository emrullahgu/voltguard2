'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const inventory=require('./employee-screen-inventory.cjs');

// Observe the existing public runtime. Forward navigation uses enabled catalogue
// entries and visible controls, never a replacement navigator or synthetic DOM.
module.exports=async function({page,admin,api,check,report,output,base}){
  const source=inventory(),normalize=source.normalize;
  report.recordCoverage={runId:process.argv.find(x=>x.startsWith('--record-run-id='))?.slice(16)||crypto.randomUUID(),isolated:true,startedAt:new Date().toISOString(),runtimeScripts:JSON.parse(fs.readFileSync(path.join(__dirname,'../../calisan/uygulama/employee-modules-manifest.json'),'utf8')).scripts,screens:[],entries:[],steps:[]};
  const save=()=>fs.writeFileSync(path.join(output,'record-report.json'),JSON.stringify(report.recordCoverage,null,2));
  report.recordCoverage.attempt=Number(process.argv.find(x=>x.startsWith('--record-attempt='))?.slice(17)||1);
  await page.addInitScript(()=>{
    let value;window.__vgRecords={events:[]};
    Object.defineProperty(window,'VoltGuardEmployeeModules',{configurable:true,get:()=>value,set:runtime=>{
      value=Object.freeze({...runtime,mount:async(host,options)=>{
        const controller=await runtime.mount(host,{...options,onEvent:event=>{
          if(event.type==='vg:saha-route')window.__vgRecords.events.push({route:event.route,paramKeys:Object.keys(event.params||{})});
          options.onEvent?.(event);
        }});window.__vgRecords.controller=controller;return controller;
      }});
    }});
  });
  const host=()=>page.locator('[data-employee-module-host]');
  async function settle(route){
    route=normalize(route);
    await page.getByText('Modül yükleniyor…',{exact:true}).waitFor({state:'hidden',timeout:60000});
    await page.waitForFunction(route=>window.__vgRecords?.events.at(-1)?.route===route,route,{timeout:20000});
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(()=>!window.__vgRecords?.controller||window.__vgRecords.controller.getWriteStatus().pending===0,null,{timeout:30000});
    await page.waitForFunction(()=>{
      const text=document.querySelector('[data-employee-module-host]')?.shadowRoot?.querySelector('[data-vg-module-root]')?.innerText.trim();
      const first=text?.split('\n').map(line=>line.trim()).find(Boolean);
      return !!text&&!/^(Yükleniyor[.…]*|Hazırlanıyor[.…]*)$/.test(first);
    },null,{timeout:15000});
    await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  }
  async function open(route){
    route=normalize(route);
    const entry=source.entries.find(entry=>entry.enabled&&entry.route===route);
    if(!entry)throw Error('Not an enabled catalogue entry: '+route+'; use visible navigation controls.');
    const query=new URLSearchParams({module:entry.module,bolum:entry.section});
    await page.goto(base+'/calisan/uygulama/?'+query,{waitUntil:'domcontentloaded'});
    await settle(route);report.recordCoverage.entries.push({...entry});save();
  }
  async function click(label,route){
    const title=page.getByTestId('site-hub-title').filter({hasText:new RegExp('^'+label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')});
    const card=host().locator('[data-testid="site-hub-card"]:visible,[data-testid="site-hub-row"]:visible').filter({has:title});
    if(await card.count()===1)await card.click();
    else await host().getByText(label,{exact:true}).filter({visible:true}).first().click();
    await settle(route);report.recordCoverage.steps.push({label,route:normalize(route)});save();
  }
  async function back(route){
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){
      // Read the write status and invoke back in the same browser turn. Startup
      // cache writes may begin between two separate automation commands.
      const outcome=await page.evaluate(()=>{
        const controller=window.__vgRecords.controller;
        if(controller.getWriteStatus().pending>0)return 'pending';
        try{controller.goBack();return 'returned';}
        catch(error){if(/Kayıt isteğinin tamamlanmasını bekleyin/.test(error.message))return 'pending';throw error;}
      });
      if(outcome==='returned'){await settle(route);return;}
      await page.waitForTimeout(100);
    }
    throw Error('Navigation waited 30 seconds for pending writes: '+route);
  }
  async function inspect(route){
    route=normalize(route);await settle(route);
    const metrics=await host().evaluate(host=>{
      const root=host.shadowRoot?.querySelector('[data-vg-module-root]');
      const text=root?.innerText.trim()||'';
      const alerts=[...root?.querySelectorAll('[role="alert"]')||[]].filter(node=>node.getBoundingClientRect().width>0).map(node=>node.textContent.trim().slice(0,500));
      return {text:text.slice(0,280),alerts,state:alerts.length?'reported-error':'rendered',errorBoundary:/Uygulama kararsız bir duruma girdi|Beklenmedik bir hata oluştu/.test(text),pageWidth:document.documentElement.scrollWidth,viewport:innerWidth};
    });
    check(metrics.text.length>0,true,'Record screen has readable rendered content: '+route);
    check(metrics.errorBoundary,false,'Record screen avoids ErrorBoundary: '+route);
    check(metrics.pageWidth<=metrics.viewport+2,true,'Record screen fits viewport: '+route);
    check(report.pageErrors.length,0,'Record workflow has no uncaught browser error: '+route);
    check(report.consoleErrors.length,0,'Record workflow has no unexpected console error: '+route);
    check(report.apiErrors.length,0,'Record workflow has no failed API request: '+route);
    const event=await page.evaluate(()=>window.__vgRecords.events.at(-1));
    report.recordCoverage.screens.push({route,paramKeys:event.paramKeys,...metrics});save();return metrics;
  }
  const rpc=async(name,args)=>(await api(admin,'company','rpc',{name,args})).data;
  async function seed(table,rows){
    const result=await rpc('app_saha_query',{table,operation:'insert',select:'*',rows:Array.isArray(rows)?rows:[rows],filters:[],order:[],returning:true,single:null});
    return result.data;
  }
  async function cache(key,value){
    const current=await rpc('app_saha_cache',{operation:'get',key});
    return rpc('app_saha_cache',{operation:'set',key,value:JSON.stringify(value),...(current.shared?{revision:current.revision}:{})});
  }
  async function expectedConflict(response,before,description){
    check(response.status(),409,description+' returns the deliberately injected conflict');
    const payload=await response.json();check(payload.error,'PT409',description+' keeps the expected revision code');
    const requestKey=crypto.createHash('sha256').update(response.request().postData()||'').digest('hex');
    const deadline=Date.now()+3000;
    while(Date.now()<deadline&&!report.apiErrors.some(x=>x.requestKey===requestKey))await page.waitForTimeout(25);
    const errors=report.apiErrors.slice(before.api);
    check(errors.length,1,description+' has exactly one attributable API failure');
    const error=errors[0];check(error.requestKey,requestKey,description+' matches the exact rejected request');
    await page.waitForTimeout(100);
    const resources=report.consoleErrors.slice(before.console).filter(x=>x.phase===error.phase&&x.url===response.url()&&x.message==='Failed to load resource: the server responded with a status of 409 (Conflict)');
    check(resources.length<=1,true,description+' has at most one corresponding resource console event');
    (report.expectedApiErrors||=[]).push({...error,description,consoleErrors:resources});
    report.apiErrors.splice(report.apiErrors.indexOf(error),1);
    for(const item of resources)report.consoleErrors.splice(report.consoleErrors.indexOf(item),1);
  }
  save();return {host,open,click,inspect,settle,back,seed,cache,rpc,source,save,expectedConflict};
};

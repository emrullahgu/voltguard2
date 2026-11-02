'use strict';
const fs=require('node:fs'),path=require('node:path');
const inventory=require('./employee-screen-inventory.cjs');

module.exports=async function nestedScreens({page,workflow,check,report,output,base,modules}){
  const source=inventory(),routeMap=new Map(source.routes.map(route=>[route.route,route]));
  const entries=source.entries.filter(entry=>entry.enabled&&modules.includes(entry.module));
  const queued=new Set(entries.map(entry=>entry.route)),queue=entries.map(entry=>({...entry,steps:[]}));
  const limit=Number(process.argv.find(arg=>arg.startsWith('--nested-max-cards='))?.split('=')[1]||0);
  const runId=process.argv.find(arg=>arg.startsWith('--nested-run-id='))?.slice(16)||null;
  const runtimeScripts=JSON.parse(fs.readFileSync(path.join(__dirname,'../../calisan/uygulama/employee-modules-manifest.json'),'utf8')).scripts;
  report.nested={runId,runtimeScripts,viewport:1440,identity:'synthetic administrator',catalogueEntries:entries,routeInventory:source.routes.map(({route,source,parameters,catalogueEntry})=>({route,source,parameters,catalogueEntry})),parents:[],edges:[],screens:[],skips:[],automaticWrites:[],scanFinished:false};
  const flush=()=>fs.writeFileSync(path.join(output,'nested-report.json'),JSON.stringify(report.nested,null,2));
  // Observe the public runtime's normal route events without changing its entry gate or navigator.
  await page.addInitScript(()=>{
    let value;window.__vgNested={events:[]};
    Object.defineProperty(window,'VoltGuardEmployeeModules',{configurable:true,get:()=>value,set:runtime=>{
      value=Object.freeze({...runtime,mount:async(host,options)=>{
        const controller=await runtime.mount(host,{...options,onEvent:event=>{
          if(event.type==='vg:saha-route')window.__vgNested.events.push({route:event.route,paramKeys:Object.keys(event.params||{})});
          options.onEvent?.(event);
        }});
        window.__vgNested.controller=controller;return controller;
      }});
    }});
  });
  await page.route('**/api/company.php?**',async route=>{
    let input;try{input=route.request().postDataJSON();}catch{}
    const name=input?.name,args=input?.args||{},operation=args.operation;
    const mutation=name==='app_saha_query'&&operation!=='select'||name==='app_saha_cache'&&['set','remove','clear'].includes(operation)||name==='app_saha_storage'&&['upload','remove'].includes(operation)||name==='app_saha_rpc'&&['visit_check_in','visit_check_out','run_due_templates','kvkk_erase_user','set_user_approval','set_user_role'].includes(args.name);
    // Normal startup persists preferences and checks recurring jobs. This is the real API,
    // backed by the caller's disposable empty dataset; never stub a successful response.
    if(mutation)report.nested.automaticWrites.push({name,operation,source:args.name,key:args.key,table:args.table});
    await route.continue();
  });
  await page.setViewportSize({width:1440,height:1050});
  const host=()=>page.locator('[data-employee-module-host]');
  async function settle(expected){
    await page.getByText('Modül yükleniyor…',{exact:true}).waitFor({state:'hidden',timeout:60000});
    await page.waitForFunction(expected=>window.__vgNested?.events.at(-1)?.route===expected,expected,{timeout:20000});
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(()=>!window.__vgNested?.controller||window.__vgNested.controller.getWriteStatus().pending===0,null,{timeout:30000});
    // Some screens initially render only a spinner while their read effects settle.
    await page.waitForFunction(()=>!!document.querySelector('[data-employee-module-host]')?.shadowRoot?.querySelector('[data-vg-module-root]')?.innerText.trim(),null,{timeout:15000});
    await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  }
  async function clickCard(label){
    const cards=host().locator('[data-testid="site-hub-card"]:visible,[data-testid="site-hub-row"]:visible');
    const title=page.getByTestId('site-hub-title').filter({hasText:new RegExp('^'+label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')});
    const card=cards.filter({has:title});
    check(await card.count(),1,'One visible navigation card matches its source label: '+label);
    await card.click();
  }
  let currentParentKey=null;
  async function openParent(parent){
    const key=parent.module+'/'+parent.section+'/'+parent.steps.map(step=>step.route).join('/');
    if(key===currentParentKey){
      await page.waitForFunction(()=>!window.__vgNested?.controller||window.__vgNested.controller.getWriteStatus().pending===0,null,{timeout:30000});
      const current=await page.evaluate(()=>window.__vgNested?.events.at(-1)?.route);
      if(current===parent.route){await settle(parent.route);return;}
      // Status can change between two browser commands. Check it and call the
      // public back method in the same browser turn; retry its normal save guard.
      const deadline=Date.now()+30000;let returned=false;
      do{
        const outcome=await page.evaluate(()=>{
          const controller=window.__vgNested?.controller;
          if(!controller?.canGoBack())return 'unavailable';
          if(controller.getWriteStatus().pending>0)return 'pending';
          try{controller.goBack();return 'returned';}
          catch(error){if(/Kayıt isteğinin tamamlanmasını bekleyin/.test(error.message))return 'pending';throw error;}
        });
        if(outcome==='returned'){returned=true;break;}
        if(outcome==='unavailable')break;
        await page.waitForTimeout(100);
      }while(Date.now()<deadline);
      if(returned){await settle(parent.route);return;}
    }
    const query=new URLSearchParams({module:parent.module,bolum:parent.section});
    await page.goto(base+'/calisan/uygulama/?'+query,{waitUntil:'domcontentloaded'});
    await settle(source.entries.find(entry=>entry.module===parent.module&&entry.section===parent.section).route);
    for(const step of parent.steps){await clickCard(step.label);await settle(step.route);}
    currentParentKey=key;
  }
  async function inspect(route){
    const metrics=await host().evaluate(host=>{
      const root=host.shadowRoot?.querySelector('[data-vg-module-root]');
      if(!root)return {text:'',title:'',cards:[],errorBoundary:false,pageWidth:document.documentElement.scrollWidth};
      const visible=node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0&&!node.closest('[aria-hidden="true"],[hidden]')&&getComputedStyle(node).visibility!=='hidden';};
      const text=root.innerText.trim();
      const headings=[...root.querySelectorAll('[role="heading"],h1,h2,h3')].filter(visible).map(node=>node.textContent.trim()).filter(Boolean);
      const cards=[...root.querySelectorAll('[data-testid="site-hub-card"],[data-testid="site-hub-row"]')].filter(visible).map(node=>node.querySelector('[data-testid="site-hub-title"]')?.textContent.trim()).filter(Boolean);
      const alerts=[...root.querySelectorAll('[role="alert"]')].filter(visible).map(node=>node.textContent.trim().slice(0,500));
      return {text:text.slice(0,220),title:headings[0]||text.split('\n').find(line=>line.trim()&&!/^[\ue000-\uf8ff]+$/.test(line.trim()))||'',cards,alerts,state:alerts.length?'reported-error':'rendered',errorBoundary:/Uygulama kararsız bir duruma girdi|Beklenmedik bir hata oluştu/.test(text),pageWidth:document.documentElement.scrollWidth};
    });
    check(metrics.text.length>0,true,'Nested screen renders readable content: '+route);
    check(metrics.title.trim().length>0,true,'Nested screen exposes a visible title or leading label: '+route);
    check(metrics.errorBoundary,false,'Nested screen does not fall into ErrorBoundary: '+route);
    check(metrics.pageWidth<=1442,true,'Nested screen fits desktop viewport: '+route);
    return metrics;
  }
  while(queue.length){
    const parent=queue.shift();let labels=[];
    await workflow('nested-parent:'+parent.route,async()=>{
      const errors={api:report.apiErrors.length,page:report.pageErrors.length,console:report.consoleErrors.length};
      await openParent(parent);const metrics=await inspect(parent.route);labels=metrics.cards;
      check(report.pageErrors.length,errors.page,'Parent screen causes no uncaught browser error');
      check(report.consoleErrors.length,errors.console,'Parent screen causes no console error');
      check(report.apiErrors.length,errors.api,'Parent screen causes no failed private API read');
      report.nested.parents.push({route:parent.route,title:metrics.title,state:metrics.state,alerts:metrics.alerts,path:parent.steps});
    });
    for(const label of labels){
      const target=routeMap.get(parent.route)?.cards.find(card=>card.label===label);
      if(!target){report.nested.skips.push({from:parent.route,label,reason:'Navigation destination is not statically classified; no arbitrary button clicked.'});continue;}
      const meta=routeMap.get(target.route);
      if(meta.parameters?.required){report.nested.skips.push({from:parent.route,label,route:target.route,reason:'Requires natural route parameters or a synthetic detail fixture.',fields:meta.parameters.fields});continue;}
      if(/Scanner|Scan$|Nfc|VoiceNote|VisionScanner/.test(target.route)){report.nested.skips.push({from:parent.route,label,route:target.route,reason:'Requires a camera, NFC or microphone device.'});continue;}
      if(limit&&report.nested.edges.length>=limit){report.nested.skips.push({from:parent.route,label,route:target.route,reason:'Explicit smoke sample limit reached.'});continue;}
      const edge={from:parent.route,label,route:target.route,path:[...parent.steps,target],ok:false};report.nested.edges.push(edge);
      await workflow('nested-card:'+parent.route+':'+target.route,async()=>{
        const errors={api:report.apiErrors.length,page:report.pageErrors.length,console:report.consoleErrors.length};
        await openParent(parent);await clickCard(label);await settle(target.route);
        const metrics=await inspect(target.route);edge.title=metrics.title;edge.content=metrics.text;edge.cards=metrics.cards.length;edge.state=metrics.state;edge.alerts=metrics.alerts;
        check(report.pageErrors.length,errors.page,'Nested card causes no uncaught browser error');
        check(report.consoleErrors.length,errors.console,'Nested card causes no console error');
        check(report.apiErrors.length,errors.api,'Nested card causes no failed private API read');
        edge.ok=true;report.nested.screens.push({route:target.route,title:metrics.title,state:metrics.state,alerts:metrics.alerts,from:parent.route});
        if(metrics.cards.length&&!queued.has(target.route)){queued.add(target.route);queue.push({...parent,route:target.route,steps:[...parent.steps,target]});}
      });
      if(!edge.ok)currentParentKey=null;
      flush();
    }
    flush();
  }
  const visited=new Set([...report.nested.parents.map(screen=>screen.route),...report.nested.screens.map(screen=>screen.route)]);
  report.nested.unvisited=source.routes.filter(route=>!visited.has(route.route)).map(({route,source,parameters,catalogueEntry})=>({route,source,parameters,catalogueEntry,reason:parameters?.required?'Requires a natural detail fixture.':'No verified visible hub-card path was exercised in this module group.'}));
  report.nested.summary={registeredNames:source.registeredNames,canonicalRoutes:source.routes.length,selectedCatalogueEntries:entries.length,clickedCards:report.nested.edges.length,passedCards:report.nested.edges.filter(edge=>edge.ok).length,uniquePassedScreens:visited.size,uniquePassedTargets:new Set(report.nested.screens.map(screen=>screen.route)).size,skippedCards:report.nested.skips.length};
  report.nested.scanFinished=!limit;flush();
};

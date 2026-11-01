'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');

// Exercise the published runtime lifecycle with two real synthetic MFA accounts.
// Delay a successful server read, unmount normally, switch the browser cookie,
// and mount an allowed entry for the second employee. No private exports or
// replacement API successes are used.
module.exports=async function({page,admin,employee,api,workflow,check,report,ui,base}){
  await workflow('deep-session-delayed-private-read',async()=>{
    const bootstrap=async who=>(await api(who,'company','rpc',{name:'app_saha_bootstrap',args:{}})).data;
    const a=await bootstrap(admin),b=await bootstrap(employee),stamp=new Date().toISOString();
    const secret='QA Önceki Hesabın Özel Bildirimi',current='QA Yeni Hesabın Özel Bildirimi';
    await ui.seed('notifications',[
      {id:randomUUID(),user_id:a.user.id,type:'custom',title:secret,message:'Yalnız önceki sentetik çalışana ait veri.',channels:[],read:false,created_at:stamp},
      {id:randomUUID(),user_id:b.user.id,type:'custom',title:current,message:'Yalnız yeni sentetik çalışana ait veri.',channels:[],read:false,created_at:stamp},
    ]);
    await ui.open('NotificationHub');
    let release,heldResolve,intercepted=false,heldResponse;
    const held=new Promise(resolve=>{heldResolve=resolve;}),gate=new Promise(resolve=>{release=resolve;});
    const matches=request=>{try{const value=request.postDataJSON();return value?.name==='app_saha_query'&&value.args?.table==='notifications'&&value.args.operation==='select';}catch{return false;}};
    const hold=async route=>{
      if(!intercepted&&matches(route.request())){
        intercepted=true;heldResponse=await route.fetch();heldResolve();await gate;await route.fulfill({response:heldResponse});
      }else await route.continue();
    };
    await page.route('**/api/company.php?action=rpc',hold);
    try{
      await ui.host().getByText('Bildirim Akışı',{exact:true}).filter({visible:true}).click();
      await Promise.race([held,new Promise((_,reject)=>setTimeout(()=>reject(Error('The real previous-employee read was not captured')),15000))]);
      const body=await heldResponse.json();check(body.data.data.some(row=>row.title===secret),true,'Held server response actually contains the previous employee private notification');
      // Unmount permits pending reads while retaining its normal write guard.
      await page.waitForFunction(()=>window.__vgRecords.controller.unmount());
      check(await ui.host().locator('[data-vg-module-root]').count(),0,'Public runtime unmount resets memory without bypassing pending writes');
      await page.context().addCookies([...employee.cookies].filter(([name])=>name==='VGSTAFF').map(([name,value])=>({name,value,url:base,httpOnly:true,sameSite:'Strict'})));
      const styles=JSON.parse(fs.readFileSync(path.join(__dirname,'../../calisan/uygulama/employee-modules-manifest.json'),'utf8')).styles;
      await page.evaluate(async styles=>{await window.VoltGuardEmployeeModules.mount(document.querySelector('[data-employee-module-host]'),{route:'NotificationHub',styles});},styles);
      await ui.settle('NotificationHub');await ui.click('Bildirim Akışı','Notifications');
      await ui.host().getByText(current,{exact:true}).filter({visible:true}).waitFor({state:'visible'});
      const oldCompleted=page.waitForResponse(response=>matches(response.request())&&response.status()===200&&response.request().postDataJSON().args.filters?.some(filter=>filter.field==='user_id'&&filter.value===a.user.id));
      release();await oldCompleted;await page.waitForLoadState('networkidle');
      await page.waitForFunction(()=>window.__vgRecords.controller.getWriteStatus().pending===0);
      const cache=async()=>(await api(employee,'company','rpc',{name:'app_saha_cache',args:{operation:'get',key:'@SahaTakip:notifications'}})).data;
      // Wait for the old async continuation as well as the visible current UI.
      await page.waitForTimeout(150);
      const stored=JSON.parse((await cache()).value||'[]');
      check(stored.some(row=>row.title===secret),false,'A delayed previous-employee response never contaminates the new employee private cache');
      check(stored.some(row=>row.title===current),true,'Current employee private cache retains its own confirmed notification');
      check(await ui.host().getByText(secret,{exact:true}).filter({visible:true}).count(),0,'Current employee UI never shows the old private notification');
      await ui.inspect('Notifications');
      report.sessionBoundary={lifecycle:'Public unmount/remount with a real synthetic staff cookie switch',oldResponseHeld:true,oldResponseContainsPrivateData:true,currentAccountCacheIsolated:true,oldResponseStatus:heldResponse.status()};
    }finally{
      release();await page.unroute('**/api/company.php?action=rpc',hold);
      await page.context().addCookies([...admin.cookies].filter(([name])=>name==='VGSTAFF').map(([name,value])=>({name,value,url:base,httpOnly:true,sameSite:'Strict'})));
    }
  });
};

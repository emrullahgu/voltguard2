'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const inventory=require('./employee-screen-inventory.cjs');
const root=path.resolve(__dirname,'../..'),output=path.join(root,'.qa/employee-nested');
const runId=randomUUID();
const source=inventory(),enabled=source.entries.filter(entry=>entry.enabled);
const requested=process.argv.find(arg=>arg.startsWith('--modules='))?.slice(10).split(',');
const modules=requested||[...new Set(enabled.map(entry=>entry.module))];
for(const module of modules)if(!enabled.some(entry=>entry.module===module))throw Error('No enabled native entry for module: '+module);
const groups=[];let current=[],weight=0;
for(const module of modules){const count=enabled.filter(entry=>entry.module===module).length;if(current.length&&(weight+count>6||current.length>=4)){groups.push(current);current=[];weight=0;}current.push(module);weight+=count;}
if(current.length)groups.push(current);
fs.mkdirSync(output,{recursive:true});
const jobs=groups.map((modules,index)=>({id:'group-'+String(index+1).padStart(2,'0'),modules})),results=[];
const selectedGroups=process.argv.find(arg=>arg.startsWith('--groups='))?.slice(9).split(',');
const rerunFailed=process.argv.includes('--rerun-failed');
const readReport=(id,name)=>{const file=path.join(output,id,name);return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;};
for(let index=jobs.length-1;index>=0;index--){
  const job=jobs[index],full=readReport(job.id,'report.json'),report=readReport(job.id,'nested-report.json');
  const passed=full&&report?.summary&&['findings','apiErrors','pageErrors','consoleErrors'].every(key=>full[key]?.length===0);
  if(selectedGroups&&!selectedGroups.includes(job.id)||rerunFailed&&passed){
    if(!full||!report?.summary)throw Error('Cannot reuse a missing completed group report: '+job.id);
    results.push({...job,previousRun:true,code:passed?0:1,report,findings:full.findings||[],apiErrors:full.apiErrors||[],pageErrors:full.pageErrors||[],consoleErrors:full.consoleErrors||[]});
    jobs.splice(index,1);
  }
}
const maxCards=process.argv.find(arg=>arg.startsWith('--nested-max-cards='));
function save(){
  const screens=new Set(results.flatMap(result=>[...(result.report?.parents||[]),...(result.report?.screens||[])].map(screen=>screen.route)));
  const nestedScreens=[...screens].filter(route=>!source.routes.find(item=>item.route===route)?.catalogueEntry);
  const edges=results.flatMap(result=>result.report?.edges||[]),skips=results.flatMap(result=>result.report?.skips||[]);
  const reportedStates=[...new Map(results.flatMap(result=>[...(result.report?.parents||[]),...(result.report?.screens||[])]).filter(screen=>screen.state==='reported-error').map(screen=>[screen.route,{route:screen.route,state:screen.state,alerts:screen.alerts}])).values()];
  const unvisited=source.routes.filter(route=>!screens.has(route.route)).map(({route,source,parameters,catalogueEntry})=>({route,source,parameters,catalogueEntry,reason:parameters?.required?'Needs a natural record/detail fixture.':'No successful visible navigation-card smoke in this run.'}));
  const summary={runId,isolated:true,identity:'Synthetic administrator',viewport:1440,expectedCanonicalRoutes:source.routes.length,catalogueNativeEntries:source.entries.length,groupsFinished:results.length,groupsExpected:groups.length,clickedCards:edges.length,passedCards:edges.filter(edge=>edge.ok).length,uniquePassedScreens:screens.size,uniquePassedNestedScreens:nestedScreens.length,unvisitedScreens:unvisited.length,explicitCardSkips:skips.length,allConfiguredGroupsPassed:results.length===groups.length&&results.every(result=>result.code===0),allGroupsFresh:results.length===groups.length&&results.every(result=>!result.previousRun&&result.report?.runId===runId&&result.report?.scanFinished===true),coverageComplete:screens.size===source.routes.length};
  fs.writeFileSync(path.join(output,'coverage-report.json'),JSON.stringify({summary,reportedStates,passedRoutes:[...screens].sort(),passedNestedRoutes:nestedScreens.sort(),skips,unvisited,groups:results.map(result=>({id:result.id,modules:result.modules,runId:result.report?.runId,runtimeScripts:result.report?.runtimeScripts,previousRun:!!result.previousRun,code:result.code,summary:result.report?.summary,findings:result.findings,apiErrors:result.apiErrors,pageErrors:result.pageErrors,consoleErrors:result.consoleErrors}))},null,2));
  return summary;
}
async function worker(){
  while(jobs.length){
    const job=jobs.shift(),log=fs.openSync(path.join(output,job.id+'.log'),'w');
    const directory=path.join(output,job.id);fs.mkdirSync(directory,{recursive:true});
    // A crashed fresh worker must never inherit a successful earlier JSON report.
    for(const name of ['report.json','nested-report.json']){const file=path.join(directory,name);if(fs.existsSync(file))fs.unlinkSync(file);}
    const child=spawn(process.execPath,[path.join(__dirname,'company-real-browser.cjs'),'--nested-only','--nested-group='+job.id,'--nested-run-id='+runId,'--modules='+job.modules.join(','),...(maxCards?[maxCards]:[])],{cwd:root,windowsHide:true,stdio:['ignore',log,log]});
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});fs.closeSync(log);
    const read=name=>fs.existsSync(path.join(directory,name))?JSON.parse(fs.readFileSync(path.join(directory,name),'utf8')):{};
    const report=read('nested-report.json'),full=read('report.json');
    results.push({...job,code,report,findings:full.findings||[],apiErrors:full.apiErrors||[],pageErrors:full.pageErrors||[],consoleErrors:full.consoleErrors||[]});
    console.log(JSON.stringify({group:job.id,modules:job.modules,code,summary:report.summary,progress:save()}));
  }
}
Promise.all([worker(),worker()]).then(()=>{const summary=save();console.log(JSON.stringify(summary));if(!summary.allConfiguredGroupsPassed)process.exitCode=1;}).catch(error=>{console.error(error);process.exitCode=1;});

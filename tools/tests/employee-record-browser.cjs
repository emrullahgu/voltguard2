'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),directory=path.join(root,'.qa/employee-records');
const suites=['field','commerce','office','capability'];let runId=crypto.randomUUID();
const manifest=()=>JSON.parse(fs.readFileSync(path.join(root,'calisan/uygulama/employee-modules-manifest.json'),'utf8'));
const runtime=()=>manifest().scripts.map(script=>({script,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,script))).digest('hex')}));
const initial=runtime(),results=[];
const read=file=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
fs.mkdirSync(directory,{recursive:true});
function summarize(){
  const inv=require('./employee-screen-inventory.cjs')(),boundaries=require('./employee-route-boundaries.cjs')();
  const nested=read(path.join(root,'.qa/employee-nested/coverage-report.json'));
  const scripts=initial.map(x=>x.script);
  const matching=report=>JSON.stringify(report?.runtimeScripts)===JSON.stringify(scripts);
  const baseFresh=!!nested?.summary?.allConfiguredGroupsPassed&&!!nested.summary.allGroupsFresh&&nested.groups.every(matching);
  const currentRoutes=new Set(baseFresh?nested.passedRoutes:[]);
  for(const result of results)if(result.code===0&&result.record?.scanFinished&&matching(result.record))for(const screen of result.record.screens)currentRoutes.add(screen.route);
  const previousRoutes=new Set(nested?.passedRoutes||[]),newlyCovered=[...currentRoutes].filter(x=>!previousRoutes.has(x));
  const unvisited=inv.routes.filter(route=>!currentRoutes.has(route.route)).map(route=>({route:route.route,source:route.source,parameters:route.parameters,boundary:boundaries.routes.find(x=>x.route===route.route)?.boundary||null}));
  const summary={runId,currentRuntime:initial,runtimeUnchanged:JSON.stringify(runtime())===JSON.stringify(initial),suitesFinished:results.length,suitesExpected:suites.length,allSuitesPassed:results.length===suites.length&&results.every(x=>x.code===0&&x.record?.scanFinished&&matching(x.record)),allSuitesFresh:results.length===suites.length&&results.every(x=>x.record?.runId===runId),nestedBaselineMatchesRuntime:baseFresh,checks:results.reduce((sum,x)=>sum+(x.report?.checks||0),0),workflows:results.reduce((sum,x)=>sum+(x.report?.workflows.length||0),0),recordScreens:new Set(results.filter(x=>x.code===0).flatMap(x=>x.record?.screens||[]).map(x=>x.route)).size,uniqueCurrentScreens:currentRoutes.size,newlyCoveredScreens:newlyCovered.length,registeredScreens:inv.routes.length,unvisitedScreens:unvisited.length,coverageComplete:currentRoutes.size===inv.routes.length};
  const output={summary,newlyCoveredRoutes:newlyCovered.sort(),passedRoutes:[...currentRoutes].sort(),unvisited,reportedStates:results.flatMap(x=>x.record?.screens||[]).filter(x=>x.state==='reported-error'),suites:results.map(x=>({suite:x.suite,code:x.code,runId:x.record?.runId,attempt:x.record?.attempt||1,startedAt:x.record?.startedAt,finishedAt:x.record?.finishedAt,checks:x.report?.checks,workflows:x.report?.workflows,expectedApiErrors:x.report?.expectedApiErrors||[],findings:x.report?.findings,pageErrors:x.report?.pageErrors,consoleErrors:x.report?.consoleErrors,apiErrors:x.report?.apiErrors,limitations:x.report?.recordLimitations||[]}))};
  fs.writeFileSync(path.join(directory,'coverage-report.json'),JSON.stringify(output,null,2));return summary;
}
if(process.argv.includes('--summarize-only')){
  for(const suite of suites){const report=read(path.join(directory,suite,'report.json')),record=read(path.join(directory,suite,'record-report.json'));if(!report||!record)throw Error('Missing completed suite: '+suite);results.push({suite,report,record,code:report.findings.length||report.pageErrors.length||report.consoleErrors.length||report.apiErrors.length?1:0});}
  const ids=new Set(results.map(x=>x.record.runId));if(ids.size!==1)throw Error('Suite run IDs do not match; run the complete record scan.');runId=[...ids][0];
  const summary=summarize();console.log(JSON.stringify(summary));
  if(!summary.allSuitesPassed||!summary.allSuitesFresh||!summary.runtimeUnchanged)process.exitCode=1;
}else{
  const jobs=[...suites];
  async function worker(){while(jobs.length){const suite=jobs.shift(),out=path.join(directory,suite);fs.mkdirSync(out,{recursive:true});
    for(const name of ['report.json','record-report.json']){const file=path.join(out,name);if(fs.existsSync(file))fs.unlinkSync(file);}
    const fd=fs.openSync(path.join(directory,suite+'.log'),'w');
    const child=spawn(process.execPath,[path.join(__dirname,'company-real-browser.cjs'),'--record-only','--record-suite='+suite,'--record-run-id='+runId],{cwd:root,windowsHide:true,stdio:['ignore',fd,fd]});
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});fs.closeSync(fd);
    results.push({suite,code,report:read(path.join(out,'report.json')),record:read(path.join(out,'record-report.json'))});
    console.log(JSON.stringify({suite,code,progress:summarize()}));
  }}
  Promise.all([worker(),worker()]).then(()=>{const summary=summarize();console.log(JSON.stringify(summary));if(!summary.allSuitesPassed||!summary.allSuitesFresh||!summary.runtimeUnchanged)process.exitCode=1;}).catch(error=>{console.error(error);process.exitCode=1;});
}

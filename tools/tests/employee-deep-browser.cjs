'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),output=path.join(root,'.qa/employee-deep');
const suites=['session','forms','operational'],jobs=[...suites],runId=crypto.randomUUID(),results=[];
fs.mkdirSync(output,{recursive:true});
function runtime(){const manifest=JSON.parse(fs.readFileSync(path.join(root,'calisan/uygulama/employee-modules-manifest.json'),'utf8'));return manifest.scripts.map(script=>({script,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,script.slice(1)))).digest('hex')}));}
const initial=runtime();
const read=file=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
function save(){
 const complete=results.length===suites.length;
 const summary={runId,isolated:true,source:'Actual compiled portal and private PHP APIs with disposable synthetic MFA accounts',runtime:initial,runtimeUnchanged:JSON.stringify(runtime())===JSON.stringify(initial),suitesFinished:results.length,suitesExpected:suites.length,
  allSuitesPassed:complete&&results.every(result=>result.code===0&&result.report?.workflows.length>0&&result.report.workflows.every(flow=>flow.ok)&&['findings','apiErrors','pageErrors','consoleErrors'].every(key=>result.report[key]?.length===0)),
  allSuitesFresh:complete&&results.every(result=>result.record?.runId===runId&&result.record.scanFinished===true&&JSON.stringify(result.record.runtimeScripts)===JSON.stringify(initial.map(item=>item.script))),
  checks:results.reduce((sum,result)=>sum+(result.report?.checks||0),0),workflows:results.reduce((sum,result)=>sum+(result.report?.workflows.length||0),0),expectedRejections:results.reduce((sum,result)=>sum+(result.report?.expectedApiErrors?.length||0),0)};
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({summary,suites:results.map(result=>({suite:result.suite,code:result.code,checks:result.report?.checks,workflows:result.report?.workflows,findings:result.report?.findings,apiErrors:result.report?.apiErrors,pageErrors:result.report?.pageErrors,consoleErrors:result.report?.consoleErrors,expectedApiErrors:result.report?.expectedApiErrors||[],sessionBoundary:result.report?.sessionBoundary,record:result.record}))},null,2));return summary;
}
async function worker(){while(jobs.length){
 const suite=jobs.shift(),directory=path.join(root,'.qa/employee-records',suite);fs.mkdirSync(directory,{recursive:true});
 for(const name of ['report.json','record-report.json']){const file=path.join(directory,name);if(fs.existsSync(file))fs.unlinkSync(file);}
 const log=fs.openSync(path.join(output,suite+'.log'),'w');
 const child=spawn(process.execPath,[path.join(__dirname,'company-real-browser.cjs'),'--record-only','--record-suite='+suite,'--record-run-id='+runId],{cwd:root,windowsHide:true,stdio:['ignore',log,log]});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});fs.closeSync(log);
 results.push({suite,code,report:read(path.join(directory,'report.json')),record:read(path.join(directory,'record-report.json'))});console.log(JSON.stringify({suite,code,progress:save()}));
}}
Promise.all([worker(),worker()]).then(()=>{const summary=save();console.log(JSON.stringify(summary));if(!summary.allSuitesPassed||!summary.allSuitesFresh||!summary.runtimeUnchanged)process.exitCode=1;}).catch(error=>{console.error(error);process.exitCode=1;});

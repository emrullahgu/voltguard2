'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname,'../..');
const output = path.join(root,'.qa/employee-layout');
fs.mkdirSync(output,{recursive:true});
const allWidths = [1440,1024,768,390,320];
const selectedWidths = process.argv.find(argument=>argument.startsWith('--widths='))?.slice(9).split(',').map(Number) || allWidths;
if (!selectedWidths.length || selectedWidths.some(width=>!allWidths.includes(width))) throw Error('Use --widths=1440,1024,768,390,320 (or a subset).');
const widths = [...new Set(selectedWidths)];
const results = [];
// Each viewport gets a separate disposable dataset and its normal rate limits.
// This keeps a full catalogue sweep from exhausting one employee's API budget.
async function worker() {
  while(widths.length) {
    const width = widths.shift();
    const log = fs.openSync(path.join(output,`${width}.log`),'w');
    const child = spawn(process.execPath,[path.join(__dirname,'company-real-browser.cjs'),'--layout-only','--layout-width='+width],{cwd:root,windowsHide:true,stdio:['ignore',log,log]});
    const code = await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    fs.closeSync(log);
    const reportPath = path.join(output,String(width),'report.json');
    const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath,'utf8')) : {};
    results.push({width,code,...report});
    console.log(JSON.stringify({width,code,layouts:report.layouts?.length,findings:report.findings?.length,apiErrors:report.apiErrors?.length,pageErrors:report.pageErrors?.length}));
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({runs:results},null,2));
  }
}
Promise.all([worker(),worker()]).then(()=>{
  const runs=allWidths.map(width=>{
    const current=results.find(result=>result.width===width);
    if(current)return current;
    const file=path.join(output,String(width),'report.json');
    if(!fs.existsSync(file))return null;
    const report=JSON.parse(fs.readFileSync(file,'utf8'));
    const passed=['findings','apiErrors','pageErrors','consoleErrors'].every(key=>report[key]?.length===0);
    return {width,code:passed?0:1,previousRun:true,...report};
  }).filter(Boolean);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({runs},null,2));
  const layouts=runs.flatMap(result=>result.layouts||[]);
  fs.writeFileSync(path.join(output,'layout-report.json'),JSON.stringify(layouts,null,2));
  console.log(JSON.stringify({viewports:runs.length,rerun:results.length,layouts:layouts.length,passed:runs.every(result=>result.code===0),report:path.join(output,'report.json')}));
  if(runs.some(result=>result.code!==0))process.exitCode=1;
}).catch(error=>{console.error(error);process.exitCode=1;});

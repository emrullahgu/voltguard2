/* Resolve SVG geometry for the pinned CC0 symbols; build-time only. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const runtime=process.env.VOLTGUARD_PLAYWRIGHT||'C:/Users/emrul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const {chromium}=require(runtime);
async function main(){
  const records=JSON.parse(fs.readFileSync(path.join(__dirname,'library-unbounded.json'),'utf8'));
  const browser=await chromium.launch({executablePath:process.env.VOLTGUARD_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent('<!doctype html><html><body><svg xmlns="http://www.w3.org/2000/svg" id="measure"></svg></body></html>');
    const result=await page.evaluate(records=>{
      const svg=document.getElementById('measure');
      return records.map(record=>{
        if(!record.viewBox){
          svg.innerHTML=record.body;
          const bbox=svg.firstElementChild.getBBox();
          if(!(bbox.width>0||bbox.height>0)||!Number.isFinite(bbox.x))throw Error('Invalid symbol bounds: '+record.id);
          const pad=Math.max(.3,Math.max(bbox.width,bbox.height)*.055);
          record.viewBox=[bbox.x-pad,bbox.y-pad,bbox.width+2*pad,bbox.height+2*pad].map(n=>Number(n.toFixed(6))).join(' ');
        }
        return record;
      });
    },records);
    fs.writeFileSync(path.join(__dirname,'library.json'),JSON.stringify(result,null,2)+'\n');
    console.log(`${result.length} symbols finalized, ${fs.statSync(path.join(__dirname,'library.json')).size} bytes`);
  }finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1});

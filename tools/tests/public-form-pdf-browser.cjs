'use strict';
// Actual public engineering-form PDF downloads. Synthetic inputs and local static files only.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),output=path.join(root,'.qa/public-form-pdf');
const modules=process.env.VG_NODE_MODULES||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=require(path.join(modules,'playwright'));
const chrome=[process.env.VG_CHROME,process.env.VOLTGUARD_CHROME,process.env.PROGRAMFILES&&path.join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),process.env['PROGRAMFILES(X86)']&&path.join(process.env['PROGRAMFILES(X86)'],'Google/Chrome/Application/chrome.exe')].filter(Boolean).find(fs.existsSync);
const forms=['ges-kesif-formu','elektrik-kesif-formu','kompanzasyon-kontrol-formu','kablo-metraj-sablonu','trafo-bakim-checklisti','pano-kontrol-formu','motor-bakim-formu','pano-malzeme-listesi','periyodik-kontrol-checklistleri'];
const scenarios=[...forms.map(slug=>({slug,id:slug})),{slug:'trafo-bakim-checklisti',id:'trafo-long-note',kind:'long-note'},{slug:'pano-malzeme-listesi',id:'pano-many-rows',kind:'many-rows'}].filter(s=>process.argv.includes('--normal-only')?!s.kind:process.argv.includes('--stress-only')?!!s.kind:true);
const report={isolated:true,forms:[],findings:[],pageErrors:[],consoleErrors:[],externalRequests:[],requests:[],checks:0};
fs.mkdirSync(output,{recursive:true});
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png','.jpeg':'image/jpeg','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.json':'application/json'};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://fixture');report.requests.push({method:req.method,path:url.pathname,query:url.search});
  if(url.pathname==='/api/auth.php'&&url.searchParams.get('action')==='me'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({api:'vg-auth/1',ok:true,user:null,csrf:'a'.repeat(64)}));}
  if(url.pathname==='/api/metrics.php'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true}));}
  if(req.method!=='GET'||/\.php(?:$|\/)/i.test(url.pathname)||!/^\/(?:mm|css|js|fonts|public)\//.test(url.pathname)){res.writeHead(404);return res.end('Not found');}
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()||!mime[path.extname(file)]){res.writeHead(404);return res.end('Not found');}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
});
const norm=s=>String(s).replace(/\s+/g,' ').trim();
function checked(condition,message){report.checks++;assert.ok(condition,message);}
function auditPdf(file,prefix){
  const code='import json,sys,fitz;from pypdf import PdfReader\nf=sys.argv[1];r=PdfReader(f);d=fitz.open(f);out={"pages":len(r.pages),"text":"\\n".join(p.extract_text() or "" for p in r.pages),"pageDetails":[]}\nfor p in d:\n blocks=p.get_text("blocks",clip=fitz.INFINITE_RECT());body=[b for b in blocks if b[1]<805 and str(b[4]).strip()];clipped=[{"bbox":list(b[:4]),"text":b[4]} for b in blocks if b[0]<-1 or b[2]>p.rect.width+1 or b[1]<-1 or b[3]>p.rect.height+1];out["pageDetails"].append({"page":p.number+1,"text":p.get_text(),"bodyBlocks":len(body),"clipped":clipped})\nprint(json.dumps(out,ensure_ascii=True))';
  const parsed=spawnSync(process.env.VG_PYTHON||'python',['-c',code,file],{encoding:'utf8',windowsHide:true,timeout:30000});
  checked(parsed.status===0,'Downloaded public-form PDF must parse: '+parsed.stderr);
  const data=JSON.parse(parsed.stdout);
  checked(path.dirname(path.resolve(prefix))===output,'Rendered page cleanup stays in this fixture output directory');
  const oldPage=new RegExp('^'+path.basename(prefix).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'-\\d+\\.png$');
  for(const old of fs.readdirSync(output).filter(name=>oldPage.test(name)))fs.unlinkSync(path.join(output,old));
  const render=spawnSync(process.env.VG_PDFTOPPM||'pdftoppm',['-scale-to','1400','-png',file,prefix],{encoding:'utf8',windowsHide:true,timeout:60000});
  checked(render.status===0,'Downloaded PDF must render: '+render.stderr);
  const ink=spawnSync(process.env.VG_PYTHON||'python',['-c','import json,sys;from pathlib import Path;from PIL import Image\nout=[]\nfor f in sorted(Path(sys.argv[1]).parent.glob(Path(sys.argv[1]).name+"-*.png")):\n if not f.stem.rsplit("-",1)[-1].isdigit():continue\n im=Image.open(f).convert("RGB");body=im.crop((0,0,im.width,int(im.height*.94)));h=body.convert("L").histogram();out.append({"image":str(f),"bodyInk":sum(h[:235])/(body.width*body.height)})\nprint(json.dumps(out))',prefix],{encoding:'utf8',windowsHide:true,timeout:30000});
  checked(ink.status===0,'Rendered pages must be measurable');data.rendered=JSON.parse(ink.stdout);checked(data.rendered.length===data.pages,'Every actual PDF page has exactly one numbered render');return data;
}
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  let browser;
  try{
    browser=await chromium.launch({headless:true,executablePath:chrome,args:['--disable-features=Prerender2,SpeculationRulesPrefetch,SpeculationRulesPrerender']});
    const context=await browser.newContext({locale:'tr-TR',timezoneId:'Europe/Istanbul',viewport:{width:1440,height:1000},serviceWorkers:'block',acceptDownloads:true,reducedMotion:'reduce'});
    await context.route('**/*',route=>{const u=route.request().url();if(/^https?:/.test(u)&&!u.startsWith(base+'/')){report.externalRequests.push(u);return route.abort();}return route.continue();});
    for(const scenario of scenarios){
      const {slug,id,kind}=scenario;
      const page=await context.newPage(),entry={slug:id,source:slug,boundary:kind||null,ok:false,findings:[]};report.forms.push(entry);
      page.on('pageerror',error=>report.pageErrors.push({slug,error:error.message}));
      page.on('console',message=>{if(message.type()==='error'&&!/net::ERR_(?:FAILED|ABORTED|BLOCKED_BY_CLIENT)/.test(message.text()))report.consoleErrors.push({slug,message:message.text()});});
      page.on('dialog',dialog=>{entry.findings.push('Unexpected dialog: '+dialog.message());dialog.dismiss().catch(()=>{});});
      try{
        await page.goto(base+'/mm/'+slug+'.html',{waitUntil:'networkidle',timeout:20000});
        await page.waitForFunction(()=>!!window.VG?.Forms?.exportPdf);await page.evaluate(()=>document.fonts.ready);
        const controls=page.locator('main input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]),main textarea,main select');
        let lastText;
        for(let i=0;i<await controls.count();i++){
          const control=controls.nth(i);if(!await control.isVisible()||!await control.isEnabled())continue;
          const kind=await control.evaluate(e=>({tag:e.tagName,type:e.type,min:e.min,max:e.max,readOnly:e.readOnly}));if(kind.readOnly)continue;
          if(kind.tag==='SELECT'){const value=await control.evaluate(e=>[...e.options].find(o=>o.value!=='')?.value);if(value!==undefined)await control.selectOption(value);}
          else if(kind.type==='checkbox'||kind.type==='radio'){if(i%2===0)await control.check();}
          else if(kind.type==='date')await control.fill('2026-10-26');
          else if(kind.type==='time')await control.fill('09:30');
          else if(kind.type==='number'){let value=1;if(kind.min!==''&&Number(kind.min)>value)value=Number(kind.min);if(kind.max!==''&&Number(kind.max)<value)value=Number(kind.max);await control.fill(String(value));}
          else if(kind.type==='email')await control.fill('qa@example.invalid');
          else if(kind.type==='tel')await control.fill('0000000000');
          else {await control.fill(i===0?'QA-FORM-'+slug:'QA '+(i+1));lastText=control;}
        }
        let longTokens=[];
        if(kind==='long-note'){
          longTokens=Array.from({length:450},(_,i)=>'QA-LONG-'+String(i).padStart(4,'0'));
          await page.locator('.vg-form-section table tbody tr').first().locator('input[type=text],textarea').last().fill('QA-UZUN-BAS '+longTokens.join(' ')+' QA-UZUN-SON');
        }
        if(kind==='many-rows'){
          const add=page.locator('[data-vg-add-row]').first();
          for(let i=0;i<55;i++){
            await add.click();const table=await add.getAttribute('data-vg-add-row');
            await page.locator(table+' tbody tr').last().locator('input[type=text]').first().fill('QA-ROW-'+String(i).padStart(3,'0'));
          }
          lastText=page.locator('main input[type=text]:not([readonly]),main textarea').last();
        }
        if(lastText)await lastText.fill('QA-SON-'+id);
        const expected=await page.evaluate(()=>{
          const clean=s=>String(s||'').replace(/\s+/g,' ').trim(),safe=s=>window.VG.Forms.pdfSafe(clean(s));
          const controls=[...document.querySelectorAll('main input,main select,main textarea')].filter(e=>!/^(hidden|button|submit|reset)$/.test(e.type));
          const firstTable=document.querySelector('.vg-form-section table');return{tableHeaders:firstTable?[...firstTable.querySelectorAll('thead th')].map(e=>safe(e.textContent)):[],firstRowContext:firstTable?[...firstTable.querySelectorAll('tbody tr:first-child td')].filter(e=>!e.querySelector('input,select,textarea')).map(e=>safe(e.textContent)).filter(t=>t.length>4):[],title:safe(document.querySelector('.vg-form-header h1')?.textContent||document.querySelector('h1')?.textContent),fields:window.VG.Forms.readValues(document.querySelector('main')).map((f,i)=>({label:safe(f.label),value:safe(controls[i]?.type==='number'?String(f.value).replace('.',','):f.value)})),descriptions:[...document.querySelectorAll('main .vg-form-desc')].map(e=>safe(e.textContent)),headings:[...document.querySelectorAll('.vg-form-section h2')].map(e=>safe(e.textContent)),fixedCells:[...document.querySelectorAll('.vg-form-section table th,.vg-form-section table td')].filter(e=>!e.querySelector('input,select,textarea')).map(e=>safe(e.textContent)).filter(s=>s.length>4&&!/^[-\d\s.]+$/.test(s))};
        });
        entry.expected=expected;await page.screenshot({path:path.join(output,id+'-screen.png'),fullPage:true});
        const event=page.waitForEvent('download',{timeout:30000});await page.locator('[data-vg-form-action="pdf"]').click();const download=await event;
        const file=path.join(output,id+'.pdf');await download.saveAs(file);entry.file=file;entry.bytes=fs.statSync(file).size;
        checked(fs.readFileSync(file).subarray(0,5).toString()==='%PDF-','Actual file has PDF header');
        const pdf=auditPdf(file,path.join(output,id));entry.pdf=pdf;
        const body=norm(pdf.pageDetails.map(p=>p.text).join('\n'));checked(body.includes(norm(expected.title)),'Actual PDF retains its visible form title');
        const missingHeadings=expected.headings.filter(s=>!body.includes(norm(s)));
        const missingCells=[...new Set(expected.fixedCells)].filter(s=>!body.includes(norm(s)));
        const missingDescriptions=expected.descriptions.filter(s=>!body.includes(norm(s)));
        const missingValues=expected.fields.filter(f=>f.value!==''&&f.value.length<1000&&!body.includes(norm(f.value)));
        if(missingHeadings.length)entry.findings.push({problem:'Missing section headings',values:missingHeadings});
        if(missingCells.length)entry.findings.push({problem:'Missing fixed table context',values:missingCells});
        if(missingDescriptions.length)entry.findings.push({problem:'Missing visible usage/scope description',values:missingDescriptions});
        if(missingValues.length)entry.findings.push({problem:'Missing entered control values',values:missingValues});
        checked(body.includes('QA-SON-'+id),'Actual PDF preserves the final entered field');
        if(longTokens.length){const missing=longTokens.filter(token=>!body.includes(token));if(missing.length)entry.findings.push({problem:'Long cell loses tokens across pages',tokens:missing});checked(body.includes('QA-UZUN-SON'),'Actual PDF preserves the end of an oversized cell');}
        for(const p of pdf.pageDetails){if(kind&&/QA-(?:LONG|ROW)-/.test(p.text)){const visible=norm(p.text);for(const label of expected.tableHeaders)checked(visible.includes(norm(label)),'A continued table repeats its column header: '+label);if(kind==='long-note')for(const label of expected.firstRowContext)checked(visible.includes(norm(label)),'A continued note retains the original checklist item: '+label);}if(!p.bodyBlocks)entry.findings.push({problem:'Footer-only or blank page',page:p.page});if(p.clipped.length)entry.findings.push({problem:'Text outside page',page:p.page,blocks:p.clipped});checked(p.text.includes('Sayfa '+p.page+'/'+pdf.pages),'Actual PDF has consistent page numbering');}
        for(const p of pdf.rendered)if(p.bodyInk<0.0007)entry.findings.push({problem:'Almost empty rendered page',image:p.image,ink:p.bodyInk});
        entry.ok=entry.findings.length===0;
        console.log(JSON.stringify({slug:id,ok:entry.ok,pages:pdf.pages,missingHeadings:missingHeadings.length,missingFixedCells:missingCells.length,bytes:entry.bytes}));
      }catch(error){entry.findings.push({problem:'Workflow failed',error:error.stack});}
      finally{await page.close();}
    }
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
  report.findings=report.forms.flatMap(f=>f.findings.map(finding=>({slug:f.slug,finding})));
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.forms.filter(f=>f.ok).length,total:report.forms.length,checks:report.checks,findings:report.findings.length,pageErrors:report.pageErrors.length,consoleErrors:report.consoleErrors.length,report:path.join(output,'report.json')}));
  if(report.findings.length||report.pageErrors.length||report.consoleErrors.length)process.exitCode=1;
}
main().catch(error=>{console.error(error.stack);server.close();process.exitCode=1;});

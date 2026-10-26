'use strict';

// UI-only fixtures run on an isolated local server. Never calls a live staff API,
// consumes a real invitation, or reads/writes company payroll storage.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, '.qa/staff');
fs.mkdirSync(output, { recursive:true });
const report = { checks:[], layouts:[], findings:[], requests:{}, browserNotices:[], firstEnrollment:[] };
const TOKEN = 'a'.repeat(64);
const SECRET = 'JBSWY3DPEHPK3PXP';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
const sessions = new Map();
const observed = [];
let serial = 0;
let plan = { role:'employee', direct:false, unavailable:false };
let people = [
  { id:'staff-admin', name:'QA Yönetici', email:'admin@example.invalid', role:'admin', status:'active' },
  { id:'staff-employee', name:'QA Çalışan <img src=x onerror="window.__unsafe=1">', email:'employee@example.invalid', role:'employee', status:'active' },
  { id:'staff-payroll', name:'QA Bordro Sorumlusu', email:'payroll@example.invalid', role:'payroll', status:'active' },
];
let records = [{ id:'qa-payroll-1', userId:'staff-employee', employeeName:people[1].name,
  period:'2026-09', gross:'55000.00', deductions:'10000.00', net:'45000.00',
  note:'<img src=x onerror="window.__unsafe=1"> Bu metin bir UI test verisidir.', hasPdf:true }];

function packagePath(name) {
  try { return require.resolve(name); } catch (_) {}
  const dirs = [process.env.VG_NODE_MODULES, process.env.VOLTGUARD_NODE_MODULES,
    path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')].filter(Boolean);
  for (const dir of dirs) if (fs.existsSync(path.join(dir,name))) return path.join(dir,name);
  throw new Error(name+' unavailable; set VG_NODE_MODULES to the bundled packages directory.');
}
function chromePath() {
  return [process.env.VOLTGUARD_CHROME, process.env.VG_CHROME,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'],'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA,'Google/Chrome/Application/chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES,'Microsoft/Edge/Application/msedge.exe')].filter(Boolean).find(file=>fs.existsSync(file));
}
function sessionFor(req) {
  const match = (req.headers.cookie || '').match(/(?:^|;\s*)VGSTAFFSESS=(qa-\d+)/);
  if (match && sessions.has(match[1])) return sessions.get(match[1]);
  const id = 'qa-'+(++serial);
  const user = people.find(person=>person.role === plan.role);
  const session = { id, csrf:'qa-staff-csrf-'+id, role:plan.role, user:plan.direct ? {...user} : null,
    target:{...user}, pending:plan.pendingEnrollment ? {mode:'enroll',secret:SECRET} : null, unavailable:plan.unavailable, failUpload:false, expired:false,
    consumedInvite:!!plan.consumedInvite, loginMode:plan.loginMode || 'verify' };
  sessions.set(id,session);
  return session;
}
function json(res, session, code, body) {
  res.writeHead(code, { 'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store, private', 'Set-Cookie':'VGSTAFFSESS='+session.id+'; HttpOnly; SameSite=Lax; Path=/' });
  res.end(JSON.stringify({api:'vg-staff/1',ok:code<400,...body}));
}
function canManage(session) { return session.user && ['admin','payroll'].includes(session.user.role); }
async function fixtureAPI(req,res,url) {
  const session = sessionFor(req), action = url.searchParams.get('action');
  let raw = ''; for await (const chunk of req) raw += chunk;
  const multipart = (req.headers['content-type'] || '').startsWith('multipart/form-data');
  const body = raw && !multipart ? JSON.parse(raw) : {};
  observed.push({ action, session:session.id, headers:req.headers, body, raw, url:url.pathname+url.search });
  if (session.unavailable) return json(res,session,503,{error:'staff_unavailable',message:'Çalışan sistemi şu anda kullanılamıyor.'});
  if (action==='me') return json(res,session,200,{user:session.user,csrf:session.csrf,mfa:session.pending ? {required:true,...session.pending} : null});
  if (req.method==='POST' && req.headers['x-vg-staff-csrf']!==session.csrf) return json(res,session,403,{error:'staff_csrf',message:'Güvenlik doğrulaması başarısız oldu.'});
  if (action==='login') {
    if (body.password!=='FixturePass123!' || !body.email.includes('@')) return json(res,session,401,{error:'staff_login_failed',message:'E-posta, şifre veya çalışan erişimi geçersiz.'});
    session.pending={mode:session.loginMode};
    if(session.loginMode==='enroll')session.pending.secret=session.nextEnrollmentSecret || SECRET;
    session.challengeExpired=false;
    session.csrf += '-pending';
    return json(res,session,200,{mfa_required:true,...session.pending,csrf:session.csrf});
  }
  if (action==='activate') {
    if (session.consumedInvite || body.token!==TOKEN) return json(res,session,400,{error:'staff_invite_invalid',message:'Bağlantı geçersiz, kullanılmış veya süresi dolmuş.'});
    session.pending={mode:'enroll',secret:SECRET}; session.csrf += '-pending';
    return json(res,session,200,{mfa_required:true,mode:'enroll',secret:SECRET,csrf:session.csrf});
  }
  if (action==='mfa_enroll' || action==='mfa_verify') {
    if (session.challengeExpired) {
      session.pending=null;
      return json(res,session,401,{error:'staff_challenge_expired',message:'Giriş adımını yeniden başlatın.'});
    }
    if (body.code!=='123456') return json(res,session,401,{error:'staff_code',message:'Doğrulama kodu geçersiz. Yeniden deneyin.'});
    session.user={...session.target};session.pending=null;session.csrf += '-authenticated';
    return json(res,session,200,{user:session.user,csrf:session.csrf});
  }
  if (action==='logout') { session.user=null;session.pending=null;session.csrf += '-loggedout';return json(res,session,200,{user:null,csrf:session.csrf}); }
  if (!session.user || session.expired) return json(res,session,401,{error:'staff_login',message:'Çalışan oturumunuz sona erdi.'});
  if (action==='payroll_download') {
    res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="qa-bordro.pdf"','Cache-Control':'no-store, private'});return res.end(PDF);
  }
  if (action==='payroll_list') return json(res,session,200,{items:canManage(session)?records:records.filter(row=>row.userId===session.user.id),canManage:!!canManage(session)});
  if (!canManage(session)) return json(res,session,403,{error:'staff_role',message:'Bu işlem için yetkiniz yok.'});
  if (action==='users') return json(res,session,200,{items:people,canInvite:session.user.role==='admin'});
  if (action==='payroll_create') {
    const owner=people.find(person=>person.id===body.userId);
    const item={id:'qa-payroll-'+(++serial),...body,employeeName:owner?.name||'',hasPdf:false};records.unshift(item);
    return json(res,session,201,{item});
  }
  if (action==='payroll_upload') {
    if (session.failUpload) return json(res,session,503,{error:'staff_upload_unavailable',message:'PDF yükleme şu anda kullanılamıyor.'});
    const id=raw.match(/name="statementId"\r\n\r\n([^\r]+)/)?.[1];
    const row=records.find(row=>row.id===id);if(row)row.hasPdf=true;
    return json(res,session,200,{uploaded:true});
  }
  if (action==='payroll_delete') { records=records.filter(row=>row.id!==body.statementId);return json(res,session,200,{deleted:true}); }
  if (action==='create_invite') {
    if(session.user.role!=='admin')return json(res,session,403,{error:'staff_role',message:'Bu işlem için yetkiniz yok.'});
    people.push({id:'qa-invite-'+(++serial),name:body.name,email:body.email,role:body.role,status:'invited'});
    return json(res,session,201,{activationUrl:'http://127.0.0.1:'+server.address().port+'/calisan/etkinlestir.html#t='+TOKEN});
  }
  if (action==='disable_user') {
    if(session.user.role!=='admin')return json(res,session,403,{error:'staff_role',message:'Bu işlem için yetkiniz yok.'});
    const person=people.find(person=>person.id===body.userId);if(person)person.status='disabled';return json(res,session,200,{disabled:true});
  }
  return json(res,session,404,{error:'staff_action_not_found',message:'İşlem bulunamadı.'});
}
function escapeHTML(value) {return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function shell(html) {
  for(const part of ['head','header','footer']) {
    const placeholder='<!--vg:'+part+'--><!--/vg:'+part+'-->';
    if(html.includes(placeholder))html=html.replace(placeholder,'<!--vg:'+part+'-->'+fs.readFileSync(path.join(root,'tools/shell/'+part+'.html'),'utf8').replace(/<!--@(?:preconnect|extras)-->/g,'')+'<!--/vg:'+part+'-->');
  }
  return html;
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const csp=fs.readFileSync(path.join(root,'.htaccess'),'utf8').match(/Header always set Content-Security-Policy\s+"([^"]+)"/)[1];
const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',csp);
  const url=new URL(req.url,'http://local');
  if(url.pathname==='/api/staff.php')return fixtureAPI(req,res,url);
  if(url.pathname==='/api/auth.php'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({api:'vg-auth/1',ok:true,user:null,csrf:'public-csrf'}));return;}
  if(url.pathname==='/calisan/' || url.pathname==='/calisan/index.php') {
    const session=sessionFor(req);
    if(!session.user || session.expired){res.writeHead(303,{Location:'/calisan/giris.html'}).end();return;}
    let html=fs.readFileSync(path.join(root,'calisan/index.php'),'utf8').replace(/^<\?php[\s\S]*?\?>/,'');
    for(const part of ['header','footer']) html=html.replace(new RegExp('<\\?php\\s+readfile[\\s\\S]*?shared-'+part+'\\.html[\\s\\S]*?\\?>'),fs.readFileSync(path.join(root,fs.existsSync(path.join(root,'calisan/shared-'+part+'.html'))?'calisan/shared-'+part+'.html':'tools/shell/'+part+'.html'),'utf8'));
    html=html.replace(/<\?php echo staff_page_escape\([\s\S]*?\?>/,escapeHTML(session.user.name));
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store, private','Set-Cookie':'VGSTAFFSESS='+session.id+'; HttpOnly; SameSite=Lax; Path=/'});res.end(html);return;
  }
  let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try {
    if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');
    let bytes=fs.readFileSync(file);
    if(path.extname(file)==='.html')bytes=Buffer.from(shell(bytes.toString()));
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(bytes);
  }catch(_){res.writeHead(404).end();}
});

function finding(stage,error) {report.findings.push({stage,message:error.message});console.warn(stage+': '+error.message);}
async function scenario(name,work) {try{await work();report.checks.push(name);console.log('Passed: '+name);}catch(error){finding(name,error);}}
async function checkLayout(page,name,width) {
  await page.setViewportSize({width,height:width<800?844:1000});
  await page.evaluate(()=>{window.VGShell?.close();window.scrollTo({top:0,behavior:'instant'});});
  if(width<1100)await page.waitForFunction(()=>getComputedStyle(document.getElementById('vgNav')).visibility==='hidden');
  await page.evaluate(()=>document.fonts.ready);
  const layout=await page.evaluate(()=>{
    const controls=Array.from(document.querySelectorAll('main input,main select,main textarea,main button')).filter(element=>{
      const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
      return rect.width&&rect.height&&style.visibility!=='hidden'&&(rect.left<-1||rect.right>innerWidth+1);
    }).map(element=>({tag:element.tagName,name:element.name,id:element.id}));
    const oversized=Array.from(document.querySelectorAll('main *')).filter(element=>{const rect=element.getBoundingClientRect();return rect.width>0&&rect.right>innerWidth+1;}).map(element=>({tag:element.tagName,id:element.id,className:element.className,text:element.textContent.slice(0,80)})).slice(0,12);
    return{viewport:innerWidth,width:document.documentElement.scrollWidth,controls,oversized,bodyFont:getComputedStyle(document.body).fontFamily,
      titleFont:getComputedStyle(document.querySelector('h1')).fontFamily};
  });
  report.layouts.push({name,...layout});
  assert.ok(layout.width<=width+1,name+' page overflow '+layout.width+'/'+width);assert.deepEqual(layout.controls,[],name+' clipped controls');
  assert.ok(layout.bodyFont.startsWith('Inter'));assert.ok(layout.titleFont.startsWith('Outfit'));
  await page.screenshot({path:path.join(output,name+'-'+width+'.png')});
  if(width<800) {
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.locator('#vgBurger').click();
    assert.equal(await page.locator('#vgBurger').getAttribute('aria-expanded'),'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#vgBurger').getAttribute('aria-expanded'),'false');
    await page.waitForFunction(()=>getComputedStyle(document.getElementById('vgNav')).visibility==='hidden');
  }
}
async function fillPayroll(page,period,pdf) {
  await page.locator('#staff-payroll-manager').evaluate(details=>{details.open=true;});
  const form=page.locator('#staff-payroll-form');
  await form.locator('[name=userId]').selectOption('staff-employee');
  for(const [name,value]of Object.entries({period,gross:'65000.00',deductions:'14000.00',net:'51000.00',note:'UI test bordrosu'}))await form.locator('[name='+name+']').fill(value);
  if(pdf)await form.locator('[name=pdf]').setInputFiles({name:'qa-bordro.pdf',mimeType:'application/pdf',buffer:PDF});
  await form.getByRole('button',{name:'Bordro kaydını ekle'}).click();
  await page.waitForFunction(()=>!document.getElementById('staff-payroll-form').hasAttribute('aria-busy'));
}
(async()=>{
  const {chromium}=require(packagePath('playwright'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,executablePath:chromePath()});
  const pageErrors=[],localErrors=[];
  async function contextWith(settings) {
    plan={role:'employee',direct:false,unavailable:false,...settings};
    const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'tr-TR',timezoneId:'Europe/Istanbul',serviceWorkers:'block',acceptDownloads:true});
    context.on('page',page=>{
      page.on('pageerror',error=>{
        if(/^Transition was aborted because of invalid state\. ViewTransition opt-in disabled$/.test(error.message))report.browserNotices.push(error.message);
        else pageErrors.push(error.message);
      });
      page.on('response',response=>{if(response.url().startsWith(base+'/')&&!response.url().includes('/api/')&&response.status()>=400)localErrors.push({url:response.url(),status:response.status()});});
      page.on('dialog',dialog=>dialog.accept());
    });
    return context;
  }
  try {
    await scenario('Consumed invitation hides password setup and offers staff-login recovery',async()=>{
      const context=await contextWith({role:'employee',consumedInvite:true,loginMode:'enroll'}),page=await context.newPage();
      await page.goto(base+'/calisan/etkinlestir.html#t='+TOKEN,{waitUntil:'networkidle'});
      await page.locator('#staff-activate-form [name=password]').fill('FixturePass123!');
      await page.locator('#staff-activate-form [name=confirm]').fill('FixturePass123!');
      await page.getByRole('button',{name:'Şifremi belirle'}).click();
      await page.waitForFunction(()=>document.getElementById('staff-activate-form').hidden);
      assert.ok(await page.locator('#staff-factor').isHidden());
      assert.equal(await page.locator('#staff-activate-form [name=password]').inputValue(),'');
      const recovery=page.locator('a[href="/calisan/giris.html"]').filter({hasText:/kurulum|devam|şifre/i}).first();
      assert.ok(await recovery.isVisible(),'Consumed invitation must offer continuation with the existing staff password');
      const sessionId=observed.filter(row=>row.action==='activate').at(-1).session;
      assert.equal(observed.filter(row=>row.session===sessionId&&row.action==='activate').length,1);
      for(const width of [1440,390,320])await checkLayout(page,'activation-recovery',width);
      await scenario('Enrollment account resumes setup by password login without reactivating its invitation',async()=>{
        await recovery.click();await page.waitForURL(base+'/calisan/giris.html');
        await page.waitForFunction(()=>!document.getElementById('staff-login-form').hidden);
        await page.locator('#staff-login-form [name=email]').fill('employee@example.invalid');
        await page.locator('#staff-login-form [name=password]').fill('FixturePass123!');
        await page.locator('#staff-login-form button').click();
        await page.waitForFunction(()=>!document.getElementById('staff-factor').hidden);
        assert.ok(await page.locator('#staff-enroll').isVisible());
        assert.ok(await page.locator('#staff-login-form').isHidden());
        assert.equal(await page.locator('#staff-secret').inputValue(),SECRET);
        assert.notEqual(await page.evaluate(()=>document.activeElement?.name),'code');
        assert.equal(observed.filter(row=>row.session===sessionId&&row.action==='activate').length,1,'Continuation never consumes or resets an invitation');
        await page.locator('#staff-factor-form [name=code]').fill('123456');
        await page.locator('#staff-factor-form button').click();
        await page.waitForURL(base+'/calisan/');
        await page.waitForFunction(()=>document.querySelectorAll('.staff-record').length>0);
        assert.equal(observed.filter(row=>row.session===sessionId&&row.action==='mfa_enroll').length,1);
        assert.equal(observed.filter(row=>row.session===sessionId&&row.action==='mfa_verify').length,0);
        assert.ok(await page.locator('#staff-people-tab').isHidden());
      });
      await context.close();
    });
    await scenario('A pending setup session resumes enrollment instead of showing invalid-link recovery',async()=>{
      const context=await contextWith({role:'employee',pendingEnrollment:true}),page=await context.newPage();
      await page.goto(base+'/calisan/etkinlestir.html',{waitUntil:'networkidle'});
      await page.waitForFunction(()=>!document.getElementById('staff-factor').hidden);
      assert.ok(await page.locator('#staff-enroll').isVisible());
      assert.ok(await page.locator('#staff-activation-recovery').isHidden());
      assert.ok(await page.locator('#staff-activate-form').isHidden());
      assert.equal(await page.locator('#staff-secret').inputValue(),SECRET);
      const sessionId=observed.filter(row=>row.action==='me').at(-1).session;
      assert.equal(observed.filter(row=>row.session===sessionId&&['activate','login'].includes(row.action)).length,0);
      await context.close();
    });
    await scenario('Expired first enrollment clears the old key and offers an explicit password restart',async()=>{
      const context=await contextWith({role:'employee',loginMode:'enroll'}),page=await context.newPage();
      await page.goto(base+'/calisan/etkinlestir.html#t='+TOKEN,{waitUntil:'networkidle'});
      await page.locator('#staff-activate-form [name=password]').fill('FixturePass123!');
      await page.locator('#staff-activate-form [name=confirm]').fill('FixturePass123!');
      await page.getByRole('button',{name:'Şifremi belirle'}).click();
      await page.waitForFunction(()=>!document.getElementById('staff-factor').hidden);
      const sid=observed.filter(row=>row.action==='activate').at(-1).session,session=sessions.get(sid);
      session.challengeExpired=true;
      session.nextEnrollmentSecret='KRSXG5DSNFXGOIDB';
      await page.locator('#staff-factor-form [name=code]').fill('123456');
      await page.locator('#staff-factor-form button').click();
      await page.waitForFunction(()=>!document.getElementById('staff-activation-recovery').hidden);
      assert.ok(await page.locator('#staff-factor').isHidden());
      assert.ok(await page.locator('#staff-activate-form').isHidden());
      assert.equal(await page.locator('#staff-secret').inputValue(),'');
      assert.equal(await page.locator('#staff-factor-form [name=code]').inputValue(),'');
      assert.match(await page.locator('#staff-status').innerText(),/10 dakika/);
      assert.match(await page.locator('#staff-status').innerText(),/yeni anahtarı/);
      assert.equal(session.user,null,'Expiry must not authenticate');
      assert.equal(observed.filter(row=>row.session===sid&&row.action==='login').length,0,'No automatic password submission');
      assert.equal(observed.filter(row=>row.session===sid&&row.action==='mfa_enroll').length,1,'No automatic code retry');
      for(const width of [390,320])await checkLayout(page,'expired-enrollment',width);
      await page.locator('#staff-activation-recovery a[href="/calisan/giris.html"]').click();
      await page.waitForURL(base+'/calisan/giris.html');
      await page.locator('#staff-login-form [name=email]').fill('employee@example.invalid');
      await page.locator('#staff-login-form [name=password]').fill('FixturePass123!');
      await page.locator('#staff-login-form button').click();
      await page.waitForFunction(()=>!document.getElementById('staff-factor').hidden);
      assert.equal(await page.locator('#staff-secret').inputValue(),session.nextEnrollmentSecret,'Restart shows the new setup key');
      assert.match(await page.locator('#staff-enroll').innerText(),/yeni anahtarı/);
      assert.equal(observed.filter(row=>row.session===sid&&row.action==='activate').length,1,'Restart does not reactivate the consumed invitation');
      await context.close();
    });
    await scenario('Expired normal MFA returns to password login with the email retained',async()=>{
      const context=await contextWith({role:'admin'}),page=await context.newPage();
      await page.setViewportSize({width:390,height:844});
      await page.goto(base+'/calisan/giris.html',{waitUntil:'networkidle'});
      await page.locator('#staff-login-form [name=email]').fill('admin@example.invalid');
      await page.locator('#staff-login-form [name=password]').fill('FixturePass123!');
      await page.locator('#staff-login-form button').click();
      await page.waitForFunction(()=>!document.getElementById('staff-factor').hidden);
      const sid=observed.filter(row=>row.action==='login').at(-1).session,session=sessions.get(sid);
      session.challengeExpired=true;
      await page.locator('#staff-factor-form [name=code]').fill('123456');
      await page.locator('#staff-factor-form button').click();
      await page.waitForFunction(()=>!document.getElementById('staff-login-form').hidden);
      assert.ok(await page.locator('#staff-factor').isHidden());
      assert.equal(await page.locator('#staff-secret').inputValue(),'');
      assert.equal(await page.locator('#staff-factor-form [name=code]').inputValue(),'');
      assert.equal(await page.locator('#staff-login-form [name=email]').inputValue(),'admin@example.invalid');
      assert.equal(await page.locator('#staff-login-form [name=password]').inputValue(),'');
      assert.match(await page.locator('#staff-status').innerText(),/10 dakika/);
      assert.equal(session.user,null);
      assert.equal(observed.filter(row=>row.session===sid&&row.action==='login').length,1,'No automatic login after expiry');
      assert.equal(observed.filter(row=>row.session===sid&&row.action==='mfa_verify').length,1,'No automatic code retry');
      await page.locator('#staff-login-form [name=password]').fill('FixturePass123!');
      await page.locator('#staff-login-form button').click();
      await page.waitForFunction(()=>!document.getElementById('staff-factor').hidden);
      await page.locator('#staff-factor-form [name=code]').fill('123456');
      await page.locator('#staff-factor-form button').click();
      await page.waitForURL(base+'/calisan/');
      assert.equal(observed.filter(row=>row.session===sid&&row.action==='login').length,2);
      await context.close();
    });
    await scenario('First MFA enrollment explains app codes and keeps the setup key in view',async()=>{
      for(const width of [1440,390,320]) {
        const context=await contextWith({role:'employee'}),page=await context.newPage();
        await page.setViewportSize({width,height:width<800?844:1000});
        await page.goto(base+'/calisan/etkinlestir.html#t='+TOKEN,{waitUntil:'networkidle'});
        await page.locator('#staff-activate-form [name=password]').fill('FixturePass123!');
        await page.locator('#staff-activate-form [name=confirm]').fill('FixturePass123!');
        await page.getByRole('button',{name:'Şifremi belirle'}).click();
        await page.waitForFunction(()=>!document.getElementById('staff-factor').hidden);
        // Check the actual first frame after the UI transition, before any QA
        // helper scrolls the page or the user focuses the code field.
        try {
          await page.waitForFunction(()=>{
            const heading=document.getElementById('staff-factor-title').getBoundingClientRect();
            const secret=document.getElementById('staff-secret').getBoundingClientRect();
            const header=document.getElementById('vgHeader').getBoundingClientRect();
            return heading.top>=header.bottom-1 && heading.bottom<=innerHeight && secret.top>=header.bottom-1 && secret.bottom<=innerHeight;
          },null,{timeout:5000});
        } catch(error) {
          const bounds=await page.evaluate(()=>{
            const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return{top:Math.round(r.top),bottom:Math.round(r.bottom)};};
            return{viewport:innerWidth,height:innerHeight,heading:rect('staff-factor-title'),secret:rect('staff-secret'),focused:document.activeElement?.name||document.activeElement?.id||'',scroll:Math.round(scrollY)};
          });
          report.firstEnrollment.push({...bounds,failure:'Setup heading/key is outside the first viewport'});
          await page.screenshot({path:path.join(output,'enrollment-first-'+width+'-failure.png')});
          throw new Error('First enrollment viewport: '+JSON.stringify(bounds));
        }
        const firstFrame=await page.evaluate(()=>{
          const bounds=id=>{const rect=document.getElementById(id).getBoundingClientRect();return{top:Math.round(rect.top),bottom:Math.round(rect.bottom)};};
          return{viewport:innerWidth,height:innerHeight,heading:bounds('staff-factor-title'),secret:bounds('staff-secret'),focused:document.activeElement?.name||document.activeElement?.id||''};
        });
        report.firstEnrollment.push(firstFrame);
        assert.notEqual(firstFrame.focused,'code','Enrollment must show setup before opening the numeric keyboard');
        const instructions=await page.locator('#staff-enroll').innerText();
        const explanation=await page.locator('#staff-factor').innerText();
        assert.match(explanation,/e[-‑ ]?posta[\s\S]{0,35}SMS[\s\S]{0,50}(?:gönderilmez|gönderilmiyor|gelmez)/i,'Enrollment explains that the code is not sent by email/SMS');
        assert.ok(await page.locator('#staff-enroll li').count()>=3,'Enrollment provides the app → key → code setup steps');
        assert.match(instructions,/uygulama/i);assert.match(instructions,/anahtar/i);assert.match(instructions,/6\s*hane/i);
        assert.equal(await page.locator('#staff-secret').inputValue(),SECRET);
        await page.screenshot({path:path.join(output,'enrollment-first-'+width+'.png')});
        await context.close();
      }
    });
    await scenario('Activation invitation → MFA enrollment → own employee panel',async()=>{
      const context=await contextWith({role:'employee'}),page=await context.newPage();
      await page.goto(base+'/calisan/etkinlestir.html#t='+TOKEN,{waitUntil:'networkidle'});
      assert.equal(new URL(page.url()).hash,'');
      await page.locator('#staff-activate-form [name=password]').fill('FixturePass123!');
      await page.locator('#staff-activate-form [name=confirm]').fill('FixturePass123!');
      await page.getByRole('button',{name:'Şifremi belirle'}).click();
      await page.waitForFunction(()=>!document.getElementById('staff-factor').hidden);
      assert.ok(await page.locator('#staff-enroll').isVisible());assert.equal(await page.locator('#staff-secret').inputValue(),SECRET);
      assert.equal(await page.locator('#staff-activate-form [name=password]').inputValue(),'');
      assert.equal(observed.filter(row=>row.action==='activate').at(-1).body.token,TOKEN);
      for(const width of [1440,390,320])await checkLayout(page,'enrollment',width);
      await page.locator('#staff-factor-form [name=code]').fill('123456');
      await page.locator('#staff-factor-form button').click();
      await page.waitForURL(base+'/calisan/');await page.waitForFunction(()=>document.querySelectorAll('.staff-record').length>0);
      assert.ok(await page.locator('#staff-people-tab').isHidden());assert.ok(await page.locator('#staff-payroll-manager').isHidden());
      assert.ok(await page.locator('#staff-invite-section').isHidden());
      assert.equal(await page.locator('#staff-payroll-list img').count(),0);assert.equal(await page.evaluate(()=>window.__unsafe),undefined);
      assert.ok(await page.locator('#staff-payroll-list').innerText().then(text=>text.includes('45.000,00')));
      const employeeSession=observed.filter(row=>row.action==='mfa_enroll').at(-1).session;
      assert.equal(observed.filter(row=>row.session===employeeSession&&['users','create_invite','payroll_create'].includes(row.action)).length,0);
      for(const width of [1440,390,320])await checkLayout(page,'employee-panel',width);
      const downloadEvent=page.waitForEvent('download');await page.getByRole('link',{name:'PDF bordroyu indir'}).click();
      const download=await downloadEvent;await download.saveAs(path.join(output,'fixture-payroll.pdf'));assert.equal(fs.readFileSync(path.join(output,'fixture-payroll.pdf')).subarray(0,5).toString(),'%PDF-');
      await page.evaluate(()=>addEventListener('pagehide',()=>sessionStorage.setItem('qa-private-scrub',JSON.stringify({records:document.querySelectorAll('.staff-record').length,people:document.querySelectorAll('.staff-person').length,invite:document.getElementById('staff-invite-link').value}))));
      await page.locator('#staff-logout').click();await page.waitForURL(base+'/calisan/giris.html');
      assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('qa-private-scrub'))),{records:0,people:0,invite:''});
      await context.close();
    });
    await scenario('Password login → MFA verification → admin payroll, invitations and disable',async()=>{
      const context=await contextWith({role:'admin'}),page=await context.newPage();
      await page.goto(base+'/calisan/giris.html',{waitUntil:'networkidle'});
      for(const width of [1440,390,320])await checkLayout(page,'login',width);
      await page.locator('#staff-login-form [name=email]').fill('admin@example.invalid');
      await page.locator('#staff-login-form [name=password]').fill('wrong-password');
      await page.locator('#staff-login-form button').click();
      await page.waitForFunction(()=>document.getElementById('staff-status').textContent.includes('geçersiz'));
      await scenario('Visible login error uses error color',async()=>{assert.equal(await page.locator('#staff-status').evaluate(element=>getComputedStyle(element).color),'rgb(185, 28, 28)');});
      assert.equal(await page.locator('#staff-login-form [name=password]').inputValue(),'');
      await page.locator('#staff-login-form [name=password]').fill('FixturePass123!');await page.locator('#staff-login-form button').click();
      await page.waitForFunction(()=>!document.getElementById('staff-factor').hidden);assert.ok(await page.locator('#staff-enroll').isHidden());
      await page.locator('#staff-factor-form [name=code]').fill('000000');await page.locator('#staff-factor-form button').click();
      await page.waitForFunction(()=>document.getElementById('staff-status').textContent.includes('Doğrulama kodu geçersiz'));
      assert.equal(await page.locator('#staff-factor-form [name=code]').inputValue(),'');
      await scenario('Wrong MFA code preserves the normal verification flow',async()=>{
        assert.ok(await page.locator('#staff-factor').isVisible());
        assert.ok(await page.locator('#staff-factor-form').isVisible());
        assert.ok(await page.locator('#staff-login-form').isHidden());
        assert.ok(await page.locator('#staff-enroll').isHidden());
        assert.equal(await page.locator('#staff-secret').inputValue(),'');
        assert.equal(await page.locator('#staff-factor-form button').isDisabled(),false);
        assert.equal(observed.filter(row=>row.action==='mfa_verify').at(-1).body.code,'000000');
        assert.ok(new URL(page.url()).pathname.endsWith('/calisan/giris.html'));
      });
      await page.locator('#staff-factor-form [name=code]').fill('123456');await page.locator('#staff-factor-form button').click();
      await page.waitForURL(base+'/calisan/');await page.waitForFunction(()=>document.querySelectorAll('.staff-person').length===3);
      const adminSession=observed.filter(row=>row.action==='mfa_verify').at(-1).session;
      const session=sessions.get(adminSession);
      assert.ok(await page.locator('#staff-payroll-manager').isVisible());
      for(const width of [1440,390,320])await checkLayout(page,'admin-panel',width);
      await fillPayroll(page,'2026-10',true);assert.ok(await page.locator('#staff-status').innerText().then(text=>text.includes('Bordro kaydı eklendi')));
      const upload=observed.filter(row=>row.session===adminSession&&row.action==='payroll_upload').at(-1);
      assert.ok(upload.headers['content-type'].startsWith('multipart/form-data; boundary='));assert.ok(upload.raw.includes('%PDF-'));assert.equal(upload.headers['x-vg-staff-csrf'],session.csrf);
      session.failUpload=true;await fillPayroll(page,'2026-11',true);
      assert.ok(await page.locator('#staff-status').innerText().then(text=>text.includes('Bordro kaydı eklendi, PDF yüklenemedi')));
      session.failUpload=false;
      await page.locator('.staff-record').first().getByRole('button',{name:'Kaydı sil'}).click();await page.waitForFunction(()=>document.getElementById('staff-status').textContent.includes('Bordro kaydı silindi'));
      await page.locator('#staff-people-tab').click();
      assert.equal(await page.locator('#staff-people-list img').count(),0);
      for(const [name,value]of Object.entries({name:'QA Yeni Çalışan',email:'new@example.invalid'}))await page.locator('#staff-invite-form [name='+name+']').fill(value);
      await page.locator('#staff-invite-form [name=role]').selectOption('employee');await page.getByRole('button',{name:'Özel davet oluştur'}).click();
      await page.waitForFunction(()=>!document.getElementById('staff-invite-result').hidden);
      assert.ok((await page.locator('#staff-invite-link').inputValue()).endsWith('#t='+TOKEN));
      const card=page.locator('.staff-person').filter({hasText:'employee@example.invalid'});await card.getByRole('button',{name:'Erişimi kapat'}).click();
      await page.waitForFunction(()=>document.getElementById('staff-status').textContent.includes('erişimi kapatıldı'));
      assert.equal(await page.locator('.staff-person').filter({hasText:'employee@example.invalid'}).getByRole('button',{name:'Erişimi kapat'}).count(),0);
      for(const width of [1440,390,320])await checkLayout(page,'admin-people',width);
      await context.close();
    });
    await scenario('Payroll manager can manage payroll but has no invitation or disable controls',async()=>{
      const context=await contextWith({role:'payroll',direct:true}),page=await context.newPage();await page.goto(base+'/calisan/',{waitUntil:'networkidle'});
      await page.waitForFunction(()=>document.querySelectorAll('.staff-person').length>0);assert.ok(await page.locator('#staff-payroll-manager').isVisible());
      await page.locator('#staff-people-tab').click();assert.ok(await page.locator('#staff-invite-section').isHidden());assert.equal(await page.getByRole('button',{name:'Erişimi kapat'}).count(),0);
      await context.close();
    });
    await scenario('Invalid activation link and unavailable API show safe visible errors',async()=>{
      const context=await contextWith({}),page=await context.newPage();await page.goto(base+'/calisan/etkinlestir.html#t=invalid',{waitUntil:'networkidle'});
      assert.equal(new URL(page.url()).hash,'');assert.ok(await page.locator('#staff-activate-form').isHidden());assert.ok(await page.locator('#staff-status').innerText().then(text=>text.includes('özel davet')));await context.close();
      const unavailable=await contextWith({unavailable:true}),errorPage=await unavailable.newPage();await errorPage.goto(base+'/calisan/giris.html',{waitUntil:'networkidle'});
      assert.ok(await errorPage.locator('#staff-status').innerText().then(text=>text.includes('şu anda kullanılamıyor')));assert.ok(await errorPage.locator('#staff-factor').isHidden());await errorPage.screenshot({path:path.join(output,'unavailable.png')});await unavailable.close();
    });
    await scenario('Expired private session redirects to staff login and scrubbed payroll remains hidden',async()=>{
      const context=await contextWith({role:'employee',direct:true}),page=await context.newPage();await page.goto(base+'/calisan/',{waitUntil:'networkidle'});
      await page.waitForFunction(()=>document.querySelectorAll('.staff-record').length>0);const sid=observed.filter(row=>row.action==='me').at(-1).session;sessions.get(sid).expired=true;
      await page.locator('#staff-refresh').click();await page.waitForURL(base+'/calisan/giris.html');assert.equal(await page.locator('.staff-record').count(),0);await context.close();
    });
    await scenario('Shared header hamburger retains the host dimensions',async()=>{
      const context=await contextWith({}),page=await context.newPage();await page.setViewportSize({width:390,height:844});await page.goto(base+'/bilgi-bankasi.html',{waitUntil:'networkidle'});
      const style=()=>page.locator('#vgBurger').evaluate(element=>{const s=getComputedStyle(element);return{padding:s.padding,border:s.borderWidth,width:s.width,height:s.height}});
      const reference=await style();await page.goto(base+'/calisan/giris.html',{waitUntil:'networkidle'});assert.deepEqual(await style(),reference);await context.close();
    });
    await scenario('No JavaScript errors or missing local UI assets',async()=>{assert.deepEqual(pageErrors,[]);assert.deepEqual(localErrors,[]);});
    report.requests=observed.reduce((counts,row)=>(counts[row.action]=(counts[row.action]||0)+1,counts),{});
    assert.equal(report.findings.length,0,JSON.stringify(report.findings,null,2));
    console.log('Passed staff UI fixtures: '+report.checks.length+' scenarios, '+report.layouts.length+' desktop/mobile layouts.');
  } finally {
    fs.writeFileSync(path.join(output,'browser-report.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});

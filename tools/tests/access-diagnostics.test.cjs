'use strict';
// Synthetic private stores only: diagnostics must not initialize, repair, chmod, send mail or disclose credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const {spawn, spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const script = path.join(root, 'tools/diagnose-access.php');
const php = process.env.VG_PHP || path.join(root, '.qa/php/runtime/php.exe');
const extensions = path.join(path.dirname(php), 'ext');
const sqliteArgs = fs.existsSync(path.join(extensions, 'php_pdo_sqlite.dll')) ? ['-d', `extension_dir=${extensions}`, '-d', 'extension=pdo_sqlite'] : [];
const driverProbe = 'echo class_exists("PDO") && in_array("sqlite",PDO::getAvailableDrivers(),true) ? "yes" : "no";';
const probe = spawnSync(php, ['-n', ...sqliteArgs, '-r', driverProbe], {encoding:'utf8',windowsHide:true});
if (probe.error || probe.status !== 0) throw Error('Set VG_PHP to the test PHP executable for access diagnostics.');
const hasSqlite = probe.stdout === 'yes';
const baseHasSqlite = spawnSync(php, ['-n','-r',driverProbe], {encoding:'utf8',windowsHide:true}).stdout === 'yes';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-access-diagnostic-'));
  const docroot = path.join(dir, 'public_html'); fs.mkdirSync(docroot);
  return {dir,docroot,selected:path.join(dir,'vg-data'),legacy:path.join(docroot,'_vgdata')};
}
function clean(dir) {
  const actual = fs.realpathSync(dir);
  assert.equal(path.dirname(actual), fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(actual).startsWith('vg-access-diagnostic-'));
  fs.rmSync(actual,{recursive:true,force:true});
}
function write(file, data) { fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,typeof data === 'string' ? data : JSON.stringify(data)); }
function snapshot(dir) {
  const out = {};
  function walk(p) {
    const st = fs.lstatSync(p), key = path.relative(dir,p) || '.';
    out[key] = {mode:st.mode,mtime:st.mtimeMs,kind:st.isDirectory()?'dir':'file'};
    if (st.isDirectory()) fs.readdirSync(p).sort().forEach(n=>walk(path.join(p,n)));
    else out[key].sha = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  }
  walk(dir); return out;
}
function run(f, options={}) {
  const env = {...process.env}; delete env.VG_DATA_DIR; delete env.VG_MAIL_OUTBOX;
  Object.assign(env,options.env || {});
  const args = ['-n', ...(options.sqlite === false ? [] : sqliteArgs), script, '--docroot', f.docroot];
  if (options.email) args.push('--email',options.email);
  const before = snapshot(f.dir);
  const result = spawnSync(php,args,{cwd:root,env,encoding:'utf8',windowsHide:true});
  assert.deepEqual(snapshot(f.dir),before,'diagnostics changed files, directory entries, permissions or modification times');
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stderr,'');
  return {report:JSON.parse(result.stdout),raw:result.stdout};
}
function jsonStore(dir, entries) {
  write(path.join(dir,'store.kind'),'json');
  const index = {};
  entries.forEach((email,i)=>{
    const id = 'u'+String(i+1).padStart(24,'0'); index[email]=id;
    write(path.join(dir,'json/users',id+'.json'),{id,email,name:'UNRELATED_PRIVATE_NAME',pass:'PRIVATE_PASSWORD_HASH',resetToken:'PRIVATE_RESET_TOKEN'});
  });
  fs.mkdirSync(path.join(dir,'json/users'),{recursive:true});
  write(path.join(dir,'json/emails.json'),index);
}
function staffStore(dir, users) {
  write(path.join(dir,'staff/state.json'),{version:1,users,invites:{PRIVATE_INVITATION_TOKEN:{email:'hidden-invite@example.invalid'}},payroll:[{amount:'PRIVATE_PAYROLL_AMOUNT'}],audit:[],rates:[]});
}

test('selected and legacy stores expose only counts and the explicitly requested account',()=>{
  const f=fixture();try {
    jsonStore(f.selected,['current@example.invalid']);
    jsonStore(f.legacy,['legacy@example.invalid','do-not-disclose@example.invalid']);
    staffStore(f.selected,{s1:{email:'legacy@example.invalid',name:'PRIVATE_STAFF_NAME',role:'employee',status:'disabled',mfaSecret:null,password:'PRIVATE_STAFF_HASH'}});
    staffStore(f.legacy,{s2:{email:'legacy@example.invalid',role:'admin',status:'active',mfaSecret:'PRIVATE_MFA_SECRET'},s3:{email:'other-staff@example.invalid',role:'employee',status:'invited',password:'ANOTHER_HASH'}});
    const {report:r,raw}=run(f,{email:'  LEGACY@EXAMPLE.INVALID  ',env:{VG_MAIL_OUTBOX:'1'}});
    assert.equal(r.readOnly,true); assert.equal(r.requestedEmail,'legacy@example.invalid');
    assert.equal(r.stores.selected.accountCount,1); assert.equal(r.stores.legacy.accountCount,2);
    assert.equal(r.stores.selected.emailExists,false); assert.equal(r.stores.legacy.emailExists,true);
    assert.deepEqual(r.stores.selected.staff.requestedAccount,{exists:true,status:'disabled',role:'employee',mfaEnrolled:false});
    assert.equal(r.stores.legacy.staff.activeMfaAdminCount,1);
    assert.equal(r.stores.legacy.staff.requestedAccount.mfaEnrolled,true);
    assert.ok(r.findings.includes('requested_member_only_in_legacy_store'));
    assert.ok(r.findings.includes('cli_mail_outbox_enabled_no_delivery'));
    for (const secret of ['PRIVATE_','UNRELATED_PRIVATE_NAME','ANOTHER_HASH','other-staff@example.invalid','do-not-disclose@example.invalid','hidden-invite@example.invalid']) assert.ok(!raw.includes(secret),secret+' disclosed');
    assert.equal(r.runtime.outboxMode,true);
    const anonymous=run(f).report;
    assert.equal(anonymous.requestedEmail,null); assert.ok(!('requestedAccount' in anonymous.stores.selected.staff));
  } finally {clean(f.dir);}
});

test('missing selected directory and empty current store identify legacy data without creating anything',()=>{
  const f=fixture();try {
    jsonStore(f.legacy,['legacy@example.invalid']);
    staffStore(f.legacy,{s1:{email:'legacy@example.invalid',role:'admin',status:'active',mfaSecret:'PRIVATE_MFA_SECRET'}});
    let r=run(f).report;
    assert.equal(fs.existsSync(f.selected),false);
    for (const finding of ['selected_directory_missing','legacy_accounts_not_in_selected_store','legacy_staff_not_in_selected_store','selected_staff_not_initialized']) assert.ok(r.findings.includes(finding),finding);
    jsonStore(f.selected,[]);
    r=run(f,{email:'legacy@example.invalid'}).report;
    assert.equal(r.stores.selected.accountCount,0); assert.ok(r.findings.includes('legacy_accounts_not_in_selected_store'));
    const custom=path.join(f.dir,'missing-custom');
    r=run(f,{env:{VG_DATA_DIR:custom}}).report;
    assert.equal(r.selectionSource,'VG_DATA_DIR'); assert.equal(r.stores.selected.exists,false); assert.equal(r.stores.externalDefault.accountCount,0);
  } finally {clean(f.dir);}
});

test('corrupt metadata is reported without printing stored content or repairing it',()=>{
  const f=fixture();try {
    write(path.join(f.selected,'store.kind'),'PRIVATE_INVALID_MARKER');
    write(path.join(f.selected,'json/emails.json'),'PRIVATE_CORRUPT_JSON');
    write(path.join(f.selected,'staff/state.json'),{version:99,users:{private:'PRIVATE_STAFF_RECORD'}});
    const {report:r,raw}=run(f,{email:'someone@example.invalid'});
    assert.equal(r.stores.selected.markerStatus,'invalid_kind'); assert.equal(r.stores.selected.json.status,'invalid_json');
    assert.equal(r.stores.selected.staff.status,'invalid_staff_store');
    assert.ok(!raw.includes('PRIVATE_')); assert.ok(r.findings.includes('selected_store_marker_missing_or_invalid'));
  } finally {clean(f.dir);}
});

test('staff schema missing an API-required collection is unhealthy even when safe account counts are readable',()=>{
  const f=fixture();try {
    staffStore(f.selected,{s1:{email:'fixture@example.invalid',role:'admin',status:'active',mfaSecret:'PRIVATE_MFA_SECRET'}});
    const stateFile=path.join(f.selected,'staff/state.json'),complete=JSON.parse(fs.readFileSync(stateFile,'utf8'));
    for(const collection of ['invites','payroll','rates','audit']) {
      const state={...complete};delete state[collection];write(stateFile,state);
      const {report:r,raw}=run(f);
      assert.equal(r.stores.selected.staff.status,'invalid_staff_store',collection);
      assert.equal(r.stores.selected.staff.accountCount,1);
      assert.ok(!raw.includes('PRIVATE_'));
    }
  } finally {clean(f.dir);}
});

test('SQLite lookup is immutable/read-only and sidecars are refused',{skip:!hasSqlite},()=>{
  const f=fixture();try {
    write(path.join(f.selected,'store.kind'),'sqlite');
    const file=path.join(f.selected,'vg-accounts.sqlite');
    const created=spawnSync(php,['-n',...sqliteArgs,'-r', '$d=new PDO("sqlite:".getenv("FIXTURE_SQLITE"));$d->exec("CREATE TABLE users (email TEXT, pass TEXT)");$s=$d->prepare("INSERT INTO users VALUES (?,?)");$s->execute(["fixture@example.invalid","PRIVATE_SQLITE_HASH"]);$s=null;$d=null;'],{env:{...process.env,FIXTURE_SQLITE:file},encoding:'utf8',windowsHide:true});
    assert.equal(created.status,0,created.stderr+created.stdout);
    let result=run(f,{email:'fixture@example.invalid'});
    assert.equal(result.report.stores.selected.sqlite.status,'ok'); assert.equal(result.report.stores.selected.accountCount,1);
    assert.equal(result.report.stores.selected.emailExists,true); assert.ok(!result.raw.includes('PRIVATE_SQLITE_HASH'));
    result=run(f,{sqlite:false}); assert.equal(result.report.stores.selected.sqlite.status,baseHasSqlite?'ok':'readonly_sqlite_driver_unavailable');
    write(file+'-wal','PRIVATE_WAL_FIXTURE');
    result=run(f,{email:'fixture@example.invalid'});
    assert.equal(result.report.stores.selected.sqlite.status,'sidecar_present_use_consistent_snapshot'); assert.equal(result.report.stores.selected.accountCount,null);
    assert.ok(!result.raw.includes('PRIVATE_WAL_FIXTURE'));
  } finally {clean(f.dir);}
});

test('HTTP requests get an empty 404 before parsing arguments or inspecting data',async()=>{
  const f=fixture();let server;try {
    fs.copyFileSync(script,path.join(f.docroot,'diagnostic.php'));
    const n=net.createServer();await new Promise(r=>n.listen(0,'127.0.0.1',r));const port=n.address().port;await new Promise(r=>n.close(r));
    const before=snapshot(f.dir);
    server=spawn(php,['-n','-S','127.0.0.1:'+port,'-t',f.docroot],{stdio:['ignore','ignore','ignore'],windowsHide:true,env:{...process.env,VG_DATA_DIR:f.selected}});
    let response;
    for(let i=0;i<100;i++){try{response=await fetch('http://127.0.0.1:'+port+'/diagnostic.php?email=private@example.invalid');break;}catch{await new Promise(r=>setTimeout(r,30));}}
    assert.ok(response,'test PHP server did not start');assert.equal(response.status,404);assert.equal(await response.text(),'');
    assert.deepEqual(snapshot(f.dir),before);
  } finally {if(server){server.kill();await new Promise(resolve=>server.once('exit',resolve));}clean(f.dir);}
});

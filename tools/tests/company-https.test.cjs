'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('Private PHP HTTPS bridge keeps exact signing, routing, bounded TLS transport and existing source contracts without process execution',()=>{
 const root=path.resolve(__dirname,'../..'),php=process.env.VG_PHP||path.join(root,'.qa/php/runtime/php.exe');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'voltguard-company-https-'));
 try{
  const result=spawnSync(php,['-n','-d','memory_limit=384M','-d','disable_functions=proc_open,curl_init,curl_setopt_array,curl_exec,curl_getinfo,curl_close',path.join(__dirname,'company-https-fixture.php')],{cwd:root,env:{...process.env,VG_DATA_DIR:temporary,VG_STORE:'json'},encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:1024*1024});
  assert.equal(result.error,undefined,result.error?.message);assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.equal(result.stderr,'');
  const report=JSON.parse(result.stdout);assert.equal(report.ok,true);assert.equal(report.synthetic,true);assert.equal(report.networkAccess,false);assert.ok(report.checks>=95,'Config, signature, isolation, failure and TLS controls must all execute');
 }finally{
  const resolved=fs.realpathSync(temporary),tempRoot=fs.realpathSync(os.tmpdir());assert.ok(path.relative(tempRoot,resolved).startsWith('voltguard-company-https-'));fs.rmSync(resolved,{recursive:true,force:true});
 }
});

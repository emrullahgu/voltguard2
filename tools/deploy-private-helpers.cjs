'use strict';
// Operator-only. No remote mutation occurs without --apply <reviewed-manifest>.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const privateRoot = '/home/emrullah/voltguard-site-bridge';
const files = {'company_store.py':'tools/ubuntu-company-bridge.py','saha_store.py':'tools/ubuntu-saha-source.py','saha-source-schema.json':'tools/saha-source-schema.json'};
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value);
function remote(payload) {
  const script = fs.readFileSync(path.join(__dirname, 'deploy-private-helpers.py')).toString('base64');
  const ssh = process.env.VG_OPERATOR_SSH || (process.platform === 'win32' ? 'C:/Windows/System32/OpenSSH/ssh.exe' : 'ssh');
  const command = 'python3 -B -c \'import base64;exec(base64.b64decode("' + script + '"))\'';
  const result = cp.spawnSync(ssh, ['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=7','sunucu',command], {input:JSON.stringify(payload), encoding:'utf8', windowsHide:true, timeout:240000, maxBuffer:1048576});
  if (result.error) throw new Error('Private helper SSH transport failed. No remote output was printed.');
  let answer;
  try {answer = JSON.parse(result.stdout);} catch {throw new Error('Private helper SSH response was not a valid operator report. No remote output was printed.');}
  if (result.status !== 0 || answer.ok !== true) throw new Error('Private helper operation stopped: ' + (/^[a-z_]+$/.test(answer.code || '') ? answer.code : 'operator_failed'));
  return answer.result;
}
function outputPath(raw) {
  if (!raw) throw new Error('A manifest path inside .qa is required.');
  const file = path.resolve(root, raw), base = path.join(root, '.qa') + path.sep;
  if (!file.startsWith(base) || path.extname(file) !== '.json') throw new Error('Operator reports must stay inside the workspace .qa directory.');
  return file;
}
function candidates() {return Object.fromEntries(Object.entries(files).map(([name, file]) => [name, fs.readFileSync(path.join(root, file))]));}
function main(args) {
  if (args.length === 1 && args[0] === '--inspect') return console.log(JSON.stringify({inspected:true,remote:'sunucu',root:privateRoot,...remote({action:'inspect'})},null,2));
  if (args.length !== 2 || !['--plan','--apply'].includes(args[0])) throw new Error('Usage: node tools/deploy-private-helpers.cjs --inspect | --plan .qa/plan.json | --apply .qa/plan.json');
  const manifestFile = outputPath(args[1]), content = candidates();
  const candidateHashes = Object.fromEntries(Object.entries(content).map(([name, value]) => [name, sha(value)]));
  if (args[0] === '--plan') {
    if (fs.existsSync(manifestFile)) throw new Error('Manifest exists. Use a new report filename to preserve the reviewed plan.');
    const inspection = remote({action:'inspect'});
    const manifest = {version:1,host:'sunucu',root:privateRoot,createdAt:new Date().toISOString(),expectedInspection:inspection,candidateHashes,changes:Object.keys(files).filter(name=>inspection.files[name].sha256 !== candidateHashes[name]),sourceFiles:files};
    fs.mkdirSync(path.dirname(manifestFile),{recursive:true});
    fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
    return console.log(JSON.stringify({prepared:true,applied:false,manifest:manifestFile,manifestSha256:sha(fs.readFileSync(manifestFile)),changes:manifest.changes,installed:Object.fromEntries(Object.keys(files).map(name=>[name,inspection.files[name]])),candidateHashes,healthy:inspection.healthy},null,2));
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  if (manifest.version !== 1 || manifest.host !== 'sunucu' || manifest.root !== privateRoot || canonical(manifest.candidateHashes) !== canonical(candidateHashes) || canonical(manifest.sourceFiles) !== canonical(files)) throw new Error('Reviewed manifest no longer matches the fixed operator target and current source. Prepare a new plan.');
  const report = manifestFile.replace(/\.json$/,'.result.json');
  if (fs.existsSync(report)) throw new Error('A result already exists for this manifest. Inspect the installed helpers before any retry.');
  const result = remote({action:'apply',manifest,files:Object.fromEntries(Object.entries(content).map(([name,value])=>[name,value.toString('base64')]))});
  fs.writeFileSync(report,JSON.stringify({manifestSha256:sha(fs.readFileSync(manifestFile)),completedAt:new Date().toISOString(),...result},null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({report,...result},null,2));
}
try {main(process.argv.slice(2));} catch(error) {console.error(error.message);process.exitCode=1;}

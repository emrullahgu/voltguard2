'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),source=path.join(root,'tools/staff-app'),dist=path.join(source,'dist'),target=path.join(root,'calisan/uygulama');
const vite=path.join(source,'node_modules/vite/bin/vite.js');
if(!fs.existsSync(vite))throw new Error('Install the locked dependencies in tools/staff-app with npm ci first.');
const result=spawnSync(process.execPath,[vite,'build'],{cwd:source,stdio:'inherit',windowsHide:true});
if(result.status!==0)process.exit(result.status||1);
for(const directory of [path.join(root,'calisan'),target]){
 if(fs.existsSync(directory)&&fs.lstatSync(directory).isSymbolicLink())throw new Error('Company output cannot use directory links.');
}
fs.mkdirSync(target,{recursive:true});
const realTarget=fs.realpathSync(target),expectedTarget=path.join(fs.realpathSync(root),'calisan','uygulama');
if(realTarget!==expectedTarget)throw new Error('Company output must stay inside the workspace.');
function rejectAssetLinks(directory){if(!fs.existsSync(directory))return;if(fs.lstatSync(directory).isSymbolicLink())throw new Error('Generated assets cannot use links.');for(const item of fs.readdirSync(directory,{withFileTypes:true})){if(item.isSymbolicLink())throw new Error('Generated assets cannot use links.');if(item.isDirectory())rejectAssetLinks(path.join(directory,item.name));}}
for(const folder of ['assets','fonts','licenses'])rejectAssetLinks(path.join(target,folder));
const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
const tags=[...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="\/calisan\/uygulama\/[^\"]+"[^>]*>(?:<\/script>)?/g)].map(m=>m[0]).join('\n');
if(!tags.includes('type="module"'))throw new Error('Company module entry was not emitted.');
function copyDirectory(from,to){fs.mkdirSync(to,{recursive:true});for(const item of fs.readdirSync(from,{withFileTypes:true})){if(item.name.startsWith('.')||item.name==='index.html')continue;const a=path.join(from,item.name),b=path.join(to,item.name);if(item.isDirectory())copyDirectory(a,b);else fs.copyFileSync(a,b);}}
copyDirectory(dist,target);
fs.writeFileSync(path.join(target,'entry-tags.html'),tags+'\n');
// Only generated asset trees may be pruned; preserve the PHP authorization gate.
function pruneGenerated(directory){
 const absolute=path.resolve(directory),relative=path.relative(target,absolute);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!['assets','fonts','licenses'].includes(relative.split(path.sep)[0]))throw new Error('Invalid generated asset directory.');
 if(!fs.existsSync(absolute))return;
 if(fs.lstatSync(absolute).isSymbolicLink())throw new Error('Generated assets cannot use directory links.');
 const actual=fs.realpathSync(absolute);if(!actual.startsWith(realTarget+path.sep))throw new Error('Generated assets escaped the company output.');
 for(const item of fs.readdirSync(absolute,{withFileTypes:true})){
  const file=path.join(absolute,item.name);
  if(item.isSymbolicLink())throw new Error('Generated assets cannot use file links.');
  if(item.isDirectory()){pruneGenerated(file);if(fs.readdirSync(file).length===0)fs.rmdirSync(file);}
  else if(!fs.existsSync(path.join(dist,path.relative(target,file))))fs.unlinkSync(file);
 }
}
for(const folder of ['assets','fonts','licenses'])pruneGenerated(path.join(target,folder));
console.log('Employee application built; HTML and all assets require employee authorization.');

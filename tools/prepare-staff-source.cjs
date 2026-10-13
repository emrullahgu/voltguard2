'use strict';
// One-time curated source import. Runtime employee data and credentials are excluded.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const original = path.join(root, 'voltguardekleyelim/Teklif-Voltguard-main');
const reviewed = path.join(root, 'voltguardekleyelim/company/app-overrides');
const target = path.join(root, 'tools/staff-app');
if (fs.existsSync(target)) throw new Error('Curated source already exists; edit it directly.');
fs.mkdirSync(target, {recursive:true});
const provenance = [];
function copy(from, relative) {
  const to = path.join(target, relative); fs.mkdirSync(path.dirname(to), {recursive:true});
  const bytes = fs.readFileSync(from); fs.writeFileSync(to, bytes);
  provenance.push({path:relative, source:path.relative(root, from).split(path.sep).join('/'), sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
for (const name of fs.readdirSync(path.join(original,'src'))) {
  if (!/\.(?:jsx?|tsx?|mjs|css|json)$/.test(name)) continue;
  // Legacy cloud authentication config is replaced by the local employee adapter.
  if (name === 'firebase.js' || name === 'supabaseClient.js') continue;
  const fixed = path.join(reviewed,'src',name);
  copy(fs.existsSync(fixed) ? fixed : path.join(original,'src',name), 'src/'+name);
}
for (const name of fs.readdirSync(path.join(reviewed,'src'))) {
  if (name === 'firebase.js' || name === 'supabaseClient.js') continue;
  if (!fs.existsSync(path.join(target,'src',name))) copy(path.join(reviewed,'src',name), 'src/'+name);
}
// Product-price history is private company data: the complete built application
// and every emitted asset will be served through the employee authorization gate.
for (const name of ['Fatura.json','Fatura2.json']) copy(path.join(original,'fatura',name), 'fatura/'+name);
for (const name of fs.readdirSync(path.join(original,'public'))) {
  if (/\.(?:png|jpe?g|webp|svg|ico)$/.test(name) && fs.statSync(path.join(original,'public',name)).isFile()) copy(path.join(original,'public',name), 'public/'+name);
}
function tree(from, relative) {
  for (const entry of fs.readdirSync(from, {withFileTypes:true})) {
    if (entry.isDirectory()) tree(path.join(from,entry.name), relative+'/'+entry.name);
    else copy(path.join(from,entry.name), relative+'/'+entry.name);
  }
}
tree(path.join(reviewed,'public/fonts'), 'public/fonts');
tree(path.join(reviewed,'public/licenses'), 'public/licenses');
copy(path.join(reviewed,'package.json'),'package.json');
copy(path.join(reviewed,'package-lock.json'),'package-lock.json');
copy(path.join(original,'tailwind.config.js'),'tailwind.config.js');
copy(path.join(original,'postcss.config.js'),'postcss.config.js');
fs.writeFileSync(path.join(target,'provenance.json'), JSON.stringify({baseline:'Teklif-Voltguard-main',reviewedFixes:'company/app-overrides',files:provenance},null,2)+'\n');
console.log('Curated employee application source: '+provenance.length+' files.');

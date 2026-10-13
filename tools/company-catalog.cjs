'use strict';
// Private catalogue import. It never emits catalogue contents or credentials.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=path.resolve(process.argv[2] || path.join(root,'voltguardekleyelim/Teklif-Voltguard-main'));
const destination=process.env.VG_DATA_DIR;
if(!destination || !path.isAbsolute(destination))throw new Error('VG_DATA_DIR must explicitly name a private absolute data directory.');
fs.mkdirSync(destination,{recursive:true,mode:0o700});
const actual=fs.realpathSync(destination),web=fs.realpathSync(root),relative=path.relative(web,actual);
if(relative==='' || (!relative.startsWith('..'+path.sep) && !path.isAbsolute(relative)))throw new Error('Catalogue data must stay outside the web root.');
const company=path.join(actual,'company');fs.mkdirSync(company,{recursive:true,mode:0o700});
if(fs.realpathSync(company)!==company)throw new Error('Private catalogue directory must not be a junction.');
const target=path.join(company,'catalog.json');
if(fs.existsSync(target))throw new Error('Catalogue already exists. Preserve it; use an explicit reviewed update instead of overwriting.');
const load=relative=>JSON.parse(fs.readFileSync(path.join(source,relative),'utf8').replace(/^\uFEFF/,''));
const data={historicalInvoice1:load('fatura/Fatura.json'),historicalInvoice2:load('fatura/Fatura2.json'),cablePrices:load('src/serer-kablo-fiyat.json'),packages:load('src/hazir-paketler.json')};
if(!Array.isArray(data.historicalInvoice1)||!Array.isArray(data.historicalInvoice2))throw new Error('Invalid invoice catalogue.');
fs.writeFileSync(target,JSON.stringify(data),{mode:0o600,flag:'wx'});
console.log('Private catalogue imported: '+data.historicalInvoice1.length+' + '+data.historicalInvoice2.length+' historical product rows.');

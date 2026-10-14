const fs=require('node:fs'),path=require('node:path');
const originalCredit=require('../src/original-credit.cjs');
const root=path.resolve(__dirname,'..'),dist=path.resolve(process.env.VG_DOWNLOAD_DIR||path.join(root,'dist'));
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0});
function crc32(b){let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>e.name==='downloads'?[]:e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)])}
function rewriteReference(reference,entryName,navigation=false){
  if(!reference||/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(reference))return reference;
  const match=reference.match(/^([^?#]*)([?#].*)?$/),pathname=match[1],tail=match[2]||'';
  let target;
  // These main-site assets are copied into the integrated staging directory by
  // the host builder and included by walk() with the rest of the public library.
  if(/^\/(?:css|js|fonts)\//.test(pathname))target='assets/host'+pathname;
  else if(pathname==='/public/voltguard-logo.webp')target='assets/host'+pathname;
  else if(/^\/araclar(?:\/|$)/.test(pathname)){
    target=pathname.replace(/^\/araclar\/?/,'');
    if(!target||target.endsWith('/'))target+='index.html';
  }
  if(target!==undefined){
    let relative=path.posix.relative(path.posix.dirname(entryName),target);
    if(!relative)relative=path.posix.basename(target);
    return relative+tail;
  }
  if(pathname.startsWith('/'))return 'https://voltguard.com.tr'+reference;
  // Browsers do not resolve file:// directory links to index.html.
  if(navigation&&pathname.endsWith('/'))return pathname+'index.html'+tail;
  return reference;
}
function rewriteCss(css,entryName){
  return css.replace(/url\(\s*(?:(["'])([\s\S]*?)\1|([^)]*?))\s*\)/gi,(_,quote,quoted,bare)=>{
    const value=quote?quoted:bare.trim();
    return 'url('+(quote||'')+rewriteReference(value,entryName)+(quote||'')+')';
  }).replace(/(@import\s+)(["'])([^"']+)\2/gi,(_,prefix,quote,value)=>prefix+quote+rewriteReference(value,entryName)+quote);
}
function rewriteArchiveReferences(content,entryName){
  if(entryName.endsWith('.html'))content=content.replace(/<script\b[^>]*data-vg-online-only[^>]*>[\s\S]*?<\/script>/gi,'');
  if(entryName.endsWith('.css'))return rewriteCss(content,entryName);
  if(!entryName.endsWith('.html'))return content;
  let html=content.replace(/(<(?:a|link|script|img|source|video|audio|iframe)\b[^>]*?\b(?:href|src)=)(["'])([^"']+)(\2)/gi,(_,start,quote,value)=>{
    return start+quote+rewriteReference(value,entryName,/^<a\b/i.test(start))+quote;
  });
  html=html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,(_,start,css,end)=>start+rewriteCss(css,entryName)+end);
  return html;
}
function archiveData(file){
  const data=fs.readFileSync(file);
  if(process.env.VG_INTEGRATED_ARCHIVE!=='1')return data;
  const name=path.relative(dist,file).split(path.sep).join('/');
  return /\.(?:html|css)$/.test(name)?Buffer.from(rewriteArchiveReferences(data.toString('utf8'),name),'utf8'):data;
}
function buildArchive(){
const entries=walk(dist).map(f=>({name:path.relative(dist,f).split(path.sep).join('/'),data:archiveData(f)}));
entries.push({name:'ONCE-OKUYUN.txt',data:Buffer.from(`VoltGuard çevrimdışı araç paketi\n\nZIP dosyasını bir klasöre çıkarın ve index.html dosyasını açın.\nYerel dosya erişimini kısıtlayan tarayıcılarda, çevrimiçi sitedeyken araç sayfasının Çevrimdışı HTML indir düğmesini kullanın; bu kopya tüm bağımlılıkları tek dosyada saklar.\nProje JSON yedeğinizi ayrı saklayın. Harita bağlantıları internet gerektirir.\n\nÖzgün 25 hesap aracının geliştiricisi: ${originalCredit.author}, bağımsız Elektrik-Elektronik Mühendisi (${originalCredit.sourceName}).\n${originalCredit.thankYou}\nGeliştirici profili: ${originalCredit.profileUrl}\nSite uyarlaması ve sonradan eklenen araçlar: VoltGuard. Özgün kaynak adı ve geliştirici atıfları korunur. Açık kaynak atıfları ve lisanslar acik-kaynak/ sayfasında ve vendor/ dizinindedir.\n`,'utf8')});
const local=[],central=[];let offset=0;for(const e of entries){const name=Buffer.from(e.name,'utf8'),crc=crc32(e.data),h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt32LE(crc,14);h.writeUInt32LE(e.data.length,18);h.writeUInt32LE(e.data.length,22);h.writeUInt16LE(name.length,26);local.push(h,name,e.data);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt32LE(crc,16);c.writeUInt32LE(e.data.length,20);c.writeUInt32LE(e.data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);central.push(c,name);offset+=h.length+name.length+e.data.length}
const end=Buffer.alloc(22),centralSize=central.reduce((a,b)=>a+b.length,0);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);const target=path.join(dist,'downloads');fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'voltguard-cevrimdisi.zip'),Buffer.concat([...local,...central,end]));console.log('Offline ZIP built: '+entries.length+' files.');
}
if(require.main===module)buildArchive();
module.exports={rewriteReference,rewriteCss,rewriteArchiveReferences,buildArchive};

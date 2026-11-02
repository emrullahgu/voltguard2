/* Original VoltGuard learning model. Ideal single diode at a fixed cell temperature. */
(function(root){
  'use strict';
  const defaults={irradiance:1000,cells:60,voltage:80,wavelength:550,lesson:0};
  const K=1.380649e-23,Q=1.602176634e-19,H=6.62607015e-34,C=299792458;
  const temperature=298.15,ideality=1.2,isc=10,vocCell=.65,bandgap=1.12;
  const a=ideality*K*temperature/Q,i0=isc/Math.expm1(vocCell/a);
  function validate(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Atölye girdileri geçersiz.');
    const p={};
    for(const [key,min,max,integer] of [['irradiance',0,1200],['cells',1,120,true],['voltage',0,100],['wavelength',350,1300],['lesson',0,3,true]]){
      const s=String(raw[key]).trim();
      if(!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(s))throw Error('Geçerli bir sayısal değer girin: '+key);
      const n=Number(s.replace(',','.'));
      if(!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n)))throw Error(key+': '+min+'–'+max+' aralığında '+(integer?'tamsayı':'değer')+' gerekir.');
      p[key]=n;
    }
    return p;
  }
  function photonEnergy(wavelength){return H*C/(wavelength*1e-9*Q)}
  function analyze(raw){
    const p=validate(raw),iph=isc*p.irradiance/1000,scale=p.cells*a;
    const voc=scale*Math.log1p(iph/i0);
    const current=v=>Math.max(0,iph-i0*Math.expm1(v/scale));
    let lo=0,hi=voc/scale;
    for(let n=0;n<70;n++){const mid=(lo+hi)/2;if((1+mid)*Math.exp(mid)>1+iph/i0)hi=mid;else lo=mid}
    const vmp=(lo+hi)/2*scale,imp=current(vmp),pmp=vmp*imp;
    const v=voc*p.voltage/100,i=p.voltage===100?0:current(v);
    const points=Array.from({length:161},(_,n)=>{const x=voc*n/160,j=n===160?0:current(x);return [x,j,x*j]});
    return {inputs:p,iph,voc,vmp,imp,pmp,v,i,power:v*i,photon:photonEnergy(p.wavelength),bandgap,canExcite:photonEnergy(p.wavelength)>=bandgap,points};
  }
  const api={defaults,validate,analyze,photonEnergy,constants:{K,Q,H,C,temperature,ideality,isc,vocCell,bandgap,i0}};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.VGPVLearning=api;
  if(typeof document==='undefined'||!document.getElementById('pv-learning'))return;
  const $=id=>document.getElementById(id),fields=['irradiance','cells','voltage','wavelength'];
  const fmt=(n,d=2)=>n.toLocaleString('tr-TR',{maximumFractionDigits:d});
  const lessons=[
    ['Işık bir enerji taşır','Bir fotonun enerjisi dalga boyu kısaldıkça artar. Silisyumda bant aralığını aşan bir foton, soğurulursa elektron–boşluk çifti oluşturabilir. Enerjinin tamamı elektrik enerjisine dönüşmez.'],
    ['Eklem yükleri ayırır','p ve n bölgeleri arasındaki iç elektrik alan, oluşan taşıyıcıların ayrılmasına yardım eder. p ve n, pilin artı ve eksi kutbu gibi hazır enerji depoları değildir. Işık enerji sağlar.'],
    ['Güç için devre kapanmalı','Açık devrede gerilim vardır, akım ve dış yüke verilen güç sıfırdır. Kısa devrede akım vardır, uç gerilimi ve dış yüke verilen güç sıfırdır. En yüksek güç bu iki uç noktanın arasındadır.'],
    ['Hücreler paneli oluşturur','Özdeş, eşit aydınlanan hücreler seri bağlanınca gerilimler toplanır; aynı akım tüm hücrelerden geçer. Bu ideal örnekte hücre sayısı arttıkça maksimum güç aynı oranda artar. Gölge ve bypass diyotları bu modelde yoktur.']
  ];
  let lesson=0,last=null;
  const getState=()=>({version:1,tool:'fotondan-panele-atolyesi',values:{...Object.fromEntries(fields.map(k=>[k,$('pv-'+k).value])),lesson}});
  function setState(s){
    if(!s||s.version!==1||s.tool!=='fotondan-panele-atolyesi'||!s.values)throw Error('Bu dosya Fotondan Panele atölyesine ait değil.');
    const p=validate(s.values); // Validate the entire import before touching the current project.
    fields.forEach(k=>{$('pv-'+k).value=String(p[k])});lesson=p.lesson;calculate();
  }
  function chart(id,r,kind){
    const svg=$(id),ns='http://www.w3.org/2000/svg';svg.replaceChildren();
    const append=(tag,attrs,text)=>{const el=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));if(text!==undefined)el.textContent=text;svg.appendChild(el)};
    const xmax=Math.max(r.voc,1),ymax=Math.max(kind===1?r.iph:r.pmp,1)*1.12,X=v=>58+v/xmax*474,Y=v=>225-v/ymax*175;
    for(let n=0;n<=4;n++){const v=xmax*n/4,j=ymax*n/4;append('line',{x1:58,x2:532,y1:Y(j),y2:Y(j),stroke:'#d7e2ec'});append('text',{x:49,y:Y(j)+4,'text-anchor':'end'},fmt(j,1));append('text',{x:X(v),y:247,'text-anchor':'middle'},fmt(v,1))}
    append('text',{x:58,y:24},kind===1?'Akım · A':'Güç · W');append('text',{x:532,y:273,'text-anchor':'end'},'Uç gerilimi · V');
    append('path',{d:r.points.map((pt,n)=>(n?'L':'M')+X(pt[0]).toFixed(3)+','+Y(pt[kind]).toFixed(3)).join(' '),fill:'none',stroke:kind===1?'#0284a1':'#b66b08','stroke-width':3});
    const my=kind===1?r.imp:r.pmp,oy=kind===1?r.i:r.power;
    append('circle',{cx:X(r.vmp),cy:Y(my),r:5,fill:'#157044'});
    append('circle',{cx:X(r.v),cy:Y(oy),r:6,fill:'#fff',stroke:'#0e2541','stroke-width':3});
    append('text',{x:58,y:296},'● Yeşil: MPP    ○ Lacivert: seçilen çalışma noktası');
  }
  function calculate(){
    try{
      const r=analyze({...getState().values});last=r;
      document.documentElement.dataset.vgInvalid='false';$('pv-error').hidden=true;$('pv-results').hidden=false;
      for(const [id,value,unit] of [['power',r.power,'W'],['current',r.i,'A'],['potential',r.v,'V'],['mpp',r.pmp,'W'],['voc',r.voc,'V'],['isc',r.iph,'A']])$('pv-out-'+id).textContent=fmt(value)+' '+unit;
      $('pv-photon-energy').textContent=fmt(r.photon,3)+' eV';
      $('pv-wavelength-value').textContent=fmt(r.inputs.wavelength)+' nm';
      $('pv-photon-status').textContent=r.canExcite?'Foton enerjisi bant aralığına eşit veya daha yüksek. Soğurulursa taşıyıcı oluşturabilir.':'Foton enerjisi bu basit silisyum bant aralığının altında. Tek fotonla bantlar arası uyarım gösterilmez.';
      $('pv-photon-status').dataset.active=String(r.canExcite);
      $('pv-cell-count').textContent=r.inputs.cells+' özdeş hücre · seri bağlantı';
      $('pv-operating').textContent=r.iph===0?'Işınım sıfır: üretim yok.':r.inputs.voltage===100?'Açık devre: gerilim var; dış yüke akım akmıyor.':r.inputs.voltage===0?'Kısa devre: uç gerilimi sıfır; yüke verilen güç sıfır.':'Çalışma noktası: Voc’nin %'+fmt(r.inputs.voltage)+"’i · MPP gerilimi "+fmt(r.vmp)+' V.';
      $('pv-lesson-title').textContent=lessons[lesson][0];$('pv-lesson-text').textContent=lessons[lesson][1];
      document.querySelectorAll('[data-pv-lesson]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.pvLesson)===lesson)));
      $('pv-stage').setAttribute('data-lesson',lesson);chart('pv-iv',r,1);chart('pv-power',r,2);return r;
    }catch(e){last=null;document.documentElement.dataset.vgInvalid='true';$('pv-error').textContent=e.message;$('pv-error').hidden=false;$('pv-results').hidden=true;$('printReport').replaceChildren();return null}
  }
  function report(){
    const r=calculate();if(!r)throw Error('Rapordan önce girdileri düzeltin.');
    const report=$('printReport');report.replaceChildren();
    const h=document.createElement('h2');h.textContent='Fotondan Panele · eğitim raporu';report.appendChild(h);
    for(const text of ['Işınım: '+fmt(r.inputs.irradiance)+' W/m² · Seri hücre: '+r.inputs.cells+' · Hücre sıcaklığı: 25 °C.',
      'Çalışma noktası: '+fmt(r.v)+' V, '+fmt(r.i)+' A, '+fmt(r.power)+' W.',
      'Maksimum güç: '+fmt(r.pmp)+' W · Vmp: '+fmt(r.vmp)+' V · Imp: '+fmt(r.imp)+' A.',
      'Voc: '+fmt(r.voc)+' V · Isc: '+fmt(r.iph)+' A.',
      'Bağımsız foton deneyi: '+fmt(r.inputs.wavelength)+' nm → '+fmt(r.photon,3)+' eV. Bant aralığı: 1,12 eV.',
      lessons[lesson].join(': '),$('pv-model').textContent]){const p=document.createElement('p');p.textContent=text;report.appendChild(p)}
    for(const id of ['pv-iv','pv-power']){const copy=$(id).cloneNode(true);copy.removeAttribute('id');report.appendChild(copy)}
    const refs=document.createElement('p');refs.textContent='Kaynaklar: DOE Solar Photovoltaic Cell Basics; Sandia PVPMC Single Diode Equivalent Circuit Models. Bağımsız VoltGuard eğitim uygulaması.';report.appendChild(refs);return report;
  }
  $('pv-form').addEventListener('submit',e=>{e.preventDefault();calculate()});
  $('pv-form').addEventListener('input',calculate);$('pv-form').addEventListener('change',calculate);
  $('pv-wavelength').addEventListener('input',calculate);
  document.querySelectorAll('[data-pv-lesson]').forEach(b=>b.addEventListener('click',()=>{lesson=Number(b.dataset.pvLesson);calculate()}));
  document.querySelectorAll('[data-pv-point]').forEach(b=>b.addEventListener('click',()=>{const r=calculate();if(!r)return;$('pv-voltage').value=b.dataset.pvPoint==='mpp'?(r.voc?r.vmp/r.voc*100:0):b.dataset.pvPoint;lesson=2;calculate()}));
  $('pv-reset').addEventListener('click',()=>setState({version:1,tool:'fotondan-panele-atolyesi',values:defaults}));
  $('pv-cloud').addEventListener('click',()=>{$('pv-irradiance').value='250';calculate()});
  $('pv-csv').addEventListener('click',()=>{const r=calculate();if(!r)return;const csv='\ufeffGerilim (V);Akım (A);Güç (W)\r\n'+r.points.map(p=>p.map(x=>String(x).replace('.',',')).join(';')).join('\r\n'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='voltguard-pv-egitim.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000)});
  window.VoltGuardExportAdapter={getState,setState,flush:calculate,buildReport:report};window.buildReport=report;calculate();
})(typeof window!=='undefined'?window:globalThis);

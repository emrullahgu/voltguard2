'use strict';
(() => {
  const source=document.getElementById('team-data');
  if(!source)return;
  const people=new Map(JSON.parse(source.textContent).map(p=>[p.id,p]));
  const units=new Set(['ofis','depo','ar-ge','saha']);
  const filters=[...document.querySelectorAll('[data-filter]')];
  const cards=[...document.querySelectorAll('[data-person]')];
  const rosters=[...document.querySelectorAll('[data-roster-unit]')];
  const search=document.getElementById('team-search');
  const results=document.querySelector('.team-results');
  const empty=document.querySelector('.team-empty');
  const controls=document.querySelector('.team-controls');
  const dialog=document.querySelector('.team-dialog');
  const tree=document.querySelector('.team-tree');
  const rootNode=document.querySelector('.team-tree__root');
  const branchNodes=[...document.querySelectorAll('[data-branch]')];
  const namespace='http://www.w3.org/2000/svg';
  const connections=document.createElementNS(namespace,'svg');
  connections.setAttribute('class','team-tree__connections');
  connections.setAttribute('aria-hidden','true');
  tree.insertBefore(connections,rootNode);
  function drawConnections(){
    const bounds=tree.getBoundingClientRect(),rootBounds=rootNode.getBoundingClientRect();
    if(!bounds.width)return;
    const nodes=branchNodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.left+r.width/2-bounds.left,y:r.top-bounds.top};});
    const rows=[];
    for(const node of nodes){let row=rows.find(r=>Math.abs(r.y-node.y)<3);if(!row){row={y:node.y,nodes:[]};rows.push(row);}row.nodes.push(node);}
    rows.sort((a,b)=>a.y-b.y);
    const x=rootBounds.left+rootBounds.width/2-bounds.left,y=rootBounds.bottom-bounds.top;
    const paths=[];
    const firstBus=rows[0].y-32;
    paths.push(`M ${x} ${y} V ${firstBus}`);
    if(rows.length>1)paths.push(`M ${x} ${firstBus} H -7 V ${rows[rows.length-1].y-10}`);
    rows.forEach((row,index)=>{const bus=row.y-(index?10:32);const xs=row.nodes.map(n=>n.x);paths.push(`M ${rows.length>1?-7:Math.min(...xs)} ${bus} H ${Math.max(...xs)}`);row.nodes.forEach(n=>paths.push(`M ${n.x} ${bus} V ${n.y}`));});
    connections.setAttribute('viewBox',`0 0 ${bounds.width} ${bounds.height}`);
    connections.replaceChildren(...paths.map(d=>{const path=document.createElementNS(namespace,'path');path.setAttribute('d',d);return path;}));
    tree.dataset.connections='ready';
  }
  let redrawPending=false;
  const scheduleConnections=()=>{if(redrawPending)return;redrawPending=true;requestAnimationFrame(()=>{redrawPending=false;drawConnections();});};
  if(typeof ResizeObserver==='function')new ResizeObserver(scheduleConnections).observe(tree);
  window.addEventListener('resize',scheduleConnections,{passive:true});
  if(document.fonts)document.fonts.ready.then(scheduleConnections);
  scheduleConnections();
  let selected='all',trigger=null;
  const fold=value=>value.toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');
  for(const card of cards)card.dataset.normalizedSearch=fold(card.dataset.search);
  function apply(){
    const query=fold(search.value.trim());let count=0,visibleUnits=0;
    for(const card of cards){card.hidden=(selected!=='all'&&card.dataset.unit!==selected)||(query&&!card.dataset.normalizedSearch.includes(query));if(!card.hidden)count++;}
    for(const section of rosters){section.hidden=![...section.querySelectorAll('[data-person]')].some(card=>!card.hidden);if(!section.hidden)visibleUnits++;for(const group of section.querySelectorAll('[data-group]'))group.hidden=![...group.querySelectorAll('[data-person]')].some(card=>!card.hidden);}
    for(const button of filters)button.setAttribute('aria-pressed',String(button.dataset.filter===selected));
    for(const branch of document.querySelectorAll('[data-branch]'))branch.dataset.active=String(selected===branch.dataset.branch);
    results.textContent=`${count} ekip arkadaşı · ${visibleUnits} birim${query?' · Arama: '+search.value.trim():''}`;
    empty.hidden=count!==0;
  }
  function select(unit){selected=units.has(unit)?unit:'all';apply();}
  controls.hidden=false;results.hidden=false;
  search.addEventListener('input',apply);
  filters.forEach(button=>button.addEventListener('click',()=>select(button.dataset.filter)));
  document.querySelectorAll('[data-explore]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();search.value='';select(link.dataset.explore);document.getElementById('kadro').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}));
  document.querySelector('[data-reset]').addEventListener('click',()=>{search.value='';select('all');search.focus();});
  function openProfile(id,button){
    const person=people.get(id);if(!person)return;
    trigger=button;
    const image=dialog.querySelector('img');image.src=person.src;image.alt=person.name;
    document.getElementById('profile-name').textContent=person.name;
    document.getElementById('profile-unit').textContent=person.unitName;
    document.getElementById('profile-role').textContent=person.role;
    dialog.showModal();
    dialog.querySelector('button').focus();
  }
  document.querySelectorAll('[data-profile],[data-person]').forEach(button=>button.addEventListener('click',()=>openProfile(button.dataset.profile||button.dataset.person,button)));
  dialog.querySelector('button').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{dialog.querySelector('img').removeAttribute('src');if(trigger&&trigger.isConnected&&!trigger.hidden)trigger.focus();});
  apply();
})();

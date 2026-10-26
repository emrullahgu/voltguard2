/* Native details and links work without JavaScript; enhance only search/filter controls. */
(function () {
  'use strict';
  var root = document.getElementById('homeDirectory');
  if (!root) return;
  var search = document.getElementById('homeDirectorySearch');
  var category = document.getElementById('homeDirectoryCategory');
  var count = document.getElementById('homeDirectoryCount');
  var empty = document.getElementById('homeDirectoryEmpty');
  var reset = document.getElementById('homeDirectoryReset');
  var controls = document.getElementById('homeDirectoryControls');
  var actions = document.getElementById('homeDirectoryActions');
  if (!search || !category || !count || !empty || !reset || !controls || !actions) return;
  function normalize(value) {
    var text = String(value || '');
    if (text.normalize) text = text.normalize('NFKD');
    return text.replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  var groups = Array.prototype.map.call(root.querySelectorAll('[data-directory-group]'), function (group) {
    return {element:group, category:group.getAttribute('data-directory-group'), label:group.querySelector('[data-directory-group-count]'),
      rows:Array.prototype.map.call(group.querySelectorAll('[data-directory-entry]'), function (row) {
        return {element:row,text:normalize(row.getAttribute('data-directory-search')),kind:row.getAttribute('data-directory-kind')};
      })};
  });
  var total = groups.reduce(function(n,g){return n+g.rows.length;},0), savedOpen=null;
  var optionLabels=Array.prototype.map.call(category.options,function(option){return option.textContent.replace(/\s+\(\d+\)$/,'');});
  function apply() {
    var query=normalize(search.value), words=query?query.split(' '):[], filtered=!!query||category.value!=='all';
    if (filtered && !savedOpen) savedOpen=groups.map(function(g){return g.element.open;});
    var shown=0, visibleGroups=0;
    groups.forEach(function(group,index){
      var matched=0, inCategory=category.value==='all'||category.value===group.category;
      group.rows.forEach(function(row){
        var visible=inCategory&&words.every(function(word){return row.text.indexOf(word)!==-1;});
        row.element.hidden=!visible;
        if (visible) matched++;
      });
      group.element.hidden=matched===0;
      if (filtered) group.element.open=matched>0;
      else if (savedOpen) group.element.open=savedOpen[index];
      group.label.textContent=filtered ? matched+' / '+group.rows.length+' içerik' : group.rows.length+' içerik';
      if (matched) visibleGroups++;
      shown+=matched;
    });
    if (!filtered) savedOpen=null;
    count.textContent=filtered?shown+' / '+total+' içerik bağlantısı bulundu.':total+' içerik bağlantısı · '+groups.length+' kategori';
    empty.hidden=shown!==0; reset.hidden=!filtered;
    actions.hidden=visibleGroups===0;
  }
  function clear(){search.value='';category.value='all';apply();search.focus();}
  search.addEventListener('input',apply);search.addEventListener('search',apply);
  search.addEventListener('keydown',function(event){if(event.key==='Escape'&&(search.value||category.value!=='all')){event.preventDefault();clear();}});
  category.addEventListener('change',apply);reset.addEventListener('click',clear);
  document.getElementById('homeDirectoryOpen').addEventListener('click',function(){groups.forEach(function(g){if(!g.element.hidden)g.element.open=true;});});
  document.getElementById('homeDirectoryClose').addEventListener('click',function(){groups.forEach(function(g){g.element.open=false;});});
  apply(); controls.hidden=false; actions.hidden=false;

  // New published VoltHaber articles live in PHP storage, not the static sitemap.
  // A complete successful read replaces only those rows; failures retain the
  // published build snapshot and the archive link, without blocking navigation.
  var liveStarted=false;
  async function refreshLive() {
    if (liveStarted || !window.VGHomeVoltHaber) return;
    liveStarted=true;
    try {
      var response=await window.VGHomeVoltHaber.readEntries();
      if (!response || !response.ok || !response.complete || !Array.isArray(response.entries)) return;
      var group=groups.filter(function(g){return g.category==='haberler';})[0];
      if (!group) return;
      var active=document.activeElement, activeRow=active&&active.closest?active.closest('[data-directory-kind="VoltHaber"]'):null;
      var activeHref=activeRow&&activeRow.querySelector('a').getAttribute('href');
      var rows=[];
      var seen=Object.create(null);
      response.entries.forEach(function(entry){
        if (!entry || typeof entry.u!=='string' || !/^\/volthaber\/[a-z0-9][a-z0-9-]{1,88}[a-z0-9]\/$/.test(entry.u) || typeof entry.t!=='string' || !entry.t.trim() || seen[entry.u]) return;
        seen[entry.u]=true;
        var li=document.createElement('li'),a=document.createElement('a'),label=document.createElement('span'),kind=document.createElement('small'),arrow=document.createElement('span');
        var searchable=entry.t+' '+String(entry.keywords||'');
        li.setAttribute('data-directory-entry','');li.setAttribute('data-directory-kind','VoltHaber');li.setAttribute('data-directory-search',searchable);
        a.setAttribute('href',entry.u);label.textContent=entry.t;kind.textContent='VoltHaber';arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');
        a.appendChild(label);a.appendChild(kind);a.appendChild(arrow);li.appendChild(a);
        rows.push({element:li,text:normalize(searchable),kind:'VoltHaber'});
      });
      // Never turn a malformed partial response into missing archive entries.
      if (rows.length!==response.entries.length) return;
      group.rows=group.rows.filter(function(row){if(row.kind==='VoltHaber'){row.element.remove();return false;}return true;});
      var list=group.element.querySelector('ul');
      rows.forEach(function(row){list.appendChild(row.element);group.rows.push(row);});
      total=groups.reduce(function(n,g){return n+g.rows.length;},0);
      Array.prototype.forEach.call(category.options,function(option,index){
        var target=groups.filter(function(g){return g.category===option.value;})[0];
        if(target) option.textContent=optionLabels[index]+' ('+target.rows.length+')';
      });
      apply();
      if(activeHref){
        var replacement=group.rows.filter(function(row){return row.element.querySelector('a').getAttribute('href')===activeHref;})[0];
        var focusTarget=replacement?replacement.element.querySelector('a'):group.element.querySelector('summary');
        focusTarget.focus({preventScroll:true});
      }
    } catch (error) { /* The native links and published snapshot remain usable. */ }
  }
  search.addEventListener('focus',refreshLive,{once:true});
  category.addEventListener('focus',refreshLive,{once:true});
  if(window.IntersectionObserver){
    var liveObserver=new IntersectionObserver(function(entries){if(entries.some(function(e){return e.isIntersecting;})){liveObserver.disconnect();refreshLive();}},{rootMargin:'600px 0px'});
    liveObserver.observe(root);
  } else refreshLive();
}());

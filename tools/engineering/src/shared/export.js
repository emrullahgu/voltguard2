/* VoltGuard: local, dependency-free project backups and locally bundled PDF export. */
(function () {
  'use strict';
  if (window.VoltGuardExports) return;
  const ownScript = document.currentScript;
  const assetBase = new URL('.', ownScript && ownScript.src || location.href);
  const vendorURL = file => new URL(file.replace(/^vendor\//, ''), document.body.dataset.vgVendorBase ? new URL(document.body.dataset.vgVendorBase, location.href) : new URL('vendor/', assetBase)).href;
  const VERSION = 1, MAX_FILE = 32 * 1024 * 1024;
  let busy = false;
  const tool = () => document.body.dataset.vgTool || decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || 'voltguard');
  const title = () => document.body.dataset.vgTitle || document.title.replace(/\s*[|·]\s*VoltGuard.*$/i, '') || 'VoltGuard raporu';
  function originalAttribution() {
    const author = document.body.dataset.vgOriginalAuthor;
    if (!author) return null;
    const source = document.body.dataset.vgOriginalSource;
    return {
      author,
      lines: [`Özgün hesap araçları: ${author}${source ? ` (${source})` : ''}.`, 'Açık kaynak katkıları için teşekkür ederiz. Site uyarlaması: VoltGuard.']
    };
  }
  function originNotice(doc, className) {
    const origin = originalAttribution();
    if (!origin) return null;
    const notice = doc.createElement('div'); notice.className = className;
    origin.lines.forEach(line => { const span = doc.createElement('span'); span.textContent = line; notice.appendChild(span); });
    return notice;
  }
  function ensurePrintAttribution() {
    const existing = document.getElementById('vg-print-origin');
    if (existing) existing.remove();
    const notice = originNotice(document, 'vg-print-origin');
    if (notice) { notice.id = 'vg-print-origin'; document.body.appendChild(notice); }
  }
  function pdfProperties() {
    const origin = originalAttribution();
    return { title: title(), subject: 'VoltGuard hesap raporu', author: origin ? `${origin.author}; VoltGuard uyarlaması` : 'VoltGuard', creator: 'VoltGuard rapor katmanı', keywords: 'elektrik, mühendislik, hesap, rapor' };
  }
  const jsonText = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const cleanName = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/İ/g, 'I').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'voltguard';
  const filename = ext => `voltguard-${cleanName(title())}-${new Date().toLocaleDateString('sv-SE')}.${ext}`;
  const fields = root => Array.from(root.querySelectorAll('input:not([type=file]):not([type=password]):not([type=hidden]):not([type=button]):not([type=submit]),select,textarea')).filter(el => !el.closest('#vg-export,[data-vg-no-print]'));
  const waitFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  function status(message, error = false) {
    const box = document.getElementById('vg-export-status');
    if (box) { box.textContent = message; box.dataset.error = String(error); }
  }
  async function run(label, action) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('#vg-export button').forEach(b => { b.disabled = true; });
    status(label);
    try { await action(); }
    catch (error) { console.error('[VoltGuard export]', error); status(error.message || 'Dosya hazırlanamadı. Girdileri kontrol edip tekrar deneyin.', true); }
    finally { busy = false; document.querySelectorAll('#vg-export button').forEach(b => { b.disabled = false; }); }
  }
  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; a.hidden = true; document.body.appendChild(a); a.click(); a.remove();
    // Safari and mobile browsers need the object URL alive until their download starts.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function storageKeys() {
    try { const keys = JSON.parse(document.body.dataset.vgStorageKeys || '[]'); return Array.isArray(keys) ? keys.filter(k => typeof k === 'string' && k.length < 240) : []; }
    catch (_) { return []; }
  }
  function snapshotFields() {
    return fields(document).map((el, index) => ({ id: el.id || '', name: el.name || '', index, tag: el.tagName, type: el.type || '', value: el.value, checked: /^(radio|checkbox)$/.test(el.type) ? el.checked : undefined, selected: el.multiple ? Array.from(el.selectedOptions, o => o.value) : undefined }));
  }
  function restoreFields(records, trigger = true) {
    const all = fields(document), changed = [];
    records.forEach(record => {
      let el = record.id ? document.getElementById(record.id) : all[record.index];
      if (!el || el.tagName !== record.tag || el.type === 'password' || el.type === 'file' || el.closest('#vg-export')) return;
      if (!record.id && record.name && el.name !== record.name) return;
      el.value = record.value;
      if (typeof record.checked === 'boolean') el.checked = record.checked;
      if (el.multiple && Array.isArray(record.selected)) Array.from(el.options).forEach(o => { o.selected = record.selected.includes(o.value); });
      changed.push(el);
    });
    // Assign all values first, then notify native calculations; one field must not erase another.
    if (trigger) changed.forEach(el => { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  }
  function nativeAdapter() {
    if (window.VoltGuardExportAdapter) return window.VoltGuardExportAdapter;
    if (typeof window.collectState === 'function' && typeof window.applyState === 'function') return { getState: () => window.collectState(), setState: s => window.applyState(s), embeddedId: 'embeddedState' };
    if (typeof window.stateObj === 'function' && typeof window.applyState === 'function') return { getState: () => window.stateObj(), setState: s => { window.applyState(s); if (typeof window.calc === 'function') window.calc(); }, embeddedId: 'saved-state' };
    if (typeof window.durumAl === 'function' && typeof window.durumUygula === 'function') return { getState: () => window.durumAl(), setState: s => { window.durumUygula(s); if (typeof window.hesapla === 'function') window.hesapla(); }, embeddedId: 'saved-state' };
    if (typeof window._snap === 'function' && typeof window._yukle === 'function') return { getState: () => JSON.parse(window._snap()), setState: s => { window._yukle(JSON.stringify(s)); if (typeof window.refresh === 'function') window.refresh(); if (typeof window.buildScene === 'function') window.buildScene(); if (typeof window.draw2Dvarsa === 'function') window.draw2Dvarsa(); }, stateComment: true };
    if (typeof window.gatherState === 'function') return { getState: () => { if (typeof window.commitPending === 'function') window.commitPending(); return window.gatherState(); }, embeddedId: '__embedded_state__', importWithNative: 'loadFile' };
    return null;
  }
  function flush() {
    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) { active.dispatchEvent(new Event('change', { bubbles: true })); active.blur(); }
    const adapter = nativeAdapter();
    if (adapter && adapter.flush) adapter.flush();
  }
  function projectSnapshot() {
    flush();
    const storage = Object.create(null);
    storageKeys().forEach(key => { try { const value = localStorage.getItem(key); if (value !== null) storage[key] = value; } catch (_) {} });
    const adapter = nativeAdapter();
    const state = adapter && adapter.getState ? adapter.getState() : null;
    const project = { format: 'voltguard-project', version: VERSION, tool: tool(), title: title(), exportedAt: new Date().toISOString(), fields: snapshotFields(), storage, nativeState: state };
    const origin = originalAttribution();
    if (origin) project.attribution = { originalAuthor: origin.author, originalSource: document.body.dataset.vgOriginalSource || '', acknowledgment: origin.lines.join(' '), adaptation: 'VoltGuard' };
    return project;
  }
  function validateProject(project) {
    if (!project || project.format !== 'voltguard-project' || project.version !== VERSION || project.tool !== tool()) throw new Error('Bu proje dosyası bu araca ait değil veya desteklenmeyen bir sürüm kullanıyor.');
    if (!Array.isArray(project.fields) || project.fields.length > 20000 || !project.storage || typeof project.storage !== 'object' || Array.isArray(project.storage)) throw new Error('Proje dosyasının yapısı geçersiz.');
    project.fields.forEach(r => { if (!r || typeof r.value !== 'string' || !Number.isInteger(r.index) || typeof r.tag !== 'string' || r.index < 0 || r.index > 20000 || (r.id && typeof r.id !== 'string')) throw new Error('Proje alanları geçersiz.'); });
    Object.entries(project.storage).forEach(([key, value]) => { if (!storageKeys().includes(key) || typeof value !== 'string') throw new Error('Proje dosyasında bu araca ait olmayan bir kayıt var.'); });
    // Imported JSON is data only. Reject keys that can affect object prototypes in native importers.
    function check(value, depth) { if (depth > 80) throw new Error('Proje verisi çok karmaşık.'); if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => { if (['__proto__', 'prototype', 'constructor'].includes(k)) throw new Error('Proje verisinde geçersiz anahtar bulundu.'); check(v, depth + 1); }); }
    check(project.nativeState, 0);
    Object.values(project.storage).forEach(value => { let parsed; try { parsed = JSON.parse(value); } catch (_) { return; } check(parsed, 0); });
    return project;
  }
  function applyNative(project) {
    const adapter = nativeAdapter();
    if (project.nativeState && adapter && adapter.setState) { adapter.setState(project.nativeState); return true; }
    if (project.nativeState && adapter && adapter.importWithNative && typeof window[adapter.importWithNative] === 'function') {
      const file = new File([JSON.stringify(project.nativeState)], 'voltguard-project.json', { type: 'application/json' });
      window[adapter.importWithNative]({ target: { files: [file], value: '' } });
      return true;
    }
    return false;
  }
  async function importProject(file) {
    if (!file) return;
    if (file.size > MAX_FILE) throw new Error('Proje dosyası 32 MB sınırını aşıyor.');
    const project = validateProject(JSON.parse(await file.text()));
    const nativeApplied = applyNative(project);
    if (Object.keys(project.storage).length && !nativeApplied) {
      // Native modules reconstruct private tab/row models during initialization.
      // Persist only this module's allowlisted keys, then restore scalar fields after reload.
      try {
        sessionStorage.setItem(`vg-project-pending:${tool()}`, jsonText(project));
        Object.entries(project.storage).forEach(([key, value]) => localStorage.setItem(key, value));
      } catch (_) { throw new Error('Tarayıcı proje kayıt alanını kullanamıyor. Çevrimdışı HTML kopyasını açın veya bu site için kayıt izni verin.'); }
      location.reload(); return;
    }
    restoreFields(project.fields, !nativeApplied);
    status('Proje açıldı. Girdiler ve kayıtlı proje verileri geri yüklendi.');
  }
  function syncClone(clone, replaceCanvases = true) {
    const original = fields(document), copies = fields(clone);
    original.forEach((el, i) => {
      const copy = copies[i]; if (!copy) return;
      if (el.tagName === 'TEXTAREA') copy.textContent = el.value;
      else if (el.tagName === 'SELECT') Array.from(copy.options).forEach((o, n) => { o.toggleAttribute('selected', el.options[n].selected); });
      else { copy.setAttribute('value', el.value); copy.toggleAttribute('checked', !!el.checked); }
    });
    if (!replaceCanvases) return;
    const canvases = Array.from(document.querySelectorAll('canvas'));
    Array.from(clone.querySelectorAll('canvas')).forEach((copy, i) => {
      try { const img = document.createElement('img'); img.src = canvases[i].toDataURL('image/png'); img.setAttribute('style', copy.getAttribute('style') || ''); img.style.maxWidth = '100%'; img.width = canvases[i].width; img.height = canvases[i].height; img.alt = canvases[i].getAttribute('aria-label') || 'Hesap çizimi'; copy.replaceWith(img); }
      catch (_) { throw new Error('Bir çizim dış kaynak nedeniyle kaydedilemiyor. Kaynak görseli kontrol edin.'); }
    });
  }
  async function loadPdfDependencies() {
    for (const [test, file] of [[() => typeof window.html2canvas === 'function', 'vendor/html2canvas.min.js'], [() => window.jspdf && window.jspdf.jsPDF, 'vendor/jspdf.umd.min.js']]) {
      if (test()) continue;
      await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = vendorURL(file); script.dataset.vgVendor = 'true'; script.dataset.vgVendorFile = file;
        const timer = setTimeout(() => { script.remove(); reject(new Error('PDF bileşeni yüklenemedi. Sayfayı yenileyin veya çevrimdışı HTML dosyasını kullanın.')); }, 15000);
        script.onload = () => { clearTimeout(timer); resolve(); }; script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('PDF bileşeni yüklenemedi. Sayfayı yenileyin veya çevrimdışı HTML dosyasını kullanın.')); }; document.head.appendChild(script);
      });
    }
  }
  function printStyleRules() {
    const rules = [];
    function visit(list) {
      Array.from(list || []).forEach(rule => {
        if (rule.type === 4 && /(^|\W)print(\W|$)/i.test(rule.conditionText || '')) rules.push(Array.from(rule.cssRules, r => r.cssText).join('\n'));
        else if (rule.type === 4 && rule.cssRules) visit(rule.cssRules);
      });
    }
    Array.from(document.styleSheets).forEach(sheet => { try { visit(sheet.cssRules); } catch (_) {} });
    return rules.join('\n');
  }
  function prepareReport(options = {}) {
    flush();
    if (document.documentElement.dataset.vgInvalid === 'true') throw new Error('Girdilerde hata var. Geçerli bir rapor indirmek için belirtilen alanları düzeltip yeniden hesaplayın.');
    const adapter = nativeAdapter();
    if (adapter && adapter.buildReport) adapter.buildReport();
    else if (typeof window.buildPrint === 'function') window.buildPrint();
    else if (typeof window.buildReport === 'function') window.buildReport(true);
    else if (typeof window.printA4 === 'function' && document.getElementById('printArea')) {
      // The native single-line diagram builds its print SVG inside printA4.
      const print = window.print;
      try { window.print = function () {}; window.printA4(); } finally { window.print = print; }
    }
    if (options.allPages && tool() === 'kabul-tutanagi' && typeof window.tumAltSayfalariCiz === 'function') {
      if (typeof window.ciz === 'function') window.ciz();
      window.tumAltSayfalariCiz(); document.body.classList.add('yazdir-tum');
    }
    window.dispatchEvent(new Event('beforeprint'));
    if (document.documentElement.dataset.vgInvalid === 'true') throw new Error('Hesap doğrulanamadı. Rapordan önce girdileri düzeltip yeniden hesaplayın.');
    const host = ['printReport', 'printArea', 'printPage', 'a4Sar'].map(id => document.getElementById(id)).find(el => el && (el.textContent.trim() || el.querySelector('svg,img,canvas,table')));
    if (!host && ['printReport', 'printArea', 'printPage'].some(id => document.getElementById(id))) throw new Error('Rapor için yeterli veri yok. Hesabı tamamlayıp tekrar deneyin.');
    ensurePrintAttribution();
    return host;
  }
  const reportCSS = `html,body{margin:0!important;padding:0!important;background:#fff!important;color:#173247!important;min-width:0!important;min-height:0!important;overflow:visible!important;zoom:1!important}body{font-family:Arial,"Segoe UI",sans-serif!important}#vg-export,.vg-tool-bar,.vg-module-header,[data-vg-no-print],button,input[type=file],input[type=button],input[type=submit],.toast,.modal{display:none!important}.vg-report-host{display:block!important;visibility:visible!important;position:static!important;max-width:100%!important;min-width:0!important;width:100%!important;height:auto!important;overflow:visible!important;margin:0!important;padding:0!important}.vg-report-host>div{max-width:100%}img,svg,canvas{max-width:100%}table{border-collapse:collapse}thead{display:table-header-group}.vg-report-banner{display:flex!important;justify-content:space-between;gap:14px;border-bottom:2px solid #1383b1;padding:0 0 9px!important;margin:0 0 15px!important;color:#18394a!important;font:11px/1.4 Arial,sans-serif!important}.vg-report-banner strong{font-size:18px;color:#087fae;flex-shrink:0}.vg-report-banner>span{min-width:0;text-align:right;overflow-wrap:anywhere;white-space:normal!important}.vg-field-value{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;color:inherit;display:inline-block;padding:2px 3px;margin:0 3px;min-height:1em}a{color:inherit;text-decoration:none}.vg-report-host .pbrk,.vg-report-host .pp,.vg-report-host .rp{page-break-before:auto!important;break-before:auto!important}.vg-report-host .pp+.pp,.vg-report-host .rp+.rp{margin-top:24px!important}`;
  const brandedReportCSS = reportCSS.replace('border-bottom:2px solid #1383b1', 'border-bottom:2px solid #f59e0b')
    .replace('font-size:18px;color:#087fae', 'font-size:18px;color:#0a1628')
    + '\n.vg-report-credit{display:block!important;position:static!important;visibility:visible!important;max-width:100%!important;margin:0 0 12px!important;padding:6px 8px!important;border:1px solid #d8e0e7!important;border-radius:4px;background:#fff!important;color:#526277!important;font:10px/1.45 Arial,"Segoe UI",sans-serif!important;white-space:normal!important;overflow-wrap:anywhere!important;break-inside:avoid!important}.vg-report-credit>span{display:block!important}';
  async function reportFrame(host) {
    const frame = document.createElement('iframe'); frame.className = 'vg-report-frame'; frame.setAttribute('aria-hidden', 'true'); frame.title = 'PDF rapor hazırlama'; frame.width = '718'; frame.height = '900';
    // Scripts never run in the report copy.
    frame.setAttribute('sandbox', 'allow-same-origin'); document.body.appendChild(frame);
    try {
    const doc = frame.contentDocument;
    doc.open(); doc.write('<!doctype html><html lang="tr"><head><meta charset="utf-8"></head><body></body></html>'); doc.close();
    doc.body.className = document.body.className;
    const clone = document.documentElement.cloneNode(true); syncClone(clone);
    clone.querySelectorAll('script,iframe,base').forEach(el => el.remove());
    clone.querySelectorAll('[role=tabpanel][hidden]').forEach(el => el.remove());
    clone.querySelectorAll('*').forEach(el => Array.from(el.attributes).forEach(a => { if (/^on/i.test(a.name)) el.removeAttribute(a.name); }));
    clone.querySelectorAll('style,link[rel=stylesheet]').forEach(el => { const copy = el.cloneNode(true); if (copy.tagName === 'LINK') copy.href = new URL(copy.getAttribute('href'), location.href).href; doc.head.appendChild(doc.importNode(copy, true)); });
    const ps = doc.createElement('style'); ps.textContent = printStyleRules() + '\n' + brandedReportCSS; doc.head.appendChild(ps);
    const root = host ? clone.querySelector(`[id="${host.id}"]`) : clone.querySelector('body');
    if (!root) { frame.remove(); throw new Error('Rapor görünümü oluşturulamadı.'); }
    const section = host ? doc.importNode(root, true) : doc.createElement('div');
    if (!host) Array.from(root.childNodes).forEach(n => section.appendChild(doc.importNode(n, true)));
    section.classList.add('vg-report-host'); section.style.setProperty('display', 'block', 'important');
    if (document.getElementById('vg-tool-workspace') && section.id !== 'vg-tool-workspace' && !section.querySelector('#vg-tool-workspace')) {
      const workspace = doc.createElement('div'); workspace.id = 'vg-tool-workspace'; workspace.appendChild(section); doc.body.appendChild(workspace);
    } else doc.body.appendChild(section);
    section.querySelectorAll('#vg-export,#vg-top,#vg-origin,#vg-print-origin,.vg-report-credit,.vg-report-frame,.vg-tool-bar,.vg-module-header,[data-vg-no-print]').forEach(el => el.remove());
    const banner = doc.createElement('div'); banner.className = 'vg-report-banner';
    const brand = doc.createElement('strong'); brand.textContent = 'VoltGuard';
    const info = doc.createElement('span'); info.textContent = `${title()} · ${new Date().toLocaleString('tr-TR')}`; banner.append(brand, info); section.prepend(banner);
    const origin = originNotice(doc, 'vg-report-credit');
    if (origin) banner.after(origin);
    // Print copies display the current values, never browser-dependent form widgets.
    fields(section).forEach(el => {
      if (el.type === 'range') { el.remove(); return; }
      const value = doc.createElement('span'); value.className = 'vg-field-value';
      value.textContent = /^(checkbox|radio)$/.test(el.type) ? (el.hasAttribute('checked') ? '✓' : '—') : el.tagName === 'SELECT' ? Array.from(el.selectedOptions, o => o.textContent).join(', ') : el.tagName === 'TEXTAREA' ? el.textContent : el.getAttribute('value') || '';
      el.replaceWith(value);
    });
    await Promise.all(Array.from(doc.querySelectorAll('link[rel=stylesheet]'), link => link.sheet ? Promise.resolve() : new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Rapor stilleri yüklenemedi. Sayfayı yenileyip tekrar deneyin.')), 10000);
      link.onload = () => { clearTimeout(timer); resolve(); }; link.onerror = () => { clearTimeout(timer); reject(new Error('Rapor stilleri yüklenemedi.')); };
    })));
    await Promise.all(Array.from(doc.querySelectorAll('img')).filter(img => { const rect = img.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }).map(img => img.complete && img.naturalWidth ? Promise.resolve() : new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Rapordaki bir görsel yüklenemedi. Görseli kontrol edip tekrar deneyin.')), 10000);
      img.onload = () => { clearTimeout(timer); resolve(); }; img.onerror = () => { clearTimeout(timer); reject(new Error('Rapordaki bir görsel yüklenemedi.')); };
    })));
    if (doc.fonts && doc.fonts.ready) await doc.fonts.ready;
    // Source calculators mix dark panels with the site's light theme. Use an ink-
    // friendly report surface while keeping the original SVG/canvas chart colors.
    const view = doc.defaultView;
    const rgb = value => { const m = String(value).match(/rgba?\(([^)]+)\)/); return m ? m[1].split(/[, ]+/).filter(Boolean).map(Number) : null; };
    function tone(color) {
      const c = rgb(color); if (!c) return '#173247';
      if (c[0] > c[1] * 1.45 && c[0] > c[2] * 1.25) return '#a92a32';
      if (c[1] > c[0] * 1.4 && c[1] > c[2] * 1.15) return '#176544';
      if (c[2] > c[0] * 1.4) return '#086c97';
      return '#173247';
    }
    Array.from(section.querySelectorAll('*')).forEach(el => {
      if (el.closest('svg') || /^(IMG|CANVAS)$/.test(el.tagName)) return;
      const style = view.getComputedStyle(el), bg = rgb(style.backgroundColor), fg = rgb(style.color);
      const chartSurface = el.children.length <= 2 && Array.from(el.children).some(child => /^(svg|canvas)$/i.test(child.tagName));
      if (!chartSurface && (/gradient\(/i.test(style.backgroundImage) || bg && (bg[3] === undefined || bg[3] > .4) && (.2126 * bg[0] + .7152 * bg[1] + .0722 * bg[2]) < 115)) {
        el.style.setProperty('background', '#ffffff', 'important'); el.style.setProperty('color', tone(style.color), 'important');
        el.style.setProperty('border-color', '#b5c8d2', 'important'); el.style.setProperty('box-shadow', 'none', 'important');
      } else if (!chartSurface && fg && (.2126 * fg[0] + .7152 * fg[1] + .0722 * fg[2]) > 155) el.style.setProperty('color', tone(style.color), 'important');
    });
    section.querySelectorAll('.kurul').forEach(row => {
      const columns = Array.from(row.children).filter(el => el.classList.contains('uye'));
      if (!columns.length) return;
      row.style.setProperty('display', 'table', 'important'); row.style.setProperty('table-layout', 'fixed', 'important'); row.style.setProperty('width', '100%', 'important'); row.style.setProperty('border-spacing', '2mm 0', 'important');
      columns.forEach(column => {
        column.style.setProperty('display', 'table-cell', 'important'); column.style.setProperty('width', `${100 / columns.length}%`, 'important'); column.style.setProperty('vertical-align', 'top', 'important');
        const role = column.querySelector('.rolad'); if (role) { role.style.setProperty('display', 'block', 'important'); role.style.setProperty('width', '100%', 'important'); role.style.setProperty('text-align', 'center', 'important'); }
      });
    });
    await waitFrame();
    // Render each signature role in its measured column. Repeated empty-name
    // flex/table labels otherwise acquire incorrect canvas text offsets.
    section.querySelectorAll('.kurul .rolad').forEach(role => {
      const rect = role.getBoundingClientRect(), style = view.getComputedStyle(role);
      if (!rect.width || !rect.height) return;
      const ns = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(ns, 'svg'), text = doc.createElementNS(ns, 'text');
      svg.setAttribute('xmlns', ns); svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`); svg.setAttribute('width', String(rect.width)); svg.setAttribute('height', String(rect.height)); svg.style.cssText = `display:block;width:100%;height:${rect.height}px`;
      text.setAttribute('x', String(rect.width / 2)); text.setAttribute('y', String(rect.height / 2 + parseFloat(style.fontSize) * .34)); text.setAttribute('text-anchor', 'middle'); text.setAttribute('font-family', style.fontFamily); text.setAttribute('font-size', style.fontSize); text.setAttribute('font-weight', style.fontWeight); text.setAttribute('fill', style.color); text.textContent = role.textContent; svg.appendChild(text); role.replaceWith(svg);
    });
    await waitFrame();
    // Native schematic SVGs use millimetre dimensions for browser printing.
    // Give the canvas renderer an image with explicit pixel dimensions instead;
    // an SVG with only a millimetre width can otherwise become a blank capture.
    if (tool() === 'ag-tek-hat-semasi') {
      for (const svg of section.querySelectorAll('svg')) {
        const rect = svg.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        const copy = svg.cloneNode(true);
        copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        copy.setAttribute('width', String(Math.ceil(rect.width)));
        copy.setAttribute('height', String(Math.ceil(rect.height)));
        const img = doc.createElement('img'); img.alt = 'AG dağıtım panosu tek hat şeması';
        img.dataset.vgNativeSchematic = 'true';
        img.width = Math.ceil(rect.width); img.height = Math.ceil(rect.height);
        img.style.cssText = 'display:block;max-width:100%;height:auto;';
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(copy));
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('Tek hat şeması rapora aktarılamadı.')); });
        svg.replaceWith(img);
      }
    }
    return { frame, doc, section };
    } catch (error) { frame.remove(); throw error; }
  }
  function pageSlices(height, maxHeight, protectedRects) {
    const slices = [];
    for (let top = 0; top < height - 1;) {
      let bottom = Math.min(height, top + maxHeight);
      if (bottom < height) {
        const collision = protectedRects.filter(r => r.top > top + maxHeight * .45 && r.top < bottom - 1 && r.bottom > bottom + 1 && r.bottom - r.top < maxHeight * .9).sort((a, b) => a.top - b.top)[0];
        if (collision) bottom = collision.top;
      }
      const size = Math.max(1, Math.floor(bottom - top)); slices.push({ top, height: size }); top += size;
      if (slices.length > 150) throw new Error('Rapor 150 sayfa sınırını aşıyor. Projeyi bölümleyerek indirin.');
    }
    return slices;
  }
  async function pdfBlob(options = {}) {
    await loadPdfDependencies();
    const allPages = options.allPages === undefined ? tool() === 'kabul-tutanagi' : !!options.allPages;
    let report;
    try {
      const host = prepareReport({ allPages }); report = await reportFrame(host);
      const { frame, doc, section } = report;
      if (tool() === 'ag-tek-hat-semasi') {
        const schematic = section.querySelector('img[data-vg-native-schematic]');
        if (!schematic || !schematic.naturalWidth || !schematic.naturalHeight) throw new Error('Tek hat şeması oluşturulamadı.');
        // Draw the native browser-decoded schematic directly. Its print-only
        // container rules are unsuitable for html2canvas's nested iframe clone.
        const scale = 3, width = schematic.naturalWidth, origin = originalAttribution();
        const creditLines = [];
        // Measure Turkish text on the same canvas font used for drawing. This
        // keeps long credits inside the schematic's image on narrow pages.
        if (origin) {
          const measure = document.createElement('canvas').getContext('2d'); measure.font = '11px Arial';
          origin.lines.forEach(line => {
            let row = '';
            line.split(/\s+/).forEach(word => {
              const candidate = row ? `${row} ${word}` : word;
              if (row && measure.measureText(candidate).width > width - 16) { creditLines.push(row); row = word; }
              else row = candidate;
            });
            if (row) creditLines.push(row);
          });
        }
        const headerHeight = 52 + (creditLines.length ? creditLines.length * 15 + 8 : 0);
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil((schematic.naturalHeight + headerHeight) * scale);
        const ctx = canvas.getContext('2d'); ctx.scale(scale, scale); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, canvas.height / scale);
        ctx.fillStyle = '#087fae'; ctx.font = 'bold 18px Arial'; ctx.fillText('VoltGuard', 0, 22);
        ctx.fillStyle = '#18394a'; ctx.font = '11px Arial'; ctx.textAlign = 'right'; ctx.fillText(`${title()} · ${new Date().toLocaleString('tr-TR')}`, width, 22); ctx.textAlign = 'left';
        ctx.strokeStyle = '#1383b1'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 36); ctx.lineTo(width, 36); ctx.stroke();
        ctx.fillStyle = '#526277'; ctx.font = '11px Arial'; creditLines.forEach((line, index) => ctx.fillText(line, 0, 53 + index * 15));
        ctx.drawImage(schematic, 0, headerHeight, width, schematic.naturalHeight);
        const pdf = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
        pdf.setProperties(pdfProperties());
        const imageW = Math.min(190, 270 * canvas.width / canvas.height), imageH = canvas.height * imageW / canvas.width;
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10 + (190 - imageW) / 2, 10, imageW, imageH, undefined, 'FAST');
        pdf.setFontSize(8); pdf.setTextColor(82, 104, 118); pdf.text('VoltGuard', 10, 290); pdf.text('1 / 1', 200, 290, { align: 'right' });
        canvas.width = canvas.height = 1;
        return pdf.output('blob');
      }
      const css = Array.from(document.querySelectorAll('style'), s => s.textContent).join('\n');
      const landscape = /size\s*:\s*A4\s+landscape|size\s*:\s*297mm\s+210mm/i.test(css) || section.scrollWidth > 950;
      const pageW = landscape ? 297 : 210, pageH = landscape ? 210 : 297, margin = 10;
      let width = Math.round((pageW - margin * 2) / 25.4 * 96);
      frame.width = String(width); await waitFrame();
      // Fit the full report width instead of cropping a wide native table or drawing.
      if (section.scrollWidth > width + 4) { width = Math.ceil(section.scrollWidth); frame.width = String(width); await waitFrame(); }
      const height = Math.ceil(Math.max(section.scrollHeight, section.getBoundingClientRect().height));
      if (height < 20 || (!section.textContent.trim() && !section.querySelector('svg,img'))) throw new Error('Rapor boş; PDF oluşturulmadı.');
      const pixelsPerMM = width / (pageW - margin * 2), maxHeight = Math.floor((pageH - margin * 2 - 7) * pixelsPerMM);
      const baseY = section.getBoundingClientRect().top;
      const rects = Array.from(section.querySelectorAll('tr,h1,h2,h3,svg,img,figure,.stat,.kpi,.rp-sec,.emp,.blk,.card,.panel,.box'), el => { const r = el.getBoundingClientRect(); return { top: Math.floor(r.top - baseY), bottom: Math.ceil(r.bottom - baseY) }; }).filter(r => r.bottom > r.top);
      Array.from(section.querySelectorAll('h1,h2,h3,.sec,.geombaslik,.section-title')).forEach(heading => {
        const h = heading.getBoundingClientRect(), next = heading.nextElementSibling;
        if (!next || h.height <= 0 || heading.closest('svg')) return;
        const n = next.getBoundingClientRect();
        if (n.height > 0 && n.top >= h.top) rects.push({ top: Math.floor(h.top - baseY), bottom: Math.ceil(Math.max(h.bottom, n.top + Math.min(n.height, 48)) - baseY) });
      });
      const tables = Array.from(section.querySelectorAll('table'), table => {
        const header = table.tHead || (table.rows[0] && table.rows[0].querySelector('th') ? table.rows[0] : null);
        if (!header) return null;
        const h = header.getBoundingClientRect(), t = table.getBoundingClientRect();
        return { top: Math.floor(h.top - baseY), height: Math.ceil(h.height), bottom: Math.ceil(t.bottom - baseY) };
      }).filter(t => t && t.height > 0 && t.height < maxHeight * .2);
      let slices = [];
      const hardBreaks = Array.from(section.querySelectorAll('.pbrk,.pp+.pp,.rp+.rp'), el => Math.floor(el.getBoundingClientRect().top - baseY));
      for (let top = 0; top < height - 1;) {
        const header = tables.find(t => top >= t.top + t.height && top < t.bottom - 2);
        const budget = maxHeight - (header ? header.height : 0);
        const next = pageSlices(height - top, budget, rects.map(r => ({ top: r.top - top, bottom: r.bottom - top })))[0];
        const forcedBreak = hardBreaks.find(y => y > top + 40 && y < top + next.height - 1);
        if (forcedBreak !== undefined) next.height = forcedBreak - top;
        slices.push({ top, height: next.height, header }); top += next.height;
        if (slices.length > 150) throw new Error('Rapor 150 sayfa sınırını aşıyor. Projeyi bölümleyerek indirin.');
      }
      const paperRects = Array.from(section.querySelectorAll('.a4'), el => { const r = el.getBoundingClientRect(); return { top: Math.floor(r.top - baseY), bottom: Math.ceil(r.bottom - baseY), width: r.width }; }).filter(r => r.width > 0 && r.bottom > r.top);
      if (paperRects.length) {
        // A prepared A4 template is a complete page. Fit it as a whole, including
        // the report banner, rather than spilling its last border onto another page.
        slices = paperRects.map((r, index) => ({ top: index ? r.top : 0, height: r.bottom - (index ? r.top : 0), fitPage: true }));
      } else if (slices.length >= 2) {
        // Keep a short last row or footnote on its report instead of creating
        // a nearly blank second sheet. The complete report remains readable.
        const previous = slices[slices.length - 2], last = slices[slices.length - 1];
        const explicitBreak = hardBreaks.some(top => Math.abs(top - last.top) < 3);
        if (!explicitBreak && !previous.header && !last.header && last.height < maxHeight * .2 && previous.height + last.height <= maxHeight * 1.2) {
          slices.splice(slices.length - 2, 2, { top: previous.top, height: previous.height + last.height, fitPage: true });
        }
      }
      const pdf = new window.jspdf.jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true });
      pdf.setProperties(pdfProperties());
      for (let i = 0; i < slices.length; i++) {
        status(`PDF hazırlanıyor · ${i + 1}/${slices.length} sayfa`);
        const slice = slices[i];
        const canvas = await window.html2canvas(section, { backgroundColor: '#ffffff', scale: Math.min(2, 2400 / width), useCORS: true, allowTaint: false, logging: false, width, height: slice.height, x: 0, y: slice.top, scrollX: 0, scrollY: 0, windowWidth: width, windowHeight: Math.max(900, slice.height), imageTimeout: 10000 });
        if (!canvas.width || !canvas.height) throw new Error('PDF sayfası oluşturulamadı.');
        if (i) pdf.addPage();
        let offset = 0;
        if (slice.header) {
          const header = await window.html2canvas(section, { backgroundColor: '#ffffff', scale: Math.min(2, 2400 / width), logging: false, width, height: slice.header.height, x: 0, y: slice.header.top, scrollX: 0, scrollY: 0, windowWidth: width, windowHeight: 900, useCORS: true });
          offset = slice.header.height / pixelsPerMM;
          pdf.addImage(header.toDataURL('image/png'), 'PNG', margin, margin, pageW - margin * 2, offset, undefined, 'FAST'); header.width = header.height = 1;
        }
        const imageW = slice.fitPage ? Math.min(pageW - margin * 2, (pageH - margin * 2 - 7) * width / slice.height) : pageW - margin * 2;
        const imageH = slice.fitPage ? slice.height * imageW / width : slice.height / pixelsPerMM;
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin + (pageW - margin * 2 - imageW) / 2, margin + offset, imageW, imageH, undefined, 'FAST');
        pdf.setFontSize(8); pdf.setTextColor(82, 104, 118); pdf.text('VoltGuard', margin, pageH - 7); pdf.text(`${i + 1} / ${slices.length}`, pageW - margin, pageH - 7, { align: 'right' });
        canvas.width = canvas.height = 1;
      }
      return pdf.output('blob');
    } finally {
      if (report) report.frame.remove();
      if (allPages && tool() === 'kabul-tutanagi') { document.body.classList.remove('yazdir-tum'); if (typeof window.ciz === 'function') window.ciz(); }
      window.dispatchEvent(new Event('afterprint'));
    }
  }
  const assetCache = new Map();
  async function fetchAsset(url, asData = false) {
    const key = `${asData}:${url}`;
    if (!assetCache.has(key)) assetCache.set(key, (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
      let response;
      try { response = await fetch(url, { credentials: 'same-origin', signal: controller.signal }); }
      catch (_) { throw new Error('Çevrimdışı dosya bileşenleri yüklenemedi. Bağlantıyı kontrol edip tekrar deneyin.'); }
      finally { clearTimeout(timer); }
      if (!response.ok) throw new Error(`Çevrimdışı dosya için bir bileşen yüklenemedi (${response.status}). Sayfayı yenileyip tekrar deneyin.`);
      if (!asData) return response.text();
      const blob = await response.blob();
      return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
    })());
    return assetCache.get(key);
  }
  async function inlineCSS(css, base) {
    const matches = Array.from(css.matchAll(/url\(\s*(["']?)([^)"']+)\1\s*\)/g));
    for (const m of matches) {
      const ref = m[2].trim(); if (/^(data:|#)/i.test(ref)) continue;
      const data = await fetchAsset(new URL(ref, base).href, true); css = css.split(m[0]).join(`url("${data}")`);
    }
    return css;
  }
  function embedNative(clone, project) {
    const adapter = nativeAdapter();
    if (adapter && adapter.embeddedId && project.nativeState) {
      let tag = clone.querySelector(`[id="${adapter.embeddedId}"]`);
      if (!tag) { tag = document.createElement('script'); tag.id = adapter.embeddedId; tag.type = 'application/json'; clone.querySelector('body').prepend(tag); }
      tag.textContent = jsonText(project.nativeState);
    }
    if (adapter && adapter.stateComment && project.nativeState) clone.querySelectorAll('script:not([src])').forEach(script => { if (script.textContent.includes('/*STATE*/')) script.textContent = script.textContent.replace(/\/\*STATE\*\/[\s\S]*?\/\*STATE_END\*\//, `/*STATE*/${jsonText(project.nativeState)}/*STATE_END*/`); });
    // Modules with private models already commit their entire model to local storage.
    const nativeTags = { savedState: ['sehim_v1', 'agaw_v1', 'uplift_v2'], kayitVeri: ['kkt_taslak_v4'], 'saved-state': ['agkdh_v21', 'og_kd_sim_v3'] };
    Object.entries(nativeTags).forEach(([id, keys]) => {
      const tag = clone.querySelector(`[id="${id}"]`); if (!tag || project.nativeState && adapter && adapter.embeddedId === id) return;
      const key = Object.keys(project.storage).find(storedKey => keys.some(k => storedKey === k || storedKey.endsWith(':' + k)));
      if (key) { try { tag.textContent = jsonText(JSON.parse(project.storage[key])); } catch (_) {} }
    });
  }
  async function portableHTML() {
    const project = projectSnapshot(), clone = document.documentElement.cloneNode(true); syncClone(clone, false); embedNative(clone, project);
    // Shared navigation rebinds when the self-contained page is opened from disk.
    clone.removeAttribute('data-vg-shell'); clone.classList.remove('vg-js', 'vg-lock');
    const header = clone.querySelector('#vgHeader');
    if (header) { header.classList.remove('is-open', 'is-scrolled'); header.querySelectorAll('.is-open').forEach(el => el.classList.remove('is-open')); }
    clone.querySelectorAll('#vgHeader [aria-expanded]').forEach(el => el.setAttribute('aria-expanded', 'false'));
    clone.querySelectorAll('#vg-export,#vg-print-origin,.vg-report-frame,base,link[rel=manifest],link[rel=canonical],link[rel=preload],link[rel=prefetch],script[type=speculationrules],script[data-vg-online-only],script[data-vg-vendor],#vg-project-data,#vg-project-boot').forEach(el => el.remove());
    // No open menu, download-progress message, stale loading state or live canvas is saved.
    clone.querySelectorAll('a[href]').forEach(a => { const href = a.getAttribute('href'); if (href && !/^(#|data:|blob:|mailto:|tel:|javascript:)/i.test(href)) a.setAttribute('href', new URL(href, location.href).href); });
    for (const link of Array.from(clone.querySelectorAll('link[rel=stylesheet]'))) {
      const url = new URL(link.getAttribute('href'), location.href).href, style = document.createElement('style');
      style.textContent = await inlineCSS(await fetchAsset(url), url); link.replaceWith(style);
    }
    for (const style of Array.from(clone.querySelectorAll('style'))) style.textContent = await inlineCSS(style.textContent, location.href);
    for (const el of Array.from(clone.querySelectorAll('img[src],link[rel=icon][href],link[rel=apple-touch-icon][href]'))) {
      const attr = el.tagName === 'IMG' ? 'src' : 'href', ref = el.getAttribute(attr);
      if (ref && !/^(data:|#)/i.test(ref)) el.setAttribute(attr, await fetchAsset(new URL(ref, location.href).href, true));
      if (el.tagName === 'IMG') el.removeAttribute('srcset');
    }
    for (const script of Array.from(clone.querySelectorAll('script[src]'))) {
      const url = new URL(script.getAttribute('src'), location.href).href;
      script.textContent = (await fetchAsset(url)).replace(/<\/script/gi, '<\\/script'); script.removeAttribute('src'); script.removeAttribute('integrity'); script.removeAttribute('crossorigin'); script.removeAttribute('defer');
    }
    // PDF remains usable when the downloaded HTML is opened without an internet connection.
    for (const file of ['vendor/html2canvas.min.js', 'vendor/jspdf.umd.min.js']) {
      const bundled = Array.from(document.querySelectorAll('script[data-vg-vendor-file]')).find(s => s.dataset.vgVendorFile === file && !s.src);
      const script = document.createElement('script'); script.dataset.vgVendor = 'true'; script.dataset.vgVendorFile = file; script.textContent = (bundled ? bundled.textContent : await fetchAsset(vendorURL(file))).replace(/<\/script/gi, '<\\/script'); clone.querySelector('head').appendChild(script);
    }
    const retainedNotices = document.getElementById('vg-third-party-notices');
    const noticeText = retainedNotices ? retainedNotices.textContent : await fetchAsset(new URL('third-party-notices.json', assetBase).href);
    const notices = document.createElement('script'); notices.id = 'vg-third-party-notices'; notices.type = 'application/json'; notices.textContent = jsonText(JSON.parse(noticeText)); clone.querySelectorAll('#vg-third-party-notices').forEach(el => el.remove()); clone.querySelector('head').appendChild(notices);
    const data = document.createElement('script'); data.id = 'vg-project-data'; data.type = 'application/json'; data.textContent = jsonText(project); clone.querySelector('head').appendChild(data);
    const boot = document.createElement('script'); boot.id = 'vg-project-boot'; boot.textContent = '(function(){try{var p=JSON.parse(document.getElementById("vg-project-data").textContent);Object.keys(p.storage).forEach(function(k){try{localStorage.setItem(k,p.storage[k])}catch(e){}})}catch(e){}})();';
    // The private native models read their own storage before their original scripts initialize.
    clone.querySelector('head').appendChild(boot);
    clone.querySelector('body').classList.remove('yazdir-tum', 'pt-print'); clone.querySelector('body').style.zoom = '';
    return new Blob(['<!doctype html>\n', clone.outerHTML], { type: 'text/html;charset=utf-8' });
  }
  async function exportPDF(options = {}) { const blob = await pdfBlob(options); saveBlob(blob, filename('pdf')); status('PDF indirildi. Türkçe metinler, tablolar ve çizimler rapora alındı.'); }
  async function exportHTML() { saveBlob(await portableHTML(), filename('html')); status('Çevrimdışı HTML indirildi. Araç ve proje girdileri aynı dosyada.'); }
  function clearLocal() {
    if (!confirm('Bu araca ait tarayıcıdaki proje kayıtları silinsin mi? İndirdiğiniz dosyalar etkilenmez.')) return;
    try { storageKeys().forEach(key => localStorage.removeItem(key)); sessionStorage.removeItem(`vg-project-pending:${tool()}`); }
    catch (_) { throw new Error('Tarayıcı kayıtlarına erişilemiyor. Kayıt iznini kontrol edin.'); }
    location.reload();
  }
  function printA4() {
    let pageStyle;
    try {
      prepareReport();
      const css = Array.from(document.querySelectorAll('style'), s => s.textContent).join('\n');
      const sizes = Array.from(css.matchAll(/@page[^{}]*\{[^}]*?size\s*:\s*([^;}]+)/gi));
      const lastSize = sizes.length ? sizes[sizes.length - 1][1] : '';
      const landscape = /landscape|297mm\s+210mm|420mm\s+297mm/i.test(lastSize);
      pageStyle = document.createElement('style'); pageStyle.id = 'vg-a4-print';
      pageStyle.textContent = `@page{size:A4 ${landscape ? 'landscape' : 'portrait'}!important;margin:8mm!important}@media print{#vg-top,#vg-origin,#vg-export{display:none!important}#printPage .psvg.tam svg{max-width:100%!important;max-height:${landscape ? 175 : 260}mm!important;width:auto!important;height:auto!important}body{padding-bottom:0!important}}`;
      document.head.appendChild(pageStyle);
      window.print(); status('A4 yazdırma penceresi açıldı. PDF olarak kaydet seçeneğini de kullanabilirsiniz.');
    }
    finally { if (pageStyle) pageStyle.remove(); window.dispatchEvent(new Event('afterprint')); }
  }
  function mount() {
    if (document.getElementById('vg-export')) return;
    // Native report buttons and Ctrl+P retain the same source acknowledgment.
    window.addEventListener('beforeprint', ensurePrintAttribution);
    window.addEventListener('afterprint', () => { const notice = document.getElementById('vg-print-origin'); if (notice) notice.remove(); });
    const bar = document.createElement('aside'); bar.id = 'vg-export'; bar.setAttribute('aria-label', 'Rapor ve proje dosyaları'); bar.dataset.html2canvasIgnore = 'true';
    bar.innerHTML = '<details><summary>Rapor & dosya</summary><div class="vg-export-actions"><button class="vg-primary" type="button" data-action="pdf">PDF indir</button><button type="button" data-action="print">A4 yazdır</button><button type="button" data-action="json">Proje JSON indir</button><button type="button" data-action="import">Proje aç</button><button type="button" data-action="html">Çevrimdışı HTML indir</button><button type="button" data-action="clear">Yerel kayıtları temizle</button></div><p class="vg-export-note">Dosyalar bu cihazda hazırlanır. HTML kopyası araç ve proje girdilerini birlikte içerir.</p><p id="vg-export-status" role="status" aria-live="polite"></p><input type="file" accept=".json,application/json" hidden aria-label="VoltGuard proje dosyası"></details>';
    const input = bar.querySelector('input');
    if (tool() === 'kabul-tutanagi') {
      bar.querySelector('[data-action=pdf]').textContent = 'Tutanak PDF (tümü)';
      bar.querySelector('[data-action=print]').textContent = 'Aktif sayfa A4';
      const activePdf = document.createElement('button'); activePdf.type = 'button'; activePdf.dataset.action = 'pdf-active'; activePdf.textContent = 'Aktif sayfa PDF'; bar.querySelector('.vg-export-actions').appendChild(activePdf);
    }
    bar.addEventListener('click', event => {
      const button = event.target.closest('button[data-action]'); if (!button) return;
      const action = button.dataset.action;
      if (action === 'import') { input.click(); return; }
      if (action === 'pdf') run('PDF raporu hazırlanıyor…', exportPDF);
      else if (action === 'pdf-active') run('Aktif sayfa PDF hazırlanıyor…', () => exportPDF({ allPages: false }));
      else if (action === 'print') run('Yazdırma görünümü hazırlanıyor…', printA4);
      else if (action === 'json') run('Proje dosyası hazırlanıyor…', () => { saveBlob(new Blob([JSON.stringify(projectSnapshot(), null, 2)], { type: 'application/json;charset=utf-8' }), filename('json')); status('Proje JSON indirildi. Bu araçta Proje aç ile geri yükleyebilirsiniz.'); });
      else if (action === 'html') run('Çevrimdışı kopya hazırlanıyor…', exportHTML);
      else if (action === 'clear') run('Yerel kayıtlar temizleniyor…', clearLocal);
    });
    input.addEventListener('change', () => { const file = input.files[0]; input.value = ''; if (file) run('Proje açılıyor…', () => importProject(file)); });
    document.body.appendChild(bar);
    // Existing globally named HTML/PDF actions use the same corrected export path.
    ['htmlKaydet', 'saveHTML', 'downloadHTML', 'saveProject', 'saveAs', 'downloadState', 'saveStateAs'].forEach(name => { if (typeof window[name] === 'function') window[name] = function () { return run('Çevrimdışı kopya hazırlanıyor…', exportHTML); }; });
    if (typeof window.exportPDF === 'function') window.exportPDF = () => run('PDF raporu hazırlanıyor…', exportPDF);
    document.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || button.closest('#vg-export')) return;
      if (button.id === 'btnSaveAs' && /farklı\s*kaydet/i.test(button.textContent)) { event.preventDefault(); event.stopImmediatePropagation(); run('Çevrimdışı kopya hazırlanıyor…', exportHTML); }
    }, true);
    let pending = null;
    try { const key = `vg-project-pending:${tool()}`; const value = sessionStorage.getItem(key); if (value) { pending = validateProject(JSON.parse(value)); sessionStorage.removeItem(key); } } catch (_) {}
    const embedded = document.getElementById('vg-project-data');
    if (!pending && embedded) { try { pending = validateProject(JSON.parse(embedded.textContent)); } catch (_) {} }
    if (pending) { applyNative(pending); restoreFields(pending.fields, false); status('Kaydedilmiş proje açıldı.'); }
  }
  // Optional per-module adapter: {getState,setState,flush,buildReport,embeddedId,stateComment}.
  // Exported API enables integration tests without replacing browser download behavior.
  window.VoltGuardExports = Object.freeze({ projectSnapshot, validateProject, importProject, portableHTML, pdfBlob, printA4, exportPDF, exportHTML, pageSlices, cleanName });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})();

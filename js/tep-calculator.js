/* TEP energy converter. ETKB Ek-3, retrieved/checked 2026-10-26.
 * Pure mass/energy/volume inputs only; no liquid-density assumptions or legal thresholds.
 * Source sheet: Enerji Dönüşümü, rows 56 (electricity), 38 (gas), 29 (diesel), 52 (LPG).
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VoltGuardTEP = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var SOURCE = 'https://enerji.gov.tr/Media/Dizin/EVCED/tr/EnerjiVerimlili%C4%9Fi/KamuBinTasHedefi/Ek-3.xlsm';
  var SOURCE_PAGE = 'https://www.enerji.gov.tr/evced-enerji-verimliligi-kamu-binalarinda-tasarruf-hedefi';
  var CHECKED = '2026-10-26';
  var MAX_AMOUNT = 1e12;
  var FUELS = Object.freeze([
    Object.freeze({key:'electricityKwh', label:'Elektrik', unit:'kWh', factor:0.000086, field:'tep-electricity'}),
    Object.freeze({key:'naturalGasM3', label:'Doğal gaz', unit:'m³', factor:0.000825, field:'tep-gas'}),
    Object.freeze({key:'dieselKg', label:'Motorin', unit:'kg', factor:0.00102, field:'tep-diesel'}),
    Object.freeze({key:'lpgKg', label:'LPG', unit:'kg', factor:0.00109, field:'tep-lpg'})
  ]);

  function calculate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {ok:false, error:'Dört enerji kalemi için tüketim miktarlarını girin.'};
    var total = 0, rows = [];
    for (var i = 0; i < FUELS.length; i++) {
      var fuel = FUELS[i], value = input[fuel.key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) {
        return {ok:false, error:fuel.label + ' (' + fuel.unit + '): 0 ile 1.000.000.000.000 arasında bir sayı girin.'};
      }
      var tep = value * fuel.factor;
      total += tep;
      if (!Number.isFinite(tep) || !Number.isFinite(total)) return {ok:false, error:'Tüketim miktarları hesap sınırını aşıyor.'};
      rows.push({key:fuel.key, label:fuel.label, quantity:value, unit:fuel.unit, tep:tep});
    }
    return {ok:true, totalTep:total, breakdown:rows};
  }

  function mount(doc, cfg, host) {
    var box = doc.querySelector('[data-tep-calculator]');
    if (!box || box.getAttribute('data-tep-ready') === 'true' || !cfg || !cfg.ui) return;
    box.setAttribute('data-tep-ready', 'true');
    host = host || window;
    var U = cfg.ui, edited = false, valid = false, busy = false;
    var actions = ['save','share','pdf','print'];
    function tepText(value) {
      return value > 0 && value < 0.000001 ? '< 0,000001 TEP' : U.fmt(value, 6) + ' TEP';
    }
    function buttons() {
      var toolbar = doc.querySelector('.vg-toolbar');
      if (!toolbar) return;
      actions.forEach(function (action) {
        var button = toolbar.querySelector('[data-vg-action="' + action + '"]');
        if (button) button.disabled = !valid || (action === 'pdf' && busy);
      });
    }
    function update() {
      var reader = U.reader(), input = {};
      FUELS.forEach(function (fuel) { input[fuel.key] = reader.num(fuel.field, {min:0, max:MAX_AMOUNT}); });
      var result = reader.error ? {ok:false, error:reader.error} : calculate(input);
      valid = result.ok;
      box.setAttribute('data-calculation-valid', String(valid));
      if (!valid) U.fail('tep', result.error);
      else U.show('tep', {
        value:tepText(result.totalTep),
        note:'Aynı döneme ait dört tüketimin toplamı. Kalemleri kendi kayıtlarınızla tamamlayın.',
        rows:result.breakdown.map(function (row) { return [row.label + ' (' + U.fmt(row.quantity, 4) + ' ' + row.unit + ')', tepText(row.tep)]; }),
        assumptions:[
          'Elektrik: kWh × 0,000086; doğal gaz: m³ × 0,000825; motorin: kg × 0,00102; LPG: kg × 0,00109.',
          'Kaynak: ETKB Ek-3 TEP Dönüşüm Tablosu. Katsayı kontrolü: 26.10.2026. ' + SOURCE_PAGE,
          'Tablodaki alt ısıl değerler esas alınır. Sıvı yakıt litre dönüşümü ve LPG hacmi dahil değildir. Aynı enerji iki kez toplanmaz.'
        ],
        status:edited ? 'hesaplandi' : 'varsayimsal',
        statusReasons:edited ? [] : ['Başlangıç değerleri sıfırdır. Tüketimlerinizi aynı dönem için girin.']
      });
      buttons();
      return valid;
    }
    FUELS.forEach(function (fuel) {
      var input = doc.getElementById(fuel.field);
      input.addEventListener('input', function () { edited = true; update(); });
      input.addEventListener('change', function () { edited = true; update(); });
    });
    U.ensureStyles();
    update();

    function guardToolbar() {
      var toolbar = doc.querySelector('.vg-toolbar');
      if (!toolbar || toolbar.getAttribute('data-tep-guard') === 'true') return false;
      toolbar.setAttribute('data-tep-guard', 'true');
      toolbar.addEventListener('click', async function (event) {
        var button = event.target.closest('[data-vg-action]');
        if (!button || !toolbar.contains(button)) return;
        var action = button.getAttribute('data-vg-action');
        if (actions.indexOf(action) === -1) return;
        // Re-read actual fields before saving/sharing/exporting, including programmatic edits.
        if (!update() || busy) { event.preventDefault(); event.stopImmediatePropagation(); return; }
        if (action !== 'pdf') return;
        event.preventDefault(); event.stopImmediatePropagation();
        busy = true; buttons();
        try {
          await host.VG.Tools.ensureJsPdf();
          // Values can change while the PDF library loads. Never export the stale result.
          if (update()) {
            await host.VG.Tools.exportPdf();
            if (host.vgTrack) host.vgTrack('report_download', {fmt:'pdf', tool:'tep-hesaplama'});
          }
        } catch (error) {
          doc.getElementById('tep-action-status').textContent = error.message || 'PDF hazırlanamadı; yeniden deneyin.';
        } finally { busy = false; buttons(); }
      }, true);
      buttons();
      return true;
    }
    if (!guardToolbar() && host.MutationObserver) {
      var observer = new host.MutationObserver(function () { if (guardToolbar()) observer.disconnect(); });
      observer.observe(box.parentNode, {childList:true});
    }
  }

  return Object.freeze({version:CHECKED, checked:CHECKED, source:SOURCE, sourcePage:SOURCE_PAGE, fuels:FUELS, calculate:calculate, mount:mount});
}));

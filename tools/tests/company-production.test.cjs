'use strict';
const test = require('node:test'), assert = require('node:assert/strict');

test('Malformed thousands groups, financial overflow and different product prices cannot silently change a quote', async () => {
  const { parseDecimal, mergeCartItems, saleLineTotal, saleUnitPrice } = await import('../staff-app/src/operations.mjs');
  for (const value of ['12.34,56', '1.23.4,56', '12,34.56', '1,23,456.78']) assert.equal(parseDecimal(value, null), null, value);
  for (const value of ['1.234,56', '1,234.56', '1234,56', '1234.56']) assert.equal(parseDecimal(value, null), 1234.56, value);
  const item = { name: 'Kablo', category: 'Kablo', unit: 'm', price: 100, quantity: 1 };
  assert.equal(mergeCartItems([item], [{ ...item, price: 120 }]).length, 2);
  assert.equal(mergeCartItems([item], [{ ...item, kdvOrani: 10 }]).length, 2);
  assert.equal(mergeCartItems([item], [{ ...item, unit: 'rulo' }]).length, 2);
  assert.equal(mergeCartItems([item], [{ ...item }])[0].quantity, 2);
  assert.throws(() => saleLineTotal({ ...item, quantity: -1 }, 0, 0));
  assert.throws(() => saleLineTotal({ ...item, price: 1e300, quantity: 1e300 }, 0, 0));
  assert.throws(() => saleUnitPrice({ ...item, price: 1e300 }, 0, 1e300));
});

test('Energy imports reject ambiguous categories, repeated timestamps, empty intervals and overflow', async () => {
  const { detectEnergyType, parseEnergySpreadsheet, prepareEnergyRows, directOsosMeasurements } = await import('../staff-app/src/operations.mjs');
  assert.equal(detectEnergyType([{ OBIS: 'reactive' }]), null);
  assert.equal(detectEnergyType([{ OBIS: '11.8.0' }]), null);
  assert.equal(detectEnergyType([{ OBIS: '1-0:1.8.0*255' }]), 'aktif');
  assert.equal(detectEnergyType([{ OBIS: '5.8.0 / 8.8.0' }]), null);
  assert.equal(detectEnergyType([{ 'Enerji Tipi': 'inductive' }]), 'induktif');
  assert.throws(() => parseEnergySpreadsheet([]));
  assert.throws(() => parseEnergySpreadsheet([{ Tarih: '2026-10-23', 'Okunan Değer': 100 }]));
  assert.throws(() => parseEnergySpreadsheet([{ Tarih: '2026-10-23', Tüketim: 10 }, { Tarih: '2026-10-23', Tüketim: 20 }]));
  assert.throws(() => parseEnergySpreadsheet([{ Tarih: '2026-10-23', 'Okunan Değer': 1e300, Çarpan: 1e300 }]));
  assert.throws(() => parseEnergySpreadsheet([{ Tarih: '2026-10-23', Tüketim: 10, Çarpan: 'geçersiz' }]));
  assert.throws(() => parseEnergySpreadsheet([{ Tarih: '2026-10-23', Tüketim: 'geçersiz', 'Okunan Değer': 100 }, { Tarih: '2026-10-24', 'Okunan Değer': 110 }]));
  assert.throws(() => prepareEnergyRows([{ Tarih: '2026-10-23', Tüketim: 10, Çarpan: 'geçersiz' }], 'aktif'));
  assert.throws(() => prepareEnergyRows([{ Tarih: '2026-10-23', Tüketim: 10 }, { Tarih: '2026-10-23', Tüketim: 20 }], 'aktif'));
  assert.throws(() => directOsosMeasurements([{ tarih: '2026-10-23', frekans: 50 }, { tarih: '2026-10-23', frekans: 51 }], 'A'));
  const large = Array.from({ length: 150000 }, (_, index) => ({ Tarih: 46318 + index / 24, Tüketim: 1 }));
  assert.equal(prepareEnergyRows(large, 'aktif').istatistikler.toplamTuketim, '150000.00');
});

test('OSOS histories keep facilities and meters separate and represent missing measurements neutrally', async () => {
  const { measurementSources, measurementSeries, measurementRange } = await import('../staff-app/src/measurementSources.mjs');
  const rows = [
    { fabrika_adi: 'A', sayac_no: '1', olcum_zamani: '2026-10-23T10:00:00Z', aktif_guc: '12,5' },
    { fabrika_adi: 'A', sayac_no: '2', olcum_zamani: '2026-10-23T11:00:00Z', aktif_guc: 99 },
    { fabrika_adi: 'B', sayac_no: '1', olcum_zamani: '2026-10-23T11:30:00Z', aktif_guc: 88 },
    { fabrika_adi: 'A', sayac_no: '1', olcum_zamani: '2026-10-23T09:00:00Z', aktif_guc: 10 },
    { fabrika_adi: 'A', sayac_no: '1', olcum_zamani: 'invalid', aktif_guc: 999 }
  ];
  assert.equal(measurementSources(rows).length, 3);
  const selected = measurementSeries(rows, { facility: 'A', meter: '1' });
  assert.deepEqual(selected.map(row => row.aktif_guc), [10, 12.5]);
  assert.equal(selected[0].gerilim, null);
  assert.equal(measurementRange('', 207, 253), null);
  assert.equal(measurementRange('230,5', 207, 253), true);
  assert.equal(measurementRange('300', 207, 253), false);
});

test('A generic HTTP success page cannot be reported as a healthy company server', async () => {
  const { checkCompanyHealth } = await import('../staff-app/src/serverHealth.mjs');
  const check = response => checkCompanyHealth({ fetcher: async () => response });
  assert.equal(await check({ ok: true, status: 200, json: async () => ({ api: 'vg-company/1', ok: true, data: { online: true } }) }), true);
  assert.equal(await check({ ok: true, status: 200, json: async () => ({ ok: true }) }), false);
  assert.equal(await check({ ok: true, status: 200, json: async () => { throw new Error('HTML'); } }), false);
  assert.equal(await check({ ok: false, status: 401, json: async () => ({ api: 'vg-company/1', ok: false }) }), true);
  assert.equal(await check({ ok: false, status: 503, json: async () => ({ api: 'vg-company/1', ok: false }) }), false);
});

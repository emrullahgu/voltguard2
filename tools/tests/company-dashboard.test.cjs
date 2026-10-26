'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const load = name => import('../staff-app/src/' + name);

test('Empty company catalog reports no invoice sources, prices or invented VAT', async () => {
  const { dashboardSummary } = await load('dashboardSummary.mjs');
  const empty = dashboardSummary();
  assert.equal(empty.sources, 0);
  assert.equal(empty.averagePrice, null);
  assert.deepEqual(empty.highest, []);
  assert.deepEqual(empty.lowest, []);
  assert.equal(empty.vat, 'Belirtilmedi');
});

test('Historical normalized product rankings retain names, decimal prices and actual source counts', async () => {
  const { normalizeHistoricalInvoice } = await load('historicalCatalog.mjs');
  const { dashboardSummary } = await load('dashboardSummary.mjs');
  const first = normalizeHistoricalInvoice([{ 'ÜRÜN': 'Test kablo', MARKA: 'Test Marka', 'BİRİM FİYAT': '1.234,56' }, { 'ÜRÜN': 'Fiyatsız ürün' }], 'Fatura1');
  const second = normalizeHistoricalInvoice([{ 'Ürün/hizmet': 'Test hizmet', 'Birim fiyatı': '25,50' }, { 'Ürün/hizmet': 'Geçersiz fiyat', 'Birim fiyatı': -5 }], 'Fatura2');
  const result = dashboardSummary(first, second);
  assert.equal(result.sources, 2);
  assert.equal(result.pricedCount, 2);
  assert.equal(result.averagePrice, 630.03);
  assert.equal(result.highest[0].urun, 'Test kablo');
  assert.equal(result.highest[0].birimFiyat, 1234.56);
  assert.equal(result.lowest[0].urun, 'Test hizmet');
  assert.equal(dashboardSummary(first, []).sources, 1);
  assert.equal(first[0].urun, 'Test kablo', 'Ranking does not mutate source order or rows.');
});

test('Cable VAT is shown only when its actual inclusion and rate are supplied', async () => {
  const { dashboardSummary } = await load('dashboardSummary.mjs');
  assert.equal(dashboardSummary([], [], { kdvDahil: true }).vat, 'Dahil');
  assert.equal(dashboardSummary([], [], { kdvDahil: false, kdvOrani: '20,5' }).vat, 'Hariç (%20,5)');
  assert.equal(dashboardSummary([], [], { kdvDahil: false, kdvOrani: 0 }).vat, 'Hariç (%0)');
  for (const data of [{ kdvDahil: false }, { kdvOrani: 20 }, { kdvDahil: 'false', kdvOrani: 20 }, { kdvDahil: false, kdvOrani: -1 }]) assert.equal(dashboardSummary([], [], data).vat, 'Belirtilmedi');
});

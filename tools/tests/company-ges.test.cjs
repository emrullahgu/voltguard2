'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const form = { customerName: 'Sentetik müşteri', offerDate: '2026-10-26', usdRate: 40, autoPower: 12, laborRate: 10, transportRate: 1, overheadRate: 1, marginRate: 20, vatRate: 20 };

test('GES calculations preserve valid loaded values and accept Turkish decimal input without mutating snapshots', async () => {
  const { calculateGESQuote } = await import('../staff-app/src/gesQuote.mjs');
  const original = { ...form, usdRate: '40,50', laborRate: '10,5' };
  const items = [{ desc: 'Test panel', qty: '2,5', price: '1.234,56' }];
  const value = calculateGESQuote(original, items);
  assert.equal(value.items[0].qty, 2.5);
  assert.equal(value.items[0].price, 1234.56);
  for (const [field, expected] of Object.entries({ materialTotal: 3086.4, directCost: 3472.2, finalTotal: 4999.968, tlTotal: 202498.704 })) assert(Math.abs(value.totals[field] - expected) < 1e-8, field);
  assert.equal(original.usdRate, '40,50');
  assert.equal(items[0].price, '1.234,56');
  const restored = calculateGESQuote(value.form, value.items);
  assert.deepEqual(restored, value, 'Reopening a valid snapshot keeps its exact financial inputs and totals.');
});

test('GES rejects missing or nonpositive exchange rate and quantities instead of substituting a price', async () => {
  const { calculateGESQuote } = await import('../staff-app/src/gesQuote.mjs');
  const row = { qty: 1, price: 50 };
  for (const value of [0, -1, '', 'abc', null, Infinity]) assert.throws(() => calculateGESQuote({ ...form, usdRate: value }, [row]), { field: 'usdRate' });
  for (const value of [0, -1, '', '3 kg', Infinity]) assert.throws(() => calculateGESQuote(form, [{ ...row, qty: value }]), { field: 'items.0.qty' });
  for (const value of [-1, '', '3 USD', Infinity]) assert.throws(() => calculateGESQuote(form, [{ ...row, price: value }]), { field: 'items.0.price' });
  assert.equal(calculateGESQuote(form, [{ qty: 1, price: 0 }]).totals.finalTotal, 0, 'A deliberately free line is valid.');
});

test('GES validates rates, date and finite calculated totals', async () => {
  const { calculateGESQuote } = await import('../staff-app/src/gesQuote.mjs');
  const rows = [{ qty: 1, price: 100 }];
  for (const field of ['laborRate', 'transportRate', 'overheadRate', 'marginRate', 'vatRate']) assert.throws(() => calculateGESQuote({ ...form, [field]: -1 }, rows), { field });
  assert.throws(() => calculateGESQuote({ ...form, vatRate: 101 }, rows), { field: 'vatRate' });
  for (const offerDate of ['', '2026-02-30', 'not-a-date']) assert.throws(() => calculateGESQuote({ ...form, offerDate }, rows), { field: 'offerDate' });
  assert.throws(() => calculateGESQuote(form, [{ qty: 1e200, price: 1e200 }]), /tutarı hesaplanamıyor/);
});

test('Default quote date follows the local calendar at Istanbul midnight', async () => {
  const { localISODate } = await import('../staff-app/src/operations.mjs');
  const original = process.env.TZ;
  try {
    process.env.TZ = 'Europe/Istanbul';
    assert.equal(localISODate(new Date('2026-10-25T21:15:00Z')), '2026-10-26');
    assert.equal(localISODate(new Date('2026-12-31T21:05:00Z')), '2027-01-01');
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

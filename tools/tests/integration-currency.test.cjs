'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path'), fs = require('node:fs');
const root = path.resolve(__dirname, '../..'), php = process.env.VG_PHP || path.join(root, '.qa/php/runtime/php.exe');
const adapter = path.join(root, 'api/lib/integration-currency.php');
const runner = `define('VG_API',true);class VgIntegrationError extends RuntimeException{public $status;public $errCode;function __construct($s,$c,$m){parent::__construct($m);$this->status=$s;$this->errCode=$c;}}require $argv[1];$r=json_decode(stream_get_contents(STDIN),true);$calls=[];$fetch=function($method,$url,$options)use(&$calls,$r){$calls[]=['method'=>$method,'url'=>$url,'options'=>$options];return ['status'=>$r['status']??200,'headers'=>[],'body'=>$r['body']];};try{$out=['ok'=>true,'data'=>vg_int_currency($r['action'],$r['input']??[],$fetch)];}catch(VgIntegrationError $e){$out=['ok'=>false,'status'=>$e->status,'error'=>$e->errCode,'message'=>$e->getMessage()];}catch(Throwable $e){$out=['fatal'=>get_class($e).': '.$e->getMessage()];}$out['calls']=$calls;echo json_encode($out,JSON_THROW_ON_ERROR);`;
function request(action, input, body, status = 200) {
  const result = spawnSync(php, ['-n', '-r', runner, adapter], { input: JSON.stringify({ action, input, body: typeof body === 'string' ? body : JSON.stringify(body), status }), encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const value = JSON.parse(result.stdout); assert.equal(value.fatal, undefined, value.fatal); return value;
}
const xml = `<?xml version="1.0"?><Tarih_Date Tarih="30.10.2026" Date="10/30/2026"><Currency CurrencyCode="USD" Kod="USD"><Unit>1</Unit><ForexBuying>39</ForexBuying><ForexSelling>40</ForexSelling><BanknoteBuying>38</BanknoteBuying><BanknoteSelling>41</BanknoteSelling></Currency><Currency CurrencyCode="EUR" Kod="EUR"><Unit>1</Unit><ForexBuying>49</ForexBuying><ForexSelling>50</ForexSelling><BanknoteBuying>48</BanknoteBuying><BanknoteSelling>51</BanknoteSelling></Currency><Currency CurrencyCode="JPY" Kod="JPY"><Unit>100</Unit><ForexBuying>25</ForexBuying><ForexSelling>26</ForexSelling><BanknoteBuying></BanknoteBuying><BanknoteSelling>0</BanknoteSelling></Currency></Tarih_Date>`;
const row = (quote, rate, date = '2026-10-30') => ({ date, base: 'USD', quote, rate, providers: [{ key: 'ECB', date, rate }] });
const exchange = { result: 'success', base_code: 'USD', time_last_update_unix: Date.parse('2026-10-30T00:00:00Z') / 1000, time_next_update_unix: Date.parse('2026-10-31T00:00:00Z') / 1000, time_eol_unix: 0, rates: { USD: 1, TRY: 40, EUR: 0.8 } };

test('TCMB converts original 100 JPY units, cross rates, and all four quote types explicitly', () => {
  const selling = request('tcmb', { base: 'JPY', quotes: 'TRY,USD', date: '2026-10-30' }, xml);
  assert.equal(selling.ok, true); assert.equal(selling.data.rates.TRY, 0.26); assert.equal(selling.data.rates.USD, 0.006500000000000001);
  assert.equal(selling.data.currencyDetails.JPY.unit, 100); assert.equal(selling.data.currencyDetails.JPY.perUnit.forex_selling, 0.26);
  assert.equal(selling.data.date, '2026-10-30'); assert.equal(selling.data.quoteType, 'forex_selling'); assert.equal(selling.data.indicative, true);
  assert.equal(selling.calls[0].url, 'https://www.tcmb.gov.tr/kurlar/202610/30102026.xml');
  for (const [rateType, expected] of [['forex_buying', 39], ['forex_selling', 40], ['banknote_buying', 38], ['banknote_selling', 41]]) assert.equal(request('tcmb', { base: 'USD', quotes: 'TRY', rateType }, xml).data.rates.TRY, expected);
});

test('TCMB missing and zero quotations stay visible and never become a fabricated rate', () => {
  const result = request('tcmb', { base: 'USD', quotes: 'TRY,JPY', rateType: 'banknote_selling' }, xml);
  assert.deepEqual(result.data.rates, { TRY: 41 }); assert.equal(result.data.currencyDetails.JPY.perUnit.banknote_selling, 0); assert.equal(result.data.currencyDetails.JPY.perUnit.banknote_buying, null);
  assert.equal(result.data.warnings.length, 1); assert.match(result.data.warnings[0], /JPY/);
  const absent = request('tcmb', { base: 'JPY', quotes: 'TRY', rateType: 'banknote_buying' }, xml);
  assert.equal(absent.status, 422); assert.equal(absent.error, 'currency_unavailable');
});

test('TCMB rejects external entities, malformed XML, inconsistent dates, and invalid currency inputs', () => {
  for (const body of ['<!DOCTYPE x [<!ENTITY stolen SYSTEM "file:///private">]>' + xml, '<Tarih_Date><Currency>', xml.replace('10/30/2026', '10/29/2026')]) assert.equal(request('tcmb', { base: 'USD' }, body).status, 502);
  assert.equal(request('tcmb', { date: '2026-10-29' }, xml).error, 'currency_date_response');
  for (const input of [{ base: '../../etc' }, { quotes: ['USD'] }, { rateType: 'buy' }, { date: '2026-02-30' }, { from: '2026-10-29', to: '2026-10-30' }]) {
    const result = request('tcmb', input, xml); assert.equal(result.status, 422); assert.equal(result.calls.length, 0);
  }
  assert.equal(request('tcmb', {}, xml, 404).error, 'currency_date_unavailable'); assert.equal(request('tcmb', {}, xml, 429).status, 503);
});

test('Frankfurter v2 preserves expanded provider objects, requests ECB explicitly, and does not mix observation dates', () => {
  const result = request('frankfurter', { base: 'USD', quotes: 'EUR,TRY', from: '2026-10-29', to: '2026-10-30' }, [row('TRY', 39, '2026-10-29'), row('EUR', 0.8), row('TRY', 40)]);
  assert.equal(result.ok, true); assert.deepEqual(result.data.rates, { EUR: 0.8, TRY: 40 }); assert.equal(result.data.date, '2026-10-30');
  assert.deepEqual(result.data.observations[1].providers, ['ECB']); assert.deepEqual(result.data.observations[1].providerDetails, [{ key: 'ECB', date: '2026-10-30', rate: 0.8 }]);
  const url = new URL(result.calls[0].url); assert.equal(url.origin, 'https://api.frankfurter.dev'); assert.equal(url.pathname, '/v2/rates'); assert.equal(url.searchParams.get('providers'), 'ecb'); assert.equal(url.searchParams.get('expand'), 'providers');
  const partial = request('frankfurter', { quotes: 'EUR,TRY' }, [row('EUR', 0.8, '2026-10-29'), row('TRY', 40)]);
  assert.deepEqual(partial.data.rates, { TRY: 40 }); assert.equal(partial.data.warnings.length, 1);
});

test('Frankfurter rejects mismatched sources, currencies, duplicate rows, impossible values, and unbounded ranges', () => {
  for (const body of [[{ ...row('TRY', 40), base: 'EUR' }], [row('GBP', 0.8)], [row('TRY', 0)], [row('TRY', 40), row('TRY', 41)], [{ ...row('TRY', 40), providers: ['ECB'] }], [{ ...row('TRY', 40), providers: [{ key: 'OTHER', date: '2026-10-30', rate: 40 }] }]]) assert.equal(request('frankfurter', {}, body).status, 502);
  for (const input of [{ from: '2024-01-01', to: '2026-10-30' }, { from: '2026-10-30' }, { providers: 'ecb&url=evil' }, { group: 'day' }]) {
    const result = request('frankfurter', input, []); assert.equal(result.status, 422); assert.equal(result.calls.length, 0);
  }
  assert.equal(request('frankfurter', {}, []).status, 404);
});

test('ExchangeRate-API returns one selected conversion with required attribution and real daily timestamps', () => {
  const result = request('exchange_rate', { base: 'USD', quote: 'TRY', amount: '0' }, exchange);
  assert.equal(result.ok, true); assert.deepEqual(result.data.rates, { TRY: 40 }); assert.equal(result.data.convertedAmount, 0); assert.equal(result.data.amount, 0);
  assert.equal(result.data.date, '2026-10-30'); assert.equal(result.data.frequency, 'daily'); assert.equal(result.data.attribution.label, 'Rates By Exchange Rate API'); assert.equal(result.data.attribution.url, 'https://www.exchangerate-api.com');
  assert.equal(result.calls[0].url, 'https://open.er-api.com/v6/latest/USD'); assert.equal(JSON.stringify(result.data).includes('"EUR"'), false, 'Do not mirror the complete open-access rate feed.');
  assert.equal(request('exchange_rate', { amount: '2.5' }, exchange).data.convertedAmount, 100);
});

test('ExchangeRate-API validates timestamps and declines unsupported history and invalid amounts before fetching', () => {
  for (const body of [{ ...exchange, result: 'error' }, { ...exchange, base_code: 'EUR' }, { ...exchange, time_last_update_unix: '123' }, { ...exchange, time_next_update_unix: exchange.time_last_update_unix }, { ...exchange, rates: { TRY: -1 } }]) assert.equal(request('exchange_rate', {}, body).status, 502);
  for (const input of [{ quotes: 'EUR,TRY' }, { date: '2026-10-29' }, { amount: '-1' }, { amount: true }, { amount: '1e200' }, { amount: [] }]) {
    const result = request('exchange_rate', input, exchange); assert.equal(result.status, 422); assert.equal(result.calls.length, 0);
  }
});

test('Read-only recorded live Frankfurter and ExchangeRate-API response shapes pass the same production parsers when available', () => {
  const frank = path.join(root, '.qa/integration-currency-live/frankfurter.json'), open = path.join(root, '.qa/integration-currency-live/exchange_rate.json');
  if (fs.existsSync(frank)) assert.equal(request('frankfurter', { quotes: 'EUR,TRY' }, fs.readFileSync(frank, 'utf8')).ok, true);
  if (fs.existsSync(open)) assert.equal(request('exchange_rate', { quotes: 'TRY' }, fs.readFileSync(open, 'utf8')).ok, true);
});

test('Offer rate preview inverts TRY-base pairs, validates dates, and never silently combines different publications', async () => {
  const { currencySnapshotFromResponses, currencySnapshotMatchesRates, normalizeCurrencySnapshot } = await import('../staff-app/src/currencyRates.mjs');
  const data = { provider: 'tcmb', date: '2026-10-30', retrievedAt: '2026-11-01T10:00:00Z', base: 'TRY', rates: { USD: 0.025, EUR: 0.02 }, observations: [{ date: '2026-10-30', base: 'TRY', quote: 'USD', rate: 0.025, providers: ['tcmb'] }], quoteType: 'forex_selling', indicative: true };
  const snapshot = currencySnapshotFromResponses('tcmb', ['USD', 'EUR'], [data]); assert.deepEqual(snapshot.rates, { USD: 40, EUR: 50 }); assert.equal(snapshot.quote, 'TRY');
  assert.equal(currencySnapshotMatchesRates(snapshot, { USD: '40', EUR: '50' }, ['USD', 'EUR']), true); assert.equal(currencySnapshotMatchesRates(snapshot, { USD: 40.01, EUR: 50 }, ['USD', 'EUR']), false);
  assert.throws(() => currencySnapshotFromResponses('tcmb', ['USD', 'EUR'], [{ ...data, rates: { USD: 0.025 } }]), /doğrulanamadı/);
  assert.throws(() => currencySnapshotFromResponses('tcmb', ['USD'], [{ ...data, rates: { USD: 0 } }]), /geçersiz/);
  for (const date of ['2026-02-30', '2099-01-01']) assert.equal(normalizeCurrencySnapshot({ ...snapshot, date }), null);
  assert.equal(normalizeCurrencySnapshot({ ...snapshot, rates: { USD: Infinity } }), null);
  const copy = normalizeCurrencySnapshot(snapshot); copy.rates.USD = 1; assert.equal(snapshot.rates.USD, 40);
  const usd = { ...data, provider: 'exchange_rate', quoteType: 'indicative', base: 'USD', rates: { TRY: 40 }, observations: [{ ...data.observations[0], base: 'USD', quote: 'TRY', rate: 40 }] };
  const eur = { ...usd, base: 'EUR', rates: { TRY: 50 }, observations: [{ ...usd.observations[0], base: 'EUR', rate: 50 }] };
  assert.deepEqual(currencySnapshotFromResponses('exchange_rate', ['USD', 'EUR'], [usd, eur]).rates, { USD: 40, EUR: 50 });
  assert.throws(() => currencySnapshotFromResponses('exchange_rate', ['USD', 'EUR'], [usd, { ...eur, date: '2026-10-29' }]), /tutarlı/);
});

test('Offer API client forwards cancellation and requires the integration envelope; provenance survives saved proposal round trips', async () => {
  const { fetchCurrencySnapshot } = await import('../staff-app/src/currencyRates.mjs'); const { normalizeProposal } = await import('../staff-app/src/proposalSnapshots.mjs');
  const controller = new AbortController(); const calls = [];
  const fake = async (url, options) => {
    calls.push({ url, options }); const base = new URL(url, 'https://example.test').searchParams.get('base');
    const rate = base === 'USD' ? 40 : 50;
    return { ok: true, json: async () => ({ api: 'vg-integrations/1', ok: true, data: { provider: 'exchange_rate', base, quoteType: 'indicative', date: '2026-10-30', retrievedAt: '2026-11-01T10:00:00Z', rates: { TRY: rate }, indicative: true, observations: [{ date: '2026-10-30', base, quote: 'TRY', rate, providers: ['exchange_rate'] }] } }) };
  };
  const snapshot = await fetchCurrencySnapshot({ provider: 'exchange_rate', codes: ['USD', 'EUR'], signal: controller.signal, fetchImpl: fake });
  assert.equal(calls.length, 2); assert.equal(calls[0].options.signal, controller.signal); assert.equal(calls[0].options.credentials, 'same-origin');
  const saved = normalizeProposal('ges', { form: { usdRate: 40 }, items: [{ qty: 1, price: 20 }], metadata: { exchangeRateSnapshot: snapshot } });
  assert.deepEqual(saved.metadata.exchangeRateSnapshot, snapshot); snapshot.rates.USD = 1; assert.equal(saved.metadata.exchangeRateSnapshot.rates.USD, 40);
  await assert.rejects(fetchCurrencySnapshot({ fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, data: {} }) }) }), /Kur alınamadı/);
  await assert.rejects(fetchCurrencySnapshot({ fetchImpl: async () => ({ ok: false, json: async () => ({ api: 'vg-integrations/1', ok: false, error: { message: 'Kaynak geçici olarak kullanılamıyor.' } }) }) }), /geçici/);
});

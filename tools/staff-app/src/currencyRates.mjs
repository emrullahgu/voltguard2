// Draft-only currency previews. Fetching a rate never changes an offer.
const PROVIDERS = Object.freeze({ tcmb: 'TCMB', frankfurter: 'Frankfurter (ECB)', exchange_rate: 'ExchangeRate-API' });
const TYPES = new Set(['forex_buying', 'forex_selling', 'banknote_buying', 'banknote_selling', 'reference_mid', 'indicative']);
const URLS = Object.freeze({ tcmb: 'https://www.tcmb.gov.tr/kurlar/today.xml', frankfurter: 'https://frankfurter.dev/', exchange_rate: 'https://www.exchangerate-api.com' });
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1e9;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value && value <= new Date().toISOString().slice(0, 10);
const currencyCodes = value => {
  if (!Array.isArray(value) || !value.length || value.some(code => !['USD', 'EUR'].includes(code))) throw Error('Desteklenen teklif para birimini seçin.');
  return [...new Set(value)];
};

export function normalizeCurrencySnapshot(value, required = ['USD']) {
  if (!record(value) || !Object.hasOwn(PROVIDERS, value.provider) || !validDate(value.date) || value.quote !== 'TRY' || !TYPES.has(value.quoteType) || !record(value.rates) || value.indicative !== true) return null;
  const keys = Object.keys(value.rates);
  if (!keys.length || keys.some(code => !['USD', 'EUR'].includes(code) || !positive(value.rates[code])) || required.some(code => !positive(value.rates[code]))) return null;
  if (typeof value.retrievedAt !== 'string' || Number.isNaN(Date.parse(value.retrievedAt))) return null;
  return {
    provider: value.provider, providerName: PROVIDERS[value.provider], date: value.date,
    quote: 'TRY', rateUnit: 'TRY per 1 foreign currency', rates: { ...value.rates },
    quoteType: value.quoteType, indicative: true, retrievedAt: value.retrievedAt,
    // Attribution destinations are fixed, never loaded from saved untrusted JSON.
    attribution: { label: value.provider === 'exchange_rate' ? 'Rates By Exchange Rate API' : 'Kaynak: ' + PROVIDERS[value.provider], url: URLS[value.provider] },
    sourceProviders: Array.isArray(value.sourceProviders) ? [...new Set(value.sourceProviders.filter(key => typeof key === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(key)))].slice(0, 120) : [],
  };
}

export function currencySnapshotFromResponses(provider, codes, responses) {
  const required = currencyCodes(codes);
  if (!Object.hasOwn(PROVIDERS, provider) || !Array.isArray(responses) || !responses.length) throw Error('Kur kaynağı doğrulanamadı.');
  const first = responses[0];
  if (!record(first)) throw Error('Kur yanıtı doğrulanamadı.');
  const rates = {}, sourceProviders = [];
  for (const data of responses) {
    if (!record(data) || data.provider !== provider || data.date !== first.date || data.quoteType !== first.quoteType || data.indicative !== true || !record(data.rates)) throw Error('Kur kaynağı, yayın tarihi veya kur türü tutarlı değil.');
    if (!Array.isArray(data.observations) || !data.observations.length) throw Error('Kur gözlemi eksik.');
    for (const row of data.observations) {
      if (!record(row) || row.date !== data.date || row.base !== data.base || !positive(row.rate)) throw Error('Kur gözlem tarihi veya değeri doğrulanamadı.');
      if (Array.isArray(row.providers)) sourceProviders.push(...row.providers);
    }
    for (const code of required) {
      let rate;
      if (data.base === 'TRY' && Object.hasOwn(data.rates, code)) {
        if (!positive(data.rates[code])) throw Error(code + ' kuru geçersiz.');
        rate = 1 / data.rates[code];
      } else if (data.base === code && Object.hasOwn(data.rates, 'TRY')) rate = data.rates.TRY;
      if (rate !== undefined) {
        if (!positive(rate) || Object.hasOwn(rates, code)) throw Error('Kur değeri eksik, yinelenmiş veya geçersiz.');
        rates[code] = rate;
      }
    }
  }
  const snapshot = normalizeCurrencySnapshot({ ...first, quote: 'TRY', rates, sourceProviders }, required);
  if (!snapshot) throw Error('Gerekli teklif kurları doğrulanamadı. Mevcut taslak kuru korundu.');
  return snapshot;
}

export async function fetchCurrencySnapshot({ provider = 'tcmb', codes = ['USD'], rateType = 'forex_selling', signal, fetchImpl = globalThis.fetch } = {}) {
  const required = currencyCodes(codes);
  if (!Object.hasOwn(PROVIDERS, provider) || typeof fetchImpl !== 'function') throw Error('Kur servisi kullanılamıyor.');
  const inputs = provider === 'exchange_rate'
    ? required.map(base => ({ base, quotes: 'TRY', amount: '1' }))
    : [{ base: 'TRY', quotes: required.join(','), ...(provider === 'tcmb' ? { rateType } : { providers: 'ecb' }) }];
  const responses = await Promise.all(inputs.map(async input => {
    const query = new URLSearchParams({ action: provider, ...input });
    const response = await fetchImpl('/api/integrations.php?' + query, { method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' }, signal });
    let envelope;
    try { envelope = await response.json(); } catch { throw Error('Kur servisi geçerli bir yanıt vermedi. Mevcut taslak kuru korundu.'); }
    if (!response.ok || envelope?.api !== 'vg-integrations/1' || envelope?.ok !== true) throw Error(typeof envelope?.message === 'string' ? envelope.message : typeof envelope?.error?.message === 'string' ? envelope.error.message : 'Kur alınamadı. Mevcut taslak kuru korundu.');
    return envelope.data;
  }));
  return currencySnapshotFromResponses(provider, required, responses);
}

export function currencySnapshotMatchesRates(snapshot, rates, required = ['USD']) {
  const normalized = normalizeCurrencySnapshot(snapshot, required);
  return !!normalized && required.every(code => positive(Number(rates[code])) && Math.abs(Number(rates[code]) - normalized.rates[code]) <= Math.max(1, normalized.rates[code]) * 1e-10);
}

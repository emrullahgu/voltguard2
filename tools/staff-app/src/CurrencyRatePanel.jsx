import React, { useEffect, useRef, useState } from 'react';
import { fetchCurrencySnapshot, normalizeCurrencySnapshot } from './currencyRates.mjs';

const TYPE_LABELS = { forex_buying: 'Döviz alış', forex_selling: 'Döviz satış', banknote_buying: 'Efektif alış', banknote_selling: 'Efektif satış', reference_mid: 'ECB referans kuru', indicative: 'Günlük gösterge kuru' };
const format = value => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 6 }).format(value);

export default function CurrencyRatePanel({ codes = ['USD'], appliedSnapshot = null, onApply }) {
  const [provider, setProvider] = useState('tcmb');
  const [rateType, setRateType] = useState('forex_selling');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const active = useRef(null);
  const keys = codes.join(',');
  useEffect(() => () => { active.current?.abort(); }, []);
  useEffect(() => { setMessage(''); }, [appliedSnapshot]);
  const invalidate = () => { active.current?.abort(); active.current = null; setPreview(null); setBusy(false); setError(''); setMessage(''); };
  const read = async () => {
    active.current?.abort();
    const request = new AbortController(); active.current = request;
    setBusy(true); setPreview(null); setError(''); setMessage('');
    try {
      const result = await fetchCurrencySnapshot({ provider, rateType, codes: keys.split(','), signal: request.signal });
      if (active.current === request && !request.signal.aborted) setPreview(result);
    } catch (failure) {
      if (active.current === request && !request.signal.aborted) setError(failure.message || 'Kur alınamadı.');
    } finally { if (active.current === request) { active.current = null; setBusy(false); } }
  };
  const applied = normalizeCurrencySnapshot(appliedSnapshot, codes);
  return <section className="mt-3 p-3 rounded border border-blue-200 bg-white text-sm" aria-label="Teklif için kur kaynağı">
    <h4 className="font-semibold text-blue-900">Kur kaynağı</h4>
    <p className="text-xs text-gray-600 mt-1">Günlük gösterge kurunu önce önizleyin, ardından taslağa uygulayın. Kayıtlı teklifin kuru kendiliğinden değişmez.</p>
    <div className="flex flex-wrap gap-2 my-2">
      <label className="text-xs">Servis<select aria-label="Kur servisi" value={provider} onChange={event => { invalidate(); setProvider(event.target.value); }} className="block border rounded p-2 text-sm bg-white">
        <option value="tcmb">TCMB</option><option value="frankfurter">Frankfurter (ECB)</option><option value="exchange_rate">ExchangeRate-API</option>
      </select></label>
      {provider === 'tcmb' && <label className="text-xs">Kur türü<select aria-label="TCMB kur türü" value={rateType} onChange={event => { invalidate(); setRateType(event.target.value); }} className="block border rounded p-2 text-sm bg-white">
        <option value="forex_selling">Döviz satış</option><option value="forex_buying">Döviz alış</option><option value="banknote_selling">Efektif satış</option><option value="banknote_buying">Efektif alış</option>
      </select></label>}
      <button type="button" onClick={read} disabled={busy} className="self-end border border-blue-600 rounded px-3 py-2 text-blue-800 disabled:opacity-60">{busy ? 'Kur alınıyor…' : 'Kuru önizle'}</button>
    </div>
    {error && <p role="alert" className="text-red-800">{error}</p>}
    {preview && <div className="rounded bg-blue-50 p-2">
      <p>{codes.map(code => `1 ${code} = ${format(preview.rates[code])} TL`).join(' · ')}</p>
      <p className="text-xs mt-1">Yayın: {preview.date} · {TYPE_LABELS[preview.quoteType]} · {preview.providerName}{preview.sourceProviders.length ? ' · ' + preview.sourceProviders.join(', ') : ''}</p>
      <p className="text-xs"><a className="underline" href={preview.attribution.url} target="_blank" rel="noopener noreferrer">{preview.attribution.label}</a></p>
      <button type="button" className="mt-2 bg-blue-700 text-white rounded px-3 py-2" onClick={() => { onApply(normalizeCurrencySnapshot(preview, codes)); setPreview(null); setMessage('Kur taslağa uygulandı. Teklifi kaydettiğinizde kaynak ve yayın tarihi de kaydedilir.'); }}>Kuru taslağa uygula</button>
    </div>}
    <p role="status" aria-live="polite" className="text-xs text-gray-600 mt-2">{message || (applied ? `Taslak kuru: ${applied.providerName} · ${applied.date} · ${TYPE_LABELS[applied.quoteType]}` : 'Taslak kuru elle girilmiş; doğrulanmış kaynak ve yayın tarihi yok.')}</p>
    {applied && <p className="text-xs mt-1"><a className="underline" href={applied.attribution.url} target="_blank" rel="noopener noreferrer">{applied.attribution.label}</a></p>}
  </section>;
}

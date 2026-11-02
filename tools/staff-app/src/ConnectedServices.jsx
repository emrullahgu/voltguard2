import React, {useCallback, useEffect, useRef, useState} from 'react';
import {useAuth} from './SimpleAuth';
import {findEmployeeModule, moduleVariants} from './employeeModules';
import {AI_PROVIDERS, DATA_SERVICES, connectedDataParams, createConnectedServiceSession, isConnectedServiceRoute} from './connectedServicesTransport';

const aiLabels = {gemini: 'Google Gemini', groq: 'Groq', openrouter: 'OpenRouter', cloudflare: 'Cloudflare Workers AI'};
const dataLabels = {epias: 'EPİAŞ · saatlik PTF', ipinfo: 'IPinfo · IP konumu', github: 'GitHub · depo bilgisi', unsplash: 'Unsplash · görsel arama', tmdb: 'TMDB · film arama', newsapi: 'NewsAPI · haber arama', jsonplaceholder: 'JSONPlaceholder · sentetik kayıtlar', dummyjson: 'DummyJSON · sentetik ürünler'};
const dataFields = {epias: [['date', 'Tarih', 'YYYY-AA-GG']], ipinfo: [['ip', 'Genel IP adresi', 'Sorgulamak istediğiniz IP adresi']], github: [['owner', 'Depo sahibi', 'public-apis'], ['repo', 'Depo adı', 'public-apis']], unsplash: [['q', 'Görsel arama sözcüğü', 'solar panels']], tmdb: [['q', 'Film arama sözcüğü', 'Film adı']], newsapi: [['q', 'Haber arama sözcüğü', 'güneş enerjisi']], jsonplaceholder: [['limit', 'Örnek kayıt sayısı', '5–20']], dummyjson: [['limit', 'Örnek kayıt sayısı', '5–20']]};
function initialFields() { const now = new Date(); return {date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`, ip: '', owner: 'public-apis', repo: 'public-apis', q: '', limit: '5'}; }
const panel = 'bg-white rounded-xl border border-gray-200 p-4 md:p-6 space-y-3';
const button = 'px-4 py-2 rounded-lg bg-blue-700 text-white disabled:opacity-50';
const fieldClass = 'w-full rounded-lg border border-gray-300 p-3 bg-white text-gray-900';
const surfaceStyle = {backgroundColor: 'var(--vg-module-bg-card)', color: 'var(--vg-module-text-primary)', borderColor: 'var(--vg-module-border-primary)'};
const inputStyle = {backgroundColor: 'var(--vg-module-bg-primary)', color: 'var(--vg-module-text-primary)', borderColor: 'var(--vg-module-border-secondary)'};

export default function ConnectedServices(props) {
  const {currentUser} = useAuth();
  return <ConnectedWorkspace key={`${props.route}:${currentUser?.id || 'signed-out'}:${currentUser?.role || 'none'}`} {...props} />;
}
function ConnectedWorkspace({route, title, refreshKey = 0}) {
  const {currentUser, recheck} = useAuth();
  const session = useRef(null), busy = useRef(false), sequence = useRef(0);
  const [status, setStatus] = useState(null), [verifiedRole, setVerifiedRole] = useState(null);
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [provider, setProvider] = useState('gemini'), [service, setService] = useState('epias');
  const [prompt, setPrompt] = useState(''), [fields, setFields] = useState(initialFields);
  const [reply, setReply] = useState(null), [result, setResult] = useState(null);
  const isAI = route === 'ConnectedAi';
  const entry = findEmployeeModule('api-servisleri', currentUser);
  const permitted = isConnectedServiceRoute(route) && !!entry && moduleVariants(entry, currentUser).some(item => item.route === route);
  const clearPrivateState = useCallback(() => {
    sequence.current++; busy.current = false;
    setStatus(null); setVerifiedRole(null); setPrompt(''); setFields(initialFields()); setReply(null); setResult(null); setPending(false); setLoading(false);
    setError('Çalışan oturumu değişti. Ekranı yeniden açın.');
  }, []);
  const load = useCallback(async () => {
    const active = session.current; if (!active || busy.current) return;
    const request = ++sequence.current; setLoading(true); setError('');
    try { const next = await active.status(); if (session.current === active && request === sequence.current) { setStatus(next); setVerifiedRole(active.getUser()?.role || null); } }
    catch (e) { if (session.current === active && request === sequence.current) { setStatus(null); setVerifiedRole(null); setError(e.message || 'Bağlantı durumu alınamadı.'); } }
    finally { if (session.current === active && request === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (!permitted || !currentUser?.id) { setLoading(false); return; }
    clearPrivateState();
    // Construct within each effect setup: React.StrictMode cleanup must never
    // cause the next setup to reuse a disposed transport.
    const active = createConnectedServiceSession({expectedUserId: currentUser.id, onInvalid: () => { clearPrivateState(); void recheck(); }});
    session.current = active; void load();
    const reset = () => active.invalidate();
    const message = event => { if (event.origin === window.location.origin && event.data?.type === 'vg:staff-signout') reset(); };
    window.addEventListener('message', message);
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('vg-staff-auth');
    if (channel) channel.onmessage = event => { if (['SIGNED_OUT', 'logout', 'vg:staff-signout'].includes(event.data?.type)) reset(); };
    return () => { sequence.current++; active.dispose(); if (session.current === active) session.current = null; window.removeEventListener('message', message); channel?.close(); };
  }, [currentUser?.id, permitted, route, clearPrivateState, load, recheck]);
  const previousRefresh = useRef(refreshKey);
  useEffect(() => { if (previousRefresh.current !== refreshKey) { previousRefresh.current = refreshKey; void load(); } }, [refreshKey, load]);
  const selected = status?.[isAI ? 'ai' : 'services']?.[isAI ? provider : service];
  const authorized = isAI || service === 'epias' || verifiedRole === 'admin';
  const enabled = !!selected?.configured && (isAI || (selected.available && authorized));
  const send = async event => {
    event.preventDefault(); const active = session.current;
    if (!active || busy.current || loading || !enabled || (isAI && !prompt.trim())) return;
    const request = ++sequence.current, submittedPrompt = prompt, submittedProvider = provider, submittedService = service, submittedFields = {...fields};
    busy.current = true; setPending(true); setError('');
    try {
      if (isAI) {
        const next = await active.send(submittedProvider, submittedPrompt);
        if (session.current === active && request === sequence.current) { setReply(next); setPrompt(current => current === submittedPrompt ? '' : current); }
      } else {
        const params = connectedDataParams(submittedService, submittedFields);
        const next = await active.query(submittedService, submittedFields);
        if (session.current === active && request === sequence.current) setResult({service: submittedService, params, data: next});
      }
    } catch (e) { if (session.current === active && request === sequence.current) setError(e.message || 'İstek tamamlanamadı. Taslağınız korundu.'); }
    finally { if (session.current === active && request === sequence.current) { busy.current = false; setPending(false); setVerifiedRole(active.getUser()?.role || null); } }
  };
  if (!permitted) return <p role="alert" className="employee-module-notice">Bu çalışan modülü için erişiminiz bulunmuyor.</p>;
  return <section aria-label={title} data-employee-connected-module="" data-module-route={route} className="employee-module-host space-y-4" style={{height: 'auto', color: 'var(--vg-module-text-primary)'}}>
    <div className={panel} style={surfaceStyle}>
      <h2 className="text-xl font-bold">{isAI ? 'Teknik yapay zekâ yardımcısı' : 'Veri servisleri laboratuvarı'}</h2>
      <p>{isAI ? 'Teknik sorularınızı açıklatın, metin taslağı veya özet hazırlatın. Yanıtları uygulamadan önce doğrulayın.' : 'Enerji piyasası verilerini ve geliştirme amaçlı veri kaynaklarını sorgulayın. Her sorgu yalnızca seçtiğiniz kaynağa gönderilir.'}</p>
      <fieldset className="space-y-2" disabled={pending}>
        <legend className="font-semibold">{isAI ? 'Sağlayıcı seçin' : 'Veri kaynağı'}</legend>
        {(isAI ? AI_PROVIDERS : DATA_SERVICES).map(item => {
          const row = status?.[isAI ? 'ai' : 'services']?.[item], name = (isAI ? aiLabels : dataLabels)[item];
          return <label key={item} className="flex gap-3 items-start border border-gray-200 rounded-lg p-3 cursor-pointer" style={{borderColor: 'var(--vg-module-border-primary)'}}>
            <input type="radio" name="connected-source" value={item} checked={(isAI ? provider : service) === item} aria-label={name} onChange={() => { (isAI ? setProvider : setService)(item); setError(''); }} />
            <span><strong>{name}</strong><small className="block">{!status ? 'Durum bekleniyor' : !row.configured ? 'Sunucu ayarı gerekiyor' : isAI ? 'Sunucu ayarı mevcut' : row.available ? 'Sorgu yapılabilir' : 'Kullanıma kapalı'}</small></span>
          </label>;
        })}
      </fieldset>
      <button type="button" className="underline" disabled={loading || pending} aria-label={isAI ? 'Bağlantı durumunu yenile' : 'Veri servislerinin durumunu yenile'} onClick={() => { void load(); }}>Bağlantı durumunu yenile</button>
      {loading && <p role="status">Bağlantı durumu yükleniyor…</p>}
      {selected && <div className="space-y-2">{isAI && <p className="font-semibold">Model: {selected.model}</p>}<p>{selected.notice}</p>{isAI && <><a href={selected.privacyUrl} target="_blank" rel="noopener noreferrer" className="underline">Veri kullanımı koşulları</a><p className="text-sm">Ücretsiz kullanım ve kota hesabınıza bağlıdır. Sunucu ayarı, sağlayıcı erişiminin doğrulandığı anlamına gelmez.</p></>}</div>}
      {!isAI && service !== 'epias' && <p>Bu laboratuvar sorgusu yönetici hesabı gerektirir.</p>}
      {!isAI && service === 'ipinfo' && <p>Yalnızca yazdığınız genel IP adresi sorgulanır. Konum yaklaşık olabilir.</p>}
      {!isAI && ['jsonplaceholder', 'dummyjson'].includes(service) && <p>Bu kaynak sentetik örnek veri döndürür. Sonuçlar şirket kaydı olarak kaydedilmez.</p>}
    </div>
    {!isAI && (service === 'tmdb' || result?.service === 'tmdb') && <div className={panel} style={surfaceStyle}><h3>Hakkında ve kaynakça · TMDB</h3><a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" aria-label="TMDB resmi sitesini aç"><img src="/assets/tmdb-logo.svg" alt="TMDB logosu" width="150" height="38" /></a><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p><p>{status?.services.tmdb.notice}</p></div>}
    <form className={panel} style={surfaceStyle} onSubmit={send}>
      <h3 className="font-semibold">{isAI ? 'İletiniz' : dataLabels[service]}</h3>
      {isAI ? <><p>Yalnızca buraya yazdığınız metin seçtiğiniz sağlayıcıya gönderilir. Önceki yanıtlar otomatik eklenmez. Müşteri bilgisi, şifre veya API anahtarı yazmayın.</p><label htmlFor="connected-prompt">Yapay zekâ iletisi</label><textarea id="connected-prompt" className={fieldClass} style={inputStyle} rows="6" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Örneğin: Güneş panelinde eğim ve yönün üretime etkisini açıkla." /><p>{[...prompt].length.toLocaleString('tr-TR')} / 12.000 karakter</p></> : dataFields[service].map(([key, label, placeholder]) => <label key={key} className="block">{label}<input className={fieldClass} style={inputStyle} value={fields[key]} placeholder={placeholder} onChange={event => setFields(current => ({...current, [key]: event.target.value}))} autoCapitalize="none" /></label>)}
      {!authorized && <p role="alert">Bu sorgu için yönetici yetkisi gerekiyor.</p>}
      {!!error && <p role="alert" className="employee-module-notice">{error}</p>}
      <button type="submit" className={button} aria-label={isAI ? 'Seçili sağlayıcıya gönder' : 'Seçili veri kaynağını sorgula'} disabled={loading || pending || !enabled || (isAI && !prompt.trim())}>{pending ? 'Yanıt bekleniyor…' : isAI ? 'Seçili sağlayıcıya gönder' : 'Sorgula'}</button>
      {pending && <p role="status">Yanıt bekleniyor. İstek otomatik yeniden gönderilmez.</p>}
    </form>
    {isAI && reply && <div className={panel} style={surfaceStyle}><h3 className="font-semibold">Son yanıt · {aiLabels[reply.provider]}</h3><p>{reply.model} · {new Date(reply.generatedAt).toLocaleString('tr-TR')}</p><p className="whitespace-pre-wrap">{reply.text}</p>{reply.truncated && <p>Yanıt uzunluk sınırında kesildi.</p>}{reply.usage.totalTokens !== null && <p>Sağlayıcının bildirdiği kullanım: {reply.usage.totalTokens} token</p>}</div>}
    {!isAI && result && <div className={panel} style={surfaceStyle}><h3 className="font-semibold">Son sorgu · {dataLabels[result.service]}</h3><p>{Object.entries(result.params).map(([key, value]) => `${key}: ${value}`).join(' · ')}</p><p>Alınma zamanı: {new Date(result.data.retrievedAt).toLocaleString('tr-TR')}</p><a href={result.data.source.url} target="_blank" rel="noopener noreferrer" aria-label="Veri kaynağını aç" className="underline">{result.data.source.name}</a><pre className="whitespace-pre-wrap break-words">{JSON.stringify(result.data, null, 2)}</pre></div>}
  </section>;
}

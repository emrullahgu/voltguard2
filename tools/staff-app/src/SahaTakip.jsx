import React, { useEffect, useRef, useState } from 'react';
import { MapPin, RefreshCw, Maximize2, Minimize2 } from 'lucide-react';

const ENTRY = '/calisan/uygulama/saha.php';
const SAVING_NOTICE = 'Saha kayıtlarınız kaydediliyor. Kaydetme tamamlandıktan sonra bölüm değiştirebilirsiniz.';

export default function SahaTakip() {
  const frame = useRef(null);
  const storage = useRef({ pending: 0, error: null, outcome: null });
  const [writeStatus, setWriteStatus] = useState(storage.current);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const close = event => { if (event.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', close);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', close); };
  }, [expanded]);

  useEffect(() => {
    setState('loading'); setMessage('');
    const timeout = setTimeout(() => {
      setState(previous => previous === 'loading' ? 'error' : previous);
      setMessage(previous => previous || 'SahaTakip henüz açılamadı. Bağlantıyı kontrol edip yeniden deneyin.');
    }, 60000);
    const receive = event => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'vg:saha-ready') { clearTimeout(timeout); setState('ready'); setMessage(''); }
      if (event.data.type === 'vg:saha-error') {
        clearTimeout(timeout); setState('error');
        setMessage(typeof event.data.message === 'string' ? event.data.message.slice(0, 300) : 'SahaTakip yüklenemedi. Yeniden deneyin.');
      }
      if (event.data.type === 'vg:saha-storage') {
        storage.current = { pending: Number.isSafeInteger(event.data.pending) && event.data.pending > 0 ? event.data.pending : 0, error: typeof event.data.error === 'string' ? event.data.error.slice(0, 300) : null, outcome: event.data.outcome === 'rejected' ? 'rejected' : event.data.error ? 'unknown' : null };
        setWriteStatus(storage.current);
        if (storage.current.pending === 0) setMessage(previous => previous === SAVING_NOTICE ? '' : previous);
      }
      if (event.data.type === 'vg:saha-notice' && typeof event.data.message === 'string') setMessage(event.data.message.slice(0, 300));
      if (event.data.type === 'vg:saha-session-expired') location.replace('/calisan/giris.html');
    };
    const beforeLeave = event => {
      if (storage.current.pending > 0) {
        event.preventDefault();
        setMessage(SAVING_NOTICE);
      }
    };
    window.addEventListener('message', receive);
    window.addEventListener('vg:before-module-change', beforeLeave);
    window.addEventListener('vg:before-sign-out', beforeLeave);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
      window.removeEventListener('vg:before-module-change', beforeLeave);
      window.removeEventListener('vg:before-sign-out', beforeLeave);
    };
  }, [attempt]);

  const retry = () => {
    if (storage.current.pending > 0) {
      setMessage(SAVING_NOTICE);
      return;
    }
    storage.current = { pending: 0, error: null, outcome: null };
    setWriteStatus(storage.current);
    setAttempt(value => value + 1);
  };
  const dismissWriteNotice = () => {
    if (storage.current.pending > 0) return;
    const previous = storage.current.error;
    storage.current = { pending: 0, error: null, outcome: null };
    setWriteStatus(storage.current);
    setMessage(current => current === previous ? '' : current);
    frame.current?.contentWindow?.postMessage({ type: 'vg:saha-clear-write-notice' }, location.origin);
  };

  return <section className={'saha-workspace' + (expanded ? ' saha-workspace--expanded' : '')} data-saha-workspace="" aria-labelledby="saha-workspace-title">
    <header className="saha-workspace__heading">
      <div className="saha-workspace__identity"><span className="saha-workspace__icon" aria-hidden="true"><MapPin size={25} /></span><div><h1 id="saha-workspace-title">SahaTakip</h1><p>İş emirleri, teklifler, müşteriler ve saha ekibi.</p></div></div>
      <div className="saha-workspace__actions"><button type="button" onClick={retry} disabled={writeStatus.pending > 0}><RefreshCw size={17} /> Yenile</button><button type="button" aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}{expanded ? 'Görünümü küçült' : 'Geniş görünüm'}</button></div>
    </header>
    {state === 'loading' && <p className="saha-workspace__status" role="status" aria-live="polite">SahaTakip hazırlanıyor…</p>}
    {message && <div className="saha-workspace__status" role="alert">{message}{state === 'error' && <button type="button" onClick={retry}>Yeniden dene</button>}</div>}
    {writeStatus.error && <div className="saha-workspace__status" role="status">
      <p>{writeStatus.outcome === 'rejected' ? 'Bu işlem sunucu tarafından reddedildi. Bilgileri düzelterek uygulama içinden tekrar deneyebilirsiniz.' : 'İşlemin sonucu doğrulanamadı. Aynı işlemi tekrar göndermeden önce sunucudaki kayıtları kontrol edin.'}</p>
      <button type="button" onClick={retry} disabled={writeStatus.pending > 0}>Sunucudaki kayıtları kontrol et</button>
      <button type="button" onClick={dismissWriteNotice} disabled={writeStatus.pending > 0}>Hata mesajını kapat</button>
    </div>}
    <iframe key={attempt} ref={frame} src={ENTRY} title="SahaTakip çalışma alanı" className="saha-workspace__frame" allow="camera 'self'; microphone 'self'; geolocation 'self'; clipboard-write 'self'" referrerPolicy="same-origin" />
  </section>;
}

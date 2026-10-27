import React, { useEffect, useRef, useState } from 'react';
import { loadEmployeeRuntime } from './employeeRuntime';

const SAVING = 'Kaydınız sunucuya yazılıyor. İşlem tamamlandığında bölüm değiştirebilirsiniz.';
export default function EmployeeModule({ route, title, refreshKey = 0 }) {
  const host = useRef(null), controller = useRef(null), currentRoute = useRef(route), status = useRef({ pending: 0, error: null });
  const [state, setState] = useState('loading'), [message, setMessage] = useState(''), [write, setWrite] = useState(status.current), [attempt, setAttempt] = useState(0);
  const previousRefresh = useRef(refreshKey);
  currentRoute.current = route;
  useEffect(() => {
    let active = true, instance;
    setState('loading'); setMessage('');
    const onEvent = event => {
      if (!active || !event || typeof event !== 'object') return;
      if (event.type === 'vg:saha-ready') { setState('ready'); setMessage(''); }
      if (event.type === 'vg:saha-error') { setState('error'); setMessage(String(event.message || 'Modül açılamadı.').slice(0, 300)); }
      if (event.type === 'vg:saha-notice') setMessage(String(event.message || '').slice(0, 300));
      if (event.type === 'vg:saha-storage') {
        status.current = { pending: Number.isSafeInteger(event.pending) && event.pending > 0 ? event.pending : 0, error: typeof event.error === 'string' ? event.error.slice(0, 300) : null, outcome: event.outcome };
        setWrite(status.current); if (!status.current.pending) setMessage(previous => previous === SAVING ? '' : previous);
      }
    };
    const beforeLeave = event => { if (status.current.pending > 0) { event.preventDefault(); setMessage(SAVING); } };
    window.addEventListener('vg:before-module-change', beforeLeave); window.addEventListener('vg:before-sign-out', beforeLeave);
    loadEmployeeRuntime().then(async ({ runtime, styles }) => {
      if (!active) return;
      instance = await runtime.mount(host.current, { route: currentRoute.current, styles, theme: document.documentElement.dataset.theme, onEvent });
      if (!active) { instance.unmount(); return; }
      controller.current = instance;
      if (currentRoute.current !== route) instance.setRoute(currentRoute.current);
    }).catch(error => { if (active) { setState('error'); setMessage(error.message || 'Modül yüklenemedi.'); } });
    return () => { active = false; window.removeEventListener('vg:before-module-change', beforeLeave); window.removeEventListener('vg:before-sign-out', beforeLeave); instance?.unmount(); controller.current = null; };
  }, [attempt]);
  useEffect(() => {
    if (!controller.current || status.current.pending) return;
    controller.current.setRoute(route);
  }, [route]);
  const reload = () => { if (status.current.pending) return; status.current = { pending: 0, error: null }; setWrite(status.current); setAttempt(value => value + 1); };
  useEffect(() => { if (previousRefresh.current === refreshKey) return; previousRefresh.current = refreshKey; if (status.current.pending) setMessage(SAVING); else reload(); }, [refreshKey]);
  return <section className="employee-native-module" aria-label={title} data-employee-native-module="" data-module-route={route}>
    {state === 'loading' && <p className="employee-module-notice" role="status">Modül yükleniyor…</p>}
    {message && <div className="employee-module-notice" role="alert">{message}{state === 'error' && <button type="button" onClick={reload}>Yeniden dene</button>}</div>}
    {write.error && <div className="employee-module-notice" role="status"><p>{write.outcome === 'rejected' ? 'İşlem sunucu tarafından reddedildi. Bilgileri kontrol edip yeniden deneyin.' : 'İşlemin sonucu doğrulanamadı. Yeniden göndermeden önce kayıtları kontrol edin.'}</p><button type="button" onClick={reload} disabled={write.pending > 0}>Sunucudaki kayıtları kontrol et</button><button type="button" disabled={write.pending > 0} onClick={() => { controller.current?.clearWriteFailure(); setMessage(''); }}>Uyarıyı kapat</button></div>}
    <div ref={host} className="employee-module-host" data-employee-module-host="" />
  </section>;
}

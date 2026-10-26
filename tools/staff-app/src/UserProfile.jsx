import React, {useEffect, useRef, useState} from 'react';
import {useAuth} from './SimpleAuth';
import MfaSettings from './MfaSettings';

export default function UserProfile({onClose}) {
  const {currentUser, updateUser, changeOwnPassword} = useAuth();
  const [name, setName] = useState(currentUser.name || '');
  const [old, setOld] = useState(''), [password, setPassword] = useState(''), [confirmPassword, setConfirm] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const dialog = useRef(null), closeButton = useRef(null), pending = useRef(false), close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement, previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; closeButton.current?.focus();
    const keyboard = event => {
      if (event.key === 'Escape') {
        event.preventDefault(); if (!pending.current) close.current();
      }
      if (event.key !== 'Tab') return;
      const controls = [...dialog.current.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')]
        .filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (!controls.includes(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); if (!controls.length) dialog.current.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('keydown', keyboard); document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected && previousFocus.getClientRects().length) previousFocus.focus();
      else document.getElementById('portal-account-toggle')?.focus();
    };
  }, []);
  const run = async work => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); }
    catch (failure) { setError(failure.message || 'İşlem tamamlanamadı.'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
    <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Profil ve güvenlik" aria-busy={busy} className="bg-white rounded-2xl p-6 max-w-xl w-full max-h-[92vh] overflow-y-auto">
      <div className="flex justify-between gap-4"><h2 className="text-2xl font-bold">Profil ve güvenlik</h2><button type="button" ref={closeButton} disabled={busy} aria-label="Profil ekranını kapat" className="font-semibold" onClick={onClose}>Kapat</button></div>
      <p className="text-sm break-all mt-2">{currentUser.email} · VoltGuard</p>
      {error && <p role="alert" className="text-red-800 bg-red-50 p-3 my-3">{error}</p>}
      {notice && <p role="status" className="text-green-900 bg-green-50 p-3 my-3">{notice}</p>}
      <form onSubmit={event => { event.preventDefault(); run(async () => { await updateUser(currentUser.id, {name}); setNotice('Profiliniz kaydedildi.'); }); }} className="grid gap-3 mt-5">
        <label>Ad soyad<input disabled={busy} value={name} onChange={event => setName(event.target.value)} required minLength={2} maxLength={120} className="w-full border rounded p-3 mt-1" /></label>
        <button disabled={busy} className="bg-slate-800 text-white rounded px-4 py-2">Profili kaydet</button>
      </form>
      <form className="grid gap-3 border-t pt-5 mt-5" onSubmit={event => { event.preventDefault(); run(async () => {
        if (password !== confirmPassword) throw Error('Yeni şifreler eşleşmiyor.');
        if (new TextEncoder().encode(password).length > 72) throw Error('Şifre çok uzun. Daha kısa bir şifre seçin.');
        await changeOwnPassword(old, password);
      }); }}>
        <h3 className="text-xl font-semibold">Şifrenizi değiştirin</h3>
        <p className="text-sm text-slate-600">12–64 karakterlik, başka yerde kullanmadığınız bir şifre seçin. Değişiklikten sonra tüm oturumlar kapanır ve yeniden giriş yaparsınız.</p>
        <label>Mevcut şifre<input disabled={busy} type="password" value={old} onChange={event => setOld(event.target.value)} required autoComplete="current-password" className="w-full border rounded p-3 mt-1" /></label>
        <label>Yeni şifre<input disabled={busy} type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={12} maxLength={64} required autoComplete="new-password" className="w-full border rounded p-3 mt-1" /></label>
        <label>Yeni şifre tekrar<input disabled={busy} type="password" value={confirmPassword} onChange={event => setConfirm(event.target.value)} minLength={12} maxLength={64} required autoComplete="new-password" className="w-full border rounded p-3 mt-1" /></label>
        <button disabled={busy} className="bg-slate-800 text-white rounded px-4 py-2">Şifreyi değiştir ve oturumları kapat</button>
      </form>
      <MfaSettings email={currentUser.email} />
      <p className="text-sm border-t mt-6 pt-4 text-slate-600">Hesap erişiminizi şirket yöneticiniz yönetir. Çalışan ayrılışında erişim kapatılır; şirket kayıtları silinmez.</p>
    </section>
  </div>;
}

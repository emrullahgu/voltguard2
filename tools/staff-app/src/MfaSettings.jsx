import React from 'react';
export default function MfaSettings({busy, onForget}) {
  return <section className="border-t pt-6 mt-6">
    <h3 className="text-xl font-semibold">Giriş doğrulaması ve cihazlar</h3>
    <p className="text-sm mt-2 text-slate-600">Girişte kodu doğrularken “Bu cihazı 30 gün hatırla” seçeneğini işaretleyebilirsiniz. Bu tarayıcıda sonraki girişlerinizde şifreniz yeterlidir. Yeni cihazlarda ve 30 gün sonunda yeniden kod istenir.</p>
    <p className="text-sm mt-3 text-slate-600">Yalnızca size ait cihazları hatırlatın. Şifre değişikliği hatırlanan cihazları geçersiz kılar. Aşağıdaki işlem tüm hatırlanan cihazları ve açık çalışan oturumlarını kapatır; yeniden girişte kod gerekir.</p>
    <button type="button" disabled={busy} onClick={onForget} className="border border-slate-400 rounded px-4 py-2 mt-3">Hatırlanan cihazları kaldır ve çıkış yap</button>
    <p className="text-sm mt-3 text-slate-600">Doğrulayıcı cihazınızı kaybettiyseniz şirket yöneticinizden güvenli hesap kurtarma isteyin.</p>
  </section>;
}

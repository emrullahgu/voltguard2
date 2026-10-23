// SunucuDurumu — sunucuya ulasilamazsa kullaniciyi uyarir.
//
// Veritabani ofisteki Ubuntu sunucusunda calisiyor. Sunucu kapaliyken yapilan kayitlar
// kaybolmasin diye ekrani kaplayan bir uyari gosterilir. Uyari sayfayi kapatmaz ve
// formlardaki yazilanlari silmez; sunucu geri gelince kendiliginden kalkar.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { checkCompanyHealth } from './serverHealth.mjs';


const NORMAL_ARALIK = 20000; // sunucu aciktayken kontrol sikligi
const HIZLI_ARALIK = 5000;   // supheli / kapaliyken kontrol sikligi
const ZAMAN_ASIMI = 8000;
const UYARI_ESIGI = 2;       // arka arkaya bu kadar basarisiz kontrolde uyari cikar

async function sunucuAcikMi(ctrl) {
  const zamanlayici = setTimeout(() => ctrl.abort(), ZAMAN_ASIMI);
  try {
    return await checkCompanyHealth({ signal: ctrl.signal });
  } catch {
    return false;
  } finally {
    clearTimeout(zamanlayici);
  }
}

export default function SunucuDurumu() {
  const [durum, setDurum] = useState('acik'); // 'acik' | 'kapali' | 'internet-yok'
  const [sonKontrol, setSonKontrol] = useState(null);
  const [geriGeldi, setGeriGeldi] = useState(false);
  const [kontrolEdiliyor, setKontrolEdiliyor] = useState(false);
  const hataSayisi = useRef(0);
  const durumRef = useRef('acik');
  const zamanlayici = useRef(null);
  const bildirimZamanlayici = useRef(null);
  const surenKontrol = useRef(null);
  const etkin = useRef(false);
  const kontrolSurumu = useRef(0);

  const durumAyarla = useCallback((yeni) => {
    const eski = durumRef.current;
    if (eski === yeni) return;
    durumRef.current = yeni;
    setDurum(yeni);
    if (yeni === 'acik' && eski !== 'acik') {
      setGeriGeldi(true);
      clearTimeout(bildirimZamanlayici.current);
      bildirimZamanlayici.current = setTimeout(() => setGeriGeldi(false), 6000);
    }
  }, []);

  const kontrol = useCallback(async () => {
    clearTimeout(zamanlayici.current);
    if (!etkin.current || surenKontrol.current || document.visibilityState === 'hidden') return;
    const surum = ++kontrolSurumu.current;
    const controller = new AbortController();
    surenKontrol.current = controller;
    setKontrolEdiliyor(true);
    let acik;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      hataSayisi.current = UYARI_ESIGI;
      durumAyarla('internet-yok');
      acik = false;
    } else {
      acik = await sunucuAcikMi(controller);
      if (!etkin.current || surum !== kontrolSurumu.current) return;
      if (acik) {
        hataSayisi.current = 0;
        durumAyarla('acik');
      } else {
        hataSayisi.current += 1;
        if (hataSayisi.current >= UYARI_ESIGI) durumAyarla('kapali');
      }
    }
    setSonKontrol(new Date());
    setKontrolEdiliyor(false);
    surenKontrol.current = null;
    if (document.visibilityState !== 'hidden') zamanlayici.current = setTimeout(kontrol, acik ? NORMAL_ARALIK : HIZLI_ARALIK);
  }, [durumAyarla]);

  useEffect(() => {
    etkin.current = true;
    kontrol();
    const hemen = () => kontrol();
    const gorunurluk = () => { clearTimeout(zamanlayici.current); if (document.visibilityState === 'visible') kontrol(); };
    window.addEventListener('online', hemen);
    window.addEventListener('offline', hemen);
    window.addEventListener('focus', hemen);
    document.addEventListener('visibilitychange', gorunurluk);
    return () => {
      etkin.current = false;
      kontrolSurumu.current++;
      surenKontrol.current?.abort();
      surenKontrol.current = null;
      clearTimeout(zamanlayici.current);
      clearTimeout(bildirimZamanlayici.current);
      window.removeEventListener('online', hemen);
      window.removeEventListener('offline', hemen);
      window.removeEventListener('focus', hemen);
      document.removeEventListener('visibilitychange', gorunurluk);
    };
  }, [kontrol]);

  if (durum === 'acik') {
    if (!geriGeldi) return null;
    return (
      <div role="status" style={stil.tamamBildirimi}>
        Sunucu bağlantısı yeniden kuruldu. Kayıt işlemini tekrar deneyebilirsiniz.
      </div>
    );
  }

  const internetYok = durum === 'internet-yok';
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="sunucu-durumu-baslik" style={stil.perde}>
      <div style={stil.kart}>
        <div style={stil.ikon}>{internetYok ? '📡' : '⚠️'}</div>
        <h2 id="sunucu-durumu-baslik" style={stil.baslik}>
          {internetYok ? 'İnternet bağlantınız yok' : 'Sunucuya şu an ulaşılamıyor'}
        </h2>
        <p style={stil.metin}>
          <strong>Şu an yapacağınız kayıtlar kaydedilemez.</strong> Lütfen sayfayı kapatmayın ve
          yeni kayıt girmeyin. Ekranda yazdığınız bilgiler silinmez; bağlantı gelince bu uyarı
          kendiliğinden kalkar, sonra kaydedebilirsiniz.
        </p>
        <p style={stil.ikincil}>
          {internetYok
            ? 'Wi-Fi veya mobil veri bağlantınızı kontrol edin.'
            : 'Sunucu bilgisayarı kapalı veya internete bağlı olmayabilir. Durum devam ederse yöneticinize haber verin.'}
        </p>
        <button type="button" onClick={kontrol} disabled={kontrolEdiliyor} style={stil.dugme}>
          {kontrolEdiliyor ? 'Kontrol ediliyor…' : 'Tekrar dene'}
        </button>
        {sonKontrol && (
          <div style={stil.zaman}>
            Son kontrol: {sonKontrol.toLocaleTimeString('tr-TR')} · otomatik olarak tekrar deneniyor
          </div>
        )}
      </div>
    </div>
  );
}

const stil = {
  perde: {
    position: 'fixed', inset: 0, zIndex: 2147483000,
    background: 'rgba(15, 23, 42, 0.72)', backdropFilter: 'blur(2px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  kart: {
    background: '#fff', color: '#0f172a', borderRadius: 16, maxWidth: 460, width: '100%',
    padding: '28px 24px', boxShadow: '0 20px 50px rgba(0,0,0,0.35)', textAlign: 'center',
    borderTop: '6px solid #dc2626', fontFamily: 'Inter, sans-serif',
  },
  ikon: { fontSize: 44, lineHeight: 1, marginBottom: 8 },
  baslik: { margin: '4px 0 12px', fontSize: 22, fontWeight: 700, color: '#b91c1c' },
  metin: { margin: '0 0 10px', fontSize: 15, lineHeight: 1.5 },
  ikincil: { margin: '0 0 18px', fontSize: 13, lineHeight: 1.5, color: '#475569' },
  dugme: {
    background: '#f59e0b', color: '#0a1628', border: 0, borderRadius: 10, padding: '10px 22px',
    fontSize: 15, fontWeight: 600, cursor: 'pointer',
  },
  zaman: { marginTop: 12, fontSize: 12, color: '#64748b' },
  tamamBildirimi: {
    position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 2147483000,
    background: '#16a34a', color: '#fff', padding: '10px 18px', borderRadius: 10, fontSize: 14,
    fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', fontFamily: 'Inter, sans-serif',
  },
};

/* VoltGuard renk teması başlatıcısı — tools/shell/head.html'deki satır içi betiğin aynısı (tests: theme-init).
   Satır içi betiğe izin vermeyen /hesap/ ve /calisan/ sayfaları (CSP) bunu <head>'de senkron yükler. */
(function(d){var t,m;try{t=localStorage.getItem('vg-theme')}catch(e){}if(t!=='dark'&&t!=='light'){try{m=matchMedia('(prefers-color-scheme: dark)').matches}catch(e){}t=m?'dark':'light'}d.documentElement.setAttribute('data-theme',t)})(document)

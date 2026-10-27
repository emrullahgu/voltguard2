let loading;
const prefix = '/calisan/uygulama/assets/saha/';
function asset(url, suffix) { return typeof url === 'string' && url.startsWith(prefix) && !url.includes('..') && suffix.test(url); }
export function loadEmployeeRuntime() {
  if (loading) return loading;
  loading = (async () => {
    const response = await fetch('/api/company.php?action=module_assets', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    const payload = await response.json();
    if (response.status === 401) { location.replace('/calisan/giris.html'); throw new Error('Çalışan oturumu sona erdi.'); }
    if (!response.ok || payload.api !== 'vg-company/1' || !payload.ok) throw new Error(payload.message || 'Modül dosyaları yüklenemedi.');
    const files = payload.data;
    if (!Array.isArray(files?.scripts) || !files.scripts.length || files.scripts.length > 8 || !Array.isArray(files.styles) || files.styles.length > 8 || !files.scripts.every(url => asset(url, /\.m?js$/)) || !files.styles.every(url => asset(url, /\.css$/))) throw new Error('Modül paketi doğrulanamadı.');
    if (!window.VoltGuardEmployeeModules) for (const src of files.scripts) await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = src; script.async = false;
      script.onload = resolve; script.onerror = () => { script.remove(); reject(new Error('Modül kodu yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin.')); };
      document.head.append(script);
    });
    if (typeof window.VoltGuardEmployeeModules?.mount !== 'function') throw new Error('Modül başlatılamadı.');
    return { runtime: window.VoltGuardEmployeeModules, styles: files.styles };
  })().catch(error => { loading = null; throw error; });
  return loading;
}

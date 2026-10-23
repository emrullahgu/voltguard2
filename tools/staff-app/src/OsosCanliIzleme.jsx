import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { supabase } from './supabaseClient';
import { parseDecimal } from './operations.mjs';
import { measurementSources, measurementSeries, measurementRange, sourceKey } from './measurementSources.mjs';

const format = value => {
  const number = parseDecimal(value, null);
  return number === null ? '—' : number.toLocaleString('tr-TR', { maximumFractionDigits: 3 });
};
const sourceLabel = source => `${source.facility || 'Tesis adı yok'} · ${source.meter || 'Sayaç numarası yok'}`;
const statusClass = status => status === null ? 'bg-gray-50 border-gray-200 text-gray-700' : status ? 'bg-green-50 border-green-300 text-green-800' : 'bg-orange-50 border-orange-300 text-orange-800';

export default function OsosCanliIzleme() {
  const [sources, setSources] = useState([]);
  const [source, setSource] = useState(null);
  const [manual, setManual] = useState(false);
  const [facility, setFacility] = useState('');
  const [meter, setMeter] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [error, setError] = useState('');
  const [discoveryVersion, setDiscoveryVersion] = useState(0);
  const refresh = useRef(() => {});
  const automatic = useRef(false);
  const refreshTimer = useRef(null);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase.from('osos_olcumler').select('fabrika_adi,sayac_no,olcum_zamani').order('olcum_zamani', { ascending: false }).limit(1000);
        if (error) throw error;
        if (disposed) return;
        const available = measurementSources(data || []);
        setSources(available);
        setSource(current => current || available[0] || null);
        setError('');
      } catch (error) {
        if (!disposed) setError(error.message || 'Ölçüm kaynakları yüklenemedi.');
      } finally { if (!disposed) setLoading(false); }
    })();
    return () => { disposed = true; };
  }, [discoveryVersion]);

  useEffect(() => {
    if (!source) return;
    let disposed = false, pending = false;
    setRows([]);
    const load = async () => {
      clearTimeout(refreshTimer.current);
      if (disposed || pending || document.visibilityState === 'hidden') return;
      pending = true;
      setRefreshing(true);
      try {
        let query = supabase.from('osos_olcumler').select('*');
        query = source.facility === null ? query.is('fabrika_adi', null) : query.eq('fabrika_adi', source.facility);
        query = source.meter === null ? query.is('sayac_no', null) : query.eq('sayac_no', source.meter);
        const { data, error } = await query.order('olcum_zamani', { ascending: false }).limit(20);
        if (error) throw error;
        if (!disposed) {
          setRows(measurementSeries(data || [], source));
          setError('');
        }
      } catch (error) {
        if (!disposed) setError(error.message || 'Ölçümler yüklenemedi.');
      } finally {
        pending = false;
        if (!disposed) {
          setRefreshing(false);
          if (automatic.current && document.visibilityState !== 'hidden') refreshTimer.current = setTimeout(load, 5000);
        }
      }
    };
    const visibility = () => { clearTimeout(refreshTimer.current); if (document.visibilityState !== 'hidden') load(); };
    refresh.current = load;
    load();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', load);
    return () => {
      disposed = true;
      clearTimeout(refreshTimer.current);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', load);
      refresh.current = () => {};
    };
  }, [source]);

  useEffect(() => {
    automatic.current = autoRefresh;
    clearTimeout(refreshTimer.current);
    if (autoRefresh) refresh.current();
  }, [autoRefresh]);

  const latest = rows.at(-1);
  const statuses = latest ? [
    ['Gerilim L1–N', measurementRange(latest.gerilim_l1, 207, 253), '207–253 V aralığında'],
    ['Frekans', measurementRange(latest.frekans, 49.5, 50.5), '49,5–50,5 Hz aralığında'],
    ['Güç faktörü', measurementRange(latest.guc_faktoru, 0.85, 1), '0,85–1 aralığında']
  ] : [];
  const measurements = [
    ['Aktif güç', 'aktif_guc', 'kW'], ['Reaktif güç', 'reaktif_guc', 'kVAr'], ['Kapasitif güç', 'kapasitif_guc', 'kVAr'], ['Görünür güç', 'gorunen_guc', 'kVA'],
    ['Gerilim L1–N', 'gerilim_l1', 'V'], ['Gerilim L2–N', 'gerilim_l2', 'V'], ['Gerilim L3–N', 'gerilim_l3', 'V'],
    ['Akım L1', 'akim_l1', 'A'], ['Akım L2', 'akim_l2', 'A'], ['Akım L3', 'akim_l3', 'A'],
    ['Güç faktörü', 'guc_faktoru', 'cos φ'], ['Toplam enerji', 'toplam_enerji', 'kWh'], ['Frekans', 'frekans', 'Hz']
  ];

  return <section className="space-y-6 p-6 bg-gray-50" aria-busy={loading || refreshing}>
    <div className="bg-white p-6 rounded-xl border border-gray-200 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-800">Kaydedilmiş ölçümleri izle</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => source ? refresh.current() : setDiscoveryVersion(value => value + 1)} disabled={loading || refreshing} className="flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-lg">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />{refreshing ? 'Yükleniyor…' : 'Yenile'}
          </button>
          <button type="button" disabled={!source} aria-pressed={autoRefresh} onClick={() => setAutoRefresh(value => !value)} className="px-4 py-2 border border-gray-300 rounded-lg">
            {autoRefresh ? 'Otomatik yenileme açık' : 'Otomatik yenileme kapalı'}
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-600">Şirkete kaydedilen ölçümler tesis ve sayaç bazında gösterilir. Yeni ölçüm dosyasını Rapor sekmesinden yükleyebilirsiniz. Otomatik yenileme açıkken bu sekme görünür olduğu sürece, önceki sorgu tamamlandıktan 5 saniye sonra kontrol edilir.</p>
      <label className="block text-sm font-medium text-gray-700">Tesis ve sayaç
        <select className="block mt-1 w-full p-2 border rounded-lg" value={manual ? 'manual' : source ? sourceKey(source) : ''} onChange={event => {
          if (event.target.value === 'manual') { setManual(true); setFacility(source?.facility || ''); setMeter(source?.meter || ''); return; }
          setManual(false); setSource(sources.find(item => item.key === event.target.value) || null);
        }}>
          {!source && <option value="">{loading ? 'Kaynaklar yükleniyor…' : 'Kaynak seçin'}</option>}
          {source && !sources.some(item => item.key === sourceKey(source)) && <option value={sourceKey(source)}>{sourceLabel(source)}</option>}
          {sources.map(item => <option key={item.key} value={item.key}>{sourceLabel(item)}</option>)}
          <option value="manual">Tesis ve sayaç numarasıyla ara</option>
        </select>
      </label>
      <p className="text-xs text-gray-500">Listede en son 1.000 kayıtta bulunan kaynaklar yer alır. Daha eski bir kaynağı tesis ve sayaç numarasıyla arayabilirsiniz. Sayaç numarası olmayan kayıtlar ayrı bir kaynak olarak tutulur.</p>
      {manual && <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault();
        if (!facility.trim()) { setError('Tesis adını girin.'); return; }
        setSource({ facility: facility.trim(), meter: meter.trim() || null });
      }}>
        <label className="block flex-1 text-sm">Tesis adı<input required maxLength={200} value={facility} onChange={event => setFacility(event.target.value)} className="block w-full border rounded p-2 mt-1" /></label>
        <label className="block flex-1 text-sm">Sayaç numarası (yoksa boş bırakın)<input maxLength={200} value={meter} onChange={event => setMeter(event.target.value)} className="block w-full border rounded p-2 mt-1" /></label>
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg">Ölçümleri göster</button>
      </form>}
      {source && <p className="text-sm text-gray-600">Gösterilen kaynak: <strong>{sourceLabel(source)}</strong>{latest && <> · Son ölçüm: <time dateTime={latest.date.toISOString()}>{latest.zaman}</time></>}</p>}
    </div>

    {error && <div role="alert" className="bg-orange-50 border border-orange-300 p-4 rounded-lg flex items-start gap-3"><AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" /><p>{error} {latest && 'Ekranda son başarılı sorgunun kayıtları gösteriliyor.'}</p></div>}
    {!latest && <p role="status" className="bg-white p-6 rounded-xl border border-gray-200">{loading || refreshing ? 'Ölçümler yükleniyor…' : source ? 'Bu tesis ve sayaç için geçerli zaman bilgisi olan ölçüm bulunamadı.' : 'Henüz ölçüm kaydı bulunmuyor. Rapor sekmesinden gerçek ölçüm dosyanızı yükleyin.'}</p>}
    {latest && <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {statuses.map(([label, status, range]) => <div key={label} className={`p-4 rounded-xl border ${statusClass(status)}`}><h2 className="text-sm font-semibold">{label}</h2><p className="font-bold mt-1">{status === null ? 'Ölçüm yok' : status ? range : 'Gösterim aralığı dışında'}</p></div>)}
      </div>
      <p className="text-sm text-gray-600">Eksik ölçümler “—” ile gösterilir. Gösterim aralıkları anlık kaydı değerlendirmeye yardımcı olur; standart uygunluğu, faturalama veya kompanzasyon kararı için ölçüm dönemi ve tesis koşulları ayrıca değerlendirilir.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {measurements.map(([label, key, unit]) => <div key={key} className="bg-white p-4 rounded-xl border border-gray-200"><h2 className="text-sm text-gray-600">{label}</h2><p className="text-2xl font-bold text-gray-800 mt-2">{format(latest[key])} <span className="text-sm font-normal">{unit}</span></p></div>)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-4 rounded-xl border border-gray-200 min-w-0"><h2 className="text-lg font-bold mb-4">Son 20 güç ölçümü</h2><ResponsiveContainer width="100%" height={260}><LineChart data={rows} accessibilityLayer><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="zaman" tick={{ fontSize: 10 }} minTickGap={30} /><YAxis /><Tooltip /><Legend /><Line isAnimationActive={false} type="linear" dataKey="aktif_guc" stroke="#2563eb" strokeWidth={2} name="Aktif (kW)" /><Line isAnimationActive={false} type="linear" dataKey="reaktif_guc" stroke="#7c3aed" strokeWidth={2} name="Reaktif (kVAr)" /></LineChart></ResponsiveContainer></div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 min-w-0"><h2 className="text-lg font-bold mb-4">Son 20 gerilim ölçümü</h2><ResponsiveContainer width="100%" height={260}><LineChart data={rows} accessibilityLayer><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="zaman" tick={{ fontSize: 10 }} minTickGap={30} /><YAxis domain={['auto', 'auto']} unit=" V" /><Tooltip /><Legend /><Line isAnimationActive={false} type="linear" dataKey="gerilim" stroke="#047857" strokeWidth={2} name="Gerilim L1–N (V)" /></LineChart></ResponsiveContainer></div>
      </div>
    </>}
  </section>;
}

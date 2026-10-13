import React, { useEffect, useState } from 'react';
import { RefreshCw, Zap, TrendingUp, Activity, DollarSign, AlertTriangle, Settings, Download, Play, Square } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { supabase } from './supabaseClient';
import { parseDecimal } from './operations.mjs';
const LIVE_SOURCE_ENABLED = false;

const OsosCanliIzleme = () => {
  const [olcum, setOlcum] = useState(null);
  const [gecmisVeriler, setGecmisVeriler] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false); // Başlangıçta kapalı
  const [liveCollecting, setLiveCollecting] = useState(false); // Canlı toplama durumu
  const [error, setError] = useState(null);

  useEffect(() => {
    // ılk veri yükleme
    loadData();
    
    // Otomatik yenişleme
    if (autoRefresh) {
      const interval = setInterval(loadData, 5000); // 5 saniyede bir
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const loadData = async () => {
    try {
      const { data, error } = await supabase
        .from('osos_olcumler')
        .select('*')
        .order('olcum_zamani', { ascending: false })
        .limit(20);
      if (error) throw error;
      const rows = data || [];
      setOlcum(rows[0] || null);
      setError(null);
      setGecmisVeriler([...rows].reverse().map(row => ({
        zaman: new Date(row.olcum_zamani || row.created_at).toLocaleString('tr-TR'),
        aktif_guc: parseDecimal(row.aktif_guc, null),
        reaktif_guc: parseDecimal(row.reaktif_guc, null),
        gerilim: parseDecimal(row.gerilim_l1, null)
      })));
      setLoading(false);
    } catch (err) {
      console.error('OSOS verisi yüklenemedi:', err);
      setError('OSOS bağlantısı kurulamadı. Lütfen veri kaynağını kontrol edin.');
      setLoading(false);
    }
  };

  const authorizedHeaders = async () => { setError('Harici canlı bağlantılar şimdilik kapalı. Dosyadan yüklenen ve kaydedilmiş ölçümleri izleyebilirsiniz.'); };

  // OSOS Portal'dan canlı veri çek
  const fetchLiveData = async () => { setError('Harici canlı bağlantılar şimdilik kapalı. Dosyadan yüklenen ve kaydedilmiş ölçümleri izleyebilirsiniz.'); };

  // Otomatik veri toplama başlat/durdur
  const toggleLiveCollection = async (start) => { setError('Harici canlı bağlantılar şimdilik kapalı. Dosyadan yüklenen ve kaydedilmiş ölçümleri izleyebilirsiniz.'); };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 space-y-4">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
        <p className="text-gray-600">OSOS verileri yükleniyor...</p>
      </div>
    );
  }

  if (error || !olcum) {
    return (
      <div className="flex flex-col items-center justify-center h-96 space-y-4 p-6">
        <AlertTriangle className="w-16 h-16 text-orange-500" />
        <div className="text-center">
          <h3 className="text-xl font-bold text-gray-800 mb-2">OSOS Verisi Bulunamadı</h3>
          <p className="text-gray-600 mb-4">{error || 'Henüz OSOS ölçümü kaydedilmedi.'}</p>
          <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg text-left max-w-2xl">
            <h4 className="font-semibold text-blue-800 mb-2">💾 Veri Kaydetmek için:</h4>
            <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
              <li>OSOS Portal'a giriş yapın (dağıtım şirketi kullanıcı bilgilerinizle)</li>
              <li>Sayaç verilerinizi indirin (JSON/Excel formatında)</li>
              <li>OSOS Rapor sekmesinden "OSOS JSON Import" butonuna tıklayın</li>
              <li>İndirdiğiniz dosyayı seçin ve yükleyin</li>
            </ol>
          </div>
          <button
            onClick={loadData}
            className="mt-4 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors mx-auto"
          >
            <RefreshCw className="w-5 h-5" />
            Yeniden Dene
          </button>
        </div>
      </div>
    );
  }

  const measurements = [
    { label: 'Aktif Güç', value: olcum.aktif_guc, unit: 'kW', color: 'text-blue-600', bgColor: 'bg-blue-50', icon: Zap },
    { label: 'Reaktif Güç', value: olcum.reaktif_guc, unit: 'kVAr', color: 'text-purple-600', bgColor: 'bg-purple-50', icon: Activity },
    { label: 'Kapasitif Güç', value: olcum.kapasitif_guc, unit: 'kVAr', color: 'text-pink-600', bgColor: 'bg-pink-50', icon: TrendingUp },
    { label: 'Gerilim L1', value: olcum.gerilim_l1, unit: 'V', color: 'text-green-600', bgColor: 'bg-green-50', icon: Zap },
    { label: 'Gerilim L2', value: olcum.gerilim_l2, unit: 'V', color: 'text-green-600', bgColor: 'bg-green-50', icon: Zap },
    { label: 'Gerilim L3', value: olcum.gerilim_l3, unit: 'V', color: 'text-green-600', bgColor: 'bg-green-50', icon: Zap },
    { label: 'Akım L1', value: olcum.akim_l1, unit: 'A', color: 'text-orange-600', bgColor: 'bg-orange-50', icon: Activity },
    { label: 'Akım L2', value: olcum.akim_l2, unit: 'A', color: 'text-orange-600', bgColor: 'bg-orange-50', icon: Activity },
    { label: 'Akım L3', value: olcum.akim_l3, unit: 'A', color: 'text-orange-600', bgColor: 'bg-orange-50', icon: Activity },
    { label: 'Güç Faktörü', value: olcum.guc_faktoru, unit: 'cos φ', color: 'text-indigo-600', bgColor: 'bg-indigo-50', icon: DollarSign },
    { label: 'Toplam Enerji', value: olcum.toplam_enerji, unit: 'kWh', color: 'text-red-600', bgColor: 'bg-red-50', icon: TrendingUp },
    { label: 'Frekans', value: olcum.frekans, unit: 'Hz', color: 'text-yellow-600', bgColor: 'bg-yellow-50', icon: Activity },
  ];

  // Durum kontrolü
  const gerilimDurumu = olcum.gerilim_l1 == null ? null : olcum.gerilim_l1 >= 207 && olcum.gerilim_l1 <= 253;
  const frekansDurumu = olcum.frekans == null ? null : olcum.frekans >= 49.5 && olcum.frekans <= 50.5;
  const gucFaktoruDurumu = olcum.guc_faktoru == null ? null : olcum.guc_faktoru >= 0.85;

  return (
    <div className="space-y-6 p-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between bg-white p-6 rounded-xl shadow-sm">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Kaydedilmiş ölçümleri izle</h1>
          <p className="text-gray-600 mt-1">
            {olcum.fabrika_adi || 'OSOS Sayaç'} - 
            Son güncelleme: {new Date(olcum.olcum_zamani || olcum.created_at).toLocaleString('tr-TR')}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <button
            disabled title="Harici canlı bağlantılar şimdilik kapalı"
            onClick={fetchLiveData}
            
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            OSOS'tan çek
          </button>
          
          <button
            hidden={!LIVE_SOURCE_ENABLED}
            onClick={() => toggleLiveCollection(!liveCollecting)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              liveCollecting 
                ? 'bg-red-600 hover:bg-red-700 text-white' 
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {liveCollecting ? (
              <>
                <Square className="w-4 h-4" />
                Otomatik Toplamayı Durdur
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Otomatik Toplama Başlat
              </>
            )}
          </button>
          
          <button
            onClick={loadData}
            className="flex items-center gap-2 px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg font-medium transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Yenile
          </button>
          
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              autoRefresh 
                ? 'bg-green-100 text-green-700 border border-green-300' 
                : 'bg-gray-100 text-gray-700 border border-gray-300'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin' : ''}`} />
            {autoRefresh ? '5 saniyede yenileme açık' : '5 saniyede yenileme kapalı'}
          </button>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
        {LIVE_SOURCE_ENABLED ? 'Yalnızca gerçek sayaç kaynağından gelen kayıtlar gösterilir.' : 'Bu ekran kaydedilen gerçek ölçümleri gösterir. OSOS Rapor bölümünden ölçüm JSON dosyanızı yükleyin. Harici canlı bağlantılar şimdilik kapalı; dosya içe aktarma ve kayıtlı ölçümler kullanılabilir.'}
        {' '}Eksik ölçümler “—” olarak görünür; gösterim aralıkları tek başına uygunluk veya faturalama kararı değildir.
      </div>
      {/* Durum Gıstergeleri */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={`p-4 rounded-xl border-2 ${
          gerilimDurumu ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${gerilimDurumu ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
            <div>
              <h3 className="text-sm font-medium text-gray-700">Gerilim Durumu</h3>
              <p className={`text-lg font-bold ${gerilimDurumu ? 'text-green-700' : 'text-red-700'}`}>
                {gerilimDurumu == null ? 'Ölçüm yok' : gerilimDurumu ? '207–253 V aralığında' : 'Aralık dışında'}
              </p>
            </div>
          </div>
        </div>

        <div className={`p-4 rounded-xl border-2 ${
          frekansDurumu ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${frekansDurumu ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
            <div>
              <h3 className="text-sm font-medium text-gray-700">Frekans Durumu</h3>
              <p className={`text-lg font-bold ${frekansDurumu ? 'text-green-700' : 'text-red-700'}`}>
                {frekansDurumu == null ? 'Ölçüm yok' : frekansDurumu ? '49,5–50,5 Hz aralığında' : 'Aralık dışında'}
              </p>
            </div>
          </div>
        </div>

        <div className={`p-4 rounded-xl border-2 ${
          gucFaktoruDurumu ? 'bg-green-50 border-green-300' : 'bg-orange-50 border-orange-300'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${gucFaktoruDurumu ? 'bg-green-500' : 'bg-orange-500'} animate-pulse`} />
            <div>
              <h3 className="text-sm font-medium text-gray-700">Güç Faktörü</h3>
              <p className={`text-lg font-bold ${gucFaktoruDurumu ? 'text-green-700' : 'text-orange-700'}`}>
                {gucFaktoruDurumu == null ? 'Ölçüm yok' : gucFaktoruDurumu ? '≥ 0,85' : 'İnceleme gerekli'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ılım Kartları */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {measurements.map((measurement, index) => {
          const Icon = measurement.icon;
          return (
            <div key={index} className={`${measurement.bgColor} p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700">{measurement.label}</h3>
                <Icon className={`w-5 h-5 ${measurement.color}`} />
              </div>
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-bold ${measurement.color}`}>
                  {parseDecimal(measurement.value, null) === null ? '—' : parseDecimal(measurement.value).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-sm font-medium text-gray-500">{measurement.unit}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Grafikler */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Güç Grafi */}
        <div className="bg-white p-6 rounded-xl shadow-sm">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Kaydedilmiş Güç Ölçümleri</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={gecmisVeriler}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="zaman" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="aktif_guc" stroke="#3b82f6" strokeWidth={2} name="Aktif (kW)" />
              <Line type="monotone" dataKey="reaktif_guc" stroke="#a855f7" strokeWidth={2} name="Reaktif (kVAr)" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Gerilim Grafi */}
        <div className="bg-white p-6 rounded-xl shadow-sm">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Kaydedilmiş Gerilim Ölçümleri</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={gecmisVeriler}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="zaman" tick={{ fontSize: 11 }} />
              <YAxis domain={[200, 250]} />
              <Tooltip />
              <Legend />
              <Bar dataKey="gerilim" fill="#10b981" name="Gerilim (V)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Uyarılar */}
      {(gerilimDurumu === false || frekansDurumu === false || gucFaktoruDurumu === false) && (
        <div className="bg-orange-50 border-l-4 border-orange-500 p-6 rounded-r-xl">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-orange-600 shrink-0 mt-1" />
            <div>
              <h3 className="text-lg font-bold text-orange-800 mb-2">⚠️ Uyarılar</h3>
              <ul className="space-y-1 text-orange-700">
                {gerilimDurumu === false && <li>Gerilim gösterim aralığının dışında (Beklenen: 207–253 V)</li>}
                {frekansDurumu === false && <li>Frekans gösterim aralığının dışında (Beklenen: 49.5-50.5Hz)</li>}
                {gucFaktoruDurumu === false && <li>⚠️ Güç faktörü düşük (Beklenen: &gt;0.85), kompanzasyon önerilir</li>}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OsosCanliIzleme;


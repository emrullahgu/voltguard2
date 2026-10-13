import React, { useState, useEffect, useRef } from 'react';
import { Plus, Edit3, Trash2, Save, X, Download, FileText, Fuel, Car, Calendar, TrendingUp, DollarSign, Filter } from 'lucide-react';
import { supabase } from './supabaseClient';
import { parseDecimal, localISODate } from './operations.mjs';
import { exportTableReport, reportFileName, reportDate, reportMoney, reportNumber } from './pdfReport';
import * as XLSX from 'xlsx';
const faturaLogo = '/calisan/uygulama/fatura_logo.png';

export default function AkaryakitTakip() {
  const [kayitlar, setKayitlar] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const pdfPreviewRef = useRef(null);
  const [editingId, setEditingId] = useState(null);
  
  // Ay filtresi - Varsayılan olarak güncel ay
  const getCurrentMonth = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  };
  const [secilenAy, setSecilenAy] = useState(getCurrentMonth());
  const [aylikGoruntule, setAylikGoruntule] = useState(true);
  
  // Filtreler
  const [filtreArac, setFiltreArac] = useState('');
  const [filtreSurucu, setFiltreSurucu] = useState('');
  const [filtreBaslangic, setFiltreBaslangic] = useState('');
  const [filtreBitis, setFiltreBitis] = useState('');

  // Form state'leri - Basitleştirilmiş
  const [formData, setFormData] = useState({
    tarih: localISODate(),
    plaka: '',
    surucu: '',
    toplam_tutar: '',
    aciklama: ''
  });



  // Verileri yükle
  useEffect(() => {
    loadData();
  }, []);
  // Veri yükleme - Sadece yakıt kayıtları
  const loadData = async () => {
    try {
      setLoading(true);
      
      // Sadece kayıtları yükle - basit
      const { data: kayitlarData, error: kayitlarError } = await supabase
        .from('fuel_records')
        .select(`
          *,
          vehicles:vehicle_id (plate),
          drivers:driver_id (full_name)
        `)
        .order('date', { ascending: false });

      if (kayitlarError) throw kayitlarError;

      setKayitlar(kayitlarData || []);
    } catch (error) {
      console.error('Veri yükleme hatası:', error);
      alert('Veriler yüklenirken bir hata oluştu: ' + error.message);
    } finally {
      setLoading(false);
    }
  };




  // Kayıt ekle/güncelle - Basitleştirilmiş (406 hatası düzeltildi)
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      const amount = parseDecimal(formData.toplam_tutar, null);
      const plate = formData.plaka.trim().toUpperCase().replace(/\s+/g, ' ');
      const driver = formData.surucu.trim();
      if (!plate || !driver || !(amount > 0)) throw new Error('Plaka, sürücü ve sıfırdan büyük tutar zorunludur.');
      // 1. Plaka varsa araç bul, yoksa oluştur
      let vehicleId;
      const { data: existingVehicle, error: vehicleSelectError } = await supabase
        .from('vehicles')
        .select('id')
        .eq('plate', plate)
        .maybeSingle(); // single() yerine maybeSingle() - 406 hatasını önler

      if (vehicleSelectError) throw vehicleSelectError;

      if (existingVehicle) {
        vehicleId = existingVehicle.id;
      } else {
        const { data: newVehicle, error: vehicleError } = await supabase
          .from('vehicles')
          .insert([{ plate: plate, brand: '-', model: '-' }])
          .select()
          .single();
        
        if (vehicleError) throw vehicleError;
        vehicleId = newVehicle.id;
      }

      // 2. Sürücü varsa bul, yoksa oluştur
      let driverId;
      const { data: existingDriver, error: driverSelectError } = await supabase
        .from('drivers')
        .select('id')
        .eq('full_name', driver)
        .maybeSingle(); // single() yerine maybeSingle() - 406 hatasını önler

      if (driverSelectError) throw driverSelectError;

      if (existingDriver) {
        driverId = existingDriver.id;
      } else {
        const { data: newDriver, error: driverError } = await supabase
          .from('drivers')
          .insert([{ full_name: driver, active: true }])
          .select()
          .single();
        
        if (driverError) throw driverError;
        driverId = newDriver.id;
      }

      // 3. Yakıt kaydını oluştur
      const kayitData = {
        date: formData.tarih,
        vehicle_id: vehicleId,
        driver_id: driverId,
        ...(editingId ? {} : { liters: 0, price_per_liter: 0 }),
        total_amount: amount,
        description: formData.aciklama || null
      };

      if (editingId) {
        const { error } = await supabase
          .from('fuel_records')
          .update(kayitData)
          .eq('id', editingId).select('id').single();

        if (error) throw error;
        alert('Kayıt güncellendi!');
      } else {
        const { error } = await supabase
          .from('fuel_records')
          .insert([kayitData]);

        if (error) throw error;
        alert('Kayıt eklendi!');
      }

      setShowModal(false);
      resetForm();
      loadData();
    } catch (error) {
      console.error('Kayıt hatası:', error);
      alert('Kayıt işlemi sırasında bir hata oluştu: ' + error.message);
    }
  };

  // Kayıt sil
  const handleDelete = async (id) => {
    if (!confirm('Bu kaydı silmek istediğinizden emin misiniz?')) return;
    
    try {
      const { error } = await supabase
        .from('fuel_records')
        .delete()
        .eq('id', id).select('id').single();

      if (error) throw error;
      
      alert('Kayıt silindi!');
      loadData();
    } catch (error) {
      console.error('Silme hatası:', error);
      alert('Kayıt silinirken bir hata oluştu: ' + error.message);
    }
  };

  // Düzenle - Basitleştirilmiş
  const handleEdit = (kayit) => {
    setFormData({
      tarih: kayit.date,
      plaka: kayit.vehicles?.plate || '',
      surucu: kayit.drivers?.full_name || '',
      toplam_tutar: kayit.total_amount.toString(),
      aciklama: kayit.description || ''
    });
    setEditingId(kayit.id);
    setShowModal(true);
  };

  // Form sıfırlama - Basitleştirilmiş
  const resetForm = () => {
    setEditingId(null);
    setFormData({
      tarih: localISODate(),
      plaka: '',
      surucu: '',
      toplam_tutar: '',
      aciklama: ''
    });
  };

  // Filtreleme - Basitleştirilmiş
  const filtreliKayitlar = kayitlar.filter(kayit => {
    // Ay bazında filtreleme
    if (aylikGoruntule && secilenAy) {
      const kayitAy = kayit.date.substring(0, 7);
      if (kayitAy !== secilenAy) return false;
    }
    
    // Tarih aralığı
    if (!aylikGoruntule) {
      if (filtreBaslangic && kayit.date < filtreBaslangic) return false;
      if (filtreBitis && kayit.date > filtreBitis) return false;
    }

    // Plaka filtresi
    if (filtreArac && !kayit.vehicles?.plate?.includes(filtreArac.toUpperCase())) return false;
    
    // Sürücü filtresi
    if (filtreSurucu && !kayit.drivers?.full_name?.toLowerCase().includes(filtreSurucu.toLowerCase())) return false;
    
    return true;
  });

  // İstatistik hesaplama
  const istatistikler = {
    toplamKayit: filtreliKayitlar.length,
    toplamLitre: filtreliKayitlar.reduce((sum, k) => sum + k.liters, 0),
    toplamTutar: filtreliKayitlar.reduce((sum, k) => sum + k.total_amount, 0),
    ortalamaBirimFiyat: filtreliKayitlar.length > 0 
      ? filtreliKayitlar.reduce((sum, k) => sum + k.price_per_liter, 0) / filtreliKayitlar.length 
      : 0
  };

  // Excel'e aktar - Basitleştirilmiş
  const exportToExcel = () => {
    const data = filtreliKayitlar.map(kayit => ({
      'Tarih': new Date(kayit.date).toLocaleDateString('tr-TR'),
      'Plaka': kayit.vehicles?.plate || '-',
      'Sürücü': kayit.drivers?.full_name || '-',
      'Toplam Tutar': kayit.total_amount,
      'Açıklama': kayit.description || '-'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Akaryakıt Kayıtları');
    XLSX.writeFile(wb, `akaryakıt_kayıtları_${localISODate()}.xlsx`);
  };

  // PDF'e aktar - App.jsx mantığı ile (HTML to PDF)
  const exportToPDF = async () => {
    try {
      await exportTableReport({ title: 'Akaryakıt Kayıt Raporu',
        subtitle: `Seçili kayıtlar: ${filtreliKayitlar.length} | Rapor tarihi: ${reportDate()}`,
        head: ['Tarih', 'Plaka', 'Sürücü', 'Litre', 'Birim fiyat (TL/L)', 'Toplam (TL)', 'Açıklama'],
        body: filtreliKayitlar.map(k => [reportDate(k.date), k.vehicles?.plate || 'Belirtilmedi', k.drivers?.full_name || 'Belirtilmedi',
          reportNumber(k.liters), reportNumber(k.price_per_liter), reportNumber(k.total_amount), k.description || '']),
        summary: [['Kayıt sayısı', String(filtreliKayitlar.length)],
          ['Toplam litre', reportNumber(filtreliKayitlar.reduce((sum, k) => sum + Number(k.liters || 0), 0))],
          ['Toplam tutar', reportMoney(filtreliKayitlar.reduce((sum, k) => sum + Number(k.total_amount || 0), 0))]],
        filename: reportFileName('Akaryakit_Raporu') });
    } catch (error) { alert('PDF oluşturulamadı: ' + error.message); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Veriler yükleniyor...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header - Basitleştirilmiş */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Fuel className="w-8 h-8 text-blue-600" />
              <div>
                <h1 className="text-3xl font-bold text-gray-800">Akaryakıt Takip</h1>
                <p className="text-sm text-gray-500">Hangi plaka, hangi gün, kim, ne kadar</p>
              </div>
            </div>
            <button
              onClick={() => { setShowModal(true); setEditingId(null); resetForm(); }}
              className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-lg transition shadow-lg"
            >
              <Plus className="w-5 h-5" />
              <span className="font-semibold">Yakıt Kaydı Ekle</span>
            </button>
          </div>

          {/* Ay Seçici ve Görüntüleme Modu */}
          <div className="flex items-center gap-4 mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-600" />
              <span className="font-semibold text-gray-700">Görüntüleme:</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setAylikGoruntule(true); setSecilenAy(getCurrentMonth()); }}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  aylikGoruntule 
                    ? 'bg-blue-600 text-white shadow-md' 
                    : 'bg-white text-gray-600 hover:bg-gray-100'
                }`}
              >
                Aylık
              </button>
              <button
                onClick={() => { setAylikGoruntule(false); setFiltreBaslangic(''); setFiltreBitis(''); }}
                className={`px-4 py-2 rounded-lg font-medium transition ${
                  !aylikGoruntule 
                    ? 'bg-blue-600 text-white shadow-md' 
                    : 'bg-white text-gray-600 hover:bg-gray-100'
                }`}
              >
                Tüm Veriler
              </button>
            </div>
            {aylikGoruntule && (
              <>
                <div className="h-6 w-px bg-gray-300"></div>
                <div className="flex items-center gap-2">
                  <label className="font-medium text-gray-700">Ay Seç:</label>
                  <input
                    type="month"
                    value={secilenAy}
                    onChange={(e) => setSecilenAy(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                  />
                  <button
                    onClick={() => setSecilenAy(getCurrentMonth())}
                    className="px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition text-sm font-medium"
                    title="Güncel aya dön"
                  >
                    Bugün
                  </button>
                </div>
              </>
            )}
          </div>

          {/* İstatistikler */}
          <div className="mb-4">
            <h2 className="text-lg font-bold text-gray-700">
              {aylikGoruntule 
                ? `${new Date(secilenAy + '-01').toLocaleDateString('tr-TR', { year: 'numeric', month: 'long' })} İstatistikleri`
                : 'Genel İstatistikler'
              }
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
            <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg p-4 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-90">Toplam Kayıt</p>
                  <p className="text-2xl font-bold">{istatistikler.toplamKayit}</p>
                </div>
                <FileText className="w-10 h-10 opacity-80" />
              </div>
            </div>
            <div className="bg-gradient-to-r from-green-500 to-green-600 rounded-lg p-4 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-90">Toplam Litre</p>
                  <p className="text-2xl font-bold">{istatistikler.toplamLitre.toFixed(2)}</p>
                </div>
                <Fuel className="w-10 h-10 opacity-80" />
              </div>
            </div>
            <div className="bg-gradient-to-r from-red-500 to-red-600 rounded-lg p-4 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-90">Toplam Tutar</p>
                  <p className="text-2xl font-bold">{istatistikler.toplamTutar.toFixed(2)} ₺</p>
                </div>
                <DollarSign className="w-10 h-10 opacity-80" />
              </div>
            </div>
            <div className="bg-gradient-to-r from-purple-500 to-purple-600 rounded-lg p-4 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm opacity-90">Ort. Birim Fiyat</p>
                  <p className="text-2xl font-bold">{istatistikler.ortalamaBirimFiyat.toFixed(2)} ₺</p>
                </div>
                <TrendingUp className="w-10 h-10 opacity-80" />
              </div>
            </div>
          </div>
        </div>

        {/* Filtreler - Basitleştirilmiş */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-5 h-5 text-gray-600" />
            <h2 className="text-xl font-bold text-gray-800">Filtrele</h2>
            {aylikGoruntule && (
              <span className="ml-2 px-3 py-1 bg-blue-100 text-blue-700 text-sm font-semibold rounded-full">
                {new Date(secilenAy + '-01').toLocaleDateString('tr-TR', { year: 'numeric', month: 'long' })}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Plaka</label>
              <input
                type="text"
                value={filtreArac}
                onChange={(e) => setFiltreArac(e.target.value)}
                placeholder="34 ABC 123"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Sürücü</label>
              <input
                type="text"
                value={filtreSurucu}
                onChange={(e) => setFiltreSurucu(e.target.value)}
                placeholder="Ahmet Yılmaz"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            {!aylikGoruntule && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Başlangıç Tarihi</label>
                  <input
                    type="date"
                    value={filtreBaslangic}
                    onChange={(e) => setFiltreBaslangic(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Bitiş Tarihi</label>
                  <input
                    type="date"
                    value={filtreBitis}
                    onChange={(e) => setFiltreBitis(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </>
            )}
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => {
                setFiltreArac('');
                setFiltreSurucu('');
                setFiltreBaslangic('');
                setFiltreBitis('');
              }}
              className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition"
            >
              Filtreleri Temizle
            </button>
            <button
              onClick={exportToExcel}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Excel'e Aktar
            </button>
            <button
              onClick={exportToPDF}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              PDF'e Aktar
            </button>
          </div>
        </div>

        {/* Kayıtlar Tablosu */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
                <tr>
                  <th className="px-4 py-3 text-left">Tarih</th>
                  <th className="px-4 py-3 text-left">Plaka</th>
                  <th className="px-4 py-3 text-left">Sürücü</th>
                  <th className="px-4 py-3 text-right">Toplam</th>
                  <th className="px-4 py-3 text-center">İşlemler</th>
                </tr>
              </thead>
              <tbody>
                {filtreliKayitlar.map((kayit, index) => (
                  <tr key={kayit.id} className={index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                    <td className="px-4 py-3">{new Date(kayit.date).toLocaleDateString('tr-TR')}</td>
                    <td className="px-4 py-3 font-medium">{kayit.vehicles?.plate || '-'}</td>
                    <td className="px-4 py-3">{kayit.drivers?.full_name || '-'}</td>
                    <td className="px-4 py-3 text-right font-bold text-blue-600">{kayit.total_amount.toFixed(2)} ₺</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleEdit(kayit)}
                          className="p-2 bg-blue-100 hover:bg-blue-200 text-blue-600 rounded-lg transition"
                          title="Düzenle"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(kayit.id)}
                          className="p-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg transition"
                          title="Sil"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Kayıt Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-6 rounded-t-xl">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold">
                    {editingId ? 'Kayıt Güncelle' : 'Yeni Yakıt Kaydı'}
                  </h2>
                  <button
                    onClick={() => { setShowModal(false); setEditingId(null); resetForm(); }}
                    className="p-2 hover:bg-white/20 rounded-lg transition"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Tarih *</label>
                    <input
                      type="date"
                      required
                      value={formData.tarih}
                      onChange={(e) => setFormData({ ...formData, tarih: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Plaka *</label>
                    <input
                      type="text"
                      required
                      value={formData.plaka}
                      onChange={(e) => setFormData({ ...formData, plaka: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="34 ABC 123"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Sürücü *</label>
                    <input
                      type="text"
                      required
                      value={formData.surucu}
                      onChange={(e) => setFormData({ ...formData, surucu: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Ahmet Yılmaz"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Toplam Tutar *</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={formData.toplam_tutar}
                      onChange={(e) => setFormData({ ...formData, toplam_tutar: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="0.00"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Açıklama</label>
                    <textarea
                      value={formData.aciklama}
                      onChange={(e) => setFormData({ ...formData, aciklama: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      rows="3"
                      placeholder="Ek notlar..."
                    />
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    type="submit"
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-lg transition"
                  >
                    <Save className="w-5 h-5" />
                    <span>{editingId ? 'Güncelle' : 'Kaydet'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowModal(false); setEditingId(null); resetForm(); }}
                    className="px-6 py-3 bg-gray-500 hover:bg-gray-600 text-white font-semibold rounded-lg transition"
                  >
                    İptal
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* PDF Preview Modal - Ekranda görünmez, sadece PDF'e çevirmek için */}
        {showPdfPreview && (
          <div style={{ position: 'absolute', left: '-9999px', top: 0 }}>
            <div ref={pdfPreviewRef} style={{ width: '210mm', backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }}>
              
              {/* Content Area */}
              <div style={{ padding: '15mm' }}>
                {/* Header - Logo solda, Bilgiler sağda */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #e5e7eb', paddingBottom: '20px', marginBottom: '30px' }}>
                  <div style={{ minWidth: '150px' }}>
                    <img src="/calisan/uygulama/fatura_logo.png" alt="Logo" style={{ height: '60px', maxWidth: '180px', objectFit: 'contain' }} />
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <h1 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1f2937', margin: '0 0 8px 0' }}>AKARYAKIT TAKİP RAPORU</h1>
                    <p style={{ fontSize: '11px', color: '#6b7280', margin: '3px 0' }}>
                      Rapor No: AKY-{new Date().getFullYear()}-{String(new Date().getMonth() + 1).padStart(2, '0')}-{String(new Date().getDate()).padStart(2, '0')}
                    </p>
                    <p style={{ fontSize: '11px', color: '#6b7280', margin: '3px 0' }}>
                      Tarih: {new Date().toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                    {aylikGoruntule && secilenAy && (
                      <p style={{ fontSize: '11px', color: '#2563eb', margin: '3px 0', fontWeight: 'bold' }}>
                        Dönem: {new Date(secilenAy + '-01').toLocaleDateString('tr-TR', { year: 'numeric', month: 'long' })}
                      </p>
                    )}
                  </div>
                </div>

                {/* Özet Bilgiler - Tek satırda */}
                <div style={{ display: 'flex', gap: '10px', marginBottom: '25px', padding: '15px', backgroundColor: '#f9fafb', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '3px' }}>Kayıt Sayısı</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#1f2937' }}>{istatistikler.toplamKayit}</div>
                  </div>
                  <div style={{ width: '1px', backgroundColor: '#d1d5db' }}></div>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '3px' }}>Toplam Litre</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#1f2937' }}>{istatistikler.toplamLitre.toFixed(2)} L</div>
                  </div>
                  <div style={{ width: '1px', backgroundColor: '#d1d5db' }}></div>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '3px' }}>Toplam Tutar</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#2563eb' }}>
                      {istatistikler.toplamTutar.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺
                    </div>
                  </div>
                  <div style={{ width: '1px', backgroundColor: '#d1d5db' }}></div>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '3px' }}>Ort. Birim Fiyat</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#1f2937' }}>{istatistikler.ortalamaBirimFiyat.toFixed(2)} ₺/L</div>
                  </div>
                </div>

                {/* Tablo */}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f3f4f6' }}>
                      <th style={{ padding: '10px 8px', textAlign: 'center', border: '1px solid #d1d5db', color: '#374151', fontWeight: 'bold' }}>Tarih</th>
                      <th style={{ padding: '10px 8px', textAlign: 'center', border: '1px solid #d1d5db', color: '#374151', fontWeight: 'bold' }}>Plaka</th>
                      <th style={{ padding: '10px 8px', textAlign: 'left', border: '1px solid #d1d5db', color: '#374151', fontWeight: 'bold' }}>Sürücü</th>
                      <th style={{ padding: '10px 8px', textAlign: 'right', border: '1px solid #d1d5db', color: '#374151', fontWeight: 'bold' }}>Toplam Tutar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtreliKayitlar.map((kayit, index) => (
                      <tr key={kayit.id} style={{ backgroundColor: index % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                        <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #e5e7eb' }}>
                          {new Date(kayit.date).toLocaleDateString('tr-TR')}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #e5e7eb', fontWeight: 'bold' }}>
                          {kayit.vehicles?.plate || '-'}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'left', border: '1px solid #e5e7eb' }}>
                          {kayit.drivers?.full_name || '-'}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'right', border: '1px solid #e5e7eb', fontWeight: 'bold' }}>
                          {kayit.total_amount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ backgroundColor: '#f3f4f6', fontWeight: 'bold' }}>
                      <td colSpan="3" style={{ padding: '10px 8px', textAlign: 'center', border: '1px solid #d1d5db', color: '#1f2937' }}>TOPLAM</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', border: '1px solid #d1d5db', color: '#2563eb' }}>
                        {istatistikler.toplamTutar.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺
                      </td>
                    </tr>
                  </tfoot>
                </table>

                {/* Footer - Şirket Bilgileri */}
                <div style={{ marginTop: '30px', paddingTop: '15px', borderTop: '2px solid #e5e7eb' }}>
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '11px', fontWeight: 'bold', color: '#1f2937', margin: '0 0 8px 0' }}>VOLTGUARD</p>
                    <p style={{ fontSize: '10px', color: '#6b7280', margin: '3px 0' }}>
                      Kemalpaşa OSB/İzmir
                    </p>
                    <p style={{ fontSize: '10px', color: '#6b7280', margin: '3px 0' }}>
                      Tel: +90 545 434 67 35 | voltguard.com.tr
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { Plus, Edit3, Trash2, Save, X, Download, FileText, Clock, MapPin, User, Wrench, Calendar, Filter, Users, Building, Package, FileDown, TrendingUp } from 'lucide-react';
import { supabase } from './supabaseClient';
import { workDurationHours, parseDecimal, localISODate } from './operations.mjs';
import * as XLSX from 'xlsx';
import { exportTableReport, reportFileName, reportDate, reportMoney, reportNumber } from './pdfReport';
const faturaLogo = '/calisan/uygulama/fatura_logo.png';

export default function IsTakip() {
  const [activeTab, setActiveTab] = useState('kayitlar'); // 'kayitlar', 'calisanlar', 'lokasyonlar', 'malzemeler'
  const [kayitlar, setKayitlar] = useState([]);
  const [calisanlar, setCalisanlar] = useState([]);
  const [lokasyonlar, setLokasyonlar] = useState([]);
  const [malzemeler, setMalzemeler] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const submitBusy = useRef(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [modalType, setModalType] = useState(''); // 'kayit', 'calisan', 'lokasyon', 'malzeme'
  const [formData, setFormData] = useState({
    tarih: localISODate(),
    calisan_id: '',
    lokasyon_id: '',
    baslangic_saat: '',
    bitis_saat: '',
    toplam_sure: 0,
    yapilan_is: '',
    kullanilan_malzemeler: [],
    notlar: ''
  });

  // Yönetim formları için state'ler
  const [calisanForm, setCalisanForm] = useState({ ad_soyad: '', telefon: '', email: '', pozisyon: '' });
  const [lokasyonForm, setLokasyonForm] = useState({ ad: '', adres: '', koordinat: '' });
  const [malzemeForm, setMalzemeForm] = useState({ ad: '', kategori: '', birim: 'Adet', stok_durumu: 0 });

  // PDF için ref ve state
  const pdfPreviewRef = useRef(null);
  const [showPdfPreview, setShowPdfPreview] = useState(false);

  // Filtreleme için state'ler
  const [filtreCalisan, setFiltreCalisan] = useState('');
  const [filtreLokasyon, setFiltreLokasyon] = useState('');
  const [filtreTarihBaslangic, setFiltreTarihBaslangic] = useState('');
  const [filtreTarihBitis, setFiltreTarihBitis] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Çalışanları yükle
      const { data: calisanData, error: calisanError } = await supabase
        .from('is_takip_calisanlar')
        .select('*')
        .order('ad_soyad');
      
      if (calisanError) throw calisanError;
      setCalisanlar(calisanData || []);

      // Lokasyonları yükle
      const { data: lokasyonData, error: lokasyonError } = await supabase
        .from('is_takip_lokasyonlar')
        .select('*')
        .order('ad');
      
      if (lokasyonError) throw lokasyonError;
      setLokasyonlar(lokasyonData || []);

      // Malzemeleri yükle
      const { data: malzemeData, error: malzemeError } = await supabase
        .from('is_takip_malzemeler')
        .select('*')
        .order('ad');
      
      if (malzemeError) throw malzemeError;
      setMalzemeler(malzemeData || []);

      // İş kayıtlarını yükle
      const { data: kayitData, error: kayitError } = await supabase
        .from('is_takip_kayitlar')
        .select(`
          *,
          calisan:is_takip_calisanlar(ad_soyad),
          lokasyon:is_takip_lokasyonlar(ad, adres)
        `)
        .order('tarih', { ascending: false });
      
      if (kayitError) throw kayitError;
      setKayitlar(kayitData || []);
    } catch (error) {
      console.error('Veri yükleme hatası:', error);
      alert('Veri yüklenirken hata oluştu: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const calculateTotalSure = (start, end) => workDurationHours(start, end) ?? 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitBusy.current) return;
    submitBusy.current = true;
    setSaving(true);
    
    try {
      if (!formData.calisan_id || !formData.lokasyon_id || !formData.yapilan_is.trim()) throw new Error('Çalışan, lokasyon ve yapılan iş açıklaması zorunludur.');
      if (workDurationHours(formData.baslangic_saat, formData.bitis_saat) === null) throw new Error('Bitiş saati başlangıçtan sonra olmalıdır. Gece yarısını aşan işi iki tarihli kayda ayırın.');
      const toplam_sure = calculateTotalSure(formData.baslangic_saat, formData.bitis_saat);
      
      const kayit = {
        ...formData,
        toplam_sure: parseFloat(toplam_sure)
      };

      if (editingId) {
        const { error } = await supabase
          .from('is_takip_kayitlar')
          .update(kayit)
          .eq('id', editingId).select('id').single();
        
        if (error) throw error;
        alert('Kayıt güncellendi!');
      } else {
        const { error } = await supabase
          .from('is_takip_kayitlar')
          .insert([kayit]);
        
        if (error) throw error;
        alert('Kayıt eklendi!');
      }

      setShowModal(false);
      setEditingId(null);
      resetForm();
      loadData();
    } catch (error) {
      console.error('Kaydetme hatası:', error);
      alert('Kayıt sırasında hata oluştu: ' + error.message);
    } finally {
      submitBusy.current = false;
      setSaving(false);
    }
  };

  const handleEdit = (kayit) => {
    setFormData({
      tarih: kayit.tarih,
      calisan_id: kayit.calisan_id,
      lokasyon_id: kayit.lokasyon_id,
      baslangic_saat: kayit.baslangic_saat,
      bitis_saat: kayit.bitis_saat,
      toplam_sure: kayit.toplam_sure,
      yapilan_is: kayit.yapilan_is,
      kullanilan_malzemeler: kayit.kullanilan_malzemeler || [],
      notlar: kayit.notlar || ''
    });
    setEditingId(kayit.id);
    setModalType('kayit');
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Bu kaydı silmek istediğinize emin misiniz?')) return;
    
    try {
      const { error } = await supabase
        .from('is_takip_kayitlar')
        .delete()
        .eq('id', id).select('id').single();
      
      if (error) throw error;
      alert('Kayıt silindi!');
      loadData();
    } catch (error) {
      console.error('Silme hatası:', error);
      alert('Silme sırasında hata oluştu: ' + error.message);
    }
  };

  const resetForm = () => {
    setFormData({
      tarih: localISODate(),
      calisan_id: '',
      lokasyon_id: '',
      baslangic_saat: '',
      bitis_saat: '',
      toplam_sure: 0,
      yapilan_is: '',
      kullanilan_malzemeler: [],
      notlar: ''
    });
  };

  // Çalışan yönetimi fonksiyonları
  const handleCalisanSubmit = async (e) => {
    e.preventDefault();
    if (submitBusy.current) return;
    submitBusy.current = true;
    setSaving(true);
    try {
      if (editingId) {
        const { error } = await supabase
          .from('is_takip_calisanlar')
          .update(calisanForm)
          .eq('id', editingId).select('id').single();
        if (error) throw error;
        alert('Çalışan güncellendi!');
      } else {
        const { error } = await supabase
          .from('is_takip_calisanlar')
          .insert([calisanForm]);
        if (error) throw error;
        alert('Çalışan eklendi!');
      }
      setShowModal(false);
      setEditingId(null);
      setCalisanForm({ ad_soyad: '', telefon: '', email: '', pozisyon: '' });
      loadData();
    } catch (error) {
      console.error('Kaydetme hatası:', error);
      alert('Kayıt sırasında hata oluştu: ' + error.message);
    } finally {
      submitBusy.current = false;
      setSaving(false);
    }
  };

  const handleCalisanEdit = (calisan) => {
    setCalisanForm({
      ad_soyad: calisan.ad_soyad,
      telefon: calisan.telefon || '',
      email: calisan.email || '',
      pozisyon: calisan.pozisyon || ''
    });
    setEditingId(calisan.id);
    setModalType('calisan');
    setShowModal(true);
  };

  const handleCalisanDelete = async (id) => {
    if (!confirm('Bu çalışanı silmek istediğinize emin misiniz?')) return;
    try {
      const { error } = await supabase
        .from('is_takip_calisanlar')
        .delete()
        .eq('id', id).select('id').single();
      if (error) throw error;
      alert('Çalışan silindi!');
      loadData();
    } catch (error) {
      console.error('Silme hatası:', error);
      alert('Silme sırasında hata oluştu: ' + error.message);
    }
  };

  // Lokasyon yönetimi fonksiyonları
  const handleLokasyonSubmit = async (e) => {
    e.preventDefault();
    if (submitBusy.current) return;
    submitBusy.current = true;
    setSaving(true);
    try {
      if (editingId) {
        const { error } = await supabase
          .from('is_takip_lokasyonlar')
          .update(lokasyonForm)
          .eq('id', editingId).select('id').single();
        if (error) throw error;
        alert('Lokasyon güncellendi!');
      } else {
        const { error } = await supabase
          .from('is_takip_lokasyonlar')
          .insert([lokasyonForm]);
        if (error) throw error;
        alert('Lokasyon eklendi!');
      }
      setShowModal(false);
      setEditingId(null);
      setLokasyonForm({ ad: '', adres: '', koordinat: '' });
      loadData();
    } catch (error) {
      console.error('Kaydetme hatası:', error);
      alert('Kayıt sırasında hata oluştu: ' + error.message);
    } finally {
      submitBusy.current = false;
      setSaving(false);
    }
  };

  const handleLokasyonEdit = (lokasyon) => {
    setLokasyonForm({
      ad: lokasyon.ad,
      adres: lokasyon.adres || '',
      koordinat: lokasyon.koordinat || ''
    });
    setEditingId(lokasyon.id);
    setModalType('lokasyon');
    setShowModal(true);
  };

  const handleLokasyonDelete = async (id) => {
    if (!confirm('Bu lokasyonu silmek istediğinize emin misiniz?')) return;
    try {
      const { error } = await supabase
        .from('is_takip_lokasyonlar')
        .delete()
        .eq('id', id).select('id').single();
      if (error) throw error;
      alert('Lokasyon silindi!');
      loadData();
    } catch (error) {
      console.error('Silme hatası:', error);
      alert('Silme sırasında hata oluştu: ' + error.message);
    }
  };

  // Malzeme yönetimi fonksiyonları
  const handleMalzemeSubmit = async (e) => {
    e.preventDefault();
    if (submitBusy.current) return;
    submitBusy.current = true;
    setSaving(true);
    try {
      if (parseDecimal(malzemeForm.stok_durumu, null) === null || parseDecimal(malzemeForm.stok_durumu) < 0) throw new Error('Stok miktarı geçerli ve sıfır veya daha büyük olmalıdır.');
      const malzemeData = {
        ...malzemeForm,
        stok_durumu: parseDecimal(malzemeForm.stok_durumu)
      };
      
      if (editingId) {
        const { error } = await supabase
          .from('is_takip_malzemeler')
          .update(malzemeData)
          .eq('id', editingId).select('id').single();
        if (error) throw error;
        alert('Malzeme güncellendi!');
      } else {
        const { error } = await supabase
          .from('is_takip_malzemeler')
          .insert([malzemeData]);
        if (error) throw error;
        alert('Malzeme eklendi!');
      }
      setShowModal(false);
      setEditingId(null);
      setMalzemeForm({ ad: '', kategori: '', birim: 'Adet', stok_durumu: 0 });
      loadData();
    } catch (error) {
      console.error('Kaydetme hatası:', error);
      alert('Kayıt sırasında hata oluştu: ' + error.message);
    } finally {
      submitBusy.current = false;
      setSaving(false);
    }
  };

  const handleMalzemeEdit = (malzeme) => {
    setMalzemeForm({
      ad: malzeme.ad,
      kategori: malzeme.kategori || '',
      birim: malzeme.birim || 'Adet',
      stok_durumu: malzeme.stok_durumu || 0
    });
    setEditingId(malzeme.id);
    setModalType('malzeme');
    setShowModal(true);
  };

  const handleMalzemeDelete = async (id) => {
    if (!confirm('Bu malzemeyi silmek istediğinize emin misiniz?')) return;
    try {
      const { error } = await supabase
        .from('is_takip_malzemeler')
        .delete()
        .eq('id', id).select('id').single();
      if (error) throw error;
      alert('Malzeme silindi!');
      loadData();
    } catch (error) {
      console.error('Silme hatası:', error);
      alert('Silme sırasında hata oluştu: ' + error.message);
    }
  };

  const exportToExcel = () => {
    const data = filtreliKayitlar.map(kayit => ({
      'Tarih': new Date(kayit.tarih).toLocaleDateString('tr-TR'),
      'Çalışan': kayit.calisan?.ad_soyad || '-',
      'Lokasyon': kayit.lokasyon?.ad || '-',
      'Başlangıç': kayit.baslangic_saat,
      'Bitiş': kayit.bitis_saat,
      'Süre (Saat)': kayit.toplam_sure,
      'Yapılan İş': kayit.yapilan_is,
      'Malzemeler': Array.isArray(kayit.kullanilan_malzemeler) 
        ? kayit.kullanilan_malzemeler.map(m => malzemeler.find(mal => mal.id === m)?.ad || m).join(', ')
        : '-',
      'Notlar': kayit.notlar || '-'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'İş Takip');
    XLSX.writeFile(wb, `is_takip_${localISODate()}.xlsx`);
  };

  const exportToPDF = async () => {
    try {
      await exportTableReport({ title: 'İş Takip Raporu',
        subtitle: `Seçili kayıtlar: ${filtreliKayitlar.length} | Rapor tarihi: ${reportDate()}`,
        head: ['Tarih', 'Çalışan', 'Lokasyon', 'Başlangıç - Bitiş', 'Süre (saat)', 'Yapılan iş', 'Malzemeler', 'Notlar'],
        body: filtreliKayitlar.map(k => [reportDate(k.tarih), k.calisan?.ad_soyad || 'Belirtilmedi', k.lokasyon?.ad || 'Belirtilmedi',
          `${k.baslangic_saat || '-'} - ${k.bitis_saat || '-'}`, reportNumber(k.toplam_sure), k.yapilan_is || '',
          Array.isArray(k.kullanilan_malzemeler) ? k.kullanilan_malzemeler.map(m => malzemeler.find(item => item.id === m)?.ad || m).join(', ') : '', k.notlar || '']),
        summary: [['Kayıt sayısı', String(filtreliKayitlar.length)],
          ['Toplam çalışma (saat)', reportNumber(filtreliKayitlar.reduce((sum, k) => sum + Number(k.toplam_sure || 0), 0))]],
        filename: reportFileName('Is_Takip_Raporu') });
    } catch (error) { alert('PDF oluşturulamadı: ' + error.message); }
  };

  // Filtreleme
  const filtreliKayitlar = kayitlar.filter(kayit => {
    if (filtreCalisan && kayit.calisan_id !== filtreCalisan) return false;
    if (filtreLokasyon && kayit.lokasyon_id !== filtreLokasyon) return false;
    if (filtreTarihBaslangic && kayit.tarih < filtreTarihBaslangic) return false;
    if (filtreTarihBitis && kayit.tarih > filtreTarihBitis) return false;
    return true;
  });

  // İstatistikler
  const istatistikler = {
    toplamKayit: filtreliKayitlar.length,
    toplamSure: filtreliKayitlar.reduce((sum, k) => sum + parseDecimal(k.toplam_sure), 0).toFixed(2),
    aktifCalisan: [...new Set(filtreliKayitlar.map(k => k.calisan_id))].length,
    aktifLokasyon: [...new Set(filtreliKayitlar.map(k => k.lokasyon_id))].length
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Yükleniyor...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Clock className="w-8 h-8 text-purple-600" />
              <div>
                <h1 className="text-3xl font-bold text-gray-800">İş Takip Sistemi</h1>
                <p className="text-sm text-gray-500">Kim, nerede, ne, ne kadar, ne kullanarak</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={exportToPDF}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition"
              >
                <FileDown className="w-5 h-5" />
                <span>PDF</span>
              </button>
              <button
                onClick={exportToExcel}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition"
              >
                <Download className="w-5 h-5" />
                <span>Excel</span>
              </button>
              <button
                onClick={() => { 
                  setModalType('kayit'); 
                  setShowModal(true); 
                  setEditingId(null); 
                  resetForm(); 
                }}
                className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-lg transition shadow-lg"
              >
                <Plus className="w-5 h-5" />
                <span className="font-semibold">İş Kaydı Ekle</span>
              </button>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-2 mt-4 border-b border-gray-200">
            <button
              onClick={() => setActiveTab('kayitlar')}
              className={`flex items-center gap-2 px-4 py-2 font-medium transition ${
                activeTab === 'kayitlar'
                  ? 'text-purple-600 border-b-2 border-purple-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <FileText className="w-4 h-4" />
              İş Kayıtları
            </button>
            <button
              onClick={() => setActiveTab('calisanlar')}
              className={`flex items-center gap-2 px-4 py-2 font-medium transition ${
                activeTab === 'calisanlar'
                  ? 'text-purple-600 border-b-2 border-purple-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <Users className="w-4 h-4" />
              Çalışanlar ({calisanlar.length})
            </button>
            <button
              onClick={() => setActiveTab('lokasyonlar')}
              className={`flex items-center gap-2 px-4 py-2 font-medium transition ${
                activeTab === 'lokasyonlar'
                  ? 'text-purple-600 border-b-2 border-purple-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <Building className="w-4 h-4" />
              Lokasyonlar ({lokasyonlar.length})
            </button>
            <button
              onClick={() => setActiveTab('malzemeler')}
              className={`flex items-center gap-2 px-4 py-2 font-medium transition ${
                activeTab === 'malzemeler'
                  ? 'text-purple-600 border-b-2 border-purple-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <Package className="w-4 h-4" />
              Malzemeler ({malzemeler.length})
            </button>
          </div>
        </div>

        {/* İş Kayıtları Tab */}
        {activeTab === 'kayitlar' && (
          <>
          {/* Filtreler */}
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg border border-purple-200">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Çalışan</label>
              <select
                value={filtreCalisan}
                onChange={(e) => setFiltreCalisan(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="">Tümü</option>
                {calisanlar.map(c => (
                  <option key={c.id} value={c.id}>{c.ad_soyad}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Lokasyon</label>
              <select
                value={filtreLokasyon}
                onChange={(e) => setFiltreLokasyon(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="">Tümü</option>
                {lokasyonlar.map(l => (
                  <option key={l.id} value={l.id}>{l.ad}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Başlangıç Tarihi</label>
              <input
                type="date"
                value={filtreTarihBaslangic}
                onChange={(e) => setFiltreTarihBaslangic(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bitiş Tarihi</label>
              <input
                type="date"
                value={filtreTarihBitis}
                onChange={(e) => setFiltreTarihBitis(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
            {(filtreCalisan || filtreLokasyon || filtreTarihBaslangic || filtreTarihBitis) && (
              <div className="flex items-end">
                <button
                  onClick={() => {
                    setFiltreCalisan('');
                    setFiltreLokasyon('');
                    setFiltreTarihBaslangic('');
                    setFiltreTarihBitis('');
                  }}
                  className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition text-sm"
                >
                  Filtreleri Temizle
                </button>
              </div>
            )}
          </div>
        </div>

        {/* İstatistikler */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-5 text-white transform hover:scale-105 transition-transform">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium opacity-90 mb-1">Toplam Kayıt</p>
                <p className="text-2xl font-bold">{istatistikler.toplamKayit}</p>
              </div>
              <FileText className="w-10 h-10 opacity-80" />
            </div>
          </div>
          <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-5 text-white transform hover:scale-105 transition-transform">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium opacity-90 mb-1">Toplam Süre</p>
                <p className="text-2xl font-bold">{istatistikler.toplamSure} saat</p>
              </div>
              <Clock className="w-10 h-10 opacity-80" />
            </div>
          </div>
          <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-5 text-white transform hover:scale-105 transition-transform">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium opacity-90 mb-1">Aktif Çalışan</p>
                <p className="text-2xl font-bold">{istatistikler.aktifCalisan}</p>
              </div>
              <User className="w-10 h-10 opacity-80" />
            </div>
          </div>
          <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl shadow-lg p-5 text-white transform hover:scale-105 transition-transform">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium opacity-90 mb-1">Aktif Lokasyon</p>
                <p className="text-2xl font-bold">{istatistikler.aktifLokasyon}</p>
              </div>
              <MapPin className="w-10 h-10 opacity-80" />
            </div>
          </div>
        </div>

        {/* Tablo */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gradient-to-r from-purple-600 to-pink-600 text-white">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Tarih</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Çalışan</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Lokasyon</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold">Saat Aralığı</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold">Süre</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Yapılan İş</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold">İşlemler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filtreliKayitlar.map((kayit, index) => (
                  <tr key={kayit.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-3 text-sm">
                      {new Date(kayit.tarih).toLocaleDateString('tr-TR')}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium">
                      {kayit.calisan?.ad_soyad || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-1">
                        <MapPin className="w-4 h-4 text-gray-400" />
                        {kayit.lokasyon?.ad || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-center">
                      {kayit.baslangic_saat} - {kayit.bitis_saat}
                    </td>
                    <td className="px-4 py-3 text-sm text-center font-bold text-purple-600">
                      {kayit.toplam_sure} saat
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="max-w-xs truncate" title={kayit.yapilan_is}>
                        {kayit.yapilan_is}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleEdit(kayit)}
                          className="p-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition"
                          title="Düzenle"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(kayit.id)}
                          className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition"
                          title="Sil"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtreliKayitlar.length === 0 && (
                  <tr>
                    <td colSpan="7" className="px-4 py-8 text-center text-gray-500">
                      Kayıt bulunamadı
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        </>
        )}

        {/* Çalışanlar Tab */}
        {activeTab === 'calisanlar' && (
          <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Çalışan Yönetimi</h2>
              <button
                onClick={() => {
                  setModalType('calisan');
                  setEditingId(null);
                  setCalisanForm({ ad_soyad: '', telefon: '', email: '', pozisyon: '' });
                  setShowModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition"
              >
                <Plus className="w-5 h-5" />
                Yeni Çalışan
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-purple-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Ad Soyad</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Telefon</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Email</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Pozisyon</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">İşlemler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {calisanlar.map((calisan, index) => (
                    <tr key={calisan.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-3 text-sm font-medium">{calisan.ad_soyad}</td>
                      <td className="px-4 py-3 text-sm">{calisan.telefon || '-'}</td>
                      <td className="px-4 py-3 text-sm">{calisan.email || '-'}</td>
                      <td className="px-4 py-3 text-sm">{calisan.pozisyon || '-'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleCalisanEdit(calisan)}
                            className="p-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition"
                            title="Düzenle"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleCalisanDelete(calisan.id)}
                            className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition"
                            title="Sil"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {calisanlar.length === 0 && (
                    <tr>
                      <td colSpan="5" className="px-4 py-8 text-center text-gray-500">
                        Henüz çalışan eklenmemiş
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Lokasyonlar Tab */}
        {activeTab === 'lokasyonlar' && (
          <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Lokasyon Yönetimi</h2>
              <button
                onClick={() => {
                  setModalType('lokasyon');
                  setEditingId(null);
                  setLokasyonForm({ ad: '', adres: '', koordinat: '' });
                  setShowModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition"
              >
                <Plus className="w-5 h-5" />
                Yeni Lokasyon
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-purple-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Lokasyon Adı</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Adres</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Koordinat</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">İşlemler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {lokasyonlar.map((lokasyon, index) => (
                    <tr key={lokasyon.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-3 text-sm font-medium">{lokasyon.ad}</td>
                      <td className="px-4 py-3 text-sm">{lokasyon.adres || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{lokasyon.koordinat || '-'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleLokasyonEdit(lokasyon)}
                            className="p-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition"
                            title="Düzenle"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleLokasyonDelete(lokasyon.id)}
                            className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition"
                            title="Sil"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {lokasyonlar.length === 0 && (
                    <tr>
                      <td colSpan="4" className="px-4 py-8 text-center text-gray-500">
                        Henüz lokasyon eklenmemiş
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Malzemeler Tab */}
        {activeTab === 'malzemeler' && (
          <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Malzeme Yönetimi</h2>
              <button
                onClick={() => {
                  setModalType('malzeme');
                  setEditingId(null);
                  setMalzemeForm({ ad: '', kategori: '', birim: 'Adet', stok_durumu: 0 });
                  setShowModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition"
              >
                <Plus className="w-5 h-5" />
                Yeni Malzeme
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-purple-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Malzeme Adı</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Kategori</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Birim</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Stok</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">İşlemler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {malzemeler.map((malzeme, index) => (
                    <tr key={malzeme.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-3 text-sm font-medium">{malzeme.ad}</td>
                      <td className="px-4 py-3 text-sm">{malzeme.kategori || '-'}</td>
                      <td className="px-4 py-3 text-sm">{malzeme.birim || 'Adet'}</td>
                      <td className="px-4 py-3 text-sm text-center">
                        <span className={`px-2 py-1 rounded ${malzeme.stok_durumu > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {malzeme.stok_durumu || 0}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleMalzemeEdit(malzeme)}
                            className="p-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition"
                            title="Düzenle"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleMalzemeDelete(malzeme.id)}
                            className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition"
                            title="Sil"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {malzemeler.length === 0 && (
                    <tr>
                      <td colSpan="5" className="px-4 py-8 text-center text-gray-500">
                        Henüz malzeme eklenmemiş
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
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
                    <h1 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1f2937', margin: '0 0 8px 0' }}>İŞ TAKİP RAPORU</h1>
                    <p style={{ fontSize: '11px', color: '#6b7280', margin: '3px 0' }}>
                      Rapor No: IST-{new Date().getFullYear()}-{String(new Date().getMonth() + 1).padStart(2, '0')}-{String(new Date().getDate()).padStart(2, '0')}
                    </p>
                    <p style={{ fontSize: '11px', color: '#6b7280', margin: '3px 0' }}>
                      Tarih: {new Date().toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                    {(filtreTarihBaslangic || filtreTarihBitis) && (
                      <p style={{ fontSize: '11px', color: '#8b5cf6', margin: '3px 0', fontWeight: 'bold' }}>
                        Dönem: {filtreTarihBaslangic ? new Date(filtreTarihBaslangic).toLocaleDateString('tr-TR') : '...'} - {filtreTarihBitis ? new Date(filtreTarihBitis).toLocaleDateString('tr-TR') : '...'}
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
                    <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '3px' }}>Toplam Süre</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#8b5cf6' }}>{istatistikler.toplamSure} saat</div>
                  </div>
                  <div style={{ width: '1px', backgroundColor: '#d1d5db' }}></div>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '3px' }}>Aktif Çalışan</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#1f2937' }}>{istatistikler.aktifCalisan}</div>
                  </div>
                  <div style={{ width: '1px', backgroundColor: '#d1d5db' }}></div>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '3px' }}>Aktif Lokasyon</div>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#1f2937' }}>{istatistikler.aktifLokasyon}</div>
                  </div>
                </div>

                {/* Tablo */}
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f3f4f6' }}>
                      <th style={{ padding: '10px 8px', textAlign: 'center', border: '1px solid #d1d5db', color: '#374151', fontWeight: 'bold' }}>Tarih</th>
                      <th style={{ padding: '10px 8px', textAlign: 'left', border: '1px solid #d1d5db', color: '#374151', fontWeight: 'bold' }}>Çalışan</th>
                      <th style={{ padding: '10px 8px', textAlign: 'left', border: '1px solid #d1d5db', color: '#374151', fontWeight: 'bold' }}>Lokasyon</th>
                      <th style={{ padding: '10px 8px', textAlign: 'center', border: '1px solid #d1d5db', color: '#374151', fontWeight: 'bold' }}>Saat Aralığı</th>
                      <th style={{ padding: '10px 8px', textAlign: 'center', border: '1px solid #d1d5db', color: '#374151', fontWeight: 'bold' }}>Süre</th>
                      <th style={{ padding: '10px 8px', textAlign: 'left', border: '1px solid #d1d5db', color: '#374151', fontWeight: 'bold' }}>Yapılan İş</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtreliKayitlar.map((kayit, index) => (
                      <tr key={kayit.id} style={{ backgroundColor: index % 2 === 0 ? '#ffffff' : '#f9fafb' }}>
                        <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #e5e7eb' }}>
                          {new Date(kayit.tarih).toLocaleDateString('tr-TR')}
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>
                          {kayit.calisan?.ad_soyad || '-'}
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>
                          {kayit.lokasyon?.ad || '-'}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #e5e7eb' }}>
                          {kayit.baslangic_saat} - {kayit.bitis_saat}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'center', border: '1px solid #e5e7eb', fontWeight: 'bold', color: '#8b5cf6' }}>
                          {kayit.toplam_sure} saat
                        </td>
                        <td style={{ padding: '8px', border: '1px solid #e5e7eb', fontSize: '9px' }}>
                          {kayit.yapilan_is}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Alt bilgi */}
                <div style={{ marginTop: '30px', paddingTop: '20px', borderTop: '2px solid #e5e7eb', fontSize: '10px', color: '#666' }}>
                  <p><strong>VoltGuard Teklif Sistemi</strong> - İş Takip Raporu</p>
                  <p>voltguard.com.tr | info@voltguard.com.tr</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
              <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white p-6 rounded-t-xl">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold">
                    {modalType === 'kayit' && (editingId ? 'İş Kaydını Düzenle' : 'Yeni İş Kaydı')}
                    {modalType === 'calisan' && (editingId ? 'Çalışanı Düzenle' : 'Yeni Çalışan')}
                    {modalType === 'lokasyon' && (editingId ? 'Lokasyonu Düzenle' : 'Yeni Lokasyon')}
                    {modalType === 'malzeme' && (editingId ? 'Malzemeyi Düzenle' : 'Yeni Malzeme')}
                  </h2>
                  <button
                    disabled={saving}
                    onClick={() => { 
                      setShowModal(false); 
                      setEditingId(null); 
                      resetForm();
                      setCalisanForm({ ad_soyad: '', telefon: '', email: '', pozisyon: '' });
                      setLokasyonForm({ ad: '', adres: '', koordinat: '' });
                      setMalzemeForm({ ad: '', kategori: '', birim: 'Adet', stok_durumu: 0 });
                    }}
                    className="p-2 hover:bg-white/20 rounded-lg transition"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>

              {/* İş Kaydı Formu */}
              {modalType === 'kayit' && (
              <form onSubmit={handleSubmit} aria-busy={saving} className="p-6">
                <fieldset disabled={saving} className="min-w-0 border-0 p-0 m-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Tarih *</label>
                    <input
                      type="date"
                      required
                      value={formData.tarih}
                      onChange={(e) => setFormData({ ...formData, tarih: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Çalışan *</label>
                    <select
                      required
                      value={formData.calisan_id}
                      onChange={(e) => setFormData({ ...formData, calisan_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    >
                      <option value="">Seçiniz</option>
                      {calisanlar.map(c => (
                        <option key={c.id} value={c.id}>{c.ad_soyad}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Lokasyon *</label>
                    <select
                      required
                      value={formData.lokasyon_id}
                      onChange={(e) => setFormData({ ...formData, lokasyon_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    >
                      <option value="">Seçiniz</option>
                      {lokasyonlar.map(l => (
                        <option key={l.id} value={l.id}>{l.ad}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Başlangıç Saati *</label>
                    <input
                      type="time"
                      required
                      value={formData.baslangic_saat}
                      onChange={(e) => setFormData({ ...formData, baslangic_saat: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Bitiş Saati *</label>
                    <input
                      type="time"
                      required
                      value={formData.bitis_saat}
                      onChange={(e) => setFormData({ ...formData, bitis_saat: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Toplam Süre (Otomatik)</label>
                    <input
                      type="text"
                      readOnly
                      value={calculateTotalSure(formData.baslangic_saat, formData.bitis_saat) + ' saat'}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-700 font-bold"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Yapılan İş *</label>
                    <textarea
                      required
                      value={formData.yapilan_is}
                      onChange={(e) => setFormData({ ...formData, yapilan_is: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      rows="3"
                      placeholder="Yapılan işi detaylı açıklayınız..."
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Kullanılan Malzemeler</label>
                    <select
                      multiple
                      value={formData.kullanilan_malzemeler}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        kullanilan_malzemeler: Array.from(e.target.selectedOptions, option => option.value)
                      })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      size="5"
                    >
                      {malzemeler.map(m => (
                        <option key={m.id} value={m.id}>{m.ad}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">Ctrl/Cmd tuşu ile birden fazla seçim yapabilirsiniz</p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Notlar</label>
                    <textarea
                      value={formData.notlar}
                      onChange={(e) => setFormData({ ...formData, notlar: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      rows="2"
                      placeholder="Ekstra notlar..."
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-6 mt-6 border-t border-gray-200">
                  <button
                    type="submit"
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold rounded-lg transition"
                  >
                    <Save className="w-5 h-5" />
                    <span>{saving ? 'Kaydediliyor…' : editingId ? 'Güncelle' : 'Kaydet'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowModal(false); setEditingId(null); resetForm(); }}
                    className="px-6 py-3 bg-gray-500 hover:bg-gray-600 text-white font-semibold rounded-lg transition"
                  >
                    İptal
                  </button>
                </div>
                </fieldset>
              </form>
              )}

              {/* Çalışan Formu */}
              {modalType === 'calisan' && (
              <form onSubmit={handleCalisanSubmit} aria-busy={saving} className="p-6">
                <fieldset disabled={saving} className="min-w-0 border-0 p-0 m-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Ad Soyad *</label>
                    <input
                      type="text"
                      required
                      value={calisanForm.ad_soyad}
                      onChange={(e) => setCalisanForm({ ...calisanForm, ad_soyad: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="Örn: Ahmet Yılmaz"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Telefon</label>
                    <input
                      type="tel"
                      value={calisanForm.telefon}
                      onChange={(e) => setCalisanForm({ ...calisanForm, telefon: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="0555 123 45 67"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                    <input
                      type="email"
                      value={calisanForm.email}
                      onChange={(e) => setCalisanForm({ ...calisanForm, email: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="ornek@email.com"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Pozisyon</label>
                    <input
                      type="text"
                      value={calisanForm.pozisyon}
                      onChange={(e) => setCalisanForm({ ...calisanForm, pozisyon: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="Örn: Teknisyen, Usta, Mühendis"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-6 mt-6 border-t border-gray-200">
                  <button
                    type="submit"
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold rounded-lg transition"
                  >
                    <Save className="w-5 h-5" />
                    <span>{editingId ? 'Güncelle' : 'Kaydet'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { 
                      setShowModal(false); 
                      setEditingId(null); 
                      setCalisanForm({ ad_soyad: '', telefon: '', email: '', pozisyon: '' });
                    }}
                    className="px-6 py-3 bg-gray-500 hover:bg-gray-600 text-white font-semibold rounded-lg transition"
                  >
                    İptal
                  </button>
                </div>
                </fieldset>
              </form>
              )}

              {/* Lokasyon Formu */}
              {modalType === 'lokasyon' && (
              <form onSubmit={handleLokasyonSubmit} aria-busy={saving} className="p-6">
                <fieldset disabled={saving} className="min-w-0 border-0 p-0 m-0">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Lokasyon Adı *</label>
                    <input
                      type="text"
                      required
                      value={lokasyonForm.ad}
                      onChange={(e) => setLokasyonForm({ ...lokasyonForm, ad: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="Örn: Fabrika 1, Şantiye A"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Adres</label>
                    <textarea
                      value={lokasyonForm.adres}
                      onChange={(e) => setLokasyonForm({ ...lokasyonForm, adres: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      rows="2"
                      placeholder="Tam adres giriniz..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Koordinat</label>
                    <input
                      type="text"
                      value={lokasyonForm.koordinat}
                      onChange={(e) => setLokasyonForm({ ...lokasyonForm, koordinat: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="41.0082,28.9784 (opsiyonel)"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-6 mt-6 border-t border-gray-200">
                  <button
                    type="submit"
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold rounded-lg transition"
                  >
                    <Save className="w-5 h-5" />
                    <span>{editingId ? 'Güncelle' : 'Kaydet'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { 
                      setShowModal(false); 
                      setEditingId(null); 
                      setLokasyonForm({ ad: '', adres: '', koordinat: '' });
                    }}
                    className="px-6 py-3 bg-gray-500 hover:bg-gray-600 text-white font-semibold rounded-lg transition"
                  >
                    İptal
                  </button>
                </div>
                </fieldset>
              </form>
              )}

              {/* Malzeme Formu */}
              {modalType === 'malzeme' && (
              <form onSubmit={handleMalzemeSubmit} aria-busy={saving} className="p-6">
                <fieldset disabled={saving} className="min-w-0 border-0 p-0 m-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Malzeme Adı *</label>
                    <input
                      type="text"
                      required
                      value={malzemeForm.ad}
                      onChange={(e) => setMalzemeForm({ ...malzemeForm, ad: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="Örn: Vida, Boya, Kablo"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Kategori</label>
                    <input
                      type="text"
                      value={malzemeForm.kategori}
                      onChange={(e) => setMalzemeForm({ ...malzemeForm, kategori: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="Örn: Elektrik, Boya, Yapı"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Birim *</label>
                    <select
                      required
                      value={malzemeForm.birim}
                      onChange={(e) => setMalzemeForm({ ...malzemeForm, birim: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    >
                      <option value="Adet">Adet</option>
                      <option value="Kg">Kg</option>
                      <option value="Metre">Metre</option>
                      <option value="Litre">Litre</option>
                      <option value="Paket">Paket</option>
                      <option value="Kutu">Kutu</option>
                      <option value="Rulo">Rulo</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Stok Durumu</label>
                    <input
                      type="number"
                      min="0"
                      value={malzemeForm.stok_durumu}
                      onChange={(e) => setMalzemeForm({ ...malzemeForm, stok_durumu: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="0"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-6 mt-6 border-t border-gray-200">
                  <button
                    type="submit"
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold rounded-lg transition"
                  >
                    <Save className="w-5 h-5" />
                    <span>{editingId ? 'Güncelle' : 'Kaydet'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { 
                      setShowModal(false); 
                      setEditingId(null); 
                      setMalzemeForm({ ad: '', kategori: '', birim: 'Adet', stok_durumu: 0 });
                    }}
                    className="px-6 py-3 bg-gray-500 hover:bg-gray-600 text-white font-semibold rounded-lg transition"
                  >
                    İptal
                  </button>
                </div>
                </fieldset>
              </form>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


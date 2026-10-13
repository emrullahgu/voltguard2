import React, { useState, useEffect } from 'react';
import { CheckCircle, Plus, X, Edit3, Trash2, Clock, AlertCircle, CheckSquare, User, Calendar, Filter, Search } from 'lucide-react';
import { supabase } from './supabaseClient';
import { localISODate } from './operations.mjs';

const GorevTakip = () => {
  const [gorevler, setGorevler] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [filteredGorevler, setFilteredGorevler] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGorev, setEditingGorev] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');

  const [gorevForm, setGorevForm] = useState({
    baslik: '',
    aciklama: '',
    durum: 'beklemede',
    oncelik: 'orta',
    atanan_kisi: '',
    baslangic_tarihi: localISODate(),
    bitis_tarihi: '',
    notlar: ''
  });

  const durumlar = [
    { value: 'beklemede', label: 'Beklemede', icon: '•', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
    { value: 'devam-ediyor', label: 'Devam Ediyor', icon: '→', color: 'bg-blue-100 text-blue-800 border-blue-300' },
    { value: 'tamamlandi', label: 'Tamamlandı', icon: '•', color: 'bg-green-100 text-green-800 border-green-300' },
    { value: 'iptal', label: 'İptal Edildi', icon: '•', color: 'bg-red-100 text-red-800 border-red-300' }
  ];

  const oncelikler = [
    { value: 'dusuk', label: 'Düşük', color: 'bg-gray-100 text-gray-800' },
    { value: 'orta', label: 'Orta', color: 'bg-blue-100 text-blue-800' },
    { value: 'yuksek', label: 'Yüksek', color: 'bg-orange-100 text-orange-800' },
    { value: 'acil', label: 'Acil', color: 'bg-red-100 text-red-800' }
  ];

  useEffect(() => {
    loadGorevler();
  }, []);

  useEffect(() => {
    filterGorevler();
  }, [gorevler, searchTerm, filterStatus, filterPriority]);

  const loadGorevler = async () => {
    setLoadError('');
    try {
      const { data, error } = await supabase
        .from('gorevler')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setGorevler(data || []);
    } catch (error) {
      console.error('Görevler yüklenemedi:', error);
      setLoadError('Görevler yüklenemedi. Bağlantıyı ve yetkilerinizi kontrol edin.');
    }
  };

  const filterGorevler = () => {
    let filtered = [...gorevler];

    // Arama filtresi
    if (searchTerm) {
      filtered = filtered.filter(g => 
        (g.baslik || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        g.aciklama?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        g.atanan_kisi?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Durum filtresi
    if (filterStatus !== 'all') {
      filtered = filtered.filter(g => g.durum === filterStatus);
    }

    // Öncelik filtresi
    if (filterPriority !== 'all') {
      filtered = filtered.filter(g => g.oncelik === filterPriority);
    }

    setFilteredGorevler(filtered);
  };

  const saveGorev = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (!gorevForm.baslik.trim()) {
        alert('Görev başlığı zorunludur!');
        return;
      }

      if (gorevForm.baslangic_tarihi && gorevForm.bitis_tarihi && gorevForm.bitis_tarihi < gorevForm.baslangic_tarihi) throw new Error('Bitiş tarihi başlangıçtan önce olamaz.');
      // Boş string tarih alanlarını null'a çevir
      const gorevData = {
        ...gorevForm,
        baslik: gorevForm.baslik.trim(),
        baslangic_tarihi: gorevForm.baslangic_tarihi || null,
        bitis_tarihi: gorevForm.bitis_tarihi || null
      };

      if (editingGorev) {
        // Güncelleme
        const { error } = await supabase
          .from('gorevler')
          .update(gorevData)
          .eq('id', editingGorev.id).select('id').single();

        if (error) throw error;
      } else {
        // Yeni kayıt
        const { error } = await supabase
          .from('gorevler')
          .insert([gorevData]);

        if (error) throw error;
      }

      loadGorevler();
      resetForm();
      setIsModalOpen(false);
    } catch (error) {
      console.error('Görev kaydedişlemedi:', error);
      alert('Görev kaydedilemedi: ' + error.message);
    } finally { setSaving(false); }
  };

  const deleteGorev = async (id) => {
    if (!confirm('Bu görevi silmek istediğinizden emin misiniz?')) return;

    try {
      const { error } = await supabase
        .from('gorevler')
        .delete()
        .eq('id', id).select('id').single();

      if (error) throw error;
      loadGorevler();
    } catch (error) {
      console.error('Görev silinemedi:', error);
      alert('Görev silinemedi. Bağlantıyı ve yetkilerinizi kontrol edin.');
    }
  };

  const editGorev = (gorev) => {
    setEditingGorev(gorev);
    setGorevForm({
      baslik: gorev.baslik,
      aciklama: gorev.aciklama || '',
      durum: gorev.durum,
      oncelik: gorev.oncelik,
      atanan_kisi: gorev.atanan_kisi || '',
      baslangic_tarihi: gorev.baslangic_tarihi || localISODate(),
      bitis_tarihi: gorev.bitis_tarihi || '',
      notlar: gorev.notlar || ''
    });
    setIsModalOpen(true);
  };

  const resetForm = () => {
    setEditingGorev(null);
    setGorevForm({
      baslik: '',
      aciklama: '',
      durum: 'beklemede',
      oncelik: 'orta',
      atanan_kisi: '',
      baslangic_tarihi: localISODate(),
      bitis_tarihi: '',
      notlar: ''
    });
  };

  const getDurumInfo = (durum) => {
    return durumlar.find(d => d.value === durum) || durumlar[0];
  };

  const getOncelikInfo = (oncelik) => {
    return oncelikler.find(o => o.value === oncelik) || oncelikler[1];
  };

  // İstatistikler
  const stats = {
    toplam: gorevler.length,
    beklemede: gorevler.filter(g => g.durum === 'beklemede').length,
    devamEdiyor: gorevler.filter(g => g.durum === 'devam-ediyor').length,
    tamamlandi: gorevler.filter(g => g.durum === 'tamamlandi').length,
    iptal: gorevler.filter(g => g.durum === 'iptal').length
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {loadError && <div role="alert" className="bg-red-50 border border-red-200 p-4 text-red-800">{loadError} <button onClick={loadGorevler} className="underline ml-2">Yeniden dene</button></div>}
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-6 py-6 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <CheckCircle className="w-8 h-8" />
              Görev Takip Sistemi
            </h1>
            <p className="text-blue-100 mt-1">Tüm görevlerinizi tek yerden yönetin</p>
          </div>
          <button
            onClick={() => {
              resetForm();
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 bg-white text-blue-600 px-6 py-3 rounded-lg font-bold shadow-lg hover:shadow-xl transition-all"
          >
            <Plus className="w-5 h-5" />
            Yeni Görev
          </button>
        </div>

        {/* İstatistikler */}
        <div className="grid grid-cols-5 gap-4 mt-6">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-white">{stats.toplam}</div>
            <div className="text-blue-100 text-sm mt-1">Toplam Görev</div>
          </div>
          <div className="bg-yellow-500/20 backdrop-blur-sm rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-white">{stats.beklemede}</div>
            <div className="text-yellow-100 text-sm mt-1">Beklemede</div>
          </div>
          <div className="bg-blue-500/20 backdrop-blur-sm rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-white">{stats.devamEdiyor}</div>
            <div className="text-blue-100 text-sm mt-1">Devam Ediyor</div>
          </div>
          <div className="bg-green-500/20 backdrop-blur-sm rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-white">{stats.tamamlandi}</div>
            <div className="text-green-100 text-sm mt-1">Tamamlandı</div>
          </div>
          <div className="bg-red-500/20 backdrop-blur-sm rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-white">{stats.iptal}</div>
            <div className="text-red-100 text-sm mt-1">İptal</div>
          </div>
        </div>
      </div>

      {/* Filtreler */}
      <div className="bg-white border-b px-6 py-4 shrink-0">
        <div className="flex gap-4">
          {/* Arama */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Görev ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          {/* Durum Filtresi */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="all">Tüm Durumlar</option>
            {durumlar.map(d => (
              <option key={d.value} value={d.value}>{d.icon} {d.label}</option>
            ))}
          </select>

          {/* Öncelik Filtresi */}
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="all">Tüm Öncelikler</option>
            {oncelikler.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Görev Listesi */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredGorevler.map(gorev => {
            const durumInfo = getDurumInfo(gorev.durum);
            const oncelikInfo = getOncelikInfo(gorev.oncelik);

            return (
              <div key={gorev.id} className="bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                <div className="p-4">
                  {/* Başlık ve Öncelik */}
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-bold text-gray-800 text-lg flex-1 pr-2">{gorev.baslik}</h3>
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${oncelikInfo.color}`}>
                      {oncelikInfo.label}
                    </span>
                  </div>

                  {/* Açıklama */}
                  {gorev.aciklama && (
                    <p className="text-gray-600 text-sm mb-3 line-clamp-2">{gorev.aciklama}</p>
                  )}

                  {/* Durum */}
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border mb-3 ${durumInfo.color}`}>
                    <span className="text-lg">{durumInfo.icon}</span>
                    <span className="font-semibold text-sm">{durumInfo.label}</span>
                  </div>

                  {/* Atanan Kişi */}
                  {gorev.atanan_kisi && (
                    <div className="flex items-center gap-2 text-gray-600 text-sm mb-2">
                      <User className="w-4 h-4" />
                      <span>{gorev.atanan_kisi}</span>
                    </div>
                  )}

                  {/* Tarihler */}
                  <div className="flex items-center gap-2 text-gray-500 text-xs mb-3">
                    <Calendar className="w-4 h-4" />
                    <span>
                      {gorev.baslangic_tarihi && new Date(gorev.baslangic_tarihi).toLocaleDateString('tr-TR')}
                      {gorev.bitis_tarihi && ` - ${new Date(gorev.bitis_tarihi).toLocaleDateString('tr-TR')}`}
                    </span>
                  </div>

                  {/* Aksiyonlar */}
                  <div className="flex gap-2 pt-3 border-t">
                    <button
                      onClick={() => editGorev(gorev)}
                      className="flex-1 flex items-center justify-center gap-2 bg-blue-50 hover:bg-blue-100 text-blue-600 py-2 rounded-lg font-medium transition-colors"
                    >
                      <Edit3 className="w-4 h-4" />
                      Düzenle
                    </button>
                    <button
                      onClick={() => deleteGorev(gorev.id)}
                      className="flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-600 p-2 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filteredGorevler.length === 0 && (
          <div className="text-center py-12">
            <AlertCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 text-lg">Görev bulunamadı</p>
            <p className="text-gray-400 text-sm mt-2">Yeni bir görev ekleyerek başlayın!</p>
          </div>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-auto">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-6 text-white sticky top-0 z-10">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">
                  {editingGorev ? 'Görevi Düzenle' : 'Yeni Görev Ekle'}
                </h2>
                <button
                  onClick={() => {
                    setIsModalOpen(false);
                    resetForm();
                  }}
                  className="text-white hover:bg-white/20 p-2 rounded-lg transition"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Görev Başlığı <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={gorevForm.baslik}
                  onChange={(e) => setGorevForm({...gorevForm, baslik: e.target.value})}
                  className="w-full p-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="Görev başlığını girin..."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Açıklama</label>
                <textarea
                  value={gorevForm.aciklama}
                  onChange={(e) => setGorevForm({...gorevForm, aciklama: e.target.value})}
                  rows={3}
                  className="w-full p-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="Görev detaylarını girin..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Durum</label>
                  <select
                    value={gorevForm.durum}
                    onChange={(e) => setGorevForm({...gorevForm, durum: e.target.value})}
                    className="w-full p-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  >
                    {durumlar.map(d => (
                      <option key={d.value} value={d.value}>{d.icon} {d.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Öncelik</label>
                  <select
                    value={gorevForm.oncelik}
                    onChange={(e) => setGorevForm({...gorevForm, oncelik: e.target.value})}
                    className="w-full p-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  >
                    {oncelikler.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Atanan Kişi</label>
                <input
                  type="text"
                  value={gorevForm.atanan_kisi}
                  onChange={(e) => setGorevForm({...gorevForm, atanan_kisi: e.target.value})}
                  className="w-full p-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="Ki adı..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Başlangıç Tarihi</label>
                  <input
                    type="date"
                    value={gorevForm.baslangic_tarihi}
                    onChange={(e) => setGorevForm({...gorevForm, baslangic_tarihi: e.target.value})}
                    className="w-full p-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Bitiş Tarihi</label>
                  <input
                    type="date"
                    value={gorevForm.bitis_tarihi}
                    onChange={(e) => setGorevForm({...gorevForm, bitis_tarihi: e.target.value})}
                    className="w-full p-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Notlar</label>
                <textarea
                  value={gorevForm.notlar}
                  onChange={(e) => setGorevForm({...gorevForm, notlar: e.target.value})}
                  rows={2}
                  className="w-full p-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="Ek notlar..."
                />
              </div>

              <div className="flex gap-3 pt-4 border-t">
                <button
                  onClick={() => {
                    setIsModalOpen(false);
                    resetForm();
                  }}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 px-6 rounded-lg font-bold transition-colors"
                >
                  İptal
                </button>
                <button
                  onClick={saveGorev}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 px-6 rounded-lg font-bold transition-colors shadow-lg"
                >
                  {editingGorev ? 'Güncelle' : 'Kaydet'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GorevTakip;


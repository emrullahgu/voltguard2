import React, { useState, useEffect } from 'react';
import { Package, Search, Plus, Edit2, Trash2, Save, X, MapPin, Tag, Hash, Calendar, Building2, Filter, Download, Upload, RefreshCw, AlertCircle, Database } from 'lucide-react';
import { supabase } from './supabaseClient';
import { parseDecimal, localISODate } from './operations.mjs';
import { useAuth } from './SimpleAuth';
import { exportTableReport, reportFileName, reportDate, reportNumber } from './pdfReport';

const UrunTakip = () => {
  const { isAuthenticated, currentUser, loading: authLoading } = useAuth();
  const [urunler, setUrunler] = useState([]);
  const [filteredUrunler, setFilteredUrunler] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUrun, setEditingUrun] = useState(null);
  const [filterKategori, setFilterKategori] = useState('');
  const [filterMarka, setFilterMarka] = useState('');
  const [filterLokasyon, setFilterLokasyon] = useState('');
  const [loading, setLoading] = useState(false);
  const [dbError, setDbError] = useState(null);

  const [formData, setFormData] = useState({
    urun_adi: '',
    kategori: '',
    marka: '',
    model: '',
    miktar: 0,
    birim: 'Adet',
    lokasyon: '',
    aciklama: '',
    seri_no: '',
    tarih: localISODate()
  });

  // ürünleri yükle - authentication kontrolü ile
  useEffect(() => {
    if (isAuthenticated && currentUser) {
      loadUrunler();
    }
  }, [isAuthenticated, currentUser]);

  // Arama ve filtreleme
  useEffect(() => {
    let filtered = [...urunler];

    // Arama
    if (searchTerm) {
      filtered = filtered.filter(urun =>
        urun.urun_adi?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        urun.marka?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        urun.model?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        urun.seri_no?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Kategori filtresi
    if (filterKategori) {
      filtered = filtered.filter(urun => urun.kategori === filterKategori);
    }

    // Marka filtresi
    if (filterMarka) {
      filtered = filtered.filter(urun => urun.marka === filterMarka);
    }

    // Lokasyon filtresi
    if (filterLokasyon) {
      filtered = filtered.filter(urun => urun.lokasyon === filterLokasyon);
    }

    setFilteredUrunler(filtered);
  }, [searchTerm, filterKategori, filterMarka, filterLokasyon, urunler]);

  const loadUrunler = async () => {
    if (!currentUser) {
      console.warn('Kullanıcı oturumu yok');
      return;
    }

    try {
      setLoading(true);
      setDbError(null);


      const { data, error } = await supabase
        .from('urun_takip')
        .select('*')
        .eq('user_email', currentUser.email)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase hatası:', error);
        
        // Tablo yoksa ızel hata mesajı
        if (error.code === 'PGRST116' || error.message?.includes('does not exist')) {
          setDbError('table_not_found');
        } else if (error.message?.includes('permission')) {
          setDbError('permission_denied');
        } else {
          setDbError('general_error');
        }
        throw error;
      }

      setUrunler(data || []);
    } catch (error) {
      console.error('ürünler yüklenirken hata:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddOrUpdate = async () => {
    if (!formData.urun_adi.trim() || !formData.kategori.trim()) {
      alert('Lütfen Ürün adı ve kategori alanlarını doldurun');
      return;
    }

    if (!currentUser) {
      alert('Lütfen önce giriş yapın.');
      return;
    }

    try {
      if (parseDecimal(formData.miktar, null) === null || parseDecimal(formData.miktar) < 0) throw new Error('Miktar geçerli ve sıfır veya daha büyük olmalıdır.');
      const validatedData = { ...formData, urun_adi: formData.urun_adi.trim(), kategori: formData.kategori.trim(), miktar: parseDecimal(formData.miktar) };
      setLoading(true);


      if (editingUrun) {
        // Güncelleme
        const { data, error } = await supabase
          .from('urun_takip')
          .update(validatedData)
          .eq('id', editingUrun.id)
          .select('id').single();

        if (error) {
          console.error('Güncelleme hatası:', error);
          throw error;
        }

        alert('Ürün başarıyla güncellendi');
      } else {
        // Yeni ekleme - user_email ekle
        const dataToInsert = {
          ...validatedData,
          user_email: currentUser.email
        };

        
        const { data, error } = await supabase
          .from('urun_takip')
          .insert([dataToInsert])
          .select();

        if (error) {
          console.error('Ekleme hatası:', error);
          console.error('Hata detayları:', {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint
          });
          throw error;
        }

        alert('Ürün başarıyla eklendi');
      }

      resetForm();
      loadUrunler();
    } catch (error) {
      console.error('Ürün kaydedilirken hata:', error);
      
      if (error.code === '42501') {
        alert('Yetki hatası: Bu işlemi yapmaya yetkiniz yok. Lütfen yöneticinizle iletişime geçin.');
      } else if (error.code === 'PGRST116') {
        alert('Ürün verilerine erişilemedi. Şirket yöneticinizden veri kaynağını kontrol etmesini isteyin.');
      } else if (error.message?.includes('JWT')) {
        alert('Oturum süresi dolmuş. Lütfen yeniden giriş yapın.');
      } else {
        alert('Ürün kaydedilirken hata oluştu: ' + (error.message || 'Bilinmeyen hata'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Bu Ürünı silmek istediğinize emin misiniz?')) return;

    try {
      setLoading(true);
      const { error } = await supabase
        .from('urun_takip')
        .delete()
        .eq('id', id).select('id').single();

      if (error) throw error;
      alert('Ürün başarıyla silindi');
      loadUrunler();
    } catch (error) {
      console.error('Ürün silinirken hata:', error);
      alert('Ürün silinirken hata oluştu');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (urun) => {
    setEditingUrun(urun);
    setFormData({
      urun_adi: urun.urun_adi || '',
      kategori: urun.kategori || '',
      marka: urun.marka || '',
      model: urun.model || '',
      miktar: urun.miktar || 0,
      birim: urun.birim || 'Adet',
      lokasyon: urun.lokasyon || '',
      aciklama: urun.aciklama || '',
      seri_no: urun.seri_no || '',
      tarih: urun.tarih || localISODate()
    });
    setShowAddModal(true);
  };

  const resetForm = () => {
    setFormData({
      urun_adi: '',
      kategori: '',
      marka: '',
      model: '',
      miktar: 0,
      birim: 'Adet',
      lokasyon: '',
      aciklama: '',
      seri_no: '',
      tarih: localISODate()
    });
    setEditingUrun(null);
    setShowAddModal(false);
  };

  // Benzersiz deıerleri al
  const uniqueKategoriler = [...new Set(urunler.map(u => u.kategori).filter(Boolean))];
  const uniqueMarkalar = [...new Set(urunler.map(u => u.marka).filter(Boolean))];
  const uniqueLokasyonlar = [...new Set(urunler.map(u => u.lokasyon).filter(Boolean))];

  // Kategori bazında Özet
  const kategoriOzet = uniqueKategoriler.map(kategori => {
    const kategoriUrunler = urunler.filter(u => u.kategori === kategori);
    return {
      kategori,
      toplam: kategoriUrunler.reduce((sum, u) => sum + parseDecimal(u.miktar), 0),
      adet: kategoriUrunler.length
    };
  });

  // PDF Export Fonksiyonu
  const exportToPDF = async () => {
    try {
      const filterDescription = [searchTerm && `Arama: ${searchTerm}`, filterKategori && `Kategori: ${filterKategori}`,
        filterMarka && `Marka: ${filterMarka}`, filterLokasyon && `Lokasyon: ${filterLokasyon}`].filter(Boolean).join(' | ');
      await exportTableReport({ title: 'Ürün Envanter Raporu',
        subtitle: `Rapor tarihi: ${reportDate()}${filterDescription ? ' | ' + filterDescription : ' | Tüm kayıtlar'}`,
        head: ['Ürün adı', 'Kategori', 'Marka', 'Model', 'Miktar', 'Birim', 'Lokasyon', 'Seri no'],
        body: filteredUrunler.map(item => [item.urun_adi || 'Belirtilmedi', item.kategori || 'Belirtilmedi', item.marka || '', item.model || '',
          reportNumber(item.miktar, 3), item.birim || 'Adet', item.lokasyon || '', item.seri_no || '']),
        summary: [['Ürün kaydı', String(filteredUrunler.length)],
          ['Kategori sayısı', String(new Set(filteredUrunler.map(item => item.kategori).filter(Boolean)).size)],
          ['Lokasyon sayısı', String(new Set(filteredUrunler.map(item => item.lokasyon).filter(Boolean)).size)]],
        filename: reportFileName('Urun_Envanter_Raporu') });
    } catch (error) { alert('PDF oluşturulamadı: ' + error.message); }
  };

  // Auth kontrolü yapılıyor
  if (authLoading) {
    return (
      <div className="max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 text-purple-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Oturum kontrol ediliyor...</p>
        </div>
      </div>
    );
  }

  // Giriş yapılmamış
  if (!isAuthenticated) {
    return (
      <div className="max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
        <div className="text-center bg-white p-8 rounded-xl shadow-lg">
          <AlertCircle className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Lütfen Önce Giriş Yapınız</h2>
          <p className="text-gray-600 mb-6">Bu sayfayı görüntülemek için giriş yapmanız gerekmektedir.</p>
          <button
            onClick={() => window.location.href = '/'}
            className="bg-purple-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-purple-700 transition"
          >
            Giriş Sayfasına Dön
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Veritabanı Hata Uyarısı */}
      {dbError && <section role="alert" className="bg-amber-50 border border-amber-200 rounded-lg p-5 mb-6"><h2 className="font-semibold text-lg">Ürün kayıtları yüklenemedi</h2><p className="mt-2">{dbError==='permission_denied'?'Oturumunuzun ve ürün erişim yetkinizin şirket yöneticisi tarafından kontrol edilmesi gerekiyor.':'Sunucu bağlantısı veya ürün kayıtlarıyla ilgili bir sorun oluştu. Mevcut kayıtlarınız bu uyarı nedeniyle silinmez.'}</p><button onClick={loadUrunler} disabled={loading} className="mt-3 bg-slate-800 text-white px-4 py-2 rounded">Kayıtları yeniden yükle</button><p className="text-sm mt-3">Sorun devam ederse şirket yöneticinize bu ekranı bildirin.</p></section>}
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl shadow-lg p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center">
              <Package className="mr-3 h-8 w-8" />
              Ürün Takip Sistemi
            </h1>
            <p className="text-purple-100 mt-2">Envanter yönetimi ve Ürün takibi</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={exportToPDF}
              disabled={filteredUrunler.length === 0}
              className="bg-white text-purple-600 px-6 py-3 rounded-lg font-semibold hover:bg-purple-50 transition flex items-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              title="PDF olarak indir"
            >
              <Download className="w-5 h-5" />
              PDF indir
            </button>
            <button
              onClick={() => {
                resetForm();
                setShowAddModal(true);
              }}
              className="bg-white text-purple-600 px-6 py-3 rounded-lg font-semibold hover:bg-purple-50 transition flex items-center gap-2 shadow-lg"
            >
              <Plus className="w-5 h-5" />
              Yeni Ürün Ekle
            </button>
          </div>
        </div>
      </div>

      {/* İstatistikler */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-md p-4 border-l-4 border-blue-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm">Toplam Ürün</p>
              <p className="text-2xl font-bold text-gray-800">{urunler.length}</p>
            </div>
            <Package className="w-10 h-10 text-blue-500 opacity-50" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-4 border-l-4 border-green-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm">Toplam Miktar</p>
              <p className="text-2xl font-bold text-gray-800">
                {urunler.reduce((sum, u) => sum + parseDecimal(u.miktar), 0)}
              </p>
            </div>
            <Hash className="w-10 h-10 text-green-500 opacity-50" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-4 border-l-4 border-orange-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm">Kategori</p>
              <p className="text-2xl font-bold text-gray-800">{uniqueKategoriler.length}</p>
            </div>
            <Tag className="w-10 h-10 text-orange-500 opacity-50" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-4 border-l-4 border-purple-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-500 text-sm">Lokasyon</p>
              <p className="text-2xl font-bold text-gray-800">{uniqueLokasyonlar.length}</p>
            </div>
            <MapPin className="w-10 h-10 text-purple-500 opacity-50" />
          </div>
        </div>
      </div>

      {/* Arama ve Filtreler */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Arama */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Ürün, marka, model, seri no ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          {/* Kategori Filtresi */}
          <select
            value={filterKategori}
            onChange={(e) => setFilterKategori(e.target.value)}
            className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          >
            <option value="">Tüm Kategoriler</option>
            {uniqueKategoriler.map(kat => (
              <option key={kat} value={kat}>{kat}</option>
            ))}
          </select>

          {/* Marka Filtresi */}
          <select
            value={filterMarka}
            onChange={(e) => setFilterMarka(e.target.value)}
            className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          >
            <option value="">Tüm Markalar</option>
            {uniqueMarkalar.map(marka => (
              <option key={marka} value={marka}>{marka}</option>
            ))}
          </select>

          {/* Lokasyon Filtresi */}
          <select
            value={filterLokasyon}
            onChange={(e) => setFilterLokasyon(e.target.value)}
            className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          >
            <option value="">Tüm Lokasyonlar</option>
            {uniqueLokasyonlar.map(lok => (
              <option key={lok} value={lok}>{lok}</option>
            ))}
          </select>
        </div>

        {(searchTerm || filterKategori || filterMarka || filterLokasyon) && (
          <button
            onClick={() => {
              setSearchTerm('');
              setFilterKategori('');
              setFilterMarka('');
              setFilterLokasyon('');
            }}
            className="mt-3 text-sm text-purple-600 hover:text-purple-800 flex items-center gap-1"
          >
            <X className="w-4 h-4" />
            Filtreleri Temizle
          </button>
        )}
      </div>

      {/* Kategori Özet */}
      {kategoriOzet.length > 0 && (
        <div className="bg-white rounded-lg shadow-md p-4 mb-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center">
            <Tag className="w-5 h-5 mr-2 text-purple-600" />
            Kategori özeti
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {kategoriOzet.map((item, index) => (
              <div key={index} className="bg-gradient-to-br from-purple-50 to-indigo-50 p-3 rounded-lg border border-purple-200">
                <p className="text-sm font-semibold text-gray-800">{item.kategori}</p>
                <p className="text-xs text-gray-600 mt-1">
                  {item.adet} Ürün • {item.toplam} toplam miktar
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ürün Listesi */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-12 text-center">
              <RefreshCw className="w-8 h-8 text-purple-600 animate-spin mx-auto mb-3" />
              <p className="text-gray-500">Yükleniyor...</p>
            </div>
          ) : filteredUrunler.length === 0 ? (
            <div className="p-12 text-center">
              <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 text-lg">Henız Ürün eklenmemi</p>
              <p className="text-gray-400 text-sm mt-2">Yeni Ürün eklemek için yukarıdaki butonu kullanın</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Ürün Adı</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Kategori</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Marka</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Model</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold">Miktar</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Lokasyon</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Seri No</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold">İşlemler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredUrunler.map((urun, index) => (
                  <tr key={urun.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-800">{urun.urun_adi}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs font-semibold">
                        {urun.kategori}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{urun.marka || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{urun.model || '-'}</td>
                    <td className="px-4 py-3 text-sm text-center">
                      <span className="font-semibold text-gray-800">{urun.miktar}</span>
                      <span className="text-gray-500 text-xs ml-1">{urun.birim}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {urun.lokasyon ? (
                        <span className="flex items-center text-xs">
                          <MapPin className="w-3 h-3 mr-1 text-gray-400" />
                          {urun.lokasyon}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 font-mono text-xs">{urun.seri_no || '-'}</td>
                    <td className="px-4 py-3 text-sm text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleEdit(urun)}
                          className="text-blue-600 hover:text-blue-800 transition p-1"
                          title="Düzenle"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(urun.id)}
                          className="text-red-600 hover:text-red-800 transition p-1"
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
          )}
        </div>
      </div>

      {/* Ekleme/Düzenleme Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-white flex items-center">
                <Package className="mr-2 h-6 w-6" />
                {editingUrun ? 'Ürün Düzenle' : 'Yeni Ürün Ekle'}
              </h3>
              <button
                onClick={resetForm}
                className="text-white hover:bg-white/20 p-2 rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Ürün Adı */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ürün Adı *
                </label>
                <input
                  type="text"
                  value={formData.urun_adi}
                  onChange={(e) => setFormData({ ...formData, urun_adi: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="örn: Panel, Trafo, Kablo vb."
                />
              </div>

              {/* Kategori ve Marka */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Kategori *
                  </label>
                  <input
                    type="text"
                    value={formData.kategori}
                    onChange={(e) => setFormData({ ...formData, kategori: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="örn: Elektrik Malzemesi"
                    list="kategoriler"
                  />
                  <datalist id="kategoriler">
                    {uniqueKategoriler.map(kat => (
                      <option key={kat} value={kat} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Marka
                  </label>
                  <input
                    type="text"
                    value={formData.marka}
                    onChange={(e) => setFormData({ ...formData, marka: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="örn: Schneider"
                    list="markalar"
                  />
                  <datalist id="markalar">
                    {uniqueMarkalar.map(marka => (
                      <option key={marka} value={marka} />
                    ))}
                  </datalist>
                </div>
              </div>

              {/* Model ve Seri No */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Model
                  </label>
                  <input
                    type="text"
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="örn: ABC-123"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Seri No
                  </label>
                  <input
                    type="text"
                    value={formData.seri_no}
                    onChange={(e) => setFormData({ ...formData, seri_no: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="örn: SN12345"
                  />
                </div>
              </div>

              {/* Miktar ve Birim */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Miktar
                  </label>
                  <input
                    type="number"
                    value={formData.miktar}
                    onChange={(e) => setFormData({ ...formData, miktar: parseFloat(e.target.value) || 0 })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    min="0"
                    step="0.01"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Birim
                  </label>
                  <select
                    value={formData.birim}
                    onChange={(e) => setFormData({ ...formData, birim: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
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
              </div>

              {/* Lokasyon ve Tarih */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Lokasyon
                  </label>
                  <input
                    type="text"
                    value={formData.lokasyon}
                    onChange={(e) => setFormData({ ...formData, lokasyon: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="örn: Depo-A, Raf-12"
                    list="lokasyonlar"
                  />
                  <datalist id="lokasyonlar">
                    {uniqueLokasyonlar.map(lok => (
                      <option key={lok} value={lok} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tarih
                  </label>
                  <input
                    type="date"
                    value={formData.tarih}
                    onChange={(e) => setFormData({ ...formData, tarih: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Aıklama */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Aıklama
                </label>
                <textarea
                  value={formData.aciklama}
                  onChange={(e) => setFormData({ ...formData, aciklama: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  rows="3"
                  placeholder="Ek bilgiler, notlar..."
                />
              </div>

              {/* Butonlar */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleAddOrUpdate}
                  disabled={loading}
                  className="flex-1 bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-6 py-3 rounded-lg font-semibold hover:from-purple-700 hover:to-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <Save className="w-5 h-5" />
                  {loading ? 'Kaydediliyor...' : editingUrun ? 'Güncelle' : 'Kaydet'}
                </button>
                <button
                  onClick={resetForm}
                  disabled={loading}
                  className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ıptal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UrunTakip;


import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, Edit3, Trash2, Save, X, Download, FileDown, 
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle, 
  Calendar, BarChart3, PieChart, Activity, Upload, 
  Image as ImageIcon, Loader2, Minus, FileSpreadsheet, LineChart 
} from 'lucide-react';
import { supabase } from './supabaseClient';
import { parseDecimal, parseImportDate, parseEnergySpreadsheet, cosPhiFromEnergy, localISODate } from './operations.mjs';
import { currentWeekPeriod } from './weekPeriod.mjs';
import * as XLSX from 'xlsx';
import { exportHTMLReport, reportFileName } from './pdfReport';
import { LineChart as RechartsLine, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area, BarChart as RechartsBar, Bar } from 'recharts';

export default function HaftalikRaporlama() {
  const [raporlar, setRaporlar] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const submitBusy = useRef(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [selectedRapor, setSelectedRapor] = useState(null);
  const [showGrafikModal, setShowGrafikModal] = useState(false);
  const [parsedExcelData, setParsedExcelData] = useState([]);
  const [selectedEnergyType, setSelectedEnergyType] = useState('aktif');
  const [selectedDataColumn, setSelectedDataColumn] = useState('Tüketim');
  const [excelColumns, setExcelColumns] = useState([]);
  const [excelData, setExcelData] = useState([]);

  const [formData, setFormData] = useState({
    fabrika_adi: '',
    hafta_baslangic: '',
    hafta_bitis: '',
    guc_faktoru: '',
    reaktif_guc: '',
    aktif_guc: '',
    kompanzasyon_durumu: '',
    enerji_tuketimi: '',
    maliyet: '',
    onceki_hafta_guc_faktoru: '',
    hedef_guc_faktoru: '0.95',
    notlar: '',
    gorsel_url: ''
  });
  
  const [uploadedImage, setUploadedImage] = useState(null);
  const fileInputRef = useRef(null);
  const excelInputRefAktif = useRef(null);
  const excelInputRefEnduktif = useRef(null);
  const excelInputRefKapasitif = useRef(null);

  // 3 Ayrı Excel Import State'leri
  const [excelDataAktif, setExcelDataAktif] = useState([]);
  const [excelDataEnduktif, setExcelDataEnduktif] = useState([]);
  const [excelDataKapasitif, setExcelDataKapasitif] = useState([]);
  const [showExcelPreview, setShowExcelPreview] = useState(false);

  // OSOS Özet Tablosu State'leri
  const [ososOzetTablosu, setOsosOzetTablosu] = useState([]);
  const [showOsosTableInput, setShowOsosTableInput] = useState(false);
  const [ososTableText, setOsosTableText] = useState('');

  // İlk Kayıt ve Hesaplama State'leri
  const [ilkKayit, setIlkKayit] = useState(false);
  const [autoCalculateCosPhi, setAutoCalculateCosPhi] = useState(false);

  // PDF Düzenleme Modu
  const [pdfEditMode, setPdfEditMode] = useState(false);
  const [editedPdfData, setEditedPdfData] = useState(null);

  // Filtreleme State'leri
  const [filtreFabrika, setFiltreFabrika] = useState('');
  const [filtreTarihBaslangic, setFiltreTarihBaslangic] = useState('');
  const [filtreTarihBitis, setFiltreTarihBitis] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('haftalik_raporlar')
        .select('*')
        .order('hafta_baslangic', { ascending: false });
      
      if (error) throw error;
      setRaporlar(data || []);
    } catch (error) {
      console.error('Veri yükleme hatası:', error);
      alert('Haftalık raporlar yüklenemedi. Bağlantıyı ve yetkilerinizi kontrol edin: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setUploadedImage(reader.result);
      setFormData({ ...formData, gorsel_url: reader.result });
    };
    reader.readAsDataURL(file);
  };

  // Güç faktörü hesaplama fonksiyonu (P ve Q'dan cos φ hesapla)
  const calculateCosPhi = cosPhiFromEnergy;

  // Saatlik verileri günlük bazda gruplama fonksiyonu
  const groupDataByDay = (data) => {
    if (!data || data.length === 0) return [];
    
    const dayMap = {};
    
    data.forEach(row => {
      const tarih = row.tarih; // YYYY-MM-DD formatında
      if (!dayMap[tarih]) {
        dayMap[tarih] = {
          tarih: tarih,
          gun: new Date(tarih).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }),
          tuketim: 0,
          okunan_endeks: 0,
          hesaplanmis_endeks: 0,
          count: 0
        };
      }
      
      dayMap[tarih].tuketim += parseFloat(row.tuketim || 0);
      dayMap[tarih].okunan_endeks += parseFloat(row.okunan_endeks || 0);
      dayMap[tarih].hesaplanmis_endeks += parseFloat(row.hesaplanmis_endeks || 0);
      dayMap[tarih].count += 1;
    });
    
    // Ortalama hesapla ve array'e çevir
    return Object.values(dayMap).map(day => ({
      ...day,
      okunan_endeks: day.okunan_endeks / day.count,
      hesaplanmis_endeks: day.hesaplanmis_endeks / day.count
    })).sort((a, b) => new Date(a.tarih) - new Date(b.tarih));
  };

  // Aktif/Reaktif enerji değiştiğinde güç faktörünü otomatik hesapla
  useEffect(() => {
    if (autoCalculateCosPhi && formData.enerji_tuketimi && ososOzetTablosu.length > 0) {
      const aktifRow = ososOzetTablosu.find(r => r.endeks_kodu === '1.8.0');
      const enduktifRow = ososOzetTablosu.find(r => r.endeks_kodu === '5.8.0');
      
      if (aktifRow && enduktifRow && aktifRow.tuketim > 0 && enduktifRow.tuketim >= 0) {
        const calculated = calculateCosPhi(aktifRow.tuketim, enduktifRow.tuketim);
        if (calculated) {
          setFormData(prev => ({ ...prev, guc_faktoru: calculated }));
        }
      }
    }
  }, [autoCalculateCosPhi, formData.enerji_tuketimi, ososOzetTablosu]);

  // Eski tek Excel upload fonksiyonu - Artık kullanılmıyor
  // 3 ayrı Excel upload fonksiyonları: handleExcelUploadAktif, handleExcelUploadEnduktif, handleExcelUploadKapasitif

  const parseNumber = parseDecimal;
  const parseExcelDate = parseImportDate;

  const findColumnValue = (row, columnNames) => {
    const normalizedNames = columnNames.map(name => name.toLocaleLowerCase('tr-TR'));
    const key = Object.keys(row).find(column => normalizedNames.includes(column.trim().toLocaleLowerCase('tr-TR')));
    return key ? row[key] : undefined;
  };

  const parseExcelRows = parseEnergySpreadsheet;

  const getTotalConsumption = (data) => data.reduce((total, row) => total + (Number(row.tuketim) || 0), 0);

  const getPdfPageCount = (rapor) => {
    const excelPageCount = [
      rapor.excel_data_aktif,
      rapor.excel_data_enduktif,
      rapor.excel_data_kapasitif
    ].filter(Boolean).length;
    return 2 + excelPageCount + (rapor.osos_ozet_tablo ? 1 : 0) + (rapor.gorsel_url ? 1 : 0);
  };

  const setAnalyticsDataset = (rapor, energyType) => {
    const datasetByType = {
      aktif: rapor.excel_data_aktif,
      enduktif: rapor.excel_data_enduktif,
      kapasitif: rapor.excel_data_kapasitif
    };

    if (!datasetByType[energyType]) return;

    try {
      const data = JSON.parse(datasetByType[energyType]);
      setParsedExcelData(data.map(row => ({ ...row, enerji_turu: energyType })));
      setSelectedEnergyType(energyType);
    } catch (error) {
      console.error('Grafik verisi okunamadı:', error);
      alert('Grafik verisi okunamadı.');
    }
  };

  const openReportAnalytics = (rapor) => {
    const firstAvailableType = ['aktif', 'enduktif', 'kapasitif'].find(type => rapor[`excel_data_${type}`]);
    if (!firstAvailableType) return;

    setSelectedRapor(rapor);
    setAnalyticsDataset(rapor, firstAvailableType);
    setShowGrafikModal(true);
  };

  // 3 Ayrı Excel Upload Handler'ları
  const handleExcelUploadAktif = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const reader = new FileReader();
      reader.onload = (event) => {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const parsedData = parseExcelRows(jsonData);

        setExcelDataAktif(parsedData);
        setFormData(prev => ({
          ...prev,
          enerji_tuketimi: getTotalConsumption(parsedData).toFixed(2)
        }));
        alert(`AKTİF Enerji Excel verisi yüklendi! (${parsedData.length} satır)`);
      };
      reader.readAsArrayBuffer(file);
    } catch (error) {
      console.error('Excel okuma hatası:', error);
      alert('Excel dosyası okunurken hata oluştu: ' + error.message);
    }
  };

  const handleExcelUploadEnduktif = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const reader = new FileReader();
      reader.onload = (event) => {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const parsedData = parseExcelRows(jsonData);

        setExcelDataEnduktif(parsedData);
        alert(`ENDÜKTİF Reaktif Excel verisi yüklendi! (${parsedData.length} satır)`);
      };
      reader.readAsArrayBuffer(file);
    } catch (error) {
      console.error('Excel okuma hatası:', error);
      alert('Excel dosyası okunurken hata oluştu: ' + error.message);
    }
  };

  const handleExcelUploadKapasitif = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const reader = new FileReader();
      reader.onload = (event) => {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const parsedData = parseExcelRows(jsonData);

        setExcelDataKapasitif(parsedData);
        alert(`KAPASİTİF Reaktif Excel verisi yüklendi! (${parsedData.length} satır)`);
      };
      reader.readAsArrayBuffer(file);
    } catch (error) {
      console.error('Excel okuma hatası:', error);
      alert('Excel dosyası okunurken hata oluştu: ' + error.message);
    }
  };

  const parseOsosTable = (text) => {
    try {
      // Satırlara böl
      const lines = text.split('\n').filter(line => line.trim());
      const parsedData = [];

      for (const line of lines) {
        // Tab veya çoklu boşluklarla ayrılmış değerleri al
        const parts = (line.includes('\t') ? line.split('\t') : line.split(/\s{2,}/)).map(p => p.trim());
        
        if (!/^\d+\.\d+\.\d+$/.test(parts[0])) continue;

        const compactFormat = parts.length <= 7;

        const row = {
          endeks_kodu: parts[0] || '',
          aciklama: parts[1] || '',
          ilk_endeks: parseNumber(parts[2]),
          son_endeks: parseNumber(parts[3]),
          endeks_farki: compactFormat ? 0 : parseNumber(parts[4]),
          carpan: compactFormat ? 0 : parseNumber(parts[5]),
          tuketim: parseNumber(parts[compactFormat ? 4 : 6]),
          yasal_sinir: parts[compactFormat ? 5 : 7] || '',
          durum: parts[compactFormat ? 6 : 8] || ''
        };

        parsedData.push(row);
      }

      return parsedData;
    } catch (error) {
      console.error('OSOS tablo parse hatası:', error);
      return [];
    }
  };

  const handleOsosTablePaste = () => {
    const parsed = parseOsosTable(ososTableText);
    if (parsed.length === 0) {
      alert('Tablo parse edişlemedi. Lütfen formatı kontrol edin.');
      return;
    }

    setOsosOzetTablosu(parsed);
    
    // Toplam aktif enerjiyi hesapla (1.8.0)
    const aktifEnerji = parsed.find(r => r.endeks_kodu === '1.8.0');
    if (aktifEnerji) {
      setFormData(prev => ({
        ...prev,
        enerji_tuketimi: aktifEnerji.tuketim.toFixed(2)
      }));
    }

    setShowOsosTableInput(false);
    alert(`${parsed.length} satır OSOS verisi yüklendi!`);
  };

  const applyExcelDataToForm = () => {
    // Artık kullanılmıyor - 3 ayrı Excel yüklenecek
    console.warn('applyExcelDataToForm artık kullanılmamaktadır.');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitBusy.current) return;

    const gucFaktoru = parseFloat(formData.guc_faktoru);
    const hedefGucFaktoru = parseFloat(formData.hedef_guc_faktoru);
    const aktifGuc = parseFloat(formData.aktif_guc);
    const enerjiTuketimi = parseFloat(formData.enerji_tuketimi);

    if (!Number.isFinite(gucFaktoru) || gucFaktoru <= 0 || gucFaktoru > 1) {
      alert('Güç faktörü 0 ile 1 arasında olmalıdır.');
      return;
    }

    if (!Number.isFinite(hedefGucFaktoru) || hedefGucFaktoru <= 0 || hedefGucFaktoru > 1) {
      alert('Hedef güç faktörü 0 ile 1 arasında olmalıdır.');
      return;
    }

    if (!Number.isFinite(aktifGuc) || aktifGuc < 0 || !Number.isFinite(enerjiTuketimi) || enerjiTuketimi < 0) {
      alert('Aktif güç ve enerji tüketimi geçerli sayısal değerler olmalıdır.');
      return;
    }

    if (formData.hafta_baslangic > formData.hafta_bitis) {
      alert('Hafta başlangıcı, hafta bitişinden sonra olamaz.');
      return;
    }
    
    submitBusy.current = true;
    setSaving(true);
    try {
      const rapor = {
        ...formData,
        guc_faktoru: gucFaktoru,
        reaktif_guc: formData.reaktif_guc ? parseFloat(formData.reaktif_guc) : null,
        aktif_guc: aktifGuc,
        enerji_tuketimi: enerjiTuketimi,
        maliyet: formData.maliyet ? parseFloat(formData.maliyet) : null,
        onceki_hafta_guc_faktoru: formData.onceki_hafta_guc_faktoru ? parseFloat(formData.onceki_hafta_guc_faktoru) : null,
        hedef_guc_faktoru: parseFloat(formData.hedef_guc_faktoru),
        gorsel_url: uploadedImage || formData.gorsel_url || null,
        notlar: formData.notlar || null,
        excel_data_aktif: excelDataAktif.length > 0 ? JSON.stringify(excelDataAktif) : null,
        excel_data_enduktif: excelDataEnduktif.length > 0 ? JSON.stringify(excelDataEnduktif) : null,
        excel_data_kapasitif: excelDataKapasitif.length > 0 ? JSON.stringify(excelDataKapasitif) : null,
        osos_ozet_tablo: ososOzetTablosu.length > 0 ? JSON.stringify(ososOzetTablosu) : null
      };

      if (editingId) {
        const { error } = await supabase
          .from('haftalik_raporlar')
          .update(rapor)
          .eq('id', editingId);
        
        if (error) throw error;
        alert('Rapor güncellendi!');
      } else {
        const { error } = await supabase
          .from('haftalik_raporlar')
          .insert([rapor]);
        
        if (error) throw error;
        alert('Rapor eklendi!');
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

  const handleEdit = (rapor) => {
    setFormData({
      fabrika_adi: rapor.fabrika_adi,
      hafta_baslangic: rapor.hafta_baslangic,
      hafta_bitis: rapor.hafta_bitis,
      guc_faktoru: rapor.guc_faktoru,
      reaktif_guc: rapor.reaktif_guc,
      aktif_guc: rapor.aktif_guc,
      kompanzasyon_durumu: rapor.kompanzasyon_durumu,
      enerji_tuketimi: rapor.enerji_tuketimi,
      maliyet: rapor.maliyet,
      onceki_hafta_guc_faktoru: rapor.onceki_hafta_guc_faktoru,
      hedef_guc_faktoru: rapor.hedef_guc_faktoru,
      notlar: rapor.notlar || '',
      gorsel_url: rapor.gorsel_url || ''
    });
    setUploadedImage(rapor.gorsel_url || null);
    
    // 3 ayrı Excel verisini yükle
    if (rapor.excel_data_aktif) {
      try {
        const parsedData = JSON.parse(rapor.excel_data_aktif);
        setExcelDataAktif(parsedData);
      } catch (e) {
        console.error('Aktif Excel verisi parse edişlemedi:', e);
      }
    }

    if (rapor.excel_data_enduktif) {
      try {
        const parsedData = JSON.parse(rapor.excel_data_enduktif);
        setExcelDataEnduktif(parsedData);
      } catch (e) {
        console.error('Endüktif Excel verisi parse edişlemedi:', e);
      }
    }

    if (rapor.excel_data_kapasitif) {
      try {
        const parsedData = JSON.parse(rapor.excel_data_kapasitif);
        setExcelDataKapasitif(parsedData);
      } catch (e) {
        console.error('Kapasitif Excel verisi parse edişlemedi:', e);
      }
    }

    // OSOS özet tablosunu yükle
    if (rapor.osos_ozet_tablo) {
      try {
        const ososData = JSON.parse(rapor.osos_ozet_tablo);
        setOsosOzetTablosu(ososData);
      } catch (e) {
        console.error('OSOS tablo parse edişlemedi:', e);
      }
    }
    
    setEditingId(rapor.id);
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Bu raporu silmek istediğinize emin misiniz?')) return;
    
    try {
      const { error } = await supabase
        .from('haftalik_raporlar')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      alert('Rapor silindi!');
      loadData();
    } catch (error) {
      console.error('Silme hatası:', error);
      alert('Silme sırasında hata oluştu: ' + error.message);
    }
  };

  const resetForm = () => {
    const period = currentWeekPeriod();
    
    setFormData({
      fabrika_adi: '',
      hafta_baslangic: period.start,
      hafta_bitis: period.end,
      guc_faktoru: '',
      reaktif_guc: '',
      aktif_guc: '',
      kompanzasyon_durumu: 'Otomatik Kompanzasyon Aktif',
      enerji_tuketimi: '',
      maliyet: '',
      onceki_hafta_guc_faktoru: '',
      hedef_guc_faktoru: '0.95',
      notlar: '',
      gorsel_url: ''
    });
    setUploadedImage(null);
    setExcelDataAktif([]);
    setExcelDataEnduktif([]);
    setExcelDataKapasitif([]);
    setOsosOzetTablosu([]);
    setIlkKayit(false);
    setAutoCalculateCosPhi(false);
  };

  const handleYeniRapor = () => {
    setEditingId(null);
    resetForm();
    
    if (raporlar.length > 0) {
      const sonRapor = raporlar[0];
      setFormData(prev => ({
        ...prev,
        onceki_hafta_guc_faktoru: sonRapor.guc_faktoru,
        fabrika_adi: sonRapor.fabrika_adi
      }));
    }
    setShowModal(true);
  };

  const exportToExcel = () => {
    const data = filtreliRaporlar.map(rapor => ({
      'Fabrika': rapor.fabrika_adi,
      'Hafta Başlangıç': new Date(rapor.hafta_baslangic).toLocaleDateString('tr-TR'),
      'Hafta Bitiş': new Date(rapor.hafta_bitis).toLocaleDateString('tr-TR'),
      'Güç Faktörü': rapor.guc_faktoru,
      'Reaktif Güç (kVAr)': rapor.reaktif_guc,
      'Aktif Güç (kW)': rapor.aktif_guc,
      'Kompanzasyon': rapor.kompanzasyon_durumu,
      'Enerji Tüketimi (kWh)': rapor.enerji_tuketimi,
      'Maliyet (₺)': rapor.maliyet,
      'Durum': getDurum(rapor).text,
      'Notlar': rapor.notlar || '-'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Haftalık Raporlar');
    XLSX.writeFile(wb, `haftalik_raporlar_${localISODate()}.xlsx`);
  };

  const exportToPDF = (rapor) => {
    if (!rapor) return;
    setSelectedRapor(rapor);
    setShowPdfPreview(true);
  };

  const handlePDFDownload = async () => {
    if (!selectedRapor) { alert('Önce rapor seçin.'); return; }
    try {
      await exportHTMLReport({ root: document.getElementById('haftalik-rapor-printable'), selector: '.haftalik-pdf-page',
        filename: reportFileName('Haftalik_Rapor', `${selectedRapor.fabrika_adi}_${selectedRapor.hafta_baslangic}`), title: 'Haftalık Enerji Raporu' });
    } catch (error) { alert('PDF oluşturulamadı: ' + error.message); }
  };

  const getDurum = (rapor) => {
    const gucFaktoru = parseFloat(rapor.guc_faktoru);
    const hedef = parseFloat(rapor.hedef_guc_faktoru);

    if (!Number.isFinite(gucFaktoru) || !Number.isFinite(hedef)) {
      return { text: 'VERİ EKSİK', color: 'gray', icon: AlertTriangle, bg: 'bg-slate-100', textColor: 'text-slate-700' };
    }
    
    if (gucFaktoru >= hedef) {
      return { text: 'UYGUN', color: 'green', icon: CheckCircle, bg: 'bg-green-100', textColor: 'text-green-700' };
    } else if (gucFaktoru >= hedef - 0.05) {
      return { text: 'DİKKAT', color: 'yellow', icon: AlertTriangle, bg: 'bg-yellow-100', textColor: 'text-yellow-700' };
    } else {
      return { text: 'UYGUN DEĞİL', color: 'red', icon: TrendingDown, bg: 'bg-red-100', textColor: 'text-red-700' };
    }
  };

  const getTrend = (rapor) => {
    const current = parseFloat(rapor.guc_faktoru);
    const previous = parseFloat(rapor.onceki_hafta_guc_faktoru);

    if (!Number.isFinite(current) || !Number.isFinite(previous)) {
      return { icon: Minus, color: 'text-gray-500', text: 'Karşılaştırma yok' };
    }
    
    if (current > previous) {
      return { icon: TrendingUp, color: 'text-green-600', text: 'Yükseliş' };
    } else if (current < previous) {
      return { icon: TrendingDown, color: 'text-red-600', text: 'Düşüş' };
    } else {
      return { icon: Minus, color: 'text-gray-600', text: 'Sabit' };
    }
  };

  // Filtreleme
  const filtreliRaporlar = raporlar.filter(rapor => {
    if (filtreFabrika && !rapor.fabrika_adi.toLowerCase().includes(filtreFabrika.toLowerCase())) return false;
    if (filtreTarihBaslangic && rapor.hafta_baslangic < filtreTarihBaslangic) return false;
    if (filtreTarihBitis && rapor.hafta_bitis > filtreTarihBitis) return false;
    return true;
  });

  const raporTrendData = [...filtreliRaporlar]
    .sort((first, second) => new Date(first.hafta_baslangic) - new Date(second.hafta_baslangic))
    .map(rapor => ({
      hafta: new Date(rapor.hafta_baslangic).toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' }),
      guc_faktoru: Number(rapor.guc_faktoru),
      hedef: Number(rapor.hedef_guc_faktoru)
    }));

  // İstatistikler
  const istatistikler = {
    toplamRapor: filtreliRaporlar.length,
    uygunRapor: filtreliRaporlar.filter(r => getDurum(r).text === 'UYGUN').length,
    dikkatRapor: filtreliRaporlar.filter(r => getDurum(r).text === 'DİKKAT').length,
    uygunDegilRapor: filtreliRaporlar.filter(r => getDurum(r).text === 'UYGUN DEĞİL').length,
    ortalamaGucFaktoru: filtreliRaporlar.length > 0 
      ? (filtreliRaporlar.reduce((sum, r) => sum + parseFloat(r.guc_faktoru), 0) / filtreliRaporlar.length).toFixed(3)
      : 0,
    toplamMaliyet: filtreliRaporlar.reduce((sum, r) => sum + (parseFloat(r.maliyet) || 0), 0)
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="animate-spin h-16 w-16 text-purple-600 mx-auto mb-4" />
          <p className="text-gray-600">Yükleniyor...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f7f8] p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-5 md:p-6 mb-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <img src="/calisan/uygulama/fatura_logo.png" alt="VoltGuard" className="w-14 h-14 object-contain rounded-md border border-slate-200 bg-white" />
              <div>
                <p className="text-xs font-semibold tracking-wide text-cyan-700">VOLTGUARD / İZLEME MERKEZİ</p>
                <h1 className="text-2xl font-bold text-slate-900">Haftalık Raporlama</h1>
                <p className="text-sm text-slate-500">Kompanzasyon performansı ve enerji tüketimi takibi</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={exportToExcel}
                className="flex items-center gap-2 px-4 py-2 border border-emerald-700 bg-white hover:bg-emerald-50 text-emerald-800 rounded-md transition"
              >
                <Download className="w-5 h-5" />
                <span>Excel</span>
              </button>
              <button
                onClick={handleYeniRapor}
                className="flex items-center gap-2 px-5 py-2.5 bg-cyan-700 hover:bg-cyan-800 text-white rounded-md transition shadow-sm"
              >
                <Plus className="w-5 h-5" />
                <span className="font-semibold">Yeni Rapor</span>
              </button>
            </div>
          </div>
        </div>

        {/* Filtreler */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 mb-4">
          <div className="flex items-center justify-between gap-4 mb-3">
            <h2 className="text-sm font-semibold text-slate-800">Rapor Filtreleri</h2>
            {(filtreFabrika || filtreTarihBaslangic || filtreTarihBitis) && (
              <button
                type="button"
                onClick={() => {
                  setFiltreFabrika('');
                  setFiltreTarihBaslangic('');
                  setFiltreTarihBitis('');
                }}
                className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-cyan-800"
              >
                <X className="w-4 h-4" />
                Temizle
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fabrika</label>
              <input
                type="text"
                value={filtreFabrika}
                onChange={(e) => setFiltreFabrika(e.target.value)}
                placeholder="Fabrika adı..."
                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Başlangıç Tarihi</label>
              <input
                type="date"
                value={filtreTarihBaslangic}
                onChange={(e) => setFiltreTarihBaslangic(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bitiş Tarihi</label>
              <input
                type="date"
                value={filtreTarihBitis}
                onChange={(e) => setFiltreTarihBitis(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-cyan-600 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {/* İstatistikler */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-5 text-white transform hover:scale-105 transition-transform">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium opacity-90 mb-1">Toplam Rapor</p>
                <p className="text-2xl font-bold">{istatistikler.toplamRapor}</p>
              </div>
              <BarChart3 className="w-10 h-10 opacity-80" />
            </div>
          </div>
          <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-5 text-white transform hover:scale-105 transition-transform">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium opacity-90 mb-1">Uygun</p>
                <p className="text-2xl font-bold">{istatistikler.uygunRapor}</p>
              </div>
              <CheckCircle className="w-10 h-10 opacity-80" />
            </div>
          </div>
          <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-xl shadow-lg p-5 text-white transform hover:scale-105 transition-transform">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium opacity-90 mb-1">Dikkat</p>
                <p className="text-2xl font-bold">{istatistikler.dikkatRapor}</p>
              </div>
              <AlertTriangle className="w-10 h-10 opacity-80" />
            </div>
          </div>
          <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl shadow-lg p-5 text-white transform hover:scale-105 transition-transform">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium opacity-90 mb-1">Uygun Değil</p>
                <p className="text-2xl font-bold">{istatistikler.uygunDegilRapor}</p>
              </div>
              <TrendingDown className="w-10 h-10 opacity-80" />
            </div>
          </div>
          <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-5 text-white transform hover:scale-105 transition-transform">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium opacity-90 mb-1">Ort. Cosφ</p>
                <p className="text-2xl font-bold">{istatistikler.ortalamaGucFaktoru}</p>
              </div>
              <Activity className="w-10 h-10 opacity-80" />
            </div>
          </div>
          <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl shadow-lg p-5 text-white transform hover:scale-105 transition-transform">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium opacity-90 mb-1">Toplam Maliyet</p>
                <p className="text-xl font-bold">{istatistikler.toplamMaliyet.toLocaleString('tr-TR')} ₺</p>
              </div>
              <PieChart className="w-10 h-10 opacity-80" />
            </div>
          </div>
        </div>

        {raporTrendData.length > 0 && (
          <section className="bg-white border border-slate-200 rounded-lg shadow-sm mb-6">
            <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-200">
              <div>
                <h2 className="font-semibold text-slate-900">Güç Faktörü Seyri</h2>
                <p className="text-xs text-slate-500 mt-1">Seçili raporlardaki cosφ değeri ve tanımlı hedef seviyesi</p>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-600 shrink-0">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-700" /> Ölçülen</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Hedef</span>
              </div>
            </div>
            <div className="h-64 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsLine data={raporTrendData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="hafta" tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 1]} tickCount={6} tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value) => Number(value).toFixed(3)} contentStyle={{ borderRadius: '6px', borderColor: '#cbd5e1' }} />
                  <Line type="monotone" dataKey="hedef" name="Hedef" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                  <Line type="monotone" dataKey="guc_faktoru" name="Güç Faktörü" stroke="#0e7490" strokeWidth={3} dot={{ r: 3, fill: '#0e7490' }} activeDot={{ r: 5 }} />
                </RechartsLine>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* Raporlar Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtreliRaporlar.map((rapor) => {
            const durum = getDurum(rapor);
            const trend = getTrend(rapor);
            const DurumIcon = durum.icon;
            const TrendIcon = trend.icon;

            return (
              <div key={rapor.id} className="bg-white rounded-xl shadow-lg overflow-hidden hover:shadow-2xl transition-shadow flex flex-col h-full">
                {/* Header */}
                <div className={`p-4 ${durum.bg}`}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-bold text-gray-800 truncate" title={rapor.fabrika_adi}>{rapor.fabrika_adi}</h3>
                    <DurumIcon className={`w-6 h-6 ${durum.textColor}`} />
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Calendar className="w-4 h-4" />
                    <span>{new Date(rapor.hafta_baslangic).toLocaleDateString('tr-TR')} - {new Date(rapor.hafta_bitis).toLocaleDateString('tr-TR')}</span>
                  </div>
                </div>

                {/* Content */}
                <div className="p-4 space-y-3 flex-grow">
                  {/* Güç Faktörü */}
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-xs text-gray-500">Güç Faktörü</p>
                      <p className="text-2xl font-bold text-indigo-600">{rapor.guc_faktoru}</p>
                    </div>
                    <div className="text-right">
                      <div className={`flex items-center justify-end gap-1 ${trend.color}`}>
                        <TrendIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">{trend.text}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Önceki: {rapor.onceki_hafta_guc_faktoru}</p>
                    </div>
                  </div>

                  {/* Güç Bilgileri */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 bg-blue-50 rounded">
                      <p className="text-xs text-gray-600">Aktif Güç</p>
                      <p className="text-sm font-bold text-blue-700">{rapor.aktif_guc} kW</p>
                    </div>
                    <div className="p-2 bg-purple-50 rounded">
                      <p className="text-xs text-gray-600">Reaktif Güç</p>
                      <p className="text-sm font-bold text-purple-700">{rapor.reaktif_guc} kVAr</p>
                    </div>
                  </div>

                  {/* Kompanzasyon */}
                  <div className="p-2 bg-gray-50 rounded">
                    <p className="text-xs text-gray-600">Kompanzasyon</p>
                    <p className="text-sm font-semibold text-gray-800 truncate">{rapor.kompanzasyon_durumu}</p>
                  </div>

                  {/* Enerji ve Maliyet */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 bg-green-50 rounded">
                      <p className="text-xs text-gray-600">Tüketim</p>
                      <p className="text-sm font-bold text-green-700">{rapor.enerji_tuketimi} kWh</p>
                    </div>
                    <div className="p-2 bg-orange-50 rounded">
                      <p className="text-xs text-gray-600">Maliyet</p>
                      <p className="text-sm font-bold text-orange-700">{rapor.maliyet ? `${parseFloat(rapor.maliyet).toLocaleString('tr-TR')} ₺` : '-'}</p>
                    </div>
                  </div>

                  {/* Durum Badge */}
                  <div className={`p-2 rounded-lg text-center font-bold text-sm ${durum.bg} ${durum.textColor}`}>
                    {durum.text}
                  </div>

                  {/* Enerji Türü Badge (Excel verisi varsa) */}
                  {rapor.excel_enerji_turu && (
                    <div className="p-2 rounded-lg text-center text-xs font-semibold bg-gradient-to-r from-indigo-100 to-purple-100 text-indigo-700">
                      {rapor.excel_enerji_turu === 'aktif' && '⚡ Aktif Enerji'}
                      {rapor.excel_enerji_turu === 'enduktif' && '🔴 Reaktif Endüktif'}
                      {rapor.excel_enerji_turu === 'kapasitif' && '🔵 Reaktif Kapasitif'}
                    </div>
                  )}

                  {/* OSOS Tablo Badge */}
                  {rapor.osos_ozet_tablo && (
                    <div className="p-2 rounded-lg text-center text-xs font-semibold bg-gradient-to-r from-orange-100 to-amber-100 text-orange-700">
                      📋 OSOS Özet Tablo Mevcut
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="p-4 bg-gray-50 border-t border-gray-200 flex gap-2">
                  {(rapor.excel_data_aktif || rapor.excel_data_enduktif || rapor.excel_data_kapasitif) && (
                    <button
                      onClick={() => openReportAnalytics(rapor)}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition text-sm"
                    >
                      <LineChart className="w-4 h-4" />
                      Grafik
                    </button>
                  )}
                  <button
                    onClick={() => exportToPDF(rapor)}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition text-sm"
                  >
                    <FileDown className="w-4 h-4" />
                    PDF
                  </button>
                  <button
                    onClick={() => handleEdit(rapor)}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition text-sm"
                  >
                    <Edit3 className="w-4 h-4" />
                    Düzenle
                  </button>
                  <button
                    onClick={() => handleDelete(rapor.id)}
                    className="px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {filtreliRaporlar.length === 0 && (
          <div className="bg-white rounded-xl shadow-lg p-12 text-center mt-6">
            <BarChart3 className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 text-lg">Henüz rapor eklenmemiş</p>
            <p className="text-gray-400 text-sm mt-2">Yeni rapor eklemek için yukarıdaki butonu kullanın</p>
          </div>
        )}

        {/* Ekleme / Düzenleme Modalı */}
        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-6 rounded-t-xl sticky top-0 z-10">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold">
                    {editingId ? 'Raporu Düzenle' : 'Yeni Haftalık Rapor'}
                  </h2>
                  <button
                    disabled={saving}
                    onClick={() => { setShowModal(false); setEditingId(null); resetForm(); }}
                    className="p-2 hover:bg-white/20 rounded-lg transition"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>

              <form onSubmit={handleSubmit} aria-busy={saving} className="p-6">
                <fieldset disabled={saving} className="min-w-0 border-0 p-0 m-0">
                {/* Fatura Verisi Bilgilendirmesi */}
                <div className="mb-6 p-4 bg-blue-50 border-l-4 border-blue-500 rounded-lg">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold text-blue-900 mb-2">💡 Fatura/Okuma Endeks Tablosundan Veri Girişi</h4>
                      <p className="text-xs text-blue-800 mb-2">Fatura tablonuzda şu bilgiler mevcut:</p>
                      <ul className="text-xs text-blue-800 space-y-1">
                        <li>✅ <strong>Aktif Enerji Tüketimi (kWh)</strong> → "Enerji Tüketimi" alanına girin</li>
                        <li>✅ <strong>Demand / Maksimum Talep (kW)</strong> → "Aktif Güç" alanına girin</li>
                        <li>✅ <strong>Endüktif Reaktif (kVArh)</strong> → OSOS özet tablosuna yapıştürün</li>
                        <li>✅ <strong>Kapasitif Reaktif (kVArh)</strong> → OSOS özet tablosuna yapıştürün</li>
                        <li>✅ <strong>Reaktif Oranları (%)</strong> → Raporda otomatik gösterilecek</li>
                        <li>⚠️ <strong>Güç Faktörü (Cosφ)</strong> → Manuel girin veya otomatik hesaplat</li>
                        <li>⚠️ <strong>Önceki Hafta Cosφ</strong> → İlk kayıtta "İlk kayıt" seçeneğini işaretleyin</li>
                      </ul>
                      <p className="text-xs text-blue-700 mt-2 font-medium">💡 İpucu: OSOS özet tablosunu yapıştürün, Cosφ otomatik hesaplanacak!</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Fabrika Adı */}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Fabrika Adı *</label>
                    <input
                      type="text"
                      required
                      value={formData.fabrika_adi}
                      onChange={(e) => setFormData({ ...formData, fabrika_adi: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      placeholder="Örn: ABC Fabrikası"
                    />
                  </div>

                  {/* Hafta Tarihleri */}
                  <div className="md:col-span-2">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">Hafta Dönemi *</label>
                      <button
                        type="button"
                        onClick={() => {
                          const period = currentWeekPeriod();
                          
                          setFormData({
                            ...formData,
                            hafta_baslangic: period.start,
                            hafta_bitis: period.end
                          });
                        }}
                        className="text-xs px-3 py-1 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition"
                      >
                        Bu Hafta
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <input
                          type="date"
                          required
                          value={formData.hafta_baslangic}
                          onChange={(e) => setFormData({ ...formData, hafta_baslangic: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        />
                        <p className="text-xs text-gray-500 mt-1">Pazartesi</p>
                      </div>
                      <div>
                        <input
                          type="date"
                          required
                          value={formData.hafta_bitis}
                          onChange={(e) => setFormData({ ...formData, hafta_bitis: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        />
                        <p className="text-xs text-gray-500 mt-1">Pazar</p>
                      </div>
                    </div>
                  </div>

                  {/* Güç Faktörü */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Güç Faktörü (cosφ) *</label>
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="checkbox"
                        id="autoCalculate"
                        checked={autoCalculateCosPhi}
                        onChange={(e) => setAutoCalculateCosPhi(e.target.checked)}
                        className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                      />
                      <label htmlFor="autoCalculate" className="text-sm text-gray-600">
                        OSOS verilerinden otomatik hesapla (Aktif/Reaktif enerjiden)
                      </label>
                    </div>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      max="1"
                      required
                      disabled={autoCalculateCosPhi}
                      value={formData.guc_faktoru}
                      onChange={(e) => setFormData({ ...formData, guc_faktoru: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-green-50 disabled:cursor-not-allowed"
                      placeholder="0.920"
                    />
                    {autoCalculateCosPhi && formData.guc_faktoru && (
                      <p className="mt-1 text-xs text-green-600">✓ Otomatik hesaplandı</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Önceki Hafta Güç Faktörü
                      {ilkKayit && <span className="ml-2 text-xs text-blue-600">(İlk kayıtta boş bırakılabilir)</span>}
                    </label>
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="checkbox"
                        id="ilkKayit"
                        checked={ilkKayit}
                        onChange={(e) => {
                          setIlkKayit(e.target.checked);
                          if (e.target.checked) {
                            setFormData({ ...formData, onceki_hafta_guc_faktoru: '' });
                          }
                        }}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <label htmlFor="ilkKayit" className="text-sm text-gray-600">Bu fabrikanın ilk kaydı</label>
                    </div>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      max="1"
                      required={!ilkKayit}
                      disabled={ilkKayit}
                      value={formData.onceki_hafta_guc_faktoru}
                      onChange={(e) => setFormData({ ...formData, onceki_hafta_guc_faktoru: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                      placeholder={ilkKayit ? "İlk kayıt - veri yok" : "0.910"}
                    />
                  </div>

                  {/* Hedef Güç Faktörü */}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Hedef Güç Faktörü
                      <span className="ml-2 text-xs text-gray-500">(Varsayılan: 0.95 - Türkiye için ideal)</span>
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      max="1"
                      value={formData.hedef_guc_faktoru}
                      onChange={(e) => setFormData({ ...formData, hedef_guc_faktoru: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      placeholder="0.950"
                    />
                  </div>

                  {/* Güç Bilgileri */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Aktif Güç (kW) *
                      <span className="ml-2 text-xs text-gray-500">(Faturadaki Demand değeri)</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={formData.aktif_guc}
                      onChange={(e) => setFormData({ ...formData, aktif_guc: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      placeholder="327.06"
                    />
                    <p className="mt-1 text-xs text-gray-500">Fatura tablosunda "Demand / Tüketim" satüründaki değer</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Reaktif Güç (kVAr)
                      <span className="ml-2 text-xs text-gray-500">(Opsiyonel - genelde faturada yoktur)</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.reaktif_guc}
                      onChange={(e) => setFormData({ ...formData, reaktif_guc: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      placeholder="350"
                    />
                    <p className="mt-1 text-xs text-gray-500">Anlık reaktif güç - manuel hesap veya OSOS verilerinden çıkarılabilir</p>
                  </div>

                  {/* Kompanzasyon */}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Kompanzasyon Durumu *</label>
                    <input
                      type="text"
                      required
                      value={formData.kompanzasyon_durumu}
                      onChange={(e) => setFormData({ ...formData, kompanzasyon_durumu: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      placeholder="Örn: Otomatik kompanzasyon aktif, 3 kademe çalışıyor"
                    />
                  </div>

                  {/* Enerji ve Maliyet */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Enerji Tüketimi (kWh) *
                      <span className="ml-2 text-xs text-gray-500">(Faturadaki aktif enerji)</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={formData.enerji_tuketimi}
                      onChange={(e) => setFormData({ ...formData, enerji_tuketimi: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      placeholder="70044.66"
                    />
                    <p className="mt-1 text-xs text-gray-500">Fatura tablosunda "1.8.0 - Aktif enerji" tüketim değeri</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Maliyet (₺)
                      <span className="ml-2 text-xs text-gray-500">(Opsiyonel)</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.maliyet}
                      onChange={(e) => setFormData({ ...formData, maliyet: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      placeholder="245156"
                    />
                  </div>

                  {/* Notlar */}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Notlar</label>
                    <textarea
                      value={formData.notlar}
                      onChange={(e) => setFormData({ ...formData, notlar: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      rows="3"
                      placeholder="Ek açıklamalar..."
                    />
                  </div>

                  {/* OSOS Özet Tablosu Manuel Giriş */}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="w-4 h-4" />
                        OSOS Özet Tablosu (Manuel Yapıştır)
                        <span className="text-xs font-normal text-green-600">⭐ Önerilen</span>
                      </div>
                    </label>
                    <div className="mb-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-xs text-green-800">
                        <strong>💡 Fatura tablosundan bu bilgiler buraya yapıştırılmalı:</strong>
                      </p>
                      <ul className="text-xs text-green-700 mt-1 space-y-0.5 ml-4">
                        <li>• <strong>1.8.0</strong> - Aktif enerji tüketimi (70.044,66 kWh)</li>
                        <li>• <strong>5.8.0</strong> - Endüktif reaktif enerji (4.134,48 kVArh - %5,90)</li>
                        <li>• <strong>8.8.0</strong> - Kapasitif reaktif enerji (1.298,58 kVArh - %1,85)</li>
                      </ul>
                      <p className="text-xs text-green-800 mt-2">
                        ✅ Bu tabloyu yapıştırdığınızda <strong>Cosφ otomatik hesaplanacak!</strong>
                      </p>
                    </div>
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => setShowOsosTableInput(!showOsosTableInput)}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-orange-300 rounded-lg hover:border-orange-500 hover:bg-orange-50 transition"
                      >
                        <BarChart3 className="w-5 h-5 text-orange-500" />
                        <span className="text-gray-600">OSOS Özet Tablosunu Yapıştır (Endeks Kodları)</span>
                      </button>
                      
                      {showOsosTableInput && (
                        <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                          <p className="text-sm text-gray-600 mb-2">
                            OSOS'tan kopyaladığınız özet tabloyu (Endeks Kodu, Açıklama, İlk endeks, vb.) aşağıya yapıştürün:
                          </p>
                          <textarea
                            value={ososTableText}
                            onChange={(e) => setOsosTableText(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent font-mono text-xs"
                            rows="8"
                            placeholder="Endeks Kodu\tAçıklama\tİlk endeks\tSon endeks\tEndeks Farkı\tÇarpan\tTüketim (kWh)\tYasal Sınır\tDurum\n1.8.0\tAktif enerji\t3.296,18\t3.346,94\t50,7570\t1380,0000\t70.044,66\t\t\n..."
                          />
                          <div className="flex gap-2 mt-3">
                            <button
                              type="button"
                              onClick={handleOsosTablePaste}
                              className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition font-semibold"
                            >
                              Parse Et ve Yükle
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowOsosTableInput(false);
                                setOsosTableText('');
                              }}
                              className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition"
                            >
                              İptal
                            </button>
                          </div>
                        </div>
                      )}

                      {ososOzetTablosu.length > 0 && (
                        <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CheckCircle className="w-5 h-5 text-orange-600" />
                              <span className="text-sm font-medium text-orange-700">
                                {ososOzetTablosu.length} satır OSOS özet verisi yüklendi
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowOsosTableInput(true)}
                              className="text-xs px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded transition"
                            >
                              Düzenle
                            </button>
                          </div>
                          <div className="mt-2 text-xs text-gray-600">
                            Aktif: {ososOzetTablosu.find(r => r.endeks_kodu === '1.8.0')?.tuketim.toFixed(2) || 0} kWh |
                            Endüktif: {ososOzetTablosu.find(r => r.endeks_kodu === '5.8.0')?.tuketim.toFixed(2) || 0} kVArh |
                            Kapasitif: {ososOzetTablosu.find(r => r.endeks_kodu === '8.8.0')?.tuketim.toFixed(2) || 0} kVArh
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Excel Veri Yükleme - 3 Ayrı Dosya */}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="w-4 h-4" />
                        Excel Verileri Yükle (OSOS Detay Raporları)
                      </div>
                    </label>
                    <div className="space-y-3">
                      {/* Aktif Enerji Excel */}
                      <div>
                        <input
                          ref={excelInputRefAktif}
                          type="file"
                          accept=".xls,.xlsx"
                          onChange={handleExcelUploadAktif}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => excelInputRefAktif.current?.click()}
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-green-300 rounded-lg hover:border-green-500 hover:bg-green-50 transition"
                        >
                          <Upload className="w-5 h-5 text-green-500" />
                          <span className="text-gray-600">
                            {excelDataAktif.length > 0 ? `✓ Aktif Enerji (1.8.0) - ${excelDataAktif.length} satır` : 'Aktif Enerji Excel Yükle (1.8.0)'}
                          </span>
                        </button>
                      </div>

                      {/* Endüktif Reaktif Excel */}
                      <div>
                        <input
                          ref={excelInputRefEnduktif}
                          type="file"
                          accept=".xls,.xlsx"
                          onChange={handleExcelUploadEnduktif}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => excelInputRefEnduktif.current?.click()}
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-yellow-300 rounded-lg hover:border-yellow-500 hover:bg-yellow-50 transition"
                        >
                          <Upload className="w-5 h-5 text-yellow-500" />
                          <span className="text-gray-600">
                            {excelDataEnduktif.length > 0 ? `✓ Endüktif Reaktif (5.8.0) - ${excelDataEnduktif.length} satır` : 'Endüktif Reaktif Excel Yükle (5.8.0)'}
                          </span>
                        </button>
                      </div>

                      {/* Kapasitif Reaktif Excel */}
                      <div>
                        <input
                          ref={excelInputRefKapasitif}
                          type="file"
                          accept=".xls,.xlsx"
                          onChange={handleExcelUploadKapasitif}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => excelInputRefKapasitif.current?.click()}
                          className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-pink-300 rounded-lg hover:border-pink-500 hover:bg-pink-50 transition"
                        >
                          <Upload className="w-5 h-5 text-pink-500" />
                          <span className="text-gray-600">
                            {excelDataKapasitif.length > 0 ? `✓ Kapasitif Reaktif (8.8.0) - ${excelDataKapasitif.length} satır` : 'Kapasitif Reaktif Excel Yükle (8.8.0)'}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Görsel Yükleme */}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      <div className="flex items-center gap-2">
                        <ImageIcon className="w-4 h-4" />
                        Görsel / Fotoğraf Ekle
                      </div>
                    </label>
                    <div className="space-y-3">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-indigo-500 hover:bg-indigo-50 transition"
                      >
                        <Upload className="w-5 h-5 text-gray-500" />
                        <span className="text-gray-600">Görsel Yükle (Kompanzasyon panosu, ölçüm cihazı vb.)</span>
                      </button>
                      {uploadedImage && (
                        <div className="relative">
                          <img 
                            src={uploadedImage} 
                            alt="Yüklenen görsel" 
                            className="w-full h-48 object-cover rounded-lg border border-gray-300"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setUploadedImage(null);
                              setFormData({ ...formData, gorsel_url: '' });
                            }}
                            className="absolute top-2 right-2 p-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-6 mt-6 border-t border-gray-200">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-semibold rounded-lg transition"
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
            </div>
          </div>
        )}

        {/* Excel Önizleme Modal */}
        {showExcelPreview && parsedExcelData.length > 0 && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-y-auto">
              <div className="bg-gradient-to-r from-green-600 to-emerald-600 p-4 flex justify-between items-center text-white sticky top-0 z-10 rounded-t-xl">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-6 h-6" />
                  <h3 className="font-bold text-lg">Excel Veri Önizleme</h3>
                </div>
                <button onClick={() => setShowExcelPreview(false)} className="hover:bg-white/20 p-1 rounded">
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="p-6">
                {/* Enerji Türü ve Kolon Seçimi */}
                <div className="mb-6 bg-gradient-to-r from-indigo-50 to-purple-50 border-2 border-indigo-200 rounded-xl p-6">
                  <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-indigo-600" />
                    Veri Türü Seçimi
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Veri Kolonu
                      </label>
                      <select
                        value={selectedDataColumn}
                        onChange={(e) => {
                          setSelectedDataColumn(e.target.value);
                          // Veriyi yeniden parse et
                          const updatedData = excelData.map(row => {
                            const excelDate = row['Tarih'];
                            const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
                            return {
                              tarih: jsDate.toISOString().split('T')[0],
                              saat: jsDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
                              okunan_endeks: row['Okunan Endeks Değeri'] || 0,
                              carpan: row['Çarpan'] || 1380,
                              hesaplanmis_endeks: row['Hesaplanmış Endeks'] || 0,
                              tuketim: row[e.target.value] || 0,
                              enerji_turu: selectedEnergyType,
                              raw_data: row
                            };
                          });
                          setParsedExcelData(updatedData);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      >
                        {excelColumns.map(col => (
                          <option key={col} value={col}>{col}</option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500 mt-1">Excel'de hangi kolon kullanılsın?</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Enerji Türü
                      </label>
                      <select
                        value={selectedEnergyType}
                        onChange={(e) => {
                          setSelectedEnergyType(e.target.value);
                          // Veriyi güncelle
                          const updatedData = parsedExcelData.map(row => ({
                            ...row,
                            enerji_turu: e.target.value
                          }));
                          setParsedExcelData(updatedData);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      >
                        <option value="aktif">⚡ Aktif Enerji (kWh)</option>
                        <option value="enduktif">🔴 Reaktif Endüktif (kVArh)</option>
                        <option value="kapasitif">🔵 Reaktif Kapasitif (kVArh)</option>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">Bu veri hangi enerji türü?</p>
                    </div>
                  </div>
                  <div className="mt-4 p-3 bg-white rounded-lg border border-indigo-200">
                    <p className="text-sm font-semibold text-gray-700">
                      Seçili: <span className="text-indigo-600">{selectedDataColumn}</span> 
                      {selectedEnergyType === 'aktif' && ' (⚡ Aktif Enerji)'}
                      {selectedEnergyType === 'enduktif' && ' (🔴 Reaktif Endüktif)'}
                      {selectedEnergyType === 'kapasitif' && ' (🔵 Reaktif Kapasitif)'}
                    </p>
                  </div>
                </div>

                <div className="mb-4 grid grid-cols-3 gap-4">
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <p className="text-sm text-gray-600">Toplam Satır</p>
                    <p className="text-2xl font-bold text-blue-600">{parsedExcelData.length}</p>
                  </div>
                  <div className="bg-green-50 p-4 rounded-lg">
                    <p className="text-sm text-gray-600">Toplam Tüketim</p>
                    <p className="text-2xl font-bold text-green-600">
                      {parsedExcelData.reduce((sum, r) => sum + parseFloat(r.tuketim || 0), 0).toFixed(2)} 
                      {selectedEnergyType === 'aktif' ? ' kWh' : ' kVArh'}
                    </p>
                  </div>
                  <div className="bg-purple-50 p-4 rounded-lg">
                    <p className="text-sm text-gray-600">Tarih Aralığı</p>
                    <p className="text-sm font-bold text-purple-600">
                      {parsedExcelData[0]?.tarih} - {parsedExcelData[parsedExcelData.length - 1]?.tarih}
                    </p>
                  </div>
                </div>

                {/* Tüketim Grafiği */}
                <div className="mb-6 bg-gray-50 p-4 rounded-lg">
                  <h4 className="font-bold text-gray-700 mb-3">Günlük Tüketim Grafiği</h4>
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={groupDataByDay(parsedExcelData)}>
                      <defs>
                        <linearGradient id="colorTuketim" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8}/>
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="gun" fontSize={12} />
                      <YAxis fontSize={12} />
                      <Tooltip />
                      <Area type="monotone" dataKey="tuketim" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorTuketim)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Veri Tablosu */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="border p-2 text-left">#</th>
                        <th className="border p-2 text-left">Tarih</th>
                        <th className="border p-2 text-left">Saat</th>
                        <th className="border p-2 text-right">Okunan Endeks</th>
                        <th className="border p-2 text-right">Çarpan</th>
                        <th className="border p-2 text-right">Hesaplanmış Endeks</th>
                        <th className="border p-2 text-right">Tüketim (kWh)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedExcelData.slice(0, 100).map((row, idx) => (
                        <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="border p-2">{idx + 1}</td>
                          <td className="border p-2">{row.tarih}</td>
                          <td className="border p-2">{row.saat}</td>
                          <td className="border p-2 text-right">{row.okunan_endeks}</td>
                          <td className="border p-2 text-right">{row.carpan}</td>
                          <td className="border p-2 text-right">{(row.hesaplanmis_endeks == null ? '—' : row.hesaplanmis_endeks.toFixed(2))}</td>
                          <td className="border p-2 text-right font-semibold">{row.tuketim.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsedExcelData.length > 100 && (
                    <p className="text-center text-sm text-gray-500 mt-2">
                      İlk 100 satır gösteriliyor. Toplam: {parsedExcelData.length} satır
                    </p>
                  )}
                </div>

                <div className="flex gap-3 pt-6 mt-6 border-t border-gray-200">
                  <button
                    onClick={applyExcelDataToForm}
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold rounded-lg transition"
                  >
                    <CheckCircle className="w-5 h-5" />
                    <span>Verileri Forma Aktar</span>
                  </button>
                  <button
                    onClick={() => setShowExcelPreview(false)}
                    className="px-6 py-3 bg-gray-500 hover:bg-gray-600 text-white font-semibold rounded-lg transition"
                  >
                    Kapat
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Grafik Modal */}
        {showGrafikModal && selectedRapor && parsedExcelData.length > 0 && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-7xl max-h-[90vh] overflow-y-auto">
              <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-4 flex justify-between items-center text-white sticky top-0 z-10 rounded-t-xl">
                <div className="flex items-center gap-2">
                  <LineChart className="w-6 h-6" />
                  <h3 className="font-bold text-lg">Detaylı Tüketim Grafikleri - {selectedRapor.fabrika_adi}</h3>
                </div>
                <button onClick={() => setShowGrafikModal(false)} className="hover:bg-white/20 p-1 rounded">
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="p-6 space-y-6">
                <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-4">
                  {[
                    { key: 'aktif', label: 'Aktif Enerji', unit: 'kWh' },
                    { key: 'enduktif', label: 'Endüktif Reaktif', unit: 'kVArh' },
                    { key: 'kapasitif', label: 'Kapasitif Reaktif', unit: 'kVArh' }
                  ].map(type => selectedRapor[`excel_data_${type.key}`] && (
                    <button
                      key={type.key}
                      type="button"
                      onClick={() => setAnalyticsDataset(selectedRapor, type.key)}
                      className={`px-3 py-2 text-sm font-semibold rounded-md transition ${selectedEnergyType === type.key ? 'bg-cyan-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                    >
                      {type.label} ({type.unit})
                    </button>
                  ))}
                </div>
                {/* Enerji Türü Badge */}
                {parsedExcelData.length > 0 && parsedExcelData[0].enerji_turu && (
                  <div className="flex items-center justify-center gap-3 p-4 bg-gradient-to-r from-indigo-100 to-purple-100 rounded-lg">
                    <p className="text-lg font-bold text-gray-800">
                      Enerji Türü: 
                      {parsedExcelData[0].enerji_turu === 'aktif' && ' ⚡ Aktif Enerji (kWh)'}
                      {parsedExcelData[0].enerji_turu === 'enduktif' && ' 🔴 Reaktif Endüktif (kVArh)'}
                      {parsedExcelData[0].enerji_turu === 'kapasitif' && ' 🔵 Reaktif Kapasitif (kVArh)'}
                    </p>
                  </div>
                )}

                {/* Saatlik Tüketim Grafiği */}
                <div className="bg-gradient-to-br from-blue-50 to-cyan-50 p-6 rounded-xl border-2 border-blue-200">
                  <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-blue-600" />
                    Günlük Enerji Tüketimi {parsedExcelData[0]?.enerji_turu === 'aktif' ? '(kWh)' : '(kVArh)'}
                  </h4>
                  <ResponsiveContainer width="100%" height={350}>
                    <AreaChart data={groupDataByDay(parsedExcelData)}>
                      <defs>
                        <linearGradient id="colorTuketim2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="gun" fontSize={11} />
                      <YAxis fontSize={11} label={{ value: 'kWh', angle: -90, position: 'insideLeft' }} />
                      <Tooltip contentStyle={{ background: '#fff', border: '1px solid #ddd', borderRadius: '8px' }} />
                      <Area type="monotone" dataKey="tuketim" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorTuketim2)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Bar Chart - Endeks Değerleri */}
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 p-6 rounded-xl border-2 border-green-200">
                  <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-green-600" />
                    Günlük Ortalama Hesaplanmış Endeks Değerleri
                  </h4>
                  <ResponsiveContainer width="100%" height={350}>
                    <RechartsBar data={groupDataByDay(parsedExcelData)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="gun" fontSize={11} />
                      <YAxis fontSize={11} />
                      <Tooltip contentStyle={{ background: '#fff', border: '1px solid #ddd', borderRadius: '8px' }} />
                      <Bar dataKey="hesaplanmis_endeks" fill="#10b981" radius={[8, 8, 0, 0]} />
                    </RechartsBar>
                  </ResponsiveContainer>
                </div>

                {/* Line Chart - Okunan Endeks */}
                <div className="bg-gradient-to-br from-purple-50 to-pink-50 p-6 rounded-xl border-2 border-purple-200">
                  <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-purple-600" />
                    Günlük Ortalama Okunan Endeks Trendi
                  </h4>
                  <ResponsiveContainer width="100%" height={350}>
                    <RechartsLine data={groupDataByDay(parsedExcelData)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="gun" fontSize={11} />
                      <YAxis fontSize={11} />
                      <Tooltip contentStyle={{ background: '#fff', border: '1px solid #ddd', borderRadius: '8px' }} />
                      <Legend />
                      <Line type="monotone" dataKey="okunan_endeks" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 6 }} />
                    </RechartsLine>
                  </ResponsiveContainer>
                </div>

                {/* İstatistikler */}
                <div className="grid grid-cols-4 gap-4">
                  <div className="bg-gradient-to-br from-orange-100 to-orange-200 p-4 rounded-lg text-center">
                    <p className="text-sm text-orange-700 font-medium">Max Günlük Tüketim</p>
                    <p className="text-2xl font-bold text-orange-900">
                      {Math.max(...groupDataByDay(parsedExcelData).map(d => d.tuketim)).toFixed(2)} kWh
                    </p>
                  </div>
                  <div className="bg-gradient-to-br from-blue-100 to-blue-200 p-4 rounded-lg text-center">
                    <p className="text-sm text-blue-700 font-medium">Min Günlük Tüketim</p>
                    <p className="text-2xl font-bold text-blue-900">
                      {Math.min(...groupDataByDay(parsedExcelData).map(d => d.tuketim)).toFixed(2)} kWh
                    </p>
                  </div>
                  <div className="bg-gradient-to-br from-green-100 to-green-200 p-4 rounded-lg text-center">
                    <p className="text-sm text-green-700 font-medium">Günlük Ortalama</p>
                    <p className="text-2xl font-bold text-green-900">
                      {(groupDataByDay(parsedExcelData).reduce((sum, d) => sum + d.tuketim, 0) / groupDataByDay(parsedExcelData).length).toFixed(2)} kWh
                    </p>
                  </div>
                  <div className="bg-gradient-to-br from-purple-100 to-purple-200 p-4 rounded-lg text-center">
                    <p className="text-sm text-purple-700 font-medium">Toplam</p>
                    <p className="text-2xl font-bold text-purple-900">
                      {parsedExcelData.reduce((sum, d) => sum + d.tuketim, 0).toFixed(2)} kWh
                    </p>
                  </div>
                </div>

                {/* OSOS Özet Tablosu */}
                {selectedRapor.osos_ozet_tablo && (() => {
                  try {
                    const ososData = JSON.parse(selectedRapor.osos_ozet_tablo);
                    return (
                      <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-6 rounded-xl border-2 border-orange-200">
                        <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                          <BarChart3 className="w-5 h-5 text-orange-600" />
                          OSOS Özet Tablosu - Endeks Bilgileri
                        </h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs border-collapse">
                            <thead className="bg-orange-600 text-white">
                              <tr>
                                <th className="border p-2 text-left">Kod</th>
                                <th className="border p-2 text-left">Açıklama</th>
                                <th className="border p-2 text-right">İlk Endeks</th>
                                <th className="border p-2 text-right">Son Endeks</th>
                                <th className="border p-2 text-right">Fark</th>
                                <th className="border p-2 text-right">Çarpan</th>
                                <th className="border p-2 text-right">Tüketim</th>
                                <th className="border p-2 text-center">Yasal Sınır</th>
                                <th className="border p-2 text-center">Durum</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ososData.map((row, idx) => {
                                const isMainRow = ['1.8.0', '5.8.0', '8.8.0'].includes(row.endeks_kodu);
                                return (
                                  <tr key={idx} className={isMainRow ? 'bg-yellow-100' : (idx % 2 === 0 ? 'bg-white' : 'bg-gray-50')}>
                                    <td className={`border p-2 ${isMainRow ? 'font-bold' : ''}`}>{row.endeks_kodu}</td>
                                    <td className={`border p-2 ${isMainRow ? 'font-bold' : ''}`}>{row.aciklama}</td>
                                    <td className="border p-2 text-right">{row.ilk_endeks.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                                    <td className="border p-2 text-right">{row.son_endeks.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                                    <td className="border p-2 text-right">{row.endeks_farki.toLocaleString('tr-TR', { minimumFractionDigits: 4 })}</td>
                                    <td className="border p-2 text-right">{row.carpan.toLocaleString('tr-TR')}</td>
                                    <td className={`border p-2 text-right ${isMainRow ? 'font-bold text-orange-700' : ''}`}>{row.tuketim.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                                    <td className="border p-2 text-center">{row.yasal_sinir}</td>
                                    <td className={`border p-2 text-center font-semibold ${row.durum.includes('%') ? (parseFloat(row.durum.replace('%', '').trim()) > 15 ? 'text-red-600' : 'text-green-600') : ''}`}>{row.durum}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <div className="mt-3 p-3 bg-white rounded-lg border border-orange-200">
                          <p className="text-xs text-gray-600">
                            <strong>Açıklama:</strong> 
                            1.8.x: Aktif enerji tüketimi (Gündüz, Puant, Gece dönemleri) |
                            5.8.0: Endüktif reaktif enerji (Yasal sınır: %20) |
                            8.8.0: Kapasitif reaktif enerji (Yasal sınır: %15) |
                            2.8.0: Ters yön aktif enerji (veriş)
                          </p>
                        </div>
                      </div>
                    );
                  } catch (e) {
                    return null;
                  }
                })()}
              </div>
            </div>
          </div>
        )}

        {/* PDF Preview Modal */}
        {showPdfPreview && selectedRapor && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-[95vw] h-[95vh] flex flex-col">
              {/* Header */}
              <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-4 flex justify-between items-center text-white shrink-0 rounded-t-xl">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-6 h-6" />
                  <h3 className="font-bold text-lg">Haftalık Enerji Raporu - Ön İzleme</h3>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setPdfEditMode(!pdfEditMode);
                      if (!pdfEditMode) {
                        setEditedPdfData({...selectedRapor});
                      }
                    }}
                    className={`px-3 py-2 ${pdfEditMode ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-green-600 hover:bg-green-700'} rounded-lg font-medium flex items-center gap-2 transition-colors`}
                  >
                    <Edit3 className="w-5 h-5" />
                    {pdfEditMode ? 'Düzenleme Modu' : 'Düzenle'}
                  </button>
                  {pdfEditMode && (
                    <button
                      onClick={async () => {
                        // Düzenlenmiş veriyi veritabanına kaydet
                        const { error } = await supabase
                          .from('haftalik_raporlar')
                          .update(editedPdfData)
                          .eq('id', selectedRapor.id);
                        
                        if (error) {
                          alert('Kaydetme hatası: ' + error.message);
                        } else {
                          alert('Değişiklikler kaydedildi!');
                          setSelectedRapor(editedPdfData);
                          setPdfEditMode(false);
                          fetchRaporlar(); // Listeyi güncelle
                        }
                      }}
                      className="px-3 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-medium flex items-center gap-2 transition-colors"
                    >
                      <Download className="w-5 h-5" />
                      Kaydet
                    </button>
                  )}
                  <button
                    onClick={handlePDFDownload}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium flex items-center gap-2 transition-colors"
                  >
                    <Download className="w-5 h-5" />
                    PDF İndir
                  </button>
                  <button onClick={() => {
                    setShowPdfPreview(false);
                    setSelectedRapor(null);
                    setPdfEditMode(false);
                  }} className="hover:bg-white/20 p-1 rounded">
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>
              
              {/* Preview Content */}
              <div className="flex-1 overflow-y-auto bg-gray-100 p-4">
                <div id="haftalik-rapor-printable" className="mx-auto flex flex-col items-center gap-4">
                  {/* PDF Sayfa Render Mantığı - IIFE */}
                  {(() => {
                    const durum = getDurum(selectedRapor);
                    const trend = getTrend(selectedRapor);
                    const current = parseDecimal(selectedRapor.guc_faktoru, null);
                    const previous = parseDecimal(selectedRapor.onceki_hafta_guc_faktoru, null);
                    const target = parseDecimal(selectedRapor.hedef_guc_faktoru, null);
                    const cost = parseDecimal(selectedRapor.maliyet, null);
                    const gucFaktoruFark = current !== null && previous !== null ? (current - previous) * 100 : null;
                    const gucFaktoruYuzde = current !== null && target > 0 ? ((current / target) * 100).toFixed(1) : null;

                    const pages = [];
                    
                    // SAYFA 1
                    pages.push(
                      <div key="page-1" className="haftalik-pdf-page" style={{ width: '210mm', height: '297mm', background: 'white', padding: '15mm 20mm 30mm 20mm', fontFamily: 'Arial, sans-serif', position: 'relative', boxSizing: 'border-box' }}>
                        {/* Header - Logo and Report Number */}
                        <div style={{ marginBottom: '5mm', paddingBottom: '3mm', borderBottom: '2px solid #2980b9' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6mm' }}>
                            <div style={{ width: '40mm', flexShrink: 0 }}>
                              <img src="/calisan/uygulama/fatura_logo.png" alt="Logo" style={{ width: '100%', height: 'auto', maxHeight: '20mm', objectFit: 'contain' }} onError={(e) => { e.target.style.display = 'none'; }} />
                            </div>
                            <div style={{ flex: 1, textAlign: 'right' }}>
                              <p style={{ fontSize: '14px', fontWeight: 'bold', color: '#2980b9', margin: 0 }}>Rapor No: HFT-{String(selectedRapor.id).substring(0, 6).toUpperCase()}</p>
                              <p style={{ fontSize: '14px', fontWeight: 'bold', color: '#2980b9', margin: '2px 0 0 0' }}>{new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                            </div>
                          </div>
                        </div>

                        {/* Rapor Bilgileri */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10mm', fontSize: '11px' }}>
                          <div style={{ width: '48%' }}>
                            <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: '#2980b9', marginBottom: '5px' }}>TESİS BİLGİLERİ</h3>
                            <p style={{ margin: '3px 0', lineHeight: '1.6' }}>
                              <strong>Tesis Adı:</strong> 
                              <span 
                                contentEditable={pdfEditMode}
                                suppressContentEditableWarning={true}
                                onBlur={(e) => pdfEditMode && setEditedPdfData({...editedPdfData, fabrika_adi: e.target.textContent})}
                                style={{ outline: pdfEditMode ? '1px dashed #2980b9' : 'none', padding: pdfEditMode ? '2px' : '0', display: 'inline-block', minWidth: '100px' }}
                              >
                                {pdfEditMode ? (editedPdfData?.fabrika_adi || selectedRapor.fabrika_adi) : selectedRapor.fabrika_adi}
                              </span>
                            </p>
                            <p style={{ margin: '3px 0', lineHeight: '1.6' }}><strong>Rapor Dönemi:</strong> {new Date(selectedRapor.hafta_baslangic).toLocaleDateString('tr-TR')} - {new Date(selectedRapor.hafta_bitis).toLocaleDateString('tr-TR')}</p>
                            <p style={{ margin: '3px 0', lineHeight: '1.6' }}><strong>Durum:</strong> <span style={{ color: durum.text === 'UYGUN' ? '#10b981' : durum.text === 'DİKKAT' ? '#f59e0b' : '#ef4444', fontWeight: 'bold' }}>{durum.text}</span></p>
                          </div>
                          <div style={{ width: '48%' }}>
                            <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: '#2980b9', marginBottom: '5px' }}>ÖLÇÜM VE ANALİZ</h3>
                            <p style={{ margin: '3px 0', lineHeight: '1.6' }}><strong>Hedef Güç Faktörü:</strong> {selectedRapor.hedef_guc_faktoru}</p>
                            <p style={{ margin: '3px 0', lineHeight: '1.6' }}><strong>Rapor Hazirlayan:</strong> VoltGuard</p>
                            <p style={{ margin: '3px 0', lineHeight: '1.6' }}><strong>Onaylayan:</strong> Teknik Müdür</p>
                          </div>
                        </div>

                        {/* Haftalık Özet */}
                        <div style={{ marginTop: '6mm', marginBottom: '6mm', padding: '10px', backgroundColor: '#f8f9fa', borderLeft: '4px solid #2980b9' }}>
                          <h3 style={{ fontSize: '12px', fontWeight: 'bold', color: '#2c3e50', marginBottom: '5px' }}>Haftalık Özet</h3>
                          <p style={{ fontSize: '10px', lineHeight: '1.6', color: '#555', margin: 0 }}>
                            Bu hafta güç faktörü <strong>{selectedRapor.guc_faktoru}</strong> seviyesinde ölçülmüştür. 
                            {gucFaktoruYuzde === null ? 'Hedef oranı hesaplanamıyor. ' : <>Bu değer hedef <strong>{selectedRapor.hedef_guc_faktoru}</strong> değerinin <strong>%{gucFaktoruYuzde}</strong>'sine karşılık gelmektedir. </>}
                            {gucFaktoruFark === null ? 'Önceki hafta ölçümü olmadığı için karşılaştırma yapılamıyor. ' : gucFaktoruFark === 0 ? 'Önceki haftaya göre sabit kalmıştır (0.0%). ' : <>Önceki haftaya göre {gucFaktoruFark > 0 ? <strong style={{ color: '#10b981' }}>artış</strong> : <strong style={{ color: '#ef4444' }}>düşüş</strong>} göstermiştir ({Math.abs(gucFaktoruFark).toFixed(1)}%). </>}
                            {durum.text === 'UYGUN' ? 
                              <><strong style={{ color: '#10b981', fontSize: '12px' }}> ✓ Performans hedeflerimize uygundur.</strong> Mevcut kompanzasyon sistemi etkin çalışmaktadır.</> : 
                              durum.text === 'DİKKAT' ? 
                              <><strong style={{ color: '#f59e0b', fontSize: '12px' }}> ⚠ Dikkat gerektirir.</strong> Kompanzasyon sistemi gözden geçirilmeli, reaktif enerji cezası riski mevcuttur.</> : 
                              <><strong style={{ color: '#ef4444', fontSize: '12px' }}> ✗ ACİL: Hedefin altındadır.</strong> Kompanzasyon sistemi yetersiz, reaktif enerji cezası alınmaktadır. Hemen iyileştirme gereklidir.</>}
                          </p>
                        </div>

                        {!!(selectedRapor.guc_faktoru || selectedRapor.aktif_guc || selectedRapor.reaktif_guc) && (
                        <div style={{ marginBottom: '8mm' }}>
                          <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#2980b9', margin: '0 0 5mm 0', borderBottom: '1px solid #2980b9', paddingBottom: '2mm' }}>ANA PERFORMANS GÖSTERGELERİ</h3>
                          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${[selectedRapor.guc_faktoru, selectedRapor.aktif_guc, selectedRapor.reaktif_guc].filter(v => v).length}, 1fr)`, gap: '10px' }}>
                            {!!selectedRapor.guc_faktoru && (
                            <div style={{ background: '#f0f9ff', border: '2px solid #2980b9', borderRadius: '8px', padding: '15px', textAlign: 'center' }}>
                              <p style={{ fontSize: '10px', color: '#555', margin: '0 0 8px 0', fontWeight: '600' }}>GÜÇ FAKTÖRÜ</p>
                              <p style={{ fontSize: '28px', fontWeight: 'bold', margin: '0', color: '#2980b9' }}>{selectedRapor.guc_faktoru}</p>
                              <p style={{ fontSize: '9px', color: '#777', margin: '8px 0 0 0', paddingTop: '6px', borderTop: '1px solid #ddd' }}>cosφ</p>
                              <p style={{ fontSize: '9px', color: '#777', margin: '3px 0 0 0' }}>Hedef: {selectedRapor.hedef_guc_faktoru}</p>
                            </div>
                            )}
                            {!!selectedRapor.aktif_guc && (
                            <div style={{ background: '#f0fdf4', border: '2px solid #10b981', borderRadius: '8px', padding: '15px', textAlign: 'center' }}>
                              <p style={{ fontSize: '10px', color: '#555', margin: '0 0 8px 0', fontWeight: '600' }}>AKTİF GÜÇ</p>
                              <p style={{ fontSize: '28px', fontWeight: 'bold', margin: '0', color: '#10b981' }}>{selectedRapor.aktif_guc}</p>
                              <p style={{ fontSize: '9px', color: '#777', margin: '8px 0 0 0', paddingTop: '6px', borderTop: '1px solid #ddd' }}>kW</p>
                              <p style={{ fontSize: '9px', color: '#777', margin: '3px 0 0 0' }}>Ortalama</p>
                            </div>
                            )}
                            {!!selectedRapor.reaktif_guc && (
                            <div style={{ background: '#fffbeb', border: '2px solid #f59e0b', borderRadius: '8px', padding: '15px', textAlign: 'center' }}>
                              <p style={{ fontSize: '10px', color: '#555', margin: '0 0 8px 0', fontWeight: '600' }}>REAKTİF GÜÇ</p>
                              <p style={{ fontSize: '28px', fontWeight: 'bold', margin: '0', color: '#f59e0b' }}>{selectedRapor.reaktif_guc}</p>
                              <p style={{ fontSize: '9px', color: '#777', margin: '8px 0 0 0', paddingTop: '6px', borderTop: '1px solid #ddd' }}>kVAr</p>
                              <p style={{ fontSize: '9px', color: '#777', margin: '3px 0 0 0' }}>Ortalama</p>
                            </div>
                            )}
                          </div>
                        </div>
                        )}

                        <div style={{ marginBottom: '8mm' }}>
                          <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#2980b9', margin: '0 0 5mm 0', borderBottom: '1px solid #2980b9', paddingBottom: '2mm' }}>DETAYLI PERFORMANS ANALİZİ</h3>
                          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #ddd', fontSize: '9px' }}>
                            <thead>
                              <tr style={{ background: '#2980b9', color: 'white' }}>
                                <th style={{ padding: '8px', fontSize: '10px', fontWeight: 'bold', textAlign: 'left', border: '1px solid #ddd' }}>PARAMETRE</th>
                                <th style={{ padding: '8px', fontSize: '10px', fontWeight: 'bold', textAlign: 'left', border: '1px solid #ddd' }}>DEĞER</th>
                                <th style={{ padding: '8px', fontSize: '10px', fontWeight: 'bold', textAlign: 'left', border: '1px solid #ddd' }}>AÇIKLAMA</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr style={{ background: '#f8fafc' }}>
                                <td style={{ padding: '10px', fontSize: '11px', fontWeight: 'bold', color: '#334155', border: '1px solid #e2e8f0' }}>Enerji Tüketimi</td>
                                <td style={{ padding: '10px', fontSize: '11px', color: '#1e293b', border: '1px solid #e2e8f0' }}>{selectedRapor.enerji_tuketimi} kWh</td>
                                <td style={{ padding: '10px', fontSize: '11px', color: '#64748b', border: '1px solid #e2e8f0' }}>Ayın ilk gününden bu güne kadar kümülatif toplam</td>
                              </tr>
                              <tr style={{ background: 'white' }}>
                                <td style={{ padding: '10px', fontSize: '11px', fontWeight: 'bold', color: '#334155', border: '1px solid #e2e8f0' }}>Maliyet</td>
                                <td style={{ padding: '10px', fontSize: '11px', color: '#1e293b', border: '1px solid #e2e8f0' }}>{cost === null ? 'Belirtilmedi' : `${cost.toLocaleString('tr-TR')} ₺`}</td>
                                <td style={{ padding: '10px', fontSize: '11px', color: '#64748b', border: '1px solid #e2e8f0' }}>Toplam enerji maliyeti</td>
                              </tr>
                              <tr style={{ background: '#f8fafc' }}>
                                <td style={{ padding: '10px', fontSize: '11px', fontWeight: 'bold', color: '#334155', border: '1px solid #e2e8f0', width: '30%' }}>Kompanzasyon Durumu</td>
                                <td colSpan="2" style={{ padding: '10px', fontSize: '11px', color: '#1e293b', border: '1px solid #e2e8f0', width: '70%', wordWrap: 'break-word' }}>
                                  <span 
                                    contentEditable={pdfEditMode}
                                    suppressContentEditableWarning={true}
                                    onBlur={(e) => pdfEditMode && setEditedPdfData({...editedPdfData, kompanzasyon_durumu: e.target.textContent})}
                                    style={{ outline: pdfEditMode ? '1px dashed #2980b9' : 'none', padding: pdfEditMode ? '2px' : '0', display: 'block', minHeight: '20px' }}
                                  >
                                    {pdfEditMode ? (editedPdfData?.kompanzasyon_durumu || selectedRapor.kompanzasyon_durumu) : selectedRapor.kompanzasyon_durumu}
                                  </span>
                                </td>
                              </tr>
                              <tr style={{ background: 'white' }}>
                                <td style={{ padding: '10px', fontSize: '11px', fontWeight: 'bold', color: '#334155', border: '1px solid #e2e8f0' }}>Önceki Hafta Güç Faktörü</td>
                                <td style={{ padding: '10px', fontSize: '11px', color: '#1e293b', border: '1px solid #e2e8f0' }}>{previous === null ? 'Belirtilmedi' : selectedRapor.onceki_hafta_guc_faktoru}</td>
                                <td style={{ padding: '10px', fontSize: '11px', color: '#64748b', border: '1px solid #e2e8f0' }}>Karşılaştırma için</td>
                              </tr>
                              <tr style={{ background: '#f8fafc' }}>
                                <td style={{ padding: '10px', fontSize: '11px', fontWeight: 'bold', color: '#334155', border: '1px solid #e2e8f0' }}>Trend</td>
                                <td style={{ padding: '10px', fontSize: '11px', color: '#1e293b', border: '1px solid #e2e8f0' }}>{trend.text}</td>
                                <td style={{ padding: '10px', fontSize: '11px', color: '#64748b', border: '1px solid #e2e8f0' }}>{gucFaktoruFark === null ? 'Karşılaştırma yok' : gucFaktoruFark > 0 ? 'Pozitif yönde' : gucFaktoruFark < 0 ? 'Negatif yönde' : 'Sabit'}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>

                        {/* OSOS Özet Tablosu ilk sayfadan kaldırıldı - Detaylı tablo son sayfada */}

                        <div style={{ position: 'absolute', bottom: '8mm', left: '20mm', right: '20mm', paddingTop: '3mm', borderTop: '2px solid #2980b9' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '8px', color: '#555' }}>
                            <div style={{ flex: 1 }}>
                              <p style={{ margin: '0', fontWeight: 'bold', fontSize: '9px' }}>VoltGuard</p>
                              <p style={{ margin: '2px 0 0 0', lineHeight: '1.4' }}>Kemalpaşa OSB/İzmir</p>
                              <p style={{ margin: '2px 0 0 0' }}>Tel: +90 545 434 67 35 | voltguard.com.tr</p>
                            </div>
                            <p style={{ margin: '0', fontWeight: 'bold', color: '#2980b9', fontSize: '9px' }}>Sayfa 1/{getPdfPageCount(selectedRapor)}</p>
                          </div>
                        </div>
                      </div>
                    );

                    // SAYFA 2
                    pages.push(
                      <div key="page-2" className="haftalik-pdf-page shadow-xl" style={{ width: '210mm', height: '297mm', background: 'white', padding: '15mm 20mm 30mm 20mm', fontFamily: 'Arial, sans-serif', position: 'relative', boxSizing: 'border-box', overflow: 'hidden' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10mm', paddingBottom: '5mm', borderBottom: '2px solid #2980b9' }}>
                          <div style={{ width: '40mm', maxHeight: '20mm', display: 'flex', alignItems: 'center' }}>
                            <img src="/calisan/uygulama/fatura_logo.png" alt="Logo" style={{ maxWidth: '100%', maxHeight: '20mm', objectFit: 'contain' }} />
                          </div>
                          <div style={{ flex: 1, textAlign: 'right', paddingLeft: '10mm' }}>
                            <h2 style={{ fontSize: '16px', fontWeight: 'bold', margin: '0 0 5px 0', color: '#2c3e50' }}>ANALİZ VE ÖNERİLER</h2>
                            <p style={{ fontSize: '11px', color: '#555', margin: '0' }}>{selectedRapor.fabrika_adi}</p>
                          </div>
                        </div>

                        <div style={{ marginBottom: '8mm' }}>
                          <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#2980b9', margin: '0 0 5mm 0', borderBottom: '1px solid #2980b9', paddingBottom: '2mm' }}>KOMPANZASYON ANALİZİ VE ÖNERİLER</h3>
                          <div style={{ background: '#f0f9ff', border: '2px solid #2980b9', borderRadius: '8px', padding: '15px' }}>
                            <div style={{ fontSize: '11px', color: '#2c3e50', lineHeight: '1.8' }}>
                              {durum.text === 'UYGUN' ? (
                                <>
                                  <p style={{ margin: '0 0 10px 0' }}><strong style={{ color: '#10b981' }}>✓ Kompanzasyon sisteminiz optimal çalışıyor.</strong></p>
                                  <p style={{ margin: '0 0 10px 0' }}>✓ Mevcut bakım planına devam ediniz.</p>
                                  <p style={{ margin: '0' }}>✓ Periyodik ölçüm ve raporlamaya devam edilmeli.</p>
                                </>
                              ) : durum.text === 'DİKKAT' ? (
                                <>
                                  <p style={{ margin: '0 0 10px 0' }}><strong style={{ color: '#f59e0b' }}>⚠ Kompanzasyon sistemi kontrol edilmeli.</strong></p>
                                  <p style={{ margin: '0 0 10px 0' }}>⚠ Arıza durumundaki kademeler onarılmalı.</p>
                                  <p style={{ margin: '0 0 10px 0' }}>⚠ Reaktör ve kapasitör değerleri test edilmeli.</p>
                                  <p style={{ margin: '0' }}>⚠ Bir sonraki hafta yakın takip gerekli.</p>
                                </>
                              ) : (
                                <>
                                  <p style={{ margin: '0 0 10px 0' }}><strong style={{ color: '#ef4444' }}>✗ ACİL: Ek kompanzasyon ekipmanı gerekli.</strong></p>
                                  <p style={{ margin: '0 0 10px 0' }}>✗ Mevcut sistem yetersiz, kapasite artırılmalı.</p>
                                  <p style={{ margin: '0 0 10px 0' }}>✗ Reaktif enerji cezası ödeniyor.</p>
                                  <p style={{ margin: '0 0 10px 0' }}>✗ Elektrik mühendisi değerlendirmesi yapılmalı.</p>
                                  <p style={{ margin: '0' }}>✗ Yatırım getirisi (ROI) hesaplaması için iletişime geçiniz.</p>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {selectedRapor.notlar && (
                          <div style={{ marginBottom: '8mm' }}>
                            <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#2980b9', margin: '0 0 5mm 0', borderBottom: '1px solid #2980b9', paddingBottom: '2mm' }}>TEKNİK NOTLAR</h3>
                            <div style={{ background: '#fffbeb', border: '2px solid #f59e0b', borderRadius: '8px', padding: '15px' }}>
                              <p style={{ fontSize: '11px', color: '#422006', margin: '0', lineHeight: '1.8' }}>{selectedRapor.notlar}</p>
                            </div>
                          </div>
                        )}

                        <div style={{ marginBottom: '8mm' }}>
                          <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#2980b9', margin: '0 0 5mm 0', borderBottom: '1px solid #2980b9', paddingBottom: '2mm' }}>SONRAKİ ADIMLAR VE TAKİP</h3>
                          <div style={{ background: '#f8f9fa', border: '1px solid #ddd', borderRadius: '8px', padding: '12px' }}>
                            <div style={{ fontSize: '10px', color: '#2c3e50', lineHeight: '1.8' }}>
                              <p style={{ margin: '0 0 8px 0' }}><strong>📅 Bir Sonraki Rapor:</strong> {new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('tr-TR')}</p>
                              <p style={{ margin: '0 0 8px 0' }}><strong>🔧 Önerilen Bakım:</strong> {durum.text === 'UYGUN' ? 'Rutin kontrol yeterli' : durum.text === 'DİKKAT' ? 'Önümüzdeki 2 hafta içinde kontrol' : 'Acil müdahale gerekli'}</p>
                              <p style={{ margin: '0 0 8px 0' }}><strong>Destek İletişim:</strong> Teknik destek için +90 545 434 67 35 numaralı telefonu arayabilirsiniz.</p>
                              <p style={{ margin: '0' }}><strong>📧 Rapor Gönderimi:</strong> Bu rapor otomatik olarak kayıt altına alınmıştır.</p>
                            </div>
                          </div>
                        </div>

                        <div style={{ position: 'absolute', bottom: '8mm', left: '20mm', right: '20mm', paddingTop: '3mm', borderTop: '2px solid #2980b9' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '8px', color: '#555' }}>
                            <div style={{ flex: 1 }}>
                              <p style={{ margin: '0', fontWeight: 'bold', fontSize: '9px' }}>VoltGuard</p>
                              <p style={{ margin: '2px 0 0 0', lineHeight: '1.4' }}>Kemalpaşa OSB/İzmir</p>
                              <p style={{ margin: '2px 0 0 0' }}>Tel: +90 545 434 67 35 | voltguard.com.tr</p>
                            </div>
                            <p style={{ margin: '0', fontWeight: 'bold', color: '#2980b9', fontSize: '9px' }}>Sayfa 2/{getPdfPageCount(selectedRapor)}</p>
                          </div>
                        </div>
                      </div>
                    );

                    // SAYFA 3-5: 3 Ayrı Excel Grafikleri (varsa)
                    const excelDataSets = [
                      { data: selectedRapor.excel_data_aktif, type: 'aktif', title: 'Aktif Enerji', code: '1.8.0', color: '#10b981' },
                      { data: selectedRapor.excel_data_enduktif, type: 'enduktif', title: 'Reaktif Endüktif Enerji', code: '5.8.0', color: '#f59e0b' },
                      { data: selectedRapor.excel_data_kapasitif, type: 'kapasitif', title: 'Reaktif Kapasitif Enerji', code: '8.8.0', color: '#ec4899' }
                    ];

                    let excelPageCount = 0;
                    excelDataSets.forEach((excelSet, setIndex) => {
                      if (excelSet.data) {
                        try {
                          const excelData = JSON.parse(excelSet.data);
                          if (excelData.length === 0) return;
                          
                          excelPageCount++;
                          const currentPageNum = 2 + excelPageCount;
                          const totalPages = getPdfPageCount(selectedRapor);
                          
                          pages.push(
                            <div key={`page-excel-${setIndex}`} className="haftalik-pdf-page shadow-xl" style={{ width: '210mm', height: '297mm', background: 'white', padding: '15mm 20mm 30mm 20mm', fontFamily: 'Arial, sans-serif', position: 'relative', boxSizing: 'border-box', overflow: 'hidden' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8mm', paddingBottom: '5mm', borderBottom: `2px solid ${excelSet.color}` }}>
                                <div style={{ width: '40mm', maxHeight: '20mm', display: 'flex', alignItems: 'center' }}>
                                  <img src="/calisan/uygulama/fatura_logo.png" alt="Logo" style={{ maxWidth: '100%', maxHeight: '20mm', objectFit: 'contain' }} />
                                </div>
                                <div style={{ flex: 1, textAlign: 'right', paddingLeft: '10mm' }}>
                                  <h2 style={{ fontSize: '16px', fontWeight: 'bold', margin: '0 0 5px 0', color: '#2c3e50' }}>{excelSet.title.toUpperCase()} ANALİZ GRAFİĞİ</h2>
                                  <p style={{ fontSize: '11px', color: '#555', margin: '0' }}>{selectedRapor.fabrika_adi} - OBIS Kodu: {excelSet.code}</p>
                                </div>
                              </div>

                              {/* Excel Grafiği - Recharts ile render edilecek */}
                              <div style={{ height: '235mm' }}>
                                <div style={{ marginBottom: '5mm' }}>
                                  <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: excelSet.color, margin: '0 0 3mm 0' }}>Günlük {excelSet.title} Tüketimi</h3>
                                  <ResponsiveContainer width="100%" height={280}>
                                    <RechartsLine data={groupDataByDay(excelData)}>
                                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                      <XAxis 
                                        dataKey="gun" 
                                        angle={-45} 
                                        textAnchor="end" 
                                        height={60} 
                                        tick={{ fontSize: 10 }}
                                      />
                                      <YAxis tick={{ fontSize: 10 }} label={{ value: `Tüketim (${excelSet.type === 'aktif' ? 'kWh' : 'kVArh'})`, angle: -90, position: 'insideLeft', style: { fontSize: 10 } }} />
                                      <Tooltip 
                                        contentStyle={{ fontSize: '10px', backgroundColor: '#fff', border: '1px solid #ccc' }}
                                        formatter={(value) => [value.toFixed(2) + ` ${excelSet.type === 'aktif' ? 'kWh' : 'kVArh'}`, 'Tüketim']}
                                      />
                                      <Legend wrapperStyle={{ fontSize: '10px' }} />
                                      <Line type="monotone" dataKey="tuketim" stroke={excelSet.color} strokeWidth={2} dot={{ r: 3 }} name="Günlük Tüketim" />
                                    </RechartsLine>
                                  </ResponsiveContainer>
                                </div>

                                {/* 5 Satırlık Özet Tablo */}
                                <div style={{ marginTop: '8mm' }}>
                                  <h3 style={{ fontSize: '12px', fontWeight: 'bold', color: excelSet.color, margin: '0 0 3mm 0' }}>Detaylı İstatistik Tablosu</h3>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px', border: `2px solid ${excelSet.color}` }}>
                                    <thead>
                                      <tr style={{ backgroundColor: excelSet.color, color: 'white' }}>
                                        <th style={{ padding: '6px', textAlign: 'left', border: '1px solid #ddd', fontWeight: 'bold' }}>Parametre</th>
                                        <th style={{ padding: '6px', textAlign: 'right', border: '1px solid #ddd', fontWeight: 'bold' }}>Değer</th>
                                        <th style={{ padding: '6px', textAlign: 'left', border: '1px solid #ddd', fontWeight: 'bold' }}>Açıklama</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr style={{ backgroundColor: '#f8fafc' }}>
                                        <td style={{ padding: '6px', border: '1px solid #ddd', fontWeight: 'bold' }}>Toplam Tüketim</td>
                                        <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #ddd' }}>{excelData.reduce((sum, d) => sum + (d.tuketim || 0), 0).toFixed(2)} {excelSet.type === 'aktif' ? 'kWh' : 'kVArh'}</td>
                                        <td style={{ padding: '6px', border: '1px solid #ddd', fontSize: '8px' }}>Haftalık toplam {excelSet.title.toLowerCase()}</td>
                                      </tr>
                                      <tr style={{ backgroundColor: 'white' }}>
                                        <td style={{ padding: '6px', border: '1px solid #ddd', fontWeight: 'bold' }}>Günlük Ortalama</td>
                                        <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #ddd' }}>{(groupDataByDay(excelData).reduce((sum, d) => sum + (d.tuketim || 0), 0) / groupDataByDay(excelData).length).toFixed(2)} {excelSet.type === 'aktif' ? 'kWh' : 'kVArh'}</td>
                                        <td style={{ padding: '6px', border: '1px solid #ddd', fontSize: '8px' }}>Günlük ortalama tüketim</td>
                                      </tr>
                                      <tr style={{ backgroundColor: '#f8fafc' }}>
                                        <td style={{ padding: '6px', border: '1px solid #ddd', fontWeight: 'bold' }}>Max Günlük Tüketim</td>
                                        <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #ddd', color: '#dc2626', fontWeight: 'bold' }}>{Math.max(...groupDataByDay(excelData).map(d => d.tuketim || 0)).toFixed(2)} {excelSet.type === 'aktif' ? 'kWh' : 'kVArh'}</td>
                                        <td style={{ padding: '6px', border: '1px solid #ddd', fontSize: '8px' }}>En yüksek günlük tüketim</td>
                                      </tr>
                                      <tr style={{ backgroundColor: 'white' }}>
                                        <td style={{ padding: '6px', border: '1px solid #ddd', fontWeight: 'bold' }}>Min Günlük Tüketim</td>
                                        <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #ddd', color: '#16a34a' }}>{Math.min(...groupDataByDay(excelData).map(d => d.tuketim || 0)).toFixed(2)} {excelSet.type === 'aktif' ? 'kWh' : 'kVArh'}</td>
                                        <td style={{ padding: '6px', border: '1px solid #ddd', fontSize: '8px' }}>En düşük günlük tüketim</td>
                                      </tr>
                                      <tr style={{ backgroundColor: '#f8fafc' }}>
                                        <td style={{ padding: '6px', border: '1px solid #ddd', fontWeight: 'bold' }}>Gün Sayısı</td>
                                        <td style={{ padding: '6px', textAlign: 'right', border: '1px solid #ddd' }}>{groupDataByDay(excelData).length} gün</td>
                                        <td style={{ padding: '6px', border: '1px solid #ddd', fontSize: '8px' }}>Rapor dönemi gün sayısı (1 hafta = 7 gün)</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                              </div>

                              <div style={{ position: 'absolute', bottom: '8mm', left: '20mm', right: '20mm', paddingTop: '3mm', borderTop: `2px solid ${excelSet.color}` }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '8px', color: '#555' }}>
                                  <div style={{ flex: 1 }}>
                                    <p style={{ margin: '0', fontWeight: 'bold', fontSize: '9px' }}>VoltGuard</p>
                                    <p style={{ margin: '2px 0 0 0', lineHeight: '1.4' }}>Kemalpaşa OSB/İzmir</p>
                                    <p style={{ margin: '2px 0 0 0' }}>Tel: +90 545 434 67 35 | voltguard.com.tr</p>
                                  </div>
                                  <p style={{ margin: '0', fontWeight: 'bold', color: excelSet.color, fontSize: '9px' }}>Sayfa {currentPageNum}/{totalPages}</p>
                                </div>
                              </div>
                            </div>
                          );
                        } catch (e) {
                          console.error(`${excelSet.type} Excel data parse error:`, e);
                        }
                      }
                    });

                    // OSOS DETAY TABLOSU SAYFASI (varsa)
                    if (selectedRapor.osos_ozet_tablo) {
                      try {
                        const ososData = JSON.parse(selectedRapor.osos_ozet_tablo);
                        const excelPageCount = excelDataSets.filter(s => s.data).length;
                        const currentPageNum = 2 + excelPageCount + 1;
                        const totalPages = getPdfPageCount(selectedRapor);
                        
                        pages.push(
                          <div key="page-osos-table" className="haftalik-pdf-page shadow-xl" style={{ width: '210mm', height: '297mm', background: 'white', padding: '15mm 20mm 30mm 20mm', fontFamily: 'Arial, sans-serif', position: 'relative', boxSizing: 'border-box', overflow: 'hidden' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8mm', paddingBottom: '5mm', borderBottom: '2px solid #2980b9' }}>
                              <div style={{ width: '40mm', maxHeight: '20mm', display: 'flex', alignItems: 'center' }}>
                                <img src="/calisan/uygulama/fatura_logo.png" alt="Logo" style={{ maxWidth: '100%', maxHeight: '20mm', objectFit: 'contain' }} />
                              </div>
                              <div style={{ flex: 1, textAlign: 'right', paddingLeft: '10mm' }}>
                                <h2 style={{ fontSize: '16px', fontWeight: 'bold', margin: '0 0 5px 0', color: '#2c3e50' }}>OSOS ÖZET TABLO - DETAYLI ANALİZ</h2>
                                <p style={{ fontSize: '10px', color: '#e74c3c', margin: '0 0 3px 0', fontStyle: 'italic' }}>* Bu tablo ayın ilk gününden itibaren kümülatif (toplam) verileri göstermektedir</p>
                                <p style={{ fontSize: '11px', color: '#555', margin: '0' }}>{selectedRapor.fabrika_adi} - Hafta: {new Date(selectedRapor.hafta_baslangic).toLocaleDateString('tr-TR')} - {new Date(selectedRapor.hafta_bitis).toLocaleDateString('tr-TR')}</p>
                              </div>
                            </div>

                            <div style={{ height: '240mm', overflow: 'hidden' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8px', marginTop: '5mm' }}>
                                <thead>
                                  <tr style={{ backgroundColor: '#2980b9', color: 'white' }}>
                                    <th style={{ border: '1px solid #ddd', padding: '6px', textAlign: 'left', fontWeight: 'bold' }}>Endeks Kodu</th>
                                    <th style={{ border: '1px solid #ddd', padding: '6px', textAlign: 'left', fontWeight: 'bold' }}>Açıklama</th>
                                    <th style={{ border: '1px solid #ddd', padding: '6px', textAlign: 'right', fontWeight: 'bold' }}>İlk Endeks</th>
                                    <th style={{ border: '1px solid #ddd', padding: '6px', textAlign: 'right', fontWeight: 'bold' }}>Son Endeks</th>
                                    <th style={{ border: '1px solid #ddd', padding: '6px', textAlign: 'right', fontWeight: 'bold' }}>Endeks Farkı</th>
                                    <th style={{ border: '1px solid #ddd', padding: '6px', textAlign: 'right', fontWeight: 'bold' }}>Çarpan</th>
                                    <th style={{ border: '1px solid #ddd', padding: '6px', textAlign: 'right', fontWeight: 'bold' }}>Tüketim</th>
                                    <th style={{ border: '1px solid #ddd', padding: '6px', textAlign: 'center', fontWeight: 'bold' }}>Yasal Sınır</th>
                                    <th style={{ border: '1px solid #ddd', padding: '6px', textAlign: 'center', fontWeight: 'bold' }}>Durum</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {ososData.map((row, index) => {
                                    // Önemli satırları vurgula
                                    const isImportant = ['1.8.0', '5.8.0', '8.8.0', '2.8.0'].includes(row.endeks_kodu);
                                    const bgColor = isImportant ? '#e8f4f8' : 'white';
                                    const fontWeight = isImportant ? 'bold' : 'normal';
                                    
                                    return (
                                      <tr key={index} style={{ backgroundColor: bgColor }}>
                                        <td style={{ border: '1px solid #ddd', padding: '5px', fontWeight }}>{row.endeks_kodu}</td>
                                        <td style={{ border: '1px solid #ddd', padding: '5px', fontSize: '7px' }}>{row.aciklama}</td>
                                        <td style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'right' }}>{row.ilk_endeks?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                                        <td style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'right' }}>{row.son_endeks?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                                        <td style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'right' }}>{row.endeks_farki?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                                        <td style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'right' }}>{row.carpan?.toLocaleString('tr-TR')}</td>
                                        <td style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'right', fontWeight }}>{row.tuketim?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                                        <td style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'center', fontSize: '7px' }}>{row.yasal_sinir || '-'}</td>
                                        <td style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'center', fontSize: '7px', color: row.durum?.includes('AŞILDI') ? '#c0392b' : '#27ae60', fontWeight: row.durum?.includes('AŞILDI') ? 'bold' : 'normal' }}>{row.durum || '-'}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>

                              <div style={{ marginTop: '8mm', padding: '8px', background: '#f0f9ff', border: '1px solid #2980b9', borderRadius: '4px' }}>
                                <h3 style={{ fontSize: '11px', fontWeight: 'bold', color: '#2980b9', margin: '0 0 5px 0' }}>Tablo Açıklamaları</h3>
                                <div style={{ fontSize: '8px', lineHeight: '1.6', color: '#2c3e50' }}>
                                  <p style={{ margin: '3px 0' }}><strong>1.8.0 (Aktif Çekilen):</strong> Tesiste tüketilen toplam aktif enerji (kWh)</p>
                                  <p style={{ margin: '3px 0' }}><strong>5.8.0 (Endüktif Reaktif Çekilen):</strong> İndüktif yüklerden kaynaklanan reaktif enerji (kVArh) - Kompanzasyon gerektirir</p>
                                  <p style={{ margin: '3px 0' }}><strong>8.8.0 (Kapasitif Reaktif Çekilen):</strong> Kapasitif yüklerden veya aşırı kompanzasyondan kaynaklanan reaktif enerji (kVArh)</p>
                                  <p style={{ margin: '3px 0' }}><strong>2.8.0 (Aktif Verilen):</strong> Şebekeye verilen enerji (varsa)</p>
                                  <p style={{ margin: '3px 0' }}><strong>Yasal Sınır:</strong> Reaktif enerjinin aktif enerjiye oranı için %20 yasal limit (EPDK)</p>
                                </div>
                              </div>
                            </div>

                            <div style={{ position: 'absolute', bottom: '8mm', left: '20mm', right: '20mm', paddingTop: '3mm', borderTop: '2px solid #2980b9' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '8px', color: '#555' }}>
                                <div style={{ flex: 1 }}>
                                  <p style={{ margin: '0', fontWeight: 'bold', fontSize: '9px' }}>VoltGuard</p>
                                  <p style={{ margin: '2px 0 0 0', lineHeight: '1.4' }}>Kemalpaşa OSB/İzmir</p>
                                  <p style={{ margin: '2px 0 0 0' }}>Tel: +90 545 434 67 35 | voltguard.com.tr</p>
                                </div>
                                <p style={{ margin: '0', fontWeight: 'bold', color: '#2980b9', fontSize: '9px' }}>Sayfa {currentPageNum}/{totalPages}</p>
                              </div>
                            </div>
                          </div>
                        );
                      } catch (e) {
                        console.error('OSOS tablo parse hatası:', e);
                      }
                    }

                    // SON SAYFA: Görsel (varsa)
                    if (selectedRapor.gorsel_url) {
                      const excelPageCount = excelDataSets.filter(s => s.data).length;
                      const hasOsosTable = selectedRapor.osos_ozet_tablo ? 1 : 0;
                      const currentPageNum = 2 + excelPageCount + hasOsosTable + 1;
                      const totalPages = getPdfPageCount(selectedRapor);
                      
                      pages.push(
                        <div key="page-image" className="haftalik-pdf-page shadow-xl" style={{ width: '210mm', height: '297mm', background: 'white', padding: '15mm 20mm 30mm 20mm', fontFamily: 'Arial, sans-serif', position: 'relative', boxSizing: 'border-box', overflow: 'hidden' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10mm', paddingBottom: '5mm', borderBottom: '2px solid #2980b9' }}>
                            <div style={{ width: '40mm', maxHeight: '20mm', display: 'flex', alignItems: 'center' }}>
                              <img src="/calisan/uygulama/fatura_logo.png" alt="Logo" style={{ maxWidth: '100%', maxHeight: '20mm', objectFit: 'contain' }} />
                            </div>
                            <div style={{ flex: 1, textAlign: 'right', paddingLeft: '10mm' }}>
                              <h2 style={{ fontSize: '16px', fontWeight: 'bold', margin: '0 0 5px 0', color: '#2c3e50' }}>SAHA GÖRSELİ / TEKNİK FOTOĞRAF</h2>
                              <p style={{ fontSize: '11px', color: '#555', margin: '0' }}>{selectedRapor.fabrika_adi}</p>
                            </div>
                          </div>

                          <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '10px', background: '#f8fafc', textAlign: 'center' }}>
                            <img src={selectedRapor.gorsel_url} alt="Saha Görseli" style={{ maxWidth: '100%', maxHeight: '220mm', objectFit: 'contain' }} />
                          </div>

                          <div style={{ position: 'absolute', bottom: '8mm', left: '20mm', right: '20mm', paddingTop: '3mm', borderTop: '2px solid #2980b9' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '8px', color: '#555' }}>
                              <div style={{ flex: 1 }}>
                                <p style={{ margin: '0', fontWeight: 'bold', fontSize: '9px' }}>VoltGuard</p>
                                <p style={{ margin: '2px 0 0 0', lineHeight: '1.4' }}>Kemalpaşa OSB/İzmir</p>
                                <p style={{ margin: '2px 0 0 0' }}>Tel: +90 545 434 67 35 | voltguard.com.tr</p>
                              </div>
                              <p style={{ margin: '0', fontWeight: 'bold', color: '#2980b9', fontSize: '9px' }}>Sayfa {currentPageNum}/{totalPages}</p>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return pages;
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

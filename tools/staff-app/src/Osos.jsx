import { privateStorage as localStorage } from './privateStorage';
import * as XLSX from 'xlsx';
import React, { useState, useEffect, useRef } from 'react';
import { Printer, FileText, Save, RotateCcw, Edit3, Download, Zap, AlertTriangle, CheckCircle, Upload, X, Activity } from 'lucide-react';
import { createReportPDF, fitReportImage, writeReportParagraph, reportFileName, reportDate, reportNumber, reportDecimal } from './pdfReport';
import { buildEnergyHTMLReport } from './energyReport.mjs';
import OsosCanliIzleme from './OsosCanliIzleme.jsx';
import { supabase } from './supabaseClient';
import { loadCompanyDocuments, saveCompanyDocument, deleteCompanyDocument } from './companyDocuments';
import { parseDecimal, detectEnergyType, prepareEnergyRows, localISODate, parseImportDate, directOsosMeasurements, sanitizeLegacyEnergyReport } from './operations.mjs';

// KOSBI/OSOS yardimci sunucusu: varsayilan olarak sitenin kendi adresi (sunucuda /api/kosbi -> kosbi-proxy)
const KOSBI_API = ''; // External connections are explicitly disabled for this rollout.
const KOSBI_ENABLED = false;
const WORKTRACKER_ENABLED = false;

const measurementTemplates = [
    { id: 1, parametre: "Aktif Güç", deger: "", birim: "kW", referans: "Anlık tüketim", durum: "Değerlendirilmedi" },
    { id: 2, parametre: "Reaktif Güç", deger: "", birim: "kVAr", referans: "İndüktif yük", durum: "Değerlendirilmedi" },
    { id: 3, parametre: "Görünür Güç", deger: "", birim: "kVA", referans: "Toplam güç", durum: "Değerlendirilmedi" },
    { id: 4, parametre: "Gerilim (L1-N)", deger: "", birim: "V", referans: "230 V nominal", durum: "Değerlendirilmedi" },
    { id: 5, parametre: "Gerilim (L2-N)", deger: "", birim: "V", referans: "230 V nominal", durum: "Değerlendirilmedi" },
    { id: 6, parametre: "Gerilim (L3-N)", deger: "", birim: "V", referans: "230 V nominal", durum: "Değerlendirilmedi" },
    { id: 7, parametre: "Akım (L1)", deger: "", birim: "A", referans: "Maks akım", durum: "Değerlendirilmedi" },
    { id: 8, parametre: "Akım (L2)", deger: "", birim: "A", referans: "Maks akım", durum: "Değerlendirilmedi" },
    { id: 9, parametre: "Akım (L3)", deger: "", birim: "A", referans: "Maks akım", durum: "Değerlendirilmedi" },
    { id: 10, parametre: "Güç Faktörü (cos φ)", deger: "", birim: "--", referans: ">0.85", durum: "Değerlendirilmedi" },
    { id: 11, parametre: "Frekans", deger: "", birim: "Hz", referans: "50±0.5Hz", durum: "Değerlendirilmedi" },
    { id: 12, parametre: "Toplam Enerji (T0)", deger: "", birim: "kWh", referans: "Kümülatif", durum: "Değerlendirilmedi" }
];

export default function Osos() {
  const [ososTab, setOsosTab] = useState('rapor'); // 'rapor' veya 'canli'
  const [printMode, setPrintMode] = useState(false);
  const [editMode, setEditMode] = useState(true);
  const [logo, setLogo] = useState("/calisan/uygulama/fatura_logo.png");
  const [logoInputUrl, setLogoInputUrl] = useState("/calisan/uygulama/fatura_logo.png");
  const reportRef = useRef(null);
  
  // Rapor Kaydetme
  const [kaydedilenRaporlar, setKaydedilenRaporlar] = useState([]);
  const [showKayitliRaporlar, setShowKayitliRaporlar] = useState(false);
  const savedReportRef = useRef(null);
  const reportSaveBusy = useRef(false);
  const factoryLoadVersion=useRef(0);
  const [companyDataError,setCompanyDataError] = useState('');
  const [legacyReportsAvailable] = useState(() => Boolean(localStorage.getItem('osos_raporlar')));
  
  // KOSBI Login State
  const [showKosbiModal, setShowKosbiModal] = useState(false);
  const [kosbiUsers, setKosbiUsers] = useState([]);
  const [selectedKosbiUser, setSelectedKosbiUser] = useState(null);
  const [isLoadingKosbi, setIsLoadingKosbi] = useState(false);
  const [kosbiData, setKosbiData] = useState([]);
  
  // Excel Import State
  const [showExcelImportModal, setShowExcelImportModal] = useState(false);
  const [excelData, setExcelData] = useState([]);
  const [excelFileName, setExcelFileName] = useState('');
  
  // Fabrika Veri Yönetimi
  const [fabrikaVerileri, setFabrikaVerileri] = useState([]);
  const [secilenFabrika, setSecilenFabrika] = useState(null);
  const [showFabrikaModal, setShowFabrikaModal] = useState(false);
  
  // Enerji Tipi Seçimi
  const [showEnerjiTipiModal, setShowEnerjiTipiModal] = useState(false);
  const [bekleyenVeri, setBekleyenVeri] = useState(null);
  const [secilenEnerjiTipi, setSecilenEnerjiTipi] = useState('auto');
  
  // WorkTracker Entegrasyonu
  const [showWorkTrackerModal, setShowWorkTrackerModal] = useState(false);
  const [workTrackerConfig, setWorkTrackerConfig] = useState({
    url: '',
    email: '',
    password: ''
  });
  const [workTrackerToken, setWorkTrackerToken] = useState(null);
  const [workTrackerUsers, setWorkTrackerUsers] = useState([]);
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    priority: 'MEDIUM',
    assignedToId: '',
    dueDate: ''
  });
  const [isLoadingWorkTracker, setIsLoadingWorkTracker] = useState(false);
  
  // Form verileri
  const [formData, setFormData] = useState({
    firmaAdi: "",
    raporNo: "",
    raporTarihi: localISODate(),
    adres: "",
    yetkili: "",
    telefon: "",
    email: "",
    vergiNo: "",
    kontrolEdenAd: "",
    kontrolEdenUnvan: "",
    kontrolEdenOdaNo: "",
    kontrolTarihi: localISODate(),
    sonrakiKontrolTarihi: "",
    tesisGucuKW: "",
    calisanSayisi: "",
    aciklama: "",
    tespit: "",
    oneri: "",
    sonuc: "Değerlendirilmedi"
  });

  // OSOS Otomatik Veri Analizi
  const [measurements,setMeasurements]=useState(() => measurementTemplates.map(item=>({...item})));
  
  // Enerji Tipi Verileri
  const [aktifEnerji, setAktifEnerji] = useState([]);
  const [induktifEnerji, setInduktifEnerji] = useState([]);
  const [kapasitifEnerji, setKapasitifEnerji] = useState([]);
  
  // Görsel mod
  const [showCharts, setShowCharts] = useState(false);

  const downloadMeasurementTemplate = () => {
    const rows=[{sayac_no:'',olcum_zamani:'',aktif_guc:null,reaktif_guc:null,kapasitif_guc:null,gorunen_guc:null,gerilim_l1:null,gerilim_l2:null,gerilim_l3:null,akim_l1:null,akim_l2:null,akim_l3:null,guc_faktoru:null,frekans:null,toplam_enerji:null}];
    const url=URL.createObjectURL(new Blob([JSON.stringify(rows,null,2)],{type:'application/json;charset=utf-8'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download='VoltGuard-OSOS-olcum-sablonu.json';document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleMeasurementChange = (id, field, value) => {
    setMeasurements(prev => prev.map(m => 
      m.id === id ? { ...m, [field]: value } : m
    ));
  };

  const addMeasurement = () => {
    const newId = measurements.length > 0 ? Math.max(...measurements.map(m => m.id)) + 1 : 1;
    setMeasurements([...measurements, {
      id: newId,
      parametre: "",
      deger: "",
      birim: "",
      referans: "",
      durum: "Değerlendirilmedi"
    }]);
  };

  const removeMeasurement = (id) => {
    if (measurements.length > 1) {
      setMeasurements(prev => prev.filter(m => m.id !== id));
    }
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setLogo(event.target.result);
        setLogoInputUrl(event.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLogoUrlChange = () => {
    if (logoInputUrl && logoInputUrl.trim() !== '') {
      setLogo(logoInputUrl);
      alert('Logo güncellendi.');
    } else {
      alert('⚠️ Geçerli bir URL giriniz!');
    }
  };

  const removeLogo = () => {
    setLogo("/calisan/uygulama/fatura_logo.png");
    setLogoInputUrl("/calisan/uygulama/fatura_logo.png");
  };

  const loadSharedFactories = async () => {
    const version=++factoryLoadVersion.current;
    const rows=await loadCompanyDocuments('osos_fabrika');
    if(version!==factoryLoadVersion.current)return;
    setFabrikaVerileri(rows.map(row=>({...row.payload,id:row.record_id,_revision:row.revision})));
  };
  useEffect(()=>{loadSharedFactories().catch(error=>setCompanyDataError(error.message));},[]);
  const loadSharedReports = async () => {
    const rows=await loadCompanyDocuments('osos_rapor');
    setKaydedilenRaporlar(rows.map(row=>({...row.payload,id:row.record_id,_revision:row.revision})));return rows;
  };
  const raporuKaydet = async () => {
    if(reportSaveBusy.current)return;
    if(!formData.firmaAdi?.trim()||(!aktifEnerji.length&&!induktifEnerji.length&&!kapasitifEnerji.length&&!measurements.some(item=>item.deger!==''&&item.deger!=null))){alert('Firma adı ve gerçek ölçüm/enerji verisi gereklidir.');return;}
    reportSaveBusy.current=true;
    try {
      const current=savedReportRef.current||{id:crypto.randomUUID(),revision:null};savedReportRef.current=current;
      const payload={id:current.id,tarih:new Date().toISOString(),firmaAdi:formData.firmaAdi,formData:{...formData},fabrikaVerileri:[...fabrikaVerileri],aktifEnerji,induktifEnerji,kapasitifEnerji,measurements:[...measurements],logo};
      const saved=await saveCompanyDocument('osos_rapor',current.id,payload,current.revision);savedReportRef.current={id:saved.record_id,revision:saved.revision};
      let refreshed=true;try{await loadSharedReports();setCompanyDataError('');}catch(error){refreshed=false;setCompanyDataError(error.message);}
      alert(refreshed?'Rapor şirket sunucusuna kaydedildi.':'Rapor sunucuya kaydedildi; liste yenilenemedi. Rapor listesini yeniden açın.');
    }catch(error){setCompanyDataError(error.message);alert('Rapor kaydedilemedi: '+error.message+'. Formunuz korunuyor; güncel kaydı yeniden açın.');}
    finally{reportSaveBusy.current=false;}
  };
  const raporlariYukle = async () => {
    try{await loadSharedReports();setCompanyDataError('');setShowKayitliRaporlar(true);}catch(error){setCompanyDataError(error.message);alert('Raporlar yüklenemedi: '+error.message);}
  };
  const kayitliRaporuAc = rapor => {
    if(reportSaveBusy.current){alert('Kaydetme tamamlanana kadar mevcut raporu koruyun.');return;}
    if(!rapor.formData||!Array.isArray(rapor.measurements)){alert('Rapor içeriği geçersiz.');return;}
    setFormData(rapor.formData);setMeasurements(rapor.measurements);setLogo(rapor.logo);setLogoInputUrl(rapor.logo);
    const factory=rapor.fabrikaVerileri?.[0];setSecilenFabrika(factory||null);
    setAktifEnerji(rapor.aktifEnerji||factory?.aktifEnerji||[]);setInduktifEnerji(rapor.induktifEnerji||factory?.induktifEnerji||[]);setKapasitifEnerji(rapor.kapasitifEnerji||factory?.kapasitifEnerji||[]);
    savedReportRef.current={id:rapor.id,revision:rapor._revision};setShowKayitliRaporlar(false);
  };
  const kayitliRaporuSil = async id => {
    if(!confirm('Bu şirket raporunu sunucudan silmek istiyor musunuz?'))return;
    try{const record=kaydedilenRaporlar.find(item=>item.id===id);await deleteCompanyDocument('osos_rapor',id,record?._revision);await loadSharedReports();if(savedReportRef.current?.id===id)savedReportRef.current=null;alert('Rapor silindi.');}
    catch(error){alert('Rapor silinemedi: '+error.message+'. Listeyi yenileyin.');}
  };
  const importLegacyReports = async () => {
    try{
      const records=JSON.parse(localStorage.getItem('osos_raporlar')||'[]');if(!Array.isArray(records))throw new Error('Eski rapor biçimi geçersiz.');
      const existing=await loadSharedReports(),ids=new Set(existing.map(row=>String(row.record_id)));let imported=0,failed=0;
      for(const record of records){if(ids.has(String(record.id)))continue;try{if(!record.formData||!Array.isArray(record.measurements))throw new Error('Geçersiz rapor');await saveCompanyDocument('osos_rapor',String(record.id||crypto.randomUUID()),sanitizeLegacyEnergyReport(record),null);imported++;}catch{failed++;}}
      await loadSharedReports();setShowKayitliRaporlar(true);alert(`${imported} rapor aktarıldı. ${failed} rapor aktarılamadı. Mevcut sunucu kayıtları üzerine yazılmadı; eski tarayıcı kopyaları korundu.`);
    }catch(error){alert('Aktarım tamamlanamadı: '+error.message);}
  };

  const printReport = () => {
    setPrintMode(true);
    setTimeout(() => {
      window.print();
      setPrintMode(false);
    }, 100);
  };

  const exportPDF = async () => {
    if (!formData.firmaAdi?.trim()) { alert('Rapor için firma adı gereklidir.'); return; }
    const measured = measurements.filter(m => m.deger !== '' && m.deger !== null && m.deger !== undefined);
    if (!measured.length && !aktifEnerji.length && !induktifEnerji.length && !kapasitifEnerji.length && !formData.tespit?.trim() && !formData.aciklama?.trim()) {
      alert('Rapor için ölçüm, enerji verisi veya açıklama ekleyin.'); return;
    }
    try {
      const pdf = await createReportPDF({ title: 'Otomatik Sayaç Okuma Sistemi Raporu' });
      pdf.setFontSize(18); pdf.setFont(undefined, 'bold'); pdf.setTextColor(24, 57, 95);
      pdf.text('OSOS ENERJİ RAPORU', 105, 22, { align: 'center' });
      pdf.setFont(undefined, 'normal'); pdf.setFontSize(9); pdf.setTextColor(50);
      pdf.text('Otomatik Sayaç Okuma Sistemi - Kaydedilmiş veriler', 105, 30, { align: 'center' });
      const metadata = [
        ['Firma', formData.firmaAdi], ['Rapor no', formData.raporNo || 'Belirtilmedi'], ['Rapor tarihi', reportDate(formData.raporTarihi)],
        ['Adres', formData.adres], ['Yetkili', formData.yetkili], ['Telefon', formData.telefon], ['E-posta', formData.email],
        ['Vergi no', formData.vergiNo], ['Kontrolü yapan', formData.kontrolEdenAd], ['Unvan', formData.kontrolEdenUnvan],
        ['Oda sicil no', formData.kontrolEdenOdaNo], ['Kontrol tarihi', reportDate(formData.kontrolTarihi)],
        ['Sonraki kontrol', formData.sonrakiKontrolTarihi ? reportDate(formData.sonrakiKontrolTarihi) : 'Belirtilmedi'],
        ['Tesis gücü', formData.tesisGucuKW ? `${formData.tesisGucuKW} kW` : 'Belirtilmedi']
      ].filter(row => row[1]);
      pdf.autoTable({ startY: 38, head: [['Rapor bilgisi', 'Değer']], body: metadata, theme: 'grid', columnStyles: { 0: { cellWidth: 45 } } });
      if (measured.length) {
        pdf.autoTable({ startY: pdf.lastAutoTable.finalY + 8,
          head: [['Ölçüm noktası', 'Parametre', 'Değer', 'Birim', 'Referans', 'Kaydedilmiş durum']],
          body: measured.map(m => [m.olcumNoktasi || '', m.parametre || '', String(m.deger), m.birim || '', m.referans ?? m.limit ?? '', m.durum ?? m.sonuc ?? 'Belirtilmedi']),
          styles: { fontSize: 8 }, theme: 'striped' });
      }
      for (const [label, unit, rows] of [['Aktif enerji', 'kWh', aktifEnerji], ['İndüktif reaktif enerji', 'kVArh', induktifEnerji], ['Kapasitif reaktif enerji', 'kVArh', kapasitifEnerji]]) {
        if (!rows.length) continue;
        pdf.addPage(); pdf.setFont(undefined, 'bold'); pdf.setFontSize(13); pdf.setTextColor(24, 57, 95);
        pdf.text(`${label} (${unit})`, 14, 22);
        const knownRows = rows.filter(item => Number.isFinite(reportDecimal(item.tuketim)));
        const missing = rows.length - knownRows.length;
        pdf.autoTable({ startY: 30, head: [['Tarih', `Tüketim (${unit})`, 'Endeks', 'Çarpan', 'Kaydedilmiş durum']],
          body: rows.map(item => [item.tarih || 'Belirtilmedi', reportNumber(item.tuketim), reportNumber(item.endeks), reportNumber(item.carpan, 3), item.sonuc || 'Belirtilmedi']),
          foot: [[missing ? 'SAYISAL KAYIT TOPLAMI' : 'TOPLAM', reportNumber(knownRows.reduce((sum, item) => sum + reportDecimal(item.tuketim), 0)), '', '', missing ? `${missing} kayıtta tüketim eksik` : `${rows.length} kayıt`]],
          columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } }, theme: 'striped' });
      }
      pdf.setFont(undefined, 'normal'); pdf.setFontSize(9); pdf.setTextColor(40);
      let y = pdf.lastAutoTable.finalY + 9;
      for (const [label, value] of [['Açıklama', formData.aciklama], ['Tespitler', formData.tespit], ['Değerlendirme', formData.degerlendirme], ['Öneriler', formData.oneri]]) {
        if (!value?.trim()) continue;
        y = writeReportParagraph(pdf, `${label}: ${value}`, { y, lineHeight: 5 }) + 5;
      }
      writeReportParagraph(pdf, 'Bu rapor girilen ve içe aktarılan kayıtları gösterir. Boş ölçümlere değer veya uygunluk sonucu üretilmez. Kaynak ve dönem bilgileri ölçüm kayıtlarıyla doğrulanmalıdır.', { y, lineHeight: 4 });
      pdf.save(reportFileName('OSOS_Rapor', formData.raporNo || formData.firmaAdi));
    } catch (error) { alert('PDF oluşturulamadı: ' + error.message); }
  };

  const resetForm = () => {
    if(reportSaveBusy.current){alert('Kaydetme işleminin tamamlanmasını bekleyin.');return;}
    if (confirm('Tüm verileri sıfırlamak istediğinizden emin misiniz?')) {
      savedReportRef.current=null;
      setFormData({
        firmaAdi: "",
        raporNo: "",
        raporTarihi: localISODate(),
        adres: "",
        yetkili: "",
        telefon: "",
        email: "",
        vergiNo: "",
        kontrolEdenAd: "",
        kontrolEdenUnvan: "",
        kontrolEdenOdaNo: "",
        kontrolTarihi: localISODate(),
        sonrakiKontrolTarihi: "",
        tesisGucuKW: "",
        calisanSayisi: "",
        aciklama: "",
        tespit: "",
        oneri: "",
        sonuc: "Değerlendirilmedi"
      });
      setMeasurements(measurementTemplates.map(item=>({...item})));
      setAktifEnerji([]);setInduktifEnerji([]);setKapasitifEnerji([]);setSecilenFabrika(null);
      setExcelData([]);setBekleyenVeri(null);setSecilenEnerjiTipi('auto');setExcelFileName('');setShowEnerjiTipiModal(false);
      setLogo(null);
    }
  };

  // KOSBI kullanıcı ekle/düzenle
  const addKosbiUser = () => { alert('Harici canlı bağlantılar şimdilik kapalı. Dosya içe aktarma ve kayıtlı raporlar kullanılabilir.'); };

  const removeKosbiUser = (id) => {
    if (confirm('Bu kullanıcıyı silmek istediğinizden emin misiniz?')) {
      setKosbiUsers(prev => prev.filter(u => u.id !== id));
    }
  };

  // KOSBI'den veri çekme
  const fetchKosbiData = async (user) => { alert('Harici canlı bağlantılar şimdilik kapalı. Dosya içe aktarma ve kayıtlı raporlar kullanılabilir.'); };

  // KOSBI verisini measurements'a aktar
  const importKosbiData = () => {
    if (kosbiData.length === 0) {
      alert('⚠️ Önce KOSBI\'den veri çekin!');
      return;
    }

    const newMeasurements = kosbiData.map((data, idx) => ({
      id: measurements.length + idx + 1,
      olcumNoktasi: data.ad || `Sayaç ${data.sayacNo}`,
      parametre: "Çekilen Enerji",
      deger: data.cekilen,
      birim: "kWh",
      limit: "-",
      sonuc: "Değerlendirilmedi"
    }));

    setMeasurements([...measurements, ...newMeasurements]);
    setShowKosbiModal(false);
    alert(`${newMeasurements.length} sayaç verisi ölçüm tablosuna eklendi.`);
  };

  // Excel/JSON Import - Geliştirilmiş
  const handleExcelImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setExcelFileName(file.name);
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const isExcel = /\.xlsx?$/i.test(file.name);
        const jsonData = isExcel ? (() => {
          const workbook = XLSX.read(e.target.result, { type:'array', cellDates:false });
          if (!workbook.SheetNames.length) throw new Error('Excel çalışma sayfası bulunamadı.');
          return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval:'', raw:true }).map(row => {
            const dateKey = Object.keys(row).find(key => key.trim().toLocaleLowerCase('tr-TR') === 'tarih');
            if (dateKey && typeof row[dateKey] === 'number') {
              const date = parseImportDate(row[dateKey]);
              if (!date) throw new Error('Excel tarih hücresi geçersiz.');
              row[dateKey] = localISODate(date) + ' ' + [date.getHours(),date.getMinutes(),date.getSeconds()].map(value => String(value).padStart(2,'0')).join(':');
            }
            return row;
          });
        })() : JSON.parse(e.target.result);
        
        // Veri formatını doğrula
        if (!Array.isArray(jsonData) || jsonData.length === 0) {
          alert('⚠️ Geçersiz veri formatı! Dizi içeren bir JSON bekleniyor.');
          return;
        }
        
        // OSOS veri formatını kontrol et
        const firstRow = jsonData[0];
        
        // Format 1: KOSBI/OSOS Portal JSON formatı
        const hasKOSBIFormat = firstRow && typeof firstRow === 'object' && !Array.isArray(firstRow) && firstRow.hasOwnProperty("Tarih") && 
                              firstRow.hasOwnProperty("Tüketim ()") && 
                              firstRow.hasOwnProperty("Çarpan");
        
        // Format 2: Doğrudan OSOS ölçüm verisi formatı
        const hasDirectOSOSFormat = ['aktif_guc','reaktif_guc','kapasitif_guc','gorunen_guc','gerilim_l1','gerilim_l2','gerilim_l3','akim_l1','akim_l2','akim_l3','guc_faktoru','frekans','toplam_enerji','gerilim','akim','enerji','sayac_no'].some(key => Object.prototype.hasOwnProperty.call(firstRow,key));

        if (hasDirectOSOSFormat) {
          // Doğrudan OSOS ölçüm formatı - Supabase'e kaydet
          await saveDirectOSOSData(jsonData, file.name);
          return;
        }
        
        if (!hasKOSBIFormat) {
          alert('⚠️ OSOS veri formatı algılanamadı!\n\nBeklenen formatlar:\n' +
                '1) KOSBI/Portal: Tarih, Tüketim (), Çarpan\n' +
                '2) OSOS Ölçüm: aktif_guc, gerilim_l1, sayac_no');
          return;
        }
        
        // Enerji tipini otomatik tespit et
        const toplamTuketim = jsonData.reduce((sum, row) => {
          const value = parseDecimal(row["Tüketim ()"], null);
          if (value === null || value < 0) throw new Error("Dosyada geçersiz tüketim değeri var.");
          return sum + value;
        }, 0);
        const tahminEdilenTip = detectEnergyType(jsonData);
        
        setExcelData(jsonData);
        setBekleyenVeri({ jsonData, dosyaAdi: file.name, tahminEdilenTip, toplamTuketim });
        setShowEnerjiTipiModal(true);
      } catch (error) {
        alert('Dosya okunamadı:\n' + error.message);
      }
    };
    
    if (/\.xlsx?$/i.test(file.name)) reader.readAsArrayBuffer(file); else reader.readAsText(file);
  };

  // Doğrudan OSOS ölçüm verilerini Supabase'e kaydet
  const saveDirectOSOSData = async (jsonData, fileName) => {
    try {
      const fabrikaAdi = prompt('Fabrika/Tesis Adı:', formData.firmaAdi || 'Yeni Tesis');
      if (!fabrikaAdi) return;

      const records = directOsosMeasurements(jsonData, fabrikaAdi);
      const { error } = await supabase.from('osos_olcumler').insert(records);
      if (error) throw error;
      alert(`${records.length} gerçek ölçüm kaydedildi. Tesis: ${fabrikaAdi}`);
      setOsosTab('canli');
    } catch (error) {
      alert('Ölçümler kaydedilemedi: ' + error.message + '. Hiçbir tahmini değer oluşturulmadı.');
    }
  };

  const importExcelData = async () => {
    if (!bekleyenVeri) {
      alert('⚠️ Önce Excel veya JSON dosyası yükleyin!');
      return;
    }

    const { jsonData, dosyaAdi, tahminEdilenTip } = bekleyenVeri;
    
    // Fabrika adını kullanıcıdan al
    const fabrikaAdi = prompt('Fabrika Adı:', formData.firmaAdi || 'Yeni Fabrika');
    if (!fabrikaAdi) return;

    // Seçilen veya otomatik tespit edilen enerji tipine göre işle
    const enerjiTipi = secilenEnerjiTipi === 'auto' ? tahminEdilenTip : secilenEnerjiTipi;
    if (!enerjiTipi) { alert('Enerji tipi dosyadaki OBIS kodundan belirlenemedi. Aktif, endüktif veya kapasitif seçimini sayaç kaynağınıza göre yapın.'); return; }
    
    // Verileri enerji tipine göre işle
    let prepared;
    try { prepared = prepareEnergyRows(jsonData, enerjiTipi); }
    catch (error) { alert(error.message); return; }
    const { aktifData, induktifData, kapasitifData, istatistikler } = prepared;
    
    const baslangicTarihi = jsonData[0]["Tarih"] || jsonData[0]["Tarih2"];
    const bitisTarihi = jsonData[jsonData.length - 1]["Tarih"] || jsonData[jsonData.length - 1]["Tarih2"];
    
    // Fabrika verisini kaydet
    const yeniFabrikaVerisi = {
      id: crypto.randomUUID(),
      fabrikaAdi,
      dosyaAdi,
      enerjiTipi,
      yuklemeTarihi: new Date().toISOString(),
      baslangicTarihi,
      bitisTarihi,
      veriSayisi: jsonData.length,
      istatistikler,
      aktifEnerji: aktifData,
      induktifEnerji: induktifData,
      kapasitifEnerji: kapasitifData,
      hamVeri: jsonData
    };
    
    // Fabrika verilerini güncelle
    try {
      const saved = await saveCompanyDocument('osos_fabrika',yeniFabrikaVerisi.id,yeniFabrikaVerisi,null);
      factoryLoadVersion.current++;
      setFabrikaVerileri(prev => [...prev,{...yeniFabrikaVerisi,_revision:saved.revision}]);
    } catch(error) { alert('Fabrika verisi kaydedilemedi: '+error.message+'. İçe aktarım formu korunuyor.');return; }
    
    // Mevcut rapora yükle
    setAktifEnerji(aktifData);
    setInduktifEnerji(induktifData);
    setKapasitifEnerji(kapasitifData);
    
    // Firma adını güncelle
    if (!formData.firmaAdi) {
      setFormData(prev => ({ ...prev, firmaAdi: fabrikaAdi }));
    }
    
    setShowEnerjiTipiModal(false);
    setBekleyenVeri(null);
    setSecilenEnerjiTipi('auto');
    
    alert(`✅ ${fabrikaAdi} için veri aktarıldı!\n\n` +
          `⚡ Enerji Tipi: ${enerjiTipi.toUpperCase()}\n` +
          `📊 Veri Sayısı: ${jsonData.length}\n` +
          `📅 Tarih Aralığı: ${baslangicTarihi} - ${bitisTarihi}\n` +
          `⚡ Toplam Tüketim: ${istatistikler.toplamTuketim} ${enerjiTipi === 'aktif' ? 'kWh' : 'kVArh'}\n` +
          `📈 Ortalama: ${istatistikler.ortalamaTuketim} ${enerjiTipi === 'aktif' ? 'kWh' : 'kVArh'}\n` +
          `🔝 Max: ${istatistikler.maxTuketim} ${enerjiTipi === 'aktif' ? 'kWh' : 'kVArh'}`);
  };



  // WorkTracker Login
  const loginToWorkTracker = async () => { alert('Harici canlı bağlantılar şimdilik kapalı. Dosya içe aktarma ve kayıtlı raporlar kullanılabilir.'); };

  // WorkTracker kullanıcılarını çek
  const fetchWorkTrackerUsers = async (token) => { alert('Harici canlı bağlantılar şimdilik kapalı. Dosya içe aktarma ve kayıtlı raporlar kullanılabilir.'); };

  // Fabrika Yönetimi Fonksiyonları
  const fabrikaVeriYukle = (fabrika) => {
    setSecilenFabrika(fabrika);
    setAktifEnerji(fabrika.aktifEnerji);
    setInduktifEnerji(fabrika.induktifEnerji);
    setKapasitifEnerji(fabrika.kapasitifEnerji);
    setFormData(prev => ({ ...prev, firmaAdi: fabrika.fabrikaAdi }));
    setShowFabrikaModal(false);
    alert(`${fabrika.fabrikaAdi} verileri yüklendi.`);
  };

  const fabrikaSil = async id => {
    if(!confirm('Bu şirket fabrika verisini sunucudan silmek istiyor musunuz?'))return;
    try{const record=fabrikaVerileri.find(item=>item.id===id);await deleteCompanyDocument('osos_fabrika',id,record?._revision);await loadSharedFactories();if(secilenFabrika?.id===id){setSecilenFabrika(null);setAktifEnerji([]);setInduktifEnerji([]);setKapasitifEnerji([]);}alert('Fabrika verisi silindi.');}
    catch(error){alert('Fabrika verisi silinemedi: '+error.message+'. Listeyi yenileyin.');}
  };

  const tumFabrikalariKarsilastir = () => {
    if (fabrikaVerileri.length < 2) {
      alert('⚠️ Karşılaştırma için en az 2 fabrika verisi gereklidir!');
      return;
    }
    
    let karsilastirmaMetni = '📊 FABRİKA KARŞILAŞTIRMASI\n\n';
    
    fabrikaVerileri.forEach((fabrika, idx) => {
      karsilastirmaMetni += `${idx + 1}. ${fabrika.fabrikaAdi}\n`;
      karsilastirmaMetni += `   📅 Tarih: ${fabrika.baslangicTarihi} - ${fabrika.bitisTarihi}\n`;
      karsilastirmaMetni += `   ⚡ Toplam: ${fabrika.istatistikler.toplamTuketim} ${fabrika.enerjiTipi === 'aktif' ? 'kWh' : fabrika.enerjiTipi === 'belirsiz' ? 'Birim doğrulanmalı' : 'kVArh'}\n`;
      karsilastirmaMetni += `   📈 Ortalama: ${fabrika.istatistikler.ortalamaTuketim} ${fabrika.enerjiTipi === 'aktif' ? 'kWh' : fabrika.enerjiTipi === 'belirsiz' ? 'Birim doğrulanmalı' : 'kVArh'}\n`;
      karsilastirmaMetni += `   🔝 Max: ${fabrika.istatistikler.maxTuketim} ${fabrika.enerjiTipi === 'aktif' ? 'kWh' : fabrika.enerjiTipi === 'belirsiz' ? 'Birim doğrulanmalı' : 'kVArh'}\n\n`;
    });
    
    alert(karsilastirmaMetni);
  };

  // HTML İnteraktif Rapor Export
  const exportHTMLReport = () => {
    if (!formData.firmaAdi?.trim() || (!aktifEnerji.length && !induktifEnerji.length && !kapasitifEnerji.length && !measurements.some(item => item.deger !== '' && item.deger != null))) {
      alert('Firma adı ve gerçek enerji veya ölçüm verisi girin.'); return;
    }
    const html = buildEnergyHTMLReport({formData,measurements,aktifEnerji,induktifEnerji,kapasitifEnerji});
    const url = URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
    const anchor = document.createElement('a');anchor.href=url;anchor.download=`VoltGuard-OSOS-${formData.raporNo || localISODate()}.html`;
    document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  };

  // WorkTracker'a görev oluştur
  const createWorkTrackerTask = async () => { alert('Harici canlı bağlantılar şimdilik kapalı. Dosya içe aktarma ve kayıtlı raporlar kullanılabilir.'); };

  // OSOS raporundan otomatik görev oluştur
  const createTaskFromReport = () => { alert('Harici canlı bağlantılar şimdilik kapalı. Dosya içe aktarma ve kayıtlı raporlar kullanılabilir.'); };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Tab Sistemi */}
      <div className={`bg-white shadow-md no-print ${printMode ? 'hidden' : ''}`}>
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setOsosTab('canli')}
            className={`flex items-center gap-2 px-6 py-4 font-semibold transition-colors ${
              ososTab === 'canli'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
            }`}
          >
            <Activity className="w-5 h-5" />
            Ölçüm İzleme
          </button>
          <button
            onClick={() => setOsosTab('rapor')}
            className={`flex items-center gap-2 px-6 py-4 font-semibold transition-colors ${
              ososTab === 'rapor'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
            }`}
          >
            <FileText className="w-5 h-5" />
            Rapor Oluştur
          </button>
        </div>
      </div>

      {/* Ölçüm İzleme Tab */}
      {ososTab === 'canli' && (
        <OsosCanliIzleme />
      )}

      {/* Rapor Tab */}
      {ososTab === 'rapor' && (
        <div className="p-4">
          {/* Header */}
          <div className={`bg-white shadow-md rounded-lg p-4 mb-4 flex justify-between items-center no-print ${printMode ? 'hidden' : ''}`}>
            <div className="flex items-center gap-4">
              {logo && <img src={logo} alt="Logo" className="h-12 w-auto" />}
              <div>
                <h1 className="text-xl font-bold text-gray-800">OSOS Rapor Sistemi</h1>
                <p className="text-xs text-gray-500">Organize Sanayi Ölçüm Sistemi</p>
              </div>
            </div>
            <div className="flex gap-2">
          <button 
            onClick={raporuKaydet}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition-colors"
            title="Raporu kaydet"
          >
            <Save size={18} /> Kaydet
          </button>
          <button 
            onClick={raporlariYukle}
            className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white rounded-md hover:bg-cyan-700 transition-colors"
            title="Kayıtlı raporları görüntüle"
          >
            <FileText size={18} /> Raporlar
          </button>
          <button 
            onClick={async () => {try{await loadSharedFactories();setShowFabrikaModal(true);}catch(error){setCompanyDataError(error.message);alert('Fabrika listesi yüklenemedi: '+error.message);}}}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            title={`Kayıtlı ${fabrikaVerileri.length} fabrika`}
          >
            <FileText size={18} /> Fabrikalar {fabrikaVerileri.length > 0 && `(${fabrikaVerileri.length})`}
          </button>
          <button 
            onClick={exportHTMLReport}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-md hover:from-purple-700 hover:to-indigo-700 transition-colors"
            title="İnteraktif HTML rapor oluştur"
          >
            <Zap size={18} /> HTML Rapor
          </button>
          <button 
            disabled title="Harici canlı bağlantı şimdilik kapalı"
                  onClick={() => setShowKosbiModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
          >
            <Zap size={18} /> KOSBI Veri Çek
          </button>
          <label className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors cursor-pointer">
            <Upload size={18} /> OSOS dosyası yükle
            <input 
              type="file" 
              accept=".json,.xlsx,.xls"
              onChange={handleExcelImport}
              className="hidden"
            />
          </label>
          <button 
            disabled
            onClick={createTaskFromReport}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
            title="Bu rapordan WorkTracker'da görev oluştur"
          >
            <CheckCircle size={18} /> Görev Oluştur
          </button>
          <button 
            onClick={() => setEditMode(!editMode)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${editMode ? 'bg-green-600 hover:bg-green-700' : 'bg-yellow-600 hover:bg-yellow-700'} text-white`}
          >
            <Edit3 size={18} />
            {editMode ? 'Düzenleme Modu' : 'Önizleme Modu'}
          </button>
          <button onClick={exportPDF} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors">
            <Download size={18} /> PDF İndir
          </button>
          <button onClick={printReport} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
            <Printer size={18} /> Yazdır
          </button>
          <button onClick={resetForm} className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors">
            <RotateCcw size={18} /> Sıfırla
          </button>
        </div>
      </div>

      {companyDataError && <p role="alert" className="bg-red-50 text-red-800 p-4">Şirket verileri yüklenemedi: {companyDataError}</p>}
      {legacyReportsAvailable && <button onClick={importLegacyReports} className="border rounded p-3 m-3 text-sm">Eski tarayıcı OSOS raporlarını şirket sunucusuna aktar</button>}
      {!KOSBI_ENABLED && <div className="m-3 rounded border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <strong>Gerçek sayaç verisiyle çalışın.</strong> Harici canlı bağlantılar şimdilik kapalı. Dağıtım şirketi / OSOS portalından aldığınız gerçek JSON veya Excel dosyasını “OSOS JSON İmport” ile yükleyebilirsiniz. Anlık ölçümlerde gerçek ölçüm zamanı (olcum_zamani), en az bir ölçüm değeri ve tesis adı gerekir; eksik ölçümler boş kalır. Enerji dosyasında Tarih, Tüketim () ve Çarpan alanları bulunmalı; enerji tipini OBIS kodu veya kaynağınızla doğrulayın.
        <button onClick={downloadMeasurementTemplate} className="ml-3 mt-2 rounded border border-blue-400 bg-white px-3 py-2">Boş ölçüm JSON şablonunu indir</button>
        <p className="mt-2">Şablondaki boş alanları kendi sayaç çıktınızla doldurun. Tarih veya gerçek ölçüm eksikse kayıt yapılmaz; örnek tüketim üretilmez.</p>
      </div>}
      {/* WorkTracker Modal */}
      {showWorkTrackerModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-slideUp">
            <div className="bg-indigo-600 text-white px-6 py-4 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold">WorkTracker Görev Oluştur</h2>
                <p className="text-sm text-indigo-100">OSOS Raporundan Görev Takip Sistemi</p>
              </div>
              <button onClick={() => setShowWorkTrackerModal(false)} className="text-white hover:bg-indigo-700 p-2 rounded">
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Bağlantı Ayarları */}
              {!workTrackerToken && (
                <div className="space-y-3">
                  <h3 className="font-semibold text-gray-800">WorkTracker Bağlantısı</h3>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">WorkTracker URL</label>
                    <input
                      type="text"
                      value={workTrackerConfig.url}
                      onChange={(e) => setWorkTrackerConfig({...workTrackerConfig, url: e.target.value})}
                      className="w-full p-2 border rounded text-sm"
                      placeholder="http://localhost:3000"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">E-posta</label>
                    <input
                      type="email"
                      value={workTrackerConfig.email}
                      onChange={(e) => setWorkTrackerConfig({...workTrackerConfig, email: e.target.value})}
                      className="w-full p-2 border rounded text-sm"
                      placeholder="email@example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Şifre</label>
                    <input
                      type="password"
                      value={workTrackerConfig.password}
                      onChange={(e) => setWorkTrackerConfig({...workTrackerConfig, password: e.target.value})}
                      className="w-full p-2 border rounded text-sm"
                      placeholder="********"
                    />
                  </div>
                  <button
                    onClick={loginToWorkTracker}
                    disabled={isLoadingWorkTracker}
                    className="w-full px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:bg-gray-400"
                  >
                    {isLoadingWorkTracker ? 'Bağlanıyor...' : '🔐 Bağlan'}
                  </button>
                </div>
              )}

              {/* Görev Formu */}
              {workTrackerToken && (
                <div className="space-y-3">
                  <div className="bg-green-50 border border-green-200 rounded p-2 text-sm text-green-700">
                    ✅ WorkTracker'a bağlandı!
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Görev Başlığı *</label>
                    <input
                      type="text"
                      value={taskForm.title}
                      onChange={(e) => setTaskForm({...taskForm, title: e.target.value})}
                      className="w-full p-2 border rounded text-sm"
                      placeholder="Görev başlığı"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Açıklama</label>
                    <textarea
                      value={taskForm.description}
                      onChange={(e) => setTaskForm({...taskForm, description: e.target.value})}
                      className="w-full p-2 border rounded text-sm"
                      rows="8"
                      placeholder="Görev detayları..."
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Öncelik</label>
                      <select
                        value={taskForm.priority}
                        onChange={(e) => setTaskForm({...taskForm, priority: e.target.value})}
                        className="w-full p-2 border rounded text-sm"
                      >
                        <option value="LOW">Düşük</option>
                        <option value="MEDIUM">Orta</option>
                        <option value="HIGH">Yüksek</option>
                        <option value="URGENT">Acil</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Bitiş Tarihi</label>
                      <input
                        type="date"
                        value={taskForm.dueDate}
                        onChange={(e) => setTaskForm({...taskForm, dueDate: e.target.value})}
                        className="w-full p-2 border rounded text-sm"
                      />
                    </div>
                  </div>

                  {workTrackerUsers.length > 0 && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Atanan Kişi</label>
                      <select
                        value={taskForm.assignedToId}
                        onChange={(e) => setTaskForm({...taskForm, assignedToId: e.target.value})}
                        className="w-full p-2 border rounded text-sm"
                      >
                        <option value="">Atama yapılmadı</option>
                        {workTrackerUsers.map(user => (
                          <option key={user.id} value={user.id}>
                            {user.name} ({user.email})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => setWorkTrackerToken(null)}
                      className="flex-1 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                    >
                      Bağlantıyı Kes
                    </button>
                    <button
                      onClick={createWorkTrackerTask}
                      disabled={isLoadingWorkTracker}
                      className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
                    >
                      {isLoadingWorkTracker ? 'Oluşturuluyor...' : '✅ Görevi Oluştur'}
                    </button>
                  </div>
                </div>
              )}

              {/* Bilgilendirme */}
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
                <p className="font-semibold text-blue-800 mb-1">ℹ️ Kullanım</p>
                <p className="text-blue-700 text-xs">
                  Bu özellik, OSOS raporundan otomatik olarak WorkTracker görev takip sisteminde görev oluşturur. 
                  WorkTracker sunucusunun çalışıyor olması gerekmektedir.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KOSBI Modal */}
      {showKosbiModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto animate-slideUp">
            <div className="bg-purple-600 text-white px-6 py-4 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold">KOSBI Elektrik Sayaç Verileri</h2>
                <p className="text-sm text-purple-100">elektrik.kosbi.org.tr</p>
              </div>
              <button onClick={() => setShowKosbiModal(false)} className="text-white hover:bg-purple-700 p-2 rounded">
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Kullanıcı Listesi */}
              <div>
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold text-gray-800">Kayıtlı Kullanıcılar</h3>
                  <button 
                    onClick={addKosbiUser}
                    className="text-sm px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                  >
                    + Yeni Kullanıcı
                  </button>
                </div>
                
                <div className="space-y-2">
                  {kosbiUsers.map(user => (
                    <div key={user.id} className="border rounded p-3 flex justify-between items-center bg-gray-50">
                      <div>
                        <p className="font-semibold text-gray-800">{user.name}</p>
                        <p className="text-xs text-gray-500">Kullanıcı: {user.username} | Şifre: {'*'.repeat(user.password.length)}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => fetchKosbiData(user)}
                          disabled={isLoadingKosbi}
                          className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:bg-gray-400"
                        >
                          {isLoadingKosbi && selectedKosbiUser?.id === user.id ? 'Yükleniyor...' : 'Veri Çek'}
                        </button>
                        <button
                          onClick={() => removeKosbiUser(user.id)}
                          className="px-3 py-1 bg-red-100 text-red-600 rounded text-sm hover:bg-red-200"
                        >
                          Sil
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Çekilen Veriler */}
              {kosbiData.length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-800 mb-3">Çekilen Sayaç Verileri ({kosbiData.length} adet)</h3>
                  <div className="border rounded overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="p-2 text-left">Sayaç No</th>
                          <th className="p-2 text-left">Ad</th>
                          <th className="p-2 text-right">Çekilen (kWh)</th>
                          <th className="p-2 text-right">Verilen (kWh)</th>
                          <th className="p-2 text-center">Tarih</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kosbiData.map((data, idx) => (
                          <tr key={idx} className="border-t">
                            <td className="p-2">{data.sayacNo}</td>
                            <td className="p-2">{data.ad}</td>
                            <td className="p-2 text-right font-semibold">{data.cekilen}</td>
                            <td className="p-2 text-right">{data.verilen}</td>
                            <td className="p-2 text-center text-xs">{data.tarih}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      onClick={() => setKosbiData([])}
                      className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                    >
                      Temizle
                    </button>
                    <button
                      onClick={importKosbiData}
                      className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      Ölçüm Tablosuna Aktar
                    </button>
                  </div>
                </div>
              )}

              {/* Bilgilendirme */}
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm">
                <p className="font-semibold text-yellow-800 mb-1">Veri kaynağı</p>
                <p className="text-yellow-700 text-xs">
                  Bu portalda harici sayaç bağlantısı yapılandırılmamış. Dağıtım şirketinden
                  indirdiğiniz ölçüm dosyasını Rapor sekmesinden içe aktarabilirsiniz.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Enerji Tipi Seçim Modal */}
      {showEnerjiTipiModal && bekleyenVeri && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full animate-slideUp">
            <div className="bg-gradient-to-r from-green-600 to-blue-600 text-white px-6 py-4">
              <h2 className="text-2xl font-bold">⚡ Enerji Tipi Belirleme</h2>
              <p className="text-sm text-green-100">{bekleyenVeri.dosyaAdi}</p>
            </div>

            <div className="p-6 space-y-4">
              {/* Otomatik Tespit Sonucu */}
              <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="text-blue-600 text-3xl">🤖</div>
                  <div className="flex-1">
                    <h3 className="font-bold text-blue-900 mb-2">Otomatik Tespit Sonucu</h3>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-gray-600">Toplam Tüketim:</span>
                        <span className="font-bold ml-2">{bekleyenVeri.toplamTuketim.toFixed(2)} kWh</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Ortalama:</span>
                        <span className="font-bold ml-2">{(bekleyenVeri.toplamTuketim / bekleyenVeri.jsonData.length).toFixed(2)} kWh</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-gray-600">Dosyadan Belirlenen Tip:</span>
                        <span className="font-bold ml-2 text-lg">
                          {bekleyenVeri.tahminEdilenTip === 'aktif' && '⚡ AKTİF ENERJİ'}
                          {bekleyenVeri.tahminEdilenTip === 'induktif' && '🔶 ENDÜKTİF REAKTİF'}
                          {bekleyenVeri.tahminEdilenTip === 'kapasitif' && '🔷 KAPASİTİF REAKTİF'}
                          {!bekleyenVeri.tahminEdilenTip && 'Tip bilgisi yok; manuel seçim gerekli'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Manuel Seçim */}
              <div>
                <h3 className="font-semibold text-gray-800 mb-3">Enerji Tipini Seçin:</h3>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition"
                         style={{ borderColor: secilenEnerjiTipi === 'auto' ? '#3b82f6' : '#e5e7eb' }}>
                    <input
                      type="radio"
                      name="enerjiTipi"
                      value="auto"
                      checked={secilenEnerjiTipi === 'auto'}
                      onChange={(e) => setSecilenEnerjiTipi(e.target.value)}
                      className="w-5 h-5"
                    />
                    <div className="flex-1">
                      <div className="font-bold text-gray-800">Dosyadaki enerji tipi</div>
                      <div className="text-sm text-gray-600">
                        Yalnızca dosyadaki OBIS / enerji tipi bilgisi kullanılır.
                      </div>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition"
                         style={{ borderColor: secilenEnerjiTipi === 'aktif' ? '#10b981' : '#e5e7eb' }}>
                    <input
                      type="radio"
                      name="enerjiTipi"
                      value="aktif"
                      checked={secilenEnerjiTipi === 'aktif'}
                      onChange={(e) => setSecilenEnerjiTipi(e.target.value)}
                      className="w-5 h-5"
                    />
                    <div className="flex-1">
                      <div className="font-bold text-gray-800">⚡ Aktif Enerji</div>
                      <div className="text-sm text-gray-600">
                        Aktif enerji kaydı (kWh / OBIS 1.8.0)
                      </div>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition"
                         style={{ borderColor: secilenEnerjiTipi === 'induktif' ? '#f59e0b' : '#e5e7eb' }}>
                    <input
                      type="radio"
                      name="enerjiTipi"
                      value="induktif"
                      checked={secilenEnerjiTipi === 'induktif'}
                      onChange={(e) => setSecilenEnerjiTipi(e.target.value)}
                      className="w-5 h-5"
                    />
                    <div className="flex-1">
                      <div className="font-bold text-gray-800">🔶 Endüktif Reaktif Enerji</div>
                      <div className="text-sm text-gray-600">
                        Endüktif enerji kaydı (kVArh / OBIS 5.8.0)
                      </div>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition"
                         style={{ borderColor: secilenEnerjiTipi === 'kapasitif' ? '#3b82f6' : '#e5e7eb' }}>
                    <input
                      type="radio"
                      name="enerjiTipi"
                      value="kapasitif"
                      checked={secilenEnerjiTipi === 'kapasitif'}
                      onChange={(e) => setSecilenEnerjiTipi(e.target.value)}
                      className="w-5 h-5"
                    />
                    <div className="flex-1">
                      <div className="font-bold text-gray-800">🔷 Kapasitif Reaktif Enerji</div>
                      <div className="text-sm text-gray-600">
                        Kondansatörler, kompanzasyon (Aktifin %5-15'i)
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Bilgilendirme */}
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm">
                <p className="font-semibold text-yellow-800 mb-1">💡 İpucu</p>
                <p className="text-yellow-700 text-xs">
                  Eğer 3 ayrı JSON dosyanız varsa (grdResult.json, grdResult (1).json, grdResult (2).json), 
                  her birini sırayla yükleyip farklı tipler seçerek tam analiz yapabilirsiniz.
                </p>
              </div>
            </div>

            <div className="bg-gray-50 p-4 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowEnerjiTipiModal(false);
                  setBekleyenVeri(null);
                  setSecilenEnerjiTipi('auto');
                }}
                className="px-6 py-2 bg-gray-200 hover:bg-gray-300 rounded-md transition text-gray-700"
              >
                İptal
              </button>
              <button
                onClick={importExcelData}
                className="px-6 py-2 bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700 text-white rounded-md transition flex items-center gap-2 font-semibold"
              >
                <CheckCircle size={18} />
                İçe Aktar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fabrika Yönetimi Modal */}
      {showFabrikaModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto animate-slideUp">
            <div className="bg-gradient-to-r from-blue-600 to-blue-500 text-white px-6 py-4">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold flex items-center gap-2">
                    <FileText size={28} />
                    Fabrika Veri Yönetimi
                  </h2>
                  <p className="text-sm text-blue-100">OSOS Fabrika Verileri - {fabrikaVerileri.length} kayıt</p>
                </div>
                <button 
                  onClick={() => setShowFabrikaModal(false)}
                  className="text-white hover:bg-blue-700 p-2 rounded-full transition"
                >
                  <X size={24} />
                </button>
              </div>
            </div>

            <div className="p-6">
              {fabrikaVerileri.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-gray-400 mb-4">
                    <FileText size={64} className="mx-auto" />
                  </div>
                  <p className="text-gray-600 font-semibold mb-2">Henüz fabrika verisi yüklenmemiş</p>
                  <p className="text-sm text-gray-500 mb-4">
                    "OSOS JSON İmport" butonunu kullanarak grdResult.json formatında veri yükleyin
                  </p>
                  <label className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors cursor-pointer">
                    <Upload size={20} /> JSON Dosyası Yükle
                    <input 
                      type="file" 
                      accept=".json"
                      onChange={handleExcelImport}
                      className="hidden"
                    />
                  </label>
                </div>
              ) : (
                <>
                  {/* Karşılaştırma Butonu */}
                  {fabrikaVerileri.length >= 2 && (
                    <div className="mb-4">
                      <button
                        onClick={tumFabrikalariKarsilastir}
                        className="w-full px-4 py-3 bg-gradient-to-r from-purple-600 to-purple-500 text-white rounded-lg hover:from-purple-700 hover:to-purple-600 transition-all flex items-center justify-center gap-2 font-semibold"
                      >
                        📊 Tüm Fabrikaları Karşılaştır
                      </button>
                    </div>
                  )}

                  {/* Fabrika Listesi */}
                  <div className="space-y-3">
                    {fabrikaVerileri.map((fabrika) => (
                      <div 
                        key={fabrika.id} 
                        className={`border-2 rounded-lg p-4 transition-all ${
                          secilenFabrika?.id === fabrika.id 
                            ? 'border-blue-500 bg-blue-50' 
                            : 'border-gray-200 hover:border-gray-300 bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="text-lg font-bold text-gray-800">{fabrika.fabrikaAdi}</h3>
                              {fabrika.enerjiTipi && (
                                <span className={`px-3 py-1 text-white text-xs rounded-full font-semibold ${
                                  fabrika.enerjiTipi === 'aktif' ? 'bg-green-600' :
                                  fabrika.enerjiTipi === 'induktif' ? 'bg-orange-600' :
                                  'bg-blue-600'
                                }`}>
                                  {fabrika.enerjiTipi === 'aktif' && '⚡ Aktif'}
                                  {fabrika.enerjiTipi === 'induktif' && '🔶 Endüktif'}
                                  {fabrika.enerjiTipi === 'kapasitif' && '🔷 Kapasitif'}
                                </span>
                              )}
                              {secilenFabrika?.id === fabrika.id && (
                                <span className="px-2 py-1 bg-blue-600 text-white text-xs rounded-full font-semibold">
                                  ✓ Aktif Rapor
                                </span>
                              )}
                            </div>
                            
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <p className="text-gray-500 text-xs">Dosya</p>
                                <p className="font-semibold text-gray-700">{fabrika.dosyaAdi}</p>
                              </div>
                              <div>
                                <p className="text-gray-500 text-xs">Veri Sayısı</p>
                                <p className="font-semibold text-gray-700">{fabrika.veriSayisi} kayıt</p>
                              </div>
                              <div>
                                <p className="text-gray-500 text-xs">Tarih Aralığı</p>
                                <p className="font-semibold text-gray-700">{fabrika.baslangicTarihi} - {fabrika.bitisTarihi}</p>
                              </div>
                              <div>
                                <p className="text-gray-500 text-xs">Yüklenme</p>
                                <p className="font-semibold text-gray-700">{new Date(fabrika.yuklemeTarihi).toLocaleDateString('tr-TR')}</p>
                              </div>
                            </div>

                            {/* İstatistikler */}
                            <div className="mt-3 grid grid-cols-4 gap-2">
                              <div className="bg-green-50 border border-green-200 rounded p-2">
                                <p className="text-xs text-green-600">Toplam Tüketim</p>
                                <p className="text-sm font-bold text-green-800">{fabrika.istatistikler.toplamTuketim} {fabrika.enerjiTipi === 'aktif' ? 'kWh' : fabrika.enerjiTipi === 'belirsiz' ? 'Birim doğrulanmalı' : 'kVArh'}</p>
                              </div>
                              <div className="bg-blue-50 border border-blue-200 rounded p-2">
                                <p className="text-xs text-blue-600">Ortalama</p>
                                <p className="text-sm font-bold text-blue-800">{fabrika.istatistikler.ortalamaTuketim} {fabrika.enerjiTipi === 'aktif' ? 'kWh' : fabrika.enerjiTipi === 'belirsiz' ? 'Birim doğrulanmalı' : 'kVArh'}</p>
                              </div>
                              <div className="bg-orange-50 border border-orange-200 rounded p-2">
                                <p className="text-xs text-orange-600">Maximum</p>
                                <p className="text-sm font-bold text-orange-800">{fabrika.istatistikler.maxTuketim} {fabrika.enerjiTipi === 'aktif' ? 'kWh' : fabrika.enerjiTipi === 'belirsiz' ? 'Birim doğrulanmalı' : 'kVArh'}</p>
                              </div>
                              <div className="bg-purple-50 border border-purple-200 rounded p-2">
                                <p className="text-xs text-purple-600">Minimum</p>
                                <p className="text-sm font-bold text-purple-800">{fabrika.istatistikler.minTuketim} {fabrika.enerjiTipi === 'aktif' ? 'kWh' : fabrika.enerjiTipi === 'belirsiz' ? 'Birim doğrulanmalı' : 'kVArh'}</p>
                              </div>
                            </div>
                          </div>

                          {/* Aksiyonlar */}
                          <div className="flex flex-col gap-2 ml-4">
                            <button
                              onClick={() => fabrikaVeriYukle(fabrika)}
                              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm font-semibold whitespace-nowrap"
                            >
                              📊 Rapora Yükle
                            </button>
                            <button
                              onClick={() => {
                                // Ham veriyi indirme
                                const dataStr = JSON.stringify(fabrika.hamVeri, null, 2);
                                const dataBlob = new Blob([dataStr], { type: 'application/json' });
                                const url = URL.createObjectURL(dataBlob);
                                const link = document.createElement('a');
                                link.href = url;
                                link.download = `${fabrika.fabrikaAdi}_ham_veri.json`;
                                link.click();
                                URL.revokeObjectURL(url);
                              }}
                              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition text-sm font-semibold whitespace-nowrap"
                            >
                              💾 Ham Veri İndir
                            </button>
                            <button
                              onClick={() => fabrikaSil(fabrika.id)}
                              className="px-4 py-2 bg-red-100 text-red-600 rounded hover:bg-red-200 transition text-sm font-semibold whitespace-nowrap"
                            >
                              🗑️ Sil
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="bg-gray-50 p-4 border-t flex justify-between items-center">
              <p className="text-sm text-gray-600">
                💡 <strong>İpucu:</strong> Her fabrika için ayrı JSON dosyası yükleyerek tüm verileri merkezi yönetin
              </p>
              <button
                onClick={() => setShowFabrikaModal(false)}
                className="px-6 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-md transition"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input Section */}
      {editMode && !printMode && (
        <div className="space-y-4 mb-4">
          <div className="p-6 bg-white shadow-md rounded-lg max-w-7xl mx-auto">
            <h2 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2 flex items-center gap-2">
              <FileText size={18} /> Genel Bilgiler
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Firma Adı *</label>
                <input
                  type="text"
                  value={formData.firmaAdi}
                  onChange={(e) => handleInputChange('firmaAdi', e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                  placeholder="Firma adını girin"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Rapor No *</label>
                <input
                  type="text"
                  value={formData.raporNo}
                  onChange={(e) => handleInputChange('raporNo', e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                  placeholder="Rapor numarası"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Rapor Tarihi</label>
                <input
                  type="date"
                  value={formData.raporTarihi}
                  onChange={(e) => handleInputChange('raporTarihi', e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-xs font-semibold text-gray-700 mb-1">Adres</label>
                <input
                  type="text"
                  value={formData.adres}
                  onChange={(e) => handleInputChange('adres', e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                  placeholder="Tesis adresi"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Yetkili Kişi</label>
                <input
                  type="text"
                  value={formData.yetkili}
                  onChange={(e) => handleInputChange('yetkili', e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                  placeholder="Yetkili adı"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Telefon</label>
                <input
                  type="text"
                  value={formData.telefon}
                  onChange={(e) => handleInputChange('telefon', e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                  placeholder="İletişim telefonu"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">E-posta</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                  placeholder="E-posta adresi"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Vergi No</label>
                <input
                  type="text"
                  value={formData.vergiNo}
                  onChange={(e) => handleInputChange('vergiNo', e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                  placeholder="Vergi numarası"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Tesis Gücü (kW)</label>
                <input
                  type="number"
                  value={formData.tesisGucuKW}
                  onChange={(e) => handleInputChange('tesisGucuKW', e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                  placeholder="kW"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Çalışan Sayısı</label>
                <input
                  type="number"
                  value={formData.calisanSayisi}
                  onChange={(e) => handleInputChange('calisanSayisi', e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                  placeholder="Kişi"
                />
              </div>
            </div>
          </div>

          <div className="p-6 bg-white shadow-md rounded-lg max-w-7xl mx-auto">
            <h2 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2 flex items-center gap-2">
              <Zap size={18} /> Kontrol Bilgileri
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Kontrol Eden</label>
                <input
                  type="text"
                  value={formData.kontrolEdenAd}
                  onChange={(e) => handleInputChange('kontrolEdenAd', e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                  placeholder="Ad Soyad"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Unvan</label>
                <input
                  type="text"
                  value={formData.kontrolEdenUnvan}
                  onChange={(e) => handleInputChange('kontrolEdenUnvan', e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                  placeholder="Unvan"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Oda Sicil No</label>
                <input
                  type="text"
                  value={formData.kontrolEdenOdaNo}
                  onChange={(e) => handleInputChange('kontrolEdenOdaNo', e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                  placeholder="Sicil no"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Kontrol Tarihi</label>
                <input
                  type="date"
                  value={formData.kontrolTarihi}
                  onChange={(e) => handleInputChange('kontrolTarihi', e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Sonraki Kontrol Tarihi</label>
                <input
                  type="date"
                  value={formData.sonrakiKontrolTarihi}
                  onChange={(e) => handleInputChange('sonrakiKontrolTarihi', e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Genel Sonuç</label>
                <select
                  value={formData.sonuc}
                  onChange={(e) => handleInputChange('sonuc', e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                >
                  <option value="Uygun">✅ Uygun</option>
                  <option value="Uygun Değil">❌ Uygun Değil</option>
                  <option value="Şartlı Uygun">⚠️ Şartlı Uygun</option>
                </select>
              </div>
            </div>
          </div>

          <div className="p-6 bg-white shadow-md rounded-lg max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-800 border-b pb-2 flex items-center gap-2">
                <Zap size={18} /> OSOS Otomatik Veri Analizi
              </h2>
              <button
                onClick={addMeasurement}
                className="flex items-center gap-2 px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
              >
                <FileText size={14} /> Yeni Parametre
              </button>
            </div>
            <div className="space-y-3">
              {measurements.map((m, idx) => (
                <div key={m.id} className="p-3 bg-gray-50 rounded border grid grid-cols-6 gap-2 items-center">
                  <input
                    type="text"
                    value={m.parametre}
                    onChange={(e) => handleMeasurementChange(m.id, 'parametre', e.target.value)}
                    className="p-2 border rounded text-sm col-span-2"
                    placeholder="Parametre (örn: Aktif Güç)"
                  />
                  <input
                    type="text"
                    value={m.deger}
                    onChange={(e) => handleMeasurementChange(m.id, 'deger', e.target.value)}
                    className="p-2 border rounded text-sm"
                    placeholder="Değer"
                  />
                  <input
                    type="text"
                    value={m.birim}
                    onChange={(e) => handleMeasurementChange(m.id, 'birim', e.target.value)}
                    className="p-2 border rounded text-sm w-20"
                    placeholder="Birim"
                  />
                  <input
                    type="text"
                    value={m.referans}
                    onChange={(e) => handleMeasurementChange(m.id, 'referans', e.target.value)}
                    className="p-2 border rounded text-sm"
                    placeholder="Referans"
                  />
                  <div className="flex gap-1">
                    <select
                      value={m.durum}
                      onChange={(e) => handleMeasurementChange(m.id, 'durum', e.target.value)}
                      className="p-2 border rounded text-sm flex-1"
                    >
                      <option value="Normal">✅ Normal</option>
                      <option value="Uyarı">⚠️ Uyarı</option>
                      <option value="Kritik">❌ Kritik</option>
                    </select>
                    <button
                      onClick={() => removeMeasurement(m.id)}
                      className="p-2 bg-red-100 text-red-600 rounded hover:bg-red-200 text-sm"
                      disabled={measurements.length === 1}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ENERJİ TİPLERİ TABLOLARI */}
          {(aktifEnerji.length > 0 || induktifEnerji.length > 0 || kapasitifEnerji.length > 0) && (
            <div className="p-6 bg-white shadow-md rounded-lg max-w-7xl mx-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-800 border-b pb-2 flex items-center gap-2">
                  ⚡ Enerji Tüketim Analizi
                </h2>
                <div className="text-sm text-gray-600">
                  📊 Toplam: {aktifEnerji.length + induktifEnerji.length + kapasitifEnerji.length} kayıt
                </div>
              </div>

              {/* Özet Kartlar */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-green-50 border-2 border-green-500 p-4 rounded-lg">
                  <div className="text-green-700 font-bold text-sm mb-1">⚡ Aktif Enerji</div>
                  <div className="text-2xl font-bold text-green-900">
                    {aktifEnerji.reduce((sum, item) => sum + parseFloat(item.tuketim), 0).toFixed(2)} kWh
                  </div>
                  <div className="text-xs text-green-600 mt-1">{aktifEnerji.length} ölçüm</div>
                </div>
                <div className="bg-orange-50 border-2 border-orange-500 p-4 rounded-lg">
                  <div className="text-orange-700 font-bold text-sm mb-1">🔶 İndüktif Reaktif</div>
                  <div className="text-2xl font-bold text-orange-900">
                    {induktifEnerji.reduce((sum, item) => sum + parseFloat(item.tuketim), 0).toFixed(2)} kVArh
                  </div>
                  <div className="text-xs text-orange-600 mt-1">{induktifEnerji.length} ölçüm</div>
                </div>
                <div className="bg-blue-50 border-2 border-blue-500 p-4 rounded-lg">
                  <div className="text-blue-700 font-bold text-sm mb-1">🔷 Kapasitif Reaktif</div>
                  <div className="text-2xl font-bold text-blue-900">
                    {kapasitifEnerji.reduce((sum, item) => sum + parseFloat(item.tuketim), 0).toFixed(2)} kVArh
                  </div>
                  <div className="text-xs text-blue-600 mt-1">{kapasitifEnerji.length} ölçüm</div>
                </div>
              </div>

              {/* AKTİF ENERJİ TABLOSU */}
              {aktifEnerji.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-md font-semibold text-green-700 mb-2">⚡ Aktif Enerji Detayları (kWh)</h3>
                  <div className="max-h-64 overflow-y-auto border rounded">
                    <table className="w-full text-xs">
                      <thead className="bg-green-600 text-white sticky top-0">
                        <tr>
                          <th className="p-2 text-left">Tarih</th>
                          <th className="p-2 text-right">Tüketim (kWh)</th>
                          <th className="p-2 text-right">Endeks</th>
                          <th className="p-2 text-center">Çarpan</th>
                          <th className="p-2 text-center">Süre (Saat)</th>
                          <th className="p-2 text-center">Durum</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aktifEnerji.map((item, idx) => (
                          <tr key={idx} className={idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                            <td className="p-2">{item.tarih}</td>
                            <td className="p-2 text-right font-bold">{item.tuketim}</td>
                            <td className="p-2 text-right">{(item.endeks == null ? '—' : item.endeks.toFixed(2))}</td>
                            <td className="p-2 text-center">{item.carpan}</td>
                            <td className="p-2 text-center">{item.okumaSuresi}</td>
                            <td className="p-2 text-center">
                              <span className={`px-2 py-1 rounded text-xs font-semibold ${
                                item.sonuc === 'Normal' ? 'bg-green-100 text-green-800' :
                                item.sonuc === 'Dikkat' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-red-100 text-red-800'
                              }`}>
                                {item.sonuc}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* İNDÜKTİF ENERJİ TABLOSU */}
              {induktifEnerji.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-md font-semibold text-orange-700 mb-2">🔶 İndüktif Reaktif Enerji (kVArh)</h3>
                  <div className="max-h-64 overflow-y-auto border rounded">
                    <table className="w-full text-xs">
                      <thead className="bg-orange-600 text-white sticky top-0">
                        <tr>
                          <th className="p-2 text-left">Tarih</th>
                          <th className="p-2 text-right">Tüketim (kVArh)</th>
                          <th className="p-2 text-right">Endeks</th>
                          <th className="p-2 text-center">Çarpan</th>
                          <th className="p-2 text-center">Süre (Saat)</th>
                          <th className="p-2 text-center">Durum</th>
                        </tr>
                      </thead>
                      <tbody>
                        {induktifEnerji.map((item, idx) => (
                          <tr key={idx} className={idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                            <td className="p-2">{item.tarih}</td>
                            <td className="p-2 text-right font-bold">{item.tuketim}</td>
                            <td className="p-2 text-right">{(item.endeks == null ? '—' : item.endeks.toFixed(2))}</td>
                            <td className="p-2 text-center">{item.carpan}</td>
                            <td className="p-2 text-center">{item.okumaSuresi}</td>
                            <td className="p-2 text-center">
                              <span className={`px-2 py-1 rounded text-xs font-semibold ${
                                item.sonuc === 'Normal' ? 'bg-green-100 text-green-800' :
                                item.sonuc === 'Dikkat' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-red-100 text-red-800'
                              }`}>
                                {item.sonuc}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* KAPASİTİF ENERJİ TABLOSU */}
              {kapasitifEnerji.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-md font-semibold text-blue-700 mb-2">🔷 Kapasitif Reaktif Enerji (kVArh)</h3>
                  <div className="max-h-64 overflow-y-auto border rounded">
                    <table className="w-full text-xs">
                      <thead className="bg-blue-600 text-white sticky top-0">
                        <tr>
                          <th className="p-2 text-left">Tarih</th>
                          <th className="p-2 text-right">Tüketim (kVArh)</th>
                          <th className="p-2 text-right">Endeks</th>
                          <th className="p-2 text-center">Çarpan</th>
                          <th className="p-2 text-center">Süre (Saat)</th>
                          <th className="p-2 text-center">Durum</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kapasitifEnerji.map((item, idx) => (
                          <tr key={idx} className={idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                            <td className="p-2">{item.tarih}</td>
                            <td className="p-2 text-right font-bold">{item.tuketim}</td>
                            <td className="p-2 text-right">{(item.endeks == null ? '—' : item.endeks.toFixed(2))}</td>
                            <td className="p-2 text-center">{item.carpan}</td>
                            <td className="p-2 text-center">{item.okumaSuresi}</td>
                            <td className="p-2 text-center">
                              <span className={`px-2 py-1 rounded text-xs font-semibold ${
                                item.sonuc === 'Normal' ? 'bg-green-100 text-green-800' :
                                item.sonuc === 'Dikkat' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-red-100 text-red-800'
                              }`}>
                                {item.sonuc}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="p-6 bg-white shadow-md rounded-lg max-w-7xl mx-auto">
            <h2 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2">Tespit ve Öneriler</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Tespit Edilen Durumlar</label>
                <textarea
                  value={formData.tespit}
                  onChange={(e) => handleInputChange('tespit', e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                  rows="4"
                  placeholder="Tespit edilen eksiklikler ve durumlar..."
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Öneriler</label>
                <textarea
                  value={formData.oneri}
                  onChange={(e) => handleInputChange('oneri', e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                  rows="4"
                  placeholder="Yapılması önerilen işlemler..."
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Ek Açıklamalar</label>
                <textarea
                  value={formData.aciklama}
                  onChange={(e) => handleInputChange('aciklama', e.target.value)}
                  className="w-full p-2 border rounded text-sm"
                  rows="3"
                  placeholder="Ek bilgiler ve notlar..."
                />
              </div>
            </div>
          </div>

          <div className="p-6 bg-white shadow-md rounded-lg max-w-7xl mx-auto">
            <h2 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2 flex items-center gap-2">
              <Upload size={18} /> Logo Ayarları
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Logo URL (varsayılan aktif)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={logoInputUrl}
                    onChange={(e) => setLogoInputUrl(e.target.value)}
                    placeholder="https://ornek.com/logo.png"
                    className="flex-1 p-2 border rounded text-sm"
                  />
                  <button
                    onClick={handleLogoUrlChange}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Güncelle
                  </button>
                </div>
              </div>
              
              <div className="flex items-center gap-4 pt-3 border-t">
                <label className="flex-shrink-0">
                  <span className="block text-sm font-medium text-gray-700 mb-2">veya Dosyadan Yükle:</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="p-2 border rounded text-sm"
                  />
                </label>
                
                {logo && (
                  <div className="flex items-center gap-3">
                    <div className="w-20 h-20 border-2 border-gray-300 rounded p-1">
                      <img src={logo} alt="Logo" className="w-full h-full object-contain" />
                    </div>
                    <button
                      onClick={removeLogo}
                      className="p-2 bg-red-100 text-red-600 rounded hover:bg-red-200"
                      title="Varsayılan logoya dön"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Kayıtlı Raporlar Modalı */}
      {showKayitliRaporlar && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto animate-slideUp">
            <div className="bg-gradient-to-r from-cyan-600 to-cyan-500 text-white px-6 py-4 flex justify-between items-center sticky top-0">
              <div>
                <h2 className="text-xl font-bold">Kayıtlı Raporlar</h2>
                <p className="text-sm text-cyan-100">Toplam {kaydedilenRaporlar.length} rapor</p>
              </div>
              <button 
                onClick={() => setShowKayitliRaporlar(false)} 
                className="text-white hover:bg-cyan-700 p-2 rounded"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6">
              {kaydedilenRaporlar.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-gray-400 mb-4">
                    <FileText size={64} className="mx-auto" />
                  </div>
                  <p className="text-gray-600 font-semibold mb-2">Henüz kayıtlı rapor yok</p>
                  <p className="text-sm text-gray-500">
                    Raporlarınızı kaydetmek için "Kaydet" butonunu kullanın
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {kaydedilenRaporlar.map((rapor) => (
                    <div 
                      key={rapor.id} 
                      className="border-2 rounded-lg p-4 hover:border-cyan-300 transition-all bg-white"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-bold text-gray-800 text-lg mb-2 flex items-center gap-2">
                            <FileText size={18} className="text-cyan-600" />
                            {rapor.firmaAdi}
                          </h3>
                          <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
                            <div>
                              <span className="font-semibold">Kayıt Tarihi:</span> {new Date(rapor.tarih).toLocaleString('tr-TR')}
                            </div>
                            <div>
                              <span className="font-semibold">Fabrika Sayısı:</span> {rapor.fabrikaVerileri.length}
                            </div>
                            <div>
                              <span className="font-semibold">Kontrol:</span> {rapor.formData.kontrolEdenAd || '-'}
                            </div>
                            <div>
                              <span className="font-semibold">Durum:</span>{' '}
                              <span className={rapor.formData.sonuc === 'Uygun' ? 'text-green-600' : 'text-red-600'}>
                                {rapor.formData.sonuc}
                              </span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex gap-2">
                          <button
                            onClick={() => kayitliRaporuAc(rapor)}
                            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-2"
                          >
                            <Upload size={16} /> Yükle
                          </button>
                          <button
                            onClick={() => kayitliRaporuSil(rapor.id)}
                            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 flex items-center gap-2"
                          >
                            <X size={16} /> Sil
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Print View */}
      <div ref={reportRef} className={`bg-white shadow-md rounded-lg p-8 max-w-7xl mx-auto ${!editMode || printMode ? '' : 'hidden'}`}>
        {/* Logo ve Başlık */}
        <div className="flex justify-between items-start mb-6 border-b-2 border-gray-300 pb-4">
          {logo && (
            <div className="w-32 h-32 border rounded overflow-hidden">
              <img src={logo} alt="Logo" className="w-full h-full object-contain" />
            </div>
          )}
          <div className="flex-1 text-center">
            <h1 className="text-3xl font-bold text-gray-800">OSOS RAPORU</h1>
            <p className="text-base text-gray-600 mt-1">Organize Sanayi Ölçüm Sistemi</p>
            <p className="text-sm text-gray-500 mt-2">Rapor No: {formData.raporNo || '-'}</p>
          </div>
        </div>

        {/* Firma Bilgileri */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-3 text-gray-800 border-b border-gray-300 pb-1">Firma Bilgileri</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><strong>Firma Adı:</strong> {formData.firmaAdi || '-'}</div>
            <div><strong>Rapor Tarihi:</strong> {formData.raporTarihi || '-'}</div>
            <div className="col-span-2"><strong>Adres:</strong> {formData.adres || '-'}</div>
            <div><strong>Yetkili Kişi:</strong> {formData.yetkili || '-'}</div>
            <div><strong>Telefon:</strong> {formData.telefon || '-'}</div>
            <div><strong>E-posta:</strong> {formData.email || '-'}</div>
            <div><strong>Vergi No:</strong> {formData.vergiNo || '-'}</div>
            <div><strong>Tesis Gücü:</strong> {formData.tesisGucuKW ? `${formData.tesisGucuKW} kW` : '-'}</div>
            <div><strong>Çalışan Sayısı:</strong> {formData.calisanSayisi || '-'}</div>
          </div>
        </div>

        {/* Kontrol Bilgileri */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-3 text-gray-800 border-b border-gray-300 pb-1">Kontrol Bilgileri</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><strong>Kontrol Eden:</strong> {formData.kontrolEdenAd || '-'}</div>
            <div><strong>Unvan:</strong> {formData.kontrolEdenUnvan || '-'}</div>
            <div><strong>Oda Sicil No:</strong> {formData.kontrolEdenOdaNo || '-'}</div>
            <div><strong>Kontrol Tarihi:</strong> {formData.kontrolTarihi || '-'}</div>
            <div><strong>Sonraki Kontrol:</strong> {formData.sonrakiKontrolTarihi || '-'}</div>
            <div>
              <strong>Genel Sonuç:</strong> 
              <span className={`ml-2 px-2 py-1 rounded text-xs font-semibold ${
                formData.sonuc === 'Uygun' ? 'bg-green-100 text-green-700' : 
                formData.sonuc === 'Uygun Değil' ? 'bg-red-100 text-red-700' : 
                'bg-yellow-100 text-yellow-700'
              }`}>
                {formData.sonuc}
              </span>
            </div>
          </div>
        </div>

        {/* OSOS Otomatik Veri Analizi Tablosu */}
        {measurements.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-3 text-gray-800 border-b border-gray-300 pb-1">
              📊 OSOS Otomatik Veri Analizi
            </h2>
            <p className="text-xs text-gray-600 mb-3 italic">
              * Bu veriler OSOS (Otomatik Sayaç Okuma Sistemi) tarafından otomatik olarak kaydedilmiş ve analiz edilmiştir.
            </p>
            <table className="w-full text-sm border-collapse border border-gray-300">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 p-2 text-left">#</th>
                  <th className="border border-gray-300 p-2 text-left">Parametre</th>
                  <th className="border border-gray-300 p-2 text-center">Ölçülen Değer</th>
                  <th className="border border-gray-300 p-2 text-center">Birim</th>
                  <th className="border border-gray-300 p-2 text-center">Referans</th>
                  <th className="border border-gray-300 p-2 text-center">Durum</th>
                </tr>
              </thead>
              <tbody>
                {measurements.map((m, idx) => (
                  <tr key={m.id}>
                    <td className="border border-gray-300 p-2">{idx + 1}</td>
                    <td className="border border-gray-300 p-2 font-medium">{m.parametre || '-'}</td>
                    <td className="border border-gray-300 p-2 text-center font-bold text-blue-700">{m.deger || '-'}</td>
                    <td className="border border-gray-300 p-2 text-center text-gray-600">{m.birim || '-'}</td>
                    <td className="border border-gray-300 p-2 text-center text-xs text-gray-500">{m.referans || '-'}</td>
                    <td className="border border-gray-300 p-2 text-center">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        m.durum === 'Normal' ? 'bg-green-100 text-green-700' : 
                        m.durum === 'Uyarı' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {m.durum}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Tespit ve Öneriler */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-3 text-gray-800 border-b border-gray-300 pb-1">Tespit Edilen Durumlar</h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">
            {formData.tespit || 'Tespit edilen durum bulunmamaktadır.'}
          </p>
        </div>

        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-3 text-gray-800 border-b border-gray-300 pb-1">Öneriler</h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">
            {formData.oneri || 'Özel öneri bulunmamaktadır.'}
          </p>
        </div>

        {formData.aciklama && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-3 text-gray-800 border-b border-gray-300 pb-1">Ek Açıklamalar</h2>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {formData.aciklama}
            </p>
          </div>
        )}

        {/* İmza Alanı */}
        <div className="mt-12 flex justify-between border-t pt-6">
          <div className="text-center">
            <div className="border-t-2 border-gray-400 w-48 pt-2 mx-auto">
              <p className="text-sm font-semibold">{formData.kontrolEdenAd || 'Kontrol Eden'}</p>
              <p className="text-xs text-gray-600">{formData.kontrolEdenUnvan}</p>
              <p className="text-xs text-gray-500">Sicil No: {formData.kontrolEdenOdaNo || '-'}</p>
            </div>
          </div>
          <div className="text-center">
            <div className="border-t-2 border-gray-400 w-48 pt-2 mx-auto">
              <p className="text-sm font-semibold">{formData.yetkili || 'Firma Yetkilisi'}</p>
              <p className="text-xs text-gray-600">{formData.firmaAdi || 'Firma Adı'}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-gray-500 border-t pt-4">
          <p>Bu rapor {formData.raporTarihi} tarihinde {formData.kontrolEdenAd || 'yetkili kişi'} tarafından hazırlanmıştır.</p>
          <p className="mt-1">Organize Sanayi Ölçüm Sistemi (OSOS) - Elektronik Rapor Sistemi</p>
        </div>
      </div>
      </div>
      )}
    </div>
  );
}


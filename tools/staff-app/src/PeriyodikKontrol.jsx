import React, { useState, useEffect, useRef } from 'react';
import { Printer, FileText, Zap, ShieldCheck, AlertTriangle, CheckCircle, Save, RotateCcw, Sparkles, MessageSquare, X, Mail, ArrowUpCircle } from 'lucide-react';
import { exportHTMLReport, reportFileName } from './pdfReport';
import { loadCompanyDocuments, saveCompanyDocument, deleteCompanyDocument } from './companyDocuments';
import { parseDecimal, localISODate } from './operations.mjs';
const faturaLogo = '/calisan/uygulama/fatura_logo.png';

// --- Yardımcı Fonksiyonlar ve Hesaplamalar ---

// TS HD 60364'e göre Açma Akımı hesaplama (Yaklaık deıerler)
const calculateIa = (In, type, deviceType = "MCB") => {
  if (deviceType === "RCD") return In; // RCD için In aslında I_delta_n'dir
  const numericIn = parseDecimal(In, null);
  if (!(numericIn > 0)) return 0;
  
  switch (type) {
    case 'B': return numericIn * 5;
    case 'C': return numericIn * 10;
    case 'D': return numericIn * 20; // Standartlarda genelde 10-20 arası, güvenli taraf 20
    default: return 0; // Ayarlı / özel koruma için gerçek üretici açma akımı girilir.
  }
};

// Sınır değer Hesaplama (TT için 50V/Ia, TN için 230V/Ia veya formıl)
const calculateLimit = (Ia, systemType) => {
  if (!Ia || Ia === 0) return 0;
  // TN sistemlerde Zs <= Uo / Ia (Uo = 230V)
  if (systemType.includes("TN")) return (230 / Ia).toFixed(6);
  // TT sistemlerde Ra <= 50V / Ia (RCD varsa Ia = Idn)
  if (systemType.includes("TT")) return (50 / Ia).toFixed(6);
  return 0;
};

// Kablo Koordinasyon Kontrolü (Ib <= In <= Iz)
const checkCableCoordination = (Ib, In, Iz) => {
  const ib = parseDecimal(Ib, null), rated = parseDecimal(In, null), iz = parseDecimal(Iz, null);
  if (ib === null || ib < 0 || !(rated > 0) || !(iz > 0)) return null;
  const valid = ib <= rated && rated <= iz;
  return valid;
};

// --- Ana Uygulama Bileıeni ---

export default function PeriyodikKontrol() {
  const [activeTab, setActiveTab] = useState('grounding'); // 'grounding' (ZPKR01) or 'visual' (ZPKR02)
  const [printMode, setPrintMode] = useState(false);
  const currentReportRef=useRef(null),saveReportBusy=useRef(false);
  const [savedReports,setSavedReports]=useState([]);
  const [showSavedReports,setShowSavedReports]=useState(false);
  const [sharedReportError,setSharedReportError]=useState('');
  // Keep the bundled logo by URL; embedding its full PNG exceeds the private API's 2 MB request limit.
  const [logo, setLogo] = useState(faturaLogo);
  
  // AI State
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [showAiChat, setShowAiChat] = useState(false);
  const [aiChatInput, setAiChatInput] = useState("");
  const [aiChatHistory, setAiChatHistory] = useState([{ role: "system", text: "Merhaba! Ben Elektrik Mevzuat Asistanı. Bana sorular sorabilir veya 'şu verileri ekle:' diyerek toplu veri giri yapabilirsiniz." }]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  // --- Ortak Veri State'i ---
  const [commonData, setCommonData] = useState({
    firmaAdi: "",
    raporNo: "",
    raporTarihi: localISODate(),
    adres: "",
    sozlesmeId: "",
    baslangicTarihi: "",
    bitisTarihi: "",
    sgkNo: "",
    sonrakiTarih: "",
    enerjiSaglayan: "",
    sebekeTipi: "", // TT, TN, TN-C, TN-S, TN-C-S, IT
    projeVarMi: "Belirlenmedi",
    tekHatVarMi: "Belirlenmedi",
    kontrolNedeni: "Periyodik Kontrol",
    topraklayiciTipi: "",
    yapiCinsi: "",
    kullanimAmaci: "",
    sonKontrolTarihi: "",
    kontrolYapanAd: "",
    kontrolYapanUnvan: "",
    kontrolYapanOdaNo: "",
    cihazAdi: "",
    cihazSeriNo: "",
    cihazKalibrasyonTarihi: "",
    kontrolNotlari: "",
    sonucKanaat: "" // Kontrolü yapan uzman tarafından doğrulanır
  });

  // --- Topraklama Raporu Verileri (ZPKR01) ---
  const [groundingMeasurements, setGroundingMeasurements] = useState([
    { id: 1, nokta: '', In: '', egri: '', Ia: '', Ik: '', ZxRx: '', Limit: '', RcdIn: '', RcdIdn: '', RcdTa: '', sonuc: 'Değerlendirilmedi' }
  ]);

  // --- Gözle Kontrol Verileri (ZPKR02) ---
  const [visualChecks, setVisualChecks] = useState({
    fazaErisim: 'Değerlendirilmedi', kabloYalitimi: 'Değerlendirilmedi', kontakGevsekligi: 'Değerlendirilmedi', asiriIsinma: 'Değerlendirilmedi', kisaDevreKapasitesi: 'Değerlendirilmedi', potansiyelDengeleme: 'Değerlendirilmedi', rcdTesti: 'Değerlendirilmedi', kabloKoordinasyonu: 'Değerlendirilmedi', zeminYalitimi: 'Değerlendirilmedi', penKesiti: 'Değerlendirilmedi', peKesiti: 'Değerlendirilmedi'
  });
  const [circuitMeasurements, setCircuitMeasurements] = useState([
    { id: 1, panoAdi: '', linyeNo: '', kabloKesit: '', In: '', Ib: '', Iz: '', voltajFF: '', voltajFN: '', sonuc: 'Değerlendirilmedi' }
  ]);

  // Otomatik scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiChatHistory, showAiChat]);

  // --- Event Handlers ---
  const handleCommonChange = (e) => {
    const { name, value } = e.target;
    setCommonData(prev => ({ ...prev, [name]: value }));
    if (name === 'sebekeTipi') setGroundingMeasurements(previous => previous.map(row => evaluateGrounding({ ...row, sonuc: 'Değerlendirilmedi' }, value)));
  };

  const evaluateGrounding = (row, systemType) => {
    let ia = parseDecimal(row.Ia);
    if (row.RcdIdn) ia = parseDecimal(row.RcdIdn) / 1000;
    else if (['B', 'C', 'D'].includes(row.egri)) ia = calculateIa(row.In, row.egri);
    const limit = parseDecimal(calculateLimit(ia, systemType), null);
    const measured = parseDecimal(row.ZxRx, null);
    const complete = Boolean(row.nokta.trim()) && measured !== null && measured >= 0 && limit > 0 && (!row.RcdIdn || parseDecimal(row.RcdTa, null) > 0);
    const numericPass = complete && measured <= limit;
    return { ...row, Ia: ia > 0 ? String(ia) : '', Limit: limit > 0 ? String(limit) : '', sonuc: row.sonuc === 'Uygun Değil' ? 'Uygun Değil' : !complete ? 'Değerlendirilmedi' : !numericPass ? 'Uygun Değil' : row.sonuc === 'Uygun' ? 'Uygun' : 'Uzman onayı gerekli' };
  };

  const handleGroundingChange = (id, field, value) => {
    setGroundingMeasurements(previous => previous.map(row => row.id === id ? evaluateGrounding({ ...row, [field]: value, sonuc: field === 'sonuc' ? value : 'Değerlendirilmedi' }, commonData.sebekeTipi) : row));
  };

  const addGroundingRow = () => {
    const newId = groundingMeasurements.length > 0 ? Math.max(...groundingMeasurements.map(m => m.id)) + 1 : 1;
    setGroundingMeasurements([...groundingMeasurements, { id: newId, nokta: "", In: "", egri: "", Ia: "", Ik: "", ZxRx: "", Limit: "", RcdIn: "", RcdIdn: "", RcdTa: "", sonuc: "Değerlendirilmedi" }]);
  };

  const handleCircuitChange = (id, field, value) => {
    setCircuitMeasurements(prev => prev.map(item => {
        if (item.id === id) {
            const updated = { ...item, [field]: value };
            if (field === 'Ib' || field === 'In' || field === 'Iz') {
                const isValid = checkCableCoordination(updated.Ib, updated.In, updated.Iz);
                if (isValid === false) updated.sonuc = "Uygun Değil (Kablo-Şalter Uyumsuz)";
                else if (isValid === true) updated.sonuc = "Ön kontrol uygun";
                else updated.sonuc = "Değerlendirilmedi";
            }
            return updated;
        }
        return item;
    }));
  };

  const addCircuitRow = () => {
      const newId = circuitMeasurements.length > 0 ? Math.max(...circuitMeasurements.map(m => m.id)) + 1 : 1;
      setCircuitMeasurements([...circuitMeasurements, { id: newId, panoAdi: "", linyeNo: "", kabloKesit: "", In: "", Ib: "", Iz: "", voltajFF: "", voltajFN: "", sonuc: "Değerlendirilmedi" }]);
  };

  const printReport = () => {
    setPrintMode(true);
    setTimeout(() => {
        window.print();
        setPrintMode(false);
    }, 100);
  };

  const downloadReportPDF = async () => {
    if (!commonData.firmaAdi?.trim() || !commonData.raporNo?.trim() || !commonData.kontrolYapanAd?.trim() || !commonData.sonucKanaat?.trim()) {
      alert('PDF için firma, rapor numarası, kontrolü yapan kişi ve sonuç/kanaat bilgilerini tamamlayın.'); return;
    }
    try {
      await exportHTMLReport({ root: document.getElementById('periodic-control-report'),
        filename: reportFileName(activeTab === 'grounding' ? 'Topraklama_Kontrol_Raporu' : 'Elektrik_Tesisati_Kontrol_Raporu', commonData.raporNo),
        title: activeTab === 'grounding' ? 'Topraklama Kontrol Raporu' : 'Elektrik Tesisatı Kontrol Raporu' });
    } catch (error) { alert('PDF oluşturulamadı: ' + error.message); }
  };

  const generateAIConclusion = () => {
    const rows = activeTab === 'grounding' ? groundingMeasurements : circuitMeasurements;
    const failed = rows.filter(row => row.sonuc.includes('Uygun Değil'));
    const pending = rows.filter(row => row.sonuc !== 'Uygun' && !row.sonuc.includes('Uygun Değil'));
    const visualPending = activeTab === 'visual' ? Object.values(visualChecks).filter(value => !['Uygun', 'Uygulanamaz'].includes(value)).length : 0;
    const text = `${rows.length} ölçüm/kontrol satırı kaydedilmiştir. ${failed.length} satırda uygunsuzluk, ${pending.length} satırda tamamlanmamış değerlendirme vardır.${activeTab === 'visual' ? ' Görsel kontrol listesinde tamamlanmamış veya uygunsuz madde: ' + visualPending + '.' : ''} Bu özet yalnızca girilen kayıtlardan üretilmiştir. Sonuç ve kullanım kararı, gerekli bütün ölçümler ve koruma açma süreleri doğrulandıktan sonra yetkili kontrol uzmanı tarafından yazılmalıdır.`;
    setCommonData(previous => ({ ...previous, sonucKanaat: text }));
  };

  const refreshCompanyReports = async () => {
    const rows=await loadCompanyDocuments('periyodik_rapor');
    setSavedReports(rows.map(row=>({...row.payload,id:row.record_id,_revision:row.revision})));return rows;
  };
  const saveCompanyReport = async () => {
    if(saveReportBusy.current)return;
    if(!commonData.firmaAdi?.trim()||!commonData.raporNo?.trim()){alert('Firma adı ve rapor numarası gereklidir.');return;}
    saveReportBusy.current=true;
    try{
      const current=currentReportRef.current||{id:crypto.randomUUID(),revision:null};currentReportRef.current=current;
      const payload={id:current.id,tarih:new Date().toISOString(),commonData:{...commonData},activeTab,groundingMeasurements,visualChecks,circuitMeasurements,logo};
      const saved=await saveCompanyDocument('periyodik_rapor',current.id,payload,current.revision);currentReportRef.current={id:saved.record_id,revision:saved.revision};
      let refreshed=true;try{await refreshCompanyReports();setSharedReportError('');}catch(error){refreshed=false;setSharedReportError(error.message);}
      alert(refreshed?'Kontrol raporu şirket sunucusuna kaydedildi.':'Kontrol raporu sunucuya kaydedildi; liste yenilenemedi. Şirket raporlarını yeniden açın.');
    }catch(error){setSharedReportError(error.message);alert('Rapor kaydedilemedi: '+error.message+'. Formunuz korunuyor; listeden güncel sürümü açın.');}
    finally{saveReportBusy.current=false;}
  };
  const openCompanyReport = record => {
    if(saveReportBusy.current){alert('Kaydetme işleminin tamamlanmasını bekleyin.');return;}
    if(!record.commonData||!Array.isArray(record.groundingMeasurements)||!Array.isArray(record.circuitMeasurements)||!record.visualChecks){alert('Kayıt içeriği geçersiz.');return;}
    setCommonData(record.commonData);setGroundingMeasurements(record.groundingMeasurements);setCircuitMeasurements(record.circuitMeasurements);setVisualChecks(record.visualChecks);setLogo(record.logo||null);setActiveTab(record.activeTab==='visual'?'visual':'grounding');currentReportRef.current={id:record.id,revision:record._revision};setShowSavedReports(false);
  };
  const listCompanyReports = async () => {try{await refreshCompanyReports();setSharedReportError('');setShowSavedReports(true);}catch(error){setSharedReportError(error.message);alert('Rapor listesi yüklenemedi: '+error.message);}};
  const deleteCompanyReport = async record => {if(!confirm('Bu kontrol raporunu şirket sunucusundan silmek istiyor musunuz?'))return;try{await deleteCompanyDocument('periyodik_rapor',record.id,record._revision);await refreshCompanyReports();if(currentReportRef.current?.id===record.id)currentReportRef.current=null;alert('Kontrol raporu silindi.');}catch(error){alert('Rapor silinemedi: '+error.message+'. Listeyi yenileyin.');}};

  // --- Render Components ---

  const Header = () => (
    <div className="bg-white p-4 border-b border-gray-200 flex justify-between items-center no-print sticky top-0 z-10 shadow-sm">
      <div className="flex items-center gap-2">
        <ShieldCheck className="text-red-600 w-8 h-8" />
        <div>
          <h1 className="text-xl font-bold text-gray-800">Periyodik Kontrol Raporlama Sistemi</h1>
          <p className="text-xs text-gray-500">Ölçüm, muayene ve uzman değerlendirme kaydı</p>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button onClick={saveCompanyReport} className="px-3 py-2 bg-green-700 text-white rounded flex gap-2"><Save size={18}/> Sunucuya Kaydet</button>
        <button onClick={listCompanyReports} className="px-3 py-2 border rounded">Şirket Raporları</button>
        <button onClick={() => {if(saveReportBusy.current){alert('Kaydetme işleminin tamamlanmasını bekleyin.');return;}currentReportRef.current=null;alert('Form yeni bir şirket raporu olarak kaydedilecek.');}} className="px-3 py-2 border rounded">Yeni Kayıt / Kopya</button>
        <button 
          onClick={() => setActiveTab('grounding')} 
          className={`px-4 py-2 rounded-md font-medium transition-colors ${activeTab === 'grounding' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
        >
          Topraklama Raporu (ZPKR01)
        </button>
        <button 
          onClick={() => setActiveTab('visual')} 
          className={`px-4 py-2 rounded-md font-medium transition-colors ${activeTab === 'visual' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
        >
          Gözle Kontrol Raporu (ZPKR02)
        </button>
        <button onClick={printReport} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
          <Printer size={18} /> Yazdır / PDF
        </button>
        <button onClick={downloadReportPDF} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors">
          <FileText size={18} /> PDF İndir
        </button>
      </div>
    </div>
  );

  const InputSection = () => (
    <div className={`p-6 bg-gray-50 max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 no-print ${printMode ? 'hidden' : ''}`}>
      {/* Firma Bilgileri Giriş */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2 flex items-center gap-2">
            <FileText size={18}/> 1. Firma ve Genel Bilgiler
        </h3>
        <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700">Firma Adı</label>
                <input type="text" name="firmaAdi" value={commonData.firmaAdi} onChange={handleCommonChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm border p-2" />
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-700">Rapor No</label>
                <input type="text" name="raporNo" value={commonData.raporNo} onChange={handleCommonChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm border p-2" />
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-700">Rapor Tarihi</label>
                <input type="date" name="raporTarihi" value={commonData.raporTarihi} onChange={handleCommonChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm border p-2" />
            </div>
            <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700">Adres</label>
                <input type="text" name="adres" value={commonData.adres} onChange={handleCommonChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm border p-2" />
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-700">SGK Sicil No</label>
                <input type="text" name="sgkNo" value={commonData.sgkNo} onChange={handleCommonChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm border p-2" />
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-700">Sonraki Kontrol Tarihi</label>
                <input type="date" name="sonrakiTarih" value={commonData.sonrakiTarih} onChange={handleCommonChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm border p-2" />
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-700">Şebeke Tipi</label>
                <select name="sebekeTipi" value={commonData.sebekeTipi} onChange={handleCommonChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm border p-2">
                    <option value="">Seçin</option>
                    <option value="TT">TT</option>
                    <option value="TN">TN</option>
                    <option value="TN-S">TN-S</option>
                    <option value="TN-C">TN-C</option>
                    <option value="TN-C-S">TN-C-S</option>
                    <option value="IT">IT</option>
                </select>
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-700">Topraklayıcı Tipi</label>
                <select name="topraklayiciTipi" value={commonData.topraklayiciTipi} onChange={handleCommonChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm border p-2">
                    <option value="">Seçin</option>
                    <option value="Temel">Temel</option>
                    <option value="Ring">Ring</option>
                    <option value="Yüzeysel">Yüzeysel</option>
                    <option value="Derin">Derin</option>
                    <option value="Belirsiz">Belirlenemedi</option>
                </select>
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-700">Cihaz Seri No</label>
                <input type="text" name="cihazSeriNo" value={commonData.cihazSeriNo} onChange={handleCommonChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm border p-2" />
            </div>
            <div>
                <label className="block text-xs font-medium text-gray-700">Kalibrasyon Tarihi</label>
                <input type="date" name="cihazKalibrasyonTarihi" value={commonData.cihazKalibrasyonTarihi} onChange={handleCommonChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm border p-2" />
            </div>
        </div>
      </div>

      <div className="col-span-full bg-blue-50 border border-blue-200 rounded p-4 text-sm">
        Otomatik değerler yalnızca ön karşılaştırmadır: TN için 230 V / Ia, TT için 50 V / Ia, B/C/D MCB için sırasıyla 5/10/20 × In kullanılır. IT ve ayarlı korumaların açma koşulları üretici verisiyle ayrıca değerlendirilmelidir. RCD açma süresi ve diğer testler kontrol uzmanı tarafından doğrulanır. Boş veya örnek veriyle uygunluk kararı üretilmez.
        <label className="block mt-3 font-medium">Kontrol notları / ortam koşulları</label>
        <textarea name="kontrolNotlari" value={commonData.kontrolNotlari} onChange={handleCommonChange} className="w-full border p-2 rounded mt-1" />
      </div>
      <div className="col-span-full bg-white border rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          ['kontrolYapanAd', 'Kontrolü yapan ad soyad'], ['kontrolYapanUnvan', 'Kontrolü yapan unvan'], ['kontrolYapanOdaNo', 'Oda sicil no'],
          ['yapiCinsi', 'Yapı cinsi'], ['kullanimAmaci', 'Kullanım amacı'], ['cihazAdi', 'Ölçüm cihazı']
        ].map(([name,label]) => <label key={name} className="text-sm">{label}<input name={name} value={commonData[name]} onChange={handleCommonChange} className="mt-1 w-full border rounded p-2" /></label>)}
        {['projeVarMi','tekHatVarMi'].map(name => <label key={name} className="text-sm">{name === 'projeVarMi' ? 'Proje var mı?' : 'Tek hat şeması var mı?'}<select name={name} value={commonData[name]} onChange={handleCommonChange} className="w-full border p-2 mt-1 rounded"><option>Belirlenmedi</option><option>Var</option><option>Yok</option></select></label>)}
      </div>
      {activeTab === 'visual' && <div className="col-span-full bg-white border rounded-lg p-4">
        <h3 className="font-semibold mb-3">Görsel kontrol kayıtları</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {Object.entries({fazaErisim:'Doğrudan dokunmaya karşı koruma',kabloYalitimi:'Kablo / iletken yalıtımı',kontakGevsekligi:'Kontaklar ve korozyon',asiriIsinma:'Aşırı ısınma',kisaDevreKapasitesi:'Kısa devre kesme kapasitesi',potansiyelDengeleme:'Potansiyel dengeleme',rcdTesti:'RCD testleri',kabloKoordinasyonu:'Kablo ve şalter koordinasyonu',zeminYalitimi:'Zemin yalıtımı',penKesiti:'PEN kesiti',peKesiti:'PE kesiti'}).map(([key,label]) => <label key={key} className="text-sm">{label}<select value={visualChecks[key]} onChange={e => setVisualChecks(previous => ({...previous,[key]:e.target.value}))} className="w-full border rounded p-2 mt-1">{['Değerlendirilmedi','Uygun','Uygun Değil','Uygulanamaz'].map(option => <option key={option}>{option}</option>)}</select></label>)}
        </div>
      </div>}
      {/* Dinamik Veri Giriş */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2 flex items-center gap-2">
            <Zap size={18}/> 
            {activeTab === 'grounding' ? 'Ölçüm Verileri (Topraklama)' : 'Fonksiyon Test Verileri'}
        </h3>
        
        {activeTab === 'grounding' ? (
            <div className="space-y-4 max-h-[400px] overflow-y-auto">
                <p className="text-xs text-gray-500 bg-blue-50 p-2 rounded">
                    İpucu: In (Akım) ve Eğri (B,C,D) girildiğinde veya RCD mA girildiğinde Sınır değerler otomatik hesaplanır.
                </p>
                {groundingMeasurements.map((row, idx) => (
                    <div key={row.id} className="p-3 bg-gray-50 rounded border border-gray-200 text-xs">
                        <div className="flex justify-between mb-2 font-bold text-gray-700">
                            <span>#{idx + 1} Ölçüm Noktası</span>
                            <span className={row.sonuc === 'Uygun' ? 'text-green-600' : row.sonuc === 'Uygun Değil' ? 'text-red-600' : 'text-gray-600'}>{row.sonuc}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                            <input placeholder="Nokta Adı" value={row.nokta || ""} onChange={(e) => handleGroundingChange(row.id, 'nokta', e.target.value)} className="border p-1 rounded" />
                            <input placeholder="In (A)" type="number" value={row.In || ""} onChange={(e) => handleGroundingChange(row.id, 'In', e.target.value)} className="border p-1 rounded" />
                            <select value={row.egri || ""} onChange={(e) => handleGroundingChange(row.id, 'egri', e.target.value)} className="border p-1 rounded">
                                <option value="">Eğri Seç</option>
                                <option value="B">B</option>
                                <option value="C">C</option>
                                <option value="D">D</option>
                                <option value="TMŞ">TMŞ / Ayarlı (Ia manuel)</option>
                            </select>
                            <input placeholder="Ia (A), üretici açma akımı" type="number" value={row.Ia || ""} onChange={(e) => handleGroundingChange(row.id, 'Ia', e.target.value)} className="border p-1 rounded" />
                            <input placeholder="RCD IΔn (mA)" type="number" value={row.RcdIdn || ""} onChange={(e) => handleGroundingChange(row.id, 'RcdIdn', e.target.value)} className="border p-1 rounded" />
                        </div>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                            <input placeholder="RCD Zaman (ms)" type="number" value={row.RcdTa || ""} onChange={(e) => handleGroundingChange(row.id, 'RcdTa', e.target.value)} className="border p-1 rounded" />
                             <input placeholder="Toprak Kısa Devre Ik (A)" type="number" value={row.Ik || ""} onChange={(e) => handleGroundingChange(row.id, 'Ik', e.target.value)} className="border p-1 rounded" />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <div className="flex flex-col">
                                <span className="text-[10px] text-gray-500">Ölçülen (Ω)</span>
                                <input placeholder="Zx / Rx" value={row.ZxRx || ""} onChange={(e) => handleGroundingChange(row.id, 'ZxRx', e.target.value)} className="border p-1 rounded" />
                            </div>
                             <div className="flex flex-col">
                                <span className="text-[10px] text-gray-500">Sınır (Ω)</span>
                                <input placeholder="Limit" value={row.Limit || ""} readOnly className="border p-1 rounded bg-gray-100 cursor-not-allowed" />
                            </div>
                            <select value={row.sonuc || "Değerlendirilmedi"} onChange={(e) => handleGroundingChange(row.id, 'sonuc', e.target.value)} className="border p-1 rounded mt-auto h-8">
                                <option value="Değerlendirilmedi">Değerlendirilmedi</option>
                          <option value="Uzman onayı gerekli">Uzman onayı gerekli</option>
                          <option value="Uygun">Uygun</option>
                                <option value="Uygun Değil">Uygun Değil</option>
                            </select>
                        </div>
                    </div>
                ))}
                <button onClick={addGroundingRow} className="w-full py-2 bg-green-500 text-white rounded text-sm hover:bg-green-600">+ Yeni Ölçüm Ekle</button>
            </div>
        ) : (
            <div className="space-y-4 max-h-[400px] overflow-y-auto">
                 <p className="text-xs text-gray-500 bg-blue-50 p-2 rounded">
                    İpucu: Ib (Yük), In (Sigorta), Iz (Kablo) değerleri girildiğinde koordinasyon (Ib &le; In &le; Iz) otomatik kontrol edilir.
                </p>
                {circuitMeasurements.map((row, idx) => (
                    <div key={row.id} className="p-3 bg-gray-50 rounded border border-gray-200 text-xs">
                        <div className="flex justify-between mb-2 font-bold text-gray-700">
                             <span>#{idx + 1} Devre Kontrolü</span>
                             <span className={row.sonuc === 'Uygun' ? 'text-green-600' : row.sonuc.includes('Uygun Değil') ? 'text-red-600' : 'text-gray-600'}>{row.sonuc.includes('Uygun Değil') ? 'UYGUNSUZ' : row.sonuc === 'Uygun' ? 'UYGUN' : row.sonuc}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                             <input placeholder="Pano Adı" value={row.panoAdi || ""} onChange={(e) => handleCircuitChange(row.id, 'panoAdi', e.target.value)} className="border p-1 rounded" />
                             <input placeholder="Linye No" value={row.linyeNo || ""} onChange={(e) => handleCircuitChange(row.id, 'linyeNo', e.target.value)} className="border p-1 rounded" />
                        </div>
                        <div className="grid grid-cols-3 gap-2 mb-2">
                             <input placeholder="Kablo mm²" value={row.kabloKesit || ""} onChange={(e) => handleCircuitChange(row.id, 'kabloKesit', e.target.value)} className="border p-1 rounded" />
                             <input placeholder="Ib (Yük A)" type="number" value={row.Ib || ""} onChange={(e) => handleCircuitChange(row.id, 'Ib', e.target.value)} className="border p-1 rounded" />
                             <input placeholder="In (Sigorta A)" type="number" value={row.In || ""} onChange={(e) => handleCircuitChange(row.id, 'In', e.target.value)} className="border p-1 rounded" />
                        </div>
                         <div className="grid grid-cols-3 gap-2 mb-2">
                            <input placeholder="Iz (Kablo Akım A)" type="number" value={row.Iz || ""} onChange={(e) => handleCircuitChange(row.id, 'Iz', e.target.value)} className="border p-1 rounded" />
                            <input placeholder="Volt (F-F)" type="number" value={row.voltajFF || ""} onChange={(e) => handleCircuitChange(row.id, 'voltajFF', e.target.value)} className="border p-1 rounded" />
                            <input placeholder="Volt (F-N)" type="number" value={row.voltajFN || ""} onChange={(e) => handleCircuitChange(row.id, 'voltajFN', e.target.value)} className="border p-1 rounded" />
                        </div>
                        <div className="grid grid-cols-1">
                             <input placeholder="Sonuç Notu" value={row.sonuc || ""} onChange={(e) => handleCircuitChange(row.id, 'sonuc', e.target.value)} className="border p-1 rounded w-full" />
                        </div>
                    </div>
                ))}
                <button onClick={addCircuitRow} className="w-full py-2 bg-green-500 text-white rounded text-sm hover:bg-green-600">+ Yeni Devre Ekle</button>
            </div>
        )}
      </div>

      {/* AI Sonuç Bölümü */}
      <div className="col-span-1 md:col-span-2 bg-white p-4 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 border-b pb-2 flex items-center gap-2">
             <CheckCircle size={18}/> 8. & 10. Sonuç ve Kanaat (Uzman Değerlendirmesi)
          </h3>
          <div className="flex gap-2 mb-2">
              <button 
                onClick={generateAIConclusion} 
                disabled={isAiGenerating}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                  {isAiGenerating ? (
                      <span className="flex items-center gap-2"><div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"/> Analiz Ediliyor...</span>
                  ) : (
                      <><Sparkles size={18}/> Kayıtlardan Özet Oluştur</>
                  )}
              </button>
              <div className="text-xs text-gray-500 self-center">Girilen kayıtlardan düzenlenebilir bir özet çıkarır; kullanım kararını kontrol uzmanı yazar.</div>
          </div>
          <textarea 
            className="w-full h-32 p-2 border rounded-md text-sm"
            value={commonData.sonucKanaat}
            onChange={(e) => setCommonData(prev => ({ ...prev, sonucKanaat: e.target.value }))}
            placeholder="Otomatik oluşturulan veya manuel girilen sonuç metni burada görünecek..."
          />
      </div>
    </div>
  );

  // --- REPORT TEMPLATE: AG TOPRAKLAMA (ZPKR01) ---
  const GroundingReportTemplate = () => (
    <div className="bg-white mx-auto my-8 p-8 shadow-lg max-w-[210mm] min-h-[297mm] print:shadow-none print:m-0 print:w-full print:max-w-none text-[10px] leading-tight font-sans">
        
        {/* HEADER */}
        <div className="border-2 border-black mb-2">
            <div className="flex border-b border-black">
                <div className="w-1/4 p-2 border-r border-black flex items-center justify-center">
                    {logo ? (
                      <img src={logo} alt="VoltGuard Logo" className="h-16 max-w-[80px] object-contain" />
                    ) : (
                      <div className="font-bold text-center text-[9px]">
                        VoltGuard<br/>Kontrol Raporu
                      </div>
                    )}
                </div>
                <div className="w-1/2 p-2 flex items-center justify-center font-bold text-lg text-center">
                    ALÇAK GERİLİM TOPRAKLAMA TESİSATI<br/>PERİYODİK KONTROL RAPORU
                </div>
                <div className="w-1/4 p-1 text-[9px] flex flex-col justify-center">
                    <div className="flex justify-between"><span>Doküman Kodu:</span><span>ZPKR01</span></div>
                    <div className="flex justify-between"><span>Yayım Tarihi:</span><span>{commonData.raporTarihi}</span></div>
                    <div className="flex justify-between"><span>Revizyon No:</span><span>00</span></div>
                    <div className="flex justify-between"><span>Yürürlük Tarihi:</span><span>{commonData.raporTarihi}</span></div>
                </div>
            </div>
        </div>

        {/* 1. FİRMA BİLGİLERİ */}
        <div className="mb-2 border border-black">
            <div className="bg-gray-200 font-bold p-1 border-b border-black">1. FİRMA BİLGİLERİ</div>
            <div className="grid grid-cols-2">
                <div className="p-1 border-r border-b border-black flex"><span className="w-24 font-semibold">Firma Adı:</span> {commonData.firmaAdi}</div>
                <div className="p-1 border-b border-black flex"><span className="w-24 font-semibold">Rapor Numarası:</span> {commonData.raporNo}</div>
                
                <div className="p-1 border-r border-b border-black flex"><span className="w-24 font-semibold">Adres:</span> {commonData.adres}</div>
                <div className="p-1 border-b border-black flex"><span className="w-24 font-semibold">Rapor Tarihi:</span> {commonData.raporTarihi}</div>

                <div className="p-1 border-r border-b border-black flex"><span className="w-24 font-semibold">SGK Sicil No:</span> {commonData.sgkNo}</div>
                <div className="p-1 border-b border-black flex"><span className="w-24 font-semibold">Sonraki Kontrol:</span> {commonData.sonrakiTarih}</div>
            </div>
            <div className="p-1 text-[9px] italic">
                Kapsam: TS HD 60364-4-41, TS HD 60364-6, Elektrik Tesislerinde Topraklamalar Yönetmeliği
            </div>
        </div>

        {/* 2. EKİPMAN BİLGİLERİ */}
        <div className="mb-2 border border-black">
            <div className="bg-gray-200 font-bold p-1 border-b border-black">2. EKİPMAN BİLGİLERİ</div>
            <div className="grid grid-cols-4 gap-1 p-1">
                <div className="col-span-2">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold">Şebeke Tipi:</span>
                        <div className="flex gap-2">
                            {['TT', 'TN', 'TN-C', 'TN-S', 'TN-C-S', 'IT'].map(type => (
                                <span key={type} className={`flex items-center gap-1 ${commonData.sebekeTipi === type ? 'font-bold underline' : ''}`}>
                                    {commonData.sebekeTipi === type ? '☑' : '☐'} {type}
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="flex gap-4">
                        <span><span className="font-semibold">Proje:</span> {commonData.projeVarMi}</span>
                        <span><span className="font-semibold">Tek Hat:</span> {commonData.tekHatVarMi}</span>
                    </div>
                </div>
                <div className="col-span-2">
                     <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold">Topraklayıcı:</span>
                         <div className="flex gap-2">
                             {['Temel', 'Ring', 'Yüzeysel', 'Derin'].map(type => (
                                <span key={type} className={`flex items-center gap-1 ${commonData.topraklayiciTipi === type ? 'font-bold' : ''}`}>
                                    {commonData.topraklayiciTipi === type ? '☑' : '☐'} {type}
                                </span>
                             ))}
                        </div>
                     </div>
                     <div className="flex gap-4">
                        <span><span className="font-semibold">Yapı:</span> {commonData.yapiCinsi}</span>
                        <span><span className="font-semibold">Amaç:</span> {commonData.kullanimAmaci}</span>
                    </div>
                </div>
            </div>
        </div>

        {/* 3. ÖLÇÜM ALETLERİ */}
        <div className="mb-2 border border-black">
             <div className="bg-gray-200 font-bold p-1 border-b border-black">3. ÖLÇÜM ALETLERİ BİLGİLERİ</div>
             <table className="w-full text-center">
                 <thead>
                     <tr className="bg-gray-100 border-b border-black">
                         <th className="border-r border-black p-1">Cihaz Adı</th>
                         <th className="border-r border-black p-1">Seri Numarası</th>
                         <th className="border-r border-black p-1">Kalibrasyon Tarihi</th>
                         <th className="p-1">Geçerlilik Tarihi</th>
                     </tr>
                 </thead>
                 <tbody>
                     <tr>
                         <td className="border-r border-black p-1">{commonData.cihazAdi}</td>
                         <td className="border-r border-black p-1">{commonData.cihazSeriNo || '-'}</td>
                         <td className="border-r border-black p-1">{commonData.cihazKalibrasyonTarihi || '-'}</td>
                         <td className="p-1">-</td>
                     </tr>
                 </tbody>
             </table>
        </div>

        {/* 4. & 5. TEST DEĞERLERİ VE KRİTERLER */}
        <div className="mb-2 border border-black">
            <div className="bg-gray-200 font-bold p-1 border-b border-black">4. TEST DEĞERLERİ VE 5. KONTROL KRİTERLERİ</div>
            <div className="p-1 mb-1 text-[9px]">
                <strong>Zx:</strong> Ölçülen Çevrim Empedansı, <strong>Zs:</strong> Sınır değer, <strong>Ra:</strong> Ölçülen Toprak Direnci, <strong>Ia:</strong> Açma Akımı
            </div>
            <table className="w-full text-center border-t border-black text-[9px]">
                <thead>
                    <tr className="bg-gray-100 border-b border-black">
                        <th className="border-r border-black p-1 w-8">No</th>
                        <th className="border-r border-black p-1 text-left">Ölçüm Noktası / Etiket</th>
                        <th className="border-r border-black p-1 w-10">In (A)</th>
                        <th className="border-r border-black p-1 w-10">Eğri</th>
                        <th className="border-r border-black p-1 w-12">Ia (A)</th>
                        <th className="border-r border-black p-1 w-12 bg-yellow-50">Ölçülen<br/>Zx/Rx (Ω)</th>
                        <th className="border-r border-black p-1 w-12 bg-blue-50">Sınır<br/>Zs/Ra (Ω)</th>
                        <th className="border-r border-black p-1 w-20">RCD IΔn (mA)</th>
                        <th className="border-r border-black p-1 w-12">RCD<br/>Zaman (ms)</th>
                        <th className="p-1 w-20">Sonuç</th>
                    </tr>
                </thead>
                <tbody>
                    {groundingMeasurements.map((row, idx) => (
                        <tr key={row.id} className="border-b border-gray-300">
                            <td className="border-r border-black p-1">{idx + 1}</td>
                            <td className="border-r border-black p-1 text-left">{row.nokta}</td>
                            <td className="border-r border-black p-1">{row.In}</td>
                            <td className="border-r border-black p-1">{row.egri}</td>
                            <td className="border-r border-black p-1">{row.Ia}</td>
                            <td className="border-r border-black p-1 font-bold">{row.ZxRx}</td>
                            <td className="border-r border-black p-1">{row.Limit}</td>
                            <td className="border-r border-black p-1">{row.RcdIdn}</td>
                            <td className="border-r border-black p-1">{row.RcdTa}</td>
                            <td className={`p-1 font-bold ${row.sonuc === 'Uygun' ? 'text-green-700' : row.sonuc === 'Uygun Değil' ? 'text-red-600' : 'text-gray-600'}`}>
                                {row.sonuc}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>

        {/* 6. KUSUR AÇIKLAMALARI ve 7. NOTLAR */}
        <div className="grid grid-cols-2 gap-2 mb-2 min-h-32">
             <div className="border border-black p-1">
                 <div className="font-bold underline mb-1">6. KUSUR AÇIKLAMALARI</div>
                 <ul className="list-disc pl-4">
                     {groundingMeasurements.filter(m => m.sonuc.includes('Uygun Değil')).map(m => (
                         <li key={m.id}>Nokta {m.id}: Sınır değer aşıldı veya koruma elemanı uyumsuz.</li>
                     ))}
                 </ul>
             </div>
             <div className="border border-black p-1">
                 <div className="font-bold underline mb-1">7. NOTLAR</div>
                 <p>{commonData.kontrolNotlari || "Kontrol notu girilmedi."}</p>
             </div>
        </div>

        {/* 8. SONUÇ VE KANAAT */}
        <div className="mb-4 border border-black p-2 bg-gray-50">
            <div className="font-bold mb-2">8. SONUÇ VE KANAAT</div>
            <p className="text-justify mb-2 text-sm">
                {commonData.sonucKanaat || "Uzman sonucu ve kanaati henüz girilmedi."}
            </p>
            <div className="flex justify-center gap-8 font-bold text-lg my-2">
                <span className={groundingMeasurements.length > 0 && groundingMeasurements.every(m => m.sonuc === 'Uygun') ? "border-2 border-green-600 p-2 text-green-700" : "text-gray-400"}>UYGUNDUR</span>
                <span className={groundingMeasurements.some(m => m.sonuc.includes('Uygun Değil')) ? "border-2 border-red-600 p-2 text-red-700" : "text-gray-400"}>UYGUN DEĞİLDİR</span>
            </div>
            <p className="text-[9px] mt-2">
                * Tespit edilen hafif kusurların bir sonraki periyodik kontrol tarihine kadar giderilmesi gereklidir.
                ** Aır kusur durumunda tesisatın enerjilendirilmesi tehlikelidir.
            </p>
        </div>

        {/* 9. ONAY */}
        <div className="border border-black flex">
            <div className="w-1/2 p-2 border-r border-black text-center">
                 <div className="font-bold mb-8">Kontrolü Yapan</div>
                 <div>{commonData.kontrolYapanAd || "Ad Soyad Giriniz"}</div>
                 <div>{commonData.kontrolYapanUnvan}</div>
                 <div>Oda Sicil No: {commonData.kontrolYapanOdaNo}</div>
                 <div className="mt-4 border-t w-1/2 mx-auto pt-1">İmza</div>
            </div>
             <div className="w-1/2 p-2 text-center">
                 <div className="font-bold mb-8">Onaylayan (İşveren/Vekili)</div>
                 <div className="mt-12 border-t w-1/2 mx-auto pt-1">İmza / Kaşe</div>
            </div>
        </div>
    </div>
  );

  // --- REPORT TEMPLATE: GÖZLE KONTROL (ZPKR02) ---
  const VisualReportTemplate = () => (
     <div className="bg-white mx-auto my-8 p-8 shadow-lg max-w-[210mm] min-h-[297mm] print:shadow-none print:m-0 print:w-full print:max-w-none text-[10px] leading-tight font-sans">
        {/* HEADER */}
        <div className="border-2 border-black mb-2">
            <div className="flex border-b border-black">
                <div className="w-1/4 p-2 border-r border-black flex items-center justify-center">
                    {logo ? (
                      <img src={logo} alt="VoltGuard Logo" className="h-16 max-w-[80px] object-contain" />
                    ) : (
                      <div className="font-bold text-center text-[9px]">
                        VoltGuard<br/>Kontrol Raporu
                      </div>
                    )}
                </div>
                <div className="w-1/2 p-2 flex items-center justify-center font-bold text-lg text-center">
                    ELEKTRİK İÇ TESİSATI GÖZLE KONTROL VE<br/>FONKSİYON TESTLERİ RAPORU
                </div>
                <div className="w-1/4 p-1 text-[9px] flex flex-col justify-center">
                     <div className="flex justify-between"><span>Doküman Kodu:</span><span>ZPKR02</span></div>
                    <div className="flex justify-between"><span>Yayım Tarihi:</span><span>{commonData.raporTarihi}</span></div>
                </div>
            </div>
        </div>

        {/* 1. FİRMA BİLGİLERİ */}
        <div className="mb-2 border border-black">
            <div className="bg-gray-200 font-bold p-1 border-b border-black">1. FİRMA BİLGİLERİ</div>
            <div className="grid grid-cols-2">
                <div className="p-1 border-r border-b border-black flex"><span className="w-24 font-semibold">Firma Adı:</span> {commonData.firmaAdi}</div>
                <div className="p-1 border-b border-black flex"><span className="w-24 font-semibold">Rapor No:</span> {commonData.raporNo}</div>
                <div className="p-1 border-r border-black flex"><span className="w-24 font-semibold">Adres:</span> {commonData.adres}</div>
                 <div className="p-1 flex"><span className="w-24 font-semibold">Tarih:</span> {commonData.raporTarihi}</div>
            </div>
        </div>

        {/* 5. KONTROL KRİTERLERİ VE TESTLER (CHECKLIST) */}
        <div className="mb-2 border border-black">
            <div className="bg-gray-200 font-bold p-1 border-b border-black">5. GÖZLE KONTROL LİSTESİ (ÖZET)</div>
            <table className="w-full text-[9px]">
                <tbody>
                    {[
                        { label: "Pano ve Donanımlara Giriçin Uygunluıu", key: "fazaErisim" },
                        { label: "Faza Erim Engeli (IP 2X) / Doırudan Dokunmaya Karı Koruma", key: "fazaErisim" },
                        { label: "Kablo ve ıletken Renk Kodları / Tanımlamalar", key: "kabloYalitimi" },
                        { label: "Kontak Gevçekli ve Korozyon Kontrolü", key: "kontakGevsekligi" },
                        { label: "Aırı Yük Isınması (Termal Kontrol)", key: "asiriIsinma" },
                        { label: "Kısa Devre Kesme Kapasitesi Uygunluşu (Icu > Ik)", key: "kisaDevreKapasitesi" },
                        { label: "Potansiyel Dengeleme ıletkenleri", key: "potansiyelDengeleme" },
                        { label: "RCD Performans Testleri", key: "rcdTesti" },
                        { label: "Kablo - Şalter Koordinasyonu (Ib < In < Iz)", key: "kabloKoordinasyonu" },
                    ].map((item, i) => (
                        <tr key={i} className="border-b border-gray-300">
                            <td className="p-1 border-r border-gray-300 w-3/4">{item.label}</td>
                            <td className="p-1 font-bold text-center">{visualChecks[item.key] || "Değerlendirilmedi"}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>

        {/* 6. FONKSİYON KONTROL KRİTERLERİ VE TESTLER */}
        <div className="mb-2 border border-black">
            <div className="bg-gray-200 font-bold p-1 border-b border-black">6. FONKSİYON VE KOORDİNASYON TESTLERİ</div>
            <table className="w-full text-center text-[9px]">
                <thead>
                    <tr className="bg-gray-100 border-b border-black">
                        <th className="border-r border-black p-1">No</th>
                        <th className="border-r border-black p-1">Pano / Linye</th>
                        <th className="border-r border-black p-1">Kablo (mm²)</th>
                        <th className="border-r border-black p-1">Ib (Yük A)</th>
                        <th className="border-r border-black p-1">In (Sigorta A)</th>
                        <th className="border-r border-black p-1 bg-yellow-50">Iz (Kablo Akım A)</th>
                        <th className="border-r border-black p-1">Voltaj (F-N)</th>
                        <th className="p-1">Sonuç</th>
                    </tr>
                </thead>
                <tbody>
                    {circuitMeasurements.map((row, idx) => (
                        <tr key={row.id} className="border-b border-gray-300">
                             <td className="border-r border-black p-1">{idx + 1}</td>
                             <td className="border-r border-black p-1 text-left">{row.panoAdi} / {row.linyeNo}</td>
                             <td className="border-r border-black p-1">{row.kabloKesit}</td>
                             <td className="border-r border-black p-1">{row.Ib}</td>
                             <td className="border-r border-black p-1">{row.In}</td>
                             <td className="border-r border-black p-1 font-bold">{row.Iz}</td>
                             <td className="border-r border-black p-1">{row.voltajFN}</td>
                             <td className={`p-1 font-bold ${row.sonuc === 'Uygun' ? 'text-green-700' : row.sonuc.includes('Uygun Değil') ? 'text-red-600' : 'text-gray-600'}`}>
                                 {row.sonuc.includes('Uygun Değil') ? 'UYGUNSUZ' : row.sonuc === 'Uygun' ? 'UYGUN' : row.sonuc}
                             </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
        
         {/* 10. SONUı */}
        <div className="mb-4 border border-black p-2 bg-gray-50">
            <div className="font-bold mb-2">10. SONUı VE KANAAT</div>
            <p className="text-justify mb-2 text-sm">
                {commonData.sonucKanaat || "Uzman sonucu ve kanaati henüz girilmedi."}
            </p>
             <div className="flex justify-center gap-8 font-bold text-lg my-2">
                <span className={circuitMeasurements.length > 0 && circuitMeasurements.every(m => m.sonuc === 'Uygun') && Object.values(visualChecks).every(value => ['Uygun', 'Uygulanamaz'].includes(value)) ? "border-2 border-green-600 p-2 text-green-700" : "text-gray-400"}>KULLANIMI UYGUNDUR</span>
                <span className={circuitMeasurements.some(m => m.sonuc.includes('Uygun Değil')) ? "border-2 border-red-600 p-2 text-red-700" : "text-gray-400"}>KULLANIMI UYGUN DEĞİLDİR</span>
            </div>
        </div>

         {/* 11. ONAY */}
        <div className="border border-black flex">
            <div className="w-1/2 p-2 border-r border-black text-center">
                 <div className="font-bold mb-8">Kontrolü Yapan</div>
                 <div>{commonData.kontrolYapanAd || "Ad Soyad Giriniz"}</div>
                 <div>{commonData.kontrolYapanUnvan}</div>
                 <div className="mt-4 border-t w-1/2 mx-auto pt-1">İmza</div>
            </div>
             <div className="w-1/2 p-2 text-center">
                 <div className="font-bold mb-8">İşveren Yetkilisi</div>
                 <div className="mt-12 border-t w-1/2 mx-auto pt-1">İmza</div>
            </div>
        </div>
     </div>
  );

  // --- JSX Return ---
  return (
    <div className="min-h-screen bg-gray-100 font-sans relative">
      {Header()}
      {sharedReportError && <p role="alert" className="bg-red-50 text-red-800 p-4">Şirket rapor kaydına erişilemedi: {sharedReportError}</p>}
      {showSavedReports && <div className="fixed inset-0 bg-black/50 z-50 p-6 flex items-center justify-center"><div className="bg-white rounded-lg p-6 max-w-3xl w-full max-h-[80vh] overflow-auto"><div className="flex justify-between mb-4"><h2 className="font-bold text-xl">Şirket Kontrol Raporları</h2><button onClick={()=>setShowSavedReports(false)} className="border rounded p-2">Kapat</button></div>{savedReports.length===0?<p>Sunucuda henüz kayıt yok. Firma ve rapor numarasını girerek Sunucuya Kaydet düğmesini kullanın.</p>:savedReports.map(record=><div key={record.id} className="border rounded p-3 mb-2 flex justify-between gap-4 items-center"><div><strong>{record.commonData?.firmaAdi||'Firma belirtilmedi'}</strong><p className="text-sm">Rapor: {record.commonData?.raporNo||'Belirtilmedi'} · {record.commonData?.raporTarihi||'Tarih belirtilmedi'} · Sürüm {record._revision}</p></div><div className="flex gap-2"><button onClick={()=>openCompanyReport(record)} className="border rounded p-2">Aç</button><button onClick={()=>deleteCompanyReport(record)} className="border text-red-700 rounded p-2">Sil</button></div></div>)}</div></div>}

      
      {/* Veri Giriş Alanı */}
      {InputSection()}

      {/* Rapor ınizleme Alanı */}
      <div className="p-8 overflow-x-auto flex justify-center bg-gray-200 print:bg-white print:p-0">
         <div id="periodic-control-report" className="transform scale-100 origin-top print:transform-none">
            {activeTab === 'grounding' ? GroundingReportTemplate() : VisualReportTemplate()}
         </div>
      </div>

      {/* Print Styles */}
      <style jsx>{`
        @media print {
          .print-mode {
            background: white;
          }
          .no-print, header, .print\\:hidden {
            display: none !important;
          }
          table {
            page-break-inside: avoid;
          }
        }
      `}</style>
    </div>
  );
}

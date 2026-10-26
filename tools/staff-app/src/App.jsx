import { privateStorage as localStorage } from './privateStorage';
import React, { useState, useMemo, useRef, lazy, Suspense } from 'react';
import { Calculator, FileText, Settings, Search, Save, Download, Printer, X, Edit3, ChevronRight, CheckCircle, Lightbulb, Zap, Mail, TrendingDown, RefreshCw, UserPlus, Users, MapPin, Percent, UploadCloud, Sparkles, Copy, Type, Bold, Italic, AlignLeft, AlignCenter, AlignRight, FileSpreadsheet, Hammer, Plus, Trash2, Cable, Wrench, Clock, Star, Banknote, Menu, ExternalLink, Fuel, Briefcase, BarChart3, Package } from 'lucide-react';
import { useAuth } from './SimpleAuth';
import { PORTAL_MODULES, initialPortalModule } from './PortalNavigation';
import { createReportPDF, exportHTMLReport, reportFileName } from './pdfReport';
import * as XLSX from 'xlsx';
import { calculateYGQuote, calculatePeriodicQuote, normalizeProposal, cloneProposal, newDraftReference, normalizeKesifSnapshot } from './proposalSnapshots.mjs';
import { saleLineTotal, saleUnitPrice, roundMoney, parseDecimal, localISODate } from './operations.mjs';
import { sanitizeReportHTML, pasteReportHTML, reportHTMLWithReference } from './safeReportHTML.mjs';
import { supabase } from './supabaseClient';
import { historicalInvoice1 as FaturaData, historicalInvoice2 as FaturaData2, cablePrices as KabloFiyatData, packages as HazirPaketler } from './catalogData';
import { normalizeHistoricalInvoice } from './historicalCatalog.mjs';
import CompanyDashboard from './CompanyDashboard.jsx';
import { calculateGESQuote } from './gesQuote.mjs';
import {
  COMPANY_ADDRESS_LINE_1,
  COMPANY_ADDRESS_LINE_2,
  COMPANY_CONTACT_LINE,
  COMPANY_EMAIL_WEBSITE_LINE,
  COMPANY_LEGAL_NAME,
  COMPANY_NAME,
  COMPANY_PHONE,
  COMPANY_PHONE_ADDRESS_LINE
} from './companyInfo';
const faturaLogo = '/calisan/uygulama/fatura_logo.png';
// Load operational workspaces only when the employee opens them.
const BordroWithPassword = lazy(() => import('./BordroWithPassword.jsx').then(module => ({ default: module.BordroWithPassword })));
const BeyazYakaBordro = lazy(() => import('./BeyazYakaBordro.tsx'));
const KesifMetraj = lazy(() => import('./KesifMetraj.jsx'));
const GorevTakip = lazy(() => import('./GorevTakip.jsx'));
const Osos = lazy(() => import('./Osos.jsx'));
const AkaryakitTakip = lazy(() => import('./AkaryakitTakip.jsx'));
const IsTakip = lazy(() => import('./IsTakip.jsx'));
const HaftalikRaporlama = lazy(() => import('./HaftalikRaporlama.jsx'));
const UrunTakip = lazy(() => import('./UrunTakip.jsx'));
const PeriyodikKontrol = lazy(() => import('./PeriyodikKontrol.jsx'));
const SimpleAdminPanel = lazy(() => import('./SimpleAdminPanel.jsx'));
const ModuleLoading = () => <div role="status" aria-live="polite" className="p-6 bg-white rounded-lg border border-gray-200">Bölüm yükleniyor…</div>;

// Fatura verilerini birleitir ve normalize et
const normalizedFatura1 = normalizeHistoricalInvoice(FaturaData,'Fatura1');
const normalizedFatura2 = normalizeHistoricalInvoice(FaturaData2,'Fatura2');

// Tüm fatura verilerini birleitir
const CombinedFaturaData = [...normalizedFatura1, ...normalizedFatura2];

// EMO 2026 Bölgesel Azaltma Katsayilari Listesi (Sabit Veri)
const REGION_LIST = [
  { name: "Adana (Merkez)", coeff: 1.00 },
  { name: "Adana (Çevre İlçeler)", coeff: 0.75 },
  { name: "Adıyaman", coeff: 0.75 },
  { name: "Afyon", coeff: 0.60 },
  { name: "Ağrı", coeff: 0.75 },
  { name: "Aksaray", coeff: 0.60 },
  { name: "Amasya", coeff: 0.75 },
  { name: "Ankara (Büyükşehir)", coeff: 1.00 },
  { name: "Antalya (Merkez)", coeff: 1.00 },
  { name: "Alanya", coeff: 1.00 },
  { name: "Artvin", coeff: 0.75 },
  { name: "Aydın (Merkez)", coeff: 1.00 },
  { name: "Aydın (Diğer İlçeler)", coeff: 0.75 },
  { name: "Balıkesir", coeff: 0.75 },
  { name: "Bartın", coeff: 0.75 },
  { name: "Batman", coeff: 0.75 },
  { name: "Bayburt", coeff: 0.75 },
  { name: "Bilecik", coeff: 0.75 },
  { name: "Bingöl", coeff: 0.75 },
  { name: "Bitlis", coeff: 0.75 },
  { name: "Bolu", coeff: 0.75 },
  { name: "Burdur", coeff: 0.75 },
  { name: "Bursa (Merkez)", coeff: 1.00 },
  { name: "Çanakkale", coeff: 0.75 },
  { name: "Çankırı", coeff: 0.60 },
  { name: "Çorum", coeff: 0.75 },
  { name: "Denizli (Merkez)", coeff: 1.00 },
  { name: "Diyarbakır (Merkez)", coeff: 1.00 },
  { name: "Düzce", coeff: 0.75 },
  { name: "Elazığ", coeff: 0.75 },
  { name: "Erzincan", coeff: 0.60 },
  { name: "Erzurum (Büyükşehir)", coeff: 0.75 },
  { name: "Eskişehir (Merkez)", coeff: 1.00 },
  { name: "Gaziantep (Merkez)", coeff: 1.00 },
  { name: "Giresun", coeff: 0.75 },
  { name: "Gümüşhane", coeff: 0.75 },
  { name: "Hakkari", coeff: 0.75 },
  { name: "Hatay", coeff: 1.00 },
  { name: "Iğdır", coeff: 0.75 },
  { name: "Isparta", coeff: 1.00 },
  { name: "İstanbul", coeff: 1.00 },
  { name: "İzmir (Merkez İlçeler)", coeff: 1.00 },
  { name: "İzmir (Aliağa/Kemalpaşa/Ödemiş)", coeff: 1.00 },
  { name: "İzmir (Diğer İlçeler)", coeff: 0.75 },
  { name: "K.Maraş", coeff: 0.75 },
  { name: "Karabük", coeff: 0.75 },
  { name: "Karaman", coeff: 0.75 },
  { name: "Kars", coeff: 0.75 },
  { name: "Kastamonu", coeff: 0.60 },
  { name: "Kayseri (Büyükşehir)", coeff: 0.75 },
  { name: "Kırıkkale", coeff: 0.60 },
  { name: "Kırşehir", coeff: 0.60 },
  { name: "Kilis", coeff: 0.75 },
  { name: "Kocaeli (Merkez)", coeff: 1.00 },
  { name: "Konya (Büyükşehir)", coeff: 0.75 },
  { name: "Kütahya", coeff: 0.75 },
  { name: "Malatya", coeff: 0.75 },
  { name: "Manisa (Merkez/Akhisar)", coeff: 1.00 },
  { name: "Manisa (Diğer İlçeler)", coeff: 0.75 },
  { name: "Mardin", coeff: 0.75 },
  { name: "Mersin (Merkez)", coeff: 1.00 },
  { name: "Muğla", coeff: 1.00 },
  { name: "Muş", coeff: 0.75 },
  { name: "Nevşehir", coeff: 0.60 },
  { name: "Niğde", coeff: 0.75 },
  { name: "Ordu", coeff: 0.75 },
  { name: "Osmaniye", coeff: 0.75 },
  { name: "Rize", coeff: 0.75 },
  { name: "Sakarya", coeff: 0.75 },
  { name: "Samsun (Merkez)", coeff: 1.00 },
  { name: "Siirt", coeff: 0.75 },
  { name: "Sinop", coeff: 0.75 },
  { name: "Sivas", coeff: 0.60 },
  { name: "Şanlıurfa", coeff: 0.75 },
  { name: "Şırnak", coeff: 0.75 },
  { name: "Tekirdağ (Trakya)", coeff: 0.75 },
  { name: "Tokat", coeff: 0.60 },
  { name: "Trabzon (Merkez)", coeff: 1.00 },
  { name: "Trabzon (İlçeler)", coeff: 0.75 },
  { name: "Tunceli", coeff: 0.75 },
  { name: "Uşak (Merkez)", coeff: 1.00 },
  { name: "Van", coeff: 0.75 },
  { name: "Yalova", coeff: 0.75 },
  { name: "Yozgat", coeff: 0.60 },
  { name: "Zonguldak", coeff: 0.75 },
  { name: "Diğer (Varsayılan)", coeff: 1.00 }
];

// EMO 2026 Periyodik Kontrol Fiyat Sabitleri (Kısım V - Test ve Ölçüm Hizmetleri)
const PERIODIC_PRICES = {
  // YG/TM Güçzle Kontrol (Kısım V, Sira 16) - Bina Tipi 2 Hicreli Baz Alindi
  yg_base_limit: 400, // kVA
  yg_base_price: 53997.00,
  yg_tier1_limit: 5000, // kVA
  yg_tier1_increment: 16.37, // 401-5000 arasi arti
  yg_tier2_increment: 7.27,  // 5000 izeri arti

  // AG i Tesisat (Kısım V, Sira 1.5 - 5. Sinif Yapilar)
  ag_area_limit: 500, // m2
  ag_base_price: 42748.00,
  ag_increment: 7.89, // m2 başına artı

  // Topraklama (Kısım V, Sira 2.2 - AG Tesisleri)
  topraklama_base_limit: 3, // nokta
  topraklama_base_price: 7041.00,
  topraklama_increment: 645.00, // nokta başına (50'ye kadar)

  // Yildirimdan Korunma (Kısım V, Sira 11)
  paratoner_base_limit: 1, // tesisat
  paratoner_base_price: 10832.00,
  paratoner_increment: 5282.00,

  // RCD Testleri (Kısım V, Sira 9)
  rcd_base_limit: 3, // adet
  rcd_base_price: 6960.00,
  rcd_increment: 410.00, 

  // Keşif Bedeli
  kesif_bedeli: 6500.00
};

const App = () => {
  // --- State Definitions ---
  const { currentUser } = useAuth();
  const [activeTab, updateActiveTab] = useState(() => initialPortalModule(currentUser));
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const moduleButtonRef = useRef(null);
  const moduleCloseRef = useRef(null);
  const setActiveTab = (module) => {
    if (!PORTAL_MODULES.some(item => item.id === module && (!item.adminOnly || currentUser?.role === 'admin'))) return;
    if (module === activeTab) return;
    if (module !== activeTab && !window.dispatchEvent(new CustomEvent('vg:before-module-change',{cancelable:true,detail:{from:activeTab,to:module}}))) return;
    updateActiveTab(module);
    const next = new URL(window.location.href);
    next.searchParams.set('module', module);
    window.history.pushState({}, '', next);
  };
  React.useEffect(() => {
    const onHistory = () => {
      const next = initialPortalModule(currentUser);
      if (next !== activeTab && !window.dispatchEvent(new CustomEvent('vg:before-module-change',{cancelable:true,detail:{from:activeTab,to:next}}))) { const url = new URL(window.location.href); url.searchParams.set('module',activeTab); window.history.pushState({},'',url); return; }
      updateActiveTab(next);
    };
    window.addEventListener('popstate', onHistory);
    return () => window.removeEventListener('popstate', onHistory);
  }, [currentUser?.role,activeTab]);
  React.useEffect(() => {
    if (!isSidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    moduleCloseRef.current?.focus();
    const onKey = event => {
      if (event.key === 'Escape') { setIsSidebarOpen(false); moduleButtonRef.current?.focus(); }
      if (event.key === 'Tab') {
        const controls = [...document.querySelectorAll('#portal-modules button, #portal-modules a')].filter(node => !node.disabled);
        if (!controls.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = previousOverflow; };
  }, [isSidebarOpen]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  // AI States
  const [aiOutput, setAiOutput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [aiActiveFeature, setAiActiveFeature] = useState(null); // 'email' or 'tips'
  const [isEmailGeneratorOpen, setIsEmailGeneratorOpen] = useState(false);
  const [generatedEmail, setGeneratedEmail] = useState("");

  const [logo, setLogo] = useState(null); // Logo state
  
  // Teklif Sayaci ve Sabit Sicil No
  const [proposalCount, setProposalCount] = useState(1);

  
  // Para Birimi Seienei
  const [currency, setCurrency] = useState('TRY'); // 'TRY', 'USD', 'EUR'
  const [previousCurrency, setPreviousCurrency] = useState('TRY');
  const [exchangeRates, setExchangeRates] = useState({
    USD: 40.00, // TL/USD
    EUR: 49.00  // TL/EUR
  });

  
  // Editor Mode States
  const [editorMode, setEditorMode] = useState(false);
  const [editableContent, setEditableContent] = useState('');
  const [gesEditorMode, setGesEditorMode] = useState(false);
  const [gesEditableContent, setGesEditableContent] = useState('');
  
  const proposalRef = useRef(null); // PDF/Word export için referans

  // Manuel Giriş Form State
  const [manualForm, setManualForm] = useState({
    name: '',
    sector: '',
    contactName: '',
    powerStr: '',
    type: 'bina', // 'bina' or 'direk'
    region: 'İzmir (Aliağa/Kemalpaşa/Ödemiş)', // Varsayılan görüntülenen isim
    regionCoeff: 1.00, // Varsayılan katsayı
    customDiscount: 0 // Kullanıcıya özel İskonto
  });

  // Default Parameters (EMO 2026)
  const [params, setParams] = useState({
    baseFee: 8802.00,        // 400 kVA (2 hicre) Sabit
    rate1: 5.34,             // 401-5000 kVA birim fiyat
    rate2: 4.10,             // >5000 kVA birim fiyat
    
    // Direk Tipi / Kiik Güçler (EMO 2026 Kısım III - Madde 3.1)
    poleFee1: 3887.00,       // 0-50 kVA
    poleFee2: 4921.00,       // 51-160 kVA
    poleFee3: 6770.00,       // 161-400 kVA

    discountRate: 0,        // % (Varsayilan)
    regionCoeff: 1.00,       // Bölge Katsayisi (BK) (Varsayilan)
    year: 2026,
    registrationNumber: '',
    tariffNote: '2026 referans değerleri; güncel kaynak ve kapsam teklif sorumlusu tarafından doğrulanmalıdır.'
  });

  // Periyodik Kontrol States
  const [periodicCustomer, setPeriodicCustomer] = useState({
    name: '',
    city: '',
    contactName: '',
    date: new Date().toLocaleDateString('tr-TR')
  });

  const [periodicInputs, setPeriodicInputs] = useState({
    trafoGucu: 0,
    yapiAlani: 0,
    topraklamaAdet: 0,
    paratonerAdet: 0,
    rcdAdet: 0,
    İskonto: 0
  });

  const [periodicResults, setPeriodicResults] = useState({
    yg: { total: 0, desc: "" },
    ag: { total: 0, desc: "" },
    topraklama: { total: 0, desc: "" },
    paratoner: { total: 0, desc: "" },
    rcd: { total: 0, desc: "" },
    subTotal: 0,
    kesif: 0,
    grandTotal: 0,
    discountAmount: 0,
    finalPrice: 0
  });

  // Periyodik Kontrol Edit Mode
  const [periodicEditorMode, setPeriodicEditorMode] = useState(false);
  const [periodicEditableContent, setPeriodicEditableContent] = useState('');

  // Keşif Metraj States
  const [kesifCustomer, setKesifCustomer] = useState({
    name: '',
    address: '',
    contactName: '',
    phone: '',
    date: new Date().toLocaleDateString('tr-TR')
  });

  const [kesifProducts, setKesifProducts] = useState([]);
  const [kesifSettings, setKesifSettings] = useState({
    İskonto: 0,
    kdvOrani: 20
  });

  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [productQuantity, setProductQuantity] = useState(1);
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  
  // Ürün Tipi: 'normal', 'kablo' veya 'hizmet'
  const [productType, setProductType] = useState('normal');
  const [selectedCategoryForKesif, setSelectedCategoryForKesif] = useState('');
  const [selectedCableForKesif, setSelectedCableForKesif] = useState(null);
  const [kesifFiyatSecimi, setKesifFiyatSecimi] = useState('fiyat1');
  
  // Hizmet/iilik için state'ler
  const [hizmetAdi, setHizmetAdi] = useState('');
  const [hizmetFiyat, setHizmetFiyat] = useState(0);
  const [hizmetMiktar, setHizmetMiktar] = useState(1);
  const [hizmetBirim, setHizmetBirim] = useState('Güçn');
  const [hizmetAciklama, setHizmetAciklama] = useState('');

  // Hazir Paket States
  const [showHazirPaketModal, setShowHazirPaketModal] = useState(false);
  const [selectedHazirPaket, setSelectedHazirPaket] = useState(null);
  const [paketKarMarji, setPaketKarMarji] = useState(30); // %30 varsayılan kâr marjı

  // Hızlı Teklif Özellikleri States
  const [favoriteProducts, setFavoriteProducts] = useState(() => {
    const saved = localStorage.getItem('favoriteProducts');
    return saved ? JSON.parse(saved) : [];
  });
  const [recentProducts, setRecentProducts] = useState(() => {
    const saved = localStorage.getItem('recentProducts');
    return saved ? JSON.parse(saved) : [];
  });
  const [quickAddMode, setQuickAddMode] = useState(false);
  const [quickAddText, setQuickAddText] = useState('');
  const [profitMargin, setProfitMargin] = useState(30); // Kar marjı %
  const [showProfitCalculator, setShowProfitCalculator] = useState(false);
  const [costPrice, setCostPrice] = useState(0);
  const [savedQuotations, setSavedQuotations] = useState(() => {
    const saved = localStorage.getItem('savedQuotations');
    return saved ? JSON.parse(saved) : [];
  });
  const [showSavedQuotations, setShowSavedQuotations] = useState(false);

  // Merkezi Teklif Kaydetme Sistemi - Tüm Teklif Tirleri
  const [allSavedProposals, setAllSavedProposals] = useState({
    yg: [],
    periodic: [],
    kesif: [],
    ges: []
  });
  const [showAllProposals, setShowAllProposals] = useState(false);
  const [proposalsError,setProposalsError]=useState('');
  const [proposalsLoading,setProposalsLoading]=useState(false);
  const savingProposal=useRef(false),loadedProposalState=useRef({});
  const [proposalReferences,setProposalReferences]=useState(()=>({yg:newDraftReference(),periodic:newDraftReference(),kesif:newDraftReference(),ges:newDraftReference()}));
  const [proposalFilterType, setProposalFilterType] = useState('all'); // 'all', 'yg', 'periodic', 'kesif', 'ges'

  // GES Teklifi States
  const [gesForm, setGesForm] = useState({
    customerName: '',
    location: 'Kemalpaşa / İZMİR',
    usdRate: 34.50,
    offerDate: localISODate(),
    autoPower: 25, // kW
    laborRate: 10,
    transportRate: 1,
    overheadRate: 1,
    marginRate: 20,
    vatRate: 20
  });

  const [gesItems, setGesItems] = useState([]);
  const gesCalculation = useMemo(() => {
    try { return { value: calculateGESQuote(gesForm, gesItems), error: null }; }
    catch (error) { return { value: null, error }; }
  }, [gesForm, gesItems]);
  const gesError = gesCalculation.error;


  const [gesDB] = useState({
    // Eski veriler (yedek)
    panelPrice: 127.44,
    inverter: 2997,
    battery: 952.19,
    cable: 1.0,
    connector: 0.5,
    panelMount: 25,
    transport: 250,
    
    // Yeni Veritabanı - Kategorize Edilmi Fiyatlar (%35 İskontolu)
    batteries: {
      'orbit_51v_100ah_hv': { name: 'ORBiT 51.2 V 100 Ah LiFePO4 Akü-High Voltage-Metal Kasa', price: 920.40, brand: 'ORBiT' },
      'orbit_51v_50ah_hv': { name: 'ORBiT 51.2 V 050 Ah LiFePO4 Akü-High Voltage-Metal Kasa', price: 651.96, brand: 'ORBiT' },
      'orbit_51v_100ah_lv': { name: 'ORBiT 51.2 V 100 Ah LiFePO4 Akü-Low Voltage-Ekranlı-Metal Kasa', price: 936.00, brand: 'ORBiT' },
      'orbit_51v_280ah_lv': { name: 'ORBiT 51.2 V 280 Ah LiFePO4 Akü-Low Voltage-Metal Kasa', price: 2373.19, brand: 'ORBiT' },
      'orbit_48v_100ah_wall': { name: 'ORBiT 48 V 100 Ah LiFePO4 Akü-Ekranlı Duvar Tipi', price: 950.72, brand: 'ORBiT' },
      'orbit_48v_100ah_metal': { name: 'ORBiT 48 V 100 Ah LiFePO4 Akü-Ekranlı-Metal Kasa', price: 901.68, brand: 'ORBiT' },
      'orbit_24v_100ah': { name: 'ORBiT 24 V 100 Ah LiFePO4 Akü-ABS Kasa', price: 479.11, brand: 'ORBiT' },
      'orbit_24v_210ah': { name: 'ORBiT 24 V 210 Ah LiFePO4 Akü-ABS Kasa', price: 937.47, brand: 'ORBiT' },
      'orbit_12v_100ah': { name: 'ORBiT 12 V 100 Ah LiFePO4 Akü-ABS Kasa', price: 275.34, brand: 'ORBiT' },
      'orbit_12v_200ah': { name: 'ORBiT 12 V 200 Ah LiFePO4 Akü-ABS Kasa', price: 479.01, brand: 'ORBiT' },
      'orbit_12v_420ah': { name: 'ORBiT 12 V 420 Ah LiFePO4 Akü-ABS Kasa', price: 937.47, brand: 'ORBiT' }
    },
    
    bms: {
      'pace_100a': { name: 'BMS-PACE HV -BCU 100A', price: 1068.60, brand: 'PACE' },
      'pace_200a': { name: 'BMS-PACE HV-BCU 200A', price: 1514.76, brand: 'PACE' }
    },
    
    panels: {
      'set_600w': { name: 'PV - GÜNEŞ PANELİ - SET SOLAR 600 WP', price: 170.28, brand: 'SET SOLAR' },
      'set_460w': { name: 'PV - GÜNEŞ PANELİ - SET SOLAR 460 WP', price: 127.51, brand: 'SET SOLAR' }
    },
    
    inverters: {
      // Hibrit inverterler
      'deye_5kw_mono': { name: 'DEYE 05 KW MONOFAZE HİBRİT İNVERTER', price: 1296.00, brand: 'DEYE', type: 'hibrit' },
      'deye_8kw_mono': { name: 'DEYE 08 KW MONOFAZE HİBRİT İNVERTER', price: 2052.00, brand: 'DEYE', type: 'hibrit' },
      'deye_12kw_tri': { name: 'DEYE 12 KW TRİFAZE HİBRİT İNVERTER', price: 2808.00, brand: 'DEYE', type: 'hibrit' },
      'deye_20kw_hv': { name: 'DEYE 20 KW HIGH VOLTAGE (HV) TRİFAZE HİBRİT İNVERTER', price: 2976.00, brand: 'DEYE', type: 'hibrit' },
      'deye_20kw_lv': { name: 'DEYE 20 KW LOW VOLTAGE (LV) TRİFAZE HİBRİT İNVERTER', price: 4170.00, brand: 'DEYE', type: 'hibrit' },
      'deye_25kw_hv': { name: 'DEYE 25 KW HIGH VOLTAGE (HV) TRİFAZE HİBRİT İNVERTER', price: 3552.00, brand: 'DEYE', type: 'hibrit' },
      'deye_50kw_hv': { name: 'DEYE 50 KW HIGH VOLTAGE TRİFAZE HİBRİT İNVERTER', price: 7080.00, brand: 'DEYE', type: 'hibrit' },
      'deye_80kw': { name: 'Deye 80kW Hibrit inverter', price: 10043.28, brand: 'DEYE', type: 'hibrit' },
      'srp_6kw_mono': { name: 'SRP 06 KW MONOFAZE HİBRİT İNVERTER-LV', price: 1423.50, brand: 'SRP', type: 'hibrit' },
      'srp_15kw_tri': { name: 'SRP 15 KW TRİFAZE HİBRİT İNVERTER-LV', price: 3590.34, brand: 'SRP', type: 'hibrit' },
      'srp_30kw_tri': { name: 'SRP 30 KW TRİFAZE HİBRİT İNVERTER-HV', price: 4952.22, brand: 'SRP', type: 'hibrit' },
      
      // Offgrid inverterler
      'orbit_6.2kw_parallel': { name: 'ORBiT 6.2 KW TAM SİNÜS OFFGRID İNVERTER-12 PCS PARALLEL', price: 407.99, brand: 'ORBiT', type: 'offgrid' },
      'orbit_6.2kw_single': { name: 'ORBiT 6.2 KW TAM SİNÜS OFFGRID İNVERTER-NON PARALLEL', price: 364.84, brand: 'ORBiT', type: 'offgrid' },
      'srp_5kw_mono': { name: 'SRP 05 KW MONOFAZE OFFGRID İNVERTER-LV', price: 420.95, brand: 'SRP', type: 'offgrid' },
      
      // Ongrid inverterler
      'huawei_50ktl': { name: 'HUAWEI 50 KTL İNVERTER', price: 3946.80, brand: 'HUAWEI', type: 'ongrid' }
    },
    
    cabinets: {
      'cabinet_5': { name: 'KABİNET-05', price: 612.60, brand: 'ORBiT' },
      'cabinet_8': { name: 'KABİNET-08', price: 634.67, brand: 'ORBiT' },
      'cabinet_12': { name: 'KABİNET-12', price: 819.70, brand: 'ORBiT' },
      'cabinet_16': { name: 'KABİNET-16', price: 1100.10, brand: 'ORBiT' }
    },
    
    cables: {
      'dc_cable': { name: 'KABLO-DC (Metre)', price: 0.78, brand: 'Genel' },
      'mc4_connector': { name: 'KONNEKTÖR-MC4', price: 1.63, brand: 'SCTUBLE' }
    },
    
    accessories: {
      'pole_positive': { name: 'KUTUP BAŞI KONNEKTÖRÜ-POZİTİF', price: 3.51, brand: 'ORBiT' },
      'pole_negative': { name: 'KUTUP BAŞI KONNEKTÖRÜ-NEGATİF', price: 3.51, brand: 'ORBiT' },
      'charger_12v': { name: '12V-12A BATTERY CHARGER', price: 31.98, brand: 'ORBiT' },
      'charger_24v': { name: '24V-100A BATTERY CHARGER', price: 520.03, brand: 'Genel' }
    },
    
    evChargers: {
      'ev_22kw_single': { name: 'ELEKTRİKLİ ARAÇ ŞARJ İSTASYONU- 22 kW AC (BİREYSEL KULLANIM İÇİN)', price: 616.44, brand: 'BESTCHARGE' },
      'ev_22kw_shared': { name: 'ELEKTRİKLİ ARAÇ ŞARJ İSTASYONU- 22 kW AC (OCCP-PAYLAŞIMLI)', price: 732.60, brand: 'BESTCHARGE' }
    }
  });

  // Teklifleri Supabase'den yikle
  React.useEffect(() => {
    loadAllProposals();
  }, []);

  // GES başlangıç paketi yikle
  React.useEffect(() => {
    if (gesItems.length === 0) {
      loadCommercialGESPackage();
    }
  }, []);

  const loadAllProposals = async () => {
    setProposalsLoading(true);
    try {
      const rows=[];
      for(let from=0;;from+=100){const {data,error}=await supabase.from('proposals').select('*').order('created_at',{ascending:false}).order('id').range(from,from+99);if(error)throw error;rows.push(...(data || []));if(!data || data.length<100)break;}
      setAllSavedProposals({yg:rows.filter(item=>item.type==='yg'),periodic:rows.filter(item=>item.type==='periodic'),kesif:rows.filter(item=>item.type==='kesif'),ges:rows.filter(item=>item.type==='ges')});setProposalsError('');
    } catch(error){setProposalsError(error.message || 'Sunucu bağlantısını kontrol edin.');console.error('Teklif listesi alınamadı:',error);}
    finally{setProposalsLoading(false);}
  };

  // GeliÅŸmiÅŸ ürün Filtreleme States
  const [markaFilter, setMarkaFilter] = useState('tumu');
  const [kategoriFilter, setKategoriFilter] = useState('tumu');
  const [kaynakFilter, setKaynakFilter] = useState('tumu'); // Yeni: Veri kaynai filtresi
  const [fiyatAraligi, setFiyatAraligi] = useState({ min: 0, max: 100000 });
  const [siralama, setSiralama] = useState('alfabetik'); // 'alfabetik', 'fiyat-artan', 'fiyat-azalan', 'populer'
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // ürün istatistikleri ve Analizleri
  const productStats = useMemo(() => {
    // Marka sayilari
    const markaCounts = {};
    CombinedFaturaData.forEach(p => {
      const marka = p.marka || 'Bilinmeyen';
      markaCounts[marka] = (markaCounts[marka] || 0) + 1;
    });

    // En popüler ürünler (keÅŸifte en çok kullanılanlar)
    const urunKullanımSayilari = {};
    kesifProducts.forEach(kp => {
      urunKullanımSayilari[kp.urun] = (urunKullanımSayilari[kp.urun] || 0) + 1;
    });

    // Kategorilere göre siniflandirma
    const kategoriler = {
      'Kablolar': CombinedFaturaData.filter(p => p.urun?.toLowerCase().includes('kablo') || p.urun?.toLowerCase().includes('nvy') || p.urun?.toLowerCase().includes('nyy') || p.urun?.toLowerCase().includes('ttr') || p.urun?.toLowerCase().includes('kordon')),
      'Otomatlar': CombinedFaturaData.filter(p => p.urun?.toLowerCase().includes('otomat') || p.urun?.toLowerCase().includes('sigorta')),
      'Prizler': CombinedFaturaData.filter(p => p.urun?.toLowerCase().includes('priz')),
      'Anahtarlar': CombinedFaturaData.filter(p => p.urun?.toLowerCase().includes('anahtar') || p.urun?.toLowerCase().includes('komitatir')),
      'Aydinlatma': CombinedFaturaData.filter(p => p.urun?.toLowerCase().includes('armatir') || p.urun?.toLowerCase().includes('led') || p.urun?.toLowerCase().includes('ampul') || p.urun?.toLowerCase().includes('aplik') || p.urun?.toLowerCase().includes('projektir')),
      'Pano Malzemeleri': CombinedFaturaData.filter(p => p.urun?.toLowerCase().includes('pano') || p.urun?.toLowerCase().includes('kutu') || p.urun?.toLowerCase().includes('tava')),
      'Kablo Kanali': CombinedFaturaData.filter(p => p.urun?.toLowerCase().includes('kanal') || p.urun?.toLowerCase().includes('oluk')),
      'Tesisat Malzemeleri': CombinedFaturaData.filter(p => p.urun?.toLowerCase().includes('buat') || p.urun?.toLowerCase().includes('boru') || p.urun?.toLowerCase().includes('klips')),
      'Kompanzasyon': CombinedFaturaData.filter(p => p.urun?.toLowerCase().includes('kompanzasyon') || p.urun?.toLowerCase().includes('kondansatör') || p.urun?.toLowerCase().includes('reaktif') || p.urun?.toLowerCase().includes('kontaktör')),
      'Hizmetler': CombinedFaturaData.filter(p => p.urun?.toLowerCase().includes('iilik') || p.urun?.toLowerCase().includes('hizmet') || p.urun?.toLowerCase().includes('montaj'))
    };

    // Fiyat araliklari
    const fiyatAraliklari = {
      '0-50': CombinedFaturaData.filter(p => p.birimFiyat <= 50),
      '51-100': CombinedFaturaData.filter(p => p.birimFiyat > 50 && p.birimFiyat <= 100),
      '101-500': CombinedFaturaData.filter(p => p.birimFiyat > 100 && p.birimFiyat <= 500),
      '500-5000': CombinedFaturaData.filter(p => p.birimFiyat > 500 && p.birimFiyat <= 5000),
      '5000+': CombinedFaturaData.filter(p => p.birimFiyat > 5000)
    };

    // Ortalama fiyat hesaplama - sadece geçerli fiyatları kullan
    const validPrices = CombinedFaturaData.filter(p => p.birimFiyat && p.birimFiyat > 0);
    const avgPrice = validPrices.length > 0 
      ? validPrices.reduce((sum, p) => sum + p.birimFiyat, 0) / validPrices.length 
      : 0;

    return {
      toplamUrun: CombinedFaturaData.length,
      markalar: Object.keys(markaCounts).sort(),
      markaCounts,
      enPopulerMarkalar: Object.entries(markaCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
      kategoriler,
      kategoriSayilari: Object.entries(kategoriler).map(([k, v]) => ({ ad: k, adet: v.length })),
      fiyatAraliklari,
      ortalamaFiyat: avgPrice,
      enPahali: [...CombinedFaturaData].sort((a, b) => (b.birimFiyat || 0) - (a.birimFiyat || 0)).slice(0, 10),
      enUcuz: [...CombinedFaturaData].filter(p => p.birimFiyat > 0).sort((a, b) => a.birimFiyat - b.birimFiyat).slice(0, 10),
      enCokkullanılanlar: Object.entries(urunKullanımSayilari)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
    };
  }, [kesifProducts]);

  // GeliÅŸmiÅŸ ürün Filtreleme
  const filteredProducts = useMemo(() => {
    if (!productSearch && markaFilter === 'tumu' && kategoriFilter === 'tumu' && kaynakFilter === 'tumu') return [];
    
    let filtered = CombinedFaturaData;

    // Arama
    if (productSearch) {
      const searchLower = productSearch.toLowerCase();
      filtered = filtered.filter(p => 
        p.urun?.toLowerCase().includes(searchLower) || 
        p.marka?.toLowerCase().includes(searchLower)
      );
    }

    // Marka filtresi
    if (markaFilter !== 'tumu') {
      filtered = filtered.filter(p => p.marka === markaFilter);
    }

    // Kaynak filtresi (Fatura1 veya Fatura2)
    if (kaynakFilter !== 'tumu') {
      filtered = filtered.filter(p => p.kaynak === kaynakFilter);
    }

    // Kategori filtresi
    if (kategoriFilter !== 'tumu') {
      const kategoriUrunler = productStats.kategoriler[kategoriFilter] || [];
      filtered = filtered.filter(p => kategoriUrunler.some(ku => ku.urun === p.urun));
    }

    // Fiyat aralii filtresi
    filtered = filtered.filter(p => {
      const fiyat = p.birimFiyat || 0;
      return fiyat >= fiyatAraligi.min && fiyat <= fiyatAraligi.max;
    });

    // Siralama
    switch(siralama) {
      case 'fiyat-artan':
        filtered.sort((a, b) => (a.birimFiyat || 0) - (b.birimFiyat || 0));
        break;
      case 'fiyat-azalan':
        filtered.sort((a, b) => (b.birimFiyat || 0) - (a.birimFiyat || 0));
        break;
      case 'populer':
        // En çok kullanilan ürünleri öne çıkar
        const kullanimlar = {};
        kesifProducts.forEach(kp => {
          kullanimlar[kp.urun] = (kullanimlar[kp.urun] || 0) + 1;
        });
        filtered.sort((a, b) => (kullanimlar[b.urun] || 0) - (kullanimlar[a.urun] || 0));
        break;
      default: // alfabetik
        filtered.sort((a, b) => (a.urun || '').localeCompare(b.urun || '', 'tr'));
    }

    return filtered.slice(0, 50); // ilk 50 sonui
  }, [productSearch, markaFilter, kategoriFilter, kaynakFilter, fiyatAraligi, siralama, productStats, kesifProducts]);

  // Keşif Metraj Editor Mode
  const [kesifEditorMode, setKesifEditorMode] = useState(false);
  const [kesifEditableContent, setKesifEditableContent] = useState('');
  const [kesifInitialSnapshot,setKesifInitialSnapshot]=useState(null);

  // Editing a saved source produces a new draft; loaded snapshots retain their exact values.
  React.useEffect(()=>{const loaded=loadedProposalState.current.yg;if(loaded?.form===manualForm && loaded?.params===params)return;setEditableContent('');setProposalReferences(previous=>({...previous,yg:newDraftReference()}));},[manualForm,params]);
  React.useEffect(()=>{const loaded=loadedProposalState.current.periodic;if(loaded?.inputs===periodicInputs && loaded?.customer===periodicCustomer)return;setPeriodicEditableContent('');setProposalReferences(previous=>({...previous,periodic:newDraftReference()}));},[periodicInputs,periodicCustomer]);
  React.useEffect(()=>{const loaded=loadedProposalState.current.ges;if(loaded?.form===gesForm && loaded?.items===gesItems)return;setGesEditableContent('');setProposalReferences(previous=>({...previous,ges:newDraftReference()}));},[gesForm,gesItems]);

  // --- Helpers ---

  // Helper to parse power string "2000+2000+1600" -> 5600
  const parsePower = (str) => {
    if (!str) return 0;
    return str.toString().split('+').reduce((acc, curr) => acc + parseInt(curr.trim() || 0), 0);
  };

  // Each Save creates a named, server-confirmed quotation snapshot.
  const reportMetadata=type=>({schemaVersion:1,currency:type==='yg'?currency:type==='ges'?'USD':'TRY',exchangeRates:cloneProposal(exchangeRates),logo});
  const reportHTML=(id,previous)=>previous?sanitizeReportHTML(document.getElementById(id)?.innerHTML || previous):'';
  const saveProposal=async(type,raw,name)=>{
    if(savingProposal.current){alert('Kayıt devam ediyor. Lütfen tamamlanmasını bekleyin.');return null;}
    savingProposal.current=true;
    try{
      const title=String(name || '').trim();if(!title || title.length>200)throw Error('Teklif adı 1–200 karakter olmalı.');
      const data=normalizeProposal(type,{...raw,metadata:{...reportMetadata(type),...raw.metadata}},sanitizeReportHTML);
      const {data:saved,error}=await supabase.from('proposals').insert([{type,name:title,data}]).select().single();
      if(error)throw error;if(!saved?.id)throw Error('Sunucu kayıt onayı vermedi.');
      const reference=saved.reference_no || saved.data?.referenceNo;
      if(reference){setProposalReferences(previous=>({...previous,[type]:reference}));
        if(type==='yg' && data.calculated){setSelectedCompany({...data.calculated,refNo:reference});setEditableContent(reportHTMLWithReference(data.reportHtml,reference));}
        if(type==='periodic')setPeriodicEditableContent(reportHTMLWithReference(data.reportHtml,reference));
        if(type==='ges')setGesEditableContent(reportHTMLWithReference(data.reportHtml,reference));
      }
      setAllSavedProposals(previous=>({...previous,[type]:[saved,...previous[type]]}));
      alert('Teklif sunucuya kaydedildi'+(reference?' · '+reference:'.'));return saved;
    }catch(error){console.error('Teklif kaydı tamamlanamadı:',error);alert('Teklif kaydedilemedi: '+(error.message || 'Sunucu bağlantısını kontrol edin.'));return null;}
    finally{savingProposal.current=false;}
  };
  const loadProposal=proposal=>{
    try{
      const data=normalizeProposal(proposal.type,proposal.data,sanitizeReportHTML),reference=proposal.reference_no || data.referenceNo || data.calculated?.refNo || newDraftReference();
      if(proposal.type==='yg'){setCurrency(data.metadata.currency);setPreviousCurrency(data.metadata.currency);}
      if(proposal.type==='yg' && data.metadata.exchangeRates && Object.values(data.metadata.exchangeRates).every(value=>Number(value)>0))setExchangeRates(data.metadata.exchangeRates);
      if(data.metadata.logo!==undefined)setLogo(data.metadata.logo);
      setProposalReferences(previous=>({...previous,[proposal.type]:reference}));
      switch(proposal.type){
        case 'yg':{
          const calculated=data.calculated && Number.isFinite(Number(data.calculated.offerPrice))?{...data.calculated,refNo:reference}:calculateYGQuote(data.form,data.params,{referenceNo:reference});
          loadedProposalState.current.yg={form:data.form,params:data.params};setManualForm(data.form);setParams(data.params);setSelectedCompany(calculated);setEditableContent(reportHTMLWithReference(data.reportHtml,reference));setEditorMode(false);setAiOutput('');setActiveTab('proposal');break;
        }
        case 'periodic':loadedProposalState.current.periodic={inputs:data.inputs,customer:data.customer};setPeriodicCustomer(data.customer);setPeriodicInputs(data.inputs);setPeriodicResults(data.results);setPeriodicEditableContent(reportHTMLWithReference(data.reportHtml,reference));setPeriodicEditorMode(false);setActiveTab('periodic');break;
        case 'kesif':{const snapshot=normalizeKesifSnapshot(data,reference);snapshot.reportHtml=reportHTMLWithReference(snapshot.reportHtml || data.reportHtml,reference);setKesifInitialSnapshot({...snapshot,sourceId:proposal.id});setKesifCustomer(data.customer);setKesifProducts(data.products);setKesifSettings(data.settings);setActiveTab('kesif');break;}
        case 'ges':loadedProposalState.current.ges={form:data.form,items:data.items};setGesForm(data.form);setGesItems(data.items);setGesEditableContent(reportHTMLWithReference(data.reportHtml,reference));setGesEditorMode(false);setActiveTab('ges');break;
      }
      setShowAllProposals(false);alert('Teklif yüklendi: '+proposal.name+' · '+reference);
    }catch(error){alert('Teklif açılamadı: '+error.message);}
  };
  const deleteProposal=async(type,id)=>{
    if(!confirm('Bu kayıtlı teklif silinecek. Devam etmek istiyor musunuz?'))return;
    try{const {data:deleted,error}=await supabase.from('proposals').delete().eq('id',id).select('id');if(error)throw error;if(!deleted?.length)throw Error('Kayıt bulunamadı veya silme yetkiniz yok.');setAllSavedProposals(previous=>({...previous,[type]:previous[type].filter(p=>p.id!==id)}));alert('Teklif silindi.');}
    catch(error){alert('Teklif silinemedi: '+error.message);}
  };
  const saveYGProposal=async()=>{
    try{if(!manualForm.name?.trim())throw Error('Firma bilgilerini doldurun.');const name=prompt('Teklif adı:',manualForm.name+' - YG Teklifi');if(!name)return;const calculated=calculateCompanyFees({...manualForm,id:'MANUEL'});return await saveProposal('yg',{form:manualForm,params,calculated,reportHtml:reportHTML('printable-paper',editableContent)},name);}
    catch(error){alert('Teklif kaydedilemedi: '+error.message);return null;}
  };
  const savePeriodicProposal=async()=>{
    try{if(!periodicCustomer.name?.trim())throw Error('Müşteri bilgilerini doldurun.');if(!['trafoGucu','yapiAlani','topraklamaAdet','paratonerAdet','rcdAdet'].some(key=>Number(periodicInputs[key])>0))throw Error('En az bir kontrol hizmeti ve miktarı girin.');const name=prompt('Teklif adı:',periodicCustomer.name+' - Periyodik Kontrol');if(!name)return;const results=calculatePeriodicQuote(periodicInputs,PERIODIC_PRICES);setPeriodicResults(results);return await saveProposal('periodic',{customer:periodicCustomer,inputs:periodicInputs,results,tariff:PERIODIC_PRICES,reportHtml:JSON.stringify(results)===JSON.stringify(periodicResults)?reportHTML('periodic-printable-paper',periodicEditableContent):''},name);}
    catch(error){alert('Teklif kaydedilemedi: '+error.message);return null;}
  };
  const saveKesifProposal=async()=>{
    if(!kesifProducts.length){alert('Kaydedilecek ürün yok.');return null;}const name=prompt('Teklif adı:',(kesifCustomer.name || 'Keşif')+' - Malzeme Teklifi');if(!name)return;
    return await saveProposal('kesif',{customer:kesifCustomer,products:kesifProducts,settings:kesifSettings,totals:calculateKesifTotals()},name);
  };
  const saveGESProposal=async()=>{
    if(gesError){alert('Teklif kaydedilemedi: '+gesError.message);return null;}
    if(!gesForm.customerName?.trim()){alert('Müşteri adını girin.');return null;}const name=prompt('Teklif adı:',gesForm.customerName+' - GES Teklifi');if(!name)return;
    const {form,items,totals}=gesCalculation.value;
    return await saveProposal('ges',{form,items,totals,reportHtml:reportHTML('ges-printable-area',gesEditableContent)},name);
  };

  // GES Fonksiyonlari
  const loadDefaultGESPackage = () => {
    const kw = parseDecimal(gesForm.autoPower, null);
    if (kw === null || kw <= 0) { alert('Kurulu güç sıfırdan büyük bir sayı olmalı.'); return; }
    const panelCount = Math.ceil((kw * 1000) / 600); // 600W panel kullanimi
    
    const items = [
      { brand: gesDB.panels.set_600w.brand, desc: gesDB.panels.set_600w.name, qty: panelCount, price: gesDB.panels.set_600w.price },
      { brand: gesDB.inverters.deye_12kw_tri.brand, desc: gesDB.inverters.deye_12kw_tri.name, qty: 1, price: gesDB.inverters.deye_12kw_tri.price },
      { brand: gesDB.batteries.orbit_51v_100ah_hv.brand, desc: gesDB.batteries.orbit_51v_100ah_hv.name, qty: 2, price: gesDB.batteries.orbit_51v_100ah_hv.price },
      { brand: gesDB.cables.dc_cable.brand, desc: gesDB.cables.dc_cable.name + ' (Kırmızı)', qty: 50, price: gesDB.cables.dc_cable.price },
      { brand: gesDB.cables.dc_cable.brand, desc: gesDB.cables.dc_cable.name + ' (Siyah)', qty: 50, price: gesDB.cables.dc_cable.price },
      { brand: gesDB.cables.mc4_connector.brand, desc: gesDB.cables.mc4_connector.name, qty: 10, price: gesDB.cables.mc4_connector.price },
      { brand: 'ABB', desc: 'Pano & Sigorta Takımı - DC/AC koruma', qty: 1, price: 1250 },
      { brand: 'DEYE', desc: 'Deye Smart Meter + Wi-Fi', qty: 1, price: 103 },
      { brand: 'Konstrüksiyon', desc: 'Alüminyum Alt Yapı Seti', qty: panelCount, price: 25 },
      { brand: 'Lojistik', desc: 'Nakliye Hizmeti', qty: 1, price: 250 }
    ];
    
    setGesItems(items);
    setGesForm({...gesForm, autoPower: kw});
  };

  const loadCommercialGESPackage = () => {
    const items = [
      { brand: gesDB.panels.set_600w.brand, desc: gesDB.panels.set_600w.name, qty: 42, price: gesDB.panels.set_600w.price },
      { brand: gesDB.inverters.deye_25kw_hv.brand, desc: gesDB.inverters.deye_25kw_hv.name, qty: 1, price: gesDB.inverters.deye_25kw_hv.price },
      { brand: gesDB.batteries.orbit_51v_100ah_hv.brand, desc: gesDB.batteries.orbit_51v_100ah_hv.name, qty: 20, price: gesDB.batteries.orbit_51v_100ah_hv.price },
      { brand: gesDB.bms.pace_100a.brand, desc: gesDB.bms.pace_100a.name, qty: 2, price: gesDB.bms.pace_100a.price },
      { brand: gesDB.cabinets.cabinet_16.brand, desc: gesDB.cabinets.cabinet_16.name, qty: 1, price: gesDB.cabinets.cabinet_16.price },
      { brand: gesDB.cables.mc4_connector.brand, desc: gesDB.cables.mc4_connector.name, qty: 30, price: gesDB.cables.mc4_connector.price },
      { brand: gesDB.cables.dc_cable.brand, desc: gesDB.cables.dc_cable.name, qty: 200, price: gesDB.cables.dc_cable.price },
      { brand: 'Hizmet', desc: 'Ticari Sistem Montajı ve Mühendislik', qty: 1, price: 2000.00 }
    ];
    
    setGesItems(items);
    setGesForm({...gesForm, autoPower: 25});
  };

  const addNewGESRow = () => {
    setGesItems([...gesItems, { brand: '', desc: '', qty: 1, price: 0 }]);
  };

  const removeGESRow = (index) => {
    const updated = gesItems.filter((_, i) => i !== index);
    setGesItems(updated);
  };

  const updateGESItem = (index, field, value) => {
    const updated = [...gesItems];
    updated[index][field] = value;
    setGesItems(updated);
  };


  const formatMoney = (amount, currency = '$') => {
    return currency + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // GES PDF Export
  const handleGESPDFExport = async () => {
    if (gesError) { alert('PDF oluşturulamadı: ' + gesError.message); return; }
    if (!gesForm.customerName || gesItems.length === 0) {
      alert('Lütfen müşteri bilgilerini doldurun ve malzeme ekleyin.'); return;
    }
    try {
      await exportHTMLReport({ root: document.getElementById('ges-printable-area'), selector: '.ges-pdf-page',
        filename: reportFileName('GES_Teklif', gesForm.customerName), title: 'GES Fiyat Teklifi' });
    } catch (error) { alert('PDF oluşturulamadı: ' + error.message); }
  };

  // Hızlı Teklif Yardimci Fonksiyonlari
  const addToRecentProducts = (product) => {
    const newRecent = [product, ...recentProducts.filter(p => p.urun !== product.urun)].slice(0, 20);
    setRecentProducts(newRecent);
    localStorage.setItem('recentProducts', JSON.stringify(newRecent));
  };

  const toggleFavorite = (product) => {
    const isFavorite = favoriteProducts.some(p => p.urun === product.urun);
    let newFavorites;
    if (isFavorite) {
      newFavorites = favoriteProducts.filter(p => p.urun !== product.urun);
    } else {
      newFavorites = [...favoriteProducts, product];
    }
    setFavoriteProducts(newFavorites);
    localStorage.setItem('favoriteProducts', JSON.stringify(newFavorites));
  };

  const isFavorite = (product) => {
    return favoriteProducts.some(p => p.urun === product.urun);
  };

  const addFavoriteToKesif = (product, quantity = 1) => {
    const newProduct = {
      id: Date.now(),
      sira: kesifProducts.length + 1,
      type: 'normal',
      urun: product.urun,
      marka: product.marka,
      birimFiyat: product.birimFiyat,
      miktar: quantity,
      olcu: product.olcu,
      toplam: product.birimFiyat * quantity
    };
    setKesifProducts([...kesifProducts, newProduct]);
    addToRecentProducts(product);
  };

  // Hızlı Giriş Parser - İYİLEŞTİRİLMİŞ: 3 FORMAT DESTEĞİ
  const parseQuickAddText = (text) => {
    const lines = text.split('\n').filter(l => l.trim());
    const products = [];
    const errors = [];
    
    lines.forEach((line, idx) => {
      line = line.trim();
      if (!line) return;
      
      let parts = [];
      
      // Format tespiti: | veya , veya TAB
      if (line.includes('|')) {
        parts = line.split('|').map(p => p.trim());
      } else if (line.includes('\t')) {
        // Excel'den kopyala-yapıştır (TAB ile ayrılmış)
        parts = line.split('\t').map(p => p.trim());
      } else if (line.includes(',')) {
        parts = line.split(',').map(p => p.trim());
      } else {
        errors.push(`Satır ${idx + 1}: Ayırıcı bulunamadı (| veya , veya TAB)`);
        return;
      }
      
      if (parts.length < 2) {
        errors.push(`Satır ${idx + 1}: Yetersiz veri (en az ürün ve Miktar gerekli)`);
        return;
      }
      
      const urunAdi = parts[0];
      const miktar = parseFloat(parts[1]) || 1;
      const fiyat = parts.length >= 3 ? parseFloat(parts[2]) : null;
      const birim = parts.length >= 4 ? parts[3] : 'Adet';
      const marka = parts.length >= 5 ? parts[4] : '';
      
      if (!urunAdi || urunAdi === '') {
        errors.push(`Satır ${idx + 1}: ürün adı boÅŸ`);
        return;
      }
      
      if (miktar <= 0 || isNaN(miktar)) {
        errors.push(`Satır ${idx + 1}: Geçersiz miktar (${parts[1]})`);
        return;
      }
      
      // ürünü katalogda akıllı ara
      const foundProduct = CombinedFaturaData.find(p => {
        const urunLower = p.urun?.toLowerCase() || '';
        const aramaLower = urunAdi.toLowerCase();
        return urunLower.includes(aramaLower) || aramaLower.includes(urunLower);
      });
      
      let usedPrice = fiyat;
      let usedMarka = marka;
      let usedBirim = birim;
      
      if (!fiyat || fiyat <= 0 || isNaN(fiyat)) {
        if (foundProduct) {
          usedPrice = foundProduct.birimFiyat;
          usedMarka = foundProduct.marka;
          usedBirim = foundProduct.olcu;
        } else {
          errors.push(`Satır ${idx + 1}: "${urunAdi}" için fiyat bulunamadı`);
          return;
        }
      }
      
      // Kar marjı uygula
      const finalPrice = profitMargin > 0 
        ? usedPrice * (1 + profitMargin / 100)
        : usedPrice;
      
      products.push({
        id: Date.now() + products.length * 100,
        sira: kesifProducts.length + products.length + 1,
        type: 'normal',
        urun: foundProduct ? foundProduct.urun : urunAdi,
        marka: foundProduct ? foundProduct.marka : (usedMarka || 'Manuel Giriş'),
        maliyetFiyat: usedPrice,
        birimFiyat: parseFloat(finalPrice.toFixed(2)),
        miktar: miktar,
        olcu: usedBirim,
        toplam: parseFloat((finalPrice * miktar).toFixed(2)),
        karMarji: profitMargin
      });
    });
    
    return { products, errors };
  };

  const handleQuickAdd = () => {
    if (!quickAddText.trim()) {
      alert('⚠️ Lütfen ürün bilgilerini girin!');
      return;
    }
    
    const { products, errors } = parseQuickAddText(quickAddText);
    
    if (products.length > 0) {
      setKesifProducts([...kesifProducts, ...products]);
      setQuickAddText('');
      setQuickAddMode(false);
      
      let message = `? HIZLI Giriş BAŞARILI!\n\n`;
      message += `✅ ${products.length} ürün eklendi`;
      if (profitMargin > 0) {
        message += `\n?? %${profitMargin} kar marjı uygulandı`;
      }
      if (errors.length > 0) {
        message += `\n\n⚠️ ${errors.length} satırda hata:\n${errors.slice(0, 5).join('\n')}`;
      }
      alert(message);
    } else {
      alert(`❌ Hiçbir ürün eklenemedi!\n\n${errors.slice(0, 10).join('\n')}\n\nDoğru format:\nÜRÜN | Miktar | Fiyat\nÜRÜN, Miktar, Fiyat\nExcel'den kopyala-yapıştır`);
    }
  };

  // Kar marjı hesaplayici
  const calculateSellingPrice = (cost, margin) => {
    return cost * (1 + margin / 100);
  };

  const addWithProfitMargin = () => {
    if (costPrice <= 0) return;
    const sellingPrice = calculateSellingPrice(costPrice, profitMargin);
    alert(`Maliyet: ${costPrice.toFixed(2)} TL\nKar marjı: %${profitMargin}\nSati fiyatı: ${sellingPrice.toFixed(2)} TL`);
  };

  // Excel ie Aktarma - İYİLEŞTİRİLMİŞ VERSiYON
  const handleExcelImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet);

        if (jsonData.length === 0) {
          alert('📊 Excel dosyası boÅŸ!');
          return;
        }

        // AKILLI SÜTUN ALGILAMA
        const firstRow = jsonData[0];
        const columns = Object.keys(firstRow);
        
        // SÜTUN isimleri için olası varyasyonlar
        const urunVariants = ['ürün', 'urun', 'ürün', 'Urun adı', 'Malzeme', 'Product', 'ürün adı'];
        const miktarVariants = ['Miktar', 'miktar', 'MIKTAR', 'Quantity', 'Adet', 'Amount'];
        const fiyatVariants = ['Fiyat', 'fiyat', 'FİYAT', 'Birim Fiyat', 'BirimFiyat', 'Price', 'Tutar'];
        const birimVariants = ['Birim', 'birim', 'BiRiM', 'Unit', 'ili', 'olcu'];
        const markaVariants = ['Marka', 'marka', 'MARKA', 'Brand', 'iretici'];
        
        // Otomatik SÜTUN eÅŸleÅŸtirme
        const findColumn = (variants) => {
          for (let variant of variants) {
            if (columns.find(col => col.toLowerCase() === variant.toLowerCase())) {
              return columns.find(col => col.toLowerCase() === variant.toLowerCase());
            }
          }
          return null;
        };
        
        const urunCol = findColumn(urunVariants);
        const miktarCol = findColumn(miktarVariants);
        const fiyatCol = findColumn(fiyatVariants);
        const birimCol = findColumn(birimVariants);
        const markaCol = findColumn(markaVariants);
        
        if (!urunCol) {
          alert('❌ Excel\'de "ürün" sütunu bulunamadı!\n\nGeçerli SÜTUN isimleri: ' + urunVariants.join(', '));
          return;
        }

        const importedProducts = [];
        const errors = [];
        let successCount = 0;
        let skippedCount = 0;

        jsonData.forEach((row, idx) => {
          const urunAdi = row[urunCol];
          const miktar = parseDecimal(row[miktarCol], 1);
          const fiyat = parseDecimal(row[fiyatCol], 0);
          const birim = row[birimCol] || 'Adet';
          const marka = row[markaCol] || 'Genel';

          // Validasyon
          if (!urunAdi || urunAdi.trim() === '') {
            skippedCount++;
            errors.push(`Satır ${idx + 2}: ürün adı boÅŸ`);
            return;
          }

          if (miktar <= 0 || isNaN(miktar)) {
            skippedCount++;
            errors.push(`Satır ${idx + 2}: Geçersiz miktar (${miktar})`);
            return;
          }

          // Katalogda akıllı arama
          let foundProduct = null;
          let usedPrice = fiyat;

          if (fiyat <= 0 || isNaN(fiyat)) {
            // Fiyat yoksa katalogdan ara
            foundProduct = CombinedFaturaData.find(p => 
              p.urun?.toLowerCase().includes(urunAdi.toLowerCase()) ||
              urunAdi.toLowerCase().includes(p.urun?.toLowerCase())
            );
            
            if (foundProduct) {
              usedPrice = foundProduct.birimFiyat;
            } else {
              skippedCount++;
              errors.push(`Satır ${idx + 2}: "${urunAdi}" için fiyat bulunamadı`);
              return;
            }
          }

          // Kar marjı uygula
          const finalPrice = profitMargin > 0 
            ? usedPrice * (1 + profitMargin / 100)
            : usedPrice;

          importedProducts.push({
            id: Date.now() + idx * 100,
            sira: kesifProducts.length + importedProducts.length + 1,
            type: 'normal',
            urun: foundProduct ? foundProduct.urun : urunAdi,
            marka: foundProduct ? foundProduct.marka : marka,
            maliyetFiyat: usedPrice,
            birimFiyat: parseFloat(finalPrice.toFixed(2)),
            miktar: miktar,
            olcu: birim || (foundProduct ? foundProduct.olcu : 'Adet'),
            toplam: parseFloat((finalPrice * miktar).toFixed(2)),
            karMarji: profitMargin,
            kaynakDosya: file.name
          });
          successCount++;
        });

        // Sonui raporu
        if (importedProducts.length > 0) {
          setKesifProducts([...kesifProducts, ...importedProducts]);
          
          let message = `? EXCEL iMPORT BAŞARILI!\n\n`;
          message += `📊 Toplam Satır: ${jsonData.length}\n`;
          message += `? Başarılı: ${successCount} ürün\n`;
          if (skippedCount > 0) {
            message += `⏭️ Atlanan: ${skippedCount} Satır\n`;
          }
          if (profitMargin > 0) {
            message += `📊 Kar marjı: %${profitMargin} uygulandı\n`;
          }
          message += `\n📁 Dosya: ${file.name}`;
          
          if (errors.length > 0 && errors.length <= 5) {
            message += `\n\n❌ Hatalar:\n${errors.slice(0, 5).join('\n')}`;
          }
          
          alert(message);
        } else {
          alert(`❌ Hiçbir ürün eklenemedi!\n\n${errors.slice(0, 5).join('\n')}`);
        }
      } catch (error) {
        console.error('Excel import hatasi:', error);
        alert(`❌ Excel dosyası okunamadı!\n\nHata: ${error.message}\n\nLütfen dosya formatını kontrol edin:\n- ilk satırda Başlıklar olmalı\n- "ürün", "Miktar", "Fiyat" sütunlari gerekli`);
      }
    };
    reader.readAsArrayBuffer(file);
    
    // Input'u temizle (aynı dosya tekrar seilebilsin)
    e.target.value = '';
  };

  // Teklifi Kaydet
  const saveCurrentQuotation = () => {
    // Merkezi kaydetme sistemini kullan
    saveKesifProposal();
  };

  // Kaydedilmi Teklifi Yikle
  const loadSavedQuotation = (quotation) => {
    setKesifCustomer(quotation.customer);
    setKesifProducts(quotation.products);
    setKesifSettings(quotation.settings);
    setShowSavedQuotations(false);
    alert(`? "${quotation.name}" teklifi yiklendi!`);
  };

  // Kaydedilmi Teklifi Sil
  const deleteSavedQuotation = (id) => {
    if (!confirm('Bu teklifi silmek istediğinize emin misiniz?')) return;
    const updated = savedQuotations.filter(q => q.id !== id);
    setSavedQuotations(updated);
    localStorage.setItem('savedQuotations', JSON.stringify(updated));
  };

  // Tüm fiyatlara kar marjı uygula
  const applyProfitMarginToAll = () => {
    if (kesifProducts.length === 0) {
      alert('⚠️ Listede ürün yok!');
      return;
    }
    
    const margin = prompt(
      `📊 KÂR MARJI UYGULA\n\nŞu anda ${kesifProducts.length} ürün listenizde.\n\nUygulamak istediğiniz kar marjını % olarak girin:`,
      profitMargin.toString()
    );
    
    if (margin === null) return; // iptal
    
    const marginValue = parseFloat(margin);
    if (isNaN(marginValue)) {
      alert('❌ Geçersiz kâr marjı değeri!');
      return;
    }
    
    if (marginValue < 0) {
      if (!confirm(`⚠️ Negatif kâr marjı (%${marginValue}) uygulamak istediğinizden emin misiniz? Bu fiyatları düşürecektir.`)) {
        return;
      }
    }
    
    const updated = kesifProducts.map(p => {
      // Eğer maliyet fiyatı varsa ondan hesapla, yoksa mevcut fiyattan
      const basePrice = p.maliyetFiyat || p.birimFiyat;
      const newPrice = basePrice * (1 + marginValue / 100);
      return { 
        ...p, 
        birimFiyat: parseFloat(newPrice.toFixed(2)), 
        toplam: parseFloat((newPrice * p.miktar).toFixed(2)),
        karMarji: marginValue,
        maliyetFiyat: p.maliyetFiyat || basePrice
      };
    });
    
    setKesifProducts(updated);
    setProfitMargin(marginValue); // varsayılan kâr marjıni güncelle
    
    const totalIncrease = updated.reduce((sum, p) => sum + p.toplam, 0) - 
                          kesifProducts.reduce((sum, p) => sum + p.toplam, 0);
    
    alert(
      `? KÂR MARJI UYGULANDILAR!\n\n` +
      `📦 Ürün Sayısı: ${kesifProducts.length}\n` +
      `📊 Uygulanan Marj: %${marginValue}\n` +
      `📈 Toplam Artış: ${totalIncrease.toFixed(2)} TL`
    );
  };

  // Keşif Metraj Fonksiyonlari - İYİLEŞTİRİLMİŞ
  const addProductToKesif = () => {
    if (productType === 'normal') {
      // Normal ürün ekleme
      if (!selectedProduct || productQuantity <= 0) {
        alert('⚠️ Lütfen bir ürün seçin ve miktar girin!');
        return;
      }
      
      // KAR MARJI OTOMATiK UYGULA
      const maliyetFiyat = selectedProduct.birimFiyat;
      const satisFiyat = profitMargin > 0 
        ? maliyetFiyat * (1 + profitMargin / 100)
        : maliyetFiyat;
      
      const newProduct = {
        id: Date.now(),
        sira: kesifProducts.length + 1,
        type: 'normal',
        urun: selectedProduct.urun,
        marka: selectedProduct.marka,
        maliyetFiyat: maliyetFiyat,
        birimFiyat: parseFloat(satisFiyat.toFixed(2)),
        miktar: productQuantity,
        olcu: selectedProduct.olcu,
        toplam: parseFloat((satisFiyat * productQuantity).toFixed(2)),
        karMarji: profitMargin
      };

      setKesifProducts([...kesifProducts, newProduct]);
      
      // Son kullanılanlara ekle
      addToRecentProducts(selectedProduct);
      
      setSelectedProduct(null);
      setProductSearch('');
      setProductQuantity(1);
      setShowProductDropdown(false);
      
      // Baiari mesaji
      const toast = document.createElement('div');
      toast.className = 'fixed top-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-bounce';
      toast.textContent = '❌ ürün eklendi!';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2000);
    } else if (productType === 'kablo') {
      // Kablo ekleme
      if (!selectedCableForKesif || productQuantity <= 0) return;
      
      const fiyat = kesifFiyatSecimi === 'fiyat1' ? selectedCableForKesif.fiyat1 : (selectedCableForKesif.fiyat2 || selectedCableForKesif.fiyat1);
      const kategori = KabloFiyatData.kategoriler.find(k => k.urunler.some(u => u.kod === selectedCableForKesif.kod));
      
      const newProduct = {
        id: Date.now(),
        sira: kesifProducts.length + 1,
        type: 'kablo',
        urun: selectedCableForKesif.ad,
        marka: `${kategori?.ad || 'Kablo'} - ${selectedCableForKesif.kesit} mmi`,
        birimFiyat: fiyat,
        miktar: productQuantity,
        olcu: selectedCableForKesif.birim,
        toplam: fiyat * productQuantity,
        kategori: kategori?.ad || '',
        kesit: selectedCableForKesif.kesit
      };

      setKesifProducts([...kesifProducts, newProduct]);
      setSelectedCableForKesif(null);
      setSelectedCategoryForKesif('');
      setProductQuantity(1);
    } else if (productType === 'hizmet') {
      // Hizmet/iilik ekleme
      if (!hizmetAdi || hizmetFiyat <= 0 || hizmetMiktar <= 0) return;
      
      const newProduct = {
        id: Date.now(),
        sira: kesifProducts.length + 1,
        type: 'hizmet',
        urun: hizmetAdi,
        marka: 'Hizmet/iilik',
        birimFiyat: hizmetFiyat,
        miktar: hizmetMiktar,
        olcu: hizmetBirim,
        toplam: hizmetFiyat * hizmetMiktar,
        aciklama: hizmetAciklama
      };

      setKesifProducts([...kesifProducts, newProduct]);
      setHizmetAdi('');
      setHizmetFiyat(0);
      setHizmetMiktar(1);
      setHizmetBirim('Güçn');
      setHizmetAciklama('');
    }
  };

  const removeProductFromKesif = (id) => {
    const updated = kesifProducts.filter(p => p.id !== id);
    // Re-number the rows
    const reNumbered = updated.map((p, idx) => ({ ...p, sira: idx + 1 }));
    setKesifProducts(reNumbered);
  };

  const updateProductQuantity = (id, newQuantity) => {
    const updated = kesifProducts.map(p => 
      p.id === id ? { ...p, miktar: newQuantity, toplam: p.birimFiyat * newQuantity } : p
    );
    setKesifProducts(updated);
  };

  const updateProductPrice = (id, newPrice) => {
    const updated = kesifProducts.map(p => 
      p.id === id ? { ...p, birimFiyat: newPrice, toplam: newPrice * p.miktar } : p
    );
    setKesifProducts(updated);
  };

  const updateProductName = (id, newName) => {
    const updated = kesifProducts.map(p => 
      p.id === id ? { ...p, urun: newName } : p
    );
    setKesifProducts(updated);
  };

  const updateProductDetail = (id, newDetail) => {
    const updated = kesifProducts.map(p => 
      p.id === id ? { ...p, marka: newDetail } : p
    );
    setKesifProducts(updated);
  };

  // Toplu duzenleme
  const applyBulkPriceAdjustment = (percentage) => {
    if (percentage === 0) {
      alert('⚠️ Lütfen bir yüzde değeri girin!');
      return;
    }
    
    if (!confirm(`Tüm ürünlere %${percentage} ${percentage > 0 ? 'zam' : 'indirim'} uygulamak istediğinizden emin misiniz?`)) {
      return;
    }
    
    const updated = kesifProducts.map(p => {
      const newPrice = p.birimFiyat * (1 + percentage / 100);
      return { 
        ...p, 
        birimFiyat: parseFloat(newPrice.toFixed(2)), 
        toplam: parseFloat((newPrice * p.miktar).toFixed(2)),
        sonGuncelleme: new Date().toLocaleString('tr-TR')
      };
    });
    setKesifProducts(updated);
    alert(`? ${kesifProducts.length} ÜRÜNe %${percentage} ayarlama uygulandı!`);
  };
  
  // TOPLU SiLME
  const removeSelectedProducts = (selectedIds) => {
    if (selectedIds.length === 0) {
      alert('⚠️ Lütfen silinecek ürünleri seçin!');
      return;
    }
    
    if (!confirm(`${selectedIds.length} ürünü silmek istediğinizden emin misiniz?`)) {
      return;
    }
    
    const updated = kesifProducts.filter(p => !selectedIds.includes(p.id));
    const reNumbered = updated.map((p, idx) => ({ ...p, sira: idx + 1 }));
    setKesifProducts(reNumbered);
    alert(`? ${selectedIds.length} ürün silindi!`);
  };
  
  // TOPLU iOiALTMA
  const duplicateProduct = (productId) => {
    const product = kesifProducts.find(p => p.id === productId);
    if (!product) return;
    
    const newProduct = {
      ...product,
      id: Date.now(),
      sira: kesifProducts.length + 1
    };
    
    setKesifProducts([...kesifProducts, newProduct]);
    alert('❌ ürün kopyalandı!');
  };

  // Hazir Paket Ekleme Fonksiyonu
  const addHazirPaketToKesif = () => {
    if (!selectedHazirPaket) return;

    const paket = HazirPaketler.paketler.find(p => p.id === selectedHazirPaket);
    if (!paket) return;

    let addedCount = 0;
    const newProducts = [];

    paket.urunler.forEach((paketUrun) => {
      // CombinedFaturaData'dan ürünü ara
      const foundProduct = CombinedFaturaData.find(fp => 
        fp.urun?.toLowerCase().includes(paketUrun.urun.toLowerCase()) ||
        paketUrun.urun.toLowerCase().includes(fp.urun?.toLowerCase())
      );

      if (foundProduct) {
        // Liste fiyatina (İskontosuz) kar marjı ekle
        const listeFiyat = foundProduct.birimFiyat || 0;
        const satisFiyat = listeFiyat * (1 + paketKarMarji / 100);

        const newProduct = {
          id: Date.now() + addedCount,
          sira: kesifProducts.length + addedCount + 1,
          type: 'normal',
          urun: foundProduct.urun,
          birim: paketUrun.birim || foundProduct.olcu || 'Adet',
          miktar: paketUrun.miktar,
          birimFiyat: parseFloat(satisFiyat.toFixed(2)),
          toplam: parseFloat((satisFiyat * paketUrun.miktar).toFixed(2)),
          aciklama: paketUrun.aciklama || '',
          marka: foundProduct.marka || '',
          paketAdi: paket.ad
        };
        newProducts.push(newProduct);
        addedCount++;
      } else {
        // ürün bulunamadıysa, varsayilan fiyat ile ekle
        const defaultPrice = 100 * (1 + paketKarMarji / 100);
        const newProduct = {
          id: Date.now() + addedCount,
          sira: kesifProducts.length + addedCount + 1,
          type: 'normal',
          urun: paketUrun.urun,
          birim: paketUrun.birim || 'Adet',
          miktar: paketUrun.miktar,
          birimFiyat: parseFloat(defaultPrice.toFixed(2)),
          toplam: parseFloat((defaultPrice * paketUrun.miktar).toFixed(2)),
          aciklama: paketUrun.aciklama || '',
          marka: '---',
          paketAdi: paket.ad
        };
        newProducts.push(newProduct);
        addedCount++;
      }
    });

    setKesifProducts([...kesifProducts, ...newProducts]);
    setShowHazirPaketModal(false);
    setSelectedHazirPaket(null);
    alert(`${paket.ad} paketi eklendi! ${addedCount} ürün listeye eklendi.`);
  };

  const calculateKesifTotals = () => {
    const subTotal = kesifProducts.reduce((sum, p) => sum + p.toplam, 0);
    const İskontoAmount = subTotal * (kesifSettings.İskonto / 100);
    const afterDiscount = subTotal - İskontoAmount;
    const kdvAmount = afterDiscount * (kesifSettings.kdvOrani / 100);
    const grandTotal = afterDiscount + kdvAmount;

    return {
      subTotal,
      İskontoAmount,
      afterDiscount,
      kdvAmount,
      grandTotal
    };
  };

  const handleGenerateProposalEmail=()=>{
 if(!kesifProducts.length){alert('Önce teklif kalemlerini oluşturun.');return;}const totals=calculateKesifTotals();
 const lines=kesifProducts.map(item=>String(item.urun || '')+' — '+item.miktar+' '+(item.birim || '')+' × '+formatCurrency(item.birimFiyat));
 setGeneratedEmail('Sayın '+(kesifCustomer.contactName || 'Yetkili')+',\n\n'+(kesifCustomer.name || '')+' için hazırlanan malzeme teklifimiz:\n\n'+lines.join('\n')+'\n\nAra toplam: '+formatCurrency(totals.subTotal)+'\nİskonto: '+formatCurrency(totals.İskontoAmount)+'\nKDV: '+formatCurrency(totals.kdvAmount)+'\nGenel toplam: '+formatCurrency(totals.grandTotal)+'\n\nTeklif koşullarını PDF belgesinden kontrol ediniz. PDF dosyasını e-postaya ayrıca ekleyiniz.\n\nSaygılarımızla,\n'+COMPANY_NAME+'\n'+COMPANY_EMAIL_WEBSITE_LINE);
 setAiLoading(false);setIsEmailGeneratorOpen(true);
 };

  const handleKesifSubmit = (e) => {
    e.preventDefault();
    if (kesifProducts.length === 0) {
      alert('Lütfen en az bir ürün ekleyin!');
      return;
    }
    setSelectedCompany({
      ...kesifCustomer,
      type: 'kesif',
      products: kesifProducts,
      settings: kesifSettings,
      totals: calculateKesifTotals()
    });
    setActiveTab('proposal');
  };

  // Periyodik Kontrol Hesaplama Motoru
  const calculatePeriodicPrices = (snapshot) => {
    const inputs = snapshot && Object.prototype.hasOwnProperty.call(snapshot, 'trafoGucu') ? snapshot : periodicInputs;
    try { const result = calculatePeriodicQuote(inputs, PERIODIC_PRICES); setPeriodicResults(result); return result; }
    catch (error) { alert(error.message); return null; }
  };

  // Para birimi değişikliği iÅŸleyicisi
  const handleCurrencyChange = (newCurrency) => {
    if (!['TRY','USD','EUR'].includes(newCurrency) || newCurrency === previousCurrency) return;
    if(![exchangeRates.USD,exchangeRates.EUR].every(rate=>Number.isFinite(Number(rate)) && Number(rate)>0)){alert('Döviz kurları sıfırdan büyük geçerli sayılar olmalı.');return;}
    
    // Diniim oranini hesapla
    let conversionRate = 1;
    if (previousCurrency === 'TRY' && newCurrency === 'USD') {
      conversionRate = 1 / exchangeRates.USD;
    } else if (previousCurrency === 'TRY' && newCurrency === 'EUR') {
      conversionRate = 1 / exchangeRates.EUR;
    } else if (previousCurrency === 'USD' && newCurrency === 'TRY') {
      conversionRate = exchangeRates.USD;
    } else if (previousCurrency === 'EUR' && newCurrency === 'TRY') {
      conversionRate = exchangeRates.EUR;
    } else if (previousCurrency === 'USD' && newCurrency === 'EUR') {
      conversionRate = exchangeRates.USD / exchangeRates.EUR;
    } else if (previousCurrency === 'EUR' && newCurrency === 'USD') {
      conversionRate = exchangeRates.EUR / exchangeRates.USD;
    }
    
    // Tüm params fiyatlarını dönüştür
    setParams(prev => ({
      ...prev,
      baseFee: parseFloat((prev.baseFee * conversionRate).toFixed(2)),
      rate1: parseFloat((prev.rate1 * conversionRate).toFixed(8)),
      rate2: parseFloat((prev.rate2 * conversionRate).toFixed(8)),
      poleFee1: parseFloat((prev.poleFee1 * conversionRate).toFixed(2)),
      poleFee2: parseFloat((prev.poleFee2 * conversionRate).toFixed(2)),
      poleFee3: parseFloat((prev.poleFee3 * conversionRate).toFixed(2))
    }));
    
    // Eğer seçili firma varsa, onun fiyatlarını da güncelle
    if (selectedCompany && selectedCompany.type !== 'kesif') {
      setSelectedCompany(prev => ({
        ...prev,
        nominalFee: parseFloat((prev.nominalFee * conversionRate).toFixed(2)),
        discountAmount: parseFloat((prev.discountAmount * conversionRate).toFixed(2)),
        offerPrice: parseFloat((prev.offerPrice * conversionRate).toFixed(2))
      }));
    }
    
    setPreviousCurrency(newCurrency);
    setCurrency(newCurrency);
  };
  
  const formatCurrency = (val, unit = currency) => {
    if (val === null || val === undefined || isNaN(val)) return "0,00";
    const currencySymbols = { 'TRY': 'TL', 'USD': '$', 'EUR': '€' };
    const symbol = currencySymbols[unit] || 'TL';
    if (val < 100) return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val) + ' ' + symbol;
    const formatted = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
    return formatted + ' ' + symbol;
  };
  
  const formatNumber = (val) => {
    if (val === null || val === undefined || isNaN(val)) return "0";
    return new Intl.NumberFormat('tr-TR').format(val);
  };

  // Helper to calculate fees for a single company object
  const calculateCompanyFees = (companyData, priceSnapshot = params) => calculateYGQuote(companyData, priceSnapshot, { referenceNo: proposalReferences.yg });

  // --- Handlers ---
  const generateProposal = (company) => {
    setSelectedCompany(company);
    setEditableContent('');setEditorMode(false);
    setAiOutput(""); 
    setAiActiveFeature(null);
    setActiveTab('proposal');
    setProposalCount(prev => prev + 1);
  };

  const handleDownloadPDF = async () => {
    if (!selectedCompany) { alert('Önce teklif oluşturun.'); return; }
    try {
      await exportHTMLReport({ root: document.getElementById('printable-paper'), selector: '.pdf-page',
        filename: reportFileName('YG_Teklif', selectedCompany.name), title: 'YG İşletme Sorumluluğu Teklifi' });
    } catch (error) { alert('PDF oluşturulamadı: ' + error.message); }
  };

  const handleDownloadWord = async () => {
    if (!selectedCompany) return;
    
    try {
      const [{ Document, Paragraph, TextRun, AlignmentType, HeadingLevel, Table, TableCell, TableRow, WidthType, BorderStyle, Packer }, { saveAs }] = await Promise.all([import('docx'), import('file-saver')]);
      const fileName = reportFileName('YG_Teklif', selectedCompany.name, 'docx');
      
      // Tablo satirlarini oluştur
      const createTableRow = (label, value) => {
        return new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ text: label })],
              width: { size: 40, type: WidthType.PERCENTAGE }
            }),
            new TableCell({
              children: [new Paragraph({ text: value })],
              width: { size: 60, type: WidthType.PERCENTAGE }
            })
          ]
        });
      };

      // Detayli hesaplama tablosu
      const calculationRows = [];
      
      if ((selectedCompany.type === 'uretim' || (selectedCompany.type !== 'direk' && selectedCompany.totalKVA >= 400))) {
        calculationRows.push(createTableRow('İlk 400 kVA (Sabit)', formatCurrency(params.baseFee)));
        
        if (selectedCompany.totalKVA > 400 && selectedCompany.totalKVA <= 5000) {
          calculationRows.push(createTableRow(
            `401 - ${selectedCompany.totalKVA} kVA Arası`, 
            formatCurrency((selectedCompany.totalKVA - 400) * params.rate1)
          ));
        } else if (selectedCompany.totalKVA > 5000) {
          calculationRows.push(createTableRow('401 - 5000 kVA Arası', formatCurrency(4600 * params.rate1)));
          calculationRows.push(createTableRow('5000 kVA üzeri', formatCurrency((selectedCompany.totalKVA - 5000) * params.rate2)));
        }
      } else {
        const poleType = selectedCompany.totalKVA <= 50 ? '0-50 kVA' : 
                        selectedCompany.totalKVA <= 160 ? '51-160 kVA' : '161-400 kVA';
        calculationRows.push(createTableRow(poleType + ' Sabit Bedel', formatCurrency(selectedCompany.nominalFee / selectedCompany.regionCoeff)));
      }

      if (selectedCompany.regionCoeff !== 1) {
        calculationRows.push(createTableRow(
          `Bölgesel katsayı (x${(selectedCompany.regionCoeff || 1.0).toFixed(2)})`,
          formatCurrency(selectedCompany.nominalFee - (selectedCompany.nominalFee / selectedCompany.regionCoeff))
        ));
      }

      // Word belgesi oluştur
      const doc = new Document({
        sections: [{
          properties: {
            page: {
              margin: {
                top: 1440, // 1 inch = 1440 twips
                right: 1440,
                bottom: 1440,
                left: 1440
              }
            }
          },
          children: [
            // Başlık
            new Paragraph({
              text: "FİYAT TEKLİFİ",
              heading: HeadingLevel.HEADING_1,
              alignment: AlignmentType.CENTER,
              spacing: { after: 300 }
            }),
            new Paragraph({
              text: `Ref: ${selectedCompany.refNo}`,
              alignment: AlignmentType.RIGHT,
              spacing: { after: 100 }
            }),
            new Paragraph({
              text: new Date().toLocaleDateString('tr-TR'),
              alignment: AlignmentType.RIGHT,
              spacing: { after: 300 }
            }),
            
            // Giriş
            new Paragraph({
              children: [
                new TextRun({
                  text: `Sayın ${selectedCompany.contactName ? `${selectedCompany.contactName} - ` : ''}${selectedCompany.name} Yetkilisi,`,
                  bold: true
                })
              ],
              spacing: { after: 200 }
            }),
            new Paragraph({
              text: `Tesisinize yönelik fiyat teklifi, girilen kurulu güç ve ${params.year} referans hesap parametreleriyle hazırlanmıştır. Temel hesap iki hücre kapsamındadır; ek hücreler ve ilave hizmetler bu hesaba dahil değildir. Güncel tarife, sözleşme kapsamı ve uygulanabilir koşullar teklif sorumlusu tarafından ayrıca doğrulanmalıdır.`,
              spacing: { after: 400 }
            }),
            
            // 1. Bölüm: Tesis Bilgileri
            new Paragraph({
              text: "1. Tesis Bilgileri ve Toplam Kurulu Güç",
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 200, after: 200 }
            }),
            new Paragraph({
              text: `Trafo güçleri dağılımı: ${selectedCompany.powerStr} kVA`,
              spacing: { after: 100 }
            }),
            new Paragraph({
              text: `Toplam kurulu güç: ${selectedCompany.totalKVA} kVA (${(selectedCompany.totalKVA / 1000).toFixed(2)} MVA)`,
              spacing: { after: 100 }
            }),
            new Paragraph({
              text: `Tesis tipi: ${selectedCompany.type === 'direk' ? 'Direk Tipi Trafo Merkezi' : selectedCompany.type === 'uretim' ? 'Üretim Tesisi (Bina Kapsamı)' : 'Bina Tipi Trafo Merkezi'}`,
              spacing: { after: 100 }
            }),
            new Paragraph({
              text: `Bölge/katsayı: ${selectedCompany.region || 'Belirtilmemiş'} (x${(selectedCompany.regionCoeff || 1.0).toFixed(2)})`,
              spacing: { after: 100 }
            }),
            new Paragraph({
              text: `Sektör: ${selectedCompany.sector}`,
              spacing: { after: 400 }
            }),
            
            // 2. Bölüm: Hesaplama
            new Paragraph({
              text: `2. ${params.year} Referans Parametrelerle Aylık Ücret Hesabı`,
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 200, after: 200 }
            }),
            
            // Hesaplama Tablosu
            new Table({
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph({ text: "Kapasite Aralığı", bold: true })],
                      shading: { fill: "bbdefb" }
                    }),
                    new TableCell({
                      children: [new Paragraph({ text: "Tutar (TL)", bold: true })],
                      shading: { fill: "bbdefb" }
                    })
                  ]
                }),
                ...calculationRows,
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph({ text: `REFERANS HESAP ÜCRETİ`, bold: true })],
                      shading: { fill: "c8f0c8" }
                    }),
                    new TableCell({
                      children: [new Paragraph({ text: formatCurrency(selectedCompany.nominalFee), bold: true })],
                      shading: { fill: "c8f0c8" }
                    })
                  ]
                })
              ],
              width: { size: 100, type: WidthType.PERCENTAGE }
            }),
            
            new Paragraph({ text: "", spacing: { after: 400 } }),
            
            ...(() => {
              const appliedDiscountRate = selectedCompany.appliedDiscountRate ?? params.discountRate ?? 0;
              const hasDiscount = Number(selectedCompany.discountAmount || 0) > 0 && Number(appliedDiscountRate) > 0;

              if (hasDiscount) {
                return [
                  // 3. Bölüm: İskonto ve Teklif
                  new Paragraph({
                    text: "3. Uygulanan İskonto ve Nihai Teklif",
                    heading: HeadingLevel.HEADING_2,
                    spacing: { before: 200, after: 200 }
                  }),
                  new Paragraph({
                    text: `Piyasa koşullarına uyum sağlamak amacıyla, işletmenize özel %${appliedDiscountRate} iskonto uygulanmıştır.`,
                    spacing: { after: 300 }
                  }),
                  new Table({
                    rows: [
                      createTableRow('Referans hesap ücreti:', formatCurrency(selectedCompany.nominalFee)),
                      createTableRow(`İskonto Tutarı (%${appliedDiscountRate}):`, `- ${formatCurrency(selectedCompany.discountAmount)}`),
                      new TableRow({
                        children: [
                          new TableCell({
                            children: [new Paragraph({ text: "AYLIK TEKLİF FİYATI:", bold: true })],
                            shading: { fill: "c8e6c9" }
                          }),
                          new TableCell({
                            children: [new Paragraph({
                              children: [new TextRun({ text: `${formatCurrency(selectedCompany.offerPrice)} + KDV`, bold: true, color: "1b5e20" })]
                            })],
                            shading: { fill: "c8e6c9" }
                          })
                        ]
                      })
                    ],
                    width: { size: 100, type: WidthType.PERCENTAGE }
                  })
                ];
              }

              return [
                new Table({
                  rows: [
                    createTableRow('Referans hesap ücreti:', formatCurrency(selectedCompany.nominalFee)),
                    new TableRow({
                      children: [
                        new TableCell({
                          children: [new Paragraph({ text: "AYLIK TEKLİF FİYATI:", bold: true })],
                          shading: { fill: "c8e6c9" }
                        }),
                        new TableCell({
                          children: [new Paragraph({
                            children: [new TextRun({ text: `${formatCurrency(selectedCompany.offerPrice)} + KDV`, bold: true, color: "1b5e20" })]
                          })],
                          shading: { fill: "c8e6c9" }
                        })
                      ]
                    })
                  ],
                  width: { size: 100, type: WidthType.PERCENTAGE }
                })
              ];
            })(),
            
            new Paragraph({ text: "", spacing: { after: 400 } }),
            
            // Açıklamalar
            new Paragraph({
              text: "Açıklamalar:",
              bold: true,
              spacing: { before: 400, after: 200 }
            }),
            new Paragraph({
              text: `1. Bu teklif ${params.year} yılı boyunca geçerli olmak üzere aylık periyotlarla hazırlanmıştır.`,
              spacing: { after: 100 }
            }),
            new Paragraph({
              text: "2. İşletme sorumluluğu hizmetinin SMM tarafından üstlenilmesi hâlinde YG tesisi en az ayda bir kez denetlenmelidir.",
              spacing: { after: 100 }
            }),
            new Paragraph({
              text: "3. Enerji tüketiminin izlenmesi ve kompanzasyon tesisinin sağlıklı çalışıp çalışmadığının denetlenmesi bu hizmetin sorumluluk kapsamındadır.",
              spacing: { after: 100 }
            }),
            new Paragraph({
              text: "4. Hizmet kapsamı, sorumlu mühendis ve uygulanabilir koşullar tarafların onayladığı sözleşmede belirlenir.",
              spacing: { after: 100 }
            }),
            new Paragraph({
              text: "5. İşveren olarak sizin yükümlülüğünüz, İşletme Sorumlusunun görevlerini yerine getirebilmesi için gerekli imalatları/hizmetleri sağlamak, talep edilen güvenlik malzemelerini almak ve uyarılarına riayet etmektir.",
              spacing: { after: 400 }
            }),
            
            // Footer
            new Paragraph({
              text: "Saygilarimizla,",
              spacing: { before: 600, after: 100 }
            }),
            new Paragraph({
              text: "VoltGuard",
              bold: true,
              spacing: { after: 100 }
            }),
            new Paragraph({
              text: COMPANY_EMAIL_WEBSITE_LINE,
              spacing: { after: 50 }
            }),
            new Paragraph({
              text: COMPANY_PHONE_ADDRESS_LINE
            })
          ]
        }]
      });

      const blob = await Packer.toBlob(doc);
      saveAs(blob, fileName);
    } catch (error) {
      console.error('Word belgesi oluşturma hatasi:', error);
      alert('Word belgesi oluşturulurken bir hata oluitu. Lütfen tekrar deneyin.');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    const manualCompany = {
        id: 'MANUEL', 
        name: manualForm.name,
        sector: manualForm.sector,
        powerStr: manualForm.powerStr,
        contactName: manualForm.contactName,
        type: manualForm.type,
        region: manualForm.region, // Bölge adı
        regionCoeff: manualForm.regionCoeff, // Manuel formdan gelen özel katsayı
        discountRate: manualForm.customDiscount // Manuel formdan gelen özel İskonto
    };
    const calculated = calculateCompanyFees(manualCompany);
    generateProposal(calculated);
  };

  const handleRegionChange = (e) => {
    const selectedRegionName = e.target.value;
    const selectedRegion = REGION_LIST.find(r => r.name === selectedRegionName);
    if (selectedRegion) {
        setManualForm({
            ...manualForm,
            region: selectedRegionName,
            regionCoeff: selectedRegion.coeff
        });
    }
  };

  // --- Logo Upload Handler ---
  const handleLogoUpload = (e) => {
      const file = e.target.files[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
              setLogo(reader.result);
          };
          reader.readAsDataURL(file);
      }
  };

  const proposalEmailText=()=>{
 if(!selectedCompany)return '';const total=selectedCompany.type==='kesif'?selectedCompany.totals?.grandTotal:selectedCompany.offerPrice;
 return 'Sayın '+(selectedCompany.contactName || 'Yetkili')+',\n\n'+selectedCompany.name+' için hazırlanan '+(selectedCompany.refNo || proposalReferences.kesif)+' referanslı teklifimizi değerlendirmenize sunarız.\n'+(selectedCompany.totalKVA?'Trafo gücü: '+selectedCompany.totalKVA+' kVA\n':'')+'Teklif tutarı: '+formatCurrency(total,selectedCompany.type==='kesif'?'TRY':currency)+(selectedCompany.type==='kesif'?' (KDV dahil)':' + KDV (aylık)')+'\n\nPDF belgesini bu e-postaya ayrıca ekleyiniz ve teklif koşullarını kontrol ediniz.\n\nSaygılarımızla,\n'+COMPANY_NAME+'\n'+COMPANY_EMAIL_WEBSITE_LINE;
 };
 const handleProposalAssistant=type=>{
 if(!selectedCompany)return;setAiActiveFeature(type);setAiLoading(false);setAiError(null);if(type==='email'){setAiOutput(proposalEmailText());return;}
 const checks=[['Firma adı',Boolean(selectedCompany.name?.trim())],['Trafo gücü',Number(selectedCompany.totalKVA)>0],['Teklif tutarı',Number.isFinite(Number(selectedCompany.offerPrice)) && Number(selectedCompany.offerPrice)>=0],['İskonto',Number(selectedCompany.appliedDiscountRate)>=0 && Number(selectedCompany.appliedDiscountRate)<=100]];
 setAiOutput(checks.map(([label,ok])=>(ok?'✓ ':'Eksik / kontrol edin: ')+label).join('\n')+'\n\nBu kontrol teklif alanlarını karşılaştırır. Ekipman ve saha değerlendirmesini proje sorumlusu yapar.');
 };

  const copyToClipboard = () => {
      if (aiOutput) {
          navigator.clipboard.writeText(aiOutput);
          alert("Metin kopyalandı!");
      }
  };

  // --- Excel Export Handler ---
  const handleExcelExport = () => {
    if (!selectedCompany) return;
    
    const workbook = XLSX.utils.book_new();
    
    // Teklif Bilgileri Sayfasi
    const proposalData = [
      ['YÜKSEK GERİLİM İŞLETME SORUMLULUĞU TEKLİFİ'],
      [],
      ['Referans No:', selectedCompany.refNo],
      ['Tarih:', new Date().toLocaleDateString('tr-TR')],
      [],
      ['FİRMA BİLGİLERİ'],
      ['Firma Unvani:', selectedCompany.name],
      ['Yetkili:', selectedCompany.contactName],
      ['Sektör:', selectedCompany.sector],
      ['Tesis Tipi:', selectedCompany.type === 'direk' ? 'Direk Tipi' : selectedCompany.type === 'uretim' ? 'Üretim tesisi' : 'Bina Tipi'],
      ['Bölge:', selectedCompany.region || 'Belirtilmemiş'],
      ['Bölge Katsayisi:', selectedCompany.regionCoeff],
      [],
      ['GÜÇ BİLGİLERİ'],
      ['Trafo Güçleri:', selectedCompany.powerStr + ' kVA'],
      ['Toplam Kurulu Güç:', selectedCompany.totalKVA + ' kVA'],
      ['Toplam Kurulu Güç (MVA):', (selectedCompany.totalKVA / 1000).toFixed(2)],
      [],
      ['MALİ BİLGİLER'],
      ['Referans hesap ücreti:', Number(selectedCompany.nominalFee)],
      ['İskonto Oranı (%):', Number(selectedCompany.appliedDiscountRate ?? params.discountRate)],
      ['İskonto Tutarı (TL):', Number(selectedCompany.discountAmount)],
      ['AYLIK TEKLİF FİYATI (TL, KDV HARİÇ):', Number(selectedCompany.offerPrice)],
      [],
      [COMPANY_NAME],
      [COMPANY_EMAIL_WEBSITE_LINE],
      [COMPANY_PHONE_ADDRESS_LINE]
    ];
    
    const worksheet = XLSX.utils.aoa_to_sheet(proposalData);
    proposalData.forEach((row, index) => {
      const cell = worksheet[XLSX.utils.encode_cell({ r: index, c: 1 })];
      if (cell && typeof row[1] === 'number') cell.z = /TL/.test(String(row[0])) ? '#,##0.00 \"TL\"' : '0.00';
    });
    
    // SÜTUN genilikleri
    worksheet['!cols'] = [
      { wch: 25 },
      { wch: 50 }
    ];
    
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Teklif');
    
    // Dosya adı
    const fileName = reportFileName('YG_Teklif', selectedCompany.name, 'xlsx');
    
    XLSX.writeFile(workbook, fileName);
  };

  // --- Email Güçnderme Handler ---
  const handleSendEmail=()=>{
 if(!selectedCompany){alert('Önce teklif oluşturun.');return;}const value=prompt('Alıcı e-posta adresi (taslak açılacak):');if(!value)return;const email=value.trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254){alert('Geçerli bir e-posta adresi girin.');return;}
 const body=proposalEmailText();setAiOutput(body);setAiActiveFeature('email');const subject=(selectedCompany.refNo || proposalReferences.kesif)+' · '+selectedCompany.name+' · VoltGuard teklifi';
 window.location.href='mailto:'+encodeURIComponent(email)+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
 };

  const toggleEditorMode=()=>{const element=document.getElementById('printable-paper');if(element)setEditableContent(reportHTMLWithReference(element.innerHTML,selectedCompany?.refNo || proposalReferences.yg));setEditorMode(!editorMode);};
 const toggleGesEditorMode=()=>{if(gesError){alert(gesError.message);return;}const element=document.getElementById('ges-printable-area');if(element)setGesEditableContent(reportHTMLWithReference(element.innerHTML,proposalReferences.ges));setGesEditorMode(!gesEditorMode);};
 const togglePeriodicEditorMode=()=>{const element=document.getElementById('periodic-printable-paper');if(element)setPeriodicEditableContent(reportHTMLWithReference(element.innerHTML,proposalReferences.periodic));setPeriodicEditorMode(!periodicEditorMode);};

  // Periyodik Kontrol PDF Export
  const handlePeriodicPDFExport = async () => {
    if (!periodicCustomer.name) { alert('Lütfen müşteri bilgilerini doldurun.'); return; }
    try {
      await exportHTMLReport({ root: document.getElementById('periodic-printable-paper'), selector: '.periodic-pdf-page',
        filename: reportFileName('Periyodik_Kontrol_Teklif', periodicCustomer.name), title: 'Periyodik Kontrol Fiyat Teklifi' });
    } catch (error) { alert('PDF oluşturulamadı: ' + error.message); }
  };

  // --- GeliÅŸmiÅŸ PDF Export ---
  const handleAdvancedPDFExport = async () => {
    if (!selectedCompany) return;
    
    const doc = await createReportPDF({ title: 'YG İşletme Sorumluluğu Teklifi' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    
    // Başlık
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('FİYAT TEKLİFİ', pageWidth / 2, margin, { align: 'center' });
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Ref: ${selectedCompany.refNo}`, pageWidth - margin, margin + 10, { align: 'right' });
    doc.text(new Date().toLocaleDateString('tr-TR'), pageWidth - margin, margin + 15, { align: 'right' });
    
    // Firma Bilgileri
    let yPos = margin + 30;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`Sayın ${selectedCompany.contactName || ''} - ${selectedCompany.name} Yetkilisi,`, margin, yPos);
    
    yPos += 10;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const introText = `Tesisinize yönelik fiyat teklifi ${params.year} referans parametrelerle hazırlanmıştır. Temel hesap iki hücreyi kapsar; ek hücre ve hizmetler dahil değildir. Güncel kaynak ve kapsam teklif sorumlusu tarafından doğrulanmalıdır.`;
    const splitText = doc.splitTextToSize(introText, pageWidth - 2 * margin);
    doc.text(splitText, margin, yPos);
    
    yPos += splitText.length * 5 + 10;
    
    // Tablo
    doc.autoTable({
      startY: yPos,
      head: [['Özellik', 'Değer']],
      body: [
        ['Toplam Kurulu Güç', `${selectedCompany.totalKVA} kVA`],
        ['Tesis Tipi', selectedCompany.type === 'direk' ? 'Direk Tipi' : selectedCompany.type === 'uretim' ? 'Üretim Tesisi' : 'Bina Tipi'],
        ['Bölge', selectedCompany.region || 'Belirtilmemiş'],
        ['Sektör', selectedCompany.sector],
        ['Referans hesap ücreti', formatCurrency(selectedCompany.nominalFee)],
        ['İskonto Oranı', `%${selectedCompany.appliedDiscountRate ?? params.discountRate}`],
        ['İskonto Tutari', formatCurrency(selectedCompany.discountAmount)],
      ],
      theme: 'grid',
      headStyles: { fillColor: [30, 58, 138] }
    });
    
    // Nihai Teklif
    yPos = doc.lastAutoTable.finalY + 15;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('AYLIK TEKLİF FİYATI:', margin, yPos);
    doc.text(`${formatCurrency(selectedCompany.offerPrice)} + KDV`, pageWidth - margin, yPos, { align: 'right' });
    
    // Footer
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(COMPANY_NAME, pageWidth / 2, pageHeight - 18, { align: 'center' });
    doc.text([COMPANY_EMAIL_WEBSITE_LINE, `Tel: ${COMPANY_PHONE}`, COMPANY_ADDRESS_LINE_1, COMPANY_ADDRESS_LINE_2], pageWidth / 2, pageHeight - 13, { align: 'center' });
    
    // Kaydet
    const fileName = `YG_Teklif_${selectedCompany.name.replace(/\s+/g, '_')}_${new Date().toLocaleDateString('tr-TR').replace(/\./g, '-')}.pdf`;
    doc.save(fileName);
  };

  // --- UI Components ---
  const printRoot = { proposal: '#printable-paper', ges: '#ges-printable-area', periodic: '#periodic-printable-paper', kesif: '#kesif-printable-paper', kontrol: '#periodic-control-report', osos: '#osos-printable-report', 'haftalik-raporlama': '#haftalik-rapor-printable' }[activeTab];

  return (
    <div className="portal-app bg-gray-50 text-gray-800 font-sans" data-portal-module={activeTab}>
      <style>{`
        @media print {
          @page { margin: 0; size: A4 portrait; }
          #vg-company-workspace * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print, .no-print-border { display: none !important; border: none !important; }
          ${printRoot ? `
          body:has(${printRoot}), body :has(${printRoot}) {
            display: block !important; position: static !important; overflow: visible !important;
            width: auto !important; max-width: none !important; height: auto !important;
            min-height: 0 !important; max-height: none !important; margin: 0 !important;
            padding: 0 !important; transform: none !important; background: white !important;
          }
          body:has(${printRoot}) :not(${printRoot}):not(${printRoot} *):not(:has(${printRoot})) { display: none !important; }
          ${printRoot}, ${printRoot} * { visibility: visible !important; }
          ${printRoot} { display: block !important; position: relative !important; width: 210mm !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; background: white; }
          ${printRoot} > .vg-reference-line { position: absolute; top: 2mm; left: 10mm; margin: 0 !important; }
          ${printRoot} :is(.pdf-page,.ges-pdf-page,.periodic-pdf-page,.kesif-pdf-page,.haftalik-pdf-page,.print-container) {
            box-shadow: none !important; margin: 0 !important; width: 210mm !important; max-width: 100% !important;
            page-break-before: auto !important; page-break-after: always !important; page-break-inside: avoid !important;
          }
          ${printRoot} :is(.pdf-page,.ges-pdf-page,.periodic-pdf-page,.kesif-pdf-page,.haftalik-pdf-page,.print-container):last-child { page-break-after: auto !important; }
          ${printRoot} table { page-break-inside: auto !important; }
          ${printRoot} tr { page-break-inside: avoid !important; }
          #ges-printable-area .ges-pdf-page, #periodic-printable-paper .periodic-pdf-page { padding-bottom: 28mm !important; }
          #ges-printable-area .ges-pdf-page .flex.justify-end.mt-auto > [class~="w-1/2"] { width: 66.6667% !important; }
          #periodic-printable-paper .periodic-pdf-page img.h-24 { height: 80px !important; }
          #periodic-printable-paper .periodic-pdf-page .mb-8 { margin-bottom: 16px !important; }
          #periodic-printable-paper .flex.justify-between > span:last-child { white-space: nowrap; }
          ` : ''}
        }

        /* PDF Export specific styles */
        .pdf-page {
          page-break-after: always;
          page-break-inside: avoid;
        }

        /* PDF export quality tweaks (html2pdf) */
        .pdf-exporting {
          background: #ffffff !important;
        }
        .pdf-exporting#printable-paper {
          width: 210mm !important;
          margin: 0 auto !important;
          padding: 0 !important;
        }
        .pdf-exporting .pdf-page {
          box-shadow: none !important;
          margin: 0 auto !important;
          width: 210mm !important;
          min-height: 297mm !important;
          background: #ffffff !important;
        }
        .pdf-exporting .no-print,
        .pdf-exporting .print-hide {
          display: none !important;
        }
`}</style>
      
      {/* Header */}
      <header className="bg-blue-900 text-white shadow-lg no-print">
        <div className="container mx-auto px-3 md:px-6 py-3 md:py-4 flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="flex items-center space-x-2 md:space-x-3">
            <Calculator className="h-6 w-6 md:h-8 md:w-8 text-yellow-400" />
            <div>
              <h1 className="text-base md:text-xl font-bold">VoltGuard</h1>
              <p className="text-[10px] md:text-xs text-blue-200">Teklif, kayıt ve rapor yönetimi</p>
            </div>
          </div>
          <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
            <div className="hidden sm:flex px-2 md:px-3 py-1 bg-blue-800 rounded-full text-[10px] md:text-xs text-blue-200 items-center">
                <Sparkles className="w-3 h-3 mr-1 text-yellow-400"/>
                Şirket teklif araçları
            </div>
            <button 
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className="flex items-center space-x-1 md:space-x-2 bg-blue-800 hover:bg-blue-700 px-2 md:px-4 py-1.5 md:py-2 rounded-lg transition text-xs md:text-sm"
            >
              <Settings className="h-3 w-3 md:h-4 md:w-4" />
              <span className="hidden sm:inline">Parametreler</span>
              <span className="sm:hidden">Ayarlar</span>
            </button>
          </div>
        </div>
      </header>

      {/* Settings Panel (Collapsible) */}
      {isSettingsOpen && (
        <div className="bg-white border-b border-gray-200 shadow-inner">
          <div className="container mx-auto px-3 md:px-6 py-4 md:py-6">
            <h3 className="font-semibold text-gray-700 mb-3 md:mb-4 flex items-center text-sm md:text-base">
              <Edit3 className="h-3 w-3 md:h-4 md:w-4 mr-2" />
              Hesaplama parametreleri · 2026 referans
            </h3>
            <p className="mt-3 text-sm text-amber-800">2026 referans değerleri güncel kaynak ve kapsamla teklif sorumlusu tarafından doğrulanmalıdır. Temel hesap iki hücreyi kapsar; ek hücreler dahil değildir.</p><label className="mt-3 block text-sm">Sorumlu mühendisin doğrulanmış oda sicil numarası<input type="text" maxLength={40} value={params.registrationNumber || ""} onChange={event=>setParams(previous=>({...previous,registrationNumber:event.target.value}))} className="mt-1 w-full rounded border p-2" placeholder="Yetkili mühendis bilgisi" /></label>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Sabit Ücret (Bina 0-400)</label>
                <div className="relative">
                  <input 
                    type="number" 
                    value={params.baseFee} 
                    onChange={(e) => setParams({...params, baseFee: parseFloat(e.target.value) || 0})}
                    className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                  />
                  <span className="absolute right-3 top-2 text-gray-400 text-sm">{currency}</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Birim Fiyat (401-5000)</label>
                <div className="relative">
                  <input 
                    type="number" 
                    value={params.rate1} 
                    onChange={(e) => setParams({...params, rate1: parseFloat(e.target.value) || 0})}
                    className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                  />
                  <span className="absolute right-3 top-2 text-gray-400 text-sm">TL/kVA</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Birim Fiyat (&gt;5000 kVA)</label>
                <div className="relative">
                  <input 
                    type="number" 
                    value={params.rate2} 
                    onChange={(e) => setParams({...params, rate2: parseFloat(e.target.value) || 0})}
                    className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                  />
                  <span className="absolute right-3 top-2 text-gray-400 text-sm">TL/kVA</span>
                </div>
              </div>
               <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Global Bölge Katsayisi (BK)</label>
                <div className="relative">
                  <input 
                    type="number"
                    step="0.05"
                    value={params.regionCoeff} 
                    onChange={(e) => setParams({...params, regionCoeff: parseFloat(e.target.value) || 1.0})}
                    className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none" 
                  />
                  <span className="absolute right-3 top-2 text-gray-400 text-sm">x</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">Örn: İzmir: 1.00, Adana: 0.75 (Liste dışı için)</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Global İskonto</label>
                <div className="relative">
                  <input 
                    type="number" 
                    value={params.discountRate} 
                    onChange={(e) => setParams({...params, discountRate: parseFloat(e.target.value) || 0})}
                    className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-blue-700 font-bold" 
                  />
                  <span className="absolute right-3 top-2 text-gray-400 text-sm">%</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">YG ücret para birimi</label>
                <select 
                  value={currency} 
                  onChange={(e) => handleCurrencyChange(e.target.value)}
                  className="w-full border rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none font-semibold text-blue-700"
                >
                  <option value="TRY">🇹🇷 Türk Lirası (TL)</option>
                  <option value="USD">🇺🇸 Dolar ($)</option>
                  <option value="EUR">🇪🇺 Euro (€)</option>
                </select>
              </div>
              {/* Kur Oranları */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-600 mb-2">💱 Kur Oranları (1 yabancı para = TL)</label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500">USD Kuru</label>
                    <div className="relative">
                      <input 
                        type="number" 
                        step="0.01"
                        value={exchangeRates.USD} 
                        onChange={(e) => setExchangeRates({...exchangeRates, USD: parseFloat(e.target.value) || 1})}
                        className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none" 
                      />
                      <span className="absolute right-3 top-2 text-gray-400 text-xs">TL/$</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">EUR Kuru</label>
                    <div className="relative">
                      <input 
                        type="number" 
                        step="0.01"
                        value={exchangeRates.EUR} 
                        onChange={(e) => setExchangeRates({...exchangeRates, EUR: parseFloat(e.target.value) || 1})}
                        className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none" 
                      />
                      <span className="absolute right-3 top-2 text-gray-400 text-xs">TL/€</span>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-yellow-600 mt-1">⚠️ Para birimini değiştirdiğinizde tüm fiyatlar otomatik dönüştürülecektir.</p>
              </div>
              {/* Direk Tipi Ayarlari */}
              <div className="md:col-span-3 border-t pt-4 mt-2">
                 <p className="text-xs font-bold text-gray-500 mb-2">DiREK TİPi TRAFOLAR (EMO Madde 3.1)</p>
                 <div className="grid grid-cols-3 gap-4">
                    <div>
                        <label className="text-xs text-gray-500">0-50 kVA</label>
                        <input type="number" value={params.poleFee1} onChange={(e) => setParams({...params, poleFee1: parseFloat(e.target.value) || 0})} className="w-full border p-1 rounded text-xs" />
                    </div>
                    <div>
                        <label className="text-xs text-gray-500">51-160 kVA</label>
                        <input type="number" value={params.poleFee2} onChange={(e) => setParams({...params, poleFee2: parseFloat(e.target.value) || 0})} className="w-full border p-1 rounded text-xs" />
                    </div>
                    <div>
                        <label className="text-xs text-gray-500">161-400 kVA</label>
                        <input type="number" value={params.poleFee3} onChange={(e) => setParams({...params, poleFee3: parseFloat(e.target.value) || 0})} className="w-full border p-1 rounded text-xs" />
                    </div>
                 </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isSidebarOpen && <div className="portal-module-backdrop no-print" onClick={() => { setIsSidebarOpen(false); moduleButtonRef.current?.focus(); }} />}
      <aside id="portal-modules" className="portal-module-drawer no-print" hidden={!isSidebarOpen} role="dialog" aria-modal="true" aria-labelledby="portal-module-title">
        <div className="portal-module-drawer__heading"><h2 id="portal-module-title">Şirket modülleri</h2><button type="button" ref={moduleCloseRef} onClick={() => { setIsSidebarOpen(false); moduleButtonRef.current?.focus(); }} aria-label="Modül menüsünü kapat"><X size={22} /></button></div>
        <nav aria-label="Şirket modülleri">
          {['Teklifler', 'İş ve kayıtlar', 'Enerji ve kontrol', 'Bordro', ...(currentUser?.role === 'admin' ? ['Yönetim'] : [])].map(group => <div className="portal-module-group" key={group}><h3>{group}</h3>{PORTAL_MODULES.filter(item => item.group === group && (!item.adminOnly || currentUser?.role === 'admin')).map(item => <button type="button" key={item.id} disabled={item.draftOnly && !selectedCompany} aria-current={activeTab === item.id ? 'page' : undefined} onClick={() => { setActiveTab(item.id); setIsSidebarOpen(false); moduleButtonRef.current?.focus(); }}><span>{item.label}</span><ChevronRight size={16} /></button>)}</div>)}

        </nav>
      </aside>

      {/* Main Content */}
      <div className="container mx-auto px-2 md:px-6 py-4 md:py-8">
        
        <div className="portal-module-toolbar no-print"><button type="button" ref={moduleButtonRef} onClick={() => setIsSidebarOpen(true)} aria-expanded={isSidebarOpen} aria-controls="portal-modules"><Menu size={20} /> Modüller</button><p>{PORTAL_MODULES.find(item => item.id === activeTab)?.label}</p></div>

        {/* GES Teklifi Tab */}
        {activeTab === 'ges' && (
          <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-4 md:gap-6 h-auto lg:h-[calc(100vh-200px)]">
            {/* Sol Panel - Editir */}
            <div className="w-full lg:w-5/12 bg-white rounded-xl shadow-lg border border-gray-200 flex flex-col overflow-hidden">
              <div className="bg-gradient-to-r from-yellow-600 to-orange-600 px-4 md:px-6 py-3 md:py-4 border-b border-yellow-800 shrink-0">
                <h2 className="text-base md:text-lg font-bold text-white flex items-center">
                  <Zap className="mr-2 h-4 w-4 md:h-5 md:w-5"/>
                  GES Teklifi Editiri
                </h2>
                <p className="text-yellow-100 text-[10px] md:text-xs mt-1">Güneş Enerjisi Sistemi Fiyat Teklifi</p>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Genel Ayarlar */}
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <h3 className="text-sm font-bold text-blue-800 uppercase mb-3">Genel Ayarlar</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <input 
                      type="text" 
                      placeholder="Müşteri adı"
                      value={gesForm.customerName}
                      onChange={(e) => setGesForm({...gesForm, customerName: e.target.value})}
                      className="px-3 py-2 text-sm border rounded w-full"
                    />
                    <input 
                      type="text" 
                      placeholder="Lokasyon"
                      value={gesForm.location}
                      onChange={(e) => setGesForm({...gesForm, location: e.target.value})}
                      className="px-3 py-2 text-sm border rounded w-full"
                    />
                    <input 
                      type="text"
                      inputMode="decimal"
                      placeholder="Dolar Kuru"
                      aria-label="Dolar kuru (TL)"
                      aria-invalid={gesError?.field === 'usdRate'}
                      aria-describedby="ges-validation"
                      value={gesForm.usdRate}
                      onChange={(e) => setGesForm({...gesForm, usdRate: e.target.value})}
                      step="0.01"
                      className="px-3 py-2 text-sm border rounded w-full"
                    />
                    <input 
                      type="date"
                      aria-label="Teklif tarihi"
                      aria-invalid={gesError?.field === 'offerDate'}
                      aria-describedby="ges-validation"
                      value={gesForm.offerDate}
                      onChange={(e) => setGesForm({...gesForm, offerDate: e.target.value})}
                      className="px-3 py-2 text-sm border rounded w-full"
                    />
                  </div>
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Logo Yikle</label>
                    <input 
                      type="file" 
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (e) => setLogo(e.target.result);
                          reader.readAsDataURL(file);
                        }
                      }}
                      className="w-full text-xs text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-blue-100 file:text-blue-700"
                    />
                  </div>
                </div>

                <p id="ges-validation" role={gesError ? 'alert' : undefined} className={gesError ? 'p-3 bg-red-50 text-red-900 border border-red-200 rounded text-sm' : 'text-sm text-gray-600'}>{gesError ? gesError.message : 'Dolar kurunu 1 USD için TL olarak girin. Miktarlar pozitif, fiyat ve oranlar sıfır veya pozitif olmalı; ondalık için virgül kullanabilirsiniz.'}</p>

                {/* Hizli Paket Yikleyici */}
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Kurulu Güç (kW)</label>
                      <input 
                        type="text"
                        inputMode="decimal"
                        aria-label="Kurulu güç (kW)"
                        aria-invalid={gesError?.field === 'autoPower'}
                        aria-describedby="ges-validation"
                        value={gesForm.autoPower}
                        onChange={(e) => setGesForm({...gesForm, autoPower: e.target.value})}
                        className="px-3 py-2 text-sm border rounded w-full"
                      />
                    </div>
                    <div className="flex gap-1">
                      <button 
                        onClick={loadDefaultGESPackage}
                        className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded text-xs font-semibold transition h-[38px]"
                        title="12kW Ev Tipi Paket"
                      >
                        <Users className="w-3 h-3 inline mr-1"/>
                        Ev Tipi
                      </button>
                      <button 
                        onClick={loadCommercialGESPackage}
                        className="bg-orange-600 hover:bg-orange-700 text-white px-3 py-2 rounded text-xs font-semibold transition h-[38px]"
                        title="25kW Ticari Paket"
                      >
                        <Hammer className="w-3 h-3 inline mr-1"/>
                        Ticari (25kW)
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">* Paket butonlari mevcut listeyi silip standart iablonlari yikler</p>
                </div>

                {/* Malzeme Listesi */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-sm font-bold text-gray-800 uppercase">Malzeme Listesi</h3>
                    <button 
                      onClick={addNewGESRow}
                      className="text-green-600 text-xs font-bold hover:underline flex items-center"
                    >
                      <Plus className="w-3 h-3 mr-1"/>
                      Manuel Satır Ekle
                    </button>
                  </div>

                  {/* Hizli ürün Ekleme */}
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-3 rounded-lg border border-blue-200 mb-3">
                    <h4 className="text-xs font-bold text-blue-800 mb-2 flex items-center">
                      <Sparkles className="w-3 h-3 mr-1"/>
                      Hizli ürün Ekle (Veritabanından)
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      <select 
                        onChange={(e) => {
                          if (e.target.value) {
                            const [category, key] = e.target.value.split('|');
                            const product = gesDB[category][key];
                            setGesItems([...gesItems, {
                              brand: product.brand,
                              desc: product.name,
                              qty: 1,
                              price: product.price
                            }]);
                            e.target.value = '';
                          }
                        }}
                        className="text-xs border border-blue-300 rounded px-2 py-1.5 bg-white"
                      >
                        <option value="">🔋 Akü Seç</option>
                        {Object.entries(gesDB.batteries).map(([key, prod]) => (
                          <option key={key} value={`batteries|${key}`}>
                            {prod.name} - ${prod.price}
                          </option>
                        ))}
                      </select>

                      <select 
                        onChange={(e) => {
                          if (e.target.value) {
                            const [category, key] = e.target.value.split('|');
                            const product = gesDB[category][key];
                            setGesItems([...gesItems, {
                              brand: product.brand,
                              desc: product.name,
                              qty: 1,
                              price: product.price
                            }]);
                            e.target.value = '';
                          }
                        }}
                        className="text-xs border border-blue-300 rounded px-2 py-1.5 bg-white"
                      >
                        <option value="">? inverter Seç</option>
                        {Object.entries(gesDB.inverters).map(([key, prod]) => (
                          <option key={key} value={`inverters|${key}`}>
                            {prod.name} - ${prod.price}
                          </option>
                        ))}
                      </select>

                      <select 
                        onChange={(e) => {
                          if (e.target.value) {
                            const [category, key] = e.target.value.split('|');
                            const product = gesDB[category][key];
                            setGesItems([...gesItems, {
                              brand: product.brand,
                              desc: product.name,
                              qty: 1,
                              price: product.price
                            }]);
                            e.target.value = '';
                          }
                        }}
                        className="text-xs border border-blue-300 rounded px-2 py-1.5 bg-white"
                      >
                        <option value="">☀️ Panel Seç</option>
                        {Object.entries(gesDB.panels).map(([key, prod]) => (
                          <option key={key} value={`panels|${key}`}>
                            {prod.name} - ${prod.price}
                          </option>
                        ))}
                      </select>

                      <select 
                        onChange={(e) => {
                          if (e.target.value) {
                            const [category, key] = e.target.value.split('|');
                            const product = gesDB[category][key];
                            setGesItems([...gesItems, {
                              brand: product.brand,
                              desc: product.name,
                              qty: 1,
                              price: product.price
                            }]);
                            e.target.value = '';
                          }
                        }}
                        className="text-xs border border-blue-300 rounded px-2 py-1.5 bg-white"
                      >
                        <option value="">🗄️ Kabinet Seç</option>
                        {Object.entries(gesDB.cabinets).map(([key, prod]) => (
                          <option key={key} value={`cabinets|${key}`}>
                            {prod.name} - ${prod.price}
                          </option>
                        ))}
                      </select>

                      <select 
                        onChange={(e) => {
                          if (e.target.value) {
                            const [category, key] = e.target.value.split('|');
                            const product = gesDB[category][key];
                            setGesItems([...gesItems, {
                              brand: product.brand,
                              desc: product.name,
                              qty: 1,
                              price: product.price
                            }]);
                            e.target.value = '';
                          }
                        }}
                        className="text-xs border border-blue-300 rounded px-2 py-1.5 bg-white"
                      >
                        <option value="">🔌 Kablo/Konnektör</option>
                        {Object.entries(gesDB.cables).map(([key, prod]) => (
                          <option key={key} value={`cables|${key}`}>
                            {prod.name} - ${prod.price}
                          </option>
                        ))}
                      </select>

                      <select 
                        onChange={(e) => {
                          if (e.target.value) {
                            const [category, key] = e.target.value.split('|');
                            const product = gesDB[category][key];
                            setGesItems([...gesItems, {
                              brand: product.brand,
                              desc: product.name,
                              qty: 1,
                              price: product.price
                            }]);
                            e.target.value = '';
                          }
                        }}
                        className="text-xs border border-blue-300 rounded px-2 py-1.5 bg-white"
                      >
                        <option value="">🔧 Aksesuar Seç</option>
                        {Object.entries(gesDB.accessories).map(([key, prod]) => (
                          <option key={key} value={`accessories|${key}`}>
                            {prod.name} - ${prod.price}
                          </option>
                        ))}
                      </select>

                      <select 
                        onChange={(e) => {
                          if (e.target.value) {
                            const [category, key] = e.target.value.split('|');
                            const product = gesDB[category][key];
                            setGesItems([...gesItems, {
                              brand: product.brand,
                              desc: product.name,
                              qty: 1,
                              price: product.price
                            }]);
                            e.target.value = '';
                          }
                        }}
                        className="text-xs border border-blue-300 rounded px-2 py-1.5 bg-white"
                      >
                        <option value="">🖥️ BMS Seç</option>
                        {Object.entries(gesDB.bms).map(([key, prod]) => (
                          <option key={key} value={`bms|${key}`}>
                            {prod.name} - ${prod.price}
                          </option>
                        ))}
                      </select>

                      <select 
                        onChange={(e) => {
                          if (e.target.value) {
                            const [category, key] = e.target.value.split('|');
                            const product = gesDB[category][key];
                            setGesItems([...gesItems, {
                              brand: product.brand,
                              desc: product.name,
                              qty: 1,
                              price: product.price
                            }]);
                            e.target.value = '';
                          }
                        }}
                        className="text-xs border border-blue-300 rounded px-2 py-1.5 bg-white"
                      >
                        <option value="">🔌 EV Şarj İstasyonu</option>
                        {Object.entries(gesDB.evChargers).map(([key, prod]) => (
                          <option key={key} value={`evChargers|${key}`}>
                            {prod.name} - ${prod.price}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="text-xs text-blue-600 mt-2">
                      ℹ️ Veritabanından seçtiğiniz ürünler otomatik olarak marka, açıklama ve fiyat bilgileriyle eklenir
                    </p>
                  </div>

                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {gesItems.map((item, idx) => (
                      <div key={idx} className="bg-white p-3 rounded border border-gray-200 shadow-sm hover:shadow-md transition">
                        <div className="flex gap-2 mb-2">
                          <input 
                            type="text" 
                            placeholder="Marka"
                            value={item.brand}
                            onChange={(e) => updateGESItem(idx, 'brand', e.target.value)}
                            className="w-1/4 border px-2 py-1 rounded text-xs focus:ring-2 focus:ring-yellow-300 outline-none"
                          />
                          <input 
                            type="text" 
                            placeholder="ürün Açıklaması"
                            value={item.desc}
                            onChange={(e) => updateGESItem(idx, 'desc', e.target.value)}
                            className="w-3/4 border px-2 py-1 rounded text-xs focus:ring-2 focus:ring-yellow-300 outline-none"
                          />
                          <button 
                            onClick={() => removeGESRow(idx)}
                            className="text-red-500 px-2 hover:bg-red-50 rounded transition"
                            title="Sil"
                          >
                            <Trash2 className="w-4 h-4"/>
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <div className="flex-1 flex items-center border rounded px-2 bg-gray-50">
                            <span className="text-xs text-gray-500 mr-1">Adet:</span>
                            <input 
                              type="text"
                              inputMode="decimal"
                              aria-label={`${idx + 1}. satır miktarı`}
                              aria-invalid={gesError?.field === `items.${idx}.qty`}
                              aria-describedby="ges-validation"
                              value={item.qty}
                              onChange={(e) => updateGESItem(idx, 'qty', e.target.value)}
                              className="w-full bg-transparent py-1 outline-none text-right text-sm focus:bg-white"
                            />
                          </div>
                          <div className="flex-1 flex items-center border rounded px-2 bg-gray-50">
                            <span className="text-xs text-gray-500 mr-1">Birim($):</span>
                            <input 
                              type="text"
                              inputMode="decimal"
                              step="0.01"
                              aria-label={`${idx + 1}. satır birim fiyatı`}
                              aria-invalid={gesError?.field === `items.${idx}.price`}
                              aria-describedby="ges-validation"
                              value={item.price}
                              onChange={(e) => updateGESItem(idx, 'price', e.target.value)}
                              className="w-full bg-transparent py-1 outline-none text-right text-sm focus:bg-white"
                            />
                          </div>
                          <div className="flex-1 flex items-center border rounded px-2 bg-blue-50">
                            <span className="text-xs text-blue-700 mr-1">Toplam:</span>
                            <span className="text-sm font-bold text-blue-800">{(() => { const qty=parseDecimal(item.qty,null),price=parseDecimal(item.price,null);return qty!==null&&qty>0&&price!==null&&price>=0?'$'+(qty*price).toFixed(2):'—'; })()}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Maliyet & Kar Ayarlari */}
                <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                  <h3 className="text-sm font-bold text-yellow-800 uppercase mb-3">Ek Hizmetler & Kar marjı</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between items-center gap-2">
                      <span className="flex-1">Montaj ve iilik (%)</span>
                      <input 
                        type="text"
                        inputMode="decimal"
                        aria-label="Montaj oranı (%)"
                        aria-invalid={gesError?.field === 'laborRate'}
                        aria-describedby="ges-validation"
                        value={gesForm.laborRate}
                        onChange={(e) => setGesForm({...gesForm, laborRate: e.target.value})}
                        className="w-20 text-right border rounded px-2 py-1"
                      />
                    </div>
                    <div className="flex justify-between items-center gap-2">
                      <span className="flex-1">Nakliye ve Lojistik (%)</span>
                      <input 
                        type="text"
                        inputMode="decimal"
                        aria-label="Nakliye oranı (%)"
                        aria-invalid={gesError?.field === 'transportRate'}
                        aria-describedby="ges-validation"
                        value={gesForm.transportRate}
                        onChange={(e) => setGesForm({...gesForm, transportRate: e.target.value})}
                        className="w-20 text-right border rounded px-2 py-1"
                      />
                    </div>
                    <div className="flex justify-between items-center gap-2">
                      <span className="flex-1">Mih. Hizmetleri & Teknik Destek (%)</span>
                      <input 
                        type="text"
                        inputMode="decimal"
                        aria-label="Mühendislik oranı (%)"
                        aria-invalid={gesError?.field === 'overheadRate'}
                        aria-describedby="ges-validation"
                        value={gesForm.overheadRate}
                        onChange={(e) => setGesForm({...gesForm, overheadRate: e.target.value})}
                        className="w-20 text-right border rounded px-2 py-1"
                      />
                    </div>
                    <div className="flex justify-between items-center gap-2 font-bold">
                      <span className="flex-1">KAR ORANI (%)</span>
                      <input 
                        type="text"
                        inputMode="decimal"
                        aria-label="Kâr oranı (%)"
                        aria-invalid={gesError?.field === 'marginRate'}
                        aria-describedby="ges-validation"
                        value={gesForm.marginRate}
                        onChange={(e) => setGesForm({...gesForm, marginRate: e.target.value})}
                        className="w-20 text-right border border-yellow-400 bg-white rounded px-2 py-1"
                      />
                    </div>
                    <div className="flex justify-between items-center gap-2 border-t border-yellow-200 pt-2">
                      <span className="flex-1">KDV (%)</span>
                      <input 
                        type="text"
                        inputMode="decimal"
                        aria-label="KDV oranı (%)"
                        aria-invalid={gesError?.field === 'vatRate'}
                        aria-describedby="ges-validation"
                        value={gesForm.vatRate}
                        onChange={(e) => setGesForm({...gesForm, vatRate: e.target.value})}
                        className="w-20 text-right border rounded px-2 py-1"
                      />
                    </div>
                  </div>
                </div>

                {/* Kaydet ve Export Butonlari */}
                <div className="space-y-2">
                  <button 
                    onClick={toggleGesEditorMode}
                    disabled={!!gesError}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 px-6 rounded-lg font-semibold transition flex items-center justify-center"
                  >
                    <Edit3 className="w-5 h-5 mr-2"/>
                    {gesEditorMode ? '📊 Düzenleme Modundan çık' : '📊 Düzenleme Modu'}
                  </button>
                  
                  <button 
                    onClick={saveGESProposal}
                    disabled={gesItems.length === 0 || !!gesError}
                    className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-3 px-6 rounded-lg font-semibold transition flex items-center justify-center"
                  >
                    <Save className="w-5 h-5 mr-2"/>
                    Teklifi Kaydet
                  </button>
                  
                  <button 
                    onClick={handleGESPDFExport}
                    disabled={gesItems.length === 0 || !!gesError}
                    className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-3 px-6 rounded-lg font-semibold transition flex items-center justify-center"
                  >
                    <FileText className="w-5 h-5 mr-2"/>
                    PDF İndir
                  </button>
                  
                  <button 
                    onClick={() => { if (!gesError) window.print(); }}
                    disabled={gesItems.length === 0 || !!gesError}
                    className="w-full bg-gray-700 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-3 px-6 rounded-lg font-semibold transition flex items-center justify-center"
                  >
                    <Printer className="w-5 h-5 mr-2"/>
                    Yazdır
                  </button>
                </div>
              </div>
            </div>

            {/* Sai Panel - inizleme */}
            <div className="w-7/12 bg-gray-200 rounded-xl overflow-auto p-8 flex flex-col items-center gap-6">
              
              {/* Editor Mode Banner */}
              {gesEditorMode && (
                <div className="w-full space-y-2">
                  <div className="bg-indigo-600 text-white px-4 py-3 rounded-lg flex items-center justify-between">
                    <div className="flex items-center">
                      <Edit3 className="w-5 h-5 mr-2"/>
                      <span className="font-semibold">Düzenleme Modu Aktif - Metinleri doğrudan düzenleyebilirsiniz</span>
                    </div>
                    <button 
                      onClick={toggleGesEditorMode}
                    disabled={!!gesError}
                      className="bg-white text-indigo-600 px-4 py-1 rounded hover:bg-indigo-50 transition"
                    >
                      Kaydet ve çık
                    </button>
                  </div>
                  
                  {/* Formatting Toolbar */}
                  <div className="bg-white border border-gray-300 rounded-lg p-3 flex flex-wrap items-center gap-2">
                    <button 
                      onClick={() => document.execCommand('bold')}
                      className="p-2 hover:bg-gray-100 rounded border border-gray-300"
                      title="Kalin"
                    >
                      <Bold className="w-4 h-4"/>
                    </button>
                    <button 
                      onClick={() => document.execCommand('italic')}
                      className="p-2 hover:bg-gray-100 rounded border border-gray-300"
                      title="italik"
                    >
                      <Italic className="w-4 h-4"/>
                    </button>
                    <button 
                      onClick={() => document.execCommand('underline')}
                      className="p-2 hover:bg-gray-100 rounded border border-gray-300"
                      title="Alti izili"
                    >
                      <Type className="w-4 h-4"/>
                    </button>
                    <div className="w-px h-6 bg-gray-300"></div>
                    <select 
                      onChange={(e) => document.execCommand('fontSize', false, e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      <option value="">Yazi Boyutu</option>
                      <option value="1">çok Kiik</option>
                      <option value="2">Kiik</option>
                      <option value="3">Normal</option>
                      <option value="4">Büyük</option>
                      <option value="5">Çok Büyük</option>
                    </select>
                  </div>
                </div>
              )}
              
              <div 
                id="ges-printable-area"
                contentEditable={gesEditorMode}
                suppressContentEditableWarning={true}
                className={gesEditorMode ? 'outline-2 outline-dashed outline-indigo-400 w-full' : 'w-full'}
               onPaste={pasteReportHTML} dangerouslySetInnerHTML={!gesError && gesEditableContent ? {__html:reportHTMLWithReference(gesEditableContent,proposalReferences.ges)} : undefined}>{!gesError && gesEditableContent ? null : <>
              {(() => {
                if (gesError) return <p className="p-6 bg-white rounded text-gray-700">Önizlemeyi hazırlamak için formdaki hatayı düzeltin.</p>;
                const { totals, form: reportForm, items: reportItems } = gesCalculation.value;
                const dateObj = new Date(reportForm.offerDate + 'T00:00:00');
                
                // Dinamik sayfalama: Her sayfada maksimum 18 ürün
                const ITEMS_PER_PAGE = 18;
                const totalPages = Math.ceil(reportItems.length / ITEMS_PER_PAGE) + 1; // +1 Şartlar sayfasi
                const itemPages = [];
                
                for (let i = 0; i < reportItems.length; i += ITEMS_PER_PAGE) {
                  itemPages.push(reportItems.slice(i, i + ITEMS_PER_PAGE));
                }
                
                return (
                  <>
                    {/* DiNAMiK SAYFA(LAR) - ürün Listesi */}
                    {itemPages.map((pageItems, pageIndex) => {
                      const isFirstPage = pageIndex === 0;
                      const isLastItemPage = pageIndex === itemPages.length - 1;
                      const currentPageNum = pageIndex + 1;
                      
                      return (
                        <div key={pageIndex} className="ges-pdf-page bg-white max-w-[210mm] mx-auto min-h-[297mm] p-[10mm] pb-[35mm] shadow-2xl relative text-[10pt] leading-tight text-gray-800" style={{pageBreakAfter: 'always', pageBreakInside: 'avoid'}}>
                          <div>
                          {/* Header */}
                          <div className="flex justify-between items-start border-b-2 border-gray-800 pb-4 mb-4">
                            <img 
                              src="/calisan/uygulama/fatura_logo.png" 
                              className="h-16 object-contain"
                              alt="VoltGuard Logo"
                              onError={(e) => { e.target.src = "/calisan/uygulama/fatura_logo.png"; }}
                            />
                            <div className="text-right">
                              <h2 className="text-2xl font-bold text-blue-700">FİYAT TEKLİFİ</h2>
                              <p className="text-blue-600 text-xs mt-1">Güneş Enerjisi Sistemi</p>
                              <p className="text-gray-500 text-xs mt-1">Tarih: {dateObj.toLocaleDateString('tr-TR')}</p>
                              <p className="text-gray-500 text-xs mt-1">Referans: <span data-vg-reference="">{proposalReferences.ges}</span></p>
                            </div>
                          </div>

                          {/* Miteri Bilgisi (Sadece ilk sayfada) */}
                          {isFirstPage && (
                            <div className="mb-4 bg-blue-50 p-4 rounded-lg border border-blue-200">
                              <div className="flex justify-between items-end">
                                <div>
                                  <span className="text-xs text-blue-600 uppercase font-semibold">Sayın Yetkili / Müşteri</span>
                                  <h3 className="text-lg font-bold text-gray-800">{reportForm.customerName}</h3>
                                  <p className="text-gray-600 text-sm">{reportForm.location}</p>
                                </div>
                                <div className="text-right">
                                  <div className="text-xs text-blue-600">Para Birimi</div>
                                  <div className="font-bold text-gray-800">USD ($)</div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Tablo */}
                          <table className="w-full mb-4 border-collapse border border-gray-300">
                            <thead style={{backgroundColor: '#1e40af'}}>
                              <tr>
                                <th className="border border-gray-300 p-2 text-left font-semibold text-[9pt] w-10 text-white">No</th>
                                <th className="border border-gray-300 p-2 text-left font-semibold text-[9pt] text-white">Marka</th>
                                <th className="border border-gray-300 p-2 text-left font-semibold text-[9pt] w-1/2 text-white">Açıklama</th>
                                <th className="border border-gray-300 p-2 text-center font-semibold text-[9pt] text-white">Miktar</th>
                                <th className="border border-gray-300 p-2 text-right font-semibold text-[9pt] text-white">Birim Fiyat</th>
                                <th className="border border-gray-300 p-2 text-right font-semibold text-[9pt] text-white">Toplam</th>
                              </tr>
                            </thead>
                            <tbody className="text-gray-700 text-[9pt]">
                              {pageItems.map((item, idx) => {
                                const globalIdx = pageIndex * ITEMS_PER_PAGE + idx;
                                const total = (item.qty || 0) * (item.price || 0);
                                return (
                                  <tr key={globalIdx}>
                                    <td className="border border-gray-300 p-2 text-gray-500">{globalIdx + 1}</td>
                                    <td className="border border-gray-300 p-2 font-semibold">{item.brand}</td>
                                    <td className="border border-gray-300 p-2">{item.desc}</td>
                                    <td className="border border-gray-300 p-2 text-center">{item.qty}</td>
                                    <td className="border border-gray-300 p-2 text-right text-gray-600">{formatMoney(item.price)}</td>
                                    <td className="border border-gray-300 p-2 text-right font-bold text-gray-800">{formatMoney(total)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>

                          {/* özet Hesaplar (Sadece son ürün sayfasinda) */}
                          {isLastItemPage && (
                            <div className="flex justify-end mt-auto mb-8">
                      <div style={{width:'66.6667%'}}>
                        <table className="w-full text-[9pt] border-collapse border border-gray-300">
                          <tbody>
                            <tr className="bg-gray-50">
                              <td className="border border-gray-300 p-1 font-semibold">Malzeme Toplami:</td>
                              <td className="border border-gray-300 p-1 text-right font-semibold">{formatMoney(totals.materialTotal)}</td>
                            </tr>
                            {reportForm.laborRate > 0 && (
                              <tr>
                                <td className="border border-gray-300 p-1">+ Montaj ve işçilik ({reportForm.laborRate}%):</td>
                                <td className="border border-gray-300 p-1 text-right">{formatMoney(totals.laborCost)}</td>
                              </tr>
                            )}
                            {reportForm.transportRate > 0 && (
                              <tr>
                                <td className="border border-gray-300 p-1">+ Nakliye ve Lojistik ({reportForm.transportRate}%):</td>
                                <td className="border border-gray-300 p-1 text-right">{formatMoney(totals.transportCost)}</td>
                              </tr>
                            )}
                            {reportForm.overheadRate > 0 && (
                              <tr>
                                <td className="border border-gray-300 p-1">+ Mühendislik Hizmetleri ve Teknik Destek ({reportForm.overheadRate}%):</td>
                                <td className="border border-gray-300 p-1 text-right">{formatMoney(totals.overheadCost)}</td>
                              </tr>
                            )}
                            <tr className="bg-gray-50">
                              <td className="border border-gray-300 p-1 font-semibold">Proje Toplam Maliyeti:</td>
                              <td className="border border-gray-300 p-1 text-right font-semibold">{formatMoney(totals.directCost)}</td>
                            </tr>
                            {reportForm.marginRate > 0 && (
                              <tr className="bg-green-50">
                                <td className="border border-gray-300 p-1 font-semibold text-green-700">+ Kar marjı ({reportForm.marginRate}%):</td>
                                <td className="border border-gray-300 p-1 text-right font-semibold text-green-700">{formatMoney(totals.marginAmount)}</td>
                              </tr>
                            )}
                            <tr style={{backgroundColor: '#c8f0c8'}}>
                              <td className="border border-gray-300 p-3 font-bold text-[10pt]">GENEL TOPLAM (KDV Hariç):</td>
                              <td className="border border-gray-300 p-3 text-right font-bold text-[10pt]">{formatMoney(totals.grandTotalExVat)}</td>
                            </tr>
                            {reportForm.vatRate > 0 && (
                              <tr className="bg-blue-50">
                                <td className="border border-gray-300 p-1 font-semibold text-blue-700">+ KDV (%{reportForm.vatRate}):</td>
                                <td className="border border-gray-300 p-1 text-right font-semibold text-blue-700">{formatMoney(totals.vatAmount)}</td>
                              </tr>
                            )}
                            <tr className="bg-blue-900 text-white">
                              <td className="border border-gray-300 p-3 font-bold text-[11pt]">ÖDENECEK TUTAR (KDV Dahil):</td>
                              <td className="border border-gray-300 p-3 text-right font-bold text-[11pt]">{formatMoney(totals.finalTotal)}</td>
                            </tr>
                          </tbody>
                        </table>
                        <div className="mt-3 p-2 bg-gray-50 rounded border border-gray-200">
                          <p className="text-[8pt] text-gray-500 text-center">Ödenecek tutarın TL karşılığı</p>
                          <p className="text-[12pt] font-black text-gray-800 text-center">{formatMoney(totals.tlTotal, '₺')}</p>
                        </div>
                      </div>
                            </div>
                          )}

                          </div>
                          
                          {/* Footer */}
                          <div className="absolute bottom-[10mm] left-[10mm] right-[10mm] border-t border-gray-300 pt-2">
                            <div className="text-[9pt] text-gray-600">
                              <p className="font-bold text-gray-800 text-[9.5pt]">{COMPANY_LEGAL_NAME}</p>
                              <p className="text-[9pt] mt-0.5 leading-tight">{COMPANY_ADDRESS_LINE_1}<br />{COMPANY_ADDRESS_LINE_2}</p>
                              <p className="text-[9pt]">{COMPANY_CONTACT_LINE}</p>
                              <p className="text-gray-400 mt-1 text-right">Sayfa {currentPageNum}/{totalPages}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* SON SAYFA - Şartlar ve Notlar */}
                    <div className="ges-pdf-page bg-white max-w-[210mm] mx-auto min-h-[297mm] p-[10mm] pb-[35mm] shadow-2xl relative text-[10pt] leading-tight text-gray-800" style={{pageBreakBefore: 'always', pageBreakInside: 'avoid', pageBreakAfter: 'auto'}}>
                    <div>
                    {/* Header - Sayfa 2 */}
                    <div className="flex justify-between items-start border-b-2 border-gray-800 pb-4 mb-6">
                      <img 
                        src="/calisan/uygulama/fatura_logo.png" 
                        className="h-16 object-contain"
                        alt="VoltGuard Logo"
                        onError={(e) => { e.target.src = "/calisan/uygulama/fatura_logo.png"; }}
                      />
                      <div className="text-right">
                        <h2 className="text-xl font-bold text-gray-800">TEKLİF ŞARTLARI</h2>
                        <p className="text-gray-500 text-xs mt-1">Güneş Enerjisi Sistemi</p>
                        <p className="text-gray-500 text-xs mt-1">Referans: <span data-vg-reference="">{proposalReferences.ges}</span></p>
                      </div>
                    </div>

                    {/* Miteri özeti */}
                    <div className="mb-6 bg-blue-50 p-4 rounded-lg border border-blue-200">
                      <h3 className="text-[11pt] font-bold text-blue-900 mb-2">Teklif özeti</h3>
                      <div className="grid grid-cols-2 gap-3 text-[9pt]">
                        <div>
                          <span className="text-gray-600">Müşteri:</span>
                          <p className="font-semibold text-gray-800">{reportForm.customerName}</p>
                        </div>
                        <div>
                          <span className="text-gray-600">Lokasyon:</span>
                          <p className="font-semibold text-gray-800">{reportForm.location}</p>
                        </div>
                        <div>
                          <span className="text-gray-600">Kurulu Güç:</span>
                          <p className="font-semibold text-gray-800">{reportForm.autoPower} kW</p>
                        </div>
                        <div>
                          <span className="text-gray-600">Toplam Tutar (KDV Dahil):</span>
                          <p className="font-bold text-blue-900">{formatMoney(totals.finalTotal)}</p>
                        </div>
                      </div>
                    </div>

                    {/* Genel Şartlar */}
                    <div className="mb-6">
                      <h3 className="text-[11pt] font-bold text-gray-800 mb-3 pb-2 border-b-2 border-gray-300 uppercase">Genel Şartlar ve Koşullar</h3>
                      
                      <div className="space-y-4">
                        <div className="bg-gray-50 p-3 rounded">
                          <h4 className="text-[10pt] font-bold text-gray-700 mb-2 flex items-center">
                            <span className="text-blue-600 mr-2">1.</span> Teklif Geçerlilik Süresi
                          </h4>
                          <p className="text-[9pt] text-gray-700 pl-5">
                            Bu teklif <strong>30 (otuz) gün</strong> süreyle geçerlidir. Belirtilen süre sonunda fiyatlar döviz kuru ve hammadde değişikliklerine bağlı olarak güncellenecektir.
                          </p>
                        </div>

                        <div className="bg-gray-50 p-3 rounded">
                          <h4 className="text-[10pt] font-bold text-gray-700 mb-2 flex items-center">
                            <span className="text-blue-600 mr-2">2.</span> Kapsam ve Hizmetler
                          </h4>
                          <ul className="list-disc list-inside text-[9pt] text-gray-700 pl-5 space-y-1">
                            <li>Tüm ekipmanların tedariki (panel, inverter, akü, kablo, bağlantı malzemeleri)</li>
                            <li>Proje kapsamında gerekli tüm teknik hırdavat ve bağlantı malzemeleri dahildir.</li>
                            <li>Profesyonel montaj ve kurulum hizmetleri</li>
                            <li>Sistem devreye alma ve test işlemleri</li>
                            <li>Montaj sonrası sistem eğitimi ve kullanım kılavuzu</li>
                          </ul>
                        </div>

                        <div className="bg-gray-50 p-3 rounded">
                          <h4 className="text-[10pt] font-bold text-gray-700 mb-2 flex items-center">
                            <span className="text-blue-600 mr-2">3.</span> Ekipman Kalitesi ve Belgeler
                          </h4>
                          <p className="text-[9pt] text-gray-700 pl-5">
                            Tüm ekipmanlar <strong>orijinal, sıfır ve CE belgeli</strong> olup, gerekli kalite sertifikaları, test raporları ve kullanım kılavuzları ile birlikte teslim edilir. Ekipmanlar uluslararası kalite standartlarına uygundur.
                          </p>
                        </div>

                        <div className="bg-gray-50 p-3 rounded">
                          <h4 className="text-[10pt] font-bold text-gray-700 mb-2 flex items-center">
                            <span className="text-blue-600 mr-2">4.</span> Garanti ve Servis
                          </h4>
                          <p className="text-[9pt] text-gray-700 pl-5">
                            Sistem devreye alma sonrası <strong>1 (bir) yıl</strong> işçilik garantisi verilmektedir. Ekipman garantileri üretici firma garantileri çerçevesindedir (Genellikle paneller 25 yıl, inverterler 10 yıl, aküler 5-10 yıl).
                          </p>
                        </div>

                        <div className="bg-gray-50 p-3 rounded">
                          <h4 className="text-[10pt] font-bold text-gray-700 mb-2 flex items-center">
                            <span className="text-blue-600 mr-2">5.</span> Teslimat Süresi
                          </h4>
                          <p className="text-[9pt] text-gray-700 pl-5">
                            Sipariş onayı ve avans ödemesi alındıktan sonra <strong>15-20 iş günü</strong> içerisinde sistem kurulumu tamamlanacak ve devreye alınacaktır. Özel durumlar ve yüksek talep dönemlerinde teslimat süreleri uzayabilir.
                          </p>
                        </div>

                        </div>

                      </div>
                    </div>

                      {/* Footer - Son Sayfa */}
                      <div className="absolute bottom-[10mm] left-[10mm] right-[10mm] border-t border-gray-300 pt-2">
                        <div className="text-[9pt] text-gray-600">
                          <p className="font-bold text-gray-800 text-[9.5pt]">{COMPANY_LEGAL_NAME}</p>
                          <p className="text-[9pt] mt-0.5 leading-tight">{COMPANY_ADDRESS_LINE_1}<br />{COMPANY_ADDRESS_LINE_2}</p>
                          <p className="text-[9pt]">{COMPANY_CONTACT_LINE}</p>
                          <p className="text-gray-400 mt-1 text-right">Sayfa {totalPages}/{totalPages}</p>
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
              </>}</div>
            </div>
          </div>
        )}

        {/* Tab Content: Kaydedilen Teklifler */}
        {activeTab === 'saved' && (
          <div className="max-w-7xl mx-auto">
            <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl shadow-2xl p-8 mb-6">
              <h1 className="text-3xl font-bold text-white mb-2 flex items-center">
                <Save className="mr-3 h-8 w-8"/>
                Kaydedilen Teklifler
              </h1>
              <p className="text-purple-100">Tüm kaydedilmiş tekliflerinizi görüntüleyin ve yükleyin</p>
            </div>

            {proposalsLoading && <p role="status" className="mb-4 p-3 bg-blue-50 rounded">Teklif arşivi sunucudan yükleniyor…</p>}
            {proposalsError && <p role="alert" className="mb-4 p-3 bg-red-50 text-red-900 rounded">Teklif listesi yüklenemedi: {proposalsError} <button onClick={loadAllProposals} disabled={proposalsLoading} className="font-semibold underline">Yeniden yükle</button></p>}

            {/* Filtre Butonlari */}
            <div className="flex gap-3 mb-6 flex-wrap">
              <button
                onClick={() => setProposalFilterType('all')}
                className={`px-6 py-3 rounded-lg font-semibold transition shadow ${
                  proposalFilterType === 'all'
                    ? 'bg-purple-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                Tümü ({allSavedProposals.yg.length + allSavedProposals.periodic.length + allSavedProposals.kesif.length + allSavedProposals.ges.length})
              </button>
              <button
                onClick={() => setProposalFilterType('yg')}
                className={`px-6 py-3 rounded-lg font-semibold transition shadow ${
                  proposalFilterType === 'yg'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                YG Teklifleri ({allSavedProposals.yg.length})
              </button>
              <button
                onClick={() => setProposalFilterType('periodic')}
                className={`px-6 py-3 rounded-lg font-semibold transition shadow ${
                  proposalFilterType === 'periodic'
                    ? 'bg-green-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                Periyodik Kontrol ({allSavedProposals.periodic.length})
              </button>
              <button
                onClick={() => setProposalFilterType('kesif')}
                className={`px-6 py-3 rounded-lg font-semibold transition shadow ${
                  proposalFilterType === 'kesif'
                    ? 'bg-orange-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                Keşif Metraj ({allSavedProposals.kesif.length})
              </button>
              <button
                onClick={() => setProposalFilterType('ges')}
                className={`px-6 py-3 rounded-lg font-semibold transition shadow ${
                  proposalFilterType === 'ges'
                    ? 'bg-yellow-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                GES Teklifleri ({allSavedProposals.ges.length})
              </button>
            </div>

            {/* Teklifler Listesi */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* YG Teklifleri */}
              {(proposalFilterType === 'all' || proposalFilterType === 'yg') &&
                allSavedProposals.yg.map((proposal) => (
                  <div key={proposal.id} className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-blue-500 hover:shadow-xl transition">
                    <div className="flex items-center justify-between mb-4">
                      <div className="bg-blue-100 p-2 rounded-lg">
                        <UserPlus className="w-6 h-6 text-blue-600"/>
                      </div>
                      <span className="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded-full font-semibold">YG Teklifi</span>
                    </div>
                    <h3 className="text-lg font-bold text-gray-800 mb-2">{proposal.name}</h3>
                    <div className="space-y-2 mb-4 text-sm text-gray-600">
                      <div className="flex items-center justify-between">
                        <span>Tarih:</span>
                        <span className="font-semibold">{new Date(proposal.created_at).toLocaleDateString("tr-TR")}</span>
                      </div>
                      {proposal.data.form && (
                        <>
                          <div className="flex items-center justify-between">
                            <span>Firma:</span>
                            <span className="font-semibold truncate max-w-[150px]">{proposal.data.form.name}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Güç:</span>
                            <span className="font-semibold">{proposal.data.form.powerStr} kVA</span>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => loadProposal(proposal)}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold transition text-sm"
                      >
                        Yükle
                      </button>
                      <button
                        onClick={() => deleteProposal('yg', proposal.id)}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-semibold transition text-sm"
                      >
                        <Trash2 className="w-4 h-4"/>
                      </button>
                    </div>
                  </div>
                ))}

              {/* Periyodik Kontrol Teklifleri */}
              {(proposalFilterType === 'all' || proposalFilterType === 'periodic') &&
                allSavedProposals.periodic.map((proposal) => (
                  <div key={proposal.id} className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-green-500 hover:shadow-xl transition">
                    <div className="flex items-center justify-between mb-4">
                      <div className="bg-green-100 p-2 rounded-lg">
                        <RefreshCw className="w-6 h-6 text-green-600"/>
                      </div>
                      <span className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded-full font-semibold">Periyodik Kontrol</span>
                    </div>
                    <h3 className="text-lg font-bold text-gray-800 mb-2">{proposal.name}</h3>
                    <div className="space-y-2 mb-4 text-sm text-gray-600">
                      <div className="flex items-center justify-between">
                        <span>Tarih:</span>
                        <span className="font-semibold">{new Date(proposal.created_at).toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      {proposal.data.customer && (
                        <>
                          <div className="flex items-center justify-between">
                            <span>Firma:</span>
                            <span className="font-semibold truncate max-w-[150px]">{proposal.data.customer.name}</span>
                          </div>
                          {proposal.data.inputs && (
                            <div className="flex items-center justify-between">
                              <span>Trafo Güçci:</span>
                              <span className="font-semibold">{proposal.data.inputs.trafoGucu} kVA</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => loadProposal(proposal)}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-semibold transition text-sm"
                      >
                        Yükle
                      </button>
                      <button
                        onClick={() => deleteProposal('periodic', proposal.id)}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-semibold transition text-sm"
                      >
                        <Trash2 className="w-4 h-4"/>
                      </button>
                    </div>
                  </div>
                ))}

              {/* Keşif Metraj Teklifleri */}
              {(proposalFilterType === 'all' || proposalFilterType === 'kesif') &&
                allSavedProposals.kesif.map((proposal) => (
                  <div key={proposal.id} className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-orange-500 hover:shadow-xl transition">
                    <div className="flex items-center justify-between mb-4">
                      <div className="bg-orange-100 p-2 rounded-lg">
                        <Hammer className="w-6 h-6 text-orange-600"/>
                      </div>
                      <span className="text-xs bg-orange-100 text-orange-700 px-3 py-1 rounded-full font-semibold">Keşif Metraj</span>
                    </div>
                    <h3 className="text-lg font-bold text-gray-800 mb-2">{proposal.name}</h3>
                    <div className="space-y-2 mb-4 text-sm text-gray-600">
                      <div className="flex items-center justify-between">
                        <span>Tarih:</span>
                        <span className="font-semibold">{new Date(proposal.created_at).toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      {proposal.data.customer && (
                        <div className="flex items-center justify-between">
                          <span>Firma:</span>
                          <span className="font-semibold truncate max-w-[150px]">{proposal.data.customer.name}</span>
                        </div>
                      )}
                      {proposal.data.products && (
                        <>
                          <div className="flex items-center justify-between">
                            <span>ürün Sayısı:</span>
                            <span className="font-semibold">{proposal.data.products.length} kalem</span>
                          </div>
                          {proposal.data.totals && (
                            <div className="flex items-center justify-between">
                              <span>Toplam:</span>
                              <span className="font-semibold text-orange-600">{Number(proposal.data.totals.grandTotal).toFixed(2)} TL</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => loadProposal(proposal)}
                        className="flex-1 bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg font-semibold transition text-sm"
                      >
                        Yükle
                      </button>
                      <button
                        onClick={() => deleteProposal('kesif', proposal.id)}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-semibold transition text-sm"
                      >
                        <Trash2 className="w-4 h-4"/>
                      </button>
                    </div>
                  </div>
                ))}

              {/* GES Teklifleri */}
              {(proposalFilterType === 'all' || proposalFilterType === 'ges') &&
                allSavedProposals.ges.map((proposal) => (
                  <div key={proposal.id} className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-yellow-500 hover:shadow-xl transition">
                    <div className="flex items-center justify-between mb-4">
                      <div className="bg-yellow-100 p-2 rounded-lg">
                        <Zap className="w-6 h-6 text-yellow-600"/>
                      </div>
                      <span className="text-xs bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full font-semibold">GES</span>
                    </div>
                    <h3 className="text-lg font-bold text-gray-800 mb-2">{proposal.name}</h3>
                    <div className="space-y-2 mb-4 text-sm text-gray-600">
                      <div className="flex items-center justify-between">
                        <span>Tarih:</span>
                        <span className="font-semibold">{new Date(proposal.created_at).toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      {proposal.data.form && (
                        <>
                          <div className="flex items-center justify-between">
                            <span>Miteri:</span>
                            <span className="font-semibold truncate max-w-[150px]">{proposal.data.form.customerName}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Güç:</span>
                            <span className="font-semibold">{proposal.data.form.autoPower} kW</span>
                          </div>
                        </>
                      )}
                      {proposal.data.totals && (
                        <div className="flex items-center justify-between">
                          <span>Toplam:</span>
                          <span className="font-semibold text-yellow-600">${Number(proposal.data.totals.finalTotal).toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => loadProposal(proposal)}
                        className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded-lg font-semibold transition text-sm"
                      >
                        Yükle
                      </button>
                      <button
                        onClick={() => deleteProposal('ges', proposal.id)}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-semibold transition text-sm"
                      >
                        <Trash2 className="w-4 h-4"/>
                      </button>
                    </div>
                  </div>
                ))}
            </div>

            {/* boÅŸ Durum */}
            {allSavedProposals.yg.length === 0 && 
             allSavedProposals.periodic.length === 0 && 
             allSavedProposals.kesif.length === 0 && 
             allSavedProposals.ges.length === 0 && (
              <div className="bg-white rounded-xl shadow-lg p-12 text-center">
                <Save className="w-16 h-16 text-gray-300 mx-auto mb-4"/>
                <h3 className="text-xl font-bold text-gray-800 mb-2">Heniz Kaydedilmi Teklif Yok</h3>
                <p className="text-gray-600 mb-6">
                  Teklif formlarinda "Kaydet" butonunu kullanarak tekliflerinizi kaydedebilirsiniz.
                </p>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={() => setActiveTab('manual')}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold transition"
                  >
                    YG Teklifi Oluştur
                  </button>
                  <button
                    onClick={() => setActiveTab('periodic')}
                    className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-semibold transition"
                  >
                    Periyodik Kontrol
                  </button>
                  <button
                    onClick={() => setActiveTab('kesif')}
                    className="bg-orange-600 hover:bg-orange-700 text-white px-6 py-3 rounded-lg font-semibold transition"
                  >
                    Keşif Metraj
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bordro Takip Tab */}
        <Suspense fallback={<ModuleLoading />}>
        {activeTab === 'bordro' && (
          <div className="max-w-full mx-auto">
            <BordroWithPassword />
          </div>
        )}

        {/* Beyaz Yaka Bordro Tab */}
        {activeTab === 'beyaz-yaka' && (
          <div className="max-w-full mx-auto">
            <BeyazYakaBordro />
          </div>
        )}

        {activeTab === 'admin' && currentUser?.role === 'admin' && <SimpleAdminPanel />}

        {activeTab === 'kontrol' && <div className="h-full"><PeriyodikKontrol /></div>}

        {/* OSOS Tab */}
        {activeTab === 'osos' && (
          <div className="h-full">
            <Osos />
          </div>
        )}

        {/* Akaryakıt Takip Tab */}
        {activeTab === 'akaryakit' && (
          <div className="h-full">
            <AkaryakitTakip />
          </div>
        )}

        {/* İş Takip Tab */}
        {activeTab === 'is-takip' && (
          <div className="h-full">
            <IsTakip />
          </div>
        )}

        {/* Haftalık Raporlama Tab */}
        {activeTab === 'haftalik-raporlama' && (
          <div className="h-full">
            <HaftalikRaporlama />
          </div>
        )}

        {/* Ürün Takip Tab */}
        {activeTab === 'urun-takip' && (
          <div className="h-full">
            <UrunTakip />
          </div>
        )}

        {/* Görev Takip Tab */}
        {activeTab === 'gorev' && (
          <div className="h-full">
            <GorevTakip />
          </div>
        )}

        </Suspense>

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && <CompanyDashboard invoice1={normalizedFatura1} invoice2={normalizedFatura2} cable={KabloFiyatData} stats={productStats} products={kesifProducts} onSelect={setActiveTab} />}

        {/* Tab Content: Manuel Giriş */}
        {activeTab === 'manual' && (
           <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
             <div className="bg-blue-900 px-6 py-4 border-b border-blue-800">
                <h2 className="text-lg font-bold text-white flex items-center">
                    <UserPlus className="mr-2 h-5 w-5"/>
                    Teklif Bilgileri Girişi
                </h2>
                <p className="text-blue-200 text-xs mt-1">Firma bilgilerini ve doğrulanacak referans parametreleri kontrol ederek teklif hazırlayın.</p>
             </div>
             
             <form onSubmit={handleManualSubmit} className="p-8 space-y-6">
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="col-span-2">
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Firma Unvani</label>
                        <input 
                            required
                            type="text" 
                            placeholder="Örn: ABC Endüstri San. ve Tic. A.Ş."
                            value={manualForm.name}
                            onChange={(e) => setManualForm({...manualForm, name: e.target.value})}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                        />
                    </div>

                    <div className="col-span-2">
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Yetkili adı Soyadi</label>
                        <input 
                            required
                            type="text" 
                            placeholder="Örn: Ahmet Yilmaz"
                            value={manualForm.contactName}
                            onChange={(e) => setManualForm({...manualForm, contactName: e.target.value})}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition bg-blue-50"
                        />
                        <p className="text-xs text-gray-500 mt-1">Teklif mektubunda "Sayın [Ad Soyad] Yetkilisi" ieklinde kullanilacaktir.</p>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Sektör</label>
                        <input 
                            required
                            type="text" 
                            placeholder="Örn: Tekstil, Güçda"
                            value={manualForm.sector}
                            onChange={(e) => setManualForm({...manualForm, sector: e.target.value})}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                        />
                    </div>

                    <div>
                         <label className="block text-sm font-semibold text-gray-700 mb-2">Trafo Merkezi Tipi</label>
                         <select 
                            value={manualForm.type}
                            onChange={(e) => setManualForm({...manualForm, type: e.target.value})}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                         >
                             <option value="bina">Bina Tipi (Sanayi Tesisleri)</option>
                             <option value="direk">Direk Tipi</option>
                         <option value="uretim">Üretim tesisi (bina kapsamı)</option></select>
                         <p className="text-xs text-gray-500 mt-1">Not: 400 kVA altındaki normal tesislerde direk tipi ücret bandı kullanılır. Üretim tesisi için bina kapsamını ayrıca seçin.</p>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Toplam Kurulu Güç (kVA)</label>
                        <div className="relative">
                            <input 
                                required
                                type="text" 
                                placeholder="Örn: 1600 veya 1000+630"
                                value={manualForm.powerStr}
                                onChange={(e) => setManualForm({...manualForm, powerStr: e.target.value})}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition font-mono"
                            />
                            <Zap className="absolute right-3 top-3.5 h-5 w-5 text-gray-400" />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Birden fazla trafo için '+' ile ayirabilirsiniz.</p>
                    </div>

                     {/* Yeni Eklenen Alan: Bölge/iehir Seimi */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center">
                            <MapPin className="w-4 h-4 mr-1 text-blue-600"/>
                            Bölge/iehir (katsayı)
                        </label>
                        <div className="relative">
                            <select 
                                value={manualForm.region}
                                onChange={handleRegionChange}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition appearance-none bg-white"
                            >
                                {REGION_LIST.map((r, index) => (
                                    <option key={index} value={r.name}>
                                        {r.name} (x{r.coeff.toFixed(2)})
                                    </option>
                                ))}
                            </select>
                            <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                        </div>
                        <p className="text-xs text-green-600 mt-1 font-semibold">
                            seçili katsayı: {manualForm.regionCoeff.toFixed(2)}
                        </p>
                    </div>

                    {/* Yeni Eklenen Alan: İskonto Oranı */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center">
                            <Percent className="w-4 h-4 mr-1 text-blue-600"/>
                            İskonto Oranı (%)
                        </label>
                        <input 
                            type="number" 
                            min="0"
                            max="100"
                            value={manualForm.customDiscount}
                            onChange={(e) => setManualForm({...manualForm, customDiscount: parseFloat(e.target.value) || 0})}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition font-bold text-blue-800"
                        />
                         <p className="text-xs text-gray-500 mt-1">Varsayilan: %{params.discountRate}</p>
                    </div>
                </div>

                <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
                    <div className="text-sm text-gray-500">
                        <span className="font-bold text-blue-900">Hesap kapsamı:</span> {params.year} referans değerleri, {manualForm.region} katsayısı ve girilen %{manualForm.customDiscount} iskonto kullanılır. İki hücre temel kapsamdır; ek hücreler dahil değildir. Güncel ücret koşullarını teklif sorumlusu doğrular.
                    </div>
                    <div className="flex gap-3">
                        <button 
                            type="button"
                            onClick={saveYGProposal}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transform active:scale-95 transition flex items-center"
                        >
                            <Save className="mr-2 h-5 w-5"/>
                            Kaydet
                        </button>
                        <button 
                            type="submit"
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg shadow-lg transform active:scale-95 transition flex items-center"
                        >
                            <Calculator className="mr-2 h-5 w-5"/>
                            Hesapla ve Teklif Oluştur
                        </button>
                    </div>
                </div>

             </form>
           </div>
        )}

        {/* Tab Content: Periyodik Kontrol */}
        {activeTab === 'periodic' && (
          <div className="flex gap-6 flex-col lg:flex-row">
            
            {/* Sol Panel: Veri Girişi */}
            <div className="lg:w-1/3 bg-white p-6 rounded-xl shadow-lg border border-gray-200 overflow-y-auto">
              <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                <RefreshCw className="text-green-600" />
                Periyodik Kontrol Teklif Robotu
              </h2>
              
              <div className="space-y-4">
                {/* Miteri Bilgileri */}
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                  <h3 className="text-sm font-semibold text-blue-800 mb-2">Miteri Bilgileri</h3>
                  <div className="grid gap-3">
                    <input 
                      type="text" 
                      placeholder="Firma adı" 
                      value={periodicCustomer.name} 
                      onChange={e => setPeriodicCustomer({...periodicCustomer, name: e.target.value})} 
                      className="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                    />
                    <input 
                      type="text" 
                      placeholder="Şehir / Lokasyon" 
                      value={periodicCustomer.city} 
                      onChange={e => setPeriodicCustomer({...periodicCustomer, city: e.target.value})} 
                      className="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                    />
                    <input 
                      type="text" 
                      placeholder="Yetkili kişi" 
                      value={periodicCustomer.contactName} 
                      onChange={e => setPeriodicCustomer({...periodicCustomer, contactName: e.target.value})} 
                      className="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                    />
                  </div>
                </div>

                {/* Teknik Veriler */}
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Tesis ve kontrol kapsamı</h3>
                  
                  <label className="block text-xs font-medium text-gray-600 mb-1">Toplam Trafo Güçci (kVA)</label>
                  <input 
                    type="number" 
                    value={periodicInputs.trafoGucu} 
                    onChange={e => setPeriodicInputs({...periodicInputs, trafoGucu: Number(e.target.value)})} 
                    className="w-full border p-2 rounded mb-3 focus:ring-2 focus:ring-green-500 outline-none" 
                  />

                  <label className="block text-xs font-medium text-gray-600 mb-1">Kapali Alan (mi)</label>
                  <input 
                    type="number" 
                    value={periodicInputs.yapiAlani} 
                    onChange={e => setPeriodicInputs({...periodicInputs, yapiAlani: Number(e.target.value)})} 
                    className="w-full border p-2 rounded mb-3 focus:ring-2 focus:ring-green-500 outline-none" 
                  />

                  <label className="block text-xs font-medium text-gray-600 mb-1">Topraklama Ölçüm Sayısı</label>
                  <input 
                    type="number" 
                    value={periodicInputs.topraklamaAdet} 
                    onChange={e => setPeriodicInputs({...periodicInputs, topraklamaAdet: Number(e.target.value)})} 
                    className="w-full border p-2 rounded mb-3 focus:ring-2 focus:ring-green-500 outline-none" 
                  />

                  <label className="block text-xs font-medium text-gray-600 mb-1">Paratoner Tesisat Sayısı</label>
                  <input 
                    type="number" 
                    value={periodicInputs.paratonerAdet} 
                    onChange={e => setPeriodicInputs({...periodicInputs, paratonerAdet: Number(e.target.value)})} 
                    className="w-full border p-2 rounded mb-3 focus:ring-2 focus:ring-green-500 outline-none" 
                  />

                  <label className="block text-xs font-medium text-gray-600 mb-1">RCD Test Sayısı</label>
                  <input 
                    type="number" 
                    value={periodicInputs.rcdAdet} 
                    onChange={e => setPeriodicInputs({...periodicInputs, rcdAdet: Number(e.target.value)})} 
                    className="w-full border p-2 rounded mb-3 focus:ring-2 focus:ring-green-500 outline-none" 
                  />
                </div>

                {/* İskonto Ayari */}
                <div className="bg-green-50 p-4 rounded-lg border border-green-100">
                  <h3 className="text-sm font-semibold text-green-800 mb-2">Fiyatlandirma</h3>
                  <label className="block text-xs font-medium text-green-700 mb-1">İskonto Oranı (%)</label>
                  <div className="flex items-center gap-2">
                    <input 
                      type="range" 
                      min="0" 
                      max="95" 
                      step="1" 
                      value={periodicInputs.İskonto} 
                      onChange={e => setPeriodicInputs({...periodicInputs, İskonto: Number(e.target.value)})} 
                      className="w-full h-2 bg-green-200 rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="font-bold text-green-800 w-12 text-right">%{periodicInputs.İskonto}</span>
                  </div>
                </div>

                {/* Hesapla Butonu */}
                <div className="flex gap-2">
                  <button 
                    onClick={savePeriodicProposal}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-bold transition shadow-md flex justify-center items-center gap-2"
                  >
                    <Save className="h-5 w-5"/>
                    Kaydet
                  </button>
                  <button 
                    onClick={calculatePeriodicPrices}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-bold transition shadow-md flex justify-center items-center gap-2"
                  >
                    <Calculator className="h-5 w-5"/>
                    Hesapla
                  </button>
                </div>

                {/* işlem Butonlari */}
                <div className="space-y-3">
                  <button 
                    onClick={togglePeriodicEditorMode}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-lg font-bold transition shadow-md flex justify-center items-center gap-2"
                  >
                    <Edit3 className="h-4 w-4"/>
                    {periodicEditorMode ? 'Düzenleme Modundan çık' : 'Düzenleme Modu'}
                  </button>
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => window.print()} 
                      className="bg-gray-700 text-white py-3 rounded-lg font-bold hover:bg-gray-800 transition shadow-md flex justify-center items-center gap-2"
                    >
                      <Printer className="h-4 w-4"/>
                      Yazdır
                    </button>
                    <button 
                      onClick={handlePeriodicPDFExport} 
                      className="bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 transition shadow-md flex justify-center items-center gap-2"
                    >
                      <Download className="h-4 w-4"/>
                      PDF İndir
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="mt-6 text-xs text-gray-400">
                * Hesap 2026 referans değerlerini kullanır. Güncel kaynak, kapsam ve ücret koşulları teklif sorumlusu tarafından doğrulanmalıdır. KDV hariçtir.
              </div>
            </div>

            {/* Sai Panel: Teklif Önizleme */}
            <div className="lg:w-2/3 bg-gray-200 p-8 rounded-xl overflow-auto">
              {/* Editor Mode Banner */}
              {periodicEditorMode && (
                <div className="mb-4 bg-indigo-600 text-white p-4 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Edit3 className="h-5 w-5"/>
                    <span className="font-bold">Düzenleme Modu Aktif - Metinleri doğrudan düzenleyebilirsiniz</span>
                  </div>
                  <button 
                    onClick={togglePeriodicEditorMode}
                    className="bg-white text-indigo-600 px-4 py-2 rounded hover:bg-gray-100 transition font-bold flex items-center gap-2"
                  >
                    <X className="h-4 w-4"/>
                    Kapat
                  </button>
                </div>
              )}
              
              {/* Periyodik Kontrol Paper Structure */}
              <div 
                id="periodic-printable-paper"
                contentEditable={periodicEditorMode}
                suppressContentEditableWarning={true}
                className={periodicEditorMode ? 'outline-2 outline-dashed outline-indigo-400' : ''}
                style={periodicEditorMode ? { minHeight: '297mm' } : {}}
               onPaste={pasteReportHTML} dangerouslySetInnerHTML={periodicEditableContent ? {__html:reportHTMLWithReference(periodicEditableContent,proposalReferences.periodic)} : undefined}>{periodicEditableContent ? null : <><div className="vg-reference-line" style={{fontSize:"9pt",marginBottom:"8px"}}>Referans: <span data-vg-reference="">{proposalReferences.periodic}</span></div>
                
                {/* SAYFA 1 */}
                <div className="bg-white max-w-[210mm] mx-auto min-h-[297mm] p-[10mm] pb-[35mm] shadow-2xl relative text-[10pt] leading-tight text-gray-800 periodic-pdf-page" style={{pageBreakAfter: 'always', pageBreakInside: 'avoid'}}>
                  <div>
                
                {/* Header */}
                <div className="flex justify-between items-center border-b pb-6 mb-6">
                  {/* Logo Area */}
                  <div className="flex items-start justify-start min-w-[150px]">
                    <img src="/calisan/uygulama/fatura_logo.png" alt="VoltGuard Logo" className="h-24 max-w-[210px] object-contain" />
                  </div>
                  <div className="text-center flex-1">
                    <h1 className="text-2xl font-bold text-gray-800">TEKLİF MEKTUBU</h1>
                    <p className="text-gray-500 text-sm mt-1">Periyodik Kontrol ve Test Hizmetleri</p>
                  </div>
                  <div className="text-right w-48">
                    <p className="text-xs text-gray-500 leading-tight">{COMPANY_ADDRESS_LINE_1}<br />{COMPANY_ADDRESS_LINE_2}</p>
                    <p className="text-xs text-gray-500 mt-1">Tarih: {periodicCustomer.date}</p>
                  </div>
                </div>

                {/* Müşteri Başlığı */}
                <div className="mb-8">
                  <h3 className="text-md font-bold text-gray-800 mb-2">
                    Sayın {periodicCustomer.contactName ? `${periodicCustomer.contactName} - ` : ''}{periodicCustomer.name || '[Firma adı]'} Yetkilisi,
                  </h3>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    işletmenizde talep edilen tüm elektrik sistemleri periyodik kontrol ve kontrol ve ölçüm hizmetlerine yönelik fiyat teklifimiz, 
                    <strong> 2026 referans hesap parametreleri</strong> kullanılarak aşağıda sunulmuştur. Güncel kaynak, kapsam ve ücret koşulları teklif sorumlusu tarafından doğrulanmalıdır.
                  </p>
                </div>

                {/* Tesis Bilgileri özeti */}
                <div className="mb-6">
                  <h4 className="text-sm font-bold text-gray-700 border-b border-gray-200 mb-2 pb-1">1. Tesis Bilgileri</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="p-2 bg-gray-50 rounded">
                      <span className="text-gray-500 block text-xs">Kurulu Trafo Gücü</span>
                      <span className="font-semibold text-gray-800">{periodicInputs.trafoGucu} kVA</span>
                    </div>
                    <div className="p-2 bg-gray-50 rounded">
                      <span className="text-gray-500 block text-xs">Kapali Alan</span>
                      <span className="font-semibold text-gray-800">{periodicInputs.yapiAlani} m²</span>
                    </div>
                    <div className="p-2 bg-gray-50 rounded">
                      <span className="text-gray-500 block text-xs">Tesis Yeri</span>
                      <span className="font-semibold text-gray-800">{periodicCustomer.city || 'Belirtilmedi'}</span>
                    </div>
                    <div className="p-2 bg-gray-50 rounded">
                      <span className="text-gray-500 block text-xs">Kapsam</span>
                      <span className="font-semibold text-gray-800">Periyodik kontrol hizmeti</span>
                    </div>
                  </div>
                </div>

                {/* Fiyat Tablosu */}
                <div className="mb-8">
                  <h4 className="text-sm font-bold text-gray-700 border-b border-gray-200 mb-2 pb-1">2. Hizmet bedelleri · referans hesap</h4>
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="bg-gray-100 text-gray-600">
                        <th className="p-2 rounded-l">Hizmet Kalemi</th>
                        <th className="p-2">Detay / Hesaplama</th>
                        <th className="p-2 text-right rounded-r">Referans bedel (TL)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      <tr>
                        <td className="p-2 font-medium">1. YG/TM Güçzle Kontroli</td>
                        <td className="p-2 text-xs text-gray-500">{periodicResults.yg.desc || 'Heniz hesaplanmadi'}</td>
                        <td className="p-2 text-right">{formatCurrency(periodicResults.yg.total, 'TRY')}</td>
                      </tr>
                      <tr>
                        <td className="p-2 font-medium">2. AG i Tesisat Kontroli</td>
                        <td className="p-2 text-xs text-gray-500">{periodicResults.ag.desc || 'Heniz hesaplanmadi'}</td>
                        <td className="p-2 text-right">{formatCurrency(periodicResults.ag.total, 'TRY')}</td>
                      </tr>
                      <tr>
                        <td className="p-2 font-medium">3. Topraklama Ölçümü</td>
                        <td className="p-2 text-xs text-gray-500">{periodicResults.topraklama.desc || 'Heniz hesaplanmadi'}</td>
                        <td className="p-2 text-right">{formatCurrency(periodicResults.topraklama.total, 'TRY')}</td>
                      </tr>
                      <tr>
                        <td className="p-2 font-medium">4. Yildirimdan Korunma</td>
                        <td className="p-2 text-xs text-gray-500">{periodicResults.paratoner.desc || 'Heniz hesaplanmadi'}</td>
                        <td className="p-2 text-right">{formatCurrency(periodicResults.paratoner.total, 'TRY')}</td>
                      </tr>
                      <tr>
                        <td className="p-2 font-medium">5. RCD Testleri</td>
                        <td className="p-2 text-xs text-gray-500">{periodicResults.rcd.desc || 'Heniz hesaplanmadi'}</td>
                        <td className="p-2 text-right">{formatCurrency(periodicResults.rcd.total, 'TRY')}</td>
                      </tr>
                      <tr className="bg-gray-50 font-semibold text-gray-700">
                        <td className="p-2" colSpan="2">Ara Toplam (Hizmetler)</td>
                        <td className="p-2 text-right">{formatCurrency(periodicResults.subTotal, 'TRY')}</td>
                      </tr>
                      <tr>
                        <td className="p-2 font-medium">Test Ölçüm Keşif Bedeli</td>
                        <td className="p-2 text-xs text-gray-500">Sabit Bedel</td>
                        <td className="p-2 text-right">{formatCurrency(periodicResults.kesif, 'TRY')}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Toplam ve İskonto Alani */}
                <div className="flex justify-end mb-8">
                  <div className="w-full md:w-1/2 bg-blue-50 p-4 rounded-lg border border-blue-100">
                    <div className="flex justify-between text-sm text-gray-600 mb-2">
                      <span>Referans ücretler toplamı:</span>
                      <span className="font-semibold">{formatCurrency(periodicResults.grandTotal, 'TRY')}</span>
                    </div>
                    <div className="flex justify-between text-sm text-green-700 mb-2">
                      <span>Uygulanan İskonto (%{periodicInputs.İskonto}):</span>
                      <span>- {formatCurrency(periodicResults.discountAmount, 'TRY')}</span>
                    </div>
                    <div className="border-t-2 border-blue-300 my-3"></div>
                    <div className="flex justify-between text-lg font-bold text-blue-900">
                      <span>TEKLİF EDiLEN TOPLAM:</span>
                      <span>{formatCurrency(periodicResults.finalPrice, 'TRY')}</span>
                    </div>
                    <div className="text-right text-xs text-gray-500 mt-1">+ KDV</div>
                  </div>
                </div>

                {/* Footer - Sayfa 1 */}
                <div className="absolute bottom-[10mm] left-0 right-0 border-t border-gray-300 pt-2">
                  <div className="text-center text-[8pt] text-gray-500">
                    <p className="font-bold text-gray-800 text-[9pt]">{COMPANY_LEGAL_NAME}</p>
                    <p className="text-[9pt] mt-0.5 leading-tight">{COMPANY_ADDRESS_LINE_1}<br />{COMPANY_ADDRESS_LINE_2}</p>
                    <p className="text-[9pt]">{COMPANY_CONTACT_LINE}</p>
                    <p className="mt-1 text-gray-400">Sayfa 1/2</p>
                  </div>
                </div>

                  </div>
                </div>
                {/* SAYFA 1 SONU */}

                {/* SAYFA 2 */}
                <div className="bg-white max-w-[210mm] mx-auto min-h-[297mm] p-[10mm] pb-[35mm] shadow-2xl relative text-[10pt] leading-tight text-gray-800 periodic-pdf-page" style={{pageBreakBefore: 'always', pageBreakInside: 'avoid', pageBreakAfter: 'auto'}}>
                  <div>

                {/* Header - Sayfa 2 */}
                <div className="flex justify-between items-start border-b pb-6 mb-6">
                  <div className="flex items-start justify-start min-w-[150px]">
                    <img src="/calisan/uygulama/fatura_logo.png" alt="VoltGuard Logo" className="h-24 max-w-[210px] object-contain" />
                  </div>
                </div>

                {/* İndirim Gerekçesi */}
                <div className="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-200">
                  <h4 className="text-[10pt] font-bold text-blue-900 mb-3 flex items-center">
                    <CheckCircle className="h-5 w-5 mr-2"/>
                    İndirim Uygulamasının Gerekçesi ve Katma Değer
                  </h4>
                  <p className="text-[9pt] text-gray-700 leading-tight mb-3">
                    Bu teklifin hizmet kapsamı ve ticari koşulları aşağıdaki başlıklarda açıklanır. Güncel ücret ve uygunluk koşulları yetkili sorumlu tarafından doğrulanmalıdır:
                  </p>
                  <div className="space-y-3">
                    <div className="bg-white p-3 rounded border-l-4 border-blue-500">
                      <h5 className="text-[9pt] font-bold text-gray-800 mb-1">1. Stratejik Müşteri İlişkisi</h5>
                      <p className="text-[9pt] text-gray-600 leading-tight">
                        {periodicCustomer.name || 'Müşteriniz'}, sanayi tesisi olarak büyük bir potansiyele sahiptir. VoltGuard'ın bölgedeki konumlanması ve bölgedeki büyük endüstriyel müşterilere odaklanma hedefi, bu ilişkideki bir firmayla uzun vadeli iş birliği için yüksek indirim oranını haklı kılmaktadır.
                      </p>
                    </div>
                    <div className="bg-white p-3 rounded border-l-4 border-green-500">
                      <h5 className="text-[9pt] font-bold text-gray-800 mb-1">2. Yasal Uyum ve Güvenlik</h5>
                      <p className="text-[9pt] text-gray-600 leading-tight">
                        Teklif kapsamındaki tüm hizmetler (Topraklama, RCD Testleri, Yıldırımdan Korunma ve İç Tesisat Gözetleme Kontrolü), İş Ekipmanlarının Kullanımında Sağlık ve Güvenlik Şartları Yönetmeliği uyarınca zorunlu olan yıllık periyodik kontrol gerekliliklerini eksiksiz yerine getirecektir.
                      </p>
                    </div>
                    <div className="bg-white p-3 rounded border-l-4 border-purple-500">
                      <h5 className="text-[9pt] font-bold text-gray-800 mb-1">3. Tekrar Eden Hizmet Olanakları</h5>
                      <p className="text-[9pt] text-gray-600 leading-tight">
                        İskonto, girilen oran üzerinden ticari hesap parametresi olarak uygulanır. Uygulanabilir asgari ücret ve sözleşme koşulları teklif sorumlusu tarafından doğrulanmalıdır.
                      </p>
                    </div>
                    <div className="bg-white p-3 rounded border-l-4 border-yellow-500">
                      <h5 className="text-[9pt] font-bold text-gray-800 mb-1">4. Enerji Verimliliği Odaklı Yaklaşım</h5>
                      <p className="text-[9pt] text-gray-600 leading-tight">
                        VoltGuard'ın temel uzmanlığı enerji verimliliği ve sanayideki bu potansiyeli ortaya çıkarmaktır. Fabrikanızda yapılacak bu kontroller, sadece yasal zorunluluğu değil, aynı zamanda enerji tasarrufu potansiyeli olan alanların belirlenmesine de ön ayak olacaktır, zira enerji etüdü kapsamı ve hizmet yetkisi ilgili sözleşmede ayrıca doğrulanmalıdır.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Alt Bilgi */}
                <div className="text-[9pt] text-gray-500 border-t pt-4 mb-6">
                  <p className="mb-2"><strong>Notlar:</strong></p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Fiyatlara KDV dahil değildir.</li>
                    <li>Rapor kapsamı, ölçüm yöntemi ve kullanılacak belgeler yetkili kontrol sorumlusu tarafından doğrulanır.</li>
                    <li>VoltGuard, MÜSİAD Enerji ve Çevre Sektör Kurulu üyesidir.</li>
                    <li>Enerji Yönetim Sistemi (ISO 50001) ve VAP konularında ayrıca destek sağlanabilir.</li>
                  </ul>
                </div>

                {/* Footer - Sayfa 2 */}
                <div className="absolute bottom-[10mm] left-0 right-0 border-t border-gray-300 pt-2">
                  <div className="text-center text-[8pt] text-gray-500">
                    <p className="font-bold text-gray-800 text-[9pt]">{COMPANY_LEGAL_NAME}</p>
                    <p className="text-[9pt] mt-0.5 leading-tight">{COMPANY_ADDRESS_LINE_1}<br />{COMPANY_ADDRESS_LINE_2}</p>
                    <p className="text-[9pt]">{COMPANY_CONTACT_LINE}</p>
                    <p className="mt-1 text-gray-400">Sayfa 2/2</p>
                  </div>
                </div>

                  </div>
                </div>
                {/* SAYFA 2 SONU */}

              </>}</div>
            </div>

          </div>
        )}

        {/* Keşif Metraj Fiyat Teklifi Tab */}
        {activeTab === 'kesif' && (
          <Suspense fallback={<ModuleLoading />}>
          <KesifMetraj
            initialSnapshot={kesifInitialSnapshot}
            onCustomerUpdate={customerData=>setKesifCustomer({name:customerData.musteriAdi || '',address:customerData.adres || '',contactName:customerData.yetkili || '',phone:customerData.telefon || '',date:customerData.tarih || ''})}
            onSaveSnapshot={async snapshot=>{
              const form=snapshot.teklifForm;if(!form.musteriAdi?.trim() || !snapshot.cart.length){alert('Müşteri adı ve en az bir ürün gereklidir.');return null;}
              const name=prompt('Teklif adı:',form.musteriAdi+' - Keşif Teklifi');if(!name)return null;
              const products=snapshot.cart.map(item=>({...item,urun:item.name,birim:item.unit || item.birim || '',miktar:item.quantity,birimFiyat:saleUnitPrice(item,snapshot.discount,snapshot.profit),toplam:saleLineTotal(item,snapshot.discount,snapshot.profit)}));
              const subTotal=roundMoney(products.reduce((sum,item)=>sum+item.toplam,0)),kdvAmount=roundMoney(snapshot.cart.reduce((sum,item)=>sum+roundMoney(saleLineTotal(item,snapshot.discount,snapshot.profit)*(item.kdvOrani ?? form.kdvOrani ?? 20)/100),0));
              return await saveProposal('kesif',{componentSnapshot:{...snapshot,schemaVersion:1,reportHtml:sanitizeReportHTML(snapshot.reportHtml || '')},customer:{name:form.musteriAdi,address:form.adres,contactName:form.yetkili,phone:form.telefon,date:form.tarih},products,settings:{İskonto:0,kdvOrani:form.kdvOrani ?? 20},totals:{subTotal,İskontoAmount:0,kdvAmount,grandTotal:roundMoney(subTotal+kdvAmount)}},name);
            }}
          />
          </Suspense>
        )}

        {/* OLD KESIF BACKUP - SILME */}
        {false && activeTab === 'kesif_old' && (
          <div className="max-w-6xl mx-auto bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
            <div className="bg-gradient-to-r from-orange-600 to-orange-700 px-6 py-4 border-b border-orange-800">
              <h2 className="text-lg font-bold text-white flex items-center">
                <Hammer className="mr-2 h-5 w-5"/>
                Keşif Metraj Fiyat Teklifi
              </h2>
              <p className="text-orange-100 text-xs mt-1">Elektrik malzemesi ve kablo için keşif metraj listesi oluşturun. Kablo fiyatları: Serer Kablo (İzmir)</p>
            </div>

            <form onSubmit={handleKesifSubmit} className="p-8 space-y-6">
              
              {/* Serer Kablo Bilgi Kutusu */}
              {productType === 'kablo' && (
                <div className="bg-gradient-to-r from-purple-50 to-indigo-50 p-4 rounded-lg border border-purple-200">
                  <div className="flex items-start">
                    <Cable className="w-5 h-5 mr-2 text-purple-600 mt-0.5"/>
                    <div>
                      <h3 className="text-sm font-bold text-purple-800 mb-1">Kablo fiyatları: Serer Kablo (İzmir)</h3>
                      <div className="grid grid-cols-3 gap-2 text-xs text-gray-700">
                        <div><span className="font-semibold">Tel:</span> {KabloFiyatData.telefon}</div>
                        <div><span className="font-semibold">Web:</span> {KabloFiyatData.web}</div>
                        <div><span className="font-semibold text-red-600">⚠️ KDV Hariçç</span></div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Miteri Bilgileri */}
              <div className="bg-gray-50 p-6 rounded-lg border border-gray-200">
                <h3 className="text-md font-bold text-gray-800 mb-4 flex items-center">
                  <Users className="w-5 h-5 mr-2 text-orange-600"/>
                  Miteri Bilgileri
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Firma/Kurum adı *</label>
                    <input 
                      required
                      type="text" 
                      placeholder="Örn: XYZ İnşaat Ltd. Şti."
                      value={kesifCustomer.name}
                      onChange={(e) => setKesifCustomer({...kesifCustomer, name: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Yetkili adı Soyadi</label>
                    <input 
                      type="text" 
                      placeholder="Örn: Ahmet Yilmaz"
                      value={kesifCustomer.contactName}
                      onChange={(e) => setKesifCustomer({...kesifCustomer, contactName: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Adres</label>
                    <input 
                      type="text" 
                      placeholder="Örn: Ankara, iankaya"
                      value={kesifCustomer.address}
                      onChange={(e) => setKesifCustomer({...kesifCustomer, address: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Telefon</label>
                    <input 
                      type="text" 
                      placeholder="Örn: 0555 123 45 67"
                      value={kesifCustomer.phone}
                      onChange={(e) => setKesifCustomer({...kesifCustomer, phone: e.target.value})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition"
                    />
                  </div>
                </div>
              </div>

              {/* ✅ HIZLI TEKLİF PANELi */}
              <div className="bg-gradient-to-br from-cyan-50 to-blue-50 p-6 rounded-xl border-2 border-cyan-200 shadow-lg">
                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
                  <Zap className="w-6 h-6 mr-2 text-cyan-600"/>
                  ? Hızlı Teklif Arailari
                </h3>
                
                {/* Hizli Eriim Butonlari */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <button
                    type="button"
                    onClick={() => setShowSavedQuotations(!showSavedQuotations)}
                    className="bg-white hover:bg-blue-50 border-2 border-blue-300 text-blue-700 px-4 py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2 shadow"
                  >
                    <FileText className="w-4 h-4"/>
                    Kayitli Teklifler
                    {savedQuotations.length > 0 && (
                      <span className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">{savedQuotations.length}</span>
                    )}
                  </button>
                  
                  <button
                    type="button"
                    onClick={saveCurrentQuotation}
                    disabled={kesifProducts.length === 0}
                    className={`px-4 py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2 shadow ${
                      kesifProducts.length === 0
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : 'bg-green-600 hover:bg-green-700 text-white'
                    }`}
                  >
                    <Save className="w-4 h-4"/>
                    Teklifi Kaydet
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => setQuickAddMode(!quickAddMode)}
                    className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2 shadow"
                  >
                    <Zap className="w-4 h-4"/>
                    Hızlı Giriş
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => setShowProfitCalculator(!showProfitCalculator)}
                    className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2 shadow"
                  >
                    <Calculator className="w-4 h-4"/>
                    Kar marjı
                  </button>
                </div>

                {/* Excel Import & Kar marjı Uygulama */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">?❌ Excel'den ie Aktar</label>
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleExcelImport}
                      className="w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer"
                    />
                    <p className="text-xs text-gray-500 mt-1">sütunlar: ürün, Miktar, Fiyat, Birim</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">📊 Tüm Ürünlere Kâr Marjı Ekle</label>
                    <button
                      type="button"
                      onClick={applyProfitMarginToAll}
                      disabled={kesifProducts.length === 0}
                      className={`w-full py-2 px-4 rounded-lg font-semibold transition ${
                        kesifProducts.length === 0
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          : 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white'
                      }`}
                    >
                      % Kar marjı Ekle
                    </button>
                  </div>
                </div>

                {/* Hızlı Giriş Modu */}
                {quickAddMode && (
                  <div className="bg-white p-4 rounded-lg border-2 border-purple-300 mt-4">
                    <h4 className="font-bold text-purple-800 mb-2 flex items-center">
                      <Zap className="w-4 h-4 mr-2"/>
                      Hızlı Giriş Modu
                    </h4>
                    <p className="text-xs text-gray-600 mb-3">
                      Her satira bir ürün: "ürün adı, miktar, fiyat" formatinda yazin
                    </p>
                    <textarea
                      value={quickAddText}
                      onChange={(e) => setQuickAddText(e.target.value)}
                      placeholder="?? 3 FARKLI FORMAT:&#10;&#10;1️⃣ BASIT: ürün adı | Miktar | Fiyat&#10;   NYY Kablo 3x2.5 | 100 | 45.50&#10;   Priz Toprakli | 20 | 12&#10;&#10;2️⃣ DETAYLI: ürün | Miktar | Fiyat | Birim | Marka&#10;   NYM Kablo | 50 | 38.75 | metre | Nexans&#10;&#10;3️⃣ EXCEL KOPYALA-YAPIŞTIR: Doğrudan Excel'den kopyalayın (TAB ile ayrılmış)"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition text-sm font-mono"
                      rows={6}
                    />
                    <div className="flex gap-2 mt-2">
                      <button
                        type="button"
                        onClick={handleQuickAdd}
                        className="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-semibold transition"
                      >
                        ? Ekle
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setQuickAddMode(false);
                          setQuickAddText('');
                        }}
                        className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-semibold transition"
                      >
                        iptal
                      </button>
                    </div>
                  </div>
                )}

                {/* Kar marjı Hesaplayici */}
                {showProfitCalculator && (
                  <div className="bg-white p-4 rounded-lg border-2 border-orange-300 mt-4">
                    <h4 className="font-bold text-orange-800 mb-3 flex items-center">
                      <Calculator className="w-4 h-4 mr-2"/>
                      Kar marjı Hesaplayici
                    </h4>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Maliyet (TL)</label>
                        <input
                          type="number"
                          value={costPrice}
                          onChange={(e) => setCostPrice(parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition"
                          step="0.01"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Kar marjı (%)</label>
                        <input
                          type="number"
                          value={profitMargin}
                          onChange={(e) => setProfitMargin(parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition"
                        />
                      </div>
                    </div>
                    {costPrice > 0 && (
                      <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                        <div className="text-sm text-gray-700">
                          <strong>Sati fiyatı:</strong> {calculateSellingPrice(costPrice, profitMargin).toFixed(2)} TL
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          Kar: {(calculateSellingPrice(costPrice, profitMargin) - costPrice).toFixed(2)} TL
                        </div>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setShowProfitCalculator(false);
                        setCostPrice(0);
                      }}
                      className="w-full mt-2 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-semibold transition text-sm"
                    >
                      Kapat
                    </button>
                  </div>
                )}

                {/* Favoriler */}
                {favoriteProducts.length > 0 && (
                  <div className="mt-4">
                    <h4 className="font-bold text-gray-800 mb-2 flex items-center">
                      <Star className="w-4 h-4 mr-2 text-yellow-500 fill-yellow-500"/>
                      Favori ürünler ({favoriteProducts.length})
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {favoriteProducts.slice(0, 6).map((product, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => addFavoriteToKesif(product)}
                          className="bg-white hover:bg-yellow-50 border border-yellow-200 p-2 rounded-lg text-left text-sm transition group"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="font-semibold text-gray-800 text-xs truncate">{product.urun}</div>
                              <div className="text-xs text-gray-600">{product.birimFiyat?.toFixed(2)} TL</div>
                            </div>
                            <Plus className="w-4 h-4 text-green-600 opacity-0 group-hover:opacity-100 transition"/>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Son kullanılanlar */}
                {recentProducts.length > 0 && (
                  <div className="mt-4">
                    <h4 className="font-bold text-gray-800 mb-2 flex items-center">
                      <Clock className="w-4 h-4 mr-2 text-blue-500"/>
                      Son Kullanilan ürünler
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {recentProducts.slice(0, 6).map((product, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => addFavoriteToKesif(product)}
                          className="bg-white hover:bg-blue-50 border border-blue-200 p-2 rounded-lg text-left text-xs transition group"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1 truncate">
                              <div className="font-semibold text-gray-800 truncate">{product.urun}</div>
                              <div className="text-gray-600">{product.birimFiyat?.toFixed(2)} TL</div>
                            </div>
                            <Plus className="w-4 h-4 text-green-600 opacity-0 group-hover:opacity-100 transition"/>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Kayitli Teklifler Modal */}
                {showSavedQuotations && savedQuotations.length > 0 && (
                  <div className="mt-4 bg-white p-4 rounded-lg border-2 border-blue-300">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-bold text-blue-800 flex items-center">
                        <FileText className="w-4 h-4 mr-2"/>
                        Kayitli Teklifler ({savedQuotations.length})
                      </h4>
                      <button
                        type="button"
                        onClick={() => setShowSavedQuotations(false)}
                        className="text-gray-500 hover:text-gray-700"
                      >
                        <X className="w-5 h-5"/>
                      </button>
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {savedQuotations.map((quotation) => (
                        <div key={quotation.id} className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="font-semibold text-gray-800 text-sm">{quotation.name}</div>
                              <div className="text-xs text-gray-600">
                                {quotation.date} i {quotation.products.length} ürün i {quotation.totals.grandTotal.toFixed(2)} TL
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => loadSavedQuotation(quotation)}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-semibold"
                              >
                                Yükle
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteSavedQuotation(quotation.id)}
                                className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs font-semibold"
                              >
                                Sil
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Hazir Paket Ekle Butonu */}
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-6 rounded-lg border-2 border-blue-200 mb-6">
                <button
                  type="button"
                  onClick={() => setShowHazirPaketModal(true)}
                  className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white py-4 px-6 rounded-lg font-bold transition shadow-lg flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-6 h-6"/>
                  ? Hazir Paket Ekle (Hızlı Teklif)
                </button>
                <p className="text-xs text-center text-gray-600 mt-2">
                  Kompanzasyon, ADP, Aydinlatma gibi hazir paketlerle hızlı teklif oluşturun
                </p>
              </div>

              {/* Teklif mektubu */}
              <div className="mb-6 rounded-lg border border-indigo-200 bg-indigo-50 p-5"><button type="button" onClick={handleGenerateProposalEmail} disabled={!kesifProducts.length} className="w-full rounded-lg bg-indigo-600 p-3 font-semibold text-white disabled:bg-gray-300">Teklif Mektubu Taslağı Oluştur</button><p className="mt-2 text-sm text-gray-600">Müşteri ve mevcut teklif kalemlerinden düzenleyebileceğiniz bir mektup hazırlanır.</p></div>

              {/* ürün Tipi Seimi */}
              <div className="bg-gradient-to-r from-orange-50 to-purple-50 p-6 rounded-lg border border-orange-200">
                <h3 className="text-md font-bold text-gray-800 mb-4 flex items-center">
                  <Plus className="w-5 h-5 mr-2 text-orange-600"/>
                  Malzeme/Kablo Ekle
                </h3>
                
                {/* ürün Tipi Seim Butonlari */}
                <div className="mb-4 flex gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      setProductType('normal');
                      setSelectedCableForKesif(null);
                      setSelectedCategoryForKesif('');
                    }}
                    className={`px-6 py-3 rounded-lg font-semibold transition flex-1 ${
                      productType === 'normal'
                        ? 'bg-orange-600 text-white shadow-lg'
                        : 'bg-white text-gray-600 border border-gray-300 hover:border-orange-400'
                    }`}
                  >
                    <FileSpreadsheet className="w-4 h-4 inline mr-2"/>
                    Normal ürün/Malzeme
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProductType('kablo');
                      setSelectedProduct(null);
                      setProductSearch('');
                    }}
                    className={`px-6 py-3 rounded-lg font-semibold transition flex-1 ${
                      productType === 'kablo'
                        ? 'bg-purple-600 text-white shadow-lg'
                        : 'bg-white text-gray-600 border border-gray-300 hover:border-purple-400'
                    }`}
                  >
                    <Cable className="w-4 h-4 inline mr-2"/>
                    Kablo (Serer Kablo)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProductType('hizmet');
                      setSelectedProduct(null);
                      setProductSearch('');
                      setSelectedCableForKesif(null);
                      setSelectedCategoryForKesif('');
                    }}
                    className={`px-6 py-3 rounded-lg font-semibold transition flex-1 ${
                      productType === 'hizmet'
                        ? 'bg-green-600 text-white shadow-lg'
                        : 'bg-white text-gray-600 border border-gray-300 hover:border-green-400'
                    }`}
                  >
                    <Wrench className="w-4 h-4 inline mr-2"/>
                    Hizmet/iilik
                  </button>
                </div>

                {/* Normal ürün Ekleme Formu */}
                {productType === 'normal' && (
                <div className="space-y-4">
                  {/* ürün istatistikleri özeti */}
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-200">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-bold text-gray-800 text-sm flex items-center">
                        <FileSpreadsheet className="w-4 h-4 mr-2 text-blue-600"/>
                        ürün Veritabanı istatistikleri
                      </h4>
                      <button
                        type="button"
                        onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                        className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-full font-semibold transition"
                      >
                        {showAdvancedFilters ? 'i Filtreleri Güçzle' : '❌ GeliÅŸmiÅŸ Filtreler'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div className="bg-white p-2 rounded shadow-sm">
                        <div className="text-gray-600">Toplam Ürün</div>
                        <div className="text-lg font-bold text-blue-600">{productStats.toplamUrun}</div>
                      </div>
                      <div className="bg-white p-2 rounded shadow-sm">
                        <div className="text-gray-600">Marka Sayısı</div>
                        <div className="text-lg font-bold text-green-600">{productStats.markalar.length}</div>
                      </div>
                      <div className="bg-white p-2 rounded shadow-sm">
                        <div className="text-gray-600">Kategori</div>
                        <div className="text-lg font-bold text-purple-600">{productStats.kategoriSayilari.length}</div>
                      </div>
                      <div className="bg-white p-2 rounded shadow-sm">
                        <div className="text-gray-600">Ort. Fiyat</div>
                        <div className="text-lg font-bold text-orange-600">{productStats.ortalamaFiyat.toFixed(2)} ₺</div>
                      </div>
                    </div>
                  </div>

                  {/* GeliÅŸmiÅŸ Filtreler */}
                  {showAdvancedFilters && (
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        {/* Marka Filtresi */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Marka</label>
                          <select
                            value={markaFilter}
                            onChange={(e) => setMarkaFilter(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                          >
                            <option value="tumu">Tüm Markalar</option>
                            {productStats.enPopulerMarkalar.map(([marka, adet]) => (
                              <option key={marka} value={marka}>{marka} ({adet})</option>
                            ))}
                          </select>
                        </div>

                        {/* Kategori Filtresi */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Kategori</label>
                          <select
                            value={kategoriFilter}
                            onChange={(e) => setKategoriFilter(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                          >
                            <option value="tumu">Tüm Kategoriler</option>
                            {productStats.kategoriSayilari.map(({ ad, adet }) => (
                              <option key={ad} value={ad}>{ad} ({adet})</option>
                            ))}
                          </select>
                        </div>

                        {/* Veri Kaynağı Filtresi */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Veri Kaynağı</label>
                          <select
                            value={kaynakFilter}
                            onChange={(e) => setKaynakFilter(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition"
                          >
                            <option value="tumu">Tüm Kaynaklar</option>
                            <option value="Fatura1">📋 Fatura1 ({normalizedFatura1.length})</option>
                            <option value="Fatura2">📋 Fatura2 ({normalizedFatura2.length})</option>
                          </select>
                        </div>

                        {/* Siralama */}
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Siralama</label>
                          <select
                            value={siralama}
                            onChange={(e) => setSiralama(e.target.value)}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                          >
                            <option value="alfabetik">Alfabetik (A-Z)</option>
                            <option value="fiyat-artan">Fiyat (Artan)</option>
                            <option value="fiyat-azalan">Fiyat (Azalan)</option>
                            <option value="populer">En popüler</option>
                          </select>
                        </div>
                      </div>

                      {/* Fiyat Aralığı */}
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">
                          Fiyat Aralığı: {fiyatAraligi.min} ? - {fiyatAraligi.max >= 100000 ? '?' : fiyatAraligi.max + ' ?'}
                        </label>
                        <div className="flex gap-2 items-center">
                          <input
                            type="number"
                            placeholder="Min"
                            value={fiyatAraligi.min}
                            onChange={(e) => setFiyatAraligi({ ...fiyatAraligi, min: parseFloat(e.target.value) || 0 })}
                            className="w-20 px-2 py-1 text-sm border border-gray-300 rounded"
                          />
                          <span className="text-gray-500">-</span>
                          <input
                            type="number"
                            placeholder="Max"
                            value={fiyatAraligi.max >= 100000 ? '' : fiyatAraligi.max}
                            onChange={(e) => setFiyatAraligi({ ...fiyatAraligi, max: parseFloat(e.target.value) || 100000 })}
                            className="w-20 px-2 py-1 text-sm border border-gray-300 rounded"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setMarkaFilter('tumu');
                              setKategoriFilter('tumu');
                              setKaynakFilter('tumu');
                              setFiyatAraligi({ min: 0, max: 100000 });
                              setSiralama('alfabetik');
                            }}
                            className="ml-auto text-xs text-blue-600 hover:text-blue-800 font-semibold"
                          >
                            🔄 Filtreleri Temizle
                          </button>
                        </div>
                      </div>

                      {/* En çok Kullanilan ürünler */}
                      {productStats.enCokkullanılanlar.length > 0 && (
                        <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
                          <h5 className="text-xs font-bold text-yellow-800 mb-2">? Bu Projede En çok Kullanilan ürünler:</h5>
                          <div className="flex flex-wrap gap-2">
                            {productStats.enCokkullanılanlar.slice(0, 5).map(([urun, adet]) => (
                              <button
                                key={urun}
                                type="button"
                                onClick={() => {
                                  setProductSearch(urun);
                                  setShowProductDropdown(true);
                                }}
                                className="text-xs bg-yellow-200 hover:bg-yellow-300 text-yellow-900 px-2 py-1 rounded font-medium transition"
                              >
                                {urun} ({adet}x)
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ürün Arama ve Ekleme */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                    <div className="md:col-span-2 relative">
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        ürün Ara ({filteredProducts.length > 0 ? `${filteredProducts.length} sonui` : 'arama yapin'})
                      </label>
                      <div className="relative">
                        <input 
                          type="text" 
                          placeholder="ürün adı veya marka ile arayin..."
                          value={productSearch}
                          onChange={(e) => {
                            setProductSearch(e.target.value);
                            setShowProductDropdown(true);
                          }}
                          onFocus={() => setShowProductDropdown(true)}
                          className="w-full px-4 py-3 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition"
                        />
                        <Search className="absolute right-3 top-3.5 h-5 w-5 text-gray-400"/>
                      </div>
                      
                      {/* Dropdown - Gelitirilmi */}
                      {showProductDropdown && filteredProducts.length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-xl max-h-96 overflow-y-auto">
                          <div className="sticky top-0 bg-gradient-to-r from-blue-50 to-indigo-50 px-3 py-2 border-b border-blue-200">
                            <div className="text-xs font-semibold text-gray-700">
                              {filteredProducts.length} ürün bulundu
                              {markaFilter !== 'tumu' && <span className="ml-2 text-blue-600">i Marka: {markaFilter}</span>}
                              {kategoriFilter !== 'tumu' && <span className="ml-2 text-purple-600">i Kategori: {kategoriFilter}</span>}
                              {kaynakFilter !== 'tumu' && <span className="ml-2 text-green-600">i Kaynak: {kaynakFilter}</span>}
                            </div>
                          </div>
                          {filteredProducts.map((product, idx) => (
                            <div 
                              key={idx}
                              className="px-4 py-3 hover:bg-gradient-to-r hover:from-orange-50 hover:to-yellow-50 border-b border-gray-100 last:border-0 transition group"
                            >
                              <div className="flex items-start justify-between">
                                <div 
                                  className="flex-1 cursor-pointer"
                                  onClick={() => {
                                    setSelectedProduct(product);
                                    setProductSearch(product.urun);
                                    setShowProductDropdown(false);
                                  }}
                                >
                                  <div className="font-semibold text-sm text-gray-800">{product.urun}</div>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium">{product.marka}</span>
                                    <span className="text-xs text-gray-500">{product.olcu}</span>
                                    {product.kaynak && (
                                      <span className="text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded font-medium">{product.kaynak}</span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleFavorite(product);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 transition p-1 hover:bg-yellow-100 rounded"
                                    title={isFavorite(product) ? "Favorilerden ikar" : "Favorilere ekle"}
                                  >
                                    <Star 
                                      className={`w-4 h-4 ${isFavorite(product) ? 'text-yellow-500 fill-yellow-500' : 'text-gray-400'}`}
                                    />
                                  </button>
                                  <div className="text-right">
                                    <div className="text-sm font-bold text-orange-600">{product.birimFiyat} ?</div>
                                    <div className="text-xs text-gray-500">/{product.olcu}</div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Miktar</label>
                      <input 
                        type="number" 
                        min="0.01"
                        step="0.01"
                        placeholder="Miktar"
                        value={productQuantity}
                        onChange={(e) => setProductQuantity(parseFloat(e.target.value) || 0)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition"
                      />
                    </div>
                    
                    <div className="md:col-span-3">
                      <button 
                        type="button"
                        onClick={addProductToKesif}
                        disabled={!selectedProduct}
                        className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-3 px-6 rounded-lg font-semibold transition flex items-center justify-center"
                      >
                        <Plus className="w-5 h-5 mr-2"/>
                        Listeye Ekle
                      </button>
                    </div>
                  </div>
                </div>
                )}

                {/* Kablo Ekleme Formu */}
                {productType === 'kablo' && (
                <div className="grid grid-cols-1 gap-4">
                  {/* Kategori Seimi */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Kablo Kategorisi *</label>
                    <select 
                      value={selectedCategoryForKesif}
                      onChange={(e) => {
                        setSelectedCategoryForKesif(e.target.value);
                        setSelectedCableForKesif(null);
                      }}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition"
                    >
                      <option value="">-- Kategori Seiçiniz --</option>
                      {KabloFiyatData.kategoriler.map((kategori) => (
                        <option key={kategori.id} value={kategori.id}>
                          {kategori.ad}
                        </option>
                      ))}
                    </select>
                    {selectedCategoryForKesif && (
                      <p className="text-xs text-gray-600 mt-1">
                        {KabloFiyatData.kategoriler.find(k => k.id === selectedCategoryForKesif)?.aciklama}
                      </p>
                    )}
                  </div>

                  {/* Kablo Seimi */}
                  {selectedCategoryForKesif && (
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Kablo Tipi ve Kesit *</label>
                      <select 
                        value={selectedCableForKesif ? selectedCableForKesif.kod : ''}
                        onChange={(e) => {
                          const kategori = KabloFiyatData.kategoriler.find(k => k.id === selectedCategoryForKesif);
                          const cable = kategori?.urunler.find(u => u.kod === e.target.value);
                          setSelectedCableForKesif(cable || null);
                        }}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition"
                      >
                        <option value="">-- Kablo Seiçiniz --</option>
                        {KabloFiyatData.kategoriler
                          .find(k => k.id === selectedCategoryForKesif)
                          ?.urunler.map((urun) => (
                            <option key={urun.kod} value={urun.kod}>
                              {urun.ad} - {kesifFiyatSecimi === 'fiyat1' ? urun.fiyat1 : (urun.fiyat2 || urun.fiyat1)} TL/{urun.birim}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}

                  {/* Fiyat Seimi */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Fiyat Seimi</label>
                    <div className="flex gap-4">
                      <label className="flex items-center">
                        <input 
                          type="radio" 
                          name="kesifFiyatSecimi" 
                          value="fiyat1"
                          checked={kesifFiyatSecimi === 'fiyat1'}
                          onChange={(e) => setKesifFiyatSecimi(e.target.value)}
                          className="mr-2"
                        />
                        <span className="text-sm text-gray-700">Fiyat 1</span>
                      </label>
                      <label className="flex items-center">
                        <input 
                          type="radio" 
                          name="kesifFiyatSecimi" 
                          value="fiyat2"
                          checked={kesifFiyatSecimi === 'fiyat2'}
                          onChange={(e) => setKesifFiyatSecimi(e.target.value)}
                          className="mr-2"
                        />
                        <span className="text-sm text-gray-700">Fiyat 2 (varsa)</span>
                      </label>
                    </div>
                  </div>

                  {/* Miktar ve özet */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Miktar (Metre) *</label>
                      <input 
                        type="number" 
                        min="0.01"
                        step="0.01"
                        placeholder="Örn: 100"
                        value={productQuantity}
                        onChange={(e) => setProductQuantity(parseFloat(e.target.value) || 0)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition"
                      />
                    </div>
                    
                    {selectedCableForKesif && (
                      <div className="bg-purple-100 p-4 rounded-lg flex flex-col justify-center">
                        <div className="text-xs text-gray-600">Birim Fiyat</div>
                        <div className="text-xl font-bold text-purple-700">
                          {(kesifFiyatSecimi === 'fiyat1' ? selectedCableForKesif.fiyat1 : (selectedCableForKesif.fiyat2 || selectedCableForKesif.fiyat1)).toFixed(2)} TL
                        </div>
                        <div className="text-xs text-gray-600 mt-1">Toplam: {((kesifFiyatSecimi === 'fiyat1' ? selectedCableForKesif.fiyat1 : (selectedCableForKesif.fiyat2 || selectedCableForKesif.fiyat1)) * productQuantity).toFixed(2)} TL</div>
                      </div>
                    )}
                  </div>
                  
                  <button 
                    type="button"
                    onClick={addProductToKesif}
                    disabled={!selectedCableForKesif || productQuantity <= 0}
                    className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-3 px-6 rounded-lg font-semibold transition flex items-center justify-center"
                  >
                    <Plus className="w-5 h-5 mr-2"/>
                    Listeye Ekle
                  </button>
                </div>
                )}

                {/* Hizmet/iilik Ekleme Formu */}
                {productType === 'hizmet' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Hizmet/iilik adı *</label>
                    <input 
                      type="text" 
                      placeholder="Örn: iilik, Devreye Alma, Mihendislik Hizmeti"
                      value={hizmetAdi}
                      onChange={(e) => setHizmetAdi(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Birim Fiyat (TL) *</label>
                      <input 
                        type="number" 
                        min="0"
                        step="0.01"
                        placeholder="Örn: 5000"
                        value={hizmetFiyat || ''}
                        onChange={(e) => setHizmetFiyat(parseFloat(e.target.value) || 0)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Birim</label>
                      <select
                        value={hizmetBirim}
                        onChange={(e) => setHizmetBirim(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition"
                      >
                        <option value="Güçn">Güçn</option>
                        <option value="Saat">Saat</option>
                        <option value="Adet">Adet</option>
                        <option value="Takim">Takim</option>
                        <option value="Proje">Proje</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Miktar *</label>
                    <input 
                      type="number" 
                      min="0.01"
                      step="0.01"
                      placeholder="Örn: 1"
                      value={hizmetMiktar}
                      onChange={(e) => setHizmetMiktar(parseFloat(e.target.value) || 1)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Açıklama (Opsiyonel)</label>
                    <textarea 
                      rows="2"
                      placeholder="Örn: Panel devreye alma ve test"
                      value={hizmetAciklama}
                      onChange={(e) => setHizmetAciklama(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition resize-none"
                    />
                  </div>

                  {hizmetAdi && hizmetFiyat > 0 && hizmetMiktar > 0 && (
                    <div className="bg-green-100 p-4 rounded-lg">
                      <div className="text-xs text-gray-600">Toplam Tutar</div>
                      <div className="text-xl font-bold text-green-700">
                        {(hizmetFiyat * hizmetMiktar).toFixed(2)} TL
                      </div>
                      <div className="text-xs text-gray-600 mt-1">
                        {hizmetFiyat.toFixed(2)} TL i {hizmetMiktar} {hizmetBirim}
                      </div>
                    </div>
                  )}
                  
                  <button 
                    type="button"
                    onClick={addProductToKesif}
                    disabled={!hizmetAdi || hizmetFiyat <= 0 || hizmetMiktar <= 0}
                    className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white py-3 px-6 rounded-lg font-semibold transition flex items-center justify-center"
                  >
                    <Plus className="w-5 h-5 mr-2"/>
                    Listeye Ekle
                  </button>
                </div>
                )}
              </div>

              {/* ürün Listesi */}
              {kesifProducts.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-800 px-4 py-3 flex justify-between items-center">
                    <h3 className="text-md font-bold text-white flex items-center">
                      <FileSpreadsheet className="w-5 h-5 mr-2"/>
                      Malzeme/Kablo/Hizmet Listesi ({kesifProducts.length} kalem)
                    </h3>
                    <div className="flex gap-2">
                      <button 
                        type="button"
                        onClick={() => {
                          const totals = calculateKesifTotals();
                          let text = `📋 KEŞİF METRAJ LİSTESİ\n`;
                          text += `================================\n\n`;
                          text += `Firma: ${kesifCustomer.name || 'Belirtilmemiş'}\n`;
                          text += `Tarih: ${new Date().toLocaleDateString('tr-TR')}\n\n`;
                          text += `MALZEME LİSTESİ:\n`;
                          text += `--------------------------------\n`;
                          kesifProducts.forEach((p, idx) => {
                            text += `${idx + 1}. ${p.urun}\n`;
                            text += `   Marka: ${p.marka || '-'} | ${p.miktar} ${p.birim}\n`;
                            text += `   Birim Fiyat: ${p.birimFiyat.toFixed(2)} TL\n`;
                            text += `   Toplam: ${p.toplam.toFixed(2)} TL\n\n`;
                          });
                          text += `================================\n`;
                          text += `Ara Toplam: ${totals.subTotal.toFixed(2)} TL\n`;
                          text += `İskonto (%${kesifSettings.İskonto}): -${totals.İskontoAmount.toFixed(2)} TL\n`;
                          text += `İskonto Sonrası: ${totals.afterDiscount.toFixed(2)} TL\n`;
                          text += `KDV (%${kesifSettings.kdvOrani}): +${totals.kdvAmount.toFixed(2)} TL\n`;
                          text += `--------------------------------\n`;
                          text += `GENEL TOPLAM: ${totals.grandTotal.toFixed(2)} TL\n`;
                          
                          navigator.clipboard.writeText(text);
                          alert('❌ Liste panoya kopyalandı!');
                        }}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded text-xs font-semibold transition flex items-center gap-1"
                      >
                        <Copy className="w-3 h-3"/>
                        Panoya Kopyala
                      </button>
                      <button 
                        type="button"
                        onClick={() => {
                          const percentage = prompt('Yüzde değeri girin (+artış, -indirim):', '10');
                          if (percentage !== null && percentage !== '') {
                            applyBulkPriceAdjustment(parseFloat(percentage));
                          }
                        }}
                        className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white px-3 py-1 rounded text-xs font-semibold transition flex items-center gap-1"
                        title="Özel yüzde ile toplu fiyat ayarlama"
                      >
                        <Percent className="w-3 h-3"/>
                        Toplu %
                      </button>
                      <button 
                        type="button"
                        onClick={() => applyBulkPriceAdjustment(10)}
                        className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs font-semibold transition"
                        title="Tüm fiyatlara %10 zam"
                      >
                        +10%
                      </button>
                      <button 
                        type="button"
                        onClick={() => applyBulkPriceAdjustment(20)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-semibold transition"
                        title="Tüm fiyatlara %20 zam"
                      >
                        +20%
                      </button>
                      <button 
                        type="button"
                        onClick={() => applyBulkPriceAdjustment(-10)}
                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs font-semibold transition"
                        title="Tüm fiyatlara %10 indirim"
                      >
                        -10%
                      </button>
                      <button 
                        type="button"
                        onClick={() => {
                          if (confirm(`${kesifProducts.length} ürünün tamamını silmek istediğinizden emin misiniz?`)) {
                            setKesifProducts([]);
                            alert('❌ Tüm ürünler silindi!');
                          }
                        }}
                        className="bg-gray-700 hover:bg-gray-800 text-white px-3 py-1 rounded text-xs font-semibold transition flex items-center gap-1"
                        title="Tüm listeyi temizle"
                      >
                        <Trash2 className="w-3 h-3"/>
                        Tümünü Sil
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-100 border-b border-gray-300">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-700">SIRA</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-700">TİP</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-700">ürün ADI</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-gray-700">DETAY</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-gray-700">BİRİM FİYAT</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-gray-700">MİKTAR</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-gray-700">TOPLAM</th>
                          <th className="px-4 py-3 text-center text-xs font-bold text-gray-700">iLEM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kesifProducts.map((product) => (
                          <tr key={product.id} className={`border-b border-gray-200 hover:bg-gray-50 ${
                            product.type === 'kablo' ? 'bg-purple-50' : ''
                          }`}>
                            <td className="px-4 py-3 text-gray-700">{product.sira}</td>
                            <td className="px-4 py-3">
                              {product.type === 'kablo' ? (
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">
                                  <Cable className="w-3 h-3 mr-1"/>
                                  Kablo
                                </span>
                              ) : product.type === 'hizmet' ? (
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">
                                  <Wrench className="w-3 h-3 mr-1"/>
                                  Hizmet
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800">
                                  <FileSpreadsheet className="w-3 h-3 mr-1"/>
                                  Malzeme
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <input 
                                type="text"
                                value={product.urun}
                                onChange={(e) => updateProductName(product.id, e.target.value)}
                                className="w-full px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <input 
                                type="text"
                                value={product.marka}
                                onChange={(e) => updateProductDetail(product.id, e.target.value)}
                                className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                              />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <input 
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={product.birimFiyat}
                                onChange={(e) => updateProductPrice(product.id, parseFloat(e.target.value) || 0)}
                                className="w-24 px-2 py-1 text-right border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                              />
                              <span className="text-xs text-gray-500 ml-1">TL</span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <input 
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={product.miktar}
                                onChange={(e) => updateProductQuantity(product.id, parseFloat(e.target.value) || 0)}
                                className="w-20 px-2 py-1 text-right border border-gray-300 rounded focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none"
                              />
                              <span className="text-xs text-gray-500 ml-1">{product.olcu}</span>
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-gray-800">
                              {product.toplam.toFixed(2)} TL
                              {product.karMarji > 0 && (
                                <div className="text-xs text-green-600 font-normal">
                                  +%{product.karMarji} kar
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                {/* Çoğalt */}
                                <button 
                                  type="button"
                                  onClick={() => duplicateProduct(product.id)}
                                  className="text-blue-600 hover:text-blue-800 transition p-1 hover:bg-blue-50 rounded"
                                  title="Çoğalt"
                                >
                                  <Copy className="w-4 h-4"/>
                                </button>
                                {/* Sil */}
                                <button 
                                  type="button"
                                  onClick={() => removeProductFromKesif(product.id)}
                                  className="text-red-600 hover:text-red-800 transition p-1 hover:bg-red-50 rounded"
                                  title="Sil"
                                >
                                  <Trash2 className="w-4 h-4"/>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* İskonto ve KDV Ayarlari */}
              {kesifProducts.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-blue-50 p-6 rounded-lg border border-blue-200">
                    <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center">
                      <Percent className="w-4 h-4 mr-2 text-blue-600"/>
                      İskonto Oranı (%)
                    </label>
                    <input 
                      type="number" 
                      min="0"
                      max="100"
                      step="0.01"
                      value={kesifSettings.İskonto}
                      onChange={(e) => setKesifSettings({...kesifSettings, İskonto: parseFloat(e.target.value) || 0})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition text-lg font-semibold"
                    />
                  </div>
                  <div className="bg-green-50 p-6 rounded-lg border border-green-200">
                    <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center">
                      <Percent className="w-4 h-4 mr-2 text-green-600"/>
                      KDV Oranı (%)
                    </label>
                    <input 
                      type="number" 
                      min="0"
                      max="100"
                      step="0.01"
                      value={kesifSettings.kdvOrani}
                      onChange={(e) => setKesifSettings({...kesifSettings, kdvOrani: parseFloat(e.target.value) || 0})}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none transition text-lg font-semibold"
                    />
                  </div>
                </div>
              )}

              {/* özet ve Toplamlar */}
              {kesifProducts.length > 0 && (
                <div className="bg-gradient-to-r from-gray-50 to-gray-100 p-6 rounded-lg border-2 border-gray-300">
                  <h3 className="text-md font-bold text-gray-800 mb-4">Teklif özeti</h3>
                  {(() => {
                    const totals = calculateKesifTotals();
                    return (
                      <div className="space-y-3">
                        <div className="flex justify-between items-center py-2 border-b border-gray-300">
                          <span className="text-sm font-medium text-gray-700">Ara Toplam:</span>
                          <span className="text-lg font-semibold text-gray-800">{totals.subTotal.toFixed(2)} TL</span>
                        </div>
                        {kesifSettings.İskonto > 0 && (
                          <div className="flex justify-between items-center py-2 border-b border-gray-300">
                            <span className="text-sm font-medium text-blue-700">İskonto (% {kesifSettings.İskonto}):</span>
                            <span className="text-lg font-semibold text-blue-700">- {totals.İskontoAmount.toFixed(2)} TL</span>
                          </div>
                        )}
                        {kesifSettings.İskonto > 0 && (
                          <div className="flex justify-between items-center py-2 border-b border-gray-300">
                            <span className="text-sm font-medium text-gray-700">İskonto Sonrası:</span>
                            <span className="text-lg font-semibold text-gray-800">{totals.afterDiscount.toFixed(2)} TL</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center py-2 border-b border-gray-300">
                          <span className="text-sm font-medium text-green-700">KDV (% {kesifSettings.kdvOrani}):</span>
                          <span className="text-lg font-semibold text-green-700">+ {totals.kdvAmount.toFixed(2)} TL</span>
                        </div>
                        <div className="flex justify-between items-center py-3 bg-orange-600 text-white px-4 rounded-lg mt-4">
                          <span className="text-base font-bold">GENEL TOPLAM:</span>
                          <span className="text-2xl font-bold">{totals.grandTotal.toFixed(2)} TL</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Submit Button */}
              <button 
                type="submit"
                disabled={kesifProducts.length === 0}
                className="w-full bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white py-4 px-6 rounded-lg font-bold text-lg transition shadow-lg flex items-center justify-center"
              >
                <FileText className="w-6 h-6 mr-3"/>
                Teklif Önizlemesine Güçt
              </button>

            </form>
          </div>
        )}
        {/* OLD KESIF BACKUP END */}

        {/* Kablo Keşif Metraj Tab */}
        {/* Proposal View */}
        {activeTab === 'proposal' && selectedCompany && (
          <div className="flex gap-6 flex-col lg:flex-row">
            
            {/* Sidebar (No Print) */}
            <div className="lg:w-1/3 space-y-4 no-print">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h3 className="font-bold text-gray-800 mb-4 flex items-center">
                  <Lightbulb className="h-5 w-5 mr-2 text-yellow-500" />
                  Teklif metni ve girdi kontrolü
                </h3>

                <button 
                  onClick={() => handleProposalAssistant('email')}
                  disabled={aiLoading}
                  className="w-full flex items-center justify-center space-x-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white py-3 rounded-lg mb-3 transition shadow disabled:opacity-50"
                >
                  <Mail className="h-5 w-5" />
                  <span>? Teklif Sunum E-postası Yaz</span>
                </button>

                <button 
                  onClick={() => handleProposalAssistant('tips')}
                  disabled={aiLoading}
                  className="w-full flex items-center justify-center space-x-2 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white py-3 rounded-lg mb-3 transition shadow disabled:opacity-50"
                >
                  <TrendingDown className="h-5 w-5" />
                  <span>? Sektörel Enerji İpuçları</span>
                </button>

                {aiLoading && (
                    <div className="text-center py-4 text-gray-500 text-sm animate-pulse">
                        Metin hazırlanıyor...
                    </div>
                )}

                {aiOutput && (
                    <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-4 relative group">
                        <button 
                            onClick={copyToClipboard}
                            className="absolute top-2 right-2 p-1 bg-white border rounded hover:bg-gray-100 text-gray-500 transition"
                            title="Kopyala"
                        >
                            <Copy className="h-4 w-4" />
                        </button>
                        <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">
                            {aiActiveFeature === 'email' ? 'E-posta Taslai' : 'Sektörel Tavsiyeler'}
                        </h4>
                        <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans leading-relaxed">
                            {aiOutput}
                        </pre>
                    </div>
                )}
                
                {/* Export & Actions */}
                <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-4 rounded-xl border border-gray-200 mt-4">
                    <h3 className="font-bold text-gray-900 mb-3 flex items-center">
                      <Download className="w-4 h-4 mr-2"/>
                      Export & işlemler
                    </h3>
                    
                    {/* Editor Mode Toggle */}
                    <button 
                      onClick={toggleEditorMode}
                      className="w-full flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-lg mb-2 transition"
                    >
                      <Edit3 className="h-4 w-4" />
                      <span>{editorMode ? '📊 Düzenleme Modundan çık' : '📊 Düzenleme Modu'}</span>
                    </button>
                    
                    {/* PDF Export */}
                    <button 
                      onClick={handleDownloadPDF}
                      className="w-full flex items-center justify-center space-x-2 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-lg mb-2 transition"
                    >
                      <FileText className="h-4 w-4" />
                      <span>📄 PDF İndir</span>
                    </button>

                    {/* Word Export */}
                    <button 
                      onClick={handleDownloadWord}
                      className="w-full flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg mb-2 transition"
                    >
                      <FileText className="h-4 w-4" />
                      <span>📝 Word İndir</span>
                    </button>

                    {/* Excel Export */}
                    <button 
                      onClick={handleExcelExport}
                      className="w-full flex items-center justify-center space-x-2 bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-lg mb-2 transition"
                    >
                      <FileSpreadsheet className="h-4 w-4" />
                      <span>📊 Excel İndir</span>
                    </button>

                    {/* Email Send */}
                    <button 
                      onClick={handleSendEmail}
                      className="w-full flex items-center justify-center space-x-2 bg-purple-600 hover:bg-purple-700 text-white py-2.5 rounded-lg mb-2 transition"
                    >
                      <Mail className="h-4 w-4" />
                      <span>E-posta taslağı aç</span>
                    </button>

                    {/* Print */}
                    <button 
                      onClick={handlePrint}
                      className="w-full flex items-center justify-center space-x-2 bg-gray-700 hover:bg-gray-800 text-white py-2.5 rounded-lg mb-2 transition"
                    >
                      <Printer className="h-4 w-4" />
                      <span>🖨️ Yazdır</span>
                    </button>

                    {/* Kaydet */}
                    <button 
                      onClick={async()=>{if(!selectedCompany){alert('Önce teklif oluşturun.');return;}const type=selectedCompany.type==='kesif'?'kesif':'yg';const name=prompt('Teklif adı:',selectedCompany.name+' - '+(type==='yg'?'YG':'Keşif')+' Teklifi');if(!name)return;const data=type==='yg'?{form:{...manualForm,...selectedCompany},params,calculated:selectedCompany,reportHtml:reportHTML('printable-paper',editableContent)}:{customer:kesifCustomer,products:selectedCompany.products,settings:selectedCompany.settings,totals:selectedCompany.totals,reportHtml:reportHTML('printable-paper',editableContent)};await saveProposal(type,data,name);}}
                      className="w-full flex items-center justify-center space-x-2 bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-lg transition"
                    >
                      <Save className="h-4 w-4" />
                      <span>💾 Kaydet</span>
                    </button>
                </div>

                {/* Hızlı Düzenleme */}
                <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 mt-4">
                    <h3 className="font-bold text-blue-900 mb-2">Hızlı Düzenleme</h3>
                    
                    {/* Para Birimi Seici */}
                    <div className="mb-3">
                      <label className="text-xs font-bold text-blue-800 uppercase">💱 Para Birimi</label>
                      <select 
                        value={currency} 
                        onChange={(e) => handleCurrencyChange(e.target.value)}
                        className="w-full mt-1 p-2 border border-blue-200 rounded text-sm font-semibold text-blue-700"
                      >
                        <option value="TRY">🇹🇷 Türk Lirası (TL)</option>
                        <option value="USD">🇺🇸 Dolar ($)</option>
                        <option value="EUR">🇪🇺 Euro (€)</option>
                      </select>
                      <p className="text-xs text-blue-600 mt-1">YG fiyatları belirtilen kurla dönüştürülür. Keşif ve periyodik bedeller TL olarak kalır.</p>
                    </div>
                    
                    <div className="mb-3">
                    <label className="text-xs font-bold text-blue-800 uppercase">Özel İskonto (%)</label>
                    <input 
                        type="number" 
                        value={params.discountRate} 
                        onChange={(e) => {
                          const newDiscount = parseFloat(e.target.value) || 0;
                          setParams({...params, discountRate: newDiscount});
                          // selectedCompany'yi de güncelle
                          if (selectedCompany) {
                            const newDiscountAmount = selectedCompany.nominalFee * (newDiscount / 100);
                            const newOfferPrice = selectedCompany.nominalFee - newDiscountAmount;
                            setSelectedCompany({
                              ...selectedCompany,
                              appliedDiscountRate: newDiscount,
                              discountAmount: newDiscountAmount,
                              offerPrice: newOfferPrice
                            });
                          }
                        }}
                        className="w-full mt-1 p-2 border border-blue-200 rounded text-sm"
                    />
                    </div>
                </div>
              </div>
            </div>
            

            {/* Proposal Preview (A4 Paper Style) - Right Side */}
            <div className="lg:w-2/3 bg-gray-200 p-8 rounded-xl overflow-auto lg:h-[calc(100vh-200px)] flex-grow flex justify-center">
              
              {/* Editor Mode Banner */}
              {editorMode && (
                <div className="mb-4 space-y-2">
                  <div className="bg-indigo-600 text-white px-4 py-3 rounded-lg flex items-center justify-between">
                    <div className="flex items-center">
                      <Edit3 className="w-5 h-5 mr-2"/>
                      <span className="font-semibold">Düzenleme Modu Aktif - Metinleri doğrudan düzenleyebilirsiniz</span>
                    </div>
                    <button 
                      onClick={toggleEditorMode}
                      className="bg-white text-indigo-600 px-4 py-1 rounded hover:bg-indigo-50 transition"
                    >
                      Kaydet ve çık
                    </button>
                  </div>
                  
                  {/* Formatting Toolbar */}
                  <div className="bg-white border border-gray-300 rounded-lg p-3 flex flex-wrap items-center gap-2">
                    <button 
                      onClick={() => document.execCommand('bold')}
                      className="p-2 hover:bg-gray-100 rounded border border-gray-300"
                      title="Kalin"
                    >
                      <Bold className="w-4 h-4"/>
                    </button>
                    <button 
                      onClick={() => document.execCommand('italic')}
                      className="p-2 hover:bg-gray-100 rounded border border-gray-300"
                      title="italik"
                    >
                      <Italic className="w-4 h-4"/>
                    </button>
                    <button 
                      onClick={() => document.execCommand('underline')}
                      className="p-2 hover:bg-gray-100 rounded border border-gray-300"
                      title="Alti izili"
                    >
                      <Type className="w-4 h-4"/>
                    </button>
                    <div className="w-px h-6 bg-gray-300"></div>
                    <select 
                      onChange={(e) => document.execCommand('fontSize', false, e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      <option value="">Yazi Boyutu</option>
                      <option value="1">çok Kiik</option>
                      <option value="2">Kiik</option>
                      <option value="3">Normal</option>
                      <option value="4">Büyük</option>
                      <option value="5">Çok Büyük</option>
                      <option value="6">Dev</option>
                    </select>
                    <select 
                      onChange={(e) => document.execCommand('foreColor', false, e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      <option value="">Renk</option>
                      <option value="#000000">Siyah</option>
                      <option value="#1E3A8A">Mavi</option>
                      <option value="#DC2626">Kirmizi</option>
                      <option value="#059669">Yeil</option>
                      <option value="#D97706">Turuncu</option>
                    </select>
                    <div className="w-px h-6 bg-gray-300"></div>
                    <button 
                      onClick={() => document.execCommand('justifyLeft')}
                      className="p-2 hover:bg-gray-100 rounded border border-gray-300"
                      title="Sola Hizala"
                    >
                      <AlignLeft className="w-4 h-4"/>
                    </button>
                    <button 
                      onClick={() => document.execCommand('justifyCenter')}
                      className="p-2 hover:bg-gray-100 rounded border border-gray-300"
                      title="Ortala"
                    >
                      <AlignCenter className="w-4 h-4"/>
                    </button>
                    <button 
                      onClick={() => document.execCommand('justifyRight')}
                      className="p-2 hover:bg-gray-100 rounded border border-gray-300"
                      title="Saia Hizala"
                    >
                      <AlignRight className="w-4 h-4"/>
                    </button>
                  </div>
                </div>
              )}
              
              {/* A4 Paper Structure (Yazdırilacak Alan) */}
              <div 
                id="printable-paper"
                contentEditable={editorMode}
                suppressContentEditableWarning={true}
                className={editorMode ? 'outline-2 outline-dashed outline-indigo-400' : ''}
                style={editorMode ? { minHeight: '297mm' } : {}}
               onPaste={pasteReportHTML} dangerouslySetInnerHTML={editableContent ? {__html:reportHTMLWithReference(editableContent,selectedCompany?.refNo || proposalReferences.yg)} : undefined}>{editableContent ? null : <>
                  
                  {/* KEŞİF METRAJ TEKLİF - Conditional Render */}
                  {selectedCompany.type === 'kesif' ? (
                    <>
                      {(() => {
                        const products = selectedCompany.products;
                        const itemsPerPage = 18;
                        const totalPages = Math.ceil(products.length / itemsPerPage);
                        
                        return Array.from({ length: totalPages }, (_, pageIndex) => {
                          const startIdx = pageIndex * itemsPerPage;
                          const endIdx = Math.min(startIdx + itemsPerPage, products.length);
                          const pageProducts = products.slice(startIdx, endIdx);
                          const isLastPage = pageIndex === totalPages - 1;
                          
                          return (
                            <div key={pageIndex} className="bg-white max-w-[210mm] mx-auto min-h-[297mm] p-[10mm] pb-[35mm] shadow-2xl relative text-[10pt] leading-tight text-gray-800 pdf-page" style={{pageBreakAfter: isLastPage ? 'auto' : 'always', pageBreakInside: 'avoid'}}>
                              <div>
                                {/* Header */}
                                <div className="flex justify-between items-start mb-6 border-b border-gray-300 pb-4">
                                  <div className="w-1/3 flex items-start">
                                    <img src="/calisan/uygulama/fatura_logo.png" alt="VoltGuard Logo" className="h-24 max-w-[210px] object-contain" />
                                  </div>
                                  <div className="text-right">
                                    <h1 className="text-xl font-bold text-blue-700 tracking-wide uppercase">
                                      KEŞİF METRAJ FİYAT TEKLİFİ
                                    </h1>
                                    <p className="text-[9pt] text-gray-500 mt-2">Referans No: KM-{new Date().getTime().toString().slice(-6)}</p>
                                    <p className="text-[9pt] text-gray-600 mt-0.5">{selectedCompany.date}</p>
                                  </div>
                                </div>

                                {/* Miteri Bilgileri - Sadece ilk Sayfa */}
                                {pageIndex === 0 && (
                                  <>
                                    <div className="mb-6 bg-blue-50 p-4 rounded-lg border border-blue-200">
                                      <h3 className="text-[10pt] font-bold text-blue-800 mb-3 uppercase tracking-wide">Miteri Bilgileri</h3>
                                      <div className="grid grid-cols-2 gap-3 text-[9pt]">
                                        <div><strong>Firma/Kurum:</strong> {selectedCompany.name}</div>
                                        {selectedCompany.contactName && <div><strong>Yetkili:</strong> {selectedCompany.contactName}</div>}
                                        {selectedCompany.address && <div><strong>Adres:</strong> {selectedCompany.address}</div>}
                                        {selectedCompany.phone && <div><strong>Telefon:</strong> {selectedCompany.phone}</div>}
                                      </div>
                                    </div>

                                    <p className="mb-4 text-[9.5pt] leading-tight">
                                      <strong>Sayın {selectedCompany.contactName ? `${selectedCompany.contactName} - ` : ''}{selectedCompany.name} Yetkilisi,</strong>
                                    </p>
                                    <p className="mb-6 text-justify text-[9.5pt] leading-tight">
                                      Talep ettiginiz elektrik malzemeleri ve kablolara iliskin kesif metraj fiyat teklifimiz asagida detaylandirilmistir. 
                                      Tum fiyatlar guncel piyasa kosullari goz onunde bulundurularak hazirlanmistir.
                                    </p>
                                  </>
                                )}

                                {/* ürün Tablosu */}
                                <h3 className="text-[10pt] font-bold text-gray-800 mb-3 uppercase tracking-wide">
                                  {pageIndex === 0 ? 'Malzeme Listesi ve Fiyatlandirma' : 'Malzeme Listesi (Devam)'}
                                </h3>
                                <div className="overflow-x-auto mb-6">
                                  <table className="w-full text-[8pt] border-collapse border border-gray-300">
                                    <thead style={{backgroundColor: '#1e40af'}}>
                                      <tr>
                                        <th className="border border-gray-300 p-2 text-center text-white font-semibold">SIRA</th>
                                        <th className="border border-gray-300 p-2 text-left text-white font-semibold">TİP</th>
                                        <th className="border border-gray-300 p-2 text-left text-white font-semibold">ürün/KABLO ADI</th>
                                        <th className="border border-gray-300 p-2 text-left text-white font-semibold">DETAY/KESiT</th>
                                        <th className="border border-gray-300 p-2 text-right text-white font-semibold">BİRİM FİYAT</th>
                                        <th className="border border-gray-300 p-2 text-right text-white font-semibold">MİKTAR</th>
                                        <th className="border border-gray-300 p-2 text-center text-white font-semibold">iLi</th>
                                        <th className="border border-gray-300 p-2 text-right text-white font-semibold">TOPLAM (TL)</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {pageProducts.map((product, idx) => (
                                        <tr key={product.id} className={idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                                          <td className="border border-gray-300 p-2 text-center">{product.sira}</td>
                                          <td className="border border-gray-300 p-2 text-center">
                                            {product.type === 'kablo' ? (
                                              <span className="text-[7pt] font-semibold text-purple-700">KABLO</span>
                                            ) : (
                                              <span className="text-[7pt] font-semibold text-orange-700">MALZEME</span>
                                            )}
                                          </td>
                                          <td className="border border-gray-300 p-2">{product.urun}</td>
                                          <td className="border border-gray-300 p-2 text-gray-600">{product.marka}</td>
                                          <td className="border border-gray-300 p-2 text-right">{product.birimFiyat.toFixed(2)} TL</td>
                                          <td className="border border-gray-300 p-2 text-right font-semibold">{product.miktar}</td>
                                          <td className="border border-gray-300 p-2 text-center">{product.olcu}</td>
                                          <td className="border border-gray-300 p-2 text-right font-semibold">{product.toplam.toFixed(2)} TL</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>

                                {/* özet Tablo ve Şartlar - Sadece Son Sayfa */}
                                {isLastPage && (
                                  <>
                                    <div className="flex justify-end mb-6">
                                      <div className="w-1/2 bg-gray-50 border border-gray-300 rounded-lg overflow-hidden">
                                        <table className="w-full text-[9pt]">
                                          <tbody>
                                            <tr className="border-b border-gray-300">
                                              <td className="p-3 font-semibold">Ara Toplam:</td>
                                              <td className="p-3 text-right font-bold">{selectedCompany.totals.subTotal.toFixed(2)} TL</td>
                                            </tr>
                                            {selectedCompany.settings.İskonto > 0 && (
                                              <tr className="border-b border-gray-300 bg-blue-50">
                                                <td className="p-3 font-semibold text-blue-700">İskonto (% {selectedCompany.settings.İskonto}):</td>
                                                <td className="p-3 text-right font-bold text-blue-700">- {selectedCompany.totals.İskontoAmount.toFixed(2)} TL</td>
                                              </tr>
                                            )}
                                            {selectedCompany.settings.İskonto > 0 && (
                                              <tr className="border-b border-gray-300">
                                                <td className="p-3 font-semibold">İskonto Sonrası:</td>
                                                <td className="p-3 text-right font-bold">{selectedCompany.totals.afterDiscount.toFixed(2)} TL</td>
                                              </tr>
                                            )}
                                            <tr className="border-b border-gray-300 bg-green-50">
                                              <td className="p-3 font-semibold text-green-700">KDV (% {selectedCompany.settings.kdvOrani}):</td>
                                              <td className="p-3 text-right font-bold text-green-700">+ {selectedCompany.totals.kdvAmount.toFixed(2)} TL</td>
                                            </tr>
                                            <tr className="bg-orange-600 text-white">
                                              <td className="p-4 font-bold text-lg">GENEL TOPLAM:</td>
                                              <td className="p-4 text-right font-bold text-xl">{selectedCompany.totals.grandTotal.toFixed(2)} TL</td>
                                            </tr>
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>

                                    <div className="mt-6 bg-gray-50 p-4 rounded-lg border border-gray-200">
                                      <h3 className="text-[10pt] font-bold text-gray-800 mb-3">Genel Şartlar ve Notlar</h3>
                                      <ul className="list-disc list-inside text-[9pt] leading-relaxed space-y-2">
                                        <li>Teklif geçerlilik süresi: 15 gündür.</li>
                                        <li>Fiyatlara KDV dahil edilmiştir.</li>
                                        <li>Teslimat süresi: Sipariş onayından sonra 7-10 iş günüdür.</li>
                                        <li>Ödeme şartları: Görüşülerek belirlenecektir.</li>
                                        <li>Fiyatlar hammadde ve döviz kurundaki değişikliklere bağlı olarak revize edilebilir.</li>
                                        <li>Malzemeler kaliteli ve orijinaldir, gerekli belge ve sertifikalarla birlikte teslim edilir.</li>
                                      </ul>
                                    </div>
                                  </>
                                )}

                              </div>

                              {/* Footer */}
                              <div className="absolute bottom-[10mm] left-[10mm] right-[10mm] border-t border-gray-300 pt-2">
                                <div className="text-[9pt] text-gray-600">
                                  <p className="font-bold text-gray-800 text-[9.5pt]">{COMPANY_LEGAL_NAME}</p>
                                  <p className="text-[9pt] mt-0.5 leading-tight">{COMPANY_ADDRESS_LINE_1}<br />{COMPANY_ADDRESS_LINE_2}</p>
                                  <p className="text-[9pt]">{COMPANY_CONTACT_LINE}</p>
                                  <p className="text-gray-400 mt-1 text-right">Sayfa {pageIndex + 1}/{totalPages}</p>
                                </div>
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </>
                  ) : (
                    <>
                  {/* SAYFA 1 - YG İŞLETME SORUMLULUĞU */}
                  <div className="bg-white max-w-[210mm] mx-auto min-h-[297mm] p-[10mm] pb-[35mm] shadow-2xl relative text-[10pt] leading-tight text-gray-800 pdf-page" style={{pageBreakAfter: 'always', pageBreakInside: 'avoid'}}>
                    <div>
                        {/* Header */}
                        <div className="flex justify-between items-start mb-6 border-b border-gray-300 pb-4">
                            {/* Top Left Logo */}
                            <div className="w-1/3 flex items-start">
                                <img src="/calisan/uygulama/fatura_logo.png" alt="VoltGuard Logo" className="h-24 max-w-[210px] object-contain" />
                            </div>
                            <div className="text-right">
                                <h1 className="text-lg font-bold text-gray-800 tracking-wide uppercase">FİYAT TEKLİFİ</h1>
                                <p className="text-[9pt] text-gray-500 mt-2">Referans No: <span data-vg-reference="">{selectedCompany.refNo}</span></p>
                                <p className="text-[9pt] text-gray-600 mt-0.5">{new Date().toLocaleDateString('tr-TR', {day: '2-digit', month: 'long', year: 'numeric'})}</p>
                            </div>
                        </div>

                        {/* Body Content */}
                        <p className="mb-4 text-[9.5pt] leading-tight">
                          <strong>Sayın {selectedCompany.contactName ? `${selectedCompany.contactName} - ` : ''}{selectedCompany.name} Yetkilisi,</strong>
                        </p>
                    <p className="mb-4 text-justify text-[9.5pt] leading-tight">
                      Tesisinize yönelik <strong>YG işletme Sorumluluğu</strong> hizmeti fiyat teklifi, talep ettiğiniz trafo kurulu gücü ve 
                      {params.year} referans hesap parametreleri kullanılarak, 
                      rekabetçi piyasa koşulları doğrultusunda tekliflerimizde uyguladığımız indirim oranıyla aşağıda sunulmuştur.
                    </p>

                    <h3 className="text-[10pt] font-bold text-gray-800 mt-5 mb-2 uppercase tracking-wide">1. Tesis Bilgileri ve Toplam Kurulu Güç</h3>
                    <p className="mb-2 text-[9.5pt] leading-tight">Tesisinizde bulunan transformatörlerin toplam kurulu gücü (Yüksek Gerilim Tesisleri) aşağıdaki gibidir:</p>
                    <div className="bg-gray-50 p-3 rounded border border-gray-200 mb-3">
                      <ul className="list-disc list-inside text-[9.5pt] leading-tight">
                        <li>Trafo Güçleri Dağılımı: <strong>{selectedCompany.powerStr} kVA</strong></li>
                        <li>Toplam Kurulu Güç: <strong>{selectedCompany.totalKVA || 0} kVA ({((selectedCompany.totalKVA || 0) / 1000).toFixed(2)} MVA)</strong></li>
                        <li>Tesis Tipi: <strong>{selectedCompany.type === 'direk' ? 'Direk Tipi Trafo Merkezi' : selectedCompany.type === 'uretim' ? 'Üretim Tesisi (Bina Kapsamı)' : 'Bina Tipi Trafo Merkezi'}</strong></li>
                        <li>Bölge/katsayı: <strong>{selectedCompany.region || 'Belirtilmemiş'} (x{(selectedCompany.regionCoeff || 1.0).toFixed(2)})</strong></li>
                        <li>Sektör: <strong>{selectedCompany.sector}</strong></li>
                      </ul>
                    </div>

                    <h3 className="text-[10pt] font-bold text-gray-800 mt-5 mb-2 uppercase tracking-wide">2. {params.year} referans parametrelerle aylık ücret hesabı</h3>
                    <p className="mb-2 text-[9.5pt] leading-tight">Girilen trafo gücü, tesis tipi ve referans parametreler üzerinden temel ücret hesaplanır. İki hücre kapsamı kullanılır; ek hücreler dahil değildir. Güncel kaynak ve kapsam teklif sorumlusu tarafından doğrulanmalıdır.</p>
                    
                    <table className="w-full text-[9pt] border-collapse border border-gray-300 mb-3">
                      <thead style={{backgroundColor: '#bbdefb'}}>
                        <tr>
                          <th className="border border-gray-300 p-2 text-left font-semibold text-[9pt]" style={{color: '#1565c0'}}>Kapasite Aralığı</th>
                          <th className="border border-gray-300 p-2 text-left font-semibold text-[9pt]" style={{color: '#1565c0'}}>Birim Fiyat</th>
                          <th className="border border-gray-300 p-2 text-right font-semibold text-[9pt]" style={{color: '#1565c0'}}>Tutar (TL)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* BiNA TİPi GüçSTERiMi */}
                        {(selectedCompany.type === 'uretim' || (selectedCompany.type !== 'direk' && selectedCompany.totalKVA >= 400)) && (
                          <>
                            <tr>
                              <td className="border border-gray-300 p-2">İlk 400 kVA (Sabit)</td>
                              <td className="border border-gray-300 p-2">{formatCurrency(params.baseFee)}</td>
                              <td className="border border-gray-300 p-2 text-right">{formatCurrency(params.baseFee)}</td>
                            </tr>
                            {selectedCompany.totalKVA > 400 && selectedCompany.totalKVA <= 5000 && (
                              <tr>
                                <td className="border border-gray-300 p-2">401 - {selectedCompany.totalKVA} kVA Arası (Artan)</td>
                                <td className="border border-gray-300 p-2">{params.rate1} TL/kVA</td>
                                <td className="border border-gray-300 p-2 text-right">
                                  {formatCurrency((selectedCompany.totalKVA - 400) * params.rate1)}
                                </td>
                              </tr>
                            )}
                            {selectedCompany.totalKVA > 5000 && (
                              <>
                              <tr>
                                <td className="border border-gray-300 p-2">401 - 5000 kVA Arası (Artan)</td>
                                <td className="border border-gray-300 p-2">{params.rate1} TL/kVA</td>
                                <td className="border border-gray-300 p-2 text-right">
                                  {formatCurrency(4600 * params.rate1)}
                                </td>
                              </tr>
                              <tr>
                                <td className="border border-gray-300 p-2">5000 kVA izeri (Artan)</td>
                                <td className="border border-gray-300 p-2">{params.rate2} TL/kVA</td>
                                <td className="border border-gray-300 p-2 text-right">
                                  {formatCurrency((selectedCompany.totalKVA - 5000) * params.rate2)}
                                </td>
                              </tr>
                              </>
                            )}
                          </>
                        )}

                        {/* DiREK TİPi VEYA <400 BiNA GüçSTERiMi */}
                        {(selectedCompany.type === 'direk' || (selectedCompany.type === 'bina' && selectedCompany.totalKVA < 400)) && (
                          <tr>
                              <td className="border border-gray-300 p-2">
                                  {selectedCompany.totalKVA <= 50 ? '0-50 kVA' : 
                                  selectedCompany.totalKVA <= 160 ? '51-160 kVA' : '161-400 kVA'} Sabit Bedel
                              </td>
                              <td className="border border-gray-300 p-2">Sabit</td>
                              <td className="border border-gray-300 p-2 text-right">
                                  {formatCurrency(selectedCompany.nominalFee / (selectedCompany.regionCoeff || 1))}
                              </td>
                          </tr>
                        )}
                        
                        {(selectedCompany.regionCoeff || params.regionCoeff) !== 1 && (
                          <tr style={{backgroundColor: '#d4f5d4'}}>
                            <td className="border border-gray-300 p-2" colSpan="2">Bölgesel Azaltma Katsayisi (x {(selectedCompany.regionCoeff || params.regionCoeff)})</td>
                            <td className="border border-gray-300 p-2 text-right font-bold" style={{color: '#2e7d32'}}>
                                {(selectedCompany.regionCoeff || params.regionCoeff) < 1 ? '-' : '+'}{formatCurrency(Math.abs(selectedCompany.nominalFee - (selectedCompany.nominalFee / (selectedCompany.regionCoeff || params.regionCoeff))))}
                            </td>
                          </tr>
                        )}

                        <tr className="font-bold" style={{backgroundColor: '#c8f0c8'}}>
                          <td className="border border-gray-300 p-2" colSpan="2">Referans hesap ücreti (KDV hariç)</td>
                          <td className="border border-gray-300 p-2 text-right">{formatCurrency(selectedCompany.nominalFee)}</td>
                        </tr>
                      </tbody>
                    </table>

                    {(() => {
                      const appliedDiscountRate = selectedCompany.appliedDiscountRate ?? params.discountRate ?? 0;
                      const hasDiscount = Number(selectedCompany.discountAmount || 0) > 0 && Number(appliedDiscountRate) > 0;

                      if (hasDiscount) {
                        return (
                          <>
                            <h3 className="text-[10pt] font-bold text-gray-800 mt-5 mb-2 uppercase tracking-wide">3. Uygulanan İskonto ve Nihai Teklif</h3>
                            <p className="mb-4 text-[9.5pt] leading-tight">Piyasa koşullarına uyum sağlamak amacıyla, işletmenize özel <strong>%{appliedDiscountRate}</strong> iskonto uygulanmıştır.</p>

                            <div className="rounded p-4 border-2 mb-1" style={{backgroundColor: '#c8e6c9', borderColor: '#81c784'}}>
                              <div className="flex justify-between items-center mb-1.5 text-[9.5pt]" style={{color: '#2e7d32'}}>
                                <span>Referans hesap ücreti:</span>
                                <span>{formatCurrency(selectedCompany.nominalFee)}</span>
                              </div>
                              <div className="flex justify-between items-center mb-3 text-[9.5pt]" style={{color: '#2e7d32'}}>
                                <span>İskonto Tutarı (%{appliedDiscountRate}):</span>
                                <span>- {formatCurrency(selectedCompany.discountAmount)}</span>
                              </div>
                              <div className="pt-3 flex justify-between items-center text-[11pt] font-bold" style={{borderTop: '1px solid #66bb6a', color: '#1b5e20'}}>
                                <span>AYLIK TEKLİF FİYATI:</span>
                                <span>{formatCurrency(selectedCompany.offerPrice)} + KDV</span>
                              </div>
                            </div>
                          </>
                        );
                      }

                      return (
                        <div className="rounded p-4 border-2 mb-1" style={{backgroundColor: '#c8e6c9', borderColor: '#81c784'}}>
                          <div className="flex justify-between items-center mb-1.5 text-[9.5pt]" style={{color: '#2e7d32'}}>
                            <span>Referans hesap ücreti:</span>
                            <span>{formatCurrency(selectedCompany.nominalFee)}</span>
                          </div>
                          <div className="pt-3 flex justify-between items-center text-[11pt] font-bold" style={{borderTop: '1px solid #66bb6a', color: '#1b5e20'}}>
                            <span>AYLIK TEKLİF FİYATI:</span>
                            <span>{formatCurrency(selectedCompany.offerPrice)} + KDV</span>
                          </div>
                        </div>
                      );
                    })()}

                    <div className="text-[9pt] text-gray-600 border-t pt-1 mt-0" style={{pageBreakInside: 'avoid'}}>
                      <h4 className="font-bold mb-1 text-[9.5pt]">Açıklamalar:</h4>
                      <ul className="list-disc list-inside space-y-0.5 text-[9pt] leading-tight">
                        <li>1. Bu teklif {params.year} yılı boyunca geçerli olmak üzere aylık periyotlarla hazırlanmıştır.</li>
                        <li>2. İşletme sorumluluğu hizmetinin SMM tarafından üstlenilmesi hâlinde YG tesisi en az ayda bir kez denetlenmelidir.</li>
                        <li>3. Enerji tüketiminin izlenmesi ve kompanzasyon tesisinin sağlıklı çalışıp çalışmadığının denetlenmesi bu hizmetin sorumluluk kapsamındadır.</li>
                        <li>4. Hizmet kapsamı ve sorumlu mühendisin belge/yetki bilgileri ilgili sözleşme ve güncel kaynaklar üzerinden doğrulanmalıdır.</li>
                        <li>5. İşveren olarak sizin yükümlülüğünüz, İşletme Sorumlusunun görevlerini yerine getirebilmesi için gerekli imalatları/hizmetleri sağlamak, talep edilen güvenlik malzemelerini almak ve uyarılarına riayet etmektir.</li>
                      </ul>
                    </div>
                    </div>
                    
                    {/* Footer - Sayfa 1 */}
                    <div className="absolute bottom-[10mm] left-[10mm] right-[10mm] border-t border-gray-300 pt-2">
                      <div className="text-[9pt] text-gray-600">
                        <p className="font-bold text-gray-800 text-[9.5pt]">{COMPANY_LEGAL_NAME}</p>
                        <p className="text-[9pt] mt-0.5 leading-tight">{COMPANY_ADDRESS_LINE_1}<br />{COMPANY_ADDRESS_LINE_2}</p>
                        <p className="text-[9pt]">{COMPANY_CONTACT_LINE}</p>
                        <p className="text-gray-400 mt-1 text-right">Sayfa 1/2</p>
                      </div>
                    </div>
                  </div>
                  
                  {/* SAYFA 2 - Ücretsiz Ek Hizmetler */}
                  <div className="bg-white max-w-[210mm] mx-auto min-h-[297mm] p-[10mm] pb-[35mm] shadow-2xl relative text-[9.5pt] leading-tight text-gray-800 page-break pdf-page" style={{pageBreakBefore: 'always', pageBreakInside: 'avoid', pageBreakAfter: 'auto'}}>
                    <div>
                      <div className="flex justify-between items-start mb-6 border-b border-gray-300 pb-4">
                            {/* Page 2 Header - Logo */}
                            <div className="w-1/3 flex items-start">
                              <img src="/calisan/uygulama/fatura_logo.png" alt="VoltGuard Logo" className="h-24 max-w-[210px] object-contain" />
                            </div>
                            <div className="text-right">
                            </div>
                      </div>

                      <h3 className="text-[10pt] font-bold text-gray-800 mb-2 uppercase tracking-wide border-b border-gray-300 pb-2">VoltGuard için Artı Değer Katacak Ücretsiz Hizmetler</h3>
                      <p className="mb-3 text-justify text-[9.5pt] leading-tight">
                        YG işletme sorumluluğu hizmeti kapsamında enerji tüketiminin izlenmesi ve kompanzasyon tesisinin sağlıklı çalışmasının denetlenmesi yer almamaktadır. Ancak, VoltGuard olarak satın alma birimi için maliyet kontrolü ve operasyonel güvenliği artıracak bu kritik alanlarda ücretsiz ek hizmetler sunabiliriz:
                      </p>

                      <div className="space-y-2 pb-8">
                          <div className="bg-gray-50 p-2.5 rounded border-l-2 border-gray-400">
                            <h4 className="font-bold text-gray-800 text-[9.5pt] mb-1">1. Arıza Önleme Odaklı Termal Görüntüleme</h4>
                            <p className="text-[9pt] text-gray-600 mb-0.5 leading-tight">
                              Üretim sürekliliğinin kritik olduğu büyük tesislerde, YG tesisatında (trafolar, OG hücreleri ve bara bağlantıları) meydana gelebilecek gevşek bağlantılar, aşırı ısınmaya ve ciddi arızalara neden olabilir.
                            </p>
                            <ul className="list-disc list-inside text-[9pt] text-gray-600 pl-2 space-y-0.5 leading-tight">
                              <li><strong>Ücretsiz Hizmet:</strong> Yıl içinde 12 kez (örneğin aylık periyotlarla) transformatörlerin ve yüksek gerilim hücrelerinin termal kamera ile kontrol edilmesi ve bu kontrollerin raporlanması.</li>
                              <li><strong>Artı Değer:</strong> Bu denetim, YG ekipmanlarında arıza potansiyeli olan aşırı ısınmaları ve kontak gevşekliklerini (seri ark) erkenden belirleyerek, üretim kesintisi kaynaklı büyük ekonomik kayıpların önüne geçer.</li>
                            </ul>
                          </div>

                          <div className="bg-gray-50 p-2.5 rounded border-l-2 border-gray-400">
                            <h4 className="font-bold text-gray-800 text-[9.5pt] mb-1">2. Reaktif Güç ve Enerji Kalitesi Takibi</h4>
                            <p className="text-[9pt] text-gray-600 mb-0.5 leading-tight">
                              Yüksek enerji tüketicisi olan sanayi firmaları için reaktif güç cezaları önemli bir maliyet kalemidir. EMO yönetmelikleri bu takibi kapsamaz.
                            </p>
                            <ul className="list-disc list-inside text-[9pt] text-gray-600 pl-2 space-y-0.5 leading-tight">
                              <li><strong>Ücretsiz Hizmet:</strong> Tesisin reaktif güç durumunun ve güç faktörünün (PF) uzaktan izlenmesi ve çeyreklik dönemlerde (her ayda bir) kompanzasyon sisteminin durumu ve olası ceza riskleri hakkında özet rapor sunulması.</li>
                              <li><strong>Artı Değer:</strong> Sayaç ve ekipman verileri incelenerek reaktif enerji ve güç faktörü takibinde iyileştirme gerektiren alanlar belirlenebilir. Değerlendirme gerçek ölçümlerle yapılır.</li>
                            </ul>
                          </div>

                          <div className="bg-gray-50 p-2.5 rounded border-l-2 border-gray-400">
                            <h4 className="font-bold text-gray-800 text-[9.5pt] mb-1">3. Enerji Verimliliği ve Sürdürülebilirlik Ön Analizi</h4>
                            <p className="text-[9pt] text-gray-600 mb-0.5 leading-tight">
                              Büyük firmalar GES ve enerji verimliliği (IE3/IE4 motorlar, VSD uygulamaları) konusunda aktif yatırımlar yapmaktadır.
                            </p>
                            <ul className="list-disc list-inside text-[9pt] text-gray-600 pl-2 space-y-0.5 leading-tight">
                              <li><strong>Ücretsiz Hizmet:</strong> Tesisinizdeki enerji yoğun alanların (fanlar, pompalar, motorlar) ön analizi ve Yüksek Verimli Motorlar (IE3/IE4/IE5) veya Değişken Hızlı Sürücü (VSD) kullanım potansiyelinin belirlenmesi için başlangıç danışmanlığı.</li>
                              <li><strong>Artı Değer:</strong> Enerji (kW) tüketimini ve karbon ayak izini azaltma hedeflerine ulaşılmasına yardımcı olurken, aynı zamanda motorların daha iyi güç faktörleri (PF) ile çalışmasını sağlayarak trafo üzerindeki reaktif yükü azaltır ve kapasiteyi daha etkin kullanır.</li>
                            </ul>
                          </div>

                          <div className="bg-gray-50 p-2.5 rounded border-l-2 border-gray-400">
                            <h4 className="font-bold text-gray-800 text-[9.5pt] mb-1">4. Yedek Malzeme ve Kritik Stok Listesi Danışmanlığı</h4>
                            <p className="text-[9pt] text-gray-600 mb-0.5 leading-tight">
                              Güçlü sanayide kritik arızalara hızlı müdahale esastır. Yedek parça yönetimi, arıza süresini (downtime) doğrudan etkiler.
                            </p>
                            <ul className="list-disc list-inside text-[9pt] text-gray-600 pl-2 space-y-0.5 leading-tight">
                              <li><strong>Ücretsiz Hizmet:</strong> Tesisinizdeki YG ve AG kritik ekipmanlar (trafo bushingleri, parafudur, sekonder koruma röleleri, OG hücre mekanizmaları vb.) için risk ve tedarik sürelerine dayalı acil durum yedek parça listesi ve önerilen minimum stok seviyelerinin belirlenmesi konusunda danışmanlık sağlanması.</li>
                              <li><strong>Artı Değer:</strong> Arıza durumunda gerekli yedek parçaların hızlı teminini sağlayarak arıza onarım süresini (MTTR) minimize eder ve işletme sürekliliğini destekler.</li>
                            </ul>
                          </div>
                      </div>
                      
                      <p className="mt-2 mb-16 text-[9pt] italic text-gray-600 border-t border-gray-300 pt-2 leading-tight">
                        Bu ücretsiz ek hizmetler, VoltGuard'ın sadece yasal zorunlulukları karşılayan bir tedarikçisi değil, aynı zamanda maliyet optimizasyonuna ve operasyonel güvenliğe odaklanan stratejik bir iş ortağı olduğunu göstermektedir.
                      </p>
                    </div>

                    {/* Footer - Page 2 - Always at bottom */}
                    <div className="absolute bottom-[10mm] left-[10mm] right-[10mm] border-t border-gray-300 pt-2" style={{pageBreakInside: 'avoid'}}>
                      <div className="text-[9pt] text-gray-600">
                        <p className="font-bold text-gray-800 text-[9.5pt]">{COMPANY_LEGAL_NAME}</p>
                        <p className="text-[9pt] mt-0.5 leading-tight">{COMPANY_ADDRESS_LINE_1}<br />{COMPANY_ADDRESS_LINE_2}</p>
                        <p className="text-[9pt]">{COMPANY_CONTACT_LINE}</p>
                        <p className="text-gray-400 mt-1 text-right">Sayfa 2/2</p>
                      </div>
                    </div>
                  </div>
                  </>
                  )}
              </>}</div>

            </div>

          </div>
        )}

      </div>

      {/* Hazir Paket Modal */}
      {showHazirPaketModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Sparkles className="w-6 h-6 text-yellow-300"/>
                <h2 className="text-xl font-bold text-white">Hazir Paket Seimi - Hızlı Teklif</h2>
              </div>
              <button
                onClick={() => {
                  setShowHazirPaketModal(false);
                  setSelectedHazirPaket(null);
                }}
                className="text-white hover:bg-white hover:bg-opacity-20 rounded-lg p-2 transition"
              >
                <X className="w-6 h-6"/>
              </button>
            </div>

            {/* Kar marjı Ayari */}
            <div className="px-6 py-4 bg-gradient-to-r from-green-50 to-emerald-50 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-green-600"/>
                  <label className="text-sm font-semibold text-gray-700">Kar marjı (%)</label>
                </div>
                <div className="flex items-center gap-4">
                  <input 
                    type="range"
                    min="10"
                    max="80"
                    step="5"
                    value={paketKarMarji}
                    onChange={(e) => setPaketKarMarji(parseInt(e.target.value))}
                    className="w-48"
                  />
                  <input 
                    type="number"
                    min="0"
                    max="100"
                    value={paketKarMarji}
                    onChange={(e) => setPaketKarMarji(parseInt(e.target.value) || 30)}
                    className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-center font-bold text-green-700"
                  />
                  <span className="text-sm text-gray-600">Ali fiyatlarına %{paketKarMarji} kar eklenir</span>
                </div>
              </div>
            </div>

            {/* Paket Listesi */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {HazirPaketler.paketler.map((paket) => (
                  <div
                    key={paket.id}
                    onClick={() => setSelectedHazirPaket(paket.id)}
                    className={`cursor-pointer rounded-lg border-2 p-4 transition transform hover:scale-105 ${
                      selectedHazirPaket === paket.id
                        ? 'border-blue-500 bg-blue-50 shadow-lg'
                        : 'border-gray-200 bg-white hover:border-blue-300'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-bold text-gray-800 text-sm">{paket.ad}</h3>
                      {selectedHazirPaket === paket.id && (
                        <CheckCircle className="w-5 h-5 text-blue-600"/>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mb-2">{paket.kategori}</p>
                    <p className="text-xs text-gray-600 mb-3 line-clamp-2">{paket.aciklama}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <FileSpreadsheet className="w-4 h-4"/>
                      <span className="font-semibold">{paket.urunler.length} kalem ürün</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* seçili Paket Detaylari */}
            {selectedHazirPaket && (
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                <h3 className="text-sm font-bold text-gray-800 mb-3">
                  ?? {HazirPaketler.paketler.find(p => p.id === selectedHazirPaket)?.ad} - ürün Listesi
                </h3>
                <div className="max-h-48 overflow-y-auto bg-white rounded-lg border border-gray-200 p-3">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left">ürün</th>
                        <th className="px-2 py-1 text-center">Miktar</th>
                        <th className="px-2 py-1 text-left">Açıklama</th>
                      </tr>
                    </thead>
                    <tbody>
                      {HazirPaketler.paketler
                        .find(p => p.id === selectedHazirPaket)
                        ?.urunler.map((urun, idx) => (
                          <tr key={idx} className="border-b border-gray-100">
                            <td className="px-2 py-2 font-medium">{urun.urun}</td>
                            <td className="px-2 py-2 text-center">{urun.miktar} {urun.birim}</td>
                            <td className="px-2 py-2 text-gray-600">{urun.aciklama}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="px-6 py-4 bg-gray-100 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-600">
                <span className="font-semibold text-gray-800">{HazirPaketler.paketler.length}</span> farkli hazir paket mevcut
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowHazirPaketModal(false);
                    setSelectedHazirPaket(null);
                  }}
                  className="px-6 py-2 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-200 transition"
                >
                  iptal
                </button>
                <button
                  onClick={addHazirPaketToKesif}
                  disabled={!selectedHazirPaket}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition flex items-center gap-2"
                >
                  <Plus className="w-5 h-5"/>
                  Paketi Listeye Ekle
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Keşif Sihirbazı Modal */}
      

      {/* Teklif Mektubu Modal */}
      {isEmailGeneratorOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full flex flex-col max-h-[90vh] overflow-hidden animate-fadeIn">
            <div className="bg-gradient-to-r from-indigo-600 to-blue-600 p-6 flex justify-between items-center text-white shrink-0">
              <div className="flex items-center gap-3">
                <Mail className="w-8 h-8"/>
                <div>
                  <h3 className="font-bold text-xl">📜 Profesyonel Teklif Mektubu</h3>
                  <p className="text-sm text-indigo-100">Teklifteki mevcut bilgilerden düzenlenebilir taslak</p>
                </div>
              </div>
              <button 
                onClick={() => setIsEmailGeneratorOpen(false)}
                className="hover:bg-white/20 p-2 rounded-lg transition"
              >
                <X className="w-6 h-6"/>
              </button>
            </div>
            
            <div className="p-8 flex-1 overflow-y-auto">
              {aiLoading ? (
                <div className="h-96 flex flex-col items-center justify-center text-indigo-600">
                  <div className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-6"/>
                  <p className="font-bold text-lg">Profesyonel teklifiniz hazirlaniyor...</p>
                  <p className="text-sm text-gray-500 mt-2">Bu birkai saniye sirebilir</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-gradient-to-r from-indigo-50 to-blue-50 p-4 rounded-lg border border-indigo-200">
                    <p className="text-sm text-gray-700 flex items-start gap-2">
                      <Lightbulb className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5"/>
                      <span>
                        <span className="font-bold text-indigo-700">Duzenleme ipucu:</span> Metni istediginiz gibi duzenleyebilir, 
                        ardindan kopyalayip e-posta programiniza yapistirabilirsiniz.
                      </span>
                    </p>
                  </div>
                  
                  <textarea 
                    className="w-full h-[500px] p-6 border-2 border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:ring-4 focus:ring-indigo-200 focus:border-indigo-500 outline-none font-mono text-sm leading-relaxed text-gray-800 resize-none"
                    value={generatedEmail}
                    onChange={(e) => setGeneratedEmail(e.target.value)}
                    placeholder="Teklif mektubu burada görünecek..."
                  />
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-200 bg-gray-50 flex justify-between items-center gap-4 shrink-0">
              <div className="text-sm text-gray-600">
                <span className="font-semibold text-gray-800">{kesifProducts.length}</span> ürün i 
                <span className="font-semibold text-indigo-600 ml-1">{calculateKesifTotals().grandTotal.toFixed(2)} TL</span>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => setIsEmailGeneratorOpen(false)}
                  className="px-6 py-2 border-2 border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-100 transition"
                >
                  Kapat
                </button>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(generatedEmail);
                    alert("? Teklif mektubu panoya kopyalandı!");
                  }}
                  disabled={!generatedEmail || aiLoading}
                  className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white rounded-lg font-semibold flex items-center gap-2 transition shadow-lg"
                >
                  <Copy className="w-5 h-5"/>
                  Metni Kopyala
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default App;

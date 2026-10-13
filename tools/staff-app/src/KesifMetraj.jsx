import { privateStorage as localStorage } from './privateStorage';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Calculator, ShoppingCart, Trash2, Copy, FileText, Plus, X, Sparkles, MessageSquare, Send, Loader2, Mail, Download, Building2, Eye, ExternalLink, Save, Clock, Cable, Percent, Banknote, Edit3, CheckCircle, User } from 'lucide-react';
import { createReportPDF, exportHTMLReport, writeReportParagraph, reportFileName, reportMoney, reportNumber } from './pdfReport';
import { sanitizeReportHTML, pasteReportHTML, reportHTMLWithReference } from './safeReportHTML.mjs';
import { normalizeKesifSnapshot, newDraftReference } from './proposalSnapshots.mjs';
import { historicalInvoice1 as FaturaData, historicalInvoice2 as FaturaData2, cablePrices as KabloFiyatData, packages as HazirPaketler } from './catalogData';
import { normalizeHistoricalInvoice } from './historicalCatalog.mjs';
import { supabase } from './supabaseClient';
import { loadCompanyDocuments, saveCompanyDocument, deleteCompanyDocument } from './companyDocuments';
import { parseDecimal, localISODate, mergeCartItems, saleUnitPrice, saleLineTotal, roundMoney } from './operations.mjs';

const KesifMetraj = ({ initialSnapshot, onSaveSnapshot, onCustomerUpdate }) => {
  // Fatura verilerini birleştir ve kategorize et
  const initialData = useMemo(() => {
    const products = [];
    
    // Hizmet/İşçilik kalemlerini filtrele (sadece fiziksel malzemeleri al)
    const isServiceItem = (name) => {
      const n = name.toUpperCase();
      return n.includes('İŞÇİLİK') || 
             n.includes('MONTAJ') || 
             n.includes('DEVREYE ALMA') ||
             n.includes('PERİYODİK KONTROL') ||
             n.includes('KALİBRASYON') ||
             n.includes('ÖLÇÜM') ||
             n.includes('TEST') ||
             n.includes('DENETİM') ||
             n.includes('ULAŞIM') ||
             n.includes('SARF MALZEME') ||
             n.match(/^\d+\s*(ARALIK|OCAK|ŞUBAT|MART|NİSAN|MAYIS|HAZİRAN|TEMMUZ|AĞUSTOS|EYLÜL|EKİM|KASIM)/);
    };
    
    // Kategori belirleme fonksiyonu
    const categorize = (name) => {
      const n = name.toUpperCase();
      if (n.includes('NYY') || n.includes('YVV')) return 'Kablo - NYY';
      if (n.includes('NYM') || n.includes('NVV')) return 'Kablo - NYM';
      if (n.includes('TTR') || n.includes('H05VV')) return 'Kablo - TTR';
      if (n.includes('NYAF') || n.includes('H05V-K')) return 'Kablo - NYAF';
      if (n.includes('NYA') || n.includes('H05V-U')) return 'Kablo - NYA';
      if (n.includes('AER')) return 'Kablo - AER';
      if (n.includes('YAVV') || n.includes('NAYY')) return 'Kablo - YAVV';
      if (n.includes('NHXMH')) return 'Kablo - NHXMH';
      if (n.includes('KABLO') || n.includes('KORDON')) return 'Kablo - Diğer';
      if (n.includes('OTOMAT') || n.includes('SİGORTA') || n.includes('KAÇAK AKIM') || n.includes('RCD') || n.includes('ŞALTER')) return 'Otomat ve Sigorta';
      if (n.includes('PRİZ') || n.includes('ANAHTAR') || n.includes('SOKET')) return 'Priz ve Anahtar';
      if (n.includes('KUTU') || n.includes('PANO')) return 'Kutu ve Pano';
      if (n.includes('ARMATÜR') || n.includes('LED') || n.includes('LAMBA') || n.includes('SPOT') || n.includes('PROJEKTÖR') || n.includes('TRAFO')) return 'Aydınlatma';
      if (n.includes('KANAL') || n.includes('BORU') || n.includes('HORTUM') || n.includes('TAVA') || n.includes('KONSOL')) return 'Kablo Kanalı';
      if (n.includes('KLEMENS') || n.includes('PABUÇ') || n.includes('BAĞLANTI') || n.includes('KONNEKTÖR')) return 'Bağlantı Elemanları';
      if (n.includes('TOPRAKLAMA') || n.includes('PARATONER')) return 'Topraklama';
      if (n.includes('CIVATA') || n.includes('SOMUN') || n.includes('PUL') || n.includes('ZİNCİR') || n.includes('KELEPÇE')) return 'Montaj Malzemeleri';
      if (n.includes('REAKTÖR') || n.includes('REAKTIF') || n.includes('KVAR') || n.includes('SÜREÇ')) return 'Güç Elektroniği';
      return 'Diğer Malzemeler';
    };
    
    const records=[...normalizeHistoricalInvoice(FaturaData,'Fatura1'),...normalizeHistoricalInvoice(FaturaData2,'Fatura2')];
    records.forEach(item=>{if(item.urun && item.birimFiyat>0 && !isServiceItem(item.urun))products.push({category:categorize(item.urun),name:item.urun,price:item.birimFiyat,unit:item.olcu,kdvOrani:item.kdvOrani ?? 20,priceStatus:item.priceStatus,source:item.kaynak});});

    // Unique ürünleri al (isim bazlı)
    const uniqueMap = new Map();
    products.forEach(p => {
      const key = p.name.toUpperCase().trim();
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, p);
      }
    });
    
    return Array.from(uniqueMap.values());
  }, []);

  const [discount, setDiscount] = useState(0);
  const [profit, setProfit] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("Tümü");
  
  // AI States
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [isTeklifModalOpen, setIsTeklifModalOpen] = useState(false);
  const [isPdfPreviewOpen, setIsPdfPreviewOpen] = useState(false);
  const [isScenarioModalOpen, setIsScenarioModalOpen] = useState(false);
  const [isSavedTeklifModalOpen, setIsSavedTeklifModalOpen] = useState(false);
  const [isMusteriModalOpen, setIsMusteriModalOpen] = useState(false);
  const [isProductEditModalOpen, setIsProductEditModalOpen] = useState(false);
  const [isNewProductModalOpen, setIsNewProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [customProducts, setCustomProducts] = useState([]);
  const [savedTeklifler, setSavedTeklifler] = useState([]);
  const savedTeklifRef = useRef(null);
  const savedRecordsBusy = useRef(false);
  const [recordsError, setRecordsError] = useState('');
  const [productsError, setProductsError] = useState('');
  const [legacyQuotesAvailable, setLegacyQuotesAvailable] = useState(() => Boolean(localStorage.getItem('kesifTeklifler')));
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [generatedEmail, setGeneratedEmail] = useState("");
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [companyLogo, setCompanyLogo] = useState('/calisan/uygulama/fatura_logo.png');
  const [editorMode, setEditorMode] = useState(false);
  const [editableContent, setEditableContent] = useState('');
  const loadedFormState = useRef(null);
  const applyingSnapshot = useRef(false);
  
  // Teklif Form States
  const [teklifForm, setTeklifForm] = useState({
    musteriAdi: '',
    firmaAdi: '',
    yetkili: '',
    telefon: '',
    email: '',
    adres: '',
    projeAdi: '',
    aciklama: '• Ödeme Şekli: %50 Peşin, %50 İş Bitiminde\n• Teslimat: Ödeme sonrası 5-7 iş günü içinde\n• Garanti: Tüm malzemeler 2 yıl garantilidir\n• Fiyatlar KDV dahildir\n• Teklif 30 gün geçerlidir',
    kdvOrani: 20,
    teklifNo: newDraftReference(),
    tarih: new Date().toLocaleDateString('tr-TR'),
    gecerlilikSuresi: '30 gün'
  });

  useEffect(() => {
    if (!initialSnapshot) return;
    try {
      const snapshot = normalizeKesifSnapshot({componentSnapshot:initialSnapshot}, initialSnapshot.teklifForm?.teklifNo);
      applyingSnapshot.current=true;
      loadedFormState.current = {form:snapshot.teklifForm,cart:snapshot.cart,discount:snapshot.discount,profit:snapshot.profit};
      setTeklifForm(snapshot.teklifForm);setCart(snapshot.cart);setDiscount(snapshot.discount);setProfit(snapshot.profit);
      setCompanyLogo(snapshot.logo || '/calisan/uygulama/fatura_logo.png');setEditorMode(false);
      setEditableContent(reportHTMLWithReference(snapshot.reportHtml || '',snapshot.teklifForm.teklifNo));
      savedTeklifRef.current = null;setIsMusteriModalOpen(false);setIsPdfPreviewOpen(false);
    } catch(error) { alert('Keşif kaydı açılamadı: '+error.message); }
  },[initialSnapshot]);

  useEffect(() => {
    const loaded=loadedFormState.current;
    if(applyingSnapshot.current){if(loaded?.form===teklifForm && loaded?.cart===cart)applyingSnapshot.current=false;return;}
    if(loaded?.form===teklifForm && loaded?.cart===cart && loaded?.discount===discount && loaded?.profit===profit)return;
    setEditableContent('');setEditorMode(false);
  },[teklifForm,cart,discount,profit]);

  // Örnek Malzeme Şablonları
  const scenarios = [
    {
      id: 1,
      name: "Trafo Değişimi (100 kVA)",
      icon: "⚡",
      description: "100 kVA transformatör değişimi için gerekli malzemeler",
      items: [
        { search: "NYY 4x25", quantity: 50 },
        { search: "NYY 4x16", quantity: 30 },
        { search: "Otomat", quantity: 5 },
        { search: "Topraklama", quantity: 5 },
        { search: "Bağlantı", quantity: 20 }
      ]
    },
    {
      id: 2,
      name: "Trafo Değişimi (250 kVA)",
      icon: "⚡",
      description: "250 kVA transformatör değişimi ve bağlantı malzemeleri",
      items: [
        { search: "NYY 4x50", quantity: 80 },
        { search: "NYY 4x35", quantity: 50 },
        { search: "Otomat", quantity: 6 },
        { search: "Topraklama", quantity: 8 },
        { search: "Bağlantı", quantity: 30 }
      ]
    },
    {
      id: 3,
      name: "Trafo Yükseltimi (100→250 kVA)",
      icon: "📈",
      description: "Mevcut trafo yükseltme ve altyapı güçlendirme",
      items: [
        { search: "NYY 4x70", quantity: 100 },
        { search: "NYY 4x50", quantity: 60 },
        { search: "Otomat", quantity: 5 },
        { search: "Pano", quantity: 1 },
        { search: "Topraklama", quantity: 10 }
      ]
    },
    {
      id: 4,
      name: "Ana Pano Değişimi",
      icon: "🔧",
      description: "Tam ana dağıtım panosu yenişleme projesi",
      items: [
        { search: "Pano", quantity: 2 },
        { search: "Otomat", quantity: 18 },
        { search: "NYY 4x35", quantity: 100 },
        { search: "NYY 4x25", quantity: 150 },
        { search: "Bağlantı", quantity: 50 }
      ]
    },
    {
      id: 5,
      name: "Kompanzasyon Panosu Revizyonu",
      icon: "⚙️",
      description: "Reaktif güç kompanzasyonu ve pano revizyonu",
      items: [
        { search: "Kondansatör", quantity: 6 },
        { search: "Otomat", quantity: 4 },
        { search: "NYY 4x16", quantity: 80 },
        { search: "Kontaktör", quantity: 6 },
        { search: "Pano", quantity: 1 }
      ]
    },
    {
      id: 6,
      name: "Dağıtım Panosu (10 Kolon)",
      icon: "📊",
      description: "10 kolonlu alt dağıtım panosu kurulumu",
      items: [
        { search: "Pano", quantity: 10 },
        { search: "Otomat", quantity: 65 },
        { search: "NYM 3x2.5", quantity: 200 },
        { search: "Topraklama", quantity: 10 }
      ]
    },
    {
      id: 7,
      name: "Fabrika Aydınlatma Revizyonu",
      icon: "💡",
      description: "Endüstriyel alan LED aydınlatma yenişleme",
      items: [
        { search: "LED", quantity: 50 },
        { search: "NYM 3x1.5", quantity: 500 },
        { search: "Anahtar", quantity: 20 },
        { search: "Kutu", quantity: 30 },
        { search: "Kablo Kanalı", quantity: 100 }
      ]
    },
    {
      id: 8,
      name: "Ofis Aydınlatma Projesi",
      icon: "🏢",
      description: "Modern ofis alanı için LED aydınlatma",
      items: [
        { search: "LED Panel", quantity: 40 },
        { search: "LED Downlight", quantity: 30 },
        { search: "NYM 3x1.5", quantity: 300 },
        { search: "Dimmer", quantity: 10 },
        { search: "Anahtar", quantity: 50 }
      ]
    },
    {
      id: 9,
      name: "Topraklama Sistemi Yenişleme",
      icon: "🌍",
      description: "Komple topraklama sistemi kurulumu",
      items: [
        { search: "Topraklama Çubuğu", quantity: 15 },
        { search: "Bakır Kablo", quantity: 100 },
        { search: "Topraklama", quantity: 10 },
        { search: "Bağlantı", quantity: 50 },
        { search: "Test", quantity: 5 }
      ]
    },
    {
      id: 10,
      name: "Kablo Kanalı Altyapısı",
      icon: "📦",
      description: "Komple kablo taşıma sistemi kurulumu",
      items: [
        { search: "Kablo Kanalı 100", quantity: 100 },
        { search: "Kablo Kanalı 80", quantity: 150 },
        { search: "Dirsek", quantity: 50 },
        { search: "T Bağlantı", quantity: 30 },
        { search: "Montaj", quantity: 200 }
      ]
    },
    {
      id: 11,
      name: "Acil Aydınlatma Sistemi",
      icon: "🚨",
      description: "Yangın ve acil durum aydınlatması",
      items: [
        { search: "Acil Aydınlatma", quantity: 30 },
        { search: "Exit", quantity: 15 },
        { search: "NYM 3x1.5", quantity: 200 },
        { search: "Akü", quantity: 10 },
        { search: "Test", quantity: 20 }
      ]
    },
    {
      id: 12,
      name: "Jeneratör Entegrasyonu",
      icon: "🔌",
      description: "Yedek güç kaynağı bağlantısı ve otomasyonu",
      items: [
        { search: "NYY 4x95", quantity: 50 },
        { search: "Otomat", quantity: 4 },
        { search: "Kontaktör", quantity: 2 },
        { search: "Şalter", quantity: 1 },
        { search: "Pano", quantity: 1 }
      ]
    },
    {
      id: 13,
      name: "UPS Odası Kurulumu",
      icon: "🔋",
      description: "Kesintisiz güç kaynağı odası elektrik altyapısı",
      items: [
        { search: "NYY 4x70", quantity: 60 },
        { search: "NYY 4x35", quantity: 80 },
        { search: "Otomat", quantity: 6 },
        { search: "Topraklama", quantity: 8 },
        { search: "Pano", quantity: 2 }
      ]
    },
    {
      id: 14,
      name: "Priz Hattı Yenişleme (Ofis)",
      icon: "🔌",
      description: "Ofis alanı priz ve data hattı yenişleme",
      items: [
        { search: "Priz Topraklı", quantity: 80 },
        { search: "NYM 3x2.5", quantity: 300 },
        { search: "Kutu", quantity: 80 },
        { search: "Otomat", quantity: 40 },
        { search: "Kablo Kanalı", quantity: 100 }
      ]
    },
    {
      id: 15,
      name: "Motor Kontrol Panosu",
      icon: "⚙️",
      description: "Endüstriyel motor kontrol ve koruma sistemi",
      items: [
        { search: "Kontaktör", quantity: 5 },
        { search: "Termik", quantity: 5 },
        { search: "NYY 4x16", quantity: 100 },
        { search: "Buton", quantity: 10 },
        { search: "Pano", quantity: 1 }
      ]
    },
    {
      id: 16,
      name: "Şantiye Elektrik Sistemi",
      icon: "🏗️",
      description: "İnşaat sahası geçici elektrik altyapısı",
      items: [
        { search: "NYY 4x25", quantity: 200 },
        { search: "Otomat", quantity: 15 },
        { search: "Priz", quantity: 30 },
        { search: "Kutu", quantity: 20 },
        { search: "Kablo Kanalı", quantity: 50 }
      ]
    },
    {
      id: 17,
      name: "Saha Aydınlatması (Dış Mekan)",
      icon: "🌙",
      description: "Park ve bahçe LED projektör aydınlatma",
      items: [
        { search: "Projektör", quantity: 20 },
        { search: "NYY 3x2.5", quantity: 250 },
        { search: "Direk", quantity: 10 },
        { search: "Fotoselli Anahtar", quantity: 5 },
        { search: "Topraklama", quantity: 10 }
      ]
    },
    {
      id: 18,
      name: "Soğuk Hava Deposu Elektrikleri",
      icon: "❄️",
      description: "Soğuk oda ve klimatik sistem elektrik tesisatı",
      items: [
        { search: "NYY 4x16", quantity: 120 },
        { search: "Otomat", quantity: 8 },
        { search: "Kontaktör", quantity: 6 },
        { search: "Termik", quantity: 6 },
        { search: "Pano", quantity: 1 }
      ]
    },
    {
      id: 19,
      name: "Asansör Elektrik Tesisatı",
      icon: "🛗",
      description: "Asansör besleme ve kontrol sistemi",
      items: [
        { search: "NYY 4x35", quantity: 80 },
        { search: "NYM 5x1.5", quantity: 100 },
        { search: "Otomat", quantity: 5 },
        { search: "Pano", quantity: 1 },
        { search: "Topraklama", quantity: 5 }
      ]
    },
    {
      id: 20,
      name: "Havuz Elektrik Sistemi",
      icon: "🏊",
      description: "Havuz pompa, filtrasyon ve aydınlatma",
      items: [
        { search: "NYY 4x16", quantity: 100 },
        { search: "Su Altı LED", quantity: 12 },
        { search: "Otomat", quantity: 6 },
        { search: "Pano Su Geçirmez", quantity: 1 },
        { search: "Topraklama", quantity: 8 }
      ]
    },
    {
      id: 21,
      name: "Güvenlik Kamera Altyapısı",
      icon: "📹",
      description: "CCTV ve güvenlik sistemi kablolama",
      items: [
        { search: "Kablo Veri", quantity: 500 },
        { search: "NYM 2x1.5", quantity: 300 },
        { search: "Kutu Bağlantı", quantity: 25 },
        { search: "Kablo Kanalı", quantity: 150 },
        { search: "Priz", quantity: 20 }
      ]
    },
    {
      id: 22,
      name: "Depo Aydınlatma ve Priz Hattı",
      icon: "📦",
      description: "Endüstriyel depo elektrik tesisatı",
      items: [
        { search: "LED Armatür", quantity: 60 },
        { search: "NYM 3x2.5", quantity: 400 },
        { search: "Priz Endüstriyel", quantity: 40 },
        { search: "Otomat", quantity: 20 },
        { search: "Kablo Kanalı", quantity: 200 }
      ]
    },
    {
      id: 23,
      name: "Klima Santrali Besleme",
      icon: "🌡️",
      description: "Merkezi klima sistemi elektrik altyapısı",
      items: [
        { search: "NYY 4x25", quantity: 150 },
        { search: "Otomat", quantity: 10 },
        { search: "Kontaktör", quantity: 8 },
        { search: "Pano", quantity: 2 },
        { search: "Termik", quantity: 8 }
      ]
    },
    {
      id: 24,
      name: "Yangın Alarm Sistemi",
      icon: "🚨",
      description: "Yangın algılama ve alarm tesisatı",
      items: [
        { search: "Yangın Kablosu", quantity: 300 },
        { search: "Dedektör", quantity: 30 },
        { search: "Siren", quantity: 10 },
        { search: "Buton Yangın", quantity: 15 },
        { search: "Santral", quantity: 1 }
      ]
    },
    {
      id: 25,
      name: "Atölye Elektrik Revizyonu",
      icon: "🔨",
      description: "Küçük sanayi atölyesi komple elektrik yenişleme",
      items: [
        { search: "Pano", quantity: 3 },
        { search: "Otomat", quantity: 25 },
        { search: "NYY 4x16", quantity: 200 },
        { search: "Priz Endüstriyel", quantity: 50 },
        { search: "LED Armatür", quantity: 40 }
      ]
    }
  ];

  const categories = useMemo(() => ["Tümü", ...new Set(initialData.map(d => d.category))], []);

  // Supabase'den özel ürünleri yükle
  useEffect(() => {
    loadProductsFromSupabase();
  }, []);

  const loadProductsFromSupabase = async () => {
    setProductsError('');
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('updated_at', { ascending: true });

      if (error) throw error;

      if (data) {
        // Supabase formatını custom products formatına çevir
        const customProds = data.map(item => ({
          id: item.id,
          name: item.name,
          category: item.category,
          price: parseDecimal(item.price),
          originalName: item.original_name || item.name,
          isNew: item.is_new || false,
          isActive: item.is_active !== false
        }));
        setCustomProducts(customProds);
      }
    } catch (error) {
      console.error('Şirket ürünleri yüklenemedi:', error);
      setProductsError(error.message || 'Özel ürünler sunucudan yüklenemedi.');
      // Hata durumunda localStorage'dan yükle
      const saved = localStorage.getItem('customProducts');
      if (saved) {
        try {
          setCustomProducts(JSON.parse(saved));
        } catch (e) {
          console.error('localStorage ürünler yüklenemedi:', e);
        }
      }
    }
  };

  // Tüm ürünleri birleştir (orijinal + özel)
  const allProducts = useMemo(() => {
    let products = [...initialData];
    
    // Özel ürünleri ekle
    customProducts.forEach(custom => {
      if (custom.isActive === false) {
        products = products.filter(product => product.name.toLocaleUpperCase('tr-TR').trim() !== (custom.originalName || custom.name).toLocaleUpperCase('tr-TR').trim());
        return;
      }
      if (custom.isNew) {
        // Yeni eklenen ürün
        products.push(custom);
      } else {
        // Güncellenmiş ürün - orijinali bul ve değiştir
        const index = products.findIndex(p => 
          p.name.toUpperCase().trim() === custom.originalName.toUpperCase().trim()
        );
        if (index !== -1) {
          products[index] = { ...custom };
        }
      }
    });
    
    return products;
  }, [initialData, customProducts]);

  // Ürün ekleme/güncelleme fonksiyonu - Supabase
  const saveProduct = async (productData) => {
    try {
      if (!productData.name?.trim() || !productData.category?.trim() || !(parseDecimal(productData.price, null) > 0)) throw new Error('Ürün adı, kategori ve sıfırdan büyük fiyat zorunludur.');
      const productToSave = {
        name: productData.name,
        category: productData.category,
        price: parseDecimal(productData.price),
        original_name: productData.originalName || productData.name,
        is_new: productData.isNew || false,
        is_active: true,
        updated_at: new Date().toISOString()
      };

      let result;
      
      if (productData.id) {
        // Mevcut ürünü güncelle
        result = await supabase
          .from('products')
          .update(productToSave)
          .eq('id', productData.id)
          .select()
          .single();
      } else {
        // Yeni ürün ekle
        result = await supabase
          .from('products')
          .insert([productToSave])
          .select()
          .single();
      }

      if (result.error) throw result.error;

      // Local state'i güncelle
      await loadProductsFromSupabase();
      
      // localStorage'a da yedek kaydet
      const updated = [...customProducts];
      if (productData.isNew) {
        updated.push({
          ...productData,
          id: result.data.id,
          isNew: true
        });
      } else {
        const existingIndex = updated.findIndex(p => p.id === productData.id);
        if (existingIndex !== -1) {
          updated[existingIndex] = { ...productData, id: result.data.id };
        } else {
          updated.push({ ...productData, id: result.data.id });
        }
      }
      localStorage.setItem('customProducts', JSON.stringify(updated));

      alert('Ürün başarıyla kaydedildi! ✅');
      return true;
    } catch (error) {
      console.error('Ürün kaydedişlemedi:', error);
      alert('Ürün kaydedilirken hata oluştu: ' + error.message);
      return false;
    }
  };

  // Ürün silme fonksiyonu - Supabase (Soft Delete)
  const deleteProduct = async (productId, productName) => {
    try {
      // Önce ID ile bul
      const product = customProducts.find(p => p.id === productId || p.name === productName);
      
      if (product && product.id) {
        // Supabase'den soft delete
        const { error } = await supabase
          .from('products')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', product.id);

        if (error) throw error;
      } else {
        const original = initialData.find(item => item.name === productName);
        if (!original) throw new Error('Silinecek ürün bulunamadı.');
        const { error } = await supabase.from('products').insert([{name: original.name,category:original.category,price:parseDecimal(original.price),original_name:original.name,is_new:false,is_active:false}]);
        if (error) throw error;
      }

      // Local state'i güncelle
      await loadProductsFromSupabase();
      
      // localStorage'dan da sil
      const updated = customProducts.filter(p => p.id !== productId && p.name !== productName);
      localStorage.removeItem('customProducts');

      alert('Ürün başarıyla silindi! 🗑️');
    } catch (error) {
      console.error('Ürün silinemedi:', error);
      alert('Ürün silinirken hata oluştu: ' + error.message);
    }
  };

  const filteredData = useMemo(() => {
    return allProducts.filter(item => {
      const matchesSearch = 
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        item.category.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === "Tümü" || item.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [allProducts, searchTerm, selectedCategory]);

  // The displayed unit selling price includes both the discount and margin.
  const calculateDiscountedPrice = (price) => saleUnitPrice({ price }, discount, profit);

  const addToCart = (item, qty = 1) => {
    try { setCart(previous => mergeCartItems(previous, [{ ...item, quantity: qty }])); }
    catch (error) { alert(error.message); }
  };

  const updateQuantity = (index, newQty) => {
    const quantity = parseDecimal(newQty, null);
    if (!(quantity > 0)) return;
    setCart(previous => previous.map((item, i) => i === index ? { ...item, quantity } : item));
  };

  const updateItemDescription = (index, description) => {
    const newCart = [...cart];
    newCart[index].description = description;
    setCart(newCart);
  };

  const updateItemKdv = (index, kdv) => {
    const newCart = [...cart];
    const rate = parseDecimal(kdv, null);
    if (rate === null || rate < 0 || rate > 100) return;
    newCart[index].kdvOrani = rate;
    setCart(newCart);
  };

  const removeFromCart = (index) => {
    const newCart = [...cart];
    newCart.splice(index, 1);
    setCart(newCart);
  };

  // Toplam hesaplamaları
  const cartTotal = cart.reduce((sum, item) => {
    const unitPrice = parseDecimal(item.alis_fiyati ?? item.price);
    return sum + (unitPrice * item.quantity);
  }, 0);
  
  const discountedTotal = cartTotal * (1 - discount / 100);
  
  const grandTotal = roundMoney(cart.reduce((sum, item) => sum + saleLineTotal(item, discount, profit), 0));
  const vatTotal = roundMoney(cart.reduce((sum, item) => sum + roundMoney(saleLineTotal(item, discount, profit) * parseDecimal(item.kdvOrani ?? 20) / 100), 0));
  const totalIncludingVat = roundMoney(grandTotal + vatTotal);

  const copyToClipboard = () => {
    let text = `PROJE KEŞİF LİSTESİ (İskonto: %${discount})\n--------------------------------\n`;
    cart.forEach(item => {
      const lineTotal = saleLineTotal(item, discount, profit);
      text += `${item.category} - ${item.name} | ${item.quantity} ${item.birim || item.unit || 'birim'} | Birim: ${calculateDiscountedPrice(item.price).toFixed(2)} TL | Toplam: ${lineTotal.toFixed(2)} TL\n`;
    });
    text += `--------------------------------\nGENEL TOPLAM: ${grandTotal.toFixed(2)} TL`;
    
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    alert("Liste panoya kopyalandı!");
  };

  // Senaryo Uygulama Fonksiyonu (Düzeltilmiş - Tüm malzemeleri ekler)
  const applyScenario = (scenario) => {
    const additions = [], notFound = [], ambiguous = [];
    for (const requested of scenario.items) {
      const matches = allProducts.filter(item => item.name.toLocaleLowerCase('tr-TR').includes(requested.search.toLocaleLowerCase('tr-TR')) || item.category.toLocaleLowerCase('tr-TR').includes(requested.search.toLocaleLowerCase('tr-TR')));
      if (matches.length === 1) additions.push({ ...matches[0], quantity: requested.quantity });
      else if (matches.length > 1) ambiguous.push(requested.search);
      else notFound.push(requested.search);
    }
    if (additions.length > 0 && !confirm('Bu şablon yalnızca örnek miktarlar içerir. Proje ve ürün uygunluğunu kontrol ederek seçili kalemleri eklemek istiyor musunuz?')) return;
    setCart(previous => mergeCartItems(previous, additions));
    setIsScenarioModalOpen(false);
    alert(`${additions.length}/${scenario.items.length} kalem eklendi.${ambiguous.length ? '\nBirden çok ürün var; katalogdan uygun ürünü kendiniz seçin: ' + ambiguous.join(', ') : ''}${notFound.length ? '\nKatalogda bulunamadı: ' + notFound.join(', ') : ''}`);
  };

  const refreshSavedQuotes = async () => {
    const rows = await loadCompanyDocuments('kesif_teklif');
    const records = rows.map(row => ({ ...row.payload, id: row.record_id, _revision: row.revision }));
    setSavedTeklifler(records);return records;
  };

  const saveTeklif = async () => {
    if (savedRecordsBusy.current) return false;
    if (!teklifForm.musteriAdi?.trim() || !cart.length) { alert('Müşteri adı ve en az bir ürün gereklidir.');return false; }
    savedRecordsBusy.current = true;
    try {
      const current = savedTeklifRef.current || { id: crypto.randomUUID(), revision: null };
      savedTeklifRef.current = current;
      const payload = {schemaVersion:1,id:current.id,tarih:new Date().toISOString(),teklifForm:{...teklifForm},cart:[...cart],discount,profit,logo:companyLogo,reportHtml:sanitizeReportHTML(editableContent)};
      const saved = await saveCompanyDocument('kesif_teklif',current.id,payload,current.revision);
      savedTeklifRef.current = {id:saved.record_id,revision:saved.revision};
      let refreshed=true;try{await refreshSavedQuotes();setRecordsError('');}catch(error){refreshed=false;setRecordsError(error.message);}
      alert(refreshed?'Teklif şirket sunucusuna kaydedildi.':'Teklif sunucuya kaydedildi; liste yenilenemedi. Kaydı tekrar oluşturmayın, şirket tekliflerini yeniden açın.');return true;
    } catch (error) { setRecordsError(error.message);alert('Teklif kaydedilemedi: '+error.message+'. Listeyi yenileyip güncel kaydı açın; formunuz korunuyor.');return false; }
    finally { savedRecordsBusy.current = false; }
  };

  const loadSavedTeklifler = async () => {
    try { await refreshSavedQuotes();setRecordsError('');setIsSavedTeklifModalOpen(true); }
    catch (error) { setRecordsError(error.message);alert('Şirket teklifleri yüklenemedi: '+error.message); }
  };

  const loadTeklif = teklif => {
    if(savedRecordsBusy.current){alert('Kaydetme tamamlanana kadar mevcut teklif formunu koruyun.');return;}
    if (!teklif.teklifForm || !Array.isArray(teklif.cart)) { alert('Kayıt içeriği geçersiz; mevcut form korunuyor.');return; }
    loadedFormState.current={form:teklif.teklifForm,cart:teklif.cart,discount:teklif.discount ?? 0,profit:teklif.profit ?? 0};
    setTeklifForm(teklif.teklifForm);setCart(teklif.cart);setDiscount(teklif.discount ?? 0);setProfit(teklif.profit ?? 0);
    setEditorMode(false);setEditableContent(reportHTMLWithReference(teklif.reportHtml || '',teklif.teklifForm.teklifNo));
    if (teklif.logo) setCompanyLogo(teklif.logo);
    savedTeklifRef.current = {id:teklif.id,revision:teklif._revision};
    setIsSavedTeklifModalOpen(false);
  };

  const saveCentralSnapshot = async () => {
    if(savedRecordsBusy.current || !onSaveSnapshot)return;
    savedRecordsBusy.current=true;
    try{
      const saved=await onSaveSnapshot({schemaVersion:1,teklifForm:{...teklifForm},cart:cart.map(item=>({...item})),discount,profit,logo:companyLogo,reportHtml:sanitizeReportHTML(editableContent)});
      const reference=saved?.reference_no || saved?.data?.referenceNo;
      if(reference){const form={...teklifForm,teklifNo:reference};loadedFormState.current={form,cart,discount,profit};setTeklifForm(form);setEditableContent(reportHTMLWithReference(editableContent,reference));}
    }catch(error){alert('Teklif arşivine kayıt tamamlanamadı: '+error.message);}
    finally{savedRecordsBusy.current=false;}
  };

  const deleteTeklif = async id => {
    if (!confirm('Bu şirket teklifini sunucudan silmek istiyor musunuz?')) return;
    try { const record=savedTeklifler.find(item=>item.id===id);await deleteCompanyDocument('kesif_teklif',id,record?._revision);await refreshSavedQuotes();if(savedTeklifRef.current?.id===id)savedTeklifRef.current=null;alert('Teklif silindi.'); }
    catch(error){alert('Teklif silinemedi: '+error.message+'. Listeyi yenileyin.');}
  };

  const importLegacyQuotes = async () => {
    try {
      const records=JSON.parse(localStorage.getItem('kesifTeklifler')||'[]');if(!Array.isArray(records))throw new Error('Eski kayıt biçimi geçersiz.');
      const existing=await refreshSavedQuotes(),ids=new Set(existing.map(item=>String(item.id)));let imported=0,failed=0;
      for(const record of records){if(ids.has(String(record.id)))continue;try{if(!record.teklifForm||!Array.isArray(record.cart))throw new Error('Geçersiz teklif');await saveCompanyDocument('kesif_teklif',String(record.id||crypto.randomUUID()),record,null);imported++;}catch{failed++;}}
      await refreshSavedQuotes();setIsSavedTeklifModalOpen(true);alert(`${imported} eski teklif aktarıldı. ${failed} kayıt aktarılamadı. Mevcut kayıtlar üzerine yazılmadı; tarayıcı kopyaları korundu.`);
    }catch(error){alert('Aktarım tamamlanamadı: '+error.message);}
  };

  // A local, editable draft. Company data is not sent to an external AI provider.
  const handleGenerateEmail = () => {
    if (cart.length === 0) return;
    const lines = cart.map(item => `${item.category} - ${item.name}: ${item.quantity} ${item.unit || 'birim'} × ${saleUnitPrice(item, discount, profit).toFixed(2)} TL = ${(saleLineTotal(item, discount, profit)).toFixed(2)} TL (KDV %${item.kdvOrani ?? 20})`);
    setGeneratedEmail(`Sayın ${teklifForm.musteriAdi || 'Yetkili'},\n\nTalebiniz doğrultusunda hazırladığımız ${teklifForm.teklifNo || ''} numaralı teklifin kalemleri aşağıdadır:\n\n${lines.join('\n')}\n\nKDV hariç toplam: ${grandTotal.toFixed(2)} TL\nKDV toplamı: ${vatTotal.toFixed(2)} TL\nKDV dahil toplam: ${totalIncludingVat.toFixed(2)} TL\n\nGeçerlilik: ${teklifForm.gecerlilik || 'Teklif koşullarında belirtilir'}\n${teklifForm.odemeSekli ? 'Ödeme: ' + teklifForm.odemeSekli + '\n' : ''}${teklifForm.notlar ? '\n' + teklifForm.notlar : ''}\n\nSaygılarımızla,\n${teklifForm.firmaAdi || 'VoltGuard'}\n${teklifForm.yetkili || ''}\n${teklifForm.telefon || ''}\n${teklifForm.email || ''}`);
    setAiLoading(false);
    setIsEmailModalOpen(true);
  };

  // --- PDF TEKLİF HAZIRLAMA ---
  const generatePDF = async (downloadNow = false) => {
    if (cart.length === 0) {
      alert('Sepetiniz boş! Lütfen önce malzeme ekleyin.');
      return;
    }

    if (downloadNow) {
      // Direkt indirme - eski jsPDF yöntemi
      await generateSimplePDF();
    } else {
      // Önizleme modu - yeni HTML-based PDF
      await generateHTMLPDF();
    }
  };

  // Basit jsPDF indirme (hızlı)
  const generateSimplePDF = async () => {
    if (!cart.length || !teklifForm.musteriAdi?.trim() || !teklifForm.firmaAdi?.trim() || !teklifForm.yetkili?.trim()) {
      alert('Müşteri, firma, yetkili ve ürün bilgilerini tamamlayın.'); return;
    }
    try {
      const doc = await createReportPDF({ title: 'Elektrik Malzeme Keşif ve Metraj Teklifi' });
      doc.setFont(undefined, 'bold'); doc.setFontSize(17); doc.setTextColor(24, 57, 95);
      doc.text('KEŞİF VE METRAJ FİYAT TEKLİFİ', 105, 22, { align: 'center' });
      doc.autoTable({ startY: 32, head: [['Teklif bilgisi', 'Değer']], body: [
        ['Müşteri', teklifForm.musteriAdi], ['Satıcı firma', teklifForm.firmaAdi], ['Yetkili', teklifForm.yetkili],
        ['Telefon', teklifForm.telefon || 'Belirtilmedi'], ['E-posta', teklifForm.email || 'Belirtilmedi'],
        ['Adres', teklifForm.adres || 'Belirtilmedi'], ['Proje', teklifForm.projeAdi || 'Belirtilmedi'],
        ['Teklif no', teklifForm.teklifNo], ['Teklif tarihi', teklifForm.tarih], ['Geçerlilik', teklifForm.gecerlilikSuresi]
      ], theme: 'grid', columnStyles: { 0: { cellWidth: 42 } } });
      const cents = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
      const salePrice = item => cents(calculateDiscountedPrice(Number(item.alis_fiyati ?? item.price ?? 0)));
      const lineTotal = item => cents(salePrice(item) * Number(item.quantity));
      const subtotal = cart.reduce((total, item) => total + lineTotal(item), 0);
      const vat = cart.reduce((total, item) => {
        const rate = Number(item.kdvOrani ?? 20);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('Ürün KDV oranını kontrol edin.');
        return total + cents(lineTotal(item) * rate / 100);
      }, 0);
      if (!Number.isFinite(subtotal)) throw new Error('Tutarları kontrol edin.');
      doc.autoTable({ startY: doc.lastAutoTable.finalY + 8,
        head: [['#', 'Kategori', 'Ürün', 'Miktar', 'Birim satış (TL)', 'KDV %', 'Satır toplamı (TL)']],
        body: cart.map((item, index) => [index + 1, item.category || '', item.name, reportNumber(item.quantity, 3),
          reportNumber(salePrice(item)), reportNumber(item.kdvOrani ?? 20, 0), reportNumber(lineTotal(item))]),
        columnStyles: { 0: { cellWidth: 10 }, 2: { cellWidth: 65 }, 4: { halign: 'right' }, 5: { halign: 'center' }, 6: { halign: 'right' } }, theme: 'striped' });
      doc.autoTable({ startY: doc.lastAutoTable.finalY + 8, head: [['Ödeme özeti', 'Tutar']], body: [
        ['KDV hariç ara toplam', reportMoney(subtotal)], ['KDV (satır oranları)', reportMoney(vat)],
        ['KDV dahil genel toplam', reportMoney(subtotal + vat)]
      ], columnStyles: { 1: { halign: 'right' } }, theme: 'grid' });
      doc.setFont(undefined, 'normal'); doc.setFontSize(9); doc.setTextColor(40);
      if (teklifForm.aciklama?.trim()) writeReportParagraph(doc, `Açıklamalar ve koşullar:
${teklifForm.aciklama}`, { y: doc.lastAutoTable.finalY + 10 });
      doc.save(reportFileName('Kesif_Teklif', teklifForm.teklifNo));
      setIsTeklifModalOpen(false);
    } catch (error) { alert('PDF oluşturulamadı: ' + error.message); }
  };

  // HTML-based PDF (önizleme için - App.jsx GES PDF tarzı)
  const generateHTMLPDF = async () => {
    if (!teklifForm.musteriAdi || !teklifForm.firmaAdi || !teklifForm.yetkili || cart.length === 0) {
      if (!teklifForm.musteriAdi || !teklifForm.firmaAdi || !teklifForm.yetkili) {
        setIsMusteriModalOpen(true);
      } else {
        alert('Lütfen ürün ekleyin.');
      }
      return;
    }
    
    // Önizleme açmadan önce PDF içeriğini hazırla
    setIsPdfPreviewOpen(true);
    setIsTeklifModalOpen(false);
    
    // DOM'un render olması için bekle
    await new Promise(resolve => setTimeout(resolve, 100));
  };
  
  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setCompanyLogo(event.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-gray-50 text-gray-800 font-sans">
      {/* Header */}
      <header className="bg-blue-800 text-white p-3 md:p-4 shadow-lg shrink-0 z-20">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="flex items-center gap-2">
            <Calculator className="w-6 h-6 md:w-8 md:h-8 text-yellow-400" />
            <div>
              <h1 className="text-lg md:text-2xl font-bold">KabloMetraj Pro</h1>
              <p className="text-[10px] md:text-xs text-blue-200">Serer Fiyat Listesi Baz Alınmıştır</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 md:gap-3">
            <div className="flex items-center gap-2 bg-blue-700 p-2 rounded-lg border border-blue-600">
              <label className="text-xs md:text-sm font-semibold whitespace-nowrap">İskonto (%):</label>
              <input 
                type="number" 
                value={discount}
                onChange={(e) => setDiscount(Math.min(100, Math.max(0, parseDecimal(e.target.value))))}
                className="w-12 md:w-16 p-1.5 md:p-2 text-black text-center font-bold text-sm md:text-base rounded shadow-inner outline-none focus:ring-2 focus:ring-yellow-400"
              />
            </div>
            <div className="flex items-center gap-2 bg-green-700 p-2 rounded-lg border border-green-600">
              <label className="text-xs md:text-sm font-semibold whitespace-nowrap">Kâr (%):</label>
              <input 
                type="number" 
                value={profit}
                onChange={(e) => setProfit(Math.max(0, parseDecimal(e.target.value)))}
                className="w-12 md:w-16 p-1.5 md:p-2 text-black text-center font-bold text-sm md:text-base rounded shadow-inner outline-none focus:ring-2 focus:ring-yellow-400"
              />
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col">
      <div className="max-w-7xl mx-auto w-full h-full p-2 md:p-4 flex flex-col lg:flex-row gap-3 md:gap-6 overflow-hidden">
        
        {/* Sol Panel: Ürün Seçimi */}
        <div className="flex-1 flex flex-col space-y-3 md:space-y-4 overflow-hidden">
          
          {/* Arama ve Filtre */}
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 space-y-3">
            {/* Arama Alanı - Üstte tam genişlik */}
            <div className="relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5 md:w-6 md:h-6" />
              <input
                type="text"
                placeholder="🔍 Malzeme ara... (örn: NYY 4x25, Otomat, LED)"
                className="w-full pl-12 md:pl-14 pr-12 py-3 md:py-3.5 text-sm md:text-base rounded-lg border-2 border-gray-300 bg-gray-50 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all placeholder-gray-400"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
            
            <p className="text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded p-3">Başlangıç kataloğu geçmiş fatura kalemlerinden oluşur. Güncel fiyatı, ürün özelliklerini ve birimleri kontrol edin. İskonto ve kâr oranı yalnızca sizin seçiminizle uygulanır; teklifler şirket sunucusunda saklanır.</p>
            {initialSnapshot && <p className="text-xs text-blue-900 bg-blue-50 p-3 rounded">Arşivdeki teklif formu ve fiyatları açıldı. Satıcı bilgileri, fiyat güncelliği ve teklif koşullarını tekrar kontrol edin. Referans: {teklifForm.teklifNo}</p>}
            {productsError && <p role="alert" className="text-red-800 bg-red-50 p-3 rounded">Özel ürünler yüklenemedi: {productsError}. Son kayıtlı kopya varsa gösteriliyor. <button type="button" className="underline ml-2" onClick={loadProductsFromSupabase}>Yeniden dene</button></p>}
            {recordsError && <p role="alert" className="text-red-800 bg-red-50 p-3 rounded">Şirket kayıtlarına erişilemedi: {recordsError}</p>}
            {legacyQuotesAvailable && <button onClick={importLegacyQuotes} className="border rounded p-2 text-sm">Eski tarayıcı tekliflerini şirket sunucusuna aktar</button>}
            {/* Butonlar - Grid düzende */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              <button 
                onClick={() => setIsNewProductModalOpen(true)}
                className="flex items-center justify-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white px-3 py-2.5 rounded-lg text-xs md:text-sm font-medium shadow-md transition-colors"
                title="Listede Olmayan Özel Ürün Ekle - Kendi ürününüzü manuel olarak ekleyin"
              >
                <Plus className="w-4 h-4" />
                <span>Yeni Ürün</span>
              </button>
              <button 
                onClick={() => setIsMusteriModalOpen(true)}
                className="flex items-center justify-center gap-1.5 bg-orange-600 hover:bg-orange-700 text-white px-3 py-2.5 rounded-lg text-xs md:text-sm font-medium shadow-md transition-colors"
                title="Müşteri Bilgilerini Düzenle"
              >
                <User className="w-4 h-4" />
                <span>Müşteri Bilgileri</span>
              </button>
              <button 
                onClick={() => setIsScenarioModalOpen(true)}
                className="flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-700 text-white px-3 py-2.5 rounded-lg text-xs md:text-sm font-medium shadow-md transition-colors"
                title="Örnek Malzeme Şablonları - Trafo değişimi, pano revizyonu gibi hazır paketleri yükle"
              >
                <FileText className="w-4 h-4" />
                <span>Örnek Malzeme Şablonları</span>
              </button>
              <button 
                onClick={loadSavedTeklifler}
                className="flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2.5 rounded-lg text-xs md:text-sm font-medium shadow-md transition-colors"
                title="Kaydedilmiş Teklifler - Daha önce kaydetmiş olduğunuz teklifleri görüntüle ve yükle"
              >
                <Save className="w-4 h-4" />
                <span>Teklifler</span>
              </button>

            </div>

            {/* Kategori Filtreleri */}
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                    selectedCategory === cat 
                    ? 'bg-blue-600 text-white shadow-md' 
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Ürün Listesi Grid */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-3 pb-4">
            {filteredData.map((item, index) => {
              const discountedPrice = calculateDiscountedPrice(item.price);
              return (
                <div key={index} className="bg-white p-3 md:p-4 rounded-lg border border-gray-100 hover:shadow-md transition-shadow group flex flex-col justify-between relative">
                  {/* Düzenle Butonu - Sağ üst köşe */}
                  <button
                    onClick={() => {
                      setEditingProduct({ ...item, originalName: item.name });
                      setIsProductEditModalOpen(true);
                    }}
                    className="absolute top-2 right-2 p-1.5 bg-gray-100 hover:bg-blue-50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Ürünü Düzenle"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-gray-600" />
                  </button>

                  <div>
                    <span className="text-[10px] md:text-xs font-bold text-blue-600 bg-blue-50 px-1.5 md:px-2 py-0.5 rounded mb-1 inline-block">
                      {item.category}
                    </span>
                    <h3 className="font-bold text-gray-800 text-sm md:text-base leading-tight pr-8">{item.name}</h3>
                  </div>
                  
                  <div className="mt-2 md:mt-3 flex justify-between items-end">
                    <div className="flex flex-col">
                      <span className="text-[10px] md:text-xs text-gray-400 line-through">Liste: {item.price.toFixed(2)} TL</span>
                      <span className="text-base md:text-xl font-bold text-green-600">{discountedPrice.toFixed(2)} TL</span>
                    </div>
                    <button 
                      onClick={() => addToCart(item)}
                      className="bg-blue-600 hover:bg-blue-700 text-white p-1.5 md:p-2 rounded-full shadow-lg active:scale-95 transition-transform"
                    >
                      <Plus className="w-4 h-4 md:w-5 md:h-5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          </div>
        </div>

        {/* Sağ Panel: Hesap/Metraj Listesi */}
        <div className="lg:w-96 flex flex-col shrink-0 h-full">
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden h-full flex flex-col">
            <div className="bg-gray-800 text-white p-3 md:p-4 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5" />
                <h2 className="font-bold">Keşif Listesi</h2>
              </div>
              <span className="bg-gray-700 px-2 py-0.5 rounded-full text-xs">
                {cart.length} Kalem
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
              {cart.length === 0 ? (
                <div className="text-center py-10 opacity-50 flex flex-col items-center">
                  <FileText className="w-12 h-12 mb-2" />
                  <p>Liste boş.</p>
                  <p className="text-sm">Kabloları ekleyerek metrajı girin.</p>
                </div>
              ) : (
                cart.map((item, index) => {
                  const unitPrice = saleUnitPrice(item, discount, profit);
                  const lineTotal = saleLineTotal(item, discount, profit);
                  return (
                    <div key={index} className="bg-gray-50 p-3 rounded-lg border border-gray-200 text-sm">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex-1">
                          <p className="font-bold text-gray-800">{item.name}</p>
                          <p className="text-xs text-gray-500">{item.category}</p>
                        </div>
                        <button onClick={() => removeFromCart(index)} className="text-red-400 hover:text-red-600 ml-2">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      
                      {/* Açıklama Alanı */}
                      <div className="mb-2">
                        <input
                          type="text"
                          placeholder="Açıklama ekle (opsiyonel)..."
                          value={item.description || ''}
                          onChange={(e) => updateItemDescription(index, e.target.value)}
                          className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                        />
                      </div>
                      
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 bg-white border rounded px-1">
                          <input 
                            type="number" 
                            className="w-16 p-1 text-center font-bold outline-none"
                            value={item.quantity}
                            onChange={(e) => updateQuantity(index, e.target.value)}
                          />
                          <span className="text-xs text-gray-400 select-none">adet</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-500">KDV:</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={item.kdvOrani ?? 20}
                            onChange={(e) => updateItemKdv(index, e.target.value)}
                            className="w-12 px-1 py-0.5 text-xs text-center border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none"
                          />
                          <span className="text-xs text-gray-400">%</span>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-gray-400">{unitPrice.toFixed(2)} x {item.quantity}</div>
                          <div className="font-bold text-gray-800">{lineTotal.toFixed(2)} TL</div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-3 md:p-4 bg-gray-100 border-t border-gray-200 space-y-2 md:space-y-3">
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between items-center text-gray-600">
                  <span>Ara Toplam:</span>
                  <span className="font-semibold">{cartTotal.toFixed(2)} TL</span>
                </div>
                <div className="flex justify-between items-center text-red-600">
                  <span>İskonto (%{discount}):</span>
                  <span className="font-semibold">-{(cartTotal * (discount / 100)).toFixed(2)} TL</span>
                </div>
                <div className="flex justify-between items-center text-gray-600">
                  <span>İskonto Sonrası:</span>
                  <span className="font-semibold">{discountedTotal.toFixed(2)} TL</span>
                </div>
                <div className="flex justify-between items-center text-green-600">
                  <span>Kâr (%{profit}):</span>
                  <span className="font-semibold">+{(discountedTotal * (profit / 100)).toFixed(2)} TL</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-gray-300">
                  <span className="font-bold text-gray-800">Genel Toplam:</span>
                  <span className="text-xl font-bold text-blue-700">{grandTotal.toFixed(2)} TL</span>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-200">
                 <button 
                  onClick={() => {
                    if (cart.length > 0) {
                      // Müşteri bilgilerini kontrol et
                      if (!teklifForm.musteriAdi || !teklifForm.firmaAdi || !teklifForm.yetkili) {
                        setIsMusteriModalOpen(true);
                        return;
                      }
                      setIsPdfPreviewOpen(true);
                    }
                  }}
                  disabled={cart.length === 0}
                  className={`flex items-center justify-center gap-1 py-2 rounded-lg font-bold text-xs md:text-sm transition-colors ${
                    cart.length === 0 
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                    : 'bg-red-600 hover:bg-red-700 text-white shadow-md'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5 md:w-4 md:h-4" />
                  <span className="hidden sm:inline">Önizle</span>
                  <span className="sm:hidden">PDF</span>
                </button>
                <button 
                  onClick={saveTeklif}
                  disabled={cart.length === 0}
                  className={`flex items-center justify-center gap-1 py-2 rounded-lg font-bold text-xs md:text-sm transition-colors ${
                    cart.length === 0 
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                    : 'bg-green-600 hover:bg-green-700 text-white shadow-md'
                  }`}
                >
                  <Save className="w-3.5 h-3.5 md:w-4 md:h-4" />
                  <span className="hidden sm:inline">Kaydet</span>
                  <span className="sm:hidden">💾</span>
                </button>
                <button 
                  onClick={copyToClipboard}
                  disabled={cart.length === 0}
                  className={`flex items-center justify-center gap-1 py-2 rounded-lg font-bold text-xs md:text-sm transition-colors ${
                    cart.length === 0 
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                    : 'bg-green-600 hover:bg-green-700 text-white shadow-md'
                  }`}
                >
                  <Copy className="w-3.5 h-3.5 md:w-4 md:h-4" />
                  Kopyala
                </button>
              </div>
              {onSaveSnapshot && <button onClick={saveCentralSnapshot} disabled={!cart.length} className="w-full bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 text-white rounded-lg py-2 font-semibold text-sm">Teklif arşivine kaydet</button>}
              <button 
                onClick={handleGenerateEmail}
                disabled={cart.length === 0}
                className={`w-full flex items-center justify-center gap-1 py-2 rounded-lg font-bold text-xs md:text-sm transition-colors ${
                  cart.length === 0 
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                  : 'bg-purple-100 hover:bg-purple-200 text-purple-700 border border-purple-200'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 md:w-4 md:h-4" />
                <span className="hidden sm:inline">E-posta Taslağı</span>
                <span className="sm:hidden">E-posta</span>
              </button>
            </div>
          </div>
        </div>

      </div>
      </div>

      {/* Teklif Hazırlama Modal */}
      {isTeklifModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 md:p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full my-4 md:my-8">
            <div className="bg-red-600 p-3 md:p-4 flex justify-between items-center text-white">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 md:w-6 md:h-6" />
                <h3 className="font-bold text-base md:text-lg">Profesyonel Teklif Hazırla</h3>
              </div>
              <button onClick={() => setIsTeklifModalOpen(false)}><X className="w-5 h-5 md:w-6 md:h-6" /></button>
            </div>
            <div className="p-4 md:p-6 space-y-3 md:space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="bg-blue-50 p-3 md:p-4 rounded-lg border border-blue-200">
                <p className="text-xs md:text-sm text-blue-800 font-medium">
                  📋 Müşteri ve proje bilgilerini girin, ardından PDF olarak indirebilirsiniz.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Müşteri Adı *</label>
                  <input
                    type="text"
                    value={teklifForm.musteriAdi}
                    onChange={(e) => setTeklifForm({...teklifForm, musteriAdi: e.target.value})}
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-red-500 outline-none"
                    placeholder="Şirket veya Kişi Adı"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Firma Adı *</label>
                  <input
                    type="text"
                    value={teklifForm.firmaAdi}
                    onChange={(e) => setTeklifForm({...teklifForm, firmaAdi: e.target.value})}
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-red-500 outline-none"
                    placeholder="ABC Mühendislik Ltd."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Yetkili Kişi *</label>
                  <input
                    type="text"
                    value={teklifForm.yetkili}
                    onChange={(e) => setTeklifForm({...teklifForm, yetkili: e.target.value})}
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-red-500 outline-none"
                    placeholder="Ahmet Yılmaz"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Telefon</label>
                  <input
                    type="tel"
                    value={teklifForm.telefon}
                    onChange={(e) => setTeklifForm({...teklifForm, telefon: e.target.value})}
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-red-500 outline-none"
                    placeholder="+90 555 123 45 67"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">E-posta</label>
                  <input
                    type="email"
                    value={teklifForm.email}
                    onChange={(e) => setTeklifForm({...teklifForm, email: e.target.value})}
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-red-500 outline-none"
                    placeholder="info@firma.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Adres</label>
                <input
                  type="text"
                  value={teklifForm.adres}
                  onChange={(e) => setTeklifForm({...teklifForm, adres: e.target.value})}
                  className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-red-500 outline-none"
                  placeholder="İstanbul, Türkiye"
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Proje Adı</label>
                  <input
                    type="text"
                    value={teklifForm.projeAdi}
                    onChange={(e) => setTeklifForm({...teklifForm, projeAdi: e.target.value})}
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-red-500 outline-none"
                    placeholder="Fabrika Elektrik İşleri"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">KDV Oranı (%)</label>
                  <input
                    type="number"
                    value={teklifForm.kdvOrani}
                    onChange={(e) => setTeklifForm({...teklifForm, kdvOrani: parseFloat(e.target.value)})}
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-red-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Teklif No</label>
                  <input
                    type="text"
                    value={teklifForm.teklifNo}
                    onChange={(e) => setTeklifForm({...teklifForm, teklifNo: e.target.value})}
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-red-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Geçerlilik Süresi</label>
                  <input
                    type="text"
                    value={teklifForm.gecerlilikSuresi}
                    onChange={(e) => setTeklifForm({...teklifForm, gecerlilikSuresi: e.target.value})}
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-red-500 outline-none"
                    placeholder="30 gün"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Açıklama / Notlar</label>
                <textarea
                  value={teklifForm.aciklama}
                  onChange={(e) => setTeklifForm({...teklifForm, aciklama: e.target.value})}
                  rows="3"
                  className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-red-500 outline-none"
                  placeholder="Ek bilgiler, ödeme koşulları, teslim süresi vb."
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Firma Logosu</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (e) => setCompanyLogo(e.target.result);
                      reader.readAsDataURL(file);
                    }
                  }}
                  className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-red-500 outline-none text-sm file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:bg-red-100 file:text-red-700 file:hover:bg-red-200 file:cursor-pointer"
                />
                {companyLogo && (
                  <div className="mt-2 flex items-center gap-3 p-2 bg-gray-50 rounded-lg border">
                    <img src={companyLogo} alt="Logo" className="w-16 h-16 object-contain" />
                    <div className="flex-1 text-xs text-gray-600">
                      Logo yüklendi ✓
                    </div>
                    <button
                      onClick={() => setCompanyLogo('/calisan/uygulama/fatura_logo.png')}
                      className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                      title="Varsayılan logoya dön"
                    >
                      Sıfırla
                    </button>
                  </div>
                )}
              </div>

              <div className="bg-gray-50 p-4 rounded-lg border">
                <h4 className="font-bold text-gray-700 mb-2">Teklif Özeti</h4>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Toplam Kalem:</span>
                    <span className="font-semibold">{cart.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Ara Toplam:</span>
                    <span className="font-semibold">{grandTotal.toFixed(2)} TL</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">KDV ({teklifForm.kdvOrani}%):</span>
                    <span className="font-semibold">{(grandTotal * teklifForm.kdvOrani / 100).toFixed(2)} TL</span>
                  </div>
                  <div className="flex justify-between text-lg pt-2 border-t">
                    <span className="text-gray-800 font-bold">Genel Toplam:</span>
                    <span className="font-bold text-red-600">{(grandTotal * (1 + teklifForm.kdvOrani / 100)).toFixed(2)} TL</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => generatePDF(false)}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 shadow-lg transition-colors"
                >
                  <Eye className="w-5 h-5" />
                  <span className="hidden sm:inline">Önizle</span>
                </button>
                <button
                  onClick={() => generatePDF(true)}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 shadow-lg transition-colors"
                >
                  <Download className="w-5 h-5" />
                  <span className="hidden sm:inline">İndir</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Müşteri Bilgileri Modal - İlk Açılış */}
      {isMusteriModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-auto">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-4 md:p-6 text-white sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
                  <User className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-xl md:text-2xl">Müşteri Bilgileri</h3>
                  <p className="text-sm text-blue-100">Teklif hazırlamadan önce müşteri bilgilerini girin</p>
                </div>
              </div>
            </div>
            
            <div className="p-4 md:p-6 space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  <strong>ℹ️ Bilgi:</strong> Bu bilgiler PDF teklifinizde görünecektir. Zorunlu alanları doldurun.
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Müşteri Adı <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={teklifForm.musteriAdi}
                    onChange={(e) => setTeklifForm({...teklifForm, musteriAdi: e.target.value})}
                    className="w-full p-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="Örn: ABC İnşaat Ltd. Şti."
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Firma Adı <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={teklifForm.firmaAdi}
                    onChange={(e) => setTeklifForm({...teklifForm, firmaAdi: e.target.value})}
                    className="w-full p-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="Sizin firma adınız"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Yetkili Kişi <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={teklifForm.yetkili}
                    onChange={(e) => setTeklifForm({...teklifForm, yetkili: e.target.value})}
                    className="w-full p-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="Sizin adınız"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Telefon</label>
                  <input
                    type="tel"
                    value={teklifForm.telefon}
                    onChange={(e) => setTeklifForm({...teklifForm, telefon: e.target.value})}
                    className="w-full p-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="+90 555 123 45 67"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">E-posta</label>
                  <input
                    type="email"
                    value={teklifForm.email}
                    onChange={(e) => setTeklifForm({...teklifForm, email: e.target.value})}
                    className="w-full p-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="info@firma.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Proje Adı</label>
                  <input
                    type="text"
                    value={teklifForm.projeAdi}
                    onChange={(e) => setTeklifForm({...teklifForm, projeAdi: e.target.value})}
                    className="w-full p-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="Örn: Fabrika Elektrik İşleri"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Adres</label>
                  <input
                    type="text"
                    value={teklifForm.adres}
                    onChange={(e) => setTeklifForm({...teklifForm, adres: e.target.value})}
                    className="w-full p-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="İstanbul, Türkiye"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t">
                <button
                  onClick={() => {
                    if (!teklifForm.musteriAdi || !teklifForm.firmaAdi || !teklifForm.yetkili) {
                      alert('⚠️ Lütfen zorunlu alanları doldurun (Müşteri Adı, Firma Adı, Yetkili Kişi)');
                      return;
                    }
                    setIsMusteriModalOpen(false);
                    // Eğer callback sağlanmışsa, müşteri bilgilerini güncelle
                    if (onCustomerUpdate && typeof onCustomerUpdate === 'function') {
                      onCustomerUpdate(teklifForm);
                    }
                    // Keşif Metraj'ın kendi PDF önizlemesini aç
                    if (cart.length > 0) {
                      setTimeout(() => setIsPdfPreviewOpen(true), 300);
                    }
                  }}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 px-6 rounded-lg font-bold transition-all shadow-lg hover:shadow-xl"
                >
                  ✓ Kaydet ve Önizle
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Örnek Malzeme Şablonları Modal */}
      {isScenarioModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 md:p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full my-4 md:my-8">
            <div className="bg-green-700 p-3 md:p-4 flex justify-between items-center text-white">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 md:w-6 md:h-6" />
                <h3 className="font-bold text-base md:text-lg">Örnek Malzeme Şablonları</h3>
              </div>
              <button onClick={() => setIsScenarioModalOpen(false)}>
                <X className="w-5 h-5 md:w-6 md:h-6" />
              </button>
            </div>
            <div className="p-4 md:p-6 max-h-[70vh] overflow-y-auto">
              <div className="bg-blue-50 p-3 md:p-4 rounded-lg border border-blue-200 mb-4">
                <p className="text-xs md:text-sm text-blue-800">
                  <strong>💡 İpucu:</strong> Aşağıdaki hazır senaryolardan birini seçin ve tüm gerekli malzemeler otomatik olarak sepetinize eklensin!
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
                {scenarios.map(scenario => {
                  // Senaryo maliyeti hesapla
                  let estimatedCost = 0;
                  scenario.items.forEach(item => {
                    const matches = initialData.filter(d => 
                      d.name.toLowerCase().includes(item.search.toLowerCase())
                    );
                    if (matches.length > 0) {
                      estimatedCost += calculateDiscountedPrice(matches[0].price) * item.quantity;
                    }
                  });

                  return (
                    <div 
                      key={scenario.id}
                      className="bg-white border-2 border-gray-200 hover:border-green-500 rounded-xl p-4 cursor-pointer transition-all hover:shadow-lg group"
                      onClick={() => applyScenario(scenario)}
                    >
                      <div className="flex items-start gap-3 mb-3">
                        <div className="text-3xl">{scenario.icon}</div>
                        <div className="flex-1">
                          <h4 className="font-bold text-gray-800 text-sm md:text-base group-hover:text-green-600 transition-colors">
                            {scenario.name}
                          </h4>
                          <p className="text-xs text-gray-500 mt-1">
                            {scenario.description}
                          </p>
                        </div>
                      </div>

                      <div className="bg-gray-50 rounded-lg p-2 mb-3">
                        <div className="text-xs text-gray-600 mb-1">
                          <strong>{scenario.items.length}</strong> farklı malzeme türü
                        </div>
                        <div className="text-xs text-gray-500 max-h-16 overflow-y-auto">
                          {scenario.items.map((item, idx) => (
                            <div key={idx} className="flex justify-between">
                              <span>• {item.search}</span>
                              <span className="font-medium">{item.quantity} ${item.birim || item.unit || 'birim'}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex justify-between items-center pt-3 border-t border-gray-200">
                        <div className="text-xs text-gray-500">Tahmini Maliyet:</div>
                        <div className="text-base font-bold text-green-600">
                          {estimatedCost > 0 ? `${estimatedCost.toFixed(2)} TL` : 'Hesaplanıyor...'}
                        </div>
                      </div>

                      <button className="w-full mt-3 bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 group-hover:bg-green-700">
                        <Plus className="w-4 h-4" />
                        Sepete Ekle
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Kaydedilmiş Teklifler Modal */}
      {isSavedTeklifModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 md:p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full my-4 md:my-8">
            <div className="bg-blue-700 p-3 md:p-4 flex justify-between items-center text-white">
              <div className="flex items-center gap-2">
                <Save className="w-5 h-5 md:w-6 md:h-6" />
                <h3 className="font-bold text-base md:text-lg">Kaydedilmiş Teklifler ({savedTeklifler.length})</h3>
              </div>
              <button onClick={() => setIsSavedTeklifModalOpen(false)}>
                <X className="w-5 h-5 md:w-6 md:h-6" />
              </button>
            </div>
            <div className="p-4 md:p-6 max-h-[70vh] overflow-y-auto">
              {savedTeklifler.length === 0 ? (
                <div className="text-center py-12">
                  <Save className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500 text-lg mb-2">Henüz kaydedilmiş teklif yok</p>
                  <p className="text-gray-400 text-sm">Sepetinize ürün ekleyip "Kaydet" butonuna tıklayarak teklif kaydedebilirsiniz.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {savedTeklifler.map(teklif => (
                    <div key={teklif.id} className="bg-white border-2 border-gray-200 rounded-lg p-4 hover:border-blue-400 transition-all shadow-sm hover:shadow-md">
                      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <FileText className="w-5 h-5 text-blue-600" />
                            <h4 className="font-bold text-lg text-gray-800">{teklif.teklifForm.musteriAdi}</h4>
                            <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
                              {teklif.teklifForm.teklifNo}
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-gray-600">
                            <div className="flex items-center gap-2">
                              <Clock className="w-4 h-4 text-gray-400" />
                              <span>{teklif.date}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Cable className="w-4 h-4 text-gray-400" />
                              <span>{teklif.cart.length} ürün</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Percent className="w-4 h-4 text-gray-400" />
                              <span>İskonto: %{teklif.discount}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Banknote className="w-4 h-4 text-green-600" />
                              <span className="font-bold text-green-600">
                                {(teklif.cart.reduce((sum, item) => sum + saleLineTotal(item, teklif.discount, teklif.profit), 0)).toFixed(2)} TL
                              </span>
                            </div>
                          </div>
                          {teklif.teklifForm.firmaAdi && (
                            <div className="mt-2 text-xs text-gray-500">
                              Firma: {teklif.teklifForm.firmaAdi}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-row md:flex-col gap-2">
                          <button
                            onClick={() => loadTeklif(teklif)}
                            className="flex items-center gap-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
                          >
                            <Download className="w-4 h-4" />
                            Yükle
                          </button>
                          <button
                            onClick={() => deleteTeklif(teklif.id)}
                            className="flex items-center gap-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                            Sil
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

      {/* Email Modal */}
      {isEmailModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[90vh]">
            <div className="bg-indigo-700 p-4 flex justify-between items-center text-white shrink-0">
              <div className="flex items-center gap-2">
                <Mail className="w-6 h-6" />
                <h3 className="font-bold text-lg">Teklif Mektubu Oluşturucu</h3>
              </div>
              <button onClick={() => setIsEmailModalOpen(false)}><X className="w-6 h-6" /></button>
            </div>
            
            <div className="p-6 flex-1 overflow-y-auto">
              {aiLoading ? (
                <div className="h-64 flex flex-col items-center justify-center text-indigo-600">
                  <Loader2 className="w-12 h-12 animate-spin mb-4" />
                  <p className="font-medium">Profesyonel teklifiniz yazılıyor...</p>
                </div>
              ) : (
                <div className="prose prose-sm max-w-none">
                  <textarea 
                    className="w-full h-96 p-4 border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none font-mono text-sm leading-relaxed"
                    value={generatedEmail}
                    onChange={(e) => setGeneratedEmail(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3 shrink-0 rounded-b-xl">
               <button 
                onClick={() => {
                   navigator.clipboard.writeText(generatedEmail);
                   alert("Teklif metni kopyalandı!");
                }}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium flex items-center gap-2"
              >
                <Copy className="w-4 h-4" />
                Metni Kopyala
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden PDF Preview Pages (App.jsx GES tarzı) */}
      <div style={{ position: 'absolute', left: '-9999px', top: '0' }}>
        {/* Sayfa 1: Teklif Ana Sayfa */}
        <div className="kesif-pdf-page" style={{ width: '210mm', height: '297mm', background: 'white', padding: '15mm 20mm 30mm 20mm', fontFamily: 'Arial, sans-serif', position: 'relative', boxSizing: 'border-box' }}>
          {/* Header Atlet - Logo ve Başlık */}
          <div style={{ marginBottom: '5mm', paddingBottom: '3mm', borderBottom: '2px solid #2980b9' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6mm' }}>
              <div style={{ width: '40mm', flexShrink: 0 }}>
                {companyLogo && (
                  <img src={companyLogo} alt="Logo" style={{ width: '100%', height: 'auto', maxHeight: '20mm', objectFit: 'contain' }} />
                )}
              </div>
              <div style={{ flex: 1, textAlign: 'right' }}>
                <h1 style={{ fontSize: '20px', fontWeight: 'bold', color: '#2c3e50', margin: '0 0 2mm 0', lineHeight: '1.1' }}>FİYAT TEKLİFİ</h1>
                <p style={{ fontSize: '10px', color: '#7f8c8d', margin: 0, lineHeight: '1.2' }}>Elektrik Malzeme Keşfi ve Metraj Teklifi</p>
              </div>
            </div>
          </div>

          {/* Firma ve Müşteri Bilgileri */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10mm', fontSize: '11px' }}>
            <div style={{ width: '48%' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: '#2980b9', marginBottom: '5px' }}>FİRMA BİLGİLERİ</h3>
              <p style={{ margin: '3px 0', lineHeight: '1.6' }}><strong>Firma Adi:</strong> {teklifForm.firmaAdi || 'VoltGuard'}</p>
              <p style={{ margin: '3px 0', lineHeight: '1.6' }}><strong>Yetkili:</strong> {teklifForm.yetkili || 'Emrullah Günay'}</p>
              <p style={{ margin: '3px 0', lineHeight: '1.6' }}><strong>Telefon:</strong> {teklifForm.telefon || '+90 545 434 67 35'}</p>
              <p style={{ margin: '3px 0', lineHeight: '1.6' }}><strong>E-posta:</strong> {teklifForm.email || 'info@voltguard.com.tr'}</p>
              {teklifForm.adres && teklifForm.adres.trim() && (
                <p style={{ margin: '3px 0', lineHeight: '1.6' }}><strong>Adres:</strong> {teklifForm.adres}</p>
              )}
            </div>
            <div style={{ width: '48%' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: '#2980b9', marginBottom: '5px' }}>MÜŞTERİ BİLGİLERİ</h3>
              <p style={{ margin: '3px 0', lineHeight: '1.6' }}><strong>Müşteri Adı:</strong> {teklifForm.musteriAdi}</p>
              {teklifForm.projeAdi && teklifForm.projeAdi.trim() && (
                <p style={{ margin: '3px 0', lineHeight: '1.6' }}><strong>Proje:</strong> {teklifForm.projeAdi}</p>
              )}
              <p style={{ margin: '3px 0', lineHeight: '1.6' }}><strong>Teklif No:</strong> {teklifForm.teklifNo}</p>
              <p style={{ margin: '3px 0', lineHeight: '1.6' }}><strong>Tarih:</strong> {teklifForm.tarih}</p>
              <p style={{ margin: '3px 0', lineHeight: '1.6' }}><strong>Geçerlilik:</strong> {teklifForm.gecerlilikSuresi}</p>
            </div>
          </div>

          {/* Ürün Tablosu */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5px', marginBottom: '10mm' }}>
            <thead>
              <tr style={{ backgroundColor: '#2980b9', color: 'white' }}>
                <th style={{ border: '1px solid #ddd', padding: '4px', textAlign: 'left', width: '4%' }}>No</th>
                <th style={{ border: '1px solid #ddd', padding: '4px', textAlign: 'left', width: '42%' }}>Malzeme Adı</th>
                <th style={{ border: '1px solid #ddd', padding: '4px', textAlign: 'center', width: '9%' }}>Birim</th>
                <th style={{ border: '1px solid #ddd', padding: '4px', textAlign: 'center', width: '8%' }}>Miktar</th>
                <th style={{ border: '1px solid #ddd', padding: '4px', textAlign: 'right', width: '15%' }}>Birim Fiyat</th>
                <th style={{ border: '1px solid #ddd', padding: '4px', textAlign: 'right', width: '17%' }}>Genel Toplam</th>
                <th style={{ border: '1px solid #ddd', padding: '4px', textAlign: 'center', width: '5%' }}>KDV</th>
              </tr>
            </thead>
            <tbody>
              {cart.map((item, index) => {
                const unitPrice = saleUnitPrice(item, discount, profit);
                const totalPrice = unitPrice * item.quantity;
                const discountedPrice = totalPrice * (1 - (discount / 100));
                const finalTotal = saleLineTotal(item, discount, profit);
                
                return (
                  <React.Fragment key={index}>
                    <tr style={{ backgroundColor: index % 2 === 0 ? '#f9f9f9' : 'white', pageBreakInside: 'avoid' }}>
                      <td style={{ border: '1px solid #ddd', padding: '3px', textAlign: 'center', fontSize: '8px' }}>{index + 1}</td>
                      <td style={{ border: '1px solid #ddd', padding: '3px', fontSize: '8px', lineHeight: '1.3' }}>{item.name || item.malzeme_adi}</td>
                      <td style={{ border: '1px solid #ddd', padding: '3px', textAlign: 'center', fontSize: '8px' }}>{item.birim || item.unit || 'Adet'}</td>
                      <td style={{ border: '1px solid #ddd', padding: '3px', textAlign: 'center', fontSize: '8px' }}>{item.quantity}</td>
                      <td style={{ border: '1px solid #ddd', padding: '3px', textAlign: 'right', fontSize: '8px' }}>{unitPrice.toFixed(2)} TL</td>
                      <td style={{ border: '1px solid #ddd', padding: '3px', textAlign: 'right', fontWeight: 'bold', fontSize: '8px' }}>{finalTotal.toFixed(2)} TL</td>
                      <td style={{ border: '1px solid #ddd', padding: '3px', textAlign: 'center', fontSize: '7.5px' }}>%{item.kdvOrani ?? 20}</td>
                    </tr>
                    {item.description && item.description.trim() && (
                      <tr style={{ backgroundColor: index % 2 === 0 ? '#f9f9f9' : 'white', pageBreakInside: 'avoid' }}>
                        <td colSpan="7" style={{ border: '1px solid #ddd', borderTop: 'none', padding: '3px 3px 5px 20px', fontSize: '7.5px', fontStyle: 'italic', color: '#555', lineHeight: '1.2' }}>
                          <strong>Açıklama:</strong> {item.description}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {cart.length > 150 && (
                <tr>
                  <td colSpan="7" style={{ padding: '8px', textAlign: 'center', fontSize: '9px', backgroundColor: '#fff3cd', color: '#856404', fontWeight: 'bold' }}>
                    ⚠️ Gösterim sınırı: İlk 150 ürün gösteriliyor. Toplam {cart.length} ürün var.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Özet */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8mm' }}>
            <div style={{ width: '45%', fontSize: '10px', border: '1px solid #ddd' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', borderBottom: '1px solid #ecf0f1', backgroundColor: '#f9f9f9' }}>
                <span>Ara Toplam:</span>
                <span style={{ fontWeight: 'bold' }}>{cartTotal.toFixed(2)} TL</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', borderBottom: '1px solid #ecf0f1', color: '#e74c3c' }}>
                <span>İskonto (%{discount}):</span>
                <span style={{ fontWeight: 'bold' }}>-{(cartTotal * (discount / 100)).toFixed(2)} TL</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', borderBottom: '1px solid #ecf0f1', backgroundColor: '#f9f9f9' }}>
                <span>İskonto Sonrası:</span>
                <span style={{ fontWeight: 'bold' }}>{discountedTotal.toFixed(2)} TL</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', borderBottom: '1px solid #ecf0f1', color: '#e67e22' }}>
                <span>KDV (kalem oranları):</span>
                <span style={{ fontWeight: 'bold' }}>+{(vatTotal).toFixed(2)} TL</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', backgroundColor: '#2980b9', color: 'white' }}>
                <span style={{ fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>GENEL TOPLAM:</span>
                <span style={{ fontSize: '14px', fontWeight: 'bold', whiteSpace: 'nowrap', marginLeft: '10px' }}>{(totalIncludingVat).toFixed(2)} TL</span>
              </div>
            </div>
          </div>

          {/* Özel Notlar */}
          {teklifForm.aciklama && teklifForm.aciklama.trim() && (
            <div style={{ marginTop: '10mm', padding: '10px', backgroundColor: '#f8f9fa', borderLeft: '4px solid #2980b9' }}>
              <h3 style={{ fontSize: '12px', fontWeight: 'bold', color: '#2c3e50', marginBottom: '5px' }}>ÖZEL NOTLAR:</h3>
              <p style={{ fontSize: '10px', lineHeight: '1.6', color: '#555', margin: 0 }}>{teklifForm.aciklama}</p>
            </div>
          )}

          {/* Footer Atlet - Sayfa 1 */}
          <div style={{ position: 'absolute', bottom: '8mm', left: '20mm', right: '20mm', borderTop: '2px solid #2980b9', paddingTop: '4mm' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '8.5px', color: '#555', lineHeight: '1.4' }}>
              <div style={{ textAlign: 'left', flex: 1 }}>
                <p style={{ margin: '0 0 2px 0', fontWeight: 'bold', color: '#2980b9', fontSize: '9.5px' }}>VoltGuard</p>
                <p style={{ margin: '0 0 1px 0' }}>Tel: +90 545 434 67 35</p>
                <p style={{ margin: 0 }}>E-posta: info@voltguard.com.tr</p>
              </div>
              <div style={{ textAlign: 'right', flex: 1 }}>
                <p style={{ margin: '0 0 2px 0', fontWeight: 'bold', fontSize: '10px', color: '#2980b9' }}>Sayfa 1/2</p>
                <p style={{ margin: 0, fontSize: '8px', color: '#777' }}>{new Date().toLocaleDateString('tr-TR')}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Sayfa 2: Açıklamalar ve Şartlar */}
        <div className="kesif-pdf-page" style={{ width: '210mm', height: '297mm', background: 'white', padding: '12mm 20mm 25mm 20mm', fontFamily: 'Arial, sans-serif', position: 'relative', boxSizing: 'border-box', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ marginBottom: '8mm', paddingBottom: '3mm', borderBottom: '2px solid #2980b9' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6mm' }}>
              <div style={{ width: '40mm', flexShrink: 0 }}>
                {companyLogo && (
                  <img src={companyLogo} alt="Logo" style={{ width: '100%', height: 'auto', maxHeight: '20mm', objectFit: 'contain' }} />
                )}
              </div>
              <div style={{ flex: 1, textAlign: 'right' }}>
                <h1 style={{ fontSize: '18px', fontWeight: 'bold', color: '#2980b9', margin: '0 0 2mm 0', lineHeight: '1.1' }}>AÇIKLAMALAR VE GENEL ŞARTLAR</h1>
                <p style={{ fontSize: '9px', color: '#7f8c8d', margin: 0, lineHeight: '1.2' }}>Teklif No: {teklifForm.teklifNo}</p>
              </div>
            </div>
          </div>

          {/* Özel Açıklamalar */}
          {teklifForm.aciklama && teklifForm.aciklama.trim() && (
            <div style={{ marginBottom: '10mm', padding: '10px 12px', backgroundColor: '#f8f9fa', borderLeft: '4px solid #2980b9', borderRadius: '4px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: '#2c3e50', marginBottom: '6px' }}>ÖZEL NOTLAR VE AÇIKLAMALAR</h3>
              <div style={{ fontSize: '11px', lineHeight: '1.8', color: '#555', whiteSpace: 'pre-line' }}>
                {teklifForm.aciklama}
              </div>
            </div>
          )}

          {/* 1. Ödeme Planı */}
          <div style={{ marginBottom: '8mm' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: '#2c3e50', marginBottom: '5px', paddingBottom: '3px', borderBottom: '1px solid #e0e0e0' }}>1. ÖDEME PLANI</h3>
            <p style={{ fontSize: '10.5px', lineHeight: '1.8', color: '#555', textAlign: 'justify' }}>
              İşbu teklif bedeli; %50 sipariş onayı ile birlikte avans (peşin), kalan %50 bakiye iş tesliminde vadesiz (peşin) olarak tahsil edilecek şekilde hesaplanmıştır.
            </p>
          </div>

          {/* 2. Fiyatlandırma Esası */}
          <div style={{ marginBottom: '8mm' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: '#2c3e50', marginBottom: '5px', paddingBottom: '3px', borderBottom: '1px solid #e0e0e0' }}>2. FİYATLANDIRMA ESASI</h3>
            <p style={{ fontSize: '10.5px', lineHeight: '1.8', color: '#555', textAlign: 'justify' }}>
              Birim fiyatlarımız nakit/havale ödeme koşuluna göre iskontolu olarak sunulmuştur. Çek, senet veya vadeli ödeme taleplerinde, güncel finansal maliyetler ve vade farkı oranları fiyata ayrıca yansıtılır.
            </p>
          </div>

          {/* 3. Teklif Geçerliliği */}
          <div style={{ marginBottom: '8mm' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: '#2c3e50', marginBottom: '5px' }}>3. TEKLİF GEÇERLİLİĞİ</h3>
            <p style={{ fontSize: '11px', lineHeight: '1.8', color: '#555', textAlign: 'justify' }}>
              Teklifimizde yer alan kablo ve trafo gibi emtia piyasalarına (Bakır/LME ve Döviz) endeksli ürünler nedeniyle, teklifimiz {teklifForm.gecerlilikSuresi} süreyle geçerlidir. Bu süreden sonra oluşabilecek maliyet artışlarını revize etme hakkımız saklıdır.
            </p>
          </div>

          {/* 4. Teslimat Süresi */}
          <div style={{ marginBottom: '8mm' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: '#2c3e50', marginBottom: '5px' }}>4. TESLİMAT SÜRESİ</h3>
            <p style={{ fontSize: '11px', lineHeight: '1.8', color: '#555', textAlign: 'justify' }}>
              Malzemeler sipariş onayı ve ön ödeme alındıktan sonra 7-14 iş günü içinde teslim edilecektir. Stokta olmayan özel ürünler için süre ayrıca bildirilecektir.
            </p>
          </div>

          {/* 5. Montaj ve Sorumluluk */}
          <div style={{ marginBottom: '8mm' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: '#2c3e50', marginBottom: '5px' }}>5. MONTAJ HİZMETİ</h3>
            <p style={{ fontSize: '11px', lineHeight: '1.8', color: '#555', textAlign: 'justify' }}>
              Bu teklif sadece malzeme bedelini içermektedir. Montaj, işçilik ve sarf malzemesi hizmetleri talep edilmesi halinde ayrıca fiyatlandırılacaktır.
            </p>
          </div>

          {/* 6. Garanti ve Servis */}
          <div style={{ marginBottom: '8mm' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: '#2c3e50', marginBottom: '5px' }}>6. GARANTİ</h3>
            <p style={{ fontSize: '11px', lineHeight: '1.8', color: '#555', textAlign: 'justify' }}>
              Tüm ürünler için üretici firma garantisi geçerlidir. Garanti süreleri ürün bazında farklılık gösterebilir ve ürün ile birlikte teslim edilecek garanti belgesi ekinde belirtilmiştir.
            </p>
          </div>

          {/* 7. Kapsam Dışı */}
          <div style={{ marginBottom: '10mm' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 'bold', color: '#2c3e50', marginBottom: '5px' }}>7. KAPSAM DIŞI</h3>
            <p style={{ fontSize: '11px', lineHeight: '1.8', color: '#555', textAlign: 'justify' }}>
              Hafriyat, nakliye, vinç, iskele ve benzeri inşaat işleri bu teklif kapsamı dışındadır. İhtiyaç duyulması halinde ayrıca değerlendirilecektir.
            </p>
          </div>

          {/* Footer Atlet - Sayfa 2 */}
          <div style={{ position: 'absolute', bottom: '8mm', left: '20mm', right: '20mm', borderTop: '2px solid #2980b9', paddingTop: '4mm' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '8.5px', color: '#555', lineHeight: '1.4' }}>
              <div style={{ textAlign: 'left', flex: 1 }}>
                <p style={{ margin: '0 0 2px 0', fontWeight: 'bold', color: '#2980b9', fontSize: '9.5px' }}>VoltGuard</p>
                <p style={{ margin: '0 0 1px 0' }}>Tel: +90 545 434 67 35</p>
                <p style={{ margin: 0 }}>E-posta: info@voltguard.com.tr</p>
              </div>
              <div style={{ textAlign: 'right', flex: 1 }}>
                <p style={{ margin: '0 0 2px 0', fontWeight: 'bold', fontSize: '10px', color: '#2980b9' }}>Sayfa 2/2</p>
                <p style={{ margin: 0, fontSize: '8px', color: '#777' }}>{new Date().toLocaleDateString('tr-TR')}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* PDF Preview Modal */}
      {/* PDF Ön İzleme Modal (App.jsx tarzı - YG İşletme Sorumluluğu gibi) */}
      {isPdfPreviewOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2 md:p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-[95vw] h-[95vh] flex flex-col">
            {/* Header */}
            <div className="bg-gradient-to-r from-red-600 to-red-700 p-3 md:p-4 flex justify-between items-center text-white shrink-0 rounded-t-xl">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 md:w-6 md:h-6" />
                <h3 className="font-bold text-base md:text-lg">Elektrik Malzeme Keşif Teklifi - Ön İzleme</h3>
              </div>
              <div className="flex items-center gap-2 md:gap-3">
                {!editorMode && (
                  <button
                    onClick={() => {
                      setEditorMode(true);
                      const paperElement = document.getElementById('kesif-printable-paper');
                      if (paperElement) {
                        setEditableContent(sanitizeReportHTML(paperElement.innerHTML));
                      }
                    }}
                    className="px-2 md:px-3 py-1.5 md:py-2 bg-yellow-500 hover:bg-yellow-600 rounded-lg font-medium flex items-center gap-1 md:gap-2 transition-colors text-sm md:text-base"
                  >
                    <Edit3 className="w-4 h-4 md:w-5 md:h-5" />
                    <span className="hidden sm:inline">Düzenle</span>
                  </button>
                )}
                {editorMode && (
                  <button
                    onClick={() => {
                      const paperElement = document.getElementById('kesif-printable-paper');
                      if (paperElement) {
                        const safeContent = sanitizeReportHTML(paperElement.innerHTML);
                        paperElement.innerHTML = safeContent;
                        setEditableContent(safeContent);
                      }
                      setEditorMode(false);
                    }}
                    className="px-2 md:px-3 py-1.5 md:py-2 bg-green-500 hover:bg-green-600 rounded-lg font-medium flex items-center gap-1 md:gap-2 transition-colors text-sm md:text-base"
                  >
                    <CheckCircle className="w-4 h-4 md:w-5 md:h-5" />
                    Kaydet
                  </button>
                )}
                <button
                  onClick={async () => {
                    try {
                      await exportHTMLReport({ root: document.getElementById('kesif-printable-paper'), selector: '.kesif-pdf-page',
                        filename: reportFileName('Kesif_Teklif', teklifForm.teklifNo), title: 'Keşif ve Metraj Fiyat Teklifi' });
                    } catch (error) { alert('PDF oluşturulamadı: ' + error.message); }
                  }}
                  className="px-2 md:px-3 py-1.5 md:py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium flex items-center gap-1 md:gap-2 transition-colors text-sm md:text-base"
                >
                  <Download className="w-4 h-4 md:w-5 md:h-5" />
                  <span className="hidden sm:inline">İndir</span>
                </button>
                <button
                  onClick={() => {
                    saveTeklif();
                  }}
                  className="px-2 md:px-3 py-1.5 md:py-2 bg-green-600 hover:bg-green-700 rounded-lg font-medium flex items-center gap-1 md:gap-2 transition-colors text-sm md:text-base"
                >
                  <Save className="w-4 h-4 md:w-5 md:h-5" />
                  <span className="hidden sm:inline">Kaydet</span>
                </button>
                <button onClick={() => {
                  setIsPdfPreviewOpen(false);
                  setEditorMode(false);
                }} className="hover:bg-white/20 p-1 rounded">
                  <X className="w-5 h-5 md:w-6 md:h-6" />
                </button>
              </div>
            </div>
            
            {/* Editor Toolbar (Edit Mode) */}
            {editorMode && (
              <div className="bg-yellow-50 border-b border-yellow-200 p-2 md:p-3">
                <div className="flex items-center gap-2 text-xs md:text-sm text-yellow-800">
                  <Sparkles className="w-4 h-4" />
                  <span className="font-medium">Düzenleme Modu Aktif</span>
                  <span className="hidden md:inline">- PDF içeriğini doğrudan düzenleyebilirsiniz</span>
                </div>
              </div>
            )}
            
            {/* Preview Content */}
            <div className="flex-1 overflow-y-auto bg-gray-100 p-2 md:p-4">
              <div 
                id="kesif-printable-paper"
                contentEditable={editorMode}
                onPaste={pasteReportHTML}
                onDrop={pasteReportHTML}
                suppressContentEditableWarning={true}
                className={`mx-auto ${editorMode ? 'outline-2 outline-dashed outline-yellow-400' : ''}`}
                style={editorMode ? { minHeight: '297mm' } : {}}
                onInput={(e) => {
                  if (editorMode) {
                    setEditableContent(sanitizeReportHTML(e.currentTarget.innerHTML));
                  }
                }}
              >
                {(() => {
                  // Ürünleri sayfalara böl - her sayfa 20 ürün
                  const ITEMS_PER_PAGE = 20;
                  const productPages = [];
                  
                  for (let i = 0; i < cart.length; i += ITEMS_PER_PAGE) {
                    productPages.push(cart.slice(i, i + ITEMS_PER_PAGE));
                  }
                  
                  // En az 1 sayfa olsun
                  if (productPages.length === 0) {
                    productPages.push([]);
                  }
                  
                  const totalPages = productPages.length + 1; // +1 açıklamalar sayfası
                  
                  return (
                    <>
                      {productPages.map((pageItems, pageIndex) => (
                        <div key={`product-page-${pageIndex}`} className="kesif-pdf-page" style={{ width: '210mm', height: '297mm', background: 'white', padding: '12mm 20mm 25mm 20mm', fontFamily: 'Arial, sans-serif', position: 'relative', boxSizing: 'border-box', overflow: 'hidden', marginBottom: '10px' }}>
                          {/* Header - Sadece ilk sayfada tam */}
                          {pageIndex === 0 ? (
                            <>
                              <div style={{ marginBottom: '5mm', paddingBottom: '3mm', borderBottom: '2px solid #2980b9' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6mm' }}>
                                  <div style={{ width: '40mm', flexShrink: 0 }}>
                                    {companyLogo && (
                                      <img src={companyLogo} alt="Logo" style={{ width: '100%', height: 'auto', maxHeight: '20mm', objectFit: 'contain' }} />
                                    )}
                                  </div>
                                  <div style={{ flex: 1, textAlign: 'right' }}>
                                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', color: '#2c3e50', margin: '0 0 2mm 0', lineHeight: '1.1' }}>FİYAT TEKLİFİ</h1>
                                    <p style={{ fontSize: '10px', color: '#7f8c8d', margin: 0, lineHeight: '1.2' }}>Elektrik Malzeme Keşfi ve Metraj Teklifi</p>
                                  </div>
                                </div>
                              </div>

                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6mm', fontSize: '10px' }}>
                                <div style={{ width: '48%' }}>
                                  <h3 style={{ fontSize: '12px', fontWeight: 'bold', color: '#2980b9', marginBottom: '4px' }}>FİRMA BİLGİLERİ</h3>
                                  <p style={{ margin: '2px 0', lineHeight: '1.5' }}><strong>Firma:</strong> {teklifForm.firmaAdi || 'VoltGuard'}</p>
                                  <p style={{ margin: '2px 0', lineHeight: '1.5' }}><strong>Yetkili:</strong> {teklifForm.yetkili || 'Emrullah Günay'}</p>
                                  <p style={{ margin: '2px 0', lineHeight: '1.5' }}><strong>Tel:</strong> {teklifForm.telefon || '+90 545 434 67 35'}</p>
                                  <p style={{ margin: '2px 0', lineHeight: '1.5' }}><strong>E-posta:</strong> {teklifForm.email || 'info@voltguard.com.tr'}</p>
                                  {teklifForm.adres && teklifForm.adres.trim() && (
                                    <p style={{ margin: '2px 0', lineHeight: '1.5' }}><strong>Adres:</strong> {teklifForm.adres}</p>
                                  )}
                                </div>
                                <div style={{ width: '48%' }}>
                                  <h3 style={{ fontSize: '12px', fontWeight: 'bold', color: '#2980b9', marginBottom: '4px' }}>MÜŞTERİ BİLGİLERİ</h3>
                                  <p style={{ margin: '2px 0', lineHeight: '1.5' }}><strong>Müşteri:</strong> {teklifForm.musteriAdi || '-'}</p>
                                  {teklifForm.projeAdi && teklifForm.projeAdi.trim() && (
                                    <p style={{ margin: '2px 0', lineHeight: '1.5' }}><strong>Proje:</strong> {teklifForm.projeAdi}</p>
                                  )}
                                  <p style={{ margin: '2px 0', lineHeight: '1.5' }}><strong>Teklif No:</strong> {teklifForm.teklifNo}</p>
                                  <p style={{ margin: '2px 0', lineHeight: '1.5' }}><strong>Tarih:</strong> {teklifForm.tarih}</p>
                                  <p style={{ margin: '2px 0', lineHeight: '1.5' }}><strong>Geçerlilik:</strong> {teklifForm.gecerlilikSuresi}</p>
                                </div>
                              </div>
                            </>
                          ) : (
                            <div style={{ marginBottom: '5mm', paddingBottom: '3mm', borderBottom: '2px solid #2980b9' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6mm' }}>
                                <div style={{ width: '40mm', flexShrink: 0 }}>
                                  {companyLogo && (
                                    <img src={companyLogo} alt="Logo" style={{ width: '100%', height: 'auto', maxHeight: '20mm', objectFit: 'contain' }} />
                                  )}
                                </div>
                                <div style={{ flex: 1, textAlign: 'right' }}>
                                  <h2 style={{ fontSize: '16px', fontWeight: 'bold', color: '#2c3e50', margin: '0 0 2mm 0', lineHeight: '1.1' }}>FİYAT TEKLİFİ - Devam</h2>
                                  <p style={{ fontSize: '10px', color: '#555', margin: 0 }}><strong>Teklif No:</strong> {teklifForm.teklifNo} | <strong>Müşteri:</strong> {teklifForm.musteriAdi}</p>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Ürün Tablosu */}
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', marginBottom: pageIndex === productPages.length - 1 ? '6mm' : '0' }}>
                            <thead>
                              <tr style={{ backgroundColor: '#2980b9', color: 'white' }}>
                                <th style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'left', width: '4%' }}>No</th>
                                <th style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'left', width: '42%' }}>Malzeme Adı</th>
                                <th style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'center', width: '9%' }}>Birim</th>
                                <th style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'center', width: '8%' }}>Miktar</th>
                                <th style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'right', width: '15%' }}>Birim Fiyat</th>
                                <th style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'right', width: '17%' }}>Toplam</th>
                                <th style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'center', width: '5%' }}>KDV</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pageItems.map((item, idx) => {
                                const globalIndex = pageIndex * ITEMS_PER_PAGE + idx;
                                const unitPrice = saleUnitPrice(item, discount, profit);
                                const totalPrice = unitPrice * item.quantity;
                                const discountedPrice = totalPrice * (1 - (discount / 100));
                                const finalTotal = saleLineTotal(item, discount, profit);
                                
                                return (
                                  <React.Fragment key={globalIndex}>
                                    <tr style={{ backgroundColor: globalIndex % 2 === 0 ? '#f9f9f9' : 'white' }}>
                                      <td style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'center', fontSize: '10px' }}>{globalIndex + 1}</td>
                                      <td style={{ border: '1px solid #ddd', padding: '5px', fontSize: '10px', lineHeight: '1.4' }}>{item.name || item.malzeme_adi}</td>
                                      <td style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'center', fontSize: '10px' }}>{item.birim || 'Adet'}</td>
                                      <td style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'center', fontSize: '10px' }}>{item.quantity}</td>
                                      <td style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'right', fontSize: '10px' }}>{unitPrice.toFixed(2)} TL</td>
                                      <td style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'right', fontWeight: 'bold', fontSize: '10px' }}>{finalTotal.toFixed(2)} TL</td>
                                      <td style={{ border: '1px solid #ddd', padding: '5px', textAlign: 'center', fontSize: '9px' }}>%{item.kdvOrani ?? 20}</td>
                                    </tr>
                                    {item.description && item.description.trim() && (
                                      <tr style={{ backgroundColor: globalIndex % 2 === 0 ? '#f9f9f9' : 'white' }}>
                                        <td colSpan="7" style={{ border: '1px solid #ddd', borderTop: 'none', padding: '5px 5px 7px 20px', fontSize: '9px', fontStyle: 'italic', color: '#555', lineHeight: '1.4' }}>
                                          <strong>Açıklama:</strong> {item.description}
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </tbody>
                          </table>

                          {/* Özet - Sadece son ürün sayfasında */}
                          {pageIndex === productPages.length - 1 && (
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '6mm' }}>
                              <div style={{ width: '45%', fontSize: '11px', border: '1px solid #ddd' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', borderBottom: '1px solid #ecf0f1', backgroundColor: '#f9f9f9' }}>
                                  <span>Ara Toplam:</span>
                                  <span style={{ fontWeight: 'bold' }}>{cartTotal.toFixed(2)} TL</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', borderBottom: '1px solid #ecf0f1', color: '#e74c3c' }}>
                                  <span>İskonto (%{discount}):</span>
                                  <span style={{ fontWeight: 'bold' }}>-{(cartTotal * (discount / 100)).toFixed(2)} TL</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', borderBottom: '1px solid #ecf0f1', backgroundColor: '#f9f9f9' }}>
                                  <span>İskonto Sonrası:</span>
                                  <span style={{ fontWeight: 'bold' }}>{discountedTotal.toFixed(2)} TL</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', borderBottom: '1px solid #ecf0f1', color: '#e67e22' }}>
                                  <span>Ortalama KDV (kalem oranları):</span>
                                  <span style={{ fontWeight: 'bold' }}>+{(vatTotal).toFixed(2)} TL</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', backgroundColor: '#2980b9', color: 'white' }}>
                                  <span style={{ fontSize: '13px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>GENEL TOPLAM:</span>
                                  <span style={{ fontSize: '15px', fontWeight: 'bold', whiteSpace: 'nowrap', marginLeft: '10px' }}>{(totalIncludingVat).toFixed(2)} TL</span>

                                </div>
                              </div>
                            </div>
                          )}

                          {/* Footer */}
                          <div style={{ position: 'absolute', bottom: '8mm', left: '20mm', right: '20mm', borderTop: '2px solid #2980b9', paddingTop: '3mm' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#555', lineHeight: '1.3' }}>
                              <div style={{ textAlign: 'left', flex: 1 }}>
                                <p style={{ margin: '0 0 1px 0', fontWeight: 'bold', color: '#2980b9', fontSize: '10px' }}>VoltGuard</p>
                                <p style={{ margin: '0 0 1px 0' }}>Tel: +90 545 434 67 35</p>
                                <p style={{ margin: 0 }}>E-posta: info@voltguard.com.tr</p>
                              </div>
                              <div style={{ textAlign: 'right', flex: 1 }}>
                                <p style={{ margin: '0 0 1px 0', fontWeight: 'bold', fontSize: '10px', color: '#2980b9' }}>Sayfa {pageIndex + 1}/{totalPages}</p>
                                <p style={{ margin: 0, fontSize: '9px', color: '#777' }}>{new Date().toLocaleDateString('tr-TR')}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                      
                      {/* Açıklamalar Sayfası */}
                      <div className="kesif-pdf-page" style={{ width: '210mm', height: '297mm', background: 'white', padding: '15mm 20mm 25mm 20mm', fontFamily: 'Arial, sans-serif', position: 'relative', boxSizing: 'border-box', overflow: 'hidden' }}>
                        {/* Header */}
                        <div style={{ marginBottom: '10mm', paddingBottom: '4mm', borderBottom: '3px solid #2980b9' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6mm' }}>
                            <div style={{ width: '45mm', flexShrink: 0 }}>
                              {companyLogo && (
                                <img src={companyLogo} alt="Logo" style={{ width: '100%', height: 'auto', maxHeight: '22mm', objectFit: 'contain' }} />
                              )}
                            </div>
                            <div style={{ flex: 1, textAlign: 'right' }}>
                              <h1 style={{ fontSize: '22px', fontWeight: 'bold', color: '#2980b9', margin: '0 0 3mm 0', lineHeight: '1.2' }}>GENEL ŞARTLAR VE ÖDEME KOŞULLARI</h1>
                              <p style={{ fontSize: '11px', color: '#7f8c8d', margin: 0, lineHeight: '1.3' }}>Teklif No: {teklifForm.teklifNo}</p>
                            </div>
                          </div>
                        </div>
                        {/* İçerik */}
                        <div style={{ fontSize: '12px', lineHeight: '2', color: '#2c3e50' }}>
                          {/* Ödeme Planı */}
                          <div style={{ marginBottom: '10mm' }}>
                            <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#2980b9', marginBottom: '6px', display: 'flex', alignItems: 'center' }}>
                              <span style={{ marginRight: '8px', fontSize: '16px' }}>•</span> Ödeme Planı
                            </h3>
                            <p style={{ fontSize: '12px', lineHeight: '2', color: '#444', textAlign: 'justify', paddingLeft: '20px' }}>
                              İşbu teklif bedeli; %50 sipariş onayı ile birlikte avans (peşin), kalan %50 bakiye iş tesliminde vadesiz (peşin) olarak tahsil edilecek şekilde hesaplanmıştır.
                            </p>
                          </div>

                          {/* Fiyatlandırma Esası */}
                          <div style={{ marginBottom: '10mm' }}>
                            <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#2980b9', marginBottom: '6px', display: 'flex', alignItems: 'center' }}>
                              <span style={{ marginRight: '8px', fontSize: '16px' }}>•</span> Fiyatlandırma Esası
                            </h3>
                            <p style={{ fontSize: '12px', lineHeight: '2', color: '#444', textAlign: 'justify', paddingLeft: '20px' }}>
                              Birim fiyatlarımız nakit/havale ödeme koşuluna göre iskontolu olarak sunulmuştur. Çek, senet veya vadeli ödeme taleplerinde, güncel finansal maliyetler ve vade farkı oranları fiyata ayrıca yansıtılır.
                            </p>
                          </div>

                          {/* Teklif Geçerliliği */}
                          <div style={{ marginBottom: '10mm' }}>
                            <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#2980b9', marginBottom: '6px', display: 'flex', alignItems: 'center' }}>
                              <span style={{ marginRight: '8px', fontSize: '16px' }}>•</span> Teklif Geçerliliği
                            </h3>
                            <p style={{ fontSize: '12px', lineHeight: '2', color: '#444', textAlign: 'justify', paddingLeft: '20px' }}>
                              Teklifimizde yer alan kablo ve trafo gibi emtia piyasalarına (Bakır/LME ve Döviz) endeksli ürünler nedeniyle, teklifimiz 3 iş günü süreyle geçerlidir. Bu süreden sonra oluşabilecek maliyet artışlarını revize etme hakkımız saklıdır.
                            </p>
                          </div>

                          {/* Teslimat Süresi */}
                          <div style={{ marginBottom: '10mm' }}>
                            <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#2980b9', marginBottom: '6px', display: 'flex', alignItems: 'center' }}>
                              <span style={{ marginRight: '8px', fontSize: '16px' }}>•</span> Teslimat Süresi
                            </h3>
                            <p style={{ fontSize: '12px', lineHeight: '2', color: '#444', textAlign: 'justify', paddingLeft: '20px' }}>
                              Malzeme termin ve iş teslim süresi, avans ödemesinin şirket hesaplarımıza geçmesiyle başlar.
                            </p>
                          </div>

                          {/* Montaj */}
                          <div style={{ marginBottom: '10mm' }}>
                            <h3 style={{ fontSize: '14px', fontWeight: 'bold', color: '#2980b9', marginBottom: '6px', display: 'flex', alignItems: 'center' }}>
                              <span style={{ marginRight: '8px', fontSize: '16px' }}>•</span> Montaj
                            </h3>
                            <p style={{ fontSize: '12px', lineHeight: '2', color: '#444', textAlign: 'justify', paddingLeft: '20px' }}>
                              Montaj sahasının iş güvenliğine uygun ve çalışmaya hazır hale getirilmesi (hafriyat, inşaat işleri vb.) işverenin sorumluluğundadır.
                            </p>
                          </div>
                        </div>

                        {/* Footer */}
                        <div style={{ position: 'absolute', bottom: '8mm', left: '20mm', right: '20mm', borderTop: '2px solid #2980b9', paddingTop: '3mm' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#555', lineHeight: '1.3' }}>
                            <div style={{ textAlign: 'left', flex: 1 }}>
                              <p style={{ margin: '0 0 1px 0', fontWeight: 'bold', color: '#2980b9', fontSize: '10px' }}>VoltGuard</p>
                              <p style={{ margin: '0 0 1px 0' }}>Tel: +90 545 434 67 35</p>
                              <p style={{ margin: 0 }}>E-posta: info@voltguard.com.tr</p>
                            </div>
                            <div style={{ textAlign: 'right', flex: 1 }}>
                              <p style={{ margin: '0 0 1px 0', fontWeight: 'bold', fontSize: '10px', color: '#2980b9' }}>Sayfa {totalPages}/{totalPages}</p>
                              <p style={{ margin: 0, fontSize: '9px', color: '#777' }}>{new Date().toLocaleDateString('tr-TR')}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
            
            
            {/* Footer Info */}
            <div className="p-2 md:p-3 bg-gray-50 border-t flex flex-col sm:flex-row justify-between items-center gap-2 shrink-0 rounded-b-xl text-xs md:text-sm">
              <p className="text-gray-600 text-center sm:text-left">
                💡 İpucu: <span className="font-medium">Düzenle</span> ile içeriği değiştirin, <span className="font-medium">İndir</span> ile PDF kaydedin
              </p>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Toplam: {cart.length} kalem</span>
                <span className="text-gray-300">|</span>
                <span className="font-bold text-red-600">{grandTotal.toFixed(2)} TL</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ürün Düzenleme Modalı */}
      {isProductEditModalOpen && editingProduct && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6 rounded-t-xl">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <Edit3 className="w-6 h-6" />
                Ürün Düzenle
              </h2>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2">Ürün Adı</label>
                <input
                  type="text"
                  value={editingProduct.name}
                  onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Ürün adını girin..."
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Kategori</label>
                <select
                  value={editingProduct.category}
                  onChange={(e) => setEditingProduct({ ...editingProduct, category: e.target.value })}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  {categories.filter(c => c !== 'Tümü').map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Fiyat (TL)</label>
                <input
                  type="number"
                  step="0.01"
                  value={editingProduct.price}
                  onChange={(e) => setEditingProduct({ ...editingProduct, price: parseFloat(e.target.value) || 0 })}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="0.00"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={async () => {
                    if (!await saveProduct(editingProduct)) return;
                    setIsProductEditModalOpen(false);
                    setEditingProduct(null);
                  }}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold flex items-center justify-center gap-2"
                >
                  <CheckCircle className="w-5 h-5" />
                  Kaydet
                </button>
                <button
                  onClick={async () => {
                    if (confirm('Bu ürünü silmek istediğinizden emin misiniz?')) {
                      await deleteProduct(editingProduct.id, editingProduct.name);
                      setIsProductEditModalOpen(false);
                      setEditingProduct(null);
                    }
                  }}
                  className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-semibold flex items-center gap-2"
                >
                  <Trash2 className="w-5 h-5" />
                  Sil
                </button>
                <button
                  onClick={() => {
                    setIsProductEditModalOpen(false);
                    setEditingProduct(null);
                  }}
                  className="bg-gray-300 hover:bg-gray-400 text-gray-700 px-6 py-3 rounded-lg font-semibold"
                >
                  İptal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Yeni Ürün Ekleme Modalı */}
      {isNewProductModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white p-6 rounded-t-xl">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <Plus className="w-6 h-6" />
                Yeni Ürün Ekle
              </h2>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2">Ürün Adı *</label>
                <input
                  type="text"
                  id="newProductName"
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                  placeholder="Örn: NYY 4x25 Kablo"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Kategori *</label>
                <select
                  id="newProductCategory"
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                >
                  {categories.filter(c => c !== 'Tümü').map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">Fiyat (TL) *</label>
                <input
                  type="number"
                  step="0.01"
                  id="newProductPrice"
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                  placeholder="0.00"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={async () => {
                    const name = document.getElementById('newProductName').value.trim();
                    const category = document.getElementById('newProductCategory').value;
                    const price = parseFloat(document.getElementById('newProductPrice').value) || 0;

                    if (!name) {
                      alert('Ürün adı zorunludur!');
                      return;
                    }
                    if (price <= 0) {
                      alert('Geçerli bir fiyat girin!');
                      return;
                    }

                    if (!await saveProduct({
                      name,
                      category,
                      price,
                      isNew: true
                    })) return;

                    setIsNewProductModalOpen(false);
                  }}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-lg font-semibold flex items-center justify-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Ürün Ekle
                </button>
                <button
                  onClick={() => setIsNewProductModalOpen(false)}
                  className="bg-gray-300 hover:bg-gray-400 text-gray-700 px-6 py-3 rounded-lg font-semibold"
                >
                  İptal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #888;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #555;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        
        /* PDF Page Styling */
        .kesif-pdf-page {
          page-break-after: always;
          page-break-inside: avoid;
        }
        
        @media print {
          .kesif-pdf-page {
            margin: 0;
            box-shadow: none;
            page-break-after: always;
          }
          
          body {
            margin: 0;
            padding: 0;
          }
        }
      `}</style>
    </div>
  );
};

export default KesifMetraj;


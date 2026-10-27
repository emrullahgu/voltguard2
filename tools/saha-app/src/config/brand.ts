// src/config/brand.ts
// Firma kimliği ana sitenin kurumsal bilgileriyle aynıdır (hakkimizda.html).
// Logo değişimi için assets/logo.png dosyasını yenisiyle değiştirin.

export const BRAND = {
  /** Ürün/Yazılım adı (uygulamanın kendisi) */
  appName: 'VoltGuard Saha',
  /** Uygulama sloganı (Login/PDF başlıklarında görünür) */
  appSlogan: 'Endüstriyel Gücünüzü Güvenle Yönetin',

  /** Aktif olarak kullanan firmanın bilgileri */
  company: {
    name: 'VoltGuard',
    legalName: 'VoltGuard Elektrik Elektronik ve Mekanik Mühendisliği Limited Şirketi',
    tagline: 'Elektrik, Elektronik ve Mekanik Mühendislik Çözümleri',
    email: 'info@voltguard.com.tr',
    phone: '0545 434 67 35',
    phoneRaw: '+905454346735',
    address: 'Ege Üniversitesi Kampüsü, Erzene Mahallesi, Ankara Caddesi No:172/69\nEge Teknopark TGB, Turkuaz B Blok, İç Kapı No:43, Kat:2 BB43, Bornova / İzmir',
    website: 'voltguard.com.tr',
    websiteUrl: 'https://voltguard.com.tr',
    taxOffice: 'Karşıyaka Vergi Dairesi',
    taxNumber: '9251324900',
    mersis: '',
    copyrightYear: 2026,
  },

  /** Sunulan hizmet özetleri (Firma sayfasında listelenir) */
  services: [
    'Trafo İşletme Sorumluluğu, Bakım ve Kurulum',
    'Elektrik Periyodik Kontrol ve Topraklama Ölçümleri',
    'Enerji Kalitesi, Kompanzasyon ve Harmonik Analiz',
    'Elektrik Pano İmalatı ve Elektrik Taahhüt',
    'PLC / SCADA Otomasyon ve Gömülü Sistemler',
    'GES, Enerji Verimliliği ve Mekanik Sistemler',
  ],
} as const;

export type BrandConfig = typeof BRAND;

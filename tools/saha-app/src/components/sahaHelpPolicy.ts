/** Basic guidance stays available without contacting an external AI service. */
export function sahaHelpPresentation(externalAI: boolean) {
  return externalAI ? {
    title: 'SahaTakip Asistanı',
    greeting: 'Merhaba! Ben SahaTakip Asistanıyım. Yetkiniz kapsamındaki kayıtlar için soru sorabilir, özet veya teklif taslağı isteyebilirsiniz. Fotoğraf/PDF analizi için dosya ekleyebilir, ajan işlemleri için Ajan bölümünü açabilirsiniz.',
    placeholder: 'Sorunuzu yazın veya fotoğraf/PDF ekleyin…',
  } : {
    title: 'SahaTakip Rehberi',
    greeting: 'Merhaba! SahaTakip temel kullanım rehberiyim. Menüleri ve kayıt adımlarını anlatabilirim. Yapay zekâ, dosya analizi ve ajan bağlantısı şu anda etkin değil.',
    placeholder: 'Kullanım sorusu yazın: müşteri, teklif, görev…',
  };
}

const KNOWLEDGE: { trigger: RegExp; reply: string }[] = [
  { trigger: /yapay zek|\bai\b|ajan|otonom|pdf|fotoğraf.*(?:oku|analiz)|canlı veri/i, reply: 'Bu temel rehber kayıtları okumaz veya değiştirmez; dosya analizi ve ajan işlemleri yapmaz. Müşteri, teklif, görev, takvim veya hesap güvenliği adımlarını sorabilirsiniz.' },
  { trigger: /müşter|customer/i, reply: 'Müşteri eklemek için Müşteriler bölümündeki + butonunu kullanın. Mevcut müşteriyi düzenlemek için kartını açın; işlemler erişim yetkinize göre sunucuya kaydedilir.' },
  { trigger: /teklif|quote|proposal/i, reply: 'Yeni teklif için Hub → Teklifler → Yeni yolunu kullanın. YG Trafo veya GES teklifi için Teklif Modülleri menüsünü açın. Taslağı kontrol edip Kaydet butonuyla sunucuya gönderin.' },
  { trigger: /görev|task/i, reply: 'Görev oluşturmak için Görev Yönetimi → Görevler → + yolunu kullanın. Görev kartını açarak yetkinize göre durumunu ve bilgilerini düzenleyebilirsiniz.' },
  { trigger: /takvim|calendar|etkinlik/i, reply: 'Takvim ekranından günü seçip Ekle ile etkinlik oluşturabilirsiniz. Kayıt uygulama takviminde saklanır; dış takvim veya e-posta bildirimleri servis bağlantısı olmadan gönderilmez.' },
  { trigger: /bordro|maaş|puantaj/i, reply: 'Puantaj ve Bordro bölümlerini kullanın. Çalışanlar kendilerine yetkilendirilmiş kayıtları görür; bordro sorumluları ve yöneticiler yetki kapsamlarında işlem yapar. Personel kaydı ile çalışan hesabının bağlantısını yöneticiniz yapabilir.' },
  { trigger: /şifre|password|parola|doğrulayıcı|hesap güvenli/i, reply: 'SahaTakip mevcut VoltGuard çalışan hesabınızı kullanır. Profil → Çalışan hesabını aç yoluyla Hesap güvenliği bölümüne geçin. Şifre veya doğrulayıcı uygulama değişikliği için şirket yöneticinizden yeni etkinleştirme daveti isteyin.' },
  { trigger: /bildirim|notification/i, reply: 'Uygulama bildirimlerini Bildirimler bölümünden kontrol edin. Harici e-posta, SMS veya push gönderimi ilgili servis yapılandırılmadan yapılmaz.' },
  { trigger: /(merhaba|selam|hello|\bhi\b)/i, reply: 'Merhaba! SahaTakip menüleri ve kullanım adımlarını anlatabilirim. Müşteri, teklif, görev, takvim, bordro veya hesap güvenliği hakkında ne öğrenmek istersiniz?' },
  { trigger: /yardım|help/i, reply: 'Müşteri, teklif, görev, takvim, bordro, hesap güvenliği ve bildirimler hakkında kullanım adımlarını sorabilirsiniz. Bu rehber sizin yerinize işlem yapmaz.' },
];
export function getReply(text: string): string {
  for (const item of KNOWLEDGE) if (item.trigger.test(text)) return item.reply;
  return 'Bu konuda kullanım bilgim yok. İlgili modülü ana menüden açabilir veya şirket yöneticinize danışabilirsiniz. Örneğin “yeni teklif nasıl yapılır?” diye sorabilirsiniz.';
}

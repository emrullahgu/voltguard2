# Teklif-Voltguard özellik ve entegrasyon matrisi

Kaynak audit kapsamı: voltguardekleyelim/Teklif-Voltguard-main/src ve özgün entry HTML/Vite yapılandırması; ardından tools/staff-app/src reviewed kopyası. Bu belge yalnız kod akışlarından türetildi. Gerçek fatura, JSON katalog satırı, kimlik, maaş ve çalışan kayıtları okunmadı veya belgeye taşınmadı.

Yeni hedef tek /calisan/uygulama/ girişidir. module query üzerinden bütün etkin modüller erişilir. Aynı kurumsal header/footer; React ve Tailwind yalnız #vg-company-workspace içinde. Public yorum hesabı özel çalışan yetkisi vermez. Sunucu employee yalnız kendi bordrosunu okur; admin/payroll bordro yönetir; admin hesapları yönetir. Buton görünürlüğü sunucu kısıtlarının yerine geçmez.

## Sayfa, sekme, form ve çıktı kontrol listesi

| Kaynak bileşen | Portal modülü | Alt görünümler | Form ve kullanıcı eylemleri | Import/export/rapor | Veri sözleşmesi |
|---|---|---|---|---|---|
| App.jsx | dashboard / manual / periodic / kesif / ges / proposal / saved + iç modüller | 15 özgün ana sekme; entegrasyonda kontrol+admin ile 17 | Ürün/fiyat istatistikleri; marka/kategori/kaynak/fiyat aralığı/arama/sıralama; YG müşteri–tesis tipi–güç–bölge–sektör formu; EMO parametreleri/direk tipleri/iskonto; TRY/USD/EUR ve manuel kur; periyodik teklif müşteri/güç/alan/topraklama/paratoner/RCD; GES ev/ticari hazır satırlar ve özel malzeme; satır ekle/sil/adet/fiyat; teklif arşivi tür filtreleme ve tekrar açma. | YG PDF/Word/Excel/yazdır/e-posta taslağı; GES PDF; periyodik teklif PDF; rapor düzenleme ve HTML; logo yükleme; keşif Excel giriş/çıkış (eski gömülü keşif UI pasif, aktif bileşen KesifMetraj). | proposals; fiyat/catalog metadata; favoriler, son kullanılanlar ve teklif taslakları |
| BordroTakip.tsx | bordro | Özet / Detay / Geçmiş ay bordrosu | Dönem önceki/sonraki ay; personel ekle/düzenle/pasifleştir; ad/kimlik/ödenecek ücret/kayıtlı ücret ve portal çalışan hesabı eşlemesi. Özet çalışan tablosu ve hakediş/avans/gider/prim/mesai toplamları. Detay kişi seçimi; günlük durum, giriş/çıkış, mesai, açıklama; boş günleri doldurma; Avans/Gider/Prim ve taksit planı; kayıt silme; logo; yenile; aylık özet kaydet; yıl/ay tarihçe sorgula; değişiklik tarihçesi; kurtarma ve eksik gün kontrolü. | Özet XLSX; tek kişi PDF (günlük puantaj ve giderler dahil); toplu çok sayfalı PDF; XLS/XLSX personel içe aktarma; resim/logo yükleme. | bordro_employees, bordro_daily_logs, bordro_expenses, monthly_payroll_summary; memory/server privateStorage yedekleri |
| BeyazYakaBordro.tsx | beyaz-yaka | Özet / Detay; eski avans planları alt listesi | Çalışan ekle/düzenle/pasifleştir; portal hesabı bağla; kimlik, iletişim, pozisyon, departman, işe başlama, temel/brüt ücret, SGK tabanı, banka/IBAN. Kişi/dönem seçimi; temel ücret, mesai, prim, yemek, ulaşım, diğer kazançlar; SGK/işsizlik/gelir/damga/avans/diğer kesinti alanları; işveren maliyeti ve net; çalışma günü; Avans/Gider/Prim/taksit ekle/sil; eski avans dönemine git; sürüm çakışması ve yeniden yükleme; kaydet. | Kişisel ücret hesap özeti PDF; çalışan özet XLSX. Dosya içe aktarma aktif değil; Upload ikonu kullanılmayan import. | beyaz_yaka_employees, beyaz_yaka_monthly_payroll, beyaz_yaka_advances, users |
| GorevTakip.jsx | gorev | Görev listesi + görev form modalı | Başlık/açıklama, başlangıç/bitiş, durum, öncelik, sorumlu, notlar; ekle/düzenle/sil; arama/durum/öncelik filtreleri; durum/öncelik rozetleri. | Aktif dosya import/export yok. | gorevler |
| IsTakip.jsx | is-takip | Kayıtlar / Çalışanlar / Lokasyonlar / Malzemeler | İş: kişi, lokasyon, tarih, giriş/çıkış, iş açıklaması, malzeme seçimi/miktarı, notlar; süre toplamı. Çalışan ad/iletişim/pozisyon; lokasyon ad/adres/koordinat; malzeme ad/kategori/birim/stok/durum. Dört sekmede ayrı ekle/düzenle/sil ve formlar; kayıt filtreleri. | İş kayıtları XLSX/PDF; logo rapora eklenir. Aktif dosya import yok. | is_takip_kayitlar, is_takip_calisanlar, is_takip_lokasyonlar, is_takip_malzemeler |
| UrunTakip.jsx | urun-takip | Envanter liste + ürün form modalı | Ürün adı/kategori/marka/model/seri/miktar/birim/lokasyon/tarih/notlar; ekle/düzenle/sil; arama/kategori/marka/lokasyon filtreleri; stok toplamları ve DB hata/boş durum. | Envanter PDF; aktif dosya içe aktarma yok. | urun_takip |
| AkaryakitTakip.jsx | akaryakit | Aylık görünüm + kayıt formu + PDF önizleme | Plaka/sürücü/tarih/toplam tutar/açıklama; yeni kayıt/düzenle/sil; araç/sürücü/tarih/ay filtreleri; toplam tutar ve kayıt sayısı; bağlı araç/sürücü listeleri. | XLSX ve PDF; PDF önizleme/logo. Aktif import yok. | fuel_records, vehicles, drivers |
| KesifMetraj.jsx | kesif | Ürün kataloğu / sepet / senaryo / teklif formu / kayıtlı teklifler / rapor önizleme / ürün formu | Geçmiş fatura fiyatları+kablo kataloğu+hizmetler; arama/kategori; iskonto/kâr/vergiler; satır ekle, adet/açıklama/KDV değiştir, kaldır/birleştir; keşif senaryosu; özel ürün ekle/düzenle/sil; müşteri/ilgili/adres/proje/tarih/geçerlilik; kaydet/yükle/sil; rich-text düzenleme/güvenli yapıştırma; e-posta taslağı ve AI eylemleri. | PDF ve HTML; logo upload; rapor panoya kopya; eski tarayıcı tekliflerini sunucuya aktar. Aktif Excel import original App pasif keşif bölümünde kalmıştır; aktif KesifMetraj akışı ayrıca izlenmeli. | products, proposals, company_documents; privateStorage eski katalog/taslak erişimi |
| Osos.jsx | osos | Rapor / Canlı; kayıtlı rapor / fabrika kıyaslama / KOSBİ / iş takip aktarımı / içe aktarma modalları | Firma/rapor/iletişim/kurulu güç/kontrol uzmanı/tarih/değerlendirme/öneri; ölçüm satırı ekle/sil; aktif/endüktif/kapasitif veriler ve grafikler; logo resim/URL; kaydet/yükle/aç/sil; fabrika seç/kaydet/sil/karşılaştır; KOSBİ kullanıcı seç/veri getir/aktar; iş takip kullanıcı/oturum/görev oluştur; düzenle/sıfırla. | PDF/yazdır/HTML; ölçüm dosyası içe aktarma ve enerji türü/kolon önizlemesi; fabrika JSON; boş ölçüm JSON şablonu; logo; eski OSOS browser kayıtlarını sunucuya aktar. Entegrasyon dış canlı servis olmadan manuel aktarımı korur. | osos_olcumler, company_documents; ölçüm/zaman serileri; harici KOSBİ/work tracker uçları |
| OsosCanliIzleme.jsx | osos > canli | Anlık ölçüm / tarihçe / grafik | Son ölçüm, aktif/reaktif enerji, zaman serisi; yenile; otomatik yenileme; canlı veri toplama aç/kapat; yükleniyor/hata/boş durum. | Aktif dosya export yok. | osos_olcumler |
| HaftalikRaporlama.jsx | haftalik-raporlama | Liste/istatistikler / rapor formu / Excel önizleme / detay grafik / PDF önizleme | Fabrika/tarih filtreleri; cosφ trendi ve durum; yeni/düzenle/sil; hafta aralığı, cosφ/otomatik hesapla/hedef, aktif/reaktif güç, tüketim/maliyet/kompanzasyon/notlar; ilk fabrika kaydı ve önceki hafta değeri; OSOS tablosu yapıştırma; üç enerji dosyasının kolon/enerji türü seçimi; günlük gruplama, grafikte enerji türü değiştir; PDF düzenleme. | Rapor listesi XLSX; rapor PDF ve düzenlenen PDF; Aktif/Endüktif/Kapasitif XLS/XLSX import; grafik ekranı ve görsel upload. | haftalik_raporlar; energyReport normalize/parse helpers |
| PeriyodikKontrol.jsx | kontrol (özgün kontrol.html) | Topraklama ZPKR01 / Elektrik tesisatı görsel+fonksiyon ZPKR02 | Firma/rapor/tarihler/adres/SGK/şebeke/topraklayıcı/cihaz/kalibrasyon/kontrol notları; uzman ve tesis metadata; topraklama nokta/In/eğri/Ia/Ik/ZxRx/limit/RCD akım+süre satırları; görsel kontrol maddeleri; pano/linye/kablo kesiti/In/Ib/Iz/gerilim/sonuç; satır ekle ve değiştirme; ölçüm koordinasyon hesapları; uzman sonuç alanı; kayıtlı raporlar; manuel sonuç/chat/AI. | İki ayrı çok sayfalı kontrol PDF/yazdır; rapor kaydet/aç/sil; logo. Kaynak girişini App periodic teklif sekmesi ile karıştırmayın. | company_documents (reviewed); orijinal client-only rapor state |
| UserProfile.jsx | Profil ve güvenlik | Profil / şifre / zorunlu MFA bilgisi | Ad güncelle; mevcut+yeni+tekrar şifre; yetkili sunucu parola değişimi sonrası oturum kapanışı; doğrulayıcı cihaz kurtarma yönergesi. | Yok. | Sunucu staff kimliği; kullanıcı alanları |
| SimpleAdminPanel.jsx | Yönetim > ?module=admin | Özgün users / bordro + hesap oluştur/düzenle | Kaynakta onay/erişim/rol/bordro yetkisi/kullanıcı ekleme/silme/davet/hesap kurtarma/denetim. Şirket portalında aynı ihtiyaçlar gerçek staff API ile entegre yönetim ekranında çalışır; Supabase/Firebase yönetimi yeniden kurulmaz. | Davet bağlantısı (yetkili gerçek staff API). | users; active deployment uses existing staff admin API |
| SimpleAuth.jsx | Staff PHP kimlik köprüsü | Tek doğrulanmış şirket oturumu | Sunucu bootstrap, approved employee/payroll/admin rolü; oturum tekrar doğrula; çıkış; kendi profil/parola güncelleme; privateStorage yükleme. | Yok. | VGSTAFF HttpOnly cookie + CSRF; hiçbir token/API key frontendde tutulmaz |
| SunucuDurumu.jsx | Ortak bağlantı durumu | Açık / internet yok / sunucu erişimi yok / geri geldi | Otomatik tekrar deneme, online/offline/focus görünürlük kontrolleri; formlar korunur; manuel yeniden dene. | Yok. | Same-origin staff me health check |
| BordroWithPassword.jsx | bordro erişim kapısı | Oturum bekleme / kendi bordrosu | Server approved staff olmadan içerik yok; admin/payroll yönetir, ordinary employee kendi read-only kaydı. Özgün ikinci hard-coded bordro parolası taşınmaz. | BordroTakip üzerinden. | Gerçek useAuth staff bootstrap |
| AuthGate.jsx | Ortak erişim kapısı | Bekleme / session-required / admin-required | Server staff doğrulama; profil ve native bağlantılar; role metadata dışından admin çıkarsaması yok. | Yok. | SimpleAuth |
| PortalNavigation.jsx | Tek şirket uygulaması | 17 module query seçimi; 5 menü grubu (Yönetim admin-only) | Aynı site header/footer altında şirket uygulaması bağlantıları; modül menüsü, arama parametresi, keyboard Escape/focus trap; public Araçlar ayrı /araclar/; server staff Çalışan yönetimi. | Yok. | module query + server user rolü |

## BordroTakip ayrıntılı kabul listesi

- Özet ve personel detay görüntüleri; dönem ileri/geri; yalnız sunucunun izin verdiği kişilerin listesi.
- Personel adı/TC/iki ücret alanı/portal kimliği ekleme-düzenleme ve pasifleştirme; geçmiş ödemeler silinmez.
- Gün tipi: Normal, Pazar, Resmi Tatil, Raporlu, İzinli, Gelmedi. Giriş/çıkış saatleri; mesai; açıklama; boş günlere otomatik doldurma.
- Aylık hakediş, pazar/tatil ödemesi, mesai, devamsızlık, gider, prim, avans ve kalan/net tutar dökümü. Kaynak hesabının varsayımları korunur; resmi bordro teyidi ayrı konudur.
- Avans/Gider/Prim: miktar, tarih, açıklama, toplam/mevcut taksit; devam eden taksitleri geçerli aylara yayma; kayıt silme.
- Günlük kayıt CAS RPC ile beklenen updated_at sürümünü doğrular; aynı güne art arda değişiklikler sıralanır. Başarısız/çakışan kayıt başarılı gösterilmez.
- Aylık özet sadece persisted personel+puantaj+gider satırlarından oluşturulur; kaydedilmemiş puantaj varken özet kapatılmaz.
- Geçmiş yıl/ay bordrosu listesi ve toplamlara erişim; kendi kayıtlarında read-only.
- Özet Excel; tek kişi PDF; toplu PDF; personel Excel import; logo upload/sıfırla.
- Memory/server yedeği, değişiklik tarihçesi, eksik gün gözlem/kurtarma; finans verisi native browser local/sessionStorage içine yazılmaz.
- Own-view ekle/düzenle/sil/kaydet/otomatik doldur/import/kurtar düğmelerini gizler; puantaj alanları disabled; kendi PDF/Excel ve ay okuması korunur.

## BeyazYakaBordro ayrıntılı kabul listesi

- Çalışan listesi, toplam/ortalama ve kişi+dönem detayı; employee için yalnız gerçek staff ID ile bağlı kayıtlar.
- Personel portal hesabı seçimi; ad/TC/email/telefon/pozisyon/departman/işe başlama/temel+brüt ücret/SGK tabanı/banka+IBAN.
- Kazançlar: temel ücret, mesai, prim, yemek, ulaşım, diğer; kesintiler: SGK çalışan, işsizlik çalışan, gelir, damga, avans ve diğer. Net ve işveren maliyeti yeniden hesaplanır.
- Çalışma günü alanı aktiftir. Günlük puantaj/otomatik doldurma helperleri kaynakta tanımlı fakat özgün beyaz yaka JSX ekranına bağlı değildir; veri şeması ve helperler korunur.
- Dönem kaydı, gider/prim/avans ve taksit: tek server transaction/RPC; beklenen sürüm ile çakışma; yerel değişiklik kaybını önleyen yeniden yükleme.
- Eski avans planları ve plana bağlı döneme gitme; planlı taksit ile persisted avans kesintisi ayrımı.
- Personel hesap özeti PDF; özet XLSX. Çıktıda resmi bordro doğrulaması gereken vergi/SGK varsayımları açıkça tanımlıdır.
- Server role admin/payroll yönetir; employee alanları readonly; hiçbir NULL user_id kaydı veya e-posta client-side admin rolü vermez.

## Özgün girişlerin yeni karşılığı

| Özgün entry | Yeni karşılık |
|---|---|
| index.html / main.jsx | /calisan/uygulama/ |
| bordro.html | ?module=bordro |
| beyaz-yaka.html | ?module=beyaz-yaka |
| osos.html | ?module=osos |
| akaryakıt.html | ?module=akaryakit |
| kontrol.html | ?module=kontrol (tam rapor; periodic teklif değildir) |
| admin.html | ?module=admin (admin-only) |

## Auth/yardımcı dosyaların kapsamı

- SimpleAppWithAuth aktif wrapper; PortalNavigation/AuthGate gerçek staff kimliği ile çalışır.
- SimpleLogin/SimpleRegister/ForgotPassword eski ayrı auth akışları; şirket etkinleştirme+zorunlu TOTP ve native giriş ekranı bunların yerine geçer.
- AppWithAuth/AuthContext/Login/Register/AdminPanel/firebase.js legacy Firebase ailesi; şirket bundle'ının etkin girişine bağlanmaz, yetki kaynağı olmaz.
- MfaSettings yalnız zorunlu doğrulama durumu/kurtarma yönergesi; eski SDK enable/disable ve /portal/session akışı kaldırılır.
- activityLogger aktör bilgisi gerçek server oturumundan belirlenir; frontend supplied actor otorite değildir.
- pdfReport, safeReportHTML, proposalSnapshots, operations, energyReport, payrollPersistence, historicalCatalog reviewed hesap/rapor/import güvenliği yardımcılarıdır; bağımsız menü modülü değildir.
- companyDocuments rapor arşivi ve CAS sözleşmesi; privateStorage kullanıcıya özel server-backed memory arayüzü; supabaseClient same-origin PHP query/RPC köprüsüdür.
- companyInfo sabit kurumsal metinler; katalog/fatura JSON runtime özel katalog bootstrap üzerinden gelir, herkese açık bundle içine alınmaz.

## Özgün kaynakta gözlenen sorunlar ve entegrasyon şartları

1. BordroWithPassword ./BordroTakip.jsx import ederken gerçek dosya .tsx; kopyada doğru import kullanılır.
2. Vite özgün çoklu giriş listesinde akaryakıt.html eksik; tek portal modülünde bu giriş kaybolmaz.
3. Beyaz yaka eski kaynak NULL user_id varlığını admin yetkisi sayar; ordinary tüm aktif kişileri indirip yalnız maaşı maskeler. Rol/ownership backendten doğrulanır, own-only server predicate zorunlu.
4. Yalnız UUID kabulü gerçek staff s+24hex ID ile eşlemeyi kaybettirir; staff kimliği ve legacy UUID biçimlerine yalnız account ID alanlarında uyum gerekir.
5. Özgün white-collar varsayılan vergi/SGK hesabı sabit ve basitleştirilmiştir; güncel resmi bordro olarak sunulamaz. Reviewed sürüm persisted dönemin tutarlarını esas alır.
6. Özgün white-collar loadPayroll/loadAdvances yarışır; gider ve eski avans iki ayrı write ile tutulur, silme geride plan bırakabilir. Reviewed atomic RPC ve dönem sürüm sözleşmesi korunmalı.
7. Blue source daily upsert çağrısı protected backendte yasaktır; günlük kayıt ve kurtarma app_bordro_daily_log_save CAS üzerinden yapılır. SQL/RLS kapatma yönlendirmesi taşınmaz.
8. Özgün localStorage tüm mali kayıtları, yedekleri ve kullanıcı profilini browserda saklar. Private bridge memory-only; server ownership/güvenli oturum ve pending-save hata bildirimi gerekir.
9. Özgün admin kontrollerinde literal email ve ikinci şifre/onay kodları yetki yerine kullanılır; native server staff roles tek otorite.
10. Özgün SunucuDurumu private Supabase URL/API key health ping, MFA /portal/session ve Firebase/Supabase ayrı girişler şirket PHP portalıyla uyuşmaz.
11. Kaynakta sabit UI metin bozuklukları (Özet, Eylül, Çalışan, doğrulama gibi) bulunur; gerçek kayıt değerleri değiştirilmez.
12. Orijinal App içindeki false && kesif_old ve kullanılmayan viewMode/showHistoryModal state gerçek aktif özellik sayılmaz. BeyazYaka handleLogChange/fillMonthDefaults yalnız bildirimde geçer; günlük puantaj helperleri aktif JSX kontrollerine bağlı değildir; dosya bazındaki fonksiyonlar aşağıda yine izlenir.
13. Harici KOSBİ/work tracker canlı çağrıları kaynakta mevcuttu; kullanıcı tercihiyle bu sürümde düğmeleri disabled ve ağ çağrıları kapalıdır. Dosya içe aktarma ve kayıtlı ölçümlerin 5 saniyede yenilenmesi aktiftir. AI için ayrıca private server integration/config gerekir. Endpoint yokken örnek veriyle başarı üretilmez; manuel form/import/export korunur.

## Kaynak fonksiyon/event izlenebilirliği

Aşağıdaki liste gerçek veri dosyaları açılmadan yalnız kaynak bildirimi ve JSX event bağlantılarından çıkarılmıştır. İnceleme sırasında tanımlanan fonksiyon her zaman etkin düğme anlamına gelmez (ör. false && eski keşif bölümü).

### activityLogger.js

JSX bağlantıları: 0 onClick, 0 onChange, 0 form, 0 file input.

Fonksiyonlar: Entry / tanım dosyası.

### admin.jsx

JSX bağlantıları: 0 onClick, 0 onChange, 0 form, 0 file input.

Fonksiyonlar: Entry / tanım dosyası.

### AdminPanel.jsx

JSX bağlantıları: 7 onClick, 0 onChange, 0 form, 0 file input.

Fonksiyonlar: AdminPanel, fetchUsers, approveUser, rejectUser, revokeApproval, formatDate.

### AkaryakitTakip.jsx

JSX bağlantıları: 11 onClick, 10 onChange, 1 form, 0 file input.

Fonksiyonlar: getCurrentMonth, loadData, handleSubmit, handleDelete, handleEdit, resetForm, exportToExcel, exportToPDF, loadLogo.

### akaryakıt-main.jsx

JSX bağlantıları: 0 onClick, 0 onChange, 0 form, 0 file input.

Fonksiyonlar: Entry / tanım dosyası.

### App.jsx

JSX bağlantıları: 115 onClick, 91 onChange, 2 form, 2 file input.

Fonksiyonlar: App, loadAllProposals, parsePower, saveProposal, loadProposal, deleteProposal, saveYGProposal, savePeriodicProposal, saveKesifProposal, saveGESProposal, loadDefaultGESPackage, loadCommercialGESPackage, addNewGESRow, removeGESRow, updateGESItem, calculateGESTotals, formatMoney, handleGESPDFExport, loadLogo, addToRecentProducts, toggleFavorite, isFavorite, addFavoriteToKesif, parseQuickAddText, handleQuickAdd, calculateSellingPrice, addWithProfitMargin, handleExcelImport, findColumn, saveCurrentQuotation, loadSavedQuotation, deleteSavedQuotation, applyProfitMarginToAll, addProductToKesif, removeProductFromKesif, updateProductQuantity, updateProductPrice, updateProductName, updateProductDetail, applyBulkPriceAdjustment, removeSelectedProducts, duplicateProduct, addHazirPaketToKesif, calculateKesifTotals, callGeminiAPI, handleAiWizard, handleGenerateProposalEmail, handleKesifSubmit, calculatePeriodicPrices, handleCurrencyChange, formatCurrency, formatNumber, calculateCompanyFees, generateProposal, handleDownloadPDF, handleDownloadWord, createTableRow, handlePrint, handleManualSubmit, handleRegionChange, handleLogoUpload, handleGeminiCall, copyToClipboard, handleExcelExport, handleSendEmail, toggleEditorMode, toggleGesEditorMode, togglePeriodicEditorMode, handlePeriodicPDFExport, handleAdvancedPDFExport.

### AppWithAuth.jsx

JSX bağlantıları: 1 onClick, 0 onChange, 0 form, 0 file input.

Fonksiyonlar: AuthWrapper, AppWithAuth.

### AuthContext.jsx

JSX bağlantıları: 0 onClick, 0 onChange, 0 form, 0 file input.

Fonksiyonlar: signOut.

### AuthGate.jsx

JSX bağlantıları: 2 onClick, 0 onChange, 0 form, 0 file input.

Fonksiyonlar: anaSayfayaGit, Kapi.

### beyaz-yaka-main.jsx

JSX bağlantıları: 0 onClick, 0 onChange, 0 form, 0 file input.

Fonksiyonlar: Entry / tanım dosyası.

### BeyazYakaBordro.tsx

JSX bağlantıları: 20 onClick, 33 onChange, 0 form, 0 file input.

Fonksiyonlar: formatCurrency, getDaysInMonth, getDayName, isWeekend, calculateTaxesAndDeductions, isValidUUID, BeyazYakaBordro, checkUserAuth, maskSalary, canViewDetails, loadAvailableUsers, handleUserSelect, loadEmployees, loadPayrollData, createDefaultPayroll, loadAdvances, saveEmployee, savePayroll, saveAdvance, deleteExpense, handleLogChange, saveDailyLog, fillMonthDefaults, deleteAdvance, deleteEmployee, updatePayrollField, changeMonth, exportToPDF, exportSummaryToExcel, resetEmployeeForm, resetAdvanceForm, showMessage.

### bordro-main.jsx

JSX bağlantıları: 0 onClick, 0 onChange, 0 form, 0 file input.

Fonksiyonlar: Entry / tanım dosyası.

### BordroTakip.tsx

JSX bağlantıları: 33 onClick, 17 onChange, 0 form, 2 file input.

Fonksiyonlar: formatCurrency, getDaysInMonth, getDayName, isWeekend, calculateEmployeeStats, saveToLocalStorage, loadFromLocalStorage, createAutoBackup, restoreFromBackup, verifyDeleteCode, logChange, checkDatabaseChanges, restoreMissingLogs, createDataSnapshot, showChangeHistory, loadEmployees, loadMonthlyData, saveEmployee, deleteEmployee, saveDailyLog, saveExpense, deleteExpenseFromDB, deleteDailyLog, saveMonthlyPayroll, loadHistoricalPayroll, handleBeforeUnload, loadAllData, handleLogChange, addExpense, handleAdvanceSubmit, deleteExpense, fillMonthDefaults, openAddModal, openEditModal, goToDetail, exportToExcel, exportSinglePDF, exportAllPDF, importFromExcel.

### BordroWithPassword.jsx

JSX bağlantıları: 1 onClick, 1 onChange, 1 form, 0 file input.

Fonksiyonlar: handleSubmit, handleLogout.

### ForgotPassword.jsx

JSX bağlantıları: 2 onClick, 1 onChange, 1 form, 0 file input.

Fonksiyonlar: ForgotPassword, generateTempPassword, handleSubmit.

### GorevTakip.jsx

JSX bağlantıları: 6 onClick, 11 onChange, 0 form, 0 file input.

Fonksiyonlar: GorevTakip, loadGorevler, filterGorevler, saveGorev, deleteGorev, editGorev, resetForm, getDurumInfo, getOncelikInfo.

### HaftalikRaporlama.jsx

JSX bağlantıları: 28 onClick, 24 onChange, 1 form, 4 file input.

Fonksiyonlar: loadData, handleImageUpload, calculateCosPhi, groupDataByDay, parseNumber, parseExcelDate, findColumnValue, parseExcelRows, getTotalConsumption, getPdfPageCount, setAnalyticsDataset, openReportAnalytics, handleExcelUploadAktif, handleExcelUploadEnduktif, handleExcelUploadKapasitif, parseOsosTable, parts, handleOsosTablePaste, applyExcelDataToForm, handleSubmit, handleEdit, handleDelete, resetForm, formatDate, handleYeniRapor, exportToExcel, exportToPDF, handlePDFDownload, getDurum, getTrend.

### IsTakip.jsx

JSX bağlantıları: 24 onClick, 23 onChange, 4 form, 0 file input.

Fonksiyonlar: loadData, calculateTotalSure, handleSubmit, handleEdit, handleDelete, resetForm, handleCalisanSubmit, handleCalisanEdit, handleCalisanDelete, handleLokasyonSubmit, handleLokasyonEdit, handleLokasyonDelete, handleMalzemeSubmit, handleMalzemeEdit, handleMalzemeDelete, exportToExcel, exportToPDF, loadLogo.

### KesifMetraj.jsx

JSX bağlantıları: 40 onClick, 30 onChange, 0 form, 1 file input.

Fonksiyonlar: KesifMetraj, isServiceItem, categorize, loadProductsFromSupabase, saveProduct, deleteProduct, calculateDiscountedPrice, addToCart, updateQuantity, updateItemDescription, updateItemKdv, removeFromCart, copyToClipboard, applyScenario, saveTeklif, loadSavedTeklifler, loadTeklif, deleteTeklif, callGemini, callGeminiText, handleAiEstimation, handleGenerateEmail, generatePDF, generateSimplePDF, generateHTMLPDF, handleLogoUpload.

### kontrol-main.jsx

JSX bağlantıları: 0 onClick, 0 onChange, 0 form, 0 file input.

Fonksiyonlar: Entry / tanım dosyası.

### Login.jsx

JSX bağlantıları: 1 onClick, 2 onChange, 1 form, 0 file input.

Fonksiyonlar: Login, handleChange, handleSubmit.

### main.jsx

JSX bağlantıları: 0 onClick, 0 onChange, 0 form, 0 file input.

Fonksiyonlar: Entry / tanım dosyası.

### osos-main.jsx

JSX bağlantıları: 0 onClick, 0 onChange, 0 form, 0 file input.

Fonksiyonlar: Entry / tanım dosyası.

### Osos.jsx

JSX bağlantıları: 37 onClick, 40 onChange, 0 form, 3 file input.

Fonksiyonlar: handleInputChange, handleMeasurementChange, addMeasurement, removeMeasurement, handleLogoUpload, handleLogoUrlChange, removeLogo, raporuKaydet, raporlariYukle, kayitliRaporuAc, kayitliRaporuSil, printReport, exportPDF, resetForm, addKosbiUser, removeKosbiUser, fetchKosbiData, importKosbiData, handleExcelImport, saveDirectOSOSData, tesbitEnerjiTipi, importExcelData, islenenVeriHazirla, loginToWorkTracker, fetchWorkTrackerUsers, fabrikaVeriYukle, fabrikaSil, tumFabrikalariKarsilastir, exportHTMLReport, createWorkTrackerTask, createTaskFromReport.

### OsosCanliIzleme.jsx

JSX bağlantıları: 5 onClick, 0 onChange, 0 form, 0 file input.

Fonksiyonlar: OsosCanliIzleme, loadData, fetchLiveData, toggleLiveCollection.

### PeriyodikKontrol.jsx

JSX bağlantıları: 9 onClick, 29 onChange, 1 form, 0 file input.

Fonksiyonlar: callGeminiAPI, delay, calculateIa, calculateLimit, checkCableCoordination, loadLogo, handleCommonChange, handleGroundingChange, addGroundingRow, handleCircuitChange, addCircuitRow, printReport, getReportSummary, generateAIConclusion, handleChatSubmit, Header, InputSection, GroundingReportTemplate, VisualReportTemplate.

### Register.jsx

JSX bağlantıları: 1 onClick, 5 onChange, 1 form, 0 file input.

Fonksiyonlar: Register, handleChange, handleSubmit.

### SimpleAdminPanel.jsx

JSX bağlantıları: 16 onClick, 13 onChange, 3 form, 0 file input.

Fonksiyonlar: SimpleAdminPanel, loadUsers, approveUser, toggleBordroAccess, deleteUser, revokeApproval, changeUserRole, generateRandomPassword, sendLoginCredentials, openEditUser, updateUser, createNewUser, formatDate, handleAdminLogin.

### SimpleAppWithAuth.jsx

JSX bağlantıları: 5 onClick, 0 onChange, 0 form, 0 file input.

Fonksiyonlar: AuthWrapper, SimpleAppWithAuth.

### SimpleAuth.jsx

JSX bağlantıları: 0 onClick, 0 onChange, 0 form, 0 file input.

Fonksiyonlar: profilGetir, yerelKayitTemizle, signIn, signOut, register, updateUser, changeOwnPassword, deleteAccount.

### SimpleLogin.jsx

JSX bağlantıları: 2 onClick, 2 onChange, 1 form, 0 file input.

Fonksiyonlar: SimpleLogin, handleChange, handleSubmit.

### SimpleRegister.jsx

JSX bağlantıları: 1 onClick, 5 onChange, 1 form, 0 file input.

Fonksiyonlar: SimpleRegister, handleChange, sendApprovalEmail, handleSubmit.

### SunucuDurumu.jsx

JSX bağlantıları: 1 onClick, 0 onChange, 0 form, 0 file input.

Fonksiyonlar: sunucuAcikMi, hemen, gorunurluk.

### UrunTakip.jsx

JSX bağlantıları: 12 onClick, 14 onChange, 0 form, 0 file input.

Fonksiyonlar: UrunTakip, loadUrunler, handleAddOrUpdate, handleDelete, handleEdit, resetForm, exportToPDF.

### UserProfile.jsx

JSX bağlantıları: 5 onClick, 5 onChange, 1 form, 0 file input.

Fonksiyonlar: UserProfile, handleChange, handleSubmit, handleDeleteAccount.


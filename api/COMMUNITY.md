# VoltGuard Topluluk API

`/topluluk/` herkesin okuyabildiği, üyelik olmadan da yorum ve yanıt yazabildiği alandır.
Bu alan şirket çalışanı yetkisi vermez; şirket, bordro ve personel dosyaları içermez.

## Sunucu ve veri

PHP 7.4+ yeterlidir. `/api/community.php` mevcut `/api/auth.php` üyeliğini, `VGSESS` oturumunu,
şifre değişiminde iptal edilen oturum sürümünü ve aynı CSRF/Origin denetimlerini kullanır.
Yerel yalnız statik önizlemede API çalışmaz; PHP destekleyen önizleme veya cPanel gerekir.

Veri, `vg_data_dir()/community/` içinde `comments.json`, `moderators.json` ve `store.lock` ile saklanır.
**Veri klasörü DOCUMENT_ROOT dışında olmalıdır.** İçeride çözülen bir gerçek yol veya bağlantı
API'yi 503 ile kapatır. Önerilen cPanel yolu `/home/voltgua2/vg-data`; gerekirse `VG_DATA_DIR` ayarlayın.
Veriler `api/` içine yazılmaz ve deploy ile silinmez. Dosya izinleri 0600, klasörler 0700'dür.
Tüm yazmalar tek kilitte yapılır; canlı JSON dosyası kesilmez, geçici dosya atomik olarak değiştirilir.
Kilit veya yazma hatasında istek başarısız olur. Bozuk veri sessizce boş listeye dönüştürülmez.

Yedeklerken `vg-data/community/` dizinini de yedekleyin. Günlükler yorum veya kişisel bilgi içermez.

## Uç noktalar

Yanıt zarfı mevcut üyelik API'siyle aynıdır: `api: "vg-auth/1"`, `ok: true|false`;
başarılı topluluk yanıtları ayrıca `service: "vg-community/1"` içerir.

| İşlem | Yöntem | İstek | Sonuç |
| --- | --- | --- | --- |
| `list` | GET | `?action=list&limit=20&before=c_…` | `items`, `nextBefore`, `canPublish:true`, `moderator`, `csrf` |
| `publish` | POST | `{message, authorName?, parentId?:null|"c_…", website?:""}` | 201 ve `item` |
| `delete` | POST | `{id:"c_…"}` | `{id,deleted:true}` |

Yazmalar `Content-Type: application/json`, oturum çerezi ve `X-VG-CSRF` başlığı gerektirir.
CSRF jetonu topluluğun `list` yanıtından veya `/api/auth.php?action=me` ile alınır;
giriş/kayıt ardından dönen yeni jeton kullanılır. Misafir oturumu da sunucuda oluşturulur:
tarayıcıdaki isim, localStorage veya istemcinin gönderdiği kimlik oturum yetkisi vermez.
Başka kaynaktan tarayıcı isteği, yetkisiz silme ve desteklenmeyen alanlar reddedilir.
POST gövdesi en fazla 16 KiB; yorum 2–2000 karakterdir.

`items` en yeni yorumdan başlayarak sıralanır. Her kayıt şu alanları içerir:
`id, parentId, authorName, authorType, message, createdAt, deleted, canDelete`.
Üye yazar adı kayıtlı hesaptan okunur; üyenin gönderdiği `authorName` dikkate alınmaz.
Misafir `authorName` alanı 2–60 karakter olmalıdır; yorumda `authorType:"guest"` döner.
Bu görünen adın kimlik doğrulaması yapılmış değildir; arayüz ziyaretçi etiketiyle belirtir.
`authorType:"member"` normal üyeliği ifade eder ve şirket çalışanı yetkisi anlamına gelmez.
E-posta, telefon,
kullanıcı kimliği, şirket bilgisi ve parola özeti topluluk yanıtlarına eklenmez.
Sayfa boyutu 1–50; sonraki sayfada `before=nextBefore` kullanılır. Geçersiz kimlik 422,
artık bulunmayan sayfa işaretçisi 409 döner. Toplam yorum sayısı yayımlanmaz.

HTML ve Markdown yorumlarda **yorumlanmaz**. İstemci `message` ve `authorName` için
`textContent` kullanmalıdır; `innerHTML` yasaktır. Satır sonları CSS `white-space: pre-wrap` ile gösterilebilir.
Yanıtlar üç seviyeye kadar desteklenir. Silinmiş yoruma yeni yanıt verilemez.

Misafir aynı anonim sunucu oturumunda kendi yorumunu; üye kendi yorumunu;
sunucudan atanmış moderatör herkesin yorumunu silebilir. Misafir aktörü rastgele 192 bit kimlikle
sunucu oturumunda tutulur; API'ye gönderilmez. Tarayıcı oturumu kapanınca, çerez silinince
veya giriş yapılarak oturum kimliği yenilenince eski misafir yorumunun sahipliği taşınmaz.
Bu durumda silme için site yönetimine başvurulur.
Silmede yorum metni ve yazar kimliği dosyadan çıkarılır; yanıtların bağını korumak için
kimlik, tarih ve `deleted:true` işaretinden oluşan boş kayıt tutulur. Silinmiş üyelerin
yorumlarında hesap adı yerine `Silinmiş üye` gösterilir. Toplulukta yayımlanan metin,
kişisel hesap koleksiyonlarından ayrıdır; kullanıcı kendi yorumlarını silmelidir.

## İstenmeyen içerik sınırları

- Üye veya misafir oturumu: 15 saniyede 1, 15 dakikada 10, 24 saatte 40 yorum.
- IP (IPv6 /64): saatte 30 yorum; normal liste okuma dakikada 120 istek.
- Aynı üye/misafir oturumu aynı metni aynı yanıta 24 saat içinde yeniden gönderemez.
- Silme: kullanıcı başına dakikada 30.
- En fazla 5000 yorum/boş silme kaydı ve 20 MiB veri; dolunca sessiz silme yapılmaz, 422 döner.

Yazma sınırları yorumla aynı kalıcı kilitte tutulur ve depolama başarısız olduğunda yazma açılmaz.
IP/kullanıcı hız sayaçlarının anahtarı kuruluma özel HMAC'tir. 429 yanıtta `Retry-After` ve `retryAfter` bulunur.
Yönetim için veri kapasitesi, yedekler ve moderasyon süreçleri düzenli izlenmelidir.

## Moderatör atama

Herkes normal üyelik oluşturabilir; hiç kimse kayıt, profil veya e-posta alan adı yoluyla
kendine moderatör/çalışan yetkisi veremez. Varsayılan moderatör listesi boştur.
Yetki sadece sunucu terminalindeki, HTTP üzerinden çalışmayı reddeden araçla atanır:

```sh
# Sunucuda proje kaynak dizininde; API ile aynı VG_DATA_DIR zorunludur.
export VG_DATA_DIR=/home/voltgua2/vg-data
php tools/community-admin.php grant u0123456789abcdef01234567
php tools/community-admin.php revoke u0123456789abcdef01234567
php tools/community-admin.php list
```

Kimlik mevcut üyelik hesabının gerçek kimliğidir; örnek kimlik hesap oluşturmaz.
`tools/` web erişimine kapalıdır ve araç ayrıca `PHP_SAPI === 'cli'` şartını denetler.
Bu CLI dosyasını yönetim makinesinde/proje kaynaklarında tutun; public_html'e koymayın.
Yetki geri alındığında sonraki istekte hemen uygulanır; istemcideki düğme yetki kanıtı değildir.

## Geliştirme doğrulaması

`node tools/tests/community-api.test.cjs`, gerçek PHP HTTP sunucusuyla ayrı geçici veri dizininde
kontrol yapar; önizleme/canlı verisine kayıt eklemez. PHP yürütücüsü `VG_PHP` ile seçilebilir;
yerel varsayılan `.qa/php/runtime/php.exe` dosyasıdır ve depoya dahil edilmez.
Denetimler: bağımsız misafirler, sahiplik, CSRF/Origin, sahte yetki/ad, metin sınırı,
yanıt/sayfalama, hız sınırı, moderatör atama/geri alma, CLI web erişimi ve bozuk veri halinde kapanma.

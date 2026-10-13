'use strict';
// ============================================================================
// PARALAKS: TEK HAT — templates/ch3.js : Bölüm 3 "Fabrika" (AG motor kontrol, kumanda devreleri, kompanzasyon)
// şablonları, KURAL SÜRÜMÜ 4 (fiziksel dünya). Sahip: Bölüm 3 seviye tasarımcısı. Biçim: templates2.js başlığı,
// templates/README.md ve spec §19/§25. gen2.js bu dosyayı templates2.js'ten sonra yükler.
// Kural sürümü 3'ün izdüşüm seçicisi (kafa) elemanları sahada gerçek cihazlara çevrildi; her şablon yayımlanan
// seviyenin elektrik şemasıdır (base) ve aynı W×D sahasıyla seviye dosyasından tohumlanabilir:
//   node tools/reference2/gen2.js ters_yon 7 120 out.json tools/reference2/levels/ch3.js#F3
//  muhurleme_fiz  3.1 F1  START + NA 13-14 mühürleme, kumanda MCB'si, aydınlatma ayırıcısı (templates2.muhurleme'nin
//                         yayımlanan başlangıç durumu: MCB açık, aydınlatma fider kesicisi kapalı)
//  ters_yon       3.2 F3  ileri/geri yol verme, NK 21-22 kilitleme, fan izin kontağı, fider ayırıcısı (ön kesme yardımcı
//                         kontağı) + Q11 kilitlemeli koruyucu kafes kapısı, hat acil STOP / bant kumanda MCB'si ödünleşimi
//  pompa_ist      3.3 F4  kumanda barası TR-K1 -> TR-K2 aktarımı (bıçaklı ayırma klemensleri), mühürsüz kompanzasyon
//                         kontaktörü, deşarj
//  kademe_sigorta 3.4 F2  üç kademe, NH sigorta değişimi, B bölümü giriş ayırıcısı, tek kesintide iki iş
//  kademe_is      3.5 F5  kademe bakımı (LOTO + topraklama + deşarj), konveyör fider ayırıcısı, yaklaşma bölgesi
//  yildiz_ucgen   3.6 F6  yıldız-üçgen (KM/KY/KD, NK kilitleme, geçiş anahtarı), acil aydınlatmanın UPS'ten şebekeye
//                         senkronsuz geri alınması
//  fabrika_sinav  3.7 F7  kumanda trafosu-1 bakımı: iki taraftan ayır, iki topraklama, Q0T kilitlemeli trafo odası
//                         kapısı, senkron olmayan yedek hattan TR-K2, izin kontaklı kompanzasyon
// Kumanda devreleri 230 V (kv 0.23); kontaktör bobini yük sayılmaz, kumanda devresindeki anahtar akım taşımaz.
// ============================================================================
module.exports = {
  // 3.1 Mühürleme (F1) — yayımlanan seviye: tools/reference2/levels/ch3.js#F1
  muhurleme_fiz: {
    ch: 3, W: 6, D: 6, MAXH: 3, minPar: 4, maxPar: 16, sinif: "ogretici", saha: "asma_kat",
    base: {
      dugum: {"g":{},"m":{},"mot":{},"k0":{"kv":0.23},"k1":{"kv":0.23},"k2":{"kv":0.23},"coil":{"kv":0.23},"lx":{},"lmp":{}},
      el: [
        {"id":"G1","t":"kaynak","dugum":"g","ad":"Pano beslemesi (fabrika AG dağıtımı)"},
        {"id":"Q01","t":"kesici","a":"g","b":"m","I":9,"ad":"Pompa istasyonu panosu ana kesicisi"},
        {"id":"T1","t":"trafo","a":"m","b":"k0","ad":"Kumanda trafosu 400/230 V"},
        {"id":"Q09","t":"kesici","a":"k0","b":"k1","I":2,"ad":"Kumanda devresi MCB (açma eşiği 2)"},
        {"id":"S0","t":"buton","a":"k1","b":"k2","ad":"Pompa STOP butonu (NK)","nc":true},
        {"id":"S1","t":"buton","a":"k2","b":"coil","ad":"Pompa START butonu (NA)"},
        {"id":"K1","t":"kontaktor","a":"m","b":"mot","bobin":"coil","ad":"Pompa kontaktörü (AC-3)"},
        {"id":"K1A","t":"yardimci","a":"k2","b":"coil","ait":"K1","ad":"Mühürleme kontağı (NA 13-14)"},
        {"id":"Y1","t":"yuk","dugum":"mot","ad":"Arıtma pompası","d":1,"w":2},
        {"id":"Q02","t":"kesici","a":"m","b":"lx","I":9,"kapali":true,"ad":"Aydınlatma fider kesicisi"},
        {"id":"Q12","t":"ayirici","a":"lx","b":"lmp","ad":"Pompa istasyonu aydınlatma ayırıcısı"},
        {"id":"Y2","t":"yuk","dugum":"lmp","ad":"Pompa istasyonu aydınlatması","d":1,"w":1},
      ],
    },
    cells: ["T1","Q12","K1","Q02","Q09","Y2","S1","S0","Y1","Q01","G1"],
    essential: ["noAyiriciKurali"],
  },
  // 3.2 Karşılıklı Kilitleme (F3) — yayımlanan seviye: tools/reference2/levels/ch3.js#F3
  ters_yon: {
    ch: 3, W: 7, D: 7, MAXH: 3, minPar: 10, maxPar: 30, sinif: "cekirdek", saha: "asma_kat", work: true,
    base: {
      kilit: 1,
      is: {"bolge":[],"ad":"Sıkışan koliyi bandın üstünden al"},
      dugum: {"g":{},"m":{},"mf":{},"mot":{},"lx":{},"fan":{},"k0":{"kv":0.23},"k1":{"kv":0.23},"k2":{"kv":0.23},"k3":{"kv":0.23},"k4":{"kv":0.23},"k5":{"kv":0.23},"sf":{"kv":0.23},"sr":{"kv":0.23},"cf":{"kv":0.23},"cr":{"kv":0.23},"cv":{"kv":0.23}},
      hedef: {"yukler":["Y1","Y2"],"kapali":["KR"],"acik":["KF"]},
      el: [
        {"id":"G1","t":"kaynak","dugum":"g","ad":"Fabrika trafosu AG (MCC beslemesi)"},
        {"id":"Q01","t":"kesici","a":"g","b":"m","I":9,"kapali":true,"ad":"Motor kontrol panosu (MCC) ana kesicisi"},
        {"id":"Q11","t":"ayirici","a":"m","b":"mf","kapali":true,"ad":"Konveyör fider ayırıcısı (kilitlenebilir)"},
        {"id":"KF","t":"kontaktor","a":"mf","b":"mot","bobin":"cf","ad":"İleri yön kontaktörü KF (AC-3)","kapali":true},
        {"id":"KR","t":"kontaktor","a":"mf","b":"mot","bobin":"cr","ad":"Geri yön kontaktörü KR (AC-3)"},
        {"id":"Y1","t":"yuk","dugum":"mot","ad":"Konveyör bandı motoru","d":1,"w":2},
        {"id":"Q02","t":"kesici","a":"m","b":"lx","I":9,"kapali":true,"ad":"Toz emme fanı motor koruma şalteri"},
        {"id":"KV","t":"kontaktor","a":"lx","b":"fan","bobin":"cv","ad":"Toz emme fanı kontaktörü KV (AC-3)","kapali":true},
        {"id":"Y2","t":"yuk","dugum":"fan","ad":"Toz emme fanı","d":1,"w":1},
        {"id":"T1","t":"trafo","a":"m","b":"k0","ad":"Kumanda trafosu 400/230 V"},
        {"id":"Q09","t":"kesici","a":"k0","b":"k1","I":2,"kapali":true,"ad":"Kumanda devresi MCB (açma eşiği 2)"},
        {"id":"S9","t":"buton","a":"k1","b":"k2","ad":"Hat acil STOP (NK): bant ve fan birlikte durur","nc":true},
        {"id":"S2","t":"buton","a":"k2","b":"cv","ad":"Toz emme fanı START (NA)"},
        {"id":"KVA","t":"yardimci","a":"k2","b":"cv","ait":"KV","ad":"Fan mühürleme kontağı (NA 13-14)"},
        {"id":"KVN","t":"yardimci","a":"k2","b":"k3","ait":"KV","ad":"Fan çalışıyor izin kontağı (KV NA): fan durunca bant da durur"},
        {"id":"Q19","t":"kesici","a":"k3","b":"k4","I":2,"kapali":true,"ad":"Konveyör kumanda MCB'si (yalnız bandın kumandası, eşik 2)"},
        {"id":"Q11A","t":"yardimci","a":"k4","b":"k5","ait":"Q11","ad":"Fider ayırıcısı ön kesme yardımcı kontağı (NA)"},
        {"id":"S1F","t":"buton","a":"k5","b":"sf","ad":"Konveyör İLERİ START (NA)"},
        {"id":"KFA","t":"yardimci","a":"k5","b":"sf","ait":"KF","ad":"İleri mühürleme kontağı (NA 13-14)"},
        {"id":"KRN","t":"yardimci","a":"sf","b":"cf","ait":"KR","nc":true,"ad":"Kilitleme kontağı KR (NK 21-22)"},
        {"id":"S1R","t":"buton","a":"k5","b":"sr","ad":"Konveyör GERİ START (NA)"},
        {"id":"KRA","t":"yardimci","a":"k5","b":"sr","ait":"KR","ad":"Geri mühürleme kontağı (NA 13-14)"},
        {"id":"KFN","t":"yardimci","a":"sr","b":"cr","ait":"KF","nc":true,"ad":"Kilitleme kontağı KF (NK 21-22)"},
        {"id":"K1","t":"kapi","kilitli":"Q11","ad":"Konveyör koruyucu kafes kapısı — Q11 kilitlemeli"},
      ],
    },
    cells: ["Y1","S1F","S2","S1R","Q19","Y2","S9","Q09","KV","Q01","G1","Q11","T1","Q02","KF","KR"],
    essential: ["noDoors","noAyiriciKurali"],
  },
  // 3.3 Kumanda Gerilimi (F4) — yayımlanan seviye: tools/reference2/levels/ch3.js#F4
  pompa_ist: {
    ch: 3, W: 7, D: 7, MAXH: 3, minPar: 10, maxPar: 30, sinif: "cekirdek", saha: "asma_kat",
    base: {
      dugum: {"g":{},"m":{},"p1":{},"p2":{},"kt":{},"k0a":{"kv":0.23},"k0b":{"kv":0.23},"kb":{"kv":0.23},"c1":{"kv":0.23},"c2":{"kv":0.23},"cq":{},"c":{}},
      hedef: {"yukler":["Y1","Y2"],"cosphi":{"dugum":"m","ind":200,"kap":150},"acik":["Q0T","QK1"],"kapali":["QK2"]},
      el: [
        {"id":"G1","t":"kaynak","dugum":"g","ad":"Pompa istasyonu trafosu AG"},
        {"id":"Q01","t":"kesici","a":"g","b":"m","I":20,"kapali":true,"ad":"İstasyon ana kesicisi (eşik 20)"},
        {"id":"K1","t":"kontaktor","a":"m","b":"p1","bobin":"c1","ad":"Pompa-1 kontaktörü (AC-3)","kapali":true},
        {"id":"K2","t":"kontaktor","a":"m","b":"p2","bobin":"c2","ad":"Pompa-2 kontaktörü (AC-3)","kapali":true},
        {"id":"Y1","t":"yuk","dugum":"p1","ad":"Temiz su pompası-1","d":1,"p":4,"q":3,"w":2},
        {"id":"Y2","t":"yuk","dugum":"p2","ad":"Temiz su pompası-2","d":1,"p":4,"q":3,"w":2},
        {"id":"Q0T","t":"kesici","a":"m","b":"kt","I":9,"kapali":true,"ad":"Kumanda trafosu-1 primer otomatı"},
        {"id":"T1","t":"trafo","a":"kt","b":"k0a","ad":"Kumanda trafosu-1 400/230 V (ısınıyor)"},
        {"id":"T2","t":"trafo","a":"m","b":"k0b","ad":"Kumanda trafosu-2 400/230 V (yeni)"},
        {"id":"QK1","t":"ayirici","a":"k0a","b":"kb","kapali":true,"ad":"Kumanda barası TR-K1 ayırma klemensi (bıçaklı, yük altında açılmaz)"},
        {"id":"QK2","t":"ayirici","a":"k0b","b":"kb","ad":"Kumanda barası TR-K2 ayırma klemensi (bıçaklı, yük altında açılmaz)"},
        {"id":"S1","t":"buton","a":"kb","b":"c1","ad":"Pompa-1 START (NA)"},
        {"id":"K1A","t":"yardimci","a":"kb","b":"c1","ait":"K1","ad":"Pompa-1 mühürleme kontağı (NA 13-14)"},
        {"id":"S2","t":"buton","a":"kb","b":"c2","ad":"Pompa-2 START (NA)"},
        {"id":"K2A","t":"yardimci","a":"kb","b":"c2","ait":"K2","ad":"Pompa-2 mühürleme kontağı (NA 13-14)"},
        {"id":"QC1","t":"kesici","a":"m","b":"cq","I":9,"kapali":true,"ad":"Kompanzasyon kademe kesicisi"},
        {"id":"KC","t":"kontaktor","a":"cq","b":"c","bobin":"kb","ad":"Kompanzasyon kademe kontaktörü (bobini kumanda barasında, mühürsüz)","kapali":true},
        {"id":"C1","t":"kondansator","dugum":"c","q":5,"r":1,"ad":"Kompanzasyon kademesi (5 birim)"},
      ],
    },
    cells: ["T1","Q0T","T2","G1","Q01","QK1","QK2","K1","K2","QC1","KC","C1","S1","S2","Y1","Y2"],
    essential: ["noAyiriciKurali","noCapLock"],
  },
  // 3.4 Kompanzasyon Kademeleri (F2) — yayımlanan seviye: tools/reference2/levels/ch3.js#F2
  kademe_sigorta: {
    ch: 3, W: 8, D: 7, MAXH: 3, minPar: 10, maxPar: 30, sinif: "cekirdek", saha: "asma_kat",
    base: {
      yedek: 1,
      dugum: {"g":{},"bus":{},"m1":{},"m2":{},"f1":{},"c1":{},"k":{},"c2":{},"c3":{}},
      hedef: {"yukler":["Y1","Y2","Y3"],"cosphi":{"dugum":"bus","ind":200,"kap":150}},
      el: [
        {"id":"G1","t":"kaynak","dugum":"g","ad":"Fabrika trafosu AG"},
        {"id":"Q01","t":"kesici","a":"g","b":"bus","I":20,"kapali":true,"ad":"Fabrika ana kesicisi (eşik 20)"},
        {"id":"Y3","t":"yuk","dugum":"bus","ad":"Atölye aydınlatması","d":1,"p":2,"q":0,"w":1},
        {"id":"Q02","t":"kesici","a":"bus","b":"m1","I":9,"kapali":true,"ad":"Kompresör motor fideri"},
        {"id":"Y1","t":"yuk","dugum":"m1","ad":"Kompresör motoru","d":1,"p":4,"q":3,"w":1},
        {"id":"Q03","t":"kesici","a":"bus","b":"m2","I":9,"ad":"Konveyör motor fideri"},
        {"id":"Y2","t":"yuk","dugum":"m2","ad":"Konveyör motoru","d":1,"p":4,"q":5,"w":1},
        {"id":"QC1","t":"kesici","a":"bus","b":"f1","I":9,"kapali":true,"ad":"Kademe-1 kondansatör kesicisi (A bölümü)"},
        {"id":"F1","t":"sigorta","a":"f1","b":"c1","I":9,"saglam":false,"ad":"Kademe-1 NH sigortası (attı)"},
        {"id":"C1","t":"kondansator","dugum":"c1","q":3,"r":1,"ad":"Kademe-1 kondansatörü (3 birim)"},
        {"id":"Q10","t":"ayirici","a":"bus","b":"k","ad":"Kompanzasyon B bölümü giriş ayırıcısı"},
        {"id":"QC2","t":"kesici","a":"k","b":"c2","I":9,"ad":"Kademe-2 kondansatör kesicisi (B bölümü)"},
        {"id":"C2","t":"kondansator","dugum":"c2","q":2,"r":1,"sarj":3,"ad":"Kademe-2 kondansatörü (2 birim, yeni ayrıldı: yüklü)"},
        {"id":"QC3","t":"kesici","a":"k","b":"c3","I":9,"kapali":true,"ad":"Kademe-3 kondansatör kesicisi (B bölümü)"},
        {"id":"C3","t":"kondansator","dugum":"c3","q":1,"r":1,"ad":"Kademe-3 kondansatörü (1 birim)"},
      ],
    },
    cells: ["C2","QC2","QC3","C3","Q10","Q01","G1","Q03","Q02","Y3","C1","F1","QC1","Y2","Y1"],
    essential: ["noAyiriciKurali:kesinti","noZones:kesinti","noCapLock:kesinti"],
  },
  // 3.5 Deşarjı Verimli Bekle (F5) — yayımlanan seviye: tools/reference2/levels/ch3.js#F5
  kademe_is: {
    ch: 3, W: 8, D: 7, MAXH: 3, minPar: 18, maxPar: 50, sinif: "zor", saha: "galeri", work: true, hard: true,
    base: {
      kilit: 1,
      is: {"bolge":["c1"],"ad":"Kademe-1 bağlantı barası kablo pabucunu değiştir"},
      dugum: {"g":{},"bus":{},"m1":{},"x3":{},"m2":{},"k1":{},"c1":{},"c2":{}},
      hedef: {"yukler":["Y1","Y2","Y3"],"cosphi":{"dugum":"bus","ind":200,"kap":150}},
      el: [
        {"id":"G1","t":"kaynak","dugum":"g","ad":"Fabrika trafosu AG"},
        {"id":"Q01","t":"kesici","a":"g","b":"bus","I":20,"kapali":true,"ad":"Fabrika ana kesicisi (eşik 20)"},
        {"id":"Y3","t":"yuk","dugum":"bus","ad":"Atölye aydınlatması","d":1,"p":2,"q":0,"w":1},
        {"id":"Q02","t":"kesici","a":"bus","b":"m1","I":9,"kapali":true,"ad":"Kompresör motor fideri"},
        {"id":"Y1","t":"yuk","dugum":"m1","ad":"Kompresör motoru","d":1,"p":4,"q":3,"w":2},
        {"id":"Q03","t":"kesici","a":"bus","b":"x3","I":9,"kapali":true,"ad":"Konveyör motor fideri"},
        {"id":"Q13","t":"ayirici","a":"x3","b":"m2","ad":"Konveyör fider ayırıcısı (konveyör başında)"},
        {"id":"Y2","t":"yuk","dugum":"m2","ad":"Konveyör motoru","d":1,"p":4,"q":4,"w":1},
        {"id":"QC1","t":"kesici","a":"bus","b":"k1","I":9,"kapali":true,"ad":"Kademe-1 kondansatör kesicisi"},
        {"id":"Q91","t":"ayirici","a":"k1","b":"c1","kapali":true,"ad":"Kademe-1 ayırıcısı (kilitlenebilir)"},
        {"id":"B1","t":"bara","dugum":"c1","r":1,"ad":"Kademe-1 bağlantı barası"},
        {"id":"Q81","t":"toprak","dugum":"c1","ad":"Kademe-1 topraklama ayırıcısı"},
        {"id":"C1","t":"kondansator","dugum":"c1","q":3,"r":1,"ad":"Kademe-1 kondansatörü (3 birim, bakımda)"},
        {"id":"QC2","t":"kesici","a":"bus","b":"c2","I":9,"ad":"Kademe-2 kondansatör kesicisi"},
        {"id":"C2","t":"kondansator","dugum":"c2","q":2,"r":1,"sarj":3,"ad":"Kademe-2 kondansatörü (2 birim, yeni ayrıldı: yüklü)"},
      ],
    },
    cells: ["C1","Q81","B1","C2","QC2","Q91","QC1","Q13","Y2","Y1","Y3","Q02","Q01","Q03","G1"],
    essential: ["noZones","noLoto","noAyiriciKurali"],
  },
  // 3.6 Yıldız-Üçgen (F6) — yayımlanan seviye: tools/reference2/levels/ch3.js#F6
  yildiz_ucgen: {
    ch: 3, W: 7, D: 7, MAXH: 3, minPar: 10, maxPar: 30, sinif: "cekirdek", saha: "asma_kat",
    base: {
      dugum: {"g":{},"m":{},"w":{},"mot":{},"lx":{},"ex":{},"exl":{},"u":{},"k0":{"kv":0.23},"k1":{"kv":0.23},"ks":{"kv":0.23},"sy":{"kv":0.23},"sd":{"kv":0.23},"cy":{"kv":0.23},"cd":{"kv":0.23},"cm":{"kv":0.23}},
      hedef: {"yukler":["Y1","Y2","Y3"],"kapali":["KM","KD"],"acik":["KY"]},
      el: [
        {"id":"G1","t":"kaynak","dugum":"g","ad":"Fabrika AG dağıtımı (kompresör dairesi beslemesi)"},
        {"id":"Q01","t":"kesici","a":"g","b":"m","I":9,"kapali":true,"ad":"Kompresör dairesi ana kesicisi"},
        {"id":"KM","t":"kontaktor","a":"m","b":"w","bobin":"cm","ad":"Ana kontaktör KM (AC-3)"},
        {"id":"KY","t":"kontaktor","a":"w","b":"mot","bobin":"cy","ad":"Yıldız kontaktörü KY"},
        {"id":"KD","t":"kontaktor","a":"w","b":"mot","bobin":"cd","ad":"Üçgen kontaktörü KD"},
        {"id":"Y1","t":"yuk","dugum":"mot","ad":"Vidalı hava kompresörü motoru","d":1,"w":2},
        {"id":"T1","t":"trafo","a":"m","b":"k0","ad":"Kumanda trafosu 400/230 V"},
        {"id":"S0","t":"buton","a":"k0","b":"k1","ad":"Kompresör STOP (NK)","nc":true},
        {"id":"S1","t":"buton","a":"k1","b":"ks","ad":"Kompresör START (NA)"},
        {"id":"KMA","t":"yardimci","a":"k1","b":"ks","ait":"KM","ad":"KM mühürleme kontağı (NA 13-14)"},
        {"id":"SY","t":"ayirici","a":"ks","b":"sy","kapali":true,"ad":"Yıldız-üçgen geçiş anahtarı YILDIZ kontağı"},
        {"id":"SD","t":"ayirici","a":"ks","b":"sd","ad":"Yıldız-üçgen geçiş anahtarı ÜÇGEN kontağı"},
        {"id":"KDN","t":"yardimci","a":"sy","b":"cy","ait":"KD","nc":true,"ad":"KD kilitleme kontağı (NK)"},
        {"id":"KYN","t":"yardimci","a":"sd","b":"cd","ait":"KY","nc":true,"ad":"KY kilitleme kontağı (NK)"},
        {"id":"KYA","t":"yardimci","a":"ks","b":"cm","ait":"KY","ad":"KY NA kontağı: KM ancak yıldız kapalıyken çeker"},
        {"id":"KMB","t":"yardimci","a":"ks","b":"cm","ait":"KM","ad":"KM tutma kontağı (NA)"},
        {"id":"Q02","t":"kesici","a":"m","b":"lx","I":9,"kapali":true,"ad":"Daire aydınlatma fider kesicisi"},
        {"id":"Y2","t":"yuk","dugum":"lx","ad":"Kompresör dairesi aydınlatması","d":1,"w":1},
        {"id":"Q03","t":"kesici","a":"m","b":"ex","I":9,"kapali":true,"ad":"Acil aydınlatma şebeke fider kesicisi"},
        {"id":"Q13","t":"ayirici","a":"ex","b":"exl","ad":"Acil aydınlatma transfer ayırıcısı (şebeke tarafı)"},
        {"id":"G2","t":"kaynak","dugum":"u","grup":2,"acil":true,"ad":"Acil aydınlatma UPS çıkışı"},
        {"id":"Q04","t":"kesici","a":"u","b":"exl","I":9,"kapali":true,"ad":"UPS çıkış kesicisi"},
        {"id":"Y3","t":"yuk","dugum":"exl","ad":"Acil çıkış aydınlatması","d":1,"w":2},
      ],
    },
    cells: ["G2","Q04","Q13","Q02","Y2","G1","Q03","Q01","Y1","SY","SD","S1","S0","T1","KM","KY","KD","Y3"],
    essential: ["noAyiriciKurali","noSync:kesinti"],
  },
  // 3.7 Fabrika Sınavı (F7) — yayımlanan seviye: tools/reference2/levels/ch3.js#F7
  fabrika_sinav: {
    ch: 3, W: 8, D: 7, MAXH: 3, minPar: 24, maxPar: 60, sinif: "sinav", saha: "galeri", work: true, hard: true,
    base: {
      kilit: 2,
      is: {"bolge":["kt","k0a"],"ad":"TR-K1 primer klemens barasını sık, termografi kontrolü yap"},
      dugum: {"g":{},"g2":{},"m":{},"p1":{},"p2":{},"kt":{},"k0a":{"kv":0.23},"k0b":{"kv":0.23},"kb":{"kv":0.23},"c1":{"kv":0.23},"c2":{"kv":0.23},"cc":{"kv":0.23},"cq":{},"c":{}},
      hedef: {"yukler":["Y1","Y2"],"cosphi":{"dugum":"m","ind":200,"kap":150},"acik":["QK"]},
      el: [
        {"id":"G1","t":"kaynak","dugum":"g","ad":"Pompa istasyonu trafosu AG"},
        {"id":"Q01","t":"kesici","a":"g","b":"m","I":20,"kapali":true,"ad":"İstasyon ana kesicisi (eşik 20)"},
        {"id":"K1","t":"kontaktor","a":"m","b":"p1","bobin":"c1","ad":"Pompa-1 kontaktörü (AC-3)","kapali":true},
        {"id":"Y1","t":"yuk","dugum":"p1","ad":"Temiz su pompası-1","d":1,"p":4,"q":3,"w":2},
        {"id":"K2","t":"kontaktor","a":"m","b":"p2","bobin":"c2","ad":"Pompa-2 kontaktörü (AC-3)","kapali":true},
        {"id":"Y2","t":"yuk","dugum":"p2","ad":"Temiz su pompası-2","d":1,"p":4,"q":3,"w":2},
        {"id":"Q0T","t":"kesici","a":"m","b":"kt","I":9,"kapali":true,"cekmeli":true,"ad":"Kumanda trafosu-1 primer şalteri (çekmeli, kilitlenebilir)"},
        {"id":"B1","t":"bara","dugum":"kt","r":1,"ad":"Kumanda trafosu-1 primer klemens barası"},
        {"id":"Q81","t":"toprak","dugum":"kt","ad":"Kumanda trafosu-1 primer topraklama ayırıcısı"},
        {"id":"T1","t":"trafo","a":"kt","b":"k0a","ad":"Kumanda trafosu-1 400/230 V"},
        {"id":"Q82","t":"toprak","dugum":"k0a","ad":"Kumanda trafosu-1 sekonder topraklama ayırıcısı"},
        {"id":"G2","t":"kaynak","dugum":"g2","grup":2,"ad":"İstasyonun ikinci besleme hattı (yedek hat, şebekeyle senkron değil)"},
        {"id":"T2","t":"trafo","a":"g2","b":"k0b","ad":"Kumanda trafosu-2 400/230 V (yedek hattan)"},
        {"id":"QK","t":"kesici","a":"k0b","b":"kb","I":9,"ad":"Kumanda barası yedek besleme otomatı (TR-K2)"},
        {"id":"QK1","t":"ayirici","a":"k0a","b":"kb","kapali":true,"ad":"Kumanda trafosu-1 sekonder ayırıcısı (kilitlenebilir)"},
        {"id":"S1","t":"buton","a":"kb","b":"c1","ad":"Pompa-1 START (NA)"},
        {"id":"K1A","t":"yardimci","a":"kb","b":"c1","ait":"K1","ad":"Pompa-1 mühürleme kontağı (NA 13-14)"},
        {"id":"S2","t":"buton","a":"kb","b":"c2","ad":"Pompa-2 START (NA)"},
        {"id":"K2A","t":"yardimci","a":"kb","b":"c2","ait":"K2","ad":"Pompa-2 mühürleme kontağı (NA 13-14)"},
        {"id":"KCA","t":"yardimci","a":"kb","b":"cc","ait":"K1","ad":"Kompanzasyon izin kontağı (K1 NA)"},
        {"id":"QC1","t":"kesici","a":"m","b":"cq","I":9,"kapali":true,"ad":"Kompanzasyon kademe kesicisi"},
        {"id":"KC","t":"kontaktor","a":"cq","b":"c","bobin":"cc","ad":"Kompanzasyon kademe kontaktörü","kapali":true},
        {"id":"C1","t":"kondansator","dugum":"c","q":5,"r":1,"ad":"Kompanzasyon kademesi (5 birim)"},
        {"id":"K3","t":"kapi","kilitli":"Q0T","ad":"Kumanda trafosu odası kapısı — Q0T kilitlemeli"},
      ],
    },
    cells: ["T1","Q81","T2","B1","QK","QK1","Q82","C1","KC","QC1","S1","S2","Y1","Y2","K1","K2","Q01","Q0T","G1"],
    essential: ["noLoto","noZones","noAyiriciKurali:kesinti","noDoors:kesinti"],
  },
};

module.exports = [
  {
    "file": "Lab_guc-ucgeni.html",
    "slug": "guc-ucgeni",
    "name": "Güç Üçgeni ve Hat Akımı",
    "category": "dagitim",
    "description": "Aktif, reaktif ve görünür güç ilişkisini hesaplayın; bir ve üç fazlı dengeli yükün akımını bulun.",
    "icon": "bolt",
    "method": "S=P/cosφ; |Q|=P·tan(arccosφ); I=S/V veya S/(√3·V).",
    "inputs": "Aktif güç (kW); Güç faktörü · cos φ; Besleme gerilimi (V; 3 fazda hat–hat); Besleme; Reaktif güç yönü.",
    "outputs": "Sayısal sonuçlar, model açıklaması, desteklenen hesaplarda grafik; CSV, PDF ve proje yedeği.",
    "expansion": true,
    "sources": [
      {
        "title": "engineerjoe440/ElectricPy",
        "url": "https://github.com/engineerjoe440/ElectricPy",
        "note": "Elektrik hesabı denklemlerinin karşılaştırma kaynağı · MIT. Bu modül bağımsız uygulamadır."
      }
    ]
  },
  {
    "file": "Lab_yuk-kompanzasyon.html",
    "slug": "yuk-kompanzasyon",
    "name": "Yük Kompanzasyonu ve Kondansatör",
    "category": "dagitim",
    "description": "Hedef güç faktörüne göre yükün kondansatör ihtiyacını ve yıldız/üçgen faz kapasitesini hesaplayın.",
    "icon": "bolt",
    "method": "Qc=P(tanφ₁−tanφ₂); CΔ=Qc/(3ωU²), CY=Qc/(ωU²).",
    "inputs": "Yük aktif gücü (kW); Mevcut cos φ; Hedef cos φ; Üç faz hat gerilimi (V RMS); Frekans (Hz); Kondansatör bağlantısı.",
    "outputs": "Sayısal sonuçlar, model açıklaması, desteklenen hesaplarda grafik; CSV, PDF ve proje yedeği.",
    "expansion": true,
    "sources": [
      {
        "title": "engineerjoe440/ElectricPy",
        "url": "https://github.com/engineerjoe440/ElectricPy",
        "note": "Elektrik hesabı denklemlerinin karşılaştırma kaynağı · MIT. Bu modül bağımsız uygulamadır."
      },
      {
        "title": "wp-xyz/CapaCalc",
        "url": "https://github.com/wp-xyz/CapaCalc",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      }
    ]
  },
  {
    "file": "Lab_harmonik-thd.html",
    "slug": "harmonik-thd",
    "name": "Harmonik ve THD Analizi",
    "category": "dagitim",
    "description": "Temel bileşen ve harmonik RMS değerlerinden THD-F ve toplam RMS hesaplayın; harmonik spektrumunu görün.",
    "icon": "bolt",
    "method": "THD-F=√Σ(Xh²)/X₁, h≥2; toplam RMS=√Σ(Xh²).",
    "inputs": "Harmonik sıra; RMS büyüklük (her satıra bir harmonik); Ölçüm büyüklüğü.",
    "outputs": "Sayısal sonuçlar, model açıklaması, desteklenen hesaplarda grafik; CSV, PDF ve proje yedeği.",
    "expansion": true,
    "sources": [
      {
        "title": "engineerjoe440/ElectricPy",
        "url": "https://github.com/engineerjoe440/ElectricPy",
        "note": "Elektrik hesabı denklemlerinin karşılaştırma kaynağı · MIT. Bu modül bağımsız uygulamadır."
      },
      {
        "title": "upb-lea/pySignalScope",
        "url": "https://github.com/upb-lea/pySignalScope",
        "note": "Ölçüm/spektrum özellik referansı; kod veya varlık kullanılmadı."
      }
    ]
  },
  {
    "file": "Lab_motor-hiz-tork.html",
    "slug": "motor-hiz-tork",
    "name": "Motor Senkron Hızı, Kayma ve Tork",
    "category": "motor",
    "description": "Kutup sayısı ve frekanstan senkron hız; mil hızından kayma ve mekanik tork hesaplayın.",
    "icon": "compass",
    "method": "ns=120f/p; s=(ns−n)/ns; T=P/ωm=60P/(2πn).",
    "inputs": "Besleme frekansı (Hz); Kutup sayısı (çift tamsayı); Ölçülen mil hızı (dev/dak); Mil mekanik gücü (kW).",
    "outputs": "Sayısal sonuçlar, model açıklaması, desteklenen hesaplarda grafik; CSV, PDF ve proje yedeği.",
    "expansion": true,
    "sources": [
      {
        "title": "Aalto-Electric-Drives/motulator",
        "url": "https://github.com/Aalto-Electric-Drives/motulator",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      },
      {
        "title": "Beingink/3-phase-induction-motor-braking-techniques",
        "url": "https://github.com/Beingink/3-phase-induction-motor-braking-techniques",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      }
    ]
  },
  {
    "file": "Lab_clarke-park.html",
    "slug": "clarke-park",
    "name": "Clarke–Park Dönüşümü",
    "category": "motor",
    "description": "Anlık üç faz değerlerini αβ0 ve dq0 eksenlerine dönüştürün; ters dönüşüm hatasını kontrol edin.",
    "icon": "compass",
    "method": "α=(2a−b−c)/3; β=(b−c)/√3; x₀=(a+b+c)/3; d=αcosθ+βsinθ; q=−αsinθ+βcosθ.",
    "inputs": "Faz a anlık değer; Faz b anlık değer; Faz c anlık değer; Elektriksel referans açısı (°).",
    "outputs": "Sayısal sonuçlar, model açıklaması, desteklenen hesaplarda grafik; CSV, PDF ve proje yedeği.",
    "expansion": true,
    "sources": [
      {
        "title": "felipef-lisboa/clarke_park_transform",
        "url": "https://github.com/felipef-lisboa/clarke_park_transform",
        "note": "Dönüşüm konusu referansı · GPL kodu kopyalanmadı."
      },
      {
        "title": "Aalto-Electric-Drives/motulator",
        "url": "https://github.com/Aalto-Electric-Drives/motulator",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      }
    ]
  },
  {
    "file": "Lab_buck-donusturucu.html",
    "slug": "buck-donusturucu",
    "name": "Buck Dönüştürücü Ön Tasarımı",
    "category": "elektronik",
    "description": "Düşürücü DC/DC dönüştürücüde görev oranı, akım dalgalanması ve ideal L/C boyutlarını hesaplayın.",
    "icon": "bolt",
    "method": "D=Vout/Vin; L=(Vin−Vout)D/(fsΔIL); C≥ΔIL/(8fsΔV).",
    "inputs": "Giriş DC gerilimi (V); Çıkış DC gerilimi (V); Çıkış akımı (A); Anahtarlama frekansı (kHz); Bobin akım dalgalanması (% ortalama akım); İzin verilen çıkış dalgalanması (V tepe-tepe).",
    "outputs": "Sayısal sonuçlar, model açıklaması, desteklenen hesaplarda grafik; CSV, PDF ve proje yedeği.",
    "expansion": true,
    "sources": [
      {
        "title": "TAU-Power-Electronic-Systems/Soft4PES",
        "url": "https://github.com/TAU-Power-Electronic-Systems/Soft4PES",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      },
      {
        "title": "MathWorks-Teaching-Resources/Power-Electronics",
        "url": "https://github.com/MathWorks-Teaching-Resources/Power-Electronics",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      },
      {
        "title": "Texas Instruments · güç katı denklemleri",
        "url": "https://www.ti.com/lit/an/slva477b/slva477b.pdf",
        "note": "Denklem referansı; doküman metni veya şekli kopyalanmadı. Araç ideal η=1 modeli kullanır."
      }
    ]
  },
  {
    "file": "Lab_boost-donusturucu.html",
    "slug": "boost-donusturucu",
    "name": "Boost Dönüştürücü Ön Tasarımı",
    "category": "elektronik",
    "description": "Yükseltici DC/DC dönüştürücüde görev oranı, bobin akımı ve ideal L/C boyutlarını hesaplayın.",
    "icon": "bolt",
    "method": "D=1−Vin/Vout; IL=Iout/(1−D); L=VinD/(fsΔIL); C≥IoutD/(fsΔV).",
    "inputs": "Giriş DC gerilimi (V); Çıkış DC gerilimi (V); Çıkış akımı (A); Anahtarlama frekansı (kHz); Bobin akım dalgalanması (% ortalama akım); İzin verilen çıkış dalgalanması (V tepe-tepe).",
    "outputs": "Sayısal sonuçlar, model açıklaması, desteklenen hesaplarda grafik; CSV, PDF ve proje yedeği.",
    "expansion": true,
    "sources": [
      {
        "title": "TAU-Power-Electronic-Systems/Soft4PES",
        "url": "https://github.com/TAU-Power-Electronic-Systems/Soft4PES",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      },
      {
        "title": "MathWorks-Teaching-Resources/Power-Electronics",
        "url": "https://github.com/MathWorks-Teaching-Resources/Power-Electronics",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      },
      {
        "title": "Texas Instruments · güç katı denklemleri",
        "url": "https://www.ti.com/lit/an/slva372d/slva372d.pdf",
        "note": "Denklem referansı; doküman metni veya şekli kopyalanmadı. Araç ideal η=1 modeli kullanır."
      }
    ]
  },
  {
    "file": "Lab_batarya-enerji-sure.html",
    "slug": "batarya-enerji-sure",
    "name": "Batarya Enerjisi ve Çalışma Süresi",
    "category": "ges",
    "description": "Batarya nominal enerjisini, kullanılabilir enerjiyi, sabit yük çalışma süresini ve gerekli Ah değerini hesaplayın.",
    "icon": "bolt",
    "method": "Enom=V·Ah; Ekullan=Enom·DoD·η; t=Ekullan/P; Ahgerek=P·thedef/(V·DoD·η).",
    "inputs": "Nominal batarya gerilimi (V); Nominal kapasite (Ah); Sabit yük gücü (W); Kullanılabilir deşarj oranı (%); Çıkış enerji verimi (%); Hedef çalışma süresi (saat).",
    "outputs": "Sayısal sonuçlar, model açıklaması, desteklenen hesaplarda grafik; CSV, PDF ve proje yedeği.",
    "expansion": true,
    "sources": [
      {
        "title": "sileneer/NRP_2022_EEE12",
        "url": "https://github.com/sileneer/NRP_2022_EEE12",
        "note": "Batarya kapasitesi/sağlık konusu referansı; tahmin modeli veya veri seti kopyalanmadı."
      }
    ]
  },
  {
    "file": "Lab_ev-sarj-suresi.html",
    "slug": "ev-sarj-suresi",
    "name": "Elektrikli Araç Şarj Süresi",
    "category": "ges",
    "description": "Batarya kapasitesi, hedef doluluk ve şarj gücü sınırlarından ideal AC şarj süresini hesaplayın.",
    "icon": "bolt",
    "method": "Ebat=C(SOChedef−SOCbaşlangıç); Pgiriş=min(Pistasyon,Paraç); t=Ebat/(Pgiriş·η).",
    "inputs": "Kullanılabilir batarya kapasitesi (kWh); Başlangıç doluluğu (%); Hedef doluluk (%); İstasyon AC güç sınırı (kW); Araç AC şarj güç sınırı (kW); Şarj enerji verimi (%).",
    "outputs": "Sayısal sonuçlar, model açıklaması, desteklenen hesaplarda grafik; CSV, PDF ve proje yedeği.",
    "expansion": true,
    "sources": [
      {
        "title": "robert-solomon12/FYP-Electric-Vehicle-Charging-Protocol-Implementation",
        "url": "https://github.com/robert-solomon12/FYP-Electric-Vehicle-Charging-Protocol-Implementation",
        "note": "EV şarj konusu referansı; protokol veya cihaz kontrolü uygulanmadı."
      },
      {
        "title": "Sachin-S-Wagh/Electrical-Engineering-Project-Modeling-of-an-Electric-Vehicle-Charging-Station-for-Fast-DC-Charging",
        "url": "https://github.com/Sachin-S-Wagh/Electrical-Engineering-Project-Modeling-of-an-Electric-Vehicle-Charging-Station-for-Fast-DC-Charging",
        "note": "Şarj modeli konusu referansı; Simulink kodu kopyalanmadı."
      }
    ]
  },
  {
    "file": "Lab_yildiz-ucgen-direnc.html",
    "slug": "yildiz-ucgen-direnc",
    "name": "Yıldız–Üçgen Direnç Dönüşümü",
    "category": "elektronik",
    "description": "Üç uçlu direnç ağını eşdeğer yıldız veya üçgen bağlantısına dönüştürün; uç dirençlerini doğrulayın.",
    "icon": "bolt",
    "method": "Δ→Y: R₁=R₁₂R₃₁/ΣRΔ; Y→Δ: R₁₂=R₁+R₂+R₁R₂/R₃; diğer uçlar döngüsel.",
    "inputs": "Girdi bağlantısı; R₁₂ veya R₁ (Ω); R₂₃ veya R₂ (Ω); R₃₁ veya R₃ (Ω).",
    "outputs": "Sayısal sonuçlar, model açıklaması, desteklenen hesaplarda grafik; CSV, PDF ve proje yedeği.",
    "expansion": true,
    "sources": [
      {
        "title": "AbdallahHemdan/Mini-Projects",
        "url": "https://github.com/AbdallahHemdan/Mini-Projects",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      },
      {
        "title": "abolfazlmohammadpour/ElectricalCircuitAnalysisReferences",
        "url": "https://github.com/abolfazlmohammadpour/ElectricalCircuitAnalysisReferences",
        "note": "Devre analizi konusu referansı; üçüncü taraf içerik kopyalanmadı."
      }
    ]
  },
  {
    "file": "Lab_yuklu-gerilim-bolucu.html",
    "slug": "yuklu-gerilim-bolucu",
    "name": "Yüklü Gerilim Bölücü",
    "category": "elektronik",
    "description": "Direnç bölücüsünün yük altında çıkışını, yükleme hatasını ve direnç güçlerini hesaplayın.",
    "icon": "bolt",
    "method": "Ralt=R₂∥RL; Vout=Vin·Ralt/(R₁+Ralt); her dirençte P=V²/R.",
    "inputs": "Giriş gerilimi (V); Üst direnç R₁ (Ω); Alt direnç R₂ (Ω); Yük direnci (Ω; 0 = yük bağlanmamış).",
    "outputs": "Sayısal sonuçlar, model açıklaması, desteklenen hesaplarda grafik; CSV, PDF ve proje yedeği.",
    "expansion": true,
    "sources": [
      {
        "title": "engineerjoe440/ElectricPy",
        "url": "https://github.com/engineerjoe440/ElectricPy",
        "note": "Elektrik hesabı denklemlerinin karşılaştırma kaynağı · MIT. Bu modül bağımsız uygulamadır."
      },
      {
        "title": "victor-aunon/CircuitSolver",
        "url": "https://github.com/victor-aunon/CircuitSolver",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      }
    ]
  },
  {
    "file": "Lab_rc-rl-filtre.html",
    "slug": "rc-rl-filtre",
    "name": "RC / RL Birinci Derece Filtre",
    "category": "elektronik",
    "description": "RC ve RL alçak/yüksek geçiren filtrelerin kesim frekansını, genlik ve faz yanıtını karşılaştırın.",
    "icon": "bolt",
    "method": "τRC=RC; τRL=L/R; fc=1/(2πτ); HLP=1/(1+jωτ); HHP=jωτ/(1+jωτ).",
    "inputs": "Filtre; Direnç (Ω); Kapasite (µF); Endüktans (mH); İncelenen frekans (Hz).",
    "outputs": "Sayısal sonuçlar, model açıklaması, desteklenen hesaplarda grafik; CSV, PDF ve proje yedeği.",
    "expansion": true,
    "sources": [
      {
        "title": "MathWorks-Teaching-Resources/DSP-Signals-and-Filter-Design",
        "url": "https://github.com/MathWorks-Teaching-Resources/DSP-Signals-and-Filter-Design",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      },
      {
        "title": "jp2masa/BodePlotter",
        "url": "https://github.com/jp2masa/BodePlotter",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      }
    ]
  },
  {
    "file": "Lab_ayrik-fourier.html",
    "slug": "ayrik-fourier",
    "name": "Ayrık Fourier ve Spektrum",
    "category": "sinyal",
    "description": "Örnek dizisinin ayrık Fourier dönüşümünü hesaplayın; tek taraflı genlik ve faz spektrumunu görüntüleyin.",
    "icon": "wave",
    "method": "X[k]=Σx[n]e^(−j2πkn/N). Tek taraflı genlik: DC ve Nyquist için |X|/N, diğer binlerde 2|X|/N.",
    "inputs": "Örnekler · noktalı virgülle ayırın; Örnekleme frekansı (Hz).",
    "outputs": "Sayısal sonuçlar, model açıklaması, desteklenen hesaplarda grafik; CSV, PDF ve proje yedeği.",
    "expansion": true,
    "sources": [
      {
        "title": "MathWorks-Teaching-Resources/DSP-Signals-and-Filter-Design",
        "url": "https://github.com/MathWorks-Teaching-Resources/DSP-Signals-and-Filter-Design",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      },
      {
        "title": "MUmarShahbaz/Oscilloscope-Online",
        "url": "https://github.com/MUmarShahbaz/Oscilloscope-Online",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      },
      {
        "title": "Narukara/Oscilloscope",
        "url": "https://github.com/Narukara/Oscilloscope",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      }
    ]
  },
  {
    "file": "Lab_ayrik-konvolusyon.html",
    "slug": "ayrik-konvolusyon",
    "name": "Ayrık Konvolüsyon Laboratuvarı",
    "category": "sinyal",
    "description": "İki sonlu dizinin lineer konvolüsyonunu hesaplayın; çıktı örneklerini ve indekslerini görün.",
    "icon": "wave",
    "method": "y[n]=Σx[k]h[n−k]; çıktı uzunluğu Nx+Nh−1; ilk indeks nx₀+nh₀.",
    "inputs": "Giriş x[n] · noktalı virgülle; Darbe yanıtı h[n] · noktalı virgülle; x dizisinin ilk indeksi; h dizisinin ilk indeksi.",
    "outputs": "Sayısal sonuçlar, model açıklaması, desteklenen hesaplarda grafik; CSV, PDF ve proje yedeği.",
    "expansion": true,
    "sources": [
      {
        "title": "MathWorks-Teaching-Resources/Convolution-Digital-Signal-Processing",
        "url": "https://github.com/MathWorks-Teaching-Resources/Convolution-Digital-Signal-Processing",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      }
    ]
  },
  {
    "file": "Lab_adc-cozunurluk.html",
    "slug": "adc-cozunurluk",
    "name": "ADC Çözünürlük ve Kuantalama",
    "category": "sinyal",
    "description": "İdeal tek kutuplu ADC için LSB, sayısal kod ve giriş kuantalama aralığını hesaplayın.",
    "icon": "wave",
    "method": "LSB=Vref/2ᴺ; kod=min(2ᴺ−1, floor(Vin/LSB)); kod alt sınırı=kod·LSB.",
    "inputs": "ADC bit sayısı (tamsayı); Tam ölçek referansı (V); Analog giriş (V).",
    "outputs": "Sayısal sonuçlar, model açıklaması, desteklenen hesaplarda grafik; CSV, PDF ve proje yedeği.",
    "expansion": true,
    "sources": [
      {
        "title": "arm-education/Digital-Signal-Processing-Education-Kit",
        "url": "https://github.com/arm-education/Digital-Signal-Processing-Education-Kit",
        "note": "ADC/DSP konusu referansı; eğitim kitinden kod veya içerik kopyalanmadı."
      }
    ]
  },
  {
    "file": "Lab_opamp-kazanc.html",
    "slug": "opamp-kazanc",
    "name": "İdeal Op-Amp Kazanç ve Doyma",
    "category": "elektronik",
    "description": "Eviren ve evirmeyen yükselteçte kapalı çevrim kazancını ve verilen çıkış sınırlarına göre doyumu görün.",
    "icon": "bolt",
    "method": "Ainv=−Rf/Rin; Anon=1+Rf/Rin; Vçıkış=clip(A·Vin, Valt, Vüst).",
    "inputs": "Topoloji; Giriş gerilimi (V); Giriş/alt direnç (Ω); Geri besleme direnci (Ω); Kullanılabilir alt çıkış sınırı (V); Kullanılabilir üst çıkış sınırı (V).",
    "outputs": "Sayısal sonuçlar, model açıklaması, desteklenen hesaplarda grafik; CSV, PDF ve proje yedeği.",
    "expansion": true,
    "sources": [
      {
        "title": "mikinty/Hardware-Engineer-Interview-Questions",
        "url": "https://github.com/mikinty/Hardware-Engineer-Interview-Questions",
        "note": "Op-amp konusu referansı; soru metinleri veya kod kopyalanmadı."
      }
    ]
  },
  {
    "file": "Lab_rf-link-butcesi.html",
    "slug": "rf-link-butcesi",
    "name": "RF Serbest Uzay Bağlantı Bütçesi",
    "category": "sinyal",
    "description": "Friis serbest uzay kaybını, alınan gücü ve dalga boyunu hesaplayın; mesafe etkisini karşılaştırın.",
    "icon": "wave",
    "method": "λ=c/f; FSPL=20log₁₀(4πd/λ); Pr(dBm)=Pt+Gt+Gr−FSPL−Lek.",
    "inputs": "Frekans (MHz); Mesafe (m); Verici gücü (dBm); Verici anten kazancı (dBi); Alıcı anten kazancı (dBi); Ek sistem kaybı (dB).",
    "outputs": "Sayısal sonuçlar, model açıklaması, desteklenen hesaplarda grafik; CSV, PDF ve proje yedeği.",
    "expansion": true,
    "sources": [
      {
        "title": "jman4162/RF-and-Antenna-Tutorials",
        "url": "https://github.com/jman4162/RF-and-Antenna-Tutorials",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      },
      {
        "title": "andrew-burger/KlopfensteinTaper",
        "url": "https://github.com/andrew-burger/KlopfensteinTaper",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      }
    ]
  },
  {
    "file": "Lab_faz-dizili-anten.html",
    "slug": "faz-dizili-anten",
    "name": "Doğrusal Faz Dizili Anten",
    "category": "sinyal",
    "description": "Eşit genlikli doğrusal anten dizisinin normalize dizi faktörünü ve yönlendirme etkisini görüntüleyin.",
    "icon": "wave",
    "method": "AF(θ)=|Σexp(jn·2π(d/λ)(sinθ−sinθ₀))|/N.",
    "inputs": "Eleman sayısı (tamsayı); Eleman aralığı / dalga boyu; Yönlendirme açısı · geniş yüzeye göre (°).",
    "outputs": "Sayısal sonuçlar, model açıklaması, desteklenen hesaplarda grafik; CSV, PDF ve proje yedeği.",
    "expansion": true,
    "sources": [
      {
        "title": "jman4162/Phased-Array-Antenna-Model",
        "url": "https://github.com/jman4162/Phased-Array-Antenna-Model",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      },
      {
        "title": "jman4162/RF-and-Antenna-Tutorials",
        "url": "https://github.com/jman4162/RF-and-Antenna-Tutorials",
        "note": "Konu ve özellik incelemesi; bağımsız VoltGuard uygulaması."
      }
    ]
  }
];

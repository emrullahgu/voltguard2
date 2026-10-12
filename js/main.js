/**
 * VoltGuard – main.js  (yalnızca ana sayfa: index.html)
 * Endüstriyel Mühendislik Çözümleri
 *
 * Başlık/menü/çapa kaydırma: js/vg-shell.js (tüm sayfalarda ortak).
 * Ağır işler (hero tuvali, osiloskop, videolar, harita) görünüme girince ya da sayfa yüklendikten
 * sonra boşta başlar; "hareketi azalt" tercihine her yerde uyulur.
 */

(function () {
  'use strict';

  /* ------------------------------------------------
     Helper: query selector
  ------------------------------------------------- */
  function qs(selector, parent) {
    return (parent || document).querySelector(selector);
  }

  function qsAll(selector, parent) {
    return (parent || document).querySelectorAll(selector);
  }

  var hasIO = 'IntersectionObserver' in window;

  /* Sayfa yüklendikten sonra, tarayıcı boşta kalınca çalıştır (LCP / ana iş parçacığıyla yarışmasın). */
  function whenIdle(fn) {
    function go() {
      if ('requestIdleCallback' in window) { window.requestIdleCallback(fn, { timeout: 1500 }); }
      else { setTimeout(fn, 200); }
    }
    if (document.readyState === 'complete') { go(); } else { window.addEventListener('load', go, { once: true }); }
  }

  /* ------------------------------------------------
     Motion / viewport preferences (live)
  ------------------------------------------------- */
  var reduceMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var desktopMQ = window.matchMedia('(min-width: 769px)');
  var prefersReducedMotion = reduceMotionMQ.matches;
  var motionListeners = [];

  function onMotionChange(fn) { motionListeners.push(fn); }

  if (reduceMotionMQ.addEventListener) {
    reduceMotionMQ.addEventListener('change', function (e) {
      prefersReducedMotion = e.matches;
      syncSmilAnimations();
      motionListeners.forEach(function (fn) { try { fn(); } catch (err) { /* no-op */ } });
    });
  }

  /* Footer imzasındaki SMIL (animateMotion) animasyonları CSS'teki reduced-motion
     kuralından etkilenmez; tercih açıksa SVG zaman çizelgesini duraklat. */
  function syncSmilAnimations() {
    qsAll('svg.sig-trace').forEach(function (svg) {
      try {
        if (prefersReducedMotion) {
          if (svg.pauseAnimations) svg.pauseAnimations();
        } else if (svg.unpauseAnimations) {
          svg.unpauseAnimations();
        }
      } catch (err) { /* no-op */ }
    });
  }
  syncSmilAnimations();

  /* ------------------------------------------------
     0. PRELOADER
     Oturum başına bir kez gösterilir (index.html <head>: .vg-pl-skip). Bu betik DOM hazır olunca
     kapatır; JS gecikirse css/home.css ~1 sn sonra kendisi kaldırır.
  ------------------------------------------------- */
  var preloader = qs('#preloader');
  var preloaderGone = !preloader || document.documentElement.classList.contains('vg-pl-skip');
  var afterPreloader = [];

  function hidePreloader() {
    if (preloader && !preloader.classList.contains('hidden')) {
      preloader.classList.add('hidden');
    }
    if (!preloaderGone) {
      preloaderGone = true;
      setTimeout(function () { afterPreloader.forEach(function (fn) { fn(); }); afterPreloader = []; }, 250);
    }
  }
  function whenPreloaderGone(fn) { if (preloaderGone) fn(); else afterPreloader.push(fn); }

  if (preloader) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hidePreloader, { once: true });
    } else {
      /* Script defer/async ile sonradan yüklendiyse DOM zaten hazır demektir. */
      hidePreloader();
    }
    setTimeout(hidePreloader, 1500);
  }

  window.addEventListener('load', function () {
    hidePreloader();

    /* CSP-safe image error handling (replaces inline onerror) */
    qsAll('img[loading="lazy"], .hero__bg-img').forEach(function (img) {
      if (img.complete && img.naturalWidth === 0) {
        handleImageError(img);
      } else {
        img.addEventListener('error', function () {
          handleImageError(img);
        });
      }
    });
  });

  function handleImageError(img) {
    img.classList.add('img-error');
    if (img.closest('.project-card--overlay') || img.closest('.about__img-wrapper')) {
      img.parentElement.classList.add('img-placeholder');
    }
  }

  /* ------------------------------------------------
     1b. SCROLL PROGRESS BAR (transform: her karede layout yok)
  ------------------------------------------------- */
  var scrollProgress = qs('#scrollProgress');

  function updateScrollProgress() {
    if (!scrollProgress) return;
    var docHeight = document.documentElement.scrollHeight - window.innerHeight;
    var progress = docHeight > 0 ? Math.min(1, Math.max(0, window.scrollY / docHeight)) : 0;
    scrollProgress.style.transform = 'scaleX(' + progress.toFixed(4) + ')';
  }

  /* ------------------------------------------------
     1c. HERO PARALLAX + SPOTLIGHT
  ------------------------------------------------- */
  var heroBgImg = qs('.hero__bg-img');
  var heroDecoration = qs('.hero__decoration');
  var heroSpotlight = qs('#heroSpotlight');
  var heroSection = qs('#anasayfa');
  var heroInView = true;

  function updateParallax() {
    if (prefersReducedMotion || !heroInView) return;
    var scrollY = window.scrollY;
    if (scrollY < window.innerHeight) {
      if (heroBgImg) {
        heroBgImg.style.transform = 'translateY(' + (scrollY * 0.3) + 'px) scale(1.05)';
      }
      if (heroDecoration) {
        heroDecoration.style.transform = 'translateY(calc(-50% + ' + (scrollY * 0.15) + 'px))';
      }
    }
  }

  var scrollTicking = false;

  window.addEventListener('scroll', function () {
    if (!scrollTicking) {
      requestAnimationFrame(function () {
        updateScrollProgress();
        updateParallax();
        updateFloatingButtons();
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  }, { passive: true });

  if (heroSection && hasIO) {
    new IntersectionObserver(function (entries) {
      heroInView = entries[0].isIntersecting;
    }).observe(heroSection);
  }

  if (heroSpotlight && heroSection) {
    /* rAF throttle: mousemove saniyede yüzlerce kez ateşleniyor; sadece bir sonraki frame'de uygula. */
    var spotPending = false;
    var spotX = 0, spotY = 0;
    var spotRect = null;

    var applySpotlight = function () {
      spotPending = false;
      heroSpotlight.style.left = spotX + 'px';
      heroSpotlight.style.top = spotY + 'px';
      heroSpotlight.style.opacity = '0.95';
    };

    heroSection.addEventListener('mousemove', function (e) {
      if (!desktopMQ.matches || prefersReducedMotion) return;
      if (!spotRect) spotRect = heroSection.getBoundingClientRect();
      spotX = e.clientX - spotRect.left;
      spotY = e.clientY - spotRect.top;
      if (!spotPending) {
        spotPending = true;
        requestAnimationFrame(applySpotlight);
      }
    }, { passive: true });

    /* Layout değişebilir: scroll/resize sonrası rect'i tazele. */
    window.addEventListener('resize', function () { spotRect = null; }, { passive: true });
    window.addEventListener('scroll', function () { spotRect = null; }, { passive: true });

    heroSection.addEventListener('mouseleave', function () {
      heroSpotlight.style.opacity = '0.7';
      heroSpotlight.style.left = '72%';
      heroSpotlight.style.top = '38%';
    });
  }

  updateScrollProgress();

  /* ------------------------------------------------
     4. REVEAL ON SCROLL — Intersection Observer
  ------------------------------------------------- */
  var revealEls = qsAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');

  if (hasIO) {
    var revealObserver = new IntersectionObserver(
      function (entries, observer) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -60px 0px' }
    );

    revealEls.forEach(function (el) {
      revealObserver.observe(el);
    });
  } else {
    /* Fallback: show all elements if IntersectionObserver not supported */
    revealEls.forEach(function (el) {
      el.classList.add('visible');
    });
  }

  /* ------------------------------------------------
     4b. SÜREÇ ADIMLARI — görünür olunca çizgi dolar, adımlar sırayla yanar (css/home.css)
  ------------------------------------------------- */
  var timeline = qs('.process__timeline');
  if (timeline) {
    if (hasIO && !prefersReducedMotion) {
      var timelineObserver = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) {
          timeline.classList.add('is-drawn');
          timelineObserver.disconnect();
        }
      }, { threshold: 0.35 });
      timelineObserver.observe(timeline);
    } else {
      timeline.classList.add('is-drawn');
    }
  }

  /* ------------------------------------------------
     5. SCROLL-TO-TOP BUTTON + WHATSAPP + MOBILE CTA
     Mobil yapışkan çubuk, iletişim bölümü ekrandayken gizlenir (formu örtmesin).
  ------------------------------------------------- */
  var scrollTopBtn = qs('#scrollTop');
  var whatsappFloat = qs('#whatsappFloat');
  var mobileCta = qs('#mobileCta');
  var contactSection = qs('#iletisim');
  var contactInView = false;

  function updateFloatingButtons() {
    var y = window.scrollY;
    if (scrollTopBtn) scrollTopBtn.classList.toggle('visible', y > 420);
    if (whatsappFloat) whatsappFloat.classList.toggle('visible', y > 200);
    if (mobileCta) mobileCta.classList.toggle('visible', y > 300 && !contactInView);
  }

  if (contactSection && mobileCta && hasIO) {
    new IntersectionObserver(function (entries) {
      contactInView = entries[0].isIntersecting;
      updateFloatingButtons();
    }, { rootMargin: '0px 0px -35% 0px' }).observe(contactSection);
  }

  if (scrollTopBtn) {
    scrollTopBtn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    });
  }

  /* Note: updateFloatingButtons is called within the unified rAF scroll handler above */
  updateFloatingButtons();

  /* ------------------------------------------------
     7. SMOOTH SCROLL — anchor links
  ------------------------------------------------- */
  /* Sayfa içi #bölüm bağlantıları js/vg-shell.js'e bırakılır: belge düzeyindeki dinleyicisi geçmişe ekler, başlığın
     altına hizalar, content-visibility kaymasını düzeltir ve klavye odağını hedef bölüme taşır (halka çizmeden).
     Aşağıdaki yalnızca vg-shell.js yüklenemezse çalışan yedektir; o da odağı hedefe taşır. */
  function focusAnchorTarget(el) {
    if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName)) {
      el.setAttribute('tabindex', '-1');
      el.setAttribute('data-vg-anchor-focus', '');
      el.style.outline = 'none';
    }
    try { el.focus({ preventScroll: true }); } catch (err) { /* eski tarayıcı */ }
  }
  qsAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      if (e.defaultPrevented || (window.VGShell && window.VGShell.scrollTo)) return;
      if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var href = this.getAttribute('href');
      if (!href || href.length < 2) return;
      var target = null;
      try { target = document.getElementById(decodeURIComponent(href.slice(1))); } catch (err) { /* geçersiz çapa */ }
      if (!target) return;
      e.preventDefault();
      var offset = target.getBoundingClientRect().top + window.scrollY
                   - (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--vg-header-h'), 10) || 68) - 12;
      window.scrollTo({ top: offset, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
      try { if (location.hash !== href) history.pushState(null, '', href); } catch (err) { /* no-op */ }
      focusAnchorTarget(target);
    });
  });

  /* ------------------------------------------------
     8. CONTACT FORM — client-side validation & submit
  ------------------------------------------------- */
  var contactForm = qs('#contactForm');
  var submitCooldownMs = 60000;
  var SUBMIT_HTML = '<i class="fas fa-paper-plane" aria-hidden="true"></i> Talebi Gönder';

  /* localStorage erişimi gizli sekme / engellenmiş site verisinde istisna fırlatabilir. */
  function safeStorageGet(key) {
    try { return localStorage.getItem(key); } catch (err) { return null; }
  }
  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (err) { /* no-op */ }
  }

  /* Satır içi hata mesajları (WCAG 3.3.1 / 3.3.3): alanın altında metin + aria-describedby + aria-invalid.
     KVKK onayında mesaj kutunun altına gelir ve aria-invalid onay kutusunun kendisine yazılır. */
  function errorId(el) { return (el.id || 'captcha') + 'Error'; }

  function setFieldError(el, msg) {
    if (!el) return;
    var id = errorId(el);
    var p = document.getElementById(id);
    if (!p) {
      p = document.createElement('p');
      p.id = id;
      p.className = 'form__error';
      var consentWrap = el.closest('.form__consent');
      var host = el.closest('.form__group') || el.closest('.form__captcha');
      if (consentWrap) consentWrap.parentNode.insertBefore(p, consentWrap.nextSibling);
      else if (host) host.appendChild(p);
      else el.parentNode.insertBefore(p, el.nextSibling);
    }
    p.textContent = msg;
    el.classList.add('is-invalid');
    el.setAttribute('aria-invalid', 'true');
    var ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    if (ids.indexOf(id) < 0) { ids.push(id); el.setAttribute('aria-describedby', ids.join(' ')); }
  }

  function clearFieldError(el) {
    if (!el) return;
    var id = errorId(el);
    var p = document.getElementById(id);
    if (p) p.remove();
    el.classList.remove('is-invalid');
    el.removeAttribute('aria-invalid');
    var ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(function (x) { return x && x !== id; });
    if (ids.length) { el.setAttribute('aria-describedby', ids.join(' ')); } else { el.removeAttribute('aria-describedby'); }
  }

  function clearInvalidState(form) {
    qsAll('[aria-invalid="true"], .is-invalid', form).forEach(clearFieldError);
  }

  function isValidTrMobile(phone) {
    var digits = phone.replace(/\D/g, '');
    if (digits.length === 10 && digits.charAt(0) === '5') return true;
    if (digits.length === 11 && digits.charAt(0) === '0' && digits.charAt(1) === '5') return true;
    if (digits.length === 12 && digits.slice(0, 2) === '90' && digits.charAt(2) === '5') return true;
    return false;
  }

  /* contact.php FILTER_VALIDATE_EMAIL kullanır: yalnızca ASCII adresler, ardışık nokta yok, en az 2 harfli TLD
     (js/factory.js isValidEmail ile aynı kural) */
  function isValidEmail(m) {
    m = String(m);
    if (m.length > 120 || m.indexOf('..') > -1) return false;
    if (!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(m)) return false;
    var local = m.split('@')[0];
    return local.charAt(0) !== '.' && local.charAt(local.length - 1) !== '.' && /\.[A-Za-z]{2,}$/.test(m);
  }

  var syncCounter = function () {};

  if (contactForm) {
    var messageField = qs('#message', contactForm);
    var counterEl = qs('#messageCounter', contactForm);
    var timestampField = qs('#formTimestamp', contactForm);
    var captchaFieldName = 'cf-turnstile-response';
    /* Turnstile is optional until a real site key is set. With the placeholder key,
       hide the widget and don't require a token (server also falls back gracefully). */
    var captchaWidget = qs('.cf-turnstile', contactForm);
    var captchaSitekey = captchaWidget ? (captchaWidget.getAttribute('data-sitekey') || '') : '';
    var captchaEnabled = !!captchaWidget && captchaSitekey !== '' && captchaSitekey.indexOf('REPLACE_WITH') !== 0;
    if (!captchaEnabled) {
      var capWrap = qs('.form__captcha', contactForm);
      if (capWrap) { capWrap.style.display = 'none'; }
    }

    var getCaptchaToken = function () {
      var tokenField = contactForm.querySelector('input[name="' + captchaFieldName + '"]');
      return tokenField ? tokenField.value.trim() : '';
    };

    var resetCaptcha = function () {
      if (window.turnstile && typeof window.turnstile.reset === 'function') {
        try {
          window.turnstile.reset();
        } catch (err) {
          /* no-op */
        }
      }
    };

    var MSG_MAX = 1000;
    var serviceSel = qs('#service', contactForm);
    var subjectSel = qs('#subject', contactForm);

    /* İsteğe bağlı "İlgilendiğiniz hizmet": contact.php yalnızca 5 "subject" değerini kabul eder, başka alan okumaz.
       Seçilen hizmet gönderimde mesajın başına eklenir; mesaj alanının üst sınırı bu önek kadar kısalır (sunucu: 20–1000). */
    var servicePrefix = function () {
      if (!serviceSel || !serviceSel.value) return '';
      return 'İlgilenilen hizmet: ' + serviceSel.options[serviceSel.selectedIndex].text.trim() + '\n\n';
    };
    var messageMax = function () { return MSG_MAX - servicePrefix().length; };

    var CHECKS = {
      name: function (v) { return v.length >= 2 && v.length <= 100 ? '' : 'Ad soyad en az 2 karakter olmalı.'; },
      phone: function (v) { return isValidTrMobile(v) ? '' : 'Geçerli bir cep telefonu girin (05XX XXX XX XX).'; },
      email: function (v) { return !v || isValidEmail(v) ? '' : 'Geçerli bir e-posta adresi girin (örnek: ad@firma.com).'; },
      subject: function (v) { return v ? '' : 'Lütfen bir hizmet alanı seçin.'; },
      message: function (v, el) {
        if (v.length < 20) return 'Mesajınız en az 20 karakter olmalı.';
        if (v.length > messageMax()) return 'Mesajınız en fazla ' + messageMax() + ' karakter olabilir.';
        /* Teklif bağlantısının hazır metni hiç değiştirilmeden ya da "ihtiyacımız:" boş bırakılarak gönderilmesin */
        if ((el.dataset.auto === '1' && el.dataset.prefillComplete !== '1') || /ihtiyacımız:$/i.test(v)) return 'Lütfen ihtiyacınızı kısaca yazın.';
        return '';
      },
      consent: function (v, el) { return el.checked ? '' : 'Devam etmek için KVKK onayı gerekli.'; }
    };
    var fieldError = function (el) {
      var fn = el && CHECKS[el.id];
      return fn ? fn(el.type === 'checkbox' ? '' : el.value.trim(), el) : '';
    };

    syncCounter = function () {
      if (!messageField || !counterEl) return;
      var max = messageMax();
      if (String(max) !== messageField.getAttribute('maxlength')) messageField.setAttribute('maxlength', String(max));
      var len = messageField.value.length;
      counterEl.textContent = len + ' / ' + max;
      counterEl.classList.toggle('limit', len > max - 80);
    };

    /* Hata gösterilmiş bir alan düzeltildikçe mesajı güncelle / kaldır */
    var revalidate = function (e) {
      var el = e.target;
      if (!el || el.getAttribute('aria-invalid') !== 'true' || !CHECKS[el.id]) return;
      var msg = fieldError(el);
      if (msg) { setFieldError(el, msg); } else { clearFieldError(el); }
    };
    contactForm.addEventListener('input', revalidate);
    contactForm.addEventListener('change', revalidate);

    if (serviceSel) {
      serviceSel.addEventListener('change', function () {
        var opt = serviceSel.options[serviceSel.selectedIndex];
        var mapped = opt ? opt.getAttribute('data-subject') : '';
        if (mapped && subjectSel && (!subjectSel.value || subjectSel.dataset.auto === '1')) {
          subjectSel.value = mapped;
          subjectSel.dataset.auto = '1';
          if (subjectSel.getAttribute('aria-invalid') === 'true') clearFieldError(subjectSel);
        }
        syncCounter();
        if (messageField && messageField.getAttribute('aria-invalid') === 'true') revalidate({ target: messageField });
      });
      /* Hizmeti önceden seç (seçim "change" ile Hizmet Alanı'nı da doldurur):
         1) /?hizmet=<slug>#iletisim — hizmet sayfalarındaki "Teklif Al" bağlantıları;
         2) yedek: sessionStorage 'vgServiceInterest' — js/services.js teklif tıklamasında yazar (hizmetler merkezi,
            eski /#iletisim bağlantıları). Anahtar okunur okunmaz silinir; tarayıcının geri yüklediği bir seçimin
            üzerine yazılmaz. Her iki değer de [a-z0-9-] ile sınırlanır ve yalnızca listede olan bir seçenekse kullanılır. */
      var cleanSlug = function (v) { return String(v || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64); };
      var knownSlug = function (v) { return v && qs('option[value="' + v + '"]', serviceSel) ? v : ''; };
      var storedSlug = '';
      try {
        storedSlug = cleanSlug(window.sessionStorage.getItem('vgServiceInterest'));
        window.sessionStorage.removeItem('vgServiceInterest');
      } catch (err) { /* depolama kapalı / gizli sekme */ }
      var urlSlug = '';
      try { urlSlug = cleanSlug(new URLSearchParams(window.location.search).get('hizmet')); } catch (err) { /* no-op */ }
      var wanted = knownSlug(urlSlug) || (serviceSel.value ? '' : knownSlug(storedSlug));
      if (wanted && serviceSel.value !== wanted) {
        serviceSel.value = wanted;
        serviceSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    var resetFormExtras = function () {
      clearInvalidState(contactForm);
      if (messageField) { delete messageField.dataset.auto; delete messageField.dataset.prefillComplete; }
      if (subjectSel) delete subjectSel.dataset.auto;
      if (timestampField) timestampField.value = String(Date.now());
      syncCounter();
    };

    if (timestampField) {
      timestampField.value = String(Date.now());
      /* bfcache (geri/ileri) ile dönüldüğünde damgayı tazele ki sunucu doğrulaması tutarlı kalsın. */
      window.addEventListener('pageshow', function (e) {
        if (e.persisted) { timestampField.value = String(Date.now()); }
      });
    }

    if (messageField) {
      messageField.addEventListener('input', function (e) {
        if (e.isTrusted) delete messageField.dataset.auto; /* kullanıcı yazdıysa artık otomatik metin değil */
        syncCounter();
      });
      syncCounter();
    }

    /* Auto-format phone input for Turkish numbers */
    var phoneInput = qs('#phone', contactForm);
    if (phoneInput) {
      phoneInput.addEventListener('input', function () {
        var hasPlus = /^\s*\+/.test(this.value);
        var digits = this.value.replace(/\D/g, '');
        /* Henüz rakam yoksa (ya da yalnızca "+9" yazıldıysa) baştaki "+" korunsun */
        if (!digits || (hasPlus && digits === '9')) { this.value = (hasPlus ? '+' : '') + digits; return; }
        var formatted;
        if (digits.slice(0, 2) === '90') {
          /* Uluslararası 90… biçimi: 12 haneye kadar koru (validator/sunucu kabul ediyor). */
          digits = digits.slice(0, 12);
          formatted = (hasPlus ? '+' : '') + digits.slice(0, 2);
          if (digits.length > 2) formatted += ' ' + digits.slice(2, 5);
          if (digits.length > 5) formatted += ' ' + digits.slice(5, 8);
          if (digits.length > 8) formatted += ' ' + digits.slice(8, 10);
          if (digits.length > 10) formatted += ' ' + digits.slice(10, 12);
        } else {
          /* Yerel 05XX… biçimi. */
          if (digits.length > 11) digits = digits.slice(0, 11);
          formatted = '';
          if (digits.length > 0) formatted = digits.slice(0, 4);
          if (digits.length > 4) formatted += ' ' + digits.slice(4, 7);
          if (digits.length > 7) formatted += ' ' + digits.slice(7, 9);
          if (digits.length > 9) formatted += ' ' + digits.slice(9, 11);
        }
        this.value = formatted;
      });
    }

    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();

      clearInvalidState(contactForm);

      var messageInput = qs('#message', contactForm);
      var websiteTrap = qs('#website', contactForm);
      var message = messageInput.value.trim();

      /* Honeypot: real users won't fill this hidden field */
      if (websiteTrap && websiteTrap.value.trim()) {
        showNotification('Mesajınız alındı, teşekkür ederiz.', 'success');
        contactForm.reset();
        resetFormExtras();
        return;
      }

      /* Simple rate-limit for automated spam retries */
      var now = Date.now();
      var lastSubmit = parseInt(safeStorageGet('vg_last_submit_at') || '0', 10);
      if (lastSubmit && now - lastSubmit < submitCooldownMs) {
        var seconds = Math.ceil((submitCooldownMs - (now - lastSubmit)) / 1000);
        showNotification('Yeni gönderim için ' + seconds + ' saniye bekleyin.', 'error');
        return;
      }

      /* Not: "çok hızlı gönderim" sezgiseli kaldırıldı — sunucu (contact.php) da bunu
         uygulamıyor ve saati ileri olan cihazlarda meşru kullanıcıları yanlışlıkla
         engelliyordu. Bot savunması honeypot + cooldown + sunucu rate-limit + Turnstile. */

      var firstInvalid = null;
      var errorCount = 0;
      ['name', 'phone', 'email', 'subject', 'message', 'consent'].forEach(function (id) {
        var el = qs('#' + id, contactForm);
        var msg = fieldError(el);
        if (!msg) return;
        setFieldError(el, msg);
        errorCount++;
        if (!firstInvalid) firstInvalid = el;
      });
      /* Güvenlik doğrulaması yalnızca Turnstile gerçekten etkinse istenir (yer tutucu anahtarda gizli) */
      if (captchaEnabled && !getCaptchaToken()) {
        setFieldError(qs('.form__captcha', contactForm), 'Lütfen güvenlik doğrulamasını tamamlayın.');
        errorCount++;
      }

      if (errorCount) {
        showNotification(errorCount === 1 ? 'Lütfen işaretli alanı düzeltin.' : 'Lütfen işaretli ' + errorCount + ' alanı düzeltin.', 'error');
        if (firstInvalid) { try { firstInvalid.focus({ preventScroll: false }); } catch (err) { firstInvalid.focus(); } }
        return;
      }

      /* Real submission to backend endpoint */
      var submitBtn = contactForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Gönderiliyor...';

      var payload = new FormData(contactForm);
      payload.set('message', servicePrefix() + message);

      fetch('contact.php', {
        method: 'POST',
        body: payload,
        headers: {
          'Accept': 'application/json'
        }
      })
        .then(function (response) {
          return response.json().then(function (data) {
            return { ok: response.ok, data: data };
          }).catch(function () {
            return { ok: false, data: { message: 'Sunucudan geçersiz yanıt alındı.' } };
          });
        })
        .then(function (result) {
          if (!result.ok || !result.data || !result.data.success) {
            var srvMsg = result.data && result.data.message ? result.data.message : 'Gönderim başarısız oldu.';
            /* Sunucu e-postayı reddettiyse alanı işaretle ve odakla */
            if (/e-posta/i.test(srvMsg)) {
              var emailEl = qs('#email', contactForm);
              if (emailEl) {
                setFieldError(emailEl, srvMsg);
                try { emailEl.focus({ preventScroll: false }); } catch (err) { emailEl.focus(); }
              }
            }
            throw new Error(srvMsg);
          }

          showNotification(
            'Talebiniz alındı! En kısa sürede sizinle iletişime geçeceğiz.',
            'success'
          );
          safeStorageSet('vg_last_submit_at', String(Date.now()));
          contactForm.reset();
          resetCaptcha();
          resetFormExtras();
        })
        .catch(function (error) {
          resetCaptcha();
          if (timestampField) timestampField.value = String(Date.now());
          var msg = (error && error.name === 'TypeError')
            ? 'Bağlantı hatası. İnternet bağlantınızı kontrol edip tekrar deneyin.'
            : ((error && error.message) || 'Gönderim sırasında bir hata oluştu.');
          showNotification(msg, 'error');
        })
        .finally(function () {
          submitBtn.disabled = false;
          submitBtn.innerHTML = SUBMIT_HTML;
        });
    });
  }

  /* ------------------------------------------------
     8b. TEKLİF / ÖN DEĞERLENDİRME BAĞLANTILARI — formu önceden doldur
     <a href="#iletisim" data-subject="elektrik" data-prefill="..."> : hizmet alanı ve mesaj alanı boşsa
     (ya da yalnızca daha önce otomatik doldurulmuşsa) doldurulur; kullanıcının yazdığı metne dokunulmaz.
  ------------------------------------------------- */
  document.addEventListener('click', function (e) {
    if (!contactForm || !e.target || !e.target.closest) return;
    var link = e.target.closest('a[data-prefill], a[data-subject]');
    if (!link) return;
    var subjectSel = qs('#subject', contactForm);
    var msgField = qs('#message', contactForm);
    var subject = link.getAttribute('data-subject');
    var text = link.getAttribute('data-prefill');
    if (subject && subjectSel && (!subjectSel.value || subjectSel.dataset.auto === '1') && qs('option[value="' + subject + '"]', subjectSel)) {
      subjectSel.value = subject;
      subjectSel.dataset.auto = '1';
    }
    if (text && msgField && (!msgField.value.trim() || msgField.dataset.auto === '1')) {
      msgField.value = text;
      msgField.dataset.auto = '1';
      /* data-prefill-complete: hazır metin tek başına anlamlı bir talep (ör. duruş maliyeti özeti) */
      if (link.hasAttribute('data-prefill-complete')) { msgField.dataset.prefillComplete = '1'; } else { delete msgField.dataset.prefillComplete; }
      syncCounter();
      /* önceden gösterilmiş hata mesajı yeni metne göre güncellensin (sentetik olay: dataset.auto korunur) */
      msgField.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (subjectSel && subjectSel.getAttribute('aria-invalid') === 'true') subjectSel.dispatchEvent(new Event('change', { bubbles: true }));
    /* Klavyeyle (Enter) etkinleştirildiyse, kaydırma bitince odağı formun ilk alanına taşı (görünmüyorsa ortalanır).
       Fare/dokunmada odak taşınmaz, telefonda klavye kendiliğinden açılmasın. */
    if (e.detail === 0) {
      var first = qs('#name', contactForm);
      if (first) focusAfterScroll(first);
    }
  });

  /* Uzak çapada yumuşak kaydırma + js/vg-shell.js hizalama düzeltmesi birkaç "scrollend" üretir: son scrollend'den
     250 ms sonra (en geç 5 sn) odakla; alan yine de görünmüyorsa ortala. Kaydırma hiç başlamadıysa hemen odakla. */
  function focusAfterScroll(el) {
    var t = 0, cap = 0, done = false, y0 = window.scrollY;
    function go() {
      if (done) return;
      done = true;
      window.removeEventListener('scrollend', bump);
      clearTimeout(t); clearTimeout(cap);
      try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
      var r = el.getBoundingClientRect();
      if (r.top < 60 || r.bottom > window.innerHeight - 80) el.scrollIntoView({ block: 'center' });
    }
    function bump() { clearTimeout(t); t = setTimeout(go, 250); }
    if ('onscrollend' in window) {
      window.addEventListener('scrollend', bump);
      cap = setTimeout(go, 5000);
      setTimeout(function () { if (!t && Math.abs(window.scrollY - y0) < 2) go(); }, 200);
    } else {
      t = setTimeout(go, 1200);
    }
  }
  if (contactForm) {
    var subjectSelect = qs('#subject', contactForm);
    if (subjectSelect) subjectSelect.addEventListener('change', function (e) { if (e.isTrusted) delete subjectSelect.dataset.auto; });
  }

  /* ------------------------------------------------
     9. NOTIFICATION TOAST
  ------------------------------------------------- */
  function showNotification(message, type) {
    /* Remove any existing notification */
    var existing = qs('.vg-notification');
    if (existing) existing.remove();

    var el = document.createElement('div');
    el.className = 'vg-notification';
    /* Announce to screen readers: errors assertively, success politely. */
    el.setAttribute('role', type === 'success' ? 'status' : 'alert');
    el.setAttribute('aria-live', type === 'success' ? 'polite' : 'assertive');

    var icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    var bg   = type === 'success' ? '#047857' : '#b91c1c';

    el.innerHTML =
      '<i class="fas ' + icon + '" aria-hidden="true"></i> ' +
      sanitize(message);

    Object.assign(el.style, {
      position:     'fixed',
      bottom:       '2rem',
      left:         '50%',
      transform:    'translateX(-50%) translateY(16px)',
      background:   bg,
      color:        '#fff',
      padding:      '.9rem 1.5rem',
      borderRadius: '8px',
      fontSize:     '.9rem',
      fontWeight:   '600',
      fontFamily:   "var(--font-heading)",
      zIndex:       '9999',
      boxShadow:    '0 10px 30px rgba(0,0,0,.22)',
      display:      'flex',
      alignItems:   'center',
      gap:          '.5rem',
      opacity:      '0',
      transition:   'all .3s ease',
      maxWidth:     'calc(100vw - 2rem)',
      width:        'max-content',
      whiteSpace:   'normal',
      textAlign:    'center',
    });

    document.body.appendChild(el);

    requestAnimationFrame(function () {
      el.style.opacity   = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });

    setTimeout(function () {
      el.style.opacity   = '0';
      el.style.transform = 'translateX(-50%) translateY(16px)';
      setTimeout(function () { el.remove(); }, 320);
    }, 4200);
  }

  /* Minimal DOM text sanitiser — prevents XSS in notification text */
  function sanitize(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ------------------------------------------------
     10. HERO YAZMA EFEKTİ
     H1 sabit metindir ("İzmir Elektrik Mühendislik Hizmetleri"). Dönen kelime H1'in dışındaki aria-hidden
     .hero__typed satırındadır; sabit yükseklikli tek satır olduğu için kelime değişince düzen kaymaz.
     İlk kelime HTML'de hazır gelir. Hero ekranda değilken ya da sekme gizliyken bekler.
  ------------------------------------------------- */
  var typingEl = qs('#heroTyping');
  var typingWords = ['Projelendirme', 'Bakım', 'Otomasyon', 'Proje Yönetimi'];
  var wordIndex = 0;
  var charIndex = typingWords[0].length;
  var isDeleting = true;

  function typeLoop() {
    if (!typingEl) return;
    if (prefersReducedMotion) { typingEl.textContent = typingWords[0]; return; }
    if (document.hidden || !heroInView) { setTimeout(typeLoop, 700); return; }
    var currentWord = typingWords[wordIndex];
    charIndex += isDeleting ? -1 : 1;
    typingEl.textContent = currentWord.substring(0, charIndex);

    var delay = isDeleting ? 55 : 105;
    if (!isDeleting && charIndex === currentWord.length) {
      delay = 2400;
      isDeleting = true;
    } else if (isDeleting && charIndex === 0) {
      isDeleting = false;
      wordIndex = (wordIndex + 1) % typingWords.length;
      delay = 380;
    }
    setTimeout(typeLoop, delay);
  }

  if (typingEl && !prefersReducedMotion) {
    whenPreloaderGone(function () { setTimeout(typeLoop, 3000); });
  }

  /* ------------------------------------------------
     11. ANIMATED STAT COUNTERS
     Gerçek değerler HTML'de hazır. İstatistikler ilk anda görünmüyorsa (ekran dışı ya da ön yükleyici örtüyor)
     sayaç 0'dan sayar; zaten ekrandaysa değer sıfırlanmaz, yalnızca kısa bir vurgu (css/home.css .is-pulse) oynar.
  ------------------------------------------------- */
  var statNumbers = qsAll('[data-count]');
  var statsSection = qs('.hero__stats');
  var statsAnimated = false;
  var statsCountUp = false;

  if (statsSection && statNumbers.length && hasIO && !prefersReducedMotion) {
    var sr = statsSection.getBoundingClientRect();
    if (!preloaderGone || sr.top >= window.innerHeight || sr.bottom <= 0) {
      statsCountUp = true;
      statNumbers.forEach(function (el) {
        el.textContent = (el.getAttribute('data-prefix') || '') + '0' + (el.getAttribute('data-suffix') || '');
      });
    }
  }

  function animateCounters() {
    if (statsAnimated) return;
    statsAnimated = true;

    statNumbers.forEach(function (el, i) {
      var target = parseInt(el.getAttribute('data-count'), 10);
      var prefix = el.getAttribute('data-prefix') || '';
      var suffix = el.getAttribute('data-suffix') || '';

      if (!statsCountUp || prefersReducedMotion || !target) {
        el.textContent = prefix + target + suffix;
        if (!prefersReducedMotion) { el.style.animationDelay = (i * 120) + 'ms'; el.classList.add('is-pulse'); }
        return;
      }

      var duration = 1600;
      var startTime = null;

      function step(timestamp) {
        if (!startTime) startTime = timestamp;
        var progress = Math.min((timestamp - startTime) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = prefix + Math.round(eased * target) + suffix;
        if (progress < 1) requestAnimationFrame(step);
      }

      requestAnimationFrame(step);
    });
  }

  if (statsSection && hasIO) {
    var statsObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          statsObserver.unobserve(entry.target);
          whenPreloaderGone(animateCounters);
        }
      });
    }, { threshold: 0.5 });
    statsObserver.observe(statsSection);
  }

  /* ------------------------------------------------
     12. PROJECT CARD TILT EFFECT
  ------------------------------------------------- */
  var projectCards = qsAll('.project-card--overlay');

  projectCards.forEach(function (card) {
    var tiltPending = false;
    var tiltX = 0, tiltY = 0;
    var cardRect = null;

    function applyTilt() {
      tiltPending = false;
      if (!cardRect) return;
      var centerX = cardRect.width / 2;
      var centerY = cardRect.height / 2;
      var rotateX = ((tiltY - centerY) / centerY) * -6;
      var rotateY = ((tiltX - centerX) / centerX) * 6;
      card.style.transform = 'rotateX(' + rotateX + 'deg) rotateY(' + rotateY + 'deg) scale(1.02)';
    }

    card.addEventListener('mouseenter', function () {
      cardRect = card.getBoundingClientRect();
    });

    card.addEventListener('mousemove', function (e) {
      if (!desktopMQ.matches || prefersReducedMotion) return;
      if (!cardRect) cardRect = card.getBoundingClientRect();
      tiltX = e.clientX - cardRect.left;
      tiltY = e.clientY - cardRect.top;
      if (!tiltPending) {
        tiltPending = true;
        requestAnimationFrame(applyTilt);
      }
    }, { passive: true });

    card.addEventListener('mouseleave', function () {
      cardRect = null;
      card.style.transform = '';
    });
  });

  /* ------------------------------------------------
     13. KART IŞIĞI — .vgh-spot kartlarında imleci izleyen yumuşak ışık (--mx/--my)
     Tek bir pasif dinleyici, rAF ile kısılır; yalnızca fare + hareket serbestken.
  ------------------------------------------------- */
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    var spotCard = null, spotEvt = null, spotRaf = 0;
    document.addEventListener('pointermove', function (e) {
      if (prefersReducedMotion || !e.target || !e.target.closest) return;
      var card = e.target.closest('.vgh-spot');
      if (!card) return;
      spotCard = card; spotEvt = e;
      if (!spotRaf) {
        spotRaf = requestAnimationFrame(function () {
          spotRaf = 0;
          var r = spotCard.getBoundingClientRect();
          spotCard.style.setProperty('--mx', Math.round(spotEvt.clientX - r.left) + 'px');
          spotCard.style.setProperty('--my', Math.round(spotEvt.clientY - r.top) + 'px');
        });
      }
    }, { passive: true });
  }

  /* ------------------------------------------------
     14. DURUŞ MALİYETİ HIZLI TAHMİNİ (Fabrikalar İçin)
     yıllık maliyet = yıllık duruş saati × saatlik maliyet. Form JS'siz de çalışır (GET →
     /fabrika-cozumleri.html?saat=..&tl=..#durus-maliyeti); burada yalnızca canlı sonuç ve
     "Ücretsiz Ön Değerlendirme" bağlantısının ön-doldurma metni güncellenir.
  ------------------------------------------------- */
  (function () {
    var form = qs('#downtimeCalc');
    if (!form) return;
    var hours = qs('#dtHours', form), rate = qs('#dtRate', form);
    var hoursOut = qs('#dtHoursOut', form), rateOut = qs('#dtRateOut', form);
    var totalEl = qs('#dtTotal', form), monthlyEl = qs('#dtMonthly', form), live = qs('#dtLive', form);
    var quote = qs('#dtQuote', form);
    if (!hours || !rate || !totalEl) return;
    var nf = (window.Intl && Intl.NumberFormat) ? new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }) : null;
    var shown = (+hours.value) * (+rate.value), tweenRaf = 0, liveTimer = 0;

    function tl(n) { return (nf ? nf.format(n) : String(Math.round(n))) + ' TL'; }
    function fill(input) {
      var min = +input.min, max = +input.max;
      input.style.setProperty('--p', ((+input.value - min) / (max - min)).toFixed(4));
    }
    function tweenTo(target) {
      if (tweenRaf) cancelAnimationFrame(tweenRaf);
      if (prefersReducedMotion) { shown = target; totalEl.textContent = tl(target); return; }
      var from = shown, t0 = null;
      function step(ts) {
        if (!t0) t0 = ts;
        var p = Math.min(1, (ts - t0) / 320);
        shown = from + (target - from) * (1 - Math.pow(1 - p, 3));
        totalEl.textContent = tl(Math.round(shown / 1000) * 1000);
        if (p < 1) { tweenRaf = requestAnimationFrame(step); } else { tweenRaf = 0; shown = target; totalEl.textContent = tl(target); }
      }
      tweenRaf = requestAnimationFrame(step);
    }
    function update(announce) {
      var h = +hours.value, r = +rate.value, total = h * r;
      hoursOut.textContent = h + ' saat';
      rateOut.textContent = tl(r);
      hours.setAttribute('aria-valuetext', h + ' saat');
      rate.setAttribute('aria-valuetext', tl(r));
      fill(hours); fill(rate);
      monthlyEl.textContent = 'Aylık ortalama ≈ ' + tl(Math.round(total / 12));
      tweenTo(total);
      if (quote) {
        quote.setAttribute('data-prefill', 'Fabrikamız için ücretsiz ön değerlendirme talep ediyoruz. Duruş maliyeti hızlı tahmini: yılda yaklaşık ' +
          h + ' saat plansız duruş, saatlik yaklaşık ' + tl(r) + ', yıllık yaklaşık ' + tl(total) + '.');
      }
      if (announce && live) {
        clearTimeout(liveTimer);
        liveTimer = setTimeout(function () { live.textContent = 'Tahmini yıllık duruş maliyeti: ' + tl(total); }, 650);
      }
    }
    hours.addEventListener('input', function () { update(true); });
    rate.addEventListener('input', function () { update(true); });
    /* bfcache / form geri yükleme sonrası kaydırıcı değerleri değişmiş olabilir */
    window.addEventListener('pageshow', function () { update(false); });
    update(false);
  })();

  /* ------------------------------------------------
     15. HERO "ELEKTRİK AKIMI" — hafif canvas arka plan
     Devre izleri resize'da bir kez ekran dışı tuvale çizilir; her karede yalnızca akım darbeleri
     çizilir. Sayfa yüklendikten sonra boşta başlar; hero görünmezken / sekme gizliyken durur;
     imleç yakınındaki darbeler hızlanıp parlar. "Hareketi azalt": yalnızca sabit devre izleri.
  ------------------------------------------------- */
  function initHeroCurrent() {
    var cv = qs('#heroCircuit');
    if (!cv || !cv.getContext || !heroSection) return;
    /* c: görünen tuval, o: devre izlerinin bir kez çizildiği ekran dışı tuval; T: izler (nokta dizisi + .c kümülatif
       uzunluklar + .L toplam), P: akım darbeleri; z: darbe imlece 160px'ten yakın */
    var M = Math, R = M.random, c = cv.getContext('2d'), off = document.createElement('canvas'), o = off.getContext('2d');
    if (!c || !o) return;
    var W = 0, H = 0, dpr = M.min(window.devicePixelRatio || 1, 1.5), T = [], P = [], px = -1e4, py = -1e4;
    var raf = 0, last = 0, vis = 1, rt = 0;
    function rnd(a, b) { return a + R() * (b - a); }
    function on(t, e, f) { t.addEventListener(e, f, { passive: true }); }
    function build() {
      var r = cv.getBoundingClientRect(), n, i, k, x, y, p, L, d;
      if (!r.width || !r.height) return 0;
      W = r.width; H = r.height;
      cv.width = off.width = M.round(W * dpr);
      cv.height = off.height = M.round(H * dpr);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      o.setTransform(dpr, 0, 0, dpr, 0, 0);
      o.strokeStyle = 'rgba(96,165,250,.17)';
      o.fillStyle = 'rgba(245,158,11,.4)';
      T = []; P = [];
      n = M.max(6, M.min(15, M.round(H / 66)));
      for (i = 0; i < n; i++) {
        y = (i + .5) * H / n + rnd(-12, 12); x = rnd(-40, W * .3); p = [[x, y]]; L = [0];
        while (x < W + 40) {
          x += rnd(60, 200); p.push([x, y]);
          if (R() < .55) { d = rnd(12, 32) * (R() < .5 ? -1 : 1); x += M.abs(d); y += d; p.push([x, y]); }
        }
        o.beginPath();
        o.moveTo(p[0][0], p[0][1]);
        for (k = 1; k < p.length; k++) {
          L.push(L[k - 1] + M.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]));
          o.lineTo(p[k][0], p[k][1]);
        }
        o.stroke();
        for (k = 2; k < p.length - 1; k += 3) { o.beginPath(); o.arc(p[k][0], p[k][1], 1.7, 0, 7); o.fill(); }
        p.c = L; p.L = L[L.length - 1]; T.push(p);
      }
      return 1;
    }
    /* iz t üzerinde s uzunluğundaki nokta: [x, y, segment] */
    function at(t, s) {
      var C = t.c, i = 1, a, b, f;
      while (i < C.length - 1 && C[i] < s) i++;
      a = t[i - 1]; b = t[i]; f = (s - C[i - 1]) / ((C[i] - C[i - 1]) || 1);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, i];
    }
    function paint() { c.clearRect(0, 0, W, H); c.drawImage(off, 0, 0, W, H); }
    function frame(ts) {
      var dt = M.min(48, ts - (last || ts)), j, q, h, a, g, k, z;
      last = ts;
      paint();
      if (P.length < T.length && R() < .06) P.push({ t: T[R() * T.length | 0], s: 0, v: rnd(.07, .17) });
      c.lineCap = 'round';
      for (j = P.length - 1; j >= 0; j--) {
        q = P[j]; h = at(q.t, q.s);
        z = (h[0] - px) * (h[0] - px) + (h[1] - py) * (h[1] - py) < 25600;
        q.s += q.v * dt * (z ? 2.6 : 1);
        if (q.s > q.t.L) { P.splice(j, 1); continue; }
        a = at(q.t, M.max(0, q.s - (z ? 120 : 75)));
        g = c.createLinearGradient(a[0], a[1], h[0], h[1]);
        g.addColorStop(0, 'rgba(245,158,11,0)');
        g.addColorStop(1, 'rgba(252,211,77,.95)');
        c.strokeStyle = g; c.lineWidth = z ? 2.4 : 1.6;
        c.beginPath(); c.moveTo(a[0], a[1]);
        for (k = a[2]; k < h[2]; k++) c.lineTo(q.t[k][0], q.t[k][1]);
        c.lineTo(h[0], h[1]); c.stroke();
        c.fillStyle = '#fde68a';
        c.beginPath(); c.arc(h[0], h[1], z ? 2.8 : 1.9, 0, 7); c.fill();
      }
      raf = requestAnimationFrame(frame);
    }
    /* yalnızca hero görünür, sekme açık ve hareket serbestken çalış */
    function halt() { cancelAnimationFrame(raf); raf = last = 0; }
    function go() {
      if (W && vis && !document.hidden && !prefersReducedMotion) { if (!raf) raf = requestAnimationFrame(frame); } else halt();
    }
    function reset() { halt(); if (build()) paint(); go(); }

    on(heroSection, 'pointermove', function (e) {
      if (e.pointerType != 'mouse') return;
      var b = cv.getBoundingClientRect();
      px = e.clientX - b.left; py = e.clientY - b.top;
    });
    on(heroSection, 'pointerleave', function () { px = py = -1e4; });
    on(window, 'resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        var r = cv.getBoundingClientRect();
        /* mobilde adres çubuğu yüksekliği değiştirir: küçük yükseklik farkında izleri yeniden üretme */
        if (M.abs(r.width - W) > 1 || M.abs(r.height - H) > 140) reset();
      }, 200);
    });
    if (hasIO) new IntersectionObserver(function (e) { vis = e[0].isIntersecting; go(); }).observe(cv);
    on(document, 'visibilitychange', go);
    onMotionChange(function () { go(); if (W) paint(); });
    reset();
  }
  whenIdle(initHeroCurrent);

  /* ------------------------------------------------
     16. AKTİF EMI FİLTRE — oscilloscope demo (yalnızca görünürken çizer)
  ------------------------------------------------- */
  (function () {
    var canvas = qs('#emiScope');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var toggle = qs('#emiToggle');
    var stateEl = qs('#emiState');
    var roThd = qs('#roThd'), roPf = qs('#roPf');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0, h = 0, running = false, rafId = null, inView = !hasIO;
    var filterOn = false, phase = 0, mix = 0;

    function resize() {
      var r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      if (w === 0 || h === 0) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function drawGrid() {
      ctx.strokeStyle = 'rgba(59,130,246,0.10)';
      ctx.lineWidth = 1;
      var s = Math.max(22, w / 16), x, y;
      for (x = 0; x <= w; x += s) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (y = 0; y <= h; y += s) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(59,130,246,0.22)';
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    }
    function sample(t) {
      var base = Math.sin(t);
      var noisy = base
        + 0.32 * Math.sin(3 * t + 0.6)
        + 0.18 * Math.sin(5 * t + 1.2)
        + 0.12 * Math.sin(7 * t)
        + 0.07 * Math.sin(11 * t + 0.4)
        + 0.05 * Math.sin(t * 37.7);
      return base * mix + (noisy / 1.4) * (1 - mix);
    }
    function draw() {
      if (w === 0) return;
      ctx.clearRect(0, 0, w, h);
      drawGrid();
      var amp = h * 0.30;
      var col = (mix > 0.5) ? '245,158,11' : '59,130,246';
      ctx.lineWidth = 2.4;
      ctx.lineJoin = 'round';
      ctx.shadowBlur = 14;
      ctx.shadowColor = 'rgba(' + col + ',0.85)';
      ctx.strokeStyle = 'rgba(' + col + ',1)';
      ctx.beginPath();
      var cycles = 3;
      for (var px = 0; px <= w; px++) {
        var t = (px / w) * Math.PI * 2 * cycles + phase;
        var y = h / 2 - sample(t) * amp;
        if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    function setReadouts() {
      if (roThd) {
        roThd.textContent = (filterOn ? 2.8 : 38.5).toFixed(1) + ' %';
        roThd.classList.toggle('readout__value--good', filterOn);
        roThd.classList.toggle('readout__value--bad', !filterOn);
      }
      if (roPf) {
        roPf.textContent = (filterOn ? 0.99 : 0.82).toFixed(2);
        roPf.classList.toggle('readout__value--good', filterOn);
        roPf.classList.toggle('readout__value--bad', !filterOn);
      }
    }
    function setFilter(on) {
      filterOn = on;
      if (toggle) {
        toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
        toggle.classList.toggle('is-on', on);
        var txt = qs('.scope__toggle-text', toggle);
        if (txt) txt.textContent = on ? 'Filtreyi Kapat' : 'Filtreyi Aç';
      }
      if (stateEl) {
        stateEl.textContent = on ? 'FİLTRE AKTİF' : 'FİLTRE KAPALI';
        stateEl.classList.toggle('is-on', on);
      }
      setReadouts();
      if (prefersReducedMotion) { mix = on ? 1 : 0; draw(); }
    }
    function loop() {
      if (!prefersReducedMotion) phase -= 0.03;
      var target = filterOn ? 1 : 0;
      mix += (target - mix) * 0.08;
      draw();
      rafId = requestAnimationFrame(loop);
    }
    function start() { if (running) return; if (w === 0) resize(); if (inView && w > 0 && !document.hidden) { running = true; loop(); } }
    function stop() { running = false; if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
    function kickScope() { resize(); if (prefersReducedMotion) draw(); else start(); }

    if (toggle) toggle.addEventListener('click', function () { setFilter(!filterOn); });
    window.addEventListener('resize', function () { if (!inView) { w = 0; return; } resize(); draw(); }, { passive: true });

    setReadouts();
    if (hasIO) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { inView = e.isIntersecting; if (inView) kickScope(); else stop(); });
      }, { threshold: 0.15 }).observe(canvas);
    } else {
      kickScope();
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else if (inView && !prefersReducedMotion) start();
    });
    onMotionChange(function () { if (prefersReducedMotion) { stop(); if (inView) { resize(); draw(); } } else if (inView) start(); });
  })();

  /* ------------------------------------------------
     17. COOKIE CONSENT — gates the Apollo tracker behind opt-in
  ------------------------------------------------- */
  (function () {
    var CONSENT_KEY = 'vg_cookie_consent';
    var banner = qs('#cookieConsent');

    function loadApollo() {
      if (typeof window.vgInitApollo === 'function') {
        window.vgInitApollo();
      }
    }
    function readConsent() {
      try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; }
    }
    function writeConsent(value) {
      try { localStorage.setItem(CONSENT_KEY, value); } catch (e) { /* no-op */ }
    }

    var current = readConsent();

    if (current === 'granted') {
      /* Returning visitor who already opted in */
      loadApollo();
    } else if (current !== 'denied' && banner) {
      /* No choice recorded yet — present the banner */
      banner.hidden = false;
      requestAnimationFrame(function () { banner.classList.add('visible'); });
    }

    if (banner) {
      var hideBanner = function () {
        banner.classList.remove('visible');
        setTimeout(function () { banner.hidden = true; }, 400);
      };
      var acceptBtn = qs('#cookieAccept', banner);
      var rejectBtn = qs('#cookieReject', banner);

      if (acceptBtn) {
        acceptBtn.addEventListener('click', function () {
          writeConsent('granted');
          hideBanner();
          loadApollo();
        });
      }
      if (rejectBtn) {
        rejectBtn.addEventListener('click', function () {
          writeConsent('denied');
          hideBanner();
        });
      }
    }
  })();

  /* 18. SERVICE WORKER — kayıt artık js/vg-shell.js içinde (tüm sayfalarda) yapılır. */

  /* ------------------------------------------------
     19. LAZY VIDEO + POSTER
     - <video data-poster>: poster görünüme ~600px kala atanır (poster eager iner; uzaktaki videolar için).
     - Video görünüme ~200px kala yüklenir; ≤600px ekranda <source data-src-sm> varsa küçük sürüm.
     - "Hareketi azalt" ya da "veri tasarrufu" açıksa video hiç yüklenmez, poster kalır
       (büyük ekranda varsa data-poster-lg ile daha keskin poster).
  ------------------------------------------------- */
  (function () {
    var lazyVideos = qsAll('video[data-lazy-video]');
    if (!lazyVideos.length) return;
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    var saveData = !!(conn && conn.saveData);
    var smallMQ = window.matchMedia('(max-width: 600px)');

    function setPoster(video) {
      var p = video.getAttribute('data-poster');
      if (p) { video.poster = p; video.removeAttribute('data-poster'); }
    }

    function loadVideo(video) {
      if (video.dataset.loaded === '1') return;
      setPoster(video);
      if (prefersReducedMotion || saveData) {
        video.removeAttribute('autoplay');
        var lg = video.getAttribute('data-poster-lg');
        if (lg && !smallMQ.matches) video.poster = lg;
        return;
      }
      video.dataset.loaded = '1';
      var small = smallMQ.matches;
      video.querySelectorAll('source[data-src]').forEach(function (s) {
        s.src = (small && s.getAttribute('data-src-sm')) || s.getAttribute('data-src');
        s.removeAttribute('data-src');
      });
      if (video.getAttribute('data-src')) {
        video.src = video.getAttribute('data-src');
        video.removeAttribute('data-src');
      }
      video.preload = 'auto';
      try { video.load(); } catch (e) { /* no-op */ }
      var playAttempt = video.play();
      if (playAttempt && typeof playAttempt.catch === 'function') {
        playAttempt.catch(function () { /* kullanıcı jesti gerekiyorsa sessizce geç */ });
      }
    }

    function playSafe(video) {
      if (prefersReducedMotion || saveData || document.hidden) return;
      var p = video.play();
      if (p && typeof p.catch === 'function') p.catch(function () { /* no-op */ });
    }

    /* Yüklenen videolar gözlenmeye devam eder: ekrandan (~200px) çıkınca duraklar, geri gelince sürer. */
    if (hasIO) {
      var posterObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { setPoster(entry.target); posterObserver.unobserve(entry.target); }
        });
      }, { rootMargin: '600px 0px' });
      var videoObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var v = entry.target;
          v.vgVisible = entry.isIntersecting;
          if (entry.isIntersecting) {
            if (v.dataset.loaded === '1') { if (v.paused) playSafe(v); } else { loadVideo(v); }
          } else if (v.dataset.loaded === '1' && !v.paused) {
            v.pause();
          }
        });
      }, { rootMargin: '200px 0px' });
      lazyVideos.forEach(function (v) { posterObserver.observe(v); videoObserver.observe(v); });
    } else {
      lazyVideos.forEach(function (v) { v.vgVisible = true; loadVideo(v); });
    }

    function syncPlayback() {
      lazyVideos.forEach(function (v) {
        if (v.dataset.loaded !== '1') return;
        if (document.hidden || prefersReducedMotion || !v.vgVisible) { v.pause(); } else { playSafe(v); }
      });
    }
    document.addEventListener('visibilitychange', syncPlayback);
    onMotionChange(syncPlayback);
  })();

  /* ------------------------------------------------
     19b. PROJELER — telefonda yatay kaydırılan bölge: klavye odağı + anlaşılır ad (≤768px, css/style.css)
  ------------------------------------------------- */
  (function () {
    var grid = qs('.projects__grid');
    if (!grid) return;
    var label = grid.getAttribute('aria-label') || 'Gerçekleştirdiğimiz çalışmalar';
    var scrollerMQ = window.matchMedia('(max-width: 768px)');
    function sync() {
      if (scrollerMQ.matches) {
        grid.setAttribute('tabindex', '0');
        grid.setAttribute('aria-label', label + ' (yatay kaydırılabilir)');
      } else {
        grid.removeAttribute('tabindex');
        grid.setAttribute('aria-label', label);
      }
    }
    sync();
    if (scrollerMQ.addEventListener) scrollerMQ.addEventListener('change', sync);
  })();

  /* ------------------------------------------------
     20. LAZY MAP — Google Haritalar iframe'i yalnızca iletişim bölümüne yaklaşınca yüklenir
     (yavaş bağlantıda tarayıcının loading=lazy eşiği ~2500px; bu, ağır harita betiklerini erken indiriyordu).
  ------------------------------------------------- */
  (function () {
    var frame = qs('.contact__map iframe[data-src]');
    if (!frame) return;
    function loadMap() {
      if (!frame.getAttribute('data-src')) return;
      frame.src = frame.getAttribute('data-src');
      frame.removeAttribute('data-src');
    }
    if (hasIO) {
      var mapObserver = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) { loadMap(); mapObserver.disconnect(); }
      }, { rootMargin: '400px 0px' });
      mapObserver.observe(frame);
    } else {
      loadMap();
    }
  })();

})();

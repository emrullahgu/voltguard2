/**
 * VoltGuard – main.js
 * Endüstriyel Mühendislik Çözümleri
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

  /* ------------------------------------------------
     Motion / viewport preferences (live)
  ------------------------------------------------- */
  var reduceMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var desktopMQ = window.matchMedia('(min-width: 769px)');
  var prefersReducedMotion = reduceMotionMQ.matches;

  if (reduceMotionMQ.addEventListener) {
    reduceMotionMQ.addEventListener('change', function (e) {
      prefersReducedMotion = e.matches;
    });
  }

  /* ------------------------------------------------
     0. PRELOADER
  ------------------------------------------------- */
  var preloader = qs('#preloader');

  window.addEventListener('load', function () {
    if (preloader) {
      setTimeout(function () {
        preloader.classList.add('hidden');
      }, 1300);
    }

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
     1. HEADER — scroll effect
  ------------------------------------------------- */
  var header = qs('#header');

  function updateHeader() {
    if (!header) return;
    if (window.scrollY > 60) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }

  /* ------------------------------------------------
     1b. SCROLL PROGRESS BAR
  ------------------------------------------------- */
  var scrollProgress = qs('#scrollProgress');

  function updateScrollProgress() {
    if (!scrollProgress) return;
    var scrollTop = window.scrollY;
    var docHeight = document.documentElement.scrollHeight - window.innerHeight;
    var progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    scrollProgress.style.width = progress + '%';
  }

  /* ------------------------------------------------
     1c. HERO PARALLAX
  ------------------------------------------------- */
  var heroBgImg = qs('.hero__bg-img');
  var heroDecoration = qs('.hero__decoration');
  var heroSpotlight = qs('#heroSpotlight');
  var heroSection = qs('#anasayfa');

  function updateParallax() {
    if (prefersReducedMotion) return;
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
        updateHeader();
        updateScrollProgress();
        updateParallax();
        updateActiveNav();
        updateFloatingButtons();
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  }, { passive: true });

  if (heroSpotlight && heroSection) {
    heroSection.addEventListener('mousemove', function (e) {
      if (!desktopMQ.matches || prefersReducedMotion) return;
      var rect = heroSection.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      heroSpotlight.style.left = x + 'px';
      heroSpotlight.style.top = y + 'px';
      heroSpotlight.style.opacity = '0.95';
    });

    heroSection.addEventListener('mouseleave', function () {
      heroSpotlight.style.opacity = '0.7';
      heroSpotlight.style.left = '72%';
      heroSpotlight.style.top = '38%';
    });
  }

  updateHeader();
  updateScrollProgress();

  /* ------------------------------------------------
     2. MOBILE NAV TOGGLE
  ------------------------------------------------- */
  var navToggle = qs('#navToggle');
  var navMenu   = qs('#navMenu');

  function closeMenu() {
    navToggle.classList.remove('open');
    navMenu.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  }

  function openMenu() {
    navToggle.classList.add('open');
    navMenu.classList.add('open');
    navToggle.setAttribute('aria-expanded', 'true');
  }

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', function () {
      if (navMenu.classList.contains('open')) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    /* Close menu when a nav link is clicked */
    qsAll('.nav__link').forEach(function (link) {
      link.addEventListener('click', closeMenu);
    });

    /* Close menu on outside click */
    document.addEventListener('click', function (e) {
      if (
        navMenu.classList.contains('open') &&
        !navMenu.contains(e.target) &&
        !navToggle.contains(e.target)
      ) {
        closeMenu();
      }
    });

    /* Close menu on Escape key */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navMenu.classList.contains('open')) {
        closeMenu();
        navToggle.focus();
      }
    });
  }

  /* ------------------------------------------------
     3. ACTIVE NAV LINK — highlight on scroll
  ------------------------------------------------- */
  var sections  = qsAll('section[id]');
  var navLinks  = qsAll('.nav__link');

  function updateActiveNav() {
    var scrollY = window.scrollY + 100;

    sections.forEach(function (section) {
      var top    = section.offsetTop;
      var height = section.offsetHeight;
      var id     = section.getAttribute('id');

      if (scrollY >= top && scrollY < top + height) {
        navLinks.forEach(function (link) {
          link.classList.remove('active');
          if (link.getAttribute('href') === '#' + id) {
            link.classList.add('active');
          }
        });
      }
    });
  }

  /* Note: updateActiveNav is called within the unified rAF scroll handler above */
  updateActiveNav();

  /* ------------------------------------------------
     4. REVEAL ON SCROLL — Intersection Observer
  ------------------------------------------------- */
  var revealEls = qsAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');

  if ('IntersectionObserver' in window) {
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
     5. SCROLL-TO-TOP BUTTON + WHATSAPP + MOBILE CTA
  ------------------------------------------------- */
  var scrollTopBtn = qs('#scrollTop');
  var whatsappFloat = qs('#whatsappFloat');
  var mobileCta = qs('#mobileCta');

  function updateFloatingButtons() {
    var y = window.scrollY;
    if (scrollTopBtn) {
      if (y > 420) {
        scrollTopBtn.classList.add('visible');
      } else {
        scrollTopBtn.classList.remove('visible');
      }
    }
    if (whatsappFloat) {
      if (y > 200) {
        whatsappFloat.classList.add('visible');
      } else {
        whatsappFloat.classList.remove('visible');
      }
    }
    if (mobileCta) {
      if (y > 300) {
        mobileCta.classList.add('visible');
      } else {
        mobileCta.classList.remove('visible');
      }
    }
  }

  if (scrollTopBtn) {
    scrollTopBtn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* Note: updateFloatingButtons is called within the unified rAF scroll handler above */
  updateFloatingButtons();

  /* ------------------------------------------------
     6. FOOTER — current year
  ------------------------------------------------- */
  var yearEl = qs('#year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  /* ------------------------------------------------
     7. SMOOTH SCROLL — anchor links
  ------------------------------------------------- */
  qsAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      var href = this.getAttribute('href');
      if (!href || href === '#') return;

      var target = qs(href);
      if (target) {
        e.preventDefault();
        var offset = target.getBoundingClientRect().top + window.scrollY
                     - parseInt(getComputedStyle(document.documentElement)
                         .getPropertyValue('--header-h') || '72');
        window.scrollTo({ top: offset, behavior: 'smooth' });
      }
    });
  });

  /* ------------------------------------------------
     8. CONTACT FORM — client-side validation & submit
  ------------------------------------------------- */
  var contactForm = qs('#contactForm');
  var submitCooldownMs = 60000;

  function clearInvalidState(form) {
    qsAll('.is-invalid', form).forEach(function (el) {
      el.classList.remove('is-invalid');
    });
  }

  function markInvalid(el) {
    if (!el) return;
    el.classList.add('is-invalid');
  }

  function isValidTrMobile(phone) {
    var digits = phone.replace(/\D/g, '');
    if (digits.length === 10 && digits.charAt(0) === '5') return true;
    if (digits.length === 11 && digits.charAt(0) === '0' && digits.charAt(1) === '5') return true;
    if (digits.length === 12 && digits.slice(0, 2) === '90' && digits.charAt(2) === '5') return true;
    return false;
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
  }

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

    function getCaptchaToken() {
      var tokenField = contactForm.querySelector('input[name="' + captchaFieldName + '"]');
      return tokenField ? tokenField.value.trim() : '';
    }

    function resetCaptcha() {
      if (window.turnstile && typeof window.turnstile.reset === 'function') {
        try {
          window.turnstile.reset();
        } catch (err) {
          /* no-op */
        }
      }
    }

    function syncCounter() {
      if (!messageField || !counterEl) return;
      var max = parseInt(messageField.getAttribute('maxlength') || '1000', 10);
      var len = messageField.value.length;
      counterEl.textContent = len + ' / ' + max;
      counterEl.classList.toggle('limit', len > max - 80);
    }

    if (timestampField) {
      timestampField.value = String(Date.now());
    }

    if (messageField) {
      messageField.addEventListener('input', syncCounter);
      syncCounter();
    }

    /* Auto-format phone input for Turkish numbers */
    var phoneInput = qs('#phone', contactForm);
    if (phoneInput) {
      phoneInput.addEventListener('input', function () {
        var digits = this.value.replace(/\D/g, '');
        if (digits.length > 11) digits = digits.slice(0, 11);
        var formatted = '';
        if (digits.length > 0) formatted = digits.slice(0, 4);
        if (digits.length > 4) formatted += ' ' + digits.slice(4, 7);
        if (digits.length > 7) formatted += ' ' + digits.slice(7, 9);
        if (digits.length > 9) formatted += ' ' + digits.slice(9, 11);
        this.value = formatted;
      });
    }

    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();

      clearInvalidState(contactForm);

      var nameField = qs('#name', contactForm);
      var phoneField = qs('#phone', contactForm);
      var emailField = qs('#email', contactForm);
      var subjectField = qs('#subject', contactForm);
      var messageInput = qs('#message', contactForm);
      var consentField = qs('#consent', contactForm);
      var consentWrap = qs('.form__consent', contactForm);
      var websiteTrap = qs('#website', contactForm);

      var name = nameField.value.trim();
      var phone = phoneField.value.trim();
      var email = emailField.value.trim();
      var subject = subjectField.value;
      var message = messageInput.value.trim();

      /* Honeypot: real users won't fill this hidden field */
      if (websiteTrap && websiteTrap.value.trim()) {
        showNotification('Mesajınız alındı, teşekkür ederiz.', 'success');
        contactForm.reset();
        if (timestampField) timestampField.value = String(Date.now());
        syncCounter();
        return;
      }

      /* Simple rate-limit for automated spam retries */
      var now = Date.now();
      var lastSubmit = parseInt(localStorage.getItem('vg_last_submit_at') || '0', 10);
      if (lastSubmit && now - lastSubmit < submitCooldownMs) {
        var seconds = Math.ceil((submitCooldownMs - (now - lastSubmit)) / 1000);
        showNotification('Yeni gönderim için ' + seconds + ' saniye bekleyin.', 'error');
        return;
      }

      /* Bots often submit too quickly after page load */
      if (timestampField) {
        var startedAt = parseInt(timestampField.value || '0', 10);
        if (!startedAt || now - startedAt < 2500) {
          showNotification('Lütfen formu dikkatlice doldurup tekrar deneyin.', 'error');
          return;
        }
      }

      var hasError = false;

      if (!name) {
        markInvalid(nameField);
        hasError = true;
      }

      if (!isValidTrMobile(phone)) {
        markInvalid(phoneField);
        hasError = true;
      }

      if (!subject) {
        markInvalid(subjectField);
        hasError = true;
      }

      if (!message || message.length < 20) {
        markInvalid(messageInput);
        hasError = true;
      }

      if (email && !isValidEmail(email)) {
        markInvalid(emailField);
        hasError = true;
      }

      if (!consentField.checked) {
        markInvalid(consentWrap);
        hasError = true;
      }

      if (captchaEnabled && !getCaptchaToken()) {
        markInvalid(qs('.form__captcha', contactForm));
        hasError = true;
      }

      if (hasError) {
        showNotification('Lütfen işaretli alanları ve güvenlik doğrulamasını tamamlayın.', 'error');
        return;
      }

      /* Real submission to backend endpoint */
      var submitBtn = contactForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Gönderiliyor...';

      var payload = new FormData(contactForm);

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
            throw new Error(result.data && result.data.message ? result.data.message : 'Gönderim başarısız oldu.');
          }

          showNotification(
            'Mesajınız alındı! En kısa sürede sizinle iletişime geçeceğiz.',
            'success'
          );
          localStorage.setItem('vg_last_submit_at', String(Date.now()));
          contactForm.reset();
          resetCaptcha();
          if (timestampField) timestampField.value = String(Date.now());
          syncCounter();
        })
        .catch(function (error) {
          resetCaptcha();
          var msg = (error && error.name === 'TypeError')
            ? 'Bağlantı hatası. İnternet bağlantınızı kontrol edip tekrar deneyin.'
            : ((error && error.message) || 'Gönderim sırasında bir hata oluştu.');
          showNotification(msg, 'error');
        })
        .finally(function () {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Mesaj Gönder';
        });
    });
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

    var icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    var bg   = type === 'success' ? '#10b981' : '#ef4444';

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
      fontFamily:   "'Outfit', sans-serif",
      zIndex:       '9999',
      boxShadow:    '0 10px 30px rgba(0,0,0,.22)',
      display:      'flex',
      alignItems:   'center',
      gap:          '.5rem',
      opacity:      '0',
      transition:   'all .3s ease',
      maxWidth:     'calc(100vw - 2rem)',
      whiteSpace:   'nowrap',
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
     10. HERO TYPING EFFECT
  ------------------------------------------------- */
  var typingEl = qs('#heroTyping');
  var typingWords = ['VoltGuard', 'Güvenilir Çözüm', 'Akıllı Enerji'];
  var wordIndex = 0;
  var charIndex = 0;
  var isDeleting = false;
  var typingSpeed = 110;

  function typeLoop() {
    if (!typingEl) return;
    var currentWord = typingWords[wordIndex];

    if (isDeleting) {
      typingEl.textContent = currentWord.substring(0, charIndex - 1);
      charIndex--;
    } else {
      typingEl.textContent = currentWord.substring(0, charIndex + 1);
      charIndex++;
    }

    var delay = typingSpeed;

    if (!isDeleting && charIndex === currentWord.length) {
      delay = 2000;
      isDeleting = true;
    } else if (isDeleting && charIndex === 0) {
      isDeleting = false;
      wordIndex = (wordIndex + 1) % typingWords.length;
      delay = 400;
    } else if (isDeleting) {
      delay = 55;
    }

    setTimeout(typeLoop, delay);
  }

  /* Start typing after preloader (skip the animation when reduced motion is requested) */
  if (prefersReducedMotion) {
    if (typingEl) { typingEl.textContent = typingWords[0]; }
  } else {
    setTimeout(typeLoop, 1500);
  }

  /* ------------------------------------------------
     11. ANIMATED STAT COUNTERS
  ------------------------------------------------- */
  var statNumbers = qsAll('[data-count]');
  var statsAnimated = false;

  function animateCounters() {
    if (statsAnimated) return;
    statsAnimated = true;

    statNumbers.forEach(function (el) {
      var target = parseInt(el.getAttribute('data-count'), 10);
      var suffix = el.getAttribute('data-suffix') || '';

      if (prefersReducedMotion) {
        el.textContent = target + suffix;
        return;
      }

      var duration = 2000;
      var startTime = null;

      function step(timestamp) {
        if (!startTime) startTime = timestamp;
        var progress = Math.min((timestamp - startTime) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        var current = Math.floor(eased * target);
        el.textContent = current + suffix;

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          el.textContent = target + suffix;
        }
      }

      requestAnimationFrame(step);
    });
  }

  /* Observe hero__stats to trigger counter animation */
  var statsSection = qs('.hero__stats');
  if (statsSection && 'IntersectionObserver' in window) {
    var statsObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCounters();
          statsObserver.unobserve(entry.target);
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
    card.addEventListener('mousemove', function (e) {
      if (!desktopMQ.matches || prefersReducedMotion) return;
      var rect = card.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      var centerX = rect.width / 2;
      var centerY = rect.height / 2;
      var rotateX = ((y - centerY) / centerY) * -6;
      var rotateY = ((x - centerX) / centerX) * 6;
      card.style.transform = 'rotateX(' + rotateX + 'deg) rotateY(' + rotateY + 'deg) scale(1.02)';
    });

    card.addEventListener('mouseleave', function () {
      card.style.transform = '';
    });
  });

  /* ------------------------------------------------
     13. SMOOTH SCROLL FOR MOBILE CTA
  ------------------------------------------------- */
  var mobileCtaLinks = qsAll('.mobile-cta__btn[href^="#"]');
  mobileCtaLinks.forEach(function (link) {
    link.addEventListener('click', function (e) {
      var href = this.getAttribute('href');
      var target = qs(href);
      if (target) {
        e.preventDefault();
        var offset = target.getBoundingClientRect().top + window.scrollY
                     - parseInt(getComputedStyle(document.documentElement)
                         .getPropertyValue('--header-h') || '72');
        window.scrollTo({ top: offset, behavior: 'smooth' });
      }
    });
  });

  /* ------------------------------------------------
     15. HERO ENERGY CIRCUIT — interactive canvas
  ------------------------------------------------- */
  (function () {
    var canvas = qs('#heroCircuit');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var ACCENT = '245,158,11';
    var ELECTRIC = '59,130,246';
    var LINK_DIST = 132;
    var nodes = [], pulses = [];
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0, h = 0;
    var mouse = { x: -9999, y: -9999 };
    var running = false, rafId = null, inView = true;

    function build() {
      var count = Math.max(16, Math.min(58, Math.round((w * h) / 22000)));
      nodes = [];
      for (var i = 0; i < count; i++) {
        nodes.push({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25,
          r: Math.random() * 1.5 + 1
        });
      }
    }
    function resize() {
      var rect = canvas.getBoundingClientRect();
      var nw = rect.width, nh = rect.height;
      if (nw === 0 || nh === 0) return;
      var changed = Math.round(nw) !== Math.round(w) || Math.round(nh) !== Math.round(h);
      w = nw; h = nh;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (changed || nodes.length === 0) build();
    }
    function spawnPulse() {
      if (nodes.length < 2) return;
      var ai = (Math.random() * nodes.length) | 0, best = -1, bestD = LINK_DIST;
      for (var j = 0; j < nodes.length; j++) {
        if (j === ai) continue;
        var dx = nodes[ai].x - nodes[j].x, dy = nodes[ai].y - nodes[j].y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestD) { bestD = d; best = j; }
      }
      if (best >= 0) pulses.push({ a: ai, b: best, t: 0, speed: 0.012 + Math.random() * 0.02 });
    }
    function frame() {
      ctx.clearRect(0, 0, w, h);
      var i, n;
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
        var dxm = mouse.x - n.x, dym = mouse.y - n.y, dm2 = dxm * dxm + dym * dym;
        if (dm2 < 19600) { n.vx += dxm * 0.0009; n.vy += dym * 0.0009; }
        n.vx = Math.max(-0.7, Math.min(0.7, n.vx));
        n.vy = Math.max(-0.7, Math.min(0.7, n.vy));
      }
      var a, b;
      for (a = 0; a < nodes.length; a++) {
        for (b = a + 1; b < nodes.length; b++) {
          var ddx = nodes[a].x - nodes[b].x, ddy = nodes[a].y - nodes[b].y;
          var dist = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dist < LINK_DIST) {
            var o = (1 - dist / LINK_DIST) * 0.5;
            ctx.strokeStyle = 'rgba(' + ELECTRIC + ',' + o.toFixed(3) + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(nodes[a].x, nodes[a].y);
            ctx.lineTo(nodes[b].x, nodes[b].y);
            ctx.stroke();
          }
        }
      }
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        ctx.fillStyle = 'rgba(' + ACCENT + ',0.9)';
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
      for (var p = pulses.length - 1; p >= 0; p--) {
        var pu = pulses[p];
        pu.t += pu.speed;
        var na = nodes[pu.a], nb = nodes[pu.b];
        if (pu.t >= 1 || !na || !nb) { pulses.splice(p, 1); continue; }
        var px = na.x + (nb.x - na.x) * pu.t, py = na.y + (nb.y - na.y) * pu.t;
        var grd = ctx.createRadialGradient(px, py, 0, px, py, 6);
        grd.addColorStop(0, 'rgba(' + ACCENT + ',0.95)');
        grd.addColorStop(1, 'rgba(' + ACCENT + ',0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      if (pulses.length < 6 && Math.random() < 0.045) spawnPulse();
    }
    function loop() { frame(); rafId = requestAnimationFrame(loop); }
    function start() { if (running) return; if (w === 0) resize(); if (inView && w > 0) { running = true; loop(); } }
    function stop() { running = false; if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
    function kick() { resize(); if (prefersReducedMotion) frame(); else start(); }

    window.addEventListener('mousemove', function (e) {
      var r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    }, { passive: true });
    window.addEventListener('resize', kick);

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { inView = e.isIntersecting; if (inView) kick(); else stop(); });
      }).observe(canvas);
    }
    kick();
    window.addEventListener('load', kick);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else if (inView && !prefersReducedMotion) start();
    });
  })();

  /* ------------------------------------------------
     16. AKTİF EMI FİLTRE — oscilloscope demo
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
    var w = 0, h = 0, running = false, rafId = null, inView = true;
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
    function start() { if (running) return; if (w === 0) resize(); if (inView && w > 0) { running = true; loop(); } }
    function stop() { running = false; if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
    function kickScope() { resize(); if (prefersReducedMotion) draw(); else start(); }

    if (toggle) toggle.addEventListener('click', function () { setFilter(!filterOn); });
    window.addEventListener('resize', function () { resize(); draw(); });

    setReadouts();
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { inView = e.isIntersecting; if (inView) kickScope(); else stop(); });
      }, { threshold: 0.15 }).observe(canvas);
    } else {
      kickScope();
    }
    kickScope();
    window.addEventListener('load', function () { resize(); draw(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else if (inView && !prefersReducedMotion) start();
    });
  })();

  /* ------------------------------------------------
     14. COOKIE CONSENT — gates the Apollo tracker behind opt-in
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

})();

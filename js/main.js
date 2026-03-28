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
     0. PRELOADER
  ------------------------------------------------- */
  var preloader = qs('#preloader');

  window.addEventListener('load', function () {
    setTimeout(function () {
      preloader.classList.add('hidden');
    }, 1300);
  });

  /* ------------------------------------------------
     1. HEADER — scroll effect
  ------------------------------------------------- */
  var header = qs('#header');

  function updateHeader() {
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

  window.addEventListener('scroll', function () {
    updateHeader();
    updateScrollProgress();
    updateParallax();
  }, { passive: true });

  if (heroSpotlight && heroSection && window.matchMedia('(min-width: 769px)').matches) {
    heroSection.addEventListener('mousemove', function (e) {
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

  window.addEventListener('scroll', updateActiveNav, { passive: true });
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
    if (y > 420) {
      scrollTopBtn.classList.add('visible');
    } else {
      scrollTopBtn.classList.remove('visible');
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

  scrollTopBtn.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  window.addEventListener('scroll', updateFloatingButtons, { passive: true });
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

      if (!getCaptchaToken()) {
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
          showNotification(error.message || 'Gönderim sırasında bir hata oluştu.', 'error');
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

  /* Start typing after preloader */
  setTimeout(typeLoop, 1500);

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

  if (window.matchMedia('(min-width: 769px)').matches) {
    projectCards.forEach(function (card) {
      card.addEventListener('mousemove', function (e) {
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
  }

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

})();

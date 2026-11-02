/* hesap/magaza-panel.html – VoltGuard Mağaza personel paneli (siparişler, fiyatlar, durum, CSV).
   CSP: satır içi betik/olay yok (script-src 'self'). Yetki sunucudadır (panel.json); istemci yalnızca /api/magaza.php
   panel_* yanıtlarını gösterir. Tüm sunucu verisi textContent/DOM ile yazılır (innerHTML kullanılmaz). Tedarikçi
   bağlantıları, maliyetler ve USD tutarlar yalnızca bu panelde görünür; müşteriye hiçbir yerde gösterilmez.
   Saf yardımcılar (biçim, geçiş düğmeleri, gecikme, CSV aralığı...) Node'da module.exports ile testlere açılır. */
(function (root) {
  'use strict';

  /* ================================================================== sabitler */
  var TZ_OFFSET_MS = 3 * 3600 * 1000;           // Türkiye kalıcı UTC+3 (2016'dan beri; Europe/Istanbul)
  var DAY_MS = 86400000;
  var MIN_EXPORT_DAY = '2024-01-01';
  var MAX_COST_TRY = 10000000;
  var STALE_MS = 48 * 3600 * 1000;              // 48 saat kuralı (api/lib/magaza.php VGM_PRICE_MAX_AGE)
  var REF_RE = /^VGS-[0-9]{6}-[A-HJ-NP-Z2-9]{5}$/;

  var STATUS_LABELS = {
    teyit_bekliyor: 'Teyit bekleniyor', odeme_bekleniyor: 'Ödeme bekleniyor', odeme_alindi: 'Ödeme alındı', tedarikte: 'Tedarik ediliyor',
    kargoda: 'Kargoya verildi', teslim_edildi: 'Teslim edildi', iptal: 'İptal edildi', iade: 'İade edildi'
  };
  var STATUS_ORDER = ['teyit_bekliyor', 'odeme_bekleniyor', 'odeme_alindi', 'tedarikte', 'kargoda', 'teslim_edildi', 'iptal', 'iade'];
  /* Sunucudaki VGM_TRANSITIONS aynası: yalnızca sunucu "allowed" göndermezse yedek olarak kullanılır. */
  /* teyit_bekliyor: genel durum düğmesi yok; talep yalnızca "Onayla ve ödeme bilgisi gönder" (panel_order_confirm) ya da
     "Reddet" (panel_order_reject) ile ilerler. */
  var TRANSITIONS = {
    teyit_bekliyor: [], odeme_bekleniyor: ['odeme_alindi', 'iptal'], odeme_alindi: ['tedarikte', 'iptal'], tedarikte: ['kargoda', 'iptal'],
    kargoda: ['teslim_edildi', 'iade', 'iptal'], teslim_edildi: ['iade'], iptal: [], iade: []
  };
  var ACTIONS = {
    odeme_alindi: { label: 'Ödeme alındı', tone: 'primary' },
    tedarikte: { label: 'Tedarikçiden sipariş verildi', tone: 'primary' },
    kargoda: { label: 'Kargoya verildi', tone: 'primary', tracking: true },
    teslim_edildi: { label: 'Teslim edildi', tone: 'primary' },
    iade: { label: 'İade', tone: 'danger', confirm: true, reason: true },
    iptal: { label: 'İptal', tone: 'danger', confirm: true, reason: true }
  };
  var ACTION_ORDER = ['odeme_alindi', 'tedarikte', 'kargoda', 'teslim_edildi', 'iade', 'iptal'];
  var NOTE_MAX = 1000, PUBLIC_NOTE_MAX = 600;     // sunucu: vgm_order_update (iç not 1000, müşteri notu 600)
  var MAX_UNIT_TRY = 100000000, MAX_SHIP_TRY = 1000000, MAX_LINE_QTY = 999;   // sunucu: vgm_order_confirm / vgm_money_in
  var REJECT_REASONS = [['stok_yok', 'Stok yok'], ['fiyat_degisti', 'Fiyat değişti'], ['diger', 'Diğer (gerekçe yazın)']];
  var PRICE_STATUS = { ok: 'Güncel', held: 'Onay bekliyor', error: 'Hata', unavailable: 'Stokta yok' };
  var PRICE_REASONS = {
    ok: 'Siparişe açık', closed: 'Mağaza kapalı', stale: 'Fiyat 48 saatten eski', held: 'Onay bekliyor',
    error: 'Fiyat doğrulanamadı', unavailable: 'Tedarikte stok yok', no_rate: 'Kur güncel değil',
    no_source: 'Kaynak tanımlı değil', freight: 'Nakliyeli ürün (yalnızca teklif)'
  };
  var FIRMA_LABELS = {
    unvan: 'Ticaret unvanı', adres: 'Adres', il: 'İl', telefon: 'Telefon', eposta: 'E-posta', mersis: 'MERSİS numarası',
    vkn: 'Vergi kimlik numarası', vergiDairesi: 'Vergi dairesi', 'banka.ad': 'Banka adı', 'banka.hesapSahibi': 'Hesap sahibi',
    'banka.iban': 'IBAN (geçerli TR IBAN olmalı)'
  };
  var COUNT_LABELS = {
    total: 'Toplam ürün', ok: 'Güncel fiyatlı ürün', orderable: 'Siparişe açık', held: 'Onay bekleyen', error: 'Hatalı',
    unavailable: 'Stokta yok', stale: 'Fiyat teyidi eski (48 saat)', freight: 'Nakliyeli', no_source: 'Kaynaksız', noSource: 'Kaynağı tanımlı olmayan'
  };
  var SUMMARY_LABELS = {
    checked: 'kontrol edilen', ok: 'güncel', held: 'onay bekleyen', error: 'hatalı', unavailable: 'stokta yok', skipped: 'atlanan',
    left: 'sonraki çalışmaya kalan', due: 'zamanı gelen', rateUpdated: 'kur güncellendi', rateError: 'kur hatası', seconds: 'süre (sn)',
    cpuUserSeconds: 'CPU (kullanıcı)', cpuSystemSeconds: 'CPU (sistem)', peakMemoryBytes: 'tepe bellek'
  };
  // Cron her 10 dakikada bir, varsayılan en çok 540 sn çalışır; zamanı gelen ürünleri sırayla kontrol eder (api/MAGAZA.md "Kurulum").
  var CRON_COMMAND = '*/10 * * * * VG_DATA_DIR=/home/voltgua2/vg-data /usr/local/bin/php /home/voltgua2/public_html/api/lib/magaza-cron.php >/dev/null 2>&1';
  var CRON_OK_MS = 30 * 60 * 1000;               // sunucudaki eşik (VGM_HEALTHY_AFTER, 30 dakika)
  var CRON_LATE_MS = 6 * 3600 * 1000;            // 6 saate kadar gecikmiş, sonrası çalışmıyor

  /* ================================================================== saf yardımcılar */

  function str(v) { return v === null || v === undefined ? '' : String(v); }

  /** Metni kırpar, denetim karakterlerini atar; en çok max karakter. */
  function clean(v, max) {
    var s = str(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    return max && s.length > max ? s.slice(0, max) : s;
  }

  /** Türkçe harfleri sadeleştirerek küçültür (arama eşleştirmesi için). */
  function fold(s) {
    return str(s).toLocaleLowerCase('tr-TR').replace(/\u0307/g, '').replace(/ı/g, 'i').replace(/ş/g, 's')
      .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');
  }

  function groupInt(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  /** 1234.5 -> "1.234,50" (PHP number_format(v, 2, ',', '.') ile aynı). */
  function fmtNum(n, decimals) {
    var v = Number(n);
    if (n === null || n === '' || n === undefined || !isFinite(v)) return '–';
    var d = decimals === undefined ? 2 : decimals;
    var f = Math.pow(10, d);
    var r = Math.round(Math.abs(v) * f + 1e-9) / f;
    var parts = r.toFixed(d).split('.');
    return (v < 0 && r !== 0 ? '-' : '') + groupInt(parts[0]) + (parts[1] ? ',' + parts[1] : '');
  }
  function fmtTry(n) { var s = fmtNum(n, 2); return s === '–' ? s : s + ' ₺'; }
  function fmtUsd(n) { var s = fmtNum(n, 2); return s === '–' ? s : s + ' USD'; }

  /** +%32,5 / -%12 / –: yüzde değişimi. */
  function fmtPct(p) {
    if (p === null || p === undefined || !isFinite(Number(p))) return '–';
    var v = Number(p);
    var a = Math.abs(v);
    var body = '%' + fmtNum(a, a < 10 ? 1 : 0);
    return (v > 0 ? '+' : v < 0 ? '-' : '') + body;
  }
  function pctChange(prev, next) {
    var a = Number(prev), b = Number(next);
    if (prev === null || prev === undefined || next === null || next === undefined || !isFinite(a) || !isFinite(b) || a <= 0) return null;
    return (b - a) / a * 100;
  }

  /** ISO metni, saniye veya milisaniye (sayı ya da sayı metni) -> ms; geçersizse NaN. */
  function toMs(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return NaN;
    if (typeof v === 'number') return isFinite(v) ? (Math.abs(v) < 1e11 ? v * 1000 : v) : NaN;
    if (typeof v === 'string') {
      if (/^-?\d+(\.\d+)?$/.test(v.trim())) return toMs(Number(v));
      return Date.parse(v);
    }
    return NaN;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(v) {
    var ms = toMs(v);
    if (!isFinite(ms)) return '–';
    var d = new Date(ms + TZ_OFFSET_MS);
    return pad2(d.getUTCDate()) + '.' + pad2(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear();
  }
  function fmtDateTime(v) {
    var ms = toMs(v);
    if (!isFinite(ms)) return '–';
    var d = new Date(ms + TZ_OFFSET_MS);
    return pad2(d.getUTCDate()) + '.' + pad2(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear() + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  }
  /** "3 saat önce" / "2 gün önce" / "az önce". */
  function ageText(v, nowMs) {
    var ms = toMs(v);
    if (!isFinite(ms)) return '';
    var diff = (nowMs === undefined ? Date.now() : nowMs) - ms;
    if (diff < 0) return 'az önce';
    var min = Math.floor(diff / 60000);
    if (min < 2) return 'az önce';
    if (min < 120) return min + ' dakika önce';
    var hours = Math.floor(min / 60);
    if (hours < 48) return hours + ' saat önce';
    return Math.floor(hours / 24) + ' gün önce';
  }

  function statusLabel(s) { return STATUS_LABELS[s] || str(s) || '–'; }

  /** "#VGS-261027-ABCDE" ya da "#siparis=VGS-261027-ABCDE" -> sipariş numarası; aksi halde ''. */
  function orderRefFromHash(hash) {
    var s = str(hash).replace(/^#/, '');
    var m = /^(?:siparis=)?(VGS-[0-9]{6}-[A-HJ-NP-Z2-9]{5})$/.exec(s);
    return m ? m[1] : '';
  }

  /** Sunucunun "allowed" listesinden düğme tanımları: yalnızca izinli geçişler, sabit sırada (iptal sonda). */
  function allowedActions(allowed) {
    var list = Array.isArray(allowed) ? allowed : [];
    var out = [];
    ACTION_ORDER.forEach(function (s) {
      if (list.indexOf(s) < 0) return;
      var a = ACTIONS[s];
      out.push({ status: s, label: a.label, tone: a.tone, needsTracking: a.tracking === true, needsReason: a.reason === true, confirm: a.confirm === true });
    });
    return out;
  }
  function allowedFromStatus(status) { return (TRANSITIONS[status] || []).slice(); }

  /** Ödeme süresi geçmiş mi: sunucu bayrağı varsa o, yoksa "ödeme bekleniyor ve payBy geçti". */
  function isOverdue(o, nowMs) {
    if (!o || typeof o !== 'object') return false;
    if (typeof o.overdue === 'boolean') return o.overdue;
    if (o.status !== 'odeme_bekleniyor') return false;
    var due = toMs(o.payBy);
    return isFinite(due) && due < (nowMs === undefined ? Date.now() : nowMs);
  }

  function httpsUrl(v) {
    var s = str(v).trim();
    if (s.length > 600 || !/^https:\/\/[^\s"'<>\\]+$/i.test(s)) return '';
    try {
      var u = new URL(s);
      return u.protocol === 'https:' && u.hostname ? u.href : '';
    } catch (e) { return ''; }
  }
  function mailHref(v) {
    var s = str(v).trim();
    return /^[^\s@<>"'\\]{1,64}@[^\s@<>"'\\]{1,190}$/.test(s) ? 'mailto:' + s : '';
  }
  function telHref(v) {
    var s = str(v).replace(/[^0-9+]/g, '');
    return s.length >= 7 && s.length <= 16 ? 'tel:' + s : '';
  }

  /**
   * Sipariş güncelleme gövdesi (panel_order_update, ref hariç) ve istemci doğrulaması.
   * status boşsa yalnızca not kaydedilir. İptal için gerekçe şart (iç not ya da müşteri notu; boş iç not gerekçeyle doldurulur).
   * Kargoya verildi için firma + takip kodu şart.
   */
  function buildChange(status, form, notify) {
    form = form || {};
    var act = status ? ACTIONS[status] : null;
    var errors = {};
    var note = clean(form.note, NOTE_MAX), pub = clean(form.publicNote, PUBLIC_NOTE_MAX);
    var body = { notify: notify === true };
    if (status) {
      if (!act) errors.status = 'Bilinmeyen durum.';
      else body.status = status;
    }
    if (act && act.reason) {
      var reason = note || pub;
      if (reason.length < 3) errors.reason = (status === 'iade' ? 'İade' : 'İptal') + ' için gerekçe yazın (iç not ya da müşteriye görünür not).';
      else if (!note) note = reason;
    }
    if (act && act.tracking) {
      var company = clean(form.company, 60), code = clean(form.code, 60), url = clean(form.url, 300);
      if (!company) errors.company = 'Kargo firmasını yazın.';
      if (!code) errors.code = 'Takip kodunu yazın.';
      if (url && !httpsUrl(url)) errors.url = 'Takip adresi https:// ile başlamalı.';
      if (!errors.company && !errors.code && !errors.url) {
        body.tracking = { company: company, code: code };
        if (url) body.tracking.url = httpsUrl(url);
      }
    }
    if (!status && !note && !pub) errors.note = 'Kaydedilecek bir not yazın.';
    if (note) body.note = note;
    if (pub) body.publicNote = pub;
    return { ok: Object.keys(errors).length === 0, errors: errors, body: body };
  }

  /** Kuruş hassasiyetinde yuvarlama (sunucu vgm_round2 ile aynı). */
  function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

  /**
   * Teyit gövdesi (panel_order_confirm, ref hariç) ve istemci doğrulaması. rows: [{id, qty, max (talepteki adet; teyitte
   * adet yalnızca azaltılabilir), unit (TL, KDV dahil; metin ya da sayı), remove}], shipping: kargo (TL, KDV dahil; boş = 0).
   * Çıkarılan satır gönderilmez; en az bir satır kalmalı. Hatalar ürün kimliğiyle anahtarlanır (sunucu "lines.<id>.qty" ile
   * aynı; çıkarılan satırlar sırayı kaydırmaz). Dönüş: {ok, errors: {"<id>.qty"|"<id>.unit"|shipping|lines}, body, total}.
   */
  function buildConfirm(rows, shipping, form) {
    form = form || {};
    var errors = {}, lines = [], total = 0;
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || r.remove === true) return;
      var id = str(r.id);
      var max = typeof r.max === 'number' && r.max >= 1 ? Math.min(Math.floor(r.max), MAX_LINE_QTY) : MAX_LINE_QTY;
      /* Adet bağlayıcı tutara girer: "2.5" ya da "3 adet" sessizce kırpılmaz, hata verilir. */
      var qtyText = typeof r.qty === 'number' ? String(r.qty) : str(r.qty).trim();
      var qty = /^\d{1,4}$/.test(qtyText) ? parseInt(qtyText, 10) : NaN;
      var unit = typeof r.unit === 'number' ? r.unit : parseTry(r.unit);
      if (!(qty >= 1 && qty <= max)) errors[id + '.qty'] = max < MAX_LINE_QTY ? 'Adet 1–' + max + ' arası tam sayı olmalı (talepteki adetten fazla olamaz).' : 'Adet 1–' + max + ' arası tam sayı olmalı.';
      if (!(typeof unit === 'number' && isFinite(unit) && unit > 0 && unit <= MAX_UNIT_TRY)) errors[id + '.unit'] = 'KDV dahil birim fiyatı TL olarak girin.';
      else unit = round2(unit);
      if (!errors[id + '.qty'] && !errors[id + '.unit']) { lines.push({ id: id, qty: qty, unitTryGross: unit }); total += round2(unit * qty); }
    });
    if (!lines.length && !Object.keys(errors).length) errors.lines = 'En az bir ürün kalmalı; hiçbiri teyit edilemiyorsa talebi reddedin.';
    var ship = str(shipping).trim() === '' ? 0 : (typeof shipping === 'number' ? shipping : parseTry(shipping));
    if (!(typeof ship === 'number' && isFinite(ship) && ship >= 0 && ship <= MAX_SHIP_TRY)) errors.shipping = 'Kargo ücretini TL olarak girin (ücretsizse 0).';
    else ship = round2(ship);
    var body = { lines: lines, shippingTry: typeof ship === 'number' && isFinite(ship) ? ship : 0 };
    var note = clean(form.note, NOTE_MAX), pub = clean(form.publicNote, PUBLIC_NOTE_MAX);
    if (note) body.note = note;
    if (pub) body.publicNote = pub;
    return { ok: Object.keys(errors).length === 0, errors: errors, body: body, total: round2(total + body.shippingTry) };
  }

  /**
   * Sunucunun teyit doğrulama hataları (422 fields: "lines.<id>.qty", "lines.<id>.unitTryGross", shippingTry) buildConfirm
   * anahtarlarına ("<id>.qty", "<id>.unit", shipping) çevrilir; satır, ürün kimliğiyle bulunur.
   */
  function confirmServerErrors(fields) {
    var out = {};
    if (!fields || typeof fields !== 'object') return out;
    Object.keys(fields).forEach(function (k) {
      var m = /^lines\.(.+)\.(qty|unitTryGross)$/.exec(k);
      if (m) out[m[1] + (m[2] === 'qty' ? '.qty' : '.unit')] = str(fields[k]);
      else if (k === 'shippingTry') out.shipping = str(fields[k]);
    });
    return out;
  }

  /** Ret gövdesi (panel_order_reject, ref hariç): neden zorunlu; "diger"de müşteriye gerekçe (en az 3 karakter) zorunlu. */
  function buildReject(reason, form) {
    form = form || {};
    var errors = {};
    var known = REJECT_REASONS.some(function (r) { return r[0] === reason; });
    var pub = clean(form.publicNote, PUBLIC_NOTE_MAX), note = clean(form.note, NOTE_MAX);
    if (!known) errors.reason = 'Ret nedenini seçin.';
    if (reason === 'diger' && pub.length < 3) errors.publicNote = 'Müşteriye iletilecek gerekçeyi yazın.';
    var body = { reason: known ? reason : '' };
    if (pub) body.publicNote = pub;
    if (note) body.note = note;
    return { ok: Object.keys(errors).length === 0, errors: errors, body: body };
  }

  /** Teyit bekleyen talebin yanıt süresi geçti mi (sunucu bayrağı respondLate, yoksa respondBy). */
  function isRespondLate(o, nowMs) {
    if (!o || typeof o !== 'object' || o.status !== 'teyit_bekliyor') return false;
    if (typeof o.respondLate === 'boolean') return o.respondLate;
    var due = toMs(o.respondBy);
    return isFinite(due) && due < (nowMs === undefined ? Date.now() : nowMs);
  }

  /** 401/403/409/429 ve diğer hatalar için net Türkçe açıklama. */
  function explainError(e) {
    e = e || {};
    var msg = typeof e.message === 'string' ? e.message : '';
    var s = Number(e.status) || 0;
    if (s === 401) return { kind: 'auth', login: true, refresh: false, text: 'Oturumunuz sona ermiş ya da giriş yapılmamış. Devam etmek için yeniden giriş yapın.' };
    if (s === 403) return { kind: 'forbidden', login: false, refresh: false, text: 'Bu işlem için yetkiniz yok ya da güvenlik anahtarınızın süresi doldu. Sayfayı yenileyip tekrar deneyin; sorun sürerse site yönetiminden yetki isteyin.' };
    if (s === 409) return { kind: 'conflict', login: false, refresh: true, text: (msg || 'İşlem kaydın mevcut durumuyla çakışıyor.') + ' Kayıt başka biri tarafından değiştirilmiş olabilir; güncel hali yeniden yüklendi.' };
    if (s === 429) {
      var wait = Number(e.retryAfter) > 0 ? ' Yaklaşık ' + (e.retryAfter >= 90 ? Math.ceil(e.retryAfter / 60) + ' dakika' : Math.ceil(e.retryAfter) + ' saniye') + ' sonra' : ' Biraz sonra';
      return { kind: 'rate', login: false, refresh: false, text: 'Çok fazla istek gönderildi.' + wait + ' tekrar deneyin.' };
    }
    if (s >= 500) return { kind: 'server', login: false, refresh: false, text: msg || 'Sunucu şu anda yanıt veremiyor. Biraz sonra tekrar deneyin.' };
    if (!s) return { kind: 'network', login: false, refresh: false, text: 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.' };
    return { kind: 'error', login: false, refresh: false, text: msg || 'İşlem tamamlanamadı.' };
  }

  /* ---------------------------------------------------------- CSV tarih aralığı */
  function parseDay(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(s).trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var t = Date.UTC(y, mo - 1, d);
    var dt = new Date(t);
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? t : null;
  }
  function todayIso(nowMs) {
    return new Date((nowMs === undefined ? Date.now() : nowMs) + TZ_OFFSET_MS).toISOString().slice(0, 10);
  }
  /** Boş alan serbest (sınırsız). Dolu alan geçerli takvim günü olmalı; başlangıç <= bitiş; bitiş bugünden sonra olamaz. */
  function validateExportRange(from, to, today) {
    var f = str(from).trim(), t = str(to).trim();
    var errors = {};
    var fd = f ? parseDay(f) : null, td = t ? parseDay(t) : null;
    var min = parseDay(MIN_EXPORT_DAY), now = parseDay(today || todayIso());
    if (f && fd === null) errors.from = 'Başlangıç tarihi geçerli değil (YYYY-AA-GG).';
    else if (fd !== null && fd < min) errors.from = 'Başlangıç tarihi ' + MIN_EXPORT_DAY + ' tarihinden önce olamaz.';
    if (t && td === null) errors.to = 'Bitiş tarihi geçerli değil (YYYY-AA-GG).';
    else if (td !== null && now !== null && td > now) errors.to = 'Bitiş tarihi bugünden sonra olamaz.';
    if (!errors.from && !errors.to && fd !== null && td !== null && fd > td) errors.range = 'Başlangıç tarihi bitiş tarihinden sonra olamaz.';
    return { ok: Object.keys(errors).length === 0, errors: errors, from: f, to: t };
  }
  /** Hızlı aralıklar: thisMonth, lastMonth, thisYear -> {from, to} (YYYY-AA-GG). */
  function quickRange(kind, today) {
    var t = parseDay(today || todayIso());
    if (t === null) return { from: '', to: '' };
    var d = new Date(t);
    var y = d.getUTCFullYear(), m = d.getUTCMonth();
    var iso = function (ms) { return new Date(ms).toISOString().slice(0, 10); };
    if (kind === 'thisMonth') return { from: iso(Date.UTC(y, m, 1)), to: iso(t) };
    if (kind === 'lastMonth') return { from: iso(Date.UTC(y, m - 1, 1)), to: iso(Date.UTC(y, m, 0)) };
    if (kind === 'thisYear') return { from: iso(Date.UTC(y, 0, 1)), to: iso(t) };
    return { from: '', to: '' };
  }

  /* ---------------------------------------------------------- fiyatlar */
  /** "1.234,50", "1234,5", "1234.50", "1.234" (binlik) -> sayı; geçersizse NaN. En çok 2 ondalık. */
  function parseTry(input) {
    var s = str(input).replace(/[\s\u00a0₺]|TL|TRY/gi, '');
    if (s === '' || /[^0-9.,]/.test(s)) return NaN;
    var lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    var norm;
    if (lastComma >= 0 && lastDot >= 0) {
      norm = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lastComma >= 0) {
      norm = s.split(',').length === 2 ? s.replace(',', '.') : '';
    } else if (lastDot >= 0) {
      norm = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : (s.split('.').length === 2 ? s : '');
    } else norm = s;
    if (!/^\d+(\.\d{1,2})?$/.test(norm)) return NaN;
    return Number(norm);
  }

  /** Elle fiyat girişi (panel_price_decide decision=manual): KDV dahil TL alış fiyatı + stok durumu + not. */
  function buildManualPrice(id, v) {
    v = v || {};
    var errors = {};
    var cost = parseTry(v.costTry);
    if (!isFinite(cost)) errors.costTry = 'KDV dahil alış fiyatını TL olarak yazın (örn. 1.234,50; en çok 2 ondalık).';
    else if (cost <= 0 || cost > MAX_COST_TRY) errors.costTry = 'Fiyat 0 ile 10.000.000 ₺ arasında olmalı.';
    var available = !(v.available === false || v.available === 'false' || v.available === '0' || v.available === 'yok');
    var note = clean(v.note, 200);
    if (note.length < 3) errors.note = 'Fiyatı nereden ve kimden teyit ettiğinizi kısaca yazın.';
    return { ok: Object.keys(errors).length === 0, errors: errors, body: { id: id, decision: 'manual', costTry: cost, available: available, note: note } };
  }
  function buildDecision(id, decision, note) {
    var ok = decision === 'approve' || decision === 'reject';
    return { ok: ok, body: { id: id, decision: decision, note: clean(note, 200) } };
  }
  /** Onay bekleyen fiyat: önceki / yeni maliyet (KDV dahil TL) ve yüzde değişim. */
  function heldInfo(item) {
    var h = item && item.held;
    if (!h || typeof h !== 'object') return null;
    var next = Number(h.costTry);
    var prevRaw = h.prevCostTry !== null && h.prevCostTry !== undefined ? h.prevCostTry : item.costTry;
    var prev = Number(prevRaw);
    return {
      prev: prevRaw !== null && prevRaw !== undefined && isFinite(prev) && prev > 0 ? prev : null,
      next: isFinite(next) ? next : null,
      pct: pctChange(prev, next), at: h.at, available: h.available !== false
    };
  }
  function priceCounts(items) {
    var c = { total: 0, orderable: 0, held: 0, error: 0, unavailable: 0, stale: 0 };
    (Array.isArray(items) ? items : []).forEach(function (it) {
      c.total++;
      if (it.orderable === true) c.orderable++;
      if (it.held || it.status === 'held') c.held++;
      if (it.status === 'error') c.error++;
      if (it.status === 'unavailable') c.unavailable++;
      if (it.reason === 'stale') c.stale++;
    });
    return c;
  }
  /** Fiyat tablosu süzgeci: q (ad/kimlik/kategori) ve status (held|error|unavailable|stale|orderable|blocked). */
  function priceMatches(it, f) {
    f = f || {};
    var st = f.status || '';
    if (st === 'held' && !(it.held || it.status === 'held')) return false;
    if (st === 'error' && it.status !== 'error') return false;
    if (st === 'unavailable' && it.status !== 'unavailable') return false;
    if (st === 'stale' && it.reason !== 'stale') return false;
    if (st === 'orderable' && it.orderable !== true) return false;
    if (st === 'blocked' && it.orderable === true) return false;
    var q = fold(f.q);
    if (q) {
      var hay = fold(str(it.name) + ' ' + str(it.id) + ' ' + str(it.category));
      return q.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
    }
    return true;
  }
  function priceRank(it) {
    if (it.held || it.status === 'held') return 0;
    if (it.status === 'error') return 1;
    if (it.reason === 'stale') return 2;
    if (it.status === 'unavailable') return 3;
    return 4;
  }
  /** Dikkat isteyenler önce (onay bekleyen, hata, eski fiyat, stok yok), sonra ada göre. */
  function sortPrices(items) {
    return (Array.isArray(items) ? items : []).slice().sort(function (a, b) {
      var d = priceRank(a) - priceRank(b);
      return d !== 0 ? d : str(a.name).localeCompare(str(b.name), 'tr');
    });
  }
  /** Cron (her 10 dakikada bir) sağlığı: sunucudaki eşikle (30 dakika) aynı; 6 saate kadar gecikmiş, sonrası çalışmıyor. */
  function cronHealth(lastRun, nowMs) {
    var ms = toMs(lastRun);
    if (!isFinite(ms)) return { level: 'down', label: 'Hiç çalışmadı' };
    var age = (nowMs === undefined ? Date.now() : nowMs) - ms;
    if (age <= CRON_OK_MS) return { level: 'ok', label: 'Çalışıyor' };
    if (age <= CRON_LATE_MS) return { level: 'late', label: 'Gecikmiş' };
    return { level: 'down', label: 'Çalışmıyor' };
  }
  /**
   * Fiyat sekmesi sayaçları: sunucunun tüm katalog sayımları (panel_prices.counts; 50.000 ürün tarayıcıya gelmez)
   * varsa onlar, yoksa listedeki ürünlerden hesaplanır.
   */
  function priceStats(server, items) {
    var c = server && server.counts && typeof server.counts === 'object' ? server.counts : null;
    if (!c) return priceCounts(items);
    var n = function (v) { var x = Number(v); return isFinite(x) && x >= 0 ? x : 0; };
    return { total: n(server.products), orderable: null, held: n(c.held), error: n(c.error), unavailable: n(c.unavailable), stale: n(c.stale),
      ok: n(c.ok), noSource: n(c.noSource), problems: n(server.problems) };
  }
  /** Panel durumundaki cron bilgisi (healthy bayrağı varsa o, yoksa son çalışma zamanından hesaplanır). */
  function cronState(cron, lastRun, nowMs) {
    var last = cron && cron.lastRunAt ? cron.lastRunAt : lastRun;
    var calc = cronHealth(last, nowMs);
    if (cron && typeof cron.healthy === 'boolean') {
      return cron.healthy ? { level: 'ok', label: 'Çalışıyor' } : { level: calc.level === 'ok' ? 'late' : calc.level, label: 'Sorunlu' };
    }
    return calc;
  }
  function isResourceMetric(k) { return k === 'cpuUserSeconds' || k === 'cpuSystemSeconds' || k === 'peakMemoryBytes'; }
  function resourceMetricText(k, value) {
    if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return 'ölçülemedi';
    var n = Number(value);
    if (!isFinite(n) || n < 0 || n > 9007199254740991) return 'ölçülemedi';
    if (k === 'peakMemoryBytes') {
      if (n === 0 || Math.floor(n) !== n) return 'ölçülemedi';
      var mib = n / 1048576;
      return mib < 0.01 ? '<0,01 MiB' : fmtNum(mib, 2).replace(/,?0+$/, '') + ' MiB';
    }
    return n > 0 && n < 0.000001 ? '<0,000001 sn' : fmtNum(n, 6).replace(/,?0+$/, '') + ' sn';
  }
  function summaryText(v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.map(summaryText).join(', ');
    if (typeof v === 'object') {
      return Object.keys(v).filter(function (k) { return isResourceMetric(k) || (v[k] !== null && v[k] !== undefined && v[k] !== ''); }).map(function (k) {
        var x = v[k];
        return (SUMMARY_LABELS[k] || k) + ': ' + (isResourceMetric(k) ? resourceMetricText(k, x) : x === true ? 'evet' : x === false ? 'hayır' : summaryText(x));
      }).join(' · ');
    }
    return '';
  }
  function isStaleCheck(checkedAt, nowMs) {
    var ms = toMs(checkedAt);
    return !isFinite(ms) || (nowMs === undefined ? Date.now() : nowMs) - ms > STALE_MS;
  }

  var H = {
    STATUS_LABELS: STATUS_LABELS, STATUS_ORDER: STATUS_ORDER, ACTIONS: ACTIONS, TRANSITIONS: TRANSITIONS, REF_RE: REF_RE,
    PRICE_STATUS: PRICE_STATUS, PRICE_REASONS: PRICE_REASONS, FIRMA_LABELS: FIRMA_LABELS, COUNT_LABELS: COUNT_LABELS,
    CRON_COMMAND: CRON_COMMAND, STALE_MS: STALE_MS,
    str: str, clean: clean, fold: fold, fmtNum: fmtNum, fmtTry: fmtTry, fmtUsd: fmtUsd, fmtPct: fmtPct, pctChange: pctChange,
    toMs: toMs, fmtDate: fmtDate, fmtDateTime: fmtDateTime, ageText: ageText, statusLabel: statusLabel, orderRefFromHash: orderRefFromHash,
    allowedActions: allowedActions, allowedFromStatus: allowedFromStatus, isOverdue: isOverdue, httpsUrl: httpsUrl,
    mailHref: mailHref, telHref: telHref, buildChange: buildChange, explainError: explainError, parseDay: parseDay,
    todayIso: todayIso, validateExportRange: validateExportRange, quickRange: quickRange, parseTry: parseTry,
    buildManualPrice: buildManualPrice, buildDecision: buildDecision, heldInfo: heldInfo, priceCounts: priceCounts, priceStats: priceStats,
    priceMatches: priceMatches, sortPrices: sortPrices, cronHealth: cronHealth, cronState: cronState, summaryText: summaryText,
    isStaleCheck: isStaleCheck, buildConfirm: buildConfirm, confirmServerErrors: confirmServerErrors, buildReject: buildReject, isRespondLate: isRespondLate, round2: round2,
    REJECT_REASONS: REJECT_REASONS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = H;
  if (!root || !root.document) return;
  start(H, root);

  /* ================================================================== arayüz */
  function start(H, win) {
    var doc = win.document;
    var API = '/api/magaza.php';
    var LOGIN_URL = '/hesap/giris.html?next=/hesap/magaza-panel.html';
    var UI = win.VG && win.VG.AccountUI ? win.VG.AccountUI : null;
    var $ = function (s, c) { return (c || doc).querySelector(s); };
    var $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };
    var enc = encodeURIComponent;
    var gate = $('[data-mgp-gate]'), app = $('[data-mgp-app]'), alertEl = $('[data-mgp-alert]');
    var csrf = '';
    var PAGE_SIZE_PRICES = 40;
    var TABS = { orders: 'siparisler', prices: 'fiyatlar', status: 'durum', export: 'disa-aktar' };
    var TAB_BY_HASH = { siparisler: 'orders', fiyatlar: 'prices', durum: 'status', 'disa-aktar': 'export' };
    var currentTab = '';

    /* ---------------------------------------------------------- DOM yardımcıları */
    function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
    function append(el, kids) {
      (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        if (Array.isArray(c)) append(el, c);
        else el.appendChild(typeof c === 'object' ? c : doc.createTextNode(String(c)));
      });
      return el;
    }
    /** h(etiket, {class, text, on:{olay: fn}, ...öznitelikler}, çocuklar). Veri yalnızca textContent ile yazılır. */
    function h(tag, props, kids) {
      var el = doc.createElement(tag);
      if (props) Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'on') Object.keys(v).forEach(function (ev) { el.addEventListener(ev, v[ev]); });
        else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      });
      return append(el, kids);
    }
    function pill(text, cls) { return h('span', { class: 'mgp-pill' + (cls ? ' mgp-pill--' + cls : ''), text: text }); }
    function btn(label, cls, onClick, extra) {
      var p = { type: 'button', class: 'mgp-btn' + (cls ? ' mgp-btn--' + cls : ''), text: label, on: { click: onClick } };
      if (extra) Object.keys(extra).forEach(function (k) { p[k] = extra[k]; });
      return h('button', p);
    }
    function setBusy(container, on) {
      $$('button, input, select, textarea', container).forEach(function (el) {
        if (on) { el.setAttribute('data-was-disabled', el.disabled ? '1' : '0'); el.disabled = true; }
        else if (el.getAttribute('data-was-disabled') !== null) { el.disabled = el.getAttribute('data-was-disabled') === '1'; el.removeAttribute('data-was-disabled'); }
      });
      container.setAttribute('aria-busy', on ? 'true' : 'false');
    }
    function copyText(text) {
      if (win.navigator && win.navigator.clipboard && win.navigator.clipboard.writeText) {
        return win.navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
      }
      return new Promise(function (resolve) {
        var ta = h('textarea', { class: 'mgp-sr', 'aria-hidden': 'true', value: text });
        doc.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
        doc.body.removeChild(ta);
        resolve(ok);
      });
    }
    function confirmAction(opts) {
      if (UI && UI.confirmDialog) return UI.confirmDialog(opts);
      return Promise.resolve(win.confirm(opts.message || opts.title || 'Emin misiniz?'));
    }

    /* ---------------------------------------------------------- iletiler ve API */
    function say(kind, text, link) {
      clear(alertEl);
      if (!text) { alertEl.hidden = true; return; }
      alertEl.hidden = false;
      alertEl.className = 'mgp-alert mgp-alert--' + (kind || 'info');
      alertEl.setAttribute('role', kind === 'ok' || kind === 'info' ? 'status' : 'alert');
      alertEl.appendChild(doc.createTextNode(text));
      if (link) { alertEl.appendChild(doc.createTextNode(' ')); alertEl.appendChild(h('a', { href: link.href, text: link.text })); }
      if (alertEl.scrollIntoView) alertEl.scrollIntoView({ block: 'nearest' });
    }
    function fail(e) {
      var x = H.explainError({ status: e && e.status, message: e && e.message, retryAfter: e && e.retryAfter, code: e && e.code });
      say('error', x.text, x.login ? { href: LOGIN_URL, text: 'Giriş yap' } : null);
      return x;
    }

    function errorFrom(r, j) {
      var e = new Error((j && j.message) || 'İşlem tamamlanamadı.');
      e.status = r.status;
      e.code = j && j.error;
      e.fields = j && j.fields && typeof j.fields === 'object' ? j.fields : null;
      e.retryAfter = parseInt(r.headers.get('Retry-After') || '', 10) || (j && Number(j.retryAfter)) || 0;
      return e;
    }
    /** GET (opts.body yok) ya da POST (X-VG-CSRF ile). opts.raw: CSV gibi JSON olmayan başarılı yanıtı blob olarak ver. */
    function api(action, opts) {
      opts = opts || {};
      var post = opts.body !== undefined;
      var init = { method: post ? 'POST' : 'GET', credentials: 'same-origin', headers: { Accept: opts.raw ? 'text/csv, application/json' : 'application/json' } };
      if (post) {
        init.headers['Content-Type'] = 'application/json';
        init.headers['X-VG-CSRF'] = csrf;
        init.body = JSON.stringify(opts.body);
      }
      return win.fetch(API + '?action=' + enc(action) + (opts.query || ''), init).then(function (r) {
        var type = r.headers.get('Content-Type') || '';
        if (opts.raw && r.ok && type.indexOf('json') < 0) return r.blob().then(function (b) { return { blob: b, response: r }; });
        return r.json().catch(function () { return { ok: false, message: 'Sunucu yanıtı okunamadı.' }; }).then(function (j) {
          if (j && typeof j.csrf === 'string' && j.csrf) csrf = j.csrf;
          if (!r.ok || !j || j.ok !== true) throw errorFrom(r, j);
          return j;
        });
      });
    }
    /** POST; 403'te (CSRF eskimiş olabilir) güvenlik anahtarını panel_me ile yenileyip bir kez yeniden dener. */
    function post(action, body, raw) {
      return api(action, { body: body, raw: raw }).catch(function (e) {
        if (e.status !== 403) throw e;
        var used = csrf;
        return api('panel_me').then(function (me) {
          if (!me.user) { e.status = 401; throw e; }          // oturum kaybı: 403 değil "yeniden giriş yapın"
          if (!me.panel || !me.csrf || me.csrf === used) throw e;
          csrf = me.csrf;
          return api(action, { body: body, raw: raw });
        }, function () { throw e; });
      });
    }

    /* ---------------------------------------------------------- sekmeler ve yönlendirme */
    var tabButtons = $$('[role="tab"]');
    function selectTab(name) {
      currentTab = name;
      tabButtons.forEach(function (t) {
        var on = t.getAttribute('data-tab') === name;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        doc.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
    }
    tabButtons.forEach(function (t, i, all) {
      t.addEventListener('click', function () { win.location.hash = TABS[t.getAttribute('data-tab')]; });
      t.addEventListener('keydown', function (e) {
        var k = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!k) return;
        var n = all[(i + k + all.length) % all.length];
        n.focus();
        win.location.hash = TABS[n.getAttribute('data-tab')];
      });
    });

    function route() {
      var hash = (win.location.hash || '').replace(/^#/, '');
      /* Sipariş bağlantısı: #VGS-yymmdd-XXXXX (personel e-postasındaki bağlantı biçimi) ya da #siparis=VGS-... */
      var ref = H.orderRefFromHash(hash);
      if (ref) { selectTab('orders'); openOrder(ref); return; }
      /* Boş adres (ör. sipariş ayrıntısından "Geri") sipariş listesidir; tanınmayan bağlantı (#main atlama bağlantısı...) görünümü bozmaz. */
      var tab = hash === '' ? 'orders' : TAB_BY_HASH[hash];
      if (!tab) { if (currentTab) return; tab = 'orders'; }
      selectTab(tab);
      say('', '');
      if (tab === 'orders') { O.detailSeq++; showOrderView(false); loadOrders(); }
      else if (tab === 'prices') loadPrices();
      else if (tab === 'status') loadStatus();
    }

    /* ================================================================== SİPARİŞLER */
    var O = { status: '', q: '', page: 1, seq: 0, data: null, ref: '', detailSeq: 0 };
    var orderList = $('[data-mgp-orders-list]'), orderDetail = $('[data-mgp-order]');
    var chipsEl = $('[data-mgp-chips]'), ordersBody = $('[data-mgp-orders-body]'), pagerEl = $('[data-mgp-pager]');
    var searchForm = $('[data-mgp-search]'), searchInput = $('#o-q');

    function showOrderView(detail) { orderList.hidden = detail; orderDetail.hidden = !detail; }
    function gotoOrder(ref) { win.location.hash = ref; }

    function loadOrders() {
      var seq = ++O.seq;
      var qs = '&page=' + O.page + (O.status ? '&status=' + enc(O.status) : '') + (O.q ? '&q=' + enc(O.q) : '');
      clear(ordersBody).appendChild(h('tr', null, h('td', { colspan: 8, class: 'mgp-muted', text: 'Yükleniyor…' })));
      return api('panel_orders', { query: qs }).then(function (j) {
        if (seq !== O.seq) return;
        O.data = j;
        renderOrders();
      }).catch(function (e) {
        if (seq !== O.seq) return;
        clear(ordersBody).appendChild(h('tr', null, h('td', { colspan: 8, class: 'mgp-muted', text: 'Siparişler yüklenemedi.' })));
        fail(e);
      });
    }

    function chip(status, label, n) {
      var on = O.status === status;
      return h('button', { type: 'button', class: 'mgp-chip' + (on ? ' is-on' : ''), 'aria-pressed': on ? 'true' : 'false', on: { click: function () {
        O.status = status; O.page = 1; loadOrders();
      } } }, [label, h('span', { class: 'mgp-chip__n', text: String(n) })]);
    }

    function renderOrders() {
      var d = O.data || {};
      var counts = d.counts && typeof d.counts === 'object' ? d.counts : {};
      var total = 0;
      var keys = H.STATUS_ORDER.slice();
      Object.keys(counts).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
      keys.forEach(function (k) { total += Number(counts[k]) || 0; });
      clear(chipsEl).appendChild(chip('', 'Tümü', total));
      keys.forEach(function (k) { chipsEl.appendChild(chip(k, H.statusLabel(k), Number(counts[k]) || 0)); });

      clear(ordersBody);
      var rows = Array.isArray(d.orders) ? d.orders : [];
      if (!rows.length) {
        ordersBody.appendChild(h('tr', null, h('td', { colspan: 8, class: 'mgp-muted', text: O.q || O.status ? 'Bu süzgece uyan sipariş yok.' : 'Henüz sipariş yok.' })));
      }
      rows.forEach(function (o) { ordersBody.appendChild(orderRow(o)); });

      clear(pagerEl);
      var pages = Math.max(1, Number(d.pages) || 1), page = Math.min(Math.max(1, Number(d.page) || O.page), pages);
      O.page = page;
      pagerEl.appendChild(btn('‹ Önceki', 'ghost', function () { O.page = page - 1; loadOrders(); }, { disabled: page <= 1 }));
      pagerEl.appendChild(h('span', { class: 'mgp-muted', text: 'Sayfa ' + page + ' / ' + pages + ' · ' + (Number(d.total) || 0) + ' sipariş' }));
      pagerEl.appendChild(btn('Sonraki ›', 'ghost', function () { O.page = page + 1; loadOrders(); }, { disabled: page >= pages }));
    }

    function orderRow(o) {
      var overdue = H.isOverdue(o, Date.now());
      var tr = h('tr', { class: 'mgp-tr' + (overdue ? ' mgp-tr--overdue' : '') });
      var status = h('td', { 'data-label': 'Durum' }, [pill(o.statusLabel || H.statusLabel(o.status), 's-' + H.str(o.status).replace(/[^a-z_]/g, ''))]);
      if (overdue) status.appendChild(pill('Ödeme süresi geçti', 'late'));
      if (H.isRespondLate(o, Date.now())) status.appendChild(pill('Yanıt süresi geçti', 'late'));
      tr.appendChild(h('td', { 'data-label': 'Sipariş no' }, h('button', { type: 'button', class: 'mgp-link mgp-mono', text: H.str(o.ref), on: { click: function () { gotoOrder(o.ref); } } })));
      tr.appendChild(h('td', { 'data-label': 'Tarih', text: H.fmtDateTime(o.createdAt) }));
      tr.appendChild(h('td', { 'data-label': 'Müşteri' }, [H.str(o.customerName) || '–', o.member ? ' ' : null,
        o.member ? h('span', { class: 'mgp-pill mgp-pill--public', title: o.member === 'claim' ? 'Üye, e-postasını doğrulayarak hesabına ekledi' : 'Üye girişi yapılarak verildi', text: 'Üye' }) : null]));
      tr.appendChild(h('td', { 'data-label': 'İl', text: H.str(o.city) || '–' }));
      tr.appendChild(h('td', { 'data-label': 'Tutar (KDV dahil)', class: 'mgp-num' }, o.estimate === true
        ? [h('span', { class: 'mgp-muted', text: '~' }), Number(o.amountTry) > 0 ? H.fmtTry(o.amountTry) : 'fiyat yok', h('div', { class: 'mgp-muted', text: 'tahmini' + (Number(o.unpriced) > 0 ? ' · ' + o.unpriced + ' ürün fiyatsız' : '') })]
        : [H.fmtTry(o.amountTry)]));
      tr.appendChild(h('td', { 'data-label': 'Kalem', class: 'mgp-num', text: H.str(o.itemCount) }));
      tr.appendChild(status);
      tr.appendChild(h('td', { 'data-label': 'Son tarih', text: o.status === 'odeme_bekleniyor' ? 'Ödeme: ' + H.fmtDateTime(o.payBy)
        : (o.status === 'teyit_bekliyor' ? 'Yanıt: ' + H.fmtDateTime(o.respondBy) : '–') }));
      return tr;
    }

    searchForm.addEventListener('submit', function (e) {
      e.preventDefault();
      O.q = H.clean(searchInput.value, 80);
      O.page = 1;
      loadOrders();
    });
    $('[data-mgp-orders-reload]').addEventListener('click', function () { loadOrders(); });

    /* ---------------------------------------------------------- sipariş ayrıntısı */
    function card(title, kids, cls) { return h('section', { class: 'mgp-card' + (cls ? ' ' + cls : '') }, [h('h3', { text: title }), kids]); }
    function dl(rows) {
      var el = h('dl', { class: 'mgp-dl' });
      rows.forEach(function (r) {
        if (r[1] === null || r[1] === undefined || r[1] === '') return;
        el.appendChild(h('dt', { text: r[0] }));
        el.appendChild(h('dd', null, r[1]));
      });
      return el;
    }
    function link(text, href, external) {
      if (!href) return text;
      return h('a', { href: href, text: text, target: external ? '_blank' : null, rel: external ? 'noopener noreferrer' : null });
    }
    function cityLine(a) { return [H.str(a.district), H.str(a.city)].filter(Boolean).join(' / '); }

    function openOrder(ref) {
      var seq = ++O.detailSeq;
      O.ref = ref;
      showOrderView(true);
      say('', '');
      clear(orderDetail).appendChild(h('p', { class: 'mgp-muted', role: 'status', text: 'Sipariş yükleniyor…' }));
      return api('panel_order', { query: '&ref=' + enc(ref) }).then(function (j) {
        if (seq !== O.detailSeq) return;
        O.memberRef = ref;
        O.memberInfo = j.memberInfo || null;
        O.aidRef = ref;
        O.confirmAid = j.confirmAid || null;
        renderDetail(j.order, j.allowed);
      }).catch(function (e) {
        if (seq !== O.detailSeq) return;
        clear(orderDetail).appendChild(h('div', null, [
          h('p', { class: 'mgp-muted', text: 'Sipariş yüklenemedi.' }),
          btn('← Siparişlere dön', 'ghost', function () { win.location.hash = TABS.orders; })
        ]));
        fail(e);
      });
    }

    function itemsTable(order) {
      var sources = order.private && order.private.sources && typeof order.private.sources === 'object' ? order.private.sources : {};
      var head = ['Ürün', 'Adet', 'Birim fiyat (KDV dahil)', 'Tutar (KDV dahil)', 'USD, KDV hariç (personel)', 'Tedarik kaynağı (personel)'];
      var tb = h('tbody');
      (Array.isArray(order.items) ? order.items : []).forEach(function (it) {
        var qty = Number(it.qty) || 0;
        var src = h('td', { 'data-label': head[5] });
        (Array.isArray(sources[it.id]) ? sources[it.id] : []).forEach(function (s) {
          var url = H.httpsUrl(s.url);
          var line = h('div', { class: 'mgp-src' });
          line.appendChild(url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: H.str(s.supplier) || url }) : H.str(s.supplier) || '–');
          line.appendChild(doc.createTextNode(' · alış ' + H.fmtTry(s.costTry) + (s.checkedAt ? ' · ' + H.fmtDateTime(s.checkedAt) : '')));
          src.appendChild(line);
        });
        if (!src.firstChild) src.appendChild(doc.createTextNode('–'));
        tb.appendChild(h('tr', null, [
          h('td', { 'data-label': head[0] }, [
            h('strong', { text: H.str(it.name) }),
            h('div', { class: 'mgp-muted', text: [H.str(it.brand), H.str(it.mpn), H.str(it.id)].filter(Boolean).join(' · ') })
          ]),
          h('td', { 'data-label': head[1], class: 'mgp-num', text: qty + ' ' + (H.str(it.unit) || 'adet') }),
          h('td', { 'data-label': head[2], class: 'mgp-num', text: H.fmtTry(it.unitTryGross) }),
          h('td', { 'data-label': head[3], class: 'mgp-num', text: H.fmtTry(it.lineTryGross) }),
          h('td', { 'data-label': head[4], class: 'mgp-num mgp-staff', text: H.fmtUsd(it.unitUsdNet) + ' × ' + qty + ' = ' + H.fmtUsd(Math.round(Number(it.unitUsdNet) * qty * 100) / 100) }),
          src
        ]));
      });
      var thead = h('thead', null, h('tr', null, head.map(function (t) { return h('th', { scope: 'col', text: t }); })));
      return h('div', { class: 'mgp-table-wrap' }, h('table', { class: 'mgp-table mgp-table--items' }, [h('caption', { class: 'mgp-sr', text: 'Sipariş kalemleri' }), thead, tb]));
    }

    function historyList(order) {
      var rows = (Array.isArray(order.history) ? order.history : []).slice().reverse();
      var ul = h('ol', { class: 'mgp-hist' });
      rows.forEach(function (x) {
        var li = h('li', null, [
          h('div', null, [h('strong', { text: H.statusLabel(x.status) }), h('span', { class: 'mgp-muted', text: ' · ' + H.fmtDateTime(x.at) + (x.by ? ' · ' + H.str(x.by) : '') })])
        ]);
        if (H.str(x.note)) li.appendChild(h('p', { class: 'mgp-note' }, [pill('iç not', 'internal'), ' ', H.str(x.note)]));
        if (H.str(x.publicNote)) li.appendChild(h('p', { class: 'mgp-note' }, [pill('müşteriye görünür', 'public'), ' ', H.str(x.publicNote)]));
        ul.appendChild(li);
      });
      if (!ul.firstChild) ul.appendChild(h('li', { class: 'mgp-muted', text: 'Kayıt yok.' }));
      return ul;
    }

    function field(id, label, kind, props, hint) {
      var input = h(kind, Object.assign({ id: id, 'aria-describedby': id + '-err' }, props || {}));
      var err = h('p', { class: 'mgp-err', id: id + '-err', role: 'alert', hidden: true });
      var wrap = h('div', { class: 'mgp-field' }, [h('label', { for: id, text: label }), input, hint ? h('small', { class: 'mgp-muted', text: hint }) : null, err]);
      return { wrap: wrap, input: input, err: err };
    }
    function showErrors(pairs) {
      var first = null;
      pairs.forEach(function (p) {
        var msg = p[1] || '';
        p[0].err.hidden = !msg;
        p[0].err.textContent = msg;
        p[0].input.setAttribute('aria-invalid', msg ? 'true' : 'false');
        if (msg && !first) first = p[0].input;
      });
      if (first) first.focus();
    }

    function actionForm(order, allowed) {
      var list = Array.isArray(allowed) ? allowed : H.allowedFromStatus(order.status);
      var acts = H.allowedActions(list);
      var noteF = field('a-note', 'İç not (yalnızca personel görür)', 'textarea', { rows: 3, maxlength: 1000 });
      var pubF = field('a-pub', 'Müşteriye görünür not', 'textarea', { rows: 3, maxlength: 600 }, 'Sipariş takip sayfasında ve (işaretlerseniz) e-postada görünür. İptal ve iade için gerekçe zorunludur (iç not ya da bu not).');
      var companyF = field('a-company', 'Kargo firması', 'input', { type: 'text', maxlength: 60, list: 'a-carriers', autocomplete: 'off' });
      var codeF = field('a-code', 'Takip kodu', 'input', { type: 'text', maxlength: 60, autocomplete: 'off' });
      var urlF = field('a-url', 'Takip adresi (isteğe bağlı)', 'input', { type: 'url', maxlength: 300, placeholder: 'https://', autocomplete: 'off' });
      var notify = h('input', { type: 'checkbox', id: 'a-notify' });
      var carriers = h('datalist', { id: 'a-carriers' }, ['Yurtiçi Kargo', 'Aras Kargo', 'MNG Kargo', 'PTT Kargo', 'Sürat Kargo', 'UPS', 'DHL', 'Kendi aracımızla'].map(function (c) { return h('option', { value: c }); }));
      var form = h('form', { class: 'mgp-form', novalidate: true, autocomplete: 'off', on: { submit: function (e) { e.preventDefault(); } } });
      form.appendChild(carriers);
      append(form, [noteF.wrap, pubF.wrap]);
      var needsTracking = acts.some(function (a) { return a.needsTracking; });
      if (needsTracking) {
        form.appendChild(h('fieldset', { class: 'mgp-fieldset' }, [
          h('legend', { text: 'Kargo bilgisi ("Kargoya verildi" için zorunlu)' }),
          h('div', { class: 'mgp-row' }, [companyF.wrap, codeF.wrap]), urlF.wrap
        ]));
      }
      form.appendChild(h('label', { class: 'mgp-check', for: 'a-notify' }, [notify, ' Müşteriye e-posta gönder']));
      form.appendChild(h('p', { class: 'mgp-muted mgp-hint', text: 'İşaretlerseniz müşteriye durum e-postası gider; iç not hiçbir zaman gönderilmez. İşaretlemezseniz müşteriye bir şey gitmez.' }));

      function collect() {
        return { note: noteF.input.value, publicNote: pubF.input.value, company: companyF.input.value, code: codeF.input.value, url: urlF.input.value };
      }
      function send(status) {
        var built = H.buildChange(status, collect(), notify.checked);
        showErrors([[noteF, built.errors.reason || built.errors.note], [pubF, ''], [companyF, built.errors.company], [codeF, built.errors.code], [urlF, built.errors.url]]);
        if (!built.ok) return;
        var act = status ? H.ACTIONS[status] : null;
        var go = act && act.confirm
          ? confirmAction({ title: act.label + ' işlemi', message: order.ref + ' numaralı sipariş "' + H.statusLabel(status) + '" durumuna alınacak. Bu işlem geri alınamaz. Devam edilsin mi?', confirmText: act.label, danger: true })
          : Promise.resolve(true);
        return go.then(function (ok) {
          if (!ok) return;
          built.body.ref = order.ref;
          setBusy(form, true);
          return post('panel_order_update', built.body).then(function (j) {
            if (O.ref !== order.ref) return;
            var msg = status ? 'Sipariş "' + H.statusLabel(status) + '" durumuna alındı.' : 'Not kaydedildi.';
            if (built.body.notify && j.mailSent === false) say('warn', msg + ' Ancak müşteri e-postası gönderilemedi; müşteriyi başka yoldan bilgilendirin.');
            else say('ok', msg + (built.body.notify ? ' Müşteriye e-posta gönderildi.' : ''));
            if (Array.isArray(j.allowed)) return renderDetail(j.order, j.allowed);
            return api('panel_order', { query: '&ref=' + enc(order.ref) }).then(function (d) { renderDetail(d.order, d.allowed); }, function () { renderDetail(j.order, null); });
          });
        }).catch(function (e) {
          setBusy(form, false);
          var x = fail(e);
          if (x.refresh && O.ref === order.ref) openOrder(order.ref).then(function () { fail(e); });
        });
      }

      var bar = h('div', { class: 'mgp-actions' });
      acts.forEach(function (a) { bar.appendChild(btn(a.label, a.tone, function () { send(a.status); }, { 'data-status': a.status })); });
      bar.appendChild(btn('Yalnızca notu kaydet', 'ghost', function () { send(''); }));
      form.appendChild(bar);
      if (!acts.length) form.appendChild(h('p', { class: 'mgp-muted', text: 'Bu sipariş son durumda; başka durum geçişi yok. Yalnızca not ekleyebilirsiniz.' }));
      return form;
    }

    /* ---------------------------------------------------------- teyitli sipariş talebi: onay / ret
       Talep "teyit_bekliyor" iken personel her satırın stok ve fiyatını tedarikçiyle teyit eder. Sunucu (panel_order_confirm)
       girilen KDV dahil birim fiyatları ve kargo ücretini sabitler, ödeme süresini başlatır ve IBAN'lı teyit e-postasını
       gönderir; ret (panel_order_reject) talebi bedelsiz kapatır. Tedarikçi son kontrolü yalnızca bu panelde görünür. */
    function reloadOrder(ref) {
      return api('panel_order', { query: '&ref=' + enc(ref) }).then(function (d) {
        if (O.ref !== ref) return;
        O.memberRef = ref; O.memberInfo = d.memberInfo || null; O.aidRef = ref; O.confirmAid = d.confirmAid || null;
        renderDetail(d.order, d.allowed);
      });
    }
    function aidCell(it, a, onUse, ref) {
      var td = h('td', { 'data-label': 'Tedarikçi son kontrol (personel)', class: 'mgp-staff' });
      if (!a) { td.appendChild(h('span', { class: 'mgp-muted', text: 'Kayıt yok (ürün katalogdan kalkmış olabilir).' })); return td; }
      var box = h('div');
      box.appendChild(pill(H.PRICE_STATUS[a.status] || (a.status ? H.str(a.status) : 'Kontrol edilmedi'), 'p-' + (H.str(a.status).replace(/[^a-z]/g, '') || 'none')));
      if (a.available === false) box.appendChild(pill('Stokta yok', 'late'));
      box.appendChild(h('div', { text: 'Alış ' + H.fmtTry(a.costTry) + ' · öneri ' + H.fmtTry(a.tryGross) + (a.margin !== null && a.margin !== undefined ? ' (marj %' + H.fmtNum(Number(a.margin) * 100, 0) + ')' : '') }));
      box.appendChild(h('div', { class: a.fresh ? 'mgp-muted' : 'mgp-late', text: a.checkedAt ? 'Kontrol: ' + H.fmtDateTime(a.checkedAt) + ' (' + H.ageText(a.checkedAt, Date.now()) + ')' : 'Hiç doğrulanmadı' }));
      if (!a.orderable && a.reasonText) box.appendChild(h('div', { class: 'mgp-muted mgp-note-line', text: H.str(a.reasonText) }));
      (Array.isArray(a.sources) ? a.sources : []).slice(0, 3).forEach(function (s) {
        var url = H.httpsUrl(s.url);
        box.appendChild(h('div', { class: 'mgp-src' }, url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: H.str(s.supplier) || url }) : H.str(s.supplier)));
      });
      var acts = h('div', { class: 'mgp-actions mgp-aid-acts' });
      if (typeof a.tryGross === 'number') acts.appendChild(btn('Öneriyi kullan', 'ghost', function () { onUse(a.tryGross); }));
      acts.appendChild(btn('Şimdi kontrol et', 'ghost', function (e) {
        var b = e && e.currentTarget;
        if (b) b.disabled = true;
        post('panel_check_now', { id: it.id }).then(function () { return reloadOrder(ref); }).then(function () { say('ok', it.name + ': tedarikçi fiyatı yeniden kontrol edildi.'); }, function (err) { if (b) b.disabled = false; fail(err); });
      }));
      box.appendChild(acts);
      td.appendChild(box);
      return td;
    }
    function confirmCard(order) {
      var aid = O.aidRef === order.ref && O.confirmAid ? O.confirmAid : null;
      var lines = aid && aid.lines && typeof aid.lines === 'object' ? aid.lines : {};
      var items = Array.isArray(order.items) ? order.items : [];
      var wrap = h('div', { class: 'mgp-confirm' });
      var form = h('form', { class: 'mgp-form', novalidate: true, autocomplete: 'off', on: { submit: function (e) { e.preventDefault(); } } });
      form.appendChild(h('p', { class: 'mgp-muted mgp-hint', text: 'Her ürünün stok ve fiyatını tedarikçiyle teyit edin. Müşteriye gidecek KDV dahil birim fiyatı düzeltin; adet yalnızca azaltılabilir (talepteki adetten fazlası teyit edilemez), teyit edilemeyen ürünü çıkarın. Talepten farklar müşteriye teyit e-postasında ayrıca bildirilir. Onayladığınızda tutarlar sabitlenir, ödeme süresi (' + (aid && aid.paymentHours ? aid.paymentHours : 24) + ' saat) başlar ve müşteriye IBAN’lı teyit e-postası ile kesin ön bilgilendirme formu ve sözleşme gider.' }));
      var rows = [];
      var tb = h('tbody');
      var head = ['Ürün', 'Talep', 'Adet', 'Birim fiyat (TL, KDV dahil)', 'Satır', 'Tedarikçi son kontrol (personel)', 'Çıkar'];
      items.forEach(function (it, i) {
        var a = lines[it.id] || null;
        var start = typeof it.unitTryGross === 'number' ? it.unitTryGross : (a && typeof a.tryGross === 'number' ? a.tryGross : null);
        var name = H.str(it.name);
        var maxQty = typeof it.qty === 'number' && it.qty >= 1 ? it.qty : 1;
        var qtyIn = h('input', { type: 'number', min: '1', max: String(maxQty), step: '1', inputmode: 'numeric', value: String(it.qty), 'aria-label': 'Adet (en çok ' + maxQty + '): ' + name, class: 'mgp-in mgp-in--qty' });
        var unitIn = h('input', { type: 'text', inputmode: 'decimal', value: start !== null ? H.fmtNum(start, 2) : '', placeholder: 'ör. 1.250,00', 'aria-label': 'KDV dahil birim fiyat: ' + name, class: 'mgp-in mgp-in--money' });
        var rm = h('input', { type: 'checkbox', 'aria-label': 'Talepten çıkar: ' + name });
        var lineEl = h('td', { 'data-label': head[4], class: 'mgp-num' });
        var err = h('p', { class: 'mgp-err', role: 'alert', hidden: true });
        var tr = h('tr', null, [
          h('td', { 'data-label': head[0] }, [h('strong', { text: name }), h('div', { class: 'mgp-muted', text: [H.str(it.brand), H.str(it.mpn), H.str(it.id)].filter(Boolean).join(' · ') }),
            it.freight ? pill('Nakliye ürünü', 'late') : null, err]),
          h('td', { 'data-label': head[1], class: 'mgp-num' }, [it.qty + ' ' + (H.str(it.unit) || 'adet'), h('div', { class: 'mgp-muted', text: typeof it.unitTryGross === 'number' ? '× ' + H.fmtTry(it.unitTryGross) + ' (tahmini)' : 'fiyatsız talep' })]),
          h('td', { 'data-label': head[2] }, qtyIn),
          h('td', { 'data-label': head[3] }, unitIn),
          lineEl,
          aidCell(it, a, function (v) { unitIn.value = H.fmtNum(v, 2); recalc(); }, order.ref),
          h('td', { 'data-label': head[6] }, h('label', { class: 'mgp-check' }, [rm, ' Çıkar']))
        ]);
        rows.push({ id: it.id, max: maxQty, qtyIn: qtyIn, unitIn: unitIn, rm: rm, lineEl: lineEl, err: err, tr: tr });
        tb.appendChild(tr);
      });
      var thead = h('thead', null, h('tr', null, head.map(function (t) { return h('th', { scope: 'col', text: t }); })));
      form.appendChild(h('div', { class: 'mgp-table-wrap' }, h('table', { class: 'mgp-table mgp-table--confirm' }, [h('caption', { class: 'mgp-sr', text: 'Teyit edilecek ürünler' }), thead, tb])));

      var est = 0;
      items.forEach(function (it) { if (typeof it.lineTryGross === 'number') est += it.lineTryGross; });
      var ship = aid && aid.shipping ? aid.shipping : { feeTry: 0, freeOverTry: 0 };
      var shipStart = ship.feeTry > 0 && !(ship.freeOverTry > 0 && est >= ship.freeOverTry) ? ship.feeTry : 0;
      var shipF = field('c-ship', 'Kargo / nakliye ücreti (TL, KDV dahil; ücretsizse 0)', 'input', { type: 'text', inputmode: 'decimal', value: H.fmtNum(shipStart, 2) },
        ship.feeTry > 0 ? 'Mağaza ayarı: ' + H.fmtTry(ship.feeTry) + (ship.freeOverTry > 0 ? ' · ' + H.fmtTry(ship.freeOverTry) + ' üzeri ücretsiz' : '') : 'Mağaza ayarında kargo ücreti yok.');
      var totalEl = h('strong', { class: 'mgp-confirm__total', 'aria-live': 'polite' });
      var pubF = field('c-pub', 'Müşteriye not (teyit e-postasında ve takip sayfasında görünür; isteğe bağlı)', 'textarea', { rows: 2, maxlength: 600 });
      var noteF = field('c-note', 'İç not (yalnızca personel)', 'textarea', { rows: 2, maxlength: 1000 }, 'Örn. tedarikçiyle telefonda teyit, stok adedi, termin.');
      append(form, [h('div', { class: 'mgp-row' }, [shipF.wrap, h('div', { class: 'mgp-field' }, [h('span', { class: 'mgp-field__label', text: 'Müşteriye gidecek toplam (KDV dahil)' }), totalEl])]), pubF.wrap, noteF.wrap]);

      function collect() {
        return rows.map(function (r) { return { id: r.id, max: r.max, qty: r.qtyIn.value, unit: r.unitIn.value, remove: r.rm.checked }; });
      }
      function recalc() {
        var built = H.buildConfirm(collect(), shipF.input.value, {});
        rows.forEach(function (r, i) {
          r.tr.classList.toggle('mgp-tr--removed', r.rm.checked);
          var qv = String(r.qtyIn.value).trim(), q = /^\d{1,4}$/.test(qv) ? parseInt(qv, 10) : 0, u = H.parseTry(r.unitIn.value);
          r.lineEl.textContent = r.rm.checked ? 'çıkarıldı' : (q > 0 && u > 0 ? H.fmtTry(H.round2(u * q)) : '–');
          void i;
        });
        totalEl.textContent = built.ok ? H.fmtTry(built.total) : '–';
        return built;
      }
      form.addEventListener('input', recalc);
      form.addEventListener('change', recalc);
      recalc();

      function showConfirmErrors(built) {
        var first = null;
        rows.forEach(function (r) {
          var kq = r.id + '.qty', ku = r.id + '.unit';
          var m = built.errors[kq] || built.errors[ku] || '';
          r.err.hidden = !m; r.err.textContent = m;
          r.qtyIn.setAttribute('aria-invalid', built.errors[kq] ? 'true' : 'false');
          r.unitIn.setAttribute('aria-invalid', built.errors[ku] ? 'true' : 'false');
          if (!first && built.errors[kq]) first = r.qtyIn;
          if (!first && built.errors[ku]) first = r.unitIn;
        });
        showErrors([[shipF, built.errors.shipping]]);
        if (built.errors.lines) say('warn', built.errors.lines);
        if (first) first.focus();
      }
      var confirmBtn = btn('Onayla ve ödeme bilgisi gönder', 'primary', function () {
        var built = recalc();
        var full = H.buildConfirm(collect(), shipF.input.value, { publicNote: pubF.input.value, note: noteF.input.value });
        showConfirmErrors(built);
        if (!full.ok) return;
        var removed = rows.filter(function (r) { return r.rm.checked; }).length;
        confirmAction({ title: 'Talebi onayla', message: order.ref + ' için ' + full.body.lines.length + ' ürün' + (removed ? ' (' + removed + ' ürün çıkarıldı)' : '') + ', toplam ' + H.fmtTry(full.total)
          + ' (KDV dahil) sabitlenecek ve müşteriye IBAN’lı teyit e-postası gönderilecek. Sözleşme, müşteri bu tutarı süresi içinde öderse kurulur. Devam edilsin mi?', confirmText: 'Onayla ve gönder' }).then(function (ok) {
          if (!ok) return;
          full.body.ref = order.ref;
          setBusy(wrap, true);
          return post('panel_order_confirm', full.body).then(function (j) {
            if (O.ref !== order.ref) return;
            say('ok', 'Talep onaylandı: ' + H.fmtTry(j.order && j.order.totals ? j.order.totals.tryGross : full.total) + '. Müşteriye ödeme bilgileri e-postayla gönderildi; ödeme süresi başladı.');
            O.confirmAid = null;
            renderDetail(j.order, j.allowed);
          });
        }).catch(function (e) {
          setBusy(wrap, false);
          var serverErrors = e && e.status === 422 ? H.confirmServerErrors(e.fields) : {};
          if (Object.keys(serverErrors).length) showConfirmErrors({ errors: serverErrors });
          var x = fail(e);
          if (x.refresh && O.ref === order.ref) openOrder(order.ref).then(function () { fail(e); });
        });
      });
      form.appendChild(h('div', { class: 'mgp-actions' }, [confirmBtn]));
      wrap.appendChild(form);

      /* Ret: talep bedelsiz kapanır (ödeme hiç istenmedi). */
      var reason = h('select', { id: 'r-reason', 'aria-describedby': 'r-reason-err' }, [h('option', { value: '', text: 'Neden seçin…' })].concat(H.REJECT_REASONS.map(function (r) { return h('option', { value: r[0], text: r[1] }); })));
      var reasonErr = h('p', { class: 'mgp-err', id: 'r-reason-err', role: 'alert', hidden: true });
      var rPub = field('r-pub', 'Müşteriye gerekçe ("Diğer" için zorunlu; standart cümleye eklenir)', 'textarea', { rows: 2, maxlength: 600 });
      var rNote = field('r-note', 'İç not', 'textarea', { rows: 2, maxlength: 1000 });
      var rej = h('form', { class: 'mgp-form mgp-reject', novalidate: true, autocomplete: 'off', on: { submit: function (e) { e.preventDefault(); } } });
      append(rej, [h('fieldset', { class: 'mgp-fieldset' }, [h('legend', { text: 'Teyit edilemiyorsa: talebi reddet' }),
        h('div', { class: 'mgp-field' }, [h('label', { for: 'r-reason', text: 'Ret nedeni' }), reason, reasonErr]), rPub.wrap, rNote.wrap,
        h('p', { class: 'mgp-muted mgp-hint', text: 'Talep "İptal edildi" olur ve müşteriye bedelsiz kapatıldığını, ödeme alınmadığını bildiren e-posta gider.' }),
        h('div', { class: 'mgp-actions' }, [btn('Reddet (stok yok / fiyat değişti)', 'danger', function () {
          var built = H.buildReject(reason.value, { publicNote: rPub.input.value, note: rNote.input.value });
          reasonErr.hidden = !built.errors.reason; reasonErr.textContent = built.errors.reason || '';
          reason.setAttribute('aria-invalid', built.errors.reason ? 'true' : 'false');
          showErrors([[rPub, built.errors.publicNote]]);
          if (built.errors.reason) { reason.focus(); return; }
          if (!built.ok) return;
          confirmAction({ title: 'Talebi reddet', message: order.ref + ' numaralı talep bedelsiz kapatılacak ve müşteriye e-posta gönderilecek. Bu işlem geri alınamaz. Devam edilsin mi?', confirmText: 'Reddet', danger: true }).then(function (ok) {
            if (!ok) return;
            built.body.ref = order.ref;
            setBusy(wrap, true);
            return post('panel_order_reject', built.body).then(function (j) {
              if (O.ref !== order.ref) return;
              say(j.mailSent === false ? 'warn' : 'ok', j.mailSent === false ? 'Talep reddedildi; ancak müşteri e-postası gönderilemedi. Müşteriyi başka yoldan bilgilendirin.' : 'Talep reddedildi ve müşteriye bildirildi.');
              renderDetail(j.order, j.allowed);
            });
          }).catch(function (e) {
            setBusy(wrap, false);
            var x = fail(e);
            if (x.refresh && O.ref === order.ref) openOrder(order.ref).then(function () { fail(e); });
          });
        })])])]);
      wrap.appendChild(rej);
      return wrap;
    }

    /* Siparişin bağlı olduğu site üyesi (sunucu oturumdan işaretler; müşteri e-postasıyla karıştırılmaz). */
    function memberLine(order) {
      var m = O.memberRef === order.ref ? O.memberInfo : null;
      if (!order.member || !order.member.id) return h('span', { class: 'mgp-muted', text: 'Yok (üye girişi yapılmadan verildi)' });
      if (!m) return h('span', { class: 'mgp-mono', text: H.str(order.member.id) });
      var via = m.via === 'claim' ? 'üye e-postasını doğrulayıp ekledi' : 'üye girişiyle verildi';
      if (!m.exists) return h('span', { class: 'mgp-muted', text: 'Üye hesabı artık yok (' + via + ')' });
      return h('span', null, [H.str(m.name) + ' · ', link(H.str(m.email), H.mailHref(m.email)), h('span', { class: 'mgp-muted', text: ' · ' + via + ', ' + H.fmtDateTime(m.linkedAt) })]);
    }

    function renderDetail(order, allowed) {
      clear(orderDetail);
      if (!order || typeof order !== 'object') { orderDetail.appendChild(h('p', { text: 'Sipariş bulunamadı.' })); return; }
      var overdue = H.isOverdue(order, Date.now());
      var c = order.customer || {}, b = order.billing || {}, s = order.shippingAddress || {}, t = order.totals || {}, r = order.rate || {};
      var title = h('h2', { class: 'mgp-mono', tabindex: '-1', text: H.str(order.ref) });
      var head = h('div', { class: 'mgp-detail-head' }, [
        btn('← Siparişlere dön', 'ghost', function () { win.location.hash = TABS.orders; }),
        title,
        pill(H.statusLabel(order.status), 's-' + H.str(order.status).replace(/[^a-z_]/g, '')),
        overdue ? pill('Ödeme süresi geçti', 'late') : null,
        H.isRespondLate(order, Date.now()) ? pill('Yanıt süresi geçti', 'late') : null,
        h('span', { class: 'mgp-muted', text: 'Oluşturma: ' + H.fmtDateTime(order.createdAt) })
      ]);
      orderDetail.appendChild(head);

      var billingType = b.type === 'kurumsal' ? 'Kurumsal' : b.type === 'bireysel' ? 'Bireysel' : H.str(b.type);
      orderDetail.appendChild(h('div', { class: 'mgp-grid' }, [
        card('Müşteri', dl([['Ad soyad', H.str(c.name)], ['E-posta', link(H.str(c.email), H.mailHref(c.email))], ['Telefon', link(H.str(c.phone), H.telHref(c.phone))],
          ['Üye hesabı', memberLine(order)]])),
        card('Fatura bilgileri', dl([['Fatura türü', billingType], ['Ad soyad', H.str(b.name)], ['T.C. kimlik no', H.str(b.tckn)], ['Şirket unvanı', H.str(b.company)],
          ['Vergi dairesi', H.str(b.taxOffice)], ['Vergi kimlik no', H.str(b.vkn)], ['Adres', H.str(b.address)], ['İlçe / il', cityLine(b)]])),
        card('Teslimat adresi', dl([['Alıcı', H.str(s.name)], ['Telefon', link(H.str(s.phone), H.telHref(s.phone))], ['Adres', H.str(s.address)], ['İlçe / il', cityLine(s)], ['Posta kodu', H.str(s.postalCode)]])),
        card('Müşteri notu', H.str(order.notes) ? h('p', { class: 'mgp-pre', text: H.str(order.notes) }) : h('p', { class: 'mgp-muted', text: 'Not yok.' }))
      ]));

      var pending = order.status === 'teyit_bekliyor';
      var estimate = pending || !order.confirmedAt && !!(t && t.unpriced !== undefined);
      if (pending) {
        orderDetail.appendChild(card('Teyit: stok ve fiyat', confirmCard(order), 'mgp-card--actions mgp-card--confirm'));
      } else {
        orderDetail.appendChild(card('Ürünler', itemsTable(order)));
      }

      var tracking = order.tracking && typeof order.tracking === 'object' ? order.tracking : null;
      orderDetail.appendChild(h('div', { class: 'mgp-grid' }, [
        card(estimate ? 'Talep tutarı (tahmini)' : 'Toplamlar', estimate ? dl([
          ['Tahmini toplam (gösterilen fiyatlarla, KDV dahil)', h('strong', { text: H.fmtTry(t.tryGross) })],
          ['Fiyatı olmayan satır', H.str(t.unpriced || 0)],
          ['Kargo', 'Teyitte girilecek'],
          ['Talep anı kuru', r.usdTry ? H.fmtNum(r.usdTry, 4) + ' ₺/USD · TCMB ' + H.fmtDate(r.date) : '']
        ]) : dl([
          ['Ara toplam (KDV hariç)', H.fmtTry(t.tryNet)], ['KDV', H.fmtTry(t.tryVat)], ['Kargo', H.fmtTry(t.shippingTry)],
          ['Genel toplam (KDV dahil)', h('strong', { text: H.fmtTry(t.tryGross) })],
          ['USD, KDV hariç (yalnızca personel)', h('span', { class: 'mgp-staff', text: H.fmtUsd(t.usdNet) })],
          ['Teyit anı kuru', r.usdTry ? H.fmtNum(r.usdTry, 4) + ' ₺/USD · TCMB ' + H.fmtDate(r.date) : ''],
          ['Teyit', order.confirmedAt ? H.fmtDateTime(order.confirmedAt) + (order.confirmedBy ? ' · ' + H.str(order.confirmedBy) : '') : '']
        ])),
        card('Ödeme (havale / EFT)', dl([
          ['Ödeme referansı (açıklama)', h('strong', { class: 'mgp-mono', text: H.str(order.ref) })],
          ['Beklenen tutar', pending ? 'Teyitten sonra' : H.fmtTry(t.tryGross)],
          ['Yanıt son zamanı', pending ? H.fmtDateTime(order.respondBy) : ''],
          ['Son ödeme zamanı', order.status === 'odeme_bekleniyor' ? H.fmtDateTime(order.payBy) : ''],
          ['Onaylanan belgeler', order.consents && order.consents.preInfo ? 'Talepte ' + H.fmtDateTime(order.consents.preInfo) + (order.consents.docVersion ? ' · sürüm ' + H.str(order.consents.docVersion) : '')
            + (order.confirmedAt ? ' · kesin metinler teyitte gönderildi' : '') : '']
        ])),
        card('Kargo takibi', tracking ? dl([['Firma', H.str(tracking.company)], ['Takip kodu', h('span', { class: 'mgp-mono', text: H.str(tracking.code) })], ['Takip adresi', link(H.str(tracking.url), H.httpsUrl(tracking.url), true)]]) : h('p', { class: 'mgp-muted', text: 'Henüz kargoya verilmedi.' }))
      ]));

      orderDetail.appendChild(card('Geçmiş', historyList(order)));
      if (!pending) orderDetail.appendChild(card('İşlem', actionForm(order, allowed), 'mgp-card--actions'));
      title.focus();
    }

    /* ================================================================== FİYATLAR */
    /* Katalog 50.000 ürüne kadar büyüdüğü için liste tüm ürünleri getirmez: sunucu sorunlu ürünleri (onay bekleyen,
       hatalı, stokta yok; en çok 300) ve arama kutusundaki sözcükle eşleşenleri (ad, marka, model, GTIN ya da kimlik;
       en çok 50) döndürür. Sayaçlar tüm kataloğun sunucu sayımlarıdır. */
    var P = { items: [], rate: null, rateOk: null, lastRunAt: null, lastRunSummary: null, cron: null, server: null, q: '', page: 1, seq: 0, manualId: '' };
    var priceBody = $('[data-mgp-prices-body]'), priceStats = $('[data-mgp-price-stats]'), pricePager = $('[data-mgp-prices-pager]');
    var priceQ = $('#f-q'), priceStatus = $('#f-status'), manualBox = $('[data-mgp-manual]');

    /** panel_prices (?q=) + panel_status (kur geçerliliği ve cron sağlığı için). quiet: tabloyu "Yükleniyor" ile boşaltmadan yenile. */
    function loadPrices(quiet) {
      var seq = ++P.seq;
      P.q = H.clean(priceQ.value, 80);
      if (quiet !== true) clear(priceBody).appendChild(h('tr', null, h('td', { colspan: 7, class: 'mgp-muted', text: 'Yükleniyor…' })));
      var status = api('panel_status').then(function (s) { return s; }, function () { return null; });
      return api('panel_prices', { query: P.q ? '&q=' + enc(P.q) : '' }).then(function (j) {
        return status.then(function (s) {
          if (seq !== P.seq) return;
          P.items = Array.isArray(j.items) ? j.items : [];
          P.rate = j.rate || null;
          P.rateOk = s && s.rate && typeof s.rate.ok === 'boolean' ? s.rate.ok : null;
          P.lastRunAt = j.lastRunAt;
          P.lastRunSummary = j.lastRunSummary;
          P.cron = s && s.cron ? s.cron : null;
          P.server = { counts: j.counts, products: j.products, problems: j.problems, query: H.str(j.query) };
          renderPrices();
        });
      }).catch(function (e) {
        if (seq !== P.seq) return;
        clear(priceBody).appendChild(h('tr', null, h('td', { colspan: 7, class: 'mgp-muted', text: 'Fiyatlar yüklenemedi.' })));
        fail(e);
      });
    }

    function stat(label, value, extra) {
      return h('div', { class: 'mgp-stat' }, [h('b', { text: value }), h('span', { text: label }), extra || null]);
    }
    function renderPriceStats() {
      var now = Date.now();
      var counts = H.priceStats(P.server, P.items);
      var health = H.cronState(P.cron, P.lastRunAt, now);
      var rate = P.rate || {};
      clear(priceStats);
      priceStats.appendChild(h('div', { class: 'mgp-stat mgp-stat--wide' }, [
        h('b', { text: H.fmtDateTime(P.lastRunAt) }), h('span', { text: 'Son otomatik fiyat kontrolü (her 10 dakikada bir)' }),
        h('div', null, [pill(health.label, 'cron-' + health.level), ' ', h('span', { class: 'mgp-muted', text: H.summaryText(P.lastRunSummary) })])
      ]));
      priceStats.appendChild(stat('TCMB USD döviz satış kuru' + (rate.date ? ' · ' + H.fmtDate(rate.date) : ''), rate.usdTry ? H.fmtNum(rate.usdTry, 4) + ' ₺' : '–',
        P.rateOk === false || !rate.usdTry ? h('div', null, pill('Kur güncel değil: sipariş alınamaz', 'late')) : null));
      [['total', 'Toplam ürün'], ['ok', 'Güncel fiyatlı'], ['orderable', 'Siparişe açık'], ['held', 'Onay bekleyen'], ['error', 'Hatalı'], ['unavailable', 'Stokta yok'],
        ['stale', 'Fiyat teyidi eski'], ['noSource', 'Kaynağı olmayan']].forEach(function (k) {
        if (counts[k[0]] !== null && counts[k[0]] !== undefined) priceStats.appendChild(stat(k[1], String(counts[k[0]])));
      });
    }
    /** Arama sözcüğü sunucuya gönderildiyse sunucunun eşleştirdiği satırlar (match) da gösterilir (marka/model eşleşmesi). */
    function priceVisible(it) {
      var f = { q: priceQ.value, status: priceStatus.value };
      if (it.match === true && P.server && P.server.query && H.fold(P.server.query) === H.fold(H.clean(priceQ.value, 80))) f.q = '';
      return H.priceMatches(it, f);
    }
    /** Zamanı gelen birkaç ürünü (en çok 5) hemen kontrol ettirir; cron'u beklemeden kuyruğu ilerletmek için. */
    function checkBatch(holder) {
      setBusy(holder, true);
      return post('panel_check_now', { batch: true }).then(function (j) {
        var s = j && j.summary && typeof j.summary === 'object' ? j.summary : null;
        var res = s && s.rateError && Number(s.checked) === 0 ? { kind: 'warn', text: 'Kontrol yapılamadı: TCMB kuru alınamadı (' + H.str(s.rateError) + ').' }
          : { kind: 'ok', text: s && Number(s.checked) > 0 ? 'Sıradaki ürünler kontrol edildi (' + H.summaryText(s) + ').' : 'Şu anda kontrol zamanı gelmiş ürün yok.' };
        return loadPrices(true).then(function () { say(res.kind, res.text); });
      }).catch(function (e) { fail(e); }).then(function () { setBusy(holder, false); });
    }

    function priceRow(it) {
      var now = Date.now();
      var held = H.heldInfo(it);
      var stale = H.isStaleCheck(it.checkedAt, now);
      var tr = h('tr', { class: 'mgp-tr' + (held ? ' mgp-tr--held' : it.status === 'error' ? ' mgp-tr--error' : '') });
      tr.appendChild(h('td', { 'data-label': 'Ürün' }, [h('strong', { text: H.str(it.name) }), h('div', { class: 'mgp-muted' }, [h('span', { class: 'mgp-mono', text: H.str(it.id) }), ' · ' + H.str(it.category)])]));
      var st = h('td', { 'data-label': 'Durum' }, [pill(H.PRICE_STATUS[it.status] || H.str(it.status) || 'Kontrol edilmedi', 'p-' + (H.str(it.status).replace(/[^a-z]/g, '') || 'none'))]);
      st.appendChild(h('div', { class: 'mgp-muted', text: it.orderable ? 'Siparişe açık' : (H.PRICE_REASONS[it.reason] || H.str(it.reason)) }));
      if (H.str(it.note)) st.appendChild(h('div', { class: 'mgp-muted mgp-note-line', text: H.str(it.note) }));
      tr.appendChild(st);
      var cost = h('td', { 'data-label': 'Alış (KDV dahil)', class: 'mgp-num mgp-staff' });
      if (held) {
        cost.appendChild(h('div', { class: 'mgp-held' }, [
          h('div', { text: 'Önceki: ' + (held.prev !== null ? H.fmtTry(held.prev) : '–') }),
          h('div', null, [h('strong', { text: 'Yeni: ' + (held.next !== null ? H.fmtTry(held.next) : '–') }), ' ', pill(H.fmtPct(held.pct), 'late')])
        ]));
      } else cost.appendChild(doc.createTextNode(H.fmtTry(it.costTry)));
      tr.appendChild(cost);
      var margin = Number(it.margin);
      tr.appendChild(h('td', { 'data-label': 'Satış (KDV dahil)', class: 'mgp-num' }, [H.fmtTry(it.tryGross), h('div', { class: 'mgp-muted mgp-staff',
        text: (it.usdNet !== null && it.usdNet !== undefined ? H.fmtUsd(it.usdNet) + ' (KDV hariç)' : '') + (it.margin !== null && it.margin !== undefined && isFinite(margin) ? ' · marj %' + H.fmtNum(margin * 100, 0) : '') })]));
      tr.appendChild(h('td', { 'data-label': 'Doğrulama', class: stale && it.checkedAt ? 'mgp-late' : null }, [
        H.fmtDateTime(it.checkedAt), h('div', { class: 'mgp-muted', text: it.checkedAt ? H.ageText(it.checkedAt, now) : 'hiç doğrulanmadı' }),
        it.lastAttemptAt ? h('div', { class: 'mgp-muted', text: 'Son deneme: ' + H.fmtDateTime(it.lastAttemptAt) }) : null
      ]));
      var src = h('td', { 'data-label': 'Kaynak (personel)' });
      (Array.isArray(it.sources) ? it.sources : []).forEach(function (s) {
        var url = H.httpsUrl(s.url);
        var disc = Number(s.discount);
        src.appendChild(h('div', { class: 'mgp-src' }, [url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: H.str(s.supplier) || url }) : H.str(s.supplier) || '–',
          disc > 0 ? ' · bayi indirimi %' + H.fmtNum(disc * 100, 0) : '']));
      });
      if (!src.firstChild) src.appendChild(doc.createTextNode('–'));
      tr.appendChild(src);
      var acts = h('td', { 'data-label': 'İşlem', class: 'mgp-cell-actions' });
      if (held) {
        var noteIn = h('input', { type: 'text', class: 'mgp-inline-note', maxlength: 200, placeholder: 'Not (isteğe bağlı)', 'aria-label': H.str(it.name) + ' için karar notu' });
        acts.appendChild(noteIn);
        acts.appendChild(btn('Onayla', 'primary', function () { decide(it, 'approve', noteIn.value, acts); }));
        acts.appendChild(btn('Reddet', 'danger', function () {
          confirmAction({ title: 'Fiyat reddedilsin mi?', message: H.str(it.name) + ' için tedarikçinin yeni fiyatı reddedilecek; ürün yeniden doğrulanana kadar siparişe kapalı kalır.', confirmText: 'Reddet', danger: true }).then(function (ok) { if (ok) decide(it, 'reject', noteIn.value, acts); });
        }));
      }
      acts.appendChild(btn('Şimdi kontrol et', 'ghost', function () { checkNow(it, acts); }));
      acts.appendChild(btn('Elle fiyat gir', 'ghost', function () { openManual(it); }));
      tr.appendChild(acts);
      return tr;
    }

    function renderPrices() {
      renderPriceStats();
      var filtered = H.sortPrices(P.items).filter(priceVisible);
      var pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE_PRICES));
      P.page = Math.min(Math.max(1, P.page), pages);
      clear(priceBody);
      if (!filtered.length) {
        priceBody.appendChild(h('tr', null, h('td', { colspan: 7, class: 'mgp-muted', text: P.items.length ? 'Bu süzgece uyan ürün yok.'
          : P.q ? 'Aramanızla eşleşen ürün yok.' : 'Sorunlu ürün yok. Bir ürünü görmek için adını, model kodunu ya da kimliğini arayın.' })));
      }
      filtered.slice((P.page - 1) * PAGE_SIZE_PRICES, P.page * PAGE_SIZE_PRICES).forEach(function (it) { priceBody.appendChild(priceRow(it)); });
      clear(pricePager);
      pricePager.appendChild(btn('‹ Önceki', 'ghost', function () { P.page--; renderPrices(); }, { disabled: P.page <= 1 }));
      pricePager.appendChild(h('span', { class: 'mgp-muted', text: 'Sayfa ' + P.page + ' / ' + pages + ' · ' + filtered.length + ' ürün' }));
      pricePager.appendChild(btn('Sonraki ›', 'ghost', function () { P.page++; renderPrices(); }, { disabled: P.page >= pages }));
    }

    /* Sunucu {item} olarak ham fiyat kaydı döndürür (ad/kategori/kaynak yok): satırı yamamak yerine listeyi sessizce yeniler. */
    function priceCall(action, body, holder, okText) {
      setBusy(holder, true);
      return post(action, body).then(function (j) {
        var res = typeof okText === 'function' ? okText(j) : { kind: 'ok', text: okText };
        return loadPrices(true).then(function () { say(res.kind, res.text); return j; });
      }).catch(function (e) {
        setBusy(holder, false);
        var x = fail(e);
        if (x.refresh) loadPrices(true).then(function () { fail(e); });
      });
    }
    function decide(it, decision, note, holder) {
      var built = H.buildDecision(it.id, decision, note);
      if (!built.ok) return;
      return priceCall('panel_price_decide', built.body, holder, decision === 'approve' ? 'Yeni fiyat onaylandı: ' + H.str(it.name) : 'Yeni fiyat reddedildi: ' + H.str(it.name));
    }
    /* Canlı kontrol sonucu: kur alınamadıysa ya da hiçbir kaynak denenemediyse başarı gibi gösterilmez. */
    function checkNow(it, holder) {
      return priceCall('panel_check_now', { id: it.id }, holder, function (j) {
        var s = j && j.summary && typeof j.summary === 'object' ? j.summary : null;
        var name = H.str(it.name);
        if (s && Number(s.checked) === 0) {
          return { kind: 'warn', text: 'Kontrol yapılamadı: ' + name + (s.rateError ? ' (TCMB kuru alınamadı: ' + H.str(s.rateError) + ').' : ' (kaynak tanımlı değil ya da kur güncel değil).') };
        }
        if (s && Number(s.checked) > 0 && Number(s.ok) === 0) {
          var why = Number(s.held) ? 'tedarikçi fiyatı çok değişti, onayınız bekleniyor' : Number(s.unavailable) ? 'tedarikçide stok yok' : 'tedarikçi fiyatı okunamadı';
          return { kind: 'warn', text: name + ': ' + why + ' (' + H.summaryText(s) + ').' };
        }
        return { kind: 'ok', text: 'Fiyat yeniden kontrol edildi: ' + name + (s ? ' (' + H.summaryText(s) + ')' : '') };
      });
    }

    /* ---------------------------------------------------------- elle fiyat girişi */
    var manualUi = null;
    function openManual(it) {
      P.manualId = it.id;
      clear(manualBox);
      var costF = field('m-cost', 'KDV dahil TL alış fiyatı', 'input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'örn. 1.234,50' }, 'Tedarikçiden aldığınız KDV dahil birim fiyat.');
      var availSel = h('select', { id: 'm-avail' }, [h('option', { value: 'true', text: 'Stokta var' }), h('option', { value: 'false', text: 'Stokta yok' })]);
      var availWrap = h('div', { class: 'mgp-field' }, [h('label', { for: 'm-avail', text: 'Stok durumu' }), availSel]);
      var noteF = field('m-note', 'Not (fiyatın kaynağı, kimden teyit alındı)', 'input', { type: 'text', maxlength: 200, autocomplete: 'off' });
      var form = h('form', { class: 'mgp-form', novalidate: true, on: { submit: function (e) { e.preventDefault(); } } }, [
        h('h3', { text: 'Elle fiyat gir' }),
        h('p', { class: 'mgp-muted', text: H.str(it.name) + ' · ' + H.str(it.id) }),
        h('p', { class: 'mgp-muted', text: 'Elle giriş ±%25 koruma kontrolüne takılmaz ve fiyatı 48 saat boyunca doğrulanmış sayar; kayıt sizin adınızla tutulur. Fiyatı mutlaka tedarikçiden teyit edin.' }),
        h('div', { class: 'mgp-row' }, [costF.wrap, availWrap]), noteF.wrap
      ]);
      form.appendChild(h('div', { class: 'mgp-actions' }, [
        btn('Kaydet', 'primary', function () {
          var built = H.buildManualPrice(it.id, { costTry: costF.input.value, available: availSel.value, note: noteF.input.value });
          showErrors([[costF, built.errors.costTry], [noteF, built.errors.note]]);
          if (!built.ok) return;
          priceCall('panel_price_decide', built.body, form, 'Fiyat elle kaydedildi: ' + H.str(it.name)).then(function () { if (P.manualId === it.id) closeManual(); });
        }),
        btn('Vazgeç', 'ghost', closeManual)
      ]));
      manualBox.appendChild(form);
      manualBox.hidden = false;
      costF.input.focus();
      if (manualBox.scrollIntoView) manualBox.scrollIntoView({ block: 'nearest' });
    }
    function closeManual() { P.manualId = ''; manualBox.hidden = true; clear(manualBox); }

    $('[data-mgp-prices-reload]').addEventListener('click', function () { loadPrices(); });
    var batchBtn = $('[data-mgp-prices-batch]');
    batchBtn.addEventListener('click', function () { checkBatch(batchBtn.parentNode); });
    [priceQ, priceStatus].forEach(function (el) { el.addEventListener('input', function () { P.page = 1; renderPrices(); }); el.addEventListener('change', function () { P.page = 1; renderPrices(); }); });
    /* Arama sözcüğü sunucuya da gönderilir (yazmayı bitirince): listede olmayan ürünler de bulunur. */
    var searchTimer = null;
    priceQ.addEventListener('input', function () {
      win.clearTimeout(searchTimer);
      searchTimer = win.setTimeout(function () { if (H.clean(priceQ.value, 80) !== P.q) loadPrices(true); }, 450);
    });

    /* ================================================================== DURUM */
    var statusBox = $('[data-mgp-status]');
    function loadStatus() {
      clear(statusBox).appendChild(h('p', { class: 'mgp-muted', role: 'status', text: 'Yükleniyor…' }));
      return api('panel_status').then(renderStatus).catch(function (e) {
        clear(statusBox).appendChild(h('p', { class: 'mgp-muted', text: 'Durum bilgisi yüklenemedi.' }));
        fail(e);
      });
    }
    function renderStatus(s) {
      clear(statusBox);
      var now = Date.now();
      var missing = Array.isArray(s.firmaMissing) ? s.firmaMissing : [];
      var rate = s.rate || {}, cron = s.cron || {}, orders = s.orders || {}, counts = s.counts && typeof s.counts === 'object' ? s.counts : {};
      var health = H.cronState(cron, null, now);
      var shopNote = s.open
        ? 'Müşteriler sepete ekleyip sipariş verebilir.'
        : s.configOpen === true && missing.length
          ? 'Kaynak dosyasında "open": true ama satıcı bilgileri eksik olduğu için mağaza kapalı kalıyor.'
          : 'Fiyatlar görünür; sepete ekleme yerine "Siparişe yakında açılacak" ve teklif bağlantısı çıkar. Açılış sahibin kararıdır: kaynak dosyasında "open": true yapıp php tools/magaza-admin.php import ile yükleyin.';

      statusBox.appendChild(h('div', { class: 'mgp-grid' }, [
        card('Mağaza', h('div', null, [
          h('p', null, [pill(s.open ? 'Siparişe açık' : 'Siparişe kapalı', s.open ? 'p-ok' : 'p-held')]),
          h('p', { class: 'mgp-muted', text: shopNote }),
          s.products !== undefined ? h('p', { class: 'mgp-muted', text: 'Katalogdaki ürün sayısı: ' + H.str(s.products) }) : null
        ])),
        card('Satıcı bilgileri', missing.length
          ? h('div', null, [h('p', { class: 'mgp-late', text: 'Eksik zorunlu alanlar var; tamamlanana kadar mağaza açılmaz:' }), h('ul', null, missing.map(function (k) { return h('li', { text: H.FIRMA_LABELS[k] || H.str(k) }); })),
            h('p', { class: 'mgp-muted', text: 'api/lib/magaza/firma.json dosyasını tamamlayıp yayına alın.' })])
          : h('p', null, [pill('Eksik alan yok', 'p-ok')])),
        card('Döviz kuru (TCMB)', s.rate
          ? dl([['USD döviz satış kuru', rate.usdTry ? H.fmtNum(rate.usdTry, 4) + ' ₺' : '–'], ['TCMB yayın tarihi', H.fmtDate(rate.date)],
            ['Son okuma', H.fmtDateTime(rate.fetchedAt) + (rate.fetchedAt ? ' (' + H.ageText(rate.fetchedAt, now) + ')' : '')],
            ['Durum', pill(rate.ok ? 'Kullanılabilir' : 'Güncel değil: sipariş alınamaz', rate.ok ? 'p-ok' : 'late')]])
          : h('p', null, [pill('Kur yok: sipariş alınamaz', 'late')])),
        card('Fiyat kontrolü (cron)', dl([
          ['Son çalışma', H.fmtDateTime(cron.lastRunAt) + (cron.lastRunAt ? ' (' + H.ageText(cron.lastRunAt, now) + ')' : '')],
          ['Durum', pill(health.label, 'cron-' + health.level)], ['Son çalışma özeti', H.summaryText(cron.summary)]
        ])),
        card('Siparişler', dl([['Teyit bekleyen talep', h('strong', { class: Number(orders.confirmLate) > 0 ? 'mgp-late' : null, text: H.str(orders.awaitingConfirm || 0) + (Number(orders.confirmLate) > 0 ? ' (' + orders.confirmLate + ' yanıt süresi geçti)' : '') })], ['Ödeme bekleyen', H.str(orders.awaitingPayment)], ['Ödeme süresi geçen', h('strong', { class: Number(orders.overdue) > 0 ? 'mgp-late' : null, text: H.str(orders.overdue) })]])),
        card('Ürün fiyatları (kaynağı olan ürünler)', Object.keys(counts).length ? dl(Object.keys(counts).map(function (k) { return [H.COUNT_LABELS[k] || k, H.str(counts[k])]; })) : h('p', { class: 'mgp-muted', text: 'Veri yok.' }))
      ]));

      var cmdText = h('code', { class: 'mgp-mono', text: H.CRON_COMMAND });
      var copied = h('span', { class: 'mgp-muted', role: 'status' });
      statusBox.appendChild(card('Zamanlanmış görev (cPanel → Cron Jobs)', h('div', null, [
        h('p', { class: 'mgp-muted', text: 'Fiyat ve kur kontrolü sunucuda her 10 dakikada bir çalışmalıdır. Depo bu görevi kurmaz; sunucuda bir kez ekleyin:' }),
        h('pre', { class: 'mgp-code', tabindex: '0' }, cmdText),
        h('div', { class: 'mgp-actions' }, [btn('Komutu kopyala', 'ghost', function () {
          copyText(H.CRON_COMMAND).then(function (ok) { copied.textContent = ok ? 'Kopyalandı.' : 'Kopyalanamadı; metni elle seçin.'; });
        }), copied])
      ])));
    }
    $('[data-mgp-status-reload]').addEventListener('click', function () { loadStatus(); });

    /* ================================================================== CSV DIŞA AKTARMA */
    var exportForm = $('[data-mgp-export]'), exFrom = $('#x-from'), exTo = $('#x-to'), exErr = $('[data-mgp-export-err]');
    function saveBlob(blob, name) {
      var url = win.URL.createObjectURL(blob);
      var a = h('a', { href: url, download: name, class: 'mgp-sr' });
      doc.body.appendChild(a);
      a.click();
      win.setTimeout(function () { doc.body.removeChild(a); win.URL.revokeObjectURL(url); }, 1500);
    }
    $$('[data-mgp-range]', exportForm).forEach(function (b) {
      b.addEventListener('click', function () {
        var r = H.quickRange(b.getAttribute('data-mgp-range'), H.todayIso());
        exFrom.value = r.from;
        exTo.value = r.to;
      });
    });
    exportForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = H.validateExportRange(exFrom.value, exTo.value, H.todayIso());
      exErr.hidden = v.ok;
      exErr.textContent = v.ok ? '' : [v.errors.from, v.errors.to, v.errors.range].filter(Boolean).join(' ');
      exFrom.setAttribute('aria-invalid', v.errors.from || v.errors.range ? 'true' : 'false');
      exTo.setAttribute('aria-invalid', v.errors.to || v.errors.range ? 'true' : 'false');
      if (!v.ok) return;
      var body = {};
      if (v.from) body.from = v.from;
      if (v.to) body.to = v.to;
      setBusy(exportForm, true);
      post('panel_export', body, true).then(function (res) {
        setBusy(exportForm, false);
        saveBlob(res.blob, 'magaza-siparisler-' + (v.from || 'baslangic') + '_' + (v.to || H.todayIso()) + '.csv');
        say('ok', 'CSV dosyası hazırlandı ve indirildi. Dosya kişisel veri içerir; yalnızca muhasebe amacıyla kullanın.');
      }).catch(function (err) {
        setBusy(exportForm, false);
        fail(err);
      });
    });

    /* ================================================================== başlat */
    function renderGate(title, text, linkText, href) {
      clear(gate).appendChild(h('div', { class: 'mgp-gate-box' }, [
        h('h2', { text: title }), h('p', { text: text }), h('p', null, h('a', { class: 'mgp-btn mgp-btn--primary', href: href, text: linkText }))
      ]));
    }

    api('panel_me').then(function (me) {
      csrf = typeof me.csrf === 'string' ? me.csrf : csrf;
      if (!me.user) { renderGate('Giriş gerekli', 'Mağaza paneline girmek için üye hesabınızla oturum açın.', 'Giriş yap', LOGIN_URL); return; }
      if (!me.panel) { renderGate('Bu panel için yetkiniz yok', 'Hesabınızda mağaza paneli yetkisi tanımlı değil. Yetki yalnızca site yönetimi tarafından sunucuda verilir.', 'Hesabıma dön', 'panel.html'); return; }
      gate.hidden = true;
      app.hidden = false;
      win.addEventListener('hashchange', route);
      route();
    }).catch(function (e) {
      if (e && e.status === 401) { renderGate('Giriş gerekli', 'Mağaza paneline girmek için üye hesabınızla oturum açın.', 'Giriş yap', LOGIN_URL); return; }
      clear(gate).appendChild(h('p', { class: 'mgp-muted', role: 'alert', text: H.explainError({ status: e && e.status, message: e && e.message }).text }));
    });
  }
}(typeof window !== 'undefined' ? window : globalThis));

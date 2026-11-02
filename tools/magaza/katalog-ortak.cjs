'use strict';
// Mağaza kataloğu v2 ortak çekirdeği (api/MAGAZA.md "Herkese açık katalog"): parçalı dizini okur, kurallara göre doğrular
// ve tüm dizin dosyalarını belirlenimli olarak üretir. katalog-derle.cjs (yazıcı) ve katalog-dogrula.cjs (doğrulayıcı)
// aynı fonksiyonları kullanır; PHP tarafı (api/lib/magaza.php) bu dosyaların biçimini okur. Bağımlılık yok.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_DIR = path.join(ROOT, 'api/lib/magaza/katalog');
const UNITS = new Set(['adet', 'metre', 'paket', 'takım', 'kutu', 'rulo', 'kg', 'set']);
const PRODUCT_KEYS = ['id', 'slug', 'name', 'brand', 'mpn', 'gtin', 'category', 'summary', 'description', 'specs', 'images', 'documents',
  'unit', 'vat', 'shipping', 'maxQty', 'minQty', 'step', 'packQty', 'listUsd', 'listCheckedAt', 'related'];
/** Liste kartı; minQty/step/packQty/attr yalnızca varsa yazılır, sortTry her kartta (listUsd ile aynı; bkz. card). */
const CARD_KEYS = ['id', 'slug', 'name', 'brand', 'mpn', 'thumb', 'listUsd', 'listCheckedAt', 'shipping', 'unit', 'vat', 'maxQty',
  'minQty', 'step', 'packQty', 'sortTry', 'attr'];
const CATEGORY_KEYS = ['id', 'name', 'title', 'intro', 'order', 'parent', 'filters'];
/** Kart attr anahtarları (kategori filters[].key de bunlardan biri olmalı); extractAttr üretir. */
const ATTR_KEYS = ['poles', 'amps', 'curve', 'ka', 'section', 'phase', 'kw'];
const FILTER_KEYS = ['key', 'label', 'type', 'unit'];
const FILTER_TYPES = new Set(['enum', 'number']);
const ID_RE = /^vgm-(?:\d{4}|[1-9]\d{5})$/;
/** Yeni eklenen ürünün kimliği: 6 hane, 100000 ve üstü (urun/1000.json ve sonrası; 4 haneliler 0000-0099 parçalarında). */
const NEW_ID_RE = /^vgm-[1-9]\d{5}$/;
const PUBLIC_IMG = /^\/public\/magaza\/([a-z0-9-]{3,90})\.([0-9a-f]{8})(-400)?\.webp$/;
const MEDIA_IMG = /^\/magaza-gorsel\/([0-9a-f]{2})\/([a-z0-9-]{3,90})\.([0-9a-f]{8})(-t)?\.webp$/;
/** Medya deposuna yüklenebilen göreli yol (tools/magaza-admin.php gorsel-yukle ile aynı kural). */
const MEDIA_REL = /^[0-9a-f]{2}\/[a-z0-9-]{3,90}\.[0-9a-f]{8}(-t)?\.webp$/;

const FOLD = { 'İ': 'i', 'I': 'i', 'ı': 'i', 'Ç': 'c', 'ç': 'c', 'Ğ': 'g', 'ğ': 'g', 'Ö': 'o', 'ö': 'o', 'Ş': 's', 'ş': 's', 'Ü': 'u', 'ü': 'u',
  'Â': 'a', 'â': 'a', 'Î': 'i', 'î': 'i', 'Û': 'u', 'û': 'u' };
/** PHP vgmr_fold ile birebir: Türkçe harfler ASCII'ye, yalnızca A-Z küçük harfe (strtolower gibi). */
function fold(s) {
  return String(s == null ? '' : s).replace(/[İIıÇçĞğÖöŞşÜüÂâÎîÛû]/g, c => FOLD[c]).replace(/[A-Z]/g, c => c.toLowerCase());
}
function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

/* ------------------------------------------------------------------ arama dizini ve öznitelik çıkarımı */

/** Model kodunun arama biçimleri: katlanmış hali, tire/nokta/boşluk/eğik çizgi soyulmuş hali (5SV5344-6 -> 5sv53446). */
function mpnVariants(mpn) {
  const f = fold(mpn).trim();
  if (!f) return [];
  const out = [f];
  const dotted = f.replace(/(\d),(\d)/g, '$1.$2');
  if (dotted !== f) out.push(dotted);
  const bare = f.replace(/[-._/\s]+/g, '');
  if (bare && bare !== f) out.push(bare);
  const spaced = f.replace(/[-._/]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (spaced !== f && spaced !== bare) out.push(spaced);
  return [...new Set(out)];
}

/** Katlanmış değerdeki ondalık virgülü noktaya çevirir, birim boşluklarını sıkıştırır (3 x 2,5 mm² -> 3x2.5mm²). */
function numText(v) { return fold(v).replace(/(\d),(\d)/g, '$1.$2'); }
function num(s) { const n = parseFloat(String(s).replace(',', '.')); return Number.isFinite(n) ? n : null; }

const SPEC_POLES = new Set(['kutup sayisi', 'kutup yapisi', 'kutup', 'yapi']);
const SPEC_AMPS = new Set(['anma akimi', 'anma akimi (in)', 'nominal akim', 'maksimum akim', 'anma akimi in']);
const SPEC_CURVE = new Set(['acma egrisi', 'koruma karakteristigi', 'egri', 'karakteristik']);
const SPEC_KA = new Set(['kesme kapasitesi', 'kisa devre kesme kapasitesi', 'kesme kapasitesi (415 v ac)', 'kesme kapasitesi (icu)', 'icu']);
const SPEC_SECTION = new Set(['kesit', 'damar sayisi ve kesit', 'kablo kesiti', 'iletken kesiti']);
const SPEC_PHASE = new Set(['faz', 'faz sayisi', 'faz yapisi', 'besleme', 'sebeke baglantisi']);
const SPEC_KW = new Set(['anma gucu', 'nominal ac guc', 'nominal ac cikis gucu', 'nominal guc', 'guc', 'cikis gucu', 'kurulu guc']);

/**
 * Teknik özelliklerden belirlenimli normalize öznitelikler (yalnızca çözülebilenler yazılır):
 * poles "1P"|"1P+N"|"2P"|"3P"|"3P+N"|"4P", amps sayı (A), curve "B"|"C"|"D"|"K"|"Z", ka sayı (kA), section "3x2.5" (mm²),
 * phase 1|3, kw sayı (kW). İlk eşleşen spec kazanır (spec sırası); ad kullanılmaz.
 */
function extractAttr(specs) {
  const a = {};
  for (const s of Array.isArray(specs) ? specs : []) {
    if (!Array.isArray(s) || typeof s[0] !== 'string' || typeof s[1] !== 'string') continue;
    const k = fold(s[0]).trim(), v = numText(s[1]).trim();
    let m;
    if (a.poles === undefined && SPEC_POLES.has(k)) {
      if ((m = /^([1-4])\s*p\s*\+\s*n\b/.exec(v)) || /^(3)\s*faz\s*\+\s*n/.exec(v)) a.poles = (m ? m[1] : '3') + 'P+N';
      else if ((m = /^([1-4])\s*(?:p\b|kutup)/.exec(v)) || (m = /^([1-4])$/.exec(v))) a.poles = m[1] + 'P';
    } else if (a.amps === undefined && SPEC_AMPS.has(k)) {
      if ((m = /^(\d+(?:\.\d+)?)\s*a\b/.exec(v)) && !/^(\d+(?:\.\d+)?)\s*ah\b/.test(v)) a.amps = num(m[1]);
    } else if (a.curve === undefined && SPEC_CURVE.has(k)) {
      if ((m = /^([bcdkz])(?:\s+(?:egrisi|tipi|egri|tip))?$/.exec(v)) || (m = /^([bcdkz])\s*(?:egrisi|tipi)\b/.exec(v))) a.curve = m[1].toUpperCase();
    } else if (a.ka === undefined && SPEC_KA.has(k)) {
      if ((m = /^(\d+(?:\.\d+)?)\s*ka\b/.exec(v))) a.ka = num(m[1]);
    } else if (a.section === undefined && SPEC_SECTION.has(k)) {
      if ((m = /^(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*mm/.exec(v))) a.section = m[1] + 'x' + String(num(m[2]));
      else if ((m = /^(\d+(?:\.\d+)?)\s*mm/.exec(v))) a.section = '1x' + String(num(m[1]));
    } else if (a.phase === undefined && SPEC_PHASE.has(k)) {
      if (/^(?:3|uc)\b|trifaze|uc faz/.test(v)) a.phase = 3;
      else if (/^(?:1|tek|bir)\b|monofaze|tek faz/.test(v)) a.phase = 1;
    } else if (a.kw === undefined && SPEC_KW.has(k)) {
      if ((m = /^(\d+(?:\.\d+)?)\s*kw\b/.exec(v))) a.kw = num(m[1]);   // yalnızca kW (W değerleri: panel/armatür, süzgeç dışı)
    }
  }
  const out = {};
  for (const k of ATTR_KEYS) if (a[k] !== undefined && a[k] !== null) out[k] = a[k];
  return out;
}

/** Öznitelikten sentetik arama tokenleri: 1p, 3p, 16a, c16, 6ka, 3x2.5, trifaze/monofaze, 10kw. */
function attrTokens(attr) {
  const t = [];
  if (attr.poles) { const l = attr.poles.toLowerCase(); t.push(l); if (l.includes('+')) t.push(l.replace('+', '')); }
  if (attr.amps !== undefined) t.push(attr.amps + 'a');
  if (attr.curve && attr.amps !== undefined) t.push(attr.curve.toLowerCase() + attr.amps);
  if (attr.ka !== undefined) t.push(attr.ka + 'ka');
  if (attr.section) t.push(attr.section, attr.section.replace('.', ','));
  if (attr.phase === 3) t.push('trifaze', '3 faz', 'uc fazli');
  if (attr.phase === 1) t.push('monofaze', '1 faz', 'tek fazli');
  if (attr.kw !== undefined) t.push(attr.kw + 'kw', attr.kw + ' kw');
  return [...new Set(t)];
}

/** Dizin anında uygulanan küçük eş anlamlı haritası (katlanmış metin): bir grubun herhangi bir terimi geçiyorsa grubun tümü eklenir. */
const SYNONYMS = [
  ['otomatik sigorta', 'otomat', 'sigorta', 'mcb', 'minyatur devre kesici'],
  ['kacak akim', 'kacak akim rolesi', 'rccb', 'fi', 'kacak akim koruma'],
  ['parafudr', 'spd', 'asiri gerilim koruma', 'surge'],
  ['kompakt salter', 'mccb', 'salter', 'kompakt devre kesici'],
  ['inverter', 'evirici', 'invertor'],
  ['aku', 'batarya', 'pil'],
  ['sarj cihazi', 'sarj istasyonu', 'wallbox', 'ev sarj'],
  ['gunes paneli', 'solar panel', 'pv panel', 'fotovoltaik'],
  ['kontaktor', 'kontaktoru'],
  ['termik role', 'asiri yuk rolesi', 'motor koruma'],
  ['kondansator', 'kapasitor'],
];
/** Yalnızca sözcük sınırında arama (katlanmış metinde). */
function hasPhrase(text, phrase) {
  let i = -1;
  while ((i = text.indexOf(phrase, i + 1)) !== -1) {
    const before = i === 0 ? ' ' : text[i - 1], after = i + phrase.length >= text.length ? ' ' : text[i + phrase.length];
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
  }
  return false;
}
function synonymsFor(text) {
  const out = [];
  for (const group of SYNONYMS) if (group.some(g => hasPhrase(text, g))) for (const g of group) if (!hasPhrase(text, g)) out.push(g);
  return out;
}

const SPEC_INDEXED = new Set([...SPEC_POLES, ...SPEC_AMPS, ...SPEC_CURVE, ...SPEC_KA, ...SPEC_SECTION, ...SPEC_PHASE, ...SPEC_KW,
  'seri', 'kablo tipi', 'tip', 'kacak akim tipi', 'parafudr tipi', 'koruma sinifi', 'model', 'model kodu', 'urun kodu', 'siparis kodu', 'genislik']);

/**
 * arama.json satırı: [id, metin, kategori, anahtarlar, adUzunluğu]. metin = katlanmış ad + marka + model (+GTIN) + model
 * biçimleri + kategori yolu + seri/spec değerleri + sentetik tokenler + eş anlamlılar (boşlukla ayrılmış, tekrar yok);
 * anahtarlar = tam eşleşme anahtarları (model biçimleri + GTIN, boşlukla ayrılmış); adUzunluğu = metnin ad kısmının
 * uzunluğu (PHP: substr($row[1], 0, $row[4]) = katlanmış ad; puanlama için).
 */
function searchRow(p, catPath, attr) {
  const name = fold(p.name).replace(/\s+/g, ' ').trim();
  const parts = [name, fold(p.brand), ...mpnVariants(p.mpn), p.gtin || '', ...catPath.map(fold)];
  for (const s of Array.isArray(p.specs) ? p.specs : []) {
    if (Array.isArray(s) && typeof s[0] === 'string' && SPEC_INDEXED.has(fold(s[0]).trim())) parts.push(numText(s[1]), fold(s[1]));
  }
  parts.push(...attrTokens(attr || {}));
  // parça zaten metinde sözcük sınırında geçiyorsa (ad içindeki marka/model, "16a" gibi) yeniden yazılmaz
  let joined = '';
  for (const piece of parts) {
    const t = String(piece).replace(/\s+/g, ' ').trim();
    if (!t || hasPhrase(joined, t)) continue;
    joined += (joined ? ' ' : '') + t;
  }
  const syn = synonymsFor(joined);
  if (syn.length) joined += ' ' + syn.join(' ');
  const keys = [...new Set([...mpnVariants(p.mpn), ...(p.gtin ? [p.gtin] : [])])].join(' ');
  return [p.id, joined, p.category, keys, name.length];
}
function idNumber(id) { return parseInt(String(id).slice(4), 10); }
/** urun/<shard>.json: kimliğin sayısal kısmı / 100, 4 haneli (vgm-0101 -> 0001, vgm-123456 -> 1234). */
function shardOf(id) { return String(Math.floor(idNumber(id) / 100)).padStart(4, '0'); }
function slugShard(slug) { return crypto.createHash('md5').update(String(slug)).digest('hex').slice(0, 2); }
function gtinOk(g) {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(g)) return false;
  const d = g.split('').map(Number);
  const check = d.pop();
  const sum = d.reverse().reduce((s, v, i) => s + v * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** WebP boyutu (yalnızca ilk 64 bayt okunur); WebP değilse null. */
function webpSize(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(64);
    const n = fs.readSync(fd, b, 0, 64, 0);
    if (n < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (chunk === 'VP8L') { const bits = b.readUInt32LE(21); return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)]; }
    return null;
  } catch (_) {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** VG_MAGAZA_MEDIA ya da varsayılan yerel medya klasörü (tools/preview.cjs ile aynı kural). */
function mediaDir(env = process.env) {
  if (env.VG_MAGAZA_MEDIA) return env.VG_MAGAZA_MEDIA;
  if (process.platform === 'win32' && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'VoltGuard', 'magaza-gorsel');
  return path.join(require('node:os').homedir(), '.voltguard', 'magaza-gorsel');
}

/* ------------------------------------------------------------------ kanonik biçim */

/** Yalnızca izinli anahtarlar, sabit sırada; bilinmeyen alan (tedarikçi adresi, maliyet...) herkese açık dosyaya yazılmaz. */
function ordered(obj, keys) {
  const out = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  return out;
}
const IMAGE_KEYS = ['src', 'thumb', 'w', 'h', 'alt'];
const DOCUMENT_KEYS = ['title', 'url'];
/** İzin listesi dışındaki anahtarlar (sıralı). */
function extraKeys(obj, keys) { return obj && typeof obj === 'object' ? Object.keys(obj).filter(k => !keys.includes(k)).sort() : []; }
function canonicalProduct(p) {
  const out = ordered(p, PRODUCT_KEYS);
  if (Array.isArray(out.images)) out.images = out.images.map(im => (im && typeof im === 'object' ? ordered(im, IMAGE_KEYS) : im));
  if (Array.isArray(out.documents)) out.documents = out.documents.map(d => (d && typeof d === 'object' ? ordered(d, DOCUMENT_KEYS) : d));
  return out;
}
function canonicalCategory(c) {
  const out = ordered({ ...c, parent: c.parent == null ? null : c.parent }, CATEGORY_KEYS);
  if (Array.isArray(out.filters)) out.filters = out.filters.map(f => (f && typeof f === 'object' ? ordered(f, FILTER_KEYS) : f));
  else delete out.filters;
  return out;
}
const dump = v => JSON.stringify(v) + '\n';

/* ------------------------------------------------------------------ okuma */

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

/**
 * Parçalı dizini modele çevirir: {categories: [...], products: [...]}. Dizin yoksa boş model.
 * Bozuk dosya hatası fırlatılır (doğrulayıcı yakalar).
 */
function loadDir(dir) {
  const model = { categories: [], products: [] };
  if (!fs.existsSync(path.join(dir, 'kategoriler.json'))) return model;
  const cats = readJson(path.join(dir, 'kategoriler.json'));
  if (!cats || cats.version !== 2 || !Array.isArray(cats.categories)) throw new Error('kategoriler.json: version 2 ve categories dizisi gerekli');
  model.categories = cats.categories.map(c => { const { count, ...rest } = c || {}; return rest; });
  const urun = path.join(dir, 'urun');
  if (fs.existsSync(urun)) {
    for (const f of fs.readdirSync(urun).filter(f => /^\d{4}\.json$/.test(f)).sort()) {
      const shard = readJson(path.join(urun, f));
      if (!shard || shard.version !== 2 || !shard.products || typeof shard.products !== 'object') throw new Error('urun/' + f + ': version 2 ve products nesnesi gerekli');
      for (const [id, p] of Object.entries(shard.products)) {
        if (!p || p.id !== id) throw new Error('urun/' + f + ': ' + id + ' kaydının id alanı uyuşmuyor');
        if (shardOf(id) + '.json' !== f) throw new Error('urun/' + f + ': ' + id + ' yanlış parçada');
        model.products.push(p);
      }
    }
  }
  return model;
}

/** v1 katalog.json -> model (kategoriler üst düzey). */
function fromV1(v1) {
  if (!v1 || v1.version !== 1 || !Array.isArray(v1.categories) || !Array.isArray(v1.products)) throw new Error('v1 katalog: version 1, categories ve products gerekli');
  return { categories: v1.categories.map(c => ({ ...c, parent: null })), products: v1.products.map(p => ({ ...p })) };
}

/* ------------------------------------------------------------------ doğrulama */

function sortedCategories(categories) {
  return [...categories].sort((a, b) => ((a.order | 0) - (b.order | 0)) || cmp(a.id, b.id));
}
function categoryTree(categories) {
  const byId = new Map(categories.map(c => [c.id, c]));
  const children = new Map();
  for (const c of sortedCategories(categories)) {
    if (c.parent != null) {
      if (!children.has(c.parent)) children.set(c.parent, []);
      children.get(c.parent).push(c.id);
    }
  }
  return { byId, children, isLeaf: id => !children.has(id) };
}

/**
 * Model kuralları. opts.base: /public dosyaları için depo kökü; opts.media: medya klasörü (yoksa yalnızca adres kalıbı
 * denetlenir). Döndürür {errors: [...], unchecked: <denetlenemeyen medya dosyası sayısı>}.
 */
function validateModel(model, opts = {}) {
  const base = opts.base || ROOT;
  const media = opts.media === undefined ? mediaDir() : opts.media;
  const mediaOk = !!media && fs.existsSync(media) && fs.statSync(media).isDirectory();
  let unchecked = 0;
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  const str = (v, min, max) => typeof v === 'string' && v.trim() === v && v.length >= min && v.length <= max;
  if (!model || !Array.isArray(model.categories) || !Array.isArray(model.products)) return { errors: ['katalog: categories ve products dizileri gerekli'], unchecked };
  const cats = new Map();
  for (const [i, c] of model.categories.entries()) {
    const w = `categories[${i}]${c && c.id ? ' ' + c.id : ''}`;
    if (!c || !/^[a-z0-9-]{2,60}$/.test(c.id || '')) { err(w, 'geçersiz id'); continue; }
    if (cats.has(c.id)) err(w, 'tekrarlanan id ' + c.id);
    if (!str(c.name, 2, 60)) err(w, 'name 2–60 karakter');
    if (!str(c.title, 5, 90)) err(w, 'title 5–90 karakter');
    if (typeof c.intro !== 'string' || c.intro.length > 600) err(w, 'intro en fazla 600 karakter');
    if (!Number.isInteger(c.order)) err(w, 'order tam sayı');
    if (c.parent !== null && c.parent !== undefined && typeof c.parent !== 'string') err(w, 'parent null ya da kategori kimliği');
    if (c.filters !== undefined) {
      // isteğe bağlı süzgeç tanımı: [{key: attr anahtarı, label, type: enum|number, unit?}], anahtar tekrarı yok
      if (!Array.isArray(c.filters) || c.filters.length > ATTR_KEYS.length) err(w, 'filters en çok ' + ATTR_KEYS.length + ' süzgeç dizisi');
      else {
        const seenF = new Set();
        for (const [j, f] of c.filters.entries()) {
          const fw = `${w} filters[${j}]`;
          if (!f || typeof f !== 'object') { err(fw, 'nesne olmalı'); continue; }
          if (!ATTR_KEYS.includes(f.key)) err(fw, 'key: ' + ATTR_KEYS.join(', '));
          else if (seenF.has(f.key)) err(fw, 'tekrarlanan key ' + f.key);
          seenF.add(f.key);
          if (!str(f.label, 2, 40)) err(fw, 'label 2–40 karakter');
          if (!FILTER_TYPES.has(f.type)) err(fw, 'type enum/number');
          if (f.unit !== undefined && !str(f.unit, 1, 10)) err(fw, 'unit 1–10 karakter');
          const extraF = extraKeys(f, FILTER_KEYS);
          if (extraF.length) err(fw, 'bilinmeyen alan(lar): ' + extraF.join(', '));
        }
      }
    }
    const extraC = extraKeys(c, [...CATEGORY_KEYS, 'count']);
    if (extraC.length) err(w, 'bilinmeyen alan(lar): ' + extraC.join(', '));
    cats.set(c.id, c);
  }
  for (const [id, c] of cats) {
    if (c.parent == null) continue;
    const parent = cats.get(c.parent);
    if (!parent || c.parent === id) err('categories ' + id, 'bilinmeyen üst kategori ' + c.parent);
    else if (parent.parent != null) err('categories ' + id, 'en fazla iki düzey: ' + c.parent + ' zaten alt kategori');
  }
  const tree = categoryTree([...cats.values()]);
  const ids = new Set(), slugs = new Set(), used = new Set();
  /** Dosya var ve WebP mi; want: [w, h] tam boyut; max: [w, h] en büyük boyut (küçük görsel). Boyutu döndürür. */
  const checkFile = (iw, key, abs, want, max) => {
    if (!fs.existsSync(abs)) { err(iw, key + ' dosyası yok'); return null; }
    const dim = webpSize(abs);
    if (!dim) { err(iw, key + ' WebP değil'); return null; }
    if (want && (dim[0] !== want[0] || dim[1] !== want[1])) err(iw, `${key} ${want[0]}x${want[1]} olmalı (${dim.join('x')})`);
    if (max && (dim[0] > max[0] || dim[1] > max[1])) err(iw, `${key} en çok ${max[0]}x${max[1]} olmalı (${dim.join('x')})`);
    return dim;
  };
  for (const [i, p] of model.products.entries()) {
    const w = `products[${i}]${p && p.id ? ' ' + p.id : ''}`;
    if (!p || !ID_RE.test(p.id || '')) { err(w, 'geçersiz id (vgm-NNNN ya da 100000 ve üstü vgm-NNNNNN)'); continue; }
    // izin listesi: tedarikçi adresi, maliyet, marj gibi alanlar herkese açık kataloğa giremez
    const extraP = extraKeys(p, PRODUCT_KEYS);
    if (extraP.length) err(w, 'bilinmeyen alan(lar): ' + extraP.join(', '));
    if (ids.has(p.id)) err(w, 'tekrarlanan id');
    ids.add(p.id);
    if (!/^[a-z0-9-]{3,90}$/.test(p.slug || '') || /--|^-|-$/.test(p.slug)) err(w, 'geçersiz slug');
    else if (slugs.has(p.slug)) err(w, 'tekrarlanan slug ' + p.slug);
    slugs.add(p.slug);
    if (!str(p.name, 8, 140)) err(w, 'name 8–140 karakter');
    if (!str(p.brand, 2, 60)) err(w, 'brand 2–60 karakter');
    if (!str(p.mpn, 2, 60)) err(w, 'mpn (üretici model kodu) 2–60 karakter');
    if (p.gtin !== null && !(typeof p.gtin === 'string' && gtinOk(p.gtin))) err(w, 'gtin null ya da geçerli GTIN-8/12/13/14');
    if (!cats.has(p.category)) err(w, 'bilinmeyen kategori ' + p.category);
    else if (!tree.isLeaf(p.category)) err(w, 'ürün alt kategorisi olan ' + p.category + ' kategorisine değil, bir alt kategoriye konmalı');
    else { used.add(p.category); if (cats.get(p.category).parent) used.add(cats.get(p.category).parent); }
    if (!str(p.summary, 30, 160)) err(w, 'summary 30–160 karakter');
    if (!Array.isArray(p.description) || p.description.length < 1 || p.description.length > 5
      || p.description.some(t => !str(t, 60, 900))) err(w, 'description 1–5 paragraf, her biri 60–900 karakter');
    if (!Array.isArray(p.specs) || p.specs.length < 2 || p.specs.length > 30
      || p.specs.some(s => !Array.isArray(s) || s.length !== 2 || !str(s[0], 1, 60) || !str(s[1], 1, 160))) err(w, 'specs 2–30 [etiket, değer] çifti');
    if (!Array.isArray(p.images) || p.images.length < 1 || p.images.length > 6) err(w, 'images 1–6 görsel');
    else for (const [j, im] of p.images.entries()) {
      const iw = `${w} images[${j}]`;
      if (!im || typeof im !== 'object') { err(iw, 'nesne olmalı'); continue; }
      const extraI = extraKeys(im, IMAGE_KEYS);
      if (extraI.length) err(iw, 'bilinmeyen alan(lar): ' + extraI.join(', '));
      if (!str(im.alt, 8, 160)) err(iw, 'alt 8–160 karakter');
      const sizeOk = Number.isInteger(im.w) && Number.isInteger(im.h) && im.w >= 240 && im.w <= 1200 && im.h >= 240 && im.h <= 1200;
      if (!sizeOk) err(iw, 'w/h 240–1200 tam sayı');
      const pub = PUBLIC_IMG.exec(im.src || ''), pubT = PUBLIC_IMG.exec(im.thumb || '');
      const med = MEDIA_IMG.exec(im.src || ''), medT = MEDIA_IMG.exec(im.thumb || '');
      if (pub && !pub[3]) {
        // Depodaki görseller (git): <ad>.<özet>.webp ve 400 piksellik <ad>.<özet>-400.webp
        if (!pubT || pubT[3] !== '-400' || pubT[1] !== pub[1] || pubT[2] !== pub[2]) { err(iw, 'thumb aynı adın -400.webp sürümü olmalı'); continue; }
        checkFile(iw, 'src', path.join(base, im.src.slice(1)), sizeOk ? [im.w, im.h] : null, null);
        const t = checkFile(iw, 'thumb', path.join(base, im.thumb.slice(1)), null, [400, 400]);
        if (t && Math.max(t[0], t[1]) !== 400) err(iw, `thumb uzun kenarı 400 piksel olmalı (${t.join('x')})`);
      } else if (med && !med[4]) {
        // Medya deposu (git dışı): /magaza-gorsel/<2 hane>/<ad>.<8 hane özet>.webp ve aynı adın -t.webp küçük sürümü
        if (!medT || medT[4] !== '-t' || medT[1] !== med[1] || medT[2] !== med[2] || medT[3] !== med[3]) { err(iw, 'thumb aynı adın -t.webp sürümü olmalı'); continue; }
        if (mediaOk) {
          checkFile(iw, 'src', path.join(media, ...im.src.slice('/magaza-gorsel/'.length).split('/')), sizeOk ? [im.w, im.h] : null, null);
          checkFile(iw, 'thumb', path.join(media, ...im.thumb.slice('/magaza-gorsel/'.length).split('/')), null, sizeOk ? [im.w, im.h] : null);
        } else unchecked += 2;
      } else err(iw, 'src /public/magaza/<ad>.<özet>.webp ya da /magaza-gorsel/<2 hane>/<ad>.<özet>.webp olmalı');
    }
    if (!Array.isArray(p.documents) || p.documents.some(d => !d || !str(d.title, 3, 90) || !/^https:\/\/[^\s"<>]+$/.test(d.url || ''))) err(w, 'documents [{title, https url}]');
    else for (const [j, d] of p.documents.entries()) {
      const extraD = extraKeys(d, DOCUMENT_KEYS);
      if (extraD.length) err(`${w} documents[${j}]`, 'bilinmeyen alan(lar): ' + extraD.join(', '));
    }
    if (!UNITS.has(p.unit)) err(w, 'unit: ' + [...UNITS].join(', '));
    if (![1, 10, 20].includes(p.vat)) err(w, 'vat 1, 10 veya 20');
    if (!['kargo', 'nakliye'].includes(p.shipping)) err(w, 'shipping kargo/nakliye');
    if (!Number.isInteger(p.maxQty) || p.maxQty < 1 || p.maxQty > 999) err(w, 'maxQty 1–999');
    // isteğe bağlı adet kuralları: minQty (en az adet), step (adet artışı; minQty bunun katı), packQty (paket/koli adedi)
    const maxQ = Number.isInteger(p.maxQty) ? p.maxQty : 999;
    if (p.minQty !== undefined && (!Number.isInteger(p.minQty) || p.minQty < 1 || p.minQty > maxQ)) err(w, 'minQty 1–maxQty tam sayı');
    if (p.step !== undefined && (!Number.isInteger(p.step) || p.step < 1 || p.step > maxQ)) err(w, 'step 1–maxQty tam sayı');
    else if (p.step !== undefined && Number.isInteger(p.minQty) && p.minQty % p.step !== 0) err(w, 'minQty step katı olmalı');
    if (p.packQty !== undefined && (!Number.isInteger(p.packQty) || p.packQty < 1 || p.packQty > 9999)) err(w, 'packQty 1–9999 tam sayı');
    if (typeof p.listUsd !== 'number' || !(p.listUsd > 0) || Math.round(p.listUsd * 100) / 100 !== p.listUsd) err(w, 'listUsd pozitif, en fazla 2 ondalık');
    if (typeof p.listCheckedAt !== 'string' || Number.isNaN(Date.parse(p.listCheckedAt)) || !/Z$/.test(p.listCheckedAt)) err(w, 'listCheckedAt ISO UTC');
    if (!Array.isArray(p.related)) err(w, 'related dizi');
  }
  for (const [i, p] of model.products.entries()) {
    for (const r of (p && Array.isArray(p.related) ? p.related : [])) {
      if (r === p.id || !ids.has(r)) errors.push(`products[${i}] ${p.id}: related bilinmeyen/kendisi ${r}`);
    }
  }
  for (const [id, c] of cats) if (used.has(id) && typeof c.intro === 'string' && c.intro.trim().length < 80) err('categories ' + id, 'ürünü olan kategoride intro en az 80 karakter');
  return { errors, unchecked };
}

/** Silinmiş ürünlere ve kendisine işaret eden related kimliklerini temizler (yazıcı, doğrulamadan önce). */
function normalize(model) {
  const ids = new Set(model.products.map(p => p && p.id));
  return {
    categories: model.categories.map(c => ({ ...c, parent: c.parent == null ? null : c.parent })),
    products: model.products.map(p => (p && Array.isArray(p.related) ? { ...p, related: p.related.filter(r => r !== p.id && ids.has(r)) } : p)),
  };
}

/* ------------------------------------------------------------------ dizin dosyaları */

function productOrder(a, b) {
  return cmp(fold(a.brand), fold(b.brand)) || cmp(fold(a.name), fold(b.name)) || cmp(a.id, b.id);
}

/**
 * Liste kartı. sortTry: fiyat sıralama anahtarı; şimdilik listUsd ile aynı (KDV hariç USD) — yer tutucu: sunucu
 * (vgmr_sort_cards) bunu güncel kurla çarpar; canlı fiyat/marj yansıtıldığında yalnızca bu alanın üretimi değişir,
 * kart biçimi değişmez. attr: extractAttr(specs) boş değilse.
 */
function card(p) {
  const im = Array.isArray(p.images) && p.images[0] ? p.images[0] : null;
  const attr = extractAttr(p.specs);
  const c = { id: p.id, slug: p.slug, name: p.name, brand: p.brand, mpn: p.mpn, thumb: im ? (im.thumb || im.src || null) : null,
    listUsd: p.listUsd, listCheckedAt: p.listCheckedAt, shipping: p.shipping, unit: p.unit, vat: p.vat, maxQty: p.maxQty,
    minQty: p.minQty, step: p.step, packQty: p.packQty, sortTry: p.listUsd };
  for (const k of ['minQty', 'step', 'packQty']) if (c[k] === undefined) delete c[k];
  if (Object.keys(attr).length) c.attr = attr;
  return ordered(c, CARD_KEYS);
}

/**
 * Geçerli bir modelden tüm dizin dosyalarını üretir: Map(göreli yol -> içerik). Boş related[] aynı kategorideki
 * (yazıcı sırasındaki) en çok 4 komşuyla doldurulur. generatedAt '' bırakılır; writeDir doldurur.
 */
function buildFiles(model, generatedAt = '') {
  const files = new Map();
  const cats = sortedCategories(model.categories);
  const byCat = new Map(cats.map(c => [c.id, []]));
  for (const p of model.products) { if (byCat.has(p.category)) byCat.get(p.category).push(p); }
  for (const list of byCat.values()) list.sort(productOrder);
  const filled = new Map();
  for (const list of byCat.values()) {
    list.forEach((p, i) => {
      let related = Array.isArray(p.related) ? p.related : [];
      if (related.length === 0 && list.length > 1) {
        related = [];
        for (let k = 1; k < list.length && related.length < 4; k++) related.push(list[(i + k) % list.length].id);
      }
      filled.set(p.id, canonicalProduct({ ...p, related }));
    });
  }
  // urun/<shard>.json
  const shards = new Map();
  for (const id of [...filled.keys()].sort()) {
    const s = shardOf(id);
    if (!shards.has(s)) shards.set(s, {});
    shards.get(s)[id] = filled.get(id);
  }
  for (const [s, products] of shards) files.set(`urun/${s}.json`, dump({ version: 2, products }));
  // liste/<kategori>.json ve arama.json (kategori sırası, sonra yazıcı sırası)
  const search = [];
  const count = new Map();
  const catById = new Map(cats.map(c => [c.id, c]));
  for (const c of cats) {
    const list = byCat.get(c.id);
    if (list.length) files.set(`liste/${c.id}.json`, dump({ version: 2, category: c.id, items: list.map(card) }));
    const parent = c.parent != null ? catById.get(c.parent) : null;
    const catPath = [...(parent ? [parent.name] : []), c.name];
    for (const p of list) search.push(searchRow(p, catPath, extractAttr(p.specs)));
    count.set(c.id, (count.get(c.id) || 0) + list.length);
    if (c.parent != null) count.set(c.parent, (count.get(c.parent) || 0) + list.length);
  }
  // slug/<xx>.json
  const slugMaps = new Map();
  for (const p of [...model.products].sort((a, b) => cmp(a.slug, b.slug))) {
    const s = slugShard(p.slug);
    if (!slugMaps.has(s)) slugMaps.set(s, {});
    slugMaps.get(s)[p.slug] = p.id;
  }
  for (const s of [...slugMaps.keys()].sort()) files.set(`slug/${s}.json`, dump(slugMaps.get(s)));
  files.set('arama.json', dump({ version: 2, items: search }));
  files.set('kategoriler.json', dump({ version: 2, generatedAt,
    categories: cats.map(c => ({ ...canonicalCategory(c), count: count.get(c.id) || 0 })) }));
  files.set('manifest.json', dump({ version: 2, products: model.products.length, generatedAt }));
  return files;
}

const META_FILES = new Set(['kategoriler.json', 'manifest.json']);
/** generatedAt dışındaki içerik (karşılaştırma için). */
function withoutStamp(rel, text) {
  if (!META_FILES.has(rel)) return text;
  try { const j = JSON.parse(text); delete j.generatedAt; return JSON.stringify(j); } catch (_) { return text; }
}

/** Dizindeki mevcut katalog dosyaları (göreli yollar). */
function listFiles(dir) {
  const out = [];
  for (const top of ['kategoriler.json', 'manifest.json', 'arama.json']) if (fs.existsSync(path.join(dir, top))) out.push(top);
  for (const sub of ['urun', 'liste', 'slug']) {
    const d = path.join(dir, sub);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).sort()) if (f.endsWith('.json')) out.push(`${sub}/${f}`);
  }
  return out;
}

/**
 * Dosyaları yazar: yalnızca değişen dosyalar yazılır (geçici dosya + rename), artık kullanılmayan parça/liste/slug
 * dosyaları silinir. Hiçbir içerik değişmediyse önceki generatedAt korunur (aynı girdi = bayt bayt aynı çıktı).
 * Döndürür {written, removed, unchanged}.
 */
function writeDir(dir, files, now = new Date()) {
  const existing = new Set(listFiles(dir));
  let changed = false;
  for (const [rel, text] of files) {
    const abs = path.join(dir, rel);
    const old = existing.has(rel) ? fs.readFileSync(abs, 'utf8') : null;
    if (old === null || withoutStamp(rel, old) !== withoutStamp(rel, text)) { changed = true; break; }
  }
  for (const rel of existing) if (!files.has(rel)) { changed = true; break; }
  let stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (!changed && existing.has('manifest.json')) {
    try { stamp = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).generatedAt || stamp; } catch (_) { /* yeni zaman */ }
  }
  const stats = { written: 0, removed: 0, unchanged: 0 };
  for (const sub of ['', 'urun', 'liste', 'slug']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  for (let [rel, text] of files) {
    if (META_FILES.has(rel)) { const j = JSON.parse(text); j.generatedAt = stamp; text = JSON.stringify(j) + '\n'; }
    const abs = path.join(dir, rel);
    if (existing.has(rel) && fs.readFileSync(abs, 'utf8') === text) { stats.unchanged++; continue; }
    const tmp = abs + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, abs);
    stats.written++;
  }
  for (const rel of existing) {
    if (!files.has(rel)) { fs.rmSync(path.join(dir, rel), { force: true }); stats.removed++; }
  }
  return stats;
}

module.exports = { ROOT, DEFAULT_DIR, UNITS, ID_RE, NEW_ID_RE, MEDIA_REL, PUBLIC_IMG, MEDIA_IMG, ATTR_KEYS, SYNONYMS, fold, shardOf, slugShard, gtinOk,
  webpSize, mediaDir, loadDir, fromV1, validateModel, normalize, buildFiles, writeDir, listFiles, withoutStamp, canonicalProduct, canonicalCategory,
  sortedCategories, categoryTree, readJson, extractAttr, attrTokens, mpnVariants, synonymsFor, searchRow, card };

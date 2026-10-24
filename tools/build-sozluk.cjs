'use strict';

// bilgi/elektrik-terimleri-sozlugu.html sayfasını tools/data/elektrik-terimleri.cjs verisinden üretir.
//   node tools/build-sozluk.cjs          sayfayı yazar
//   node tools/build-sozluk.cjs --check  sayfa güncel değilse hata verir
const { esc, compose, metaHead, emit } = require('./lib/bilgi-page.cjs');
const TERMS = require('./data/elektrik-terimleri.cjs');
const OUT = 'bilgi/elektrik-terimleri-sozlugu.html';
const URL = 'https://voltguard.com.tr/' + OUT;
const UPDATED = '2026-10-24';

const collator = new Intl.Collator('tr', { sensitivity: 'base' });
const sorted = TERMS.slice().sort((a, b) => collator.compare(a.term, b.term));
const letterOf = t => t.term.charAt(0).toLocaleUpperCase('tr');
const letters = [...new Set(sorted.map(letterOf))];
// Harf çapaları ASCII: I/İ, S/Ş gibi çiftler ayrı kalır, kodlanmış adres sorunu olmaz
const TR = { 'Ç': 'c2', 'Ğ': 'g2', 'I': 'i', 'İ': 'i2', 'Ö': 'o2', 'Ş': 's2', 'Ü': 'u2' };
const slug = L => TR[L] || L.toLowerCase();

const title = 'Elektrik Terimleri Sözlüğü: ' + TERMS.length + ' Temel Kavram | VoltGuard';
const desc = 'Kompanzasyon, harmonik, kısa devre akımı, topraklama, kaçak akım rölesi, GES ve PLC gibi ' + TERMS.length + ' elektrik terimi; kısa tanımlar, ilgili standart ve rehber bağlantıları.';
const ld = { '@context': 'https://schema.org', '@graph': [
  { '@type': 'DefinedTermSet', '@id': URL + '#sozluk', name: 'Elektrik Terimleri Sözlüğü', url: URL, inLanguage: 'tr-TR', description: desc,
    publisher: { '@id': 'https://voltguard.com.tr/#organization' },
    hasDefinedTerm: sorted.map(t => ({ '@type': 'DefinedTerm', '@id': URL + '#' + t.id, name: t.term, description: t.def, url: URL + '#' + t.id, inDefinedTermSet: URL + '#sozluk' })) },
  { '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Ana Sayfa', item: 'https://voltguard.com.tr/' },
    { '@type': 'ListItem', position: 2, name: 'Bilgi Bankası', item: 'https://voltguard.com.tr/bilgi-bankasi.html' },
    { '@type': 'ListItem', position: 3, name: 'Elektrik Terimleri Sözlüğü', item: URL }] }] };

const head = metaHead({ title, desc, url: URL, type: 'website', extra: `  <style>
    .gl-index{display:flex;flex-wrap:wrap;gap:.35rem;margin:1rem 0 1.4rem;padding:0;list-style:none}
    .gl-index a{display:inline-flex;align-items:center;justify-content:center;min-width:2.5rem;min-height:2.5rem;border:1px solid #cbd5e1;border-radius:8px;font-weight:700;text-decoration:none;color:#0a1628;background:#fff}
    .gl-index a:hover,.gl-index a:focus-visible{border-color:#f59e0b;background:#fffbeb}
    .gl-filter{width:100%;max-width:420px;min-height:44px;padding:.55rem .8rem;border:1px solid #cbd5e1;border-radius:8px;font:inherit}
    .gl-letter{margin:1.8rem 0 .4rem;font-size:1.4rem;color:#b45309}
    .gl-list{margin:0}
    .gl-term{scroll-margin-top:calc(var(--vg-header-h,60px) + 16px);padding:.9rem 0;border-top:1px solid #e2e8f0}
    .gl-term:target{background:#fffbeb;box-shadow:0 0 0 .6rem #fffbeb;border-radius:4px}
    .gl-term dt{font-weight:800;font-size:1.05rem;color:#0a1628}
    .gl-term dt a{color:inherit;text-decoration:none}
    .gl-term .gl-alt{display:block;font-weight:500;font-size:.85rem;color:#4f5f74}
    .gl-term dd{margin:.3rem 0 0}
    .gl-links{display:flex;flex-wrap:wrap;gap:.1rem 1rem;margin-top:.3rem;font-size:.9rem}
    .gl-links a{display:inline-block;padding:.3rem 0}
    .gl-empty{padding:1rem;border-radius:8px;background:#f1f5f9}
  </style>
  <script src="/js/sozluk.js?v=0" defer></script>
  <script type="application/ld+json">${JSON.stringify(ld)}</script>
` });

const body = letters.map(L => `    <h2 class="gl-letter" id="harf-${slug(L)}">${esc(L)}</h2>
    <dl class="gl-list">
${sorted.filter(t => letterOf(t) === L).map(t => `      <div class="gl-term" id="${t.id}" data-terms="${esc([t.term].concat(t.alt || []).join(' ').toLocaleLowerCase('tr'))}">
        <dt><a href="#${t.id}">${esc(t.term)}</a>${t.alt && t.alt.length ? `<span class="gl-alt">Diğer adları: ${esc(t.alt.join(', '))}</span>` : ''}</dt>
        <dd><p>${esc(t.def)}</p>${t.links.length ? `<div class="gl-links">${t.links.map(([h, s]) => `<a href="${h}">${esc(s)}</a>`).join('')}</div>` : ''}</dd>
      </div>`).join('\n')}
    </dl>`).join('\n');

const main = `  <nav class="breadcrumb" aria-label="breadcrumb">
    <a href="/">Ana Sayfa</a> &rsaquo; <a href="/bilgi-bankasi.html">Bilgi Bankası</a> &rsaquo; <span>Elektrik Terimleri Sözlüğü</span>
  </nav>

  <main class="article" id="main" tabindex="-1">
    <span class="article__cat">Sözlük</span>
    <h1>Elektrik Terimleri Sözlüğü</h1>
    <p class="article__byline" style="font-size:.85rem;color:#5b6472;margin:.25rem 0 1rem">Hazırlayan: VoltGuard Mühendislik Ekibi · Son gözden geçirme: <time datetime="${UPDATED}">${UPDATED.split('-').reverse().join('.')}</time></p>
    <p class="article__summary">Sahada, projede ve faturada sık karşılaşılan ${TERMS.length} elektrik kavramının kısa tanımı. Her terimde ilgili standart veya yönetmelik ile konuyu ayrıntılı anlatan rehber, hesap aracı ya da VoltSim simülasyonu bağlantısı bulunur.</p>
    <p><label for="gl-q" class="sr-only">Sözlükte ara</label><input id="gl-q" class="gl-filter" type="search" placeholder="Sözlükte ara: harmonik, RCD, kVA…" autocomplete="off" hidden></p>
    <p class="gl-empty" id="gl-empty" role="status" hidden></p>
    <nav aria-label="Harf dizini"><ul class="gl-index">${letters.map(L => `<li><a href="#harf-${slug(L)}">${esc(L)}</a></li>`).join('')}</ul></nav>
${body}
    <p class="kb-disclaimer" style="margin-top:1.6rem">Tanımlar bilgilendirme amaçlı kısa açıklamalardır; tasarım ve uygulamada ilgili standart ile yönetmeliğin güncel tam metni esas alınır.</p>
    <div class="kb-cta">
      <div class="kb-cta__text"><strong>Tesisiniz için mühendislik desteği</strong><span>Proje, pano, kompanzasyon, topraklama ve periyodik kontrol hizmetleri.</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:.6rem">
        <a href="/hizmetler/" class="btn btn--accent btn--md"><i class="fas fa-arrow-right" aria-hidden="true"></i> Hizmetlerimiz</a>
        <a href="/#iletisim" class="btn btn--outline-white btn--md"><i class="fas fa-paper-plane" aria-hidden="true"></i> Teklif Al</a>
      </div>
    </div>
  </main>
`;

emit(OUT, compose({ head, main }), TERMS.length + ' terim');

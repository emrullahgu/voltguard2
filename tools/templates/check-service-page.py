#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/templates/check-service-page.py - /hizmetler/ sayfalari icin denetim + JSON-LD esitleme araci
====================================================================================================

KULLANIM (proje kokunden)
  python tools/templates/check-service-page.py hizmetler/trafo-isletme-sorumlulugu.html
  python tools/templates/check-service-page.py --fix hizmetler/*.html      # FAQPage + BreadcrumbList'i gorunur metinden yazar
  python tools/templates/check-service-page.py --all                       # hizmetler/*.html hepsi

NE DENETLER
  - Tek <h1>; <title> <= 60, meta description 110-160 karakter (uyari)
  - canonical = og:url = sayfanin yayindaki adresi; og:*/twitter:* etiketleri
  - vg:head / vg:header / vg:footer isaretcileri, /css/services.css?v= ve /js/services.js?v= referanslari
  - <script type="application/ld+json" id="svc-jsonld">: gecerli JSON; hizmet sayfasinda Service (provider @id
    #organization, areaServed Turkiye) + WebPage + BreadcrumbList + FAQPage; hub'da CollectionPage + ItemList
  - FAQPage soru/cevap metinleri = gorunur <details class="svc-faq__item"> metinleri (BIREBIR)
  - BreadcrumbList adlari/URL'leri = gorunur nav.svc-crumbs
  - Ic baglantilar dosyaya cozulur (/, /hesaplama-araclari/, /hesaplama/<slug>/, /klasor/, /x.html);
    henuz yazilmamis /hizmetler/*.html sayfalari UYARI, digerleri HATA. Sayfa ici #capa hedefleri var mi.
  - <img>: width/height/alt; public/Trafoisletmesorumlulugu.jpeg yasak; goreli (../) yol yok
  - Font Awesome siniflari css/fa-subset.css icinde var mi (yoksa "YENI IKON" olarak listeler)

--fix: yalnizca #svc-jsonld blogundaki FAQPage.mainEntity ve BreadcrumbList.itemListElement'i gorunur
metinden yeniden uretir (diger dugumlere dokunmaz), blogu 2 bosluk girintili JSON olarak yazar.
BOM ve satir sonlari korunur. Cikis kodu: hata varsa 1.
"""
import argparse
import html
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SITE = 'https://voltguard.com.tr'
ORG_ID = SITE + '/#organization'
JSONLD_RE = re.compile(r'(<script type="application/ld\+json" id="svc-jsonld">)(.*?)(</script>)', re.S)


def norm(s):
    return re.sub(r'\s+', ' ', html.unescape(s or '')).strip()


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.h1 = 0
        self.title = ''
        self.metas = {}
        self.links_rel = {}
        self.anchors = []      # (href, attrs)
        self.imgs = []
        self.ids = set()
        self.icons = set()
        self.crumbs = []       # [name, href]
        self.faq = []          # [q, a, id]
        self._in = {}
        self._buf = None

    # yardimci: aktif "yakalama" modlari
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = (a.get('class') or '').split()
        if a.get('id'):
            self.ids.add(a['id'])
        for c in cls:
            if c.startswith('fa-') and c not in ('fa-solid', 'fa-regular', 'fa-brands'):
                self.icons.add(c)
        if tag == 'h1':
            self.h1 += 1
        if tag == 'title':
            self._in['title'] = True
        if tag == 'meta':
            k = a.get('name') or a.get('property')
            if k:
                self.metas[k] = a.get('content', '')
        if tag == 'link' and a.get('rel'):
            self.links_rel.setdefault(a['rel'], []).append(a.get('href', ''))
        if tag == 'a':
            self.anchors.append((a.get('href', ''), a))
        if tag == 'img':
            self.imgs.append(a)
        if tag == 'nav' and 'svc-crumbs' in cls:
            self._in['crumbs'] = len(self.stack)
        if 'crumbs' in self._in and tag == 'li':
            self.crumbs.append(['', None])
        if 'crumbs' in self._in and tag == 'a' and self.crumbs:
            self.crumbs[-1][1] = a.get('href')
        if tag == 'details' and 'svc-faq__item' in cls:
            self.faq.append(['', '', a.get('id')])
            self._in['faq'] = len(self.stack)
        if 'faq' in self._in and tag == 'summary':
            self._in['q'] = len(self.stack)
        if 'faq' in self._in and 'svc-faq__a' in cls:
            self._in['a'] = len(self.stack)
        if tag not in ('meta', 'link', 'img', 'br', 'hr', 'input', 'source', 'wbr'):
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag == 'title':
            self._in.pop('title', None)
        if tag in ('p', 'li', 'div', 'ul', 'ol') and 'a' in self._in and self.faq:
            self.faq[-1][1] += ' '   # blok sonu = bosluk (textContent'te paragraflar arasi)
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        elif tag in self.stack:
            while self.stack and self.stack.pop() != tag:
                pass
        depth = len(self.stack)
        for k in ('q', 'a', 'faq', 'crumbs'):
            if k in self._in and depth <= self._in[k]:
                self._in.pop(k)

    def handle_data(self, data):
        if self._in.get('title'):
            self.title += data
        if 'crumbs' in self._in and self.crumbs:
            self.crumbs[-1][0] += data
        if 'faq' in self._in and self.faq:
            if 'q' in self._in:
                self.faq[-1][0] += data
            elif 'a' in self._in:
                self.faq[-1][1] += data


def page_url(rel):
    if rel == 'index.html':
        return '/'
    if rel.endswith('/index.html'):
        return '/' + rel[:-len('index.html')]
    return '/' + rel


def resolve(href):
    """Kok-mutlak ic baglanti -> proje dosyasi (yoksa None)."""
    p = href.split('#')[0].split('?')[0]
    if p in ('', '/'):
        return ROOT / 'index.html'
    if p == '/hesaplama-araclari/':
        return ROOT / 'teklif-araclari.html'
    m = re.match(r'^/hesaplama/([a-z0-9-]+)/$', p)
    if m:
        return ROOT / 'hesaplama' / (m.group(1) + '.html')
    if p.endswith('/'):
        return ROOT / p.strip('/') / 'index.html'
    return ROOT / p.lstrip('/')


def fa_subset():
    css = (ROOT / 'css' / 'fa-subset.css').read_text(encoding='utf-8')
    return set(re.findall(r'\.(fa-[a-z0-9-]+)(?=[:,{\s])', css))


def check(path, fix=False):
    errs, warns = [], []
    raw = path.read_bytes()
    bom = raw.startswith(b'\xef\xbb\xbf')
    text = raw.decode('utf-8-sig')
    crlf = text.count('\r\n') > text.count('\n') - text.count('\r\n')
    t = text.replace('\r\n', '\n')
    rel = path.resolve().relative_to(ROOT).as_posix()
    url = SITE + page_url(rel)
    is_hub = rel == 'hizmetler/index.html'

    pg = Page()
    pg.feed(t)

    # --- temel etiketler
    if pg.h1 != 1:
        errs.append('h1 sayisi %d (1 olmali)' % pg.h1)
    title = norm(pg.title)
    if not title:
        errs.append('<title> yok')
    elif len(title) > 60:
        warns.append('title %d karakter (> 60): %s' % (len(title), title))
    desc = pg.metas.get('description', '')
    if not desc:
        errs.append('meta description yok')
    elif not 110 <= len(desc) <= 160:
        warns.append('meta description %d karakter (110-160 onerilir)' % len(desc))
    canon = (pg.links_rel.get('canonical') or [''])[0]
    if canon != url:
        errs.append('canonical %r, beklenen %r' % (canon, url))
    for k in ('og:title', 'og:description', 'og:url', 'og:image', 'og:type', 'og:locale', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image'):
        if not pg.metas.get(k):
            errs.append('%s eksik' % k)
    if pg.metas.get('og:url') and pg.metas['og:url'] != url:
        errs.append('og:url canonical ile ayni degil')
    for mk in ('<!--vg:head-->', '<!--vg:header-->', '<!--vg:footer-->'):
        if mk not in t:
            errs.append('%s isaretcisi yok' % mk)
    if not re.search(r'href="/css/services\.css\?v=\w+"', t):
        errs.append('/css/services.css?v=... referansi yok')
    if not re.search(r'src="/js/services\.js\?v=\w+"', t):
        errs.append('/js/services.js?v=... referansi yok')
    if 'Trafoisletmesorumlulugu' in t:
        errs.append('public/Trafoisletmesorumlulugu.jpeg kullanilmis (yasak)')
    if re.search(r'(?:href|src)="\.\./', t) or 'index.html#iletisim' in t:
        errs.append('goreli (../) yol veya index.html#iletisim kullanilmis; kok-mutlak (/, /#iletisim) kullanin')
    if not is_hub:
        slug = rel.rsplit('/', 1)[-1][:-5]
        if not re.search(r'<body[^>]*data-service="%s"' % re.escape(slug), t):
            errs.append('<body data-service="%s"> eksik' % slug)
        for sid in ('sss', 'diger-hizmetler'):
            if sid not in pg.ids:
                errs.append('#%s bolumu yok' % sid)
        if 'aria-current="page"' not in t.split('class="svc-others"', 1)[-1]:
            errs.append('diger hizmetler listesinde bu sayfa aria-current="page" degil')

    # --- gorunur breadcrumb / SSS
    crumbs = [[norm(n), h] for n, h in pg.crumbs]
    vis_bc = []
    for i, (n, h) in enumerate(crumbs, 1):
        item = SITE + h if h and h.startswith('/') else (h or url)
        vis_bc.append({'@type': 'ListItem', 'position': i, 'name': n, 'item': item})
    if len(vis_bc) < 2:
        errs.append('gorunur breadcrumb (nav.svc-crumbs) bulunamadi')
    faq = [[norm(q), norm(a), i] for q, a, i in pg.faq]
    vis_faq = [{'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a, _ in faq]
    if not is_hub and not 5 <= len(faq) <= 8:
        warns.append('SSS sayisi %d (5-8 onerilir)' % len(faq))
    for q, a, i in faq:
        if not i:
            warns.append('SSS ogesine id verin (capa ile acilabilsin): %s' % q)

    # --- JSON-LD
    m = JSONLD_RE.search(t)
    data = None
    if not m:
        errs.append('<script type="application/ld+json" id="svc-jsonld"> yok')
    else:
        try:
            data = json.loads(m.group(2))
        except ValueError as e:
            errs.append('JSON-LD gecersiz: %s' % e)
    if data is not None:
        graph = data.get('@graph', [])
        bytype = {}
        for n in graph:
            ty = n.get('@type')
            for x in (ty if isinstance(ty, list) else [ty]):
                bytype.setdefault(x, n)
        if fix:
            if 'BreadcrumbList' in bytype and vis_bc:
                bytype['BreadcrumbList']['itemListElement'] = vis_bc
            if 'FAQPage' in bytype and vis_faq:
                bytype['FAQPage']['mainEntity'] = vis_faq
            block = json.dumps(data, ensure_ascii=False, indent=2)
            block = '\n' + '\n'.join('  ' + l for l in block.split('\n')) + '\n  '
            t = t[:m.start(2)] + block + t[m.end(2):]
        need = ['CollectionPage', 'ItemList', 'BreadcrumbList'] if is_hub else ['Service', 'WebPage', 'BreadcrumbList', 'FAQPage']
        for ty in need:
            if ty not in bytype:
                errs.append('JSON-LD: %s dugumu yok' % ty)
        svc = bytype.get('Service')
        if svc:
            prov = svc.get('provider') or {}
            if prov.get('@id') != ORG_ID:
                errs.append('Service.provider @id %s olmali' % ORG_ID)
            areas = json.dumps(svc.get('areaServed', []), ensure_ascii=False)
            if 'Türkiye' not in areas:
                errs.append('Service.areaServed Türkiye icermiyor')
            if svc.get('url') != url:
                errs.append('Service.url canonical ile ayni degil')
        bc = bytype.get('BreadcrumbList')
        if bc and not fix and bc.get('itemListElement') != vis_bc:
            errs.append('BreadcrumbList gorunur breadcrumb ile ayni degil (--fix)')
        fq = bytype.get('FAQPage')
        if fq and not fix and fq.get('mainEntity') != vis_faq:
            errs.append('FAQPage gorunur SSS metniyle birebir ayni degil (--fix)')
        il = bytype.get('ItemList')
        if is_hub and il:
            urls = [x.get('url') or x.get('item') for x in il.get('itemListElement', [])]
            if len(urls) != 12:
                errs.append('ItemList 12 hizmet icermeli (%d)' % len(urls))

    # --- baglantilar
    for href, a in pg.anchors:
        if not href:
            errs.append('bos href')
            continue
        if href.startswith('#'):
            if href[1:] and href[1:] not in pg.ids:
                errs.append('sayfa ici capa hedefi yok: %s' % href)
            continue
        if a.get('target') == '_blank' and 'noopener' not in (a.get('rel') or ''):
            errs.append('target=_blank rel=noopener olmadan: %s' % href)
        if href.startswith('/') and not href.startswith('//'):
            f = resolve(href)
            if not f.exists():
                if re.match(r'^/hizmetler/[a-z0-9-]+\.html', href):
                    warns.append('henuz yok (planli hizmet sayfasi): %s' % href)
                else:
                    errs.append('kirik ic baglanti: %s' % href)
    seen = set()
    for w in [x for x in warns if x.startswith('henuz yok')]:
        seen.add(w)
    warns = [x for x in warns if not x.startswith('henuz yok')] + sorted(seen)

    # --- gorseller
    for i, im in enumerate(pg.imgs):
        src = im.get('src', '')
        for k in ('width', 'height', 'alt'):
            if k not in im:
                errs.append('img %s: %s eksik' % (src, k))
        if src.startswith('/') and not (ROOT / src.lstrip('/').split('?')[0]).exists():
            errs.append('img dosyasi yok: %s' % src)
        if i > 0 and im.get('loading') != 'lazy':
            warns.append('img %s: loading="lazy" yok (hero disindaki gorseller)' % src)

    # --- ikonlar
    new_icons = sorted(pg.icons - fa_subset())
    if new_icons:
        warns.append('YENI IKON (css/fa-subset.css icinde yok; koordinatore bildirin): ' + ', '.join(new_icons))

    if fix:
        out = t.replace('\n', '\r\n') if crlf else t
        data_b = out.encode('utf-8')
        if bom:
            data_b = b'\xef\xbb\xbf' + data_b
        if data_b != raw:
            path.write_bytes(data_b)
            print('yazildi  %s (JSON-LD FAQPage/BreadcrumbList esitlendi)' % rel)
    return errs, warns, {'faq': len(faq), 'words': len(re.findall(r'\w+', norm(re.sub(r'<[^>]+>', ' ', t.split('<main', 1)[-1].split('</main>', 1)[0]))))}


def main():
    ap = argparse.ArgumentParser(description='VoltGuard hizmet sayfasi denetimi')
    ap.add_argument('files', nargs='*')
    ap.add_argument('--fix', action='store_true', help='FAQPage + BreadcrumbList JSON-LD dugumlerini gorunur metinden yaz')
    ap.add_argument('--all', action='store_true', help='hizmetler/*.html')
    a = ap.parse_args()
    files = [Path(f) for f in a.files]
    if a.all:
        files = sorted((ROOT / 'hizmetler').glob('*.html'))
    if not files:
        ap.error('dosya verin ya da --all kullanin')
    bad = 0
    for f in files:
        f = f if f.is_absolute() else (Path.cwd() / f)
        if a.fix:
            check(f, fix=True)
        errs, warns, info = check(f)
        rel = f.resolve().relative_to(ROOT).as_posix()
        print('%s %s  (SSS: %d, main kelime: ~%d)' % ('HATA ' if errs else 'OK   ', rel, info['faq'], info['words']))
        for e in errs:
            print('   HATA  ' + e)
        for w in warns:
            print('   uyari ' + w)
        bad += bool(errs)
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
tools/seo-inventory.py - Yayindaki sayfalarin URL envanteri ve ic baglanti haritasi
===================================================================================

KULLANIM (proje kokunden)
  python tools/seo-inventory.py                 # ozet: konu kumeleri, kopuk sayfalar, olasi tekrarlar
  python tools/seo-inventory.py --csv out.csv   # tum sayfalar: URL, baslik, H1, sitemap, gelen/giden ic baglanti
  python tools/seo-inventory.py --topic kompanzasyon   # tek kumenin sayfalari ve aralarindaki baglantilar

Gelen baglanti sayilari ortak header/footer (<!--vg:header--> / <!--vg:footer-->) DISINDAKI icerikten sayilir;
menuden gelen baglanti sayfayi "bagli" yapmaz. Arama hacmi / trafik verisi icermez (Search Console gerekir).
"""
import argparse
import collections
import csv
import itertools
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util

_spec = importlib.util.spec_from_file_location('audit_site', Path(__file__).resolve().parent / 'audit-site.py')
audit = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(audit)

ROOT = audit.ROOT
ORIGIN = audit.ORIGIN
PRIVATE = ('calisan/', 'hesap/')

# Oncelikli konu kumeleri: baslik + H1 + URL uzerinde aranir (ilk eslesen degil, hepsi).
TOPICS = {
    'isletme-sorumlulugu': r'i[sş]letme sorumlu|isletme-sorumlulugu|ygtis',
    'kompanzasyon-harmonik': r'kompanzasyon|reaktif|harmonik|thd|enerji kalitesi|kondansat',
    'periyodik-kontrol': r'periyodik|topraklama [oö]l[cç][uü]m|uygunluk raporu',
    'pano-revizyonu': r'pano',
    'guc-artirimi': r'g[uü][cç] art[ıi]r|kapasite art|trafo merkezi|trafo kurulum',
}
STOP = set('ve ile için icin nedir nasıl nasil | - : voltguard izmir 2026 the hesaplama hesabı hesabi rehberi'.split())


def page_url(rel):
    if rel == 'index.html':
        return '/'
    if rel == 'teklif-araclari.html':
        return '/hesaplama-araclari/'
    if rel.endswith('/index.html'):
        return '/' + rel[:-len('index.html')]
    m = re.match(r'^hesaplama/([a-z0-9-]+)\.html$', rel)
    if m:
        return '/hesaplama/%s/' % m.group(1)
    return '/' + rel


def content_only(text):
    """Ortak kabuk (header/footer/head) cikarilmis HTML."""
    for name in ('head', 'header', 'footer'):
        text = re.sub(r'<!--vg:%s-->.*?<!--/vg:%s-->' % (name, name), ' ', text, flags=re.S)
    return text


def sitemap_urls():
    return set(urlsplit(u).path for u in re.findall(r'<loc>([^<]+)</loc>', (ROOT / 'sitemap.xml').read_text(encoding='utf-8')))


def strip(s):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', s)).strip()


def collect():
    pages = {}
    for f in audit.page_files():
        rel = f.relative_to(ROOT).as_posix()
        if rel.startswith(PRIVATE):
            continue
        raw = f.read_text(encoding='utf-8-sig')
        body = content_only(raw)
        title = strip((re.search(r'<title>(.*?)</title>', raw, re.S) or [None, ''])[1])
        h1 = strip((re.search(r'<h1[^>]*>(.*?)</h1>', raw, re.S) or [None, ''])[1])
        canon = (re.search(r'<link rel="canonical" href="([^"]+)"', raw) or [None, ''])[1]
        noindex = bool(re.search(r'<meta name="robots" content="[^"]*noindex', raw))
        main = re.search(r'<main\b.*?</main>', body, re.S)
        words = len(re.findall(r'\w+', strip(re.sub(r'<script\b.*?</script>|<style\b.*?</style>', ' ', main.group(0) if main else body, flags=re.S))))
        links = set()
        for href in re.findall(r'<a\b[^>]*\bhref="([^"]+)"', body):
            u = urlsplit(href)
            if u.scheme in ('http', 'https') and u.netloc not in ('voltguard.com.tr', 'www.voltguard.com.tr'):
                continue
            if u.scheme and u.scheme not in ('http', 'https'):
                continue
            path = u.path
            if not path:
                continue
            if not path.startswith('/'):
                path = '/' + str((Path(rel).parent / path).as_posix()).lstrip('./')
            target = audit.resolve(path)
            if target.exists():
                links.add(target.resolve().relative_to(ROOT).as_posix())
        pages[rel] = dict(rel=rel, url=page_url(rel), title=title, h1=h1, canonical=canon,
                          noindex=noindex, words=words, out=links - {rel})
    inbound = collections.defaultdict(set)
    for rel, p in pages.items():
        for t in p['out']:
            if t in pages:
                inbound[t].add(rel)
    sm = sitemap_urls()
    for rel, p in pages.items():
        p['in'] = inbound[rel]
        p['sitemap'] = p['url'] in sm or ('/' + rel) in sm
        hay = ' '.join((p['title'], p['h1'], rel)).lower()
        p['topics'] = [k for k, rx in TOPICS.items() if re.search(rx, hay)]
    return pages


def tokens(s):
    return set(w for w in re.findall(r'[a-zçğıöşü0-9]+', s.lower()) if w not in STOP and len(w) > 2)


def main():
    ap = argparse.ArgumentParser(description='VoltGuard SEO URL envanteri')
    ap.add_argument('--csv')
    ap.add_argument('--topic')
    a = ap.parse_args()
    pages = collect()
    if a.csv:
        with open(a.csv, 'w', newline='', encoding='utf-8-sig') as fh:
            w = csv.writer(fh)
            w.writerow(['url', 'dosya', 'title', 'h1', 'canonical', 'noindex', 'sitemap', 'kelime', 'gelen', 'giden', 'konu'])
            for p in sorted(pages.values(), key=lambda p: p['url']):
                w.writerow([p['url'], p['rel'], p['title'], p['h1'], p['canonical'], p['noindex'], p['sitemap'],
                            p['words'], len(p['in']), len(p['out']), ' '.join(p['topics'])])
        print('yazildi %s (%d sayfa)' % (a.csv, len(pages)))
        return
    if a.topic:
        group = [p for p in pages.values() if a.topic in p['topics']]
        names = {p['rel'] for p in group}
        for p in sorted(group, key=lambda p: p['url']):
            print('%-58s gelen %3d  kume-ici-giden: %s' % (p['url'], len(p['in']), ', '.join(sorted(page_url(x) for x in p['out'] & names)) or '-'))
        return
    print('Sayfa: %d (ozel calisan/ ve hesap/ haric)' % len(pages))
    print('\n## Konu kumeleri')
    for k in TOPICS:
        print('%-24s %d sayfa' % (k, sum(k in p['topics'] for p in pages.values())))
    print('\n## Icerikten hic baglanti almayan indekslenebilir sayfalar (yalniz menu/footer)')
    for p in sorted(pages.values(), key=lambda p: p['url']):
        if not p['in'] and not p['noindex'] and p['url'] != '/':
            print('  %s  %s' % (p['url'], '(sitemap)' if p['sitemap'] else '(sitemap DISI)'))
    print('\n## Olasi tekrar: ayni kumede, baslik/H1 kelimeleri >= %60 ortak')
    for x, y in itertools.combinations(sorted(pages.values(), key=lambda p: p['url']), 2):
        if not set(x['topics']) & set(y['topics']):
            continue
        tx, ty = tokens(x['title'] + ' ' + x['h1']), tokens(y['title'] + ' ' + y['h1'])
        if tx and ty and len(tx & ty) / min(len(tx), len(ty)) >= 0.6:
            print('  %s  <->  %s' % (x['url'], y['url']))


if __name__ == '__main__':
    main()

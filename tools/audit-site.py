#!/usr/bin/env python3
"""Check every published first-party HTML page without crawling private data."""
import argparse
import collections
import json
import re
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = 'https://voltguard.com.tr'
NEWS_SNAPSHOT = ROOT / 'tools/data/home-directory-volthaber.json'
PUBLISHED_ARTICLES = {entry['u'] for entry in json.loads(NEWS_SNAPSHOT.read_text(encoding='utf-8'))['entries']} if NEWS_SNAPSHOT.is_file() else set()
DIRECTORIES = ['akademi', 'araclar', 'bilgi', 'calisan', 'hesap', 'hesaplama', 'hizmetler', 'mm', 'sor', 'voltsim']


class Page(HTMLParser):
    def __init__(self, file):
        super().__init__(convert_charrefs=True)
        self.file = file
        self.ids = []
        self.refs = []
        self.meta = {}
        self.lang = ''
        self.canonicals = []
        self.title = ''
        self.in_title = False
        self.h1 = 0
        self.base = ORIGIN + '/' + file.relative_to(ROOT).as_posix()
        self.feed(file.read_text(encoding='utf-8-sig'))

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get('id'):
            self.ids.append(a['id'])
        if tag == 'html':
            self.lang = a.get('lang', '')
        if tag == 'base' and a.get('href'):
            self.base = urljoin(self.base, a['href'])
        if tag == 'meta':
            self.meta[a.get('name', a.get('property', ''))] = a.get('content', '')
        if tag == 'link' and a.get('rel') == 'canonical':
            self.canonicals.append(a.get('href', ''))
        if tag == 'title':
            self.in_title = True
        if tag == 'h1':
            self.h1 += 1
        for attr in ('src', 'href', 'poster', 'data-src', 'data-poster', 'data-poster-lg'):
            if a.get(attr) and not (tag == 'link' and a.get('rel') == 'canonical'):
                self.refs.append((tag, attr, a[attr], self.getpos()[0]))

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data


def page_files():
    files = list(ROOT.glob('*.html'))
    for directory in DIRECTORIES:
        files.extend(file for file in (ROOT / directory).rglob('*.html')
                     if 'uygulama' not in file.relative_to(ROOT).parts and not file.name.startswith('shared-'))
    return sorted(set(files))


def resolve(path):
    if path.rstrip('/') == '/hesaplama-araclari':
        return ROOT / 'teklif-araclari.html'
    file = ROOT / path.lstrip('/')
    if file.is_dir():
        return file / 'index.html'
    if file.exists():
        return file
    # Public articles are PHP routes backed by the published snapshot, not one
    # physical HTML file per slug. Unknown article paths still fail the audit.
    if path in PUBLISHED_ARTICLES and (ROOT / 'volthaber/index.php').is_file():
        return ROOT / 'volthaber/index.php'
    if not file.suffix:
        return file.with_suffix('.html')
    return file


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    pages = {file: Page(file) for file in page_files()}
    findings = []
    sitemap = {item.text for item in ET.parse(ROOT / 'sitemap.xml').getroot().iter()
               if item.tag.endswith('}loc')}

    def issue(file, kind, detail, line=None):
        findings.append(dict(file=file.relative_to(ROOT).as_posix(), kind=kind, detail=detail, line=line))

    for file, page in pages.items():
        private = file.relative_to(ROOT).parts[0] in ('hesap', 'calisan')
        if not page.lang.startswith('tr'):
            issue(file, 'lang', page.lang)
        if not page.title.strip():
            issue(file, 'title', 'Missing title')
        # Password reset has mutually exclusive request/reset views.
        if page.h1 != 1 and file != ROOT / 'hesap/sifre-sifirla.html':
            issue(file, 'h1', page.h1)
        if not page.meta.get('description'):
            issue(file, 'description', 'Missing description')
        if private and 'noindex' not in page.meta.get('robots', ''):
            issue(file, 'private-index', 'Private page must be noindex')
        if not private and file.name != '404.html':
            if len(page.canonicals) != 1:
                issue(file, 'canonical', page.canonicals)
            # noindex pages (search, game) must stay out of the sitemap.
            elif page.canonicals[0] not in sitemap and 'noindex' not in page.meta.get('robots', ''):
                issue(file, 'sitemap', page.canonicals[0])
        for id, count in collections.Counter(page.ids).items():
            if count > 1:
                issue(file, 'duplicate-id', id)
        for tag, attr, href, line in page.refs:
            url = urlsplit(urljoin(page.base, href))
            if url.netloc != 'voltguard.com.tr' or url.scheme != 'https':
                continue
            target = resolve(unquote(url.path))
            # PHP endpoints and staff gate are validated by isolated API tests.
            if target.suffix == '.php' or url.path.rstrip('/') == '/calisan':
                continue
            if not target.is_file():
                issue(file, 'missing-local', href, line)
            elif tag == 'a' and url.fragment and target in pages:
                fragment = unquote(url.fragment)
                if fragment not in pages[target].ids:
                    issue(file, 'missing-fragment', href, line)
    out = ROOT / '.qa/site-audit'
    out.mkdir(parents=True, exist_ok=True)
    report = dict(pages=len(pages), htmlLines=sum(len(p.read_text(encoding='utf-8-sig').splitlines()) for p in pages),
                  routes=[p.canonicals[0] if p.canonicals else p.base for p in pages.values()], findings=findings)
    (out / 'source.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(dict(pages=report['pages'], htmlLines=report['htmlLines'], findings=len(findings),
                          byKind=dict(collections.Counter(i['kind'] for i in findings))), ensure_ascii=False))
    for finding in findings[:60]:
        print(json.dumps(finding, ensure_ascii=False))
    return 1 if args.check and findings else 0


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/shell.py - VoltGuard ortak sayfa kabugu (header / footer / <head>) isleyicisi
==============================================================================

NE YAPAR
  Sitedeki her *.html dosyasinda su uc bolgeyi tek kaynaktan (tools/shell/*.html) uretir:

    <!--vg:head-->    ... <!--/vg:head-->      tools/shell/head.html   (theme-color, preconnect,
                                                speculationrules, /css/vg-shell.css, /js/vg-shell.js)
    <!--vg:header-->  ... <!--/vg:header-->    tools/shell/header.html (skip link + tek site basligi)
    <!--vg:footer-->  ... <!--/vg:footer-->    tools/shell/footer.html (tek alt bilgi)

  - Isaretciler yoksa ilk calistirmada eski header/footer blogunun yerine eklenir; header hic yoksa
    <body> acilisinin hemen arkasina, footer hic yoksa </main>'in arkasina eklenir.
  - Isaretciler varsa aradaki her sey yeniden uretilir (elle degisiklik EZILIR: kaynagi duzenleyin).
  - Header icindeki baglantilarda aria-current ayarlanir: tam eslesme "page", bolum eslesmesi
    (data-vg-match onegi; ornegin /bilgi/ altindaki makale -> Bilgi Bankasi) "true".
    Temiz URL sayfalari (/hesaplama/<slug>/ ve /hesaplama-araclari/) da dogru eslesir.
  - <main> bulunur ve id="main" tabindex="-1" alir (skip link hedefi). <main> yoksa header ile footer
    isaretcileri arasindaki icerik <main id="main"> icine sarilir.
  - Sayfada <base href> varsa skip link href'i "#main" yerine sayfanin kendi adresi + "#main" olur
    (aksi halde <base href="/"> altinda "#main" ana sayfaya giderdi).
  - <head>: sayfada Google Fonts / Font Awesome yoksa (404, gizlilik) bloga eklenir; tekrar eden
    theme-color / preconnect / speculationrules / vg-shell referanslari blok disindan temizlenir.
  - Idempotenttir: ikinci calistirma hicbir dosyayi degistirmez. BOM ve satir sonu (LF/CRLF)
    her dosyada oldugu gibi korunur; sadece degisen dosyalar yazilir.

KULLANIM
  python tools/shell.py                  tum sayfalari isle
  python tools/shell.py --check          yazmadan, degisecek dosyalari listele (degisen varsa cikis 1)
  python tools/shell.py hesap/giris.html bilgi/topraklama.html     yalnizca verilen dosyalar
  python tools/shell.py --quiet          yalnizca ozet yazdir

YENI SAYFA EKLEMEK
  Sayfanin <head>'ine <!--vg:head--><!--/vg:head-->, <body>'sine <!--vg:header--><!--/vg:header-->,
  </main>'den sonrasina <!--vg:footer--><!--/vg:footer--> yazin (ya da hic yazmayin: script ekler)
  ve scripti calistirin. Sayfa icerigini <main> icine koyun. Basligi/alt bilgiyi/menuyu degistirmek
  icin yalnizca tools/shell/header.html | footer.html | head.html dosyalarini duzenleyip scripti
  yeniden calistirin; menu href'leri KOK-MUTLAK (/akademi.html) oldugu icin her derinlikte calisir.
  Stil: css/vg-shell.css, davranis: js/vg-shell.js. tools/ klasoru (parcalar) taranmaz.
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHELL_DIR = ROOT / 'tools' / 'shell'
SKIP_DIRS = {'.git', '.github', 'node_modules', 'tools', '__pycache__', '.vscode', '.idea', '.netlify'}

FONTS_LINK = ('<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800'
              '&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">')
FA_LINK = ('<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" '
           'integrity="sha512-DTOQO9RWCH3ppGqcWaEA1BIZOC6xxalwEsw9c2QQeAIftl+Vegovlnee1c9QX4TctnWMn13TZye+giMm8e2LwA==" '
           'crossorigin="anonymous" referrerpolicy="no-referrer">')

FLAGS = re.S | re.I
NUL = chr(0)  # gecici yer tutucu ayiraci


def region_re(name):
    return re.compile(r'<!--vg:%s-->.*?<!--/vg:%s-->' % (name, name), re.S)


HEAD_RE, HEADER_RE, FOOTER_RE = region_re('head'), region_re('header'), region_re('footer')


# --------------------------------------------------------------------------- yardimcilar
def canon(p):
    """vg-shell.js icindeki canon() ile birebir ayni kural."""
    p = re.sub(r'/index\.html$', '/', p or '/')
    p = re.sub(r'\.html$', '', p)
    p = re.sub(r'/+$', '', p) or '/'
    return '/hesaplama-araclari' if p == '/teklif-araclari' else p


def page_url(rel):
    """Dosya yolu -> yayindaki (temiz) URL."""
    if rel == 'index.html':
        return '/'
    if rel == 'teklif-araclari.html':
        return '/hesaplama-araclari/'
    if re.match(r'^hesaplama/[^/]+\.html$', rel):
        return '/' + rel[:-5] + '/'
    return '/' + rel


def line_indent(t, pos):
    """pos'un bulundugu satirin bas bosluklari."""
    start = t.rfind('\n', 0, pos) + 1
    return re.match(r'[ \t]*', t[start:]).group(0)


def indent_block(block, indent):
    """Ilk satir yer tutucunun mevcut girintisini kullanir; sonraki satirlara girinti eklenir."""
    lines = block.split('\n')
    return '\n'.join([lines[0]] + [(indent + l) if l.strip() else l for l in lines[1:]])


def load_fragment(name):
    return (SHELL_DIR / name).read_text(encoding='utf-8').replace('\r\n', '\n').strip('\n')


def tag_attr(tag, name):
    m = re.search(r'\b%s\s*=\s*("([^"]*)"|\'([^\']*)\')' % re.escape(name), tag, re.I)
    if not m:
        return None
    return m.group(2) if m.group(2) is not None else m.group(3)


def strip_line(text, pattern, flags=FLAGS):
    """pattern eslesmelerini siler; satirda baska icerik yoksa satirin tamamini (satir sonuyla) kaldirir."""
    out, pos = '', 0
    for m in re.finditer(pattern, text, flags):
        s, e = m.start(), m.end()
        ls = text.rfind('\n', 0, s) + 1
        le = text.find('\n', e)
        le = len(text) if le < 0 else le
        if not text[ls:s].strip() and not text[e:le].strip():
            s, e = ls, min(le + 1, len(text))
        else:
            while e < len(text) and text[e] in ' \t':
                e += 1
        if s >= pos:
            out += text[pos:s]
            pos = e
    return out + text[pos:]


def drop_preceding_comment(t, start, words):
    """start'tan hemen once gelen tek satirlik <!-- ... --> yorumu (words'ten birini iceriyorsa) sil."""
    ls = t.rfind('\n', 0, start) + 1
    prev_end = ls - 1
    if prev_end <= 0:
        return t
    ps = t.rfind('\n', 0, prev_end) + 1
    line = t[ps:prev_end]
    if re.match(r'^\s*<!--.*-->\s*$', line) and any(w in line.lower() for w in words):
        return t[:ps] + t[ls:]
    return t


# --------------------------------------------------------------------------- aria-current
def set_current(html, rel):
    here = canon('/' + rel)
    raw_path = '/' + rel

    def fix(m):
        tag = m.group(0)
        href = tag_attr(tag, 'href')
        if not href or not href.startswith('/') or '#' in href:
            return tag
        sec = tag_attr(tag, 'data-vg-match')
        cur = None
        if canon(href.split('?')[0]) == here:
            cur = 'page'
        elif sec and raw_path.startswith(sec):
            cur = 'true'
        if not cur:
            return tag
        return tag[:-1] + ' aria-current="%s">' % cur

    return re.sub(r'<a\b[^>]*>', fix, html)


# --------------------------------------------------------------------------- <head>
def build_head_block(head_outside):
    frag = load_fragment('head.html')
    extras = []
    # Fonts and icons are self-hosted (css/fonts.css, css/fa-subset.css in head.html); CDN links are no longer added.
    joined = head_outside + '\n'.join(extras)
    pre = []
    if 'fonts.googleapis.com' in joined:
        pre.append('<link rel="preconnect" href="https://fonts.googleapis.com">')
        pre.append('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>')
    if 'cdnjs.cloudflare.com' in joined:
        pre.append('<link rel="preconnect" href="https://cdnjs.cloudflare.com" crossorigin>')
    frag = frag.replace('<!--@preconnect-->', '\n'.join(pre)).replace('<!--@extras-->', '\n'.join(extras))
    lines = [l for l in frag.split('\n') if l.strip()]
    return '<!--vg:head-->\n' + '\n'.join(lines) + '\n<!--/vg:head-->'


def apply_head(t, warnings):
    he = t.find('</head>')
    hm = re.search(r'<head\b', t, re.I)
    hs = hm.start() if hm else -1
    if hs < 0 or he < 0:
        warnings.append('<head> bulunamadi')
        return t
    head, rest = t[hs:he], t[he:]
    ph = NUL + 'VGHEAD' + NUL
    m = HEAD_RE.search(head)
    if m:
        head = head[:m.start()] + ph + head[m.end():]
    # blok disindaki tekrarlari temizle
    head = strip_line(head, r'<meta\s+name=["\']theme-color["\'][^>]*>')
    head = strip_line(head, r'<!--[^>]*?speculation[^>]*?-->[ \t]*\n?[ \t]*<script\s+type=["\']speculationrules["\'][^>]*>.*?</script>')
    head = strip_line(head, r'<script\s+type=["\']speculationrules["\'][^>]*>.*?</script>')
    head = strip_line(head, r'<link\s+rel=["\']preconnect["\']\s+href=["\']https://(?:fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com)/?["\'][^>]*>')
    head = strip_line(head, r'<link\s+[^>]*href=["\'][^"\']*vg-shell\.css[^"\']*["\'][^>]*>')
    head = re.sub(r'[ \t]*<noscript>\s*<link[^>]*font-awesome[^>]*>\s*</noscript>[ \t]*\r?\n?', '', head, flags=FLAGS)
    head = strip_line(head, r'<link\b[^>]*fonts\.googleapis\.com/css[^>]*>')
    head = strip_line(head, r'<link\b[^>]*font-awesome[^>]*>')
    head = strip_line(head, r'<script\s+[^>]*src=["\'][^"\']*vg-shell\.js[^"\']*["\'][^>]*>\s*</script>')
    block = build_head_block(head.replace(ph, ''))
    if ph in head:
        ind = line_indent(head, head.index(ph))
        head = head.replace(ph, indent_block(block, ind))
    else:
        # yerlesim: <base> / viewport / charset etiketlerinin en sonuncusunun hemen arkasi (yoksa <head> arkasi)
        cands = []
        for pat in (r'<base\b[^>]*>', r'<meta\s+name=["\']viewport["\'][^>]*>', r'<meta\s+charset[^>]*>'):
            cands.extend(re.finditer(pat, head, re.I))
        if cands:
            last = max(cands, key=lambda mm: mm.end())
            pos, ind = last.end(), line_indent(head, last.start())
        else:
            pos, ind = re.match(r'<head[^>]*>', head, re.I).end(), '  '
        head = head[:pos] + '\n' + ind + indent_block(block, ind) + head[pos:]
    return t[:hs] + head + rest


# --------------------------------------------------------------------------- header
def find_legacy_header(t):
    for m in re.finditer(r'<header\b[^>]*>.*?</header>', t, FLAGS):
        open_tag = re.match(r'<header\b[^>]*>', m.group(0), re.I).group(0)
        cls = set((tag_attr(open_tag, 'class') or '').split())
        if {'doc-header', 'header', 'vg-header'} & cls or tag_attr(open_tag, 'id') in ('header', 'vgHeader'):
            return m
    return None


def apply_header(t, rel, warnings):
    frag = load_fragment('header.html')
    skip_href = '#main'
    head_part = t[:t.find('</head>')] if '</head>' in t else ''
    if re.search(r'<base\b[^>]*\bhref\s*=', head_part, re.I):
        skip_href = page_url(rel) + '#main'
    frag = frag.replace('href="#main"', 'href="%s"' % skip_href, 1)
    frag = set_current(frag, rel)

    ph = NUL + 'VGHDR' + NUL
    m = HEADER_RE.search(t)
    if m:
        t = t[:m.start()] + ph + t[m.end():]
    else:
        lm = find_legacy_header(t)
        if lm:
            t = drop_preceding_comment(t, lm.start(), ('header', 'başlık'))
            lm = find_legacy_header(t)
            t = t[:lm.start()] + ph + t[lm.end():]
        else:
            bm = re.search(r'<body\b[^>]*>', t, re.I)
            if not bm:
                warnings.append('<body> bulunamadi')
                return t
            t = t[:bm.end()] + '\n  ' + ph + t[bm.end():]
    # blok disindaki eski skip link'leri temizle (index.html: #icerik)
    t = strip_line(t, r'<a\b[^>]*class=["\'][^"\']*skip-to-content[^"\']*["\'][^>]*>.*?</a>')
    ind = line_indent(t, t.index(ph))
    block = '<!--vg:header-->\n' + frag + '\n<!--/vg:header-->'
    return t.replace(ph, indent_block(block, ind))


# --------------------------------------------------------------------------- footer / main
def legacy_footer(text):
    main_end = -1
    for mm in re.finditer(r'</main>', text, re.I):
        main_end = mm.end()
    found = [fm for fm in re.finditer(r'<footer\b[^>]*>.*?</footer>', text, FLAGS) if fm.start() >= main_end]
    return (found[-1] if found else None), main_end


def apply_footer(t, warnings):
    frag = load_fragment('footer.html')
    block = '<!--vg:footer-->\n' + frag + '\n<!--/vg:footer-->'
    ph = NUL + 'VGFTR' + NUL
    m = FOOTER_RE.search(t)
    if m:
        t = t[:m.start()] + ph + t[m.end():]
    else:
        legacy, main_end = legacy_footer(t)
        if legacy:
            t = drop_preceding_comment(t, legacy.start(), ('footer', 'alt bilgi'))
            legacy, main_end = legacy_footer(t)
            t = t[:legacy.start()] + ph + t[legacy.end():]
        elif main_end >= 0:
            t = t[:main_end] + '\n\n  ' + ph + t[main_end:]
        else:
            bm = list(re.finditer(r'</body>', t, re.I))
            if not bm:
                warnings.append('</body> bulunamadi (footer eklenemedi)')
                return t
            at = bm[-1].start()
            t = t[:at].rstrip(' \t') + '  ' + ph + '\n' + t[at:]
    ind = line_indent(t, t.index(ph))
    return t.replace(ph, indent_block(block, ind))


def apply_main(t, warnings):
    m = re.search(r'<main\b([^>]*)>', t, re.I)
    if m:
        attrs = m.group(1)
        if re.search(r'\bid\s*=', attrs, re.I):
            attrs = re.sub(r'\bid\s*=\s*("[^"]*"|\'[^\']*\')', 'id="main"', attrs, count=1, flags=re.I)
        else:
            attrs = attrs.rstrip() + ' id="main"'
        if not re.search(r'\btabindex\s*=', attrs, re.I):
            attrs = attrs.rstrip() + ' tabindex="-1"'
        return t[:m.start()] + '<main%s>' % attrs + t[m.end():]
    # <main> yok: header ve footer isaretcileri arasini sar
    he = t.find('<!--/vg:header-->')
    fs = t.find('<!--vg:footer-->')
    if he < 0 or fs < 0 or fs < he:
        warnings.append('<main> yok ve header/footer isaretcileri sirali degil; sarilamadi')
        return t
    he += len('<!--/vg:header-->')
    inner = t[he:fs]
    if not inner.strip():
        warnings.append('<main> yok ve header/footer arasi bos')
        return t
    ind = line_indent(t, fs)
    return t[:he] + '\n' + ind + '<main id="main" tabindex="-1">' + inner.rstrip() + '\n' + ind + '</main>\n' + ind + t[fs:]


# --------------------------------------------------------------------------- dosya isleme
def process(path):
    raw = path.read_bytes()
    bom = raw.startswith(b'\xef\xbb\xbf')
    text = raw.decode('utf-8-sig')
    n_crlf = text.count('\r\n')
    n_lf = text.count('\n') - n_crlf
    crlf = n_crlf > n_lf
    t = text.replace('\r\n', '\n')
    rel = path.relative_to(ROOT).as_posix()
    warnings = []
    if '<html' not in t.lower() or '<body' not in t.lower():
        return None, None, ['atlandi: tam sayfa degil (parca)']
    t = apply_head(t, warnings)
    t = apply_header(t, rel, warnings)
    t = apply_footer(t, warnings)
    t = apply_main(t, warnings)
    out = t.replace('\n', '\r\n') if crlf else t
    data = out.encode('utf-8')
    if bom:
        data = b'\xef\xbb\xbf' + data
    return raw, data, warnings


def discover(args_files):
    if args_files:
        return [(Path(f) if Path(f).is_absolute() else Path.cwd() / f).resolve() for f in args_files]
    out = []
    for p in sorted(ROOT.rglob('*.html')):
        if set(p.relative_to(ROOT).parts[:-1]) & SKIP_DIRS:
            continue
        out.append(p)
    return out


def main():
    ap = argparse.ArgumentParser(description='VoltGuard ortak header/footer/head isleyicisi')
    ap.add_argument('files', nargs='*', help='yalnizca bu dosyalari isle (varsayilan: tum *.html)')
    ap.add_argument('--check', action='store_true', help='yazmadan degisecekleri listele; degisen varsa cikis kodu 1')
    ap.add_argument('--quiet', action='store_true')
    a = ap.parse_args()

    changed = unchanged = 0
    problems = []
    for p in discover(a.files):
        try:
            rel = p.relative_to(ROOT).as_posix()
        except ValueError:
            rel = str(p)
        raw, data, warns = process(p)
        for w in warns:
            problems.append('%s: %s' % (rel, w))
        if data is None:
            continue
        if data != raw:
            changed += 1
            if not a.check:
                p.write_bytes(data)
            if not a.quiet:
                print(('DEGISECEK ' if a.check else 'guncellendi ') + rel)
        else:
            unchanged += 1
    print('%s: %d dosya %s, %d degismedi' % ('check' if a.check else 'shell', changed,
                                             'degisecek' if a.check else 'guncellendi', unchanged))
    for pr in problems:
        print('UYARI', pr, file=sys.stderr)
    if a.check and changed:
        sys.exit(1)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/magaza/gorsel-hazirla.py - magaza urun gorselini yayina hazirlar
=====================================================================

Kaynak gorseli (uretici gorseli; kontrol edilmis, uzerinde baska site/magaza adi yok) beyaz kare zemine,
oranini bozmadan ortalar; meta veriyi (EXIF, konum, renk profili disi) atar ve iki WebP uretir:

    public/magaza/<slug>.<ozet8>.webp       800 x 800 (urun sayfasi)
    public/magaza/<slug>.<ozet8>-400.webp   400 x 400 (liste karti)

<ozet8> cikti iceriginin SHA-256 ozetidir: gorsel degisirse adres de degisir (sunucu gorselleri 1 yil
"immutable" onbellekte tutar). Cikti: katalog.json "images" ogesi olarak JSON satiri.

KULLANIM
  python tools/magaza/gorsel-hazirla.py <kaynak-dosya> <slug> --alt "Marka Model ... onden gorunum"
  python tools/magaza/gorsel-hazirla.py --check            public/magaza altindaki dosyalari dogrular

Kaynak dosya indirilen, guvenilmeyen veridir: yalnizca Pillow ile acilir, hicbir sekilde calistirilmaz.
Seffaf zeminli gorseller beyaz zemine yerlestirilir. Cok kucuk (kisa kenari 300 pikselden az) kaynak reddedilir.
"""
import argparse
import hashlib
import io
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / 'public' / 'magaza'
SIZES = (800, 400)
MIN_SIDE = 300
PAD = 0.06  # urun kenara yapismasin
Image.MAX_IMAGE_PIXELS = 60_000_000  # dekompresyon bombasina karsi


def flatten(img):
    img = ImageOps.exif_transpose(img)
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        img = img.convert('RGBA')
        bg = Image.new('RGBA', img.size, (255, 255, 255, 255))
        bg.alpha_composite(img)
        return bg.convert('RGB')
    return img.convert('RGB')


def trim_white(img, tol=12):
    """Kenarlardaki duz beyaz/acik zemini kirpar (urun tum kareyi kullansin)."""
    gray = img.convert('L')
    mask = gray.point(lambda v: 255 if v < 255 - tol else 0)
    box = mask.getbbox()
    return img.crop(box) if box else img


def square(img, size):
    inner = int(round(size * (1 - 2 * PAD)))
    copy = img.copy()
    copy.thumbnail((inner, inner), Image.LANCZOS)
    canvas = Image.new('RGB', (size, size), (255, 255, 255))
    canvas.paste(copy, ((size - copy.width) // 2, (size - copy.height) // 2))
    return canvas


def encode(img):
    buf = io.BytesIO()
    img.save(buf, 'WEBP', quality=82, method=6)
    return buf.getvalue()


def prepare(src, slug, alt):
    if not re.fullmatch(r'[a-z0-9-]{3,90}', slug):
        raise SystemExit('slug yalnizca a-z, 0-9 ve - icerebilir (3-90 karakter)')
    if not (8 <= len(alt) <= 160):
        raise SystemExit('--alt 8-160 karakter olmali')
    with Image.open(src) as raw:
        raw.load()
        img = flatten(raw)
    if min(img.size) < MIN_SIDE:
        raise SystemExit('kaynak gorsel cok kucuk: %dx%d' % img.size)
    img = trim_white(img)
    big = encode(square(img, SIZES[0]))
    small = encode(square(img, SIZES[1]))
    digest = hashlib.sha256(big).hexdigest()[:8]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    name = '%s.%s' % (slug, digest)
    (OUT_DIR / (name + '.webp')).write_bytes(big)
    (OUT_DIR / (name + '-400.webp')).write_bytes(small)
    return {'src': '/public/magaza/%s.webp' % name, 'thumb': '/public/magaza/%s-400.webp' % name,
            'w': SIZES[0], 'h': SIZES[0], 'alt': alt}


def check():
    bad = []
    for f in sorted(OUT_DIR.glob('*.webp')):
        m = re.fullmatch(r'([a-z0-9-]{3,90})\.([0-9a-f]{8})(-400)?\.webp', f.name)
        if not m:
            bad.append('%s: dosya adi kurala uymuyor' % f.name)
            continue
        with Image.open(f) as im:
            want = 400 if m.group(3) else 800
            if im.format != 'WEBP' or im.size != (want, want):
                bad.append('%s: %s %s (beklenen WEBP %dx%d)' % (f.name, im.format, im.size, want, want))
        if not m.group(3) and hashlib.sha256(f.read_bytes()).hexdigest()[:8] != m.group(2):
            bad.append('%s: icerik ozeti adla eslesmiyor' % f.name)
    for line in bad:
        print('HATA', line)
    print('gorsel kontrolu: %d sorun' % len(bad))
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser(description='Magaza urun gorselini yayina hazirlar')
    ap.add_argument('source', nargs='?')
    ap.add_argument('slug', nargs='?')
    ap.add_argument('--alt', default='')
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    if a.check:
        sys.exit(check())
    if not a.source or not a.slug:
        ap.error('kaynak dosya ve slug gerekli')
    print(json.dumps(prepare(Path(a.source), a.slug, a.alt.strip()), ensure_ascii=False))


if __name__ == '__main__':
    main()

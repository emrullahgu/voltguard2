"""Toplu urun gorseli araclari (gelistirici araci; sunucuya kopyalanmaz).

  python tools/magaza/gorsel-toplu.py indir <liste.jsonl>     # {"url": ...} satirlari -> <onbellek>/gorsel-ham/
  python tools/magaza/gorsel-toplu.py ortalama <alan> [--adet 120]
        # tedarikcinin gorsellerinin ortalamasi: sabit filigran/logo ortalamada belirginlesir -> <onbellek>/filigran/
  python tools/magaza/gorsel-toplu.py hazirla <is.jsonl>       # {"key","url","slug"} -> medya deposu WebP + sonuc
  python tools/magaza/gorsel-toplu.py pafta <is.jsonl> <cikti-klasoru> [--sutun 6 --satir 5]
        # gorsel inceleme paftalari (numarali kareler) + paftaN.json (numara -> anahtar)

Indirilen dosyalar guvenilmeyen veridir: yalnizca Pillow ile acilir. Alan basina en az 1 sn aralik, durust bot kimligi.
Medya deposu: VG_MAGAZA_MEDIA (varsayilan %LOCALAPPDATA%/VoltGuard/magaza-gorsel); yayin adresi /magaza-gorsel/<2 hex>/
<slug>.<8 hex>.webp ve -t.webp (kucuk). Ozet, buyuk dosyanin SHA-256 ozetinin ilk 8 hanesi.
"""
import argparse
import hashlib
import io
import json
import os
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

from PIL import Image, ImageDraw, ImageFont, ImageOps

UA = 'Mozilla/5.0 (compatible; VoltGuardFiyat/1.0; +https://voltguard.com.tr/magaza/)'
CACHE = os.environ.get('VG_TARAMA_DIR') or os.path.join(os.environ.get('LOCALAPPDATA', os.path.expanduser('~')),
                                                       'VoltGuard', 'magaza-tarama')
MEDIA = os.environ.get('VG_MAGAZA_MEDIA') or os.path.join(os.environ.get('LOCALAPPDATA', os.path.expanduser('~')),
                                                         'VoltGuard', 'magaza-gorsel')
RAW = os.path.join(CACHE, 'gorsel-ham')
MAX_BYTES = 8 * 1024 * 1024
SIZES = (640, 320)
MIN_SIDE = 250
PAD = 0.06
Image.MAX_IMAGE_PIXELS = 60_000_000


def raw_path(url):
    return os.path.join(RAW, hashlib.sha1(url.encode('utf8')).hexdigest()[:2], hashlib.sha1(url.encode('utf8')).hexdigest() + '.bin')


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('cok buyuk')
    return data


def cmd_indir(a):
    rows = [json.loads(l) for l in open(a.liste, encoding='utf8') if l.strip()]
    by_host = defaultdict(list)
    for r in rows:
        u = r['url']
        if os.path.exists(raw_path(u)):
            continue
        by_host[urllib.parse.urlsplit(u).netloc.lower()].append(u)
    log = open(os.path.join(CACHE, 'gorsel-indir.log'), 'a', encoding='utf8')
    lock = threading.Lock()
    stats = defaultdict(int)

    def worker(host):
        last = 0.0
        for u in by_host[host]:
            wait = a.aralik - (time.time() - last)
            if wait > 0:
                time.sleep(wait)
            last = time.time()
            try:
                data = fetch(u)
                p = raw_path(u)
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, 'wb') as f:
                    f.write(data)
                stats['ok'] += 1
            except Exception as e:
                stats['hata'] += 1
                with lock:
                    log.write(json.dumps({'url': u, 'error': str(e)[:120]}) + '\n')
    with ThreadPoolExecutor(min(48, len(by_host) or 1)) as ex:
        list(ex.map(worker, list(by_host)))
    print(json.dumps(dict(stats)), 'host', len(by_host))


def open_raw(url):
    p = raw_path(url)
    if not os.path.exists(p):
        return None
    try:
        with Image.open(p) as im:
            im.load()
            return flatten(im)
    except Exception:
        return None


def flatten(img):
    img = ImageOps.exif_transpose(img)
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        img = img.convert('RGBA')
        bg = Image.new('RGBA', img.size, (255, 255, 255, 255))
        bg.alpha_composite(img)
        return bg.convert('RGB')
    return img.convert('RGB')


def trim_white(img, tol=12):
    gray = img.convert('L')
    box = gray.point(lambda v: 255 if v < 255 - tol else 0).getbbox()
    return img.crop(box) if box else img


def square(img, size, pad=PAD):
    inner = int(round(size * (1 - 2 * pad)))
    copy = img.copy()
    copy.thumbnail((inner, inner), Image.LANCZOS)
    canvas = Image.new('RGB', (size, size), (255, 255, 255))
    canvas.paste(copy, ((size - copy.width) // 2, (size - copy.height) // 2))
    return canvas


def cmd_ortalama(a):
    """Tedarikci gorsellerini KIRPMADAN (ham cerceve) 256x256'ya olcekleyip ortalar; sabit konumlu filigran belirginlesir."""
    src = os.path.join(CACHE, 'ayristirma', a.alan + '.jsonl')
    urls = []
    for line in open(src, encoding='utf8'):
        r = json.loads(line)
        if r.get('images'):
            urls.append(r['images'][0])
    acc = None
    n = 0
    import array
    for u in urls:
        im = open_raw(u)
        if im is None:
            continue
        im = im.resize((256, 256), Image.BILINEAR)
        px = im.tobytes()
        if acc is None:
            acc = array.array('d', [0.0]) * len(px)
        for i, v in enumerate(px):
            acc[i] += v
        n += 1
        if n >= a.adet:
            break
    if not n:
        print(a.alan, 'gorsel yok')
        return
    avg = bytes(int(v / n) for v in acc)
    out = Image.frombytes('RGB', (256, 256), avg)
    # Kontrast: ortalamanin beyazdan farkini 4 kat buyut (soluk filigran gorunsun)
    boost = out.point(lambda v: max(0, 255 - (255 - v) * 4))
    os.makedirs(os.path.join(CACHE, 'filigran'), exist_ok=True)
    sheet = Image.new('RGB', (532, 276), (255, 255, 255))
    sheet.paste(out, (6, 14))
    sheet.paste(boost, (270, 14))
    ImageDraw.Draw(sheet).text((6, 1), f'{a.alan}  n={n}  (sol: ortalama, sag: 4x kontrast)', fill=(200, 0, 0))
    p = os.path.join(CACHE, 'filigran', a.alan + '.png')
    sheet.save(p)
    print(p, n)


def watermark(canvas, size):
    """Sahibin karari (29.10.2026): yayimlanan her gorsele VoltGuard filigrani eklenir ki baskalari kullanamasin.
    Sag alt kosede okunur bir 'voltguard.com.tr' yazisi + urunu kapatmayan, cok soluk, capraz bir VoltGuard yazisi."""
    base = canvas.convert('RGBA')
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    small = load_font(max(12, size // 26))
    text = 'voltguard.com.tr'
    box = draw.textbbox((0, 0), text, font=small)
    tw, th = box[2] - box[0], box[3] - box[1]
    x, y = size - tw - size // 40, size - th - size // 32
    draw.text((x + 1, y + 1), text, font=small, fill=(255, 255, 255, 150))
    draw.text((x, y), text, font=small, fill=(10, 32, 64, 170))
    diag = Image.new('RGBA', (size * 2, size // 4), (0, 0, 0, 0))
    big = load_font(max(20, size // 7))
    d2 = ImageDraw.Draw(diag)
    label = 'VoltGuard'
    b2 = d2.textbbox((0, 0), label, font=big)
    d2.text(((diag.width - (b2[2] - b2[0])) // 2, (diag.height - (b2[3] - b2[1])) // 2 - b2[1]), label, font=big,
            fill=(10, 32, 64, 22))
    diag = diag.rotate(30, expand=True, resample=Image.BICUBIC)
    layer.alpha_composite(diag, ((size - diag.width) // 2, (size - diag.height) // 2))
    return Image.alpha_composite(base, layer).convert('RGB')


def media_names(slug, big):
    digest = hashlib.sha256(big).hexdigest()[:8]
    shard = hashlib.md5(slug.encode('utf8')).hexdigest()[:2]
    return shard, f'{slug}.{digest}'


def cmd_hazirla(a):
    out = []
    for line in open(a.isler, encoding='utf8'):
        if not line.strip():
            continue
        job = json.loads(line)
        im = open_raw(job['url'])
        rec = {'key': job['key'], 'url': job['url']}
        if im is None:
            rec['error'] = 'acilamadi'
        elif min(im.size) < MIN_SIDE:
            rec['error'] = 'kucuk %dx%d' % im.size
        else:
            im = trim_white(im)
            if min(im.size) < 40:
                rec['error'] = 'bos gorsel'
            else:
                big = io.BytesIO()
                watermark(square(im, SIZES[0]), SIZES[0]).save(big, 'WEBP', quality=80, method=6)
                small = io.BytesIO()
                watermark(square(im, SIZES[1]), SIZES[1]).save(small, 'WEBP', quality=78, method=6)
                shard, name = media_names(job['slug'], big.getvalue())
                d = os.path.join(MEDIA, shard)
                os.makedirs(d, exist_ok=True)
                with open(os.path.join(d, name + '.webp'), 'wb') as f:
                    f.write(big.getvalue())
                with open(os.path.join(d, name + '-t.webp'), 'wb') as f:
                    f.write(small.getvalue())
                rec.update(src=f'/magaza-gorsel/{shard}/{name}.webp', thumb=f'/magaza-gorsel/{shard}/{name}-t.webp',
                           w=SIZES[0], h=SIZES[0], bytes=len(big.getvalue()) + len(small.getvalue()))
        out.append(rec)
    with open(a.cikti, 'w', encoding='utf8') as f:
        for r in out:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    print(sum(1 for r in out if 'src' in r), 'hazir,', sum(1 for r in out if 'error' in r), 'hata')


def load_font(size):
    for name in ('arialbd.ttf', 'arial.ttf', 'DejaVuSans-Bold.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def unsafe_images(urls):
    """Bozuk bir gorsel Pillow'u (yerel kodda) cokertebilir: once ayri bir surecte acmayi dener; cokerse tek tek
    deneyip coken gorselleri dondurur (pafta hucresi bos kalir, inceleme 'yer_tutucu' olarak reddeder)."""
    import subprocess
    code = ('import sys,json;sys.path.insert(0,sys.argv[1]);import importlib.util as u;'
            's=u.spec_from_file_location("g",sys.argv[2]);g=u.module_from_spec(s);s.loader.exec_module(g);'
            '[ (lambda i: i and i.thumbnail((64,64)))(g.open_raw(x)) for x in json.loads(sys.argv[3])]')
    here = os.path.abspath(__file__)

    def ok(batch):
        r = subprocess.run([sys.executable, '-c', code, os.path.dirname(here), here, json.dumps(batch)],
                           capture_output=True, timeout=120)
        return r.returncode == 0
    if ok(urls):
        return set()
    return {u for u in urls if not ok([u])}


def cmd_pafta(a):
    """Inceleme paftasi: her kare ham gorselin TAMAMI (kirpilmadan, oran korunarak), altinda numara ve kisa ad."""
    rows = [json.loads(l) for l in open(a.isler, encoding='utf8') if l.strip()]
    os.makedirs(a.cikti, exist_ok=True)
    per = a.sutun * a.satir
    tile, cap = a.kare, 34
    font, small = load_font(22), load_font(13)
    sheets = 0
    for s in range(0, len(rows), per):
        chunk = rows[s:s + per]
        name = os.path.join(a.cikti, f'pafta{sheets + 1:04d}')
        if os.path.exists(name + '.jpg') and os.path.exists(name + '.json'):
            sheets += 1  # onceki calismada yazildi (kesilen calismaya devam)
            continue
        bad = unsafe_images([r['url'] for r in chunk])
        sheet = Image.new('RGB', (a.sutun * tile, a.satir * (tile + cap)), (40, 40, 40))
        draw = ImageDraw.Draw(sheet)
        index = {}
        for i, r in enumerate(chunk):
            x, y = (i % a.sutun) * tile, (i // a.sutun) * (tile + cap)
            im = None if r['url'] in bad else open_raw(r['url'])
            cell = Image.new('RGB', (tile - 4, tile - 4), (255, 255, 255))
            if im is not None:
                im.thumbnail((tile - 4, tile - 4), Image.LANCZOS)
                cell.paste(im, ((tile - 4 - im.width) // 2, (tile - 4 - im.height) // 2))
            sheet.paste(cell, (x + 2, y + 2))
            n = i + 1
            draw.rectangle([x + 2, y + tile - 2, x + tile - 2, y + tile + cap - 2], fill=(255, 235, 59))
            draw.text((x + 6, y + tile), str(n), fill=(0, 0, 0), font=font)
            draw.text((x + 44, y + tile + 4), (r.get('label') or '')[:34], fill=(0, 0, 0), font=small)
            index[n] = r['key']
        sheets += 1
        sheet.save(name + '.jpg', quality=88)
        json.dump(index, open(name + '.json', 'w', encoding='utf8'), ensure_ascii=False)
    print(sheets, 'pafta')


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('indir')
    p.add_argument('liste')
    p.add_argument('--aralik', type=float, default=1.0)
    p = sub.add_parser('ortalama')
    p.add_argument('alan')
    p.add_argument('--adet', type=int, default=120)
    p = sub.add_parser('hazirla')
    p.add_argument('isler')
    p.add_argument('cikti')
    p = sub.add_parser('pafta')
    p.add_argument('isler')
    p.add_argument('cikti')
    p.add_argument('--sutun', type=int, default=5)
    p.add_argument('--satir', type=int, default=4)
    p.add_argument('--kare', type=int, default=300)
    a = ap.parse_args()
    {'indir': cmd_indir, 'ortalama': cmd_ortalama, 'hazirla': cmd_hazirla, 'pafta': cmd_pafta}[a.cmd](a)


if __name__ == '__main__':
    main()

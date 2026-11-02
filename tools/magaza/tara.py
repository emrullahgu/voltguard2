"""Tedarikci katalog taramasi (gelistirici araci; sunucuya kopyalanmaz).

Uygun bulunan tedarikcilerin herkese acik site haritalarindan urun adreslerini cikarir ve urun sayfalarini yerel
onbellege indirir. Fiyat/kimlik ayristirmasi sunucudaki ayristiriciyla yapilir (tools/magaza/toplu-ayristir.php).
Tedarikci alan adlari depoda TUTULMAZ: liste tools/magaza/ozel/tedarikci-inceleme.json dosyasindan (gitignore) okunur.

  python tools/magaza/tara.py kesif              # site haritalari -> <onbellek>/<alan>/urls.txt
  python tools/magaza/tara.py indir [--hiz 2] [--azami 6000] [--alan x.com]
                                                 # urun sayfalari -> <onbellek>/<alan>/sayfa/<sha1>.html.gz

Kurallar: durust bot kimligi, robots.txt (Disallow + Crawl-delay) uyulur, alan basina tek baglanti ve en az
1/hiz saniye aralik. Onbellek: %LOCALAPPDATA%/VoltGuard/magaza-tarama (VG_TARAMA_DIR ile degistirilebilir).
"""
import argparse
import gzip
import hashlib
import io
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from concurrent.futures import ThreadPoolExecutor

UA = 'Mozilla/5.0 (compatible; VoltGuardFiyat/1.0; +https://voltguard.com.tr/magaza/)'
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OZEL = os.path.join(ROOT, 'tools', 'magaza', 'ozel')
CACHE = os.environ.get('VG_TARAMA_DIR') or os.path.join(os.environ.get('LOCALAPPDATA', os.path.expanduser('~')),
                                                       'VoltGuard', 'magaza-tarama')
MAX_BYTES = 12 * 1024 * 1024
# Urun olmayan sayfalar (kategori, marka, blog, kurumsal); urun haritasi ayrilamayan sitelerde elemek icin.
NON_PRODUCT = re.compile(r'/(kategori|category|categories|marka|brand|brands|blog|haber|sayfa|page|pages|etiket|tag|'
                         r'hakkimizda|iletisim|sepet|uye|hesap|kampanya|sss|yardim)(/|$)', re.I)


def suppliers():
    data = json.load(open(os.path.join(OZEL, 'tedarikci-inceleme.json'), encoding='utf8'))
    assess = {a['domain']: a for a in data['assessment']}
    out = []
    for r in data['reputation']:
        a = assess.get(r['domain'], {})
        if r['verdict'] == 'UYGUN' and a.get('prices_visible') and a.get('reachable', True):
            out.append(r['domain'])
    return out


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Encoding': 'gzip',
                                               'Accept': 'text/html,application/xml;q=0.9,*/*;q=0.8'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read(MAX_BYTES + 1)
        final = resp.geturl()
        if resp.headers.get('Content-Encoding') == 'gzip' or raw[:2] == b'\x1f\x8b':
            raw = gzip.decompress(raw)
        return resp.status, final, raw


def base_for(domain):
    for pre in ('https://www.', 'https://'):
        try:
            status, final, _ = get(pre + domain + '/robots.txt', 20)
            p = urllib.parse.urlsplit(final)
            return f'{p.scheme}://{p.netloc}'
        except Exception:
            continue
    return 'https://' + domain


def robots(base):
    rp = urllib.robotparser.RobotFileParser()
    text = ''
    try:
        _, _, raw = get(base + '/robots.txt', 20)
        text = raw.decode('utf8', 'replace')
    except Exception:
        pass
    rp.parse(text.splitlines())
    maps = re.findall(r'(?im)^\s*sitemap:\s*(\S+)', text)
    return rp, maps


def locs(xml):
    return [urllib.parse.unquote(m.strip()) if False else m.strip()
            for m in re.findall(r'<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*</loc>', xml, re.S)]


def discover(domain):
    d = os.path.join(CACHE, domain)
    os.makedirs(d, exist_ok=True)
    base = base_for(domain)
    rp, maps = robots(base)
    if not maps:
        maps = [base + '/sitemap.xml']
    seen, queue, product_maps, urls = set(), list(maps), [], []
    other = []
    while queue and len(seen) < 400:
        sm = queue.pop(0)
        if sm in seen:
            continue
        seen.add(sm)
        try:
            _, _, raw = get(sm, 60)
        except Exception as e:
            print(f'  {domain}: harita okunamadi {sm}: {e}', file=sys.stderr)
            continue
        xml = raw.decode('utf8', 'replace')
        found = locs(xml)
        if '<sitemapindex' in xml:
            queue.extend(found)
            continue
        name = sm.lower()
        if re.search(r'product|urun', name):
            product_maps.append(sm)
            urls.extend(found)
        elif not re.search(r'categor|kategori|brand|marka|blog|page|sayfa|tag|etiket|image|haber|news|static', name):
            other.extend(found)
    if not urls:
        urls = [u for u in other if not NON_PRODUCT.search(urllib.parse.urlsplit(u).path)
                and urllib.parse.urlsplit(u).path.strip('/') != '']
    clean, dup = [], set()
    for u in urls:
        if u in dup or not u.startswith('http'):
            continue
        dup.add(u)
        if rp.can_fetch(UA, u):
            clean.append(u)
    delay = rp.crawl_delay(UA) or rp.crawl_delay('*') or 0
    with open(os.path.join(d, 'urls.txt'), 'w', encoding='utf8') as f:
        f.write('\n'.join(clean))
    meta = {'domain': domain, 'base': base, 'sitemaps': sorted(seen), 'productMaps': len(product_maps),
            'urls': len(clean), 'crawlDelay': delay}
    json.dump(meta, open(os.path.join(d, 'meta.json'), 'w', encoding='utf8'), indent=1)
    return meta


def cmd_kesif(args):
    doms = [args.alan] if args.alan else suppliers()
    with ThreadPoolExecutor(8) as ex:
        for m in ex.map(discover, doms):
            print(f"{m['domain']:32} urun={m['urls']:6} haritalar={m['productMaps']:3} gecikme={m['crawlDelay']}")


def page_path(domain, url):
    return os.path.join(CACHE, domain, 'sayfa', hashlib.sha1(url.encode('utf8')).hexdigest() + '.html.gz')


def crawl(domain, rate, limit, order, stop):
    d = os.path.join(CACHE, domain)
    meta = json.load(open(os.path.join(d, 'meta.json'), encoding='utf8'))
    urls = open(os.path.join(d, 'urls.txt'), encoding='utf8').read().split()
    if order:
        urls = order(domain, urls)
    urls = urls[:limit]
    spacing = max(1.0 / rate, float(meta.get('crawlDelay') or 0))
    os.makedirs(os.path.join(d, 'sayfa'), exist_ok=True)
    index_path = os.path.join(d, 'sayfalar.jsonl')
    done = set()
    if os.path.exists(index_path):
        for line in open(index_path, encoding='utf8'):
            try:
                done.add(json.loads(line)['url'])
            except Exception:
                pass
    todo = [u for u in urls if u not in done]
    fetched = errors = 0
    with open(index_path, 'a', encoding='utf8') as idx:
        last = 0.0
        for u in todo:
            if stop.is_set():
                break
            wait = spacing - (time.time() - last)
            if wait > 0:
                time.sleep(wait)
            last = time.time()
            rec = {'url': u, 't': int(last)}
            try:
                status, final, raw = get(u, 30)
                rec.update(status=status, final=final, bytes=len(raw))
                with gzip.open(page_path(domain, u), 'wb') as g:
                    g.write(raw)
                fetched += 1
            except urllib.error.HTTPError as e:
                rec.update(status=e.code)
                errors += 1
                if e.code in (429, 503):
                    time.sleep(30)
            except Exception as e:
                rec.update(status=0, error=str(e)[:120])
                errors += 1
            idx.write(json.dumps(rec, ensure_ascii=False) + '\n')
            idx.flush()
    return domain, fetched, errors, len(todo)


def cmd_indir(args):
    doms = [args.alan] if args.alan else suppliers()
    doms = [x for x in doms if os.path.exists(os.path.join(CACHE, x, 'urls.txt'))]
    order = None
    if args.oncelik and os.path.exists(args.oncelik):
        pri = json.load(open(args.oncelik, encoding='utf8'))

        def order(domain, urls):
            keep = pri.get(domain)
            if keep is None:
                return urls
            s = set(urls)
            return [u for u in keep if u in s]
    stop = threading.Event()
    with ThreadPoolExecutor(len(doms) or 1) as ex:
        futs = [ex.submit(crawl, x, args.hiz, args.azami, order, stop) for x in doms]
        try:
            for f in futs:
                dom, ok, err, total = f.result()
                print(f'{dom:32} indirilen={ok} hata={err} hedef={total}', flush=True)
        except KeyboardInterrupt:
            stop.set()


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    k = sub.add_parser('kesif')
    k.add_argument('--alan')
    i = sub.add_parser('indir')
    i.add_argument('--alan')
    i.add_argument('--hiz', type=float, default=1.0)
    i.add_argument('--azami', type=int, default=6000)
    i.add_argument('--oncelik', help='alan -> sirali URL listesi (JSON); verilmezse harita sirasi')
    a = ap.parse_args()
    {'kesif': cmd_kesif, 'indir': cmd_indir}[a.cmd](a)


if __name__ == '__main__':
    main()

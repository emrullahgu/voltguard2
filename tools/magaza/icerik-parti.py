"""Urun metni yazimi icin partiler hazirlar (gelistirici araci).

birlesik.jsonl'deki her urun grubu (haric tutulanlar ve metni zaten yazilanlar disinda) icin kisa bir girdi kaydi
olusturur ve <onbellek>/icerik/parti-NNNN.json dosyalarina boler. Tedarikci metni yalnizca olgu kaynagidir.

  python tools/magaza/icerik-parti.py [--boyut 40]
"""
import argparse
import collections
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tara import CACHE  # noqa: E402
from kategori_yolu_ortak import path_key_for  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--boyut', type=int, default=40)
    a = ap.parse_args()
    d = os.path.join(CACHE, 'icerik')
    os.makedirs(d, exist_ok=True)
    mapping = json.load(open(os.path.join(CACHE, 'kategori', 'esleme.json'), encoding='utf8'))
    excluded = set(json.load(open(os.path.join(CACHE, 'haric-anahtarlar.json'), encoding='utf8')))
    done = set()
    p = os.path.join(d, 'sonuc.jsonl')
    if os.path.exists(p):
        done = {json.loads(l)['k'] for l in open(p, encoding='utf8')}
    pending = set()
    for f in glob.glob(os.path.join(d, 'parti-*.json')):
        pending |= {e['k'] for e in json.load(open(f, encoding='utf8'))}
    start = len(glob.glob(os.path.join(d, 'parti-*.json')))
    items = []
    for line in open(os.path.join(CACHE, 'birlesik.jsonl'), encoding='utf8'):
        g = json.loads(line)
        if g['key'] in excluded or g['key'] in done or g['key'] in pending:
            continue
        offers = g['offers']
        leaves = collections.Counter(mapping.get(path_key_for(o), {}).get('leaf', 'URUN') for o in offers)
        leaves.pop('HARIC', None)
        hint = leaves.most_common(1)[0][0] if leaves else 'URUN'
        names = list(dict.fromkeys(o['name'] for o in offers if o['name']))[:3]
        facts = ' | '.join(x for x in dict.fromkeys((o.get('desc') or '')[:400] for o in offers[:2]) if x)
        specs = ' | '.join(x for x in dict.fromkeys((o.get('specs') or '')[:400] for o in offers[:2]) if x)
        items.append({'k': g['key'], 'names': names, 'brand': next((o['brand'] for o in offers if o['brand']), ''),
                      'model': next((o['model'] for o in offers if o['model']), ''),
                      'gtin': next((o['gtin'] for o in offers if o['gtin']), ''),
                      'crumbs': list(dict.fromkeys(' > '.join(o['crumbs'][-3:]) for o in offers if o['crumbs']))[:2],
                      'leafHint': hint, 'facts': (facts + (' || ' + specs if specs else ''))[:900],
                      'priceTry': round(offers[0]['gross'], 2), 'pack': g['key'].rsplit(':', 1)[-1]})
    items.sort(key=lambda e: (e['leafHint'], e['brand'], e['names'][0] if e['names'] else ''))
    n = 0
    for i in range(0, len(items), a.boyut):
        json.dump(items[i:i + a.boyut], open(os.path.join(d, f'parti-{start + n:04d}.json'), 'w', encoding='utf8'),
                  ensure_ascii=False)
        n += 1
    print(len(items), 'urun,', n, 'yeni parti (ilk numara', start, ')')


if __name__ == '__main__':
    main()

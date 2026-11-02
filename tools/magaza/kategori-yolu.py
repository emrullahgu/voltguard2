"""Tedarikci kategori izlerini (breadcrumb) magaza kategorilerine eslemek icin yardimci (gelistirici araci).

  python tools/magaza/kategori-yolu.py cikar [--parca 120]
      # <onbellek>/kategori/yollar-NNN.json: [{key, supplier, path, count, samples[]}] (henuz eslenmemis yollar)
  python tools/magaza/kategori-yolu.py durum
      # eslenen / eslenmeyen yol ve urun sayilari

Esleme sonuclari <onbellek>/kategori/esleme.json dosyasinda tutulur: {key: {"leaf": id|"URUN"|"HARIC", "why": ...}}.
Anahtar = '<alan> | <iz>'; iz, ana sayfa ve urun adi atilmis son uc halka.
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

from kategori_yolu_ortak import crumb_path as _crumb_path  # noqa: E402

DIR = os.path.join(CACHE, 'kategori')


def crumb_path(r):
    return _crumb_path(r.get('crumbs'), (r.get('offer') or {}).get('name') or r.get('h1'))


def path_key(supplier, path):
    return f'{supplier} | {path}'


def load_map():
    p = os.path.join(DIR, 'esleme.json')
    return json.load(open(p, encoding='utf8')) if os.path.exists(p) else {}


def collect():
    paths = collections.OrderedDict()
    for f in sorted(glob.glob(os.path.join(CACHE, 'ayristirma', '*.jsonl'))):
        dom = os.path.basename(f)[:-6]
        for line in open(f, encoding='utf8'):
            r = json.loads(line)
            if not r['offer']['ok']:
                continue
            path = crumb_path(r)
            k = path_key(dom, path)
            e = paths.setdefault(k, {'key': k, 'supplier': dom, 'path': path, 'count': 0, 'samples': []})
            e['count'] += 1
            if len(e['samples']) < 4:
                e['samples'].append(((r['offer']['name'] or r['h1'] or '')[:110]))
    return paths


def cmd_cikar(a):
    os.makedirs(DIR, exist_ok=True)
    for old in glob.glob(os.path.join(DIR, 'yollar-*.json')):
        os.remove(old)
    done = load_map()
    todo = [e for k, e in collect().items() if k not in done and e['path']]
    todo.sort(key=lambda e: (e['supplier'], e['path']))
    for i in range(0, len(todo), a.parca):
        json.dump(todo[i:i + a.parca], open(os.path.join(DIR, f'yollar-{i // a.parca:03d}.json'), 'w', encoding='utf8'),
                  ensure_ascii=False, indent=0)
    print(len(todo), 'eslenecek yol,', (len(todo) + a.parca - 1) // a.parca, 'parca')


def cmd_durum(a):
    done = load_map()
    c = collections.Counter()
    for k, e in collect().items():
        if not e['path']:
            c['izsiz_urun'] += e['count']
        elif k in done:
            c['eslenen_urun'] += e['count']
            c['leaf:' + ('URUN' if done[k]['leaf'] == 'URUN' else 'HARIC' if done[k]['leaf'] == 'HARIC' else 'yaprak')] += e['count']
        else:
            c['eslenmeyen_urun'] += e['count']
            c['eslenmeyen_yol'] += 1
    print(json.dumps(c, ensure_ascii=False, indent=1))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('cikar')
    p.add_argument('--parca', type=int, default=120)
    sub.add_parser('durum')
    a = ap.parse_args()
    {'cikar': cmd_cikar, 'durum': cmd_durum}[a.cmd](a)


if __name__ == '__main__':
    main()

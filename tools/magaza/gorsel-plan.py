"""Urun gorseli secim turlari (gelistirici araci; sunucuya kopyalanmaz).

Her urun grubu icin aday gorseller (tedarikcilerin urun gorselleri) sirayla incelenir: tur 1'de ilk aday, reddedilenler
icin tur 2'de siradaki aday... Inceleme gorsel paftalari uzerinde yapilir (gorsel-toplu.py pafta). Durum:
<onbellek>/gorsel/durum.json {key: {"tried": [url...], "ok": url|null, "red": [{url, sebep}]}}.

  python tools/magaza/gorsel-plan.py tur [--azami-aday 5]   # sonraki tur: <onbellek>/gorsel/tur-N/isler.jsonl + indir.jsonl
  python tools/magaza/gorsel-plan.py isle <tur-klasoru>       # tur-N/sonuc-*.json inceleme sonuclarini duruma isler
  python tools/magaza/gorsel-plan.py durum

Inceleme sonucu dosyasi (ajan ciktisi): {"sheet": "pafta0001", "items": [{"n": 1, "ok": true|false, "reason": "..."}]};
pafta numarasi -> urun anahtari eslesmesi paftaNNNN.json dosyasindadir.
"""
import argparse
import collections
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tara import CACHE, OZEL  # noqa: E402

DIR = os.path.join(CACHE, 'gorsel')
STATE = os.path.join(DIR, 'durum.json')
RISK = {'low': 0, 'unknown': 1, 'medium': 2, 'high': 3}
PLACEHOLDER = re.compile(r'(no[-_]?image|noimage|placeholder|default[-_]?(product|image)|resim[-_]?yok|gorsel[-_]?yok|'
                         r'urun[-_]?gorseli[-_]?yok|logo\.(png|jpe?g|svg|webp))', re.I)


def load_state():
    return json.load(open(STATE, encoding='utf8')) if os.path.exists(STATE) else {}


def save_state(s):
    os.makedirs(DIR, exist_ok=True)
    tmp = STATE + '.tmp'
    json.dump(s, open(tmp, 'w', encoding='utf8'), ensure_ascii=False)
    os.replace(tmp, STATE)


def candidates(group, prof, limit):
    offers = sorted(group['offers'], key=lambda o: (RISK.get(prof.get(o['supplier'], {}).get('watermarkRisk', 'unknown'), 1),
                                                   o['net']))
    out = []
    for depth in range(3):
        for o in offers:
            if not prof.get(o['supplier'], {}).get('imagesOk', True):
                continue
            imgs = o.get('images') or []
            if depth < len(imgs):
                u = imgs[depth]
                if u not in out and not PLACEHOLDER.search(u) and not u.lower().endswith(('.svg', '.gif')):
                    out.append(u)
    return out[:limit]


def label(group):
    o = group['offers'][0]
    brand = (o.get('brand') or '').split()[0] if o.get('brand') else ''
    return (f"{brand} {o.get('model') or ''} {o.get('name') or ''}").strip()[:60]


def cmd_tur(a):
    prof = json.load(open(os.path.join(OZEL, 'tedarikci-profil.json'), encoding='utf8'))
    excluded = set()
    p = os.path.join(CACHE, 'haric-anahtarlar.json')
    if os.path.exists(p):
        excluded = set(json.load(open(p, encoding='utf8')))
    state = load_state()
    rounds = sorted(glob.glob(os.path.join(DIR, 'tur-*')))
    n = len(rounds) + 1
    d = os.path.join(DIR, f'tur-{n:02d}')
    os.makedirs(d, exist_ok=True)
    jobs = []
    for line in open(os.path.join(CACHE, 'birlesik.jsonl'), encoding='utf8'):
        g = json.loads(line)
        if g['key'] in excluded:
            continue
        st = state.get(g['key'], {'tried': [], 'ok': None, 'red': []})
        if st.get('ok'):
            continue
        nxt = next((u for u in candidates(g, prof, a.azami_aday) if u not in st['tried']), None)
        if nxt:
            jobs.append({'key': g['key'], 'url': nxt, 'label': label(g)})
    with open(os.path.join(d, 'isler.jsonl'), 'w', encoding='utf8') as f:
        for j in jobs:
            f.write(json.dumps(j, ensure_ascii=False) + '\n')
    with open(os.path.join(d, 'indir.jsonl'), 'w', encoding='utf8') as f:
        for j in jobs:
            f.write(json.dumps({'url': j['url']}) + '\n')
    print(f'tur {n}: {len(jobs)} gorsel -> {d}')


def cmd_isle(a):
    state = load_state()
    applied = collections.Counter()
    jobs = {}
    for line in open(os.path.join(a.klasor, 'isler.jsonl'), encoding='utf8'):
        j = json.loads(line)
        jobs[j['key']] = j['url']
    for res in sorted(glob.glob(os.path.join(a.klasor, 'sonuc-*.json'))):
        data = json.load(open(res, encoding='utf8'))
        for sheet in data if isinstance(data, list) else [data]:
            idx_path = os.path.join(a.klasor, 'pafta', sheet['sheet'] + '.json')
            if not os.path.exists(idx_path):
                applied['pafta_yok'] += 1
                continue
            idx = json.load(open(idx_path, encoding='utf8'))
            for it in sheet['items']:
                key = idx.get(str(it['n']))
                if not key or key not in jobs:
                    continue
                st = state.setdefault(key, {'tried': [], 'ok': None, 'red': []})
                url = jobs[key]
                if url not in st['tried']:
                    st['tried'].append(url)
                if it['ok']:
                    st['ok'] = url
                    applied['onay'] += 1
                else:
                    st['red'].append({'url': url, 'sebep': it.get('reason', '')[:80]})
                    applied['red'] += 1
    save_state(state)
    print(json.dumps(applied, ensure_ascii=False))


def cmd_durum(a):
    state = load_state()
    c = collections.Counter('onayli' if v.get('ok') else 'bekliyor' for v in state.values())
    reasons = collections.Counter(r['sebep'].split(':')[0].strip().lower() for v in state.values() for r in v.get('red', []))
    print(json.dumps({'urun': len(state), **c, 'red_sebepleri': reasons.most_common(12)}, ensure_ascii=False, indent=1))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('tur')
    p.add_argument('--azami-aday', type=int, default=5)
    p = sub.add_parser('isle')
    p.add_argument('klasor')
    sub.add_parser('durum')
    a = ap.parse_args()
    {'tur': cmd_tur, 'isle': cmd_isle, 'durum': cmd_durum}[a.cmd](a)


if __name__ == '__main__':
    main()

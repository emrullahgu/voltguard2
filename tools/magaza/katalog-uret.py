"""Taranan tedarikci verisinden magaza katalogunu ve ozel kaynak dosyasini uretir (gelistirici araci).

Girdiler (<onbellek> = %LOCALAPPDATA%/VoltGuard/magaza-tarama):
  birlesik.jsonl            urun gruplari ve teklifler (birlestir.py)
  icerik/sonuc.jsonl        urun metinleri (icerik is akisinin ciktisi; k anahtarina gore)
  gorsel/hazir.jsonl        onaylanip WebP'ye cevrilen gorseller (gorsel-toplu.py hazirla)
  tools/magaza/ozel/urun-kimlik.json   kalici urun kimlikleri {anahtar: vgm-......} (yoksa olusur)
Ciktilar:
  <onbellek>/katalog/urunler.jsonl     katalog-derle.cjs --ekle girdisi (herkese acik alanlar)
  tools/magaza/ozel/kaynaklar.json     sunucu ice aktarma dosyasi (ayarlar + kaynaklar; GIT'E GIRMEZ)
  tools/magaza/ozel/gorsel-kaynaklari.json  gorsel kokeni (GIT'E GIRMEZ)

  python tools/magaza/katalog-uret.py --kur 49.7892 [--marj 0.15]
"""
import argparse
import collections
import datetime
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tara import CACHE, OZEL  # noqa: E402

UNITS = {'adet', 'metre', 'paket', 'takım', 'kutu', 'rulo', 'kg', 'set'}


def leaf_index():
    t = json.load(open(os.path.join(CACHE, 'taksonomi.json'), encoding='utf8'))
    leaves = []
    for c in t['categories']:
        for k in c['children']:
            leaves.append(k['id'])
    return {lid: i for i, lid in enumerate(leaves)}


def clean_slug(s):
    s = s.lower().translate(str.maketrans('çğıöşüâîû', 'cgiosuaiu'))
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return re.sub(r'-{2,}', '-', s)[:90].strip('-')


def ok_text(s, lo, hi):
    return isinstance(s, str) and s.strip() == s and lo <= len(s) <= hi


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--kur', type=float, required=True)
    ap.add_argument('--marj', type=float, default=0.15)
    a = ap.parse_args()
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')
    leaves = leaf_index()
    groups = {}
    for line in open(os.path.join(CACHE, 'birlesik.jsonl'), encoding='utf8'):
        g = json.loads(line)
        groups[g['key']] = g
    content = {}
    for line in open(os.path.join(CACHE, 'icerik', 'sonuc.jsonl'), encoding='utf8'):
        c = json.loads(line)
        content[c['k']] = c
    images = {}
    for line in open(os.path.join(CACHE, 'gorsel', 'hazir.jsonl'), encoding='utf8'):
        im = json.loads(line)
        if 'src' in im:
            images[im['key']] = im
    reg_path = os.path.join(OZEL, 'urun-kimlik.json')
    registry = json.load(open(reg_path, encoding='utf8')) if os.path.exists(reg_path) else {}
    used_ids = set(registry.values())
    stats = collections.Counter()
    products, sources, provenance = [], {}, {}
    slugs = set()
    curated = json.load(open(os.path.join(OZEL, 'mevcut-modeller.json'), encoding='utf8')) \
        if os.path.exists(os.path.join(OZEL, 'mevcut-modeller.json')) else []
    curated = set(curated)
    for key in sorted(groups, key=lambda k: (content.get(k, {}).get('leaf', ''), content.get(k, {}).get('brand', ''),
                                             content.get(k, {}).get('name', ''))):
        g, c, im = groups[key], content.get(key), images.get(key)
        if not c:
            stats['metin_yok'] += 1
            continue
        if not c.get('include'):
            stats['metin_haric'] += 1
            continue
        if not im:
            stats['gorsel_yok'] += 1
            continue
        if not g.get('listUsd') or g['listUsd'] < 0.1:
            # Birkac kurusluk sarf malzemesi (tekil satisi anlamsiz; genelde paket fiyati eksik okunmus)
            stats['fiyat_cok_dusuk'] += 1
            continue
        if c.get('leaf') not in leaves:
            stats['kategori_gecersiz'] += 1
            continue
        # Uretici kodu olmayan urunlerde (kablo, sarf) tedarikci modeli; o da yoksa adin marka sonrasi ilk kismi
        mpn = (c.get('mpn') or '').strip()
        if len(mpn) < 2:
            mpn = next((o['model'].strip() for o in g['offers'] if len((o.get('model') or '').strip()) >= 2), '')
        if len(mpn) < 2:
            rest = re.sub('^' + re.escape(c.get('brand') or ''), '', c.get('name') or '', flags=re.I).strip()
            mpn = ' '.join(rest.split()[:3])
        if len(mpn) > 60:
            mpn = mpn[:60].rsplit(' ', 1)[0].strip()
        c['mpn'] = mpn
        model_key = re.sub(r'[^A-Z0-9]', '', (c.get('mpn') or '').upper())
        if model_key and model_key in curated:
            stats['mevcut_55_ile_ayni'] += 1
            continue
        desc = [p.strip() for p in c.get('description') or [] if isinstance(p, str)]
        specs = [[s[0].strip(), s[1].strip()] for s in c.get('specs') or []
                 if isinstance(s, list) and len(s) == 2 and s[0].strip() and s[1].strip()]
        if not (ok_text(c.get('name', ''), 8, 140) and ok_text(c.get('summary', ''), 30, 160)
                and 1 <= len(desc) <= 5 and all(60 <= len(p) <= 900 for p in desc) and 2 <= len(specs) <= 30
                and ok_text(c.get('brand', ''), 2, 60) and ok_text(c.get('mpn', ''), 2, 60)
                and c.get('unit') in UNITS and c.get('shipping') in ('kargo', 'nakliye')):
            stats['metin_kurala_uymuyor'] += 1
            continue
        specs = [[s[0][:60], s[1][:160]] for s in specs[:30]]
        slug = clean_slug(c.get('slug') or c['name'])
        if len(slug) < 3:
            slug = clean_slug(c['brand'] + '-' + c['mpn'])
        base, n = slug, 2
        while slug in slugs:
            suffix = f'-{n}'
            slug = base[:90 - len(suffix)] + suffix
            n += 1
        slugs.add(slug)
        pid = registry.get(key)
        if not pid:
            leaf_no = leaves[c['leaf']]
            start = 100000 + leaf_no * 10000
            nxt = start
            while f'vgm-{nxt}' in used_ids:
                nxt += 1
            if nxt >= start + 10000:
                stats['kimlik_tasti'] += 1
                continue
            pid = f'vgm-{nxt}'
            registry[key] = pid
            used_ids.add(pid)
        gtins = [o['gtin'] for o in g['offers'] if o.get('gtin')]
        gtin = collections.Counter(gtins).most_common(1)[0][0] if gtins else None
        if gtin and len(gtin) not in (8, 12, 13, 14):
            gtin = gtin.zfill(13) if len(gtin) < 13 else None
        alt = c.get('alt') if ok_text(c.get('alt', ''), 8, 160) else (c['name'][:140] + ', ürün görseli')[:160]
        max_qty = c.get('maxQty') if isinstance(c.get('maxQty'), int) and 1 <= c['maxQty'] <= 999 else 50
        products.append({
            'id': pid, 'slug': slug, 'name': c['name'], 'brand': c['brand'], 'mpn': c['mpn'], 'gtin': gtin,
            'category': c['leaf'], 'summary': c['summary'], 'description': desc, 'specs': specs,
            'images': [{'src': im['src'], 'thumb': im['thumb'], 'w': im['w'], 'h': im['h'], 'alt': alt}],
            'documents': [], 'unit': c['unit'], 'vat': 20, 'shipping': c['shipping'], 'maxQty': max_qty,
            'listUsd': g['listUsd'], 'listCheckedAt': now, 'related': [],
        })
        sources[pid] = [{'url': o['url'], 'supplier': o['supplier'], 'vatIncluded': o['vatIncluded'],
                         'currency': 'TRY', 'priority': i + 1, 'discount': 0} for i, o in enumerate(g['offers'][:3])]
        provenance[pid] = {'url': im['url']}
        stats['urun'] += 1
        stats['cat:' + c['leaf']] += 1
    os.makedirs(os.path.join(CACHE, 'katalog'), exist_ok=True)
    with open(os.path.join(CACHE, 'katalog', 'urunler.jsonl'), 'w', encoding='utf8') as f:
        for p in products:
            f.write(json.dumps(p, ensure_ascii=False) + '\n')
    json.dump(registry, open(reg_path, 'w', encoding='utf8'), ensure_ascii=False, indent=0)
    json.dump({'version': 1, 'sources': sources}, open(os.path.join(CACHE, 'katalog', 'yeni-kaynaklar.json'), 'w',
                                                        encoding='utf8'), ensure_ascii=False)
    json.dump(provenance, open(os.path.join(CACHE, 'katalog', 'yeni-gorsel-kaynaklari.json'), 'w', encoding='utf8'),
              ensure_ascii=False)
    top = {k: v for k, v in stats.items() if not k.startswith('cat:')}
    print(json.dumps(top, ensure_ascii=False, indent=1))
    print('kategori sayisi', sum(1 for k in stats if k.startswith('cat:')))


if __name__ == '__main__':
    main()

"""Tedarikci tekliflerini urun bazinda birlestirir (gelistirici araci; sunucuya kopyalanmaz).

Girdi: <onbellek>/ayristirma/<alan>.jsonl (toplu-ayristir.php) ve tools/magaza/ozel/tedarikci-profil.json (tedarikci
basina: kullanilabilir mi, fiyat KDV dahil mi, model kodu hangi alanda, gorseli kullanilabilir mi, istek araligi).
Ayni urun: gecerli GTIN ya da marka + model kodu (+ ambalaj/uzunluk ipucu). Fiyatlar KDV haric TL'ye cevrilir;
birbirinden cok farkli teklifler (ambalaj/birim karisikligi) en kalabalik kume disinda elenir. Cikti:
<onbellek>/birlesik.jsonl (urun grubu basina bir satir). Tedarikci bilgisi icerir; depoya KOYMAYIN.

  python tools/magaza/birlestir.py [--kur 49.7892]
"""
import argparse
import collections
import glob
import json
import os
import re
import statistics
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tara import CACHE, OZEL  # noqa: E402

TR = str.maketrans('çğıöşüÇĞİÖŞÜâîû', 'cgiosuCGIOSUaiu')

BRAND_FIX = {
    'schneider': 'Schneider Electric', 'schneiderelectric': 'Schneider Electric', 'se': 'Schneider Electric',
    'siemens': 'Siemens', 'abb': 'ABB', 'legrand': 'Legrand', 'eaton': 'Eaton', 'chint': 'Chint', 'entes': 'Entes',
    'klemsan': 'Klemsan', 'viko': 'Viko', 'vikobypanasonic': 'Viko', 'makel': 'Makel', 'hes': 'HES Kablo',
    'heskablo': 'HES Kablo', 'nexans': 'Nexans', 'prysmian': 'Prysmian', 'tommatech': 'TommaTech', 'huawei': 'Huawei',
    'growatt': 'Growatt', 'victron': 'Victron Energy', 'victronenergy': 'Victron Energy', 'foxess': 'FoxESS',
    'fox': 'FoxESS', 'deye': 'Deye', 'omron': 'Omron', 'delta': 'Delta', 'mitsubishi': 'Mitsubishi Electric',
    'mitsubishielectric': 'Mitsubishi Electric', 'phoenixcontact': 'Phoenix Contact', 'phoenix': 'Phoenix Contact',
    'weidmuller': 'Weidmüller', 'finder': 'Finder', 'noark': 'Noark', 'ls': 'LS Electric', 'lselectric': 'LS Electric',
    'lsis': 'LS Electric', 'hager': 'Hager', 'gewiss': 'Gewiss', 'mutlusan': 'Mutlusan', 'elimko': 'Elimko',
    'tense': 'Tense', 'emas': 'Emas', 'federal': 'Federal', 'lexron': 'Lexron', 'jinko': 'Jinko Solar',
    'jinkosolar': 'Jinko Solar', 'longi': 'LONGi', 'trina': 'Trina Solar', 'trinasolar': 'Trina Solar',
    'canadiansolar': 'Canadian Solar', 'jasolar': 'JA Solar', 'sungrow': 'Sungrow', 'solis': 'Solis',
    'goodwe': 'GoodWe', 'pylontech': 'Pylontech', 'felicity': 'Felicity Solar', 'felicitysolar': 'Felicity Solar',
    'panasonic': 'Panasonic', 'osram': 'Osram', 'ledvance': 'Ledvance', 'philips': 'Philips', 'signify': 'Philips',
    'wago': 'WAGO', 'rittal': 'Rittal', 'cabur': 'Cabur', 'onka': 'Onka', 'ensto': 'Ensto', 'danfoss': 'Danfoss',
    'lenze': 'Lenze', 'yaskawa': 'Yaskawa', 'fuji': 'Fuji Electric', 'fujielectric': 'Fuji Electric', 'enda': 'Enda',
    'cht': 'CHT', 'kontrolkalemi': 'Kontrolkalemi', 'pelsan': 'Pelsan', 'cata': 'Cata', 'tugen': 'Tügen',
    'oznur': 'Öznur Kablo', 'oznurkablo': 'Öznur Kablo', 'erse': 'Erse Kablo', 'ersekablo': 'Erse Kablo',
    'emek': 'Emek Elektrik', 'gunsan': 'Günsan', 'tekmar': 'Tekmar', 'anatolia': 'Anatolia', 'anka': 'Anka',
    'elektroteknik': 'Elektroteknik', 'aron': 'Aron', 'eae': 'EAE', 'kaan': 'Kaan Kablo', 'kaankablo': 'Kaan Kablo',
    'uniteks': 'Ünitek', 'fluke': 'Fluke', 'kyoritsu': 'Kyoritsu', 'uni-t': 'UNI-T', 'unit': 'UNI-T',
    'meanwell': 'Mean Well', 'meanwel': 'Mean Well', 'tdk': 'TDK', 'tdklambda': 'TDK-Lambda', 'teco': 'Teco',
    'gmt': 'GMT', 'opple': 'Opple', 'noas': 'Noas', 'jinkosolarholding': 'Jinko Solar', 'must': 'Must',
    'axpert': 'Axpert', 'voltronic': 'Voltronic Power', 'inform': 'Inform', 'tunçmatik': 'Tunçmatik', 'tuncmatik': 'Tunçmatik',
    'apc': 'APC', 'vertiv': 'Vertiv', 'socomec': 'Socomec', 'frako': 'Frako', 'epcos': 'TDK Epcos', 'tdkepcos': 'TDK Epcos',
    'lifasa': 'Lifasa', 'ducati': 'Ducati Energia', 'ducatienergia': 'Ducati Energia', 'janitza': 'Janitza',
    'circutor': 'Circutor', 'carlogavazzi': 'Carlo Gavazzi', 'gavazzi': 'Carlo Gavazzi', 'bender': 'Bender',
    'dehn': 'DEHN', 'obo': 'OBO Bettermann', 'obobettermann': 'OBO Bettermann', 'citel': 'Citel', 'raycap': 'Raycap',
}
GENERIC_BRANDS = {'', 'diger', 'diğer', 'genel', 'markasiz', 'markasız', 'yok', 'other', 'oem', 'muhtelif', 'cesitli'}


def fold(s):
    s = unicodedata.normalize('NFKC', s or '').translate(TR).lower()
    return re.sub(r'\s+', ' ', s).strip()


def brand_key(b):
    k = re.sub(r'[^a-z0-9]', '', fold(b))
    k = re.sub(r'(elektrik|electric|elektronik|kablo|cable|ltd|sti|as|turkiye|turkey|enerji|energy)$', '', k) or k
    return k


def model_key(m):
    return re.sub(r'[^A-Z0-9]', '', fold(m).upper())


def gtin_ok(g):
    g = re.sub(r'\D', '', g or '')
    if len(g) not in (8, 12, 13, 14) or len(set(g)) == 1:
        return ''
    d = [int(c) for c in g]
    check = d.pop()
    s = sum(v * (3 if i % 2 == 0 else 1) for i, v in enumerate(reversed(d)))
    if (10 - s % 10) % 10 != check:
        return ''
    g = g.lstrip('0')
    return g if len(g) >= 8 else ''


PACK = re.compile(r'(\d+(?:[.,]\d+)?)\s*(?:mt|metre|meter|m)\b(?!m)|(\d+)\s*(?:li|lı|lu|lü)\s*(?:paket|kutu)|'
                  r'(\d+)\s*(?:adet)\b|\b(rulo|top|makara|kangal)\b', re.I)


def pack_hint(name):
    f = fold(name)
    hints = []
    for m in PACK.finditer(f):
        if m.group(1):
            v = float(m.group(1).replace(',', '.'))
            if v >= 2:  # 1 m = birim fiyat; 2 m ve uzeri ambalaj uzunlugu
                hints.append(f'{v:g}m')
        elif m.group(2):
            hints.append(m.group(2) + 'li')
        elif m.group(3) and int(m.group(3)) > 1:
            hints.append(m.group(3) + 'ad')
        elif m.group(4):
            hints.append('rulo')
    return '+'.join(sorted(set(hints)))


def model_from_name(name, brand):
    """Addaki ilk 'model kodu gorunumlu' kelime (harf+rakam karisik, en az 4 karakter)."""
    f = re.sub(re.escape(brand or ''), ' ', name or '', flags=re.I)
    for tok in re.findall(r'[A-Za-z0-9][A-Za-z0-9./\-+]{3,30}', f):
        if re.search(r'\d', tok) and re.search(r'[A-Za-z]', tok) and not re.fullmatch(
                r'\d+(?:[.,]\d+)?(?:mm2?|mm²|kw|kva|kvar|w|v|a|ah|ma|ka|m|mt|cm|hz|kg|li|lu|lı|lü)', tok, re.I):
            return tok.strip('.-/')
    return ''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--kur', type=float, required=True, help='TCMB USD doviz satis kuru (fiyat hesaplama)')
    ap.add_argument('--marj', type=float, default=0.15)
    a = ap.parse_args()
    prof = json.load(open(os.path.join(OZEL, 'tedarikci-profil.json'), encoding='utf8'))
    groups = {}
    stats = collections.Counter()
    for f in sorted(glob.glob(os.path.join(CACHE, 'ayristirma', '*.jsonl'))):
        dom = os.path.basename(f)[:-6]
        p = prof.get(dom)
        if not p or not p.get('usable'):
            stats['tedarikci_kullanilmaz'] += sum(1 for _ in open(f, encoding='utf8'))
            continue
        for line in open(f, encoding='utf8'):
            r = json.loads(line)
            o = r['offer']
            if not o['ok'] or not o['price'] or o['currency'] != 'TRY' or o['price'] <= 0:
                stats['fiyat_yok'] += 1
                continue
            name = (o['name'] or r['h1'] or r['title'] or '').strip()
            brand_raw = (o['brand'] or '').strip()
            if brand_key(brand_raw) in GENERIC_BRANDS or len(brand_raw) < 2:
                brand_raw = ''
            field = p.get('modelField', 'mpn')
            model = ''
            if field == 'mpn':
                model = o['mpn'] or (o['sku'] if p.get('skuIsModel') in ('always', 'mostly') else '') or ''
            elif field == 'sku':
                model = o['sku'] or o['mpn'] or ''
            if not model and p.get('modelFromName', True):
                model = model_from_name(name, brand_raw)
            model = (model or '').strip()
            bk = brand_key(brand_raw)
            if bk and model:
                # SKU basindaki marka on eki ('VK VCC16/11/S', 'SIEM-5SV...') atilir
                model = re.sub(r'^(%s|[A-Z]{2,5})[\s-]+(?=[A-Z0-9]*\d)' % re.escape(brand_raw), '', model, flags=re.I) \
                    if p.get('stripSkuPrefix') else model
            gt = gtin_ok(o['gtin'] or '')
            pk = pack_hint(name)
            mk = model_key(model)
            if bk and len(mk) >= 3:
                key = f'm:{bk}:{mk}:{pk}'
            elif gt:
                key = f'g:{gt}:{pk}'
            else:
                stats['kimlik_yok'] += 1
                continue
            net = o['price'] / 1.2 if p.get('vatIncluded') else o['price']
            offer = {'supplier': dom, 'url': r['final'] or r['url'], 'net': round(net, 2), 'gross': round(net * 1.2, 2),
                     'available': o['available'], 'name': name, 'brand': brand_raw, 'model': model, 'gtin': gt,
                     'crumbs': r['crumbs'], 'images': r['images'] if p.get('imagesOk', True) else [],
                     'desc': r['desc'][:1500], 'specs': r['specs'][:1500], 't': r['t'],
                     'vatIncluded': bool(p.get('vatIncluded')), 'priority': p.get('priority', 5)}
            g = groups.setdefault(key, {'key': key, 'offers': []})
            # ayni tedarikciden ayni urunun birden fazla sayfasi: ucuz olani tut
            prev = next((x for x in g['offers'] if x['supplier'] == dom), None)
            if prev:
                if offer['net'] < prev['net']:
                    g['offers'].remove(prev)
                    g['offers'].append(offer)
                stats['ayni_tedarikci_tekrar'] += 1
                continue
            g['offers'].append(offer)
    # GTIN ile ikinci birlestirme: marka/model anahtarlari farkli ama GTIN ayni olan gruplar
    by_gtin = {}
    for key, g in list(groups.items()):
        gts = {o['gtin'] for o in g['offers'] if o['gtin']}
        for gt in gts:
            pk = key.rsplit(':', 1)[-1]
            other = by_gtin.get((gt, pk))
            if other and other in groups and other != key:
                have = {o['supplier'] for o in groups[other]['offers']}
                groups[other]['offers'].extend(o for o in g['offers'] if o['supplier'] not in have)
                del groups[key]
                stats['gtin_birlesme'] += 1
                break
            by_gtin[(gt, pk)] = key
    out = open(os.path.join(CACHE, 'birlesik.jsonl'), 'w', encoding='utf8')
    for key, g in groups.items():
        offers = g['offers']
        avail = [o for o in offers if o['available'] is not False]
        if not avail:
            stats['stokta_yok'] += 1
            continue
        nets = sorted(o['net'] for o in avail)
        med = statistics.median(nets)
        keep = [o for o in avail if med / 1.6 <= o['net'] <= med * 1.6]
        if len(keep) < len(avail):
            stats['aykiri_teklif_elendi'] += len(avail) - len(keep)
        if not keep or (len(avail) == 2 and len(keep) < 2):
            # iki teklif birbirinden cok farkli: hangisinin dogru oldugu bilinemez
            stats['celiskili_grup'] += 1
            continue
        keep.sort(key=lambda o: (o['net'], o['priority']))
        best = keep[0]
        cost_usd = best['net'] / a.kur
        g.update(offers=keep, listUsd=round(cost_usd * (1 + a.marj), 2), bestNet=best['net'],
                 suppliers=len(keep), spread=round(keep[-1]['net'] / best['net'], 3))
        out.write(json.dumps(g, ensure_ascii=False) + '\n')
        stats['urun'] += 1
        stats['tek_kaynak' if len(keep) == 1 else 'cok_kaynak'] += 1
    out.close()
    print(json.dumps(stats, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()

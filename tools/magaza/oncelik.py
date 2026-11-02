"""Taranacak urun adreslerini ilgiye gore siralar (gelistirici araci). Tum adresler taranir; sira yalnizca oncelik.

Adres kisa adindaki (slug) urun tipi ve marka sozcuklerine gore puanlar; VoltGuard'in uzmanlik alanlari (salt/pano,
kablo, gunes enerjisi, sarj, kompanzasyon, olcum, otomasyon) one alinir. Cikti: <onbellek>/oncelik.json.
"""
import json, os, re, sys, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tara import CACHE, suppliers

TYPES = {
    3: r'otomat|sigorta|w-?otomat|kacak-?akim|rccb|mcb|mccb|kompakt|salter|sekiz|kontaktor|termik|motor-?koruma|'
       r'parafudr|surge|gerilim-?koruma|faz-?koruma|zaman-?rolesi|role|reaktif|kompanzasyon|kondansator|reaktor|'
       r'analizor|enerji-?analiz|multimetre|sayac|akim-?trafo|olcu|panel|inverter|invertor|evirici|akü|aku|batarya|'
       r'lityum|lifepo|sarj|wallbox|solar|gunes|mppt|pv-?kablo|plc|hmi|surucu|frekans|softstarter|guc-?kaynagi|'
       r'kablo|nyy|nym|nyaf|n2xh|xlpe|yvv|ttr|halojen|pano|klemens|ray|buat|kesici|ayirici|yuk-?ayirici|og-?|'
       r'trafo|jenerator|ups|topraklama|paratoner',
    1: r'led|armatur|projektor|anahtar|priz|fis|uzatma|kablo-?kanal|spiral|bant|kelepce|lamba|aydinlatma|sensor',
}
BRANDS = (r'schneider|siemens|abb|legrand|eaton|chint|entes|klemsan|viko|makel|hes|nexans|prysmian|tommatech|huawei|'
          r'growatt|victron|fox|deye|omron|delta|mitsubishi|phoenix|weidmuller|finder|noark|ls-|lsis|hager|gewiss|'
          r'mutlusan|elimko|tense|emas|federal|ofisi|kontrolkalemi|pluspower|lexron|jinko|longi|trina|canadian|ja-?solar|'
          r'sungrow|solis|goodwe|pylontech|felicity|must|anern|cata|pelsan|panasonic|osram|philips|wago|rittal|'
          r'cabur|onka|ensto|elsan|ege-?kablo|oznur|ozkan|kaan|danfoss|lenze|sew|yaskawa|fuji|kontrol|cht|enda')
JUNK = r'hediye|oyuncak|kozmetik|giyim|mutfak|bahce-?mobilya|kitap|cicek|tencere'

def score(u):
    slug = urllib.parse.unquote(urllib.parse.urlsplit(u).path).lower()
    s = 0
    for w, rx in TYPES.items():
        if re.search(rx, slug):
            s += w
            break
    if re.search(BRANDS, slug):
        s += 2
    if re.search(JUNK, slug):
        s -= 5
    return s

out = {}
for d in suppliers():
    p = os.path.join(CACHE, d, 'urls.txt')
    if not os.path.exists(p):
        continue
    urls = open(p, encoding='utf8').read().split()
    # Hepsi taranir (sahibin karari: uygun olan her urun); ilgili olanlar once, ilgisiz gorunenler en sona.
    ranked = sorted(urls, key=lambda u: -score(u))
    out[d] = ranked
    print(f'{d:32} {len(urls):6} -> ilgili {len(out[d]):6}  (3+: {sum(1 for u in urls if score(u)>=3)})')
json.dump(out, open(os.path.join(CACHE, 'oncelik.json'), 'w', encoding='utf8'))

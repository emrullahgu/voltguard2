"""Kategori izi anahtari (kategori-yolu.py ve icerik-parti.py ortak)."""
import re

HOME = re.compile(r'(?i)^(ana ?sayfa|home|anasayfa|ürünler|urunler|tüm ürünler|tum urunler|kategoriler|mağaza|magaza)$')


def crumb_path(crumbs, name):
    name = (name or '').strip().lower()
    cr = [c.strip() for c in crumbs or [] if c.strip() and not HOME.match(c.strip())]
    if cr and (cr[-1].lower() == name or (name and cr[-1].lower() in name and len(cr[-1]) > 25)):
        cr = cr[:-1]
    return ' > '.join(cr[-3:])


def path_key_for(offer):
    """birlesik.jsonl teklifinden esleme anahtari."""
    return f"{offer['supplier']} | {crumb_path(offer.get('crumbs'), offer.get('name'))}"

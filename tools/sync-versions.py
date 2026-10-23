#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/sync-versions.py - yerel CSS/JS referanslarinin ?v= surumunu dosya icerigine baglar
=======================================================================================

Sunucu ?v= ile istenen css/js dosyalarini bir yil "immutable" onbellege alir (.htaccess). Surum elle
guncellenmezse ziyaretci eski dosyayi bir yil gorur. Bu betik her referansi dosyanin SHA-256 ozetinin
ilk 12 hanesiyle yeniler (araclar/ uretecinin kullandigi bicimle ayni), yani dosya degismedikce surum
de degismez, degisince otomatik yenilenir.

  python tools/sync-versions.py           tum sayfalari esitle
  python tools/sync-versions.py --check   yazmadan denetle (eski surum varsa cikis 1)

Kapsam: kok ve icerik klasorlerindeki *.html, *.php ve tools/shell/head.html. Uretilen klasorler
(araclar/, voltsim/ ve VoltGame) kendi ureticileriyle ayni kurali kullanir; burada da denetlenir.
Yalnizca /css/ ve /js/ altindaki (ya da goreli css/, js/) dosyalar ele alinir; harici adreslere dokunulmaz.
"""
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP = {'.git', 'node_modules', 'VoltGame', 'voltguardekleyelim', 'vesikalar', '.qa', '.netlify-publish', '__pycache__', 'Tanıtım Videosu', '.claude'}
REF = re.compile(r'((?:href|src)=")(/?)((?:css|js)/[A-Za-z0-9_./-]+\.(?:css|js))\?v=([A-Za-z0-9_-]+)(")')
_cache = {}


def rev(rel):
    if rel not in _cache:
        f = ROOT / rel
        _cache[rel] = hashlib.sha256(f.read_bytes()).hexdigest()[:12] if f.is_file() else None
    return _cache[rel]


def files():
    for p in ROOT.rglob('*'):
        if p.suffix not in ('.html', '.php') or not p.is_file():
            continue
        parts = p.relative_to(ROOT).parts
        if parts[0] in SKIP or (parts[0] == 'tools' and p.relative_to(ROOT).as_posix() != 'tools/shell/head.html') or (parts[0] == 'public' and 'voltgame' in parts):
            continue
        yield p


def main():
    check = '--check' in sys.argv
    stale, changed, missing = [], 0, []
    for p in files():
        raw = p.read_bytes()
        text = raw.decode('utf-8')
        def sub(m):
            r = rev(m.group(3))
            if r is None:
                missing.append(f'{p.relative_to(ROOT).as_posix()}: {m.group(3)}')
                return m.group(0)
            if m.group(4) != r:
                stale.append(f'{p.relative_to(ROOT).as_posix()}: {m.group(3)} {m.group(4)} -> {r}')
            return m.group(1) + m.group(2) + m.group(3) + '?v=' + r + m.group(5)
        new = REF.sub(sub, text)
        if new != text and not check:
            p.write_bytes(new.encode('utf-8'))
            changed += 1
    for m in missing:
        print('UYARI dosya yok:', m)
    if check:
        for s in stale[:40]:
            print('eski surum:', s)
        print(f'{len(stale)} eski surum referansi')
        return 1 if stale or missing else 0
    print(f'surumler esitlendi: {changed} dosya guncellendi, {len(stale)} referans yenilendi')
    return 0


if __name__ == '__main__':
    sys.exit(main())

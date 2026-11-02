#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
VoltGuard - self-hosted asset builder (Font Awesome subset + Outfit/Inter web fonts)
====================================================================================

WHAT IT DOES
  Replaces the render-blocking third-party requests (Google Fonts CSS, fonts.gstatic.com,
  cdnjs Font Awesome all.min.css + 3 webfonts) with same-origin, preloadable files:

    css/fa-subset.css            Font Awesome 6.5.1 CSS containing ONLY the icon classes the
                                 site uses (+ all FA utility classes: fa-fw, fa-2x, fa-spin ...).
                                 Same class names and same rendering as the original all.min.css,
                                 so no markup change is needed.
    fonts/fa-solid-900.*.woff2   Subset of the real FA 6.5.1 woff2 fonts (only used glyphs).
    fonts/fa-regular-400.*.woff2
    fonts/fa-brands-400.*.woff2
    fonts/manifest.json          File names (they carry a content hash) + preload hints.

  and, with --fonts:
    css/fonts.css                @font-face for Outfit + Inter (variable woff2, font-display:swap,
                                 unicode-range), metrics-matched fallback faces (size-adjust,
                                 ascent/descent/line-gap-override) and the --font-heading/--font-body
                                 (style.css) + --vg-font-h/--vg-font-b (vg-shell.css) variables that
                                 use them.
    fonts/outfit-*.woff2, fonts/inter-*.woff2

USAGE  (run from anywhere; the project root is the parent of tools/)
    python tools/build-assets.py                  # rescan project, rebuild the icon subset
    python tools/build-assets.py --dry-run        # scan + report only, write nothing
    python tools/build-assets.py --check --strict # exit 1 if css/fa-subset.css / fonts/ are stale (CI / pre-commit)
    python tools/build-assets.py -v               # also list the icon names per FA style
    python tools/build-assets.py --extra fa-fire fa-bell   # force-include extra icons
    python tools/build-assets.py --fonts          # ALSO rebuild Outfit/Inter + css/fonts.css (network)
    python tools/build-assets.py --strict         # exit code 1 if there are warnings (CI use)
    python tools/build-assets.py --sync-refs      # rewrite hashed font file names in <link rel=preload>/sw.js/pages

  Requirements: Python 3.8+, `pip install fonttools brotli`, internet access on the first run
  (sources are downloaded once to <tmp>/voltguard-assets-cache and checksum-verified).

WHEN TO RE-RUN
  Every time a page / script starts using a Font Awesome icon that was not used before
  (e.g. <i class="fas fa-bell">) - otherwise that icon renders as an empty box. The scanner reads
  ALL .html/.php/.js/.css files of the project plus the tools/shell/ header/footer fragments (class
  attributes, JS strings, CSS `content:"\\f0e7"` rules) and also force-includes RESERVE_ICONS below.
  The script prints:
    * warnings for dynamically built class names (e.g. 'fa-' + name) - add those icons via
      --extra or to EXTRA_ICONS below, because a static scan cannot see them;
    * warnings for fa-* classes that do not exist in Font Awesome Free 6.5.1.
  After running, commit css/fa-subset.css, css/fonts.css and everything under fonts/.
  The woff2 file names contain a content hash, so browsers never keep a stale subset; stale
  files are deleted automatically. If pages contain <link rel="preload" href="/fonts/....woff2"> tags
  (or sw.js lists the files), run with --sync-refs so their hrefs follow the new hashed names
  (fonts/manifest.json lists the current names and is printed at the end of every run).

DEPLOY
  fonts/ must be copied to the server together with css/ (see .cpanel.yml). tools/ is dev-only.
"""
import argparse
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import urllib.request

# ----------------------------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------------------------
FA_VERSION = '6.5.1'
FA_CDN = 'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@%s/' % FA_VERSION
FA_SOURCES = {  # key: (path under CDN, sha256 of the file)
    'css': ('css/all.min.css', 'c22cfb6520a7fdbb738632834019acf47c78b1279462c0eb4cb83bae83ecb5a7'),
    'solid': ('webfonts/fa-solid-900.woff2', '9fc85f3a4544ab0d570c7f8f9bbb88db8d92c359b2707580ea8b07c75673eae2'),
    'regular': ('webfonts/fa-regular-400.woff2', '2bccecf0bc7e96cd5ce4003abeb3ae9ee4a3d19158c4e6edfd2df32d2f0d5721'),
    'brands': ('webfonts/fa-brands-400.woff2', '3a8924cd5203a28628716aedb5cef0943da4c3b44e3ffcee90ab06387b41c490'),
}
FA_FAMILY = {'solid': 'Font Awesome 6 Free', 'regular': 'Font Awesome 6 Free', 'brands': 'Font Awesome 6 Brands'}
FA_WEIGHT = {'solid': 900, 'regular': 400, 'brands': 400}
FA_FILE_STEM = {'solid': 'fa-solid-900', 'regular': 'fa-regular-400', 'brands': 'fa-brands-400'}

# google/fonts repository, pinned to a commit so that --fonts is reproducible.
GF_COMMIT = 'bd8f81ddb5c74d5c8897b36ad88b440266245103'
GF_RAW = 'https://raw.githubusercontent.com/google/fonts/%s/ofl/' % GF_COMMIT
TEXT_FONT_SOURCES = {  # key: (url suffix, sha256)
    'Outfit': ('outfit/Outfit%5Bwght%5D.ttf', 'fc7287273e66929776e2ba54f144fe699080bec29f61bf649d70d871468aeade'),
    'Inter': ('inter/Inter%5Bopsz%2Cwght%5D.ttf', '29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031'),
}

# Icons that other parts of the site are going to add (shell / factory / account pages). They are
# always included, in every FA style that has the glyph (so `fas fa-star` and `far fa-star` both work).
RESERVE_ICONS = """
fa-bars fa-xmark fa-chevron-down fa-user fa-right-to-bracket fa-user-plus fa-bolt fa-industry
fa-gauge-high fa-chart-line fa-shield-halved fa-screwdriver-wrench fa-plug fa-solar-panel fa-microchip
fa-satellite-dish fa-triangle-exclamation fa-circle-check fa-clock fa-coins fa-leaf fa-gears
fa-file-lines fa-download fa-print fa-star fa-heart fa-trophy fa-gamepad fa-arrow-right fa-phone
fa-envelope fa-location-dot fa-whatsapp fa-instagram fa-linkedin-in
""".split()

# Cheap safety net for very likely UI icons (small cost: a few hundred bytes each).
EXTRA_ICONS = """
fa-check fa-circle-info fa-circle-exclamation fa-circle-xmark fa-eye fa-eye-slash fa-lock fa-key
fa-chevron-up fa-chevron-left fa-chevron-right fa-arrow-left fa-circle-user fa-magnifying-glass
fa-spinner fa-rotate fa-pen fa-trash fa-plus fa-minus fa-copy fa-share-nodes fa-bell fa-building
fa-handshake fa-lightbulb fa-bullseye fa-rocket fa-warehouse fa-truck-fast
""".split()

# Files / folders the scanner never reads.
SKIP_DIRS = {'.git', 'node_modules', 'tools', 'fonts', '__pycache__',
             'voltguardekleyelim', 'SahaTakip-main', 'araclar', '.qa'}
SKIP_FILES = {'css/fa-subset.css', 'css/fonts.css'}
SCAN_EXT = ('.html', '.htm', '.php', '.js', '.mjs', '.css')
# Folders below a skipped one that ARE read: the shared header/footer/head fragments that
# tools/shell.py copies into every page (so an icon added there is covered even before shell.py runs).
EXTRA_SCAN_DIRS = ('tools/shell',)

# ---- text fonts ------------------------------------------------------------------------------
# Core file = Basic Latin + Latin-1 + Turkish (Ğ ğ İ ı Ş ş) + punctuation + symbols the site uses.
GOOGLE_LATIN = ('0000-00FF,0131,0152-0153,02BB-02BC,02C6,02DA,02DC,0304,0308,0329,2000-206F,20AC,2122,'
                '2191,2193,2212,2215,FEFF,FFFD')
TURKISH = '011E-011F,0130-0131,015E-015F'
SYMBOLS = '20BA,2190,2192,2194,2074-2079,2080-2089,2126,221A,221D-221E,2248,2260,2264-2265'
CORE_RANGES = ','.join([GOOGLE_LATIN, TURKISH, SYMBOLS])
# Rare characters (rest of Latin Extended A/B/Additional, Vietnamese, IPA ...): on-demand file.
EXT_RANGES = ('0100-02BA,02BD-02C5,02C7-02CC,02CE-02D7,02DD-02FF,0300-0301,0303-0304,0308-0309,0323,0329,'
              '1D00-1DBF,1E00-1E9F,1EA0-1EF9,1EF2-1EFF,2020,20A0-20C4,2113,2C60-2C7F,A720-A7FF')
# Greek letters (Omega, phi, delta ... are used all over the engineering pages) - Inter only.
GREEK_RANGES = '0391-03A9,03B1-03C9,03D1,03D5-03D6,03F1,03F5'
OPENTYPE_FEATURES = ['ccmp', 'locl', 'kern', 'liga', 'calt', 'rvrn', 'mark', 'mkmk', 'tnum', 'pnum', 'case', 'zero']

# Metrics-matched fallbacks (size-adjust / ascent / descent / line-gap overrides, percent), one face per weight.
# Measured in Chrome on the site's own Turkish copy: width of the loaded web font vs. the local fallback
# (Arial / Arial Bold; Roboto / Roboto Bold for Android), so the swap moves text by < 1 % instead of 2-19 %.
# Roboto numbers = Arial measurement x (Arial/Roboto average advance width from the font files).
#   key: (family, fallback face) -> {weight: (size-adjust, ascent-override, descent-override, line-gap-override)}
FALLBACK_METRICS = {
    ('Outfit', 'Arial'): {
        400: (97.99, 102.05, 26.53, 0.0),
        500: (98.57, 101.45, 26.38, 0.0),
        600: (93.57, 106.87, 27.79, 0.0),
        700: (95.38, 104.85, 27.26, 0.0),
        800: (97.19, 102.89, 26.75, 0.0),
    },
    ('Outfit', 'Roboto'): {
        400: (98.85, 101.16, 26.30, 0.0),
        500: (99.43, 100.57, 26.15, 0.0),
        600: (99.08, 100.92, 26.24, 0.0),
        700: (101.00, 99.01, 25.74, 0.0),
        800: (102.92, 97.16, 25.26, 0.0),
    },
    ('Inter', 'Arial'): {
        400: (105.82, 91.55, 22.79, 0.0),
        500: (107.08, 90.47, 22.53, 0.0),
        600: (100.80, 96.10, 23.93, 0.0),
        700: (101.97, 95.00, 23.65, 0.0),
        800: (103.38, 93.71, 23.33, 0.0),
    },
    ('Inter', 'Roboto'): {
        400: (106.75, 90.75, 22.60, 0.0),
        500: (108.02, 89.69, 22.33, 0.0),
        600: (106.75, 90.75, 22.60, 0.0),
        700: (107.99, 89.71, 22.34, 0.0),
        800: (109.48, 88.49, 22.03, 0.0),
    },
}
FALLBACK_LOCAL = {
    ('Arial', 'regular'): ['Arial', 'ArialMT', 'Liberation Sans', 'Arimo'],
    ('Arial', 'bold'): ['Arial Bold', 'Arial-BoldMT', 'Liberation Sans Bold', 'Arimo Bold'],
    ('Roboto', 'regular'): ['Roboto', 'Roboto-Regular'],
    ('Roboto', 'bold'): ['Roboto Bold', 'Roboto-Bold'],
}


# ----------------------------------------------------------------------------------------------
# Small helpers
# ----------------------------------------------------------------------------------------------
def info(msg=''):
    print(msg)
    sys.stdout.flush()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def short_hash(data):
    return hashlib.sha1(data).hexdigest()[:8]


def download(url, cache_dir, expected_sha=None, warnings=None):
    """Download once into cache_dir (keyed by URL) and return the bytes."""
    os.makedirs(cache_dir, exist_ok=True)
    key = hashlib.sha1(url.encode()).hexdigest()[:12] + '-' + re.sub(r'[^A-Za-z0-9._-]+', '_', url.rsplit('/', 1)[-1])
    path = os.path.join(cache_dir, key)
    if not os.path.exists(path):
        info('  downloading %s' % url)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (voltguard build-assets)'})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        with open(path, 'wb') as f:
            f.write(data)
    with open(path, 'rb') as f:
        data = f.read()
    if expected_sha and sha256(data) != expected_sha:
        msg = 'checksum of %s differs from the pinned one (%s) - output may differ from the reviewed build' % (
            url.rsplit('/', 1)[-1], expected_sha[:12])
        if warnings is not None:
            warnings.append(msg)
        info('  WARNING: ' + msg)
    return data


def read_text(path):
    with open(path, 'rb') as f:
        raw = f.read()
    return raw.decode('utf-8', errors='replace')


def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='') as f:  # LF, UTF-8 without BOM
        f.write(text)


def write_bytes(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data)


def parse_ranges(spec):
    out = set()
    for part in spec.split(','):
        part = part.strip().upper().replace('U+', '')
        if not part:
            continue
        if '-' in part:
            a, b = part.split('-')
            out.update(range(int(a, 16), int(b, 16) + 1))
        else:
            out.add(int(part, 16))
    return out


def format_ranges(cps):
    """Set of code points -> compact CSS unicode-range value."""
    cps = sorted(cps)
    out = []
    i = 0
    while i < len(cps):
        j = i
        while j + 1 < len(cps) and cps[j + 1] == cps[j] + 1:
            j += 1
        out.append('U+%X' % cps[i] if i == j else 'U+%X-%X' % (cps[i], cps[j]))
        i = j + 1
    return ', '.join(out)


def _differs(path, text):
    try:
        return read_text(path) != text
    except IOError:
        return True


def human(n):
    return '%.1f KB' % (n / 1024.0)


# ----------------------------------------------------------------------------------------------
# Font Awesome: parse the original CSS
# ----------------------------------------------------------------------------------------------
def split_css_rules(css):
    """Split a minified stylesheet into top-level rules (handles @media/@keyframes nesting)."""
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    rules, depth, start, quote = [], 0, 0, None
    for i, ch in enumerate(css):
        if quote:
            if ch == quote and css[i - 1] != '\\':
                quote = None
            continue
        if ch in '"\'':
            quote = ch
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                rules.append(css[start:i + 1].strip())
                start = i + 1
    return rules


ICON_SEL_RE = re.compile(r'^\.fa-([a-z0-9]+(?:-[a-z0-9]+)*):before$')
ICON_BODY_RE = re.compile(r'^\{content:"\\([0-9a-fA-F]{1,6})"\}$')


def parse_fa_css(css):
    """Return (icons{name: codepoint}, layout[list of ('rule', text) | ('icons', None)], utilities set)."""
    icons = {}
    layout = []
    utilities = set()
    icons_slot_placed = False
    for rule in split_css_rules(css):
        sel, _, _ = rule.partition('{')
        body = rule[len(sel):]
        sels = [s.strip() for s in sel.split(',')]
        m = ICON_BODY_RE.match(body)
        if m and sels and all(ICON_SEL_RE.match(s) for s in sels):
            cp = int(m.group(1), 16)
            for s in sels:
                icons['fa-' + ICON_SEL_RE.match(s).group(1)] = cp
            if not icons_slot_placed:
                layout.append(('icons', None))
                icons_slot_placed = True
            continue
        if rule.startswith('@font-face') or rule.startswith('@-webkit-keyframes'):
            continue  # replaced by our own @font-face / modern @keyframes are enough
        layout.append(('rule', rule))
        for c in re.findall(r'\.(fa-[a-z0-9-]+)', sel):
            utilities.add(c)
    return icons, layout, utilities


# ----------------------------------------------------------------------------------------------
# Font Awesome: scan the project for icon usage
# ----------------------------------------------------------------------------------------------
ICON_TOKEN_RE = re.compile(r'(?<![\w-])fa-([a-z0-9]+(?:-[a-z0-9]+)*)(?![\w-])')
DYNAMIC_RE = re.compile(r'(?<![\w-])fa-(?:[a-z0-9]+-)*(?=[\'"`]|\$\{)')
STYLE_RE = re.compile(r'(?<![\w-])(fas|far|fab|fal|fat|fad|fa-solid|fa-regular|fa-brands|fa-light|fa-thin|fa-duotone|fa)(?![\w-])')
STYLE_MAP = {'fas': 'solid', 'fa-solid': 'solid', 'fa': 'solid',
             'far': 'regular', 'fa-regular': 'regular',
             'fab': 'brands', 'fa-brands': 'brands'}
STYLE_TOKENS = set(['fa-solid', 'fa-regular', 'fa-brands', 'fa-light', 'fa-thin', 'fa-duotone', 'fa-classic', 'fa-sharp'])
FILE_EXT_RE = re.compile(r'\.(?:css|woff2?|js|html?|json|png|svg)\b')
QUOTES = '"\'`'


def iter_project_files(root):
    tops = [root] + [os.path.join(root, *d.split('/')) for d in EXTRA_SCAN_DIRS]
    for top in tops:
        if not os.path.isdir(top):
            continue
        for dirpath, dirnames, filenames in os.walk(top):
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
            for fn in sorted(filenames):
                if not fn.lower().endswith(SCAN_EXT):
                    continue
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, root).replace(os.sep, '/')
                if rel in SKIP_FILES:
                    continue
                yield full, rel


def quote_segment(text, pos):
    """Text between the nearest quote characters around pos (a class attribute value / JS string)."""
    a = max(text.rfind(q, 0, pos) for q in QUOTES)
    ends = [i for i in (text.find(q, pos) for q in QUOTES) if i != -1]
    b = min(ends) if ends else len(text)
    return text[a + 1:b]


def styles_for(text, pos, end):
    """Which FA style(s) does the icon token at text[pos:end] belong to?  None -> unknown."""
    seg_start = max(text.rfind(q, 0, pos) for q in QUOTES) + 1
    seg = quote_segment(text, pos)
    found = [m for m in STYLE_RE.finditer(seg)]
    if not found:  # style token lives in a neighbouring string ('fas ' + (...)): look at the window
        lo = max(0, pos - 160)
        win = text[lo:pos]
        # restrict the window to the current line to avoid leaking across statements
        win = win.rsplit('\n', 1)[-1]
        found = [m for m in STYLE_RE.finditer(win)]
        if found:
            found = [found[-1]]
    styles = set()
    for m in found:
        tok = m.group(1)
        if tok in STYLE_MAP:
            styles.add(STYLE_MAP[tok])
        else:
            styles.add('solid')  # Pro-only style names (fal/fat/fad) are not in Free: treat as solid
    return styles or None


CSS_BLOCK_RE = re.compile(r'\{([^{}]*)\}')
CSS_CONTENT_RE = re.compile(r'''content\s*:\s*(["'])((?:\\[0-9a-fA-F]{1,6}\s?)+)\1''')


def scan_project(root):
    """Return (usage{name: set(styles) | None-marker}, css_codepoints{style: set(cp)}, dynamic[list], where{name: [rel]})."""
    usage = {}          # name -> set of styles ('?' means unknown style)
    where = {}
    css_cps = {'solid': set(), 'regular': set(), 'brands': set()}
    dynamic = []
    nfiles = 0
    for full, rel in iter_project_files(root):
        text = read_text(full)
        nfiles += 1
        for m in ICON_TOKEN_RE.finditer(text):
            name = 'fa-' + m.group(1)
            if name in STYLE_TOKENS:
                continue
            if text[m.start() - 1:m.start()] == '/' or FILE_EXT_RE.match(text, m.end()):
                continue  # URL / file name such as /css/fa-subset.css, not a class
            st = None if rel.endswith('.css') else styles_for(text, m.start(), m.end())
            usage.setdefault(name, set()).update(st if st else {'?'})
            where.setdefault(name, set()).add(rel)
        for m in DYNAMIC_RE.finditer(text):
            line = text.count('\n', 0, m.start()) + 1
            dynamic.append('%s:%d  %s' % (rel, line, text[max(0, m.start() - 30):m.end() + 30].replace('\n', ' ').strip()))
        # CSS rules that print an FA glyph by code point:  content:"\f0e7"; font-family:"Font Awesome 6 Free"
        for b in CSS_BLOCK_RE.finditer(text):
            block = b.group(1)
            if 'Font Awesome' not in block and '--fa-font' not in block:
                continue
            cm = CSS_CONTENT_RE.search(block)
            if not cm:
                continue
            if 'Brands' in block or '--fa-font-brands' in block:
                style = 'brands'
            elif re.search(r'font-weight\s*:\s*(900|bold)', block) or '--fa-font-solid' in block:
                style = 'solid'
            else:
                style = 'regular'
            for cp in re.findall(r'\\([0-9a-fA-F]{1,6})', cm.group(2)):
                css_cps[style].add(int(cp, 16))
    return usage, css_cps, dynamic, where, nfiles


# ----------------------------------------------------------------------------------------------
# Font subsetting
# ----------------------------------------------------------------------------------------------
def load_ttfont(data):
    from fontTools.ttLib import TTFont
    return TTFont(io.BytesIO(data), recalcTimestamp=False)


def font_cmap(data):
    return set(load_ttfont(data).getBestCmap().keys())


def subset_woff2(font, codepoints, features, keep_raster_tables=False):
    """Subset the TTFont in place to codepoints and return the woff2 bytes.

    keep_raster_tables: keep the source's 'gasp' table and its glyph-independent 'prep' program
    (Google Fonts ships them in its unhinted woff2 too: smoothing flags + dropout control), so the
    rasterisers draw exactly like the Google-served files. Glyph hints are always removed."""
    from fontTools import subset
    prep = font['prep'] if keep_raster_tables and 'prep' in font else None
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = list(features)
    opts.hinting = False
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.legacy_kern = False
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    opts.name_languages = [0x409]
    opts.drop_tables += ['DSIG', 'STAT'] + ([] if keep_raster_tables else ['gasp'])
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=sorted(codepoints))
    sub.subset(font)
    if prep is not None:
        font['prep'] = prep
    font.flavor = 'woff2'
    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue()


# ----------------------------------------------------------------------------------------------
# Build: Font Awesome subset
# ----------------------------------------------------------------------------------------------
def build_icons(root, cache_dir, extra, dry_run, warnings, verbose=False, check=False):
    info('== Font Awesome %s subset ==' % FA_VERSION)
    src = {}
    for key, (path, sha) in FA_SOURCES.items():
        src[key] = download(FA_CDN + path, cache_dir, sha, warnings)
    css = src['css'].decode('utf-8')
    icons, layout, utilities = parse_fa_css(css)
    info('  original CSS defines %d icon class names' % len(icons))
    cmaps = {s: font_cmap(src[s]) for s in ('solid', 'regular', 'brands')}

    usage, css_cps, dynamic, where, nfiles = scan_project(root)
    info('  scanned %d files, found %d distinct fa-* tokens' % (nfiles, len(usage)))

    # classify tokens
    used = {}      # icon name -> set(styles or '?')
    unknown = []
    for name, styles in sorted(usage.items()):
        if name in icons:
            used[name] = set(styles)
        elif name in utilities:
            pass
        else:
            unknown.append(name)
    reserve_names = [n for n in RESERVE_ICONS + EXTRA_ICONS + list(extra or [])]
    for name in reserve_names:
        name = name if name.startswith('fa-') else 'fa-' + name
        if name not in icons:
            warnings.append('reserve/extra icon %s does not exist in Font Awesome Free %s' % (name, FA_VERSION))
            continue
        used.setdefault(name, set()).add('*')   # '*' = every style that has the glyph

    for u in unknown:
        warnings.append('unknown fa- class "%s" (not an icon / utility in FA Free %s) in: %s' % (
            u, FA_VERSION, ', '.join(sorted(where.get(u, [])))))
    for d in dynamic:
        warnings.append('dynamically built icon class - cannot be scanned, add the icon via --extra/EXTRA_ICONS: ' + d)

    # per-style code point sets
    cps = {'solid': set(), 'regular': set(), 'brands': set()}
    for name, styles in used.items():
        cp = icons[name]
        for st in styles:
            if st in ('?', '*'):
                # style unknown / reserve: solid + regular if the glyph exists there; brands only for brand glyphs
                targets = [s for s in ('solid', 'regular') if cp in cmaps[s]]
                if not targets and cp in cmaps['brands']:
                    targets = ['brands']
                if not targets:
                    warnings.append('%s (U+%X) is in no Font Awesome Free font' % (name, cp))
            else:
                targets = [st]
                if cp not in cmaps[st]:
                    warnings.append('%s is not available in the %s style of FA Free (%s) - it renders blank also with the original CSS; used in: %s' % (
                        name, st, FA_VERSION, ', '.join(sorted(where.get(name, [])))))
                    targets = []
            for s in targets:
                cps[s].add(cp)
    for st, s in css_cps.items():
        for cp in s:
            if cp in cmaps[st]:
                cps[st].add(cp)
            else:
                warnings.append('CSS content U+%X is not in the %s font' % (cp, st))

    # build subset fonts
    out_fonts = {}
    for st in ('solid', 'regular', 'brands'):
        if not cps[st]:
            continue
        font = load_ttfont(src[st])
        data = subset_woff2(font, cps[st], [])
        out_fonts[st] = (data, '%s.%s.woff2' % (FA_FILE_STEM[st], short_hash(data)))
        info('  %-8s %3d glyphs  %8s  (original %s)' % (st, len(cps[st]), human(len(data)), human(len(src[st]))))

    # icon rules: only the used class names, grouped by code point
    by_cp = {}
    for name in sorted(used):
        by_cp.setdefault(icons[name], []).append(name)
    icon_rules = []
    for cp, names in sorted(by_cp.items(), key=lambda kv: kv[1][0]):
        icon_rules.append('%s{content:"\\%x"}' % (','.join('.%s:before' % n for n in sorted(names)), cp))

    # compose the stylesheet
    lines = []
    for kind, rule in layout:
        if kind == 'rule':
            lines.append(rule)
        else:
            lines.extend(icon_rules)
    # @font-face (font-display:block like the original: invisible, never a tofu box, while loading)
    faces = []
    for st in ('brands', 'regular', 'solid'):
        if st in out_fonts:
            faces.append('@font-face{font-family:"%s";font-style:normal;font-weight:%d;font-display:block;'
                         'src:url(../fonts/%s) format("woff2")}' % (FA_FAMILY[st], FA_WEIGHT[st], out_fonts[st][1]))
    # the original puts each @font-face right before that style's weight rule; order is irrelevant for them
    header = ('/*!\n'
              ' * Font Awesome Free %s subset for voltguard.com.tr - GENERATED by tools/build-assets.py, do not edit.\n'
              ' * Same class names / rendering as the original all.min.css, limited to the icons the site uses\n'
              ' * (%d icon classes; glyphs: solid %d, regular %d, brands %d). Re-run the script after adding icons.\n'
              ' * Font Awesome Free by @fontawesome - https://fontawesome.com\n'
              ' * License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License)\n'
              ' * Copyright 2023 Fonticons, Inc.\n'
              ' */\n') % (FA_VERSION, len(used), len(cps['solid']), len(cps['regular']), len(cps['brands']))
    out_css = header + '\n'.join(faces + lines) + '\n'

    css_path = os.path.join(root, 'css', 'fa-subset.css')
    if verbose:
        for st in ('solid', 'regular', 'brands'):
            names = sorted(n for n in used if icons[n] in cps[st])
            info('  [%s] %s' % (st, ' '.join(names)))
    if check:
        stale = _differs(css_path, out_css)
        for st, (data, fname) in out_fonts.items():
            if not os.path.exists(os.path.join(root, 'fonts', fname)):
                stale = True
        if stale:
            warnings.append('css/fa-subset.css / fonts/fa-*.woff2 are OUT OF DATE - run: python tools/build-assets.py')
        else:
            info('  icon subset is up to date')
    info('  icon classes in css: %d (%d aliases merged by glyph), css/fa-subset.css = %s (original all.min.css %s)' % (
        len(used), len(used) - len(by_cp), human(len(out_css.encode('utf-8'))), human(len(src['css']))))
    if not dry_run:
        write_text(css_path, out_css)
        fonts_dir = os.path.join(root, 'fonts')
        keep = set(v[1] for v in out_fonts.values())
        for st, (data, fname) in out_fonts.items():
            write_bytes(os.path.join(fonts_dir, fname), data)
        if os.path.isdir(fonts_dir):
            for fn in os.listdir(fonts_dir):
                if fn.startswith('fa-') and fn.endswith('.woff2') and fn not in keep:
                    os.remove(os.path.join(fonts_dir, fn))
    return {'files': {st: v[1] for st, v in out_fonts.items()},
            'bytes': {st: len(v[0]) for st, v in out_fonts.items()},
            'css_bytes': len(out_css.encode('utf-8')),
            'used': sorted(used), 'glyphs': {s: len(v) for s, v in cps.items()}}


# ----------------------------------------------------------------------------------------------
# Build: Outfit / Inter
# ----------------------------------------------------------------------------------------------
def build_text_fonts(root, cache_dir, dry_run, warnings, check=False):
    from fontTools.varLib import instancer
    info('== Outfit / Inter web fonts ==')
    core = parse_ranges(CORE_RANGES)
    ext = parse_ranges(EXT_RANGES) - core
    greek = parse_ranges(GREEK_RANGES)
    plans = {
        # family: (limits for the instancer, declared weight range, [(subset name, code points, unicode-range set)])
        # Outfit keeps its full 100-900 axis: narrowing the axis re-bases the default master and makes the file bigger.
        # Inter: opsz pinned at 14 (what Google Fonts serves), wght cut to 400-900. Keep the 900 end: the
        # default master is 400, so only the 100-400 deltas are dropped and outlines/advances stay identical
        # to the Google-served font (cutting to 400-800 rescales + re-rounds the deltas: 0.02 % wider text
        # at 500-700, 1 px glyph-position shifts) for less than 1 KB more.
        'Outfit': ({}, '100 900', [('latin', core, core), ('latin-ext', ext, ext)]),
        'Inter': ({'opsz': 14, 'wght': (400, 900)}, '400 900',
                  [('latin', core, core), ('latin-ext', ext, ext), ('greek', greek, greek)]),
    }
    results = {}
    for fam, (limits, wrange, subsets) in plans.items():
        path, sha = TEXT_FONT_SOURCES[fam]
        data = download(GF_RAW + path, cache_dir, sha, warnings)
        base = load_ttfont(data)
        if limits:
            base = instancer.instantiateVariableFont(base, limits, inplace=False)
            buf = io.BytesIO()
            base.save(buf)
            base = buf.getvalue()
        else:
            base = data
        cmap = font_cmap(base)
        for sname, cps, _ in subsets:
            have = cps & cmap
            if not have:
                continue
            font = load_ttfont(base)
            blob = subset_woff2(font, have, OPENTYPE_FEATURES, keep_raster_tables=True)
            fname = '%s-%s.%s.woff2' % (fam.lower(), sname, short_hash(blob))
            results.setdefault(fam, {})[sname] = (fname, blob, wrange)
            info('  %-6s %-9s %3d chars %8s' % (fam, sname, len(have), human(len(blob))))

    # css/fonts.css
    css = []
    css.append('/*!\n * VoltGuard self-hosted fonts - GENERATED by tools/build-assets.py --fonts, do not edit.\n'
               ' * Outfit (c) The Outfit Project Authors, Inter (c) The Inter Project Authors - SIL Open Font License 1.1.\n'
               ' * Variable woff2 (Outfit wght 100-900, Inter wght 400-900 at opsz 14), subset to Latin + Turkish.\n'
               ' * "latin" holds everything Turkish text needs (ç ğ ı İ ö ş ü); "latin-ext"/"greek" load only when such\n'
               ' * characters appear. Fallback faces (size-adjust / *-override) are metrics-matched to Arial and Roboto\n'
               ' * so the swap from the system font to the web font does not shift the layout.\n */')
    for fam in ('Outfit', 'Inter'):
        for sname, (fname, blob, wrange) in results.get(fam, {}).items():
            ur = {'latin': core, 'latin-ext': ext, 'greek': greek}[sname]
            css.append('@font-face{font-family:"%s";font-style:normal;font-weight:%s;font-display:swap;'
                       'src:url(../fonts/%s) format("woff2");unicode-range:%s}' % (fam, wrange, fname, format_ranges(ur)))
    for fam in ('Outfit', 'Inter'):
        for fb in ('Arial', 'Roboto'):
            fam_name = '%s Fallback' % fam if fb == 'Arial' else '%s Fallback Roboto' % fam
            for weight, (sa, asc, desc, gap) in sorted(FALLBACK_METRICS[(fam, fb)].items()):
                srcs = ','.join('local("%s")' % n for n in FALLBACK_LOCAL[(fb, 'regular' if weight <= 500 else 'bold')])
                css.append('@font-face{font-family:"%s";font-weight:%d;src:%s;size-adjust:%.2f%%;ascent-override:%.2f%%;'
                           'descent-override:%.2f%%;line-gap-override:%.2f%%}' % (fam_name, weight, srcs, sa, asc, desc, gap))
    # html:root (specificity 0,1,1) wins over the plain :root definitions in css/style.css and
    # css/vg-shell.css, whatever the stylesheet order is.
    css.append('html:root{--font-heading:"Outfit","Outfit Fallback","Outfit Fallback Roboto",sans-serif;'
               '--font-body:"Inter","Inter Fallback","Inter Fallback Roboto",sans-serif;'
               '--vg-font-h:var(--font-heading);--vg-font-b:var(--font-body)}')
    out_css = '\n'.join(css) + '\n'
    info('  css/fonts.css = %s' % human(len(out_css.encode('utf-8'))))
    if check:
        stale = _differs(os.path.join(root, 'css', 'fonts.css'), out_css)
        for fam, d in results.items():
            for sname, (fname, blob, _) in d.items():
                if not os.path.exists(os.path.join(root, 'fonts', fname)):
                    stale = True
        if stale:
            warnings.append('css/fonts.css / fonts/outfit-*, inter-* are OUT OF DATE - run: python tools/build-assets.py --fonts')
        else:
            info('  text fonts are up to date')
    if not dry_run:
        write_text(os.path.join(root, 'css', 'fonts.css'), out_css)
        fonts_dir = os.path.join(root, 'fonts')
        keep = set()
        for fam, d in results.items():
            for sname, (fname, blob, _) in d.items():
                write_bytes(os.path.join(fonts_dir, fname), blob)
                keep.add(fname)
        for fn in os.listdir(fonts_dir):
            if re.match(r'^(outfit|inter)-.*\.woff2$', fn) and fn not in keep:
                os.remove(os.path.join(fonts_dir, fn))
    return {fam: {s: v[0] for s, v in d.items()} for fam, d in results.items()}, \
           {fam: {s: len(v[1]) for s, v in d.items()} for fam, d in results.items()}


def sync_refs(root, current, dry_run, warnings):
    """Point every /fonts/<stem>.<hash>.woff2 reference in the project to the current hashed file name."""
    pat = re.compile(r'(fonts/)((?:fa-solid-900|fa-regular-400|fa-brands-400|outfit-latin-ext|outfit-latin|inter-latin-ext|inter-latin|inter-greek))\.[0-9a-f]{8}\.woff2')
    changed = 0
    for full, rel in iter_project_files(root):
        if rel.endswith('.css'):
            continue
        with open(full, 'rb') as f:
            raw = f.read()
        text = raw.decode('utf-8', errors='surrogateescape')

        def repl(m):
            name = current.get(m.group(2))
            if not name:
                warnings.append('%s references fonts/%s.*.woff2 which is no longer generated' % (rel, m.group(2)))
                return m.group(0)
            return m.group(1) + name
        new = pat.sub(repl, text)
        if new != text:
            changed += 1
            info('  updated font references in %s' % rel)
            if not dry_run:
                with open(full, 'wb') as f:
                    f.write(new.encode('utf-8', errors='surrogateescape'))
    info('  %d file(s) %s' % (changed, 'would change' if dry_run else 'updated'))


def existing_text_fonts(root):
    """File names of the committed Outfit/Inter fonts (used for manifest.json when --fonts is not run)."""
    out = {}
    fonts_dir = os.path.join(root, 'fonts')
    if os.path.isdir(fonts_dir):
        for fn in sorted(os.listdir(fonts_dir)):
            m = re.match(r'^(outfit|inter)-([a-z-]+)\.[0-9a-f]{8}\.woff2$', fn)
            if m:
                out.setdefault(m.group(1).capitalize(), {})[m.group(2)] = fn
    return out


# ----------------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description='VoltGuard self-hosted font/icon builder (see the docstring at the top of the file).')
    ap.add_argument('--root', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'), help='project root (default: parent of tools/)')
    ap.add_argument('--fonts', action='store_true', help='also rebuild Outfit/Inter woff2 + css/fonts.css (needs network)')
    ap.add_argument('--no-icons', action='store_true', help='skip the Font Awesome step (use with --fonts)')
    ap.add_argument('--dry-run', action='store_true', help='scan and report, write nothing')
    ap.add_argument('--extra', nargs='*', default=[], help='extra icon class names to force-include, e.g. fa-bell fa-fire')
    ap.add_argument('--cache', default=os.path.join(tempfile.gettempdir(), 'voltguard-assets-cache'), help='download cache directory')
    ap.add_argument('--strict', action='store_true', help='exit with status 1 when there are warnings (or, with --check, when outputs are stale)')
    ap.add_argument('--check', action='store_true', help='write nothing; report (and with --strict fail) when committed outputs differ from a fresh build')
    ap.add_argument('--sync-refs', action='store_true', help='rewrite /fonts/<name>.<hash>.woff2 references in html/php/js files to the current hashed file names')
    ap.add_argument('-v', '--verbose', action='store_true', help='list the icon names per font style')
    args = ap.parse_args()

    try:
        import fontTools  # noqa: F401
        import brotli  # noqa: F401
    except ImportError:
        sys.exit('Missing dependency: run  pip install fonttools brotli')

    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(errors='replace')
    root = os.path.abspath(args.root)
    warnings = []
    if args.check:
        args.dry_run = True
    icon_res = text_res = None
    if not args.no_icons:
        icon_res = build_icons(root, args.cache, args.extra, args.dry_run, warnings, args.verbose, args.check)
    if args.fonts:
        text_res = build_text_fonts(root, args.cache, args.dry_run, warnings, args.check)

    # manifest for whoever wires <link rel="preload"> into the pages
    if not args.dry_run:
        mpath = os.path.join(root, 'fonts', 'manifest.json')
        old = {}
        if os.path.exists(mpath):
            try:
                old = json.loads(read_text(mpath))
            except ValueError:
                old = {}
        text_files = text_res[0] if text_res else old.get('text', existing_text_fonts(root))
        icon_files = icon_res['files'] if icon_res else old.get('icons', {})
        preload = []
        for fam in ('Outfit', 'Inter'):
            if 'latin' in text_files.get(fam, {}):
                preload.append('/fonts/' + text_files[fam]['latin'])
        if 'solid' in icon_files:
            preload.append('/fonts/' + icon_files['solid'])
        if 'brands' in icon_files:
            preload.append('/fonts/' + icon_files['brands'])
        manifest = {'text': text_files, 'icons': icon_files, 'preload': preload,
                    'css': ['/css/fonts.css', '/css/fa-subset.css']}
        write_text(mpath, json.dumps(manifest, indent=2) + '\n')
        info('')
        info('Preload hints (also in fonts/manifest.json; keep only what a page really needs):')
        for p in preload:
            info('  <link rel="preload" href="%s" as="font" type="font/woff2" crossorigin>' % p)

    if args.sync_refs:
        manifest_path = os.path.join(root, 'fonts', 'manifest.json')
        if os.path.exists(manifest_path):
            man = json.loads(read_text(manifest_path))
            current = {}
            for fam, d in man.get('text', {}).items():
                for sname, fname in d.items():
                    current['%s-%s' % (fam.lower(), sname)] = fname
            for st, fname in man.get('icons', {}).items():
                current[FA_FILE_STEM[st]] = fname
            info('')
            info('Syncing font references:')
            sync_refs(root, current, args.dry_run, warnings)

    info('')
    if warnings:
        info('%d WARNING(S):' % len(warnings))
        for w in warnings:
            info('  - ' + w)
    else:
        info('No warnings.')
    if args.dry_run:
        info('(dry run: nothing written)')
    if args.strict and warnings:
        sys.exit(1)


if __name__ == '__main__':
    main()

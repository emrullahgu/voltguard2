"""Create sanitized symbol bodies from the included, pinned CC0 source SVGs.

Run from this directory: python prepare-sources.py
Bounding boxes for upb symbols are resolved by finalize-library.cjs in a browser.
"""
from pathlib import Path
import json
import re
import xml.etree.ElementTree as ET

BASE = Path(__file__).resolve().parent
NS = "{http://www.w3.org/2000/svg}"
ALLOWED = {"g", "symbol", "path", "rect", "line", "polyline", "polygon", "circle", "ellipse", "text", "tspan", "defs", "marker", "linearGradient", "radialGradient", "stop", "clipPath", "use"}
ATTRS = {"id", "d", "points", "transform", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-opacity", "fill-opacity", "opacity", "style", "font-size", "font-family", "font-style", "font-weight", "text-anchor", "dominant-baseline", "marker-start", "marker-end", "marker-mid", "markerWidth", "markerHeight", "refX", "refY", "orient", "markerUnits", "viewBox", "offset", "stop-color", "stop-opacity", "clip-path", "clipPathUnits", "gradientUnits", "gradientTransform", "href"}
TRANSLATE = {"resistor": "Direnç", "resistor-adjustable": "Ayarlı direnç", "resistor-potentiometer": "Potansiyometre", "resistor-ldr": "Işığa duyarlı direnç", "capacitor": "Kondansatör", "capacitor-polarized": "Kutuplu kondansatör", "capacitor-adjustable": "Ayarlı kondansatör", "inductor": "Bobin", "inductor-with-core": "Çekirdekli bobin", "inductor-coupled": "Kuplajlı bobin", "transformer": "Transformatör", "ground-earth": "Topraklama", "ground-signal": "Sinyal toprağı", "source-voltage": "Gerilim kaynağı", "source-current": "Akım kaynağı", "source-voltage-controlled": "Kontrollü gerilim kaynağı", "source-current-controlled": "Kontrollü akım kaynağı", "ammeter": "Ampermetre", "voltmeter": "Voltmetre", "diode": "Diyot", "diode-zener": "Zener diyot", "diode-led": "LED", "diode-photodiode": "Fotodiyot", "opamp-single-output": "İşlemsel yükselteç", "opamp-diff-output": "Diferansiyel yükselteç", "wire": "İletken", "wire-terminal": "Bağlantı ucu", "wire-connection": "İletken birleşimi", "wire-crossing": "İletken kesişimi", "impedance": "Empedans", "impedance-adjustable": "Ayarlı empedans", "loudspeaker": "Hoparlör", "piezo": "Piezo dönüştürücü", "annotation-voltage": "Gerilim yönü", "annotation-voltage-contact": "Gerilim ölçüm noktası", "annotation-current": "Akım yönü"}
UPB_TRANSLATE = {"Resistor": "Direnç", "Varistor": "Varistör", "Potentiometer": "Potansiyometre", "Capacitor": "Kondansatör", "Inductor": "Bobin", "Transformer": "Transformatör", "Ground": "Topraklama", "Earth": "Toprak", "Diode": "Diyot", "Zener diode": "Zener diyot", "Voltage source": "Gerilim kaynağı", "Current source": "Akım kaynağı", "Switch": "Anahtar", "Fuse": "Sigorta", "Battery": "Batarya", "Motor": "Motor", "Generator": "Jeneratör"}

def clean(node, prefix):
    tag = node.tag.split("}")[-1]
    if tag not in ALLOWED:
        return None
    result = ET.Element("g" if tag == "symbol" else tag)
    for name, value in node.attrib.items():
        local = name.split("}")[-1]
        if name.startswith("{") and local != "href":
            continue
        if local not in ATTRS or "javascript:" in value.lower() or "@import" in value.lower():
            continue
        if local == "href" and not value.startswith("#"):
            continue
        if "url(" in value and re.search(r"url\(\s*[^#]", value):
            continue
        if local == "id":
            value = prefix + value
        if local == "href":
            value = "#" + prefix + value[1:]
        value = re.sub(r"url\(#([^)]*)\)", lambda m: "url(#" + prefix + m[1] + ")", value)
        if local == "style":
            value = re.sub(r"(?:-inkscape|inkscape)[^:;]*:[^;]*;?", "", value)
        result.set(local, value)
    result.text = node.text if tag in {"text", "tspan"} else None
    for child in node:
        child_clean = clean(child, prefix)
        if child_clean is not None:
            result.append(child_clean)
    return result

def string(node):
    return ET.tostring(node, encoding="unicode", short_empty_elements=True)

symbols = []
for file in sorted((BASE / "sources/basverdoes").rglob("*.svg")):
    relative = file.relative_to(BASE / "sources/basverdoes").as_posix()
    symbol_id = "bas-" + re.sub(r"[^a-z0-9]+", "-", relative[:-4].lower())
    root = ET.parse(file).getroot()
    children = [clean(n, symbol_id + "-") for n in root if n.tag.split("}")[-1] in ALLOWED]
    body = "".join(string(n) for n in children if n is not None)
    stem = file.stem
    standard = "ANSI" if "analog-ansi" in relative else "IEC" if "analog-iec" in relative else "Genel"
    category = "Yarı iletkenler" if "/semiconductors/" in relative else "Dönüştürücüler" if "/transducers/" in relative else "Sayısal mantık" if "digital" in relative else "Temel devre"
    symbols.append({"id": symbol_id, "name": TRANSLATE.get(stem, stem.replace("-", " ").capitalize()), "english": stem.replace("-", " "), "category": category, "standard": standard, "source": "basverdoes", "sourcePath": "src/symbols/" + relative, "viewBox": root.get("viewBox"), "body": body})

root = ET.parse(BASE / "sources/upb/Inkscape_Symbols_All.svg").getroot()
by_id = {n.get("id"): n for n in root.iter() if n.get("id")}
for i, node in enumerate(root.findall(".//" + NS + "symbol")):
    title = node.find(".//" + NS + "title")
    english = title.text.strip() if title is not None and title.text else node.get("id", "")
    if re.fullmatch(r"(?:g|symbol)\d+", english):
        continue
    english = english.replace("_", " ")
    symbol_id = "upb-" + node.get("id")
    group = ET.Element("g")
    for child in node:
        child_clean = clean(child, symbol_id + "-")
        if child_clean is not None:
            group.append(child_clean)
    needed = []
    seen = set()
    def collect_refs(element):
        refs = set(re.findall(r"url\(#([^)]*)\)|href=\"#([^\"]+)\"", string(element)))
        for pair in refs:
            ref = next(v for v in pair if v)
            if ref in by_id and ref not in seen:
                seen.add(ref)
                definition = clean(by_id[ref], symbol_id + "-")
                if definition is not None:
                    needed.append(definition)
                    collect_refs(by_id[ref])
    collect_refs(node)
    if needed:
        defs = ET.Element("defs")
        defs.extend(needed)
        group.insert(0, defs)
    lower = english.lower()
    category = "Güç elektroniği" if any(s in lower for s in ["igbt", "mosfet", "thyristor", "transistor", "diode", "sic", "gan"]) else "Ölçüm ve kontrol" if any(s in lower for s in ["control", "sensor", "meter", "scope", "block", "pi ", "gain", "sum"]) else "Kaynak ve yük" if any(s in lower for s in ["source", "motor", "generator", "battery", "grid", "voltage", "current", "earth", "ground"]) else "Temel devre"
    name = UPB_TRANSLATE.get(english, UPB_TRANSLATE.get(english.replace(" ", "_"), english))
    symbols.append({"id": symbol_id, "name": name, "english": english, "category": category, "standard": "UPB", "source": "upb-lea", "sourcePath": "Inkscape_Symbols_All.svg#" + node.get("id"), "viewBox": None, "body": string(group)})

(BASE / "library-unbounded.json").write_text(json.dumps(symbols, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"Prepared {len(symbols)} CC0 symbol bodies")

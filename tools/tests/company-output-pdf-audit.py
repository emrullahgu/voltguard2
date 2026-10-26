"""Render the PDFs actually produced by the latest isolated browser report for visual review."""
import json
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image
from pypdf import PdfReader

directory = Path(sys.argv[1] if len(sys.argv) > 1 else ".qa/company-outputs").resolve()
report = json.loads((directory / "report.json").read_text(encoding="utf-8"))
renderer = Path(os.environ.get("VG_PDFTOPPM", str(Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe")))
rendered = directory / "rendered"
rendered.mkdir(exist_ok=True)
pdfs = set()
for item in report.get("downloads", []):
    name = item.get("name", "")
    if name.lower().endswith(".pdf"):
        for filename in (item.get("label", "") + "-" + name, name):
            candidate = directory / filename
            if candidate.is_file():
                pdfs.add(candidate)
                break
for item in report.get("printArtifacts", []):
    candidate = Path(item["path"]).resolve()
    if candidate.parent == directory and candidate.is_file():
        pdfs.add(candidate)
audit = {"sourceReport": str(directory / "report.json"), "pdfs": [], "findings": []}
for filename in sorted(pdfs):
    reader = PdfReader(filename)
    subprocess.run([str(renderer), "-scale-to", "1100", "-png", str(filename), str(rendered / filename.stem)], check=True, capture_output=True)
    pages = []
    for index, page in enumerate(reader.pages, start=1):
        image_file = rendered / (filename.stem + "-" + str(index) + ".png")
        with Image.open(image_file) as image:
            rgb = image.convert("RGB")
            width, height = rgb.size
            body = rgb.crop((0, 0, width, int(height * .93)))
            histogram = body.convert("L").histogram()
            ink = sum(histogram[:235]) / (body.width * body.height)
        pages.append({"page": index, "png": str(image_file), "bodyInkFraction": round(ink, 5), "text": (page.extract_text() or "")[:250]})
        if ink < .0007:
            audit["findings"].append({"pdf": str(filename), "page": index, "problem": "Blank body or footer-only continuation"})
    audit["pdfs"].append({"pdf": str(filename), "pages": len(reader.pages), "bytes": filename.stat().st_size, "rendered": pages})
(directory / "pdf-audit.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"pdfs": len(audit["pdfs"]), "pages": sum(item["pages"] for item in audit["pdfs"]), "findings": audit["findings"], "report": str(directory / "pdf-audit.json")}, ensure_ascii=True))
if audit["findings"]:
    sys.exit(1)

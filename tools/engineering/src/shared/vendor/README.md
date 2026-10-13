# VoltGuard local export dependencies

- html2canvas 1.4.1 — https://github.com/niklasvh/html2canvas — MIT license (license header retained in the distributed file).
- jsPDF 3.0.3 — https://github.com/parallax/jsPDF — MIT license (license header retained in the distributed file).

Both dependencies are pinned and served locally. Portable HTML embeds both bundles, so PDF generation does not depend on a CDN.

The PDF exporter rasterizes the native report at up to 2× resolution. This preserves Turkish glyphs, SVG drawings and table formatting without relying on PDF viewer fonts. Use A4 print for selectable browser-rendered text. Native table rows, charts and headings guide PDF page breaks; very large drawings are fitted to the full page width.

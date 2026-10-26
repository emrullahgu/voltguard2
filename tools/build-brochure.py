#!/usr/bin/env python3
"""Build the two-sided A4 VoltGuard brochure from real public site assets.

Run with the bundled Python (reportlab + Pillow). Output is deterministic;
the supplied reference and the existing long catalogue are never overwritten.
"""
from pathlib import Path
import hashlib
import io
import json
import os

from PIL import Image, ImageOps
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.graphics import renderPDF
from reportlab.graphics.shapes import Drawing
from reportlab.graphics.barcode.qr import QrCodeWidget

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'output/pdf/VoltGuard-Kurumsal-Brosur.pdf'
PUBLIC = ROOT / 'public/voltguard-brosur.pdf'
W, H = landscape(A4)
PW = W / 3
M = 22
NAVY = '#0A1628'
INK = '#17365A'
MUTED = '#52667C'
GOLD = '#F5A000'
CYAN = '#20BCD9'
PALE = '#F2F6FA'
WHITE = '#FFFFFF'
SITE = 'https://voltguard.com.tr'
CHECKS = []


def fonts():
    candidates = [
        Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts',
        Path('/usr/share/fonts/truetype/msttcorefonts'),
        Path('/usr/share/fonts/truetype/dejavu'),
    ]
    for folder in candidates:
        normal = next((folder / f for f in ['arial.ttf', 'Arial.ttf', 'DejaVuSans.ttf'] if (folder / f).is_file()), None)
        bold = next((folder / f for f in ['arialbd.ttf', 'Arial_Bold.ttf', 'DejaVuSans-Bold.ttf'] if (folder / f).is_file()), None)
        if normal and bold:
            pdfmetrics.registerFont(TTFont('VG', str(normal)))
            pdfmetrics.registerFont(TTFont('VG-Bold', str(bold)))
            pdfmetrics.registerFontFamily('VG', normal='VG', bold='VG-Bold', italic='VG', boldItalic='VG-Bold')
            return
    raise RuntimeError('A Turkish-capable Arial or DejaVu Sans font family is required.')


def rect(c, x, top, width, height, fill, radius=0):
    c.setFillColor(colors.HexColor(fill))
    if radius:
        c.roundRect(x, H-top-height, width, height, radius, fill=1, stroke=0)
    else:
        c.rect(x, H-top-height, width, height, fill=1, stroke=0)


def txt(c, text, x, top, width, size=10, leading=None, color=INK, bold=False, max_height=None):
    leading = leading or size * 1.38
    p = Paragraph(text, ParagraphStyle('vg', fontName='VG-Bold' if bold else 'VG', fontSize=size,
        leading=leading, textColor=colors.HexColor(color), spaceBefore=0, spaceAfter=0,
        allowWidows=0, allowOrphans=0, splitLongWords=0))
    measured_w, height = p.wrap(width, H)
    if max_height and height > max_height + .1:
        raise ValueError(f'Text exceeds its allocated area: {text!r}: {height} > {max_height}')
    if top + height > H - 20:
        raise ValueError(f'Text exceeds page: {text!r}')
    p.drawOn(c, x, H-top-height)
    CHECKS.append({'page': c.getPageNumber(), 'text': text, 'x': round(x,2), 'top': top,
        'width': round(width,2), 'height': round(height,2), 'size': size})
    return height


def photo(c, relative, x, top, width, height, focus=(.5, .5), radius=10):
    file = ROOT / relative
    with Image.open(file) as source:
        image = source.convert('RGB')
        # 240 dpi is ample at panel size; keep text/QR vector and avoid embedding
        # multi-megapixel originals that make a short brochure needlessly large.
        pixels = (round(width / 72 * 240), round(height / 72 * 240))
        image = ImageOps.fit(image, pixels, Image.Resampling.LANCZOS, centering=focus)
        encoded = io.BytesIO()
        image.save(encoded, format='JPEG', quality=90, optimize=True, subsampling=0)
        encoded.seek(0)
        c.saveState()
        clip = c.beginPath()
        clip.roundRect(x, H-top-height, width, height, radius)
        c.clipPath(clip, stroke=0, fill=0)
        c.drawImage(ImageReader(encoded), x, H-top-height, width, height, mask='auto')
        c.restoreState()


def kicker(c, panel, label, color=MUTED):
    x = panel*PW + M
    rect(c, x, 25, 30, 4, GOLD, 2)
    txt(c, label, x, 42, PW-2*M, 8, 11, color, True, 22)


def footer(c, panel, label='voltguard.com.tr', target='/', dark=False):
    x = panel*PW + M
    rect(c, x, 552, PW-2*M, 2.5, GOLD, 1)
    txt(c, label, x, 565, PW-2*M, 8, 10, '#CFDAE8' if dark else MUTED, max_height=12)
    c.linkURL(SITE + target, (x, H-578, x+PW-2*M, H-559), relative=0, thickness=0)


def bullets(c, values, x, top, width, size=9.6, color=INK, gap=12):
    for text in values:
        rect(c, x, top+5, 3, 3, GOLD, 1.5)
        height = txt(c, text, x+11, top, width-11, size, size*1.45, color)
        top += height + gap
    return top


def url(c, text, target, x, top, width, size=10, color=INK, bold=False):
    height = txt(c, text, x, top, width, size, size*1.4, color, bold)
    c.linkURL(target, (x, H-top-height-2, x+width, H-top+2), relative=0, thickness=0)


def qr(c, target, x, top, size=90):
    widget = QrCodeWidget(target, barLevel='M', barBorder=4)
    bounds = widget.getBounds()
    bw, bh = bounds[2]-bounds[0], bounds[3]-bounds[1]
    d = Drawing(size, size, transform=[size/bw,0,0,size/bh,0,0])
    d.add(widget)
    rect(c, x-4, top-4, size+8, size+8, WHITE, 6)
    renderPDF.draw(d, c, x, H-top-size)
    c.linkURL(target, (x, H-top-size, x+size, H-top), relative=0, thickness=0)


def outside(c):
    rect(c, 0, 0, W, H, WHITE)
    rect(c, PW, 0, PW, H, PALE)
    rect(c, PW*2, 0, PW, H, NAVY)

    # Fold-in flap: actual team and a short service process.
    x = M
    kicker(c, 0, 'İŞİN ARKASINDAKİ EKİP')
    txt(c, 'Keşiften bakıma,<br/>aynı ekip yanınızda.', x, 77, PW-2*M, 19.5, 24, bold=True, max_height=50)
    photo(c, 'public/ekip-ruhu-pano-kurulumu.jpg', x, 143, PW-2*M, 180, focus=(.5,.43))
    for top, number, heading, body in [
        (345, '01', 'Keşif ve ihtiyaç analizi', 'Tesisinize uygun kapsamı netleştiririz.'),
        (403, '02', 'Planlı uygulama', 'Proje, malzeme ve saha işlerini birleştiririz.'),
        (461, '03', 'Ölçüm ve takip', 'Kontrol, kayıt ve bakım adımlarıyla ilerleriz.'),
    ]:
        txt(c, number, x, top, 28, 16, 20, GOLD, True)
        txt(c, heading, x+34, top, PW-2*M-34, 10.4, 14, bold=True, max_height=28)
        txt(c, body, x+34, top+20, PW-2*M-34, 8.8, 12.5, MUTED, max_height=26)
    footer(c, 0, 'İzmir Ege Teknopark | Türkiye geneli saha hizmeti', '/hakkimizda.html')

    # Back panel: useful contact, scannable QR and the verified company identity.
    x = PW+M
    kicker(c, 1, 'İLETİŞİM VE ÜCRETSİZ KEŞİF')
    txt(c, 'Projenizi<br/>konuşalım.', x, 77, PW-2*M, 25, 29, bold=True, max_height=60)
    url(c, '0545 434 67 35', 'tel:+905454346735', x, 157, PW-2*M, 18, INK, True)
    url(c, 'info@voltguard.com.tr', 'mailto:info@voltguard.com.tr', x, 193, PW-2*M, 11)
    url(c, 'voltguard.com.tr', SITE+'/', x, 216, PW-2*M, 11, INK, True)
    rect(c, x, 248, PW-2*M, 1, '#D6E0EB')
    txt(c, 'EGE TEKNOPARK TGB', x, 268, PW-2*M, 8.7, 12, bold=True)
    txt(c, 'Ege Üniversitesi Kampüsü, Ankara Cd. No:172/69<br/>Turkuaz B Blok, Kat:2, BB43<br/>Erzene Mahallesi, Bornova / İzmir',
        x, 288, PW-2*M, 9.1, 13.5, MUTED, max_height=56)
    qr(c, SITE+'/iletisim.html', x, 363, 88)
    txt(c, 'QR kodu okutun.<br/><b>Keşif talebinizi<br/>siteden iletin.</b>', x+105, 376, PW-2*M-105, 10.2, 15, max_height=60)
    txt(c, 'VoltGuard Elektrik Elektronik ve Mekanik<br/>Mühendisliği Limited Şirketi', x, 484, PW-2*M, 8.7, 12.5, MUTED, max_height=38)
    footer(c, 1, 'Hizmetler, projeler ve teklif: voltguard.com.tr', '/iletisim.html')

    # Cover: compact original brand treatment and real work photography.
    x = 2*PW+M
    c.drawImage(ImageReader(str(ROOT/'public/voltguard-logo.webp')), x, H-76, 44, 44, mask='auto')
    word_x = x+54
    txt(c, 'Volt<font color="#20BCD9">Guard</font>', word_x, 34, PW-2*M-54, 26, 30, WHITE, True, 33)
    txt(c, 'ENGINEERING SOLUTIONS', word_x+1, 67, PW-2*M-54, 6.9, 9, '#D4DEEB', max_height=10)
    photo(c, 'public/panokurulumuverevizyonu.jpg', x, 108, PW-2*M, 228, focus=(.5,.42))
    rect(c, x+12, 320, 153, 25, GOLD, 12)
    txt(c, 'ELEKTRİK MÜHENDİSLİĞİ', x+23, 327, 133, 7.5, 11, NAVY, True, 12)
    txt(c, 'Elektrikte güven.<br/>Enerjide süreklilik.', x, 371, PW-2*M, 20.5, 26, WHITE, True, 54)
    txt(c, 'Trafo, pano, ölçüm ve otomasyon.<br/>Tesisiniz için planlı mühendislik.', x, 444, PW-2*M, 10.2, 15, '#D4DEEB', max_height=33)
    footer(c, 2, 'voltguard.com.tr', '/', dark=True)
    c.bookmarkPage('kapak')
    c.addOutlineEntry('Broşür dış yüzü ve iletişim', 'kapak')
    c.showPage()


def inside(c):
    rect(c, 0, 0, W, H, WHITE)
    rect(c, PW, 0, PW, H, PALE)
    # Three inside panels: concise technical scope, without made-up guarantees.
    x = M
    kicker(c, 0, 'TRAFO VE ENERJİ SÜREKLİLİĞİ')
    txt(c, 'Trafo işletme<br/>sorumluluğu ve bakım', x, 77, PW-2*M, 18.5, 23, bold=True, max_height=49)
    photo(c, 'public/trafo-astor-kurulumu.jpg', x, 143, PW-2*M, 169, focus=(.5,.53))
    bottom = bullets(c, [
        'YG işletme sorumluluğu ve işletme defteri takibi',
        'Trafo, OG hücre ve koruma kontrolleri',
        'Planlı bakım ve arıza risklerinin değerlendirilmesi',
        'Kontrol bulgularının teknik raporlanması',
    ], x+2, 334, PW-2*M-4, 9.6, gap=10)
    if bottom > 491: raise ValueError('Trafo scope collides with its callout')
    rect(c, x, 490, PW-2*M, 47, NAVY, 9)
    txt(c, 'Süreklilik, planlı kontrol ve<br/>bakımla başlar.', x+13, 501, PW-2*M-26, 10.5, 14, WHITE, True, 30)
    footer(c, 0, 'Trafo hizmetlerini inceleyin', '/hizmetler/trafo-isletme-sorumlulugu.html')

    x = PW+M
    kicker(c, 1, 'ÖLÇÜM, PANO VE PROJE')
    txt(c, 'Ölçün. Kontrol edin.<br/>Güvenle uygulayın.', x, 77, PW-2*M, 18.5, 23, bold=True, max_height=49)
    photo(c, 'public/Trafoolcum.jpeg', x, 143, PW-2*M, 142, focus=(.5,.43))
    txt(c, 'Periyodik kontroller', x, 307, PW-2*M, 12.5, 17, bold=True)
    bottom = bullets(c, [
        'Topraklama, koruma testleri ve termal kontroller',
        'Enerji kalitesi ve harmonik analizi',
        'Uygunsuzluk bulguları ve teknik rapor',
    ], x+2, 336, PW-2*M-4, 9.5, gap=8)
    if bottom > 436: raise ValueError('Measurement scope collides with panel section')
    rect(c, x, 436, PW-2*M, 1, '#D6E0EB')
    txt(c, 'Pano, revizyon ve proje', x, 453, PW-2*M, 12.5, 17, bold=True)
    bullets(c, ['Pano tasarımı, imalatı ve etiketleme', 'Elektrik projesi, kurulum ve kabul hazırlığı'],
        x+2, 482, PW-2*M-4, 9.2, gap=8)
    footer(c, 1, 'Kontrol ve pano çözümlerine göz atın', '/hizmetler/')

    x = PW*2+M
    kicker(c, 2, 'OTOMASYON VE VERİMLİLİK')
    txt(c, 'Üretimi izleyin.<br/>Enerjinizi yönetin.', x, 77, PW-2*M, 18.5, 23, bold=True, max_height=49)
    photo(c, 'public/scada-biyolojik-aritma-proses-ekrani.jpg', x, 143, PW-2*M, 142, radius=8)
    txt(c, 'Gerçek bir SCADA proses ekranından', x+1, 293, PW-2*M-2, 7.3, 10, MUTED)
    txt(c, 'PLC / SCADA ve izleme', x, 325, PW-2*M, 12.5, 17, bold=True)
    bullets(c, ['Proses izleme, kontrol ve yazılım', 'Devreye alma ve teknik destek'], x+2, 353, PW-2*M-4, 9.5, gap=10)
    rect(c, x, 419, PW-2*M, 1, '#D6E0EB')
    txt(c, 'GES ve enerji kalitesi', x, 438, PW-2*M, 12.5, 17, bold=True)
    bullets(c, ['GES projelendirme ve uygulama süreçleri', 'Kompanzasyon ve harmonik iyileştirme'], x+2, 466, PW-2*M-4, 9.5, gap=10)
    footer(c, 2, 'VoltSim ve ücretsiz hesap araçları sitemizde', '/teknik-kaynaklar.html')
    c.bookmarkPage('hizmetler')
    c.addOutlineEntry('Broşür iç yüzü ve hizmet kapsamları', 'hizmetler')
    c.showPage()


def main():
    fonts()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=(W,H), pageCompression=1, invariant=1)
    c.setTitle('VoltGuard Kurumsal Broşür | Elektrik Mühendisliği')
    c.setAuthor('VoltGuard Mühendislik')
    c.setSubject('A4 yatay, iki yüz, üç panel. Trafo, pano, kontrol, otomasyon ve enerji çözümleri.')
    c.setCreator('VoltGuard Brochure Builder')
    c.setViewerPreference('DisplayDocTitle', 'true')
    c.setPageCompression(1)
    outside(c)
    inside(c)
    c.save()
    PUBLIC.write_bytes(OUT.read_bytes())
    report = {'output':str(OUT),'public':str(PUBLIC),'pages':2,'format':'A4 landscape, 3 panels per side',
        'bytes':OUT.stat().st_size,'sha256':hashlib.sha256(OUT.read_bytes()).hexdigest(),'textBoxes':CHECKS}
    report_path = ROOT/'.qa/brand-brochure/build-report.json'
    report_path.parent.mkdir(parents=True,exist_ok=True)
    report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({k:v for k,v in report.items() if k!='textBoxes'},ensure_ascii=False))


if __name__ == '__main__':
    main()

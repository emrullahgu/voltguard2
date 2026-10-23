"""Update obsolete catalogue contact text while preserving the original artwork."""
from pathlib import Path
import fitz

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / 'tools/staff-app/public/fonts/NotoSans-Regular.ttf'
FILES = ['public/voltguard-katalog.pdf', 'public/opt/voltguard-katalog.pdf']
ADDRESS = 'Ege Teknopark TGB, Turkuaz B Blok, Kat:2 BB43, Bornova / İzmir'
CONTACT = 'info@voltguard.com.tr | voltguard.com.tr | 0545 434 67 35'


def update(name):
    file = ROOT / name
    doc = fitz.open(file)
    count = 0
    for page in doc:
        changes = []
        # Work with individual lines so the company name and page numbers remain intact.
        for block in page.get_text('dict')['blocks']:
            for line in block.get('lines', []):
                text = ''.join(span['text'] for span in line['spans']).strip()
                rect = fitz.Rect(line['bbox'])
                if rect.y0 > 730 and text.startswith('Adalet Mah.'):
                    changes.append((rect, ADDRESS, 8.3, True))
                elif rect.y0 > 730 and text.startswith('Mail:'):
                    changes.append((rect, CONTACT, 8.3, True))
                elif '0538 207 01 73' in text:
                    changes.append((rect, '0545 434 67 35', 11, True))
                elif text.startswith('Adalet Mah.'):
                    # The existing address cell has two lines. Refit all of it in three lines.
                    cell = fitz.Rect(217, rect.y0 - 1, 540, rect.y0 + 33)
                    changes.append((cell, 'Ege Üniversitesi Kampüsü, Ankara Cd. No:172/69\nEge Teknopark TGB, Turkuaz B Blok, Kat:2 BB43\nErzene Mahallesi, Bornova / İzmir', 7.6, False))
        for rect, text, size, centered in changes:
            page.add_redact_annot(rect, fill=(1, 1, 1))
        if changes:
            # Redact text only; never alter underlying photographs, logos or table rules.
            page.apply_redactions(images=0, graphics=0)
            page.insert_font(fontname='VGContact', fontfile=str(FONT))
        for rect, text, size, centered in changes:
            box = fitz.Rect(70, rect.y0 - 1, page.rect.width - 55, rect.y1 + 4) if centered else rect
            spare = page.insert_textbox(box, text, fontsize=size, fontname='VGContact',
                                        color=(.2,.2,.2), align=1 if centered else 0, lineheight=1.2)
            if spare < 0:
                raise ValueError(f'Contact text does not fit: {name}, page {page.number + 1}')
            count += 1
    if count:
        doc.subset_fonts()
        stage = file.with_suffix('.updated.pdf')
        doc.save(stage, garbage=4, deflate=True)
        doc.close()
        check = fitz.open(stage)
        text = '\n'.join(page.get_text() for page in check)
        assert 'Adalet Mah.' not in text and '0538 207 01 73' not in text
        assert 'Bornova / İzmir' in text
        check.close()
        stage.replace(file)
    else:
        doc.close()
    print(f'{name}: {count} contact lines updated')


if __name__ == '__main__':
    for file in FILES:
        update(file)

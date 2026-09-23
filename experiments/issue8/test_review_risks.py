"""Issue #11: source-mark pixels and invalid quantity parsing, separate from accuracy scores."""
from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageDraw, ImageFont

from glyph_model import GlyphModel
from layout_legend import make_preview
from recognize import ROOT, recognize
from source_marks import source_conflicts


class ReviewRiskChecks(unittest.TestCase):
    def test_explicit_source_marks_are_not_certified_from_legal_codes(self):
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 28)
        for text in ['MARD 221', 'MARD', 'ARTKAL', 'MARD    HAMA', 'PERLER', 'NABBI', 'MARD 291']:
            with self.subTest(text=text), Image.new('RGB', (600, 120), 'white') as image:
                ImageDraw.Draw(image).text((20, 25), text, font=font, fill='black')
                conflicts = source_conflicts(image, make_preview(image), GlyphModel(), None, [])
                self.assertEqual(bool(conflicts), text not in ['MARD 221', 'MARD'])
                self.assertTrue(all(c['rawText'] and c['region'] and '未计入' in c['reason'] for c in conflicts))

    def test_conflicting_mark_on_real_reference_quarantines_quantities(self):
        reference = ROOT/'参考样例/豆画-Mard-148图纸样例.png'
        with tempfile.TemporaryDirectory(prefix='issue11-source-') as folder, Image.open(reference) as source:
            with Image.new('RGB', (source.width, source.height+120), 'white') as image:
                image.paste(source, (0, 0))
                font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 48)
                ImageDraw.Draw(image).text((30, source.height+25), 'ARTKAL', font=font, fill='black')
                path = Path(folder)/'148-derived-artkal.png'
                image.save(path)
                result = recognize(path)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['candidates'], [])
        self.assertEqual(result['brandVerification'], 'conflict')
        self.assertTrue(any(e.get('rawText') == 'ARTKAL' for e in result['evidence']))
        self.assertTrue(any(d.get('rawText') == 'H7 / 60' for d in result['doubts']))


if __name__ == '__main__':
    unittest.main()

"""Real image boundary checks; generated mutations never replace the original reference."""
from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageDraw, ImageFont

from recognize import ROOT, recognize

REFERENCE = ROOT / '参考样例/豆画-Mard-148图纸样例.png'
EXPECTED = {'C2': 18, 'C12': 3, 'C16': 11, 'C17': 12, 'C19': 7,
            'C29': 18, 'H2': 14, 'H3': 5, 'H7': 60}


class RecognitionChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reference = recognize(REFERENCE)

    def test_original_all_nine_codes_and_independent_cells(self):
        r = self.reference
        self.assertEqual(r['status'], 'ready', r['doubts'])
        self.assertFalse(r['manualInput'])
        self.assertEqual({c['code']: c['quantity'] for c in r['candidates']}, EXPECTED)
        self.assertEqual(r['grid']['counts'], EXPECTED)
        self.assertEqual((r['grid']['rows'], r['grid']['columns']), (16, 29))
        self.assertEqual((r['grid']['blankCells'], r['grid']['unknownCells']), (316, 0))
        last = next(e for e in r['evidence'] if e['rawText'] == 'H7(60)')
        self.assertGreater(last['region'][1], min(e['region'][1] for e in r['evidence']))

    def test_without_title_or_legend_uses_only_cells(self):
        # Derived from the development original; not a real no-legend acceptance sample.
        r = self.reference
        x, y, w, h = r['grid']['region']
        with tempfile.TemporaryDirectory(prefix='issue8-') as folder:
            path = Path(folder) / 'body.png'
            with Image.open(REFERENCE) as original:
                image = original.convert('RGB')
            image.crop((0, max(0, y-2), image.width, y+h+2)).save(path)
            result = recognize(path)
            self.assertEqual(result['source'], 'grid', result['doubts'])
            self.assertEqual(result['status'], 'ready', result['doubts'])
            self.assertEqual({c['code']: c['quantity'] for c in result['candidates']}, EXPECTED)

    def test_last_legend_row_cut_off_is_partial(self):
        bottom = max(e['region'][1] for e in self.reference['evidence'])
        with tempfile.TemporaryDirectory(prefix='issue8-') as folder:
            path = Path(folder) / 'cut.png'
            with Image.open(REFERENCE) as image:
                image.crop((0, 0, image.width, bottom+22)).save(path)
            result = recognize(path)
            self.assertEqual(result['status'], 'partial')
            self.assertNotEqual(result['total'], 148)
            self.assertTrue(result['doubts'])

    def test_altered_quantity_is_not_corrected_from_answer_or_grid(self):
        target = next(e for e in self.reference['evidence'] if e['rawText'] == 'H7(60)')
        x, y, w, h = target['region']
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', 54)
        with tempfile.TemporaryDirectory(prefix='issue8-') as folder:
            path = Path(folder) / REFERENCE.name
            with Image.open(REFERENCE) as source:
                image = source.convert('RGB')
            d = ImageDraw.Draw(image)
            d.rectangle((x+5, y+5, x+w-5, y+h-5), fill='black')
            d.text((x+15, y+6), 'H7 (61)', font=font, fill='white')
            image.save(path)
            result = recognize(path)
            self.assertNotEqual(result['status'], 'ready')
            candidate = next((c for c in result['candidates'] if c['code'] == 'H7'), None)
            if candidate:
                self.assertEqual(candidate['quantity'], 61)
            self.assertEqual(result['grid']['counts'], EXPECTED)
            self.assertTrue(result['doubts'])

    def test_blank_image_does_not_become_zero_usage(self):
        with tempfile.TemporaryDirectory(prefix='issue8-') as folder:
            path = Path(folder) / 'blank.png'
            Image.new('RGB', (600, 400), 'white').save(path)
            result = recognize(path)
            self.assertEqual(result['status'], 'failed')
            self.assertIsNone(result['total'])
            self.assertEqual(result['candidates'], [])

    def test_negative_decimal_and_duplicate_legend_are_not_counted(self):
        target = next(e for e in self.reference['evidence'] if e['rawText'] == 'H7(60)')
        x, y, w, h = target['region']
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', 54)
        with tempfile.TemporaryDirectory(prefix='issue8-') as folder:
            path = Path(folder) / 'invalid-count.png'
            for text in ['H7 (-3)', 'H7 (1.5)', 'Z99 (60)']:
                with self.subTest(text=text):
                    with Image.open(REFERENCE) as original:
                        image = original.convert('RGB')
                    d = ImageDraw.Draw(image)
                    d.rectangle((x+5, y+5, x+w-5, y+h-5), fill='black')
                    d.text((x+15, y+6), text, font=font, fill='white')
                    image.save(path)
                    result = recognize(path)
                    self.assertEqual(result['status'], 'partial')
                    self.assertFalse(any(c['code'] == 'H7' for c in result['candidates']))
                    self.assertTrue(result['doubts'])
            with Image.open(REFERENCE) as original:
                image = original.convert('RGB')
            image.paste(image.crop((x, y, x+w, y+h)), (x, y+h+20))
            image.save(path)
            duplicate = recognize(path)
            self.assertEqual(duplicate['status'], 'partial')
            self.assertFalse(any(c['code'] == 'H7' for c in duplicate['candidates']))
            self.assertTrue(any('重复' in d['reason'] for d in duplicate['doubts']))

    def test_invalid_and_animated_files_preserve_failure(self):
        with tempfile.TemporaryDirectory(prefix='issue8-') as folder:
            path = Path(folder) / 'bad.png'
            path.write_bytes(b'not an image')
            result = recognize(path)
            self.assertEqual(result['status'], 'failed')
            self.assertIsNone(result['total'])
        animated = recognize(ROOT / 'tests/fixtures/webp/animated.webp')
        self.assertEqual(animated['status'], 'failed')
        self.assertTrue(any('动画' in d['reason'] for d in animated['doubts']))


if __name__ == '__main__':
    unittest.main()

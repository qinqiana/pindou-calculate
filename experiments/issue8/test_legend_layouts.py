"""Issue #10 development cases; actual pixels plus a controlled parser-merge boundary."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw

from recognize import ROOT, recognize


class LegendLayoutChecks(unittest.TestCase):
    def test_indented_single_last_entry_is_not_split_at_previous_columns(self):
        sample = next(s for s in json.loads((ROOT/'experiments/issue8/samples.json').read_text())['samples'] if s['id'] == 'S11')
        expected = {'A25': 305, 'F1': 240, 'H16': 228, 'F13': 149, 'A19': 15, 'H2': 6}
        result = recognize(ROOT/sample['path'])
        x, y, w, h = next(e['region'] for e in result['evidence'] if e.get('codeText') == 'A19')
        with tempfile.TemporaryDirectory(prefix='issue10-') as folder, Image.open(ROOT/sample['path']) as source:
            with Image.new('RGB', (source.width, source.height+180), 'white') as image:
                image.paste(source, (0, 0))
                ImageDraw.Draw(image).rectangle((x, y, x+w, y+h), fill='white')
                image.paste(source.crop((x, y, x+w, y+h)), (255, source.height))
                path = Path(folder)/'indented.png'
                image.save(path)
                result = recognize(path)
            self.assertEqual({c['code']: c['quantity'] for c in result['candidates']}, expected)
            entry = next(e for e in result['evidence'] if e.get('codeText') == 'A19')
            self.assertEqual(entry['region'][0], 255)
            self.assertGreaterEqual(entry['region'][1], source.height)
            self.assertEqual(result['status'], 'partial')

    def test_shared_number_duplicates_and_unread_regions_retain_separate_proofs(self):
        # This controls parser detections, not OCR accuracy. Several detections
        # deliberately reference the same pixels or omit an earlier visible row.
        def item(code, x, y, number_x=None):
            return {'layout': 'right', 'tinyPrint': False, 'region': [x, y, 50, 16],
                    'codeText': code, 'quantityText': '12',
                    'code': {'rawText': code, 'score': .99},
                    'quantity': {'rawText': '12', 'score': .99, 'characters': [
                        {'region': [x+25 if number_x is None else number_x, y, 10, 12]}]}}
        grid = {'complete': False, 'counts': {}, 'cells': [], 'unknownCells': None, 'reason': '未证明完整'}
        layout = {'region': [0, 0, 200, 200], 'items': [
            item('A1', 10, 10, 45), item('A2', 30, 10, 45),  # One number, two codes.
            item('H2', 10, 40), item('H2', 10, 70),         # Separate duplicates.
            item('C2', 10, 100), item('C2', 11, 100),       # Overlapping crops only.
        ]}
        with tempfile.TemporaryDirectory(prefix='issue10-') as folder:
            path = Path(folder)/'boundary.png'
            with Image.new('RGB', (200, 200), 'white') as image:
                image.save(path)
            with patch('recognize.legend_boxes', return_value=[[10, 150, 50, 16]]), \
                    patch('recognize.GlyphReader') as reader, \
                    patch('recognize.grid_result', return_value=grid), \
                    patch('recognize.find_grid_axes', return_value=None), \
                    patch('recognize.recognize_layout', return_value=layout):
                reader.return_value.read.return_value = {'text': 'G1(?)', 'reliable': False, 'characters': []}
                result = recognize(path)
        self.assertEqual({c['code']: c['quantity'] for c in result['candidates']}, {'C2': 12})
        for word, count in [('多个色号', 2), ('重复色号', 2), ('此处可见', 1)]:
            risks = [d for d in result['doubts'] if word in d['reason']]
            self.assertEqual(len(risks), count)
            self.assertTrue(all(d['region'] and d['rawText'] and d['evidenceId'] for d in risks))
        self.assertEqual(result['status'], 'partial')


if __name__ == '__main__':
    unittest.main()

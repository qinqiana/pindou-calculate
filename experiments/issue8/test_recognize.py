"""Real image boundary checks; generated mutations never replace the original reference."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

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

    def test_unreadable_body_cell_keeps_other_counts_and_locatable_unknown(self):
        grid = self.reference['grid']
        target = next(c for c in grid['cells'] if c['code'] == 'H2')
        x, y, w, h = target['region']
        gx, gy, gw, gh = grid['region']
        top = max(0, gy-2)
        with tempfile.TemporaryDirectory(prefix='issue12-') as folder:
            path = Path(folder)/'body-unknown.png'
            with Image.open(REFERENCE) as original, original.convert('RGB') as image:
                # An out-of-set label on a white production cell must neither be
                # counted as H2 by colour nor disappear into the blank count.
                draw = ImageDraw.Draw(image)
                draw.rectangle((x+8,y+8,x+w-8,y+h-8), fill='white')
                font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 40)
                draw.text((x+w/2,y+h/2), 'Z99', font=font, fill='black', anchor='mm')
                image.crop((0,top,image.width,gy+gh+2)).save(path)
            result = recognize(path)
        self.assertEqual((result['source'], result['status']), ('grid','partial'), result['doubts'])
        self.assertEqual({c['code']: c['quantity'] for c in result['candidates']}, {**EXPECTED, 'H2':13})
        self.assertEqual((result['grid']['unknownCells'], result['grid']['blankCells']), (1,316))
        unknown = next(d for d in result['doubts'] if 'Z99' in d.get('rawText',''))
        self.assertEqual(unknown['region'], [x,y-top,w,h])
        self.assertTrue(all(e['source'] == 'grid' for e in result['evidence']))
        self.assertEqual(result['titleTotal'], None)

    def test_last_legend_row_cut_off_reuses_only_complete_body(self):
        bottom = max(e['region'][1] for e in self.reference['evidence'])
        with tempfile.TemporaryDirectory(prefix='issue8-') as folder:
            path = Path(folder) / 'cut.png'
            with Image.open(REFERENCE) as image:
                image.crop((0, 0, image.width, bottom+22)).save(path)
            result = recognize(path)
            self.assertEqual(result['status'], 'partial')
            self.assertEqual(result['source'], 'grid')
            self.assertEqual(result['total'], 148)
            self.assertEqual({c['code']: c['quantity'] for c in result['candidates']}, EXPECTED)
            recovered = next(c for c in result['candidates'] if c['code'] == 'H7')
            evidence = {e['id']: e for e in result['evidence']}
            self.assertEqual(len(recovered['evidenceIds']), 60)
            self.assertTrue(all(evidence[key]['source'] == 'grid' for key in recovered['evidenceIds']))
            self.assertTrue(result['doubts'])
            # Hiding part of the body removes complete coverage. Its partial
            # count cannot replace the missing legend entry.
            with Image.open(REFERENCE) as image:
                image.crop((0, self.reference['grid']['region'][1]+80,
                            image.width, bottom+22)).save(path)
            incomplete = recognize(path)
            self.assertFalse(incomplete['grid']['complete'])
            self.assertEqual(incomplete['source'], 'legend')
            self.assertEqual(incomplete['total'], 88)
            self.assertFalse(any(c['code'] == 'H7' for c in incomplete['candidates']))

    def test_rotated_transparent_image_preserves_visible_legend(self):
        target = next(e for e in self.reference['evidence'] if e['rawText'] == 'H7(60)')
        x, y, w, h = target['region']
        with tempfile.TemporaryDirectory(prefix='issue8-') as folder:
            path = Path(folder) / 'oriented-transparent.png'
            with Image.open(REFERENCE) as original, original.convert('RGBA') as image:
                size = image.size
                with image.getchannel('A') as alpha:
                    alpha.paste(128, (x, y, x+w, y+h))
                    alpha.paste(0, (0, 0, 10, 10))
                    image.putalpha(alpha)
                with image.transpose(Image.Transpose.ROTATE_90) as rotated:
                    exif = rotated.getexif()
                    exif[274] = 6
                    rotated.save(path, exif=exif)
            result = recognize(path)
            self.assertEqual(result['status'], 'ready', result['doubts'])
            self.assertEqual({c['code']: c['quantity'] for c in result['candidates']}, EXPECTED)
            self.assertEqual(result['grid']['counts'], EXPECTED)
            self.assertEqual((result['image']['width'], result['image']['height']), size)
            self.assertEqual(result['image']['sourceOrientation'], 6)

    def test_later_legend_omission_does_not_erase_an_earlier_quantity_conflict(self):
        # Isolate two readers disagreeing about which fields are present; this
        # is a routing check, not a claim about OCR on a new real-world image.
        layout = {'region': [10, 10, 30, 10], 'items': [{
            'tinyPrint': False, 'region': [10, 10, 30, 10],
            'codeText': 'C2', 'quantityText': '18',
            'code': {'rawText': 'C2', 'score': .99},
            'quantity': {'rawText': '18', 'score': .99},
        }]}
        with patch('recognize.GlyphReader') as reader, \
                patch('recognize.legend_boxes', return_value=[[10, 10, 30, 10], [10, 30, 30, 10]]), \
                patch('recognize.grid_result', return_value=self.reference['grid']), \
                patch('recognize.find_grid_axes', return_value=None), \
                patch('recognize.recognize_layout', return_value=layout):
            reader.return_value.read.side_effect = [
                {'text': text, 'reliable': True, 'characters': []}
                for text in ['C2(18)', 'H7(61)']]
            result = recognize(REFERENCE)
        self.assertEqual(result['source'], 'legend')
        self.assertEqual(result['status'], 'partial')
        self.assertEqual({c['code']: c['quantity'] for c in result['candidates']}, {'C2': 18})
        self.assertTrue(any(e.get('rawText') == 'H7(61)' for e in result['evidence']))
        self.assertTrue(any(d.get('legendCounts', {}).get('H7') == 61
                            and d.get('gridCounts', {}).get('H7') == 60 for d in result['doubts']))

    def test_faint_text_near_cell_edge_is_unknown_not_blank(self):
        grid = self.reference['grid']
        self.assertFalse(any(c['row'] == 1 and c['column'] == 1 for c in grid['cells']))
        gx, gy, gw, gh = grid['region']
        w, h = round(gw/(grid['columns']+2)), round(gh/(grid['rows']+2))
        x, y = gx+w, gy+h
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 8)
        with tempfile.TemporaryDirectory(prefix='issue8-') as folder:
            path = Path(folder) / 'faint-edge.png'
            with Image.open(REFERENCE) as original, original.convert('RGB') as image:
                draw = ImageDraw.Draw(image)
                draw.rectangle((x+6, y+6, x+w-6, y+h-6), fill='white')
                draw.text((x+round(w*.10)+2, y+60), 'C2', font=font, fill=(205, 205, 205))
                image.save(path)
            result = recognize(path)
            self.assertEqual(result['status'], 'partial', result['doubts'])
            self.assertEqual(result['grid']['unknownCells'], 1)
            self.assertEqual(result['grid']['blankCells'], 315)

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
            differences = [d for d in result['doubts'] if d.get('rawText') == 'H7：图例 61；独立本体 60']
            self.assertEqual(len(differences), 2)
            self.assertTrue(all(d['region'] and d['evidenceId'] for d in differences))

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

    def test_separate_quantity_fields_keep_minus_and_decimal(self):
        import json
        samples = json.loads((ROOT/'experiments/issue8/samples.json').read_text())['samples']
        for sample_id, code in [('S11', 'A25'), ('S06', 'F21')]:
            source = ROOT/next(s['path'] for s in samples if s['id'] == sample_id)
            original_result = recognize(source)
            evidence = next(e for e in original_result['evidence'] if e.get('codeText') == code)
            x, y, w, h = evidence['quantity']['region']
            with tempfile.TemporaryDirectory(prefix='issue8-') as folder:
                path = Path(folder)/'signed-count.png'
                for text in ['-3', '1.5']:
                    with self.subTest(sample=sample_id, text=text):
                        with Image.open(source) as original, original.convert('RGB') as image:
                            draw = ImageDraw.Draw(image)
                            draw.rectangle((x,y,x+w,y+h),fill='white')
                            font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',round(h*.65))
                            box = draw.textbbox((0,0),text,font=font)
                            draw.text((x+(w-box[2])/2,y+(h-(box[3]-box[1]))/2-box[1]),text,font=font,fill='black')
                            image.save(path)
                        result = recognize(path)
                        self.assertFalse(any(c['code'] == code for c in result['candidates']))
                        self.assertEqual(result['status'],'partial')

    def test_unnumbered_grid_counts_white_beads_and_keeps_unknown_cells(self):
        # Independent constructed grid: no legend, no frame labels or supplied axes.
        with tempfile.TemporaryDirectory(prefix='issue8-') as folder:
            path = Path(folder)/'grid.png'
            image = Image.new('RGB', (370, 370), 'white')
            draw = ImageDraw.Draw(image)
            font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
            for row in range(8):
                for col in range(8):
                    x, y = 25+40*col, 25+40*row
                    text = ('H7' if row < 3 else 'H2' if row == 3 else 'Z99' if (row,col) == (4,0)
                            else 'B3' if (row,col) == (4,1) else 'E5' if (row,col) == (4,2) else None)
                    if text:
                        draw.rectangle((x,y,x+40,y+40), fill='black' if text == 'H7' else 'white')
                        draw.text((x+20,y+20), text, font=font, anchor='mm', fill='white' if text == 'H7' else 'black')
            # Code-like annotation displaced from the printed cell centres is
            # unknown, while the actual single E5 bead above must remain counted.
            draw.text((55, 255), 'E5', font=font, anchor='mm', fill='#778899')
            for i in range(9):
                draw.line((25+40*i,25,25+40*i,345), fill='#bbbbbb')
                draw.line((25,25+40*i,345,25+40*i), fill='#bbbbbb')
            image.save(path)
            result = recognize(path)
            self.assertEqual({c['code']: c['quantity'] for c in result['candidates']}, {'H7':24,'H2':8,'B3':1,'E5':1})
            self.assertEqual(result['source'], 'grid')
            self.assertEqual(result['status'], 'partial')
            self.assertGreater(result['grid']['unknownCells'], 0)
            # Identical repeated cells still point to their own original-image text.
            cells = [c for c in result['grid']['cells'] if c['code'] == 'H7']
            self.assertEqual(len(cells), 24)
            first = cells[0]
            for cell in cells[1:]:
                dx = 40*(cell['column']-first['column'])
                dy = 40*(cell['row']-first['row'])
                self.assertEqual(cell['characters'], [
                    {**c, 'region': [c['region'][0]+dx, c['region'][1]+dy, *c['region'][2:]]}
                    for c in first['characters']])

    def test_large_grid_retains_counts_blank_unknown_and_cell_locations(self):
        import numpy as np
        from glyph_model import GlyphModel, SmallGlyphModel
        from grid_legend import count_grid
        from recognize import blank_texture, color_codes
        # Exercise the >16k-cell reader without relying on a site's image or legend.
        size, step = 128, 30
        with Image.new('RGB', (size*step, size*step), 'white') as image:
            draw = ImageDraw.Draw(image)
            font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
            for row in range(size):
                for col in range(size):
                    code = 'H2' if row < 64 else 'H7'
                    if row == size-1 and col < 2:
                        code = 'Z99' if col else None
                    x, y = col*step, row*step
                    if code == 'H7':
                        draw.rectangle((x,y,x+step,y+step), fill='black')
                    if code:
                        draw.text((x+step/2,y+step/2), code, font=font, anchor='mm',
                                  fill='white' if code == 'H7' else 'black')
            axes = [{'start': 0, 'end': size*step, 'step': step} for _ in range(2)]
            grid = count_grid(image, np.empty((size*step,size*step,3), 'uint8'),
                              SmallGlyphModel(GlyphModel()), axes, color_codes(), blank_texture, [])
        self.assertIsNotNone(grid)
        self.assertEqual(grid['counts'], {'H2':8192, 'H7':8190})
        self.assertEqual((grid['blankCells'], grid['unknownCells']), (1,1))
        self.assertFalse(grid['complete'])
        last = grid['cells'][-1]
        self.assertEqual((last['row'], last['column'], last['code']), (128,128,'H7'))
        self.assertGreater(last['region'][0], 127*step)
        self.assertGreater(last['region'][1], 127*step)
        self.assertTrue(next(c for c in grid['cells'] if c['code'] is None)['characters'])

    def test_dense_grid_does_not_extend_across_blank_header(self):
        import numpy as np
        from grid_legend import find_grid_axes
        from recognize import axis_lines
        with Image.new('RGB', (1640,1760), 'white') as image:
            draw = ImageDraw.Draw(image)
            for k in range(129):
                draw.line((40+k*12,180,40+k*12,1716), fill='#808080')
                draw.line((40,180+k*12,1576,180+k*12), fill='#808080')
            for y in (36,60,84):
                draw.line((40,y,140,y), fill='#808080')
            axes = find_grid_axes(np.asarray(image), axis_lines)
        self.assertIsNotNone(axes)
        self.assertAlmostEqual(axes[1]['start'], 180, delta=1)

    def test_compact_legend_survives_watermark_and_pale_last_row(self):
        import json
        sample = next(s for s in json.loads((ROOT/'experiments/issue8/samples.json').read_text())['samples']
                      if s['id'] == 'S04')
        result = recognize(ROOT/sample['path'])
        expected = {'A17':23,'B31':586,'C2':27,'D10':13,'E8':95,'E11':9,'E15':3,
                    'E16':282,'F19':26,'F21':112,'H2':153,'H6':33,'H7':556,'M2':15,'M12':3}
        self.assertEqual({c['code']:c['quantity'] for c in result['candidates']}, expected)
        self.assertEqual(result['source'], 'legend')
        self.assertEqual(result['status'], 'partial')
        self.assertTrue(any(e.get('quantity',{}).get('preprocessing') for e in result['evidence']))

    def test_search_strip_may_start_inside_a_real_first_legend_row(self):
        import json
        samples = json.loads((ROOT/'experiments/issue8/samples.json').read_text())['samples']
        references = json.loads((ROOT/'experiments/issue8/references-v05.json').read_text())['samples']
        for sample_id in ['S07', 'S08']:
            with self.subTest(sample=sample_id):
                sample = next(s for s in samples if s['id'] == sample_id)
                result = recognize(ROOT/sample['path'])
                self.assertEqual({c['code']:c['quantity'] for c in result['candidates']},
                                 references[sample_id]['expected'])

    def test_watermarked_code_uses_own_glyphs_and_repeated_grid_text(self):
        import json
        sample = next(s for s in json.loads((ROOT/'experiments/issue8/samples.json').read_text())['samples']
                      if s['id'] == 'S15')
        result = recognize(ROOT/sample['path'])
        expected = {'A3':71,'A13':76,'B11':5,'B17':60,'C4':106,'C7':79,'E11':11,'E14':8,
                    'E16':34,'F3':43,'F5':122,'F7':28,'F8':111,'H2':6,'H4':6,'H6':25,'H7':440,
                    'M4':22,'M8':17,'M12':3}
        self.assertEqual({c['code']:c['quantity'] for c in result['candidates']}, expected)
        item = next(e for e in result['evidence'] if e.get('codeText') == 'F8')
        self.assertEqual(item['gridVerification']['originalCode'], 'F38')
        self.assertGreaterEqual(item['gridVerification']['votes']['F8'], 5)
        self.assertTrue(all(e['region'][1] < item['region'][1] for e in item['gridVerification']['examples']))
        self.assertEqual(result['status'], 'partial')

    def test_dense_truncated_legend_keeps_visible_counts_without_inventing_missing_rows(self):
        import json
        sample = next(s for s in json.loads((ROOT/'experiments/issue8/samples.json').read_text())['samples']
                      if s['id'] == 'S03')
        result = recognize(ROOT/sample['path'])
        actual = {c['code']:c['quantity'] for c in result['candidates']}
        expected = json.loads((ROOT/'experiments/issue8/references-v05.json').read_text())['samples']['S03']['expected']
        self.assertEqual(actual, expected)
        item = next(e for e in result['evidence'] if e.get('codeText') == 'D16')
        self.assertEqual(item['sameFontVerification']['originalReading'], 'O16(16)')
        self.assertEqual(item['sameFontVerification']['reading'], 'D16(15)')
        self.assertTrue(any(d.get('evidenceId') == item['id'] for d in result['doubts']))
        self.assertEqual(result['status'], 'partial')
        self.assertLess(result['total'], 43116)

    def test_same_font_evidence_does_not_force_unknown_codes_or_invalid_quantities(self):
        import json
        sample = next(s for s in json.loads((ROOT/'experiments/issue8/samples.json').read_text())['samples']
                      if s['id'] == 'S03')
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 14)
        with tempfile.TemporaryDirectory(prefix='issue8-font-') as folder:
            for index, text in enumerate(('O16(15)', 'Z99(15)', 'D16(-15)', 'D16(1.5)')):
                with self.subTest(text=text), Image.open(ROOT/sample['path']).convert('RGB') as image:
                    draw = ImageDraw.Draw(image)
                    draw.rectangle((944,1352,1076,1382), fill=(228,230,247))
                    draw.text((949,1365), text, font=font, anchor='lm', fill='black')
                    path = Path(folder)/f'{index}.png'
                    image.save(path)
                    result = recognize(path)
                counts = {c['code']:c['quantity'] for c in result['candidates']}
                self.assertNotIn('D16', counts)
                self.assertNotIn('O16', counts)
                self.assertNotIn('Z99', counts)
                self.assertEqual(len(counts), 63)
                self.assertEqual(result['status'], 'partial')
            # Change the printed quantity using a clear 6 from this same font.
            # The weak prefix may remain unknown; 16 must never revert to 15.
            with Image.open(ROOT/sample['path']).convert('RGB') as image:
                digit = image.crop((961,1363,968,1373))
                image.paste(digit, (998,1363))
                path = Path(folder)/'changed-quantity.png'
                image.save(path)
                result = recognize(path)
            counts = {c['code']:c['quantity'] for c in result['candidates']}
            self.assertIn(counts.get('D16'), (None, 16))
            self.assertTrue(any(e.get('quantityText') == '16' and e['region'][0] > 930
                                and 1350 < e['region'][1] < 1380 for e in result['evidence']))
            self.assertEqual(result['status'], 'partial')

    def test_grid_bottom_is_not_a_quantity_legend(self):
        with tempfile.TemporaryDirectory(prefix='issue8-') as folder:
            path = Path(folder)/'bottom-row.png'
            image = Image.new('RGB', (1650, 420), 'white')
            draw = ImageDraw.Draw(image)
            font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
            for row in range(8):
                for col in range(40):
                    x, y = 25+40*col, 25+40*row
                    code = 'H7' if col % 2 == 0 else 'F6'
                    draw.rectangle((x, y, x+40, y+40), fill='black' if code == 'H7' else '#aa3030')
                    draw.text((x+20, y+20), code, font=font, anchor='mm', fill='white')
            for i in range(41):
                draw.line((25+40*i,25,25+40*i,345), fill='#bbbbbb')
            for i in range(9):
                draw.line((25,25+40*i,1625,25+40*i), fill='#bbbbbb')
            for col in range(40):
                draw.text((45+40*col,360), str(col+1), font=font, anchor='mm', fill='black')
            image.save(path)
            result = recognize(path)
            self.assertEqual({c['code']:c['quantity'] for c in result['candidates']}, {'H7':160, 'F6':160})
            self.assertEqual(result['source'], 'grid')
            self.assertNotEqual(result['status'], 'ready')

    def test_cached_glyphs_preserve_duplicates_order_and_pixel_changes(self):
        import numpy as np
        from glyph_model import GlyphModel
        model = GlyphModel()
        a = np.eye(12, dtype='uint8')
        b = np.ones((12, 5), dtype='uint8')
        for masks in ([a, b, a], [b, a], [a*0, b, a], []):
            self.assertEqual(model.predict(masks), model._predict(masks))

    def test_evaluation_requires_every_code_and_known_reference(self):
        from evaluate import evaluate
        reference = {'status':'complete','expected':{'A1':100,'H7':2}}
        result = {'candidates':[{'code':'A1','quantity':110},{'code':'H7','quantity':5}]}
        self.assertTrue(evaluate(result,reference)['passed'])
        for candidates in [result['candidates'][:1], result['candidates']+[{'code':'H7','quantity':2}],
                           [{'code':'A1','quantity':111},{'code':'H7','quantity':2}],
                           [{'code':'A1','quantity':100},{'code':'H6','quantity':2}]]:
            self.assertFalse(evaluate({'candidates':candidates},reference)['passed'])
        self.assertFalse(evaluate(result,{**reference,'status':'partial'})['passed'])

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


class BesideLegendChecks(unittest.TestCase):
    def test_separate_words_pale_swatches_and_invalid_quantities(self):
        # Constructed layout, independent of any site's image/reference answers.
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 20)
        with Image.new('RGB', (1048, 1240), 'white') as image, \
                tempfile.TemporaryDirectory(prefix='issue8-beside-') as folder:
            draw = ImageDraw.Draw(image)
            for n in range(31):
                draw.line((74+n*30,70,74+n*30,970), fill='#cbd5e1')
                draw.line((74,70+n*30,974,70+n*30), fill='#cbd5e1')
            for col, (code, color, number) in enumerate([
                    ('H07', '#000000', 77), ('H02', '#ffffff', 6),
                    ('M01', '#cccccc', 21), ('C03', '#99ddee', 2)]):
                x = 20+252*col
                draw.rectangle((x,1050,x+36,1086), fill=color, outline='#bbbbbb')
                draw.text((x+40,1068), code, font=font, anchor='lm', fill='#333333')
                draw.text((x+213,1068), str(number), font=font, anchor='rm', fill='#333333')
            draw.rectangle((20,1096,56,1132), fill='white', outline='#bbbbbb')
            draw.text((60,1114), 'H11', font=font, anchor='lm', fill='#333333')
            draw.text((233,1114), '1', font=font, anchor='rm', fill='#333333')
            path = Path(folder)/'diagram.png'
            image.save(path)
            result = recognize(path)
            self.assertEqual({c['code']: c['quantity'] for c in result['candidates']},
                             {'H7':77, 'H2':6, 'M1':21, 'C3':2, 'H11':1})
            self.assertEqual(result['source'], 'legend')
            self.assertEqual(result['status'], 'partial')
            for quantity, expected in [('76', 76), ('0', 0), ('-3', None),
                                       ('1.5', None), ('12  34', None), ('1000000001', None)]:
                with self.subTest(quantity=quantity), image.copy() as changed:
                    d = ImageDraw.Draw(changed)
                    d.rectangle((106,1050,251,1086), fill='white')
                    d.text((233,1068), quantity, font=font, anchor='rm', fill='#333333')
                    changed.save(path)
                    result = recognize(path)
                    counts = {c['code']: c['quantity'] for c in result['candidates']}
                    self.assertEqual(counts.get('H7'), expected)
                    self.assertEqual({k:v for k,v in counts.items() if k != 'H7'}, {'H2':6,'M1':21,'C3':2,'H11':1})
                    self.assertEqual(result['status'], 'partial')
                    if expected is None:
                        self.assertTrue(any(e.get('source') == 'legend' and 'H' in e['rawText']
                                            for e in result['evidence']))
            with image.copy() as changed:
                d = ImageDraw.Draw(changed)
                for x, y in [(20+252*c,1050) for c in range(4)]+[(20,1096)]:
                    d.rectangle((x+38,y,x+110,y+36), fill='white')
                    d.text((x+40,y+18), 'Z99', font=font, anchor='lm', fill='#333333')
                changed.save(path)
                rejected = recognize(path)
                self.assertEqual(rejected['candidates'], [])
                self.assertEqual(rejected['status'], 'failed')
                self.assertTrue(any('Z99' in e['rawText'] for e in rejected['evidence']))
                self.assertTrue(any(d.get('evidenceId', '').startswith('layout-') for d in rejected['doubts']))


if __name__ == '__main__':
    unittest.main()

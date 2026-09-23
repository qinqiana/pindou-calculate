"""Real glyph reads with one failed block; checkpoints remain exact subsets."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from glyph_model import GlyphModel, SmallGlyphModel
from grid_legend import count_grid, find_grid_axes
from layout_legend import crop_rgb, make_preview
from recognize import ROOT, app_result, axis_lines, blank_texture, color_codes, recognize


class LongGridCheck(unittest.TestCase):
    def test_failed_block_keeps_other_cells_and_compact_checkpoints(self):
        spec = importlib.util.spec_from_file_location('long_fixture', ROOT/'experiments/issue13/validate.py')
        fixture = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fixture)
        with tempfile.TemporaryDirectory(prefix='pindou-long-') as folder:
            path = Path(folder)/'long.png'
            _, expected = fixture.chart(path)
            emitted = []
            result = recognize(path, on_progress=emitted.append)
            self.assertEqual({c['code']:c['quantity'] for c in result['candidates']}, expected)
            self.assertEqual((result['grid']['columns'], result['grid']['rows']), (47,104))
            self.assertGreater(len(emitted), 1)
            self.assertTrue(any('尚未处理' in d['reason'] and d['region'] for d in emitted[0]['doubts']))
            for snapshot in emitted:
                self.assertEqual(snapshot['status'], 'partial')
                self.assertTrue(all(c['quantity'] <= expected[c['code']] for c in snapshot['candidates']))
                self.assertLessEqual(len(app_result(snapshot)['evidence']), len(expected))
            model = SmallGlyphModel(GlyphModel())
            with Image.open(path) as image:
                preview = make_preview(image, 2000)
                axes = find_grid_axes(preview, axis_lines)
                def fail_one_block(image, box):
                    if 20+40*32 <= box[1] < 20+41*32:
                        raise OSError('injected crop failure')
                    return crop_rgb(image, box)
                with patch('grid_legend.crop_rgb', side_effect=fail_one_block):
                    partial = count_grid(image, preview, model, axes, color_codes(), blank_texture, [])
                self.assertFalse(partial['complete'])
                self.assertEqual(len([b for b in partial['blocks'] if b['status'] == 'failed']), 1)
                self.assertGreater(partial['unreadCells'], 0)
                self.assertGreater(sum(partial['counts'].values()), 0)
                positions = [(c['row'],c['column']) for c in partial['cells']]
                self.assertEqual(len(positions), len(set(positions)))
                self.assertEqual(sum(partial['counts'].values())+partial['blankCells']+
                                 partial['unknownCells']+partial['unreadCells'], 47*104)


if __name__ == '__main__':
    unittest.main()

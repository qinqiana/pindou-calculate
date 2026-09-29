"""Reload final PNGs and labels; verify exported crops, counts, pairing and crop offsets."""
import json
import sys
from collections import Counter
from pathlib import Path
from PIL import Image

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / 'samples'
fixture_file = Path(sys.argv[2]) if len(sys.argv)>2 else Path(__file__).parent / 'fixtures.json'
fixtures = {f['id']: f for f in json.loads(fixture_file.read_text())}
summary = json.loads((root / 'verification.json').read_text())
crop_count = 0
visible_chars = set('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789()×x颗-/: ')

def read(folder, name):
    return json.loads((folder / (name + '.json')).read_text())

def within(a, b):
    x, y, w, h = a
    bx, by, bw, bh = b
    return w > 0 and h > 0 and x >= bx and y >= by and x+w <= bx+bw and y+h <= by+bh

for sample in summary['samples']:
    folder = root / sample['id']
    fixture = next(f for key, f in fixtures.items() if sample['id'].startswith(key + '-'))
    image = Image.open(folder / 'sheet.png').convert('RGB')
    overlay = Image.open(folder / 'overlay.png')
    detection, cells, answer = (read(folder, n) for n in ('detection', 'cells', 'answer'))
    objects = detection['objects']
    assert image.size == overlay.size == (detection['width'], detection['height'])
    assert answer['grid']['cells'] == sum(fixture['rows'], [])
    assert answer['expected'] == fixture['expected']
    assert len(cells) == len(answer['grid']['cells'])
    assert len({(c['row'], c['col']) for c in cells}) == len(cells)
    expected_counts = Counter(c['code'] for c in cells if c['label'] == 'bead')
    assert expected_counts == fixture['expected']
    assert sum(c['label'] == 'blank' for c in cells) == fixture['blankCount']
    for c in cells:
        code = fixture['rows'][c['row']][c['col']]
        assert c['code'] == code and c['label'] == ('blank' if code is None else 'bead')
    assert answer['blankPositions'] == [[c['row'], c['col']] for c in cells if c['label'] == 'blank']
    by_id = {o['id']: o for o in objects}
    assert len(by_id) == len(objects)
    for obj in objects:
        assert within(obj['box'], [0, 0, *image.size])
        if obj['parent']:
            assert within(obj['box'], by_id[obj['parent']]['box'])
    grid = next(o['box'] for o in objects if o['cls'] == 'grid_region')
    assert all(within(c['box'], grid) for c in cells)
    recognition = read(folder, 'recognition')
    boxes = {c['crop']: c['box'] for c in cells}
    boxes.update({f"crops/{o['id']}.png": o['box'] for o in objects})
    for record in recognition:
        assert set(record['text']) <= visible_chars
    for crop_name in set([c['crop'] for c in cells] + [r['crop'] for r in recognition]):
        box = boxes[crop_name]
        x, y, w, h = map(int, box)
        actual = Image.open(folder / crop_name).convert('RGB')
        expected = image.crop((x, y, x+w, y+h))
        assert actual.size == expected.size and actual.tobytes() == expected.tobytes(), crop_name
        crop_count += 1
    legends = [o for o in objects if o['cls'] == 'legend_item']
    if answer['layout'] == 'no-legend':
        assert not legends and answer['titleTotal'] is None
        assert not any(o['cls'] in ('title_text', 'count_text', 'code_text') for o in objects)
        # The exact final grid pixels must match the corresponding full-sheet sample.
        full_folder = next(root / s['id'] for s in summary['samples'] if s['id'].startswith(fixture['id']+'-') and not s['id'].endswith('no-legend'))
        full = Image.open(full_folder / 'sheet.png').convert('RGB')
        gx, gy, gw, gh = next(o['box'] for o in read(full_folder, 'detection')['objects'] if o['cls'] == 'grid_region')
        x, y, w, h = grid
        assert image.crop((x,y,x+w,y+h)).tobytes() == full.crop((gx,gy,gx+gw,gy+gh)).tobytes()
    else:
        pairs = {}
        for item in legends:
            children = [o for o in objects if o['parent'] == item['id']]
            code = next(o['text'] for o in children if o['cls'] == 'code_text')
            count = next(o['text'] for o in children if o['cls'] == 'count_text')
            assert code not in pairs
            pairs[code] = int(count.removesuffix(' 颗').strip('()'))
        assert pairs == fixture['expected']
        assert answer['titleTotal'] == sum(pairs.values())
    # H1 is never collapsed into blank; both nearly-white codes remain beads.
    assert expected_counts['H1'] > 0 and expected_counts['H2'] > 0

print(json.dumps({'samples': len(summary['samples']), 'exact_png_crops': crop_count,
                  'saved_image_answer_checks': 'passed', 'independent_qa': False}, indent=2))

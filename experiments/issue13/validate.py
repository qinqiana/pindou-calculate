"""Reproducible long-grid fixtures and real boundary inputs; no answers enter recognition."""
import argparse
from collections import Counter
import csv
import json
from pathlib import Path
import resource
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]


def chart(path, pitch=(32, 32), separator=5, watermark=False):
    # Authored labels are the fixture truth, not inferred pixels or OCR output.
    # Seven labelled columns plus one blank repeat; boundary rows are isolated.
    palette = ['H7', 'H2', 'H3', 'H5', 'F21', 'F24', 'B8', '.']
    rows = [[('H2' if c == 0 else 'H7' if c == 46 else '.') if r % 8 == 0 or r == 103
             else palette[c % 8] for c in range(47)] for r in range(104)]
    expected = dict(Counter(code for row in rows for code in row if code != '.'))
    sx, sy = pitch
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
    colors = {'H7': '#222222', 'H2': '#ffffff', 'H3': '#d9d9d9', 'H5': '#b7b7b7',
              'F21': '#ed7480', 'F24': '#ed7480', 'B8': '#25aa63', '.': '#ffffff'}
    with Image.new('RGB', (47*sx+40, 104*sy+40), 'white') as image:
        draw = ImageDraw.Draw(image)
        for r, row in enumerate(rows):
            for c, code in enumerate(row):
                x, y = 20+c*sx, 20+r*sy
                draw.rectangle((x, y, x+sx, y+sy), fill=colors[code])
                if code != '.':
                    draw.text((x+sx/2, y+sy/2), code, font=font,
                              fill='white' if code == 'H7' else 'black', anchor='mm')
        for c in range(48):
            draw.line((20+c*sx, 20, 20+c*sx, 20+104*sy), fill='#909090', width=3 if c % separator == 0 else 1)
        for r in range(105):
            draw.line((20, 20+r*sy, 20+47*sx, 20+r*sy), fill='#909090', width=3 if r % separator == 0 else 1)
        if watermark:
            # A text occlusion must keep its location, never be repaired by colour.
            draw.rectangle((20, 20+40*sy, 20+47*sx, 20+43*sy), fill='#dedede')
            draw.text((24, 20+41*sy), 'Z99 WATERMARK', fill='black', font=font)
        image.save(path, **({'quality': 70} if path.suffix in ('.jpg', '.webp') else {}))
    return rows, expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--child', type=Path)
    args = parser.parse_args()
    out = args.output_dir
    out.mkdir(parents=True, exist_ok=True)
    if args.child:
        sys.path.insert(0, str(ROOT/'experiments/issue8'))
        from recognize import recognize, app_result
        checkpoints = []
        result = recognize(args.child, on_progress=lambda r: checkpoints.append(app_result(r)))
        result['checkpoints'] = checkpoints
        result['peakRssMiB'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024
        (out/(args.child.stem+'.json')).write_text(json.dumps(result, ensure_ascii=False))
        return 0
    inputs, references = [], {}
    for name, pitch, separator, watermark in [
        ('long-5.png', (32,32), 5, False), ('long-10.png', (32,32), 10, False),
        ('rectangular.png', (32,40), 5, False), ('compressed.jpg', (32,32), 5, False),
        ('compressed.webp', (32,32), 5, False), ('watermark.png', (32,32), 5, True),
    ]:
        path = out/name
        rows, expected = chart(path, pitch, separator, watermark)
        references[path.stem] = {'rows': rows, 'expected': expected, 'complete': not watermark}
        inputs.append((path, 'authored-fixture', not watermark))
    # The actual 47x104 chart is watermarked. Its printed legend is a comparison,
    # not a new independently checked cell reference. Keep it out of exact scores.
    samples = json.loads((ROOT/'experiments/issue8/samples.json').read_text())['samples']
    path = ROOT/'experiments/issue13/inputs/N25.png'
    references[path.stem] = json.loads((ROOT/'experiments/issue13/N25-reference.json').read_text())
    inputs.append((path, 'BitBead-existing-real-chart', True))
    for sid in ['S14', 'S03']:
        sample = next(s for s in samples if s['id'] == sid)
        path = ROOT/sample['path']
        if sid == 'S14':
            path = out/'S14-body.png'
            with Image.open(ROOT/sample['path']) as im:
                im.crop((0,116,1080,2455)).save(path)
        inputs.append((path, sid, False))
    # Write the independent reference before starting any recognizer child.
    (out/'fixture-references.json').write_text(json.dumps(references, ensure_ascii=False))
    results = []
    for path, group, supported in inputs:
        row = {'input': path.name, 'group': group, 'exactRequired': supported, 'referenceComplete': supported}
        try:
            subprocess.run([sys.executable, __file__, '--output-dir', str(out), '--child', str(path)],
                           check=True, timeout=90, capture_output=True, text=True)
            result = json.loads((out/(path.stem+'.json')).read_text())
            actual = {c['code']:c['quantity'] for c in result['candidates']}
            expected = references.get(path.stem, {}).get('expected')
            grid = result.get('grid', {})
            row.update(status=result['status'], source=result['source'], total=result['total'],
                       exact=actual == expected if supported else None,
                       rows=grid.get('rows'), columns=grid.get('columns'),
                       blocks=len(grid.get('blocks', [])), checkpoints=len(result['checkpoints']),
                       unknownCells=grid.get('unknownCells'), unreadCells=grid.get('unreadCells'),
                       locatedDoubts=sum(bool(d.get('region')) for d in result['doubts']),
                       seconds=result['elapsedSeconds'], peakRssMiB=round(result['peakRssMiB'], 2),
                       differences=json.dumps({c:[expected.get(c),actual.get(c)] for c in
                           sorted(expected.keys() | actual.keys()) if expected.get(c) != actual.get(c)}) if supported else '')
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            row.update(status='process-failed', exact=False, error=str(error))
        results.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
    with (out/'results.csv').open('w') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(dict.fromkeys(k for r in results for k in r)), lineterminator='\n')
        writer.writeheader()
        writer.writerows(results)
    return any(not r['exact'] if r['exactRequired'] else r['status'] == 'ready' or not r.get('locatedDoubts') for r in results)


if __name__ == '__main__':
    sys.exit(main())

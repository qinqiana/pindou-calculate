"""Real originals and traceable negative derivatives; no new generalization score."""
import argparse
import csv
import json
from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'experiments/issue8'))
from recognize import recognize


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True)
    folder = parser.parse_args().output_dir
    folder.mkdir(parents=True, exist_ok=True)
    samples = json.loads((ROOT/'experiments/issue8/samples.json').read_text())['samples']
    reference = ROOT/'参考样例/豆画-Mard-148图纸样例.png'
    baseline = recognize(reference)
    inputs = [(sid, ROOT/next(s['path'] for s in samples if s['id'] == sid), '原始截图', None)
              for sid in ['S03', 'S04']]
    with Image.open(reference) as source:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 48)
        for name, label in [('foreign', 'ARTKAL'), ('multiple', 'MARD    HAMA'), ('palette', 'MARD 291')]:
            path = folder/(name+'.png')
            with Image.new('RGB', (source.width, source.height+120), 'white') as image:
                image.paste(source, (0, 0))
                ImageDraw.Draw(image).text((30, source.height+25), label, font=font, fill='black')
                image.save(path)
            inputs.append((name, path, '148原图下方加120像素白边并印 '+label, 'source'))
        target = next(e for e in baseline['evidence'] if e['rawText'] == 'H7(60)')
        x, y, w, h = target['region']
        path = folder/'unknown.png'
        with source.convert('RGB') as image:
            draw = ImageDraw.Draw(image)
            draw.rectangle((x+5, y+5, x+w-5, y+h-5), fill='black')
            draw.text((x+15, y+6), 'C30 (60)', font=font, fill='white')
            image.save(path)
        inputs.append(('unknown', path, '148原图末项H7(60)改印为色卡外C30(60)，本体不改', 'unknown'))
        path = folder/'cut.png'
        source.crop((0, 0, source.width, y+22)).save(path)
        inputs.append(('cut', path, f'148原图裁至末行y+22={y+22}像素，保留完整本体', 'cut'))
    rows = []
    for name, path, derivation, kind in inputs:
        result = recognize(path)
        proofs = {e['id']: e for e in result['evidence']}
        located = sum(bool(d.get('region') or proofs.get(d.get('evidenceId'), {}).get('region') or
                          any(proofs.get(key, {}).get('region') for key in d.get('evidenceIds', [])))
                      for d in result['doubts'])
        passed = result['status'] != 'ready' and bool(result['doubts'])
        if kind == 'source':
            passed &= result['status'] == 'failed' and not result['candidates'] and result['brandVerification'] == 'conflict'
        if kind == 'unknown':
            passed &= all(c['code'] != 'C30' for c in result['candidates']) and any('C30' in e.get('rawText', '') for e in result['evidence'])
        if kind == 'cut':
            passed &= result['source'] == 'grid' and result['total'] == 148 and located > 0
        if name == 'S04':
            expected = json.loads((ROOT/'experiments/issue8/references-v05.json').read_text())['samples']['S04']['expected']
            passed &= {c['code']: c['quantity'] for c in result['candidates']} == expected
        row = dict(input=name, source=str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else '148原图派生',
                   derivation=derivation, passed=bool(passed), status=result['status'], total=result['total'],
                   doubts=len(result['doubts']), locatedDoubts=located, seconds=result['elapsedSeconds'], manualCorrections=0)
        rows.append(row)
        (folder/(name+'.json')).write_text(json.dumps(result, ensure_ascii=False))
        print(name, row['passed'], row['status'], row['total'], flush=True)
    with (folder/'results.csv').open('w') as file:
        writer = csv.DictWriter(file, fieldnames=rows[0].keys(), lineterminator='\n')
        writer.writeheader()
        writer.writerows(rows)
    return not all(row['passed'] for row in rows)


if __name__ == '__main__':
    sys.exit(main())

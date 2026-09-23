"""Frozen exact-count regression; reference answers are compared only after recognition."""
import argparse
import csv
import json
from pathlib import Path
import sys

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'experiments/issue8'))
from recognize import recognize


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    samples = json.loads((ROOT/'experiments/issue8/samples.json').read_text())['samples']
    references = json.loads((ROOT/'experiments/issue8/references-v05.json').read_text())['samples']
    inputs = [(s['id'], s, ROOT/s['path']) for s in samples if s['id'] != 'S00']
    for sid in ['S17', 'S04', 'S01']:
        sample = next(s for s in samples if s['id'] == sid)
        for suffix in ['png', 'jpg', 'webp']:
            path = args.output_dir/f'{sid}.{suffix}'
            with Image.open(ROOT/sample['path']) as original, original.convert('RGB') as image:
                image.save(path, **({'quality': 88} if suffix != 'png' else {}))
            inputs.append((f'{sid}-{suffix}', sample, path))
    rows = []
    for name, sample, path in inputs:
        try:
            result = recognize(path)
        except Exception as error:
            result = {'status': 'failed', 'total': None, 'candidates': [], 'elapsedSeconds': None,
                      'doubts': [{'reason': str(error)}], 'error': type(error).__name__}
        expected = references[sample['id']]['expected']
        counts = {c['code']: c['quantity'] for c in result['candidates']}
        complete = references[sample['id']]['status'] == 'complete'
        row = {'input': name, 'group': 'development' if sample['id'] in ['S06', 'S11', 'S18'] else 'frozen-regression',
               'layout': sample['layout'], 'format': result.get('image', {}).get('format'),
               'referenceComplete': complete, 'exact': complete and counts == expected,
               'status': result['status'], 'total': result['total'], 'seconds': result['elapsedSeconds'],
               'manualCorrections': 0, 'risks': len(result['doubts']),
               'differences': json.dumps({code: {'expected': expected.get(code), 'actual': counts.get(code)}
                    for code in sorted(expected.keys() | counts.keys()) if expected.get(code) != counts.get(code)}, ensure_ascii=False)}
        rows.append(row)
        (args.output_dir/f'{name}.json').write_text(json.dumps(result, ensure_ascii=False))
        print(name, row['exact'], row['status'], row['total'], row['seconds'], flush=True)
    with (args.output_dir/'results.csv').open('w') as file:
        writer = csv.DictWriter(file, fieldnames=rows[0].keys(), lineterminator='\n')
        writer.writeheader()
        writer.writerows(rows)
    # A known truncated original remains a negative case, even if its visible
    # portion is read exactly. Never remove its row to improve the score.
    failures = [r for r in rows if (r['referenceComplete'] and not r['exact']) or
                (not r['referenceComplete'] and r['status'] == 'ready')]
    return bool(failures)


if __name__ == '__main__':
    sys.exit(main())

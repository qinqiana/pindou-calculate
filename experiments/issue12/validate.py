"""Exact body-count checks: the child recognizer receives only image bytes/path."""
import argparse
import csv
import json
from pathlib import Path
import subprocess
import sys

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    samples = json.loads((HERE/'samples.json').read_text())['samples']
    rows = []
    for sample in samples:
        output = args.output_dir/(sample['id']+'.json')
        row = {'id': sample['id'], 'kind': sample['kind'], 'group': sample['sourceGroup'],
               'supported': sample.get('supported', True)}
        try:
            path = ROOT/sample['path']
            if sample.get('crop'):
                path = args.output_dir/(sample['id']+'.png')
                with Image.open(ROOT/sample['path']) as original:
                    original.crop(tuple(sample['crop'])).save(path)
            subprocess.run([sys.executable, str(ROOT/'experiments/issue8/recognize.py'),
                            str(path), '--output', str(output)],
                           capture_output=True, text=True, check=True, timeout=30)
            result = json.loads(output.read_text())
            # References are opened only after the independent process exits.
            reference = json.loads((HERE/'references.json').read_text())['samples'][sample['id']]
            counts = {c['code']: c['quantity'] for c in result['candidates']}
            grid = result.get('grid', {})
            row.update(status=result['status'], source=result['source'], total=result['total'],
                       exact=counts == reference['expected'],
                       blankCells=grid.get('blankCells'), unknownCells=grid.get('unknownCells'),
                       locatedDoubts=sum(bool(d.get('region')) for d in result['doubts']),
                       seconds=result['elapsedSeconds'], peakRssMiB=round(result['runtime']['peakRssBytes']/2**20, 2),
                       differences=json.dumps({code: [reference['expected'].get(code), counts.get(code)]
                           for code in sorted(reference['expected'].keys() | counts.keys())
                           if reference['expected'].get(code) != counts.get(code)}))
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            row.update(status='process-failed', exact=False, error=str(error))
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
    with (args.output_dir/'results.csv').open('w') as file:
        keys = list(dict.fromkeys(key for row in rows for key in row))
        writer = csv.DictWriter(file, fieldnames=keys, lineterminator='\n')
        writer.writeheader()
        writer.writerows(rows)
    return any((not row['exact'] or row.get('source') != 'grid') if row['supported'] else
               (row['status'] == 'ready' or not row.get('locatedDoubts')) for row in rows)


if __name__ == '__main__':
    sys.exit(main())

"""Score original diagrams after recognition; references never enter the recognizer."""
import argparse
from collections import Counter
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def evaluate(result, reference):
    candidates = result.get('candidates', [])
    duplicates = sorted(code for code, n in Counter(c['code'] for c in candidates).items() if n > 1)
    actual = {c['code']: c['quantity'] for c in candidates}
    expected = reference.get('expected', {})
    missing, extra = sorted(expected.keys()-actual.keys()), sorted(actual.keys()-expected.keys())
    errors = {code: {'expected': count, 'actual': actual[code], 'allowedError': max(3, count*.10)}
              for code, count in expected.items() if code in actual
              and abs(count-actual[code]) > max(3, count*.10)}
    complete_reference = reference.get('status') == 'complete' and bool(expected)
    return {'passed': complete_reference and not (missing or extra or errors or duplicates),
            'referenceComplete': complete_reference, 'missing': missing, 'extra': extra,
            'duplicates': duplicates, 'outsideTolerance': errors, 'counts': actual}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, default=HERE/'samples.json')
    parser.add_argument('--references', type=Path, default=HERE/'references-v05.json')
    parser.add_argument('--recognizer', type=Path, default=HERE/'recognize.py')
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(args.manifest.read_text())['samples']
    references = json.loads(args.references.read_text())
    ids = [sample['id'] for sample in manifest]
    if len(ids) != len(set(ids)):
        parser.error('样例编号重复，拒绝覆盖逐图结果')
    denominator = sum(sample['id'] != 'S00' for sample in manifest)
    rows = []
    env = {**os.environ, 'OPENBLAS_NUM_THREADS': '1', 'OMP_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1'}
    for sample in manifest:
        output = args.output_dir/(sample['id']+'.json')
        row = {'id': sample['id'], 'path': sample['path']}
        try:
            subprocess.run([sys.executable, str(args.recognizer), str(ROOT/sample['path']),
                            '--output', str(output)], check=True, capture_output=True, text=True,
                           timeout=120, env=env)
            with output.open() as stream:
                result = json.load(stream)
            row.update(status=result['status'], total=result['total'], elapsedSeconds=result['elapsedSeconds'],
                       peakRssMiB=round(result['runtime']['peakRssBytes']/2**20, 2))
            if sample['id'] == 'S00':
                row['paletteRejected'] = result['status'] == 'failed' and not result['candidates']
            else:
                row.update(evaluate(result, references.get('samples', {}).get(sample['id'], {'status':'missing', 'expected':{}})))
            del result
        except (subprocess.SubprocessError, OSError, ValueError) as error:
            row.update(status='process-failed', passed=False, error=str(error))
        rows.append(row)
        report = {'purpose': references.get('purpose', 'External post-recognition evaluation'),
                  'recognizer': str(args.recognizer.resolve()),
                  'inferenceResources': {name: args.recognizer.with_name(name).stat().st_size
                                         for name in ['glyphs.json','glyph-model.npz','glyph-small.npz']
                                         if args.recognizer.with_name(name).exists()},
                  'tolerance': {'relative': .1, 'absolute': 3, 'rule': 'max(relative*expected,absolute)',
                                'allowMissingOrExtraCodes': False},
                  'passed': sum(r.get('passed', False) for r in rows if r['id'] != 'S00'),
                  'denominator': denominator, 'samples': rows}
        (args.output_dir/'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
        print(json.dumps(row, ensure_ascii=False), flush=True)

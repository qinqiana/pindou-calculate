"""Run the frozen manifest in fresh local processes; keep every failure and unknown reference."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--split', choices=['development', 'acceptance', 'all'], default='all')
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((HERE/'samples.json').read_text())
    results = []
    for sample in manifest['samples']:
        if args.split != 'all' and sample['split'] != args.split:
            continue
        output = args.output_dir/(sample['id']+'.json')
        record = {k: sample[k] for k in ['id', 'path', 'split', 'kind', 'source_group', 'reference_status']}
        try:
            subprocess.run([sys.executable, str(HERE/'recognize.py'), str(ROOT/sample['path']),
                            '--output', str(output)], check=True, capture_output=True, text=True, timeout=30)
            result = json.loads(output.read_text())
            counts = {c['code']: c['quantity'] for c in result['candidates']}
            record.update(status=result['status'], source=result['source'], counts=counts,
                          total=result['total'], elapsedSeconds=result['elapsedSeconds'],
                          runtime=result['runtime'], doubts=result['doubts'],
                          evidence=[{k: e[k] for k in ['id', 'source', 'rawText', 'region']}
                                    for e in result['evidence']],
                          referenceMatch=counts == sample['expected'] if sample['expected'] is not None else None)
        except (subprocess.SubprocessError, OSError, ValueError) as error:
            record.update(status='process-failed', referenceMatch=None, error=str(error))
        results.append(record)
        (args.output_dir/'summary.json').write_text(json.dumps(results, ensure_ascii=False, indent=2)+'\n')
        print(json.dumps({k: record[k] for k in ['id', 'status', 'total', 'referenceMatch', 'elapsedSeconds'] if k in record}, ensure_ascii=False), flush=True)

"""Self-authored landscape grids; borrow only scale requirements, never real image pixels."""
import json
import math
from collections import Counter
from pathlib import Path

codes = ([f'A{i}' for i in range(1, 9)] + [f'B{i}' for i in range(1, 9)]
         + [f'C{i}' for i in range(1, 17)] + [f'D{i}' for i in range(1, 9)]
         + [f'F{i}' for i in range(1, 9)] + [f'G{i}' for i in range(1, 9)]
         + ['H1', 'H2', 'H7', 'M1', 'M2', 'M3', 'M4', 'M5'])
assert len(codes) == 64

def landscape(identifier, cols, rows, total, modes, color_count=64):
    palette = codes[:color_count-3] + ['H1', 'H2', 'H7'] if color_count < 64 else codes
    # Retain the requested number of central cells, leaving explicit blank margins.
    ranked = sorted(range(cols*rows), key=lambda i: (-min(i % cols, cols-1-i % cols, i//cols, rows-1-i//cols), i))
    occupied = set(ranked[:total])
    grid = []
    for y in range(rows):
        row = []
        for x in range(cols):
            index = y*cols+x
            if index not in occupied:
                row.append(None)
                continue
            nx, ny = x/(cols-1), y/(rows-1)
            # Large contiguous sky, sun, mountain, river and town shapes, plus shade bands.
            if (nx-.76)**2 + (ny-.19)**2 < .055**2:
                shade = 2 + min(5, int(abs(nx-.76)*90))
            elif ny < .37 + .065*math.sin(nx*18):
                shade = 16 + min(15, int(ny*35))
            elif ny < .57 + .085*math.sin(nx*11+1):
                shade = 32 + int((ny + nx*.2)*35) % 8
            elif abs(nx - (.5 + .14*math.sin(ny*8))) < .035 + max(0, ny-.6)*.15:
                shade = 16 + int(ny*45) % 16
            elif .58 < ny < .82 and .12 < nx < .42:
                shade = 56 + (int(nx*70)+int(ny*70)) % 3 if (x//3+y//4) % 3 == 0 else 48 + x//5 % 8
            else:
                shade = 8 + int((ny + .04*math.sin(nx*24))*65) % 8
            row.append(palette[shade % len(palette)])
        grid.append(row)
    # A short multicolor border is part of this original test motif, guaranteeing all codes.
    stripe = [i for i in range(cols*rows) if i in occupied and i//cols >= rows-8]
    for j, i in enumerate(stripe):
        grid[i//cols][i % cols] = palette[(j//3) % len(palette)]
    # Make the two nearly-white formal codes explicit and adjacent to black.
    for j, code in enumerate(['H1', 'H2', 'H7']):
        i = ranked[len(ranked)//2+j]
        assert i in occupied
        grid[i//cols][i % cols] = code
    expected = dict(Counter(c for row in grid for c in row if c is not None))
    assert sum(expected.values()) == total and len(expected) == len(palette)
    return {'id': identifier, 'rows': grid, 'expected': expected,
            'blankCount': cols*rows-total, 'modes': modes}

fixtures = [
    landscape('medium-3600', 64, 64, 3600, ['right-count'], 24),
    landscape('dense-25250', 160, 160, 25250, ['inline', 'no-legend']),
    landscape('tall-30030', 138, 239, 30030, ['below']),
]
out = Path(__file__).parent / 'fixtures-large.json'
out.write_text(json.dumps(fixtures, ensure_ascii=False, separators=(',', ':'))+'\n')
print([(f['id'], len(f['rows'][0]), len(f['rows']), sum(f['expected'].values()), len(f['expected'])) for f in fixtures])

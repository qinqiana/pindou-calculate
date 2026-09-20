"""Local image -> evidence/candidates experiment. No OCR engine, network or ledger writes."""
import argparse
import base64
import json
import math
from pathlib import Path
import re
import time

import cv2
import numpy as np
from PIL import Image, ImageOps

from generate_glyphs import feature

VERSION = 'pixel-glyph-0.1'
PARAMETERS = {
    'glyph_error': .36, 'glyph_margin': .04, 'ink_contrast': 65,
    'shape_weight': .18, 'hole_weight': .15, 'grid_preview': 2000,
    'max_grid_cells': 4096, 'max_legend_boxes': 256,
}
ROOT = Path(__file__).resolve().parents[2]


def color_codes():
    # Read the existing static catalog, never a user's ledger or the sample manifest.
    text = (ROOT / 'app/src/ledger/catalog.ts').read_text()
    palette, _ = json.JSONDecoder().raw_decode(text.split('export const PALETTE: Palette = ', 1)[1])
    return {c['code'] for c in palette['colors']}


class GlyphReader:
    def __init__(self):
        self.alpha = None
        source = json.loads(Path(__file__).with_name('glyphs.json').read_text())
        self.chars, shapes, ratios, holes = [], [], [], []
        for char, ratio, hole_count, encoded in source['templates']:
            packed = np.frombuffer(base64.b64decode(encoded), dtype='uint8')
            values = np.empty(len(packed) * 2, dtype='float32')
            values[::2], values[1::2] = packed >> 4, packed & 15
            shapes.append(values / 15)
            self.chars.append(char)
            ratios.append(ratio)
            holes.append(hole_count)
        self.shapes = np.array(shapes)
        self.ratios, self.holes = np.array(ratios), np.array(holes)

    def match(self, mask, punctuation=False):
        shape, ratio, holes = feature(mask)
        scores = np.mean(abs(self.shapes - shape.ravel()), axis=1)
        scores += PARAMETERS['shape_weight'] * abs(np.log(ratio / self.ratios))
        scores += PARAMETERS['hole_weight'] * abs(holes - self.holes)
        best = {}
        for char, score in zip(self.chars, scores):
            if punctuation and char not in '.-':
                continue
            best[char] = min(best.get(char, math.inf), float(score))
        ranked = sorted(best.items(), key=lambda item: item[1])
        char, error = ranked[0]
        margin = ranked[1][1] - error
        return {'char': char, 'error': round(error, 4), 'margin': round(margin, 4),
                'alternative': ranked[1][0],
                'reliable': error <= PARAMETERS['glyph_error'] and margin >= PARAMETERS['glyph_margin']}

    def read(self, rgb, region, pad_fraction, min_letter_height):
        x, y, w, h = region
        px, py = max(2, round(w * pad_fraction[0])), max(2, round(h * pad_fraction[1]))
        tile = rgb[y+py:y+h-py, x+px:x+w-px]
        if not tile.size:
            return {'text': '', 'reliable': False, 'characters': [], 'blank': False}
        background = np.median(tile.reshape(-1, 3), axis=0)
        difference = np.max(abs(tile.astype('float32') - background), axis=2)
        mask = (difference > PARAMETERS['ink_contrast']).astype('uint8')
        _, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
        components = sorted([s for s in stats[1:] if s[4] >= max(2, h * .04)], key=lambda s: s[0])
        if len(components) > 32:
            return {'text': '', 'reliable': False, 'characters': [], 'blank': False}
        letters = [s for s in components if s[3] >= h * min_letter_height]
        chars = []
        for a, b, cw, ch, area in components:
            # Keep small punctuation: dropping a minus or decimal would invent a positive integer.
            small = ch < h * min_letter_height
            if small and not letters:
                continue
            match = self.match(mask[b:b+ch, a:a+cw], punctuation=small)
            match['region'] = [int(x+px+a), int(y+py+b), int(cw), int(ch)]
            if a == 0 or b == 0 or a+cw >= tile.shape[1] or b+ch >= tile.shape[0]:
                match['reliable'] = False
            chars.append(match)
        # Read text broadly; verify empty background farther from cell-edge shadows.
        bx, by = max(2, round(w*.20)), max(2, round(h*.20))
        blank_tile = rgb[y+by:y+h-by, x+bx:x+w-bx]
        blank = not chars and not mask.any() and blank_tile.size > 0 and blank_texture(blank_tile)
        if blank and self.alpha is not None and np.any(self.alpha[y:y+h, x:x+w] != 255):
            blank = False  # Transparency alone cannot establish a non-production cell.
        return {'text': ''.join(c['char'] for c in chars),
                'reliable': bool(chars) and all(c['reliable'] for c in chars),
                'characters': chars, 'blank': bool(blank)}


def blank_texture(tile):
    # Uniform pixels or a clear two-tone checkerboard are positive blank evidence.
    # No recognized text alone is never sufficient.
    spread = np.max(tile.reshape(-1, 3), axis=0).astype(int) - np.min(tile.reshape(-1, 3), axis=0)
    if max(spread) < 5:
        return True
    if np.max(np.ptp(tile.astype(int), axis=2)) > 3 or max(spread) > 40:
        return False
    gray = tile[:, :, 0].astype('float32')
    # A checker is the product of alternating horizontal/vertical stripes.
    # Fit the whole texture: an individual edge pixel may have compression ringing.
    u, singular, v = np.linalg.svd(gray-gray.mean(), full_matrices=False)
    energy = np.sum(singular**2)
    if energy == 0 or singular[0]**2 / energy < .95:
        return False
    return all(.2 < (stripe > 0).mean() < .8 and np.count_nonzero(np.diff(stripe > 0)) >= 2
               for stripe in [u[:, 0], v[0]])


def legend_boxes(rgb):
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    contours, _ = cv2.findContours(cv2.Canny(gray, 5, 15), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if not (3 < w / h < 12 and w > rgb.shape[1] * .02 and h > 10):
            continue
        if cv2.contourArea(contour) < w * h * .85:
            continue
        box = [x, y, w, h]
        if not any(max(abs(a-b) for a, b in zip(box, other)) <= 3 for other in boxes):
            boxes.append(box)
    return sorted(boxes, key=lambda b: (b[1] // 5, b[0]))


def axis_lines(edges, axis):
    length = edges.shape[1-axis]
    kernel = (1, max(20, edges.shape[0]//8)) if axis == 0 else (max(20, edges.shape[1]//8), 1)
    mask = cv2.morphologyEx(edges, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, kernel))
    power = (mask > 0).sum(axis=axis)
    ids = np.flatnonzero(power > power.max() * .12)
    groups = np.split(ids, np.flatnonzero(np.diff(ids) > 3) + 1)
    peaks = np.array([np.average(g, weights=power[g]) for g in groups if len(g)])
    if len(peaks) < 6 or len(peaks) > 350:
        return None
    differences = np.diff(peaks)
    options = np.unique(np.round(np.concatenate([differences/k for k in range(1, 5)]), 1))
    best = None
    for step in options[(options >= 6) & (options < length/4)]:
        tolerance = max(1.8, step*.04)
        for phase in peaks:
            residual = abs((peaks-phase+step/2) % step-step/2)
            use = residual < tolerance
            score = use.mean() * np.sqrt(step)
            if use.mean() >= .8 and (best is None or score > best[0]):
                best = (score, step, phase, use)
    if best is None:
        return None
    _, step, phase, use = best
    indices = np.rint((peaks[use]-phase)/step)
    step, phase = np.polyfit(indices, peaks[use], 1)
    start, end = phase+indices.min()*step, phase+indices.max()*step
    if abs(start-step) < max(2, step*.04):
        start -= step
    # Cropping can hide outer rules. This is only a hypothesis until every frame
    # label is read and agrees with the proposed row/column numbers.
    for missing in (1, 2):
        if abs(length-1-end-missing*step) < max(2, step*.04):
            end += missing*step
            break
    return {'start': float(start), 'end': float(end), 'step': float(step)}


def grid_result(rgb, reader, allowed):
    h, w = rgb.shape[:2]
    small = Image.fromarray(rgb)
    small.thumbnail((PARAMETERS['grid_preview'], PARAMETERS['grid_preview']), Image.Resampling.BICUBIC)
    preview = np.asarray(small)
    edges = np.maximum.reduce([cv2.Canny(preview[:, :, c], 5, 15) for c in range(3)])
    axes = [axis_lines(edges, i) for i in (0, 1)]
    failed = {'complete': False, 'counts': {}, 'cells': [], 'unknownCells': None,
              'reason': '网格或完整边界未可靠定位'}
    if any(a is None for a in axes):
        return failed
    for a, ratio in zip(axes, [w/preview.shape[1], h/preview.shape[0]]):
        for key in a:
            a[key] *= ratio
    x, y = axes
    cols = round((x['end']-x['start'])/x['step'])
    rows = round((y['end']-y['start'])/y['step'])
    # ponytail: v0.1 validates square grids with a four-sided numeric frame.
    # Other layouts remain unsupported until their complete boundary can be proved.
    if abs(math.log(x['step']/y['step'])) > .08 or min(cols, rows) < 4:
        return failed
    if rows*cols > PARAMETERS['max_grid_cells']:
        return {**failed, 'reason': '网格超过本版逐格验证范围'}
    def box(r, c):
        sx, sy = round(x['start']+c*x['step']), round(y['start']+r*y['step'])
        ex, ey = round(x['start']+(c+1)*x['step']), round(y['start']+(r+1)*y['step'])
        return [max(0, sx), max(0, sy), min(w, ex)-max(0, sx), min(h, ey)-max(0, sy)]
    def read(r, c, frame=False):
        return reader.read(rgb, box(r, c), (.04, .08) if frame else (.10, .15), .18)
    for side in [[(0, c, c) for c in range(1, cols-1)],
                 [(rows-1, c, c) for c in range(1, cols-1)],
                 [(r, 0, r) for r in range(1, rows-1)],
                 [(r, cols-1, r) for r in range(1, rows-1)]]:
        for r, c, number in side:
            label = read(r, c, frame=True)
            if not label['reliable'] or label['text'] != str(number):
                return failed
    counts, cells, blanks, unknown = {}, [], 0, 0
    for r in range(1, rows-1):
        for c in range(1, cols-1):
            item = read(r, c)
            if item['blank']:
                blanks += 1
                continue
            code = normalize_code(item['text'], allowed) if item['reliable'] else None
            cell = {'row': r, 'column': c, 'region': box(r, c), 'rawText': item['text'],
                    'code': code, 'characters': item['characters']}
            cells.append(cell)
            if code:
                counts[code] = counts.get(code, 0)+1
            else:
                unknown += 1
    return {'complete': unknown == 0, 'rows': rows-2, 'columns': cols-2, 'counts': counts,
            'blankCells': blanks, 'unknownCells': unknown, 'cells': cells,
            'region': [max(0, round(x['start'])), max(0, round(y['start'])),
                       round(x['end']-x['start']), round(y['end']-y['start'])],
            'reason': None if unknown == 0 else '存在未读清或无法判为空白的格子'}


def normalize_code(text, allowed):
    match = re.fullmatch(r'([A-Z]+)([0-9]+)', text)
    code = match[1]+str(int(match[2])) if match else None
    return code if code in allowed else None


def recognize(path):
    started = time.perf_counter()
    result = {'algorithm': VERSION, 'parameters': PARAMETERS, 'status': 'failed',
              'source': None, 'candidates': [], 'evidence': [], 'doubts': [],
              'total': None, 'titleTotal': None, 'manualInput': False,
              'brandVerification': 'not-verified'}
    try:
        path = Path(path)
        if path.stat().st_size > 20*1024*1024:
            raise ValueError('图片超过 20 MiB 上限')
        with Image.open(path) as original:
            fmt = original.format
            if fmt not in {'PNG', 'JPEG', 'WEBP'}:
                raise ValueError('只支持 PNG、JPG 和静态 WebP')
            if original.width*original.height > 32_000_000:
                raise ValueError('图片超过 3200 万像素上限')
            if getattr(original, 'n_frames', 1) != 1:
                raise ValueError('不支持动画图纸')
            original.verify()
        with Image.open(path) as original:
            orientation = original.getexif().get(274, 1)
            original.load()
            oriented = ImageOps.exif_transpose(original) if orientation != 1 else original
            alpha = None
            if 'A' in oriented.getbands() or 'transparency' in oriented.info:
                rgba = oriented if oriented.mode == 'RGBA' else oriented.convert('RGBA')
                channel = rgba.getchannel('A')
                if channel.getextrema() != (255, 255):
                    alpha = np.asarray(channel)
                    image = Image.new('RGB', rgba.size, 'white')
                    image.paste(rgba, mask=channel)
                else:
                    image = oriented.convert('RGB')
                del rgba, channel
            else:
                image = oriented.convert('RGB')
        rgb = np.asarray(image)
        image.close()  # NumPy's buffer is independent; release the full-size Pillow raster.
        result['image'] = {'format': fmt, 'width': image.width, 'height': image.height,
                           'sourceOrientation': orientation, 'coordinates': 'display-oriented-original'}
        reader, allowed = GlyphReader(), color_codes()
        reader.alpha = alpha
        boxes = legend_boxes(rgb)
        if len(boxes) > PARAMETERS['max_legend_boxes']:
            raise ValueError('图例候选过多，本版无法可靠处理')
        for i, region in enumerate(boxes):
            item = reader.read(rgb, region, (.012, .08), .28)
            evidence = {'id': f'legend-{i}', 'source': 'legend', 'rawText': item['text'],
                        'region': region, 'characters': item['characters'], 'score': None}
            result['evidence'].append(evidence)
            match = re.fullmatch(r'([A-Z]+[A-Z0-9]*)\(([^()]*)\)', item['text'])
            code = normalize_code(match[1], allowed) if match else None
            valid_quantity = bool(match and re.fullmatch(r'[0-9]+', match[2]))
            quantity = int(match[2]) if valid_quantity else None
            clipped = region[0] <= 1 or region[1] <= 1 or region[0]+region[2] >= image.width-1 or region[1]+region[3] >= image.height-1
            if item['reliable'] and code and quantity is not None and quantity <= 1_000_000_000 and not clipped:
                result['candidates'].append({'code': code, 'quantity': quantity,
                                             'source': 'legend', 'evidenceIds': [evidence['id']]})
            else:
                result['doubts'].append({'reason': '图例文字、色号、数量或边界不可靠',
                                         'evidenceId': evidence['id'], 'region': region,
                                         'rawText': item['text'], 'quantity': None})
        duplicates = {c['code'] for c in result['candidates']
                      if sum(d['code'] == c['code'] for d in result['candidates']) > 1}
        for code in sorted(duplicates):
            result['doubts'].append({'reason': '不同位置出现重复色号，未自动累加', 'code': code})
        result['candidates'] = [c for c in result['candidates'] if c['code'] not in duplicates]
        grid = grid_result(rgb, reader, allowed)
        result['grid'] = grid
        legend = {c['code']: c['quantity'] for c in result['candidates']}
        if legend:
            result['source'] = 'legend'
            result['status'] = 'partial'
            if grid['complete'] and grid['counts'] == legend and not result['doubts']:
                result['status'] = 'ready'
            else:
                result['doubts'].append({'reason': '图例与完整逐格计数未相互验证',
                                         'gridReason': grid['reason'], 'gridCounts': grid['counts']})
        elif not boxes and grid['complete'] and grid['counts']:
            result['source'], result['status'] = 'grid', 'ready'
            for code, quantity in sorted(grid['counts'].items()):
                ids = []
                for cell in grid['cells']:
                    if cell['code'] == code:
                        key = f"cell-{cell['row']}-{cell['column']}"
                        ids.append(key)
                        result['evidence'].append({'id': key, 'source': 'grid', **cell})
                result['candidates'].append({'code': code, 'quantity': quantity, 'source': 'grid', 'evidenceIds': ids})
        else:
            result['doubts'].append({'reason': '未取得可靠逐色用量', 'gridReason': grid['reason']})
        if result['candidates']:
            total = sum(c['quantity'] for c in result['candidates'])
            if total > 2**53-1:
                raise ValueError('合计超出安全整数范围')
            result['total'] = total
        result['coverage'] = '已覆盖带四边编号的制作区域，并逐格读取；结果仍待用户核对' if result['status'] == 'ready' else '完整覆盖尚未证明；疑点可能影响用量'
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError, cv2.error) as error:
        result.update(status='failed', source=None, candidates=[], total=None)
        result['doubts'].append({'reason': str(error)})
    result['elapsedSeconds'] = round(time.perf_counter()-started, 3)
    return result


if __name__ == '__main__':
    import platform
    import resource
    import PIL
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image', type=Path)
    parser.add_argument('--output', type=Path, help='Write candidates and evidence JSON')
    args = parser.parse_args()
    result = recognize(args.image)
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    result['runtime'] = {'python': platform.python_version(), 'pillow': PIL.__version__,
                         'numpy': np.__version__, 'opencv': cv2.__version__,
                         'system': platform.system(), 'machine': platform.machine(),
                         'peakRssBytes': int(peak if platform.system() == 'Darwin' else peak*1024),
                         'glyphBytes': Path(__file__).with_name('glyphs.json').stat().st_size}
    encoded = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(encoded+'\n')
        print(json.dumps({k: result[k] for k in ['status', 'source', 'total', 'candidates', 'elapsedSeconds']}, ensure_ascii=False))
    else:
        print(encoded)

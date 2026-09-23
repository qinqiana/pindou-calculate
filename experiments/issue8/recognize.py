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
from layout_legend import crop_rgb, recognize_layout, make_preview
from glyph_model import GlyphModel, SmallGlyphModel
from grid_legend import refine_from_grid, refine_edge_codes, count_grid, find_grid_axes

VERSION = 'pixel-glyph-0.9.2-dev'
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

    def read(self, image, region, pad_fraction, min_letter_height):
        x, y, w, h = region
        rgb, transparent = crop_rgb(image, region)
        px, py = max(2, round(w * pad_fraction[0])), max(2, round(h * pad_fraction[1]))
        tile = rgb[py:h-py, px:w-px]
        if not tile.size:
            return {'text': '', 'reliable': False, 'characters': [], 'blank': False}
        background = np.median(tile.reshape(-1, 3), axis=0).astype('float32')
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
        blank_tile = rgb[by:h-by, bx:w-bx]
        blank = not chars and not mask.any() and blank_tile.size > 0 and blank_texture(blank_tile)
        if blank and np.ptp(blank_tile.reshape(-1, 3), axis=0).max() < 5:
            # A plain center cannot hide faint content elsewhere in the reading area.
            blank = np.ptp(tile.reshape(-1, 3), axis=0).max() < 5
        if blank and transparent:
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


def legend_boxes(image):
    # Overlapping strips preserve original text geometry without full-image Canny buffers.
    boxes = []
    strip_height = min(image.height, max(32, min(512, 2_000_000//image.width)))
    stride = max(1, strip_height//2)
    for top in range(0, image.height, stride):
        height = min(strip_height, image.height-top)
        rgb, _ = crop_rgb(image, [0, top, image.width, height])
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        del rgb
        contours, _ = cv2.findContours(cv2.Canny(gray, 5, 15), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            x, y, w, h = cv2.boundingRect(contour)
            if (y <= 1 and top > 0) or (y+h >= height-1 and top+height < image.height):
                continue
            if not (3 < w/h < 12 and w > image.width*.02 and h > 10):
                continue
            if cv2.contourArea(contour) < w*h*.85:
                continue
            box = [x, top+y, w, h]
            if not any(max(abs(a-b) for a, b in zip(box, other)) <= 3 for other in boxes):
                boxes.append(box)
        if top+height >= image.height:
            break
    return sorted(boxes, key=lambda b: (b[1]//5, b[0]))


def axis_lines(edges, axis, kernel_length=None):
    length = edges.shape[1-axis]
    kernel = (1, max(20, edges.shape[0]//8)) if axis == 0 else (max(20, edges.shape[1]//8), 1)
    if kernel_length is not None:
        kernel = (1, kernel_length) if axis == 0 else (kernel_length, 1)
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


def grid_result(image, preview, reader, allowed):
    w, h = image.size
    edges = cv2.Canny(preview[:, :, 0], 5, 15)
    for channel in (1, 2):
        np.maximum(edges, cv2.Canny(preview[:, :, channel], 5, 15), out=edges)
    axes = [axis_lines(edges, i) for i in (0, 1)]
    del edges
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
        return reader.read(image, box(r, c), (.04, .08) if frame else (.10, .15), .18)
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


def grid_candidates(grid):
    evidence, by_code = [], {}
    for cell in grid['cells']:
        key = f"cell-{cell['row']}-{cell['column']}"
        evidence.append({'id': key, 'source': 'grid', **cell})
        if cell['code']:
            by_code.setdefault(cell['code'], []).append(key)
    candidates = [{'code': code, 'quantity': quantity, 'source': 'grid',
                   'evidenceIds': by_code[code]}
                  for code, quantity in sorted(grid['counts'].items())]
    return candidates, evidence


def overlapping_region(a, b):
    x, y, w, h = a
    u, v, s, t = b
    return (max(0, min(x+w, u+s)-max(x, u)) * max(0, min(y+h, v+t)-max(y, v))
            > min(w*h, s*t)*.8)


def character_region(characters, fallback):
    if not characters:
        return fallback
    boxes = [c['region'] for c in characters]
    x, y = min(b[0] for b in boxes), min(b[1] for b in boxes)
    return [x, y, max(b[0]+b[2] for b in boxes)-x, max(b[1]+b[3] for b in boxes)-y]


def reject_duplicate_codes(candidates, evidence, doubts):
    """Deduplicate repeat detections by location; keep separate printed entries."""
    proofs = {e['id']: e for e in evidence}
    positions = {e['id']: character_region(e.get('code', e).get('characters', []), e['region']) for e in evidence}
    unique = []
    for candidate in candidates:
        proof = proofs[candidate['evidenceIds'][0]]
        if any(c['code'] == candidate['code'] and c['quantity'] == candidate['quantity']
               and overlapping_region(positions[c['evidenceIds'][0]], positions[proof['id']]) for c in unique):
            continue
        unique.append(candidate)
    repeated = {c['code'] for c in unique if sum(d['code'] == c['code'] for d in unique) > 1}
    for candidate in unique:
        if candidate['code'] in repeated:
            proof = proofs[candidate['evidenceIds'][0]]
            doubts.append({'reason': '不同位置出现重复色号，未计入，未自动累加', 'code': candidate['code'],
                           'evidenceId': proof['id'], 'region': proof['region'], 'rawText': proof['rawText']})
    return [c for c in unique if c['code'] not in repeated]


def reject_shared_quantities(candidates, evidence, doubts):
    proofs = {e['id']: e for e in evidence}
    fields = {}
    for candidate in candidates:
        key = candidate['evidenceIds'][0]
        characters = (proofs[key].get('quantity') or {}).get('characters', [])
        if characters:
            fields[key] = character_region(characters, None)
    ambiguous = {key for key, box in fields.items() if any(
        other != key and overlapping_region(box, region) for other, region in fields.items())}
    for key in sorted(ambiguous):
        proof = proofs[key]
        doubts.append({'reason': '同一数量可能对应多个色号，未计入，请核对配对',
                       'evidenceId': key, 'region': proof['region'], 'rawText': proof['rawText']})
    return [c for c in candidates if c['evidenceIds'][0] not in ambiguous]


def recognize(path):
    started = time.perf_counter()
    result = {'algorithm': VERSION, 'parameters': PARAMETERS, 'status': 'failed',
              'source': None, 'candidates': [], 'evidence': [], 'doubts': [],
              'total': None, 'titleTotal': None, 'manualInput': False,
              'brandVerification': 'not-verified'}
    image = None
    original = None
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
        original = Image.open(path)
        orientation = original.getexif().get(274, 1)
        original.load()
        image = ImageOps.exif_transpose(original) if orientation != 1 else original
        if image is not original:
            original.close()
        width, height = image.size
        preview = make_preview(image, PARAMETERS['grid_preview'])
        result['image'] = {'format': fmt, 'width': width, 'height': height,
                           'sourceOrientation': orientation, 'coordinates': 'display-oriented-original'}
        reader, allowed = GlyphReader(), color_codes()
        boxes = legend_boxes(image)
        if len(boxes) > PARAMETERS['max_legend_boxes']:
            raise ValueError('图例候选过多，本版无法可靠处理')
        invalid_number_regions = []
        for i, region in enumerate(boxes):
            item = reader.read(image, region, (.012, .08), .28)
            evidence = {'id': f'legend-{i}', 'source': 'legend', 'rawText': item['text'],
                        'region': region, 'characters': item['characters'], 'score': None}
            result['evidence'].append(evidence)
            match = re.fullmatch(r'([A-Z]+[A-Z0-9]*)\(([^()]*)\)', item['text'])
            code = normalize_code(match[1], allowed) if match else None
            valid_quantity = bool(match and re.fullmatch(r'[0-9]+', match[2]))
            quantity = int(match[2]) if valid_quantity else None
            # A merged pair of digits can be the old template reader's low-score
            # "minus"; only positively read punctuation blocks the newer reader.
            if match and code and re.search(r'[-.]', match[2]) and any(
                    c['char'] in '-.' and c['reliable'] for c in item['characters']):
                invalid_number_regions.append((code, region))
            clipped = region[0] <= 1 or region[1] <= 1 or region[0]+region[2] >= width-1 or region[1]+region[3] >= height-1
            if item['reliable'] and code and quantity is not None and quantity <= 1_000_000_000 and not clipped:
                result['candidates'].append({'code': code, 'quantity': quantity,
                                             'source': 'legend', 'evidenceIds': [evidence['id']]})
            else:
                result['doubts'].append({'reason': '图例文字、色号、数量或边界不可靠',
                                         'evidenceId': evidence['id'], 'region': region,
                                         'rawText': item['text'], 'quantity': None})
        result['candidates'] = reject_duplicate_codes(result['candidates'], result['evidence'], result['doubts'])
        rejected_legend = bool(result['doubts'])
        grid = grid_result(image, preview, reader, allowed)
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
            result['candidates'], evidence = grid_candidates(grid)
            result['evidence'].extend(evidence)
        else:
            result['doubts'].append({'reason': '未取得可靠逐色用量', 'gridReason': grid['reason']})
        if result['status'] != 'ready':
            model = GlyphModel()
            axes = find_grid_axes(preview, axis_lines)
            layout = recognize_layout(image, preview, model, axes)
            if axes is not None and any(it['tinyPrint'] for it in layout['items']):
                refine_from_grid(image,preview,layout,SmallGlyphModel(model),axes,allowed)
            if axes is not None:
                refine_edge_codes(image, preview, layout, model, axes)
            new_candidates, new_evidence, new_doubts = [], [], []
            for i, item in enumerate(layout['items']):
                key = f'layout-{i}'
                new_evidence.append({'id': key, 'source': 'legend', 'rawText': item['code']['rawText'] +
                                     (' / '+item['quantity']['rawText'] if item['quantity'] else ''), **item})
                code = normalize_code(item['codeText'], allowed)
                text = item['quantityText']
                confidence = min(item['code'].get('interpretation',{}).get('score',item['code']['score']),
                                 item['quantity'].get('interpretation',{}).get('score',item['quantity']['score']) if item['quantity'] else 1)
                if item.get('gridVerification',{}).get('verifiedCode'):
                    confidence = item['quantity'].get('interpretation',{}).get('score',0) if item['quantity'] else confidence
                bx,by,bw,bh = item['region']
                invalid_number = any(code == bad_code and
                    max(0,min(bx+bw,rx+rw)-max(bx,rx))*max(0,min(by+bh,ry+rh)-max(by,ry)) > min(bw*bh,rw*rh)*.5
                    for bad_code,(rx,ry,rw,rh) in invalid_number_regions)
                if invalid_number or not code or not text or not re.fullmatch(r'[0-9]+', text) or confidence <= .35 or int(text) > 1_000_000_000:
                    new_doubts.append({'reason': '图例字段未可靠读清，未计入，未记为零', 'evidenceId': key,
                                       'region': item['region'], 'rawText': new_evidence[-1]['rawText']})
                    continue
                new_candidates.append({'code': code, 'quantity': int(text), 'source': 'legend',
                                       'evidenceIds': [key]})
                verification = item.get('gridVerification', {})
                if verification and verification['originalCode'] != code:
                    new_doubts.append({'reason': '小字候选由同图重复格内文字或字形交叉解释，保留原文供核对',
                                       'evidenceId': key, 'originalCode': verification['originalCode'], 'candidateCode': code})
                if item.get('sameFontVerification'):
                    new_doubts.append({'reason': '弱字段参考同图清楚字形解释，保留原文及对照位置供核对',
                                       'evidenceId': key, **item['sameFontVerification']})
                for field in [item['code'], item['quantity']]:
                    variants = sorted({v['decoded'] for v in (field or {}).get('variants', [])
                                       if v.get('decoded') and v['score'] > .8})
                    if len(variants) > 1:
                        new_doubts.append({'reason': '同一文字有不同读法，请核对原图', 'evidenceId': key,
                                           'region': field['region'], 'rawText': ' / '.join(variants)})
                    if field and field.get('interpretation', {}).get('changes'):
                        new_doubts.append({'reason': '存在字符歧义，候选按字段语法解释，仍需核对',
                                           'evidenceId': key, 'changes': field['interpretation']['changes']})
            new_candidates = reject_duplicate_codes(new_candidates, new_evidence, new_doubts)
            new_candidates = reject_shared_quantities(new_candidates, new_evidence, new_doubts)
            # A newer parser may read other rows successfully while missing an
            # earlier visible item. Only a matching source region supersedes it.
            if layout.get('region'):
                for proof in result['evidence']:
                    if (proof.get('source') == 'legend' and overlapping_region(proof['region'], layout['region'])
                            and not any(overlapping_region(proof['region'], e['region']) for e in new_evidence)):
                        new_evidence.append(proof)
                        new_doubts.append({'reason': '此处可见图例未可靠配对，未计入，请对照原图补充',
                                           'evidenceId': proof['id'], 'region': proof['region'], 'rawText': proof['rawText']})
            if new_candidates:
                if grid['complete'] and any(grid['counts'].get(code) != quantity
                                            for code, quantity in legend.items()):
                    # A later reader omitting a field must not erase its conflict.
                    new_evidence.extend(result['evidence'])
                    new_doubts.append({'reason': '图例与完整本体数量冲突，保留原图例，不自动补全',
                                       'legendCounts': legend, 'gridCounts': grid['counts'],
                                       'evidenceIds': [e['id'] for e in result['evidence']]})
                result.update(candidates=new_candidates, evidence=new_evidence, doubts=new_doubts,
                              source='legend', status='partial')
                # Reuse an already complete numbered grid, never add two counts
                # or use incomplete cells to fill a missing legend quantity.
                if (grid['complete'] and grid['unknownCells'] == 0 and not rejected_legend
                        and not new_doubts and len(new_candidates) < len(grid['counts'])
                        and all(grid['counts'].get(c['code']) == c['quantity'] for c in new_candidates)):
                    result['candidates'], evidence = grid_candidates(grid)
                    result['evidence'].extend(evidence)
                    result['source'] = 'grid'
                    result['doubts'].append({'reason': '图例未列全制作色号，采用独立完整逐格计数，保留图例供核对',
                                            'gridCounts': grid['counts']})
                else:
                    result['doubts'].append({'reason': '图例与本体计数待核对',
                                            'gridReason': grid['reason'], 'gridCounts': grid['counts']})
                result['legendRegion'] = layout['region']
            elif new_evidence:
                result['evidence'].extend(new_evidence)
                result['doubts'].extend(new_doubts)
                result['legendRegion'] = layout['region']
        if not result['candidates'] and not layout['items'] and not grid['cells']:
            # Keep invalid/unreadable quantity legends visible; this path is for a
            # grid that the older four-numbered-sides reader could not accept.
            counted = count_grid(image, preview, SmallGlyphModel(model), axes, allowed, blank_texture, boxes)
            if counted is not None:
                result.update(grid=counted, source='grid', status='partial')
                result['candidates'], evidence = grid_candidates(counted)
                result['evidence'].extend(evidence)
                result['doubts'].append({'reason': counted['reason'], 'unknownCells': counted['unknownCells']})
        if result['candidates']:
            total = sum(c['quantity'] for c in result['candidates'])
            if total > 2**53-1:
                raise ValueError('合计超出安全整数范围')
            result['total'] = total
        result['coverage'] = '已覆盖带四边编号的制作区域，并逐格读取；结果仍待用户核对' if result['grid']['complete'] else '完整覆盖尚未证明；疑点可能影响用量'
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError, cv2.error) as error:
        result.update(status='failed', source=None, candidates=[], total=None)
        result['doubts'].append({'reason': str(error)})
    finally:
        if image is not None:
            image.close()
        if original is not None:
            original.close()
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
    if args.output:
        with args.output.open('w', encoding='utf-8') as stream:
            json.dump(result, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        print(json.dumps({k: result[k] for k in ['status', 'source', 'total', 'candidates', 'elapsedSeconds']}, ensure_ascii=False))
    else:
        import sys
        json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
        print()

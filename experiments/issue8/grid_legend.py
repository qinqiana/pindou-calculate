"""Cross-read tiny legend labels from repeated cells in the same image."""
from collections import Counter
from itertools import product
import math
import re

import cv2
import numpy as np
from PIL import Image

from glyph_model import normalize
from layout_legend import crop_rgb, read_field, decode_field


def refine_edge_codes(image, preview, layout, model, axes):
    """Check noisy legend glyph alternatives against repeated text in this image."""
    if axes is None:
        return
    pending = []
    for item in layout['items']:
        field = item['code']
        if item['layout'] != 'right' or field.get('interpretation', {}).get('score', 0) >= .65:
            continue
        chars = field['characters']
        if not 3 <= len(chars) <= 4:
            continue
        fx, fy, fw, fh = field['region']
        first, rest = chars[0], chars[1:]
        cx, cy, cw, ch = first['region']
        if (first['score'] >= .5 or cx > fx or cw >= np.median([c['region'][2] for c in rest])*.75):
            continue
        options = [[v['char'] for v in [{'char': c['char'], 'score': c['score']}, *c['alternatives']]
                    if v['score'] >= .12 and v['char'] in ('ABCDEFGHIJKLMNOPQRSTUVWXYZ' if i == 0 else '0123456789')]
                   for i, c in enumerate(rest)]
        words = {''.join(word) for word in product(*options)}
        if words:
            pending.append((item, words, first['region']))
    if not pending:
        return
    from glyph_model import SmallGlyphModel
    model = SmallGlyphModel(model)
    x, y = axes
    cols, rows = [round((a['end']-a['start'])/a['step']) for a in axes]
    if min(cols, rows) < 5 or cols*rows > 16000:
        return
    sx, sy = image.width/preview.shape[1], image.height/preview.shape[0]
    words = set().union(*(w for _, w, _ in pending))
    votes, examples = Counter(), []
    # ponytail: at most 1024 evenly spaced cells; keep uncertainty for rarer labels.
    stride = max(1, math.ceil(cols*rows/1024))
    for index in range(0, cols*rows, stride):
        row, col = divmod(index, cols)
        xx, yy = x['start']+(col+.5)*x['step'], y['start']+(row+.5)*y['step']
        if layout['region'] and yy*sy >= layout['region'][1]:
            continue
        box = [(xx-x['step']*.44)*sx, (yy-y['step']*.32)*sy, x['step']*.88*sx, y['step']*.64*sy]
        pixels, transparent = crop_rgb(image, box)
        if not pixels.size or transparent:
            continue
        background = np.median(pixels.reshape(-1,3), axis=0)
        if np.count_nonzero(abs(pixels.astype('float32')-background).max(axis=2) > 40) < 6:
            continue
        field = read_field(image, box, model, background, kind='code')
        word = decode_field(field, 'code')
        score = field.get('interpretation', {}).get('score', 0)
        if word in words and score > .8:
            votes[word] += 1
            examples.append({'text': word, 'region': field['region'], 'score': score})
    for item, candidates, noise in pending:
        ranked = sorted(((votes[word],word) for word in candidates), reverse=True)
        count, word = ranked[0]
        if count < 5 or (len(ranked)>1 and count < 3*ranked[1][0]):
            continue
        if any(other is not item and other['codeText'] == word for other in layout['items']):
            continue
        item['gridVerification'] = {'originalCode': item['codeText'], 'verifiedCode': word,
            'votes': {w:votes[w] for w in sorted(candidates)}, 'edgeNoiseRegion': noise,
            'reason': '贴边碎片与正文重复字符交叉核对；不按色卡猜号',
            'examples': [e for e in examples if e['text'] == word][:8]}
        item['codeText'] = word


def refine_from_grid(image, preview, layout, model, axes, allowed):
    items = [it for it in layout['items'] if it['tinyPrint']
             and it['swatchColor'] is not None and it['quantityText'] is not None]
    if not items or any(a is None for a in axes):
        return
    x, y = axes
    if abs(math.log(x['step']/y['step'])) > .05:
        return
    cols, rows = [round((a['end']-a['start'])/a['step']) for a in axes]
    if min(cols, rows) < 5 or cols*rows > 16000:
        return
    sx, sy = image.width/preview.shape[1], image.height/preview.shape[0]
    centers, colors = [], []
    for row in range(rows):
        for col in range(cols):
            xx, yy = x['start']+(col+.5)*x['step'], y['start']+(row+.5)*y['step']
            tile = preview[max(0,round(yy-y['step']*.3)):round(yy+y['step']*.3),
                           max(0,round(xx-x['step']*.3)):round(xx+x['step']*.3)]
            if tile.size:
                background = np.median(tile.reshape(-1,3), axis=0)
                # A blank cell supplies no character evidence; do not let plain white dominate sampling.
                if np.count_nonzero(abs(tile.astype('float32')-background).max(axis=2) > 40) >= 6:
                    colors.append(background)
                    centers.append((xx, yy))
    if not colors:
        return
    colors = np.array(colors)
    backgrounds = np.array([it['swatchColor'] for it in items])
    distance = np.linalg.norm(colors[:,None,:]-backgrounds[None,:,:], axis=2)
    assignments = distance.argmin(axis=1)
    anchors = []

    def glyph_shape(character, background):
        pixels, _ = crop_rgb(image, character['region'])
        diff = abs(pixels.astype('float32')-background).max(axis=2)
        return normalize((diff > max(20,np.percentile(diff,90)*.5)).astype('float32'))

    for index, item in enumerate(items):
        votes, examples, masks = Counter(), [], []
        ids = [i for i in np.argsort(distance[:,index]) if assignments[i] == index][:25]
        for cell_id in ids:
            if distance[cell_id,index] > 40:
                continue
            xx, yy = centers[cell_id]
            box = [(xx-x['step']*.46)*sx, (yy-y['step']*.32)*sy,
                   x['step']*.92*sx, y['step']*.64*sy]
            field = read_field(image, box, model, background=colors[cell_id], kind='code')
            word = decode_field(field, 'code')
            if word and field.get('interpretation',{}).get('score',0) > .65:
                votes[word] += 1
                examples.append({'text': word, 'region': field['region'], 'score': field['interpretation']['score']})
            pixels, _ = crop_rgb(image, box)
            diff = abs(pixels.astype('float32')-colors[cell_id]).max(axis=2)
            diff[:1] = diff[-1:] = 0
            diff[:,:1] = diff[:,-1:] = 0
            yy0, xx0 = np.nonzero(diff > max(35,np.percentile(diff,95)*.35))
            if len(xx0) > 8:
                patch = diff[yy0.min():yy0.max()+1,xx0.min():xx0.max()+1]
                hh, ww = patch.shape
                if hh > 3 and ww/hh < 4:
                    patch = np.clip(patch/max(50,np.percentile(patch,95)),0,1)
                    nw = round(ww/hh*20)
                    canvas = np.zeros((28,96),'float32')
                    canvas[4:24,(96-nw)//2:(96-nw)//2+nw] = cv2.resize(patch,(nw,20))
                    masks.append(canvas)
        ranked = [(word,n) for word,n in votes.most_common() if word in allowed]
        other_distance = min((np.linalg.norm(backgrounds[index]-bg) for j,bg in enumerate(backgrounds)
                              if index != j), default=math.inf)
        verified = None
        if ranked:
            word, count = ranked[0]
            supported_variant = any(v['decoded'] == word and v['score'] > .3 for v in item['code'].get('variants',[]))
            collision = any(j != index and other['codeText'] == word for j,other in enumerate(items))
            second = ranked[1][1] if len(ranked)>1 else 0
            if not collision and (other_distance > 20 or supported_variant) and count >= 5 and count >= 2*second and count/sum(n for _,n in ranked) > .55:
                verified = word
        average_words = []
        if masks and other_distance > 20 and verified is None:
            for average in (np.mean, np.median):
                pixels = (255-np.clip(average(masks,axis=0),0,1)*255).astype('uint8')
                with Image.fromarray(pixels) as gray, gray.convert('RGB') as averaged:
                    field = read_field(averaged,[0,0,96,28],model,background=np.full(3,255),kind='code')
                word = decode_field(field,'code')
                if field.get('interpretation',{}).get('score',0) > .65:
                    average_words.append(word)
            if len(average_words) == 2 and average_words[0] == average_words[1] and votes[average_words[0]] >= 2:
                if average_words[0] in allowed:
                    verified = average_words[0]
        if verified and any(j != index and other['codeText'] == verified for j,other in enumerate(items)):
            verified = None  # Cross-reading may not merge two separately printed legend entries.
        item['gridVerification'] = {'votes': dict(votes), 'examples': examples,
                                    'averages': average_words, 'originalCode': item['codeText'], 'verifiedCode': verified}
        chars = item['code']['characters']
        if verified:
            item['codeText'] = verified
            if len(verified) == len(chars):
                anchors.extend((c, glyph_shape(char,backgrounds[index])) for c,char in zip(verified,chars))
        else:
            word = item['codeText']
            agreement = [v for v in item['code'].get('variants',[]) if v['decoded'] == word]
            if word in allowed and len(agreement) >= 3 and max(v['score'] for v in agreement) > .8 and len(word) == len(chars):
                anchors.append((word[0],glyph_shape(chars[0],backgrounds[index])))
    # Adapt only the letter prefix. Number glyphs and quantities keep their own evidence.
    for index, item in enumerate(items):
        if item['gridVerification']['verifiedCode'] or not item['code']['characters'] or not anchors:
            continue
        shape = glyph_shape(item['code']['characters'][0], backgrounds[index])
        by_letter = {}
        for letter, reference in anchors:
            if letter.isalpha():
                error = float(np.mean(abs(shape-reference)))
                by_letter[letter] = min(by_letter.get(letter,1),error)
        ranked = sorted(by_letter.items(),key=lambda pair: pair[1])
        if not ranked or ranked[0][1] > .18 or (len(ranked)>1 and ranked[1][1]-ranked[0][1] < .025):
            continue
        prefix = ranked[0][0]
        word = prefix+item['codeText'][1:]
        variants = [v['decoded'] for v in item['code'].get('variants',[]) if v['score'] > .3]
        valid_votes = [(w,n) for w,n in item['gridVerification']['votes'].items() if w in allowed and w.startswith(prefix)]
        if word in allowed and word in variants:
            chosen = word
        elif item['codeText'] not in allowed and valid_votes:
            chosen, count = max(valid_votes,key=lambda pair: pair[1])
            if count < 2:
                continue
        else:
            continue
        item['codeText'] = chosen
        item['gridVerification']['fontCandidate'] = {'text': chosen, 'letterError': ranked[0][1],
                                                    'reason': '同图重复文字建立的字形证据，仍需核对'}



def cell_rectangle_axes(edges):
    """Recover both pitches from repeated cell interiors when line peaks alias."""
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    boxes = [cv2.boundingRect(c) for c in contours if cv2.contourArea(c) > 60]
    boxes = [b for b in boxes if min(b[2:]) >= 8 and .3 < b[2]/b[3] < 3
             and max(b[2:]) < min(edges.shape)/4]
    if len(boxes) < 20:
        return None
    common = Counter((b[2], b[3]) for b in boxes).most_common(1)[0][0]
    boxes = [b for b in boxes if max(abs(b[2]-common[0]), abs(b[3]-common[1])) <= 2]
    axes = []
    for axis in (0, 1):
        values = np.sort([b[axis]+b[axis+2]/2 for b in boxes])
        groups = np.split(values, np.flatnonzero(np.diff(values) > 3)+1)
        centers = np.array([np.mean(g) for g in groups if len(g) >= 2])
        differences = np.diff(centers)
        adjacent = differences[(differences > common[axis]*.8) & (differences < common[axis]*1.3)]
        if len(adjacent) < 4:
            return None
        rough_step = float(np.mean(adjacent))
        indices = np.r_[0, np.cumsum(np.rint(differences/rough_step))]
        step, phase = np.polyfit(indices, centers, 1)
        if np.max(abs(centers-(phase+indices*step))) > max(2, step*.07):
            return None
        start, end = float(phase-step/2), float(phase+(indices.max()+.5)*step)
        length = edges.shape[1-axis]
        # An edge cell has no closed contour when the outer line is cropped.
        # Include that geometric candidate, while still reporting partial coverage.
        if abs(length-end-step) < max(2, step*.07):
            end += step
        axes.append({'start': start, 'end': end, 'step': float(step)})
    return axes


def find_grid_axes(preview, axis_reader):
    edges = cv2.Canny(preview[:, :, 0], 5, 15)
    for channel in (1, 2):
        np.maximum(edges, cv2.Canny(preview[:, :, channel], 5, 15), out=edges)
    axes = None
    # Short segments preserve pale/broken rules; both axes must agree on cell size.
    for length in (20, 40, 80):
        candidate = [axis_reader(edges, axis, length) for axis in (0, 1)]
        if all(a is not None for a in candidate) and abs(math.log(candidate[0]['step']/candidate[1]['step'])) < .05:
            axes = candidate
            break
    if axes is None:
        axes = cell_rectangle_axes(edges)
    if axes is not None and np.prod([(a['end']-a['start'])/a['step'] for a in axes]) > 16000:
        # Strong lines can miss pale margins in dense charts. Extend only along
        # the established pitch, supported by at least three weaker rule peaks.
        for axis, a in enumerate(axes):
            kernel = (1, 20) if axis == 0 else (20, 1)
            rules = cv2.morphologyEx(edges, cv2.MORPH_OPEN,
                                     cv2.getStructuringElement(cv2.MORPH_RECT, kernel))
            power = (rules > 0).sum(axis=axis)
            ids = np.flatnonzero(power > power.max()*.03)
            groups = np.split(ids, np.flatnonzero(np.diff(ids) > 3)+1)
            peaks = np.array([np.average(g, weights=power[g]) for g in groups if len(g)])
            indices = np.rint((peaks-a['start'])/a['step'])
            matched = abs(peaks-a['start']-indices*a['step']) < max(.7, a['step']*.06)
            extension = indices[matched & (peaks < a['start']-a['step']/2)]
            if len(extension) >= 3:
                start = a['start']+float(extension.min())*a['step']
                # Isolated header rules can share the grid phase. Require crossing
                # rules throughout the proposed strip before including any of it.
                crossing = cv2.morphologyEx(edges, cv2.MORPH_OPEN,
                                            cv2.getStructuringElement(cv2.MORPH_RECT, kernel[::-1]))
                support = (crossing > 0).sum(axis=axis)
                centers = np.arange(start+a['step']/2, a['start'], a['step']).astype('int')
                if len(centers) and np.all(support[centers] >= 6):
                    a['start'] = start
    return axes


def count_grid(image, preview, model, axes, allowed, blank_check, legend_regions, progress=None):
    """Read each visible cell; geometry supplies positions, never colour codes.

    Completeness remains unproved for cropped frames, even if readable cells agree.
    """
    if axes is None:
        return None
    x, y = axes
    cols, rows = [round((a['end']-a['start'])/a['step']) for a in axes]
    # ponytail: geometry beyond 40k cells remains unsupported; do not infer extra
    # cells from a title or enlarge this boundary without device measurements.
    if min(cols, rows) < 5 or rows*cols > 40000:
        return None
    sx, sy = image.width/preview.shape[1], image.height/preview.shape[0]
    # Rectangle detectors can mistake joined grid cells for a legend. Only ignore
    # those contained by the detected grid; an unreadable outside legend still blocks.
    for rx, ry, rw, rh in legend_regions:
        if (rx < x['start']*sx-3 or ry < y['start']*sy-3
                or rx+rw > x['end']*sx+3 or ry+rh > y['end']*sy+3):
            return None
    region = [max(0, round(x['start']*sx)), max(0, round(y['start']*sy)),
              min(image.width, round(x['end']*sx))-max(0, round(x['start']*sx)),
              min(image.height, round(y['end']*sy))-max(0, round(y['start']*sy))]
    # Each block owns whole rows. Cell crops use original coordinates and overlap
    # the row boundary; the overlap supplies pixels, never a second counted cell.
    block_rows = max(1, min(8, 256//cols))
    blocks = []
    for start in range(0, rows, block_rows):
        end = min(rows, start+block_rows)
        top = max(0, round((y['start']+start*y['step'])*sy))
        bottom = min(image.height, round((y['start']+end*y['step'])*sy))
        margin = math.ceil(y['step']*sy*.54)
        blocks.append({'id': f'rows-{start+1}-{end}', 'startRow': start+1, 'endRow': end,
                       'status': 'pending', 'region': [region[0], top, region[2], bottom-top],
                       'readRegion': [region[0], max(0, top-margin), region[2],
                                      min(image.height, bottom+margin)-max(0, top-margin)]})
    completed = {}
    def snapshot():
        counts, blanks, unknown, cells = Counter(), 0, 0, []
        # Replacement by block identity makes repeated delivery/retry idempotent.
        for block_counts, block_blanks, block_unknown, block_cells in completed.values():
            counts.update(block_counts)
            blanks += block_blanks
            unknown += block_unknown
            cells.extend(block_cells)
        unread = sum((b['endRow']-b['startRow']+1)*cols for b in blocks if b['status'] != 'read')
        return {'complete': False, 'rows': rows, 'columns': cols, 'counts': dict(counts),
                'blankCells': blanks, 'unknownCells': unknown, 'unreadCells': unread,
                'cells': cells, 'blocks': [dict(b) for b in blocks], 'region': region,
                'reason': '逐格候选已读取；外围是否截断尚未证明，未读清格不计为零'}
    readings = {}
    def clipped(field):
        fx, fy, fw, fh = field['region']
        return any(cx <= fx or cy <= fy or cx+cw >= fx+fw or cy+ch >= fy+fh
                   for cx, cy, cw, ch in (c['region'] for c in field['characters']))

    def read_cell(row, col):
        xx, yy = x['start']+(col+.5)*x['step'], y['start']+(row+.5)*y['step']
        region = [(xx-x['step']*.44)*sx, (yy-y['step']*.36)*sy, x['step']*.88*sx, y['step']*.72*sy]
        pixels, transparent = crop_rgb(image, region)
        if not pixels.size:
            return {'row': row+1, 'column': col+1, 'region': region,
                    'rawText': '未取得格内像素', 'code': None, 'characters': []}
        if not transparent and blank_check(pixels):
            return None
        expanded = [(xx-x['step']*.54)*sx, (yy-y['step']*.46)*sy,
                    x['step']*1.08*sx, y['step']*.92*sy]
        wide, wide_transparent = crop_rgb(image, expanded)
        # Exact original pixels, both crop sizes and relative rounding must match.
        rounded, outer = list(map(round, region)), list(map(round, expanded))
        key = (pixels.shape, transparent, pixels.tobytes(), wide.shape, wide_transparent,
               wide.tobytes(), rounded[0]-outer[0], rounded[1]-outer[1])
        cached = readings.get(key)
        if cached is not None:
            code, previous = cached
            dx, dy = rounded[0]-previous['cellOrigin'][0], rounded[1]-previous['cellOrigin'][1]
            def shifted(box):
                return [box[0]+dx, box[1]+dy, *box[2:]]
            field = {**previous, 'region': shifted(previous['region']),
                     'characters': [{**c, 'region': shifted(c['region'])} for c in previous['characters']]}
            if previous.get('interpretation'):
                field['interpretation'] = {**previous['interpretation'], 'changes':
                    [{**c, 'region': shifted(c['region'])} for c in previous['interpretation']['changes']]}
        else:
            background = np.median(pixels.reshape(-1, 3), axis=0)
            field = read_field(image, region, model, background, kind='code')
            if clipped(field):
                # The small overlap includes rules, not adjacent centred text.
                region = expanded
                field = read_field(image, region, model, background, kind='code')
            text = decode_field(field, 'code')
            match = re.fullmatch(r'([A-Z]+)([0-9]+)', text or '')
            code = match[1]+str(int(match[2])) if match else None
            if code not in allowed or field.get('interpretation', {}).get('score', 0) <= .6:
                first = field['characters'][0] if field['characters'] else None
                stable_prefix = first['char'] if first and first['char'].isalpha() and first['score'] > .9 else None
                retry = read_field(image, region, model, background, kind='code', split_candidates=True)
                text = decode_field(retry, 'code')
                match = re.fullmatch(r'([A-Z]+)([0-9]+)', text or '')
                alternative = match[1]+str(int(match[2])) if match else None
                if (alternative in allowed and retry.get('interpretation', {}).get('score', 0) > .6
                        and not clipped(retry) and (stable_prefix is None or alternative.startswith(stable_prefix))):
                    # Recutting merged digits must not overwrite a clear
                    # prefix merely because the new word enters the catalog.
                    code, field = alternative, retry
            if code not in allowed or field.get('interpretation', {}).get('score', 0) <= .6 or clipped(field):
                code = None
            if len(key[2])+len(key[5]) <= 8192:
                if len(readings) >= 512:
                    readings.pop(next(iter(readings)))
                readings[key] = (code, {**field, 'cellOrigin': rounded[:2]})
        if code:
            bounds = [c['region'] for c in field['characters']]
            tx = (min(b[0] for b in bounds)+max(b[0]+b[2] for b in bounds))/2
            ty = (min(b[1] for b in bounds)+max(b[1]+b[3] for b in bounds))/2
            # This reader samples centred cell labels. A watermark fragment
            # at a corner is uncertain even when it resembles a valid code.
            if abs(tx-xx*sx) > x['step']*sx*.2 or abs(ty-yy*sy) > y['step']*sy*.2:
                code = None
        return {'row': row+1, 'column': col+1, 'region': field['region'],
                      'rawText': field['rawText'], 'code': code,
                      'characters': field['characters'] if code is None or rows*cols <= 16000 else [],
                      'interpretation': field.get('interpretation')}

    for block in blocks:
        counts, blanks, unknown, cells = Counter(), 0, 0, []
        try:
            for row in range(block['startRow']-1, block['endRow']):
                for col in range(cols):
                    cell = read_cell(row, col)
                    if cell is None:
                        blanks += 1
                    else:
                        cells.append(cell)
                        if cell['code']:
                            counts[cell['code']] += 1
                        else:
                            unknown += 1
            completed[block['id']] = (counts, blanks, unknown, cells)
            block['status'] = 'read'
        except (OSError, ValueError, cv2.error) as error:
            block.update(status='failed', reason=str(error))
        if progress is not None:
            progress(snapshot())
    result = snapshot()
    counts = result['counts']
    # A palette chart also has a grid. Require repeated production labels before
    # returning counts; do not turn a sheet of one example per colour into a design.
    if not counts or max(counts.values()) < 4 or sum(counts.values()) < len(counts)*2:
        if result['unreadCells']:
            return {**result, 'counts': {}, 'cells': [], 'blankCells': 0, 'unknownCells': None,
                    'reason': '处理未完成，尚无足够制作格证据；未覆盖区域数量未知'}
        return None
    return result

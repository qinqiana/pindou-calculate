"""Locate and pair printed legend fields without a supplied crop or palette colours."""
import math
import re

import cv2
import numpy as np


def legend_start(rgb):
    h, w = rgb.shape[:2]
    edges = cv2.Canny(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY), 5, 15)
    vertical = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((7, 1), 'uint8'))
    vertical = cv2.morphologyEx(vertical, cv2.MORPH_OPEN, np.ones((max(30, h//6), 1), 'uint8'))
    _, _, stats, _ = cv2.connectedComponentsWithStats(vertical)
    bars = [b for b in stats[1:] if b[3] > h*.3 and b[2] < w*.02]
    candidates = []
    for b in bars:
        end = b[1]+b[3]
        group = [o for o in bars if abs(o[1]+o[3]-end) <= 7]
        span = max(o[0]+o[2] for o in group)-min(o[0] for o in group)
        if len(group) >= 5 and span > w*.5:
            candidates.append((len(group)*span, int(np.median([o[1]+o[3] for o in group]))))
    if candidates:
        return max(0, max(candidates, key=lambda c: c[1])[1]-round(w*.025))
    # Thin, regular grids can have broken edge pixels but continuous printed lines.
    dark = (rgb.min(axis=2) < 220).astype('uint8')
    hor = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, np.ones((1, 5), 'uint8'))
    hor = cv2.morphologyEx(hor, cv2.MORPH_OPEN, np.ones((1, max(30, w//4)), 'uint8'))
    ver = cv2.morphologyEx(dark, cv2.MORPH_OPEN, np.ones((max(30, h//10), 1), 'uint8'))
    contours, _ = cv2.findContours(cv2.dilate(hor | ver, np.ones((3, 3), 'uint8')),
                                  cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = [cv2.boundingRect(c) for c in contours]
    boxes = [b for b in boxes if b[2] > w*.5 and b[3] > h*.3 and b[1]+b[3] < h]
    return max(0, max(boxes, key=lambda b: b[2]*b[3])[1] + max(boxes, key=lambda b: b[2]*b[3])[3]-round(w*.025)) if boxes else None


def swatch_rows(rgb, dark_limit=100):
    border = np.concatenate([rgb[-2:].reshape(-1, 3), rgb[:, -2:].reshape(-1, 3)])
    background = np.median(border, axis=0).astype('float32')
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    if background.max()-background.min() > 30:
        mask = (abs(rgb.astype('float32')-background).max(axis=2) > 30).astype('uint8')
    else:
        mask = (((hsv[:, :, 1] > 30) & (hsv[:, :, 2] > 40)) | (hsv[:, :, 2] < dark_limit)).astype('uint8')
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), 'uint8'))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if w > rgb.shape[1]*.012 and h >= 8 and .65 < w/h < 15 and cv2.contourArea(contour) > w*h*.65:
            boxes.append([x, y, w, h])
    rows = []
    for box in sorted(boxes, key=lambda b: (b[1], b[0])):
        row = next((r for r in rows if abs(r[0][1]-box[1]) < max(6, box[3]*.2)
                    and .7 < r[0][3]/box[3] < 1.4), None)
        if row is None:
            rows.append([box])
        else:
            row.append(box)
    return [sorted(row) for row in rows]


def lattice(row):
    if len(row) < 2:
        return None
    h = float(np.median([b[3] for b in row]))
    widths = np.array([b[2] for b in row])
    low = float(np.percentile(widths, 25))
    kind = 'inline' if low/h > 3 else 'below' if low/h < 1.2 else 'right'
    # A joined colour patch can be several entries wide; pitch comes from repeated edges.
    use = [b for b in row if b[2] < low*1.5] if kind != 'inline' else [b for b in row if b[2] > low*.75]
    if len(use) < 2:
        return None
    xs = np.array([b[0] for b in use])
    w = float(np.median([b[2] for b in use])) if kind != 'inline' else low
    gaps = np.diff(xs)
    if kind == 'below' and len(gaps) and gaps.min() > w*4:
        kind = 'beside'
    options = [float(g/n) for g in gaps for n in range(1, 5)]
    limits = (4., 12.) if kind == 'beside' else (1., 1.5) if kind in {'inline', 'below'} else (1.8, 4.)
    fits = []
    for step in options:
        if not limits[0]*w < step < limits[1]*w:
            continue
        indices = np.rint((xs-xs[0])/step)
        if len(np.unique(indices)) != len(xs):
            continue
        step, phase = np.polyfit(indices, xs, 1)
        residual = max(abs(xs-(phase+indices*step)))
        if residual <= max(3, step*.05):
            fits.append((residual, -step, float(phase), float(step)))
    if not fits:
        return None
    _, _, phase, step = min(fits)
    return phase, step, w, h, float(np.median([b[1] for b in use]))


def crop_rgb(image, box):
    x, y, w, h = map(round, box)
    x, y = max(0, x), max(0, y)
    w, h = min(w, image.width-x), min(h, image.height-y)
    if w <= 0 or h <= 0:
        return np.empty((0, 0, 3), 'uint8'), False
    with image.crop((x, y, x+w, y+h)) as tile:
        if tile.mode == 'RGB':
            return np.asarray(tile), False
        if 'A' in tile.getbands() or 'transparency' in tile.info:
            from PIL import Image
            # Opaque RGBA is common for exported charts; no compositing buffer is needed.
            if tile.mode == 'RGBA':
                with tile.getchannel('A') as alpha:
                    if alpha.getextrema() == (255, 255):
                        with tile.convert('RGB') as flat:
                            return np.asarray(flat), False
            with tile.convert('RGBA') as rgba, rgba.getchannel('A') as alpha:
                transparent = alpha.getextrema() != (255, 255)
                with Image.new('RGB', tile.size, 'white') as flat:
                    flat.paste(rgba, mask=alpha)
                    return np.asarray(flat), transparent
        with tile.convert('RGB') as flat:
            return np.asarray(flat), False


def make_preview(image, limit=2000):
    """Resize through bounded bands, including alpha compositing, rather than a full RGBA copy."""
    from PIL import Image
    scale = min(1., limit/max(image.size))
    width, height = round(image.width*scale), round(image.height*scale)
    preview = np.empty((height, width, 3), 'uint8')
    for top in range(0, height, 128):
        bottom = min(height, top+128)
        sy, ey = max(0, math.floor(top/scale)-4), min(image.height, math.ceil(bottom/scale)+4)
        rgb, _ = crop_rgb(image, [0, sy, image.width, ey-sy])
        with Image.fromarray(rgb) as tile:
            with tile.resize((width, bottom-top), Image.Resampling.BICUBIC,
                             box=(0, top/scale-sy, image.width, min(ey-sy, bottom/scale-sy))) as small:
                preview[top:bottom] = np.asarray(small)
        del rgb
    return preview


def split_blob(own, model, alphabet=None):
    """Choose a small number of cuts from valleys using generic glyph evidence."""
    height, width = own.shape
    if width <= height*1.15:
        return [(0, 0, width, height, own)]
    power = own.sum(axis=0)
    options = []
    for count in range(2, min(6, math.ceil(width/(height*.3)))+1):
        if width/count < height*.2 or width/count > height*1.1:
            continue
        cuts = [0]
        for k in range(1, count):
            center = round(width*k/count)
            lo, hi = max(cuts[-1]+2, center-round(height*.28)), min(width-2, center+round(height*.28))
            if lo >= hi:
                break
            cut = lo+int(np.argmin(power[lo:hi]))
            cuts.append(cut)
        if len(cuts) != count:
            continue
        cuts.append(width)
        parts = []
        for left, right in zip(cuts, cuts[1:]):
            part = own[:, left:right]
            yy, xx = np.nonzero(part)
            if len(xx):
                parts.append((left+xx.min(), yy.min(), xx.max()-xx.min()+1, yy.max()-yy.min()+1,
                              part[yy.min():yy.max()+1, xx.min():xx.max()+1]))
        if len(parts) == count:
            options.append((parts, sum(power[c] for c in cuts[1:-1])/height))
    # A single valley can lie inside a zero. Compare nearby two-character cuts
    # using both glyphs, rather than committing to the lowest ink column.
    for cut in range(max(2, round(width*.3)), min(width-2, round(width*.7))+1) if alphabet else ():
        parts = []
        for left, right in ((0, cut), (cut, width)):
            part = own[:, left:right]
            yy, xx = np.nonzero(part)
            if len(xx):
                parts.append((left+xx.min(), yy.min(), xx.max()-xx.min()+1, yy.max()-yy.min()+1,
                              part[yy.min():yy.max()+1, xx.min():xx.max()+1]))
        if len(parts) == 2:
            options.append((parts, float(power[cut])/height))
    if not options:
        return [(0, 0, width, height, own)]
    predictions = model.predict([p[4] for parts, _ in options for p in parts])
    at, ranked = 0, []
    for parts, cut_ink in options:
        scores = predictions[at:at+len(parts)]
        at += len(parts)
        evidence = sum(math.log(max(.001, next((c['score'] for c in p if alphabet is None or c['char'] in alphabet), 0))) for p in scores)/len(parts)-cut_ink*.15
        ranked.append((evidence, parts))
    return max(ranked, key=lambda pair: pair[0])[1]


def read_field(image, box, model, background=None, kind=None, split_candidates=False):
    x, y, w, h = map(round, box)
    rgb, transparent = crop_rgb(image, box)
    empty = {'rawText': '', 'characters': [], 'score': 0, 'region': [x, y, w, h], 'visible': False}
    if not rgb.size:
        return empty
    if background is None:
        background = np.median(rgb.reshape(-1, 3), axis=0).astype('float32')
    diff = abs(rgb.astype('float32')-background).max(axis=2)
    scale = 3 if h < 45 else 1
    if scale != 1:
        diff = cv2.resize(diff, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    variants = []
    contrast = float(np.percentile(diff, 98))
    for threshold in tuple(max(20, contrast*f) for f in (.3, .4, .5, .6, .7, .8)):

        mask = (diff > threshold).astype('uint8')
        _, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
        components = []
        punctuation = []
        letter_stats = [s for s in stats[1:] if s[3] >= h*scale*.22 and s[2] < s[3]*2]
        typical_height = float(np.median([s[3] for s in letter_stats])) if letter_stats else 0
        for label, (a, b, cw, ch, area) in enumerate(stats[1:], 1):
            if typical_height and ch < typical_height*.45 and area >= max(2*scale,scale**2):
                if float(diff[b:b+ch,a:a+cw].max()) > contrast*.8:
                    if cw > ch*1.8 and cw >= typical_height*.25:
                        punctuation.append(('-',a,b,cw,ch))
                    elif .4 < cw/max(1,ch) < 2 and ch < typical_height*.4:
                        punctuation.append(('.',a,b,cw,ch))
            if area < 2*scale or ch < h*scale*.12:
                continue
            if cw <= 2*scale and ch > h*scale*.78:
                continue
            if cw > ch*6:
                continue
            own = (labels[b:b+ch, a:a+cw] == label).astype('uint8')
            for dx, dy, pw, ph, part in split_blob(own, model,
                    ('0123456789' if kind == 'number' else 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' if kind == 'code' else None)
                    if split_candidates else None):
                components.append((a+dx, b+dy, pw, ph, part))
        # Rejoin disconnected pieces whose horizontal spans overlap (e.g. a broken 3).
        components.sort(key=lambda c: c[0])
        merged = []
        for component in components:
            a, b, cw, ch, own = component
            broken_prefix = (kind == 'code' and len(merged) == 1 and merged[0][3] < ch*.75
                             and 0 <= a-merged[0][0]-merged[0][2] <= scale
                             and a+cw-merged[0][0] <= ch*1.05 and abs(b-merged[0][1]) < ch*.2)
            if merged and (broken_prefix or min(merged[-1][0]+merged[-1][2], a+cw)-max(merged[-1][0], a) > min(merged[-1][2], cw)*.4):
                p, q, pw, ph, previous = merged.pop()
                x0, y0, x1, y1 = min(p,a), min(q,b), max(p+pw,a+cw), max(q+ph,b+ch)
                joined = np.zeros((y1-y0, x1-x0), 'uint8')
                joined[q-y0:q-y0+ph, p-x0:p-x0+pw] |= previous
                joined[b-y0:b-y0+ch, a-x0:a-x0+cw] |= own
                merged.append((x0,y0,x1-x0,y1-y0,joined))
            else:
                merged.append(component)
        if merged:
            typical = float(np.percentile([c[3] for c in merged], 75))
            main = [c for c in merged if c[3] >= typical*.6]
            top = float(np.median([c[1] for c in main]))
            bottom = float(np.median([c[1]+c[3] for c in main]))
            merged = [c for c in merged if c[3] >= typical*.6 or (c[1] < bottom and c[1]+c[3] > top)]
        components = merged
        if not components or len(components) > 20:
            continue
        components.sort(key=lambda c: c[0])
        # At <=8 source pixels the pixel-font model has the relevant stroke
        # evidence; averaging in the ordinary reader can erase a narrow 0/9.
        tiny_number = bool(kind == 'number' and hasattr(model, 'pixel') and max(c[3] for c in components) <= 8*scale)
        results = (model.pixel if tiny_number else model).predict([c[4] for c in components])
        characters = [{'char': r[0]['char'], 'score': r[0]['score'], 'alternatives': r[1:],
                       'region': [x+round(a/scale), y+round(b/scale), max(1, round(cw/scale)), max(1, round(ch/scale))]}
                      for r, (a, b, cw, ch, _) in zip(results, components)]
        numeric_symbols = []
        numeric_chars = characters if kind == 'number' else []
        if kind == 'inline':
            left = next((i for i,c in enumerate(characters) if c['char'] == '('),None)
            right = next((i for i,c in enumerate(characters) if c['char'] == ')' and left is not None and i > left),None)
            if left is not None and right is not None:
                numeric_chars = characters[left+1:right]
        if numeric_chars:
            top = np.median([c['region'][1]-y for c in numeric_chars])*scale
            bottom = np.median([c['region'][1]+c['region'][3]-y for c in numeric_chars])*scale
            first = min(c['region'][0]-x for c in numeric_chars)*scale
            last = max(c['region'][0]+c['region'][2]-x for c in numeric_chars)*scale
            for symbol,a,b,cw,ch in punctuation:
                # A detached foot/arm inside a digit is not a separate decimal or minus.
                if any(c['region'][3]*scale >= typical_height*.6 and
                       min(a+cw,(c['region'][0]+c['region'][2]-x)*scale)-max(a,(c['region'][0]-x)*scale) > cw*.3
                       for c in numeric_chars):
                    continue
                mid = b+ch/2
                if symbol == '-' and first-typical_height <= a < last and top+typical_height*.25 < mid < bottom-typical_height*.15:
                    numeric_symbols.append({'symbol':symbol,'region':[x+round(a/scale),y+round(b/scale),round(cw/scale),round(ch/scale)]})
                if symbol == '.' and first < a < last and bottom-typical_height*.3 < mid < bottom+typical_height*.15:
                    numeric_symbols.append({'symbol':symbol,'region':[x+round(a/scale),y+round(b/scale),round(cw/scale),round(ch/scale)]})
        occupied = np.zeros(mask.shape, 'uint8')
        for a, b, cw, ch, _ in components:
            occupied[max(0,b-scale):b+ch+scale, max(0,a-scale):a+cw+scale] = 1
        low = diff > max(20, contrast*.3)
        coverage = float(np.count_nonzero(occupied & low)/max(1,np.count_nonzero(low)))
        variants.append({'tinyNumber': tiny_number, 'invalidNumericSymbols': numeric_symbols, 'inkCoverage': coverage, 'rawText': ''.join(c['char'] for c in characters), 'characters': characters,
                         'score': min(c['score'] for c in characters), 'region': [x, y, w, h],
                         'visible': True, 'transparent': transparent,
                         'threshold': threshold})
    if not variants:
        return {**empty, 'visible': bool((diff > 65).any())}
    for variant in variants:
        kept = []
        for symbol in variant['invalidNumericSymbols']:
            px,py,pw,ph = symbol['region']
            covered = sum(any(c['char'].isdigit() and c['score'] > .8 and c['region'][3] >= ph*2 and
                              c['region'][0] <= px+pw/2 <= c['region'][0]+c['region'][2] and
                              c['region'][1] <= py+ph/2 <= c['region'][1]+c['region'][3]
                              for c in other['characters']) for other in variants)
            if covered < 2:
                kept.append(symbol)
        variant['invalidNumericSymbols'] = kept
    if sum(bool(v['invalidNumericSymbols']) for v in variants) >= 2:
        symbols = next(v['invalidNumericSymbols'] for v in variants if v['invalidNumericSymbols'])
        for v in variants:
            v['invalidNumericSymbols'] = symbols
    else:
        for v in variants:
            v['invalidNumericSymbols'] = []
    # Grammar describes field positions only; never choose by palette membership.
    for variant in variants:
        variant['decoded'] = decode_field(variant, kind) if kind else None
    def evidence(v):
        score = v.get('interpretation', {}).get('score', v['score']*.25) if kind else math.exp(sum(math.log(max(.001, c['score'])) for c in v['characters'])/len(v['characters']))
        consensus = sum(o.get('interpretation', {}).get('score', 0)
                        for o in variants if o['decoded'] == v['decoded']) if v['decoded'] and not v['tinyNumber'] else 0
        return (v['inkCoverage']**.15)*score*(1+consensus*.1)
    best = max(variants, key=evidence)
    best['variants'] = [{'rawText': v['rawText'], 'decoded': v['decoded'], 'score': v.get('interpretation', {}).get('score', 0)} for v in variants]
    return best


def decode_field(field, kind):
    chars = field['characters']
    if not chars or field.get('invalidNumericSymbols'):
        return None
    patterns = []
    if kind == 'number':
        patterns = ['0123456789'] * len(chars),
    elif kind == 'code':
        for prefix in (1,):
            patterns.append(['ABCDEFGHIJKLMNOPQRSTUVWXYZ']*prefix + ['0123456789']*(len(chars)-prefix))
    else:
        raw = field['rawText']
        left, right = raw.find('('), raw.rfind(')')
        if left < 2 or right != len(chars)-1 or right <= left+1:
            return None
        for prefix in (1,):
            patterns.append(['ABCDEFGHIJKLMNOPQRSTUVWXYZ']*prefix + ['0123456789']*(left-prefix)
                            + ['('] + ['0123456789']*(right-left-1) + [')'])
    options = []
    for pattern in patterns:
        text, score, changes = '', 0, []
        for c, alphabet in zip(chars, pattern):
            candidates = [{'char': c['char'], 'score': c['score']}, *c['alternatives']]
            chosen = next((a for a in candidates if a['char'] in alphabet and a['score'] >= .05), None)
            if chosen is None:
                break
            text += chosen['char']
            score += math.log(chosen['score'])
            if chosen['char'] != c['char']:
                changes.append({'region': c['region'], 'raw': c['char'], 'candidate': chosen['char'],
                                'reason': '字段语法候选，仍需核对'})
        else:
            options.append((score, text, changes))
    if not options:
        return None
    score, text, changes = max(options)
    field['interpretation'] = {'text': text, 'changes': changes, 'score': math.exp(score/len(chars))}
    return text


def local_contrast_field(image, field, model, kind):
    """Recover faint strokes under broad overlays, keeping original-image evidence."""
    if field.get('invalidNumericSymbols') or field.get('interpretation', {}).get('score', 0) * field.get('inkCoverage', 0) >= .8:
        return field
    from PIL import Image
    pixels, _ = crop_rgb(image, field['region'])
    if not pixels.size:
        return field
    gray = cv2.cvtColor(pixels, cv2.COLOR_RGB2GRAY)
    h, w = gray.shape
    variants = []
    sizes = sorted({max(3, round(h*f)//2*2+1) for f in (.25, .35, .5)})
    if kind == 'code':
        sizes = sizes[:1]  # A wider opening joins watermark strokes into new letters.
    for size in sizes:
        if kind == 'number':
            masks = [cv2.adaptiveThreshold(gray, 255, method, cv2.THRESH_BINARY, size, 15)
                     for method in (cv2.ADAPTIVE_THRESH_MEAN_C, cv2.ADAPTIVE_THRESH_GAUSSIAN_C)]
        else:
            masks = [255-cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, np.ones((size,size), 'uint8'))]
        for mask in masks:
            with Image.fromarray(mask).convert('RGB') as tile:
                candidate = read_field(tile, [0,0,w,h], model, kind=kind)
            text = decode_field(candidate, kind)
            score = candidate.get('interpretation', {}).get('score', 0)
            if text and score > .8:
                variants.append((text, score, candidate))
    if not variants and kind == 'code' and field.get('interpretation', {}).get('score', 0) < .8:
        # A watermark can introduce a third brightness level. Absolute contrast
        # then joins dark background fragments to light lettering. Read each
        # ink polarity separately, without choosing by palette membership.
        middle = float(np.median(gray))
        for edge in (float(gray.min()), float(gray.max())):
            for fraction in (.3, .4, .5, .6, .7, .8):
                threshold = middle+(edge-middle)*fraction
                ink = gray < threshold if edge < middle else gray > threshold
                with Image.fromarray(255-ink.astype('uint8')*255).convert('RGB') as tile:
                    candidate = read_field(tile, [0,0,w,h], model, background=np.full(3,255), kind=kind)
                text = decode_field(candidate, kind)
                score = candidate.get('interpretation', {}).get('score', 0)
                if text and score > .8:
                    variants.append((text, score, candidate))
        variants = [v for v in variants if sum(word == v[0] for word, _, _ in variants) >= 2]
    if not variants:
        return field
    votes = {text: sum(score for word, score, _ in variants if word == text) for text, _, _ in variants}
    text = max(votes, key=votes.get)
    # Quantities and replacements of a strong original reading require
    # agreement across local windows; one transformed fragment is insufficient.
    if (kind == 'number' or field.get('interpretation', {}).get('score', 0) >= .8) and sum(word == text for word, _, _ in variants) < 2:
        return field
    candidate = max((v for word, _, v in variants if word == text),
                    key=lambda v: v['interpretation']['score'])
    dx, dy = field['region'][:2]
    for character in [*candidate['characters'], *candidate['interpretation']['changes']]:
        box = character['region']
        character['region'] = [box[0]+dx, box[1]+dy, *box[2:]]
    return {**candidate, 'region': field['region'], 'originalReading': field['rawText'],
            'preprocessing': '局部对比增强；保留原图位置，仍需核对'}


def refine_same_font(image, items):
    """Check weak inline fields against repeated, clear glyphs in this legend."""
    from glyph_model import normalize
    inline = [item for item in items if item['layout'] == 'inline'
              and item['swatchColor'] is not None
              and not item['code'].get('invalidNumericSymbols')]
    pending = [item for item in inline if item['quantityText'] is not None
               and min((c['score'] for c in item['code']['characters']), default=1) < .7]
    if not pending:
        return
    def shapes(character, background):
        pixels, _ = crop_rgb(image, character['region'])
        diff = abs(pixels.astype('float32')-np.array(background,'float32')).max(axis=2)
        lo, hi = np.percentile(diff, [10,90])
        diff = np.clip((diff-lo)/max(hi-lo,1),0,1)
        return np.array([normalize((diff>t).astype('float32')) for t in (.2,.35,.5,.65,.8)])
    anchors = []
    for item in inline:
        if item in pending:
            continue
        field = item['code']
        if sum(v['decoded']==field.get('decoded') and v['score']>.8 for v in field.get('variants',[])) < 2:
            continue
        for c in field['characters']:
            if c['score'] > .94:
                anchors.append((c['char'], shapes(c,item['swatchColor']), c['region']))
    for item in pending:
        chars=item['code']['characters']; raw=item['code'].get('decoded')
        if not raw or len(raw)!=len(chars):
            continue
        left,right=raw.find('('),raw.rfind(')')
        if left<2 or right!=len(raw)-1:
            continue
        corrected=list(raw);changes=[]
        for index,c in enumerate(chars):
            alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ' if index==0 else '0123456789'
            if c['char'] in '()':
                continue
            own=shapes(c,item['swatchColor']);by_char={}
            for letter,shape,region in anchors:
                if letter not in alphabet or not .75<c['region'][3]/max(1,region[3])<1.34:
                    continue
                error=float(abs(own[:,None]-shape[None,:]).mean(axis=(2,3)).min())
                by_char.setdefault(letter,[]).append((error,region))
            ranked=sorted((float(np.mean([v[0] for v in sorted(values)[:3]])),letter)
                          for letter,values in by_char.items() if len(values)>=3)
            if len(ranked)<2 or ranked[0][0]>.16 or ranked[1][0]-ranked[0][0]<.025:
                continue
            error,letter=ranked[0]
            if letter != raw[index]:
                corrected[index]=letter
                changes.append({'index':index,'raw':raw[index],'candidate':letter,'error':error,
                                'runnerUpError':ranked[1][0],'region':c['region'],
                                'examples':[v[1] for v in sorted(by_char[letter])[:3]]})
        text=''.join(corrected);match=re.fullmatch(r'([A-Z][0-9]+)\(([0-9]+)\)',text)
        if changes and match:
            item['codeText'],item['quantityText']=match.groups()
            item['sameFontVerification']={'originalReading':raw,'reading':text,'changes':changes}


def beside_fields(image, box, model):
    """Pair separate code/quantity words beside an unlabelled colour swatch."""
    x, y, w, h = box
    pixels, _ = crop_rgb(image, box)
    if not pixels.size:
        return None
    background = np.median(pixels.reshape(-1, 3), axis=0)
    ink = abs(pixels.astype('float32')-background).max(axis=2) > 40
    margin = max(1, round(h*.08))
    ink[:margin] = ink[-margin:] = False
    columns = np.flatnonzero(ink.any(axis=0))
    if not len(columns):
        return None
    words = np.split(columns, np.flatnonzero(np.diff(columns) > max(3, h*.28))+1)
    if len(words) not in (2, 3) or words[1][0]-words[0][-1] < h*.5:
        return [read_field(image, box, model, background), None]
    fields = [read_field(image, [x+int(g[0])-2, y+margin, int(g[-1]-g[0])+5, h-2*margin],
                         model, background, kind=kind)
              for g, kind in zip(words, ('code', 'number', None))]
    if len(fields) == 3:
        # Retain the separate unit as evidence; an extra number is ambiguity,
        # never a suffix that may be dropped from the quantity.
        unit = fields[2]
        if decode_field(unit, 'number') is not None and unit['interpretation']['score'] > .6:
            fields[1]['invalidNumericSymbols'] = [{'symbol': 'extra-number', 'region': unit['region']}]
    return fields


def recognize_layout(image, preview, model, axes=None):
    start = legend_start(preview)
    if start is None or start >= preview.shape[0]:
        return {'items': [], 'region': None, 'reason': '未定位图纸与图例之间的结构边界'}
    strip = preview[start:]
    sx, sy = image.width/preview.shape[1], image.height/preview.shape[0]
    def original(box):
        x, y, w, h = box
        return [round(x*sx), round((y+start)*sy), round(w*sx), round(h*sy)]
    items = []
    tiny_reader = None
    rows = swatch_rows(strip)
    fits = [(row, lattice(row)) for row in rows]
    # With only one dark chip, there is no pitch yet. Closed pale outlines at
    # the same measured size can establish spacing without guessing quantities.
    isolated = [row[0] for row, fit in fits if fit is None and len(row) == 1
                and .8 < row[0][2]/row[0][3] < 1.2]
    if isolated:
        contours, _ = cv2.findContours((strip.min(axis=2) < 245).astype('uint8'),
                                       cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for chip in isolated:
            recovered = [chip]
            for contour in contours:
                b = list(cv2.boundingRect(contour))
                if (cv2.contourArea(contour) >= b[2]*b[3]*.8 and abs(b[1]-chip[1]) < 6
                        and .8 < b[2]/chip[2] < 1.2 and .8 < b[3]/chip[3] < 1.2
                        and not any(abs(b[0]-other[0]) < 6 for other in recovered)):
                    recovered.append(b)
            recovered.sort()
            fit = lattice(recovered)
            if fit is not None and fit[1] > fit[2]*4:
                fits = [(row, f) for row, f in fits if row[0] != chip]
                fits.append((recovered, fit))
    # Pale, unlabelled swatches still occupy columns. Recover their rectangles
    # before fitting pitch, otherwise two visible chips can suggest half a row.
    beside = [f for _, f in fits if f is not None and .8 < f[2]/f[3] < 1.2 and f[1] > f[2]*4]
    if beside:
        pale_rows = swatch_rows(strip, 235)
        # A white chip may have only its thin outline. Opening the colour mask
        # removes that outline, so recover closed rectangles at the measured size.
        contours, _ = cv2.findContours((strip.min(axis=2) < 245).astype('uint8'),
                                       cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            b = list(cv2.boundingRect(contour))
            if (cv2.contourArea(contour) < b[2]*b[3]*.8 or not any(
                    .8 < b[2]/f[2] < 1.2 and .8 < b[3]/f[3] < 1.2 for f in beside)):
                continue
            row = next((r for r in pale_rows if abs(r[0][1]-b[1]) < 6), None)
            if row is None:
                pale_rows.append([b])
            elif not any(abs(o[0]-b[0]) < 6 for o in row):
                row.append(b)
                row.sort()
        for row in pale_rows:
            if not any(all(.8 < b[2]/f[2] < 1.2 and .8 < b[3]/f[3] < 1.2 for b in row) for f in beside):
                continue
            fit = lattice(row)
            if fit is None and len(row) == 1:
                match = next((f for f in beside if .8 < row[0][2]/f[2] < 1.2
                              and abs((row[0][0]-f[0]+f[1]/2)%f[1]-f[1]/2) < 3), None)
                if match:
                    fit = (*match[:4], float(row[0][1]))
            if fit is not None and fit[1] > fit[2]*4:
                fits = [(r, f) for r, f in fits if abs(r[0][1]-row[0][1]) >= 6]
                fits.append((row, fit))
        first = min(f[4] for f in beside)
        separators = np.flatnonzero((strip[:round(first)].min(axis=2) < 245).mean(axis=1) > .8)
        if len(separators) and first-separators[-1] < np.median([f[3] for f in beside])*.6:
            # A full-width separator immediately above the table excludes the
            # grid's last row and coordinate numbers, even if grid axes failed.
            fits = [(r, f) for r, f in fits if r[0][1] > separators[-1]]
    compact = [f for _, f in fits if f is not None and
               (1.2 < f[2]/f[3] <= 3 or .8 < f[2]/f[3] < 1.2 and f[1] > f[2]*4)]
    if compact:
        # A pale final row can have no dark swatches. Reuse a measured legend's
        # dimensions and phase instead of detecting loose text as new entries.
        for row in swatch_rows(strip, 235):
            if any(abs(row[0][1]-r[0][1]) < 6 for r, _ in fits):
                continue
            match = next((f for f in compact if all(.8 < b[2]/f[2] < 1.2 and .8 < b[3]/f[3] < 1.2
                        and abs((b[0]-f[0]+f[1]/2)%f[1]-f[1]/2) < 3 for b in row)), None)
            if match and len(row) >= 2:
                fits.append((row, (*match[:4], float(np.median([b[1] for b in row])))))
    for row, fit in fits:
        if (start > 0 and row[0][1] == 0 and axes is not None
                and start+max(b[3] for b in row) <= axes[1]['end']+3):
            continue  # The search strip cut a row still inside the detected grid.
        if fit is None and len(row) == 1:
            box = row[0]
            match = next((f for r, f in fits if f is not None and .8 < box[2]/f[2] < 1.2
                          and .8 < box[3]/f[3] < 1.2), None)
            if match:
                # A sparse row may be centred or indented independently. Reuse
                # measured field sizes, but anchor at this row's actual swatch.
                fit = (float(box[0]), *match[1:4], float(box[1]))
        if fit is None:
            # No trustworthy column spacing: keep the visible source area
            # instead of dropping the row or pairing by text order.
            if axes is None or start+row[0][1] > axes[1]['end']:
                left, top = min(b[0] for b in row), min(b[1] for b in row)
                right = max(b[0]+b[2] for b in row)
                bottom = min(strip.shape[0], max(b[1]+b[3]*1.6 for b in row))
                region = original([left, top, right-left, bottom-top])
                items.append({'layout': 'unpaired', 'tinyPrint': False, 'swatchColor': None,
                              'codeText': '', 'quantityText': None, 'quantity': None, 'region': region,
                              'code': {'rawText': '', 'score': 0, 'characters': [], 'region': region}})
            continue
        phase, step, w, h, y = fit
        if axes is not None:
            gx, gy = axes
            # A row of production cells is not a legend. Keep the search margin
            # for real first-row legends, but reject square swatches on the grid.
            if (.8 < w/gx['step'] < 1.2 and .8 < h/gy['step'] < 1.2
                    and gy['start']-3 <= y+start and y+start+h <= gy['end']+3
                    and gx['start']-3 <= row[0][0] and row[-1][0]+row[-1][2] <= gx['end']+3):
                continue
        kind = 'beside' if .8 < w/h < 1.2 and step > w*4 else 'below' if .65 < w/h < 1.2 else 'inline' if w/h > 3 else 'right'
        if (axes is not None and axes[1]['end'] >= preview.shape[0]-2
                and (kind != 'right' or y+start+h >= preview.shape[0]-2)):
            continue
        small_print = (kind == 'below' and h*sy < 40) or kind == 'beside'
        if small_print and tiny_reader is None:
            from glyph_model import SmallGlyphModel
            tiny_reader = SmallGlyphModel(model)
        field_reader = tiny_reader if small_print else model
        while phase-step >= 0:
            phase -= step
        for column in range(math.floor((strip.shape[1]-w-phase)/step)+1):
            x = round(phase+column*step)
            if kind == 'beside':
                fields = beside_fields(image, original([x+w+2, y, step-w-5, h]), field_reader)
                if fields is None:
                    continue
                code, number = fields[:2]
                items.append({'layout': kind, 'tinyPrint': False, 'swatchColor': None,
                              'codeText': decode_field(code, 'code') or code['rawText'],
                              'quantityText': decode_field(number, 'number') if number else None,
                              'code': code, 'quantity': number,
                              'unit': fields[2] if len(fields) == 3 else None,
                              'region': original([x, y, step, h])})
                continue
            if kind == 'below':
                code_box, number_box = [x+w*.03, y+h*.20, w*.94, h*.60], [x, y+h+3, w, h*.55]
            elif kind == 'right':
                code_box, number_box = [x+2, y+2, w-4, h-4], [x+w+3, y+2, step-w-8, h-4]
            else:
                code_box, number_box = [x+2, y+2, w-4, h-4], None
            fill, _ = crop_rgb(image, original([x+w*.15, y+h*.10, w*.7, h*.15]))
            background = np.median(fill.reshape(-1, 3), axis=0).astype('float32') if fill.size else None
            code = read_field(image, original(code_box), field_reader, background, 'inline' if kind == 'inline' else 'code')
            number = read_field(image, original(number_box), field_reader, kind='number') if number_box else None
            if kind == 'right':
                code = local_contrast_field(image, code, field_reader, 'code')
                number = local_contrast_field(image, number, field_reader, 'number')
            elif kind == 'inline':
                code = local_contrast_field(image, code, field_reader, 'inline')
            if not code['visible'] and (number is None or not number['visible']):
                continue
            if kind == 'inline':
                decoded = decode_field(code, 'inline')
                match = re.fullmatch(r'([A-Z]+[0-9]+)\(([0-9]+)\)', decoded or '')
                text, quantity = (match[1], match[2]) if match else (code['rawText'], None)
            else:
                text, quantity = decode_field(code, 'code') or code['rawText'], decode_field(number, 'number')
            items.append({'layout': kind, 'tinyPrint': small_print, 'withinSwatchRow': x+w <= max(b[0]+b[2] for b in row)+3,
                          'swatchColor': background.tolist() if background is not None else None, 'codeText': text, 'quantityText': quantity,
                          'code': code, 'quantity': number, 'region': original([x, y, step, h*1.6 if kind == 'below' else h])})
    refine_same_font(image, items)
    return {'items': items, 'region': original([0, 0, strip.shape[1], strip.shape[0]]), 'reason': None}

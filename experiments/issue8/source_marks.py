"""Read explicit Latin palette labels with the existing glyph reader, without brand mapping."""
import re

import cv2
import numpy as np

from layout_legend import read_field


def source_conflicts(image, preview, model, grid_region, evidence):
    # Only inspect text outside known production/legend fields. This is a bounded
    # label reader, not certification of an unmarked image's brand or provenance.
    sx, sy = preview.shape[1]/image.width, preview.shape[0]/image.height
    mask = (preview.min(axis=2) < 120).astype('uint8')
    for box in ([grid_region] if grid_region else []) + [e['region'] for e in evidence]:
        x, y, w, h = box
        mask[max(0, round(y*sy)):round((y+h)*sy), max(0, round(x*sx)):round((x+w)*sx)] = 0
    # Remove long rules, leaving isolated words and palette headings.
    for kernel in [(max(40, mask.shape[1]//5), 1), (1, max(40, mask.shape[0]//5))]:
        mask &= 1-cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones(kernel[::-1], 'uint8'))
    _, _, letters, _ = cv2.connectedComponentsWithStats(mask)
    heights = [h for x, y, w, h, area in letters[1:] if 7 <= h <= 100 and w < h*1.5]
    gap = max(7, round(float(np.median(heights))*.7)) if heights else 7
    joined = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((1, gap), 'uint8'))
    _, _, stats, _ = cv2.connectedComponentsWithStats(joined)
    words = []
    for x, y, w, h, area in sorted(stats[1:], key=lambda b: (b[1], b[0])):
        if not (7 <= h <= 100 and 2 <= w/h <= 18 and mask[y:y+h, x:x+w].sum() < w*h*.8):
            continue
        pad = max(4, round(h*.25))
        box = [max(0, round((x-2)/sx)), max(0, round((y-pad)/sy)),
               round((w+4)/sx), round((h+2*pad)/sy)]
        box[2] = min(box[2], image.width-box[0])
        box[3] = min(box[3], image.height-box[1])
        words.append(box)
    marks = []
    # ponytail: at most 80 external words; unfamiliar/illegible marks remain an
    # explicit support boundary, never a claim of verified MARD provenance.
    for box in words[:80]:
        field = read_field(image, box, model)
        raw = field['rawText']
        text = raw.upper().replace(' ', '').replace('-', '')
        match = re.fullmatch(r'(MARD|PERLER|HAMA|ARTKAL|NABBI)([0-9]{2,4})?', text)
        if match and field['score'] >= .65:
            marks.append({'rawText': raw, 'region': box, 'brand': match[1], 'palette': match[2]})
    # A separated number immediately beside MARD can also identify the palette.
    for mark in marks:
        if mark['brand'] != 'MARD' or mark['palette']:
            continue
        x, y, w, h = mark['region']
        for box in words[:80]:
            a, b, cw, ch = box
            if 0 <= a-x-w <= h*1.5 and abs(b-y) < h*.3 and .6 <= ch/h <= 1.5:
                field = read_field(image, box, model)
                if re.fullmatch(r'[0-9]{2,4}', field['rawText']) and field['score'] >= .8:
                    mark.update(palette=field['rawText'], rawText=mark['rawText']+' '+field['rawText'],
                                region=[x, min(y,b), a+cw-x, max(y+h,b+ch)-min(y,b)])
                    break
    conflicts = [m for m in marks if m['brand'] != 'MARD' or m['palette'] not in (None, '221')]
    multiple = len({m['brand'] for m in marks}) > 1
    return [{**m, 'reason': ('存在多品牌对应标记，不能自动选择色号栏' if multiple else
                            '图中色卡标记与当前 MARD 221 不一致') + '；候选未计入，请按原图核对来源后手工补录，不自动换色'}
            for m in (marks if multiple else conflicts)]

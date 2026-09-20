"""Build tiny generic glyph templates from installed fonts, never from sample images."""
import base64
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONTS = [
    'liberation/LiberationSans-Regular.ttf', 'liberation/LiberationSans-Bold.ttf',
    'dejavu/DejaVuSans.ttf', 'dejavu/DejaVuSans-Bold.ttf',
    'dejavu/DejaVuSansMono.ttf', 'dejavu/DejaVuSansMono-Bold.ttf',
    'liberation/LiberationMono-Regular.ttf', 'liberation/LiberationMono-Bold.ttf',
    'noto/NotoSansMono-Regular.ttf', 'noto/NotoSansMono-Bold.ttf',
    'ubuntu/UbuntuMono[wght].ttf', 'ubuntu/UbuntuSansMono[wght].ttf',
]
CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789()-.'


def feature(mask):
    yy, xx = np.nonzero(mask)
    if not len(xx):
        raise ValueError('Empty glyph')
    mask = mask[yy.min():yy.max()+1, xx.min():xx.max()+1]
    contours, hierarchy = cv2.findContours(mask.astype('uint8'), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    holes = sum(1 for i, c in enumerate(contours)
                if hierarchy[0][i][3] >= 0 and cv2.contourArea(c) > mask.size * .012)
    shape = cv2.resize(mask.astype('float32'), (20, 28), interpolation=cv2.INTER_AREA)
    return shape, mask.shape[1] / mask.shape[0], holes


if __name__ == '__main__':
    templates = []
    for name in FONTS:
        font = ImageFont.truetype(str(Path('/usr/share/fonts/truetype') / name), 64)
        for char in CHARACTERS:
            canvas = Image.new('L', (100, 100))
            ImageDraw.Draw(canvas).text((8, 0), char, font=font, fill=255)
            shape, ratio, holes = feature(np.asarray(canvas) > 127)
            values = np.rint(shape.ravel() * 15).astype('uint8')
            packed = (values[::2] << 4) | values[1::2]
            templates.append([char, round(ratio, 6), holes, base64.b64encode(packed).decode('ascii')])
    target = Path(__file__).with_name('glyphs.json')
    target.write_text(json.dumps({'version': 1, 'shape': [20, 28], 'fonts': FONTS,
                                 'characters': CHARACTERS, 'templates': templates}, separators=(',', ':')) + '\n')
    print(f'{len(templates)} generic glyphs; {target.stat().st_size} bytes; no sample input')

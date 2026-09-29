"""Display-only previews and 1:1 details. No training labels belong to resized previews."""
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).parent / 'samples-large'
summary = json.loads((root / 'verification.json').read_text())
for sample in summary['samples']:
    folder = root / sample['id']
    for name in ['sheet', 'overlay']:
        image = Image.open(folder / (name+'.png')).convert('RGB')
        image.resize((1080, round(image.height*1080/image.width)), Image.Resampling.LANCZOS).save(folder / (name+'-1080.png'))
    cells = json.loads((folder / 'cells.json').read_text())
    target = next(c for c in cells if c['code'] == 'H1')
    x, y, w, h = target['box']
    for name in ['sheet', 'overlay']:
        image = Image.open(folder / (name+'.png')).convert('RGB')
        left, top = max(0, x-5*w), max(0, y-3*h)
        image.crop((left, top, min(image.width,left+16*w), min(image.height,top+10*h))).save(folder / (name+'-detail.png'))
    det = json.loads((folder / 'detection.json').read_text())
    legends = [o['box'] for o in det['objects'] if o['cls'] == 'legend_item']
    if legends:
        bottom = max(y+h for x,y,w,h in legends)
        top = min(y for x,y,w,h in legends)
        for name in ['sheet', 'overlay']:
            image = Image.open(folder / (name+'.png')).convert('RGB')
            image.crop((0, max(0,int(top)-8), min(800,image.width), min(image.height,int(bottom)+8))).save(folder / (name+'-legend.png'))
page = (root / 'index.html').read_text()
page = page.replace('<p>真实度待用户验收；', '<p>下方整页预览缩至 1080 像素宽，仅供密度观察；训练标注对应点击后的原尺寸 PNG。缩图不视为文字可读或识别通过。真实度待用户验收；')
for name in ['sheet', 'overlay']:
    page = page.replace(f'/{name}.png"></a><figcaption>', f'/{name}-1080.png"></a><figcaption>')
for sample in summary['samples']:
    identifier = sample['id']
    marker = f'<a href="{identifier}/answer.json">'
    extra = f'<a href="{identifier}/sheet-detail.png">原尺寸 H1 局部</a><a href="{identifier}/overlay-detail.png">局部框线</a>'
    page = page.replace(marker, extra+marker)
(root / 'index.html').write_text(page)

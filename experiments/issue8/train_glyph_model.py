"""Reproduce font-only training. Requires existing PyTorch only when training, never at inference."""
import argparse
import gzip
from pathlib import Path
import random

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, PcfFontFile
import torch

from generate_glyphs import FONTS, CHARACTERS
from glyph_model import normalize

STAGES = ('base', 'fine', 'pixel', 'stretch')
SIZES = {'base': [8,10,12,16,20,28,40,64], 'other': [6,7,8,9,10,11,12,14,16,20,28,40]}
EXTRA_FONTS = ['noto/NotoSansCJK-Regular.ttc', 'noto/NotoSansCJK-Bold.ttc',
               'urw-base35/NimbusSans-Regular.otf', 'urw-base35/NimbusSans-Bold.otf']


class Net(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = torch.nn.Sequential(
            torch.nn.Conv2d(1,12,3,padding=1), torch.nn.ReLU(), torch.nn.MaxPool2d(2),
            torch.nn.Conv2d(12,24,3,padding=1), torch.nn.ReLU(), torch.nn.MaxPool2d(2),
            torch.nn.Flatten(), torch.nn.Linear(24*7*5,64), torch.nn.ReLU(),
            torch.nn.Linear(64,len(CHARACTERS)))

    def forward(self, x):
        return self.layers(x)


def train(stage, output):
    random.seed(801)
    np.random.seed(801)
    torch.manual_seed(801)
    torch.set_num_threads(2)
    fonts = [Path('/usr/share/fonts/truetype')/name for name in FONTS]
    if stage != 'base':
        fonts += [Path('/usr/share/fonts/opentype')/name for name in EXTRA_FONTS]
    if stage in {'pixel', 'stretch'}:
        pixel_fonts = [Path(__file__).parent/'training-fonts'/name
                       for name in ['Silkscreen-Regular.ttf', 'PressStart2P-Regular.ttf']]
        fonts += pixel_fonts*(4 if stage == 'stretch' else 1)
    base = []
    for path in fonts:
        for size in SIZES['base' if stage == 'base' else 'other']:
            font = ImageFont.truetype(str(path),size)
            for label, char in enumerate(CHARACTERS):
                canvas = Image.new('L',(100,100))
                ImageDraw.Draw(canvas).text((6,2),char,font=font,fill=255)
                a = np.array(canvas,dtype='float32')/255
                yy, xx = np.nonzero(a > .1)
                if len(xx):
                    base.append((a[max(0,yy.min()-2):yy.max()+3,max(0,xx.min()-2):xx.max()+3],label))
    for path in sorted(Path('/usr/share/fonts/X11/misc').glob('*-ISO8859-1.pcf.gz')):
        if path.name[0] not in '56789' and not path.name.startswith('10x'):
            continue
        with gzip.open(path,'rb') as source:
            font = PcfFontFile.PcfFontFile(source)
        for label, char in enumerate(CHARACTERS):
            glyph = font.glyph[ord(char)]
            if glyph is not None:
                base.append((np.pad(np.array(glyph[3],dtype='float32'),2),label))
    repetitions = 16 if stage == 'base' else 12 if stage == 'fine' else 8
    xs, ys = [], []
    for a, label in base:
        for k in range(repetitions):
            scale = random.uniform(.7,2.5)
            fx = scale*random.uniform(.7,1.3) if stage == 'stretch' else scale
            fy = scale*random.uniform(.7,1.3) if stage == 'stretch' else scale
            im = cv2.resize(a.copy(),None,fx=fx,fy=fy,interpolation=random.choice(
                [cv2.INTER_LINEAR,cv2.INTER_CUBIC,cv2.INTER_NEAREST]))
            im = np.clip(im,0,1)
            if k % 4 == 0:
                im = cv2.GaussianBlur(im,(3,3),random.uniform(.3,.8))
            threshold = random.uniform(.25,.7) if stage == 'base' else random.uniform(.2,.8)
            mask = (im > threshold).astype('float32')
            if mask.any():
                xs.append(normalize(mask))
                ys.append(label)
    x, y = torch.tensor(np.array(xs)[:,None]), torch.tensor(ys,dtype=torch.long)
    permutation = torch.randperm(len(x))
    val, training = permutation[:len(x)//10], permutation[len(x)//10:]
    net = Net()
    if stage != 'base':
        previous = STAGES[STAGES.index(stage)-1]
        net.load_state_dict(torch.load(output/(previous+'.pt'),weights_only=True,map_location='cpu'))
    optimizer = torch.optim.Adam(net.parameters(),lr=.001)
    epochs = 30 if stage == 'base' else 20 if stage == 'fine' else 12
    for epoch in range(epochs):
        net.train()
        correct = total = 0
        for ids in training[torch.randperm(len(training))].split(512):
            optimizer.zero_grad()
            prediction = net(x[ids])
            torch.nn.functional.cross_entropy(prediction,y[ids]).backward()
            optimizer.step()
            correct += (prediction.argmax(1) == y[ids]).sum().item()
            total += len(ids)
        net.eval()
        with torch.no_grad():
            accuracy = sum((net(x[ids]).argmax(1) == y[ids]).sum().item() for ids in val.split(512))/len(val)
        print(stage,epoch,round(correct/total,4),round(accuracy,4),flush=True)
    torch.save(net.state_dict(),output/(stage+'.pt'))
    np.savez_compressed(output/(stage+'.npz'),**{k:v.detach().numpy() for k,v in net.state_dict().items()})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage',choices=(*STAGES,'all'),default='all')
    parser.add_argument('--output-dir',type=Path,required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True,exist_ok=True)
    for stage in STAGES if args.stage == 'all' else [args.stage]:
        train(stage,args.output_dir)
    # Synthetic validation variants share fonts with training; this is not diagram accuracy.

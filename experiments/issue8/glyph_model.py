"""Small font-trained character reader. NumPy inference; no training runtime required."""
from pathlib import Path

import cv2
import numpy as np

CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789()-.'


def normalize(mask):
    yy, xx = np.nonzero(mask > .22)
    if not len(xx):
        return np.zeros((28, 20), dtype='float32')
    a = mask[yy.min():yy.max()+1, xx.min():xx.max()+1]
    scale = min(16/a.shape[1], 24/a.shape[0])
    w, h = max(1, round(a.shape[1]*scale)), max(1, round(a.shape[0]*scale))
    out = np.zeros((28, 20), dtype='float32')
    out[(28-h)//2:(28-h)//2+h, (20-w)//2:(20-w)//2+w] = cv2.resize(
        a.astype('float32'), (w, h), interpolation=cv2.INTER_AREA)
    return out


class GlyphModel:
    def __init__(self, path=None):
        with np.load(path or Path(__file__).with_name('glyph-model.npz'), allow_pickle=False) as data:
            self.weights = {k: data[k] for k in data.files}
        self.cache = {}

    def predict(self, masks):
        if not masks:
            return []
        # Exact pixels only: repeated print can share inference, never colour codes.
        keys = [(m.shape, m.dtype.str, m.tobytes()) for m in masks]
        missing = {key: mask for key, mask in zip(keys, masks) if key not in self.cache}
        predictions = dict(zip(missing, self._predict(list(missing.values()))))
        results = [self.cache[key] if key in self.cache else predictions[key] for key in keys]
        for key, value in predictions.items():
            if len(key[2]) <= 4096:
                if len(self.cache) >= 1024:
                    self.cache.pop(next(iter(self.cache)))
                self.cache[key] = value
        return results

    def _predict(self, masks):
        results = []
        # Bound intermediate convolution storage, including for dense legends.
        for start in range(0, len(masks), 64):
            x = np.array([normalize(m) for m in masks[start:start+64]])[:, None]
            for layer in (0, 3):
                w, b = self.weights[f'layers.{layer}.weight'], self.weights[f'layers.{layer}.bias']
                windows = np.lib.stride_tricks.sliding_window_view(
                    np.pad(x, ((0, 0), (0, 0), (1, 1), (1, 1))), (3, 3), axis=(2, 3))
                x = np.einsum('nchwkl,ockl->nohw', windows, w, optimize=True) + b[None, :, None, None]
                np.maximum(x, 0, out=x)
                # The same 2x2 maximum, avoiding a strided multi-axis reduction
                # for every small glyph in the Android runtime.
                x = np.maximum(np.maximum(x[:, :, ::2, ::2], x[:, :, 1::2, ::2]),
                               np.maximum(x[:, :, ::2, 1::2], x[:, :, 1::2, 1::2]))
            x = x.reshape(len(x), -1)
            x = np.maximum(x @ self.weights['layers.7.weight'].T + self.weights['layers.7.bias'], 0)
            logits = x @ self.weights['layers.9.weight'].T + self.weights['layers.9.bias']
            p = np.exp(logits - logits.max(axis=1, keepdims=True))
            p /= p.sum(axis=1, keepdims=True)
            for row in p:
                ids = np.argsort(row)[::-1][:3]
                results.append([{'char': CHARACTERS[i], 'score': round(float(row[i]), 4)} for i in ids])
        return results


class SmallGlyphModel:
    """Combine ordinary and pixel-font training for print below eight pixels high."""
    def __init__(self, base):
        self.base = base
        self.pixel = GlyphModel(Path(__file__).with_name('glyph-small.npz'))

    def predict(self, masks):
        output = []
        for normal, pixel in zip(self.base.predict(masks), self.pixel.predict(masks)):
            scores = {}
            for c in normal + pixel:
                scores[c['char']] = scores.get(c['char'], 0) + c['score']/2
            output.append([{'char': c, 'score': round(p, 4)}
                           for c, p in sorted(scores.items(), key=lambda item: item[1], reverse=True)[:3]])
        return output

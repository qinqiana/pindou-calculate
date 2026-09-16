from collections import Counter
from pathlib import Path
import json
import sys

from PIL import Image


if len(sys.argv) != 2:
    raise SystemExit('用法：python3 grid_probe.py 原始148颗PNG文件')
source = Path(sys.argv[1])
image = Image.open(source).convert('RGB')
# ponytail: 已知本图点阵与棋盘背景，仅验证此样例；跨版式需独立验证定位、背景和近似色。
x0, y0, step, rows, columns = 161, 315, image.width / 31, 16, 29
offsets = (0.2, 0.35, 0.5, 0.65, 0.8)


def cell_color(row, column):
    pixels = (image.getpixel((round(x0 + (column - 1 + dx) * step),
                              round(y0 + (row - 1 + dy) * step)))
              for dx in offsets for dy in offsets)
    return Counter(pixels).most_common(1)[0][0]


# 人工给定每色一个代表格的编号映射；算法不读取格内文字或底部图例数量。
seeds = {'H7': (2, 26), 'C29': (5, 22), 'C2': (8, 14), 'H2': (5, 23),
         'C17': (10, 8), 'C16': (5, 17), 'C19': (9, 10), 'H3': (3, 26), 'C12': (4, 24)}
palette = {cell_color(*position): code for code, position in seeds.items()}
assert len(palette) == len(seeds), '代表色发生碰撞，无法据此确定色号'
backgrounds = [cell_color(1, 1), cell_color(1, 3)]
counts, unknown, blank = Counter(), [], 0
for row in range(1, rows + 1):
    for column in range(1, columns + 1):
        color = cell_color(row, column)
        if color in palette:
            counts[palette[color]] += 1
        elif any(max(abs(a - b) for a, b in zip(color, background)) <= 2 for background in backgrounds):
            blank += 1
        else:
            unknown.append({'row': row, 'column': column, 'rgb': color})

expected = {'C2': 18, 'C12': 3, 'C16': 11, 'C17': 12, 'C19': 7, 'C29': 18, 'H2': 14, 'H3': 5, 'H7': 60}
result = {'source': str(source), 'grid': {'rows': rows, 'columns': columns, 'x0': x0, 'y0': y0, 'step': step},
          'manual_code_seeds': seeds, 'counts': dict(sorted(counts.items())), 'total': sum(counts.values()),
          'blank_cells': blank, 'unknown_cells': unknown, 'matches_reference': counts == expected,
          'limits': ['点阵参数人工给定', '每色代表格的色号人工给定', '仅一张清晰图、未验证自动定位或跨版式',
                     '仅本机脚本验证、未验证安卓性能', '不读取文字、不调用OCR或网络服务']}
assert counts == expected and not unknown
assert sum(counts.values()) + blank == rows * columns
print(json.dumps(result, ensure_ascii=False, indent=2))

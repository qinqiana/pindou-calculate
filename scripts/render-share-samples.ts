// 样张渲染脚本：把 6 种分享模板输出为 PNG 供人工目检。
// 用法：node --experimental-strip-types scripts/render-share-samples.ts [输出目录]
// 默认输出到临时目录；需要提交验收素材时把输出目录指到 docs/acceptance/ 下。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeRaster, sniffImage } from '../app/src/ledger/image.ts'
import { renderShareImage, SHARE_VARIANTS, type ShareKind } from '../app/src/share/templates.ts'

const samplePath = '参考样例/豆画-Mard-148图纸样例.png'
const bytes = new Uint8Array(readFileSync(samplePath))
const sniffed = sniffImage(bytes)
if (!sniffed.ok) throw new Error('sniff failed')
const patternImage = decodeRaster(sniffed.image)

// 合成的「作品」占位图：豆粒感马赛克
const W = 240
const H = 180
const rgb = new Uint8Array(W * H * 3)
const bead = [
  [214, 92, 92],
  [240, 176, 80],
  [120, 160, 96],
  [96, 140, 190],
  [180, 130, 170],
]
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const cell = bead[(Math.floor(x / 24) + Math.floor(y / 24)) % bead.length]
    const inBead = (x % 24 > 3 && x % 24 < 20 && y % 24 > 3 && y % 24 < 20) ? 1 : 0.82
    const i = (y * W + x) * 3
    rgb[i] = cell[0] * inBead
    rgb[i + 1] = cell[1] * inBead
    rgb[i + 2] = cell[2] * inBead
  }
}
const workImage = { width: W, height: H, rgb }

const outDir = process.argv[2] ?? join(tmpdir(), 'pindou-share-samples')
mkdirSync(outDir, { recursive: true })
const kinds: ShareKind[] = ['moments', 'xiaohongshu']
for (const kind of kinds) {
  for (const variant of SHARE_VARIANTS) {
    const png = renderShareImage(kind, { patternName: '小熊猫杯垫·春日野餐', workImage, patternImage }, variant)
    const file = join(outDir, `${kind}-${variant}.png`)
    writeFileSync(file, png)
    console.log(file, png.length)
  }
}
// 无作品照片的真实首版场景
for (const kind of kinds) {
  const png = renderShareImage(kind, { patternName: '小熊猫杯垫·春日野餐', patternImage }, 'cover')
  const file = join(outDir, `${kind}-cover-nowork.png`)
  writeFileSync(file, png)
  console.log(file, png.length)
}

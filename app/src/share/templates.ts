import { encodePngRgb, readPngSize } from './png.ts'

export { readPngSize }

export type ShareKind = 'moments' | 'xiaohongshu'

export type ShareContent = {
  patternName: string
  workImage?: { width: number; height: number; rgb: Uint8Array }
  patternImage?: { width: number; height: number; rgb: Uint8Array }
}

type Rgb = { r: number; g: number; b: number }
type Box = { x: number; y: number; w: number; h: number }

// 朋友圈画幅固定 1080×1440；视觉签收另做。
const MOMENTS_WIDTH = 1080
const MOMENTS_HEIGHT = 1440
const XHS_WIDTH = 1080
const XHS_HEIGHT = 1800

const PAPER: Rgb = { r: 247, g: 241, b: 228 }
const INK: Rgb = { r: 46, g: 40, b: 34 }
const MUTED: Rgb = { r: 110, g: 100, b: 88 }
const FRAME: Rgb = { r: 255, g: 252, b: 247 }
const BORDER: Rgb = { r: 186, g: 172, b: 150 }
const PLACE: Rgb = { r: 232, g: 223, b: 204 }

const FONT5X7 = Uint8Array.of(
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x5f, 0x00, 0x00, 0x00, 0x07, 0x00, 0x07, 0x00, 0x14, 0x7f, 0x14, 0x7f, 0x14,
  0x24, 0x2a, 0x7f, 0x2a, 0x12, 0x23, 0x13, 0x08, 0x64, 0x62, 0x36, 0x49, 0x55, 0x22, 0x50, 0x00, 0x05, 0x03, 0x00, 0x00,
  0x00, 0x1c, 0x22, 0x41, 0x00, 0x00, 0x41, 0x22, 0x1c, 0x00, 0x08, 0x2a, 0x1c, 0x2a, 0x08, 0x08, 0x08, 0x3e, 0x08, 0x08,
  0x00, 0x50, 0x30, 0x00, 0x00, 0x08, 0x08, 0x08, 0x08, 0x08, 0x00, 0x60, 0x60, 0x00, 0x00, 0x20, 0x10, 0x08, 0x04, 0x02,
  0x3e, 0x51, 0x49, 0x45, 0x3e, 0x00, 0x42, 0x7f, 0x40, 0x00, 0x42, 0x61, 0x51, 0x49, 0x46, 0x21, 0x41, 0x45, 0x4b, 0x31,
  0x18, 0x14, 0x12, 0x7f, 0x10, 0x27, 0x45, 0x45, 0x45, 0x39, 0x3c, 0x4a, 0x49, 0x49, 0x30, 0x01, 0x71, 0x09, 0x05, 0x03,
  0x36, 0x49, 0x49, 0x49, 0x36, 0x06, 0x49, 0x49, 0x29, 0x1e, 0x00, 0x36, 0x36, 0x00, 0x00, 0x00, 0x56, 0x36, 0x00, 0x00,
  0x00, 0x08, 0x14, 0x22, 0x41, 0x14, 0x14, 0x14, 0x14, 0x14, 0x41, 0x22, 0x14, 0x08, 0x00, 0x02, 0x01, 0x51, 0x09, 0x06,
  0x32, 0x49, 0x79, 0x41, 0x3e, 0x7e, 0x11, 0x11, 0x11, 0x7e, 0x7f, 0x49, 0x49, 0x49, 0x36, 0x3e, 0x41, 0x41, 0x41, 0x22,
  0x7f, 0x41, 0x41, 0x22, 0x1c, 0x7f, 0x49, 0x49, 0x49, 0x41, 0x7f, 0x09, 0x09, 0x09, 0x01, 0x3e, 0x41, 0x41, 0x51, 0x32,
  0x7f, 0x08, 0x08, 0x08, 0x7f, 0x00, 0x41, 0x7f, 0x41, 0x00, 0x20, 0x40, 0x41, 0x3f, 0x01, 0x7f, 0x08, 0x14, 0x22, 0x41,
  0x7f, 0x40, 0x40, 0x40, 0x40, 0x7f, 0x02, 0x04, 0x02, 0x7f, 0x7f, 0x04, 0x08, 0x10, 0x7f, 0x3e, 0x41, 0x41, 0x41, 0x3e,
  0x7f, 0x09, 0x09, 0x09, 0x06, 0x3e, 0x41, 0x51, 0x21, 0x5e, 0x7f, 0x09, 0x19, 0x29, 0x46, 0x46, 0x49, 0x49, 0x49, 0x31,
  0x01, 0x01, 0x7f, 0x01, 0x01, 0x3f, 0x40, 0x40, 0x40, 0x3f, 0x1f, 0x20, 0x40, 0x20, 0x1f, 0x7f, 0x20, 0x18, 0x20, 0x7f,
  0x63, 0x14, 0x08, 0x14, 0x63, 0x03, 0x04, 0x78, 0x04, 0x03, 0x61, 0x51, 0x49, 0x45, 0x43, 0x00, 0x00, 0x7f, 0x41, 0x41,
  0x02, 0x04, 0x08, 0x10, 0x20, 0x41, 0x41, 0x7f, 0x00, 0x00, 0x04, 0x02, 0x01, 0x02, 0x04, 0x40, 0x40, 0x40, 0x40, 0x40,
  0x00, 0x01, 0x02, 0x04, 0x00, 0x20, 0x54, 0x54, 0x54, 0x78, 0x7f, 0x48, 0x44, 0x44, 0x38, 0x38, 0x44, 0x44, 0x44, 0x20,
  0x38, 0x44, 0x44, 0x48, 0x7f, 0x38, 0x54, 0x54, 0x54, 0x18, 0x08, 0x7e, 0x09, 0x01, 0x02, 0x08, 0x14, 0x54, 0x54, 0x3c,
  0x7f, 0x08, 0x04, 0x04, 0x78, 0x00, 0x44, 0x7d, 0x40, 0x00, 0x20, 0x40, 0x44, 0x3d, 0x00, 0x00, 0x7f, 0x10, 0x28, 0x44,
  0x00, 0x41, 0x7f, 0x40, 0x00, 0x7c, 0x04, 0x18, 0x04, 0x78, 0x7c, 0x08, 0x04, 0x04, 0x78, 0x38, 0x44, 0x44, 0x44, 0x38,
  0x7c, 0x14, 0x14, 0x14, 0x08, 0x08, 0x14, 0x14, 0x18, 0x7c, 0x7c, 0x08, 0x04, 0x04, 0x08, 0x48, 0x54, 0x54, 0x54, 0x20,
  0x04, 0x3f, 0x44, 0x40, 0x20, 0x3c, 0x40, 0x40, 0x20, 0x7c, 0x1c, 0x20, 0x40, 0x20, 0x1c, 0x3c, 0x40, 0x30, 0x40, 0x3c,
  0x44, 0x28, 0x10, 0x28, 0x44, 0x0c, 0x50, 0x50, 0x50, 0x3c, 0x44, 0x64, 0x54, 0x4c, 0x44, 0x00, 0x08, 0x36, 0x41, 0x00,
  0x00, 0x00, 0x7f, 0x00, 0x00, 0x00, 0x41, 0x36, 0x08, 0x00, 0x08, 0x04, 0x08, 0x10, 0x08,
)

function packGlyph(art: string): Uint16Array {
  const lines = art.trim().split('\n').map((s) => s.trim())
  const out = new Uint16Array(16)
  for (let y = 0; y < 16; y++) {
    const line = lines[y] ?? ''
    let bits = 0
    for (let x = 0; x < 16; x++) if (line[x] === '#') bits |= 1 << (15 - x)
    out[y] = bits
  }
  return out
}

const CJK = new Map<string, Uint16Array>([
  [
    '作',
    packGlyph(`
..##............
..##....#####...
..##............
############....
..##............
..##...######...
..##............
..##..##....#...
..##.##.........
..####..........
..##.#..........
..##..#.........
..##...##.......
.###....##......
#..##.....##....
................
`),
  ],
  [
    '品',
    packGlyph(`
................
...########.....
...#......#.....
...#......#.....
...########.....
................
.######..######.
.#....#..#....#.
.#....#..#....#.
.#....#..#....#.
.######..######.
................
................
................
................
................
`),
  ],
  [
    '图',
    packGlyph(`
################
#..............#
#......##......#
#....######....#
#......##......#
#...########...#
#......##......#
#....#.##.#....#
#...#..##..#...#
#..#...##...#..#
#......##......#
#......##...##.#
#..............#
#..............#
################
................
`),
  ],
  [
    '纸',
    packGlyph(`
.#..............
.#..#...#####...
.####......#....
.#..#......#....
.#..#...######..
.#.#.......#....
.##.#......#....
.#...#..#..#....
.#....#.#..#....
.#....##...#....
.#....#...#.....
.#...#....#.....
.#..#....#.#....
.#.#....#...#...
##.....#.....#..
................
`),
  ],
])

function fillCanvas(buf: Uint8Array, width: number, height: number, c: Rgb): void {
  const stride = width * 3
  for (let x = 0; x < width; x++) {
    buf[x * 3] = c.r
    buf[x * 3 + 1] = c.g
    buf[x * 3 + 2] = c.b
  }
  for (let y = 1; y < height; y++) buf.set(buf.subarray(0, stride), y * stride)
}

function fillRect(buf: Uint8Array, bw: number, bh: number, x: number, y: number, w: number, h: number, c: Rgb): void {
  const x0 = Math.max(0, x)
  const y0 = Math.max(0, y)
  const x1 = Math.min(bw, x + w)
  const y1 = Math.min(bh, y + h)
  if (x0 >= x1 || y0 >= y1) return
  const dw = x1 - x0
  const row = new Uint8Array(dw * 3)
  for (let i = 0; i < dw; i++) {
    row[i * 3] = c.r
    row[i * 3 + 1] = c.g
    row[i * 3 + 2] = c.b
  }
  for (let yy = y0; yy < y1; yy++) buf.set(row, (yy * bw + x0) * 3)
}

function strokeRect(buf: Uint8Array, bw: number, bh: number, box: Box, t: number, c: Rgb): void {
  fillRect(buf, bw, bh, box.x, box.y, box.w, t, c)
  fillRect(buf, bw, bh, box.x, box.y + box.h - t, box.w, t, c)
  fillRect(buf, bw, bh, box.x, box.y, t, box.h, c)
  fillRect(buf, bw, bh, box.x + box.w - t, box.y, t, box.h, c)
}

function fillRoundRect(buf: Uint8Array, bw: number, bh: number, box: Box, r: number, c: Rgb): void {
  const radius = Math.max(0, Math.min(r, Math.floor(box.w / 2), Math.floor(box.h / 2)))
  for (let y = 0; y < box.h; y++) {
    let inset = 0
    if (y < radius || y >= box.h - radius) {
      const dy = y < radius ? radius - y : y - (box.h - 1 - radius)
      const inner = radius * radius - dy * dy
      inset = inner <= 0 ? radius : radius - Math.ceil(Math.sqrt(inner))
      if (inset < 0) inset = 0
    }
    fillRect(buf, bw, bh, box.x + inset, box.y + y, box.w - inset * 2, 1, c)
  }
}

function usableImage(
  img: ShareContent['workImage'],
): img is { width: number; height: number; rgb: Uint8Array } {
  if (!img) return false
  if (!Number.isInteger(img.width) || !Number.isInteger(img.height)) return false
  if (img.width < 1 || img.height < 1) return false
  return img.rgb.length >= img.width * img.height * 3
}

function blitContain(
  buf: Uint8Array,
  bw: number,
  bh: number,
  box: Box,
  img: { width: number; height: number; rgb: Uint8Array },
): void {
  const scale = Math.min(box.w / img.width, box.h / img.height)
  const outW = Math.max(1, Math.floor(img.width * scale))
  const outH = Math.max(1, Math.floor(img.height * scale))
  const ox = box.x + Math.floor((box.w - outW) / 2)
  const oy = box.y + Math.floor((box.h - outH) / 2)
  for (let y = 0; y < outH; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y * img.height) / outH))
    const dstY = oy + y
    if (dstY < 0 || dstY >= bh) continue
    const srcRow = sy * img.width * 3
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x * img.width) / outW))
      const dstX = ox + x
      if (dstX < 0 || dstX >= bw) continue
      const di = (dstY * bw + dstX) * 3
      const si = srcRow + sx * 3
      buf[di] = img.rgb[si]
      buf[di + 1] = img.rgb[si + 1]
      buf[di + 2] = img.rgb[si + 2]
    }
  }
}

function glyphWidth(ch: string, asciiScale: number, cjkScale: number): number {
  if (CJK.has(ch)) return 16 * cjkScale + cjkScale
  const code = ch.codePointAt(0) ?? 0
  if (code >= 32 && code <= 126) return 6 * asciiScale
  if (code > 127) return 16 * cjkScale + cjkScale
  return 6 * asciiScale
}

function measure(text: string, asciiScale: number, cjkScale: number): number {
  let w = 0
  for (const ch of text) w += glyphWidth(ch, asciiScale, cjkScale)
  return w
}

function drawAscii(buf: Uint8Array, bw: number, bh: number, x: number, y: number, ch: string, scale: number, c: Rgb): void {
  const code = ch.charCodeAt(0)
  if (code < 32 || code > 126) return
  const base = (code - 32) * 5
  for (let col = 0; col < 5; col++) {
    const bits = FONT5X7[base + col]
    for (let row = 0; row < 7; row++) {
      if (bits & (1 << row)) fillRect(buf, bw, bh, x + col * scale, y + row * scale, scale, scale, c)
    }
  }
}

function drawCjk(buf: Uint8Array, bw: number, bh: number, x: number, y: number, ch: string, scale: number, c: Rgb): void {
  const glyph = CJK.get(ch)
  if (!glyph) {
    strokeRect(buf, bw, bh, { x: x + scale, y: y + scale, w: 14 * scale, h: 14 * scale }, Math.max(1, Math.floor(scale / 2)), c)
    return
  }
  for (let row = 0; row < 16; row++) {
    const bits = glyph[row]
    for (let col = 0; col < 16; col++) {
      if (bits & (1 << (15 - col))) fillRect(buf, bw, bh, x + col * scale, y + row * scale, scale, scale, c)
    }
  }
}

function drawText(
  buf: Uint8Array,
  bw: number,
  bh: number,
  x: number,
  y: number,
  text: string,
  asciiScale: number,
  cjkScale: number,
  c: Rgb,
): void {
  let cx = x
  const asciiH = 7 * asciiScale
  const cjkH = 16 * cjkScale
  const lineH = Math.max(asciiH, cjkH)
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (CJK.has(ch) || cp > 127) {
      drawCjk(buf, bw, bh, cx, y + Math.floor((lineH - cjkH) / 2), ch, cjkScale, c)
      cx += 16 * cjkScale + cjkScale
    } else {
      const drawCh = cp < 32 ? ' ' : ch
      drawAscii(buf, bw, bh, cx, y + Math.floor((lineH - asciiH) / 2), drawCh, asciiScale, c)
      cx += 6 * asciiScale
    }
  }
}

function ellipsize(text: string, maxW: number, asciiScale: number, cjkScale: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (measure(clean, asciiScale, cjkScale) <= maxW) return clean
  const dots = '...'
  const dotsW = measure(dots, asciiScale, cjkScale)
  let out = ''
  for (const ch of clean) {
    const next = out + ch
    if (measure(next, asciiScale, cjkScale) + dotsW > maxW) break
    out = next
  }
  return out + dots
}

function paintRegion(
  buf: Uint8Array,
  bw: number,
  bh: number,
  caption: string,
  captionBox: Box,
  frame: Box,
  img: ShareContent['workImage'],
): void {
  const capScale = 3
  const capAscii = 5
  const capW = measure(caption, capAscii, capScale)
  drawText(
    buf,
    bw,
    bh,
    captionBox.x + Math.floor((captionBox.w - capW) / 2),
    captionBox.y + Math.floor((captionBox.h - 16 * capScale) / 2),
    caption,
    capAscii,
    capScale,
    INK,
  )
  fillRoundRect(buf, bw, bh, frame, 18, FRAME)
  strokeRect(buf, bw, bh, frame, 3, BORDER)
  const inner: Box = { x: frame.x + 18, y: frame.y + 18, w: frame.w - 36, h: frame.h - 36 }
  if (usableImage(img)) {
    fillRect(buf, bw, bh, inner.x, inner.y, inner.w, inner.h, PLACE)
    blitContain(buf, bw, bh, inner, img)
  } else {
    fillRect(buf, bw, bh, inner.x, inner.y, inner.w, inner.h, PLACE)
    const labelW = measure(caption, capAscii, capScale)
    drawText(
      buf,
      bw,
      bh,
      inner.x + Math.floor((inner.w - labelW) / 2),
      inner.y + Math.floor((inner.h - 16 * capScale) / 2),
      caption,
      capAscii,
      capScale,
      MUTED,
    )
  }
}

function paintShare(width: number, height: number, content: ShareContent): Uint8Array {
  const buf = new Uint8Array(width * height * 3)
  fillCanvas(buf, width, height, PAPER)
  const marginX = 72
  const marginTop = 56
  const marginBottom = 56
  const titleH = 80
  const captionH = 52
  const gap = 36
  const titleAscii = 7
  const titleCjk = 4
  const maxTitleW = width - marginX * 2
  const name = ellipsize(content.patternName ?? '', maxTitleW, titleAscii, titleCjk)
  if (name) {
    const nameW = measure(name, titleAscii, titleCjk)
    drawText(
      buf,
      width,
      height,
      Math.floor((width - nameW) / 2),
      marginTop + Math.floor((titleH - Math.max(7 * titleAscii, 16 * titleCjk)) / 2),
      name,
      titleAscii,
      titleCjk,
      INK,
    )
  }
  const bodyTop = marginTop + titleH
  const bodyH = height - bodyTop - marginBottom
  const regionH = Math.floor((bodyH - gap) / 2)
  const imgX = marginX
  const imgW = width - marginX * 2
  const workCaption: Box = { x: imgX, y: bodyTop, w: imgW, h: captionH }
  const workFrame: Box = { x: imgX, y: bodyTop + captionH, w: imgW, h: regionH - captionH }
  const patternTop = bodyTop + regionH + gap
  const patternCaption: Box = { x: imgX, y: patternTop, w: imgW, h: captionH }
  const patternFrame: Box = { x: imgX, y: patternTop + captionH, w: imgW, h: regionH - captionH }
  paintRegion(buf, width, height, '作品', workCaption, workFrame, content.workImage)
  paintRegion(buf, width, height, '图纸', patternCaption, patternFrame, content.patternImage)
  return buf
}

export function renderShareImage(kind: ShareKind, content: ShareContent): Uint8Array {
  const size =
    kind === 'moments'
      ? { width: MOMENTS_WIDTH, height: MOMENTS_HEIGHT }
      : kind === 'xiaohongshu'
        ? { width: XHS_WIDTH, height: XHS_HEIGHT }
        : null
  if (!size) throw new Error('unknown share template')
  return encodePngRgb(size.width, size.height, paintShare(size.width, size.height, content))
}

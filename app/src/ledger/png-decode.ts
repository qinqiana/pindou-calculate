import { inflateZlib } from './inflate.ts'

function u32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

export function decodePngRgb(bytes: Uint8Array): { width: number; height: number; rgb: Uint8Array } {
  if (bytes.length < 33 || bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error('not png')
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat: Uint8Array[] = []
  let palette: Uint8Array | null = null
  while (offset + 12 <= bytes.length) {
    const len = u32(bytes, offset)
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
    const data = bytes.subarray(offset + 8, offset + 8 + len)
    if (type === 'IHDR') {
      width = u32(data, 0)
      height = u32(data, 4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'PLTE') {
      palette = data.slice()
    } else if (type === 'IDAT') {
      idat.push(data.slice())
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + len
  }
  if (!width || !height) throw new Error('png missing ihdr')
  if (bitDepth !== 8) throw new Error('png bit depth not 8')
  let idatLen = 0
  for (const part of idat) idatLen += part.length
  const zlib = new Uint8Array(idatLen)
  let o = 0
  for (const part of idat) {
    zlib.set(part, o)
    o += part.length
  }
  const raw = inflateZlib(zlib)
  let channels = 0
  if (colorType === 0) channels = 1
  else if (colorType === 2) channels = 3
  else if (colorType === 3) channels = 1
  else if (colorType === 4) channels = 2
  else if (colorType === 6) channels = 4
  else throw new Error('png color type unsupported')
  const stride = width * channels
  const rowBytes = stride + 1
  if (raw.length < rowBytes * height) throw new Error('png data short')
  const recon = new Uint8Array(stride)
  const prev = new Uint8Array(stride)
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * rowBytes, y * rowBytes + rowBytes)
    const filter = row[0]
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? recon[x - channels] : 0
      const up = prev[x]
      const upLeft = x >= channels ? prev[x - channels] : 0
      const v = row[x + 1]
      let out = v
      if (filter === 1) out = (v + left) & 255
      else if (filter === 2) out = (v + up) & 255
      else if (filter === 3) out = (v + ((left + up) >> 1)) & 255
      else if (filter === 4) out = (v + paeth(left, up, upLeft)) & 255
      else if (filter !== 0) throw new Error('png filter')
      recon[x] = out
    }
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 3
      if (colorType === 2 || colorType === 6) {
        const si = x * channels
        rgb[di] = recon[si]
        rgb[di + 1] = recon[si + 1]
        rgb[di + 2] = recon[si + 2]
      } else if (colorType === 0 || colorType === 4) {
        const g = recon[x * channels]
        rgb[di] = g
        rgb[di + 1] = g
        rgb[di + 2] = g
      } else if (colorType === 3) {
        const idx = recon[x] * 3
        if (!palette || idx + 2 >= palette.length) throw new Error('png palette')
        rgb[di] = palette[idx]
        rgb[di + 1] = palette[idx + 1]
        rgb[di + 2] = palette[idx + 2]
      }
    }
    prev.set(recon)
  }
  return { width, height, rgb }
}

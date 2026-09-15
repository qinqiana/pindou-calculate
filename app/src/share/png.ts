const PNG_SIG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function writeU32(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xff
  buf[offset + 1] = (value >>> 16) & 0xff
  buf[offset + 2] = (value >>> 8) & 0xff
  buf[offset + 3] = value & 0xff
}

function readU32(buf: Uint8Array, offset: number): number {
  return ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0
}

function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  const base = 65521
  let i = 0
  while (i < data.length) {
    let n = Math.min(5552, data.length - i)
    while (n--) {
      a += data[i++]
      b += a
    }
    a %= base
    b %= base
  }
  return ((b << 16) | a) >>> 0
}

function zlibStore(data: Uint8Array): Uint8Array {
  const max = 65535
  const blocks = Math.max(1, Math.ceil(data.length / max))
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4)
  out[0] = 0x78
  out[1] = 0x01
  let o = 2
  for (let bi = 0; bi < blocks; bi++) {
    const start = bi * max
    const len = Math.min(max, data.length - start)
    const nlen = (~len) & 0xffff
    out[o++] = bi === blocks - 1 ? 1 : 0
    out[o++] = len & 0xff
    out[o++] = (len >>> 8) & 0xff
    out[o++] = nlen & 0xff
    out[o++] = (nlen >>> 8) & 0xff
    if (len > 0) {
      out.set(data.subarray(start, start + len), o)
      o += len
    }
  }
  writeU32(out, o, adler32(data))
  return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  writeU32(out, 0, data.length)
  out[4] = type.charCodeAt(0)
  out[5] = type.charCodeAt(1)
  out[6] = type.charCodeAt(2)
  out[7] = type.charCodeAt(3)
  out.set(data, 8)
  writeU32(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  return encodePngRgb(width, height, rgb)
}

export function encodePngRgb(width: number, height: number, rgb: Uint8Array): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('invalid png size')
  }
  const stride = width * 3
  if (rgb.length < stride * height) throw new Error('rgb buffer too small')
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1)
    raw[row] = 0
    raw.set(rgb.subarray(y * stride, y * stride + stride), row + 1)
  }
  const ihdr = new Uint8Array(13)
  writeU32(ihdr, 0, width)
  writeU32(ihdr, 4, height)
  ihdr[8] = 8
  ihdr[9] = 2
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const parts = [PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', zlibStore(raw)), chunk('IEND', new Uint8Array(0))]
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export function readPngSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 33) throw new Error('png too short')
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIG[i]) throw new Error('not a png')
  }
  if (readU32(bytes, 8) !== 13) throw new Error('invalid ihdr')
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    throw new Error('missing ihdr')
  }
  return { width: readU32(bytes, 16), height: readU32(bytes, 20) }
}

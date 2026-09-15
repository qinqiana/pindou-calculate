class Bits {
  data: Uint8Array
  pos: number
  buf: number
  n: number

  constructor(data: Uint8Array, pos: number) {
    this.data = data
    this.pos = pos
    this.buf = 0
    this.n = 0
  }

  bit(): number {
    if (this.n === 0) {
      let b = this.data[this.pos++]
      if (b === 0xff) {
        while (this.data[this.pos] === 0xff) this.pos++
        if (this.data[this.pos] !== 0) throw new Error('jpeg marker in stream')
        this.pos++
      }
      this.buf = b
      this.n = 8
    }
    this.n--
    return (this.buf >> this.n) & 1
  }

  bits(count: number): number {
    let v = 0
    for (let i = 0; i < count; i++) v = (v << 1) | this.bit()
    return v
  }

  receive(s: number): number {
    let v = this.bits(s)
    if (v < 1 << (s - 1)) v += ((-1 << s) + 1)
    return v
  }
}

type Huff = { minCode: Int32Array; maxCode: Int32Array; valPtr: Int32Array; vals: Uint8Array }

function buildHuff(lengths: Uint8Array, values: Uint8Array): Huff {
  const minCode = new Int32Array(17)
  const maxCode = new Int32Array(17)
  const valPtr = new Int32Array(17)
  let code = 0
  let k = 0
  for (let i = 1; i <= 16; i++) {
    if (lengths[i] === 0) {
      maxCode[i] = -1
    } else {
      valPtr[i] = k
      minCode[i] = code
      code += lengths[i]
      maxCode[i] = code - 1
      k += lengths[i]
    }
    code <<= 1
  }
  return { minCode, maxCode, valPtr, vals: values }
}

function huffDecode(bits: Bits, h: Huff): number {
  let code = bits.bit()
  let len = 1
  while (code > h.maxCode[len]) {
    code = (code << 1) | bits.bit()
    len++
    if (len > 16) throw new Error('jpeg huffman')
  }
  return h.vals[h.valPtr[len] + (code - h.minCode[len])]
}

function idct(src: Int32Array, dst: Float64Array): void {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let sum = 0
      for (let v = 0; v < 8; v++) {
        const cv = v === 0 ? Math.SQRT1_2 : 1
        for (let u = 0; u < 8; u++) {
          const cu = u === 0 ? Math.SQRT1_2 : 1
          sum += cu * cv * src[v * 8 + u] * Math.cos(((2 * x + 1) * u * Math.PI) / 16) * Math.cos(((2 * y + 1) * v * Math.PI) / 16)
        }
      }
      dst[y * 8 + x] = sum / 4
    }
  }
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

export function decodeJpegRgb(bytes: Uint8Array): { width: number; height: number; rgb: Uint8Array } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not jpeg')
  let i = 2
  const qtables: number[][] = []
  const huffDC: Huff[] = []
  const huffAC: Huff[] = []
  let width = 0
  let height = 0
  const comps: { id: number; h: number; v: number; qt: number }[] = []
  let scan: { id: number; dc: number; ac: number }[] = []
  let sosPos = 0
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) throw new Error('jpeg marker')
    while (bytes[i] === 0xff) i++
    const marker = bytes[i++]
    if (marker === 0xd9) break
    if (marker === 0xda) {
      const len = (bytes[i] << 8) | bytes[i + 1]
      const n = bytes[i + 2]
      scan = []
      let p = i + 3
      for (let c = 0; c < n; c++) {
        scan.push({ id: bytes[p], dc: bytes[p + 1] >> 4, ac: bytes[p + 1] & 0x0f })
        p += 2
      }
      sosPos = i + len
      break
    }
    if (marker === 0xd8) continue
    if (marker >= 0xd0 && marker <= 0xd7) continue
    const len = (bytes[i] << 8) | bytes[i + 1]
    const data = bytes.subarray(i + 2, i + len)
    i += len
    if (marker === 0xdb) {
      let p = 0
      while (p < data.length) {
        const prec = data[p] >> 4
        const id = data[p] & 0x0f
        p++
        const t: number[] = []
        for (let k = 0; k < 64; k++) {
          t[k] = prec ? (data[p] << 8) | data[p + 1] : data[p]
          p += prec ? 2 : 1
        }
        qtables[id] = t
      }
    } else if (marker === 0xc4) {
      let p = 0
      while (p < data.length) {
        const cls = data[p] >> 4
        const id = data[p] & 0x0f
        p++
        const lengths = new Uint8Array(17)
        let n = 0
        for (let k = 1; k <= 16; k++) {
          lengths[k] = data[p++]
          n += lengths[k]
        }
        const values = data.slice(p, p + n)
        p += n
        const h = buildHuff(lengths, values)
        if (cls === 0) huffDC[id] = h
        else huffAC[id] = h
      }
    } else if (marker === 0xc0) {
      height = (data[1] << 8) | data[2]
      width = (data[3] << 8) | data[4]
      const n = data[5]
      let p = 6
      for (let c = 0; c < n; c++) {
        comps.push({ id: data[p], h: data[p + 1] >> 4, v: data[p + 1] & 0x0f, qt: data[p + 2] })
        p += 3
      }
    }
  }
  if (!width || !scan.length) throw new Error('jpeg missing frame')
  const zigzag = [
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47,
    55, 62, 63,
  ]
  const bits = new Bits(bytes, sosPos)
  const maxH = Math.max(...comps.map((c) => c.h))
  const maxV = Math.max(...comps.map((c) => c.v))
  const mcuW = 8 * maxH
  const mcuH = 8 * maxV
  const mcusX = Math.ceil(width / mcuW)
  const mcusY = Math.ceil(height / mcuH)
  const rgb = new Uint8Array(width * height * 3)
  const pred = new Int32Array(4)
  const block = new Int32Array(64)
  const spatial = new Float64Array(64)
  const planes: Float64Array[] = comps.map((c) => new Float64Array(width * height))

  function decodeBlock(dcH: Huff, acH: Huff, qt: number[], dcIdx: number): Float64Array {
    block.fill(0)
    const t = huffDecode(bits, dcH)
    pred[dcIdx] += t ? bits.receive(t) : 0
    block[0] = pred[dcIdx] * qt[0]
    let k = 1
    while (k < 64) {
      const rs = huffDecode(bits, acH)
      const s = rs & 0x0f
      const r = rs >> 4
      if (s === 0) {
        if (r !== 15) break
        k += 16
        continue
      }
      k += r
      if (k >= 64) break
      block[zigzag[k]] = bits.receive(s) * qt[k]
      k++
    }
    idct(block, spatial)
    return spatial
  }

  const order = scan.map((s) => comps.findIndex((c) => c.id === s.id))
  for (let my = 0; my < mcusY; my++) {
    for (let mx = 0; mx < mcusX; mx++) {
      for (let ci = 0; ci < order.length; ci++) {
        const idx = order[ci]
        const comp = comps[idx]
        const sc = scan[ci]
        for (let v = 0; v < comp.v; v++) {
          for (let h = 0; h < comp.h; h++) {
            const sp = decodeBlock(huffDC[sc.dc], huffAC[sc.ac], qtables[comp.qt], idx)
            const px = mx * mcuW + h * 8
            const py = my * mcuH + v * 8
            const dupX = maxH / comp.h
            const dupY = maxV / comp.v
            for (let y = 0; y < 8; y++) {
              for (let x = 0; x < 8; x++) {
                const val = sp[y * 8 + x]
                for (let dy = 0; dy < dupY; dy++) {
                  for (let dx = 0; dx < dupX; dx++) {
                    const xx = px + x * dupX + dx
                    const yy = py + y * dupY + dy
                    if (xx < width && yy < height) planes[idx][yy * width + xx] = val
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  if (comps.length === 1) {
    for (let p = 0; p < width * height; p++) {
      const g = clamp(planes[0][p] + 128)
      rgb[p * 3] = g
      rgb[p * 3 + 1] = g
      rgb[p * 3 + 2] = g
    }
  } else {
    for (let p = 0; p < width * height; p++) {
      const Y = planes[0][p] + 128
      const Cb = planes[1][p]
      const Cr = planes[2][p]
      rgb[p * 3] = clamp(Y + 1.402 * Cr)
      rgb[p * 3 + 1] = clamp(Y - 0.344136 * Cb - 0.714136 * Cr)
      rgb[p * 3 + 2] = clamp(Y + 1.772 * Cb)
    }
  }
  return { width, height, rgb }
}

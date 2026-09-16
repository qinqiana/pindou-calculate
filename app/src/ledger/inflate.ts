const LEN_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
]
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
  8193, 12289, 16385, 24577,
]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

type Huffman = { bits: number; counts: Uint16Array; symbols: Uint16Array }

function buildHuffman(lengths: Uint8Array): Huffman {
  const max = 15
  const counts = new Uint16Array(max + 1)
  for (let i = 0; i < lengths.length; i++) counts[lengths[i]]++
  counts[0] = 0
  const offs = new Uint16Array(max + 1)
  for (let len = 1; len < max; len++) offs[len + 1] = offs[len] + counts[len]
  const symbols = new Uint16Array(lengths.length)
  const cursor = offs.slice()
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i]
    if (!len) continue
    symbols[cursor[len]++] = i
  }
  return { bits: max, counts, symbols }
}

class BitReader {
  data: Uint8Array
  pos: number
  buf: number
  n: number

  constructor(data: Uint8Array, pos = 0) {
    this.data = data
    this.pos = pos
    this.buf = 0
    this.n = 0
  }

  bit(): number {
    if (this.n === 0) {
      if (this.pos >= this.data.length) throw new Error('inflate truncated')
      this.buf = this.data[this.pos++]
      this.n = 8
    }
    const v = this.buf & 1
    this.buf >>= 1
    this.n--
    return v
  }

  bits(count: number): number {
    let v = 0
    for (let i = 0; i < count; i++) v |= this.bit() << i
    return v
  }

  align(): void {
    this.buf = 0
    this.n = 0
  }
}

function decodeSymbol(src: BitReader, table: Huffman): number {
  let code = 0
  let first = 0
  let index = 0
  for (let len = 1; len <= table.bits; len++) {
    code = (code << 1) | src.bit()
    const count = table.counts[len]
    if (code - first < count) return table.symbols[index + (code - first)]
    index += count
    first = (first + count) << 1
  }
  throw new Error('bad huffman symbol')
}

function fixedLit(): Huffman {
  const lengths = new Uint8Array(288)
  lengths.fill(8, 0, 144)
  lengths.fill(9, 144, 256)
  lengths.fill(7, 256, 280)
  lengths.fill(8, 280, 288)
  return buildHuffman(lengths)
}

function fixedDist(): Huffman {
  const lengths = new Uint8Array(32)
  lengths.fill(5)
  return buildHuffman(lengths)
}

const FIXED_LIT = fixedLit()
const FIXED_DIST = fixedDist()

class Output {
  bytes = new Uint8Array(1 << 16)
  len = 0

  push(v: number): void {
    if (this.len >= this.bytes.length) {
      const n = new Uint8Array(this.bytes.length * 2)
      n.set(this.bytes)
      this.bytes = n
    }
    this.bytes[this.len++] = v
  }

  copy(distance: number, length: number): void {
    if (distance < 1 || distance > this.len) throw new Error('bad distance')
    let from = this.len - distance
    for (let i = 0; i < length; i++) this.push(this.bytes[from++])
  }

  result(): Uint8Array {
    return this.bytes.subarray(0, this.len)
  }
}

function inflateBlock(src: BitReader, out: Output, lit: Huffman, dist: Huffman): void {
  for (;;) {
    const sym = decodeSymbol(src, lit)
    if (sym < 256) {
      out.push(sym)
      continue
    }
    if (sym === 256) return
    const lenCode = sym - 257
    const length = LEN_BASE[lenCode] + src.bits(LEN_EXTRA[lenCode])
    const distCode = decodeSymbol(src, dist)
    out.copy(DIST_BASE[distCode] + src.bits(DIST_EXTRA[distCode]), length)
  }
}

function dynamicTables(src: BitReader): { lit: Huffman; dist: Huffman } {
  const nLit = src.bits(5) + 257
  const nDist = src.bits(5) + 1
  const nCl = src.bits(4) + 4
  const clens = new Uint8Array(19)
  for (let i = 0; i < nCl; i++) clens[CL_ORDER[i]] = src.bits(3)
  const clTable = buildHuffman(clens)
  const lengths = new Uint8Array(nLit + nDist)
  let i = 0
  while (i < lengths.length) {
    const sym = decodeSymbol(src, clTable)
    if (sym < 16) {
      lengths[i++] = sym
    } else if (sym === 16) {
      const copy = 3 + src.bits(2)
      const prev = i === 0 ? 0 : lengths[i - 1]
      for (let k = 0; k < copy; k++) lengths[i++] = prev
    } else if (sym === 17) {
      i += 3 + src.bits(3)
    } else {
      i += 11 + src.bits(7)
    }
  }
  return {
    lit: buildHuffman(lengths.subarray(0, nLit)),
    dist: buildHuffman(lengths.subarray(nLit)),
  }
}

export function inflateZlib(data: Uint8Array): Uint8Array {
  if (data.length < 6) throw new Error('zlib too short')
  const cmf = data[0]
  const flg = data[1]
  if ((cmf & 0x0f) !== 8) throw new Error('unsupported zlib method')
  if (((cmf << 8) + flg) % 31 !== 0) throw new Error('bad zlib header')
  if (flg & 0x20) throw new Error('zlib dict not supported')
  const src = new BitReader(data, 2)
  const out = new Output()
  for (;;) {
    const last = src.bit()
    const type = src.bits(2)
    if (type === 0) {
      src.align()
      if (src.pos + 4 > src.data.length) throw new Error('stored block truncated')
      const len = src.data[src.pos] | (src.data[src.pos + 1] << 8)
      const nlen = src.data[src.pos + 2] | (src.data[src.pos + 3] << 8)
      src.pos += 4
      if ((len ^ 0xffff) !== nlen) throw new Error('bad stored block')
      for (let i = 0; i < len; i++) out.push(src.data[src.pos++])
    } else if (type === 1) {
      inflateBlock(src, out, FIXED_LIT, FIXED_DIST)
    } else if (type === 2) {
      const tables = dynamicTables(src)
      inflateBlock(src, out, tables.lit, tables.dist)
    } else {
      throw new Error('bad deflate type')
    }
    if (last) break
  }
  return out.result()
}

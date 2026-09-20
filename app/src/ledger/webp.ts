/** Container validation only. Pixel decoding belongs to the platform codec. */
export function webpInfo(bytes: Uint8Array): { width: number; height: number; exif?: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  const bad = () => { throw new Error('WebP 文件损坏或不完整，请重新选择原图') }
  const u24 = (at: number) => bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16
  if (bytes.length < 20 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length) bad()
  let canvas: { width: number; height: number } | undefined
  let size: { width: number; height: number } | undefined
  let exif: Uint8Array | undefined
  let flags = 0
  let alpha = false
  let icc = false
  let xmp = false
  for (let at = 12; at < bytes.length;) {
    if (at + 8 > bytes.length) bad()
    const type = tag(at)
    const length = view.getUint32(at + 4, true)
    const start = at + 8
    const end = start + length
    const next = end + (length & 1)
    if (next > bytes.length || (length & 1 && bytes[end] !== 0)) bad()
    if (type === 'ANIM' || type === 'ANMF') throw new Error('不支持动画 WebP，请选择单幅静态图纸')
    if (type === 'VP8X') {
      if (at !== 12 || length !== 10) bad()
      flags = bytes[start]
      if (flags & 2) throw new Error('不支持动画 WebP，请选择单幅静态图纸')
      if ((flags & 0xc1) || bytes[start + 1] || bytes[start + 2] || bytes[start + 3]) bad()
      canvas = { width: u24(start + 4) + 1, height: u24(start + 7) + 1 }
    } else if (type === 'VP8 ' || type === 'VP8L') {
      if (size || (!canvas && at !== 12)) bad()
      if (type === 'VP8 ') {
        if (length < 10 || (bytes[start] & 1) || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 1 || bytes[start + 5] !== 0x2a) bad()
        size = { width: view.getUint16(start + 6, true) & 0x3fff, height: view.getUint16(start + 8, true) & 0x3fff }
      } else {
        if (length < 5 || bytes[start] !== 0x2f || (bytes[start + 4] >> 5) || alpha) bad()
        const bits = view.getUint32(start + 1, true)
        size = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
        alpha = !!(bits & 0x10000000)
      }
    } else if (type === 'ALPH') {
      if (!canvas || size || alpha || length < 1 || !(flags & 0x10)) bad()
      alpha = true
    } else if (type === 'ICCP') {
      if (!canvas || size || alpha || icc || !(flags & 0x20) || !length) bad()
      icc = true
    } else if (type === 'EXIF') {
      if (!canvas || !size || exif || !(flags & 8) || !length) bad()
      exif = bytes.subarray(start, end)
    } else if (type === 'XMP ') {
      if (!canvas || !size || xmp || !(flags & 4) || !length) bad()
      xmp = true
    }
    at = next
  }
  if (!size || !size.width || !size.height) bad()
  if (canvas && (canvas.width !== size!.width || canvas.height !== size!.height ||
    !!(flags & 0x10) !== alpha || !!(flags & 0x20) !== icc || !!(flags & 8) !== !!exif || !!(flags & 4) !== xmp)) bad()
  return { ...size!, exif }
}

/** EXIF's optional orientation; absent/unspecified values mean normal display. */
export function exifOrientation(bytes?: Uint8Array): number {
  if (!bytes) return 1
  const start = bytes[0] === 0x45 && bytes[1] === 0x78 ? 6 : 0
  if (bytes.length < start + 8) return 1
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, bytes.byteLength - start)
  const order = view.getUint16(0)
  if (order !== 0x4949 && order !== 0x4d4d) return 1
  const le = order === 0x4949
  if (view.getUint16(2, le) !== 42) return 1
  const offset = view.getUint32(4, le)
  if (offset + 2 > view.byteLength) return 1
  const count = view.getUint16(offset, le)
  for (let at = offset + 2; at + 12 <= view.byteLength && at < offset + 2 + count * 12; at += 12) {
    if (view.getUint16(at, le) === 0x112 && view.getUint16(at + 2, le) === 3 && view.getUint32(at + 4, le) === 1) {
      const value = view.getUint16(at + 8, le)
      return value >= 1 && value <= 8 ? value : 1
    }
  }
  return 1
}

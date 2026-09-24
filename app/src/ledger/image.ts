import { crc32, encodePngRgb, readPngSize } from '../share/png.ts'
import { decodeJpegRgb } from './jpeg-decode.ts'
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, MAX_THUMB_BYTES } from './numbers.ts'
import { decodePngRgb } from './png-decode.ts'
import { exifOrientation, webpInfo } from './webp.ts'

export type SniffedImage = {
  mime: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  bytes: Uint8Array
  orientation?: number
}

function u32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

export function sniffImage(bytes: Uint8Array): { ok: true; image: SniffedImage } | { ok: false; message: string } {
  if (!bytes || bytes.length === 0) return { ok: false, message: '没有图片数据' }
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, message: '图片超过 20 MiB 上限' }
  if (bytes.length >= 4 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF') {
    try {
      const info = webpInfo(bytes)
      if (info.width * info.height > MAX_IMAGE_PIXELS) return { ok: false, message: '图片像素超过 3200 万上限' }
      return { ok: true, image: { mime: 'image/webp', width: info.width, height: info.height, bytes, orientation: exifOrientation(info.exif) } }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'WebP 文件损坏' }
    }
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    if (bytes.length < 45 || bytes[4] !== 13 || bytes[5] !== 10 || bytes[6] !== 26 || bytes[7] !== 10 ||
      u32(bytes, 8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return { ok: false, message: 'PNG 文件不完整' }
    let ended = false
    let orientation = 1
    for (let at = 8; at < bytes.length;) {
      const length = u32(bytes, at)
      const next = at + 12 + length
      if (at + 12 > bytes.length || next > bytes.length) return { ok: false, message: 'PNG 文件不完整' }
      if (crc32(bytes.subarray(at + 4, next - 4)) !== u32(bytes, next - 4)) return { ok: false, message: 'PNG 文件损坏' }
      const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
      if (type === 'IHDR' && at !== 8) return { ok: false, message: 'PNG 文件含重复尺寸信息，请重新选择原图' }
      if (type === 'acTL') return { ok: false, message: '不支持动画，请选择单幅静态图纸' }
      if (type === 'eXIf') orientation = exifOrientation(bytes.subarray(at + 8, at + 8 + length))
      if (type === 'IEND') {
        ended = length === 0
        break
      }
      at = next
    }
    if (!ended) return { ok: false, message: 'PNG 文件不完整' }
    const width = u32(bytes, 16)
    const height = u32(bytes, 20)
    if (width < 1 || height < 1) return { ok: false, message: 'PNG 尺寸无效' }
    if (width * height > MAX_IMAGE_PIXELS) return { ok: false, message: '图片像素超过 3200 万上限' }
    return { ok: true, image: { mime: 'image/png', width, height, bytes, orientation } }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const size = jpegSize(bytes)
    if (!size) return { ok: false, message: 'JPEG 文件不完整或尺寸无效' }
    if (size.width * size.height > MAX_IMAGE_PIXELS) return { ok: false, message: '图片像素超过 3200 万上限' }
    return { ok: true, image: { mime: 'image/jpeg', ...size, bytes } }
  }
  return { ok: false, message: '只支持 PNG、JPG 或静态 WebP 图纸截图' }
}

function jpegSize(bytes: Uint8Array): { width: number; height: number; orientation: number } | null {
  let i = 2
  let orientation = 1
  let size: { width: number; height: number } | null = null
  let scanning = false
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      if (!scanning) return null
      i++
      continue
    }
    while (bytes[i + 1] === 0xff) i++
    const marker = bytes[i + 1]
    if (marker === 0xd9) return size && scanning ? { ...size, orientation } : null
    if (scanning && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) {
      i += 2
      continue
    }
    if (i + 4 > bytes.length || marker === 0xd8) return null
    const len = u16(bytes, i + 2)
    if (len < 2 || i + 2 + len > bytes.length) return null
    if (marker === 0xe1) orientation = exifOrientation(bytes.subarray(i + 4, i + 2 + len))
    const sof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    if (sof) {
      if (len < 8 || size) return null
      const height = u16(bytes, i + 5)
      const width = u16(bytes, i + 7)
      if (width < 1 || height < 1) return null
      size = { width, height }
    }
    if (marker === 0xda) scanning = true
    i += 2 + len
  }
  return null
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function base64ToBytes(text: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(text, 'base64'))
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export const TINY_PNG = encodePngRgb(1, 1, new Uint8Array([255, 0, 0]))

export function decodeRaster(image: SniffedImage): { width: number; height: number; rgb: Uint8Array } {
  if (image.mime === 'image/png') return decodePngRgb(image.bytes)
  if (image.mime === 'image/webp') throw new Error('当前环境没有 WebP 解码器，请在 Android 应用中导入')
  return decodeJpegRgb(image.bytes)
}

export function scaleRgb(
  src: { width: number; height: number; rgb: Uint8Array },
  maxSide: number,
): { width: number; height: number; rgb: Uint8Array } {
  const scale = Math.max(src.width, src.height) / maxSide
  if (scale <= 1) return src
  const width = Math.max(1, Math.round(src.width / scale))
  const height = Math.max(1, Math.round(src.height / scale))
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / height))
    for (let x = 0; x < width; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / width))
      const si = (sy * src.width + sx) * 3
      const di = (y * width + x) * 3
      rgb[di] = src.rgb[si]
      rgb[di + 1] = src.rgb[si + 1]
      rgb[di + 2] = src.rgb[si + 2]
    }
  }
  return { width, height, rgb }
}

export function pickThumbnail(
  image: SniffedImage,
  thumbnailBytes?: Uint8Array,
): { mime: 'image/png' | 'image/jpeg'; base64: string } | { ok: false; message: string } {
  try {
    // Even tiny files and caller-supplied thumbnails must pass complete source decoding.
    const raster = decodeRaster(image)
    if (thumbnailBytes) {
      const sniffed = sniffImage(thumbnailBytes)
      if (!sniffed.ok) return { ok: false, message: '缩略图' + sniffed.message.replace(/^图片/, '') }
      if (sniffed.image.mime === 'image/webp') return { ok: false, message: '保存的缩略图必须为 PNG 或 JPG' }
      decodeRaster(sniffed.image)
      if (thumbnailBytes.length > MAX_THUMB_BYTES) return { ok: false, message: '缩略图过大' }
      return { mime: sniffed.image.mime, base64: bytesToBase64(sniffed.image.bytes) }
    }
    let scaled = scaleRgb(raster, 256)
    let encoded = encodePngRgb(scaled.width, scaled.height, scaled.rgb)
    if (encoded.length > MAX_THUMB_BYTES) {
      scaled = scaleRgb(raster, 128)
      encoded = encodePngRgb(scaled.width, scaled.height, scaled.rgb)
    }
    if (encoded.length > MAX_THUMB_BYTES) return { ok: false, message: '无法生成足够小的缩略图' }
    const size = readPngSize(encoded)
    if (size.width <= 1 && size.height <= 1 && (image.width > 1 || image.height > 1)) return { ok: false, message: '缩略图退化' }
    return { mime: 'image/png', base64: bytesToBase64(encoded) }
  } catch (err) {
    return { ok: false, message: '无法生成缩略图：' + (err instanceof Error ? err.message : '解码失败') }
  }
}

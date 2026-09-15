import { encodePngRgb, readPngSize } from '../share/png.ts'
import { decodeJpegRgb } from './jpeg-decode.ts'
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, MAX_THUMB_BYTES } from './numbers.ts'
import { decodePngRgb } from './png-decode.ts'

export type SniffedImage = {
  mime: 'image/png' | 'image/jpeg'
  width: number
  height: number
  bytes: Uint8Array
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
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    if (bytes.length < 24) return { ok: false, message: 'PNG 文件不完整' }
    const width = u32(bytes, 16)
    const height = u32(bytes, 20)
    if (width < 1 || height < 1) return { ok: false, message: 'PNG 尺寸无效' }
    if (width * height > MAX_IMAGE_PIXELS) return { ok: false, message: '图片像素超过 3200 万上限' }
    return { ok: true, image: { mime: 'image/png', width, height, bytes } }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const size = jpegSize(bytes)
    if (!size) return { ok: false, message: '无法读取 JPEG 尺寸' }
    if (size.width * size.height > MAX_IMAGE_PIXELS) return { ok: false, message: '图片像素超过 3200 万上限' }
    return { ok: true, image: { mime: 'image/jpeg', width: size.width, height: size.height, bytes } }
  }
  return { ok: false, message: '只支持 PNG 或 JPG 图纸截图' }
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null
    const marker = bytes[i + 1]
    if (marker === 0xd9 || marker === 0xda) return null
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const len = u16(bytes, i + 2)
    if (len < 2) return null
    const sof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    if (sof) {
      const height = u16(bytes, i + 5)
      const width = u16(bytes, i + 7)
      if (width < 1 || height < 1) return null
      return { width, height }
    }
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

export const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49,
  0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4,
  0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

export function decodeRaster(image: SniffedImage): { width: number; height: number; rgb: Uint8Array } {
  if (image.mime === 'image/png') return decodePngRgb(image.bytes)
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
  if (thumbnailBytes) {
    const sniffed = sniffImage(thumbnailBytes)
    if (!sniffed.ok) return { ok: false, message: '缩略图' + sniffed.message.replace(/^图片/, '') }
    if (thumbnailBytes.length > MAX_THUMB_BYTES) return { ok: false, message: '缩略图过大' }
    return { mime: sniffed.image.mime, base64: bytesToBase64(sniffed.image.bytes) }
  }
  if (image.bytes.length <= MAX_THUMB_BYTES) {
    return { mime: image.mime, base64: bytesToBase64(image.bytes) }
  }
  try {
    const raster = decodeRaster(image)
    let scaled = scaleRgb(raster, 256)
    let encoded = encodePngRgb(scaled.width, scaled.height, scaled.rgb)
    if (encoded.length > MAX_THUMB_BYTES) {
      scaled = scaleRgb(raster, 128)
      encoded = encodePngRgb(scaled.width, scaled.height, scaled.rgb)
    }
    if (encoded.length > MAX_THUMB_BYTES) return { ok: false, message: '无法生成足够小的缩略图' }
    const size = readPngSize(encoded)
    if (size.width <= 1 && size.height <= 1) return { ok: false, message: '缩略图退化' }
    return { mime: 'image/png', base64: bytesToBase64(encoded) }
  } catch (err) {
    return { ok: false, message: '无法生成缩略图：' + (err instanceof Error ? err.message : '解码失败') }
  }
}

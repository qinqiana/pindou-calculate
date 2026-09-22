import { base64ToBytes, bytesToBase64, pickThumbnail, sniffImage } from '../ledger/image.ts'
import { MAX_IMAGE_PIXELS } from '../ledger/numbers.ts'

// The picker retains its granted URI only for the lifetime of these original bytes.
// Native decoders can read it directly without copying a Java byte[] through the JS bridge.
const nativeSources = new WeakMap<Uint8Array, string>()
export function rememberNativeImage(bytes: Uint8Array, uri: string): void {
  nativeSources.set(bytes, uri)
}

/** Android codecs decode the complete original; only the small PNG crosses back to JS. */
export const pickPlatformThumbnail: typeof pickThumbnail = (image, _thumbnailBytes) => {
  const android = (globalThis as { plus?: any }).plus?.android
  if (!android?.invoke) return pickThumbnail(image, _thumbnailBytes)
  const bitmaps = new Set<any>()
  const keep = (bitmap: any) => {
    if (!bitmap) throw new Error('图片未能完整解码，请重新选择完整的静态原图')
    bitmaps.add(bitmap)
    return bitmap
  }
  const call = (obj: any, method: string, ...args: any[]) => android.invoke(obj, method, ...args)
  let stream: any
  let input: any
  try {
    const checked = sniffImage(image.bytes)
    if (!checked.ok) return checked
    image = checked.image
    const sdk = Number(android.importClass('android.os.Build$VERSION').SDK_INT)
    if (!Number.isInteger(sdk) || sdk < 21) throw new Error('无法确认图片解码环境，请重启应用后重试')
    const uri = nativeSources.get(image.bytes)
    let bitmap: any
    if (uri) {
      const resolver = call(android.runtimeMainActivity(), 'getContentResolver')
      const nativeUri = call('android.net.Uri', 'parse', uri)
      if (sdk >= 28) bitmap = keep(call('android.graphics.ImageDecoder', 'decodeBitmap', call('android.graphics.ImageDecoder', 'createSource', resolver, nativeUri)))
      else {
        input = call(resolver, 'openInputStream', nativeUri)
        bitmap = keep(call('android.graphics.BitmapFactory', 'decodeStream', input))
      }
    } else {
      const data = call('android.util.Base64', 'decode', bytesToBase64(image.bytes), 2)
      if (!data) throw new Error('无法读取原图字节，请重新选图')
      // No partial-image listener: damaged/incomplete decoding must fail.
      if (sdk >= 28) bitmap = keep(call('android.graphics.ImageDecoder', 'decodeBitmap', call('android.graphics.ImageDecoder', 'createSource', call('java.nio.ByteBuffer', 'wrap', data))))
      else bitmap = keep(call('android.graphics.BitmapFactory', 'decodeByteArray', data, 0, image.bytes.length))
    }
    const width = Number(call(bitmap, 'getWidth'))
    const height = Number(call(bitmap, 'getHeight'))
    const rotated = sdk >= 28 && (image.orientation ?? 1) >= 5
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_IMAGE_PIXELS ||
      width !== (rotated ? image.height : image.width) || height !== (rotated ? image.width : image.height)) {
      throw new Error('图片解码尺寸与文件不符或超过 3200 万像素，请重新选图')
    }
    const ratio = Math.min(1, 256 / Math.max(width, height))
    bitmap = keep(call('android.graphics.Bitmap', 'createScaledBitmap', bitmap, Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)), true))
    const config = android.importClass('android.graphics.Bitmap$Config').ARGB_8888
    // ImageDecoder may return a hardware bitmap; software Canvas needs a software copy.
    if (sdk >= 28) bitmap = keep(call(bitmap, 'copy', config, false))
    if (sdk < 28 && (image.orientation ?? 1) !== 1) {
      const matrix = android.newObject('android.graphics.Matrix')
      const orientation = image.orientation
      if (orientation === 2) call(matrix, 'setScale', -1, 1)
      if (orientation === 3) call(matrix, 'setRotate', 180)
      if (orientation === 4) call(matrix, 'setScale', 1, -1)
      if (orientation === 5 || orientation === 6) call(matrix, 'setRotate', 90)
      if (orientation === 7 || orientation === 8) call(matrix, 'setRotate', -90)
      if (orientation === 5 || orientation === 7) call(matrix, 'postScale', -1, 1)
      bitmap = keep(call('android.graphics.Bitmap', 'createBitmap', bitmap, 0, 0, call(bitmap, 'getWidth'), call(bitmap, 'getHeight'), matrix, true))
    }
    // Sharing uses RGB. Composite transparency on white instead of exposing hidden RGB.
    const target = keep(call('android.graphics.Bitmap', 'createBitmap', call(bitmap, 'getWidth'), call(bitmap, 'getHeight'), config))
    const canvas = android.newObject('android.graphics.Canvas', target)
    call(canvas, 'drawColor', -1)
    call(canvas, 'drawBitmap', bitmap, 0.0, 0.0, null)
    stream = android.newObject('java.io.ByteArrayOutputStream')
    const png = android.importClass('android.graphics.Bitmap$CompressFormat').PNG
    if (call(target, 'compress', png, 100, stream) !== true) throw new Error('缩略图转换失败，请重试选图')
    const encoded = call('android.util.Base64', 'encodeToString', call(stream, 'toByteArray'), 2)
    if (typeof encoded !== 'string' || !encoded) throw new Error('缩略图转换失败，请重试选图')
    const thumbnail = sniffImage(base64ToBytes(encoded))
    if (!thumbnail.ok || thumbnail.image.mime !== 'image/png' || thumbnail.image.width > 256 || thumbnail.image.height > 256) {
      throw new Error('缩略图转换失败，请重试选图')
    }
    return pickThumbnail(thumbnail.image)
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '图片处理失败，请重新选择原图' }
  } finally {
    for (const bitmap of bitmaps) {
      try { call(bitmap, 'recycle') } catch { /* Preserve the original decode outcome. */ }
    }
    if (stream) { try { call(stream, 'close') } catch { /* No file was created. */ } }
    if (input) { try { call(input, 'close') } catch { /* Preserve decode outcome. */ } }
  }
}

export type OriginalImage = { bytes: Uint8Array; preview: string }
let handoff: { patternId: string; epoch: number; original: OriginalImage } | null = null

export function handoffOriginal(patternId: string, epoch: number, original: OriginalImage): void {
  handoff = { patternId, epoch, original }
}

export function takeOriginal(patternId: string, epoch: number): OriginalImage | null {
  const current = handoff
  handoff = null
  return current?.patternId === patternId && current.epoch === epoch ? current.original : null
}

export function prepareOriginal(bytes: Uint8Array): { ok: true; original: OriginalImage } | { ok: false; message: string } {
  const checked = sniffImage(bytes)
  if (!checked.ok) return checked
  const thumbnail = pickPlatformThumbnail(checked.image)
  if ('ok' in thumbnail) return thumbnail
  return { ok: true, original: { bytes, preview: 'data:' + checked.image.mime + ';base64,' + bytesToBase64(bytes) } }
}

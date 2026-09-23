import { base64ToBytes, bytesToBase64, pickThumbnail, sniffImage } from '../ledger/image.ts'
import { androidCall, androidPlatform } from './android.ts'
import type { Thumbnail } from '../ledger/types.ts'

// The original bytes own this cache; neither originals nor native file paths are persisted.
const thumbnails = new WeakMap<Uint8Array, Thumbnail>()
export const pickPlatformThumbnail: typeof pickThumbnail = (image, thumbnailBytes) => {
  if (!androidPlatform()) return pickThumbnail(image, thumbnailBytes)
  const cached = thumbnails.get(image.bytes)
  if (cached) return cached
  const checked = sniffImage(image.bytes)
  if (!checked.ok) return checked
  image = checked.image
  const rotated = (image.orientation ?? 1) >= 5
  const result = androidCall<string>('thumbnail', {
    base64: bytesToBase64(image.bytes),
    width: rotated ? image.height : image.width,
    height: rotated ? image.width : image.height,
  })
  if (!result.ok) return result
  try {
    const small = sniffImage(base64ToBytes(result.value))
    if (!small.ok || small.image.mime !== 'image/png' || small.image.width > 256 || small.image.height > 256) {
      return { ok: false, message: '缩略图转换失败，请重新选图' }
    }
    const thumbnail = pickThumbnail(small.image)
    if (!('ok' in thumbnail)) thumbnails.set(image.bytes, thumbnail)
    return thumbnail
  } catch { return { ok: false, message: '图片处理失败，请重新选择原图' } }
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

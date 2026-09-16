import { base64ToBytes, bytesToBase64, decodeRaster, sniffImage } from '../ledger/image.ts'
import { renderShareImage, type ShareContent, type ShareKind, type ShareVariant } from './templates.ts'

export function pixelsFromThumbnail(thumb: { mime: string; base64: string }): ShareContent['patternImage'] {
  const bytes = base64ToBytes(thumb.base64)
  const sniffed = sniffImage(bytes)
  if (!sniffed.ok) return undefined
  try {
    return decodeRaster(sniffed.image)
  } catch {
    return undefined
  }
}

export function shareContentFromPattern(
  patternName: string,
  patternThumb: { mime: string; base64: string },
  workThumb?: { mime: string; base64: string },
): ShareContent {
  const patternImage = pixelsFromThumbnail(patternThumb)
  const workImage = workThumb ? pixelsFromThumbnail(workThumb) : undefined
  return { patternName, workImage, patternImage }
}

export function previewShareDataUrl(kind: ShareKind, content: ShareContent, variant: ShareVariant = 'classic'): string {
  const png = renderShareImage(kind, content, variant)
  return 'data:image/png;base64,' + bytesToBase64(png)
}

/** 分享图文件名（保存由平台文件适配层决定落点与相册导入）。 */
export function shareDestPath(kind: ShareKind, variant: ShareVariant = 'classic'): string {
  return 'pindou-share-' + kind + '-' + variant + '.png'
}

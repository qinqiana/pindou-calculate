import { base64ToBytes, bytesToBase64, sniffImage } from '../ledger/image.ts'
import { MAX_IMAGE_BYTES } from '../ledger/numbers.ts'
import { androidCall, androidPick, type FileOutcome } from './android.ts'
export type { FileOutcome } from './android.ts'

/** Android's document provider returns original bytes, without gallery recompression. */
export async function pickImageFile(): Promise<FileOutcome<{ bytes: Uint8Array; mime: string }>> {
  const result = await androidPick<{ base64: string; mime?: string }>('image')
  if (!result.ok) return result
  try {
    const bytes = base64ToBytes(result.value.base64)
    if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, message: '图片超过 20 MiB 上限' }
    return { ok: true, value: { bytes, mime: result.value.mime ?? 'application/octet-stream' } }
  } catch { return { ok: false, message: '读取图片失败，请重新选择原图' } }
}

export function pickTextDocument(): Promise<FileOutcome<{ text: string }>> {
  return androidPick('text')
}

export async function writeTextToDownloads(filename: string, text: string): Promise<FileOutcome<{ path: string }>> {
  return androidCall('writeText', { filename, text })
}

export async function saveImageToGallery(filename: string, png: Uint8Array): Promise<FileOutcome<{ path: string }>> {
  const checked = sniffImage(png)
  if (!checked.ok || checked.image.mime !== 'image/png') return { ok: false, message: '分享图片无效，请重新生成' }
  return androidCall('saveImage', { filename, base64: bytesToBase64(png) })
}

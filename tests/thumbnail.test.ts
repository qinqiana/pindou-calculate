import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { Ledger } from '../app/src/ledger/operations.ts'
import { TINY_PNG, base64ToBytes, sniffImage } from '../app/src/ledger/image.ts'
import { MAX_THUMB_BYTES } from '../app/src/ledger/numbers.ts'
import { readPngSize } from '../app/src/share/png.ts'
import { previewShareDataUrl, shareContentFromPattern } from '../app/src/share/from-pattern.ts'

function must<T extends { ok: boolean }>(result: T, label: string): T {
  assert.equal(result.ok, true, label + ' ' + JSON.stringify(result))
  return result
}

test('PNG larger than 256KiB is stored as a recognizable downscaled thumb, not 1x1', () => {
  const bytes = new Uint8Array(readFileSync('参考样例/豆画-Mard-148图纸样例.png'))
  assert.ok(bytes.length > MAX_THUMB_BYTES)
  const l = new Ledger()
  const created = must(l.createPattern('big', { name: '148样例', imageBytes: bytes }, l.token()), 'create')
  const pattern = l.getPattern(created.ok ? created.patternId! : '')!.pattern
  const thumb = base64ToBytes(pattern.thumbnail.base64)
  assert.notDeepEqual(thumb, TINY_PNG)
  const size = readPngSize(thumb)
  assert.ok(size.width > 1)
  assert.ok(size.height > 1)
  assert.ok(size.width <= 256)
  assert.ok(size.height <= 256)
  assert.equal(pattern.pixelWidth, 5000)
  assert.equal(pattern.pixelHeight, 3820)
})

test('JPG larger than 256KiB is downscaled instead of 1x1 placeholder', () => {
  const bytes = new Uint8Array(readFileSync('参考样例/参考图纸/0b1f1c09f7d13072aadf70ca571f56fb.jpg'))
  assert.ok(bytes.length > MAX_THUMB_BYTES)
  const l = new Ledger()
  const created = must(l.createPattern('jpg', { name: 'jpg样例', imageBytes: bytes }, l.token()), 'jpg')
  const pattern = l.getPattern(created.ok ? created.patternId! : '')!.pattern
  const thumb = base64ToBytes(pattern.thumbnail.base64)
  assert.notDeepEqual(thumb, TINY_PNG)
  const sniffed = sniffImage(thumb)
  assert.equal(sniffed.ok, true)
  if (sniffed.ok) {
    assert.ok(sniffed.image.width > 1)
    assert.ok(sniffed.image.height > 1)
  }
})

test('share content uses decoded 图纸 pixels and builds a preview data URL', () => {
  const l = new Ledger()
  const created = must(l.createPattern('s', { name: '分享预览', imageBytes: TINY_PNG }, l.token()), 'p')
  const pattern = l.getPattern(created.ok ? created.patternId! : '')!.pattern
  const content = shareContentFromPattern(pattern.name, pattern.thumbnail)
  assert.ok(content.patternImage)
  assert.equal(content.workImage, undefined)
  assert.ok((content.patternImage?.width ?? 0) >= 1)
  const url = previewShareDataUrl('xiaohongshu', content)
  assert.match(url, /^data:image\/png;base64,/)
  assert.equal(url.includes('库存'), false)
})

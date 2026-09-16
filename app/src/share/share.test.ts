import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderShareImage } from './templates.ts'
import { readPngSize } from './png.ts'

function containsUtf8(bytes: Uint8Array, text: string): boolean {
  const needle = new TextEncoder().encode(text)
  if (needle.length === 0 || bytes.length < needle.length) return false
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer
    }
    return true
  }
  return false
}

test('xiaohongshu PNG is 1080×1800', () => {
  const png = renderShareImage('xiaohongshu', { patternName: '小熊猫' })
  assert.deepEqual(readPngSize(png), { width: 1080, height: 1800 })
})

test('moments PNG is 1080×1440', () => {
  const png = renderShareImage('moments', { patternName: '小熊猫' })
  assert.deepEqual(readPngSize(png), { width: 1080, height: 1440 })
})

test('rendered PNG does not contain stock, history, or path strings', () => {
  const png = renderShareImage('moments', { patternName: '小熊猫' })
  for (const s of ['库存', '余额', '/home/', 'history']) {
    assert.equal(containsUtf8(png, s), false)
  }
})

test('cancel is N/A; rendering does not throw on missing images', () => {
  assert.doesNotThrow(() => renderShareImage('xiaohongshu', { patternName: 'demo' }))
  assert.doesNotThrow(() => renderShareImage('moments', { patternName: '' }))
})

test('images are optional and do not change canvas size', () => {
  const workImage = { width: 2, height: 2, rgb: Uint8Array.of(40, 70, 90, 40, 70, 90, 40, 70, 90, 40, 70, 90) }
  const patternImage = { width: 3, height: 1, rgb: Uint8Array.of(90, 80, 60, 90, 80, 60, 90, 80, 60) }
  const png = renderShareImage('xiaohongshu', { patternName: 'Demo', workImage, patternImage })
  assert.deepEqual(readPngSize(png), { width: 1080, height: 1800 })
})

test('every variant renders both platforms at the fixed sizes without throwing', () => {
  const workImage = { width: 2, height: 2, rgb: Uint8Array.of(40, 70, 90, 40, 70, 90, 40, 70, 90, 40, 70, 90) }
  const patternImage = { width: 3, height: 1, rgb: Uint8Array.of(90, 80, 60, 90, 80, 60, 90, 80, 60) }
  const content = { patternName: '小熊猫杯垫·春日野餐', workImage, patternImage }
  for (const variant of ['classic', 'cover', 'polaroid'] as const) {
    assert.deepEqual(readPngSize(renderShareImage('moments', content, variant)), { width: 1080, height: 1440 })
    assert.deepEqual(readPngSize(renderShareImage('xiaohongshu', content, variant)), { width: 1080, height: 1800 })
  }
})

test('variants tolerate missing name and missing images', () => {
  for (const variant of ['classic', 'cover', 'polaroid'] as const) {
    assert.doesNotThrow(() => renderShareImage('moments', { patternName: '' }, variant))
    assert.doesNotThrow(() => renderShareImage('xiaohongshu', { patternName: '作品只有图纸', }, variant))
  }
})

test('unknown variant falls back to classic pixels', () => {
  const content = { patternName: '对照' }
  const fallback = renderShareImage('moments', content, 'bogus' as never)
  const classic = renderShareImage('moments', content, 'classic')
  assert.deepEqual(fallback, classic)
})

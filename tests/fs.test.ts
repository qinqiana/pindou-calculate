import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickImageFile, pickTextDocument, saveImageToGallery, writeTextToDownloads } from '../app/src/platform/fs.ts'
import { TINY_PNG, bytesToBase64 } from '../app/src/ledger/image.ts'

async function withNative(fn: (bridge: any, events: EventTarget) => Promise<void>) {
  const g = globalThis as any
  const previous = { native: g.PindouAndroid, add: g.addEventListener, remove: g.removeEventListener }
  const events = new EventTarget()
  const bridge: any = {}
  g.PindouAndroid = bridge
  g.addEventListener = events.addEventListener.bind(events)
  g.removeEventListener = events.removeEventListener.bind(events)
  try { await fn(bridge, events) }
  finally { g.PindouAndroid = previous.native; g.addEventListener = previous.add; g.removeEventListener = previous.remove }
}

test('system document result preserves original bytes, text, cancellation and request identity', async () => {
  await withNative(async (bridge, events) => {
    let cancelled = false
    bridge.pick = (id: string, kind: string) => {
      events.dispatchEvent(new CustomEvent('pindou-document', { detail: { id: 'old-request', result: { ok: false } } }))
      const result = cancelled ? { ok: false, cancelled: true, message: 'cancelled' } : { ok: true, value: kind === 'image'
        ? { base64: bytesToBase64(TINY_PNG), mime: 'image/png' } : { text: '{"原账本":1}\n' } }
      events.dispatchEvent(new CustomEvent('pindou-document', { detail: { id, result } }))
    }
    const image = await pickImageFile()
    assert.ok(image.ok)
    assert.deepEqual(image.value.bytes, TINY_PNG)
    assert.deepEqual(await pickTextDocument(), { ok: true, value: { text: '{"原账本":1}\n' } })
    cancelled = true
    const cancel = await pickImageFile()
    assert.ok(!cancel.ok && cancel.cancelled)
    bridge.pick = () => { throw new Error('provider missing') }
    assert.equal((await pickTextDocument()).ok, false)
  })
})

test('exports preserve bytes and UTF-8 text; bad image, failed native writes and missing native bridge do not claim success', async () => {
  await withNative(async bridge => {
    const calls: any[] = []
    bridge.call = (action: string, payload: string) => {
      calls.push([action, JSON.parse(payload)])
      return JSON.stringify({ ok: true, value: { path: 'Download/豆计/backup.json' } })
    }
    assert.ok((await writeTextToDownloads('backup.json', '{"库存":2}')).ok)
    assert.ok((await saveImageToGallery('share.png', TINY_PNG)).ok)
    assert.deepEqual(calls, [
      ['writeText', { filename: 'backup.json', text: '{"库存":2}' }],
      ['saveImage', { filename: 'share.png', base64: bytesToBase64(TINY_PNG) }],
    ])
    assert.equal((await saveImageToGallery('bad.png', new Uint8Array([1, 2]))).ok, false)
    assert.equal(calls.length, 2)
    bridge.call = () => JSON.stringify({ ok: false, message: 'disk full' })
    assert.equal((await writeTextToDownloads('backup.json', '{}')).ok, false)
    bridge.call = () => '{}'
    assert.equal((await saveImageToGallery('share.png', TINY_PNG)).ok, false)
  })
  assert.equal((await pickImageFile()).ok, false)
  assert.equal((await writeTextToDownloads('backup.json', '{}')).ok, false)
})

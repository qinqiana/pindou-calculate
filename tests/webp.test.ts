import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { base64ToBytes, decodeRaster, sniffImage, TINY_PNG } from '../app/src/ledger/image.ts'
import { MAX_IMAGE_BYTES, MAX_THUMB_BYTES } from '../app/src/ledger/numbers.ts'
import { Ledger } from '../app/src/ledger/operations.ts'
import { openNodeStore } from '../app/src/ledger/store-node.ts'
import { pickImageFile } from '../app/src/platform/fs.ts'
import { handoffOriginal, pickPlatformThumbnail, prepareOriginal, takeOriginal } from '../app/src/platform/image.ts'
import { shareContentFromPattern, previewShareDataUrl } from '../app/src/share/from-pattern.ts'

const fixture = (name: string) => new Uint8Array(readFileSync('tests/fixtures/webp/' + name))
const samples = ['参考样例/豆画-Mard-148图纸样例.png', ...readdirSync('参考样例/参考图纸').map(name => '参考样例/参考图纸/' + name)]

// Real host decoding via Pillow/libwebp, behind a Native.js test double.
// This verifies data flow and pixels; it does NOT replace Android device acceptance.
function nativeCodec(sdk = 28, failCompress = false) {
  const recycled: any[] = []
  const calls: string[] = []
  const decode = (bytes: Uint8Array, orient: boolean) => {
    const output = execFileSync('python3', ['-c', `
import base64, io, json, sys
from PIL import Image, ImageOps
im = Image.open(io.BytesIO(sys.stdin.buffer.read()))
im.load()
if ${orient ? 'True' : 'False'}: im = ImageOps.exif_transpose(im)
w, h = im.size
im = im.convert('RGBA'); im.thumbnail((256, 256))
white = Image.new('RGBA', im.size, 'white'); white.alpha_composite(im)
out = io.BytesIO(); white.convert('RGB').save(out, format='PNG')
print(json.dumps(dict(width=w, height=h, png=base64.b64encode(out.getvalue()).decode())))
`], { input: bytes, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })
    return JSON.parse(output.toString())
  }
  const android = {
    // Native.js static fields live on imported classes, not getAttribute(className).
    importClass(_name: string) { return { SDK_INT: sdk, ARGB_8888: 'ARGB_8888', PNG: 'PNG' } },
    newObject(name: string, target?: any) { return { name, target } },
    invoke(obj: any, method: string, ...args: any[]): any {
      calls.push(method)
      if (method === 'decode') return base64ToBytes(args[0])
      if (method === 'wrap' || method === 'createSource') return args[0]
      if (method === 'decodeBitmap') return decode(args[0], true)
      if (method === 'decodeByteArray') return decode(args[0], false)
      if (method === 'getWidth') return obj.width
      if (method === 'getHeight') return obj.height
      if (method === 'createScaledBitmap') return { ...args[0], width: args[1], height: args[2] }
      if (method === 'copy') return { ...obj }
      if (method === 'createBitmap') return { width: args[0], height: args[1] }
      if (method === 'drawBitmap') { obj.target.png = args[0].png; return }
      if (method === 'compress') { args[2].png = obj.png; return !failCompress }
      if (method === 'toByteArray') return base64ToBytes(obj.png)
      if (method === 'encodeToString') return Buffer.from(args[0]).toString('base64')
      if (method === 'recycle') recycled.push(obj)
    },
  }
  return { android, calls, recycled }
}

async function withAndroid<T>(android: any, fn: () => T | Promise<T>): Promise<T> {
  const g = globalThis as any
  const previous = g.plus
  g.plus = { android }
  try { return await fn() } finally { if (previous === undefined) delete g.plus; else g.plus = previous }
}

test('18 real originals → full decode → manual confirmation → restart → share → v2 restore', async () => {
  assert.equal(samples.length, 18)
  assert.equal(samples.filter(p => p.endsWith('.webp')).length, 13)
  const dir = mkdtempSync(join(tmpdir(), 'pindou-webp-'))
  const codec = nativeCodec()
  try {
    await withAndroid(codec.android, () => {
      let ledger = new Ledger(openNodeStore(join(dir, 'ledger.json')), undefined, pickPlatformThumbnail)
      assert.ok(ledger.commitFirstEntry('stock', [{ code: 'A1', qty: 1000 }], ledger.token()).ok)
      const stock = ledger.listStock()
      for (const path of samples) {
        const bytes = new Uint8Array(readFileSync(path))
        const prepared = prepareOriginal(bytes)
        assert.ok(prepared.ok, path + ': ' + JSON.stringify(prepared.ok ? '' : prepared))
        assert.deepEqual(prepared.original.bytes, bytes)
        assert.deepEqual(base64ToBytes(prepared.original.preview.split(',')[1]), bytes)
        const created = ledger.createPattern(path, { name: path.split('/').pop()!, imageBytes: bytes }, ledger.token())
        assert.ok(created.ok, path + ': ' + JSON.stringify(created))
        assert.ok(ledger.confirmUsage(path + '-confirm', created.patternId, { lines: [{ code: 'A1', qty: 3 }] }, ledger.token()).ok)
        const pattern = ledger.getPattern(created.patternId)!.pattern
        assert.equal(pattern.thumbnail.mime, 'image/png')
        const thumbnail = base64ToBytes(pattern.thumbnail.base64)
        if (process.env.PINDOU_IMAGE_EVIDENCE_DIR) writeFileSync(join(process.env.PINDOU_IMAGE_EVIDENCE_DIR, path.split('/').pop()! + '.png'), thumbnail)
        assert.ok(thumbnail.length <= MAX_THUMB_BYTES)
        const sniffed = sniffImage(thumbnail)
        assert.ok(sniffed.ok)
        const raster = decodeRaster(sniffed.image)
        assert.ok(raster.width > 1 && raster.width <= 256 && raster.height > 1 && raster.height <= 256)
        assert.ok(new Set(raster.rgb).size > 8, path + ': recognizable image, not a blank placeholder')
        assert.ok(Math.abs(raster.width / raster.height - pattern.pixelWidth! / pattern.pixelHeight!) < 0.02)
        assert.deepEqual(ledger.listStock(), stock)
      }
      const first = ledger.listPatterns()[0]
      assert.ok(ledger.make('make', first.id, ledger.token()).ok)
      const backup = ledger.exportBackup()
      assert.equal(backup.formatVersion, 2)
      assert.doesNotMatch(JSON.stringify(backup), /"(?:imageBytes|bytes|preview|original|path)":/)
      ledger = new Ledger(openNodeStore(join(dir, 'ledger.json')), undefined, pickPlatformThumbnail)
      assert.deepEqual(ledger.listPatterns(), backup.patterns)
      const restored = new Ledger(openNodeStore(join(dir, 'restored.json')))
      assert.ok(restored.restoreReplace('restore', backup, restored.token()).ok)
      const roundtrip = restored.exportBackup()
      for (const key of ['patterns', 'confirmedUsages', 'stock', 'makes', 'movements'] as const) assert.deepEqual(roundtrip[key], backup[key])
      for (const pattern of restored.listPatterns()) {
        const content = shareContentFromPattern(pattern.name, pattern.thumbnail)
        assert.ok(content.patternImage)
        assert.match(previewShareDataUrl('moments', content), /^data:image\/png;base64,/)
      }
      if (process.env.PINDOU_IMAGE_EVIDENCE_DIR) {
        const pattern = restored.listPatterns().find(p => p.name.endsWith('.webp'))!
        const share = previewShareDataUrl('xiaohongshu', shareContentFromPattern(pattern.name, pattern.thumbnail))
        writeFileSync(join(process.env.PINDOU_IMAGE_EVIDENCE_DIR, 'share.png'), base64ToBytes(share.split(',')[1]))
      }
      assert.ok(codec.calls.includes('decodeBitmap'))
      assert.ok(codec.recycled.length >= 18)
    })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('lossy/lossless/transparent WebP, EXIF direction and conversion failure protection', async () => {
  await withAndroid(nativeCodec().android, () => {
    for (const name of ['lossy.webp', 'lossless.webp', 'transparent.webp', 'rotated.webp']) {
      const image = sniffImage(fixture(name))
      assert.ok(image.ok, name)
      const thumbnail = pickPlatformThumbnail(image.image)
      assert.ok(!('ok' in thumbnail), name)
      const decoded = sniffImage(base64ToBytes(thumbnail.base64))
      assert.ok(decoded.ok)
      const raster = decodeRaster(decoded.image)
      assert.equal(raster.width, name === 'rotated.webp' ? 48 : 80)
      assert.equal(raster.height, name === 'rotated.webp' ? 80 : 48)
      if (name === 'transparent.webp') {
        assert.deepEqual(Array.from(raster.rgb.subarray(60 * 3, 60 * 3 + 3)), [255, 255, 255])
        assert.deepEqual(Array.from(raster.rgb.subarray(0, 3)), [255, 0, 0])
      }
    }
  })
  await withAndroid(nativeCodec(21).android, () => assert.ok(prepareOriginal(fixture('lossless.webp')).ok))
  await withAndroid(nativeCodec(28, true).android, () => {
    const ledger = new Ledger(undefined, undefined, pickPlatformThumbnail)
    const before = ledger.store.live()
    const result = ledger.createPattern('fail', { name: 'fail', imageBytes: fixture('lossy.webp') }, ledger.token())
    assert.equal(result.ok, false)
    assert.deepEqual(ledger.store.live(), before)
  })
})

test('animated, corrupt container, truncated, oversized and bad compressed data leave the ledger untouched', async () => {
  const valid = fixture('lossless.webp')
  const badSize = valid.slice(); badSize[4] ^= 1
  const badChunk = valid.slice(); badChunk[16] = 255
  const hugePixels = fixture('rotated.webp'); hugePixels.fill(255, 24, 30)
  const oversized = new Uint8Array(MAX_IMAGE_BYTES + 1)
  const corruptData = valid.slice(); corruptData.fill(255, 25)
  const cases = [fixture('animated.webp'), badSize, badChunk, valid.subarray(0, valid.length - 1), hugePixels, oversized, corruptData, TINY_PNG.subarray(0, 30)]
  await withAndroid(nativeCodec().android, () => {
    const ledger = new Ledger(undefined, undefined, pickPlatformThumbnail)
    const before = JSON.stringify(ledger.store.live())
    for (const bytes of cases) {
      const result = ledger.createPattern('bad', { name: 'bad', imageBytes: bytes }, ledger.token())
      assert.equal(result.ok, false)
      assert.equal(JSON.stringify(ledger.store.live()), before)
    }
    const original = prepareOriginal(valid)
    assert.ok(original.ok)
    handoffOriginal('p1', 1, original.original)
    assert.equal(takeOriginal('p1', 2), null)
    handoffOriginal('p1', 2, original.original)
    assert.equal(takeOriginal('p1', 2), original.original)
    assert.equal(takeOriginal('p1', 2), null)
    ledger.setInterrupt('before-commit')
    assert.equal(ledger.createPattern('save-fail', { name: 'fail', imageBytes: valid }, ledger.token()).ok, false)
    assert.equal(JSON.stringify(ledger.store.live()), before)
  })
})

test('Android document picker preserves exact original bytes, closes streams and restores callbacks', async () => {
  const bytes = fixture('transparent.webp')
  let closed = 0
  let offset = 0
  let cancelled = false
  let failed = false
  const prior = () => {}
  const main: any = {
    onActivityResult: prior,
    startActivityForResult(_intent: any, code: number) { this.onActivityResult(code, cancelled ? 0 : -1, {}) },
  }
  const android = {
    runtimeMainActivity: () => main,
    importClass() {},
    newObject: () => ({}),
    invoke(obj: any, method: string, ...args: any[]) {
      if (method === 'getData') return 'content://test/source.webp'
      if (method === 'getContentResolver' || method === 'newChannel' || method === 'openInputStream') return {}
      if (method === 'allocate') return { bytes: new Uint8Array(65536) }
      if (method === 'read') {
        if (failed) throw new Error('permission revoked')
        if (offset === bytes.length) return -1
        const count = Math.min(17, bytes.length - offset)
        args[0].bytes.set(bytes.subarray(offset, offset + count)); offset += count
        return count
      }
      if (method === 'array') return obj.bytes
      if (method === 'encodeToString') return Buffer.from(args[0].subarray(args[1], args[1] + args[2])).toString('base64')
      if (method === 'getType') return 'application/octet-stream'
      if (method === 'close') closed++
    },
  }
  await withAndroid(android, async () => {
    const selected = await pickImageFile()
    assert.ok(selected.ok)
    assert.deepEqual(selected.value.bytes, bytes)
    assert.equal(closed, 2)
    assert.equal(main.onActivityResult, prior)
    cancelled = true
    const cancel = await pickImageFile()
    assert.ok(!cancel.ok && cancel.cancelled)
    assert.equal(main.onActivityResult, prior)
    cancelled = false; failed = true
    const fail = await pickImageFile()
    assert.ok(!fail.ok && !fail.cancelled)
    assert.equal(main.onActivityResult, prior)
    assert.equal(closed, 4)
  })
})

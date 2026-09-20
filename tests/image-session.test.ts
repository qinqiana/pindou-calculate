import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { TINY_PNG } from '../app/src/ledger/image.ts'
import { Ledger } from '../app/src/ledger/operations.ts'
import { handoffOriginal, prepareOriginal, takeOriginal } from '../app/src/platform/image.ts'

/** Exercise the actual page handlers without pretending this is a device/UI rendering test. */
function page(name: string, ledger: Ledger, extras: Record<string, any>, expose: string) {
  const source = readFileSync('app/pages/pattern/' + name + '.vue', 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
  const hooks: Record<string, Function> = {}
  let serial = 0
  const env = {
    ref: (value: any) => ({ value }),
    onLoad: (fn: Function) => hooks.load = fn,
    onShow: (fn: Function) => hooks.show = fn,
    onHide: (fn: Function) => hooks.hide = fn,
    onUnload: (fn: Function) => hooks.unload = fn,
    onBackPress: (fn: Function) => hooks.back = fn,
    appLedger: () => ledger,
    appStorageState: () => ({}),
    bootAppLedger: async () => {},
    newRequestId: () => 'page-' + serial++,
    prepareOriginal, handoffOriginal, takeOriginal,
    getCurrentPages: () => [{ route: 'pages/pattern/list' }],
    ...extras,
  }
  const code = stripTypeScriptTypes(source.replace(/^import .*$/gm, ''))
  return { hooks, api: runInNewContext(code + '\n;({' + expose + '})', env) }
}

test('select/cancel/read failure/save failure retain previous inputs; late selection cannot resurrect cancelled preview', async () => {
  const ledger = new Ledger()
  let result: any = { ok: true, value: { bytes: TINY_PNG, mime: 'wrong/type' } }
  let delayed: ((value: any) => void) | null = null
  const { api, hooks } = page('list', ledger, {
    pickImageFile: () => result === 'wait' ? new Promise(resolve => delayed = resolve) : Promise.resolve(result),
    uni: { navigateTo: (options: any) => options.success() },
  }, 'pick, savePending, cancelPending, pendingPreview, previewReady, pendingName, pendingNote, pendingSize, error')
  await api.pick()
  api.savePending()
  assert.equal(ledger.listPatterns().length, 0)
  api.previewReady.value = true
  const preview = api.pendingPreview.value
  api.pendingName.value = '保留图纸'
  api.pendingNote.value = '来源'
  api.pendingSize.value = '10×10'
  for (const failure of [
    { ok: false, cancelled: true, message: '已取消' },
    { ok: false, message: '读取失败，可重试' },
    { ok: true, value: { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' } },
  ]) {
    result = failure
    await api.pick()
    assert.equal(api.pendingPreview.value, preview)
    assert.equal(api.pendingName.value, '保留图纸')
    assert.equal(api.pendingNote.value, '来源')
    assert.equal(api.pendingSize.value, '10×10')
    assert.equal(ledger.listPatterns().length, 0)
  }
  ledger.setInterrupt('before-commit')
  api.savePending()
  assert.equal(api.pendingPreview.value, preview)
  assert.equal(ledger.listPatterns().length, 0)
  assert.match(api.error.value, /重试/)
  ledger.setInterrupt('none')
  api.savePending()
  assert.equal(ledger.listPatterns().length, 1)
  assert.equal(api.pendingPreview.value, '')
  const saved = ledger.listPatterns()[0]
  assert.deepEqual(takeOriginal(saved.id, ledger.token().epoch)?.bytes, TINY_PNG)
  result = 'wait'
  const pending = api.pick()
  api.cancelPending()
  delayed!({ ok: true, value: { bytes: TINY_PNG } })
  await pending
  assert.equal(api.pendingPreview.value, '')
  result = { ok: true, value: { bytes: TINY_PNG } }
  await api.pick()
  hooks.hide()
  assert.equal(api.pendingPreview.value, '')
})

test('zoom keeps manual inputs; failed confirmation keeps original; success/unload releases it; restore rejects stale editor', () => {
  const ledger = new Ledger()
  const created = ledger.createPattern('create', { name: '图纸', imageBytes: TINY_PNG }, ledger.token())
  assert.ok(created.ok)
  const original = prepareOriginal(TINY_PNG)
  assert.ok(original.ok)
  handoffOriginal(created.patternId, ledger.token().epoch, original.original)
  const { api, hooks } = page('edit', ledger, { uni: { redirectTo() {} } }, 'original, imagePreview, lines, name, note, confirmAll, previewOriginal, zooming, error')
  hooks.load({ id: created.patternId })
  api.lines.value = [{ code: 'A1', qty: '7' }]
  api.note.value = '核对时保留'
  api.previewOriginal()
  assert.equal(api.zooming.value, true)
  assert.equal(hooks.back(), true)
  assert.equal(api.zooming.value, false)
  assert.equal(api.lines.value[0].qty, '7')
  assert.equal(api.note.value, '核对时保留')
  ledger.setInterrupt('before-commit')
  api.confirmAll()
  assert.equal(api.original.value, original.original)
  assert.equal(ledger.getPattern(created.patternId)!.confirmed, null)
  ledger.setInterrupt('none')
  const stock = ledger.listStock()
  api.confirmAll()
  assert.equal(api.original.value, null)
  assert.deepEqual(ledger.listStock(), stock)
  assert.equal(ledger.getPattern(created.patternId)!.confirmed!.lines[0].qty, 7)
  assert.ok(ledger.restoreReplace('restore', ledger.exportBackup(), ledger.token()).ok)
  api.lines.value[0].qty = '999'
  api.confirmAll()
  assert.match(api.error.value, /账本已恢复/)
  assert.equal(ledger.getPattern(created.patternId)!.confirmed!.lines[0].qty, 7)
  hooks.unload()
  assert.equal(api.imagePreview.value, '')
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { TINY_PNG, bytesToBase64, sniffImage } from '../app/src/ledger/image.ts'
import { Ledger } from '../app/src/ledger/operations.ts'
import { handoffOriginal, prepareOriginal, takeOriginal } from '../app/src/platform/image.ts'

import { normalizeColorCode } from '../app/src/ledger/catalog.ts'
import { parseNonNegativeInt, qtyMessage } from '../app/src/ledger/numbers.ts'
import { hasRecognitionRisk, invalidateRiskReview, readRecognition, recognitionProvenance, sameRecognition, usageSourceLabel } from '../app/src/recognition/result.ts'

let requestSerial = 0

/** Exercise the actual page handlers without pretending this is a device/UI rendering test. */
function page(name: string, ledger: Ledger, extras: Record<string, any>, expose: string) {
  const source = readFileSync('app/pages/pattern/' + name + '.vue', 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
  const hooks: Record<string, Function> = {}
  const env = {
    setTimeout: () => 0, clearTimeout: () => {},
    ref: (value: any) => ({ value }),
    computed: (fn: Function) => ({ get value() { return fn() } }),
    nextTick: () => Promise.resolve(),
    sniffImage, normalizeColorCode, parseNonNegativeInt, qtyMessage, hasRecognitionRisk, invalidateRiskReview, readRecognition, recognitionProvenance, sameRecognition, usageSourceLabel,
    onLoad: (fn: Function) => hooks.load = fn,
    onReady: (fn: Function) => hooks.ready = fn,
    onShow: (fn: Function) => hooks.show = fn,
    onHide: (fn: Function) => hooks.hide = fn,
    onUnload: (fn: Function) => hooks.unload = fn,
    onBackPress: (fn: Function) => hooks.back = fn,
    appLedger: () => ledger,
    appStorageState: () => ({}),
    bootAppLedger: async () => {},
    newRequestId: () => 'page-' + requestSerial++,
    prepareOriginal, handoffOriginal, takeOriginal,
    getCurrentPages: () => [{ route: 'pages/pattern/list' }],
    ...extras,
  }
  env.uni = { getSystemInfoSync: () => ({ windowWidth: 400 }), ...extras.uni }
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
  const { api, hooks } = page('edit', ledger, { uni: { redirectTo() {} } }, 'original, imagePreview, lines, name, note, confirmAll, previewOriginal, zooming, error, touchEdit')
  hooks.load({ id: created.patternId })
  hooks.ready?.()
  api.lines.value = [{ code: 'A1', qty: '7' }]
  api.touchEdit()
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
  assert.match(api.error.value, /账本.*变化/)
  assert.equal(ledger.getPattern(created.patternId)!.confirmed!.lines[0].qty, 7)
  hooks.unload()
  assert.equal(api.imagePreview.value, '')
})

test('actual editor ignores late recognition after editing, requires risk acknowledgement, and keeps automatic provenance', () => {
  const ledger = new Ledger()
  const created = ledger.createPattern('recognition-pattern', { name: '核对', imageBytes: TINY_PNG }, ledger.token())
  assert.ok(created.ok)
  const original = prepareOriginal(TINY_PNG)
  assert.ok(original.ok)
  handoffOriginal(created.patternId, ledger.token().epoch, original.original)
  const { api, hooks } = page('edit', ledger, { uni: { redirectTo() {} } }, 'request, busy, lines, editLine, startRecognition, receiveRecognition, candidate, adoptCandidate, riskAck, adopted, confirmAll, error, previewOriginal, previewRegion, focusRegion, toggleResolved')
  hooks.load({ id: created.patternId })
  hooks.ready?.()
  const first = api.request.value.identity
  api.editLine(0, 'code', 'C12')
  api.editLine(0, 'qty', '9')
  const raw = { algorithm: 'pixel-glyph-test', status: 'partial', source: 'legend', image: { width: 10, height: 10 }, candidates: [{ code: 'C12', quantity: 3, source: 'legend', evidenceIds: ['e'] }], titleTotal: null, evidence: [{ id: 'e', rawText: 'C12 3', region: [1, 1, 4, 4] }], doubts: [{ reason: '下方可能被截断', evidenceId: 'e' }] }
  api.receiveRecognition({ identity: first, stage: 'result', result: raw })
  assert.equal(api.candidate.value, null)
  assert.equal(api.lines.value[0].qty, '9')
  api.startRecognition()
  const next = api.request.value.identity
  api.previewOriginal()
  assert.equal(api.request.value.identity.requestId, next.requestId, 'zoom does not expire recognition')
  ledger.commitFirstEntry('unrelated-stock', [{ code: 'A1', qty: 100 }], ledger.token())
  api.receiveRecognition({ identity: next, stage: 'result', result: raw })
  assert.ok(api.candidate.value)
  assert.equal(api.lines.value[0].qty, '9', 'existing edits are not overwritten')
  api.adoptCandidate()
  api.confirmAll()
  assert.match(api.error.value, /风险/)
  assert.equal(ledger.getPattern(created.patternId)!.confirmed, null)
  api.riskAck.value = true
  api.toggleResolved('risk-0')
  assert.equal(api.adopted.value.risks[1].resolved, true)
  api.editLine(0, 'qty', '4')
  assert.equal(api.adopted.value.risks[1].resolved, false, 'editing invalidates the earlier correction as well as acknowledgement')
  api.previewRegion(api.lines.value[0].proof.region)
  assert.deepEqual(Array.from(api.focusRegion.value), [1, 1, 4, 4])
  assert.equal(api.lines.value[0].proof.raw, 'C12 3', 'editing and viewing preserve the original evidence')
  assert.equal(api.lines.value[0].qty, '4')
  assert.equal(api.riskAck.value, false, 'editing invalidates earlier acknowledgement')
  api.riskAck.value = true
  const stock = ledger.listStock()
  api.confirmAll()
  const confirmed = ledger.getPattern(created.patternId)!.confirmed!
  assert.equal(confirmed.inputMethod, 'legend')
  assert.equal(confirmed.recognition!.modified, true)
  assert.equal(confirmed.recognition!.candidateLines[0].qty, 3)
  assert.equal(confirmed.lines[0].qty, 4)
  assert.deepEqual(ledger.listStock(), stock)
  assert.equal(JSON.stringify(confirmed).includes('region'), false, 'source boxes stay in the image session, not the backup')
})

test('recognition timeout and bridge errors cannot save an empty result as manual zero', () => {
  for (const failure of ['timer', 'timeout', 'error', 'invalid-result']) {
    const ledger = new Ledger()
    const created = ledger.createPattern('failed-recognition', { name: '失败保护', imageBytes: TINY_PNG }, ledger.token())
    assert.ok(created.ok)
    const original = prepareOriginal(TINY_PNG)
    assert.ok(original.ok)
    handoffOriginal(created.patternId, ledger.token().epoch, original.original)
    let timeout: Function = () => {}
    const { api, hooks } = page('edit', ledger, {
      setTimeout: (callback: Function, ms: number) => { assert.equal(ms, 30000); timeout = callback; return 1 },
      uni: { redirectTo() {}, showModal: (options: any) => options.success({ confirm: true }) },
    }, 'request, busy, lines, original, confirmAll, receiveRecognition, startManual, error')
    hooks.load({ id: created.patternId })
    hooks.ready()
    const identity = api.request.value.identity
    if (failure === 'timer') timeout()
    else api.receiveRecognition({ identity, stage: failure === 'invalid-result' ? 'result' : failure, result: null, message: '识别失败，可重试' })
    assert.equal(api.busy.value, false)
    const before = JSON.stringify(ledger.store.live())
    api.confirmAll()
    assert.equal(JSON.stringify(ledger.store.live()), before, failure + ' must not create a confirmed zero version')
    assert.match(api.error.value, /零用量/)
    assert.ok(api.original.value, 'failure keeps the original for retry')
    api.startManual()
    api.confirmAll()
    assert.equal(ledger.getPattern(created.patternId)!.confirmed!.lines.reduce((sum, line) => sum + line.qty, 0), 0, 'explicit manual zero remains valid')
    assert.equal(ledger.getPattern(created.patternId)!.confirmed!.inputMethod, 'manual')
  }
})

test('edit page confirm saves metadata once and does not treat the opening original as a re-pick', async () => {
  const ledger = new Ledger()
  assert.ok(ledger.commitFirstEntry('edit-stock', [{ code: 'A1', qty: 11 }], ledger.token()).ok)
  const jpeg = new Uint8Array(readFileSync('tests/fixtures/webp/tiny.jpg'))
  const created = ledger.createPattern('edit-open', { name: '原名', sourceNote: '旧来源', sizeNote: '旧尺寸', imageBytes: TINY_PNG }, ledger.token())
  assert.ok(created.ok)
  const openingThumb = ledger.getPattern(created.patternId)!.pattern.thumbnail.base64
  const opened = prepareOriginal(jpeg)
  assert.ok(opened.ok)
  handoffOriginal(created.patternId, ledger.token().epoch, opened.original)
  const { api, hooks } = page('edit', ledger, { uni: { redirectTo() {} } }, 'name, note, sizeNote, lines, confirmAll, cancelRecognition, original')
  hooks.load({ id: created.patternId })
  hooks.ready?.()
  assert.ok(api.original.value)
  api.cancelRecognition()
  api.name.value = '  改名 '
  api.note.value = ' 新来源 '
  api.sizeNote.value = ' 7cm '
  api.lines.value = [{ code: 'A1', qty: '4' }]
  const requests = ledger.store.live().requests.length
  const operations = ledger.store.live().operations.length
  api.confirmAll()
  const saved = ledger.getPattern(created.patternId)!
  assert.equal(saved.pattern.name, '改名')
  assert.equal(saved.pattern.sourceNote, '新来源')
  assert.equal(saved.pattern.sizeNote, '7cm')
  assert.equal(saved.pattern.thumbnail.base64, openingThumb)
  assert.equal(saved.confirmed!.lines[0].qty, 4)
  assert.equal(ledger.store.live().requests.length, requests + 1)
  assert.equal(ledger.store.live().operations.length, operations + 1)
  assert.equal(ledger.store.live().operations.at(-1)!.type, 'confirm-usage')
  assert.equal(ledger.store.live().operations.some((op) => op.type === 'pattern-meta'), false)
  assert.equal(ledger.getStock('A1')!.qty, 11)

  const repick = ledger.createPattern('edit-repick', { name: '待重选', imageBytes: TINY_PNG }, ledger.token())
  assert.ok(repick.ok)
  const beforeRepick = ledger.getPattern(repick.patternId)!.pattern.thumbnail.base64
  let pick: { ok: boolean; message?: string; value?: { bytes: Uint8Array } } = { ok: true, value: { bytes: jpeg } }
  const second = page('edit', ledger, { uni: { redirectTo() {} }, pickImageFile: () => Promise.resolve(pick) }, 'name, lines, confirmAll, cancelRecognition, selectOriginal, error, original')
  second.hooks.load({ id: repick.patternId })
  await second.api.selectOriginal()
  assert.ok(second.api.original.value)
  second.api.cancelRecognition()
  second.api.name.value = '重选后'
  second.api.lines.value = [{ code: 'A1', qty: '5' }]
  const repickOps = ledger.store.live().operations.length
  second.api.confirmAll()
  const repicked = ledger.getPattern(repick.patternId)!
  assert.equal(repicked.pattern.name, '重选后')
  assert.notEqual(repicked.pattern.thumbnail.base64, beforeRepick)
  assert.equal(repicked.confirmed!.lines[0].qty, 5)
  assert.equal(ledger.store.live().operations.length, repickOps + 1)
  assert.equal(ledger.store.live().operations.at(-1)!.type, 'confirm-usage')
  assert.equal(JSON.stringify(ledger.exportBackup()).includes(bytesToBase64(jpeg)), false)
  assert.equal(ledger.getStock('A1')!.qty, 11)

  const failed = ledger.createPattern('edit-bad-pick', { name: '坏图前', imageBytes: TINY_PNG }, ledger.token())
  assert.ok(failed.ok)
  const failedThumb = ledger.getPattern(failed.patternId)!.pattern.thumbnail.base64
  pick = { ok: true, value: { bytes: new Uint8Array([9, 9, 9]) } }
  const third = page('edit', ledger, { uni: { redirectTo() {} }, pickImageFile: () => Promise.resolve(pick) }, 'name, lines, confirmAll, selectOriginal, error, original')
  third.hooks.load({ id: failed.patternId })
  await third.api.selectOriginal()
  assert.match(third.api.error.value, /.+/)
  assert.equal(third.api.original.value, null)
  third.api.name.value = '只改名字'
  third.api.lines.value = [{ code: 'A1', qty: '1' }]
  third.api.confirmAll()
  assert.equal(ledger.getPattern(failed.patternId)!.pattern.name, '只改名字')
  assert.equal(ledger.getPattern(failed.patternId)!.pattern.thumbnail.base64, failedThumb)
  assert.equal(ledger.getStock('A1')!.qty, 11)
})

test('edit page confirm leaves name, notes, thumbnail, version, and inventory unchanged when title, risk, or saving fails', () => {
  const ledger = new Ledger()
  assert.ok(ledger.commitFirstEntry('edit-fail-stock', [{ code: 'A1', qty: 11 }], ledger.token()).ok)
  const open = (label: string) => {
    const created = ledger.createPattern('edit-fail-' + label, { name: '原名', sourceNote: '旧来源', sizeNote: '旧尺寸', imageBytes: TINY_PNG }, ledger.token())
    assert.ok(created.ok)
    const original = prepareOriginal(TINY_PNG)
    assert.ok(original.ok)
    handoffOriginal(created.patternId, ledger.token().epoch, original.original)
    const loaded = page('edit', ledger, { uni: { redirectTo() {} } }, 'name, note, sizeNote, lines, titleTotal, confirmAll, cancelRecognition, error, needAck, request, startRecognition, receiveRecognition, adoptCandidate, editLine')
    loaded.hooks.load({ id: created.patternId })
    loaded.hooks.ready?.()
    loaded.api.cancelRecognition()
    return { id: created.patternId, api: loaded.api, thumbnail: ledger.getPattern(created.patternId)!.pattern.thumbnail.base64 }
  }
  const unchanged = (id: string, thumbnail: string) => {
    const stored = ledger.getPattern(id)!
    assert.equal(stored.pattern.name, '原名')
    assert.equal(stored.pattern.sourceNote, '旧来源')
    assert.equal(stored.pattern.sizeNote, '旧尺寸')
    assert.equal(stored.pattern.thumbnail.base64, thumbnail)
    assert.equal(stored.confirmed, null)
    assert.equal(ledger.getStock('A1')!.qty, 11)
    assert.equal(ledger.movements().length, 1)
  }

  const title = open('title')
  title.api.name.value = '不应保存'
  title.api.note.value = '不应保存'
  title.api.sizeNote.value = '不应保存'
  title.api.lines.value = [{ code: 'A1', qty: '2' }]
  title.api.titleTotal.value = '9'
  const titleRequests = ledger.store.live().requests.length
  title.api.confirmAll()
  assert.equal(title.api.needAck.value, true)
  assert.equal(ledger.store.live().requests.length, titleRequests)
  unchanged(title.id, title.thumbnail)

  const risk = open('risk')
  risk.api.editLine(0, 'code', 'C12')
  risk.api.editLine(0, 'qty', '9')
  risk.api.startRecognition()
  risk.api.receiveRecognition({
    identity: risk.api.request.value.identity,
    stage: 'result',
    result: { algorithm: 'pixel-glyph-test', status: 'partial', source: 'legend', image: { width: 10, height: 10 }, candidates: [{ code: 'C12', quantity: 3 }], titleTotal: null, evidence: [{ id: 'e', rawText: 'C12 3', region: [1, 1, 4, 4] }], doubts: [{ reason: '下方可能被截断', evidenceId: 'e' }] },
  })
  risk.api.adoptCandidate()
  risk.api.name.value = '不应保存'
  risk.api.note.value = '不应保存'
  risk.api.sizeNote.value = '不应保存'
  const riskRequests = ledger.store.live().requests.length
  risk.api.confirmAll()
  assert.match(risk.api.error.value, /风险/)
  assert.equal(ledger.store.live().requests.length, riskRequests)
  unchanged(risk.id, risk.thumbnail)

  const persist = open('persist')
  persist.api.name.value = '不应保存'
  persist.api.note.value = '不应保存'
  persist.api.sizeNote.value = '不应保存'
  persist.api.lines.value = [{ code: 'A1', qty: '2' }]
  ledger.setInterrupt('before-commit')
  const persistRequests = ledger.store.live().requests.length
  persist.api.confirmAll()
  assert.match(persist.api.error.value, /未改/)
  assert.equal(ledger.store.live().requests.length, persistRequests)
  unchanged(persist.id, persist.thumbnail)
  ledger.setInterrupt('none')
})

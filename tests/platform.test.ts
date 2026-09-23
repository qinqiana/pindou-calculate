import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { Ledger } from '../app/src/ledger/operations.ts'
import { TINY_PNG } from '../app/src/ledger/image.ts'
import { freshEnvelope, memorySink } from '../app/src/ledger/store.ts'
import {
  appLedger,
  appStorageState,
  bootAppLedger,
  createAppLedger,
  createSqliteJsonSink,
  retryAppStorage,
  setAppPersistSink,
} from '../app/src/platform/app-ledger.ts'
import { MemorySqlite } from '../app/src/ledger/sqlite-json.ts'
import {
  clearRequestAfterVoid,
  emptyMakeRequestState,
  markMakeSuccess,
  resolveMakeRequestId,
} from '../app/src/platform/make-request.ts'

test('platform modules use the narrow native bridge without Node filesystem or DCloud runtime', () => {
  for (const file of ['app-ledger.ts', 'fs.ts', 'image.ts', 'android.ts']) {
    const source = readFileSync('app/src/platform/' + file, 'utf8')
    assert.doesNotMatch(source, /node:fs|plus\./)
  }
})

function seedPayload(qty: number): string {
  const slot = { json: null as string | null }
  const ledger = createAppLedger(memorySink(slot))
  assert.ok(ledger.commitFirstEntry('seed', [{ code: 'A1', qty }], ledger.token()).ok)
  return slot.json!
}

// Domain-facing bridge fixture. Actual SQLite transactions are checked on Android.
async function withNative(state: { text: string | null; readError?: boolean; writeError?: boolean }, fn: () => Promise<void>) {
  const g = globalThis as any
  const previous = g.PindouAndroid
  g.PindouAndroid = { call(action: string, args: string) {
    if (action === 'readLedger') return JSON.stringify(state.readError ? { ok: false, message: 'read failed' } : { ok: true, value: state.text })
    if (action === 'writeLedger') {
      if (state.writeError) return JSON.stringify({ ok: false, message: 'commit failed' })
      state.text = JSON.parse(args).text
      return JSON.stringify({ ok: true, value: true })
    }
    throw new Error('unexpected action')
  } }
  setAppPersistSink(null)
  try { await fn() }
  finally { g.PindouAndroid = previous; setAppPersistSink(null) }
}

test('native commit is read back after a fresh JS context; failed commits preserve visible and saved state', async () => {
  const state = { text: seedPayload(7), writeError: false }
  await withNative(state, async () => {
    await bootAppLedger()
    assert.ok(appStorageState().ok)
    assert.equal(appLedger().getStock('A1')!.qty, 7)
    state.writeError = true
    const denied = appLedger().commitRestock('fail', [{ code: 'A1', qty: 100 }], appLedger().token())
    assert.ok(!denied.ok && denied.code === 'persist-failed')
    assert.equal(appLedger().getStock('A1')!.qty, 7)
    assert.equal(JSON.parse(state.text).live.stock.A1.qty, 7)
    state.writeError = false
    assert.ok(appLedger().commitRestock('saved', [{ code: 'A1', qty: 100 }], appLedger().token()).ok)
  })
  await withNative(state, async () => {
    await bootAppLedger()
    assert.equal(appLedger().getStock('A1')!.qty, 100)
    assert.equal(appLedger().movements('A1').length, 2)
  })
})

test('failed or malformed reads never initialize over existing data; retry recovers', async () => {
  const state = { text: seedPayload(7), readError: true }
  const original = state.text
  await withNative(state, async () => {
    await bootAppLedger()
    assert.equal(appStorageState().ok, false)
    assert.equal(appLedger().commitFirstEntry('denied', [{ code: 'A1', qty: 100 }], appLedger().token()).ok, false)
    assert.equal(state.text, original)
    state.readError = false
    await retryAppStorage()
    assert.ok(appStorageState().ok)
    assert.equal(appLedger().getStock('A1')!.qty, 7)
  })
  for (const text of ['', '{broken', '{}']) {
    const bad = { text }
    await withNative(bad, async () => {
      await bootAppLedger()
      assert.equal(appStorageState().ok, false)
      assert.equal(bad.text, text)
    })
  }
})

test('only a confirmed empty native database is initialized; missing bridge cannot appear to save', async () => {
  const state = { text: null as string | null }
  await withNative(state, async () => {
    await bootAppLedger()
    assert.ok(appStorageState().ok)
    assert.ok(state.text)
    assert.equal(appLedger().getStock('A1')!.qty, 0)
  })
  await bootAppLedger()
  assert.equal(appStorageState().ok, false)
  assert.equal(appLedger().commitFirstEntry('denied', [{ code: 'A1', qty: 10 }], appLedger().token()).ok, false)
  setAppPersistSink(null)
})

test('合法 JSON 但损坏的 envelope 被拒绝，且不会被写回覆盖', () => {
  const slot = { json: JSON.stringify({ ...freshEnvelope(), pointer: 'pending', pending: { seq: -1 } }) }
  assert.throws(() => createAppLedger(memorySink(slot)), /invalid-envelope/)
  assert.match(slot.json!, /"seq":-1/)
})

test('injected persist sink reloads last commit after restart', () => {
  const slot = { json: null as string | null }
  const sink = memorySink(slot)
  setAppPersistSink(sink)
  const first = createAppLedger(sink)
  const saved = first.commitFirstEntry('a1-100', [{ code: 'A1', qty: 100 }], first.token())
  assert.equal(saved.ok, true)
  setAppPersistSink(sink)
  const second = createAppLedger(sink)
  assert.equal(second.getStock('A1')!.qty, 100)
  assert.equal(second.movements('A1').length, 1)
  setAppPersistSink(null)
})

test('new SqliteJsonStore on the same engine SELECTs last write after dropping JS cache', () => {
  const db = new MemorySqlite()
  const firstSink = createSqliteJsonSink(db)
  const first = createAppLedger(firstSink)
  const saved = first.commitFirstEntry('a1-100-sql', [{ code: 'A1', qty: 100 }], first.token())
  assert.equal(saved.ok, true)
  assert.equal(first.getStock('A1')!.qty, 100)
  const secondSink = createSqliteJsonSink(db)
  assert.notEqual(secondSink, firstSink)
  const loaded = secondSink.read()
  assert.ok(loaded)
  assert.equal(loaded!.live.stock.A1.qty, 100)
  const second = createAppLedger(secondSink)
  assert.equal(second.getStock('A1')!.qty, 100)
  assert.equal(second.movements('A1').length, 1)
})

test('已拼 reuses in-flight requestId; 再拼一次 mints a new id', () => {
  const l = new Ledger()
  l.commitFirstEntry('s', [{ code: 'A1', qty: 80 }], l.token())
  const p = l.createPattern('p', { name: '连点', imageBytes: TINY_PNG }, l.token())
  assert.equal(p.ok, true)
  const id = p.ok ? p.patternId! : ''
  l.confirmUsage('c', id, { lines: [{ code: 'A1', qty: 10 }] }, l.token())
  let n = 0
  const gen = () => 'id-' + ++n
  let state = emptyMakeRequestState()
  const first = resolveMakeRequestId(state, 'make', gen)
  state = first.state
  const tap2 = resolveMakeRequestId(state, 'make', gen)
  assert.equal(tap2.requestId, first.requestId)
  const r1 = l.make(first.requestId, id, l.token())
  assert.equal(r1.ok, true)
  const r2 = l.make(tap2.requestId, id, l.token())
  assert.equal(r2.ok, true)
  assert.equal(l.listMakes().length, 1)
  state = markMakeSuccess(tap2.state, 'make')
  l.commitRestock('more', [{ code: 'A1', qty: 80 }], l.token())
  const remake = resolveMakeRequestId(state, 'remake', gen)
  assert.notEqual(remake.requestId, first.requestId)
  const r3 = l.make(remake.requestId, id, l.token())
  assert.equal(r3.ok, true)
  assert.equal(l.listMakes().length, 2)
  const remakeTap = resolveMakeRequestId(remake.state, 'remake', gen)
  assert.equal(remakeTap.requestId, remake.requestId)
})

test('撤回 clears makeId so the next 已拼 is a new 制作', () => {
  const l = new Ledger()
  l.commitFirstEntry('s', [{ code: 'A1', qty: 80 }], l.token())
  const p = l.createPattern('p', { name: '撤回再拼', imageBytes: TINY_PNG }, l.token())
  assert.equal(p.ok, true)
  const id = p.ok ? p.patternId! : ''
  l.confirmUsage('c', id, { lines: [{ code: 'A1', qty: 10 }] }, l.token())
  let n = 0
  const gen = () => 'void-' + ++n
  let state = emptyMakeRequestState()
  const first = resolveMakeRequestId(state, 'make', gen)
  const made = l.make(first.requestId, id, l.token())
  assert.equal(made.ok, true)
  assert.equal(l.listMakes().filter((m) => !m.voided).length, 1)
  const rec = l.listMakes()[0]
  const voided = l.voidMake('void-req', rec.id, l.token())
  assert.equal(voided.ok, true)
  state = markMakeSuccess(first.state, 'make')
  state = clearRequestAfterVoid(state, rec.requestId)
  const afterVoid = resolveMakeRequestId(state, 'make', gen)
  assert.notEqual(afterVoid.requestId, first.requestId)
  const madeAgain = l.make(afterVoid.requestId, id, l.token())
  assert.equal(madeAgain.ok, true)
  assert.equal(l.listMakes().length, 2)
  assert.equal(l.listMakes().filter((m) => !m.voided).length, 1)
  assert.equal(l.getStock('A1')!.qty, 70)
})

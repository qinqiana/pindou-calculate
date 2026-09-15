import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { Ledger } from '../app/src/ledger/operations.ts'
import { TINY_PNG } from '../app/src/ledger/image.ts'
import { memorySink } from '../app/src/ledger/store.ts'
import { createAppLedger, createSqliteJsonSink, setAppPersistSink } from '../app/src/platform/app-ledger.ts'
import { MemorySqlite } from '../app/src/ledger/sqlite-json.ts'
import {
  clearRequestAfterVoid,
  emptyMakeRequestState,
  markMakeSuccess,
  resolveMakeRequestId,
} from '../app/src/platform/make-request.ts'

test('uni-app persist modules do not import node:fs', () => {
  for (const file of [
    'app/src/platform/app-ledger.ts',
    'app/src/ledger/operations.ts',
    'app/src/ledger/store.ts',
    'app/src/ledger/sqlite-json.ts',
    'app/src/ledger/image.ts',
  ]) {
    const text = readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /node:fs/)
    assert.doesNotMatch(text, /from 'fs'/)
  }
  const app = readFileSync('app/src/platform/app-ledger.ts', 'utf8')
  assert.doesNotMatch(app, /Ledger\.open/)
  assert.match(app, /pindou_ledger/)
  assert.match(app, /BEGIN TRANSACTION/)
  assert.doesNotMatch(app, /plus\.storage/)
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

test('plus sqlite sink hydrates A1=100 from sqlite SELECT on a new sink instance', () => {
  const previous = (globalThis as { plus?: unknown }).plus
  const sqlite = {
    openDatabase() {},
    executeSql() {},
    selectSql() {},
  }
  ;(globalThis as { plus?: unknown }).plus = { sqlite }
  try {
    setAppPersistSink(null)
    const first = createAppLedger()
    const saved = first.commitFirstEntry('a1-plus', [{ code: 'A1', qty: 100 }], first.token())
    assert.equal(saved.ok, true)
    setAppPersistSink(null)
    const second = createAppLedger()
    assert.equal(second.getStock('A1')!.qty, 100)
  } finally {
    setAppPersistSink(null)
    ;(globalThis as { plus?: unknown }).plus = previous
  }
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

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { Ledger } from '../app/src/ledger/operations.ts'
import { TINY_PNG } from '../app/src/ledger/image.ts'
import { memorySink } from '../app/src/ledger/store.ts'
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

test('uni-app persist modules do not import node:fs', () => {
  for (const file of [
    'app/src/platform/app-ledger.ts',
    'app/src/platform/fs.ts',
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
  assert.match(app, /transaction/) // 原生事务 API（begin/commit/rollback）
  assert.match(app, /PersistError/)
  assert.match(app, /BootReadError/)
  assert.doesNotMatch(app, /plus\.storage/)
  assert.doesNotMatch(app, /WeakMap/) // 不再用内存缓存冒充持久化
})

/** 用纯内存账本造一份 A1=qty 的持久化载荷，作为原生库初始内容。 */
function seedPayload(qty: number): string {
  const slot = { json: null as string | null }
  const l = createAppLedger(memorySink(slot))
  const saved = l.commitFirstEntry('seed', [{ code: 'A1', qty }], l.token())
  assert.equal(saved.ok, true)
  return slot.json!
}

type Opts = {
  success?: (rows?: unknown) => void
  fail?: (err?: unknown) => void
  sql?: string | string[]
  operation?: string
}

/**
 * 原生 SQLite 模拟：真实保存 payload，事务语义与 plus.sqlite 一致
 * （begin 暂存、commit 落盘、rollback 丢弃），回调同步触发，可注入失败。
 * makeFacade() 每次生成全新门面对象，模拟整个 JS 运行上下文重建。
 */
function fakeNativeSqlite(initialPayload: string | null) {
  const state = {
    payload: initialPayload,
    tx: undefined as string | null | undefined,
    calls: [] as string[],
    failNext: {} as Record<string, number>,
  }
  const failOnce = (key: string): boolean => {
    if ((state.failNext[key] ?? 0) > 0) {
      state.failNext[key] -= 1
      return true
    }
    return false
  }
  function makeFacade() {
    return {
      openDatabase(opts: Opts) {
        state.calls.push('open')
        opts.success?.()
      },
      executeSql(opts: Opts) {
        const sqls = Array.isArray(opts.sql) ? opts.sql : [opts.sql!]
        for (const sql of sqls) state.calls.push('exec:' + sql.slice(0, 16))
        if (failOnce('exec')) {
          opts.fail?.({ code: -1, message: 'injected exec failure' })
          return
        }
        for (const sql of sqls) {
          if (/^CREATE/i.test(sql)) continue
          if (/^DELETE/i.test(sql)) state.tx = null
          else if (/^INSERT/i.test(sql)) {
            const m = /^INSERT INTO pindou_ledger \(id, payload\) VALUES \(1, '(.*)'\)$/s.exec(sql)
            state.tx = m ? m[1].replace(/''/g, "'") : null
          }
        }
        opts.success?.()
      },
      selectSql(opts: Opts) {
        state.calls.push('select')
        if (failOnce('select')) {
          opts.fail?.({ code: -1, message: 'injected select failure' })
          return
        }
        opts.success?.(state.payload == null ? [] : [{ payload: state.payload }])
      },
      transaction(opts: Opts) {
        state.calls.push('tx:' + opts.operation)
        if (failOnce(opts.operation!)) {
          opts.fail?.({ code: -1, message: 'injected ' + opts.operation + ' failure' })
          return
        }
        if (opts.operation === 'begin') state.tx = undefined
        else if (opts.operation === 'commit') {
          if (state.tx !== undefined) state.payload = state.tx
          state.tx = undefined
        } else if (opts.operation === 'rollback') state.tx = undefined
        opts.success?.()
      },
    }
  }
  return { state, makeFacade }
}

function withPlus(sqlite: unknown, fn: () => void): void {
  const prev = (globalThis as { plus?: unknown }).plus
  ;(globalThis as { plus?: unknown }).plus = { sqlite }
  try {
    fn()
  } finally {
    if (prev === undefined) delete (globalThis as { plus?: unknown }).plus
    else (globalThis as { plus?: unknown }).plus = prev
    setAppPersistSink(null)
  }
}

test('启动读取旧账后，后续提交写入真实原生库；全新 JS 上下文仍能读回', () => {
  const initial = seedPayload(7)
  const db = fakeNativeSqlite(initial)
  withPlus(db.makeFacade(), () => {
    bootAppLedger()
    assert.equal(appStorageState().ok, true)
    assert.equal(appLedger().getStock('A1')!.qty, 7)
    db.state.calls.length = 0
    const saved = appLedger().commitRestock('a1-100', [{ code: 'A1', qty: 100 }], appLedger().token())
    assert.equal(saved.ok, true)
    assert.ok(db.state.calls.some((c) => c.startsWith('exec:INSERT')), '提交必须触发原生 INSERT')
    assert.ok(db.state.calls.includes('tx:begin'), '提交必须开启原生事务')
    assert.ok(db.state.calls.includes('tx:commit'), '提交必须真实 COMMIT')
    assert.equal(JSON.parse(db.state.payload!).live.stock.A1.qty, 100, '原生库已写入新值')
  })
  // 模拟结束进程后重开：新 facade、新适配器实例，不复用任何 JS 缓存
  withPlus(db.makeFacade(), () => {
    bootAppLedger()
    assert.equal(appLedger().getStock('A1')!.qty, 100)
    assert.equal(appLedger().movements('A1').length, 2)
  })
})

test('读取数据库短暂失败：不覆盖旧账，进入错误状态并可重试恢复', () => {
  const initial = seedPayload(7)
  const db = fakeNativeSqlite(initial)
  db.state.failNext.select = 1 // 冷启动首次 SELECT 失败，后续 SQL 可用
  withPlus(db.makeFacade(), () => {
    bootAppLedger()
    assert.equal(appStorageState().ok, false)
    assert.ok(appStorageState().message)
    // 降级账本：写入明确失败，不静默充当可编辑的临时内存账本
    const denied = appLedger().commitFirstEntry('a1-100', [{ code: 'A1', qty: 100 }], appLedger().token())
    if (denied.ok) assert.fail('存储不可用时不得返回保存成功')
    assert.equal(denied.code, 'persist-failed')
    // 旧库原样保留：没有任何写入或初始化
    assert.equal(db.state.payload, initial)
    assert.equal(db.state.calls.filter((c) => c.startsWith('exec:INSERT') || c.startsWith('exec:DELETE')).length, 0)
    // 恢复后重试能读回旧账
    retryAppStorage()
    assert.equal(appStorageState().ok, true)
    assert.equal(appLedger().getStock('A1')!.qty, 7)
  })
})

test('原生写入失败：报告 persist-failed，可见状态与原生库都保持原样', () => {
  const initial = seedPayload(7)
  const db = fakeNativeSqlite(initial)
  withPlus(db.makeFacade(), () => {
    bootAppLedger()
    db.state.failNext.exec = 1 // 下一次 [DELETE, INSERT] 失败
    const denied = appLedger().commitRestock('a1-100', [{ code: 'A1', qty: 100 }], appLedger().token())
    if (denied.ok) assert.fail('写入失败不得伪成功')
    assert.equal(denied.code, 'persist-failed')
    assert.ok(db.state.calls.includes('tx:rollback'), '失败必须回滚原生事务')
    assert.equal(db.state.payload, initial, '原生库未被改动')
    assert.equal(appLedger().getStock('A1')!.qty, 7, '可见状态未被改动')
    // 故障恢复后可以正常保存
    const again = appLedger().commitRestock('a1-100b', [{ code: 'A1', qty: 100 }], appLedger().token())
    assert.equal(again.ok, true)
    assert.equal(JSON.parse(db.state.payload!).live.stock.A1.qty, 100)
  })
})

test('原生 COMMIT 失败：同样报告 persist-failed，不留伪成功', () => {
  const initial = seedPayload(7)
  const db = fakeNativeSqlite(initial)
  withPlus(db.makeFacade(), () => {
    bootAppLedger()
    db.state.failNext.commit = 1
    const denied = appLedger().commitRestock('a1-100', [{ code: 'A1', qty: 100 }], appLedger().token())
    if (denied.ok) assert.fail('COMMIT 失败不得伪成功')
    assert.equal(denied.code, 'persist-failed')
    assert.equal(db.state.payload, initial)
    assert.equal(appLedger().getStock('A1')!.qty, 7)
  })
})

test('确认空库才初始化：SELECT 成功且空表时写入初始账本', () => {
  const db = fakeNativeSqlite(null)
  withPlus(db.makeFacade(), () => {
    bootAppLedger()
    assert.equal(appStorageState().ok, true)
    assert.ok(db.state.payload, '确认空库后应初始化')
    assert.equal(appLedger().getStock('A1')!.qty, 0)
  })
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

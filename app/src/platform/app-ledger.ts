import { Ledger } from '../ledger/operations.ts'
import { MemorySqlite, SqliteJsonStore, type SqlExec, type SqlQuery } from '../ledger/sqlite-json.ts'
import { freshEnvelope, LedgerStore, memorySink, PersistError, type PersistSink } from '../ledger/store.ts'
import type { Envelope } from '../ledger/types.ts'

/** 启动期读取失败（区别于运行期写入失败）：绝不据此初始化覆盖原库。 */
export class BootReadError extends Error {
  constructor(message: string) {
    super('boot-read:' + message)
    this.name = 'BootReadError'
  }
}

const DB_NAME = 'pindou'
const DB_PATH = '_doc/pindou.db'

type PlusSqlite = {
  openDatabase?: (opts: { name: string; path: string; success?: () => void; fail?: (err?: unknown) => void }) => void
  executeSql?: (opts: { name: string; sql: string | string[]; success?: () => void; fail?: (err?: unknown) => void }) => void
  selectSql?: (opts: { name: string; sql: string; success?: (rows?: unknown) => void; fail?: (err?: unknown) => void }) => void
  transaction?: (opts: { name: string; operation: 'begin' | 'commit' | 'rollback'; success?: () => void; fail?: (err?: unknown) => void }) => void
}

type Capture = { settled: boolean; ok: boolean; rows?: unknown; err?: unknown }

/**
 * plus.sqlite 属 DCloud 5+ 同步桥接模块（回调在调用返回前触发）。这里对每个
 * 原生调用做同步结果捕获；若回调未同步触发（平台差异），按「结果未确认」
 * 失败处理——宁可向用户报错，也不留下伪成功状态。真机验收会复核这一假设。
 */
function captureCall(invoke: (cb: { success: (rows?: unknown) => void; fail: (err?: unknown) => void }) => void): Capture {
  const cap: Capture = { settled: false, ok: false }
  invoke({
    success: (rows?: unknown) => {
      cap.settled = true
      cap.ok = true
      cap.rows = rows
    },
    fail: (err?: unknown) => {
      cap.settled = true
      cap.ok = false
      cap.err = err
    },
  })
  return cap
}

function quote(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'"
}

/**
 * Android 正式持久化：每一笔提交经 begin → [DELETE, INSERT] → commit 写入真实
 * SQLite，任何一步失败或未确认都 rollback 并抛 PersistError。读取只信真实
 * SELECT：确认空库才允许初始化；SELECT 失败抛 BootReadError，由启动流程转入
 * 不可用状态，绝不用空内存账本覆盖原库。
 */
export class PlusSqliteSink implements PersistSink {
  private sqlite: PlusSqlite

  constructor(sqlite: PlusSqlite) {
    if (
      typeof sqlite?.openDatabase !== 'function' ||
      typeof sqlite?.executeSql !== 'function' ||
      typeof sqlite?.selectSql !== 'function' ||
      typeof sqlite?.transaction !== 'function'
    ) {
      throw new BootReadError('sqlite 接口不完整')
    }
    this.sqlite = sqlite
    const opened = captureCall((cb) => sqlite.openDatabase!({ name: DB_NAME, path: DB_PATH, ...cb }))
    if (!opened.settled) throw new BootReadError('打开数据库结果未确认')
    if (!opened.ok) throw new BootReadError('打开数据库失败')
    const created = captureCall((cb) =>
      sqlite.executeSql!({ name: DB_NAME, sql: 'CREATE TABLE IF NOT EXISTS pindou_ledger (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)', ...cb }),
    )
    if (!created.settled) throw new BootReadError('建表结果未确认')
    if (!created.ok) throw new BootReadError('建表失败')
  }

  read(): Envelope | null {
    const r = captureCall((cb) => this.sqlite.selectSql!({ name: DB_NAME, sql: 'SELECT payload FROM pindou_ledger WHERE id = 1', ...cb }))
    if (!r.settled) throw new BootReadError('读取账本结果未确认')
    if (!r.ok) throw new BootReadError('读取账本失败')
    const rows = Array.isArray(r.rows) ? r.rows : []
    if (rows.length === 0) return null
    const row = rows[0]
    const payload = typeof row === 'string' ? row : row && (row as { payload?: string }).payload
    if (!payload) return null
    return JSON.parse(String(payload)) as Envelope
  }

  write(envelope: Envelope): void {
    const payload = JSON.stringify(envelope)
    const begin = captureCall((cb) => this.sqlite.transaction!({ name: DB_NAME, operation: 'begin', ...cb }))
    let stage = ''
    if (begin.settled && begin.ok) {
      const mutated = captureCall((cb) =>
        this.sqlite.executeSql!({
          name: DB_NAME,
          sql: ['DELETE FROM pindou_ledger WHERE id = 1', 'INSERT INTO pindou_ledger (id, payload) VALUES (1, ' + quote(payload) + ')'],
          ...cb,
        }),
      )
      if (mutated.settled && mutated.ok) {
        const committed = captureCall((cb) => this.sqlite.transaction!({ name: DB_NAME, operation: 'commit', ...cb }))
        if (committed.settled && committed.ok) return
        stage = committed.settled ? 'commit 失败' : 'commit 结果未确认'
      } else {
        stage = mutated.settled ? '写入失败' : '写入结果未确认'
      }
    } else {
      stage = begin.settled ? '开启事务失败' : '开启事务结果未确认'
    }
    captureCall((cb) => this.sqlite.transaction!({ name: DB_NAME, operation: 'rollback', ...cb }))
    throw new PersistError('本机数据库' + stage)
  }
}

let instance: Ledger | null = null
let injected: PersistSink | null = null
let bootError: string | null = null
const fallbackSlot: { json: string | null } = { json: null }

export function createSqliteJsonSink(driver: { executeSql: SqlExec; selectSql: SqlQuery }): PersistSink {
  const store = new SqliteJsonStore(driver)
  store.ensureSchema()
  return store
}

function plusSqlite(): PlusSqlite | null {
  const p = (globalThis as { plus?: { sqlite?: PlusSqlite } }).plus
  return p?.sqlite ?? null
}

export function appStorageState(): { ok: boolean; message: string | null } {
  return { ok: bootError === null, message: bootError }
}

export function defaultAppSink(): PersistSink {
  if (injected) return injected
  const sqlite = plusSqlite()
  if (sqlite) return new PlusSqliteSink(sqlite)
  return memorySink(fallbackSlot)
}

export function setAppPersistSink(sink: PersistSink | null): void {
  injected = sink
  instance = null
  bootError = null
}

export function createAppLedger(sink?: PersistSink): Ledger {
  const used = sink ?? defaultAppSink()
  return new Ledger(LedgerStore.hydrate(used))
}

/**
 * 启动：读取与后续写入使用同一个真实适配器。读取失败进入不可用状态——
 * 不初始化、不写入，保留原库，由页面展示错误并提供重试。
 */
export function bootAppLedger(done?: () => void): void {
  bootError = null
  try {
    instance = createAppLedger()
  } catch (err) {
    if (err instanceof BootReadError || err instanceof PersistError) {
      bootError = '账本存储读取失败，原有数据未做任何改动。请检查存储权限或重启应用后，在页面上点重试。'
      instance = null
    } else {
      throw err
    }
  }
  done?.()
}

export function retryAppStorage(done?: () => void): void {
  bootAppLedger(done)
}

/** 降级账本：可读空账、所有写入抛 PersistError；不静默充当可编辑临时账本。 */
const unavailableSink: PersistSink = {
  read: () => null,
  write: () => {
    throw new PersistError('账本存储不可用')
  },
}

export function appLedger(): Ledger {
  if (!instance) {
    if (bootError === null) bootAppLedger()
    if (!instance) instance = new Ledger(new LedgerStore(freshEnvelope(), unavailableSink))
  }
  return instance
}

export function newRequestId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return 'req-' + Date.now() + '-' + Math.random().toString(16).slice(2)
}

export { SqliteJsonStore, MemorySqlite }

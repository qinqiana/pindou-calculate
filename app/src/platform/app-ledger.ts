import { Ledger } from '../ledger/operations.ts'
import { MemorySqlite, SqliteJsonStore, type SqlExec, type SqlQuery } from '../ledger/sqlite-json.ts'
import { freshEnvelope, InvalidEnvelopeError, LedgerStore, parseEnvelope, PersistError, type PersistSink } from '../ledger/store.ts'
import { androidCall } from './android.ts'
import type { Envelope } from '../ledger/types.ts'
import { pickPlatformThumbnail } from './image.ts'

/** 启动期读取失败（区别于运行期写入失败）：绝不据此初始化覆盖原库。 */
export class BootReadError extends Error {
  constructor(message: string) {
    super('boot-read:' + message)
    this.name = 'BootReadError'
  }
}

/** Android owns the SQLite transaction; the call returns only after commit. */
export class AndroidSqliteSink implements PersistSink {
  read(): Envelope | null {
    const result = androidCall<string | null>('readLedger')
    if (!result.ok) throw new BootReadError(result.message)
    if (result.value === null) return null
    try { return parseEnvelope(JSON.parse(result.value)) }
    catch { throw new BootReadError('本机账本格式或结构无效') }
  }

  write(envelope: Envelope): void {
    const result = androidCall<boolean>('writeLedger', { text: JSON.stringify(envelope) })
    if (!result.ok || result.value !== true) throw new PersistError(result.ok ? '保存未确认' : result.message)
  }
}

let instance: Ledger | null = null
let injected: PersistSink | null = null
let bootError: string | null = null
let booting = false
let bootPromise: Promise<void> | null = null

export function createSqliteJsonSink(driver: { executeSql: SqlExec; selectSql: SqlQuery }): PersistSink {
  const store = new SqliteJsonStore(driver)
  store.ensureSchema()
  return store
}

export function appStorageState(): { ok: boolean; message: string | null } {
  return { ok: !booting && bootError === null, message: bootError }
}

export function defaultAppSink(): PersistSink {
  return injected ?? new AndroidSqliteSink()
}

export function setAppPersistSink(sink: PersistSink | null): void {
  injected = sink
  instance = null
  bootError = null
  booting = false
  bootPromise = null
}

export function createAppLedger(sink?: PersistSink): Ledger {
  const used = sink ?? defaultAppSink()
  return new Ledger(LedgerStore.hydrate(used), undefined, pickPlatformThumbnail)
}

/**
 * 启动：读取与后续写入使用同一个真实适配器。读取失败进入不可用状态——
 * 不初始化、不写入，保留原库，由页面展示错误并提供重试。
 */
export function bootAppLedger(done?: () => void): Promise<void> {
  if (bootPromise) return bootPromise
  if (instance && bootError === null) {
    done?.()
    return Promise.resolve()
  }
  bootError = null
  booting = true
  const current = (async () => {
    try {
      const sink = await defaultAppSink()
      instance = new Ledger(LedgerStore.hydrate(sink), undefined, pickPlatformThumbnail)
    } catch (err) {
      if (err instanceof BootReadError || err instanceof PersistError || err instanceof InvalidEnvelopeError) {
        bootError = '账本存储读取失败，原有数据未做任何改动。请检查存储权限或重启应用后，在页面上点重试。'
        instance = null
      } else {
        throw err
      }
    } finally {
      booting = false
      bootPromise = null
      done?.()
    }
  })()
  bootPromise = current
  return current
}

export function retryAppStorage(done?: () => void): Promise<void> {
  return bootAppLedger(done)
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
    if (bootError === null && !booting) void bootAppLedger()
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

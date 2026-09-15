import { Ledger } from '../ledger/operations.ts'
import { MemorySqlite, SqliteJsonStore, type SqlExec, type SqlQuery } from '../ledger/sqlite-json.ts'
import { LedgerStore, memorySink, type PersistSink } from '../ledger/store.ts'

let instance: Ledger | null = null
let injected: PersistSink | null = null
const fallbackSlot: { json: string | null } = { json: null }
const plusEngines = new WeakMap<object, MemorySqlite>()

type PlusSqlite = {
  openDatabase?: (opts: { name: string; path: string }) => void
  executeSql?: (opts: {
    name: string
    sql: string
    success?: () => void
    fail?: (err?: unknown) => void
  }) => void
  selectSql?: (opts: {
    name: string
    sql: string
    success?: (rows: unknown) => void
    fail?: (err?: unknown) => void
  }) => void
}

export function createSqliteJsonSink(driver: { executeSql: SqlExec; selectSql: SqlQuery }): PersistSink {
  const store = new SqliteJsonStore(driver)
  store.ensureSchema()
  return store
}

function engineFor(sqlite: object): MemorySqlite {
  let engine = plusEngines.get(sqlite)
  if (!engine) {
    engine = new MemorySqlite()
    plusEngines.set(sqlite, engine)
  }
  return engine
}

function bindSql(sql: string, values?: unknown[]): string {
  if (!values || !values.length) return sql
  return sql.replace('?', "'" + String(values[0]).replace(/'/g, "''") + "'")
}

function runPlusTransaction(sqlite: PlusSqlite, payload: string | null): void {
  const name = 'pindou'
  const fail = () => sqlite.executeSql?.({ name, sql: 'ROLLBACK' })
  sqlite.executeSql?.({
    name,
    sql: 'BEGIN TRANSACTION',
    success: () => {
      sqlite.executeSql?.({
        name,
        sql: 'DELETE FROM pindou_ledger WHERE id = 1',
        success: () => {
          sqlite.executeSql?.({
            name,
            sql: bindSql('INSERT INTO pindou_ledger (id, payload) VALUES (1, ?)', [payload ?? '']),
            success: () => {
              sqlite.executeSql?.({ name, sql: 'COMMIT', fail })
            },
            fail,
          })
        },
        fail,
      })
    },
    fail,
  })
}

function plusSqliteSink(): PersistSink | null {
  const plusObj = (globalThis as { plus?: { sqlite?: PlusSqlite } }).plus
  const sqlite = plusObj?.sqlite
  if (!sqlite || typeof sqlite.executeSql !== 'function') return null
  try {
    sqlite.openDatabase?.({ name: 'pindou', path: '_doc/pindou.db' })
    sqlite.executeSql?.({
      name: 'pindou',
      sql: 'CREATE TABLE IF NOT EXISTS pindou_ledger (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)',
    })
  } catch {
    /* engine still accepts local SELECT */
  }
  const engine = engineFor(sqlite)
  return createSqliteJsonSink({
    executeSql(sql: string, values?: unknown[]) {
      engine.executeSql(sql, values)
      if (/^COMMIT/i.test(sql.trim())) runPlusTransaction(sqlite, engine.table.payload)
    },
    selectSql() {
      return engine.selectSql()
    },
  })
}

export function defaultAppSink(): PersistSink {
  if (injected) return injected
  return plusSqliteSink() ?? memorySink(fallbackSlot)
}

export function setAppPersistSink(sink: PersistSink | null): void {
  injected = sink
  instance = null
}

export function createAppLedger(sink?: PersistSink): Ledger {
  const used = sink ?? defaultAppSink()
  return new Ledger(LedgerStore.hydrate(used))
}

export function bootAppLedger(done?: () => void): void {
  const plusObj = (globalThis as { plus?: { sqlite?: PlusSqlite } }).plus
  const sqlite = plusObj?.sqlite
  if (!sqlite || typeof sqlite.selectSql !== 'function') {
    instance = createAppLedger()
    done?.()
    return
  }
  sqlite.openDatabase?.({ name: 'pindou', path: '_doc/pindou.db' })
  sqlite.executeSql?.({
    name: 'pindou',
    sql: 'CREATE TABLE IF NOT EXISTS pindou_ledger (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)',
  })
  sqlite.selectSql?.({
    name: 'pindou',
    sql: 'SELECT payload FROM pindou_ledger WHERE id = 1',
    success: (rows) => {
      const engine = engineFor(sqlite)
      const list = Array.isArray(rows) ? rows : (rows as { data?: unknown[] })?.data
      const row = list && list[0]
      const payload = typeof row === 'string' ? row : row && (row as { payload?: string }).payload
      if (payload) engine.table.payload = payload
      instance = createAppLedger(createSqliteJsonSink(engine))
      done?.()
    },
    fail: () => {
      instance = createAppLedger()
      done?.()
    },
  })
}

export function appLedger(): Ledger {
  if (!instance) instance = createAppLedger()
  return instance
}

export function newRequestId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return 'req-' + Date.now() + '-' + Math.random().toString(16).slice(2)
}

export { SqliteJsonStore, MemorySqlite }

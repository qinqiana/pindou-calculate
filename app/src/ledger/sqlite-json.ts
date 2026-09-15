import { clone } from './numbers.ts'
import { freshEnvelope, type InterruptStage, type PersistSink } from './store.ts'
import type { Envelope, LedgerState } from './types.ts'

export type SqlExec = (sql: string, values?: unknown[]) => void
export type SqlQuery = (sql: string, values?: unknown[]) => { data?: unknown[] }

export type SqlitePayloadTable = { payload: string | null }

/** In-memory SQLite stand-in: BEGIN/COMMIT/ROLLBACK actually isolate writes until commit. */
export class MemorySqlite {
  table: SqlitePayloadTable
  private tx: { payload: string | null } | null = null

  constructor(table?: SqlitePayloadTable) {
    this.table = table ?? { payload: null }
  }

  executeSql(sql: string, values?: unknown[]): void {
    const s = sql.trim()
    if (/^CREATE/i.test(s)) return
    if (/^BEGIN/i.test(s)) {
      if (this.tx) throw new Error('nested transaction')
      this.tx = { payload: this.table.payload }
      return
    }
    if (/^COMMIT/i.test(s)) {
      if (!this.tx) throw new Error('COMMIT without BEGIN')
      this.table.payload = this.tx.payload
      this.tx = null
      return
    }
    if (/^ROLLBACK/i.test(s)) {
      this.tx = null
      return
    }
    const setPayload = (value: string | null) => {
      if (this.tx) this.tx.payload = value
      else this.table.payload = value
    }
    if (/^DELETE/i.test(s)) {
      setPayload(null)
      return
    }
    if ((/^INSERT/i.test(s) || /^UPDATE/i.test(s)) && values && values.length) {
      setPayload(String(values[0]))
    }
  }

  selectSql(): { data?: unknown[] } {
    const payload = this.tx ? this.tx.payload : this.table.payload
    return { data: payload != null && payload !== '' ? [payload] : [] }
  }
}

export function mapSqliteDriver(table: SqlitePayloadTable): MemorySqlite {
  return new MemorySqlite(table)
}

export class SqliteJsonStore implements PersistSink {
  private driver: { executeSql: SqlExec; selectSql: SqlQuery }
  private draft: Envelope | null = null
  interrupt: InterruptStage = 'none'

  constructor(driver: { executeSql: SqlExec; selectSql: SqlQuery }) {
    this.driver = driver
  }

  begin(): void {
    this.driver.executeSql('BEGIN TRANSACTION')
    this.draft = clone(this.readEnvelope())
  }

  commit(): void {
    if (!this.draft) throw new Error('commit without begin')
    this.driver.executeSql('UPDATE pindou_ledger SET payload = ? WHERE id = 1', [JSON.stringify(this.draft)])
    this.driver.executeSql('COMMIT')
    this.draft = null
  }

  rollback(): void {
    this.driver.executeSql('ROLLBACK')
    this.draft = null
  }

  ensureSchema(): void {
    this.driver.executeSql(
      'CREATE TABLE IF NOT EXISTS pindou_ledger (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)',
    )
    const rows = this.driver.selectSql('SELECT payload FROM pindou_ledger WHERE id = 1')
    if (!rows.data || rows.data.length === 0) {
      this.driver.executeSql('BEGIN TRANSACTION')
      this.driver.executeSql('INSERT INTO pindou_ledger (id, payload) VALUES (1, ?)', [JSON.stringify(freshEnvelope())])
      this.driver.executeSql('COMMIT')
    }
  }

  executeTransaction(work: (env: Envelope) => void): void {
    this.begin()
    try {
      if (this.interrupt === 'before-commit') {
        this.interrupt = 'none'
        this.rollback()
        throw new Error('interrupt:before-commit')
      }
      work(this.draft!)
      this.commit()
    } catch (err) {
      try {
        this.rollback()
      } catch {
        /* already rolled back */
      }
      throw err
    }
  }

  readEnvelope(): Envelope {
    const rows = this.driver.selectSql('SELECT payload FROM pindou_ledger WHERE id = 1')
    const row = rows.data && rows.data[0]
    const payload = typeof row === 'string' ? row : row && (row as { payload?: string }).payload
    if (!payload) return freshEnvelope()
    return JSON.parse(String(payload)) as Envelope
  }

  live(): LedgerState {
    return this.readEnvelope().live
  }

  read(): Envelope | null {
    const rows = this.driver.selectSql('SELECT payload FROM pindou_ledger WHERE id = 1')
    if (!rows.data || rows.data.length === 0) return null
    const row = rows.data[0]
    const payload = typeof row === 'string' ? row : row && (row as { payload?: string }).payload
    if (!payload) return null
    return JSON.parse(String(payload)) as Envelope
  }

  write(envelope: Envelope): void {
    this.ensureSchema()
    this.driver.executeSql('BEGIN TRANSACTION')
    try {
      this.driver.executeSql('DELETE FROM pindou_ledger WHERE id = 1')
      this.driver.executeSql('INSERT INTO pindou_ledger (id, payload) VALUES (1, ?)', [JSON.stringify(envelope)])
      this.driver.executeSql('COMMIT')
    } catch (err) {
      try {
        this.driver.executeSql('ROLLBACK')
      } catch {
        /* ignore */
      }
      throw err
    }
  }
}

import { PALETTE, COLOR_CODES } from './catalog.ts'
import { clone, DEFAULT_LOW_STOCK_PERCENT } from './numbers.ts'
import type { Envelope, LedgerState, StockRow } from './types.ts'

export type InterruptStage = 'none' | 'before-commit' | 'restore-prepare' | 'restore-write' | 'restore-switch'

/** 持久化写入失败（区别于中断演练）；上层据此报错并保持可见状态一致。 */
export class PersistError extends Error {
  constructor(message: string) {
    super('persist:' + message)
    this.name = 'PersistError'
  }
}

export function isPersistError(err: unknown): err is PersistError {
  return err instanceof PersistError
}

export type PersistSink = {
  read(): Envelope | null
  write(envelope: Envelope): void
}

export function emptyStock(): Record<string, StockRow> {
  const stock: Record<string, StockRow> = {}
  for (const code of COLOR_CODES) {
    stock[code] = { code, qty: 0, estimated: true, baseline: null, entered: false }
  }
  return stock
}

export function freshState(): LedgerState {
  return {
    epoch: 1,
    seq: 0,
    palette: clone(PALETTE),
    settings: { lowStockPercent: DEFAULT_LOW_STOCK_PERCENT },
    stock: emptyStock(),
    operations: [],
    movements: [],
    patterns: [],
    confirmedUsages: [],
    drafts: [],
    makes: [],
    requests: [],
  }
}

export function freshEnvelope(): Envelope {
  return { pointer: 'live', live: freshState(), pending: null }
}

export class LedgerStore {
  envelope: Envelope
  sink: PersistSink | null
  interrupt: InterruptStage = 'none'

  constructor(envelope?: Envelope, sink?: PersistSink | null) {
    this.envelope = envelope ? envelope : freshEnvelope()
    this.sink = sink ?? null
  }

  static hydrate(sink: PersistSink): LedgerStore {
    const loaded = sink.read()
    const store = new LedgerStore(loaded ?? freshEnvelope(), sink)
    if (!loaded) store.persist()
    else store.recoverPointer()
    return store
  }

  recoverPointer(): void {
    if (this.envelope.pointer === 'pending' && this.envelope.pending && isCompleteState(this.envelope.pending)) {
      this.envelope.live = this.envelope.pending
      this.envelope.pending = null
      this.envelope.pointer = 'live'
      this.persist()
    } else if (this.envelope.pointer === 'pending') {
      this.envelope.pending = null
      this.envelope.pointer = 'live'
      this.persist()
    }
  }

  live(): LedgerState {
    return this.envelope.live
  }

  snapshot(): LedgerState {
    return clone(this.envelope.live)
  }

  commit(mutator: (state: LedgerState) => void): LedgerState {
    const next = clone(this.envelope.live)
    mutator(next)
    if (this.interrupt === 'before-commit') {
      this.interrupt = 'none'
      throw new Error('interrupt:before-commit')
    }
    // 先持久化、后改可见状态：写入失败时可见账本保持原样，不出现伪成功。
    const candidate: Envelope = { pointer: 'live', live: next, pending: null }
    if (this.sink) this.sink.write(candidate)
    this.envelope = candidate
    return this.envelope.live
  }

  replaceLive(next: LedgerState, stage?: InterruptStage): void {
    const use = stage ?? this.interrupt
    if (use === 'restore-prepare') {
      this.interrupt = 'none'
      throw new Error('interrupt:restore-prepare')
    }
    const prepared = clone(next)
    const original = clone(this.envelope)
    try {
      if (use === 'restore-write') {
        this.envelope.pending = { seq: -1 } as LedgerState
        this.envelope.pointer = 'pending'
        this.persist()
        this.interrupt = 'none'
        throw new Error('interrupt:restore-write')
      }
      this.envelope.pending = prepared
      if (use === 'restore-switch') {
        this.envelope.pointer = 'pending'
        this.persist()
        this.interrupt = 'none'
        throw new Error('interrupt:restore-switch')
      }
      this.envelope.live = prepared
      this.envelope.pending = null
      this.envelope.pointer = 'live'
      this.persist()
    } catch (err) {
      // 中断演练按原语义抛出；真实写入失败则把可见状态回滚到恢复前。
      if (isPersistError(err)) this.envelope = original
      throw err
    }
  }

  /** 取消恢复：先落盘再改可见状态，失败时 pending 保持原样。 */
  abortPending(): void {
    const candidate: Envelope = { pointer: 'live', live: this.envelope.live, pending: null }
    if (this.sink) this.sink.write(candidate)
    this.envelope = candidate
  }

  persist(): void {
    if (!this.sink) return
    this.sink.write(this.envelope)
  }
}

function isCompleteState(state: LedgerState): boolean {
  return !!(state && state.stock && state.operations && state.settings && state.palette)
}

export function memorySink(slot: { json: string | null }): PersistSink {
  return {
    read() {
      if (!slot.json) return null
      return JSON.parse(slot.json) as Envelope
    },
    write(envelope: Envelope) {
      slot.json = JSON.stringify(envelope)
    },
  }
}

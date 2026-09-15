import { PALETTE, COLOR_CODES } from './catalog.ts'
import { clone, DEFAULT_LOW_STOCK_PERCENT } from './numbers.ts'
import type { Envelope, LedgerState, StockRow } from './types.ts'

export type InterruptStage = 'none' | 'before-commit' | 'restore-prepare' | 'restore-write' | 'restore-switch'

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
    this.envelope.live = next
    this.envelope.pending = null
    this.envelope.pointer = 'live'
    this.persist()
    return this.envelope.live
  }

  replaceLive(next: LedgerState, stage?: InterruptStage): void {
    const use = stage ?? this.interrupt
    if (use === 'restore-prepare') {
      this.interrupt = 'none'
      throw new Error('interrupt:restore-prepare')
    }
    const prepared = clone(next)
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

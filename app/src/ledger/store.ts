import { PALETTE, COLOR_CODES, COLOR_SET, type Palette } from './catalog.ts'
import { clone, DEFAULT_LOW_STOCK_PERCENT, MAX_QTY } from './numbers.ts'
import { validStoredRecognition } from './provenance.ts'
import type {
  ConfirmedUsage,
  DraftUsage,
  Envelope,
  LedgerState,
  MakeRecord,
  Movement,
  Operation,
  Pattern,
  RequestRecord,
  StockRow,
  UsageLine,
} from './types.ts'

export type InterruptStage = 'none' | 'before-commit' | 'restore-prepare' | 'restore-write' | 'restore-switch'

/** 持久化写入失败（区别于中断演练）；上层据此报错并保持可见状态一致。 */
export class PersistError extends Error {
  constructor(message: string) {
    super('persist:' + message)
    this.name = 'PersistError'
  }
}

/** 持久化内容是合法 JSON 但不是本应用账本时，禁止继续启动。 */
export class InvalidEnvelopeError extends Error {
  constructor(message: string) {
    super('invalid-envelope:' + message)
    this.name = 'InvalidEnvelopeError'
  }
}

export function isPersistError(err: unknown): err is PersistError {
  return err instanceof PersistError
}

export type PersistSink = {
  read(): Envelope | null
  write(envelope: Envelope): void
}

type RecordLike = Record<string, unknown>

function record(value: unknown): RecordLike | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordLike) : null
}

function text(value: unknown, allowEmpty = true): boolean {
  return typeof value === 'string' && (allowEmpty || value.length > 0)
}

function safeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function nonNegativeInt(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return safeInt(value) && value >= 0 && value <= max
}

function nullableQty(value: unknown): boolean {
  return value === null || nonNegativeInt(value, MAX_QTY)
}

function validColor(value: unknown): value is string {
  return typeof value === 'string' && COLOR_SET.has(value)
}

function validPalette(value: unknown): value is Palette {
  const p = record(value)
  if (!p || !text(p.id, false) || !text(p.label, false) || !text(p.sourceName) || !text(p.sourceUrl) || !text(p.acquiredAt) || !text(p.disclaimer)) return false
  if (!Array.isArray(p.colors) || p.colors.length !== COLOR_CODES.length) return false
  const seen = new Set<string>()
  for (const raw of p.colors) {
    const color = record(raw)
    if (!color || !validColor(color.code) || seen.has(color.code as string) || !text(color.group, false) || !/^#[0-9a-fA-F]{6}$/.test(String(color.hex))) return false
    if (![color.r, color.g, color.b].every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255)) return false
    seen.add(color.code as string)
  }
  return seen.size === COLOR_CODES.length
}

function validStockRow(value: unknown): value is StockRow {
  const row = record(value)
  return !!row && validColor(row.code) && nonNegativeInt(row.qty, MAX_QTY) && typeof row.estimated === 'boolean' && nullableQty(row.baseline) && typeof row.entered === 'boolean'
}

function validUsageLine(value: unknown): value is UsageLine {
  const line = record(value)
  return !!line && validColor(line.code) && nonNegativeInt(line.qty, MAX_QTY)
}

function validUsageLines(value: unknown): value is UsageLine[] {
  if (!Array.isArray(value)) return false
  const seen = new Set<string>()
  for (const line of value) {
    if (!validUsageLine(line) || seen.has(line.code)) return false
    seen.add(line.code)
  }
  return true
}

function validOperation(value: unknown): value is Operation {
  const op = record(value)
  const types = new Set(['first-entry', 'count', 'restock', 'flag', 'make', 'void-make', 'settings', 'create-pattern', 'pattern-meta', 'confirm-usage', 'archive-pattern', 'restore'])
  return !!op && text(op.id, false) && types.has(String(op.type)) && text(op.at, false) && nonNegativeInt(op.seq) && text(op.requestId, false) && text(op.reason) && (op.patternId === undefined || text(op.patternId, false)) && (op.makeId === undefined || text(op.makeId, false))
}

function validMovement(value: unknown): value is Movement {
  const movement = record(value)
  return !!movement && text(movement.operationId, false) && validColor(movement.code) && nonNegativeInt(movement.qtyBefore, MAX_QTY) && nonNegativeInt(movement.qtyAfter, MAX_QTY) && safeInt(movement.delta) && movement.delta === (movement.qtyAfter as number) - (movement.qtyBefore as number) && typeof movement.estimatedBefore === 'boolean' && typeof movement.estimatedAfter === 'boolean' && nullableQty(movement.baselineBefore) && nullableQty(movement.baselineAfter)
}

function validThumbnail(value: unknown): boolean {
  const thumbnail = record(value)
  if (!thumbnail || (thumbnail.mime !== 'image/png' && thumbnail.mime !== 'image/jpeg') || typeof thumbnail.base64 !== 'string' || thumbnail.base64.length === 0) return false
  if (thumbnail.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(thumbnail.base64)) return false
  return true
}

function validPattern(value: unknown): value is Pattern {
  const pattern = record(value)
  return !!pattern && text(pattern.id, false) && text(pattern.name, false) && text(pattern.sourceNote) && (pattern.pixelWidth === null || nonNegativeInt(pattern.pixelWidth)) && (pattern.pixelHeight === null || nonNegativeInt(pattern.pixelHeight)) && text(pattern.sizeNote) && validThumbnail(pattern.thumbnail) && (pattern.confirmedVersion === null || nonNegativeInt(pattern.confirmedVersion)) && nonNegativeInt(pattern.createdSeq) && (pattern.archivedAt === undefined || pattern.archivedAt === null || text(pattern.archivedAt, false))
}

function validConfirmedUsage(value: unknown): value is ConfirmedUsage {
  const usage = record(value)
  if (!usage || !text(usage.patternId, false) || !nonNegativeInt(usage.version) || !validUsageLines(usage.lines) || !text(usage.confirmedAt, false) || (usage.titleTotal !== null && !nonNegativeInt(usage.titleTotal)) || (usage.titleDiff !== null && !safeInt(usage.titleDiff)) || typeof usage.titleDiffAcknowledged !== 'boolean' || !Array.isArray(usage.rejectedItems)) return false
  if (usage.rejectedItems.length > 512 || !usage.rejectedItems.every((item) => {
    const rejected = record(item)
    return !!rejected && text(rejected.raw) && rejected.raw.length <= 1000 && (rejected.qty === null || nonNegativeInt(rejected.qty, MAX_QTY)) && text(rejected.note) && rejected.note.length <= 1000
  })) return false
  if (usage.inputMethod === 'manual') return usage.recognition === undefined || usage.recognition === null
  if (usage.inputMethod !== 'legend' && usage.inputMethod !== 'grid' && usage.inputMethod !== 'assisted') return false
  return !!usage.recognition && usage.recognition.source === usage.inputMethod && validStoredRecognition(usage.recognition, usage.lines, usage.titleTotal)
}

function validDraft(value: unknown): value is DraftUsage {
  const draft = record(value)
  return !!draft && text(draft.patternId, false) && validUsageLines(draft.lines) && (draft.titleTotal === null || nonNegativeInt(draft.titleTotal))
}

function validMake(value: unknown): value is MakeRecord {
  const make = record(value)
  return !!make && text(make.id, false) && text(make.patternId, false) && nonNegativeInt(make.usageVersion) && text(make.nameSnapshot) && text(make.sourceNoteSnapshot) && validUsageLines(make.linesSnapshot) && text(make.completedAt, false) && typeof make.voided === 'boolean' && (make.voidedAt === null || text(make.voidedAt, false)) && text(make.requestId, false)
}

function validRequest(value: unknown): value is RequestRecord {
  const request = record(value)
  const result = record(request?.result)
  return !!request && text(request.requestId, false) && text(request.payloadCanonical, false) && !!result && result.ok === true && text(result.requestId, false) && text(result.operationId, false) && nonNegativeInt(result.seq)
}

/** 返回人类可读的结构错误；持久化读取和备份恢复共用这套底线校验。 */
export function validateLedgerState(value: unknown): string | null {
  const state = record(value)
  if (!state) return '账本状态不是对象'
  if (!nonNegativeInt(state.epoch) || !nonNegativeInt(state.seq)) return '账本序号无效'
  if (!validPalette(state.palette)) return '账本色卡无效'
  const settings = record(state.settings)
  if (!settings || !nonNegativeInt(settings.lowStockPercent, 100)) return '账本设置无效'
  const stock = record(state.stock)
  if (!stock || COLOR_CODES.some((code) => !validStockRow(stock[code]) || (stock[code] as StockRow).code !== code)) return '账本库存无效'
  if (!Array.isArray(state.operations) || !state.operations.every(validOperation)) return '账本操作记录无效'
  if (!Array.isArray(state.movements) || !state.movements.every(validMovement)) return '账本变动记录无效'
  if (!Array.isArray(state.patterns) || !state.patterns.every(validPattern)) return '账本图纸记录无效'
  if (!Array.isArray(state.confirmedUsages) || !state.confirmedUsages.every(validConfirmedUsage)) return '账本确认用量无效'
  if (!Array.isArray(state.drafts) || !state.drafts.every(validDraft)) return '账本草稿无效'
  if (!Array.isArray(state.makes) || !state.makes.every(validMake)) return '账本制作记录无效'
  if (!Array.isArray(state.requests) || !state.requests.every(validRequest)) return '账本请求记录无效'

  const patternIds = new Set((state.patterns as Pattern[]).map((p) => p.id))
  if (patternIds.size !== (state.patterns as Pattern[]).length) return '账本图纸标识重复'
  if ((state.confirmedUsages as ConfirmedUsage[]).some((u) => !patternIds.has(u.patternId)) || (state.drafts as DraftUsage[]).some((d) => !patternIds.has(d.patternId)) || (state.makes as MakeRecord[]).some((m) => !patternIds.has(m.patternId))) return '账本记录缺少图纸关联'
  const usageKeys = new Set<string>()
  for (const usage of state.confirmedUsages as ConfirmedUsage[]) {
    const key = usage.patternId + '/' + usage.version
    if (usage.version < 1 || usageKeys.has(key)) return '账本确认用量版次无效或重复'
    usageKeys.add(key)
  }
  if ((state.patterns as Pattern[]).some(p => p.confirmedVersion !== null && !usageKeys.has(p.id + '/' + p.confirmedVersion))) return '图纸缺少当前确认用量'
  if ((state.makes as MakeRecord[]).some(m => !usageKeys.has(m.patternId + '/' + m.usageVersion))) return '制作记录缺少当时确认用量'

  const operationIds = new Set((state.operations as Operation[]).map((o) => o.id))
  if (operationIds.size !== (state.operations as Operation[]).length) return '账本操作标识重复'
  if ((state.movements as Movement[]).some((m) => !operationIds.has(m.operationId))) return '账本变动缺少操作关联'
  const makeIds = new Set((state.makes as MakeRecord[]).map((m) => m.id))
  if (makeIds.size !== (state.makes as MakeRecord[]).length) return '账本制作标识重复'
  if ((state.operations as Operation[]).some((o) => o.patternId !== undefined && !patternIds.has(o.patternId)) || (state.operations as Operation[]).some((o) => o.makeId !== undefined && !makeIds.has(o.makeId))) return '账本操作关联无效'
  return null
}

export function validateEnvelope(value: unknown): string | null {
  const envelope = record(value)
  if (!envelope || (envelope.pointer !== 'live' && envelope.pointer !== 'pending')) return '账本指针无效'
  const liveError = validateLedgerState(envelope.live)
  if (liveError) return liveError
  if (envelope.pending !== null) {
    const pendingError = validateLedgerState(envelope.pending)
    if (pendingError) return '待提交账本无效：' + pendingError
  }
  if (envelope.pointer === 'pending' && envelope.pending === null) return '账本指针缺少待提交内容'
  return null
}

export function parseEnvelope(value: unknown): Envelope {
  const error = validateEnvelope(value)
  if (error) throw new InvalidEnvelopeError(error)
  return value as Envelope
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
    if (loaded) parseEnvelope(loaded)
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
      throw new InvalidEnvelopeError('待提交账本不完整，未自动清除')
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
        // 写入阶段只落完整候选，指针仍指向旧 live；重启时可安全保留旧账。
        this.envelope.pending = prepared
        this.envelope.pointer = 'live'
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
  return validateLedgerState(state) === null
}

export function memorySink(slot: { json: string | null }): PersistSink {
  return {
    read() {
      if (!slot.json) return null
      try {
        return parseEnvelope(JSON.parse(slot.json))
      } catch (err) {
        if (err instanceof InvalidEnvelopeError) throw err
        throw new InvalidEnvelopeError('账本 JSON 无效')
      }
    },
    write(envelope: Envelope) {
      slot.json = JSON.stringify(envelope)
    },
  }
}

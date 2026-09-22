import type { Palette } from './catalog.ts'

export type OperationType =
  | 'first-entry'
  | 'count'
  | 'restock'
  | 'flag'
  | 'make'
  | 'void-make'
  | 'settings'
  | 'create-pattern'
  | 'pattern-meta'
  | 'confirm-usage'
  | 'archive-pattern'
  | 'restore'

export type StockRow = {
  code: string
  qty: number
  estimated: boolean
  baseline: number | null
  entered: boolean
}

export type Operation = {
  id: string
  type: OperationType
  at: string
  seq: number
  requestId: string
  patternId?: string
  makeId?: string
  reason: string
}

export type Movement = {
  operationId: string
  code: string
  qtyBefore: number
  qtyAfter: number
  delta: number
  estimatedBefore: boolean
  estimatedAfter: boolean
  baselineBefore: number | null
  baselineAfter: number | null
}

export type Thumbnail = {
  mime: 'image/png' | 'image/jpeg'
  base64: string
}

export type Pattern = {
  id: string
  name: string
  sourceNote: string
  pixelWidth: number | null
  pixelHeight: number | null
  /** User-supplied 制作尺寸; empty means 未提供, never invented from pixels. */
  sizeNote: string
  thumbnail: Thumbnail
  confirmedVersion: number | null
  createdSeq: number
  /** 从主列表移除的时间；旧账本缺失时视为未归档。 */
  archivedAt?: string | null
}

export type UsageLine = { code: string; qty: number }

export type RejectedItem = { raw: string; qty: number | null; note: string }

export type RecognitionProvenance = {
  source: 'legend' | 'grid' | 'assisted'
  algorithmVersion: string
  originalStatus: 'ready' | 'partial'
  candidateLines: UsageLine[]
  candidateTitleTotal: number | null
  modified: boolean
  risks: { id: string; reason: string; raw: string; resolved: boolean }[]
  riskAcknowledged: boolean
}

export type ConfirmedUsage = {
  patternId: string
  version: number
  lines: UsageLine[]
  inputMethod: 'manual' | 'legend' | 'grid' | 'assisted'
  recognition?: RecognitionProvenance | null
  confirmedAt: string
  titleTotal: number | null
  titleDiff: number | null
  titleDiffAcknowledged: boolean
  rejectedItems: RejectedItem[]
}

export type DraftUsage = {
  patternId: string
  lines: UsageLine[]
  titleTotal: number | null
}

export type MakeRecord = {
  id: string
  patternId: string
  usageVersion: number
  nameSnapshot: string
  sourceNoteSnapshot: string
  linesSnapshot: UsageLine[]
  completedAt: string
  voided: boolean
  voidedAt: string | null
  requestId: string
}

export type Settings = {
  lowStockPercent: number
}

export type StoredResult = {
  ok: true
  requestId: string
  operationId: string
  seq: number
  patternId?: string
  makeId?: string
  version?: number
  perColorSum?: number
  difference?: number | null
}

export type RequestRecord = {
  requestId: string
  payloadCanonical: string
  result: StoredResult
}

export type LedgerState = {
  epoch: number
  seq: number
  palette: Palette
  settings: Settings
  stock: Record<string, StockRow>
  operations: Operation[]
  movements: Movement[]
  patterns: Pattern[]
  confirmedUsages: ConfirmedUsage[]
  drafts: DraftUsage[]
  makes: MakeRecord[]
  requests: RequestRecord[]
}

export type Envelope = {
  pointer: 'live' | 'pending'
  live: LedgerState
  pending: LedgerState | null
}

export type Fail = {
  ok: false
  code: string
  message: string
  colors?: string[]
  difference?: number
  titleTotal?: number | null
  perColorSum?: number
  gaps?: { code: string; need: number; have: number; gap: number }[]
}

export type Ok<T> = { ok: true } & T

export type BatchItem = {
  code: string
  qty: unknown
  estimated?: boolean
}

export type BatchPreviewLine = {
  code: string
  qtyBefore: number
  qtyAfter: number
  delta: number
  estimatedBefore: boolean
  estimatedAfter: boolean
  baselineBefore: number | null
  baselineAfter: number | null
  enteredBefore: boolean
}

export type GapLine = {
  code: string
  demand: number
  have: number
  gap: number
  remaining: number
}

export type BackupFile = {
  formatVersion: number
  exportedAt: string
  appVersion: string
  palette: Palette
  settings: Settings
  stock: StockRow[]
  operations: Operation[]
  movements: Movement[]
  patterns: Pattern[]
  confirmedUsages: ConfirmedUsage[]
  makes: MakeRecord[]
  requests: RequestRecord[]
  epoch: number
  seq: number
}

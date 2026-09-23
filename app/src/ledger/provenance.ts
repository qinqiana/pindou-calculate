import { COLOR_SET, compareColorCode, normalizeColorCode } from './catalog.ts'
import { MAX_QTY } from './numbers.ts'
import type { RecognitionProvenance, UsageLine } from './types.ts'

const MAX_ALGORITHM_VERSION = 100
const MAX_RISKS = 512
const MAX_RISK_ID = 100
const MAX_RISK_TEXT = 1000

type ProvenanceErrorCode = 'invalid-provenance' | 'recognition-risk'

export type ProvenanceResult =
  | { ok: true; value: RecognitionProvenance | null }
  | { ok: false; code: ProvenanceErrorCode; message: string }

type RecordLike = Record<string, unknown>

function record(value: unknown): RecordLike | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordLike) : null
}

function exactKeys(value: RecordLike, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function validQty(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_QTY
}

function parseCandidateLines(value: unknown): { ok: true; lines: UsageLine[] } | { ok: false; message: string } {
  if (!Array.isArray(value)) return { ok: false, message: '识别候选必须是列表' }
  if (value.length > 221) return { ok: false, message: '识别候选色号过多' }
  const seen = new Set<string>()
  const lines: UsageLine[] = []
  for (const item of value) {
    const line = record(item)
    if (!line || !exactKeys(line, ['code', 'qty']) || typeof line.code !== 'string' || !validQty(line.qty)) {
      return { ok: false, message: '识别候选用量无效' }
    }
    const code = normalizeColorCode(line.code)
    if (!code || !COLOR_SET.has(code)) return { ok: false, message: '识别候选含未知色号：' + line.code }
    if (seen.has(code)) return { ok: false, message: '识别候选色号重复：' + code }
    seen.add(code)
    lines.push({ code, qty: line.qty })
  }
  lines.sort((a, b) => compareColorCode(a.code, b.code))
  return { ok: true, lines }
}

function sameLines(left: UsageLine[], right: UsageLine[]): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (left[i].code !== right[i].code || left[i].qty !== right[i].qty) return false
  }
  return true
}

/** 校验并复制来源证据；传入最终用量时会重算 modified。 */
export function normalizeRecognition(
  input: unknown,
  finalLines?: UsageLine[],
  finalTitleTotal?: number | null,
): ProvenanceResult {
  if (input === undefined || input === null) return { ok: true, value: null }
  const source = record(input)
  if (!source || !exactKeys(source, ['source', 'algorithmVersion', 'originalStatus', 'candidateLines', 'candidateTitleTotal', 'modified', 'risks', 'riskAcknowledged'])) {
    return { ok: false, code: 'invalid-provenance', message: '识别来源证据格式无效' }
  }
  if (source.source !== 'legend' && source.source !== 'grid' && source.source !== 'assisted') {
    return { ok: false, code: 'invalid-provenance', message: '识别来源无效' }
  }
  if (typeof source.algorithmVersion !== 'string' || source.algorithmVersion.trim() === '' || source.algorithmVersion.length > MAX_ALGORITHM_VERSION) {
    return { ok: false, code: 'invalid-provenance', message: '识别算法版本无效' }
  }
  if (!['ready', 'partial', 'failed'].includes(source.originalStatus as string)) {
    return { ok: false, code: 'invalid-provenance', message: '原始识别状态无效' }
  }
  if (typeof source.modified !== 'boolean') return { ok: false, code: 'invalid-provenance', message: '识别修改标记无效' }
  if (typeof source.riskAcknowledged !== 'boolean') return { ok: false, code: 'invalid-provenance', message: '识别风险确认标记无效' }

  const candidates = parseCandidateLines(source.candidateLines)
  if (!candidates.ok) return { ok: false, code: 'invalid-provenance', message: candidates.message }
  if (source.originalStatus === 'failed'
    ? source.source !== 'assisted' || candidates.lines.length !== 0
    : candidates.lines.length === 0) {
    return { ok: false, code: 'invalid-provenance', message: '识别状态与原始候选不一致' }
  }
  if (source.candidateTitleTotal !== null && (typeof source.candidateTitleTotal !== 'number' || !Number.isSafeInteger(source.candidateTitleTotal) || source.candidateTitleTotal < 0)) {
    return { ok: false, code: 'invalid-provenance', message: '识别候选标题总数无效' }
  }

  if (!Array.isArray(source.risks) || source.risks.length > MAX_RISKS) {
    return { ok: false, code: 'invalid-provenance', message: '识别风险列表无效' }
  }
  const riskIds = new Set<string>()
  const risks: RecognitionProvenance['risks'] = []
  for (const item of source.risks) {
    const risk = record(item)
    if (!risk || !exactKeys(risk, ['id', 'reason', 'raw', 'resolved']) || typeof risk.id !== 'string' || typeof risk.reason !== 'string' || typeof risk.raw !== 'string' || typeof risk.resolved !== 'boolean') {
      return { ok: false, code: 'invalid-provenance', message: '识别风险项无效' }
    }
    if (risk.id.length === 0 || risk.id.length > MAX_RISK_ID || risk.reason.length === 0 || risk.reason.length > MAX_RISK_TEXT || risk.raw.length > MAX_RISK_TEXT) {
      return { ok: false, code: 'invalid-provenance', message: '识别风险项超出长度限制' }
    }
    if (riskIds.has(risk.id)) return { ok: false, code: 'invalid-provenance', message: '识别风险标识重复：' + risk.id }
    riskIds.add(risk.id)
    risks.push({ id: risk.id, reason: risk.reason, raw: risk.raw, resolved: risk.resolved })
  }
  if ((source.originalStatus !== 'ready' || risks.some((risk) => !risk.resolved)) && !source.riskAcknowledged) {
    return { ok: false, code: 'recognition-risk', message: '识别结果仍有未解决风险，需要确认后继续' }
  }

  const candidateTitleTotal = source.candidateTitleTotal as number | null
  const modified = finalLines === undefined
    ? source.modified
    : !sameLines(finalLines, candidates.lines) || finalTitleTotal !== candidateTitleTotal
  return {
    ok: true,
    value: {
      source: source.source,
      algorithmVersion: source.algorithmVersion,
      originalStatus: source.originalStatus as RecognitionProvenance['originalStatus'],
      candidateLines: candidates.lines,
      candidateTitleTotal,
      modified,
      risks,
      riskAcknowledged: source.riskAcknowledged,
    },
  }
}

export function validStoredRecognition(value: unknown, finalLines: UsageLine[], finalTitleTotal: number | null): value is RecognitionProvenance {
  const parsed = normalizeRecognition(value, finalLines, finalTitleTotal)
  return parsed.ok && parsed.value !== null && parsed.value.modified === (record(value)?.modified as unknown)
}

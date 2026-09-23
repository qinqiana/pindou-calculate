import { COLOR_SET } from '../ledger/catalog.ts'
import { MAX_QTY } from '../ledger/numbers.ts'
import type { RecognitionProvenance, UsageLine } from '../ledger/types.ts'

export type RecognitionIdentity = {
  requestId: string
  imageSession: number
  patternId: string
  revision: number
  confirmedVersion: number | null
  epoch: number
}
export function sameRecognition(a: RecognitionIdentity | null, b: RecognitionIdentity | null): boolean {
  return !!a && !!b && a.requestId === b.requestId && a.imageSession === b.imageSession && a.patternId === b.patternId && a.revision === b.revision && a.confirmedVersion === b.confirmedVersion && a.epoch === b.epoch
}
export type Region = [number, number, number, number]
export type RecognitionResult = {
  algorithm: string
  status: 'ready' | 'partial' | 'failed'
  source: 'legend' | 'grid' | null
  lines: UsageLine[]
  titleTotal: number | null
  width: number
  height: number
  evidence: { id: string; raw: string; region: Region | null; codes: string[] }[]
  risks: { id: string; reason: string; raw: string; region: Region | null; resolved: boolean }[]
}
function region(value: unknown, width: number, height: number): Region | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) return null
  const [x, y, w, h] = value
  return x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= width + 1 && y + h <= height + 1 ? [x, y, w, h] : null
}
/** Validate the worker boundary before any result reaches editable quantities. */
export function readRecognition(raw: any): RecognitionResult {
  if (!raw || !['ready', 'partial', 'failed'].includes(raw.status) || typeof raw.algorithm !== 'string' || raw.algorithm.length > 100) throw Error('识别结果格式无效')
  if (!Array.isArray(raw.candidates) || raw.candidates.length > 221 || !Array.isArray(raw.evidence) || raw.evidence.length > 20000 || !Array.isArray(raw.doubts) || raw.doubts.length > 512) throw Error('识别结果内容无效')
  const seen = new Set<string>()
  const lines = raw.candidates.map((c: any) => {
    if (!c || !COLOR_SET.has(c.code) || seen.has(c.code) || !Number.isSafeInteger(c.quantity) || c.quantity < 0 || c.quantity > MAX_QTY) throw Error('候选含无效或重复用量')
    seen.add(c.code)
    return { code: c.code, qty: c.quantity }
  })
  if (raw.status === 'failed' && lines.length || raw.status !== 'failed' && (!lines.length || !['legend', 'grid'].includes(raw.source))) throw Error('候选状态不一致')
  if (raw.titleTotal !== null && (!Number.isSafeInteger(raw.titleTotal) || raw.titleTotal < 0 || raw.titleTotal > MAX_QTY)) throw Error('标题总数无效')
  const width = raw.image?.width ?? 0, height = raw.image?.height ?? 0
  if (![width, height].every(n => Number.isSafeInteger(n) && n >= 0) || width * height > 32_000_000) throw Error('识别图片尺寸无效')
  if (raw.status !== 'failed' && (!width || !height)) throw Error('缺少识别原图尺寸')
  const evidence = raw.evidence.map((e: any) => ({ id: String(e.id).slice(0, 100), raw: String(e.rawText ?? '').slice(0, 1000), region: region(e.region, width, height), codes: raw.candidates.filter((c: any) => c.source === 'legend' && Array.isArray(c.evidenceIds) && c.evidenceIds.includes(e.id)).map((c: any) => c.code) }))
  const risks = raw.doubts.map((d: any, i: number) => {
    const proof = evidence.find(e => e.id === d.evidenceId || d.evidenceIds?.includes(e.id))
    return { id: 'risk-' + i, reason: String(d.reason ?? '此处需要人工核对').slice(0, 1000), raw: String(d.rawText ?? proof?.raw ?? '').slice(0, 1000), region: region(d.region, width, height) ?? proof?.region ?? null, resolved: false }
  })
  if (raw.status === 'partial') risks.unshift({ id: 'coverage', reason: '完整覆盖尚未证明，仍可能漏计。请结合原图补充用量。', raw: '', region: null, resolved: false })
  return { algorithm: raw.algorithm, status: raw.status, source: raw.source, lines, titleTotal: raw.titleTotal, width, height, evidence, risks }
}
export function recognitionProvenance(result: RecognitionResult): RecognitionProvenance {
  if (result.status === 'failed' || !result.source || !result.lines.length) throw Error('失败结果不能作为自动用量')
  return { source: result.source, algorithmVersion: result.algorithm, originalStatus: result.status, candidateLines: result.lines.map(l => ({ ...l })), candidateTitleTotal: result.titleTotal, modified: false, risks: result.risks.map(({ region: _, ...risk }) => ({ ...risk })), riskAcknowledged: false }
}
export function hasRecognitionRisk(value?: RecognitionProvenance | null): boolean {
  return !!value && (value.originalStatus === 'partial' || value.risks.some(r => !r.resolved))
}
export function usageSourceLabel(method: string): string {
  return ({ manual: '手工录入', legend: '图例识别', grid: '本体识别', assisted: '人工辅助识别' } as Record<string, string>)[method] ?? '来源未知'
}

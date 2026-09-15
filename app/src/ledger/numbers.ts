export const APP_VERSION = '0.1.0'
export const BACKUP_FORMAT_VERSION = 1
export const MAX_QTY = 1_000_000_000
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 32_000_000
export const MAX_THUMB_BYTES = 256 * 1024
export const DEFAULT_FIRST_ENTRY = 1000
export const DEFAULT_LOW_STOCK_PERCENT = 10

export type QtyOk = { ok: true; value: number }
export type QtyErr = { ok: false; reason: 'empty' | 'negative' | 'decimal' | 'overflow' | 'invalid' }

export function parseNonNegativeInt(value: unknown): QtyOk | QtyErr {
  if (value === null || value === undefined) return { ok: false, reason: 'empty' }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return { ok: false, reason: 'empty' }
    if (!/^\d+$/.test(trimmed)) {
      if (/^-/.test(trimmed)) return { ok: false, reason: 'negative' }
      if (/[.]/.test(trimmed)) return { ok: false, reason: 'decimal' }
      return { ok: false, reason: 'invalid' }
    }
    if (trimmed.length > 1 && trimmed.startsWith('0')) return { ok: false, reason: 'invalid' }
    const n = Number(trimmed)
    if (!Number.isSafeInteger(n)) return { ok: false, reason: 'overflow' }
    if (n > MAX_QTY) return { ok: false, reason: 'overflow' }
    return { ok: true, value: n }
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { ok: false, reason: 'invalid' }
    if (value < 0) return { ok: false, reason: 'negative' }
    if (!Number.isInteger(value)) return { ok: false, reason: 'decimal' }
    if (value > MAX_QTY) return { ok: false, reason: 'overflow' }
    return { ok: true, value: value }
  }
  return { ok: false, reason: 'invalid' }
}

export function parsePercent(value: unknown): QtyOk | QtyErr {
  const parsed = parseNonNegativeInt(value)
  if (!parsed.ok) return parsed
  if (parsed.value > 100) return { ok: false, reason: 'overflow' }
  return parsed
}

export function qtyMessage(reason: QtyErr['reason'], field = '数量'): string {
  switch (reason) {
    case 'empty':
      return field + '不能为空'
    case 'negative':
      return field + '不能为负数'
    case 'decimal':
      return field + '必须是整数，不能有小数'
    case 'overflow':
      return field + '超出可记录范围'
    default:
      return field + '不是有效整数'
  }
}

export function newId(prefix: string): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return prefix + '-' + c.randomUUID()
  return prefix + '-' + Date.now().toString(16) + '-' + Math.random().toString(16).slice(2)
}

export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) out[key] = sortKeys(obj[key])
    return out
  }
  return value
}

export function clone<T>(value: T): T {
  return structuredClone(value)
}

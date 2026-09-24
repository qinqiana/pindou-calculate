import { COLOR_CODES, COLOR_SET, compareColorCode, normalizeColorCode, PALETTE } from './catalog.ts'
import { restockListCsv, restockListText } from './csv.ts'
import { pickThumbnail, sniffImage } from './image.ts'
import { APP_VERSION, BACKUP_FORMAT_VERSION, MAX_QTY, canonical, clone, newId, parseNonNegativeInt, parsePercent, qtyMessage } from './numbers.ts'
import { normalizeRecognition } from './provenance.ts'
import { LedgerStore, isPersistError, validateLedgerState, type InterruptStage } from './store.ts'
import type {
  BackupFile,
  BatchItem,
  BatchPreviewLine,
  ConfirmedUsage,
  Fail,
  GapLine,
  LedgerState,
  MakeRecord,
  Movement,
  Ok,
  Operation,
  Pattern,
  RecognitionProvenance,
  RejectedItem,
  StockRow,
  UsageLine,
} from './types.ts'

export type Clock = () => string

function defaultClock(): string {
  return new Date().toISOString()
}

function fail(code: string, message: string, extra?: Partial<Fail>): Fail {
  return { ok: false, code, message, ...extra }
}

function colorFail(raw: string): Fail {
  return fail('unknown-color', '未知色号：' + raw, { colors: [raw] })
}

type Token = { epoch: number; seq: number }

export class Ledger {
  store: LedgerStore
  clock: Clock
  private thumbnailer: typeof pickThumbnail

  constructor(store?: LedgerStore, clock?: Clock, thumbnailer = pickThumbnail) {
    this.store = store ?? new LedgerStore()
    this.clock = clock ?? defaultClock
    this.thumbnailer = thumbnailer
  }

  setInterrupt(stage: InterruptStage): void {
    this.store.interrupt = stage
  }

  token(): Token {
    const s = this.store.live()
    return { epoch: s.epoch, seq: s.seq }
  }

  listStock(query?: string, group?: string): StockRow[] {
    const s = this.store.live()
    let codes = COLOR_CODES.slice()
    if (group) codes = codes.filter((c) => c.startsWith(group))
    if (query && query.trim() !== '') {
      const q = query.trim().toUpperCase()
      codes = codes.filter((c) => c.includes(q) || c === normalizeColorCode(query))
      const exact = normalizeColorCode(query)
      if (exact && COLOR_SET.has(exact) && !codes.includes(exact)) codes.push(exact)
    }
    codes.sort(compareColorCode)
    return codes.map((c) => clone(s.stock[c]))
  }

  search(query: string): StockRow[] {
    return this.listStock(query)
  }

  getStock(code: string): StockRow | null {
    const normalized = normalizeColorCode(code)
    if (!normalized) return null
    return clone(this.store.live().stock[normalized])
  }

  lowStock(code: string): boolean {
    const row = this.getStock(code)
    if (!row) return false
    return isLow(row, this.store.live().settings.lowStockPercent)
  }

  listLowStock(): StockRow[] {
    const percent = this.store.live().settings.lowStockPercent
    return this.listStock().filter((row) => isLow(row, percent))
  }

  movements(code?: string): { operation: Operation; movement: Movement }[] {
    const s = this.store.live()
    const out: { operation: Operation; movement: Movement }[] = []
    for (const mv of s.movements) {
      if (code && mv.code !== normalizeColorCode(code) && mv.code !== code) continue
      const op = s.operations.find((o) => o.id === mv.operationId)
      if (op) out.push({ operation: clone(op), movement: clone(mv) })
    }
    out.sort((a, b) => a.operation.seq - b.operation.seq)
    return out
  }

  settings(): { lowStockPercent: number } {
    return clone(this.store.live().settings)
  }

  previewFirstEntry(items: BatchItem[]): Ok<{ lines: BatchPreviewLine[]; token: Token }> | Fail {
    return previewBatch(this.store.live(), items, 'first-entry')
  }

  commitFirstEntry(requestId: string, items: BatchItem[], token: Token): Ok<{ operationId: string; token: Token }> | Fail {
    return this.commitBatch(requestId, items, token, 'first-entry')
  }

  previewCount(items: BatchItem[]): Ok<{ lines: BatchPreviewLine[]; token: Token }> | Fail {
    return previewBatch(this.store.live(), items, 'count')
  }

  commitCount(requestId: string, items: BatchItem[], token: Token): Ok<{ operationId: string; token: Token }> | Fail {
    return this.commitBatch(requestId, items, token, 'count')
  }

  previewRestock(items: BatchItem[]): Ok<{ lines: BatchPreviewLine[]; token: Token }> | Fail {
    return previewBatch(this.store.live(), items, 'restock')
  }

  commitRestock(requestId: string, items: BatchItem[], token: Token): Ok<{ operationId: string; token: Token }> | Fail {
    return this.commitBatch(requestId, items, token, 'restock')
  }

  commitFlags(requestId: string, items: { code: string; estimated: boolean }[], token: Token): Ok<{ operationId: string; token: Token }> | Fail {
    const mapped: BatchItem[] = items.map((it) => {
      const row = this.getStock(it.code)
      return { code: it.code, qty: row ? row.qty : 0, estimated: it.estimated }
    })
    return this.commitBatch(requestId, mapped, token, 'flag')
  }

  setLowStockPercent(requestId: string, percent: unknown, token: Token): Ok<{ token: Token }> | Fail {
    const parsed = parsePercent(percent)
    if (!parsed.ok) return fail('invalid-number', qtyMessage(parsed.reason, '预警比例'))
    return this.write(requestId, { kind: 'settings', percent: parsed.value }, token, (state) => {
      if (state.settings.lowStockPercent === parsed.value) {
        return { operationId: 'noop', skipOp: true }
      }
      state.settings.lowStockPercent = parsed.value
      const op = pushOp(state, requestId, 'settings', this.clock(), '设置低库存预警比例为 ' + parsed.value + '%')
      return { operationId: op.id }
    })
  }

  replaceDisplayPalette(
    requestId: string,
    palette: typeof PALETTE,
    token: Token,
  ): Ok<{ token: Token }> | Fail {
    const codes = palette.colors.map((c) => c.code)
    if (codes.length !== COLOR_CODES.length || COLOR_CODES.some((c, i) => codes[i] !== c && !codes.includes(c))) {
      const set = new Set(codes)
      if (set.size !== COLOR_CODES.length || COLOR_CODES.some((c) => !set.has(c))) {
        return fail('palette-mismatch', '显示色资料必须覆盖同一套 221 色号')
      }
    }
    return this.write(requestId, { kind: 'palette', source: palette.sourceName }, token, (state) => {
      state.palette = clone(palette)
      const op = pushOp(state, requestId, 'settings', this.clock(), '更新社区版参考色显示资料')
      return { operationId: op.id }
    })
  }

  createPattern(
    requestId: string,
    input: {
      name: string
      sourceNote?: string
      sizeNote?: string
      imageBytes: Uint8Array
      thumbnailBytes?: Uint8Array
    },
    token: Token,
  ): Ok<{ patternId: string; token: Token }> | Fail {
    if (!input.name || input.name.trim() === '') return fail('invalid-name', '图纸名称不能为空')
    const sniffed = sniffImage(input.imageBytes)
    if (!sniffed.ok) return fail('invalid-image', sniffed.message)
    const thumb = this.thumbnailer(sniffed.image, input.thumbnailBytes)
    if ('ok' in thumb && thumb.ok === false) return fail('invalid-image', thumb.message)
    const thumbnail = thumb as { mime: 'image/png' | 'image/jpeg'; base64: string }
    return this.write(
      requestId,
      { kind: 'create-pattern', name: input.name.trim(), mime: sniffed.image.mime, w: sniffed.image.width, h: sniffed.image.height },
      token,
      (state) => {
        const id = newId('pattern')
        const pattern: Pattern = {
          id,
          name: input.name.trim(),
          sourceNote: (input.sourceNote ?? '').trim(),
          sizeNote: (input.sizeNote ?? '').trim(),
          pixelWidth: (sniffed.image.orientation ?? 1) >= 5 ? sniffed.image.height : sniffed.image.width,
          pixelHeight: (sniffed.image.orientation ?? 1) >= 5 ? sniffed.image.width : sniffed.image.height,
          thumbnail,
          confirmedVersion: null,
          createdSeq: state.seq + 1,
          archivedAt: null,
        }
        state.patterns.push(pattern)
        const op = pushOp(state, requestId, 'create-pattern', this.clock(), '导入图纸', id)
        return { operationId: op.id, patternId: id }
      },
    )
  }

  updatePatternMeta(
    requestId: string,
    patternId: string,
    patch: { name?: string; sourceNote?: string; sizeNote?: string },
    token: Token,
  ): Ok<{ token: Token }> | Fail {
    const pattern = this.store.live().patterns.find((p) => p.id === patternId)
    if (!pattern) return fail('missing-pattern', '找不到图纸')
    const name = patch.name !== undefined ? patch.name.trim() : pattern.name
    if (!name) return fail('invalid-name', '图纸名称不能为空')
    return this.write(requestId, { kind: 'pattern-meta', patternId, name, sourceNote: patch.sourceNote ?? pattern.sourceNote, sizeNote: patch.sizeNote ?? pattern.sizeNote }, token, (state) => {
      const p = state.patterns.find((x) => x.id === patternId)!
      p.name = name
      if (patch.sourceNote !== undefined) p.sourceNote = patch.sourceNote
      if (patch.sizeNote !== undefined) p.sizeNote = patch.sizeNote.trim()
      const op = pushOp(state, requestId, 'pattern-meta', this.clock(), '编辑图纸信息', patternId)
      return { operationId: op.id }
    })
  }

  archivePattern(requestId: string, patternId: string, token: Token): Ok<{ patternId: string; token: Token }> | Fail {
    const payload = { kind: 'archive-pattern', patternId }
    const replayed = this.existing(requestId, payload)
    if (replayed) return replayed
    const pattern = this.store.live().patterns.find((p) => p.id === patternId)
    if (!pattern) return fail('missing-pattern', '找不到图纸')
    if (pattern.archivedAt) return fail('already-archived', '图纸已从列表移除')
    return this.write(
      requestId,
      payload,
      token,
      (state) => {
        const current = state.patterns.find((p) => p.id === patternId)!
        current.archivedAt = this.clock()
        const op = pushOp(state, requestId, 'archive-pattern', this.clock(), '移除图纸', patternId)
        return { operationId: op.id, patternId }
      },
    )
  }

  saveDraft(patternId: string, lines: { code: unknown; qty: unknown }[], titleTotal?: unknown): Ok<{ token: Token }> | Fail {
    const parsed = parseUsageLines(lines)
    if (!parsed.ok) return parsed
    let title: number | null = null
    if (titleTotal !== undefined && titleTotal !== null && String(titleTotal).trim() !== '') {
      const t = parseNonNegativeInt(titleTotal, Number.MAX_SAFE_INTEGER)
      if (!t.ok) return fail('invalid-number', qtyMessage(t.reason, '标题总数'))
      title = t.value
    }
    const live = this.store.live()
    if (!live.patterns.some((p) => p.id === patternId)) return fail('missing-pattern', '找不到图纸')
    try {
      this.store.commit((state) => {
        const rest = state.drafts.filter((d) => d.patternId !== patternId)
        rest.push({ patternId, lines: parsed.lines, titleTotal: title })
        state.drafts = rest
      })
    } catch (err) {
      if (isInterrupt(err)) return fail('interrupted', '保存中断，账本未改')
      const pf = asPersistFail(err)
      if (pf) return pf
      throw err
    }
    return { ok: true, token: this.token() }
  }

  confirmUsage(
    requestId: string,
    patternId: string,
    input: {
      lines: { code: unknown; qty: unknown }[]
      titleTotal?: unknown
      acknowledgeTitleDiff?: boolean
      rejectedItems?: { raw: string; qty: number | null; note: string }[]
      recognition?: RecognitionProvenance | null
      /** 缺省时沿用既有手工确认请求身份。imageBytes 只在本页成功重选原图时传入。 */
      patternMeta?: {
        name: string
        sourceNote: string
        sizeNote: string
        imageBytes?: Uint8Array
      } | null
    },
    token: Token,
  ): Ok<{ version: number; perColorSum: number; difference: number | null; token: Token }> | Fail {
    const parsed = parseUsageLines(input.lines)
    if (!parsed.ok) return parsed
    const meta = readPatternMeta(input.patternMeta)
    if (!meta.ok) return meta
    let title: number | null = null
    if (input.titleTotal !== undefined && input.titleTotal !== null && String(input.titleTotal).trim() !== '') {
      const t = parseNonNegativeInt(input.titleTotal, Number.MAX_SAFE_INTEGER)
      if (!t.ok) return fail('invalid-number', qtyMessage(t.reason, '标题总数'))
      title = t.value
    }
    const sum = parsed.lines.reduce((a, l) => a + l.qty, 0)
    const difference = title === null ? null : title - sum
    if (difference !== null && difference !== 0 && !input.acknowledgeTitleDiff) {
      return fail('title-diff', '标题总数与逐色合计不一致', {
        difference,
        titleTotal: title,
        perColorSum: sum,
      })
    }
    const rejected = parseRejectedItems(input.rejectedItems)
    if (!rejected.ok) return rejected
    const recognition = normalizeRecognition(input.recognition, parsed.lines, title)
    if (!recognition.ok) return fail(recognition.code, recognition.message)
    const live = this.store.live()
    if (!live.patterns.some((p) => p.id === patternId)) return fail('missing-pattern', '找不到图纸')
    // 完整解码在唯一一次写入之前完成。请求身份只记规范化文字和生成的缩略图，不记原图字节。
    const image = meta.value ? this.decodedReplacement(meta.value.imageBytes) : { ok: true as const, value: null }
    if (!image.ok) return image
    const patternMeta = meta.value
      ? {
          name: meta.value.name,
          sourceNote: meta.value.sourceNote,
          sizeNote: meta.value.sizeNote,
          ...(image.value
            ? { pixelWidth: image.value.pixelWidth, pixelHeight: image.value.pixelHeight, thumbnail: image.value.thumbnail }
            : {}),
        }
      : null
    return this.write(
      requestId,
      {
        kind: 'confirm-usage',
        patternId,
        lines: parsed.lines,
        title,
        ack: !!input.acknowledgeTitleDiff,
        ...(patternMeta ? { patternMeta } : {}),
        ...(rejected.items.length ? { rejectedItems: rejected.items } : {}),
        ...(recognition.value ? { recognition: recognition.value } : {}),
      },
      token,
      (state) => {
        const pattern = state.patterns.find((p) => p.id === patternId)!
        if (patternMeta) {
          pattern.name = patternMeta.name
          pattern.sourceNote = patternMeta.sourceNote
          pattern.sizeNote = patternMeta.sizeNote
          if (image.value) {
            pattern.thumbnail = image.value.thumbnail
            pattern.pixelWidth = image.value.pixelWidth
            pattern.pixelHeight = image.value.pixelHeight
          }
        }
        const version = (pattern.confirmedVersion ?? 0) + 1
        const confirmed: ConfirmedUsage = {
          patternId,
          version,
          lines: parsed.lines,
          inputMethod: recognition.value ? recognition.value.source : 'manual',
          recognition: recognition.value,
          confirmedAt: this.clock(),
          titleTotal: title,
          titleDiff: difference,
          titleDiffAcknowledged: difference !== null && difference !== 0,
          rejectedItems: rejected.items,
        }
        state.confirmedUsages.push(confirmed)
        pattern.confirmedVersion = version
        state.drafts = state.drafts.filter((d) => d.patternId !== patternId)
        const op = pushOp(state, requestId, 'confirm-usage', this.clock(), '确认全部用量', patternId)
        return { operationId: op.id, version, perColorSum: sum, difference }
      },
    )
  }

  listPatterns(): Pattern[] {
    return clone(this.store.live().patterns)
  }

  listPatternCards(): {
    pattern: Pattern
    totalDemand: number | null
    makeCount: number
    hasDraft: boolean
    sizeLabel: string
  }[] {
    return this.listPatterns().filter((pattern) => !pattern.archivedAt).map((pattern) => {
      const detail = this.getPattern(pattern.id)
      const gap = pattern.confirmedVersion != null ? this.previewGap(pattern.id) : null
      const makes = this.listMakes(pattern.id)
      return {
        pattern,
        totalDemand: gap && gap.ok ? gap.totalDemand : null,
        makeCount: makes.filter((m) => !m.voided).length,
        hasDraft: !!(detail && detail.draft),
        sizeLabel: pattern.sizeNote && pattern.sizeNote.trim() !== '' ? pattern.sizeNote : '未提供',
      }
    })
  }

  getPattern(patternId: string): {
    pattern: Pattern
    confirmed: ConfirmedUsage | null
    versions: ConfirmedUsage[]
    draft: { lines: UsageLine[]; titleTotal: number | null } | null
  } | null {
    const s = this.store.live()
    const pattern = s.patterns.find((p) => p.id === patternId)
    if (!pattern) return null
    const confirmed =
      pattern.confirmedVersion == null
        ? null
        : s.confirmedUsages.find((u) => u.patternId === patternId && u.version === pattern.confirmedVersion) ?? null
    const versions = s.confirmedUsages.filter((u) => u.patternId === patternId).sort((a, b) => a.version - b.version)
    const draft = s.drafts.find((d) => d.patternId === patternId) ?? null
    return { pattern: clone(pattern), confirmed: confirmed ? clone(confirmed) : null, versions: clone(versions), draft: draft ? clone(draft) : null }
  }

  previewGap(patternId: string): Ok<{
    totalDemand: number
    colorCount: number
    canMake: boolean
    lines: GapLine[]
    token: Token
  }> | Fail {
    const computed = this.gapLines(patternId)
    if (!computed.ok) return computed
    const totalDemand = computed.lines.reduce((a, l) => a + l.demand, 0)
    const colorCount = computed.lines.filter((l) => l.demand > 0).length
    const canMake = computed.lines.every((l) => l.gap === 0)
    return { ok: true, totalDemand, colorCount, canMake, lines: computed.lines, token: this.token() }
  }

  exportRestockList(patternId: string): Ok<{ csv: string; text: string; generatedAt: string }> | Fail {
    const pattern = this.store.live().patterns.find((p) => p.id === patternId)
    if (!pattern) return fail('missing-pattern', '找不到图纸')
    const computed = this.gapLines(patternId)
    if (!computed.ok) return computed
    const generatedAt = this.clock()
    return {
      ok: true,
      csv: restockListCsv(pattern.name, generatedAt, computed.lines),
      text: restockListText(pattern.name, generatedAt, computed.lines),
      generatedAt,
    }
  }

  make(requestId: string, patternId: string, token: Token): Ok<{ makeId: string; token: Token }> | Fail {
    const live = this.store.live()
    const pattern = live.patterns.find((p) => p.id === patternId)
    if (!pattern) return fail('missing-pattern', '找不到图纸')
    if (pattern.confirmedVersion == null) return fail('unconfirmed', '尚未确认用量，不能已拼')
    const usage = live.confirmedUsages.find((u) => u.patternId === patternId && u.version === pattern.confirmedVersion)
    if (!usage) return fail('unconfirmed', '找不到已确认用量')
    const payload = { kind: 'make', patternId, version: pattern.confirmedVersion, lines: usage.lines }
    const replayed = this.existing(requestId, payload)
    if (replayed) return replayed
    return this.write(
      requestId,
      payload,
      token,
      (state) => {
        const p = state.patterns.find((x) => x.id === patternId)
        if (!p || p.confirmedVersion == null) throw new BatchFail(fail('unconfirmed', '尚未确认用量，不能已拼'))
        const u = state.confirmedUsages.find((x) => x.patternId === patternId && x.version === p.confirmedVersion)
        if (!u) throw new BatchFail(fail('unconfirmed', '找不到已确认用量'))
        const missing: { code: string; need: number; have: number; gap: number }[] = []
        for (const line of u.lines) {
          const have = state.stock[line.code].qty
          const gap = Math.max(line.qty - have, 0)
          if (gap > 0) missing.push({ code: line.code, need: line.qty, have, gap })
        }
        if (missing.length) {
          throw new BatchFail(
            fail('insufficient', '库存不足，未扣减', { gaps: missing, colors: missing.map((g) => g.code) }),
          )
        }
        const makeId = newId('make')
        const op = pushOp(state, requestId, 'make', this.clock(), '已拼', patternId, makeId)
        for (const line of u.lines) {
          if (line.qty === 0) continue
          const row = state.stock[line.code]
          const before = row.qty
          row.qty = before - line.qty
          pushMovement(state, op.id, row, before, row.qty, row.estimated, row.baseline)
        }
        const rec: MakeRecord = {
          id: makeId,
          patternId,
          usageVersion: u.version,
          nameSnapshot: p.name,
          sourceNoteSnapshot: p.sourceNote,
          linesSnapshot: clone(u.lines),
          completedAt: op.at,
          voided: false,
          voidedAt: null,
          requestId,
        }
        state.makes.push(rec)
        return { operationId: op.id, makeId }
      },
    )
  }

  voidMake(requestId: string, makeId: string, token: Token): Ok<{ token: Token }> | Fail {
    const live = this.store.live()
    const rec = live.makes.find((m) => m.id === makeId)
    if (!rec) return fail('missing-make', '找不到制作记录')
    if (rec.voided) {
      const prev = live.requests.find((r) => r.requestId === requestId)
      if (prev) return this.replay(prev)
      return fail('already-voided', '该制作已经撤回')
    }
    return this.write(requestId, { kind: 'void-make', makeId }, token, (state) => {
      const make = state.makes.find((m) => m.id === makeId)
      if (!make) throw new BatchFail(fail('missing-make', '找不到制作记录'))
      if (make.voided) return { operationId: 'already', skipOp: true }
      for (const line of make.linesSnapshot) {
        const parsed = parseNonNegativeInt(state.stock[line.code].qty + line.qty)
        if (!parsed.ok) throw new BatchFail(fail('invalid-number', '撤回后数量溢出：' + line.code))
      }
      const op = pushOp(state, requestId, 'void-make', this.clock(), '撤回制作', make.patternId, makeId)
      for (const line of make.linesSnapshot) {
        if (line.qty === 0) continue
        const row = state.stock[line.code]
        const before = row.qty
        row.qty = before + line.qty
        pushMovement(state, op.id, row, before, row.qty, row.estimated, row.baseline)
      }
      make.voided = true
      make.voidedAt = op.at
      return { operationId: op.id }
    })
  }

  listMakes(patternId?: string): MakeRecord[] {
    const makes = this.store.live().makes.filter((m) => (patternId ? m.patternId === patternId : true))
    return clone(makes)
  }

  achievements(): { totalUsed: number; completedMakes: number; perColor: Record<string, number> } {
    const perColor: Record<string, number> = {}
    for (const code of COLOR_CODES) perColor[code] = 0
    let totalUsed = 0
    let completedMakes = 0
    for (const make of this.store.live().makes) {
      if (make.voided) continue
      completedMakes += 1
      for (const line of make.linesSnapshot) {
        perColor[line.code] += line.qty
        totalUsed += line.qty
      }
    }
    return { totalUsed, completedMakes, perColor }
  }

  exportBackup(): BackupFile {
    const snap = this.store.snapshot()
    return stateToBackup(snap, this.clock())
  }

  validateBackup(raw: unknown): Ok<{ backup: BackupFile; diff: BackupDiff }> | Fail {
    const parsed = parseBackup(raw)
    if (!parsed.ok) return parsed
    return { ok: true, backup: parsed.backup, diff: diffBackup(this.store.live(), parsed.backup) }
  }

  cancelRestore(): Ok<{ token: Token }> | Fail {
    try {
      this.store.abortPending()
    } catch (err) {
      const pf = asPersistFail(err)
      if (pf) return pf
      throw err
    }
    return { ok: true, token: this.token() }
  }

  restoreReplace(requestId: string, raw: unknown, token: Token): Ok<{ token: Token }> | Fail {
    const stale = checkToken(this.store.live(), token)
    if (stale) return stale
    const parsed = parseBackup(raw)
    if (!parsed.ok) return parsed
    const next = backupToState(parsed.backup)
    next.epoch = this.store.live().epoch + 1
    next.requests = next.requests.concat([
      {
        requestId,
        payloadCanonical: canonical({ kind: 'restore', seq: parsed.backup.seq, exportedAt: parsed.backup.exportedAt }),
        result: { ok: true, requestId, operationId: 'restore', seq: next.seq },
      },
    ])
    try {
      this.store.replaceLive(next, this.store.interrupt)
    } catch (err) {
      if (isInterrupt(err)) return fail('interrupted', '恢复中断，仍保留完整账本')
      const pf = asPersistFail(err)
      if (pf) return pf
      throw err
    }
    return { ok: true, token: this.token() }
  }

  shareContent(patternId: string): Ok<{ patternName: string; thumbnail: { mime: string; base64: string } }> | Fail {
    const pattern = this.store.live().patterns.find((p) => p.id === patternId)
    if (!pattern) return fail('missing-pattern', '找不到图纸')
    return { ok: true, patternName: pattern.name, thumbnail: clone(pattern.thumbnail) }
  }

  private gapLines(patternId: string): Ok<{ lines: GapLine[] }> | Fail {
    const s = this.store.live()
    const pattern = s.patterns.find((p) => p.id === patternId)
    if (!pattern) return fail('missing-pattern', '找不到图纸')
    if (pattern.confirmedVersion == null) return fail('unconfirmed', '尚未确认用量')
    const usage = s.confirmedUsages.find((u) => u.patternId === patternId && u.version === pattern.confirmedVersion)
    if (!usage) return fail('unconfirmed', '找不到已确认用量')
    const lines: GapLine[] = usage.lines.map((line) => {
      const have = s.stock[line.code].qty
      return {
        code: line.code,
        demand: line.qty,
        have,
        gap: Math.max(line.qty - have, 0),
        remaining: have - line.qty,
      }
    })
    lines.sort((a, b) => compareColorCode(a.code, b.code))
    return { ok: true, lines }
  }

  private commitBatch(
    requestId: string,
    items: BatchItem[],
    token: Token,
    kind: 'first-entry' | 'count' | 'restock' | 'flag',
  ): Ok<{ operationId: string; token: Token }> | Fail {
    const payloadItems = items.map((it) => ({
      code: String(it.code ?? ''),
      qty: it.qty,
      estimated: it.estimated,
    }))
    const replayed = this.existing(requestId, { kind, items: payloadItems })
    if (replayed) return replayed
    const preview = previewBatch(this.store.live(), items, kind)
    if (!preview.ok) return preview
    return this.write(requestId, { kind, items: payloadItems }, token, (state) => {
      const again = previewBatch(state, items, kind)
      if (!again.ok) throw new BatchFail(again)
      if (again.lines.length === 0) {
        return { operationId: 'noop', skipOp: true }
      }
      const reason =
        kind === 'first-entry'
          ? '首次录入'
          : kind === 'count'
            ? '盘点更正'
            : kind === 'restock'
              ? '补货入库'
              : '估算/精确标记'
      const op = pushOp(state, requestId, kind, this.clock(), reason)
      for (const line of again.lines) {
        const row = state.stock[line.code]
        const qtyBefore = row.qty
        const estimatedBefore = row.estimated
        const baselineBefore = row.baseline
        row.qty = line.qtyAfter
        row.estimated = line.estimatedAfter
        row.baseline = line.baselineAfter
        if (kind === 'first-entry') row.entered = true
        if (kind === 'count' || kind === 'restock' || kind === 'flag') {
          if (line.qtyAfter !== 0 || line.enteredBefore) row.entered = true
        }
        if (qtyBefore === row.qty && estimatedBefore === row.estimated && baselineBefore === row.baseline) continue
        pushMovement(state, op.id, row, qtyBefore, row.qty, estimatedBefore, baselineBefore)
      }
      return { operationId: op.id }
    })
  }

  private decodedReplacement(
    imageBytes: Uint8Array | undefined,
  ): Ok<{ value: { pixelWidth: number; pixelHeight: number; thumbnail: { mime: 'image/png' | 'image/jpeg'; base64: string } } | null }> | Fail {
    if (imageBytes === undefined) return { ok: true, value: null }
    const sniffed = sniffImage(imageBytes)
    if (!sniffed.ok) return fail('invalid-image', sniffed.message)
    const thumb = this.thumbnailer(sniffed.image)
    if ('ok' in thumb && thumb.ok === false) return fail('invalid-image', thumb.message)
    const thumbnail = thumb as { mime: 'image/png' | 'image/jpeg'; base64: string }
    const rotated = (sniffed.image.orientation ?? 1) >= 5
    return {
      ok: true,
      value: {
        pixelWidth: rotated ? sniffed.image.height : sniffed.image.width,
        pixelHeight: rotated ? sniffed.image.width : sniffed.image.height,
        thumbnail,
      },
    }
  }

  private existing(
    requestId: string,
    payload: unknown,
  ): Ok<{ operationId: string; token: Token; patternId?: string; makeId?: string; version?: number; perColorSum?: number; difference?: number | null }> | Fail | null {
    const prev = this.store.live().requests.find((r) => r.requestId === requestId)
    if (!prev) return null
    if (prev.payloadCanonical !== canonical(payload)) return fail('request-conflict', '同一请求内容冲突')
    return {
      ok: true,
      operationId: prev.result.operationId,
      token: this.token(),
      patternId: prev.result.patternId,
      makeId: prev.result.makeId,
      version: prev.result.version,
      perColorSum: prev.result.perColorSum,
      difference: prev.result.difference,
    }
  }

  private replay(prev: { result: { ok: true; requestId: string; operationId: string; seq: number; makeId?: string; patternId?: string } }): Ok<{ operationId: string; token: Token; makeId?: string; patternId?: string }> {
    return {
      ok: true,
      operationId: prev.result.operationId,
      token: this.token(),
      makeId: prev.result.makeId,
      patternId: prev.result.patternId,
    }
  }

  private write(
    requestId: string,
    payload: unknown,
    token: Token,
    apply: (state: LedgerState) => { operationId: string; skipOp?: boolean; patternId?: string; makeId?: string; version?: number; perColorSum?: number; difference?: number | null },
  ): Ok<{ operationId: string; token: Token; patternId?: string; makeId?: string; version?: number; perColorSum?: number; difference?: number | null }> | Fail {
    if (!requestId || requestId.trim() === '') return fail('invalid-request', '缺少请求标识')
    const live = this.store.live()
    const replayed = this.existing(requestId, payload)
    if (replayed) return replayed
    const stale = checkToken(live, token)
    if (stale) return stale
    let produced: { operationId: string; skipOp?: boolean; patternId?: string; makeId?: string; version?: number; perColorSum?: number; difference?: number | null }
    try {
      this.store.commit((state) => {
        produced = apply(state)
        if (!produced.skipOp) {
          state.seq += 1
          const last = state.operations[state.operations.length - 1]
          if (last) last.seq = state.seq
        }
        state.requests.push({
          requestId,
          payloadCanonical: canonical(payload),
          result: {
            ok: true,
            requestId,
            operationId: produced.operationId,
            seq: state.seq,
            patternId: produced.patternId,
            makeId: produced.makeId,
            version: produced.version,
            perColorSum: produced.perColorSum,
            difference: produced.difference,
          },
        })
      })
    } catch (err) {
      if (err instanceof BatchFail) return err.fail
      if (isInterrupt(err)) return fail('interrupted', '写入中断，账本未改')
      const pf = asPersistFail(err)
      if (pf) return pf
      throw err
    }
    return { ok: true, token: this.token(), ...produced! }
  }
}

class BatchFail extends Error {
  fail: Fail
  constructor(failValue: Fail) {
    super(failValue.message)
    this.fail = failValue
  }
}

function isInterrupt(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith('interrupt:')
}

/** 持久化失败转成对用户的明确失败结果；其余错误继续抛出。 */
function asPersistFail(err: unknown): Fail | null {
  if (isPersistError(err)) return fail('persist-failed', '未能写入本机存储，账本未改，请重试')
  return null
}

function checkToken(state: LedgerState, token: Token): Fail | null {
  if (token.epoch !== state.epoch || token.seq !== state.seq) {
    return fail('stale', '账本已变化，请重新预览后再保存')
  }
  return null
}

function isLow(row: StockRow, percent: number): boolean {
  if (row.baseline === null || row.baseline <= 0) return false
  return row.qty * 100 <= percent * row.baseline
}

function pushOp(
  state: LedgerState,
  requestId: string,
  type: Operation['type'],
  at: string,
  reason: string,
  patternId?: string,
  makeId?: string,
): Operation {
  const op: Operation = {
    id: newId('op'),
    type,
    at,
    seq: state.seq + 1,
    requestId,
    reason,
  }
  if (patternId) op.patternId = patternId
  if (makeId) op.makeId = makeId
  state.operations.push(op)
  return op
}

function pushMovement(
  state: LedgerState,
  operationId: string,
  row: StockRow,
  qtyBefore: number,
  qtyAfter: number,
  estimatedBefore: boolean,
  baselineBefore: number | null,
): void {
  state.movements.push({
    operationId,
    code: row.code,
    qtyBefore,
    qtyAfter,
    delta: qtyAfter - qtyBefore,
    estimatedBefore,
    estimatedAfter: row.estimated,
    baselineBefore,
    baselineAfter: row.baseline,
  })
}

function previewBatch(
  state: LedgerState,
  items: BatchItem[],
  kind: 'first-entry' | 'count' | 'restock' | 'flag',
): Ok<{ lines: BatchPreviewLine[]; token: Token }> | Fail {
  if (!items || items.length === 0) return fail('empty-batch', '没有选入任何色号')
  const seen = new Set<string>()
  const lines: BatchPreviewLine[] = []
  const decreases: string[] = []
  for (const item of items) {
    const code = normalizeColorCode(String(item.code ?? ''))
    if (!code) return colorFail(String(item.code ?? ''))
    if (seen.has(code)) return fail('duplicate-color', '色号重复：' + code, { colors: [code] })
    seen.add(code)
    const qty = parseNonNegativeInt(item.qty)
    if (!qty.ok) return fail('invalid-number', code + '：' + qtyMessage(qty.reason), { colors: [code] })
    const row = state.stock[code]
    const estimatedAfter =
      item.estimated === undefined ? (kind === 'first-entry' && !row.entered ? true : row.estimated) : !!item.estimated
    let baselineAfter = row.baseline
    if (kind === 'first-entry' && row.entered) {
      return fail('already-entered', '已录入色号请走盘点更正：' + code, { colors: [code] })
    }
    if (kind === 'first-entry' && !row.entered) baselineAfter = qty.value
    if (kind === 'restock') {
      if (qty.value < row.qty) decreases.push(code)
      else if (qty.value > row.qty) baselineAfter = qty.value
    }
    if (kind === 'flag' && qty.value !== row.qty) {
      return fail('flag-qty-changed', '仅改标记时不能改数量：' + code, { colors: [code] })
    }
    lines.push({
      code,
      qtyBefore: row.qty,
      qtyAfter: qty.value,
      delta: qty.value - row.qty,
      estimatedBefore: row.estimated,
      estimatedAfter,
      baselineBefore: row.baseline,
      baselineAfter,
      enteredBefore: row.entered,
    })
  }
  if (kind === 'restock' && decreases.length) {
    return fail('restock-decrease', '补货不能减少数量，请改走盘点更正：' + decreases.join('、'), {
      colors: decreases,
    })
  }
  const meaningful = lines.filter(
    (l) => l.qtyBefore !== l.qtyAfter || l.estimatedBefore !== l.estimatedAfter || l.baselineBefore !== l.baselineAfter,
  )
  if (kind !== 'first-entry' && meaningful.length === 0) {
    return { ok: true, lines: [], token: { epoch: state.epoch, seq: state.seq } }
  }
  return { ok: true, lines: kind === 'flag' || kind === 'restock' ? meaningful : lines, token: { epoch: state.epoch, seq: state.seq } }
}

function readPatternMeta(
  input: unknown,
): Ok<{ value: { name: string; sourceNote: string; sizeNote: string; imageBytes?: Uint8Array } | null }> | Fail {
  if (input === undefined || input === null) return { ok: true, value: null }
  if (typeof input !== 'object' || Array.isArray(input)) return fail('invalid-meta', '图纸元数据无效')
  const meta = input as Record<string, unknown>
  if (typeof meta.name !== 'string' || typeof meta.sourceNote !== 'string' || typeof meta.sizeNote !== 'string') {
    return fail('invalid-meta', '图纸元数据无效')
  }
  const name = meta.name.trim()
  if (!name) return fail('invalid-name', '图纸名称不能为空')
  if (meta.imageBytes !== undefined && !(meta.imageBytes instanceof Uint8Array)) return fail('invalid-image', '替换图片无效')
  return {
    ok: true,
    value: {
      name,
      sourceNote: meta.sourceNote.trim(),
      sizeNote: meta.sizeNote.trim(),
      ...(meta.imageBytes !== undefined ? { imageBytes: meta.imageBytes as Uint8Array } : {}),
    },
  }
}

function parseUsageLines(lines: { code: unknown; qty: unknown }[]): Ok<{ lines: UsageLine[] }> | Fail {
  if (!Array.isArray(lines)) return fail('invalid-usage', '用量必须是列表')
  const seen = new Set<string>()
  const out: UsageLine[] = []
  for (const line of lines) {
    if (!line || typeof line !== 'object') return fail('invalid-usage', '用量行无效')
    const code = normalizeColorCode(String(line.code ?? ''))
    if (!code) return colorFail(String(line.code ?? ''))
    if (seen.has(code)) return fail('duplicate-color', '色号重复，不能静默累加：' + code, { colors: [code] })
    seen.add(code)
    const qty = parseNonNegativeInt(line.qty)
    if (!qty.ok) return fail('invalid-number', code + '：' + qtyMessage(qty.reason), { colors: [code] })
    out.push({ code, qty: qty.value })
  }
  out.sort((a, b) => compareColorCode(a.code, b.code))
  return { ok: true, lines: out }
}

function parseRejectedItems(items: { raw: string; qty: number | null; note: string }[] | undefined): Ok<{ items: RejectedItem[] }> | Fail {
  if (items === undefined) return { ok: true, items: [] }
  if (!Array.isArray(items) || items.length > 512) return fail('invalid-rejected-item', '拒绝项列表无效')
  const out: RejectedItem[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object' || typeof item.raw !== 'string' || item.raw.length > 1000 || (item.qty !== null && (typeof item.qty !== 'number' || !Number.isSafeInteger(item.qty) || item.qty < 0 || item.qty > MAX_QTY)) || typeof item.note !== 'string' || item.note.length > 1000) {
      return fail('invalid-rejected-item', '拒绝项无效')
    }
    out.push({ raw: item.raw, qty: item.qty, note: item.note })
  }
  return { ok: true, items: out }
}

export type BackupDiff = {
  stockChanged: number
  lowStockPercentBefore: number
  lowStockPercentAfter: number
  patternCountBefore: number
  patternCountAfter: number
  makeCountBefore: number
  makeCountAfter: number
  movementCountBefore: number
  movementCountAfter: number
  thumbnailComplete: boolean
  replaceNotMerge: true
}

function diffBackup(live: LedgerState, backup: BackupFile): BackupDiff {
  let stockChanged = 0
  for (const row of backup.stock) {
    const cur = live.stock[row.code]
    if (!cur || cur.qty !== row.qty || cur.estimated !== row.estimated || cur.baseline !== row.baseline) stockChanged += 1
  }
  return {
    stockChanged,
    lowStockPercentBefore: live.settings.lowStockPercent,
    lowStockPercentAfter: backup.settings.lowStockPercent,
    patternCountBefore: live.patterns.length,
    patternCountAfter: backup.patterns.length,
    makeCountBefore: live.makes.length,
    makeCountAfter: backup.makes.length,
    movementCountBefore: live.movements.length,
    movementCountAfter: backup.movements.length,
    thumbnailComplete: backup.patterns.every((p) => !!(p.thumbnail && p.thumbnail.base64 && p.thumbnail.base64.length > 0)),
    replaceNotMerge: true,
  }
}

function stateToBackup(state: LedgerState, exportedAt: string): BackupFile {
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt,
    appVersion: APP_VERSION,
    palette: clone(state.palette),
    settings: clone(state.settings),
    stock: COLOR_CODES.map((c) => clone(state.stock[c])),
    operations: clone(state.operations),
    movements: clone(state.movements),
    patterns: clone(state.patterns).map((p) => ({ ...p, archivedAt: p.archivedAt ?? null })),
    confirmedUsages: clone(state.confirmedUsages),
    makes: clone(state.makes),
    requests: clone(state.requests),
    epoch: state.epoch,
    seq: state.seq,
  }
}

function parseBackup(raw: unknown): Ok<{ backup: BackupFile }> | Fail {
  if (raw === null || raw === undefined) return fail('invalid-backup', '没有备份内容')
  let data: BackupFile
  if (typeof raw === 'string') {
    if (raw.trim() === '') return fail('invalid-backup', '备份文件为空')
    try {
      data = JSON.parse(raw) as BackupFile
    } catch {
      return fail('invalid-backup', '备份不是合法 JSON（可能已截断）')
    }
  } else if (typeof raw === 'object') {
    data = raw as BackupFile
  } else {
    return fail('invalid-backup', '备份格式无法识别')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('invalid-backup', '备份根节点不是对象')
  if (!Number.isSafeInteger(data.formatVersion)) return fail('invalid-backup', '缺少格式版本')
  const inputFormatVersion = data.formatVersion
  if (inputFormatVersion !== 1 && inputFormatVersion !== BACKUP_FORMAT_VERSION) {
    return fail('unsupported-backup', '不支持的备份格式版本：' + String(data.formatVersion))
  }
  if (typeof data.exportedAt !== 'string' || data.exportedAt.trim() === '') return fail('invalid-backup', '备份时间无效')
  if (data.appVersion !== undefined && typeof data.appVersion !== 'string') return fail('invalid-backup', '备份应用版本无效')
  if (
    !data.palette ||
    !data.settings ||
    !Array.isArray(data.stock) ||
    !Array.isArray(data.operations) ||
    !Array.isArray(data.movements) ||
    !Array.isArray(data.makes) ||
    !Array.isArray(data.confirmedUsages) ||
    !Array.isArray(data.patterns) ||
    (data.requests !== undefined && !Array.isArray(data.requests))
  ) {
    return fail('invalid-backup', '备份缺少必要账本字段')
  }
  if (inputFormatVersion === 1) {
    for (const usage of data.confirmedUsages) {
      if (!usage || typeof usage !== 'object' || usage.inputMethod !== 'manual' || Object.prototype.hasOwnProperty.call(usage, 'recognition')) {
        return fail('invalid-backup', 'v1 备份只能包含手工确认用量')
      }
    }
  }
  if (!Number.isSafeInteger(data.epoch) || data.epoch < 0 || !Number.isSafeInteger(data.seq) || data.seq < 0) {
    return fail('invalid-backup', '备份序号无效')
  }
  if (data.stock.length !== COLOR_CODES.length) return fail('invalid-backup', '备份色号数量不是 221')
  const codes = new Set<string>()
  for (const row of data.stock) {
    if (!row || typeof row !== 'object') return fail('invalid-backup', '备份库存行无效')
    if (!COLOR_SET.has(row.code)) return fail('invalid-backup', '备份含未知色号：' + row.code)
    if (codes.has(row.code)) return fail('invalid-backup', '备份色号重复：' + row.code)
    codes.add(row.code)
    if (typeof row.estimated !== 'boolean' || typeof row.entered !== 'boolean') return fail('invalid-backup', '备份库存状态无效：' + row.code)
    const q = parseNonNegativeInt(row.qty)
    if (!q.ok) return fail('invalid-backup', '备份数量非法：' + row.code)
    if (row.baseline !== null && row.baseline !== undefined) {
      const b = parseNonNegativeInt(row.baseline)
      if (!b.ok) return fail('invalid-backup', '备份基准非法：' + row.code)
    }
  }
  const opIds = new Set<string>()
  for (const op of data.operations) {
    if (!op || typeof op !== 'object' || typeof op.id !== 'string' || typeof op.type !== 'string' || typeof op.at !== 'string' || !Number.isSafeInteger(op.seq) || op.seq < 0 || typeof op.requestId !== 'string' || typeof op.reason !== 'string') return fail('invalid-backup', '备份操作记录无效')
    if (opIds.has(op.id)) return fail('invalid-backup', '备份操作标识重复')
    opIds.add(op.id)
  }
  const makeIds = new Set<string>()
  for (const make of data.makes) {
    if (!make || typeof make !== 'object' || typeof make.id !== 'string' || typeof make.patternId !== 'string' || !Number.isSafeInteger(make.usageVersion) || !Array.isArray(make.linesSnapshot) || typeof make.voided !== 'boolean' || typeof make.requestId !== 'string') return fail('invalid-backup', '备份制作记录无效')
    if (makeIds.has(make.id)) return fail('invalid-backup', '备份制作标识重复')
    makeIds.add(make.id)
    for (const line of make.linesSnapshot) {
      if (!line || typeof line !== 'object' || !Number.isSafeInteger(line.qty) || line.qty < 0) return fail('invalid-backup', '制作快照数量无效')
      if (!COLOR_SET.has(line.code)) return fail('invalid-backup', '制作快照含未知色号：' + line.code)
    }
  }
  if (data.patterns.some((p) => !p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.name !== 'string' || !p.thumbnail || typeof p.thumbnail !== 'object' || (p.thumbnail.mime !== 'image/png' && p.thumbnail.mime !== 'image/jpeg') || typeof p.thumbnail.base64 !== 'string' || p.thumbnail.base64.length === 0 || (p.archivedAt !== undefined && p.archivedAt !== null && (typeof p.archivedAt !== 'string' || p.archivedAt.trim() === '')))) return fail('invalid-backup', '备份图纸记录无效')
  const patternIds = new Set(data.patterns.map((p) => p.id))
  if (patternIds.size !== data.patterns.length) return fail('invalid-backup', '备份图纸标识重复')
  for (const u of data.confirmedUsages) {
    if (!u || typeof u !== 'object' || typeof u.patternId !== 'string' || !Number.isSafeInteger(u.version) || !Array.isArray(u.lines)) return fail('invalid-backup', '备份确认用量无效')
    if (!patternIds.has(u.patternId)) return fail('invalid-backup', '确认用量缺少图纸关联')
    for (const line of u.lines) {
      if (!line || typeof line !== 'object' || !COLOR_SET.has(line.code) || !Number.isSafeInteger(line.qty) || line.qty < 0) return fail('invalid-backup', '确认用量行无效')
    }
  }
  for (const make of data.makes) {
    if (!patternIds.has(make.patternId)) return fail('invalid-backup', '制作记录缺少图纸关联')
  }
  for (const p of data.patterns) {
    if (!p.thumbnail || !p.thumbnail.base64) return fail('invalid-backup', '图纸缺少缩略图')
    if (p.thumbnail.base64.includes('/') && p.thumbnail.base64.startsWith('/')) {
      return fail('invalid-backup', '缩略图不能是设备路径')
    }
  }
  const dumped = JSON.stringify(data)
  if (dumped.includes('"originalImage"') || dumped.includes('keystore') || dumped.includes('privateKey')) {
    return fail('invalid-backup', '备份含有不允许的字段')
  }
  try {
    const stateError = validateLedgerState(backupToState(data))
    if (stateError) return fail('invalid-backup', '备份账本结构无效：' + stateError)
  } catch {
    return fail('invalid-backup', '备份账本结构无效')
  }
  const backup: BackupFile = inputFormatVersion === BACKUP_FORMAT_VERSION
    ? data
    : { ...data, formatVersion: BACKUP_FORMAT_VERSION, requests: data.requests ?? [] }
  return { ok: true, backup }
}

function backupToState(backup: BackupFile): LedgerState {
  const stock: Record<string, StockRow> = {}
  for (const row of backup.stock) stock[row.code] = clone(row)
  for (const code of COLOR_CODES) {
    if (!stock[code]) stock[code] = { code, qty: 0, estimated: true, baseline: null, entered: false }
  }
  return {
    epoch: backup.epoch,
    seq: backup.seq,
    palette: clone(backup.palette),
    settings: clone(backup.settings),
    stock,
    operations: clone(backup.operations),
    movements: clone(backup.movements),
    patterns: clone(backup.patterns).map((p) => ({ ...p, sizeNote: p.sizeNote ?? '', archivedAt: p.archivedAt ?? null })),
    confirmedUsages: clone(backup.confirmedUsages),
    drafts: [],
    makes: clone(backup.makes),
    requests: clone(backup.requests ?? []),
  }
}

export function backupContainsForbidden(backup: BackupFile): boolean {
  const text = JSON.stringify(backup)
  if (text.includes('originalFullImage') || text.includes('originalImage')) return true
  if (/\/home\/|\/data\/user\/|C:\\\\Users/.test(text)) return true
  return false
}

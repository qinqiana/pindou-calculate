import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { COLOR_CODES, PALETTE } from '../app/src/ledger/catalog.ts'
import { TINY_PNG, bytesToBase64, sniffImage } from '../app/src/ledger/image.ts'
import { Ledger } from '../app/src/ledger/operations.ts'
import { APP_VERSION, MAX_QTY, canonical } from '../app/src/ledger/numbers.ts'
import { LedgerStore, PersistError, memorySink } from '../app/src/ledger/store.ts'
import { openNodeStore } from '../app/src/ledger/store-node.ts'

function clock() {
  let n = 0
  return () => new Date(Date.UTC(2026, 0, 1, 8, 0, n++)).toISOString()
}

function ledger() {
  return new Ledger(undefined, clock())
}

function openFile(path: string) {
  return new Ledger(openNodeStore(path), clock())
}

function must<T extends { ok: boolean }>(result: T, label: string): T {
  assert.equal(result.ok, true, label + ' ' + JSON.stringify(result))
  return result
}

function jpeg1x1(): Uint8Array {
  return new Uint8Array(readFileSync('tests/fixtures/webp/tiny.jpg'))
}

test('MARD 221 catalog groups and search', () => {
  const l = ledger()
  const all = l.listStock()
  assert.equal(all.length, 221)
  const groups: Record<string, number> = {}
  for (const row of all) groups[row.code[0]] = (groups[row.code[0]] || 0) + 1
  assert.deepEqual(groups, { A: 26, B: 32, C: 29, D: 26, E: 24, F: 25, G: 21, H: 23, M: 15 })
  assert.equal(new Set(all.map((r) => r.code)).size, 221)
  assert.equal(l.search('C12').map((r) => r.code).join(), 'C12')
  assert.equal(l.search(' c12 ').map((r) => r.code).join(), 'C12')
  assert.equal(l.search('ZZ9').length, 0)
  assert.equal(l.getStock('ZZ9'), null)
  for (const row of all) {
    assert.equal(row.qty, 0)
    assert.equal(row.baseline, null)
    assert.equal(row.entered, false)
  }
})

test('first-entry only A1 leaves 220 colors at 0 without baseline', () => {
  const l = ledger()
  const preview = must(l.previewFirstEntry([{ code: 'A1', qty: 1000 }]), 'preview')
  assert.equal(preview.ok && preview.lines.length, 1)
  const saved = must(l.commitFirstEntry('r-a1', [{ code: 'A1', qty: 1000 }], preview.token), 'save A1')
  assert.equal(saved.ok, true)
  const a1 = l.getStock('A1')!
  assert.equal(a1.qty, 1000)
  assert.equal(a1.baseline, 1000)
  assert.equal(a1.entered, true)
  assert.equal(a1.estimated, true)
  const others = l.listStock().filter((r) => r.code !== 'A1')
  assert.equal(others.length, 220)
  for (const row of others) {
    assert.equal(row.qty, 0)
    assert.equal(row.baseline, null)
    assert.equal(row.entered, false)
  }
  const again = l.commitFirstEntry('r-a1-new', [{ code: 'A1', qty: 800 }], l.token())
  assert.equal(again.ok, false)
  if (!again.ok) assert.equal(again.code, 'already-entered')
  assert.equal(l.getStock('A1')!.qty, 1000)
  const retry = must(l.commitFirstEntry('r-a1', [{ code: 'A1', qty: 1000 }], l.token()), 'retry')
  assert.equal(retry.ok && retry.operationId, saved.ok && saved.operationId)
  assert.equal(l.getStock('A1')!.qty, 1000)
  assert.equal(l.movements('A1').length, 1)
})

test('illegal numbers and unknown colors never partial-write', () => {
  const l = ledger()
  const t = l.token()
  must(l.commitFirstEntry('ok', [{ code: 'A1', qty: 100 }], t), 'seed')
  const seq = l.token()
  assert.equal(l.commitCount('bad-neg', [{ code: 'A1', qty: -1 }], seq).ok, false)
  assert.equal(l.commitCount('bad-dec', [{ code: 'A1', qty: 1.5 }], seq).ok, false)
  assert.equal(l.commitCount('bad-ov', [{ code: 'A1', qty: MAX_QTY + 1 }], seq).ok, false)
  assert.equal(l.commitCount('bad-code', [{ code: 'ZZ9', qty: 1 }], seq).ok, false)
  assert.equal(l.commitCount('mixed', [{ code: 'A1', qty: 8 }, { code: 'NOPE', qty: 1 }], seq).ok, false)
  assert.equal(l.getStock('A1')!.qty, 100)
  assert.equal(l.movements('A1').length, 1)
})

test('count, flag-only, restock +5, mixed restock reject', () => {
  const l = ledger()
  must(l.commitFirstEntry('s', [{ code: 'A1', qty: 500 }, { code: 'B1', qty: 300 }], l.token()), 'seed')
  const a1b = l.getStock('A1')!.baseline
  const counted = must(l.commitCount('c1', [{ code: 'A1', qty: 70 }], l.token()), 'count')
  assert.equal(l.getStock('A1')!.qty, 70)
  assert.equal(l.getStock('A1')!.baseline, a1b)
  const mv = l.movements('A1').at(-1)!
  assert.equal(mv.movement.delta, -430)
  assert.equal(mv.operation.reason, '盘点更正')
  must(l.commitFlags('f1', [{ code: 'A1', estimated: false }], l.token()), 'flag')
  assert.equal(l.getStock('A1')!.estimated, false)
  assert.equal(l.getStock('A1')!.qty, 70)
  assert.equal(l.getStock('A1')!.baseline, a1b)
  const flagMv = l.movements('A1').at(-1)!
  assert.equal(flagMv.movement.qtyBefore, 70)
  assert.equal(flagMv.movement.qtyAfter, 70)
  assert.equal(flagMv.movement.estimatedBefore, true)
  assert.equal(flagMv.movement.estimatedAfter, false)

  const l2 = ledger()
  must(l2.commitFirstEntry('s2', [{ code: 'B1', qty: 10 }], l2.token()), 'b1')
  must(l2.commitRestock('rs', [{ code: 'B1', qty: 15 }], l2.token()), 'restock')
  assert.equal(l2.getStock('B1')!.qty, 15)
  assert.equal(l2.getStock('B1')!.baseline, 15)
  assert.equal(l2.movements('B1').at(-1)!.movement.delta, 5)

  const l3 = ledger()
  must(l3.commitFirstEntry('s3', [{ code: 'A1', qty: 500 }, { code: 'B1', qty: 300 }], l3.token()), 'seed3')
  const mixed = l3.commitRestock('mix', [{ code: 'A1', qty: 800 }, { code: 'B1', qty: 250 }], l3.token())
  assert.equal(mixed.ok, false)
  if (!mixed.ok) {
    assert.ok(mixed.colors && mixed.colors.includes('B1'))
    assert.match(mixed.message, /B1/)
  }
  assert.equal(l3.getStock('A1')!.qty, 500)
  assert.equal(l3.getStock('B1')!.qty, 300)
})

test('percentage warn at 100 not 101; restock baseline 1200; count/make do not reset', () => {
  const l = ledger()
  must(l.commitFirstEntry('e', [{ code: 'A1', qty: 1000 }], l.token()), 'entry')
  must(l.setLowStockPercent('p', 10, l.token()), 'percent')
  must(l.commitCount('n100', [{ code: 'A1', qty: 100 }], l.token()), '100')
  assert.equal(l.lowStock('A1'), true)
  must(l.commitCount('n101', [{ code: 'A1', qty: 101 }], l.token()), '101')
  assert.equal(l.lowStock('A1'), false)
  must(l.commitRestock('to1200', [{ code: 'A1', qty: 1200 }], l.token()), '1200')
  assert.equal(l.getStock('A1')!.baseline, 1200)
  must(l.commitCount('n120', [{ code: 'A1', qty: 120 }], l.token()), '120')
  assert.equal(l.lowStock('A1'), true)
  must(l.commitCount('n121', [{ code: 'A1', qty: 121 }], l.token()), '121')
  assert.equal(l.lowStock('A1'), false)
  assert.equal(l.getStock('A1')!.baseline, 1200)
  const unentered = l.getStock('B1')!
  assert.equal(unentered.baseline, null)
  assert.equal(l.lowStock('B1'), false)
})

test('95-bead closed loop: gap, restock list, make, retry, achievements, void after count', () => {
  const l = ledger()
  must(l.commitFirstEntry('stock', [{ code: 'A1', qty: 100 }, { code: 'B1', qty: 10 }], l.token()), 'stock')
  const created = must(l.createPattern('pat', { name: '95颗样例', sourceNote: 'spec', imageBytes: TINY_PNG }, l.token()), 'pattern')
  const patternId = created.ok ? created.patternId! : ''
  must(l.saveDraft(patternId, [{ code: 'A1', qty: 1 }, { code: 'B1', qty: 1 }]), 'draft')
  assert.equal(l.getPattern(patternId)!.confirmed, null)
  const confirmed = must(
    l.confirmUsage(
      'cu2',
      patternId,
      { lines: [{ code: 'A1', qty: 80 }, { code: 'B1', qty: 15 }] },
      l.token(),
    ),
    'confirm',
  )
  assert.equal(confirmed.ok && confirmed.perColorSum, 95)
  assert.equal(l.getStock('A1')!.qty, 100)
  const gap = must(l.previewGap(patternId), 'gap')
  assert.equal(gap.ok && gap.totalDemand, 95)
  const byCode = Object.fromEntries((gap.ok ? gap.lines : []).map((x) => [x.code, x]))
  assert.equal(byCode.A1.remaining, 20)
  assert.equal(byCode.B1.gap, 5)
  assert.equal(gap.ok && gap.canMake, false)
  const list = must(l.exportRestockList(patternId), 'list')
  assert.match(list.ok ? list.text : '', /B1 缺 5/)
  assert.doesNotMatch(list.ok ? list.csv : '', /100/)
  assert.match(list.ok ? list.text : '', /不是完整备份/)
  const blocked = l.make('make1', patternId, l.token())
  assert.equal(blocked.ok, false)
  assert.equal(l.getStock('A1')!.qty, 100)
  assert.equal(l.getStock('B1')!.qty, 10)
  assert.equal(l.listMakes().length, 0)
  must(l.commitRestock('b1to15', [{ code: 'B1', qty: 15 }], l.token()), 'restock b1')
  const made = must(l.make('make1b', patternId, l.token()), 'make')
  assert.equal(l.getStock('A1')!.qty, 20)
  assert.equal(l.getStock('B1')!.qty, 0)
  assert.equal(l.listMakes().length, 1)
  const retry = must(l.make('make1b', patternId, l.token()), 'retry make')
  assert.equal(retry.ok && retry.makeId, made.ok && made.makeId)
  assert.equal(l.getStock('A1')!.qty, 20)
  assert.equal(l.listMakes().length, 1)
  const ach = l.achievements()
  assert.equal(ach.totalUsed, 95)
  assert.equal(ach.perColor.A1, 80)
  assert.equal(ach.perColor.B1, 15)
  assert.equal(ach.completedMakes, 1)
  must(l.commitCount('a1-300', [{ code: 'A1', qty: 300 }], l.token()), 'count 300')
  assert.equal(l.achievements().totalUsed, 95)
  const a1Baseline = l.getStock('A1')!.baseline
  must(l.voidMake('void1', made.ok ? made.makeId! : '', l.token()), 'void')
  assert.equal(l.getStock('A1')!.qty, 380)
  assert.equal(l.getStock('B1')!.qty, 15)
  assert.equal(l.getStock('A1')!.baseline, a1Baseline)
  assert.equal(l.achievements().totalUsed, 0)
  assert.equal(l.achievements().completedMakes, 0)
  const voidAgain = l.voidMake('void2', made.ok ? made.makeId! : '', l.token())
  assert.equal(voidAgain.ok, false)
  assert.equal(l.getStock('A1')!.qty, 380)
})

test('zero-usage make, remake, edit usage keeps old snapshot', () => {
  const l = ledger()
  must(l.commitFirstEntry('st', [{ code: 'A1', qty: 80 }], l.token()), 'stock')
  const p = must(l.createPattern('p', { name: '零用量', imageBytes: TINY_PNG }, l.token()), 'p')
  const id = p.ok ? p.patternId! : ''
  must(l.confirmUsage('c0', id, { lines: [] }, l.token()), 'zero confirm')
  const z = must(l.make('zmake', id, l.token()), 'zero make')
  assert.equal(l.getStock('A1')!.qty, 80)
  assert.equal(l.movements().filter((m) => m.operation.type === 'make').length, 0)
  assert.equal(l.achievements().completedMakes, 1)
  assert.equal(l.achievements().totalUsed, 0)
  must(l.make('zmake', id, l.token()), 'zero retry')
  assert.equal(l.achievements().completedMakes, 1)
  const p2 = must(l.createPattern('p2', { name: '再拼', imageBytes: TINY_PNG }, l.token()), 'p2')
  const id2 = p2.ok ? p2.patternId! : ''
  must(l.confirmUsage('c80', id2, { lines: [{ code: 'A1', qty: 80 }] }, l.token()), '80')
  const m1 = must(l.make('m80', id2, l.token()), 'make80')
  must(l.commitRestock('more', [{ code: 'A1', qty: 80 }], l.token()), 'refill')
  must(
    l.confirmUsage('c60', id2, { lines: [{ code: 'A1', qty: 60 }] }, l.token()),
    'edit 60',
  )
  const m2 = must(l.make('m60', id2, l.token()), 'make60')
  const makes = l.listMakes(id2)
  assert.equal(makes.length, 2)
  assert.deepEqual(makes.find((m) => m.id === (m1.ok && m1.makeId))!.linesSnapshot, [{ code: 'A1', qty: 80 }])
  assert.deepEqual(makes.find((m) => m.id === (m2.ok && m2.makeId))!.linesSnapshot, [{ code: 'A1', qty: 60 }])
  assert.equal(l.getPattern(id2)!.confirmed!.version, 2)
})

test('title 148 vs per-color 130 keeps formal total 130', () => {
  const l = ledger()
  const p = must(l.createPattern('p', { name: '标题差', imageBytes: TINY_PNG }, l.token()), 'p')
  const id = p.ok ? p.patternId! : ''
  const blocked = l.confirmUsage(
    't1',
    id,
    { lines: [{ code: 'A1', qty: 100 }, { code: 'B1', qty: 30 }], titleTotal: 148 },
    l.token(),
  )
  assert.equal(blocked.ok, false)
  if (!blocked.ok) {
    assert.equal(blocked.difference, 18)
    assert.equal(blocked.perColorSum, 130)
  }
  assert.equal(l.getPattern(id)!.confirmed, null)
  const ok = must(
    l.confirmUsage(
      't2',
      id,
      {
        lines: [{ code: 'A1', qty: 100 }, { code: 'B1', qty: 30 }],
        titleTotal: 148,
        acknowledgeTitleDiff: true,
      },
      l.token(),
    ),
    'ack',
  )
  assert.equal(ok.ok && ok.perColorSum, 130)
  assert.equal(l.getPattern(id)!.confirmed!.titleDiff, 18)
  const gap = must(l.previewGap(id), 'gap')
  assert.equal(gap.ok && gap.totalDemand, 130)
})

test('recognition provenance is derived, risk-gated, replay-safe, and does not spend stock', () => {
  const l = ledger()
  must(l.commitFirstEntry('stock', [{ code: 'A1', qty: 20 }], l.token()), 'stock')
  const created = must(l.createPattern('provenance-pattern', { name: '识别来源', imageBytes: TINY_PNG }, l.token()), 'pattern')
  const id = created.patternId
  const recognition = {
    source: 'legend',
    algorithmVersion: 'legend-test-1',
    originalStatus: 'partial',
    candidateLines: [{ code: 'A1', qty: 5 }],
    candidateTitleTotal: 5,
    modified: false,
    risks: [{ id: 'truncated', reason: '图例可能截断', raw: 'A1 5…', resolved: false }],
    riskAcknowledged: true,
  } as any
  must(l.confirmUsage('recognized', id, { lines: [{ code: 'A1', qty: 4 }], titleTotal: 4, recognition }, l.token()), 'recognized')
  assert.equal(l.getStock('A1')!.qty, 20)
  const saved = l.getPattern(id)!.confirmed!
  assert.equal(saved.inputMethod, 'legend')
  assert.equal(saved.recognition!.source, 'legend')
  assert.equal(saved.recognition!.modified, true)
  assert.equal(saved.recognition!.originalStatus, 'partial')
  assert.equal(saved.recognition!.riskAcknowledged, true)

  const replay = l.confirmUsage('recognized', id, { lines: [{ code: 'A1', qty: 4 }], titleTotal: 4, recognition }, l.token())
  assert.equal(replay.ok, true)
  assert.equal(l.getPattern(id)!.confirmed!.version, 1)
  const conflict = l.confirmUsage('recognized', id, { lines: [{ code: 'A1', qty: 4 }], titleTotal: 4, recognition: { ...recognition, source: 'grid' } }, l.token())
  assert.equal(conflict.ok, false)
  if (!conflict.ok) assert.equal(conflict.code, 'request-conflict')

  const made = must(l.make('make-recognized', id, l.token()), 'make')
  assert.equal(l.getStock('A1')!.qty, 16)
  must(l.confirmUsage('manual-revision', id, { lines: [{ code: 'A1', qty: 2 }] }, l.token()), 'manual revision')
  const second = must(l.make('make-manual', id, l.token()), 'manual make')
  const makes = l.listMakes(id)
  const versions = l.getPattern(id)!.versions
  assert.deepEqual(versions.map((usage) => usage.version), [1, 2])
  assert.equal(versions[0].inputMethod, 'legend')
  assert.equal(versions[0].recognition!.source, 'legend')
  assert.equal(versions[1].inputMethod, 'manual')
  assert.equal(makes.find((m) => m.id === made.makeId)!.usageVersion, 1)
  assert.equal(makes.find((m) => m.id === second.makeId)!.usageVersion, 2)
  assert.deepEqual(makes.find((m) => m.id === made.makeId)!.linesSnapshot, [{ code: 'A1', qty: 4 }])

  const restored = ledger()
  must(restored.restoreReplace('restore-provenance', l.exportBackup(), restored.token()), 'restore provenance')
  assert.deepEqual(restored.store.live().confirmedUsages.find((usage) => usage.patternId === id && usage.version === 1)!.recognition, saved.recognition)
  assert.deepEqual(restored.listMakes().map((m) => m.linesSnapshot), makes.map((m) => m.linesSnapshot))
})

test('recognition provenance rejects empty or unacknowledged automatic evidence while manual zero remains valid', () => {
  const l = ledger()
  const created = must(l.createPattern('provenance-validation', { name: '识别校验', imageBytes: TINY_PNG }, l.token()), 'pattern')
  const id = created.patternId
  const base = {
    source: 'grid',
    algorithmVersion: 'grid-test-1',
    originalStatus: 'ready',
    candidateLines: [{ code: 'A1', qty: 1 }],
    candidateTitleTotal: null,
    modified: false,
    risks: [],
    riskAcknowledged: false,
  } as any
  const empty = l.confirmUsage('empty-candidate', id, { lines: [], recognition: { ...base, candidateLines: [] } }, l.token())
  assert.equal(empty.ok, false)
  if (!empty.ok) assert.equal(empty.code, 'invalid-provenance')
  const unknown = l.confirmUsage('unknown-source', id, { lines: [{ code: 'A1', qty: 1 }], recognition: { ...base, source: 'failed' } }, l.token())
  assert.equal(unknown.ok, false)
  if (!unknown.ok) assert.equal(unknown.code, 'invalid-provenance')
  const risk = l.confirmUsage('risk', id, { lines: [{ code: 'A1', qty: 1 }], recognition: { ...base, originalStatus: 'partial', risks: [{ id: 'r', reason: '缺覆盖', raw: '', resolved: true }] } }, l.token())
  assert.equal(risk.ok, false)
  if (!risk.ok) assert.equal(risk.code, 'recognition-risk')
  must(l.confirmUsage('manual-zero', id, { lines: [] }, l.token()), 'manual zero')
  assert.equal(l.getPattern(id)!.confirmed!.inputMethod, 'manual')
})

test('PNG and JPG import; cancel does not create; confirm does not change stock', () => {
  const l = ledger()
  const before = l.getStock('A1')!.qty
  must(l.createPattern('png', { name: 'png图', imageBytes: TINY_PNG }, l.token()), 'png')
  must(l.createPattern('jpg', { name: 'jpg图', imageBytes: jpeg1x1() }, l.token()), 'jpg')
  const webp = l.createPattern('webp', { name: 'bad', imageBytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]) }, l.token())
  assert.equal(webp.ok, false)
  assert.equal(l.listPatterns().length, 2)
  assert.equal(l.getStock('A1')!.qty, before)
  const id = l.listPatterns()[0].id
  must(l.confirmUsage('c', id, { lines: [{ code: 'A1', qty: 5 }] }, l.token()), 'confirm')
  assert.equal(l.getStock('A1')!.qty, before)
})

test('PNG accepts metadata after complete IEND but rejects incomplete IEND', () => {
  const withTrailer = new Uint8Array([...TINY_PNG, ...new TextEncoder().encode('vivo screenshot metadata')])
  const image = sniffImage(withTrailer)
  assert.equal(image.ok, true)
  const l = ledger()
  assert.equal(l.createPattern('png-trailer', { name: '厂商截图', imageBytes: withTrailer }, l.token()).ok, true)

  const truncated = withTrailer.subarray(0, TINY_PNG.length - 1)
  const nonzeroIend = withTrailer.slice()
  nonzeroIend[TINY_PNG.length - 9] = 1
  const corruptCrcs: Uint8Array[] = []
  const view = new DataView(TINY_PNG.buffer, TINY_PNG.byteOffset, TINY_PNG.byteLength)
  for (let at = 8; at < TINY_PNG.length;) {
    const next = at + 12 + view.getUint32(at)
    const corrupt = TINY_PNG.slice()
    corrupt[next - 1] ^= 1
    corruptCrcs.push(corrupt)
    at = next
  }
  assert.equal(corruptCrcs.length, 3)
  for (const [index, bytes] of [truncated, nonzeroIend, ...corruptCrcs].entries()) {
    assert.equal(sniffImage(bytes).ok, false)
    assert.equal(l.createPattern('png-bad-' + index, { name: '损坏截图', imageBytes: bytes }, l.token()).ok, false)
  }
  assert.equal(l.listPatterns().length, 1)
})

test('未确认用量与确认后的零用量在图纸卡片上可区分', () => {
  const l = ledger()
  const created = must(l.createPattern('p-state', { name: '状态图纸', imageBytes: TINY_PNG }, l.token()), 'create')
  const id = created.ok ? created.patternId! : ''
  assert.equal(l.listPatternCards()[0].totalDemand, null)
  must(l.confirmUsage('p-state-confirm', id, { lines: [] }, l.token()), 'confirm zero')
  assert.equal(l.listPatternCards()[0].totalDemand, 0)
})

test('图纸归档只移出主列表，保留用量、制作、历史和备份且可幂等重试', () => {
  const l = ledger()
  must(l.commitFirstEntry('archive-stock', [{ code: 'A1', qty: 10 }], l.token()), 'stock')
  const created = must(l.createPattern('archive-pattern-create', { name: '待移除图纸', imageBytes: TINY_PNG }, l.token()), 'create')
  const id = created.ok ? created.patternId! : ''
  must(l.confirmUsage('archive-confirm', id, { lines: [{ code: 'A1', qty: 2 }] }, l.token()), 'confirm')
  const made = must(l.make('archive-make', id, l.token()), 'make')
  const qtyBefore = l.getStock('A1')!.qty
  const archived = must(l.archivePattern('archive-remove', id, l.token()), 'archive')
  assert.equal(archived.patternId, id)
  assert.equal(l.listPatternCards().length, 0)
  assert.equal(l.listPatterns().length, 1)
  assert.equal(l.getPattern(id)!.confirmed!.lines[0].qty, 2)
  assert.equal(l.listMakes(id).length, 1)
  assert.equal(l.getStock('A1')!.qty, qtyBefore)
  assert.equal(l.store.live().operations.at(-1)!.type, 'archive-pattern')
  const retry = must(l.archivePattern('archive-remove', id, l.token()), 'archive retry')
  assert.equal(retry.operationId, archived.operationId)
  const duplicate = l.archivePattern('archive-remove-again', id, l.token())
  assert.equal(duplicate.ok, false)
  if (!duplicate.ok) assert.equal(duplicate.code, 'already-archived')

  const backup = l.exportBackup()
  assert.equal(backup.patterns[0].archivedAt !== null, true)
  const legacy = JSON.parse(JSON.stringify(backup)) as any
  delete legacy.patterns[0].archivedAt
  const restored = ledger()
  assert.equal(restored.validateBackup(legacy).ok, true)

  const active = ledger()
  const activePattern = must(active.createPattern('archive-legacy', { name: '旧图纸', imageBytes: TINY_PNG }, active.token()), 'legacy create')
  const envelope = JSON.parse(JSON.stringify(active.store.envelope)) as any
  delete envelope.live.patterns[0].archivedAt
  const loaded = new Ledger(LedgerStore.hydrate(memorySink({ json: JSON.stringify(envelope) })), clock())
  assert.equal(loaded.listPatternCards().length, 1)
  assert.equal(activePattern.ok, true)
  assert.equal(made.ok, true)
})

test('restock csv escapes formula-like names and is not a backup', () => {
  const l = ledger()
  must(l.commitFirstEntry('s', [{ code: 'B1', qty: 0 }], l.token()), 's')
  const p = must(l.createPattern('p', { name: '=1+1,换行', imageBytes: TINY_PNG }, l.token()), 'p')
  const id = p.ok ? p.patternId! : ''
  must(l.confirmUsage('c', id, { lines: [{ code: 'B1', qty: 3 }] }, l.token()), 'c')
  const list = must(l.exportRestockList(id), 'csv')
  assert.match(list.ok ? list.csv : '', /^图纸名称/)
  assert.match(list.ok ? list.csv : '', /"'=1\+1,换行"|"""=1\+1,换行"""|'=1\+1,换行/)
  assert.doesNotMatch(list.ok ? list.text : '', /完整账本恢复(?!)/)
  assert.match(list.ok ? list.text : '', /不能用于恢复账本|不是完整备份/)
})

test('stale preview cannot overwrite a newer write', () => {
  const l = ledger()
  const first = must(l.previewFirstEntry([{ code: 'A1', qty: 100 }]), 'p1')
  must(l.commitFirstEntry('n1', [{ code: 'A1', qty: 40 }], l.token()), 'newer')
  const stale = l.commitFirstEntry('old', [{ code: 'A1', qty: 100 }], first.ok ? first.token : l.token())
  assert.equal(stale.ok, false)
  assert.equal(l.getStock('A1')!.qty, 40)
})

test('interrupt before commit leaves prior state; restart reloads last commit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pindou-'))
  const path = join(dir, 'ledger.json')
  const l = openFile(path)
  must(l.commitFirstEntry('a', [{ code: 'A1', qty: 100 }], l.token()), 'a')
  l.setInterrupt('before-commit')
  const interrupted = l.commitCount('b', [{ code: 'A1', qty: 1 }], l.token())
  assert.equal(interrupted.ok, false)
  assert.equal(l.getStock('A1')!.qty, 100)
  const reopened = openFile(path)
  assert.equal(reopened.getStock('A1')!.qty, 100)
  assert.equal(reopened.movements('A1').length, 1)
})

test('backup export validate cancel replace; truncated and unknown version rejected', () => {
  const l = ledger()
  must(l.commitFirstEntry('s', [{ code: 'A1', qty: 100 }, { code: 'B1', qty: 10 }], l.token()), 's')
  const p = must(l.createPattern('p', { name: '备份样例', imageBytes: TINY_PNG }, l.token()), 'p')
  const id = p.ok ? p.patternId! : ''
  must(l.confirmUsage('c', id, { lines: [{ code: 'A1', qty: 80 }, { code: 'B1', qty: 15 }] }, l.token()), 'c')
  must(l.commitRestock('r', [{ code: 'B1', qty: 15 }], l.token()), 'r')
  must(l.make('m1', id, l.token()), 'm1')
  must(l.commitRestock('r2', [{ code: 'A1', qty: 80 }, { code: 'B1', qty: 15 }], l.token()), 'r2')
  must(l.make('m2', id, l.token()), 'm2')
  must(l.voidMake('v1', l.listMakes()[0].id, l.token()), 'void')
  must(l.commitCount('cnt', [{ code: 'A1', qty: 9 }], l.token()), 'count')
  const backup = l.exportBackup()
  assert.equal(backup.formatVersion, 2)
  assert.equal(backup.stock.length, 221)
  assert.equal(backup.makes.length, 2)
  assert.ok(backup.patterns[0].thumbnail.base64.length > 10)
  const dumped = JSON.stringify(backup)
  assert.doesNotMatch(dumped, /\/home\//)
  assert.doesNotMatch(dumped, /originalFullImage/)
  const other = ledger()
  must(other.commitFirstEntry('x', [{ code: 'A1', qty: 1 }], other.token()), 'other')
  const valid = must(other.validateBackup(backup), 'validate')
  assert.equal(valid.ok && valid.diff.replaceNotMerge, true)
  other.cancelRestore()
  assert.equal(other.getStock('A1')!.qty, 1)
  must(other.restoreReplace('rest', backup, other.token()), 'restore')
  assert.equal(other.getStock('A1')!.qty, 9)
  assert.equal(other.listMakes().length, 2)
  assert.equal(other.achievements().completedMakes, 1)
  const truncated = other.validateBackup(JSON.stringify(backup).slice(0, 40))
  assert.equal(truncated.ok, false)
  assert.equal(other.getStock('A1')!.qty, 9)
  const unknown = other.validateBackup({ ...backup, formatVersion: 99 })
  assert.equal(unknown.ok, false)
  const dup = JSON.parse(JSON.stringify(backup))
  dup.makes.push(dup.makes[0])
  assert.equal(other.validateBackup(dup).ok, false)
})

test('备份版本与 manifest 一致，并拒绝损坏的嵌套结构', () => {
  const l = ledger()
  const backup = l.exportBackup()
  const manifest = JSON.parse(readFileSync('app/manifest.json', 'utf8')) as { versionName: string }
  assert.equal(APP_VERSION, manifest.versionName)
  assert.equal(backup.appVersion, manifest.versionName)

  const badRoot = { ...backup, epoch: -1 }
  assert.equal(l.validateBackup(badRoot).ok, false)
  const badStock = JSON.parse(JSON.stringify(backup))
  badStock.stock[0].estimated = 'yes'
  assert.equal(l.validateBackup(badStock).ok, false)
  const badPattern = JSON.parse(JSON.stringify(backup))
  badPattern.patterns = [null]
  assert.equal(l.validateBackup(badPattern).ok, false)
  const badRequest = JSON.parse(JSON.stringify(backup))
  badRequest.requests = [{ requestId: 'r', payloadCanonical: '{}', result: { ok: true } }]
  assert.equal(l.validateBackup(badRequest).ok, false)
})

test('genuine v1 backup migrates to v2; v2 provenance roundtrip and bad versions preserve live state', () => {
  const l = ledger()
  must(l.commitFirstEntry('backup-stock', [{ code: 'A1', qty: 9 }], l.token()), 'stock')
  const created = must(l.createPattern('backup-pattern', { name: '备份来源', imageBytes: TINY_PNG }, l.token()), 'pattern')
  const id = created.patternId
  must(l.confirmUsage('backup-confirm', id, { lines: [{ code: 'A1', qty: 3 }] }, l.token()), 'confirm')
  const backup = l.exportBackup()
  assert.equal(backup.formatVersion, 2)

  const v1 = JSON.parse(JSON.stringify(backup)) as any
  v1.formatVersion = 1
  for (const usage of v1.confirmedUsages) delete usage.recognition
  const migrated = must(l.validateBackup(v1), 'v1 validate')
  assert.equal(migrated.backup.formatVersion, 2)
  const restored = ledger()
  must(restored.restoreReplace('restore-v1', v1, restored.token()), 'v1 restore')
  assert.deepEqual(restored.listPatterns(), l.listPatterns())
  assert.deepEqual(restored.store.live().confirmedUsages, l.store.live().confirmedUsages.map((usage) => {
    const copy = { ...usage }
    delete (copy as any).recognition
    return copy
  }))

  const v1WithRecognition = JSON.parse(JSON.stringify(v1))
  v1WithRecognition.confirmedUsages[0].recognition = null
  assert.equal(l.validateBackup(v1WithRecognition).ok, false)

  const liveBefore = l.getStock('A1')!.qty
  const future = { ...backup, formatVersion: 3 }
  assert.equal(l.validateBackup(future).ok, false)
  assert.equal(l.getStock('A1')!.qty, liveBefore)
  const corrupt = JSON.parse(JSON.stringify(backup))
  corrupt.confirmedUsages[0].lines[0].code = 'ZZ9'
  assert.equal(l.validateBackup(corrupt).ok, false)
  assert.equal(l.getStock('A1')!.qty, liveBefore)
})

test('restore interrupt leaves complete before or complete after', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pindou-'))
  const path = join(dir, 'ledger.json')
  const l = openFile(path)
  must(l.commitFirstEntry('a', [{ code: 'A1', qty: 7 }], l.token()), 'a')
  const backup = l.exportBackup()
  const l2 = openFile(path)
  must(l2.commitCount('c', [{ code: 'A1', qty: 3 }], l2.token()), 'c')
  l2.setInterrupt('restore-prepare')
  assert.equal(l2.restoreReplace('rp', backup, l2.token()).ok, false)
  assert.equal(openFile(path).getStock('A1')!.qty, 3)
  const l3 = openFile(path)
  l3.setInterrupt('restore-write')
  assert.equal(l3.restoreReplace('rw', backup, l3.token()).ok, false)
  assert.equal(openFile(path).getStock('A1')!.qty, 3)
  const l4 = openFile(path)
  l4.setInterrupt('restore-switch')
  assert.equal(l4.restoreReplace('rs', backup, l4.token()).ok, false)
  const after = openFile(path)
  assert.ok(after.getStock('A1')!.qty === 3 || after.getStock('A1')!.qty === 7)
})

test('display palette swap does not change stock or history source records', () => {
  const l = ledger()
  must(l.commitFirstEntry('a', [{ code: 'A1', qty: 12 }], l.token()), 'a')
  const copy = JSON.parse(JSON.stringify(PALETTE))
  copy.sourceName = '另一份社区色'
  copy.colors[0].hex = '#000000'
  must(l.replaceDisplayPalette('pal', copy, l.token()), 'pal')
  assert.equal(l.getStock('A1')!.qty, 12)
  assert.equal(l.store.live().palette.colors[0].hex, '#000000')
  assert.equal(COLOR_CODES[0], 'A1')
})

test('share content has no inventory or paths', () => {
  const l = ledger()
  const p = must(l.createPattern('p', { name: '分享图', imageBytes: TINY_PNG }, l.token()), 'p')
  const content = must(l.shareContent(p.ok ? p.patternId! : ''), 'share')
  const text = JSON.stringify(content)
  assert.doesNotMatch(text, /库存|余额|\/home\/|history/)
  assert.equal(content.ok && content.patternName, '分享图')
})

test('zero-change count/restock batches skip operation and write no movements', () => {
  const l = ledger()
  must(l.commitFirstEntry('seed', [{ code: 'A1', qty: 100 }, { code: 'B1', qty: 10 }], l.token()), 'seed')
  const opsAfterSeed = l.exportBackup().operations.length
  const countSame = must(l.commitCount('c-same', [{ code: 'A1', qty: 100 }], l.token()), 'count same')
  assert.equal(countSame.ok && countSame.operationId, 'noop')
  const restockSame = must(l.commitRestock('r-same', [{ code: 'B1', qty: 10 }], l.token()), 'restock same')
  assert.equal(restockSame.ok && restockSame.operationId, 'noop')
  const flagSame = must(l.commitFlags('f-same', [{ code: 'A1', estimated: true }], l.token()), 'flag same')
  assert.equal(flagSame.ok && flagSame.operationId, 'noop')
  assert.equal(l.exportBackup().operations.length, opsAfterSeed)
  assert.equal(l.movements().length, 2)
  const replay = must(l.commitCount('c-same', [{ code: 'A1', qty: 100 }], l.token()), 'replay noop')
  assert.equal(replay.ok && replay.operationId, 'noop')
  assert.equal(l.getStock('A1')!.qty, 100)
  assert.equal(l.getStock('B1')!.qty, 10)
})

const LEAKED_IMAGE_KEYS = ['imageBytes', 'imageMime', 'uri', 'path', 'hash', 'thumbnailHistory', 'originalBytes', 'bytes', 'preview', 'snapshots']

function leakedImageKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) leakedImageKeys(item, found)
    return found
  }
  if (!value || typeof value !== 'object') return found
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (LEAKED_IMAGE_KEYS.includes(key)) found.add(key)
    leakedImageKeys(child, found)
  }
  return found
}

function assertNoOriginalImage(ledger: Ledger, original: Uint8Array) {
  const marker = bytesToBase64(original)
  const backup = ledger.exportBackup()
  assert.equal(JSON.stringify(backup).includes(marker), false)
  assert.deepEqual([...leakedImageKeys(backup)], [])
  for (const request of backup.requests) {
    const payload = JSON.parse(request.payloadCanonical) as unknown
    assert.equal(JSON.stringify(payload).includes(marker), false)
    assert.deepEqual([...leakedImageKeys(payload)], [])
  }
}

function patternView(ledger: Ledger, patternId: string) {
  const found = ledger.getPattern(patternId)
  assert.ok(found)
  return {
    name: found.pattern.name,
    sourceNote: found.pattern.sourceNote,
    sizeNote: found.pattern.sizeNote,
    thumbnail: found.pattern.thumbnail.base64,
    confirmedVersion: found.pattern.confirmedVersion,
    stock: ledger.getStock('A1')!.qty,
    movements: ledger.movements().length,
    operations: ledger.store.live().operations.length,
    requests: ledger.store.live().requests.length,
  }
}

test('atomic confirm stores name, notes, and a re-picked thumbnail in one confirm operation', () => {
  const l = ledger()
  must(l.commitFirstEntry('atomic-stock', [{ code: 'A1', qty: 40 }], l.token()), 'stock')
  const created = must(l.createPattern('atomic-pattern', { name: '原名', sourceNote: '旧来源', sizeNote: '旧尺寸', imageBytes: TINY_PNG }, l.token()), 'pattern')
  const id = created.patternId
  const opening = patternView(l, id)
  const replacement = jpeg1x1()
  const saved = must(
    l.confirmUsage(
      'atomic-confirm',
      id,
      {
        lines: [{ code: 'A1', qty: 2 }],
        patternMeta: { name: '  新名称  ', sourceNote: ' 新来源 ', sizeNote: ' 12cm ', imageBytes: replacement },
      },
      l.token(),
    ),
    'confirm',
  )
  assert.equal(saved.ok && saved.version, 1)
  assert.equal(saved.ok && saved.perColorSum, 2)
  const stored = l.getPattern(id)!
  assert.equal(stored.pattern.name, '新名称')
  assert.equal(stored.pattern.sourceNote, '新来源')
  assert.equal(stored.pattern.sizeNote, '12cm')
  assert.notEqual(stored.pattern.thumbnail.base64, opening.thumbnail)
  assert.equal(stored.pattern.thumbnail.mime, 'image/png')
  assert.equal(stored.confirmed!.lines[0].qty, 2)
  assert.equal(stored.confirmed!.version, 1)
  const sniffed = sniffImage(replacement)
  assert.equal(sniffed.ok, true)
  if (sniffed.ok) {
    const rotated = (sniffed.image.orientation ?? 1) >= 5
    assert.equal(stored.pattern.pixelWidth, rotated ? sniffed.image.height : sniffed.image.width)
    assert.equal(stored.pattern.pixelHeight, rotated ? sniffed.image.width : sniffed.image.height)
  }
  const ops = l.store.live().operations
  assert.deepEqual(ops.map((op) => op.type).filter((type) => type === 'confirm-usage' || type === 'pattern-meta'), ['confirm-usage'])
  assert.equal(l.store.live().requests.length, opening.requests + 1)
  assert.equal(l.store.live().operations.length, opening.operations + 1)
  assert.equal(l.getStock('A1')!.qty, 40)
  assert.equal(l.movements().length, opening.movements)
  const payload = JSON.parse(l.store.live().requests.find((request) => request.requestId === 'atomic-confirm')!.payloadCanonical)
  assert.equal(payload.patternMeta.thumbnail.base64, stored.pattern.thumbnail.base64)
  assert.equal(payload.patternMeta.name, '新名称')
  assertNoOriginalImage(l, replacement)
  const copy = ledger()
  must(copy.restoreReplace('atomic-restore', l.exportBackup(), copy.token()), 'restore')
  assert.equal(copy.getPattern(id)!.pattern.name, '新名称')
  assert.equal(copy.getPattern(id)!.pattern.thumbnail.base64, stored.pattern.thumbnail.base64)
  assert.equal(copy.getPattern(id)!.confirmed!.lines[0].qty, 2)
  assert.equal(copy.movements().length, opening.movements)
})

test('title diff, unacknowledged risk, bad image, and persist failure do not partially save a confirm', () => {
  const l = ledger()
  must(l.commitFirstEntry('fail-stock', [{ code: 'A1', qty: 40 }], l.token()), 'stock')
  const created = must(l.createPattern('fail-pattern', { name: '原名', sourceNote: '旧来源', sizeNote: '旧尺寸', imageBytes: TINY_PNG }, l.token()), 'pattern')
  const id = created.patternId
  must(l.saveDraft(id, [{ code: 'A1', qty: 1 }], 1), 'draft')
  const before = patternView(l, id)
  const replacement = jpeg1x1()
  const meta = { name: '不应保存', sourceNote: '不应保存', sizeNote: '不应保存', imageBytes: replacement }
  const same = () => assert.deepEqual(patternView(l, id), before)
  const titleDiff = l.confirmUsage('fail-title', id, { lines: [{ code: 'A1', qty: 1 }], titleTotal: 9, patternMeta: meta }, l.token())
  assert.equal(titleDiff.ok, false)
  if (!titleDiff.ok) assert.equal(titleDiff.code, 'title-diff')
  same()
  const risk = l.confirmUsage(
    'fail-risk',
    id,
    {
      lines: [{ code: 'A1', qty: 1 }],
      patternMeta: meta,
      recognition: {
        source: 'legend',
        algorithmVersion: 'pixel-glyph-0.8-dev',
        originalStatus: 'partial',
        candidateLines: [{ code: 'A1', qty: 1 }],
        candidateTitleTotal: null,
        modified: false,
        risks: [{ id: 'coverage', reason: '图例没有覆盖全图', raw: '', resolved: false }],
        riskAcknowledged: false,
      },
    },
    l.token(),
  )
  assert.equal(risk.ok, false)
  if (!risk.ok) assert.equal(risk.code, 'recognition-risk')
  same()
  const badImage = l.confirmUsage(
    'fail-image',
    id,
    { lines: [{ code: 'A1', qty: 1 }], patternMeta: { ...meta, imageBytes: new Uint8Array([1, 2, 3, 4]) } },
    l.token(),
  )
  assert.equal(badImage.ok, false)
  if (!badImage.ok) assert.equal(badImage.code, 'invalid-image')
  same()
  const badType = l.confirmUsage(
    'fail-type',
    id,
    { lines: [{ code: 'A1', qty: 1 }], patternMeta: { name: '不应保存', sourceNote: 3, sizeNote: '' } as never },
    l.token(),
  )
  assert.equal(badType.ok, false)
  if (!badType.ok) assert.equal(badType.code, 'invalid-meta')
  same()
  l.store.sink = {
    read: () => null,
    write() {
      throw new PersistError('full')
    },
  }
  const persisted = l.confirmUsage('fail-persist', id, { lines: [{ code: 'A1', qty: 1 }], patternMeta: meta }, l.token())
  assert.equal(persisted.ok, false)
  if (!persisted.ok) assert.equal(persisted.code, 'persist-failed')
  l.store.sink = null
  same()
  assert.equal(l.getPattern(id)!.confirmed, null)
  assert.equal(l.getPattern(id)!.draft!.lines[0].qty, 1)
})

test('same confirm request rejects changed metadata or image and does not repeat an identical confirm', () => {
  const l = ledger()
  const created = must(l.createPattern('replay-pattern', { name: '原名', imageBytes: TINY_PNG }, l.token()), 'pattern')
  const id = created.patternId
  const image = jpeg1x1()
  const input = {
    lines: [{ code: 'A1', qty: 3 }],
    patternMeta: { name: '一次', sourceNote: '来源', sizeNote: '9cm', imageBytes: image },
  }
  must(l.confirmUsage('replay-confirm', id, input, l.token()), 'first')
  const after = patternView(l, id)
  const replay = must(l.confirmUsage('replay-confirm', id, { ...input, patternMeta: { ...input.patternMeta, imageBytes: jpeg1x1() } }, l.token()), 'replay')
  assert.equal(replay.ok && replay.version, 1)
  assert.deepEqual(patternView(l, id), after)
  assert.equal(l.getPattern(id)!.versions.length, 1)
  const renamed = l.confirmUsage('replay-confirm', id, { ...input, patternMeta: { ...input.patternMeta, name: '另一次' } }, l.token())
  assert.equal(renamed.ok, false)
  if (!renamed.ok) assert.equal(renamed.code, 'request-conflict')
  assert.deepEqual(patternView(l, id), after)
  const otherImage = new Uint8Array(TINY_PNG)
  const recolored = l.confirmUsage('replay-confirm', id, { ...input, patternMeta: { ...input.patternMeta, imageBytes: otherImage } }, l.token())
  assert.equal(recolored.ok, false)
  if (!recolored.ok) assert.equal(recolored.code, 'request-conflict')
  assert.deepEqual(patternView(l, id), after)
  assert.equal(l.getPattern(id)!.pattern.thumbnail.base64, after.thumbnail)
})

test('confirm without pattern metadata keeps the manual request canonical', () => {
  const l = ledger()
  const created = must(l.createPattern('manual-pattern', { name: '手工', imageBytes: TINY_PNG }, l.token()), 'pattern')
  const id = created.patternId
  const lines = [{ code: 'A1', qty: 6 }]
  must(l.confirmUsage('manual-plain', id, { lines }, l.token()), 'plain')
  const plain = l.store.live().requests.find((request) => request.requestId === 'manual-plain')!
  assert.equal(plain.payloadCanonical, canonical({ kind: 'confirm-usage', patternId: id, lines, title: null, ack: false }))
  const withNull = must(l.confirmUsage('manual-null', id, { lines: [{ code: 'A1', qty: 1 }], patternMeta: null }, l.token()), 'null meta')
  assert.equal(withNull.ok && withNull.version, 2)
  const nullable = l.store.live().requests.find((request) => request.requestId === 'manual-null')!
  assert.equal(nullable.payloadCanonical, canonical({ kind: 'confirm-usage', patternId: id, lines: [{ code: 'A1', qty: 1 }], title: null, ack: false }))
  const replay = must(l.confirmUsage('manual-plain', id, { lines }, l.token()), 'plain replay')
  assert.equal(replay.ok && replay.version, 1)
  assert.equal(l.getPattern(id)!.versions.length, 2)
  assert.equal(l.getPattern(id)!.confirmed!.version, 2)
  assert.equal(l.store.live().confirmedUsages.filter((usage) => usage.patternId === id && usage.version === 1).length, 1)
})

test('restock preview omits unchanged colors so full selection only shows real changes', () => {
  const l = ledger()
  must(l.commitFirstEntry('seed-all', [{ code: 'A1', qty: 100 }, { code: 'B1', qty: 10 }], l.token()), 'seed')
  const preview = must(l.previewRestock([{ code: 'A1', qty: 100 }, { code: 'B1', qty: 15 }]), 'preview')
  assert.deepEqual(preview.ok && preview.lines.map((line) => line.code), ['B1'])
  must(l.commitRestock('full-selection', [{ code: 'A1', qty: 100 }, { code: 'B1', qty: 15 }], preview.token), 'save')
  assert.equal(l.movements('A1').length, 1)
  assert.equal(l.movements('B1').at(-1)!.movement.delta, 5)
})

test('low-stock boundary compares as integers: exact threshold warns, one above does not', () => {
  const l = ledger()
  must(l.commitFirstEntry('e2', [{ code: 'C1', qty: 70 }], l.token()), 'entry')
  must(l.setLowStockPercent('p2', 10, l.token()), 'percent')
  must(l.commitCount('c7', [{ code: 'C1', qty: 7 }], l.token()), '7')
  assert.equal(l.lowStock('C1'), true)
  must(l.commitCount('c8', [{ code: 'C1', qty: 8 }], l.token()), '8')
  assert.equal(l.lowStock('C1'), false)
  must(l.commitRestock('r210', [{ code: 'C1', qty: 210 }], l.token()), 'restock 210')
  must(l.commitCount('c21', [{ code: 'C1', qty: 21 }], l.token()), '21')
  assert.equal(l.lowStock('C1'), true)
  must(l.commitCount('c22', [{ code: 'C1', qty: 22 }], l.token()), '22')
  assert.equal(l.lowStock('C1'), false)
})

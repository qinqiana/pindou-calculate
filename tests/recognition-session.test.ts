import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasRecognitionRisk, invalidateRiskReview, readRecognition, recognitionProvenance, sameRecognition } from '../app/src/recognition/result.ts'
import { Ledger } from '../app/src/ledger/operations.ts'
import { LedgerStore, memorySink } from '../app/src/ledger/store.ts'
import { TINY_PNG } from '../app/src/ledger/image.ts'

test('recognition is tied to image/edit/version/epoch, while viewing and unrelated stock writes do not expire it', () => {
  const issued = { requestId: 'r1', imageSession: 1, patternId: 'p1', revision: 0, confirmedVersion: null, epoch: 1 }
  assert.ok(sameRecognition(issued, { ...issued }))
  for (const change of [{ requestId: 'r2' }, { imageSession: 2 }, { patternId: 'p2' }, { revision: 1 }, { confirmedVersion: 1 }, { epoch: 2 }]) assert.equal(sameRecognition(issued, { ...issued, ...change }), false)
  assert.equal(sameRecognition(issued, null), false)
  const raw = { algorithm: 'pixel-glyph-test', status: 'partial', source: 'legend', image: { width: 100, height: 100 }, candidates: [{ code: 'C12', quantity: 3, source: 'legend', evidenceIds: ['e1'] }], evidence: [{ id: 'e1', rawText: 'C12 3', region: [10, 20, 30, 15] }], doubts: [{ reason: '图例可能截断', evidenceId: 'e1' }], titleTotal: null }
  const candidate = readRecognition(raw)
  assert.deepEqual(candidate.evidence[0].codes, ['C12'])
  assert.deepEqual(candidate.risks[1].region, [10, 20, 30, 15])
  const provenance = recognitionProvenance(candidate)
  assert.equal(provenance.riskAcknowledged, false)
  assert.ok(hasRecognitionRisk(provenance))
  provenance.risks.forEach(r => r.resolved = true)
  assert.ok(hasRecognitionRisk(provenance), 'resolving one or all doubts cannot prove complete coverage')
  assert.equal(JSON.stringify(provenance).includes('region'), false, 'full image-region evidence is session-only')
  assert.throws(() => readRecognition({ ...raw, candidates: [{ code: 'C12', quantity: -1 }] }))
  assert.throws(() => readRecognition({ ...raw, candidates: [...raw.candidates, ...raw.candidates] }))
  assert.throws(() => readRecognition({ ...raw, candidates: [] }))
  assert.throws(() => recognitionProvenance(readRecognition({ ...raw, status: 'failed', source: null, candidates: [] })))
})

test('review risks, corrections and excluded source text survive confirm, reopen and backup without changing a make', () => {
  const raw = { algorithm: 'review-test', status: 'partial', source: 'legend', image: { width: 100, height: 100 },
    candidates: [{ code: 'A1', quantity: 3, source: 'legend', evidenceIds: ['e1'] }],
    evidence: [{ id: 'e1', rawText: 'A1 3', region: [10, 10, 30, 10] }, { id: 'e2', rawText: 'C30 12', region: [10, 30, 30, 10] }],
    doubts: [{ reason: '截断图例，C30 未计入', evidenceId: 'e2' }], total: 3, titleTotal: 3 }
  const result = readRecognition(raw)
  assert.deepEqual(result.risks[1].region, [10, 30, 30, 10])
  const slot = { json: null as string | null }
  const ledger = new Ledger(new LedgerStore(undefined, memorySink(slot)))
  assert.ok(ledger.commitFirstEntry('stock', [{ code: 'A1', qty: 20 }], ledger.token()).ok)
  const created = ledger.createPattern('pattern', { name: '异常图例', imageBytes: TINY_PNG }, ledger.token())
  assert.ok(created.ok)
  const id = created.patternId
  assert.ok(ledger.confirmUsage('first', id, { lines: [{ code: 'A1', qty: 1 }] }, ledger.token()).ok)
  assert.ok(ledger.make('make', id, ledger.token()).ok)
  const stock = ledger.listStock(), makes = ledger.listMakes()
  const provenance = recognitionProvenance(result)
  assert.equal(ledger.confirmUsage('unreviewed', id, { lines: result.lines, titleTotal: 3, recognition: provenance }, ledger.token()).ok, false)
  provenance.riskAcknowledged = true
  provenance.risks[1].resolved = true
  invalidateRiskReview(provenance)
  assert.equal(provenance.riskAcknowledged, false)
  assert.equal(provenance.risks[1].resolved, false)
  provenance.risks[1].resolved = true
  provenance.riskAcknowledged = true
  assert.ok(ledger.confirmUsage('corrected', id, { lines: [{ code: 'A1', qty: 4 }], recognition: provenance }, ledger.token()).ok)
  const reopened = new Ledger(LedgerStore.hydrate(memorySink(slot)))
  const confirmed = reopened.getPattern(id)!.confirmed!
  assert.equal(confirmed.recognition!.modified, true)
  assert.deepEqual(confirmed.recognition!.candidateLines, [{ code: 'A1', qty: 3 }])
  assert.ok(hasRecognitionRisk(confirmed.recognition), 'matching title and resolved item do not remove truncated coverage')
  assert.equal(confirmed.recognition!.risks[1].raw, 'C30 12')
  const restored = new Ledger()
  assert.ok(restored.restoreReplace('restore', reopened.exportBackup(), restored.token()).ok)
  assert.deepEqual(restored.getPattern(id)!.confirmed, confirmed)
  assert.deepEqual(restored.listStock(), stock)
  assert.deepEqual(restored.listMakes(), makes)
  const failed = readRecognition({ ...raw, status: 'failed', source: null, candidates: [], total: null })
  assert.throws(() => recognitionProvenance(failed))
  const correctedFailure = recognitionProvenance(failed, true)
  correctedFailure.riskAcknowledged = true
  assert.ok(restored.confirmUsage('manual-after-failure', id, { lines: [{ code: 'A1', qty: 2 }], recognition: correctedFailure }, restored.token()).ok)
  const final = new Ledger()
  assert.ok(final.restoreReplace('failure-restore', restored.exportBackup(), final.token()).ok)
  assert.equal(final.getPattern(id)!.confirmed!.recognition!.originalStatus, 'failed')
  assert.deepEqual(final.listStock(), stock)
  assert.deepEqual(final.listMakes(), makes)
})

test('bad numbers remain invalid; a safe aggregate above one billion remains valid', () => {
  const raw = { algorithm: 'numbers-test', status: 'partial', source: 'legend', image: { width: 100, height: 100 },
    candidates: [{ code: 'A1', quantity: 600_000_000 }, { code: 'B1', quantity: 600_000_000 }], evidence: [], doubts: [], total: 1_200_000_000, titleTotal: 1_200_000_000 }
  const result = readRecognition(raw)
  const ledger = new Ledger()
  const created = ledger.createPattern('p', { name: '大合计', imageBytes: TINY_PNG }, ledger.token())
  assert.ok(created.ok)
  const provenance = recognitionProvenance(result)
  provenance.riskAcknowledged = true
  assert.ok(ledger.saveDraft(created.patternId, result.lines, '1200000000').ok)
  assert.ok(ledger.confirmUsage('large', created.patternId, { lines: result.lines, titleTotal: '1200000000', recognition: provenance }, ledger.token()).ok)
  const restored = new Ledger()
  assert.ok(restored.restoreReplace('large-restore', ledger.exportBackup(), restored.token()).ok)
  assert.equal(restored.getPattern(created.patternId)!.confirmed!.titleTotal, 1_200_000_000)
  for (const qty of [-1, 1.5, '12x', '1.5', '12', 1_000_000_001, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => readRecognition({ ...raw, candidates: [{ code: 'A1', quantity: qty }] }), String(qty))
  }
  assert.throws(() => readRecognition({ ...raw, total: Number.MAX_SAFE_INTEGER + 1 }))
  assert.throws(() => readRecognition({ ...raw, total: 1_200_000_001 }))
  assert.throws(() => readRecognition({ ...raw, titleTotal: Number.MAX_SAFE_INTEGER + 1 }))
})

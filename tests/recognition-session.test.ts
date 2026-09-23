import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hasRecognitionRisk, readRecognition, recognitionProvenance, sameRecognition } from '../app/src/recognition/result.ts'

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

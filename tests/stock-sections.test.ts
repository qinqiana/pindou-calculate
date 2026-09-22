import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Ledger } from '../app/src/ledger/operations.ts'
import { stockSections } from '../app/src/platform/stock-sections.ts'

test('221 色按 9 组浏览，库存保留已录入的零余额并排除未录入色号', () => {
  const ledger = new Ledger()
  const original = ledger.listStock()
  assert.deepEqual(stockSections(original, true), [])
  const all = stockSections(original, false)
  assert.equal(all.length, 9)
  assert.equal(all.flatMap(section => section.rows).length, 221)
  assert.equal(Math.max(...all.map(section => section.rows.length)), 32)
  assert.equal(ledger.commitFirstEntry('stock-view', [
    { code: 'A1', qty: 0 }, { code: 'B1', qty: 10 },
  ], ledger.token()).ok, true)
  const owned = stockSections(ledger.listStock(), true)
  assert.deepEqual(owned.map(section => section.group), ['A', 'B'])
  assert.deepEqual(owned.flatMap(section => section.rows).map(row => [row.code, row.qty]), [['A1', 0], ['B1', 10]])
  assert.equal(ledger.search('c012')[0].code, 'C12')
  assert.equal(ledger.search('c012')[0].entered, false)
  assert.deepEqual(ledger.listStock().filter(row => !['A1', 'B1'].includes(row.code)), original.filter(row => !['A1', 'B1'].includes(row.code)))
})

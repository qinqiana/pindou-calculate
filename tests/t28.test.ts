import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('T28 148-bead local count matches per-color reference and conserves cells', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const stdout = execFileSync(
    process.platform === 'win32' ? 'python' : 'python3',
    ['experiments/t28/count_grid.py', '参考样例/豆画-Mard-148图纸样例.png'],
    { encoding: 'utf8', cwd: root },
  )
  const result = JSON.parse(stdout)
  assert.deepEqual(result.counts, {
    C12: 3,
    C16: 11,
    C17: 12,
    C19: 7,
    C2: 18,
    C29: 18,
    H2: 14,
    H3: 5,
    H7: 60,
  })
  assert.equal(result.total, 148)
  assert.equal(result.blank_cells, 316)
  assert.equal(result.unknown_cells.length, 0)
  assert.equal(result.total + result.blank_cells + result.unknown_cells.length, result.grid.rows * result.grid.columns)
  assert.equal(result.matches_reference, true)
})

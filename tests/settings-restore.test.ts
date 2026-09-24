import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { ref } from 'vue'
import { Ledger } from '../app/src/ledger/operations.ts'

test('backup preview shows setting changes and refuses a replacement after a newer write', async () => {
  const ledger = new Ledger()
  const backup = JSON.stringify(ledger.exportBackup())
  assert.ok(ledger.setLowStockPercent('percent', 20, ledger.token()).ok)

  const source = readFileSync('app/pages/settings/index.vue', 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
  const code = stripTypeScriptTypes(source.replace(/^import .*$/gm, ''))
  let request = 0
  const page = runInNewContext(code + '\n;({ chooseBak, replace, diff, message })', {
    ref,
    onShow() {},
    appLedger: () => ledger,
    newRequestId: () => `restore-page-${request++}`,
    pickTextDocument: async () => ({ ok: true, value: { text: backup } }),
  })

  await page.chooseBak()
  assert.equal(page.diff.value.lowStockPercentBefore, 20)
  assert.equal(page.diff.value.lowStockPercentAfter, 10)
  assert.ok(ledger.commitFirstEntry('newer', [{ code: 'A1', qty: 8 }], ledger.token()).ok)
  page.replace()
  assert.match(page.message.value, /账本在预览后有变化/)
  assert.equal(page.diff.value, null)
  assert.equal(ledger.getStock('A1')!.qty, 8)
  assert.equal(ledger.settings().lowStockPercent, 20)

  await page.chooseBak()
  page.replace()
  assert.equal(page.message.value, '已整体替换为备份账本')
  assert.equal(ledger.getStock('A1')!.qty, 0)
  assert.equal(ledger.settings().lowStockPercent, 10)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import { computed, nextTick, ref } from 'vue'
import { Ledger } from '../app/src/ledger/operations.ts'
import { colorByCode, GROUP_ORDER } from '../app/src/ledger/catalog.ts'
import { DEFAULT_FIRST_ENTRY } from '../app/src/ledger/numbers.ts'
import { bindPreview, previewStillValid } from '../app/src/platform/batch-preview.ts'

test('预览后修改数量使预览失效；保存提交的是预览快照而非当前表单', () => {
  const l = new Ledger()
  const items = [{ code: 'A1', qty: 1000, estimated: false }]
  const p = l.previewFirstEntry(items)
  assert.equal(p.ok, true)
  const binding = bindPreview(items, p.ok ? p.token : l.token())
  // 预览显示 1000 后，表单被改成 1500，不重新预览 → 预览失效，禁止保存
  assert.equal(previewStillValid(binding, [{ code: 'A1', qty: 1500, estimated: false }]), false)
  // 表单未被改动 → 预览有效；commit 提交的是快照里的 1000
  assert.equal(previewStillValid(binding, items), true)
  const saved = l.commitFirstEntry('req-1', binding.items, binding.token)
  assert.equal(saved.ok, true)
  assert.equal(l.getStock('A1')!.qty, 1000)
})

test('选中项与精度标记变化同样使预览失效', () => {
  const items = [{ code: 'A1', qty: 1000, estimated: false }]
  const b = bindPreview(items, { epoch: 1, seq: 0 })
  assert.equal(previewStillValid(b, [{ code: 'A1', qty: 1000, estimated: true }]), false)
  assert.equal(
    previewStillValid(b, [
      { code: 'A1', qty: 1000, estimated: false },
      { code: 'B1', qty: 5, estimated: true },
    ]),
    false,
  )
  assert.equal(previewStillValid(b, []), false)
  assert.equal(previewStillValid(b, items), true)
})

test('账本版本变化（stale）：快照 token 过期，commit 拒绝，必须重新预览', () => {
  const l = new Ledger()
  const items = [{ code: 'A1', qty: 100, estimated: true }]
  const p = l.previewFirstEntry(items)
  assert.equal(p.ok, true)
  const binding = bindPreview(items, p.ok ? p.token : l.token())
  // 另一笔操作改变了账本
  const other = l.commitFirstEntry('other', [{ code: 'B1', qty: 10 }], l.token())
  assert.equal(other.ok, true)
  assert.equal(previewStillValid(binding, items), true, '表单未变，输入快照仍一致')
  const denied = l.commitFirstEntry('req-2', binding.items, binding.token)
  if (denied.ok) assert.fail('stale token 不得保存成功')
  assert.equal(denied.code, 'stale')
})

test('批量页面：统一填数保护已录入和未选色号，改标记可预览保存，无变更有提示', async () => {
  const ledger = new Ledger()
  ledger.commitFirstEntry('existing', [{ code: 'B1', qty: 7 }], ledger.token())
  let serial = 0
  function page(mode: string) {
    let load: Function
    const source = readFileSync('app/pages/stock/batch.vue', 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
    const code = stripTypeScriptTypes(source.replace(/^import .*$/gm, ''))
    const api = runInNewContext(code + '\n;({ lines, sections, toggleAll, toggleGroupSelection, batchQty, applyBatchQty, preview, previewLines, save, onEst, error })', {
      ref, computed, nextTick, colorByCode, GROUP_ORDER, DEFAULT_FIRST_ENTRY, bindPreview, previewStillValid,
      onLoad: (fn: Function) => { load = fn }, appLedger: () => ledger,
      newRequestId: () => 'batch-page-' + serial++, uni: { showToast() {}, navigateBack() {} },
    })
    load!({ mode })
    return api
  }
  const first = page('first-entry')
  first.toggleGroupSelection(first.sections.value[0])
  first.batchQty.value = '123'
  first.applyBatchQty()
  await first.preview()
  assert.equal(first.previewLines.value.length, 26)
  first.save()
  assert.equal(ledger.getStock('A1')!.qty, 123)
  assert.equal(ledger.getStock('A26')!.qty, 123)
  assert.equal(ledger.getStock('B1')!.qty, 7)
  assert.equal(ledger.getStock('B2')!.qty, 0)

  const remaining = page('first-entry')
  remaining.toggleAll()
  remaining.batchQty.value = '55'
  remaining.applyBatchQty()
  assert.equal(remaining.lines.value.find((l: any) => l.code === 'B1').qty, 7)
  assert.equal(remaining.lines.value.find((l: any) => l.code === 'B1').selected, false)
  assert.equal(remaining.lines.value.find((l: any) => l.code === 'B2').qty, '55')

  const count = page('count')
  const a1 = count.lines.value.find((l: any) => l.code === 'A1')
  a1.selected = true
  await count.preview()
  assert.equal(count.previewLines.value.length, 0)
  assert.match(count.error.value, /没有变化/)
  count.onEst(a1)
  await count.preview()
  assert.equal(count.previewLines.value[0].delta, 0)
  assert.equal(count.previewLines.value[0].estimatedBefore, true)
  assert.equal(count.previewLines.value[0].estimatedAfter, false)
  count.save()
  assert.equal(ledger.getStock('A1')!.estimated, false)
  assert.equal(ledger.getStock('A1')!.qty, 123)

  const restock = page('restock')
  restock.lines.value.find((l: any) => l.code === 'A1').selected = true
  restock.lines.value.find((l: any) => l.code === 'B2').selected = true
  restock.batchQty.value = '10'
  restock.applyBatchQty()
  await restock.preview()
  assert.match(restock.error.value, /A1/)
  restock.save()
  assert.equal(ledger.getStock('A1')!.qty, 123)
  assert.equal(ledger.getStock('B2')!.qty, 0)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Ledger } from '../app/src/ledger/operations.ts'
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

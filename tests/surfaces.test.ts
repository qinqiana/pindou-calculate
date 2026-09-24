import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { test } from 'node:test'

const files = [
  'app/pages/stock/index.vue',
  'app/pages/stock/batch.vue',
  'app/pages/stock/history.vue',
  'app/pages/pattern/list.vue',
  'app/pages/pattern/edit.vue',
  'app/pages/pattern/detail.vue',
  'app/pages/pattern/share.vue',
  'app/pages/settings/index.vue',
]

test('user-facing pages exist and call shipped Ledger entry', () => {
  for (const file of files) {
    assert.equal(existsSync(file), true, file)
    const text = readFileSync(file, 'utf8')
    assert.match(text, /appLedger/)
  }
  const stock = readFileSync('app/pages/stock/index.vue', 'utf8')
  assert.match(stock, /库存/)
  // SPEC §5：界面使用「已记录使用」，避免把不完整用量误称为全部实际消耗
  assert.match(stock, /已记录使用/)
  const pattern = readFileSync('app/pages/pattern/detail.vue', 'utf8')
  assert.match(pattern, /已拼/)
  assert.match(pattern, /撤回/)
  const share = readFileSync('app/pages/pattern/share.vue', 'utf8')
  assert.match(share, /朋友圈/)
  assert.match(share, /小红书/)
  assert.match(share, /不会发布/)
  assert.doesNotMatch(share, /发布成功/)
  assert.match(share, /<image/)
  assert.match(share, /previewSrc|previewShareDataUrl/)
  assert.doesNotMatch(share, /\bwx\./)
  assert.match(share, /shareContentFromPattern/)
  const settings = readFileSync('app/pages/settings/index.vue', 'utf8')
  assert.match(settings, /备份/)
  assert.match(settings, /整体替换/)
  assert.match(settings, /writeTextToDownloads/)
  assert.match(settings, /pickTextDocument/)
  assert.match(settings, /thumbnailComplete/)
  const list = readFileSync('app/pages/pattern/list.vue', 'utf8')
  assert.match(list, /pendingPreview/)
  assert.match(list, /listPatternCards/)
  assert.match(list, /未提供/)
  assert.match(list, /尚未录入用量/)
  assert.match(list, /archivePattern/)
  assert.match(list, /移除图纸/)
  const history = readFileSync('app/pages/stock/history.vue', 'utf8')
  assert.match(history, /关联图纸/)
  const shareNote = readFileSync('app/pages/pattern/share.vue', 'utf8')
  assert.match(shareNote, /不会把图纸截图说成实物成品/)
  const batch = readFileSync('app/pages/stock/batch.vue', 'utf8')
  assert.match(batch, /commitFirstEntry|previewFirstEntry/)
  assert.match(batch, /bindPreview|previewStillValid/)
  assert.match(batch, /GROUP_ORDER/)
  assert.match(batch, /全选未录入/)
  assert.match(batch, /全选全部/)
  assert.match(batch, /选本组/)
  assert.match(batch, /填入已选/)
  assert.match(batch, /applyBatchQty/)
  assert.match(batch, /class="dock"/)
  assert.match(batch, /expandedGroups\[section\.group\]/)
  assert.doesNotMatch(batch, /mode !== 'first-entry' \|\| expandedGroups/)
  assert.match(batch, /expandedGroups/)
  assert.match(batch, /isLocked/)
  const edit = readFileSync('app/pages/pattern/edit.vue', 'utf8')
  assert.match(edit, /class="dock"[\s\S]*确认全部用量/)
  const detailPage = readFileSync('app/pages/pattern/detail.vue', 'utf8')
  assert.match(detailPage, /class="dock"[\s\S]*已拼/)
  assert.match(detailPage, /class="dock"[\s\S]*补货清单/)
  // 存储不可用时的错误状态与重试入口（三个主 tab 页）
  for (const file of ['app/pages/stock/index.vue', 'app/pages/pattern/list.vue', 'app/pages/settings/index.vue']) {
    const text = readFileSync(file, 'utf8')
    assert.match(text, /appStorageState/, file)
    assert.match(text, /retryAppStorage/, file)
  }
  const detail = readFileSync('app/pages/pattern/detail.vue', 'utf8')
  assert.match(detail, /\.make\(/)
  assert.match(detail, /再拼一次/)
  assert.match(detail, /尚未录入用量/)
  assert.match(detail, /archivePattern/)
  assert.match(detail, /移除图纸/)
  assert.match(detail, /resolveMakeRequestId/)
  assert.match(detail, /clearRequestAfterVoid/)
})

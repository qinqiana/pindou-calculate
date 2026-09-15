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
  assert.match(stock, /累计已用/)
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
  assert.match(settings, /writeFile/)
  assert.match(settings, /thumbnailComplete/)
  const list = readFileSync('app/pages/pattern/list.vue', 'utf8')
  assert.match(list, /pendingPreview/)
  assert.match(list, /listPatternCards/)
  assert.match(list, /未提供/)
  const history = readFileSync('app/pages/stock/history.vue', 'utf8')
  assert.match(history, /关联图纸/)
  const shareNote = readFileSync('app/pages/pattern/share.vue', 'utf8')
  assert.match(shareNote, /不会把图纸截图说成实物成品/)
  const batch = readFileSync('app/pages/stock/batch.vue', 'utf8')
  assert.match(batch, /commitFirstEntry|previewFirstEntry/)
  const detail = readFileSync('app/pages/pattern/detail.vue', 'utf8')
  assert.match(detail, /\.make\(/)
  assert.match(detail, /再拼一次/)
  assert.match(detail, /resolveMakeRequestId/)
  assert.match(detail, /clearRequestAfterVoid/)
})

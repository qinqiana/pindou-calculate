<template>
  <view class="page">
    <text class="title">{{ title }}</text>
    <text class="hint">预填 1000 只出现在首次录入表单；未选入的色号保存后仍为 0。</text>
    <view v-for="line in lines" :key="line.code" class="line">
      <checkbox :checked="line.selected" @click="line.selected = !line.selected" />
      <text class="code">{{ line.code }}</text>
      <input type="number" :value="String(line.qty)" @input="e => line.qty = e.detail.value" />
      <text @click="line.estimated = !line.estimated">{{ line.estimated ? '估算' : '精确' }}</text>
    </view>
    <button @click="preview">预览本批变更</button>
    <view v-if="previewLines.length" class="preview">
      <view v-for="p in previewLines" :key="p.code">
        {{ p.code }} {{ p.qtyBefore }} → {{ p.qtyAfter }}（{{ p.delta > 0 ? '+' : '' }}{{ p.delta }}）
      </view>
      <button type="primary" @click="save">保存整批</button>
    </view>
    <text v-if="error" class="err">{{ error }}</text>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { DEFAULT_FIRST_ENTRY } from '../../src/ledger/numbers'
import { appLedger, newRequestId } from '../../src/platform/app-ledger'

const mode = ref<'first-entry' | 'count' | 'restock'>('first-entry')
const title = ref('首次录入')
const lines = ref<{ code: string; qty: string | number; estimated: boolean; selected: boolean }[]>([])
const previewLines = ref<{ code: string; qtyBefore: number; qtyAfter: number; delta: number }[]>([])
const error = ref('')
let token = appLedger().token()

onLoad((q: { mode?: string }) => {
  mode.value = (q.mode as typeof mode.value) || 'first-entry'
  title.value = mode.value === 'count' ? '盘点更正' : mode.value === 'restock' ? '补货（填写新总数）' : '首次录入'
  const stock = appLedger().listStock()
  lines.value = stock.map((row) => ({
    code: row.code,
    qty: mode.value === 'first-entry' && !row.entered ? DEFAULT_FIRST_ENTRY : row.qty,
    estimated: row.estimated,
    selected: false,
  }))
  token = appLedger().token()
})

function selectedItems() {
  return lines.value.filter((l) => l.selected).map((l) => ({ code: l.code, qty: l.qty, estimated: l.estimated }))
}

function preview() {
  error.value = ''
  const items = selectedItems()
  const fn =
    mode.value === 'count' ? appLedger().previewCount.bind(appLedger()) : mode.value === 'restock' ? appLedger().previewRestock.bind(appLedger()) : appLedger().previewFirstEntry.bind(appLedger())
  const result = fn(items)
  if (!result.ok) {
    error.value = result.message
    previewLines.value = []
    return
  }
  previewLines.value = result.lines
  token = result.token
}

function save() {
  error.value = ''
  const items = selectedItems()
  const req = newRequestId()
  const fn =
    mode.value === 'count' ? appLedger().commitCount.bind(appLedger()) : mode.value === 'restock' ? appLedger().commitRestock.bind(appLedger()) : appLedger().commitFirstEntry.bind(appLedger())
  const result = fn(req, items, token)
  if (!result.ok) {
    error.value = result.message
    token = appLedger().token()
    return
  }
  uni.showToast({ title: '已保存', icon: 'none' })
  uni.navigateBack()
}
</script>

<style>
.page { padding: 16px; }
.hint, .err { display: block; margin: 8px 0; }
.err { color: #8a4b2f; }
.line { display: flex; gap: 8px; align-items: center; padding: 6px 0; }
.code { width: 48px; }
input { flex: 1; background: #fffcf7; padding: 6px; }
.preview { margin-top: 12px; background: #fffcf7; padding: 12px; }
</style>

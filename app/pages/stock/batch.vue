<template>
  <view class="page">
    <view class="card head">
      <text class="title">{{ title }}</text>
      <text class="hint">预填 1000 只出现在首次录入表单；未选入的色号保存后仍为 0。点选色号行加入本批，提交前会先预览整批变更。</text>
    </view>

    <view class="picked">
      <text class="picked-text">已选 <text class="picked-num">{{ selectedCount }}</text> 色</text>
    </view>

    <view
      v-for="line in lines"
      :key="line.code"
      class="line card"
      :class="{ on: line.selected }"
      @click="line.selected = !line.selected"
    >
      <view class="check" :class="{ on: line.selected }">{{ line.selected ? '✓' : '' }}</view>
      <view class="swatch" :style="{ background: hex(line.code) }" />
      <text class="code">{{ line.code }}</text>
      <input
        class="qty-input"
        type="number"
        :value="String(line.qty)"
        @click.stop
        @input="e => line.qty = e.detail.value"
      />
      <text class="est" :class="{ exact: !line.estimated }" @click.stop="line.estimated = !line.estimated">{{ line.estimated ? '估算' : '精确' }}</text>
    </view>

    <view class="footer">
      <button class="btn primary" @click="preview">预览本批变更</button>
    </view>

    <view v-if="previewLines.length" class="card preview">
      <text class="preview-title">本批变更 {{ previewLines.length }} 项</text>
      <view v-for="p in previewLines" :key="p.code" class="preview-line">
        <text class="preview-code">{{ p.code }}</text>
        <text class="preview-diff">{{ p.qtyBefore }} → {{ p.qtyAfter }}</text>
        <text class="preview-delta" :class="{ neg: p.delta < 0 }">{{ p.delta > 0 ? '+' : '' }}{{ p.delta }}</text>
      </view>
      <button class="btn primary" @click="save">保存整批</button>
    </view>

    <text v-if="error" class="err">{{ error }}</text>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { colorByCode } from '../../src/ledger/catalog'
import { DEFAULT_FIRST_ENTRY } from '../../src/ledger/numbers'
import { appLedger, newRequestId } from '../../src/platform/app-ledger'

const mode = ref<'first-entry' | 'count' | 'restock'>('first-entry')
const title = ref('首次录入')
const lines = ref<{ code: string; qty: string | number; estimated: boolean; selected: boolean }[]>([])
const previewLines = ref<{ code: string; qtyBefore: number; qtyAfter: number; delta: number }[]>([])
const error = ref('')
let token = appLedger().token()

const selectedCount = computed(() => lines.value.filter((l) => l.selected).length)

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

function hex(code: string) {
  return colorByCode(code)?.hex || '#ccc'
}

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
.page { padding: 24rpx 24rpx 80rpx; }
.card { background: #fffefb; border-radius: 24rpx; box-shadow: 0 2rpx 14rpx rgba(74, 62, 40, 0.06); }

.head { padding: 28rpx 32rpx; }
.title { display: block; font-size: 36rpx; font-weight: 700; }
.hint { display: block; margin-top: 12rpx; font-size: 24rpx; color: #857c6e; line-height: 1.6; }

.picked { display: flex; justify-content: flex-end; padding: 20rpx 8rpx 4rpx; }
.picked-text { font-size: 24rpx; color: #857c6e; }
.picked-num { color: #566c4d; font-weight: 700; font-size: 28rpx; }

.line { display: flex; align-items: center; gap: 12rpx; padding: 20rpx 20rpx; margin-top: 16rpx; border: 2rpx solid transparent; }
.line.on { border-color: #6b8260; background: #f6f9f1; }
.check { width: 40rpx; height: 40rpx; border-radius: 50%; border: 2rpx solid #cfc4ae; color: #fff; font-size: 26rpx; line-height: 40rpx; text-align: center; flex-shrink: 0; }
.check.on { background: #6b8260; border-color: #6b8260; }
.swatch { width: 44rpx; height: 44rpx; border-radius: 10rpx; border: 1rpx solid rgba(0, 0, 0, 0.08); flex-shrink: 0; }
.code { width: 68rpx; font-size: 28rpx; font-weight: 700; flex-shrink: 0; }
.qty-input { flex: 1; min-width: 0; height: 76rpx; background: #fff; border: 1rpx solid #e0d7c4; border-radius: 14rpx; padding: 0 16rpx; font-size: 30rpx; font-variant-numeric: tabular-nums; }
.est { font-size: 22rpx; color: #857c6e; border: 1rpx solid #d8cfbe; border-radius: 999rpx; padding: 8rpx 16rpx; flex-shrink: 0; }
.est.exact { color: #566c4d; border-color: #9db28c; background: #edf1e6; }

.footer { margin-top: 28rpx; }
.btn { margin: 0; font-size: 30rpx; border-radius: 999rpx; height: 96rpx; line-height: 96rpx; }
.btn::after { border: none; }
.primary { background: #6b8260; color: #fff; font-weight: 600; }

.preview { margin-top: 28rpx; padding: 28rpx 32rpx; }
.preview-title { display: block; font-size: 28rpx; font-weight: 700; margin-bottom: 12rpx; }
.preview-line { display: flex; align-items: center; gap: 20rpx; padding: 12rpx 0; border-bottom: 1rpx solid #f0e9da; }
.preview-code { width: 80rpx; font-weight: 700; }
.preview-diff { flex: 1; color: #6e6353; font-variant-numeric: tabular-nums; }
.preview-delta { color: #566c4d; font-weight: 700; font-variant-numeric: tabular-nums; }
.preview-delta.neg { color: #b65b38; }
.preview .btn { margin-top: 24rpx; }

.err { display: block; margin-top: 24rpx; color: #b65b38; font-size: 26rpx; }
</style>

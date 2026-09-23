<template>
  <view class="page">
    <scroll-view class="page-content" scroll-y :scroll-into-view="scrollTarget" scroll-with-animation>
    <view class="content">
    <view class="card head">
      <text class="title">{{ title }}</text>
      <text class="hint">首次录入的空格预填 1000。先勾选色号，再填一个数套到已选；没选中的不会入账。预览和保存在屏幕底部。</text>
    </view>

    <view class="selection-tools card">
      <button class="btn outline" :disabled="availableCount === 0" @click="toggleAll">
        {{ allAvailableSelected ? '取消全选' : mode === 'first-entry' ? '全选未录入' : '全选' }}
      </button>
      <text class="available-note">可选 {{ availableCount }} 色</text>
      <input class="qty-input batch-input" type="number" :value="batchQty" placeholder="统一颗数" @input="onBatchQty" />
      <button class="btn outline" :disabled="selectedCount === 0 || batchQty.trim() === ''" @click="applyBatchQty">填入已选</button>
    </view>

    <view v-for="section in sections" :key="section.group" class="group card">
      <view v-if="section.group" class="group-head" @click="toggleGroup(section.group)">
        <view class="group-title">
          <text class="group-name">{{ section.group }} 组</text>
          <text class="group-count">{{ section.selectedCount }}/{{ section.availableCount }} 已选</text>
        </view>
        <button class="group-action" :disabled="section.availableCount === 0" @click.stop="toggleGroupSelection(section)">
          {{ section.allSelected ? '取消本组' : '选本组' }}
        </button>
        <text class="group-chevron">{{ expandedGroups[section.group] ? '⌃' : '⌄' }}</text>
      </view>

      <view v-if="expandedGroups[section.group]" class="group-lines">
        <view
          v-for="line in section.lines"
          :key="line.code"
          class="line card"
          :class="{ on: line.selected, locked: isLocked(line) }"
          @click="toggleSelect(line)"
        >
          <view class="check" :class="{ on: line.selected, locked: isLocked(line) }">{{ isLocked(line) ? '—' : line.selected ? '✓' : '' }}</view>
          <view class="swatch" :style="{ background: hex(line.code) }" />
          <text class="code">{{ line.code }}</text>
          <input
            class="qty-input"
            type="number"
            :value="String(line.qty)"
            :disabled="isLocked(line)"
            @click.stop
            @input="e => onQty(line, e)"
          />
          <text class="est" :class="{ exact: !line.estimated, locked: isLocked(line) }" @click.stop="onEst(line)">{{ isLocked(line) ? '已录入' : line.estimated ? '估算' : '精确' }}</text>
        </view>
      </view>
    </view>

    <view v-if="previewLines.length" id="batch-preview" class="card preview">
      <text class="preview-title">本批变更 {{ previewLines.length }} 项</text>
      <view v-for="p in previewLines" :key="p.code" class="preview-line">
        <text class="preview-code">{{ p.code }}</text>
        <view class="preview-diff">
          <text>{{ p.qtyBefore }} → {{ p.qtyAfter }}</text>
          <text class="preview-precision">{{ p.estimatedBefore ? '估算' : '精确' }} → {{ p.estimatedAfter ? '估算' : '精确' }}</text>
        </view>
        <text class="preview-delta" :class="{ neg: p.delta < 0 }">{{ p.delta > 0 ? '+' : '' }}{{ p.delta }}</text>
      </view>
    </view>

    </view>
    </scroll-view>
    <view class="dock">
      <text v-if="error" class="err">{{ error }}</text>
      <view class="dock-row">
        <text class="picked-text">已选 <text class="picked-num">{{ selectedCount }}</text> 色</text>
        <button class="btn outline" @click="preview">预览</button>
        <button class="btn primary" :disabled="previewLines.length === 0" @click="save">保存整批</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import { computed, nextTick, ref } from 'vue'
import { colorByCode, GROUP_ORDER } from '../../src/ledger/catalog'
import { DEFAULT_FIRST_ENTRY } from '../../src/ledger/numbers'
import type { Ledger } from '../../src/ledger/operations'
import type { BatchPreviewLine } from '../../src/ledger/types'
import { appLedger, newRequestId } from '../../src/platform/app-ledger'
import { bindPreview, previewStillValid, type BatchInputItem, type PreviewBinding } from '../../src/platform/batch-preview'

type Token = ReturnType<Ledger['token']>

const mode = ref<'first-entry' | 'count' | 'restock'>('first-entry')
const title = ref('首次录入')
type BatchLine = { code: string; qty: string | number; estimated: boolean; selected: boolean; entered: boolean }
type GroupSection = { group: string; lines: BatchLine[]; availableCount: number; selectedCount: number; allSelected: boolean }

const lines = ref<BatchLine[]>([])
const previewLines = ref<BatchPreviewLine[]>([])
const error = ref('')
const batchQty = ref('')
const scrollTarget = ref('')
const expandedGroups = ref<Record<string, boolean>>(defaultExpandedGroups())
let binding: PreviewBinding<Token> | null = null

const selectedCount = computed(() => lines.value.filter((l) => l.selected).length)
const availableCount = computed(() => lines.value.filter((l) => !isLocked(l)).length)
const allAvailableSelected = computed(() => availableCount.value > 0 && lines.value.filter((l) => !isLocked(l)).every((l) => l.selected))
const sections = computed<GroupSection[]>(() => {
  return GROUP_ORDER.map((group) => {
    const groupLines = lines.value.filter((line) => line.code.startsWith(group))
    const available = groupLines.filter((line) => !isLocked(line))
    return {
      group,
      lines: groupLines,
      availableCount: available.length,
      selectedCount: available.filter((line) => line.selected).length,
      allSelected: available.length > 0 && available.every((line) => line.selected),
    }
  })
})

function defaultExpandedGroups(): Record<string, boolean> {
  return Object.fromEntries(GROUP_ORDER.map((group, index) => [group, index === 0]))
}

onLoad((q: { mode?: string }) => {
  mode.value = (q.mode as typeof mode.value) || 'first-entry'
  title.value = mode.value === 'count' ? '盘点更正' : mode.value === 'restock' ? '补货（填写新总数）' : '首次录入'
  expandedGroups.value = defaultExpandedGroups()
  const stock = appLedger().listStock()
  lines.value = stock.map((row) => ({
    code: row.code,
    qty: mode.value === 'first-entry' && !row.entered ? DEFAULT_FIRST_ENTRY : row.qty,
    estimated: row.estimated,
    selected: false,
    entered: row.entered,
  }))
})

function hex(code: string) {
  return colorByCode(code)?.hex || '#ccc'
}

/** 数量、选中项或精度标记变化都会使旧预览失效，必须重新预览。 */
function invalidate() {
  previewLines.value = []
  binding = null
}

function isLocked(line: BatchLine) {
  return mode.value === 'first-entry' && line.entered
}

function toggleSelect(line: BatchLine) {
  if (isLocked(line)) return
  line.selected = !line.selected
  invalidate()
}

function toggleGroup(group: string) {
  expandedGroups.value[group] = !expandedGroups.value[group]
}

function toggleAll() {
  if (availableCount.value === 0) return
  const selected = !allAvailableSelected.value
  for (const line of lines.value) if (!isLocked(line)) line.selected = selected
  invalidate()
}

function toggleGroupSelection(section: GroupSection) {
  if (section.availableCount === 0) return
  const selected = !section.allSelected
  for (const line of section.lines) if (!isLocked(line)) line.selected = selected
  invalidate()
}

function onBatchQty(e: { detail: { value: string } }) {
  batchQty.value = e.detail.value
}

function applyBatchQty() {
  const qty = batchQty.value.trim()
  if (!qty || selectedCount.value === 0) return
  for (const line of lines.value) if (line.selected && !isLocked(line)) line.qty = qty
  invalidate()
}

function onQty(line: BatchLine, e: { detail: { value: string } }) {
  if (isLocked(line)) return
  line.qty = e.detail.value
  invalidate()
}

function onEst(line: BatchLine) {
  if (isLocked(line)) return
  line.estimated = !line.estimated
  invalidate()
}

function selectedItems(): BatchInputItem[] {
  return lines.value.filter((l) => l.selected && !isLocked(l)).map((l) => ({ code: l.code, qty: l.qty, estimated: l.estimated }))
}

function previewFn() {
  const l = appLedger()
  return mode.value === 'count' ? l.previewCount.bind(l) : mode.value === 'restock' ? l.previewRestock.bind(l) : l.previewFirstEntry.bind(l)
}

function commitFn() {
  const l = appLedger()
  return mode.value === 'count' ? l.commitCount.bind(l) : mode.value === 'restock' ? l.commitRestock.bind(l) : l.commitFirstEntry.bind(l)
}

async function preview() {
  error.value = ''
  scrollTarget.value = ''
  const result = previewFn()(selectedItems())
  if (!result.ok) {
    error.value = result.message
    previewLines.value = []
    binding = null
    return
  }
  binding = bindPreview(selectedItems(), result.token)
  previewLines.value = result.lines
  if (!result.lines.length) { error.value = '所选色号的数量和估算标记没有变化，无需保存。'; return }
  await nextTick()
  scrollTarget.value = 'batch-preview'
}

function save() {
  error.value = ''
  if (!binding || previewLines.value.length === 0) {
    error.value = '请先预览本批变更'
    return
  }
  if (!previewStillValid(binding, selectedItems())) {
    invalidate()
    error.value = '表单在预览后被修改，请重新预览'
    return
  }
  const result = commitFn()(newRequestId(), binding.items, binding.token)
  if (!result.ok) {
    // 账本版本变化必须重新预览；不允许刷新 token 绕过确认
    if (result.code === 'stale') invalidate()
    error.value = result.message
    return
  }
  uni.showToast({ title: '已保存', icon: 'none' })
  uni.navigateBack()
}
</script>

<style>
.page { height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
.page-content { flex: 1; height: 0; min-height: 0; }
.content { padding: 24rpx; }
.card { background: #fffefb; border-radius: 24rpx; box-shadow: 0 2rpx 14rpx rgba(74, 62, 40, 0.06); }

.head { padding: 28rpx 32rpx; }
.title { display: block; font-size: 36rpx; font-weight: 700; }
.hint { display: block; margin-top: 12rpx; font-size: 24rpx; color: #857c6e; line-height: 1.6; }

.selection-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 16rpx; margin-top: 16rpx; padding: 16rpx 20rpx; }
.selection-tools .btn { height: 72rpx; line-height: 72rpx; padding: 0 24rpx; font-size: 26rpx; }
.batch-input { width: 180rpx; flex: none; }
.outline { background: #edf1e6; color: #566c4d; border: 2rpx solid #cfd9c4; }
.available-note { color: #857c6e; font-size: 24rpx; }

.picked-text { font-size: 24rpx; color: #857c6e; flex-shrink: 0; }
.picked-num { color: #566c4d; font-weight: 700; font-size: 28rpx; }

.group { margin-top: 16rpx; padding: 0 20rpx 20rpx; overflow: hidden; }
.group-head { display: flex; align-items: center; gap: 12rpx; min-height: 92rpx; }
.group-title { display: flex; align-items: baseline; gap: 12rpx; flex: 1; min-width: 0; }
.group-name { font-size: 30rpx; font-weight: 700; }
.group-count { color: #857c6e; font-size: 22rpx; }
.group-action { margin: 0; padding: 0 16rpx; height: 60rpx; line-height: 60rpx; color: #566c4d; background: #edf1e6; border: 1rpx solid #cfd9c4; border-radius: 999rpx; font-size: 22rpx; }
.group-action::after { border: none; }
.group-action[disabled] { color: #b7ac9a; background: #f5f1e8; border-color: #e0d7c4; }
.group-chevron { width: 28rpx; color: #857c6e; font-size: 30rpx; text-align: center; }
.group-lines .line { margin-top: 12rpx; box-shadow: none; }

.line { display: flex; align-items: center; gap: 12rpx; padding: 20rpx 20rpx; margin-top: 16rpx; border: 2rpx solid transparent; }
.line.on { border-color: #6b8260; background: #f6f9f1; }
.line.locked { opacity: 0.62; }
.check { width: 40rpx; height: 40rpx; border-radius: 50%; border: 2rpx solid #cfc4ae; color: #fff; font-size: 26rpx; line-height: 40rpx; text-align: center; flex-shrink: 0; }
.check.on { background: #6b8260; border-color: #6b8260; }
.check.locked { color: #857c6e; border-color: #d8cfbe; }
.swatch { width: 44rpx; height: 44rpx; border-radius: 10rpx; border: 1rpx solid rgba(0, 0, 0, 0.08); flex-shrink: 0; }
.code { width: 68rpx; font-size: 28rpx; font-weight: 700; flex-shrink: 0; }
.qty-input { flex: 1; min-width: 0; height: 76rpx; background: #fff; border: 1rpx solid #e0d7c4; border-radius: 14rpx; padding: 0 16rpx; font-size: 30rpx; font-variant-numeric: tabular-nums; }
.qty-input:disabled { color: #857c6e; background: #f5f1e8; }
.est { font-size: 22rpx; color: #857c6e; border: 1rpx solid #d8cfbe; border-radius: 999rpx; padding: 8rpx 16rpx; flex-shrink: 0; }
.est.exact { color: #566c4d; border-color: #9db28c; background: #edf1e6; }
.est.locked { color: #857c6e; background: #f5f1e8; }

.dock { flex-shrink: 0; z-index: 5; padding: 16rpx 24rpx calc(16rpx + env(safe-area-inset-bottom)); background: #fffefb; box-shadow: 0 -4rpx 20rpx rgba(74, 62, 40, 0.08); }
.dock-row { display: flex; align-items: center; gap: 16rpx; }
.dock .btn { flex: 1; height: 80rpx; line-height: 80rpx; font-size: 28rpx; }
.dock .primary[disabled] { background: #c5d0bc; color: #fff; }
.btn { margin: 0; font-size: 30rpx; border-radius: 999rpx; height: 96rpx; line-height: 96rpx; }
.btn::after { border: none; }
.primary { background: #6b8260; color: #fff; font-weight: 600; }

.preview { margin-top: 28rpx; padding: 28rpx 32rpx; }
.preview-title { display: block; font-size: 28rpx; font-weight: 700; margin-bottom: 12rpx; }
.preview-line { display: flex; align-items: center; gap: 20rpx; padding: 12rpx 0; border-bottom: 1rpx solid #f0e9da; }
.preview-code { width: 80rpx; font-weight: 700; }
.preview-diff { flex: 1; color: #6e6353; font-variant-numeric: tabular-nums; }
.preview-precision { display: block; color: #857c6e; font-size: 24rpx; margin-top: 4rpx; }
.preview-delta { color: #566c4d; font-weight: 700; font-variant-numeric: tabular-nums; }
.preview-delta.neg { color: #b65b38; }
.err { display: block; margin-bottom: 12rpx; color: #b65b38; font-size: 26rpx; }
</style>

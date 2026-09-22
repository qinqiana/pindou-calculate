<template>
  <view class="stock-page">
    <view class="header">
      <text class="app-name">豆计</text>
      <view v-if="!storageError" class="toolbar">
        <button class="toolbar-button add-button" aria-label="首次录入库存" @click="goBatch('first-entry')">＋</button>
        <button class="toolbar-button more-button" aria-label="盘点、补货和变动记录" @click="showActions">•••</button>
      </view>
    </view>
    <view v-if="storageError" class="message-panel">
      <text class="error-text">{{ storageError }}</text>
      <button class="primary-button" @click="retryStorage">重试读取</button>
    </view>
    <template v-else>
      <text class="summary">已记录使用 {{ ach.totalUsed }} 颗 · 完成 {{ ach.completedMakes }} 件作品</text>
      <view class="search">
        <view class="search-icon" />
        <input class="search-input" :value="query" placeholder="搜索全部色号，如 C12" placeholder-class="placeholder" @input="onSearch" />
        <button v-if="query" class="clear-search" aria-label="清除搜索" @click="clearSearch">×</button>
      </view>

      <view v-if="!searching" class="scope-control">
        <button class="scope-button" :class="{ selected: scope === 'owned' }" @click="setScope('owned')">我的库存 <text class="scope-count">{{ enteredCount }}</text></button>
        <button class="scope-button" :class="{ selected: scope === 'all' }" @click="setScope('all')">全部色号 <text class="scope-count">{{ allRows.length }}</text></button>
      </view>
      <text class="section-caption">{{ searching ? '全部色号中的 ' + searchRows.length + ' 个结果' : scope === 'owned' ? '按色系查看已录入库存' : '按色系浏览 · 点开查看色号' }}</text>

      <view v-if="!searching && scope === 'owned' && !enteredCount" class="empty-inventory">
        <view class="empty-mark"><view /><view /><view /><view /></view>
        <text class="empty-title">先记下手头的豆</text>
        <text class="empty-note">录入后按色系查看库存，
用完的色号也会保留。</text>
        <button class="primary-button" @click="goBatch('first-entry')">首次录入</button>
        <button class="text-button" @click="setScope('all')">浏览全部色号</button>
      </view>
      <view v-else-if="searching && !searchRows.length" class="message-panel search-empty">
        <text class="empty-title">没有找到“{{ query }}”</text>
        <text class="empty-note">试试色号或字母，例如 C12、C。</text>
        <button class="text-button" @click="clearSearch">清除搜索</button>
      </view>
      <view v-else class="grouped-list">
        <view v-for="section in displaySections" :key="section.group" class="stock-section">
          <button v-if="!searching" class="family-row" :class="{ expanded: expandedGroup === section.group }" :aria-expanded="expandedGroup === section.group" @click="toggleGroup(section.group)">
            <view class="family-swatches">
              <view v-for="row in section.rows.slice(0, 3)" :key="row.code" class="family-swatch" :style="{ background: hex(row.code) }" />
            </view>
            <view class="family-main">
              <text class="family-title">{{ section.group }} · {{ groupNames[section.group] }}</text>
              <text class="family-note">{{ scope === 'owned' ? '已录入 ' + section.rows.length + ' / ' + section.total + ' 色' : section.group + '1–' + section.group + section.total }}</text>
            </view>
            <text class="family-count">{{ section.rows.length }}</text>
            <view class="chevron" :class="{ open: expandedGroup === section.group }" />
          </button>
          <view v-if="searching || expandedGroup === section.group" class="section-rows">
            <view v-for="row in section.rows" :key="row.code" class="stock-row">
              <view class="swatch" :style="{ background: hex(row.code) }" />
              <view class="row-main">
                <view class="row-title">
                  <text class="code">{{ row.code }}</text>
                  <text v-if="warn(row.code)" class="low-stock">低库存</text>
                </view>
                <text class="row-note">{{ row.entered ? (row.estimated ? '估算' : '精确') + ' · 已记录使用 ' + used(row.code) + ' 颗' : '未录入' }}</text>
              </view>
              <view class="balance"><text class="qty">{{ row.qty }}</text><text class="qty-unit">颗</text></view>
            </view>
          </view>
        </view>
      </view>
      <text class="list-footnote">色块为社区参考色，非官方色值。
未录入的色号不参与低库存提醒。</text>
    </template>
  </view>
</template>

<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { colorByCode } from '../../src/ledger/catalog'
import type { StockRow } from '../../src/ledger/types'
import { appLedger, appStorageState, bootAppLedger, retryAppStorage } from '../../src/platform/app-ledger'
import { stockSections } from '../../src/platform/stock-sections'

const groupNames: Record<string, string> = {
  A: '黄橙', B: '绿色', C: '蓝青', D: '蓝紫', E: '粉玫',
  F: '红色', G: '棕肤', H: '黑白', M: '大地',
}
const query = ref('')
const scope = ref<'owned' | 'all'>('owned')
const expandedGroup = ref('')
const storageError = ref('')
const allRows = ref<StockRow[]>([])
const searchRows = ref<StockRow[]>([])
const ach = ref({ totalUsed: 0, completedMakes: 0, perColor: {} as Record<string, number> })
const searching = computed(() => query.value.trim().length > 0)
const enteredCount = computed(() => allRows.value.filter(row => row.entered).length)
const displaySections = computed(() => searching.value
  ? [{ group: 'search', rows: searchRows.value, total: searchRows.value.length }]
  : stockSections(allRows.value, scope.value === 'owned'))

function reload() {
  allRows.value = appLedger().listStock()
  searchRows.value = appLedger().search(query.value)
  ach.value = appLedger().achievements()
}
async function retryStorage() {
  await retryAppStorage()
  storageError.value = appStorageState().message ?? ''
  if (!storageError.value) reload()
}
function onSearch(e: { detail: { value: string } }) {
  query.value = e.detail.value
  searchRows.value = appLedger().search(query.value)
}
function clearSearch() { query.value = '' }
function setScope(value: 'owned' | 'all') {
  scope.value = value
  expandedGroup.value = ''
}
function toggleGroup(group: string) {
  expandedGroup.value = expandedGroup.value === group ? '' : group
}
function hex(code: string) { return colorByCode(code)?.hex || '#ccc' }
function used(code: string) { return ach.value.perColor[code] || 0 }
function warn(code: string) { return appLedger().lowStock(code) }
function goBatch(mode: string) { uni.navigateTo({ url: '/pages/stock/batch?mode=' + mode }) }
function goHistory() { uni.navigateTo({ url: '/pages/stock/history' }) }
function showActions() {
  uni.showActionSheet({
    itemList: ['盘点库存', '补货入库', '变动记录'],
    success: ({ tapIndex }: { tapIndex: number }) => {
      if (tapIndex === 0) goBatch('count')
      else if (tapIndex === 1) goBatch('restock')
      else if (tapIndex === 2) goHistory()
    },
  })
}
onShow(async () => {
  await bootAppLedger()
  storageError.value = appStorageState().message ?? ''
  if (!storageError.value) reload()
})
</script>

<style scoped>
.stock-page { padding: calc(var(--status-bar-height) + 16rpx) 32rpx 40rpx; background: #f2f2f7; min-height: 100vh; box-sizing: border-box; color: #1c1c1e; }
.header, .toolbar, .search, .scope-control, .family-row, .stock-row, .row-title, .balance { display: flex; align-items: center; }
.header { justify-content: space-between; gap: 20rpx; }
.app-name { font-size: 60rpx; font-weight: 700; letter-spacing: -1rpx; }
.toolbar { gap: 8rpx; }
button { margin: 0; font-weight: 500; }
button::after { border: none; }
.toolbar-button { min-width: 88rpx; height: 88rpx; line-height: 88rpx; padding: 0; background: transparent; color: #0066cc; border-radius: 50%; }
.add-button { font-size: 52rpx; font-weight: 400; }
.more-button { font-size: 28rpx; letter-spacing: 3rpx; }
.summary { display: block; color: #68686d; font-size: 24rpx; margin-top: 8rpx; }
.search { gap: 18rpx; margin-top: 32rpx; padding: 0 22rpx; min-height: 88rpx; background: #e5e5ea; border-radius: 18rpx; }
.search-icon { width: 25rpx; height: 25rpx; border: 3rpx solid #74747a; border-radius: 50%; position: relative; box-sizing: border-box; flex-shrink: 0; }
.search-icon::after { content: ''; position: absolute; width: 11rpx; height: 3rpx; background: #74747a; right: -8rpx; bottom: -4rpx; transform: rotate(45deg); }
.search-input { flex: 1; min-width: 0; font-size: 29rpx; height: 88rpx; }
.placeholder { color: #737378; }
.clear-search { padding: 0; width: 72rpx; height: 88rpx; line-height: 88rpx; background: transparent; color: #707075; font-size: 40rpx; }
.scope-control { margin-top: 28rpx; padding: 4rpx; gap: 4rpx; background: #e5e5ea; border-radius: 16rpx; }
.scope-button { flex: 1; min-width: 0; min-height: 88rpx; padding: 14rpx 8rpx; line-height: 56rpx; border-radius: 12rpx; background: transparent; color: #424247; font-size: 26rpx; }
.scope-button.selected { background: #fff; color: #1c1c1e; box-shadow: 0 2rpx 7rpx rgba(0,0,0,.08); font-weight: 600; }
.scope-count { margin-left: 8rpx; color: #68686d; font-size: 23rpx; font-variant-numeric: tabular-nums; }
.section-caption { display: block; color: #68686d; font-size: 23rpx; padding: 28rpx 24rpx 14rpx; }
.grouped-list, .message-panel, .empty-inventory { background: #fff; border-radius: 22rpx; overflow: hidden; }
.family-row { width: 100%; padding: 22rpx 24rpx; min-height: 128rpx; border-radius: 0; background: #fff; text-align: left; line-height: 1.45; gap: 20rpx; }
.stock-section + .stock-section { border-top: 1rpx solid #e5e5ea; }
.family-row.expanded { background: #f9f9fb; }
.family-swatches { display: flex; align-items: center; width: 90rpx; flex-shrink: 0; padding-left: 2rpx; }
.family-swatch { width: 40rpx; height: 40rpx; border: 2rpx solid #fff; border-radius: 50%; margin-left: -12rpx; box-shadow: 0 0 0 1rpx rgba(0,0,0,.06); flex-shrink: 0; }
.family-swatch:first-child { margin-left: 0; }
.family-main, .row-main { flex: 1; min-width: 0; }
.family-title { display: block; font-size: 31rpx; font-weight: 500; }
.family-note { display: block; color: #68686d; font-size: 23rpx; margin-top: 3rpx; font-weight: 400; }
.family-count { color: #68686d; font-size: 28rpx; font-weight: 400; font-variant-numeric: tabular-nums; }
.chevron { width: 12rpx; height: 12rpx; border-right: 3rpx solid #a4a4a9; border-bottom: 3rpx solid #a4a4a9; transform: rotate(-45deg); margin: 0 4rpx 0 2rpx; transition: transform .15s; flex-shrink: 0; }
.chevron.open { transform: rotate(45deg); }
.section-rows { padding: 0 24rpx; }
.stock-row { gap: 20rpx; min-height: 120rpx; padding: 18rpx 0; box-sizing: border-box; border-top: 1rpx solid #e5e5ea; }
.stock-row:first-child { border-top: none; }
.swatch { width: 56rpx; height: 56rpx; border-radius: 12rpx; border: 1rpx solid rgba(0,0,0,.08); flex-shrink: 0; }
.row-title { flex-wrap: wrap; gap: 12rpx; }
.code { font-size: 30rpx; font-weight: 600; }
.low-stock { color: #a43d0e; background: #fff0e5; font-size: 21rpx; padding: 2rpx 10rpx; border-radius: 6rpx; }
.row-note { display: block; color: #68686d; font-size: 23rpx; line-height: 1.55; margin-top: 3rpx; }
.balance { flex-wrap: wrap; justify-content: flex-end; align-items: baseline; gap: 8rpx; max-width: 48%; text-align: right; }
.qty { font-size: 35rpx; font-weight: 500; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.qty-unit { color: #68686d; font-size: 22rpx; }
.list-footnote { display: block; padding: 20rpx 24rpx 0; color: #737378; font-size: 22rpx; line-height: 1.65; white-space: pre-line; }
.empty-inventory { display: flex; flex-direction: column; align-items: center; padding: 48rpx 32rpx 24rpx; text-align: center; }
.empty-mark { display: grid; grid-template-columns: repeat(2, 30rpx); gap: 6rpx; margin-bottom: 24rpx; }
.empty-mark view { width: 30rpx; height: 30rpx; border-radius: 7rpx; background: #d7e7fa; }
.empty-mark view:nth-child(2), .empty-mark view:nth-child(3) { background: #bfd7f3; }
.empty-title { display: block; font-size: 34rpx; font-weight: 600; }
.empty-note { display: block; margin-top: 14rpx; color: #68686d; font-size: 26rpx; line-height: 1.6; white-space: pre-line; }
.primary-button { min-width: 260rpx; min-height: 88rpx; margin-top: 32rpx; padding: 0 32rpx; line-height: 88rpx; color: #fff; background: #0066cc; border-radius: 16rpx; font-size: 28rpx; }
.text-button { min-height: 88rpx; margin-top: 8rpx; padding: 0 24rpx; line-height: 88rpx; color: #0066cc; background: transparent; font-size: 27rpx; }
.message-panel { padding: 40rpx 28rpx; margin-top: 28rpx; }
.search-empty { text-align: center; }
.error-text { color: #b42318; font-size: 27rpx; line-height: 1.6; }
</style>

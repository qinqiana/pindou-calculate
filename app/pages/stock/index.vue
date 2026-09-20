<template>
  <view class="page">
    <view v-if="storageError" class="card storage-error">
      <text class="storage-error-text">{{ storageError }}</text>
      <button class="btn primary" @click="retryStorage">重试</button>
    </view>
    <template v-else>
    <view class="hero card">
      <view class="hero-head">
        <text class="hero-title">我的豆仓</text>
        <text class="hero-note">社区版参考色 · 不是官方精确色值</text>
      </view>
      <view class="stats">
        <view class="stat">
          <text class="stat-num">{{ ach.totalUsed }}</text>
          <text class="stat-label">已记录使用（颗）</text>
        </view>
        <view class="stat-divider" />
        <view class="stat">
          <text class="stat-num">{{ ach.completedMakes }}</text>
          <text class="stat-label">完成作品（件）</text>
        </view>
      </view>
    </view>

    <view class="search card">
      <input class="search-input" :value="query" placeholder="搜索色号，例如 C12" placeholder-class="ph" @input="onSearch" />
    </view>

    <scroll-view scroll-x class="groups" :show-scrollbar="false">
      <text class="chip" :class="{ on: !group }" @click="setGroup('')">全部</text>
      <text v-for="g in groups" :key="g" class="chip" :class="{ on: group === g }" @click="setGroup(g)">{{ g }} {{ groupNames[g] }}</text>
    </scroll-view>

    <view class="actions">
      <button class="btn ghost" @click="goBatch('first-entry')">首次录入</button>
      <button class="btn ghost" @click="goBatch('count')">盘点</button>
      <button class="btn ghost" @click="goBatch('restock')">补货</button>
      <text class="history-link" @click="goHistory">变动记录 ›</text>
    </view>

    <view v-for="row in rows" :key="row.code" class="row-card card">
      <view class="swatch" :style="{ background: hex(row.code) }" />
      <view class="row-main">
        <view class="row-top">
          <text class="code">{{ row.code }}</text>
          <text v-if="row.entered && row.estimated" class="tag tag-est">估算</text>
          <text v-if="warn(row.code)" class="tag tag-low">低库存</text>
        </view>
        <view class="row-bottom">
          <text class="qty">{{ row.qty }}<text class="qty-unit"> 颗</text></text>
          <text class="sub">{{ row.entered ? '已记录使用 ' + used(row.code) + ' 颗 · ' + (row.estimated ? '估算' : '精确') : '未录入 · 无预警基准' }}</text>
        </view>
      </view>
    </view>

    <view v-if="rows.length === 0" class="empty card">
      <text class="empty-title">没有匹配的色号</text>
      <text class="empty-sub">换个关键词试试，不会因此新建色号。</text>
    </view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { GROUP_ORDER, colorByCode } from '../../src/ledger/catalog'
import { appLedger, appStorageState, bootAppLedger, retryAppStorage } from '../../src/platform/app-ledger'

const groups = GROUP_ORDER
const groupNames: Record<string, string> = {
  A: '黄橙',
  B: '绿',
  C: '蓝青',
  D: '蓝紫',
  E: '粉玫',
  F: '红',
  G: '棕肤',
  H: '黑白',
  M: '大地',
}
const query = ref('')
const group = ref('')
const storageError = ref('')
const rows = ref<ReturnType<ReturnType<typeof appLedger>['listStock']>>([])
const ach = ref({ totalUsed: 0, completedMakes: 0, perColor: {} as Record<string, number> })

function reload() {
  rows.value = appLedger().listStock(query.value, group.value || undefined)
  ach.value = appLedger().achievements()
}
async function retryStorage() {
  await retryAppStorage()
  storageError.value = appStorageState().message ?? ''
  if (!storageError.value) reload()
}
function onSearch(e: { detail: { value: string } }) {
  query.value = e.detail.value
  reload()
}
function setGroup(g: string) {
  group.value = g
  reload()
}
function hex(code: string) {
  return colorByCode(code)?.hex || '#ccc'
}
function used(code: string) {
  return ach.value.perColor[code] || 0
}
function warn(code: string) {
  return appLedger().lowStock(code)
}
function goBatch(mode: string) {
  uni.navigateTo({ url: '/pages/stock/batch?mode=' + mode })
}
function goHistory() {
  uni.navigateTo({ url: '/pages/stock/history' })
}
onShow(async () => {
  await bootAppLedger()
  storageError.value = appStorageState().message ?? ''
  if (!storageError.value) reload()
})
</script>

<style>
.page { padding: 24rpx 24rpx 60rpx; }
.card { background: #fffefb; border-radius: 24rpx; box-shadow: 0 2rpx 14rpx rgba(74, 62, 40, 0.06); }

.hero { padding: 32rpx; }
.hero-head { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8rpx; }
.hero-title { font-size: 40rpx; font-weight: 700; letter-spacing: 2rpx; }
.hero-note { font-size: 22rpx; color: #857c6e; }
.stats { display: flex; align-items: center; margin-top: 28rpx; background: #edf1e6; border-radius: 20rpx; padding: 24rpx 0; }
.stat { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4rpx; }
.stat-num { font-size: 44rpx; font-weight: 700; color: #566c4d; font-variant-numeric: tabular-nums; }
.stat-label { font-size: 22rpx; color: #6b7a5f; }
.stat-divider { width: 2rpx; height: 56rpx; background: rgba(86, 108, 77, 0.25); }

.search { display: flex; align-items: center; margin-top: 24rpx; padding: 0 32rpx; height: 88rpx; }
.search-input { flex: 1; font-size: 28rpx; }
.ph { color: #b7ac9a; }

.groups { white-space: nowrap; margin: 24rpx 0 4rpx; }
.chip { display: inline-block; padding: 14rpx 28rpx; margin-right: 16rpx; background: #f0e9da; color: #6e6353; border-radius: 999rpx; font-size: 26rpx; }
.chip.on { background: #6b8260; color: #fff; font-weight: 600; }

.actions { display: flex; align-items: center; gap: 16rpx; margin: 20rpx 0 8rpx; }
.btn { margin: 0; font-size: 28rpx; border-radius: 999rpx; height: 80rpx; line-height: 80rpx; padding: 0 32rpx; }
.btn::after { border: none; }
.ghost { background: #fffefb; color: #566c4d; border: 2rpx solid #cfd9c4; }
.history-link { margin-left: auto; color: #857c6e; font-size: 26rpx; padding: 16rpx 8rpx; }

.row-card { display: flex; align-items: center; gap: 24rpx; padding: 24rpx; margin-top: 20rpx; }
.swatch { width: 76rpx; height: 76rpx; border-radius: 18rpx; border: 1rpx solid rgba(0, 0, 0, 0.08); flex-shrink: 0; }
.row-main { flex: 1; display: flex; flex-direction: column; gap: 8rpx; }
.row-top { display: flex; align-items: center; gap: 12rpx; }
.code { font-size: 32rpx; font-weight: 700; letter-spacing: 1rpx; }
.tag { font-size: 20rpx; padding: 4rpx 16rpx; border-radius: 999rpx; }
.tag-est { color: #857c6e; border: 1rpx solid #d8cfbe; }
.tag-low { color: #b65b38; background: #f9eae0; font-weight: 600; }
.row-bottom { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8rpx; }
.qty { font-size: 34rpx; font-weight: 700; font-variant-numeric: tabular-nums; }
.qty-unit { font-size: 22rpx; font-weight: 400; color: #857c6e; }
.sub { font-size: 24rpx; color: #857c6e; }

.empty { margin-top: 32rpx; padding: 48rpx 32rpx; display: flex; flex-direction: column; align-items: center; gap: 8rpx; }
.empty-title { font-size: 30rpx; font-weight: 600; }
.empty-sub { font-size: 24rpx; color: #857c6e; }

.storage-error { padding: 40rpx 32rpx; display: flex; flex-direction: column; gap: 16rpx; }
.storage-error-text { font-size: 26rpx; color: #8a4b2f; line-height: 1.6; }
.storage-error .btn { margin: 0; font-size: 28rpx; border-radius: 999rpx; height: 88rpx; line-height: 88rpx; }
</style>

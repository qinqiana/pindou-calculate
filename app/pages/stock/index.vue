<template>
  <view class="page">
    <view class="hero">
      <text class="kicker">社区版参考色，不是官方精确色值</text>
      <text class="stat">累计已用 {{ ach.totalUsed }} 颗 · 完成作品 {{ ach.completedMakes }} 件</text>
    </view>
    <input class="search" :value="query" placeholder="搜索色号，例如 C12" @input="onSearch" />
    <scroll-view scroll-x class="groups">
      <text v-for="g in groups" :key="g" class="chip" :class="{ on: group === g }" @click="setGroup(g)">{{ g }}</text>
      <text class="chip" :class="{ on: !group }" @click="setGroup('')">全部</text>
    </scroll-view>
    <view class="actions">
      <button size="mini" @click="goBatch('first-entry')">首次录入</button>
      <button size="mini" @click="goBatch('count')">盘点</button>
      <button size="mini" @click="goBatch('restock')">补货</button>
      <button size="mini" @click="goHistory">变动</button>
    </view>
    <view v-for="row in rows" :key="row.code" class="row">
      <view class="swatch" :style="{ background: hex(row.code) }" />
      <view class="meta">
        <text class="code">{{ row.code }}</text>
        <text class="qty">{{ row.qty }} 颗 · {{ row.estimated ? '估算' : '精确' }}</text>
        <text class="used">已记录使用 {{ used(row.code) }} 颗</text>
        <text v-if="warn(row.code)" class="warn">低库存（相对预警基准）</text>
        <text v-else-if="row.baseline == null" class="muted">未录入，无预警基准</text>
      </view>
    </view>
    <view v-if="rows.length === 0" class="empty">没有匹配的色号，不会因此新建色号。</view>
  </view>
</template>

<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { GROUP_ORDER, colorByCode } from '../../src/ledger/catalog'
import { appLedger } from '../../src/platform/app-ledger'

const groups = GROUP_ORDER
const query = ref('')
const group = ref('')
const rows = ref(appLedger().listStock())
const ach = ref(appLedger().achievements())

function reload() {
  rows.value = appLedger().listStock(query.value, group.value || undefined)
  ach.value = appLedger().achievements()
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
onShow(reload)
</script>

<style>
.page { padding: 16px 16px 40px; }
.kicker { font-size: 12px; color: #6b6258; display: block; }
.stat { display: block; margin: 8px 0 16px; }
.search { background: #fffcf7; padding: 10px; border-radius: 8px; }
.groups { white-space: nowrap; margin: 12px 0; }
.chip { display: inline-block; padding: 6px 10px; margin-right: 8px; background: #efe8dc; border-radius: 16px; }
.chip.on { background: #7a8f6a; color: #fff; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.row { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid #e7dfd2; }
.swatch { width: 36px; height: 36px; border-radius: 6px; border: 1px solid #ccc; }
.code { font-weight: 600; display: block; }
.qty, .used, .muted { display: block; font-size: 13px; color: #6b6258; }
.warn { display: block; font-size: 13px; color: #8a4b2f; }
.empty { margin-top: 24px; color: #6b6258; }
</style>

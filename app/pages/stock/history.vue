<template>
  <view class="page">
    <view v-for="item in items" :key="item.movement.operationId + item.movement.code" class="card">
      <view class="head">
        <text class="reason">{{ item.operation.reason }}</text>
        <text class="code-tag">{{ item.movement.code }}</text>
      </view>
      <view class="change">
        <text class="before">{{ item.movement.qtyBefore }}</text>
        <text class="arrow">→</text>
        <text class="after">{{ item.movement.qtyAfter }}</text>
        <text class="delta" :class="{ neg: item.movement.delta < 0 }">{{ item.movement.delta > 0 ? '+' : '' }}{{ item.movement.delta }}</text>
      </view>
      <view class="meta">
        <text class="muted">{{ item.operation.at }}</text>
        <text class="muted">{{ item.movement.estimatedBefore ? '估算' : '精确' }} → {{ item.movement.estimatedAfter ? '估算' : '精确' }}</text>
      </view>
      <text v-if="item.operation.patternId || item.operation.makeId" class="muted link-line">
        关联图纸 {{ patternName(item.operation.patternId) }}
        <text v-if="item.operation.makeId"> · 制作 {{ item.operation.makeId }}</text>
      </text>
    </view>
    <view v-if="items.length === 0" class="card empty">
      <text class="empty-title">还没有库存变动</text>
      <text class="empty-sub">录入、盘点、补货或已拼之后，这里会解释每个数字为什么变。</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { appLedger } from '../../src/platform/app-ledger'

const items = ref(appLedger().movements())
onShow(() => {
  items.value = appLedger().movements()
})

function patternName(id?: string) {
  if (!id) return '—'
  const found = appLedger().getPattern(id)
  return found ? found.pattern.name : id
}
</script>

<style>
.page { padding: 24rpx 24rpx 60rpx; }
.card { background: #fffefb; border-radius: 24rpx; box-shadow: 0 2rpx 14rpx rgba(74, 62, 40, 0.06); padding: 28rpx 32rpx; margin-top: 20rpx; }
.card:first-child { margin-top: 0; }

.head { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.reason { font-size: 30rpx; font-weight: 700; }
.code-tag { font-size: 24rpx; font-weight: 700; color: #566c4d; background: #edf1e6; border-radius: 999rpx; padding: 4rpx 20rpx; }

.change { display: flex; align-items: baseline; gap: 16rpx; margin-top: 16rpx; }
.before, .after { font-size: 40rpx; font-weight: 700; font-variant-numeric: tabular-nums; }
.arrow { color: #b7ac9a; }
.delta { font-size: 30rpx; font-weight: 700; color: #566c4d; font-variant-numeric: tabular-nums; }
.delta.neg { color: #b65b38; }

.meta { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8rpx; margin-top: 12rpx; }
.muted { font-size: 22rpx; color: #a89d8c; }
.link-line { display: block; margin-top: 8rpx; }

.empty { display: flex; flex-direction: column; align-items: center; gap: 12rpx; padding: 56rpx 32rpx; }
.empty-title { font-size: 30rpx; font-weight: 600; }
.empty-sub { font-size: 24rpx; color: #857c6e; text-align: center; line-height: 1.6; }
</style>

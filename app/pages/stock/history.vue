<template>
  <view class="page">
    <view v-for="item in items" :key="item.movement.operationId + item.movement.code" class="card">
      <text class="time">{{ item.operation.at }}</text>
      <text class="reason">{{ item.operation.reason }} · {{ item.movement.code }}</text>
      <text>{{ item.movement.qtyBefore }} → {{ item.movement.qtyAfter }}（{{ item.movement.delta > 0 ? '+' : '' }}{{ item.movement.delta }}）</text>
      <text class="muted">{{ item.movement.estimatedBefore ? '估算' : '精确' }} → {{ item.movement.estimatedAfter ? '估算' : '精确' }}</text>
      <text v-if="item.operation.patternId || item.operation.makeId" class="muted">
        关联图纸 {{ patternName(item.operation.patternId) }}
        <text v-if="item.operation.makeId"> · 制作 {{ item.operation.makeId }}</text>
      </text>
    </view>
    <view v-if="items.length === 0" class="empty">还没有库存变动。</view>
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
.page { padding: 16px; }
.card { background: #fffcf7; padding: 12px; margin-bottom: 10px; border-radius: 8px; }
.time, .muted { display: block; font-size: 12px; color: #6b6258; }
.reason { display: block; font-weight: 600; }
.empty { color: #6b6258; }
</style>

<template>
  <view class="page">
    <view v-if="storageError" class="card storage-error">
      <text class="storage-error-text">{{ storageError }}</text>
      <button class="btn primary" @click="retryStorage">重试</button>
    </view>
    <template v-else>
    <view class="card">
      <text class="section-title">低库存预警</text>
      <text class="muted">按各色首次录入或最近补货后的数量为基准；扣减、撤回和盘点更正不会重置基准。</text>
      <view class="row">
        <input class="pct-input" type="number" :value="percent" @input="e => percent = e.detail.value" />
        <text class="pct-unit">%</text>
        <button class="btn primary small" @click="savePercent">保存比例</button>
      </view>
    </view>

    <view class="card">
      <text class="section-title">备份与恢复</text>
      <text class="muted">备份包含库存、图纸缩略图、确认用量和全部历史，不含原始大图。恢复是整体替换，不合并。</text>
      <button class="btn primary" @click="exportBak">导出完整备份到文件</button>
      <button class="btn ghost" @click="chooseBak">选择备份文件并预览差异</button>

      <view v-if="diff" class="diff">
        <text class="diff-title">将整体替换，不合并</text>
        <view class="diff-line"><text class="diff-key">余额变化色数</text><text class="diff-val">{{ diff.stockChanged }}</text></view>
        <view class="diff-line"><text class="diff-key">低库存预警比例</text><text class="diff-val">{{ diff.lowStockPercentBefore }}% → {{ diff.lowStockPercentAfter }}%</text></view>
        <view class="diff-line"><text class="diff-key">图纸</text><text class="diff-val">{{ diff.patternCountBefore }} → {{ diff.patternCountAfter }}</text></view>
        <view class="diff-line"><text class="diff-key">制作</text><text class="diff-val">{{ diff.makeCountBefore }} → {{ diff.makeCountAfter }}</text></view>
        <view class="diff-line"><text class="diff-key">变动记录</text><text class="diff-val">{{ diff.movementCountBefore }} → {{ diff.movementCountAfter }}</text></view>
        <view class="diff-line"><text class="diff-key">缩略图完整</text><text class="diff-val">{{ diff.thumbnailComplete ? '是' : '否' }}</text></view>
        <button class="btn warn" @click="replace">整体替换</button>
        <button class="btn ghost" @click="cancel">取消</button>
      </view>
    </view>

    <view class="card">
      <text class="section-title">说明</text>
      <text class="muted">· 颜色块使用社区版参考色，不是品牌官方色值，也不决定计数；始终以色号为准。</text>
      <text class="muted">· 全部数据只保存在这台设备上，离线可用；换机请先导出备份。</text>
    </view>

    <text v-if="message" class="msg">{{ message }}</text>
    </template>
  </view>
</template>

<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { ref } from 'vue'
import type { Ledger } from '../../src/ledger/operations'
import { appLedger, appStorageState, bootAppLedger, newRequestId, retryAppStorage } from '../../src/platform/app-ledger'
import { pickTextDocument, writeTextToDownloads } from '../../src/platform/fs'

const percent = ref('10')
const storageError = ref('')
const diff = ref<null | {
  stockChanged: number
  lowStockPercentBefore: number
  lowStockPercentAfter: number
  patternCountBefore: number
  patternCountAfter: number
  makeCountBefore: number
  makeCountAfter: number
  movementCountBefore: number
  movementCountAfter: number
  thumbnailComplete: boolean
}>(null)
const message = ref('')
let validated: unknown = null
let previewToken: ReturnType<Ledger['token']> | null = null

function clearPreview() {
  diff.value = null
  validated = null
  previewToken = null
}

onShow(async () => {
  await bootAppLedger()
  storageError.value = appStorageState().message ?? ''
  if (!storageError.value) percent.value = String(appLedger().settings().lowStockPercent)
})

async function retryStorage() {
  await retryAppStorage()
  storageError.value = appStorageState().message ?? ''
  if (!storageError.value) percent.value = String(appLedger().settings().lowStockPercent)
}

function savePercent() {
  const result = appLedger().setLowStockPercent(newRequestId(), percent.value, appLedger().token())
  message.value = result.ok ? '预警比例已保存' : result.message
}

async function exportBak() {
  const data = appLedger().exportBackup()
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const name = 'pindou-backup-' + stamp + '.json'
  const written = await writeTextToDownloads(name, JSON.stringify(data))
  message.value = written.ok
    ? '备份已保存到下载目录（' + written.value.path + '）。不含原始大图、密钥或设备路径。'
    : written.message + '，账本未改。'
}

async function chooseBak() {
  clearPreview()
  const picked = await pickTextDocument()
  if (!picked.ok) {
    message.value = picked.message
    return
  }
  const ledger = appLedger()
  const token = ledger.token()
  const result = ledger.validateBackup(picked.value.text)
  if (!result.ok) {
    message.value = result.message
    return
  }
  diff.value = result.diff
  validated = result.backup
  previewToken = token
  message.value = '这是整体替换预览，取消不会改账本。'
}

function replace() {
  if (!validated || !previewToken) return
  const result = appLedger().restoreReplace(newRequestId(), validated, previewToken)
  message.value = result.ok ? '已整体替换为备份账本' : result.code === 'stale' ? '账本在预览后有变化，请重新选择备份并预览差异' : result.message
  clearPreview()
}

function cancel() {
  appLedger().cancelRestore()
  clearPreview()
  message.value = '已取消，原账本完整。'
}
</script>

<style>
.page { padding: 24rpx 24rpx 60rpx; }
.card { background: #fffefb; border-radius: 24rpx; box-shadow: 0 2rpx 14rpx rgba(74, 62, 40, 0.06); padding: 28rpx 32rpx; margin-top: 24rpx; }
.card:first-child { margin-top: 0; }
.section-title { display: block; font-size: 30rpx; font-weight: 700; }
.muted { display: block; margin-top: 12rpx; font-size: 24rpx; color: #857c6e; line-height: 1.6; }

.row { display: flex; align-items: center; gap: 16rpx; margin-top: 20rpx; }
.pct-input { width: 160rpx; height: 84rpx; background: #fff; border: 1rpx solid #e0d7c4; border-radius: 14rpx; padding: 0 24rpx; font-size: 30rpx; font-variant-numeric: tabular-nums; }
.pct-unit { font-size: 30rpx; color: #6e6353; }

.btn { margin: 24rpx 0 0; font-size: 30rpx; border-radius: 999rpx; height: 96rpx; line-height: 96rpx; }
.btn::after { border: none; }
.primary { background: #6b8260; color: #fff; font-weight: 600; }
.primary.small { margin: 0; padding: 0 32rpx; height: 84rpx; line-height: 84rpx; font-size: 26rpx; }
.ghost { background: transparent; color: #857c6e; border: 2rpx solid #d8cfbe; }
.warn { background: #b65b38; color: #fff; font-weight: 600; }

.diff { margin-top: 24rpx; background: #fbf8f0; border: 1rpx solid #eae2d2; border-radius: 16rpx; padding: 24rpx; }
.diff-title { display: block; font-size: 26rpx; font-weight: 700; color: #8a4b2f; margin-bottom: 12rpx; }
.diff-line { display: flex; justify-content: space-between; padding: 8rpx 0; }
.diff-key { font-size: 26rpx; color: #6e6353; }
.diff-val { font-size: 26rpx; font-weight: 700; font-variant-numeric: tabular-nums; }

.msg { display: block; margin-top: 20rpx; font-size: 26rpx; color: #566c4d; }

.storage-error { padding: 40rpx 32rpx; display: flex; flex-direction: column; gap: 16rpx; }
.storage-error-text { font-size: 26rpx; color: #8a4b2f; line-height: 1.6; }
.storage-error .btn { margin: 0; font-size: 28rpx; border-radius: 999rpx; height: 88rpx; line-height: 88rpx; }
</style>

<template>
  <view class="page">
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
  </view>
</template>

<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { appLedger, newRequestId } from '../../src/platform/app-ledger'

const percent = ref(String(appLedger().settings().lowStockPercent))
const diff = ref<null | {
  stockChanged: number
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

onShow(() => {
  percent.value = String(appLedger().settings().lowStockPercent)
})

function savePercent() {
  const result = appLedger().setLowStockPercent(newRequestId(), percent.value, appLedger().token())
  message.value = result.ok ? '预警比例已保存' : result.message
}

function exportBak() {
  const data = appLedger().exportBackup()
  const text = JSON.stringify(data)
  const dest = '_doc/pindou-backup.json'
  uni.getFileSystemManager().writeFile({
    filePath: dest,
    data: text,
    encoding: 'utf8',
    success: () => {
      message.value = '备份已保存到文件 ' + dest + '。不含原始大图、密钥或设备路径。'
    },
    fail: () => {
      message.value = '保存备份文件失败，账本未改。'
    },
  })
}

function chooseBak() {
  const fs = uni.getFileSystemManager()
  const pick = (uni as { chooseFile?: (opts: unknown) => void }).chooseFile
  const afterRead = (raw: string) => {
    const result = appLedger().validateBackup(raw)
    if (!result.ok) {
      message.value = result.message
      diff.value = null
      validated = null
      return
    }
    diff.value = result.diff
    validated = result.backup
    message.value = '这是整体替换预览，取消不会改账本。'
  }
  if (typeof pick === 'function') {
    pick({
      count: 1,
      extension: ['.json'],
      success: (res: { tempFiles?: { path: string }[]; tempFilePaths?: string[] }) => {
        const path = res.tempFilePaths?.[0] || res.tempFiles?.[0]?.path
        if (!path) {
          message.value = '已取消选择备份'
          return
        }
        fs.readFile({
          filePath: path,
          encoding: 'utf8',
          success: (file) => afterRead(String(file.data)),
          fail: () => {
            message.value = '无法读取备份文件，原账本未改。'
          },
        })
      },
      fail: () => {
        message.value = '已取消选择备份，原账本未改。'
      },
    })
    return
  }
  message.value = '当前环境没有文件选择器。'
}

function replace() {
  if (!validated) return
  const result = appLedger().restoreReplace(newRequestId(), validated, appLedger().token())
  message.value = result.ok ? '已整体替换为备份账本' : result.message
  diff.value = null
}

function cancel() {
  appLedger().cancelRestore()
  diff.value = null
  validated = null
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
</style>

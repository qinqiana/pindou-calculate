<template>
  <view class="page">
    <text class="kicker">社区版参考色，不是品牌官方色值，也不决定计数。</text>
    <text>低库存预警比例（%）</text>
    <input type="number" :value="percent" @input="e => percent = e.detail.value" />
    <button size="mini" @click="savePercent">保存比例</button>
    <button @click="exportBak">导出完整备份到文件</button>
    <button @click="chooseBak">选择备份文件并预览差异</button>
    <view v-if="diff" class="card">
      <text>将整体替换，不合并。</text>
      <text>余额变化色数 {{ diff.stockChanged }}</text>
      <text>图纸 {{ diff.patternCountBefore }} → {{ diff.patternCountAfter }}</text>
      <text>制作 {{ diff.makeCountBefore }} → {{ diff.makeCountAfter }}</text>
      <text>变动记录 {{ diff.movementCountBefore }} → {{ diff.movementCountAfter }}</text>
      <text>缩略图完整 {{ diff.thumbnailComplete ? '是' : '否' }}</text>
      <button type="primary" @click="replace">整体替换</button>
      <button @click="cancel">取消</button>
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
.page { padding: 16px; }
.kicker { display: block; font-size: 12px; color: #6b6258; margin-bottom: 12px; }
input { background: #fffcf7; width: 100%; margin: 8px 0; padding: 8px; }
.card { background: #fffcf7; padding: 12px; margin-top: 12px; }
.msg { display: block; margin-top: 8px; }
</style>

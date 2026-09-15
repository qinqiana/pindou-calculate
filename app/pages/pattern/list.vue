<template>
  <view class="page">
    <button @click="pick">选择 PNG/JPG 图纸</button>
    <view v-if="pendingPreview" class="preview-card">
      <image class="preview" :src="pendingPreview" mode="aspectFit" />
      <input :value="pendingName" placeholder="图纸名称" @input="e => pendingName = e.detail.value" />
      <input :value="pendingNote" placeholder="来源备注（可选）" @input="e => pendingNote = e.detail.value" />
      <input :value="pendingSize" placeholder="制作尺寸（没有则留空，显示未提供）" @input="e => pendingSize = e.detail.value" />
      <button type="primary" @click="savePending">确认导入这张图</button>
      <button @click="cancelPending">取消，不创建图纸</button>
    </view>
    <view v-for="card in cards" :key="card.pattern.id" class="card" @click="open(card.pattern.id)">
      <image class="thumb" :src="'data:' + card.pattern.thumbnail.mime + ';base64,' + card.pattern.thumbnail.base64" mode="aspectFill" />
      <view>
        <text class="name">{{ card.pattern.name }}</text>
        <text class="muted">确认版次 {{ card.pattern.confirmedVersion ?? '未确认' }} · 尺寸 {{ card.sizeLabel }}</text>
        <text class="muted">已确认总需求 {{ card.totalDemand == null ? '—' : card.totalDemand }} · 有效制作 {{ card.makeCount }}</text>
        <text v-if="card.hasDraft" class="warn">有未确认编辑，制作仍用已确认版本</text>
      </view>
    </view>
    <view v-if="cards.length === 0 && !pendingPreview" class="empty">还没有图纸。离线也可从本机选择 PNG 或 JPG。</view>
    <text v-if="error" class="err">{{ error }}</text>
  </view>
</template>

<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { appLedger, newRequestId } from '../../src/platform/app-ledger'

const cards = ref(appLedger().listPatternCards())
const error = ref('')
const pendingPreview = ref('')
const pendingName = ref('未命名图纸')
const pendingNote = ref('')
const pendingSize = ref('')
let pendingBytes: Uint8Array | null = null

function reload() {
  cards.value = appLedger().listPatternCards()
}

function pick() {
  error.value = ''
  uni.chooseImage({
    count: 1,
    sizeType: ['original'],
    success: (res) => {
      const path = res.tempFilePaths[0]
      pendingPreview.value = path
      uni.getFileSystemManager().readFile({
        filePath: path,
        success: (file) => {
          pendingBytes = new Uint8Array(file.data as ArrayBuffer)
        },
        fail: () => {
          error.value = '读取图片失败'
          pendingPreview.value = ''
        },
      })
    },
    fail: () => {
      error.value = '已取消选择，没有创建图纸'
    },
  })
}

function cancelPending() {
  pendingPreview.value = ''
  pendingBytes = null
  error.value = '已取消，没有创建图纸'
}

function savePending() {
  if (!pendingBytes) {
    error.value = '请先预览图纸'
    return
  }
  const result = appLedger().createPattern(
    newRequestId(),
    {
      name: pendingName.value,
      sourceNote: pendingNote.value,
      sizeNote: pendingSize.value,
      imageBytes: pendingBytes,
    },
    appLedger().token(),
  )
  if (!result.ok) {
    error.value = result.message
    return
  }
  pendingPreview.value = ''
  pendingBytes = null
  uni.navigateTo({ url: '/pages/pattern/edit?id=' + result.patternId })
}

function open(id: string) {
  const p = appLedger().getPattern(id)
  if (p && p.draft) uni.navigateTo({ url: '/pages/pattern/edit?id=' + id })
  else if (p && p.confirmed) uni.navigateTo({ url: '/pages/pattern/detail?id=' + id })
  else uni.navigateTo({ url: '/pages/pattern/edit?id=' + id })
}

onShow(reload)
</script>

<style>
.page { padding: 16px; }
.card, .preview-card { display: flex; flex-direction: column; gap: 8px; background: #fffcf7; padding: 12px; margin-top: 12px; border-radius: 8px; }
.card { flex-direction: row; }
.thumb { width: 72px; height: 72px; background: #eee; }
.preview { width: 100%; height: 180px; background: #eee; }
.name { display: block; font-weight: 600; }
.muted, .empty { color: #6b6258; display: block; }
.warn, .err { color: #8a4b2f; display: block; }
input { background: #fff; padding: 8px; }
</style>

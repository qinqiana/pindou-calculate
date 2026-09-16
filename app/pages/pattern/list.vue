<template>
  <view class="page">
    <view class="import-card" @click="pick">
      <text class="import-plus">＋</text>
      <text class="import-title">导入图纸</text>
      <text class="import-sub">从本机选择 PNG / JPG，断网也能用</text>
    </view>

    <view v-if="pendingPreview" class="card pending">
      <image class="pending-img" :src="pendingPreview" mode="aspectFit" />
      <view class="field">
        <text class="field-label">图纸名称</text>
        <input class="field-input" :value="pendingName" @input="e => pendingName = e.detail.value" />
      </view>
      <view class="field">
        <text class="field-label">来源备注（可选）</text>
        <input class="field-input" :value="pendingNote" placeholder="例如小红书某位作者" placeholder-class="ph" @input="e => pendingNote = e.detail.value" />
      </view>
      <view class="field">
        <text class="field-label">制作尺寸（可选）</text>
        <input class="field-input" :value="pendingSize" placeholder="没有则留空，显示未提供" placeholder-class="ph" @input="e => pendingSize = e.detail.value" />
      </view>
      <button class="btn primary" @click="savePending">确认导入这张图</button>
      <button class="btn ghost" @click="cancelPending">取消，不创建图纸</button>
    </view>

    <view v-for="card in cards" :key="card.pattern.id" class="card item" @click="open(card.pattern.id)">
      <image class="thumb" :src="'data:' + card.pattern.thumbnail.mime + ';base64,' + card.pattern.thumbnail.base64" mode="aspectFill" />
      <view class="item-main">
        <view class="item-head">
          <text class="name">{{ card.pattern.name }}</text>
          <text v-if="card.hasDraft" class="tag-draft">有未确认编辑</text>
        </view>
        <text class="muted">确认版次 {{ card.pattern.confirmedVersion ?? '未确认' }} · 尺寸 {{ card.sizeLabel }}</text>
        <text class="muted">已确认总需求 {{ card.totalDemand == null ? '—' : card.totalDemand }} 颗 · 有效制作 {{ card.makeCount }} 件</text>
      </view>
    </view>

    <view v-if="cards.length === 0 && !pendingPreview" class="card empty">
      <text class="empty-title">还没有图纸</text>
      <text class="empty-sub">导入一张想拼的图纸，录入逐色用量后就能看缺口、记已拼。</text>
    </view>
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
.page { padding: 24rpx 24rpx 60rpx; }
.card { background: #fffefb; border-radius: 24rpx; box-shadow: 0 2rpx 14rpx rgba(74, 62, 40, 0.06); }

.import-card { display: flex; flex-direction: column; align-items: center; gap: 8rpx; padding: 48rpx 32rpx; border: 2rpx dashed #c4b694; border-radius: 24rpx; background: #fbf8f0; }
.import-plus { font-size: 56rpx; color: #6b8260; line-height: 1; }
.import-title { font-size: 32rpx; font-weight: 700; color: #566c4d; }
.import-sub { font-size: 24rpx; color: #857c6e; }

.pending { margin-top: 24rpx; padding: 28rpx 32rpx; }
.pending-img { width: 100%; height: 360rpx; background: #f0e9da; border-radius: 16rpx; }
.field { margin-top: 20rpx; }
.field-label { display: block; font-size: 24rpx; color: #857c6e; margin-bottom: 8rpx; }
.field-input { height: 84rpx; background: #fff; border: 1rpx solid #e0d7c4; border-radius: 14rpx; padding: 0 24rpx; font-size: 28rpx; }
.ph { color: #b7ac9a; }
.btn { margin: 24rpx 0 0; font-size: 30rpx; border-radius: 999rpx; height: 96rpx; line-height: 96rpx; }
.btn::after { border: none; }
.primary { background: #6b8260; color: #fff; font-weight: 600; }
.ghost { background: transparent; color: #857c6e; border: 2rpx solid #d8cfbe; }

.item { display: flex; gap: 24rpx; padding: 24rpx; margin-top: 20rpx; }
.thumb { width: 168rpx; height: 168rpx; border-radius: 16rpx; background: #f0e9da; flex-shrink: 0; }
.item-main { flex: 1; display: flex; flex-direction: column; gap: 8rpx; min-width: 0; }
.item-head { display: flex; align-items: center; gap: 12rpx; flex-wrap: wrap; }
.name { font-size: 32rpx; font-weight: 700; }
.tag-draft { font-size: 20rpx; color: #b65b38; background: #f9eae0; border-radius: 999rpx; padding: 4rpx 16rpx; }
.muted { font-size: 24rpx; color: #857c6e; }

.empty { margin-top: 24rpx; padding: 56rpx 32rpx; display: flex; flex-direction: column; align-items: center; gap: 12rpx; }
.empty-title { font-size: 30rpx; font-weight: 600; }
.empty-sub { font-size: 24rpx; color: #857c6e; text-align: center; line-height: 1.6; }
.err { display: block; margin-top: 24rpx; color: #b65b38; font-size: 26rpx; }
</style>

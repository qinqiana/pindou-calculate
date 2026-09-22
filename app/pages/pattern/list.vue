<template>
  <view class="page">
    <view v-if="storageError" class="card storage-error">
      <text class="storage-error-text">{{ storageError }}</text>
      <button class="btn primary" @click="retryStorage">重试</button>
    </view>
    <template v-else>
    <view class="import-card" :class="{ busy: picking }" @click="pick">
      <text class="import-plus">＋</text>
      <text class="import-title">导入图纸</text>
      <text class="import-sub">{{ picking ? '正在读取和检查图片…' : '从本机选择 PNG / JPG / WebP，断网也能用' }}</text>
    </view>

    <view v-if="pendingPreview" class="card pending">
      <image class="pending-img" :src="pendingPreview" mode="aspectFit" @load="previewReady = true" @error="previewReady = false; error = '预览失败，请重新选择图片；其他输入已保留。'" />
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
      <button class="btn primary" :disabled="picking || saving || !previewReady" @click="savePending">确认导入这张图</button>
      <button class="btn ghost" :disabled="saving" @click="cancelPending">取消，不创建图纸</button>
    </view>

    <view v-for="card in cards" :key="card.pattern.id" class="card item" @click="open(card.pattern.id)">
      <image class="thumb" :src="'data:' + card.pattern.thumbnail.mime + ';base64,' + card.pattern.thumbnail.base64" mode="aspectFill" />
      <view class="item-main">
        <view class="item-head">
          <text class="name">{{ card.pattern.name }}</text>
          <text v-if="card.hasDraft" class="tag-draft">有未确认编辑</text>
        </view>
        <text class="muted">确认版次 {{ card.pattern.confirmedVersion ?? '未确认' }} · 尺寸 {{ card.sizeLabel }}</text>
        <text class="muted">{{ card.totalDemand == null ? '尚未录入用量' : '已确认总需求 ' + card.totalDemand + ' 颗' }} · 有效制作 {{ card.makeCount }} 件</text>
      </view>
      <button class="remove-btn" @click.stop="removePattern(card.pattern.id)">移除</button>
    </view>

    <view v-if="cards.length === 0 && !pendingPreview" class="card empty">
      <text class="empty-title">还没有图纸</text>
      <text class="empty-sub">导入一张想拼的图纸，录入逐色用量后就能看缺口、记已拼。</text>
    </view>
    <text v-if="error" class="err">{{ error }}</text>
    </template>
  </view>
</template>

<script setup lang="ts">
import { onHide, onShow, onUnload } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { handoffOriginal, prepareOriginal, takeOriginal, type OriginalImage } from '../../src/platform/image'
import { appLedger, appStorageState, bootAppLedger, newRequestId, retryAppStorage } from '../../src/platform/app-ledger'
import { pickImageFile } from '../../src/platform/fs'

const cards = ref<ReturnType<ReturnType<typeof appLedger>['listPatternCards']>>([])
const error = ref('')
const storageError = ref('')
const pendingPreview = ref('')
const previewReady = ref(false)
const pendingName = ref('未命名图纸')
const pendingNote = ref('')
const pendingSize = ref('')
const picking = ref(false)
const saving = ref(false)
let pendingOriginal: OriginalImage | null = null
let pendingRequest = ''
let selection = 0
let pendingEpoch = 0

function reload() {
  cards.value = appLedger().listPatternCards()
}

async function retryStorage() {
  await retryAppStorage()
  storageError.value = appStorageState().message ?? ''
  if (!storageError.value) reload()
}

async function pick() {
  if (picking.value || saving.value) return
  const request = ++selection
  const epoch = appLedger().token().epoch
  picking.value = true
  error.value = ''
  try {
    const picked = await pickImageFile()
    if (request !== selection || epoch !== appLedger().token().epoch) return
    const pages = getCurrentPages()
    if (pages[pages.length - 1]?.route !== 'pages/pattern/list') { releasePending(); return }
    if (!picked.ok) { error.value = picked.message; return }
    const prepared = prepareOriginal(picked.value.bytes)
    if (!prepared.ok) { error.value = prepared.message; return }
    pendingOriginal = prepared.original
    previewReady.value = previewReady.value && pendingPreview.value === prepared.original.preview
    pendingPreview.value = prepared.original.preview
    pendingRequest = newRequestId()
    pendingEpoch = epoch
  } catch {
    error.value = '图片处理失败，请重试选图；已有输入保留。'
  } finally {
    picking.value = false
  }
}

function releasePending() {
  selection++
  pendingPreview.value = ''
  previewReady.value = false
  pendingOriginal = null
}

function cancelPending() {
  releasePending()
  error.value = '已取消，没有创建图纸'
}

function savePending() {
  if (saving.value || picking.value) return
  if (!previewReady.value) { error.value = '请等图片预览完成后再确认。'; return }
  if (pendingEpoch !== appLedger().token().epoch) {
    releasePending()
    error.value = '账本已恢复，请重新选图。'
    return
  }
  if (!pendingOriginal) {
    error.value = '请先预览图纸'
    return
  }
  saving.value = true
  const result = appLedger().createPattern(
    pendingRequest,
    {
      name: pendingName.value,
      sourceNote: pendingNote.value,
      sizeNote: pendingSize.value,
      imageBytes: pendingOriginal.bytes,
    },
    appLedger().token(),
  )
  if (!result.ok) {
    saving.value = false
    error.value = result.message + '；已有输入保留，可重试。'
    return
  }
  handoffOriginal(result.patternId, pendingEpoch, pendingOriginal)
  uni.navigateTo({
    url: '/pages/pattern/edit?id=' + result.patternId,
    success: () => { releasePending(); saving.value = false },
    fail: () => {
      takeOriginal(result.patternId, pendingEpoch)
      saving.value = false
      reload()
      error.value = '图纸已导入，但未能打开用量页，请重试或从列表打开。'
    },
  })
}

function removePattern(patternId: string) {
  uni.showModal({
    title: '移除图纸',
    content: '图纸将从主列表移除，但确认用量、制作记录和备份会保留。',
    success: ({ confirm }: { confirm: boolean }) => {
      if (!confirm) return
      const result = appLedger().archivePattern(newRequestId(), patternId, appLedger().token())
      if (!result.ok) {
        error.value = result.message
        return
      }
      reload()
    },
  })
}

function open(id: string) {
  const p = appLedger().getPattern(id)
  if (p && p.draft) uni.navigateTo({ url: '/pages/pattern/edit?id=' + id })
  else if (p && p.confirmed) uni.navigateTo({ url: '/pages/pattern/detail?id=' + id })
  else uni.navigateTo({ url: '/pages/pattern/edit?id=' + id })
}

onShow(async () => {
  await bootAppLedger()
  storageError.value = appStorageState().message ?? ''
  if (!storageError.value) reload()
  if (pendingOriginal && pendingEpoch !== appLedger().token().epoch) releasePending()
})

// Opening the system picker may hide the app; it is still the same input session.
onHide(() => { if (!picking.value && !saving.value) releasePending() })
onUnload(releasePending)
</script>

<style>
.page { padding: 24rpx 24rpx 60rpx; }
.card { background: #fffefb; border-radius: 24rpx; box-shadow: 0 2rpx 14rpx rgba(74, 62, 40, 0.06); }

.import-card { display: flex; flex-direction: column; align-items: center; gap: 8rpx; padding: 48rpx 32rpx; border: 2rpx dashed #c4b694; border-radius: 24rpx; background: #fbf8f0; }
.import-card.busy { opacity: 0.65; }
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
.remove-btn { flex: none; align-self: center; margin: 0; padding: 0 20rpx; height: 64rpx; line-height: 64rpx; font-size: 24rpx; color: #b65b38; background: #fffefb; border: 2rpx solid #e3b9a5; border-radius: 999rpx; }
.remove-btn::after { border: none; }

.empty { margin-top: 24rpx; padding: 56rpx 32rpx; display: flex; flex-direction: column; align-items: center; gap: 12rpx; }
.empty-title { font-size: 30rpx; font-weight: 600; }
.empty-sub { font-size: 24rpx; color: #857c6e; text-align: center; line-height: 1.6; }
.err { display: block; margin-top: 24rpx; color: #b65b38; font-size: 26rpx; }

.storage-error { padding: 40rpx 32rpx; display: flex; flex-direction: column; gap: 16rpx; }
.storage-error-text { font-size: 26rpx; color: #8a4b2f; line-height: 1.6; }
.storage-error .btn { margin: 0; font-size: 28rpx; border-radius: 999rpx; height: 88rpx; line-height: 88rpx; }
</style>

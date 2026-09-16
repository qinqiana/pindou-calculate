<template>
  <view class="page">
    <view class="card">
      <text class="section-title">分享图片</text>
      <text class="muted">预览本地模板。保存的是图片文件，不会发布到朋友圈或小红书。</text>

      <view class="segmented">
        <text class="seg" :class="{ on: kind === 'moments' }" @click="setKind('moments')">朋友圈</text>
        <text class="seg" :class="{ on: kind === 'xiaohongshu' }" @click="setKind('xiaohongshu')">小红书 9:15</text>
      </view>

      <view class="variants">
        <text
          v-for="v in variants"
          :key="v"
          class="variant-chip"
          :class="{ on: variant === v }"
          @click="setVariant(v)"
        >{{ labels[v] }}</text>
      </view>

      <text class="name-line">图纸：{{ name }}</text>
      <text class="muted">默认不包含库存、变动历史或内部路径。没有单独的作品照片时，「作品」只是占位，不会把图纸截图说成实物成品。</text>
    </view>

    <image v-if="previewSrc" class="preview" :src="previewSrc" mode="widthFix" />

    <button class="btn primary" @click="save">保存图片</button>
    <button class="btn ghost" @click="cancel">取消</button>
    <text v-if="message" class="msg">{{ message }}</text>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { appLedger } from '../../src/platform/app-ledger'
import { saveImageToGallery } from '../../src/platform/fs'
import { previewShareDataUrl, shareContentFromPattern, shareDestPath } from '../../src/share/from-pattern'
import { renderShareImage, SHARE_VARIANTS, SHARE_VARIANT_LABELS, type ShareContent, type ShareKind, type ShareVariant } from '../../src/share/templates'

const id = ref('')
const name = ref('')
const kind = ref<ShareKind>('moments')
const variant = ref<ShareVariant>('classic')
const variants = SHARE_VARIANTS
const labels = SHARE_VARIANT_LABELS
const message = ref('')
const previewSrc = ref('')
let content: ShareContent = { patternName: '' }

function rebuild() {
  previewSrc.value = previewShareDataUrl(kind.value, content, variant.value)
}

function setKind(next: ShareKind) {
  kind.value = next
  rebuild()
}

function setVariant(next: ShareVariant) {
  variant.value = next
  rebuild()
}

onLoad((q: { id?: string }) => {
  id.value = q.id || ''
  const c = appLedger().shareContent(id.value)
  if (!c.ok) {
    message.value = c.message
    return
  }
  name.value = c.patternName
  content = shareContentFromPattern(c.patternName, c.thumbnail)
  rebuild()
})

async function save() {
  message.value = ''
  const png = renderShareImage(kind.value, content, variant.value)
  const dest = shareDestPath(kind.value, variant.value)
  const saved = await saveImageToGallery(dest, png)
  message.value = saved.ok ? '图片已保存到系统相册（' + saved.value.path + '），未发布。' : saved.message + '，账本未改，可以重试。'
}

function cancel() {
  message.value = '已取消，未保存也未发布。'
  uni.navigateBack()
}
</script>

<style>
.page { padding: 24rpx 24rpx 80rpx; }
.card { background: #fffefb; border-radius: 24rpx; box-shadow: 0 2rpx 14rpx rgba(74, 62, 40, 0.06); padding: 28rpx 32rpx; }
.section-title { display: block; font-size: 30rpx; font-weight: 700; }
.muted { display: block; margin-top: 12rpx; font-size: 24rpx; color: #857c6e; line-height: 1.6; }

.segmented { display: flex; background: #f0e9da; border-radius: 999rpx; padding: 6rpx; margin-top: 24rpx; }
.seg { flex: 1; text-align: center; font-size: 28rpx; color: #857c6e; padding: 16rpx 0; border-radius: 999rpx; }
.seg.on { background: #fffefb; color: #2f2a23; font-weight: 700; box-shadow: 0 2rpx 8rpx rgba(74, 62, 40, 0.08); }

.variants { display: flex; gap: 16rpx; margin-top: 20rpx; }
.variant-chip { flex: 1; text-align: center; font-size: 26rpx; color: #6e6353; background: #f0e9da; border-radius: 14rpx; padding: 16rpx 0; }
.variant-chip.on { background: #6b8260; color: #fff; font-weight: 600; }

.name-line { display: block; margin-top: 20rpx; font-size: 28rpx; font-weight: 600; }

.preview { width: 100%; margin-top: 24rpx; border-radius: 24rpx; background: #f0e9da; }

.btn { margin: 24rpx 0 0; font-size: 30rpx; border-radius: 999rpx; height: 96rpx; line-height: 96rpx; }
.btn::after { border: none; }
.primary { background: #6b8260; color: #fff; font-weight: 600; }
.ghost { background: transparent; color: #857c6e; border: 2rpx solid #d8cfbe; }

.msg { display: block; margin-top: 20rpx; font-size: 26rpx; color: #566c4d; }
</style>

<template>
  <view class="page">
    <text class="hint">预览本地模板。保存的是图片文件，不会发布到朋友圈或小红书。</text>
    <view class="tabs">
      <button size="mini" :type="kind === 'moments' ? 'primary' : 'default'" @click="setKind('moments')">朋友圈</button>
      <button size="mini" :type="kind === 'xiaohongshu' ? 'primary' : 'default'" @click="setKind('xiaohongshu')">小红书 9:15</button>
    </view>
    <text>图纸：{{ name }}</text>
    <text class="muted">默认不包含库存、变动历史或内部路径。没有单独的作品照片时，「作品」只是占位，不会把图纸截图说成实物成品。</text>
    <image v-if="previewSrc" class="preview" :src="previewSrc" mode="widthFix" />
    <button type="primary" @click="save">保存图片</button>
    <button @click="cancel">取消</button>
    <text v-if="message" class="msg">{{ message }}</text>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { appLedger } from '../../src/platform/app-ledger'
import { previewShareDataUrl, shareContentFromPattern, shareDestPath } from '../../src/share/from-pattern'
import { renderShareImage, type ShareContent, type ShareKind } from '../../src/share/templates'

const id = ref('')
const name = ref('')
const kind = ref<ShareKind>('moments')
const message = ref('')
const previewSrc = ref('')
let content: ShareContent = { patternName: '' }

function rebuild() {
  previewSrc.value = previewShareDataUrl(kind.value, content)
}

function setKind(next: ShareKind) {
  kind.value = next
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

function save() {
  message.value = ''
  const png = renderShareImage(kind.value, content)
  const dest = shareDestPath(kind.value)
  const fs = uni.getFileSystemManager()
  fs.writeFile({
    filePath: dest,
    data: png,
    success: () => {
      message.value = '图片已保存到本机，未发布。'
    },
    fail: () => {
      message.value = '保存失败，账本未改，可以重试。'
    },
  })
}

function cancel() {
  message.value = '已取消，未保存也未发布。'
  uni.navigateBack()
}
</script>

<style>
.page { padding: 16px; }
.hint, .muted { display: block; color: #6b6258; margin-bottom: 8px; }
.tabs { display: flex; gap: 8px; margin: 12px 0; }
.preview { width: 100%; background: #eee; margin: 12px 0; }
.msg { display: block; margin-top: 12px; }
</style>

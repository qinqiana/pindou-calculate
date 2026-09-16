<template>
  <view class="page">
    <view class="card">
      <text class="section-title">图纸信息</text>
      <view class="field">
        <text class="field-label">图纸名称</text>
        <input class="field-input" :value="name" @input="e => name = e.detail.value" />
      </view>
      <view class="field">
        <text class="field-label">来源备注（可选）</text>
        <input class="field-input" :value="note" placeholder="例如小红书某位作者" placeholder-class="ph" @input="e => note = e.detail.value" />
      </view>
      <view class="field">
        <text class="field-label">制作尺寸（可选）</text>
        <input class="field-input" :value="sizeNote" placeholder="没有则留空，显示未提供" placeholder-class="ph" @input="e => sizeNote = e.detail.value" />
      </view>
      <view class="field">
        <text class="field-label">标题总数（可选核对）</text>
        <input class="field-input" type="number" :value="titleTotal" placeholder="图纸上印的总颗数，用于核对差异" placeholder-class="ph" @input="e => titleTotal = e.detail.value" />
      </view>
    </view>

    <view class="card">
      <text class="section-title">逐色用量</text>
      <view v-for="(line, i) in lines" :key="i" class="line">
        <input class="code-input" :value="line.code" placeholder="色号" placeholder-class="ph" @input="e => line.code = e.detail.value" />
        <input class="qty-input" type="number" :value="String(line.qty)" placeholder="颗数" placeholder-class="ph" @input="e => line.qty = e.detail.value" />
        <text class="del" @click="lines.splice(i, 1)">删除</text>
      </view>
      <view class="add" @click="lines.push({ code: '', qty: '' })">
        <text class="add-text">＋ 增加色号</text>
      </view>
    </view>

    <text class="hint">确认不会扣库存。未确认的编辑不会替换已确认版本。</text>

    <view v-if="needAck" class="card diff-card">
      <text class="diff-text">{{ diffHint }}</text>
      <button class="btn warn" @click="ackAndSave">已知差异，仍用逐色合计</button>
    </view>

    <button class="btn primary" @click="confirmAll()">确认全部用量</button>
    <text v-if="error" class="err">{{ error }}</text>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { appLedger, newRequestId } from '../../src/platform/app-ledger'

const id = ref('')
const name = ref('')
const note = ref('')
const sizeNote = ref('')
const titleTotal = ref('')
const lines = ref<{ code: string; qty: string | number }[]>([{ code: '', qty: '' }])
const error = ref('')
const diffHint = ref('')
const needAck = ref(false)

onLoad((q: { id?: string }) => {
  id.value = q.id || ''
  const found = appLedger().getPattern(id.value)
  if (!found) return
  name.value = found.pattern.name
  note.value = found.pattern.sourceNote
  sizeNote.value = found.pattern.sizeNote || ''
  const src = found.draft || found.confirmed
  if (src) {
    lines.value = src.lines.map((l) => ({ code: l.code, qty: l.qty }))
    titleTotal.value = src.titleTotal != null ? String(src.titleTotal) : ''
  }
})

function confirmAll(ack = false) {
  error.value = ''
  diffHint.value = ''
  const meta = appLedger().updatePatternMeta(
    newRequestId(),
    id.value,
    { name: name.value, sourceNote: note.value, sizeNote: sizeNote.value },
    appLedger().token(),
  )
  if (!meta.ok) {
    error.value = meta.message
    return
  }
  const usable = lines.value.filter((l) => String(l.code).trim() !== '')
  appLedger().saveDraft(id.value, usable, titleTotal.value === '' ? null : titleTotal.value)
  const result = appLedger().confirmUsage(
    newRequestId(),
    id.value,
    {
      lines: usable,
      titleTotal: titleTotal.value === '' ? null : titleTotal.value,
      acknowledgeTitleDiff: ack,
    },
    appLedger().token(),
  )
  if (!result.ok && result.code === 'title-diff') {
    needAck.value = true
    diffHint.value = '标题 ' + result.titleTotal + '，逐色合计 ' + result.perColorSum + '，差 ' + result.difference + '。正式用量将采用逐色合计。'
    return
  }
  if (!result.ok) {
    error.value = result.message
    return
  }
  uni.navigateTo({ url: '/pages/pattern/detail?id=' + id.value })
}

function ackAndSave() {
  confirmAll(true)
}
</script>

<style>
.page { padding: 24rpx 24rpx 80rpx; }
.card { background: #fffefb; border-radius: 24rpx; box-shadow: 0 2rpx 14rpx rgba(74, 62, 40, 0.06); padding: 28rpx 32rpx; margin-top: 24rpx; }
.card:first-child { margin-top: 0; }

.section-title { display: block; font-size: 30rpx; font-weight: 700; margin-bottom: 8rpx; }
.field { margin-top: 16rpx; }
.field-label { display: block; font-size: 24rpx; color: #857c6e; margin-bottom: 8rpx; }
.field-input { height: 84rpx; background: #fff; border: 1rpx solid #e0d7c4; border-radius: 14rpx; padding: 0 24rpx; font-size: 28rpx; }
.ph { color: #b7ac9a; }

.line { display: flex; align-items: center; gap: 16rpx; margin-top: 16rpx; }
.code-input { width: 180rpx; height: 84rpx; background: #fff; border: 1rpx solid #e0d7c4; border-radius: 14rpx; padding: 0 24rpx; font-size: 30rpx; font-weight: 700; }
.qty-input { flex: 1; height: 84rpx; background: #fff; border: 1rpx solid #e0d7c4; border-radius: 14rpx; padding: 0 24rpx; font-size: 30rpx; font-variant-numeric: tabular-nums; }
.del { font-size: 26rpx; color: #b65b38; padding: 16rpx 8rpx; flex-shrink: 0; }

.add { margin-top: 20rpx; border: 2rpx dashed #c4b694; border-radius: 14rpx; padding: 20rpx 0; display: flex; justify-content: center; }
.add-text { color: #566c4d; font-size: 26rpx; font-weight: 600; }

.hint { display: block; margin-top: 24rpx; font-size: 24rpx; color: #857c6e; }

.diff-card { background: #f9eae0; }
.diff-text { display: block; font-size: 26rpx; color: #8a4b2f; line-height: 1.6; }

.btn { margin: 24rpx 0 0; font-size: 30rpx; border-radius: 999rpx; height: 96rpx; line-height: 96rpx; }
.btn::after { border: none; }
.primary { background: #6b8260; color: #fff; font-weight: 600; }
.warn { background: #b65b38; color: #fff; font-weight: 600; }

.err { display: block; margin-top: 24rpx; color: #b65b38; font-size: 26rpx; }
</style>

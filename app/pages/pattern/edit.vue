<template>
  <view class="page">
    <input :value="name" placeholder="图纸名称" @input="e => name = e.detail.value" />
    <input :value="note" placeholder="来源备注（可选）" @input="e => note = e.detail.value" />
    <input :value="sizeNote" placeholder="制作尺寸（没有则留空，显示未提供）" @input="e => sizeNote = e.detail.value" />
    <input :value="titleTotal" placeholder="标题总数（可选核对）" @input="e => titleTotal = e.detail.value" />
    <view v-for="(line, i) in lines" :key="i" class="line">
      <input :value="line.code" placeholder="色号" @input="e => line.code = e.detail.value" />
      <input type="number" :value="String(line.qty)" placeholder="颗数" @input="e => line.qty = e.detail.value" />
      <text @click="lines.splice(i, 1)">删除</text>
    </view>
    <button size="mini" @click="lines.push({ code: '', qty: '' })">增加色号</button>
    <button type="primary" @click="confirmAll">确认全部用量</button>
    <text class="hint">确认不会扣库存。未确认的编辑不会替换已确认版本。</text>
    <text v-if="diffHint" class="warn">{{ diffHint }}</text>
    <button v-if="needAck" @click="ackAndSave">已知差异，仍用逐色合计</button>
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
.page { padding: 16px; }
input { background: #fffcf7; margin-bottom: 8px; padding: 8px; }
.line { display: flex; gap: 8px; }
.hint, .warn, .err { display: block; margin-top: 8px; }
.warn, .err { color: #8a4b2f; }
</style>

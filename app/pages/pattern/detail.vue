<template>
  <view class="page" v-if="detail">
    <text class="name">{{ detail.pattern.name }}</text>
    <text class="muted">{{ detail.pattern.sourceNote || '无来源备注' }} · 尺寸 {{ detail.pattern.sizeNote?.trim() ? detail.pattern.sizeNote : '未提供' }} · 像素 {{ detail.pattern.pixelWidth }}×{{ detail.pattern.pixelHeight }}</text>
    <text v-if="detail.draft" class="warn">有未确认编辑；已拼使用已确认版本 {{ detail.pattern.confirmedVersion }}</text>
    <image class="thumb" :src="'data:' + detail.pattern.thumbnail.mime + ';base64,' + detail.pattern.thumbnail.base64" mode="aspectFit" />
    <text v-if="gap">总需求 {{ gap.totalDemand }} · 用色 {{ gap.colorCount }} · {{ gap.canMake ? '足量可拼' : '有缺口' }}</text>
    <view v-for="line in gap ? gap.lines : []" :key="line.code" class="row">
      <text>{{ line.code }} 需 {{ line.demand }} / 有 {{ line.have }}</text>
      <text v-if="line.gap > 0" class="warn">缺 {{ line.gap }}</text>
      <text v-else>预计余 {{ line.remaining }}</text>
    </view>
    <button @click="doMake('make')">已拼</button>
    <button v-if="makes.length" @click="doMake('remake')">再拼一次</button>
    <button size="mini" @click="copyList">复制并保存补货清单</button>
    <button size="mini" @click="goShare">分享图片</button>
    <button size="mini" @click="goEdit">编辑用量</button>
    <view v-for="m in makes" :key="m.id" class="card">
      <text>{{ m.voided ? '已撤回' : '完成' }} · {{ m.completedAt }}</text>
      <text>{{ m.linesSnapshot.map(l => l.code + '=' + l.qty).join(' ') || '零用量' }}</text>
      <button v-if="!m.voided" size="mini" @click="voidMake(m.id)">撤回这次</button>
    </view>
    <text v-if="error" class="err">{{ error }}</text>
  </view>
</template>

<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { appLedger, newRequestId } from '../../src/platform/app-ledger'
import { clearRequestAfterVoid, emptyMakeRequestState, markMakeSuccess, resolveMakeRequestId, type MakeAction } from '../../src/platform/make-request'

const id = ref('')
const detail = ref(appLedger().getPattern(''))
const gap = ref<{ ok: true; totalDemand: number; colorCount: number; canMake: boolean; lines: { code: string; demand: number; have: number; gap: number; remaining: number }[] } | null>(null)
const makes = ref(appLedger().listMakes())
const error = ref('')
let makeState = emptyMakeRequestState()

function reload() {
  detail.value = appLedger().getPattern(id.value)
  const g = appLedger().previewGap(id.value)
  gap.value = g.ok ? g : null
  makes.value = appLedger().listMakes(id.value)
}

onLoad((q: { id?: string }) => {
  id.value = q.id || ''
  makeState = emptyMakeRequestState()
  reload()
})
onShow(reload)

function doMake(action: MakeAction) {
  error.value = ''
  const resolved = resolveMakeRequestId(makeState, action, newRequestId)
  makeState = resolved.state
  const result = appLedger().make(resolved.requestId, id.value, appLedger().token())
  if (!result.ok) {
    error.value = result.message
    return
  }
  makeState = markMakeSuccess(makeState, action)
  uni.showToast({ title: '已记入制作', icon: 'none' })
  reload()
}

function voidMake(makeId: string) {
  const rec = makes.value.find((m) => m.id === makeId)
  const result = appLedger().voidMake(newRequestId(), makeId, appLedger().token())
  if (!result.ok) {
    error.value = result.message
    return
  }
  makeState = clearRequestAfterVoid(makeState, rec?.requestId)
  reload()
}

function copyList() {
  const list = appLedger().exportRestockList(id.value)
  if (!list.ok) {
    error.value = list.message
    return
  }
  uni.setClipboardData({ data: list.text })
  uni.getFileSystemManager().writeFile({
    filePath: '_doc/pindou-restock.csv',
    data: list.csv,
    encoding: 'utf8',
    fail: () => {
      error.value = '清单已复制。保存文件失败，图纸和库存未改。'
    },
  })
}

function goShare() {
  uni.navigateTo({ url: '/pages/pattern/share?id=' + id.value })
}
function goEdit() {
  uni.navigateTo({ url: '/pages/pattern/edit?id=' + id.value })
}
</script>

<style>
.page { padding: 16px; }
.name { font-size: 20px; font-weight: 600; display: block; }
.muted { color: #6b6258; display: block; margin-bottom: 8px; }
.thumb { width: 100%; height: 180px; background: #eee; }
.row, .card { background: #fffcf7; padding: 10px; margin-top: 8px; }
.warn, .err { color: #8a4b2f; display: block; }
</style>

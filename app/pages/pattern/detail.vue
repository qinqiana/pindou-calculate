<template>
  <view class="page" v-if="detail">
    <view class="card head">
      <image class="thumb" :src="'data:' + detail.pattern.thumbnail.mime + ';base64,' + detail.pattern.thumbnail.base64" mode="aspectFit" />
      <text class="name">{{ detail.pattern.name }}</text>
      <text class="muted">{{ detail.pattern.sourceNote || '无来源备注' }} · 尺寸 {{ detail.pattern.sizeNote?.trim() ? detail.pattern.sizeNote : '未提供' }} · 像素 {{ detail.pattern.pixelWidth }}×{{ detail.pattern.pixelHeight }}</text>
      <view v-if="detail.draft" class="draft-note">
        <text class="draft-text">有未确认编辑；已拼使用已确认版本 {{ detail.pattern.confirmedVersion }}</text>
      </view>
    </view>

    <view v-if="gap" class="card stats">
      <view class="stat">
        <text class="stat-num">{{ gap.totalDemand }}</text>
        <text class="stat-label">总需求（颗）</text>
      </view>
      <view class="stat-divider" />
      <view class="stat">
        <text class="stat-num">{{ gap.colorCount }}</text>
        <text class="stat-label">用色（种）</text>
      </view>
      <view class="stat-divider" />
      <view class="stat">
        <text class="stat-num" :class="{ clay: !gap.canMake }">{{ gap.canMake ? '足量' : '有缺口' }}</text>
        <text class="stat-label">库存状态</text>
      </view>
    </view>

    <view v-if="gap && gap.lines.length" class="card">
      <text class="section-title">逐色对照</text>
      <view v-for="line in gap.lines" :key="line.code" class="gap-line">
        <view class="swatch" :style="{ background: hex(line.code) }" />
        <text class="gap-code">{{ line.code }}</text>
        <text class="gap-have">需 {{ line.demand }} · 有 {{ line.have }}</text>
        <text v-if="line.gap > 0" class="gap-badge short">缺 {{ line.gap }}</text>
        <text v-else class="gap-badge left">余 {{ line.remaining }}</text>
      </view>
    </view>

    <view class="actions">
      <button class="btn primary big" @click="doMake('make')">已拼</button>
      <button v-if="makes.length" class="btn outline big" @click="doMake('remake')">再拼一次</button>
    </view>
    <view class="tools">
      <button class="btn ghost" @click="copyList">补货清单</button>
      <button class="btn ghost" @click="goShare">分享图片</button>
      <button class="btn ghost" @click="goEdit">编辑用量</button>
    </view>

    <view v-if="makes.length" class="card">
      <text class="section-title">制作记录</text>
      <view v-for="m in makes" :key="m.id" class="make">
        <view class="make-head">
          <text class="make-status" :class="{ voided: m.voided }">{{ m.voided ? '已撤回' : '完成' }}</text>
          <text class="muted">{{ m.completedAt }}</text>
        </view>
        <text class="make-lines">{{ m.linesSnapshot.map(l => l.code + '=' + l.qty).join(' ') || '零用量' }}</text>
        <button v-if="!m.voided" class="btn ghost small" @click="voidMake(m.id)">撤回这次</button>
      </view>
    </view>

    <text v-if="error" class="err">{{ error }}</text>
  </view>
</template>

<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { colorByCode } from '../../src/ledger/catalog'
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

function hex(code: string) {
  return colorByCode(code)?.hex || '#ccc'
}

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
.page { padding: 24rpx 24rpx 80rpx; }
.card { background: #fffefb; border-radius: 24rpx; box-shadow: 0 2rpx 14rpx rgba(74, 62, 40, 0.06); padding: 28rpx 32rpx; margin-top: 24rpx; }
.card:first-child { margin-top: 0; }

.head { display: flex; flex-direction: column; }
.thumb { width: 100%; height: 400rpx; background: #f0e9da; border-radius: 16rpx; }
.name { margin-top: 20rpx; font-size: 38rpx; font-weight: 700; }
.muted { margin-top: 8rpx; font-size: 24rpx; color: #857c6e; }
.draft-note { margin-top: 16rpx; background: #f9eae0; border-radius: 14rpx; padding: 16rpx 20rpx; }
.draft-text { font-size: 24rpx; color: #8a4b2f; }

.stats { display: flex; align-items: center; padding: 24rpx 0; }
.stat { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4rpx; }
.stat-num { font-size: 40rpx; font-weight: 700; color: #566c4d; font-variant-numeric: tabular-nums; }
.stat-num.clay { color: #b65b38; font-size: 34rpx; }
.stat-label { font-size: 22rpx; color: #857c6e; }
.stat-divider { width: 2rpx; height: 52rpx; background: #eae2d2; }

.section-title { display: block; font-size: 30rpx; font-weight: 700; margin-bottom: 8rpx; }
.gap-line { display: flex; align-items: center; gap: 16rpx; padding: 18rpx 0; border-bottom: 1rpx solid #f0e9da; }
.gap-line:last-child { border-bottom: none; }
.swatch { width: 48rpx; height: 48rpx; border-radius: 12rpx; border: 1rpx solid rgba(0, 0, 0, 0.08); flex-shrink: 0; }
.gap-code { width: 76rpx; font-weight: 700; font-size: 30rpx; }
.gap-have { flex: 1; color: #6e6353; font-size: 26rpx; font-variant-numeric: tabular-nums; }
.gap-badge { font-size: 24rpx; font-weight: 700; border-radius: 999rpx; padding: 6rpx 20rpx; }
.gap-badge.short { color: #b65b38; background: #f9eae0; }
.gap-badge.left { color: #566c4d; background: #edf1e6; }

.actions { margin-top: 28rpx; display: flex; flex-direction: column; gap: 20rpx; }
.tools { display: flex; gap: 16rpx; margin-top: 20rpx; }
.btn { margin: 0; font-size: 30rpx; border-radius: 999rpx; }
.btn::after { border: none; }
.big { height: 104rpx; line-height: 104rpx; font-size: 32rpx; }
.primary { background: #6b8260; color: #fff; font-weight: 700; }
.outline { background: #fffefb; color: #566c4d; border: 2rpx solid #6b8260; font-weight: 600; }
.ghost { flex: 1; background: #fffefb; color: #6e6353; border: 2rpx solid #d8cfbe; height: 84rpx; line-height: 84rpx; font-size: 26rpx; }
.ghost.small { flex: none; margin-top: 12rpx; padding: 0 32rpx; height: 64rpx; line-height: 64rpx; font-size: 24rpx; color: #b65b38; border-color: #e3b9a5; }

.make { padding: 20rpx 0; border-bottom: 1rpx solid #f0e9da; }
.make:last-child { border-bottom: none; }
.make-head { display: flex; align-items: center; justify-content: space-between; }
.make-status { font-size: 24rpx; font-weight: 700; color: #566c4d; background: #edf1e6; border-radius: 999rpx; padding: 4rpx 20rpx; }
.make-status.voided { color: #a89d8c; background: #f0e9da; }
.make-lines { display: block; margin-top: 12rpx; font-size: 26rpx; color: #6e6353; font-variant-numeric: tabular-nums; }

.err { display: block; margin-top: 24rpx; color: #b65b38; font-size: 26rpx; }
</style>

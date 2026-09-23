<template>
  <view class="page">
    <scroll-view class="page-content" scroll-y>
    <view class="content">
    <RecognitionRunner :request="request" @result="receiveRecognition" />
    <view v-if="imagePreview" class="card image-card">
      <image class="original-image" :src="imagePreview" mode="aspectFit" @click="previewOriginal()" />
      <view class="image-actions">
        <button v-if="original" class="small-button" @click="previewOriginal()">放大原图</button>
        <button class="small-button" :disabled="picking" @click="selectOriginal">{{ original ? '重选原图' : '选原图重新识别' }}</button>
      </view>
      <text class="hint">{{ original ? '原图仅用于本次核对；确认后保存缩略图。' : '当前只有缩略图。重新识别需要选择这张图纸的原文件。' }}</text>
    </view>

    <view class="card recognition-card">
      <text class="section-title">{{ busy ? '正在离线识别' : '用量核对' }}</text>
      <text class="hint">{{ recognitionMessage || '选择原图后自动识别，也可以直接手工录入。' }}</text>
      <button v-if="busy" class="small-button" @click="cancelRecognition">取消识别，继续手工</button>
      <view v-else-if="original" class="image-actions"><button class="small-button" @click="startRecognition">重新识别</button><button v-if="adopted || recognitionFailed" class="small-button" @click="startManual">手工录入</button></view>
      <template v-if="candidate && candidate.status !== 'failed' && !candidateAdopted">
        <text class="candidate-total">候选 {{ candidate.lines.length }} 色 · {{ candidate.lines.reduce((n,l) => n + l.qty, 0) }} 颗</text>
        <text class="hint">采用后会替换当前逐色输入和标题总数；库存不会变化。</text>
        <text v-for="line in candidateDifferences" :key="line" class="difference-line">{{ line }}</text>
        <button class="btn primary" @click="adoptCandidate">采用这份候选</button>
      </template>
      <text v-if="adopted" class="source">来源：{{ usageSourceLabel(adopted.source) }}{{ editedAutomatic ? ' · 已人工修改' : '' }}</text>
      <view v-if="displayRisks.length" class="risks">
        <text class="section-title">需要核对 {{ displayRisks.length }} 处</text>
        <view v-for="risk in displayRisks" :key="risk.id" class="risk-row">
          <text>{{ risk.reason }}</text>
          <text v-if="risk.raw" class="raw">原始内容：{{ risk.raw }}</text>
          <view class="image-actions">
            <button v-if="original" class="small-button" @click="previewOriginal(risk.id)">{{ riskRegion(risk.id) ? '查看原图位置' : '查看整张原图' }}</button>
            <button v-if="adopted && risk.id !== 'coverage'" class="small-button" @click="toggleResolved(risk.id)">{{ risk.resolved ? '已核对并修正 · 撤销' : '我已核对并修正此处' }}</button>
          </view>
        </view>
      </view>
      <button v-if="adopted && requiresRiskAck" class="risk-ack" :class="{ checked: riskAck }" @click="riskAck = !riskAck">{{ riskAck ? '✓ ' : '○ ' }}已查看疑点，知晓仍可能漏计，按当前用量继续</button>
      <button v-if="adopted && !original" class="small-button" @click="startManual">独立手工录入</button>
    </view>

    <view class="card">
      <text class="section-title">逐色用量</text>
      <view v-for="(line, i) in lines" :key="line.key" class="line-wrap">
        <view class="line">
          <input class="code-input" :value="line.code" placeholder="色号" aria-label="色号" @input="e => editLine(i, 'code', e.detail.value)" />
          <input class="qty-input" type="number" :value="String(line.qty)" placeholder="颗数" aria-label="用量颗数" @input="e => editLine(i, 'qty', e.detail.value)" />
          <button class="delete" @click="removeLine(i)">删除</button>
        </view>
        <text v-if="lineError(line)" class="field-error">{{ lineError(line) }}</text>
        <button v-if="original && line.proof?.region" class="small-button line-proof" @click="previewRegion(line.proof.region)">图例原文：{{ line.proof.raw }} · 查看位置</button>
      </view>
      <button class="add" @click="addLine">＋ 增加色号</button>
      <view class="field">
        <text class="field-label">标题总数（可选核对）</text>
        <input class="field-input" type="number" :value="titleTotal" placeholder="图纸上印的总颗数" @input="e => { titleTotal = e.detail.value; touchEdit() }" />
      </view>
      <text class="hint">当前逐色合计 {{ validSum }} 颗</text>
    </view>

    <view class="card">
      <text class="section-title">图纸信息</text>
      <view class="field"><text class="field-label">图纸名称</text><input class="field-input" v-model="name" /></view>
      <view class="field"><text class="field-label">来源备注（可选）</text><input class="field-input" v-model="note" placeholder="图纸作者或来源" /></view>
      <view class="field"><text class="field-label">制作尺寸（可选）</text><input class="field-input" v-model="sizeNote" placeholder="未提供" /></view>
    </view>
    </view>
    </scroll-view>
    <view class="dock">
      <text v-if="error" class="err">{{ error }}</text>
      <text class="hint">确认不会扣库存。只有记录「已拼」才扣减。</text>
      <view v-if="needAck" class="diff-card"><text>{{ diffHint }}</text></view>
      <button class="btn" :class="needAck ? 'warn' : 'primary'" :disabled="saving || busy || picking" @click="confirmAll(needAck)">{{ needAck ? '已知差异，仍用逐色合计' : '确认全部用量' }}</button>
    </view>

    <view v-if="zooming && original" class="image-zoom">
      <text class="zoom-caption">{{ focusRegion ? '标记处为识别证据，可缩放拖动核对。' : '可双指缩放、拖动查看整张原图。' }}</text>
      <movable-area class="zoom-area">
        <movable-view class="zoom-content" direction="all" :scale="true" :scale-min="1" :scale-max="8" :scale-value="zoomScale" :x="zoomX" :y="zoomY" :style="{height: zoomImageHeight + 'px'}">
          <image class="zoom-picture" :src="original.preview" mode="scaleToFill" :style="{height: zoomImageHeight + 'px'}" />
          <view v-if="focusRegion && imageWidth && imageHeight" class="region-marker" :style="{left: 100 * focusRegion[0] / imageWidth + '%',top: 100 * focusRegion[1] / imageHeight + '%',width: 100 * focusRegion[2] / imageWidth + '%',height: 100 * focusRegion[3] / imageHeight + '%'}" />
        </movable-view>
      </movable-area>
      <button class="btn close-zoom" @click="zooming = false">返回用量核对</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onBackPress, onHide, onLoad, onReady, onShow, onUnload } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import RecognitionRunner from '../../components/RecognitionRunner.vue'
import { appLedger, newRequestId } from '../../src/platform/app-ledger'
import { prepareOriginal, takeOriginal, type OriginalImage } from '../../src/platform/image'
import { pickImageFile } from '../../src/platform/fs'
import { sniffImage } from '../../src/ledger/image'
import { normalizeColorCode } from '../../src/ledger/catalog'
import { parseNonNegativeInt, qtyMessage } from '../../src/ledger/numbers'
import type { RecognitionProvenance } from '../../src/ledger/types'
import { hasRecognitionRisk, readRecognition, recognitionProvenance, sameRecognition, usageSourceLabel, type RecognitionIdentity, type RecognitionResult, type Region } from '../../src/recognition/result'

const id = ref(''), name = ref(''), note = ref(''), sizeNote = ref(''), titleTotal = ref('')
let nextLine = 0
const makeLine = (code = '', qty: string | number = '', proof: RecognitionResult['evidence'][number] | null = null) => ({ key: ++nextLine, code, qty, proof })
const lines = ref([makeLine()])
const error = ref(''), diffHint = ref(''), needAck = ref(false), saving = ref(false), picking = ref(false)
const original = ref<OriginalImage | null>(null), imagePreview = ref(''), zooming = ref(false)
const request = ref<{ identity: RecognitionIdentity; image: string } | null>(null)
const busy = ref(false), recognitionMessage = ref(''), candidate = ref<RecognitionResult | null>(null), candidateAdopted = ref(false)
const recognitionFailed = ref(false)
const adoptedEvidence = ref<RecognitionResult | null>(null)
const adopted = ref<RecognitionProvenance | null>(null), riskAck = ref(false), editedAutomatic = ref(false)
const focusRegion = ref<Region | null>(null), imageWidth = ref(0), imageHeight = ref(0)
const zoomScale = ref(1), zoomX = ref(0), zoomY = ref(0)
const screenWidth = uni.getSystemInfoSync().windowWidth
const zoomImageHeight = computed(() => imageWidth.value ? screenWidth * imageHeight.value / imageWidth.value : screenWidth)
const validSum = computed(() => lines.value.reduce((sum, line) => { const qty = parseNonNegativeInt(line.qty); return sum + (qty.ok ? qty.value : 0) }, 0))
const requiresRiskAck = computed(() => hasRecognitionRisk(adopted.value))
const displayRisks = computed(() => adopted.value?.risks ?? candidate.value?.risks ?? [])
const candidateDifferences = computed(() => {
  if (!candidate.value) return []
  const current = new Map(lines.value.filter(l => l.code.trim()).map(l => [normalizeColorCode(l.code) ?? l.code.trim(), String(l.qty)]))
  const next = new Map(candidate.value.lines.map(l => [l.code, String(l.qty)]))
  const differences = [...new Set([...current.keys(), ...next.keys()])].filter(c => current.get(c) !== next.get(c)).map(c => c + '：' + (current.get(c) ?? '未填') + ' → ' + (next.get(c) ?? '移除'))
  differences.push('标题总数：' + (titleTotal.value || '未填') + ' → ' + (candidate.value.titleTotal ?? '未提供'))
  return differences
})
let recognitionTimer: ReturnType<typeof setTimeout> | undefined
let epoch = 0, imageSession = 0, revision = 0, confirmedVersion: number | null = null, active = true, selection = 0
let imageChanged = false

function identity(requestId: string): RecognitionIdentity { return { requestId, imageSession, patternId: id.value, revision, confirmedVersion: appLedger().getPattern(id.value)?.pattern.confirmedVersion ?? null, epoch: appLedger().token().epoch } }
function stopRecognition() { clearTimeout(recognitionTimer); request.value = null; busy.value = false }
function cancelRecognition() { stopRecognition(); recognitionMessage.value = '已取消识别，当前输入保留。可以重试或手工录入。' }
function touchEdit() {
  revision++; riskAck.value = false; needAck.value = false
  if (adopted.value) editedAutomatic.value = true
  if (busy.value) { stopRecognition(); recognitionMessage.value = '已保留你的编辑并停止旧识别，可重新识别后选择是否采用。' }
}
function editLine(i: number, key: 'code' | 'qty', value: string) { lines.value[i][key] = value; touchEdit() }
function addLine() { lines.value.push(makeLine()); touchEdit() }
function removeLine(i: number) { lines.value.splice(i, 1); touchEdit() }
function lineError(line: {code: string; qty: string | number}) {
  if (!line.code.trim() && line.qty === '') return ''
  if (!normalizeColorCode(line.code)) return '请输入 MARD 221 内的有效色号'
  const q = parseNonNegativeInt(line.qty)
  return q.ok ? '' : qtyMessage(q.reason)
}
function installOriginal(value: OriginalImage) {
  original.value = value; imagePreview.value = value.preview; imageSession++; adoptedEvidence.value = null
  lines.value.forEach(line => { line.proof = null })
  const info = sniffImage(value.bytes)
  if (info.ok) { const rotated = (info.image.orientation ?? 1) >= 5; imageWidth.value = rotated ? info.image.height : info.image.width; imageHeight.value = rotated ? info.image.width : info.image.height }
}
function startRecognition() {
  stopRecognition(); candidate.value = null; candidateAdopted.value = false
  if (!active || !original.value || epoch !== appLedger().token().epoch) return
  recognitionFailed.value = false
  recognitionMessage.value = '正在准备手机离线识别…'; busy.value = true
  request.value = { identity: identity(newRequestId()), image: original.value.preview }
  recognitionTimer = setTimeout(() => { recognitionFailed.value = true; stopRecognition(); recognitionMessage.value = '识别超过 30 秒，已停止。可以重试、换清晰原图或手工录入。' }, 30000)
}
function receiveRecognition(event: any) {
  if (!active || !request.value || !sameRecognition(event.identity, request.value.identity) || !sameRecognition(event.identity, identity(event.identity.requestId))) return
  if (event.stage === 'result') {
    try {
      const result = readRecognition(event.result)
      candidate.value = result
      recognitionFailed.value = result.status === 'failed'
      recognitionMessage.value = result.status === 'failed' ? '没有取得可采用的用量。可换清晰原图或独立手工录入；不会生成零用量。' : result.status === 'partial' ? '已取得部分候选，请核对疑点和可能漏计的区域。' : '已取得候选，请结合原图核对后确认。'
      if (result.status !== 'failed' && lines.value.every(l => !l.code.trim() && l.qty === '') && !titleTotal.value && !adopted.value) adoptCandidate()
    } catch (e) { recognitionFailed.value = true; error.value = (e instanceof Error ? e.message : '识别结果无效') + '，当前输入已保留，可重试或手工录入。' }
    stopRecognition()
  } else if (['error', 'timeout'].includes(event.stage)) { recognitionFailed.value = true; recognitionMessage.value = event.message; stopRecognition() }
  else recognitionMessage.value = event.message
}
function adoptCandidate() {
  const result = candidate.value
  if (!result || result.status === 'failed' || epoch !== appLedger().token().epoch) return
  lines.value = result.lines.map(l => makeLine(l.code, l.qty, result.evidence.find(e => e.codes.includes(l.code)) ?? null)); titleTotal.value = result.titleTotal === null ? '' : String(result.titleTotal)
  adopted.value = recognitionProvenance(result); adoptedEvidence.value = result; candidateAdopted.value = true; editedAutomatic.value = false
  revision++; riskAck.value = false; needAck.value = false; error.value = ''; stopRecognition()
}
function toggleResolved(id: string) {
  const risk = adopted.value?.risks.find(r => r.id === id)
  if (risk) { risk.resolved = !risk.resolved; riskAck.value = false; revision++ }
}
function startManual() {
  uni.showModal({ title: '独立手工录入', content: '将清空当前逐色输入与标题总数，保留图纸信息。已保存的确认版本不受影响。', success: ({confirm}) => {
    if (!confirm) return
    stopRecognition(); recognitionFailed.value = false; adopted.value = null; candidate.value = null; lines.value = [makeLine()]; titleTotal.value = ''; touchEdit(); recognitionMessage.value = '独立手工录入，尚未确认。'
  } })
}
function riskRegion(id: string) { return (adopted.value ? adoptedEvidence.value : candidate.value)?.risks.find(r => r.id === id)?.region ?? null }
function previewOriginal(riskId?: string) {
  previewRegion(riskId ? riskRegion(riskId) : null)
}
function previewRegion(region: Region | null) {
  if (!original.value) return
  focusRegion.value = region
  zoomScale.value = 1; zoomX.value = 0; zoomY.value = focusRegion.value ? -Math.max(0, screenWidth * focusRegion.value[1] / imageWidth.value - 100) : 0
  zooming.value = true
}
async function selectOriginal() {
  if (picking.value) return
  stopRecognition(); const ticket = ++selection; picking.value = true; error.value = ''
  try {
    const picked = await pickImageFile()
    if (!active || ticket !== selection || epoch !== appLedger().token().epoch) return
    if (!picked.ok) { error.value = picked.message; return }
    const prepared = prepareOriginal(picked.value.bytes)
    if (!prepared.ok) { error.value = prepared.message; return }
    installOriginal(prepared.original); imageChanged = true; touchEdit(); startRecognition()
  } finally { picking.value = false }
}
function releaseSession() { active = false; selection++; stopRecognition(); original.value = null; imagePreview.value = ''; zooming.value = false }
onLoad((q: {id?: string}) => {
  id.value = q.id || ''; epoch = appLedger().token().epoch
  const found = appLedger().getPattern(id.value)
  if (!found) { error.value = '找不到图纸'; return }
  confirmedVersion = found.pattern.confirmedVersion
  name.value = found.pattern.name; note.value = found.pattern.sourceNote; sizeNote.value = found.pattern.sizeNote || ''
  imagePreview.value = 'data:' + found.pattern.thumbnail.mime + ';base64,' + found.pattern.thumbnail.base64
  const src = found.draft || found.confirmed
  if (src) { lines.value = src.lines.map(l => makeLine(l.code, l.qty)); titleTotal.value = src.titleTotal === null ? '' : String(src.titleTotal) }
  // A confirmed automatic source remains automatic when its quantities are edited.
  if (!found.draft && found.confirmed?.recognition) { adopted.value = JSON.parse(JSON.stringify(found.confirmed.recognition)); editedAutomatic.value = adopted.value!.modified }
  const selected = takeOriginal(id.value, epoch)
  if (selected) installOriginal(selected)
})
onReady(() => { if (original.value) startRecognition() })
onHide(() => { if (!picking.value) { if (busy.value) cancelRecognition(); active = false } })
onShow(() => {
  active = true
  if (epoch && (epoch !== appLedger().token().epoch || confirmedVersion !== (appLedger().getPattern(id.value)?.pattern.confirmedVersion ?? null))) {
    releaseSession(); error.value = '账本或确认版本已变化，请返回列表重新打开图纸。'
  }
})
onUnload(releaseSession)
onBackPress(() => { if (!zooming.value) return false; zooming.value = false; return true })

function confirmAll(ack = false) {
  if (saving.value || busy.value || picking.value) return
  if (!active || epoch !== appLedger().token().epoch || confirmedVersion !== (appLedger().getPattern(id.value)?.pattern.confirmedVersion ?? null)) { error.value = '账本或确认版本已变化，请重新打开图纸。'; return }
  if (requiresRiskAck.value && !riskAck.value) { error.value = '请先查看疑点并确认可能漏计的风险。'; return }
  if (!name.value.trim()) { error.value = '图纸名称不能为空'; return }
  error.value = ''; diffHint.value = ''; saving.value = true
  try {
    const inputLines = lines.value.filter(l => !(l.code.trim() === '' && l.qty === ''))
    if (inputLines.some(l => lineError(l))) { error.value = '请修正标记的色号或数量，其他输入已保留。'; return }
    if (!inputLines.length && recognitionFailed.value) { error.value = '失败结果不能确认为零用量。请手工填写，或先选择独立手工录入。'; return }
    const recognition = adopted.value ? { ...adopted.value, riskAcknowledged: riskAck.value } : null
    const patternMeta: { name: string; sourceNote: string; sizeNote: string; imageBytes?: Uint8Array } = { name: name.value, sourceNote: note.value, sizeNote: sizeNote.value }
    if (imageChanged && original.value) patternMeta.imageBytes = original.value.bytes
    const result = appLedger().confirmUsage(newRequestId(), id.value, { lines: inputLines.map(({ code, qty }) => ({ code, qty })), titleTotal: titleTotal.value, acknowledgeTitleDiff: ack, recognition, patternMeta }, appLedger().token())
    if (!result.ok && result.code === 'title-diff') { needAck.value = true; diffHint.value = '标题 ' + result.titleTotal + '，逐色合计 ' + result.perColorSum + '，差 ' + result.difference + '。正式用量采用逐色合计。'; return }
    if (!result.ok) { error.value = result.message; return }
    confirmedVersion = result.version
    releaseSession(); uni.redirectTo({ url: '/pages/pattern/detail?id=' + id.value })
  } finally { saving.value = false }
}
</script>

<style>
page { background: #f2f2f7; color: #202124; }
.page { height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
.page-content { flex: 1; height: 0; min-height: 0; }
.content { padding: 24rpx; }
.card { background: white; border-radius: 24rpx; padding: 28rpx; margin-bottom: 24rpx; }
.image-card { padding: 16rpx 24rpx 24rpx; }
.original-image { width: 100%; height: 260rpx; background: #fff; }
.section-title { display: block; font-size: 32rpx; font-weight: 600; margin-bottom: 16rpx; }
.hint,.source { display: block; font-size: 25rpx; line-height: 1.6; color: #63636c; margin-top: 12rpx; }
.source { color: #0066cc; }
.image-actions { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 12rpx; }
.small-button { font-size: 25rpx; line-height: 1.5; min-height: 80rpx; padding: 20rpx; background: #eef4fc; color: #0066cc; border-radius: 16rpx; margin: 8rpx 0; }
button::after { border: none; }
.candidate-total { display: block; font-weight: 600; margin-top: 24rpx; }
.difference-line { display: block; font-size: 26rpx; margin-top: 8rpx; }
.risks { margin-top: 24rpx; }
.risk-row { border-top: 1rpx solid #e6e6eb; padding: 20rpx 0; font-size: 26rpx; line-height: 1.6; }
.raw { display: block; color: #63636c; }
.risk-ack { text-align: left; background: #fff3de; color: #734400; font-size: 26rpx; line-height: 1.6; padding: 20rpx; border-radius: 16rpx; margin-top: 20rpx; }
.risk-ack.checked { background: #e4f2e9; color: #245d35; }
.line { display: flex; align-items: center; gap: 12rpx; margin-top: 16rpx; }
.code-input,.qty-input,.field-input { height: 88rpx; border: 1rpx solid #d7d7df; border-radius: 14rpx; padding: 0 20rpx; font-size: 30rpx; }
.code-input { width: 160rpx; }
.qty-input { flex: 1; min-width: 80rpx; }
.delete { color: #b23030; font-size: 26rpx; background: transparent; padding: 8rpx; margin: 0; }
.field-error,.err { display: block; color: #b23030; font-size: 25rpx; margin-top: 12rpx; }
.line-proof { text-align: left; width: 100%; margin-bottom: 0; }
.add { background: #eef4fc; color: #0066cc; font-size: 28rpx; margin-top: 24rpx; border-radius: 16rpx; }
.field { margin-top: 24rpx; }
.field-label { display: block; color: #63636c; font-size: 26rpx; margin-bottom: 10rpx; }
.dock { flex-shrink: 0; z-index: 5; padding: 16rpx 24rpx calc(16rpx + env(safe-area-inset-bottom)); background: #fff; box-shadow: 0 -4rpx 20rpx rgba(0, 0, 0, 0.06); }
.dock .btn { margin-top: 12rpx; }
.dock .hint { margin-top: 0; }
.btn { font-size: 30rpx; border-radius: 18rpx; min-height: 96rpx; line-height: 1.5; padding: 25rpx 18rpx; margin-top: 24rpx; }
.primary,.close-zoom { background: #0066cc; color: white; font-weight: 600; }
.primary[disabled] { background: #b7c8de; color: #fff; }
.warn { background: #925400; color: white; }
.diff-card { background: #fff3de; margin-top: 12rpx; padding: 12rpx; border-radius: 12rpx; font-size: 26rpx; line-height: 1.5; }
.image-zoom { position: fixed; inset: 0; z-index: 20; background: #fff; padding-top: var(--status-bar-height); }
.zoom-caption { display: block; padding: 20rpx; font-size: 25rpx; color: #63636c; }
.zoom-area { width: 100%; height: calc(100% - 260rpx); overflow: hidden; }
.zoom-content { width: 100%; position: relative; }
.zoom-picture { width: 100%; display: block; }
.region-marker { position: absolute; box-sizing: border-box; border: 3px solid #e64c00; background: rgba(255,160,0,.08); pointer-events: none; }
.close-zoom { margin: 16rpx 24rpx; }
</style>

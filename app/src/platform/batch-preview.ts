/**
 * 批量录入的「预览 ↔ 保存」绑定：
 * 预览时对已选输入做快照；数量、选中项或精度标记任何变化都会使旧预览失效；
 * 保存只允许提交与本次有效预览一致的快照内容。账本 token 只证明账本没变，
 * 不能证明表单没被改，因此输入快照独立于 token 校验。
 */
export type BatchInputItem = { code: string; qty: string | number; estimated: boolean }

export type PreviewBinding<TToken> = {
  snapshot: string
  items: BatchInputItem[]
  token: TToken
}

/** 规范化已选输入：色号排序 + 数量去空白，保证「同一份输入」得到同一快照。 */
export function canonicalBatchItems(items: BatchInputItem[]): string {
  const norm = items
    .map((i) => [i.code, String(i.qty).trim(), i.estimated ? '1' : '0'] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return JSON.stringify(norm)
}

export function bindPreview<TToken>(items: BatchInputItem[], token: TToken): PreviewBinding<TToken> {
  const copied = items.map((i) => ({ code: i.code, qty: i.qty, estimated: i.estimated }))
  return { snapshot: canonicalBatchItems(copied), items: copied, token }
}

/** 当前表单已选输入是否仍与预览快照一致。 */
export function previewStillValid<TToken>(binding: PreviewBinding<TToken>, currentSelected: BatchInputItem[]): boolean {
  return canonicalBatchItems(currentSelected) === binding.snapshot
}

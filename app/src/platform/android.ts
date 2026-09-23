export type FileOutcome<T> = { ok: true; value: T } | { ok: false; cancelled?: boolean; message: string }

type Android = { call(action: string, payload: string): string; pick(id: string, kind: string): void }
export function androidPlatform(): Android | undefined {
  return (globalThis as { PindouAndroid?: Android }).PindouAndroid
}

export function androidCall<T>(action: string, args: object = {}): FileOutcome<T> {
  try {
    const platform = androidPlatform()
    if (!platform) throw new Error('手机接口不可用，请通过豆计 Android 应用打开')
    const result = JSON.parse(platform.call(action, JSON.stringify(args)))
    if (result?.ok === true && Object.hasOwn(result, 'value')) return result
    return { ok: false, message: typeof result?.message === 'string' ? result.message : '手机操作未确认成功' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '手机操作失败，请重试' }
  }
}

export function androidPick<T>(kind: 'image' | 'text'): Promise<FileOutcome<T>> {
  const platform = androidPlatform()
  if (!platform) return Promise.resolve({ ok: false, message: '手机文件选择器不可用，请通过豆计 Android 应用打开' })
  return new Promise(resolve => {
    const id = crypto.randomUUID()
    const receive = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail?.id !== id) return
      globalThis.removeEventListener('pindou-document', receive)
      resolve(detail.result)
    }
    globalThis.addEventListener('pindou-document', receive)
    try { platform.pick(id, kind) }
    catch {
      globalThis.removeEventListener('pindou-document', receive)
      resolve({ ok: false, message: '无法打开系统文件选择器，已有输入保留' })
    }
  })
}

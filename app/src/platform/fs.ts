/**
 * Android 文件能力适配层（普通 uni-app + HTML5+）：
 * - 普通 uni-app 的 uni.getFileSystemManager 仅支持 HarmonyOS，uni.chooseFile
 *   不支持 App，因此这里集中用 plus.io / plus.gallery / Native.js 实现
 *   选文件、读文件、写文件/入相册，页面一律只调本模块。
 * - 回调型原生 API 全部 Promise 化；任何失败都返回 ok:false 并给出用户可读
 *   信息，不静默吞错。
 * - 真机行为（系统选择器、作用域存储、相册可见性）以 Android 验收为准。
 */
import { base64ToBytes } from '../ledger/image.ts'
import { MAX_IMAGE_BYTES } from '../ledger/numbers.ts'

export type FileOutcome<T> = { ok: true; value: T } | { ok: false; cancelled?: boolean; message: string }

function fail<T>(message: string, cancelled = false): FileOutcome<T> {
  return { ok: false, message, ...(cancelled ? { cancelled: true } : {}) }
}

function platformMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const value = (err as { errMsg?: unknown; message?: unknown }).errMsg ?? (err as { message?: unknown }).message
    if (value) return String(value)
  }
  return String(err ?? '')
}

function pickerFailure<T>(err: unknown, message: string): FileOutcome<T> {
  const detail = platformMessage(err)
  if (/cancel|cancelled|canceled|取消|用户返回|user.?back/i.test(detail)) return fail(message + '，已取消。', true)
  return fail(detail ? message + '：' + detail : message)
}

type UniGlobal = {
  chooseImage?: (opts: {
    count: number
    sizeType?: string[]
    success?: (res: { tempFilePaths?: string[]; tempFiles?: { path?: string }[] }) => void
    fail?: (err?: unknown) => void
  }) => void
  chooseFile?: (opts: {
    count: number
    extension?: string[]
    success?: (res: { tempFiles?: { path: string }[]; tempFilePaths?: string[] }) => void
    fail?: (err?: unknown) => void
  }) => void
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type PlusAny = any

function uniGlobal(): UniGlobal | null {
  return (globalThis as { uni?: UniGlobal }).uni ?? null
}

function plusGlobal(): PlusAny {
  return (globalThis as { plus?: PlusAny }).plus ?? null
}

/** Android 直接读取系统文档原始字节，不经相册压缩/转换。 */
export async function pickImageFile(): Promise<FileOutcome<{ bytes: Uint8Array; mime: string }>> {
  const plus = plusGlobal()
  if (plus?.android?.runtimeMainActivity && plus.android.invoke) return pickImageDocument(plus.android)
  if (plus?.gallery?.pick) {
    const selected = await new Promise<FileOutcome<string>>((resolve) => {
      try {
        plus.gallery.pick(
          (path: string) => resolve(path ? { ok: true, value: path } : fail('选择图片失败：系统未返回文件路径')),
          (err: unknown) => resolve(pickerFailure(err, '选择图片失败')),
          { filter: 'image', multiple: false },
        )
      } catch (err) {
        resolve(pickerFailure(err, '选择图片失败'))
      }
    })
    if (!selected.ok) return selected
    return readImageBytes(selected.value)
  }

  const uni = uniGlobal()
  if (!uni?.chooseImage) return fail('当前环境不支持选择图片')
  const selected = await new Promise<FileOutcome<string>>((resolve) => {
    uni.chooseImage!({
      count: 1,
      sizeType: ['original'],
      success: (res) => {
        const path = res.tempFilePaths?.[0] ?? res.tempFiles?.[0]?.path
        resolve(path ? { ok: true, value: path } : fail('选择图片失败：系统未返回文件路径'))
      },
      fail: (err) => resolve(pickerFailure(err, '选择图片失败')),
    })
  })
  if (!selected.ok) return selected
  return readImageBytes(selected.value)
}

function readImageBytes(path: string): Promise<FileOutcome<{ bytes: Uint8Array; mime: string }>> {
  const plus = plusGlobal()
  if (plus?.io?.resolveLocalFileSystemURL && plus?.io?.FileReader) {
    return new Promise((resolve) => {
      const candidates = localPathCandidates(path, plus)
      const tryPath = (index: number) => {
        if (index >= candidates.length) return resolve(fail('读取图片失败，请检查图片路径或存储权限'))
        const nextPath = () => tryPath(index + 1)
        plus.io.resolveLocalFileSystemURL(
          candidates[index],
          (entry: PlusAny) => {
            entry.file(
              (file: PlusAny) => {
                if (Number(file.size) > MAX_IMAGE_BYTES) return resolve(fail('图片超过 20 MiB 上限，请选择较小的原图'))
                const reader = new plus.io.FileReader()
                let settled = false
                const finish = (result: FileOutcome<{ bytes: Uint8Array; mime: string }>) => {
                  if (settled) return
                  settled = true
                  reader.onload = null
                  reader.onloadend = null
                  reader.onerror = null
                  resolve(result)
                }
                const next = () => {
                  if (settled) return
                  settled = true
                  reader.onload = null
                  reader.onloadend = null
                  reader.onerror = null
                  nextPath()
                }
                const done = (e: PlusAny) => {
                  if (settled) return
                  const url = String(e?.target?.result ?? '')
                  const m = /^data:([^;,]*)(?:;[^,]*)?;base64,(.*)$/s.exec(url)
                  if (!m) return next()
                  try {
                    const bytes = base64ToBytes(m[2])
                    if (bytes.length > MAX_IMAGE_BYTES) {
                      return finish(fail('图片超过 20 MiB 上限，请选择较小的原图'))
                    }
                    finish({ ok: true, value: { bytes, mime: m[1] } })
                  } catch {
                    next()
                  }
                }
                reader.onload = done
                reader.onloadend = done
                reader.onerror = next
                try {
                  reader.readAsDataURL(file)
                } catch {
                  next()
                }
              },
              nextPath,
            )
          },
          nextPath,
        )
      }
      tryPath(0)
    })
  }
  // H5 开发环境兜底（浏览器 Blob URL）
  if (typeof fetch === 'function') {
    return (async () => {
      try {
        const res = await fetch(path)
        if (!res.ok) return fail('读取图片失败，请重新选择本机文件')
        if (Number(res.headers.get('content-length')) > MAX_IMAGE_BYTES) return fail('图片超过 20 MiB 上限')
        const buf = await res.arrayBuffer()
        if (buf.byteLength > MAX_IMAGE_BYTES) return fail('图片超过 20 MiB 上限')
        return { ok: true, value: { bytes: new Uint8Array(buf), mime: res.headers.get('content-type') || 'image/png' } }
      } catch {
        return fail('读取图片失败')
      }
    })()
  }
  return Promise.resolve(fail('当前环境无法读取图片文件'))
}

function pickImageDocument(android: PlusAny): Promise<FileOutcome<{ bytes: Uint8Array; mime: string }>> {
  return new Promise((resolve) => {
    let main: PlusAny
    let previous: PlusAny
    let handler: PlusAny
    const call = (obj: PlusAny, name: string, ...args: PlusAny[]) => android.invoke(obj, name, ...args)
    const restore = () => { if (main && handler && main.onActivityResult === handler) main.onActivityResult = previous }
    try {
      main = android.runtimeMainActivity()
      const intent = android.newObject('android.content.Intent', 'android.intent.action.OPEN_DOCUMENT')
      call(intent, 'addCategory', 'android.intent.category.OPENABLE')
      call(intent, 'setType', 'image/*')
      previous = main.onActivityResult
      handler = (requestCode: number, resultCode: number, data: PlusAny) => {
        if (requestCode !== 9022) {
          if (typeof previous === 'function') previous(requestCode, resultCode, data)
          return
        }
        restore()
        if (resultCode !== -1 || !data) return resolve(fail('已取消选图，已有输入保留。', true))
        let input: PlusAny
        let channel: PlusAny
        try {
          const resolver = call(main, 'getContentResolver')
          const uri = call(data, 'getData')
          input = call(resolver, 'openInputStream', uri)
          if (!input) throw new Error('无法打开文件')
          channel = call('java.nio.channels.Channels', 'newChannel', input)
          const buffer = call('java.nio.ByteBuffer', 'allocate', 65536)
          const parts: Uint8Array[] = []
          let size = 0
          while (true) {
            call(buffer, 'clear')
            const count = call(channel, 'read', buffer)
            if (count === -1) break
            if (!Number.isInteger(count) || count <= 0 || count > 65536) throw new Error('无法完整读取文件')
            size += count
            if (size > MAX_IMAGE_BYTES) return resolve(fail('图片超过 20 MiB 上限，请选择较小的原图'))
            const encoded = call('android.util.Base64', 'encodeToString', call(buffer, 'array'), 0, count, 2)
            if (typeof encoded !== 'string') throw new Error('无法读取文件字节')
            const part = base64ToBytes(encoded)
            if (part.length !== count) throw new Error('文件读取不完整')
            parts.push(part)
          }
          const bytes = new Uint8Array(size)
          let offset = 0
          for (const part of parts) { bytes.set(part, offset); offset += part.length }
          resolve({ ok: true, value: { bytes, mime: String(call(resolver, 'getType', uri) || '') } })
        } catch {
          resolve(fail('读取图片失败，请重新选择可读取的本机文件；已有输入保留。'))
        } finally {
          if (channel) call(channel, 'close')
          if (input) call(input, 'close')
        }
      }
      main.onActivityResult = handler
      // Import the activity so this void call throws on bridge errors rather than silently failing.
      android.importClass(main)
      main.startActivityForResult(intent, 9022)
    } catch {
      restore()
      resolve(fail('无法打开文件选择器，请重试；已有输入保留。'))
    }
  })
}

function localPathCandidates(path: string, plus: PlusAny): string[] {
  const values = [path]
  const add = (value: unknown) => {
    if (typeof value === 'string' && value && !values.includes(value)) values.push(value)
  }
  try {
    add(plus.io.convertLocalFileSystemURL?.(path))
  } catch {
    /* try the original path */
  }
  try {
    add(plus.io.convertAbsoluteFileSystem?.(path))
  } catch {
    /* try the original path */
  }
  return values
}

const PICK_BACKUP_REQUEST_CODE = 9021

/** 选择一个文本文件（备份 JSON）并读出内容。Android 走系统文档选择器。 */
export async function pickTextDocument(): Promise<FileOutcome<{ text: string }>> {
  const plus = plusGlobal()
  if (plus?.android?.runtimeMainActivity && plus?.android?.importClass) {
    return pickViaAndroidIntent(plus)
  }
  const uni = uniGlobal()
  if (uni?.chooseFile) {
    const selected = await new Promise<FileOutcome<string>>((resolve) => {
      uni.chooseFile!({
        count: 1,
        extension: ['.json'],
        success: (res) => {
          const path = res.tempFilePaths?.[0] ?? res.tempFiles?.[0]?.path
          resolve(path ? { ok: true, value: path } : fail('选择备份失败：系统未返回文件路径'))
        },
        fail: (err) => resolve(pickerFailure(err, '选择备份失败')),
      })
    })
    if (!selected.ok) return selected
    const path = selected.value
    if (typeof fetch === 'function') {
      try {
        const res = await fetch(path)
        return { ok: true, value: { text: await res.text() } }
      } catch {
        return fail('无法读取备份文件，原账本未改。')
      }
    }
  }
  return fail('当前环境没有可用的文件选择器')
}

function pickViaAndroidIntent(plus: PlusAny): Promise<FileOutcome<{ text: string }>> {
  return new Promise((resolve) => {
    let main: PlusAny
    let previous: PlusAny = null
    let handler: PlusAny = null
    try {
      main = plus.android.runtimeMainActivity()
      const Intent = plus.android.importClass('android.content.Intent')
      const intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
      intent.addCategory(Intent.CATEGORY_OPENABLE)
      intent.setType('*/*')
      previous = main.onActivityResult
      handler = (requestCode: number, resultCode: number, data: PlusAny) => {
        if (requestCode !== PICK_BACKUP_REQUEST_CODE) {
          if (typeof previous === 'function') previous(requestCode, resultCode, data)
          return
        }
        if (main.onActivityResult === handler) main.onActivityResult = previous
        if (resultCode !== -1 || !data) return resolve(fail('已取消选择备份，原账本未改。', true))
        try {
          const uri = data.getData()
          const resolver = main.getContentResolver()
          const input = resolver.openInputStream(uri)
          const InputStreamReader = plus.android.importClass('java.io.InputStreamReader')
          const BufferedReader = plus.android.importClass('java.io.BufferedReader')
          const reader = new BufferedReader(new InputStreamReader(input, 'UTF-8'))
          let text = ''
          let line = reader.readLine()
          while (line !== null && line !== undefined) {
            text += line + '\n'
            line = reader.readLine()
          }
          reader.close()
          resolve({ ok: true, value: { text } })
        } catch {
          resolve(fail('无法读取备份文件，原账本未改。'))
        }
      }
      main.onActivityResult = handler
      main.startActivityForResult(intent, PICK_BACKUP_REQUEST_CODE)
    } catch {
      if (main && main.onActivityResult === handler) main.onActivityResult = previous
      resolve(fail('无法打开系统文件选择器'))
    }
  })
}

/** 把文本写入用户可取出的文件（下载目录；覆盖同名旧文件）。 */
export async function writeTextToDownloads(filename: string, text: string): Promise<FileOutcome<{ path: string }>> {
  const plus = plusGlobal()
  if (!plus?.io?.requestFileSystem) return fail('当前环境不支持写入文件')
  return new Promise((resolve) => {
    plus.io.requestFileSystem(
      plus.io.PUBLIC_DOWNLOADS,
      (fs: PlusAny) => {
        // 先删后建，避免覆盖时残留旧内容尾部
        const createAndWrite = () =>
          fs.root.getFile(
            filename,
            { create: true, exclusive: false },
            (entry: PlusAny) => {
              entry.createWriter(
                (writer: PlusAny) => {
                  writer.onwriteend = () => resolve({ ok: true, value: { path: String(entry.fullPath || filename) } })
                  writer.onerror = () => resolve(fail('写入文件失败'))
                  writer.write(text)
                },
                () => resolve(fail('写入文件失败')),
              )
            },
            () => resolve(fail('无法创建文件')),
          )
        fs.root.getFile(
          filename,
          { create: false },
          (old: PlusAny) => old.remove(createAndWrite, createAndWrite),
          createAndWrite,
        )
      },
      () => resolve(fail('无法访问下载目录')),
    )
  })
}

/** 把 PNG 字节写入应用目录并保存进系统相册（用户可直接取用）。 */
export async function saveImageToGallery(filename: string, png: Uint8Array): Promise<FileOutcome<{ path: string }>> {
  const plus = plusGlobal()
  if (!plus?.io?.requestFileSystem || !plus?.gallery?.save) return fail('当前环境不支持保存图片')
  const relPath = '_doc/share/' + filename
  return new Promise((resolve) => {
    plus.io.requestFileSystem(
      plus.io.PRIVATE_DOC,
      (fs: PlusAny) => {
        fs.root.getDirectory(
          'share',
          { create: true, exclusive: false },
          (dir: PlusAny) => {
            dir.getFile(
              filename,
              { create: true, exclusive: false },
              (entry: PlusAny) => {
                entry.createWriter(
                  (writer: PlusAny) => {
                    writer.onerror = () => resolve(fail('写入图片失败'))
                    writer.onwriteend = () => {
                      plus.gallery.save(
                        relPath,
                        () => resolve({ ok: true, value: { path: relPath } }),
                        () => resolve(fail('图片已写入应用目录但未能加入相册，请检查相册权限后重试')),
                      )
                    }
                    try {
                      const blob = new Blob([png.buffer as ArrayBuffer], { type: 'image/png' })
                      writer.write(blob)
                    } catch {
                      resolve(fail('写入图片失败'))
                    }
                  },
                  () => resolve(fail('写入图片失败')),
                )
              },
              () => resolve(fail('写入图片失败')),
            )
          },
          () => resolve(fail('写入图片失败')),
        )
      },
      () => resolve(fail('写入图片失败')),
    )
  })
}

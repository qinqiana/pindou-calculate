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

export type FileOutcome<T> = { ok: true; value: T } | { ok: false; cancelled?: boolean; message: string }

function fail<T>(message: string, cancelled = false): FileOutcome<T> {
  return { ok: false, message, ...(cancelled ? { cancelled: true } : {}) }
}

type UniGlobal = {
  chooseImage?: (opts: {
    count: number
    sizeType?: string[]
    success?: (res: { tempFilePaths?: string[] }) => void
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

/** 选一张图纸图片并读出字节（App 用 chooseImage + plus.io 读取）。 */
export async function pickImageFile(): Promise<FileOutcome<{ bytes: Uint8Array; mime: string }>> {
  const uni = uniGlobal()
  if (!uni?.chooseImage) return fail('当前环境不支持选择图片')
  const path = await new Promise<string | null>((resolve) => {
    uni.chooseImage!({
      count: 1,
      sizeType: ['original'],
      success: (res) => resolve(res.tempFilePaths?.[0] ?? null),
      fail: () => resolve(null),
    })
  })
  if (!path) return fail('已取消选择，没有创建图纸', true)
  return readImageBytes(path)
}

function readImageBytes(path: string): Promise<FileOutcome<{ bytes: Uint8Array; mime: string }>> {
  const plus = plusGlobal()
  if (plus?.io?.resolveLocalFileSystemURL && plus?.io?.FileReader) {
    return new Promise((resolve) => {
      plus.io.resolveLocalFileSystemURL(
        path,
        (entry: PlusAny) => {
          entry.file(
            (file: PlusAny) => {
              const reader = new plus.io.FileReader()
              reader.onloadend = (e: PlusAny) => {
                const url = String(e?.target?.result ?? '')
                const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(url)
                if (!m) return resolve(fail('读取图片失败'))
                try {
                  resolve({ ok: true, value: { bytes: base64ToBytes(m[2]), mime: m[1] } })
                } catch {
                  resolve(fail('读取图片失败'))
                }
              }
              reader.onerror = () => resolve(fail('读取图片失败'))
              reader.readAsDataURL(file)
            },
            () => resolve(fail('读取图片失败')),
          )
        },
        () => resolve(fail('读取图片失败')),
      )
    })
  }
  // H5 开发环境兜底（浏览器 Blob URL）
  if (typeof fetch === 'function') {
    return (async () => {
      try {
        const res = await fetch(path)
        const buf = await res.arrayBuffer()
        return { ok: true, value: { bytes: new Uint8Array(buf), mime: res.headers.get('content-type') || 'image/png' } }
      } catch {
        return fail('读取图片失败')
      }
    })()
  }
  return Promise.resolve(fail('当前环境无法读取图片文件'))
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
    const path = await new Promise<string | null>((resolve) => {
      uni.chooseFile!({
        count: 1,
        extension: ['.json'],
        success: (res) => resolve(res.tempFilePaths?.[0] ?? res.tempFiles?.[0]?.path ?? null),
        fail: () => resolve(null),
      })
    })
    if (!path) return fail('已取消选择备份，原账本未改。', true)
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
    try {
      main = plus.android.runtimeMainActivity()
      const Intent = plus.android.importClass('android.content.Intent')
      const intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
      intent.addCategory(Intent.CATEGORY_OPENABLE)
      intent.setType('*/*')
      main.onActivityResult = (requestCode: number, resultCode: number, data: PlusAny) => {
        main.onActivityResult = null
        if (requestCode !== PICK_BACKUP_REQUEST_CODE) return
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
      main.startActivityForResult(intent, PICK_BACKUP_REQUEST_CODE)
    } catch {
      main && (main.onActivityResult = null)
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

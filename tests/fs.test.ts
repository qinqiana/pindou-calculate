import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickImageFile, pickTextDocument, saveImageToGallery, writeTextToDownloads } from '../app/src/platform/fs.ts'

/* eslint-disable @typescript-eslint/no-explicit-any */

async function withEnv<T>(env: { plus?: unknown; uni?: unknown }, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as { plus?: unknown; uni?: unknown }
  const prevPlus = g.plus
  const prevUni = g.uni
  if ('plus' in env) g.plus = env.plus
  if ('uni' in env) g.uni = env.uni
  try {
    return await fn()
  } finally {
    if (prevPlus === undefined) delete g.plus
    else g.plus = prevPlus
    if (prevUni === undefined) delete g.uni
    else g.uni = prevUni
  }
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

test('pickImageFile：App 优先使用 plus.gallery.pick 的系统图片路径', async () => {
  const paths: string[] = []
  const plus = {
    gallery: {
      pick(ok: (path: string) => void, _fail: (err: unknown) => void, options: unknown) {
        assert.deepEqual(options, { filter: 'image', multiple: false })
        ok('file:///storage/emulated/0/Pictures/pattern.png')
      },
    },
    io: {
      resolveLocalFileSystemURL(path: string, ok: (e: any) => void) {
        paths.push(path)
        ok({
          file(cb: (f: any) => void) {
            cb({ name: 'pattern.png' })
          },
        })
      },
      FileReader: class {
        onloadend: ((e: any) => void) | null = null
        onerror: (() => void) | null = null
        readAsDataURL() {
          this.onloadend!({ target: { result: 'data:image/png;base64,' + Buffer.from(PNG_BYTES).toString('base64') } })
        }
      },
    },
  }
  const r = await withEnv({ plus }, () => pickImageFile())
  assert.equal(r.ok, true)
  assert.deepEqual(paths, ['file:///storage/emulated/0/Pictures/pattern.png'])
})

test('pickImageFile：连续选择两张图片时读取状态彼此独立，重复回调也只完成一次', async () => {
  const selectedPaths = ['file:///storage/emulated/0/Pictures/one.png', 'file:///storage/emulated/0/Pictures/two.png']
  const resolvedPaths: string[] = []
  let pickCount = 0
  let readCount = 0
  const plus = {
    gallery: {
      pick(ok: (path: string) => void) {
        ok(selectedPaths[pickCount++])
      },
    },
    io: {
      resolveLocalFileSystemURL(path: string, ok: (e: any) => void) {
        resolvedPaths.push(path)
        ok({ file(cb: (f: any) => void) { cb({ name: path }) } })
      },
      FileReader: class {
        onload: ((e: any) => void) | null = null
        onloadend: ((e: any) => void) | null = null
        onerror: (() => void) | null = null
        readAsDataURL() {
          const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, readCount++])
          const event = { target: { result: 'data:image/png;base64,' + Buffer.from(bytes).toString('base64') } }
          const onload = this.onload!
          const onloadend = this.onloadend!
          onload(event)
          onloadend(event)
        }
      },
    },
  }
  const result = await withEnv({ plus }, async () => [await pickImageFile(), await pickImageFile()])
  assert.equal(result[0].ok, true)
  assert.equal(result[1].ok, true)
  assert.deepEqual(resolvedPaths, selectedPaths)
  if (result[0].ok && result[1].ok) assert.notDeepEqual(Array.from(result[0].value.bytes), Array.from(result[1].value.bytes))
})

test('pickImageFile：一次读取失败后下一次选择仍可正常读取', async () => {
  let pickCount = 0
  const plus = {
    gallery: {
      pick(ok: (path: string) => void) {
        ok(pickCount++ === 0 ? 'file:///bad.png' : 'file:///good.png')
      },
    },
    io: {
      resolveLocalFileSystemURL(path: string, ok: (e: any) => void, failPath: () => void) {
        if (path === 'file:///bad.png') return failPath()
        ok({ file(cb: (f: any) => void) { cb({ name: 'good.png' }) } })
      },
      FileReader: class {
        onloadend: ((e: any) => void) | null = null
        onerror: (() => void) | null = null
        readAsDataURL() {
          this.onloadend!({ target: { result: 'data:image/png;base64,' + Buffer.from(PNG_BYTES).toString('base64') } })
        }
      },
    },
  }
  const result = await withEnv({ plus }, async () => [await pickImageFile(), await pickImageFile()])
  assert.equal(result[0].ok, false)
  assert.equal(result[1].ok, true)
})

// Android content URI selection is covered through OPEN_DOCUMENT in webp.test.ts.

test('pickImageFile：chooseImage + plus.io 读出字节与 mime', async () => {
  const uni = {
    chooseImage(opts: any) {
      opts.success({ tempFilePaths: ['_doc/tmp/pattern.png'] })
    },
  }
  const plus = {
    io: {
      resolveLocalFileSystemURL(path: string, ok: (e: any) => void) {
        assert.equal(path, '_doc/tmp/pattern.png')
        ok({
          file(cb: (f: any) => void) {
            cb({ name: 'pattern.png' })
          },
        })
      },
      FileReader: class {
        onloadend: ((e: any) => void) | null = null
        onerror: (() => void) | null = null
        readAsDataURL() {
          this.onloadend!({ target: { result: 'data:image/png;base64,' + Buffer.from(PNG_BYTES).toString('base64') } })
        }
      },
    },
  }
  const r = await withEnv({ plus, uni }, () => pickImageFile())
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.deepEqual(Array.from(r.value.bytes), Array.from(PNG_BYTES))
    assert.equal(r.value.mime, 'image/png')
  }
})

test('pickImageFile：原始路径无法解析时尝试转换后的本地路径', async () => {
  const paths: string[] = []
  const uni = {
    chooseImage(opts: any) {
      opts.success({ tempFilePaths: ['/data/user/0/app/tmp/pattern.png'] })
    },
  }
  const plus = {
    io: {
      convertAbsoluteFileSystem(path: string) {
        assert.equal(path, '/data/user/0/app/tmp/pattern.png')
        return '_doc/tmp/pattern.png'
      },
      resolveLocalFileSystemURL(path: string, ok: (e: any) => void, fail: () => void) {
        paths.push(path)
        if (path !== '_doc/tmp/pattern.png') return fail()
        ok({
          file(cb: (f: any) => void) {
            cb({ name: 'pattern.png' })
          },
        })
      },
      FileReader: class {
        onload: ((e: any) => void) | null = null
        onloadend: ((e: any) => void) | null = null
        onerror: (() => void) | null = null
        readAsDataURL() {
          this.onloadend!({ target: { result: 'data:image/png;base64,' + Buffer.from(PNG_BYTES).toString('base64') } })
        }
      },
    },
  }
  const r = await withEnv({ plus, uni }, () => pickImageFile())
  assert.equal(r.ok, true)
  assert.deepEqual(paths, ['/data/user/0/app/tmp/pattern.png', '_doc/tmp/pattern.png'])
})

test('pickImageFile：用户取消返回 cancelled，不算错误', async () => {
  const uni = {
    chooseImage(opts: any) {
      opts.fail({ errMsg: 'cancel' })
    },
  }
  const r = await withEnv({ uni }, () => pickImageFile())
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.cancelled, true)
})

test('pickImageFile：权限或系统失败不误报为取消', async () => {
  const uni = {
    chooseImage(opts: any) {
      opts.fail({ errMsg: 'authorize denied' })
    },
  }
  const r = await withEnv({ uni }, () => pickImageFile())
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.cancelled, undefined)
    assert.match(r.message, /authorize denied/)
  }
})

test('pickImageFile：无 chooseImage 的环境给出明确失败', async () => {
  const r = await withEnv({}, () => pickImageFile())
  assert.equal(r.ok, false)
})

function fakeAndroid(lines: string[], resultCode: number) {
  const calls: string[] = []
  class Intent {
    static ACTION_OPEN_DOCUMENT = 'android.intent.action.OPEN_DOCUMENT'
    static CATEGORY_OPENABLE = 'android.intent.category.OPENABLE'
    action: string
    constructor(action: string) {
      this.action = action
    }
    addCategory() {}
    setType() {}
  }
  class InputStreamReader {
    input: unknown
    enc: string
    constructor(input: unknown, enc: string) {
      this.input = input
      this.enc = enc
    }
  }
  class BufferedReader {
    private rest = lines.slice()
    readLine(): string | null {
      return this.rest.length ? this.rest.shift()! : null
    }
    close() {}
  }
  const main: any = {
    onActivityResult: null as null | ((rc: number, sc: number, data: any) => void),
    startActivityForResult(_intent: unknown, code: number) {
      calls.push('start:' + code)
      this.onActivityResult!(code, resultCode, resultCode === -1 ? { getData: () => 'content://backup/1' } : null)
    },
    getContentResolver() {
      return {
        openInputStream(uri: unknown) {
          calls.push('open:' + String(uri))
          return { uri }
        },
      }
    },
  }
  const plus = {
    android: {
      runtimeMainActivity: () => main,
      importClass(name: string) {
        if (name === 'android.content.Intent') return Intent
        if (name === 'java.io.InputStreamReader') return InputStreamReader
        if (name === 'java.io.BufferedReader') return BufferedReader
        throw new Error('unexpected import ' + name)
      },
    },
  }
  return { plus, main, calls }
}

test('pickTextDocument：Android 文档选择器读出文本内容', async () => {
  const { plus, calls } = fakeAndroid(['{"formatVersion":1,', '"stock":{}}'], -1)
  const r = await withEnv({ plus }, () => pickTextDocument())
  assert.equal(r.ok, true)
  if (r.ok) assert.match(r.value.text, /formatVersion/)
  assert.ok(calls.some((c) => c.startsWith('start:9021')))
  assert.ok(calls.includes('open:content://backup/1'))
})

test('pickTextDocument：用户取消系统选择器返回 cancelled', async () => {
  const { plus } = fakeAndroid([], 0)
  const r = await withEnv({ plus }, () => pickTextDocument())
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.cancelled, true)
})

test('pickTextDocument：uni 文件选择失败不误报为取消', async () => {
  const uni = {
    chooseFile(opts: any) {
      opts.fail({ errMsg: 'permission denied' })
    },
  }
  const r = await withEnv({ uni }, () => pickTextDocument())
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.cancelled, undefined)
    assert.match(r.message, /permission denied/)
  }
})

test('pickTextDocument：非目标 activity result 不会清掉目标回调', async () => {
  const { plus, main } = fakeAndroid(['{"formatVersion":1}'], -1)
  const originalStart = main.startActivityForResult
  main.startActivityForResult = function (intent: unknown, code: number) {
    this.onActivityResult!(1001, 0, null)
    originalStart.call(this, intent, code)
  }
  const r = await withEnv({ plus }, () => pickTextDocument())
  assert.equal(r.ok, true)
})

test('pickTextDocument：没有可用选择器时明确失败', async () => {
  const r = await withEnv({}, () => pickTextDocument())
  assert.equal(r.ok, false)
})

function fakeDownloadsFs(opts: { oldExists?: boolean; writerFails?: boolean }) {
  const calls: string[] = []
  const writer: any = {
    data: null as unknown,
    onwriteend: null as null | (() => void),
    onerror: null as null | (() => void),
    write(data: unknown) {
      this.data = data
      if (opts.writerFails) this.onerror!()
      else this.onwriteend!()
    },
  }
  const entry: any = {
    fullPath: '/storage/emulated/0/Download/pindou-backup.json',
    createWriter(ok: (w: any) => void) {
      ok(writer)
    },
    remove(ok: () => void) {
      calls.push('remove-old')
      ok()
    },
  }
  const plus = {
    io: {
      PUBLIC_DOWNLOADS: 4,
      PRIVATE_DOC: 2,
      requestFileSystem(_which: number, ok: (fs: any) => void) {
        ok({
          root: {
            getFile(_name: string, flags: { create?: boolean }, ok: (e: any) => void, fail: () => void) {
              if (!flags.create && !opts.oldExists) return fail()
              ok(entry)
            },
          },
        })
      },
    },
  }
  return { plus, writer, calls }
}

test('writeTextToDownloads：写入下载目录并返回路径；旧文件先删后建', async () => {
  const { plus, writer, calls } = fakeDownloadsFs({ oldExists: true })
  const r = await withEnv({ plus }, () => writeTextToDownloads('pindou-backup.json', '{"a":1}'))
  assert.equal(r.ok, true)
  if (r.ok) assert.match(r.value.path, /Download/)
  assert.equal(writer.data, '{"a":1}')
  assert.ok(calls.includes('remove-old'))
})

test('writeTextToDownloads：写入失败返回 ok:false，不伪报成功', async () => {
  const { plus } = fakeDownloadsFs({ writerFails: true })
  const r = await withEnv({ plus }, () => writeTextToDownloads('pindou-backup.json', 'x'))
  assert.equal(r.ok, false)
})

test('writeTextToDownloads：不支持的环境明确失败', async () => {
  const r = await withEnv({}, () => writeTextToDownloads('a.json', 'x'))
  assert.equal(r.ok, false)
})

function fakeGalleryEnv(opts: { galleryFails?: boolean; decodeFails?: boolean }) {
  const calls: string[] = []
  const plus = {
    io: {
      PRIVATE_DOC: 2,
      requestFileSystem(_which: number, ok: (fs: any) => void) {
        ok({ root: { getDirectory(_name: string, _flags: unknown, ready: () => void) { ready() } } })
      },
    },
    nativeObj: {
      Bitmap: class {
        loadBase64Data(data: string, ok: () => void, fail: () => void) {
          assert.deepEqual(new Uint8Array(Buffer.from(data.split(',')[1], 'base64')), PNG_BYTES)
          calls.push('decode-png')
          opts.decodeFails ? fail() : ok()
        }
        save(path: string, options: unknown, ok: () => void) {
          assert.deepEqual(options, { overwrite: true, format: 'png' })
          calls.push('write-png:' + path)
          ok()
        }
        clear() { calls.push('clear-bitmap') }
      },
    },
    gallery: {
      save(path: string, ok: () => void, fail: () => void) {
        calls.push('gallery:' + path)
        opts.galleryFails ? fail() : ok()
      },
    },
  }
  return { plus, calls }
}

test('saveImageToGallery：写入应用目录后加入系统相册', async () => {
  const { plus, calls } = fakeGalleryEnv({})
  const r = await withEnv({ plus }, () => saveImageToGallery('pindou-share-moments-classic.png', PNG_BYTES))
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.value.path, '_doc/share/pindou-share-moments-classic.png')
  assert.ok(calls.includes('write-png:_doc/share/pindou-share-moments-classic.png'))
  assert.equal(calls.at(-1), 'clear-bitmap')
  assert.ok(calls.includes('gallery:_doc/share/pindou-share-moments-classic.png'))
})

test('saveImageToGallery：相册保存失败明确报错（不谎称已可取用）', async () => {
  const { plus, calls } = fakeGalleryEnv({ galleryFails: true })
  const r = await withEnv({ plus }, () => saveImageToGallery('x.png', PNG_BYTES))
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.message, /相册/)
  assert.equal(calls.at(-1), 'clear-bitmap')
  const bad = fakeGalleryEnv({ decodeFails: true })
  assert.equal((await withEnv({ plus: bad.plus }, () => saveImageToGallery('bad.png', PNG_BYTES))).ok, false)
  assert.deepEqual(bad.calls, ['decode-png', 'clear-bitmap'])
})

test('页面与门面不再使用 uni.getFileSystemManager', async () => {
  const { readFileSync } = await import('node:fs')
  for (const file of [
    'app/pages/pattern/list.vue',
    'app/pages/pattern/detail.vue',
    'app/pages/pattern/share.vue',
    'app/pages/settings/index.vue',
    'app/pages/stock/batch.vue',
    'app/pages/stock/index.vue',
  ]) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /getFileSystemManager/, file)
  }
})

test('Android exports publish in public Downloads and remove only their own unfinished item on failure', async () => {
  for (const broken of [false, true]) {
    const calls: string[] = []
    const android = {
      runtimeMainActivity: () => 'activity',
      importClass: (name: string) => name.includes('VERSION') ? { SDK_INT: 35 } : { EXTERNAL_CONTENT_URI: 'downloads' },
      newObject: (name: string, ...args: any[]) => ({ name, args }),
      invoke(_target: unknown, method: string, ...args: any[]) {
        calls.push(method + (method === 'put' ? ':' + args[0] : ''))
        if (method === 'getContentResolver') return 'resolver'
        if (method === 'insert') return 'content://downloads/this-new-export'
        if (method === 'openOutputStream') return 'output'
        if (method === 'write') { assert.equal(args[0], '{"测试":2}'); if (broken) throw Error('storage full') }
        if (method === 'update') return 1
        if (method === 'delete') assert.equal(args[0], 'content://downloads/this-new-export')
      },
    }
    const result = await withEnv({ plus: { android } }, () => writeTextToDownloads('backup.json', '{"测试":2}'))
    assert.equal(result.ok, !broken)
    assert.ok(calls.includes('put:relative_path'))
    assert.ok(calls.includes('close'))
    assert.equal(calls.includes('delete'), broken)
    assert.equal(calls.includes('update'), !broken)
    if (result.ok) assert.equal(result.value.path, '下载/豆计/backup.json')
  }
})

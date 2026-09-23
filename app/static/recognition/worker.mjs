// The parent passes packaged bytes, never URLs supplied by an image or a user.
self.onmessage = async ({ data: { assets, image } }) => {
  const urls = []
  const moduleUrl = name => {
    const url = URL.createObjectURL(new Blob([assets[name]], { type: 'text/javascript' }))
    urls.push(url)
    return url
  }
  try {
    // A synthetic origin lets Pyodide use its normal loader inside a file:// WebView.
    // Every fetch is intercepted; missing bundled files fail closed, with no network fallback.
    globalThis.fetch = async input => {
      const url = new URL(String(input))
      const name = url.pathname.slice(1)
      if (url.origin !== 'https://pindou.invalid' || !Object.hasOwn(assets, name)) throw Error('缺少离线识别资源：' + name)
      return new Response(assets[name], { headers: { 'Content-Type': name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } })
    }
    const { loadPyodide } = await import(moduleUrl('pyodide.mjs'))
    const { default: createPyodideModule } = await import(moduleUrl('pyodide.asm.mjs'))
    self.postMessage({ stage: 'loading', message: '正在准备手机离线识别…' })
    const py = await loadPyodide({ indexURL: 'https://pindou.invalid/', createPyodideModule })
    await py.loadPackage(['numpy', 'opencv-python', 'pillow'])
    py.FS.mkdirTree('/app/experiments/issue8')
    py.FS.mkdirTree('/app/app/src/ledger')
    for (const [name, bytes] of Object.entries(assets)) {
      if (name.endsWith('.py') || name.endsWith('.npz') || name === 'glyphs.json') py.FS.writeFile('/app/experiments/issue8/' + name, new Uint8Array(bytes))
    }
    py.FS.writeFile('/app/app/src/ledger/catalog.ts', new Uint8Array(assets['catalog.ts']))
    py.FS.writeFile('/app/input', new Uint8Array(image))
    self.postMessage({ stage: 'recognizing', message: '正在读取图例并检查制作区域…' })
    py.globals.set('emit_checkpoint', value => {
      const result = JSON.parse(value)
      self.postMessage({ stage: 'progress', result, message: `已处理 ${result.progress.completed}/${result.progress.total} 个区域，仍在读取；可取消并核对已读部分。` })
    })
    const result = JSON.parse(py.runPython('import sys, json\nsys.path.insert(0, "/app/experiments/issue8")\nfrom recognize import recognize, app_result\ndef checkpoint(result):\n    emit_checkpoint(json.dumps(app_result(result), ensure_ascii=False))\njson.dumps(app_result(recognize("/app/input", on_progress=checkpoint)), ensure_ascii=False)'))
    self.postMessage({ stage: 'result', result })
  } catch (error) {
    self.postMessage({ stage: 'error', message: '本次识别未能完成，可重试或手工录入。', detail: String(error) })
  } finally {
    for (const url of urls) URL.revokeObjectURL(url)
  }
}

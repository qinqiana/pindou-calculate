// Offline app assets: download at build time only; inference never fetches a remote URL.
import { mkdir, writeFile, copyFile, rename, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destination = resolve(root, 'app/static/recognition/generated')
const version = '314.0.7'
const files = {
  'pyodide.mjs': 17931, 'pyodide.asm.mjs': 1250344, 'pyodide.asm.wasm': 9598218,
  'python_stdlib.zip': 2545637, 'pyodide-lock.json': 119077,
  'numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl': 2960568,
  'opencv_python-4.11.0.86-cp314-cp314-pyemscripten_2026_0_wasm32.whl': 10675764,
  'pillow-12.2.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl': 1037806,
}
await mkdir(destination, { recursive: true })
for (const [name, size] of Object.entries(files)) {
  const path = resolve(destination, name)
  if (await stat(path).then(s => s.size === size, () => false)) continue
  const response = await fetch(`https://cdn.jsdelivr.net/pyodide/v${version}/full/${name}`)
  if (!response.ok) throw Error(`下载离线识别文件失败：${name} (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length !== size) throw Error(`离线识别文件不完整：${name}`)
  await writeFile(path + '.part', bytes)
  await rename(path + '.part', path)
}
const algorithmFiles = ['recognize.py', 'generate_glyphs.py', 'layout_legend.py', 'glyph_model.py', 'grid_legend.py', 'source_marks.py', 'glyphs.json', 'glyph-model.npz', 'glyph-small.npz']
for (const name of algorithmFiles) await copyFile(resolve(root, 'experiments/issue8', name), resolve(destination, name))
await copyFile(resolve(root, 'app/src/ledger/catalog.ts'), resolve(destination, 'catalog.ts'))
await writeFile(resolve(destination, 'assets.json'), JSON.stringify([...Object.keys(files), ...algorithmFiles, 'catalog.ts']))
console.log('手机离线识别资源已准备：Pyodide ' + version)

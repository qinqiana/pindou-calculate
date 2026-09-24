import './prepare-recognition.mjs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const build = spawnSync(process.execPath, [resolve(root, 'node_modules/@dcloudio/vite-plugin-uni/bin/uni.js'), 'build', '-p', 'h5'], {
  cwd: root,
  env: {
    ...process.env,
    UNI_INPUT_DIR: resolve(root, 'app'),
    UNI_OUTPUT_DIR: resolve(root, 'dist/build/android-assets'),
  },
  stdio: 'inherit',
})
if (build.error) throw build.error
process.exit(build.status ?? 1)

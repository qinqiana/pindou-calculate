<template><view :request="request" :change:request="runner.changed" /></template>
<script>
export default {
  props: { request: { type: Object, default: null } },
  emits: ['result'],
  methods: {
    receive(value) {
      try { this.$emit('result', JSON.parse(value)) }
      catch { this.$emit('result', { stage: 'error', identity: this.request?.identity, message: '识别结果传回失败，当前输入已保留，可重试。' }) }
    },
  },
}
</script>
<script module="runner" lang="renderjs">
export default {
  methods: {
    async changed(request) {
      if (this.stopTask) this.stopTask()
      if (!request?.image) return
      let active = true, worker, timer
      const xhrs = new Set(), urls = []
      const stop = () => {
        active = false
        clearTimeout(timer)
        for (const xhr of xhrs) xhr.abort()
        if (worker) worker.terminate()
        for (const url of urls) URL.revokeObjectURL(url)
      }
      this.stopTask = stop
      // Native.js drops null properties in object arguments; a JSON string preserves
      // confirmedVersion/titleTotal null, which must remain distinct from missing data.
      const send = value => { if (active) this.$ownerInstance.callMethod('receive', JSON.stringify({ ...value, identity: request.identity })) }
      const read = path => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhrs.add(xhr)
        xhr.open('GET', 'static/recognition/' + path)
        xhr.responseType = 'arraybuffer'
        xhr.onload = () => { xhrs.delete(xhr); xhr.status === 200 && xhr.response ? resolve(xhr.response) : reject(Error('本地资源读取失败')) }
        xhr.onerror = () => reject(Error('本地资源读取失败'))
        xhr.onabort = () => reject(Error('cancelled'))
        xhr.send()
      })
      timer = setTimeout(() => { send({ stage: 'timeout', message: '识别超过 30 秒，已停止。可重试、换清晰原图或手工录入。' }); stop() }, 30000)
      try {
        send({ stage: 'loading', message: '正在准备手机离线识别…' })
        const names = JSON.parse(new TextDecoder().decode(await read('generated/assets.json')))
        const assets = {}
        for (const name of names) {
          if (!active) return
          assets[name] = await read('generated/' + name)
        }
        const code = await read('worker.mjs')
        if (!active) return
        const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
        urls.push(url)
        worker = new Worker(url, { type: 'module' })
        worker.onmessage = ({ data }) => { send(data); if (['result', 'error'].includes(data.stage)) stop() }
        worker.onerror = () => { send({ stage: 'error', message: '离线识别暂不可用，可重试或手工录入。' }); stop() }
        const raw = atob(request.image.slice(request.image.indexOf(',') + 1))
        const image = Uint8Array.from(raw, c => c.charCodeAt(0)).buffer
        worker.postMessage({ assets, image }, [...Object.values(assets), image])
      } catch (error) {
        send({ stage: 'error', message: '离线识别暂不可用，可重试或手工录入。', detail: String(error) })
        stop()
      }
    },
  },
}
</script>

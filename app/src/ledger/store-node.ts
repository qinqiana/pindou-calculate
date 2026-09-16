import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { LedgerStore, type PersistSink } from './store.ts'
import type { Envelope } from './types.ts'

export function nodeFileSink(path: string): PersistSink {
  return {
    read() {
      if (!existsSync(path)) return null
      return JSON.parse(readFileSync(path, 'utf8')) as Envelope
    },
    write(envelope: Envelope) {
      mkdirSync(dirname(path), { recursive: true })
      const tmp = path + '.tmp'
      writeFileSync(tmp, JSON.stringify(envelope), 'utf8')
      renameSync(tmp, path)
    },
  }
}

export function openNodeStore(path: string): LedgerStore {
  return LedgerStore.hydrate(nodeFileSink(path))
}

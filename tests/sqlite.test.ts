import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MemorySqlite, SqliteJsonStore } from '../app/src/ledger/sqlite-json.ts'
import { freshEnvelope } from '../app/src/ledger/store.ts'

test('sqlite json store rolls back an interrupted transaction', () => {
  const db = new MemorySqlite()
  const store = new SqliteJsonStore(db)
  store.ensureSchema()
  const before = store.live().seq
  store.interrupt = 'before-commit'
  assert.throws(() => {
    store.executeTransaction((env) => {
      env.live.seq = 99
    })
  })
  assert.equal(store.live().seq, before)
  store.executeTransaction((env) => {
    env.live.seq = 4
  })
  assert.equal(store.live().seq, 4)
})

test('BEGIN/DELETE is not visible after ROLLBACK; new store SELECTs committed row', () => {
  const db = new MemorySqlite()
  const first = new SqliteJsonStore(db)
  first.write(freshEnvelope())
  const original = first.read()
  assert.ok(original)
  db.executeSql('BEGIN TRANSACTION')
  db.executeSql('DELETE FROM pindou_ledger WHERE id = 1')
  assert.equal(db.selectSql().data?.length ?? 0, 0)
  db.executeSql('ROLLBACK')
  const second = new SqliteJsonStore(db)
  const loaded = second.read()
  assert.ok(loaded)
  assert.equal(loaded!.seq, original!.seq)
})

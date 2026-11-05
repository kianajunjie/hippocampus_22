import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHippocampus } from '../src/index.mjs'

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-subject-')), 'm.db')
const today = () => new Date().toLocaleDateString('sv-SE')

test('addEvent 会把 subject 落库（按人隔离的前提）', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: today(), who: 'user', topic: 'chat', what: '主人说腿疼', subject: '主人' })
  const row = hip.db.prepare('select subject, pinned from events').get()
  assert.equal(row.subject, '主人')
  assert.equal(row.pinned, 0)
  hip.close()
})

test('addEvent 的 pin 标记不会被吞掉', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: today(), who: 'user', topic: 'chat', what: '她怕黑', subject: '主人', pinned: true })
  assert.equal(hip.db.prepare('select pinned from events').get().pinned, 1)
  assert.equal(hip.list(5)[0].pinned, 1)
  hip.close()
})

test('A 的聊天记忆不会出现在 B 的召回里', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: today(), who: 'user', topic: 'cycling', what: '晴天骑车腿酸', subject: 'A' })
  const asA = hip.recall('骑车腿酸', { subject: 'A' })
  const asB = hip.recall('骑车腿酸', { subject: 'B' })
  assert.ok(asA.length >= 1, 'A 应该能召回自己的记忆')
  assert.equal(asB.length, 0, 'B 不该看到 A 的记忆')
  hip.close()
})

test('handleTurn 记下的聊天事件带 subject，群聊看不进私聊', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  await hip.handleTurn({ channel: 'qq', externalId: '1001', text: '我今天加班到十点', reply: '早点休息' })
  const row = hip.db.prepare('select subject, what from events').get()
  assert.equal(row.subject, 'qq:1001')
  const other = hip.recall('加班', { subject: 'qq:2002' })
  assert.equal(other.length, 0)
  hip.close()
})

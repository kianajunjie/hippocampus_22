import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHippocampus } from '../src/index.mjs'
import { forget } from '../src/forget.mjs'

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-forget-')), 'm.db')
const today = () => new Date().toLocaleDateString('sv-SE')
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('sv-SE')

test('不给条件就拒绝执行（否则等于清库）', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: today(), who: 'user', topic: 'chat', what: '一条记忆' })
  assert.throws(() => forget(hip.db, {}), /至少给一个条件/)
  assert.equal(hip.stats().events, 1)
  hip.close()
})

test('按主题软遗忘：召回不到、审计还查得到、联想边被清掉', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  const a = hip.addEvent({ day: today(), who: 'user', topic: 'fight', what: '那次吵架说的话', subject: '主人' })
  const b = hip.addEvent({ day: today(), who: 'agent', topic: 'care', what: '后来和好了', subject: '主人' })
  hip.link(a, b)

  const r = forget(hip.db, { topic: 'fight' })
  assert.equal(r.matched, 1)
  assert.equal(r.mode, 'soft')

  const row = hip.db.prepare('select superseded, strength from events where id=?').get(a)
  assert.equal(row.superseded, 1)
  assert.equal(row.strength, 0)
  assert.equal(hip.recall('吵架', { subject: '主人' }).length, 0)
  assert.equal(hip.db.prepare('select count(*) as n from edges').get().n, 0, '边要一起清')
  assert.ok(hip.audit().superseded.some((e) => e.id === a), 'audit 里还应该查得到')
  hip.close()
})

test('dry-run 只报告不落库', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: today(), who: 'user', topic: 'test', what: '测试数据' })
  const r = forget(hip.db, { topic: 'test', dryRun: true })
  assert.equal(r.matched, 1)
  assert.equal(r.dryRun, true)
  assert.equal(hip.db.prepare('select superseded from events').get().superseded, 0)
  hip.close()
})

test('置顶的默认不动，force 才删', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: today(), who: 'user', topic: 'rule', what: '她怕黑，留一盏灯', pinned: true })
  const soft = forget(hip.db, { topic: 'rule' })
  assert.equal(soft.matched, 0)
  assert.equal(soft.skipped, 1)
  const forced = forget(hip.db, { topic: 'rule', force: true })
  assert.equal(forced.matched, 1)
  hip.close()
})

test('olderThan 只影响更老的那些', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: daysAgo(40), who: 'user', topic: 'misc', what: '很久以前' })
  hip.addEvent({ day: today(), who: 'user', topic: 'misc', what: '今天刚说的' })
  const r = forget(hip.db, { olderThan: 30 })
  assert.equal(r.matched, 1)
  const left = hip.db.prepare('select what from events where superseded=0').all()
  assert.equal(left.length, 1)
  assert.match(left[0].what, /今天/)
  hip.close()
})

test('hard 模式直接删行', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: today(), who: 'user', topic: 'test', what: '测试数据' })
  const r = forget(hip.db, { topic: 'test', hard: true })
  assert.equal(r.mode, 'hard')
  assert.equal(hip.stats().events, 0)
  hip.close()
})

test('按人遗忘不影响别人', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: today(), who: 'user', topic: 'chat', what: 'A 的秘密', subject: 'A' })
  hip.addEvent({ day: today(), who: 'user', topic: 'chat', what: 'B 的日常', subject: 'B' })
  const r = forget(hip.db, { subject: 'A' })
  assert.equal(r.matched, 1)
  assert.equal(hip.recall('日常', { subject: 'B' }).length, 1)
  hip.close()
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHippocampus } from '../src/index.mjs'
import { health, formatHealth, localDay } from '../src/health.mjs'

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-health-')), 'm.db')

const dayAgo = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('sv-SE')

test('空库：结论是 empty，并且提示先记点什么', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  const h = health(hip.db)
  assert.equal(h.verdict, 'empty')
  assert.equal(h.events.total, 0)
  assert.match(h.advice[0], /还没记住/)
  hip.close()
})

test('健康库：有活跃事件且强度正常', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: localDay(), who: 'user', topic: 'chat', what: '说她今天加班', strength: 1 })
  hip.addEvent({ day: localDay(), who: 'agent', topic: 'care', what: '提醒她早点睡', strength: 0.9 })
  const h = health(hip.db)
  assert.equal(h.verdict, 'healthy')
  assert.equal(h.events.active, 2)
  assert.equal(h.events.weak, 0)
  hip.close()
})

test('快见底的记忆被计数，置顶的不算', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: dayAgo(80), who: 'user', topic: 'old', what: '很久以前的普通一天', strength: 0.08 })
  hip.addEvent({ day: dayAgo(80), who: 'user', topic: 'old', what: '很久以前但置顶了', strength: 0.08 })
  const pinnedId = hip.list(10).find((e) => e.what.includes('置顶')).id
  hip.pin(pinnedId)
  const h = health(hip.db)
  assert.equal(h.events.weak, 1)
  assert.equal(h.events.pinned, 1)
  assert.equal(h.events.stale, 2, '置顶也算"老"，只是不算"弱"')
  hip.close()
})

test('全部作废时结论是 starving', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: localDay(), who: 'user', topic: 'chat', what: '改口前', strength: 1 })
  hip.db.prepare('update events set superseded = 1').run()
  const h = health(hip.db)
  assert.equal(h.verdict, 'starving')
  assert.equal(h.events.active, 0)
  hip.close()
})

test('分层计数、关系疙瘩与未解缺口都出现在报告里', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: localDay(), who: 'user', topic: 'chat', what: '聊了一句', subject: '主人' })
  hip.relation('主人', { unresolved: 1, why: '吵了一句' })
  hip.fact('主人', '住在', '杭州')
  hip.gap('quokkacore', '群友提过')
  const h = health(hip.db)
  assert.equal(h.layers.relations, 1)
  assert.equal(h.layers.facts, 1)
  assert.equal(h.layers.gaps, 1)
  assert.deepEqual(h.knots, [{ subject: '主人', unresolved: 1 }])
  assert.equal(h.openGaps, 1)
  assert.equal(h.subjects.count, 1)
  assert.ok(h.advice.some((line) => line.includes('疙瘩')))
  hip.close()
})

test('文本版逐行输出，含结论与建议', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: localDay(), who: 'user', topic: 'chat', what: '聊了', strength: 1 })
  const text = formatHealth(health(hip.db))
  assert.match(text, /记忆体检测/)
  assert.match(text, /事件\s+总 1/)
  assert.ok(text.split('\n').length >= 4)
  hip.close()
})

test('英文输出不夹中文建议', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  const h = health(hip.db, { language: 'en' })
  assert.match(h.advice[0], /Nothing remembered yet/)
  hip.close()
})

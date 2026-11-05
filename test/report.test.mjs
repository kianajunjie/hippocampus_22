import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHippocampus } from '../src/index.mjs'
import { memoryReport } from '../src/report.mjs'

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-report-')), 'm.db')
const today = () => new Date().toLocaleDateString('sv-SE')

test('空库：给一句人话而不是空表格', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  const md = memoryReport(hip.db)
  assert.match(md, /^# 记忆档案/)
  assert.match(md, /还是空的/)
  hip.close()
})

test('档案按层排列：概览 / 事实 / 章节 / 最近 / 技能 / 缺口', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: today(), who: 'user', topic: 'chat', what: '主人说今天加班', subject: '主人', strength: 0.8 })
  hip.fact('主人', '住在', '杭州')
  hip.chapter('2026-10', '2026-11', '开学', '认识了一群人')
  hip.skill('剪视频', '剪,视频', 'whisper')
  hip.gap('quokkacore', '群友提过')
  hip.relation('主人', { intimacy: 1, unresolved: 1, why: '吵了一句' })

  const md = memoryReport(hip.db, { subject: '主人' })
  const order = ['## 概览', '## 事实（当前有效）', '## 最近的章节', '## 最近发生的事', '## 我会的技能', '## 还没搞懂的']
  const positions = order.map((h) => md.indexOf(h))
  assert.ok(positions.every((p) => p >= 0), md)
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, '章节顺序必须稳定')
  assert.match(md, /住在：杭州/)
  assert.match(md, /主人说今天加班/)
  assert.match(md, /没解开的疙瘩 1/)
  hip.close()
})

test('作废的记忆单独成段，不会被当成"还记得"', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: today(), who: 'user', topic: 'coffee', what: '主人喜欢喝咖啡', subject: '主人' })
  const id = hip.list(1)[0].id
  hip.addEvent({ day: today(), who: 'user', topic: 'coffee', what: '主人戒了咖啡', subject: '主人' })
  hip.db.prepare('update events set superseded=1 where id=?').run(id)

  const md = memoryReport(hip.db, { subject: '主人' })
  const supersededAt = md.indexOf('## 已经作废的')
  assert.ok(supersededAt > 0)
  const body = md.slice(supersededAt)
  assert.match(body, /喜欢喝咖啡/)
  assert.ok(md.indexOf('喜欢喝咖啡') > supersededAt, '"喜欢喝咖啡"只应出现在作废段')
  hip.close()
})

test('按人过滤：A 的档案里看不到 B 的事', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: today(), who: 'user', topic: 'chat', what: 'A 说他喜欢猫', subject: 'A' })
  hip.addEvent({ day: today(), who: 'user', topic: 'chat', what: 'B 说他怕狗', subject: 'B' })
  const md = memoryReport(hip.db, { subject: 'A' })
  assert.match(md, /喜欢猫/)
  assert.ok(!md.includes('怕狗'))
  hip.close()
})

test('英文档案用英文小标题', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: today(), who: 'user', topic: 'chat', what: 'she worked late' })
  const md = memoryReport(hip.db, { language: 'en' })
  assert.match(md, /^# Memory archive/)
  assert.match(md, /## Recent events/)
  hip.close()
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHippocampus } from '../src/index.mjs'

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-layer-')), 'm.db')

test('relationship drifts with what happens', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  const start = hip.relationship('主人')
  assert.equal(start.intimacy, 5)
  hip.relation('主人', { intimacy: 2, why: '聊了一晚上' })
  hip.relation('主人', { unresolved: 1, intimacy: -0.5, why: '吵了一句' })
  const now = hip.relationship('主人')
  assert.equal(now.intimacy, 6.5)
  assert.equal(now.unresolved, 1)
  assert.match(hip.relationLine('主人'), /疙瘩/)
  hip.close()
})

test('a changed fact closes the old one instead of keeping both', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.fact('主人', '住在', '成都')
  hip.fact('主人', '住在', '杭州')
  const facts = hip.facts('主人')
  assert.equal(facts.length, 1)
  assert.match(facts[0], /杭州/)
  hip.close()
})

test('chapters keep the latest one', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.chapter('2026-10', '2026-11', '第一章', '刚认识')
  hip.chapter('2026-11', '2026-12', '第二章', '熟了')
  assert.equal(hip.latestChapter().title, '第二章')
  hip.close()
})

test('skills surface only when the task matches', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.skill('剪视频', '剪,视频', 'whisper-srt')
  assert.equal(hip.skillsFor('帮我剪个视频').length, 1)
  assert.equal(hip.skillsFor('今天天气不错').length, 0)
  hip.close()
})

test('gaps remind her to ask instead of pretending', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.gap('quokkacore', '群友提过')
  assert.ok(hip.gaps().some((g) => g.term === 'quokkacore'))
  const ctx = hip.context({ subject: '主人', text: 'quokkacore 是啥' })
  assert.match(ctx, /我不太懂的/)
  assert.match(ctx, /主动问/)
  hip.close()
})

test('context block is ordered and complete', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.relation('主人', { intimacy: 2 })
  hip.fact('主人', '正在学', '开源课')
  hip.chapter('2026-10', '2026-11', '开始养她', '慢慢熟了')
  hip.skill('剪视频', '剪,视频', 'whisper-srt')
  hip.gap('quokkacore', '')
  const ctx = hip.context({ subject: '主人', text: '剪个视频' })
  const order = ['【关系】', '【关于主人的事实】', '【最近的章节】', '【我会的】', '【我不太懂的】']
  const positions = order.map((m) => ctx.indexOf(m))
  assert.ok(positions.every((p) => p >= 0), ctx)
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'sections must appear in order')
  hip.close()
})

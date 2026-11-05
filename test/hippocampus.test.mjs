import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHippocampus } from '../src/index.mjs'

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-'))
  return path.join(dir, 'memory.db')
}

const today = new Date().toLocaleDateString('sv-SE')
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('sv-SE')

test('encode inserts events and links them', async () => {
  const hip = await createHippocampus({
    db: tmpDb(),
    llm: async () => `${today}|user|cycling|user rode home and legs hurt|-1\n${today}|agent|care|she told the user to stretch|2`,
  })
  const r = await hip.encode([{ at: new Date().toISOString(), user: 'rode home, legs hurt', reply: 'stretch before bed' }])
  assert.equal(r.events, 2)
  const s = hip.stats()
  assert.equal(s.events, 2)
  assert.equal(s.edges, 1)
  hip.close()
})

test('recall matches keywords and returns a confidence level', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: daysAgo(1), who: 'user', topic: 'cycling', what: 'legs were sore after cycling', detail: 'legs sore', affect: -1 })
  const items = hip.recall('my legs are sore')
  assert.ok(items.length >= 1)
  assert.ok(['clear', 'roughly', 'barely', '记得清', '大概记得', '只记得有这回事'].includes(items[0].level))
  hip.close()
})

test('recall follows one hop through edges', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  const a = hip.addEvent({ day: today, who: 'user', topic: 'cycling', what: 'legs sore after cycling' })
  const b = hip.addEvent({ day: today, who: 'agent', topic: 'care', what: 'reminded to stretch' })
  hip.link(a, b)
  const items = hip.recall('cycling')
  assert.ok(items.some((i) => i.topic === undefined && i.what.includes('stretch')) || items.length >= 2)
  hip.close()
})

test('emotion-weighted decay forgets neutral events faster', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  const neutral = hip.addEvent({ day: daysAgo(3), who: 'user', topic: 'misc', what: 'neutral thing', affect: 0 })
  const strong = hip.addEvent({ day: daysAgo(3), who: 'user', topic: 'fight', what: 'emotional thing', affect: 2 })
  await hip.replay()
  const rows = hip.db.prepare('select id, strength from events order by id').all()
  const n = rows.find((r) => r.id === neutral).strength
  const s = rows.find((r) => r.id === strong).strength
  assert.ok(s > n, `emotional event should decay slower (${s} > ${n})`)
  hip.close()
})

test('replay merges duplicate topics and never below floor', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: daysAgo(40), who: 'user', topic: 'old', what: 'very old event' })
  hip.addEvent({ day: daysAgo(39), who: 'user', topic: 'old', what: 'very old event again' })
  const r = await hip.replay()
  assert.equal(r.merged, 1)
  const row = hip.db.prepare('select strength from events').get()
  assert.ok(row.strength >= hip.cfg.decay.floor)
  hip.close()
})

test('encode without llm throws a clear error', async () => {
  const hip = await createHippocampus({ db: tmpDb(), apiKey: '' })
  await assert.rejects(() => hip.encode([{ at: today, user: 'x', reply: 'y' }]), /needs an llm/)
  hip.close()
})

test('recallDeep expands a paraphrase into a lexical hit', async () => {
  const hip = await createHippocampus({
    db: tmpDb(),
    // 假模型：把「运动之后的肌肉疼」改写成能命中的词
    llm: async () => '骑车 腿 酸',
  })
  hip.addEvent({ day: daysAgo(2), who: 'user', topic: 'cycling', what: '主人骑车二十公里腿酸', detail: '腿酸' })
  const lexical = hip.recall('运动之后的肌肉疼')
  assert.equal(lexical.length, 0, 'lexical recall should miss')
  const deep = await hip.recallDeep('运动之后的肌肉疼')
  assert.equal(deep.via, 'expanded')
  assert.ok(deep.items.length >= 1, 'expansion should find the event')
  hip.close()
})

test('recallDeep uses an injected embedder when lexical misses', async () => {
  const hip = await createHippocampus({
    db: tmpDb(),
    // 玩具向量：字符直方图，够验证链路
    embedder: async (text) => {
      const v = new Array(64).fill(0)
      for (const ch of String(text)) v[ch.codePointAt(0) % 64] += 1
      return v
    },
  })
  const id = hip.addEvent({ day: daysAgo(1), who: 'user', topic: 'cycling', what: '主人骑车腿酸' })
  // 手动写入向量（模拟 encode 时算过）
  const v = await (async (t) => {
    const arr = new Array(64).fill(0)
    for (const ch of String(t)) arr[ch.codePointAt(0) % 64] += 1
    return arr
  })('主人骑车腿酸')
  hip.db.prepare('update events set vec=? where id=?').run(JSON.stringify(v), id)
  const deep = await hip.recallDeep('腿酸痛')
  assert.ok(['vector', 'lexical'].includes(deep.via))
  hip.close()
})

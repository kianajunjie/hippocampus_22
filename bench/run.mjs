#!/usr/bin/env node
/**
 * Bench: simulate a long fake life and measure memory quality.
 *
 *   node bench/run.mjs --mode mock --days 60
 *   node bench/run.mjs --mode llm  --days 10 --api-key sk-...
 *
 * mock: plants events directly (no LLM) — tests decay / recall / confidence at scale.
 * llm : generates dialogues, runs them through encode() — tests extraction quality.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHippocampus } from '../src/index.mjs'

const argv = process.argv.slice(2)
const flag = (k, d) => {
  const i = argv.indexOf('--' + k)
  if (i < 0) return d
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : true
}

const mode = flag('mode', 'mock')
const days = Number(flag('days', 60))
const seed = Number(flag('seed', 42))
const apiKey = flag('api-key', process.env.DEEPSEEK_API_KEY || '')
const verbose = argv.includes('--verbose')

let rs = seed
const rand = () => { rs = (rs * 1103515245 + 12345) % 2147483648; return rs / 2147483648 }
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const dayOf = (offset) => new Date(Date.now() - offset * 86400000).toLocaleDateString('sv-SE')

// 事实模板：{topic, what, probe, affect}
const TOPICS = [
  { topic: 'cat', zhWhat: '主人家的猫生病了，带去医院打了针', zhProbe: '猫咪现在怎么样了', what: 'the cat was sick and the user took it to the vet', probe: 'how is the cat doing', affect: -2 },
  { topic: 'cycling', zhWhat: '主人骑车二十公里，回来腿酸得厉害', zhProbe: '我腿还是有点酸', what: 'the user rode 20km and came back with sore legs', probe: 'my legs hurt after cycling', affect: 0 },
  { topic: 'exam', zhWhat: '主人下周有应用密码学考试', zhProbe: '考试准备得怎么样', what: 'the user has a cryptography exam next week', probe: 'the exam is coming', affect: -1 },
  { topic: 'coffee', zhWhat: '主人买了一包新咖啡豆', zhProbe: '新买的咖啡豆好喝吗', what: 'the user bought a new bag of coffee beans', probe: 'the new coffee beans', affect: 1 },
  { topic: 'job', zhWhat: '主人投了一家创业公司的实习', zhProbe: '实习那事有消息了吗', what: 'the user applied for an internship at a startup', probe: 'my internship application', affect: 1 },
  { topic: 'sleep', zhWhat: '主人连续一周凌晨三点才睡', zhProbe: '最近还熬夜吗', what: 'the user has been sleeping at 3am for a week', probe: 'I keep sleeping late', affect: -1 },
  { topic: 'friend', zhWhat: '主人和多年朋友吵架了，心里难受', zhProbe: '和朋友那件事过去了没', what: 'the user argued with an old friend and felt bad', probe: 'that argument with my friend', affect: -2 },
  { topic: 'guitar', zhWhat: '主人开始学吉他和弦', zhProbe: '吉他最近还练吗', what: 'the user started learning guitar chords', probe: 'guitar practice', affect: 1 },
  { topic: 'trip', zhWhat: '主人计划周末去山里玩', zhProbe: '周末去山里的事定了吗', what: 'the user planned a weekend trip to the mountains', probe: 'the mountain trip plan', affect: 1 },
  { topic: 'wallet', zhWhat: '主人丢了钱包，后来找回来了', zhProbe: '钱包找到了没', what: 'the user lost a wallet and found it later', probe: 'I lost my wallet', affect: -1 },
]

const NOISE = [
  'today is sunny', 'the user said hello', 'the agent said good morning',
  'the user laughed', 'the agent told a joke', 'the user said good night',
]

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-bench-'))
  return path.join(dir, 'm.db')
}

async function runMock() {
  const hip = await createHippocampus({ db: makeDb() })
  const facts = []
  let noiseCount = 0

  for (let d = days; d >= 0; d--) {
    const day = dayOf(d)
    // 每 4 天埋一件事（情绪高的更可能重复出现）
    if (d % 4 === 0) {
      const t = pick(TOPICS)
      const repeat = Math.abs(t.affect) >= 2 && rand() < 0.5 ? 2 : 1
      for (let k = 0; k < repeat; k++) {
        hip.addEvent({ day, who: 'user', topic: t.topic, what: t.what, detail: t.what, affect: t.affect })
        facts.push({ day, age: d, ...t })
      }
    }
    // 每天若干噪音
    const n = 1 + Math.floor(rand() * 3)
    for (let k = 0; k < n; k++) {
      hip.addEvent({ day, who: 'user', topic: 'misc', what: pick(NOISE), affect: 0 })
      noiseCount++
    }
    // 每 10 天重放一次
    if (d % 10 === 0) await hip.replay()
  }
  await hip.replay()

  // ---- 探测 ----
  const buckets = { '7d': { hit: 0, n: 0, clear: 0 }, '30d': { hit: 0, n: 0, clear: 0 }, '60d': { hit: 0, n: 0, clear: 0 } }
  for (const f of facts) {
    const bucket = f.age <= 7 ? '7d' : f.age <= 30 ? '30d' : '60d'
    const items = hip.recall(f.probe)
    buckets[bucket].n++
    const hit = items.find((i) => i.what.toLowerCase().includes(f.topic) || f.what.toLowerCase().includes(f.topic))
    if (hit) {
      buckets[bucket].hit++
      if (hit.level === 'clear' || hit.level === '记得清') buckets[bucket].clear++
    }
  }

  // ---- 情绪保留 ----
  const rows = hip.db.prepare('select affect, avg(strength) s, count(*) n from events group by affect').all()
  const neutral = rows.find((r) => r.affect === 0)?.s || 0
  const emotional = rows.filter((r) => Math.abs(r.affect) >= 1).reduce((a, r) => a + r.s * r.n, 0) /
    (rows.filter((r) => Math.abs(r.affect) >= 1).reduce((a, r) => a + r.n, 0) || 1)

  // ---- 误召 ----
  const unrelated = hip.recall('quantum chromodynamics lattice gauge theory')
  const stats = hip.stats()
  hip.close()

  console.log(`\n=== MOCK BENCH (${days} days, ${facts.length} planted facts, ${noiseCount} noise events) ===`)
  console.log('recall@3 by age:')
  for (const [k, v] of Object.entries(buckets)) {
    const pct = v.n ? Math.round((v.hit / v.n) * 100) : 0
    console.log(`  ${k.padEnd(4)} n=${String(v.n).padStart(3)}  hit=${String(v.hit).padStart(3)} (${pct}%)  clear=${v.clear}`)
  }
  console.log(`emotion retention: neutral avg=${neutral.toFixed(3)}  emotional avg=${emotional.toFixed(3)}  ratio=${(emotional / (neutral || 1)).toFixed(2)}x`)
  console.log(`false recall (unrelated query): ${unrelated.length} items`)
  console.log(`store: ${stats.events} events, ${stats.edges} edges, avg strength ${stats.avgStrength}`)
  return { buckets, neutral, emotional, unrelated: unrelated.length, stats }
}

async function runLLM() {
  if (!apiKey) throw new Error('llm mode needs --api-key or DEEPSEEK_API_KEY')
  const hip = await createHippocampus({ db: makeDb(), apiKey, language: 'zh' })
  const dialogues = []
  // 10 天，每天 2 轮对话，其中一半含事实
  for (let d = 9; d >= 0; d--) {
    const t = TOPICS[(9 - d) % TOPICS.length]
    dialogues.push({
      day: dayOf(d),
      turns: [
        { at: new Date(Date.now() - d * 86400000).toISOString(), user: t.zhWhat, reply: '记住了，我记着这事。' },
        { at: new Date(Date.now() - d * 86400000 + 60000).toISOString(), user: pick(NOISE), reply: '嗯。' },
      ],
      fact: t,
    })
  }
  const turns = dialogues.flatMap((d) => d.turns)
  if (verbose) console.log(`encoding ${turns.length} turns...`)
  const enc = await hip.encode(turns)
  await hip.replay()

  let hit = 0
  for (const d of dialogues) {
    const items = hip.recall(d.fact.zhProbe || d.fact.probe)
    if (items.length) hit++
  }
  const stats = hip.stats()
  hip.close()
  console.log(`\n=== LLM BENCH (10 days, ${turns.length} turns) ===`)
  console.log(`extracted events: ${enc.events}`)
  console.log(`recall@3 hit: ${hit}/${dialogues.length}`)
  console.log(`store: ${stats.events} events, ${stats.edges} edges`)
  return { enc, hit, total: dialogues.length, stats }
}

const result = mode === 'llm' ? await runLLM() : await runMock()
console.log('\nJSON:', JSON.stringify(result))

#!/usr/bin/env node
/**
 * Full test suite: seeds, ablations, dense facts, paraphrase, long-gap merging.
 *
 *   node bench/suite.mjs              # mock scenarios only (no model needed)
 *   node bench/suite.mjs --llm        # also run extraction-quality scenarios
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHippocampus } from '../src/index.mjs'

const argv = process.argv.slice(2)
const withLLM = argv.includes('--llm')
const apiKey = (() => {
  const i = argv.indexOf('--api-key')
  return i >= 0 ? argv[i + 1] : process.env.DEEPSEEK_API_KEY || ''
})()

const TOPICS = [
  { t: 'cat', what: '主人家的猫生病，带去医院打针', probe: '猫咪怎么样了', affect: -2 },
  { t: 'cycling', what: '主人骑车二十公里，腿酸', probe: '腿还疼不疼', affect: 0 },
  { t: 'exam', what: '主人下周有密码学考试', probe: '考试准备得怎么样', affect: -1 },
  { t: 'coffee', what: '主人买了新咖啡豆', probe: '咖啡豆好喝吗', affect: 1 },
  { t: 'job', what: '主人投了创业公司实习', probe: '实习有消息吗', affect: 1 },
  { t: 'sleep', what: '主人一周凌晨三点睡', probe: '还熬夜吗', affect: -1 },
  { t: 'friend', what: '主人和多年朋友吵架', probe: '和朋友那事过去没', affect: -2 },
  { t: 'guitar', what: '主人开始学吉他和弦', probe: '吉他还练吗', affect: 1 },
  { t: 'trip', what: '主人计划周末去山里', probe: '山里那事定了吗', affect: 1 },
  { t: 'wallet', what: '主人丢了钱包又找回', probe: '钱包找到没', affect: -1 },
]
const NOISE = ['今天天气不错', '主人说你好', '她说了句早安', '主人笑了一下', '她讲了个笑话', '主人说晚安']

const iso = (d) => new Date(Date.now() - d * 86400000).toISOString()
const dayOf = (d) => iso(d).slice(0, 10)
const mkdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-suite-'))

function rng(seed) {
  let s = seed
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
}

async function scenarioBaseline({ seed, days = 90, cfg = {} }) {
  const hip = await createHippocampus({ db: path.join(mkdir(), 'm.db'), ...cfg })
  const rand = rng(seed)
  const facts = []
  for (let d = days; d >= 0; d--) {
    if (d % 3 === 0) {
      const f = TOPICS[Math.floor(rand() * TOPICS.length)]
      const times = Math.abs(f.affect) >= 2 && rand() < 0.5 ? 2 : 1
      for (let k = 0; k < times; k++) {
        hip.addEvent({ day: dayOf(d), who: 'user', topic: f.t, what: f.what, detail: f.what, affect: f.affect })
        facts.push({ age: d, ...f })
      }
    }
    for (let k = 0, n = 1 + Math.floor(rand() * 3); k < n; k++) {
      hip.addEvent({ day: dayOf(d), who: 'user', topic: 'misc', what: NOISE[Math.floor(rand() * NOISE.length)], affect: 0 })
    }
    if (d % 10 === 0) await hip.replay()
  }
  await hip.replay()

  const hits = { 1: 0, 3: 0, 5: 0 }
  const old = { n: 0, hit: 0 }   // 只统计 60 天以上的事实，衰减才有区分度
  let n = 0
  for (const f of facts) {
    const items = hip.recall(f.probe)
    n++
    const found = items.some((i) => i.what.includes(f.what.slice(0, 4)) || f.what.includes(i.what.slice(0, 2)))
    if (found) hits[1]++
    if (items.slice(0, 3).some((i) => i.what.includes(f.what.slice(0, 4)))) hits[3]++
    if (items.length) hits[5]++
    if (f.age > 60) { old.n++; if (found) old.hit++ }
  }
  const rows = hip.db.prepare('select affect, avg(strength) s, count(*) n from events group by affect').all()
  const neutral = rows.find((r) => r.affect === 0)?.s || 0
  const emoRows = rows.filter((r) => Math.abs(r.affect) >= 1)
  const emotional = emoRows.length
    ? emoRows.reduce((a, r) => a + r.s * r.n, 0) / emoRows.reduce((a, r) => a + r.n, 0)
    : 0
  const falseRecall = hip.recall('量子色动力学格点规范理论').length
  const stats = hip.stats()
  hip.close()
  return { n, hits, old, neutral, emotional, falseRecall, stats }
}

async function scenarioLongGap() {
  const hip = await createHippocampus({ db: path.join(mkdir(), 'm.db') })
  hip.addEvent({ day: dayOf(70), who: 'user', topic: 'cycling', what: '主人第一次骑车腿酸', affect: 0 })
  hip.addEvent({ day: dayOf(1), who: 'user', topic: 'cycling', what: '主人又骑车了，这次不酸了', affect: 0 })
  const before = hip.stats().events
  await hip.replay()
  const after = hip.stats().events
  const items = hip.recall('骑车')
  hip.close()
  return { before, after, kept: after === 2, recall: items.map((i) => `${i.what}(${i.level})`) }
}

async function scenarioParaphrase() {
  const hip = await createHippocampus({ db: path.join(mkdir(), 'm.db'), ...(withLLM && apiKey ? { apiKey, language: 'zh' } : {}) })
  hip.addEvent({ day: dayOf(3), who: 'user', topic: 'cycling', what: '主人骑车二十公里腿酸', affect: 0 })
  const same = hip.recall('腿还疼不疼')
  const diff = hip.recall('运动之后的肌肉疼')   // 与原文几乎不共字
  let deep = null
  if (withLLM && apiKey) {
    const r = await hip.recallDeep('运动之后的肌肉疼')
    deep = { via: r.via, hits: r.items.length, expansions: r.expansions }
  }
  hip.close()
  return { same: same.length, diff: diff.length, deep }
}

async function scenarioDenseFacts() {
  if (!withLLM || !apiKey) return null
  const hip = await createHippocampus({ db: path.join(mkdir(), 'm.db'), apiKey, language: 'zh', encode: { maxPerBatch: 6, batchTurns: 6 } })
  const turns = [
    { at: iso(2), user: '猫生病了带去医院，顺便买了咖啡豆，下周还要考试', reply: '记住了。' },
    { at: iso(1), user: '骑车腿酸，和朋友吵架了，吉他也没练', reply: '知道了。' },
  ]
  const enc = await hip.encode(turns)
  const probes = ['猫怎么样了', '咖啡豆好喝吗', '考试准备如何', '腿酸不酸', '朋友那事', '吉他练了吗']
  const hits = probes.filter((p) => hip.recall(p).length).length
  hip.close()
  return { turns: turns.length, events: enc.events, probes: probes.length, hits }
}

async function scenarioAblation() {
  const runs = {}
  for (const [name, cfg] of Object.entries({
    'full': {},
    'no-emotion': { decay: { emotionBoost: 0 } },
    'no-hop': { recall: { hop: 0 } },
    'fast-forget': { decay: { base: 0.85 } },
  })) {
    const r = await scenarioBaseline({ seed: 7, days: 90, cfg })
    runs[name] = {
      recall1: r.hits[1],
      n: r.n,
      oldRecall: r.old.n ? Math.round((r.old.hit / r.old.n) * 100) : null,
      emoRatio: r.emotional / (r.neutral || 1),
    }
  }
  return runs
}

const out = {}
out.baseline = []
for (const seed of [1, 7, 42]) out.baseline.push(await scenarioBaseline({ seed, days: 90 }))
out.longGap = await scenarioLongGap()
out.paraphrase = await scenarioParaphrase()
out.ablation = await scenarioAblation()
out.dense = await scenarioDenseFacts()

const avg = (arr, f) => arr.reduce((a, x) => a + f(x), 0) / arr.length

console.log('\n=== 1) baseline: 90 simulated days × 3 seeds ===')
for (const [i, r] of out.baseline.entries()) {
  console.log(`  seed#${[1, 7, 42][i]} facts=${r.n} recall@1=${r.hits[1]} recall@3=${r.hits[3]} recall@any=${r.hits[5]} falseRecall=${r.falseRecall} avgStrength=${r.stats.avgStrength}`)
}
console.log(`  means: recall@1=${avg(out.baseline, (r) => r.hits[1] / r.n * 100).toFixed(0)}% recall@3=${avg(out.baseline, (r) => r.hits[3] / r.n * 100).toFixed(0)}% emotion=${avg(out.baseline, (r) => r.emotional / (r.neutral || 1)).toFixed(2)}x`)

console.log('\n=== 2) long-gap merge (same topic, 70 days apart) ===')
console.log(`  events before=${out.longGap.before} after=${out.longGap.after} keptBoth=${out.longGap.kept}`)
console.log(`  recall: ${out.longGap.recall.join(' | ')}`)

console.log('\n=== 3) paraphrase (probe shares almost no characters) ===')
console.log(`  same-wording hits=${out.paraphrase.same} different-wording hits=${out.paraphrase.diff}`)
if (out.paraphrase.deep) {
  console.log(`  deep recall: via=${out.paraphrase.deep.via} hits=${out.paraphrase.deep.hits} expansions=[${out.paraphrase.deep.expansions.join(' ')}]`)
} else {
  console.log('  deep recall: skipped (needs --llm --api-key)')
}

console.log('\n=== 4) ablation (60 days, seed 7) ===')
for (const [k, v] of Object.entries(out.ablation)) {
  console.log(`  ${k.padEnd(12)} recall@1=${v.recall1}/${v.n} oldRecall=${v.oldRecall}% emotion=${v.emoRatio.toFixed(2)}x`)
}

if (out.dense) {
  console.log('\n=== 5) dense facts (3 facts per turn, LLM extraction) ===')
  console.log(`  turns=${out.dense.turns} events=${out.dense.events} probe hits=${out.dense.hits}/${out.dense.probes}`)
} else {
  console.log('\n=== 5) dense facts: skipped (needs --llm --api-key) ===')
}

fs.mkdirSync('bench/results', { recursive: true })
const file = `bench/results/${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
fs.writeFileSync(file, JSON.stringify(out, null, 2))
console.log(`\nwritten: ${file}`)

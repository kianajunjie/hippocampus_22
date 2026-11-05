#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createHippocampus } from './src/index.mjs'

const [, , cmd, ...rest] = process.argv
const flags = {}
const positional = []
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const k = rest[i].slice(2)
    const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true
    flags[k] = v
  } else {
    positional.push(rest[i])
  }
}

function usage() {
  console.log(`dsh-hippocampus — memory for a companion bot (the 大肥鱼 kind)

  dsh-hippocampus encode --turns <file.json> [--db path]
  dsh-hippocampus replay        [--db path]
  dsh-hippocampus recall "text" [--subject 主人] [--db path]
  dsh-hippocampus remember "text" [--subject 主人] [--pin] [--topic fear]
  dsh-hippocampus context [--subject 主人] ["这轮说的话"]
  dsh-hippocampus list [n] | audit | stats
  dsh-hippocampus rel 主人 | rel-shift 主人 intimacy:1 unresolved:1 why:吵架
  dsh-hippocampus fact-add 主人 住在 杭州 | facts 主人
  dsh-hippocampus chapter-add 2026-10 2026-11 "开始养她" "吵架、买娃娃"
  dsh-hippocampus skill-add 剪视频 "剪,视频" "去静音+whisper"
  dsh-hippocampus gap-add "quokkacore" "群友提过"
  dsh-hippocampus demo
  dsh-hippocampus encode --turns turns.json

Options: --db, --api-key, --model, --base-url, --lang zh|en

turns.json: [{"at":"2026-11-01T12:00:00Z","user":"...","reply":"..."}]
`)
}

const config = {
  db: flags.db || undefined,
  apiKey: flags['api-key'] || undefined,
  model: flags.model || undefined,
  baseUrl: flags['base-url'] || undefined,
  language: flags.lang || undefined,
}

if (!cmd) {
  usage()
  process.exit(0)
}

const hip = await createHippocampus(config)

if (cmd === 'encode') {
  const file = flags.turns
  if (!file) { usage(); process.exit(2) }
  const turns = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
  const r = await hip.encode(turns)
  console.log(JSON.stringify(r))
} else if (cmd === 'replay') {
  const r = await hip.replay()
  console.log(JSON.stringify(r))
} else if (cmd === 'recall') {
  const text = positional.join(' ')
  console.log(hip.recallText(text, { subject: flags.subject }) || '(nothing)')
} else if (cmd === 'remember') {
  const text = positional.join(' ')
  const r = hip.remember(text, { subject: flags.subject, topic: flags.topic, pin: !!flags.pin, affect: Number(flags.affect) || 0 })
  console.log(JSON.stringify(r))
} else if (cmd === 'list') {
  for (const e of hip.list(Number(flags.limit) || 20)) {
    console.log(`${e.day} [${e.subject || '-'}] ${e.pinned ? '📌' : '  '} ${e.what}  (${e.strength.toFixed(2)})`)
  }
} else if (cmd === 'context') {
  console.log(hip.context({ subject: flags.subject || '主人', text: positional.join(' ') }) || '(空)')
} else if (cmd === 'rel') {
  const who = positional[0]
  console.log(who ? hip.relationLine(who) : hip.relationLine('主人'))
} else if (cmd === 'rel-shift') {
  const who = positional[0]
  const d = {}
  for (const kv of positional.slice(1)) { const [k, v] = kv.split(':'); d[k] = k === 'why' ? v : Number(v) || 0 }
  console.log(JSON.stringify(hip.relation(who, d)))
} else if (cmd === 'fact-add') {
  console.log(JSON.stringify({ id: hip.fact(positional[0], positional[1], positional[2]) }))
} else if (cmd === 'facts') {
  console.log(hip.facts(positional[0] || '').join('\n') || '(没有事实)')
} else if (cmd === 'chapter-add') {
  console.log(JSON.stringify({ id: hip.chapter(positional[0], positional[1], positional[2], positional.slice(3).join(' ')) }))
} else if (cmd === 'chapter') {
  const c = hip.latestChapter()
  console.log(c ? `${c.period_from}~${c.period_to} ${c.title}：${c.summary}` : '(还没有章节)')
} else if (cmd === 'skill-add') {
  console.log(JSON.stringify({ id: hip.skill(positional[0], positional[1], positional.slice(2).join(' ')) }))
} else if (cmd === 'gap-add') {
  console.log(JSON.stringify({ id: hip.gap(positional[0], positional.slice(1).join(' ')) }))
} else if (cmd === 'gaps') {
  console.log(hip.gaps().map((g) => g.term).join('、') || '(没有缺口)')
} else if (cmd === 'audit') {
  console.log(JSON.stringify(hip.audit(), null, 2))
} else if (cmd === 'stats') {
  console.log(JSON.stringify(hip.stats()))
} else if (cmd === 'demo') {
  // 不需要模型：直接塞几条事件，演示衰减与召回
  const today = new Date().toLocaleDateString('sv-SE')
  const old = new Date(Date.now() - 10 * 86400000).toLocaleDateString('sv-SE')
  const a = hip.addEvent({ day: old, who: 'user', topic: 'cycling', what: 'user said cycling home left the legs sore', affect: 1 })
  const b = hip.addEvent({ day: today, who: 'user', topic: 'cycling', what: 'user mentioned legs still sore today', detail: 'legs sore / rest a bit', affect: -1 })
  const c = hip.addEvent({ day: today, who: 'agent', topic: 'care', what: 'she told the user to stretch before bed', detail: 'stretch before bed', affect: 2 })
  hip.link(b, c)
  console.log('seeded', { a, b, c })
  console.log('--- recall "legs" ---')
  console.log(hip.recallText('legs') || '(nothing)')
  const r = await hip.replay()
  console.log('--- replay ---')
  console.log(JSON.stringify(r))
  console.log('--- stats ---')
  console.log(JSON.stringify(hip.stats()))
} else {
  usage()
}
hip.close()

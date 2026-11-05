#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createHippocampus } from './src/index.mjs'
import { parseArgs, listCount } from './src/cli-args.mjs'
import { formatHealth } from './src/health.mjs'

const [, , cmd, ...rest] = process.argv
const { flags, positional } = parseArgs(rest)

function usage() {
  console.log(`hippocampus_22 — 陪伴型机器人的情感记忆层
  可执行名：hippo / hippocampus-22（源码目录里也可以 node cli.mjs <命令>）

  hippo encode --turns <file.json> [--db path]
  hippo replay        [--db path]
  hippo recall "text" [--subject 主人] [--db path]
  hippo remember "text" [--subject 主人] [--pin] [--topic fear]
  hippo context [--subject 主人] ["这轮说的话"]
  hippo list [n] | audit | stats
  hippo health                      记忆体检测：强度、快见底的、没解开的疙瘩
  hippo rel 主人 | rel-shift 主人 intimacy:1 unresolved:1 why:吵架
  hippo fact-add 主人 住在 杭州 | facts 主人
  hippo chapter-add 2026-10 2026-11 "开始养她" "吵架、买娃娃"
  hippo skill-add 剪视频 "剪,视频" "去静音+whisper"
  hippo gap-add "quokkacore" "群友提过"
  hippo demo
  hippo export --out memory.json     导出整份记忆（不给 --out 就打 stdout）
  hippo import --in memory.json [--mode merge|replace]
  hippo forget [--topic fight] [--older-than 30] [--dry-run] [--force] [--hard]

Options: --db, --api-key, --model, --base-url, --lang zh|en
Docs: docs/cli.md

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
  for (const e of hip.list(listCount(positional, flags))) {
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
} else if (cmd === 'health') {
  console.log(formatHealth(hip.health(), config.language || hip.cfg.language || 'zh'))
} else if (cmd === 'export') {
  const dump = hip.exportMemory()
  const out = flags.out || flags.file
  const text = JSON.stringify(dump, null, 2)
  if (out) {
    fs.writeFileSync(path.resolve(out), text)
    const rows = Object.values(dump.counts).reduce((a, b) => a + b, 0)
    console.log(`导出完成：${rows} 行 -> ${out}`)
  } else {
    console.log(text)
  }
} else if (cmd === 'import') {
  const file = flags.in || flags.file || positional[0]
  if (!file) { usage(); process.exit(2) }
  const data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
  const r = hip.importMemory(data, { mode: flags.mode || 'merge' })
  const rows = Object.values(r.imported).reduce((a, b) => a + b, 0)
  console.log(`导入完成（${r.mode}）：${rows} 行`)
} else if (cmd === 'forget') {
  const r = hip.forget({
    id: flags.id,
    topic: flags.topic,
    subject: flags.subject,
    olderThan: flags.older ?? flags['older-than'],
    force: !!flags.force,
    hard: !!flags.hard,
    dryRun: !!flags['dry-run'] || !!flags.dryRun,
  })
  if (!r.matched) {
    console.log(`没有匹配到可遗忘的记忆${r.skipped ? `（${r.skipped} 条置顶的没动，需要 --force）` : ''}`)
  } else if (r.dryRun) {
    console.log(`将遗忘 ${r.matched} 条（--dry-run，未落库）：`)
    for (const e of r.events) console.log(`  #${e.id} ${e.day} ${e.what}`)
  } else {
    console.log(`已遗忘 ${r.matched} 条（${r.mode}）：${r.ids.join(', ')}`)
  }
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

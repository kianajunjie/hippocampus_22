/**
 * 人读的记忆档案。
 *
 * 数据库不是给人看的，`list` 也不是。想把"她记住了什么"贴进博客、发给朋友、
 * 或者三个月后自己复盘时翻一翻，就用这个：一份 Markdown，按层排好。
 * 纯只读，不改数据。
 */
import { localDay } from './health.mjs'

const LABEL = {
  zh: {
    title: '记忆档案',
    overview: '概览',
    relation: '关系',
    facts: '事实（当前有效）',
    chapter: '最近的章节',
    recent: '最近发生的事',
    skills: '我会的技能',
    gaps: '还没搞懂的',
    superseded: '已经作废的（她改了口）',
    pinned: '置顶',
    empty: '这份记忆还是空的。',
    none: '（无）',
    exported: '导出于',
    strength: '强度',
    unresolved: '没解开的疙瘩',
    every: '全部',
  },
  en: {
    title: 'Memory archive',
    overview: 'Overview',
    relation: 'Relationship',
    facts: 'Facts (current)',
    chapter: 'Latest chapter',
    recent: 'Recent events',
    skills: 'Skills',
    gaps: 'Unknowns',
    superseded: 'Superseded (she changed her mind)',
    pinned: 'pinned',
    empty: 'This memory is still empty.',
    none: '(none)',
    exported: 'exported at',
    strength: 'strength',
    unresolved: 'unresolved knots',
    every: 'everyone',
  },
}

export function memoryReport(db, { subject = '', today = localDay(), recent = 10, language = 'zh' } = {}) {
  const t = LABEL[language === 'en' ? 'en' : 'zh']
  const all = db.prepare('select id,day,who,topic,what,strength,pinned,superseded,subject from events order by day desc, id desc').all()
  const scoped = subject ? all.filter((r) => r.subject === subject) : all
  const active = scoped.filter((r) => !r.superseded)
  const superseded = scoped.filter((r) => r.superseded)

  const out = []
  out.push(`# ${t.title}${subject ? ` · ${subject}` : ` · ${t.every}`}`)
  out.push(`> ${t.exported} ${today} · hippocampus_22`)
  out.push('')

  if (!scoped.length) {
    out.push(t.empty)
    return out.join('\n')
  }

  const avg = active.length
    ? Math.round((active.reduce((a, r) => a + (r.strength ?? 1), 0) / active.length) * 100) / 100
    : 0
  out.push(`## ${t.overview}`)
  out.push(`- events: ${active.length} active / ${superseded.length} superseded / ${scoped.filter((r) => r.pinned).length} ${t.pinned}`)
  out.push(`- ${t.strength}: ${avg}`)
  if (subject) {
    const rel = db.prepare('select trust, intimacy, unresolved from relations where subject=?').get(subject)
    if (rel) out.push(`- ${t.relation}: intimacy ${rel.intimacy} / trust ${rel.trust} / ${t.unresolved} ${rel.unresolved}`)
  }
  out.push('')

  if (subject) {
    const facts = db.prepare("select relation, object, valid_from from facts where subject=? and (valid_to is null or valid_to='') order by id desc").all(subject)
    out.push(`## ${t.facts}`)
    out.push(facts.length ? facts.map((f) => `- ${f.relation}：${f.object}（自 ${f.valid_from}）`).join('\n') : t.none)
    out.push('')
  }

  const ch = db.prepare('select period_from, period_to, title, summary from chapters order by id desc limit 1').get()
  out.push(`## ${t.chapter}`)
  out.push(ch ? `- ${ch.period_from}~${ch.period_to} **${ch.title}**：${ch.summary}` : t.none)
  out.push('')

  out.push(`## ${t.recent}`)
  if (active.length) {
    for (const r of active.slice(0, recent)) {
      out.push(`- \`${r.day}\` ${r.pinned ? '📌 ' : ''}${r.who || 'user'}：${r.what}（${t.strength} ${round(r.strength)}）`)
    }
  } else {
    out.push(t.none)
  }
  out.push('')

  const skills = db.prepare('select name, keywords, steps from skills order by id').all()
  out.push(`## ${t.skills}`)
  out.push(skills.length ? skills.map((s) => `- **${s.name}**（${s.keywords}）：${s.steps}`).join('\n') : t.none)
  out.push('')

  const gaps = db.prepare('select term, note from gaps where asked=0 order by id desc').all()
  out.push(`## ${t.gaps}`)
  out.push(gaps.length ? gaps.map((g) => `- ${g.term}${g.note ? `：${g.note}` : ''}`).join('\n') : t.none)
  out.push('')

  if (superseded.length) {
    out.push(`## ${t.superseded}`)
    for (const r of superseded.slice(0, recent)) out.push(`- \`${r.day}\` ${r.what}`)
    out.push('')
  }

  return out.join('\n').trimEnd() + '\n'
}

function round(n) {
  return Math.round((n ?? 1) * 100) / 100
}

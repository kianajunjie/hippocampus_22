import { daysBetween } from './store.mjs'

export function candidates(text, max = 12) {
  const raw = String(text || '')
  const out = new Set()

  // 英文：整词优先（比字符片段准）
  for (const w of raw.toLowerCase().match(/[a-z]{3,}/g) || []) {
    if (out.size >= max) break
    if (!STOPWORDS.has(w)) out.add(w)
  }

  // 中文：2~4 字片段
  const han = raw.replace(/[^\p{Script=Han}]/gu, '')
  for (let n = 4; n >= 2; n--) {
    for (let i = 0; i + n <= han.length && out.size < max; i++) out.add(han.slice(i, i + n))
  }

  if (!out.size) out.add(String(text || '').trim().slice(0, 8))
  return [...out].filter(Boolean)
}

const STOPWORDS = new Set(['the', 'and', 'for', 'was', 'were', 'that', 'this', 'with', 'have', 'has', 'had',
  'how', 'what', 'when', 'where', 'who', 'why', 'are', 'you', 'your', 'its', 'it', 'my', 'me', 'is',
  'doing', 'did', 'does', 'about', 'after', 'before', 'still', 'just', 'not', 'but', 'from', 'they'])


export function recall({ db, cfg, text, today, subject }) {
  const terms = candidates(text)
  if (!terms.length) return []
  // 单元字也当弱线索（"猫" 能命中 "猫生病了"）
  const singles = [...new Set(String(text).replace(/[^\p{Script=Han}]/gu, ''))]
    .filter((c) => !STOP_CHARS.has(c)).slice(0, 6)
  const allTerms = [...new Set([...terms, ...singles])]
  const cond = allTerms.map(() => '(what like ? or topic like ?)').join(' or ')
  const params = allTerms.flatMap((t) => [`%${t}%`, `%${t}%`])
  // 按人隔离：只看这场对话相关的记忆（没标 subject 的算通用）
  const scope = subject ? ' and (subject = \'\' or subject = ?)' : ''
  const scopeParams = subject ? [subject] : []

  // 多取一些，再按"命中词数"重排
  let rows = db.prepare(`select id,day,who,topic,what,detail,strength from events
    where (${cond})${scope} and strength >= ? and superseded = 0
    order by strength desc, day desc limit ?`).all(...params, ...scopeParams, cfg.recall.minStrength ?? 0.1, cfg.recall.limit * 4)

  const score = (r) => {
    const hay = `${r.topic || ''} ${r.what}`.toLowerCase()
    let strong = 0
    let weak = 0
    for (const t of terms) if (hay.includes(t.toLowerCase())) strong++
    for (const t of singles) if (hay.includes(t)) weak++
    return { strong, weak, total: strong * 2 + weak }
  }
  const shortQuery = String(text).replace(/[^\p{Script=Han}]/gu, '').length <= 8
  rows = rows.map((r) => ({ ...r, _m: score(r) }))
    // 只有弱命中时：短问题允许 1 个，长问题至少要 2 个，避免乱命中
    .filter((r) => r._m.strong > 0 || r._m.weak >= (shortQuery ? 1 : 2))
    .sort((a, b) => b._m.total - a._m.total || b.strength - a.strength)
    .slice(0, cfg.recall.limit)

  if (rows.length) {
    const ids = rows.map((r) => r.id)
    const ph = ids.map(() => '?').join(',')
    const extra = db.prepare(`select e.id,e.day,e.who,e.what,e.detail,e.strength
      from edges ed join events e on e.id = ed.b
      where ed.a in (${ph}) and e.id not in (${ph})
      order by e.strength desc limit ?`).all(...ids, ...ids, cfg.recall.hop)
    rows = rows.concat(extra.map((r) => ({ ...r, _s: 1 })))
    db.prepare(`update events set last_recall=? where (${cond})`).run(today, ...params)
  }
  return rows.slice(0, cfg.recall.limit + cfg.recall.hop).map((r) => {
    const age = daysBetween(r.day, today)
    const level = r.detail && age <= cfg.confidence.clearDays
      ? (cfg.language === 'en' ? 'clear' : '记得清')
      : age <= cfg.confidence.vagueDays
        ? (cfg.language === 'en' ? 'roughly' : '大概记得')
        : (cfg.language === 'en' ? 'barely' : '只记得有这回事')
    return { day: r.day, who: r.who, what: r.what, level, strength: r.strength }
  })
}

/**
 * Hybrid recall: lexical first; if it comes back empty and we have an LLM,
 * expand the query into paraphrases and try again. Optionally use an injected
 * embedder for semantic similarity.
 *
 * @param {object} opts
 * @param {(text: string) => Promise<number[]>} [opts.embedder]
 */
export async function recallHybrid({ db, cfg, text, today, llm, expandQuery, embedder, subject }) {
  const lexical = recall({ db, cfg, text, today, subject })
  if (lexical.length) return { items: lexical, via: 'lexical', expansions: [] }

  // 1) 语义向量（如果调用方提供了 embedder）
  if (embedder) {
    try {
      const qv = await embedder(text)
      const rows = db.prepare(`select id,day,who,what,detail,strength,vec from events
        where strength >= ? and superseded = 0${subject ? " and (subject = '' or subject = ?)" : ''}`)
        .all(...[cfg.recall.minStrength ?? 0.1, ...(subject ? [subject] : [])])
      const scored = rows
        .map((r) => ({ r, s: cosine(qv, JSON.parse(r.vec || '[]')) }))
        .filter((x) => x.s > 0.2)
        .sort((a, b) => b.s - a.s)
        .slice(0, cfg.recall.limit)
      if (scored.length) {
        return {
          items: scored.map(({ r }) => decorate(r, today, cfg)),
          via: 'vector',
          expansions: [],
        }
      }
    } catch { /* fall through to expansion */ }
  }

  // 2) 让模型把它改写成能命中的说法
  if (llm && expandQuery) {
    const extra = await expandQuery(llm, cfg, text)
    for (const term of extra) {
      const items = recall({ db, cfg, text: term, today, subject })
      if (items.length) return { items, via: 'expanded', expansions: extra }
    }
    return { items: [], via: 'none', expansions: extra }
  }

  return { items: [], via: 'none', expansions: [] }
}

function decorate(r, today, cfg) {
  const age = daysBetween(r.day, today)
  const level = r.detail && age <= cfg.confidence.clearDays
    ? (cfg.language === 'en' ? 'clear' : '记得清')
    : age <= cfg.confidence.vagueDays
      ? (cfg.language === 'en' ? 'roughly' : '大概记得')
      : (cfg.language === 'en' ? 'barely' : '只记得有这回事')
  return { day: r.day, who: r.who, what: r.what, level, strength: r.strength }
}

function cosine(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

const STOP_CHARS = new Set([...'的了是我你他她它们在和有不这那就都也很还吗呢吧啊嘛很太什么怎么能可以要会去来说对给把被让着过'])


export function formatRecall(items) {
  return items.map((i) => `${i.day} ${i.who}：${i.what}（${i.level}）`).join('\n')
}

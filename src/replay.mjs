import { daysBetween } from './store.mjs'

const IMPRESSION_ZH = '把今天记住的事写成 1-2 句印象，像人回忆那样，可以模糊，不要罗列。'
const IMPRESSION_EN = 'Write a 1-2 sentence impression of what was remembered today. Sound like a human recalling, allow vagueness, do not list.'

export async function replay({ db, llm, cfg, today }) {
  const rows = db.prepare('select id,day,who,topic,what,affect,strength,pinned,superseded from events order by id').all()
  const groups = new Map()
  for (const r of rows) {
    const k = `${r.who || ''}|${r.topic || ''}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(r)
  }
  let merged = 0
  let superseded = 0
  const windowMs = (cfg.decay.mergeWindowDays ?? 7) * 86400000
  for (const [, list] of groups) {
    if (list.length < 2) continue
    // 只在时间窗内合并：别把几个月前的同一主题抹成一条
    const newest = new Date(list[list.length - 1].day).getTime()
    const oldest = new Date(list[0].day).getTime()
    if (!Number.isFinite(newest) || !Number.isFinite(oldest) || newest - oldest > windowMs) continue
    const keep = list[list.length - 1]
    for (const r of list.slice(0, -1)) {
      // 说法相近 → 合并；说法不同 → 旧的作废（人改了主意，别自相矛盾）
      if (similar(keep.what, r.what)) {
        const strength = Math.min(cfg.decay.mergeCap, (r.strength || 1) + (keep.strength || 1))
        db.prepare('update events set strength=? where id=?').run(strength, keep.id)
        db.prepare('delete from events where id=?').run(r.id)
        merged++
      } else {
        db.prepare('update events set superseded=1 where id=?').run(r.id)
        superseded++
      }
    }
    const strength = Math.min(cfg.decay.mergeCap, list.reduce((a, r) => a + (r.strength || 1), 0))
    db.prepare('update events set strength=? where id=?').run(strength, keep.id)
  }
  for (const r of rows) {
    if (r.pinned) continue                       // 钉住的记忆不衰减
    if (r.superseded) continue                   // 已作废的不再衰减
    const age = daysBetween(r.day, today)
    if (age <= 0) continue
    const tau = 1 + Math.abs(r.affect || 0) * cfg.decay.emotionBoost
    const factor = Math.pow(cfg.decay.base, age / tau)
    db.prepare('update events set strength=max(?, ? * ?) where id=?')
      .run(cfg.decay.floor, r.strength || 1, factor, r.id)
  }
  let impression = ''
  if (llm) {
    const todayRows = db.prepare('select who,what from events where day=?').all(today)
    if (todayRows.length) {
      try {
        impression = await llm([
          { role: 'system', content: cfg.language === 'en' ? IMPRESSION_EN : IMPRESSION_ZH },
          { role: 'user', content: todayRows.map((r) => `${r.who}：${r.what}`).join('\n') },
        ], 200)
      } catch { impression = '' }
    }
  }
  return { merged, superseded, impression }
}

/** 说法相近就算同一件事（合并）；否则是改主意（作废旧条） */
function similar(a = '', b = '') {
  const clean = (s) => s.replace(/[^\p{Script=Han}A-Za-z0-9]/gu, '')
  const x = clean(a)
  const y = clean(b)
  if (!x || !y) return false
  const grams = new Set()
  for (let i = 0; i < x.length - 1; i++) grams.add(x.slice(i, i + 2))
  let hit = 0
  for (let i = 0; i < y.length - 1; i++) if (grams.has(y.slice(i, i + 2))) hit++
  const ratio = hit / Math.max(1, y.length - 1)
  return ratio >= 0.5
}

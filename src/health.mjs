/**
 * 记忆体检测。
 *
 * 记忆跑久了会有两种"病"：一种是**记不住**（事件太少、强度全部见底），
 * 另一种是**记太多**（作废的、重复的、快过期的堆在一起，召回被稀释）。
 * 这个模块只读数据库、不改任何东西，给出一份可以一眼看完的体检报告。
 */
import { daysBetween } from './store.mjs'

export function localDay(date = new Date()) {
  return date.toLocaleDateString('sv-SE')
}

const LAYERS = ['relations', 'facts', 'chapters', 'skills', 'gaps', 'identities', 'edges']

export function health(db, { today = localDay(), weakBelow = 0.2, staleDays = 45, language = 'zh' } = {}) {
  const zh = language !== 'en'
  const rows = db.prepare('select day, strength, pinned, superseded, subject from events').all()

  const active = rows.filter((r) => !r.superseded)
  const weak = active.filter((r) => !r.pinned && (r.strength ?? 1) < weakBelow)
  const stale = active.filter((r) => daysBetween(r.day, today) > staleDays)
  const pinned = active.filter((r) => r.pinned)
  const subjects = [...new Set(rows.map((r) => r.subject).filter(Boolean))]

  const events = {
    total: rows.length,
    active: active.length,
    superseded: rows.length - active.length,
    pinned: pinned.length,
    weak: weak.length,
    stale: stale.length,
    avgStrength: average(active.map((r) => r.strength ?? 1)),
  }

  const layers = Object.fromEntries(LAYERS.map((t) => [t, countRows(db, t)]))
  const knots = db.prepare('select subject, unresolved from relations where unresolved > 0 order by unresolved desc').all()
  const openGaps = countRows(db, 'gaps', 'asked = 0')

  const verdict = judge(events)
  return {
    today,
    events,
    layers,
    subjects: { count: subjects.length, names: subjects.slice(0, 10) },
    knots: knots.map((k) => ({ subject: k.subject, unresolved: k.unresolved })),
    openGaps,
    verdict,
    advice: advice({ events, layers, knots, openGaps, verdict, staleDays, zh }),
  }
}

function countRows(db, table, where = '') {
  const sql = `select count(*) as n from ${table}${where ? ` where ${where}` : ''}`
  return db.prepare(sql).get()?.n ?? 0
}

function average(nums) {
  if (!nums.length) return 0
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100
}

/** empty / starving / tired / healthy —— 只有四档，够用且不需要解释 */
function judge(events) {
  if (events.total === 0) return 'empty'
  if (events.active === 0) return 'starving'
  const weakRatio = events.active ? events.weak / events.active : 0
  if (events.avgStrength < 0.35 || weakRatio > 0.5) return 'tired'
  return 'healthy'
}

function advice({ events, layers, knots, openGaps, verdict, staleDays, zh }) {
  const out = []
  if (verdict === 'empty') {
    out.push(zh ? '还没记住任何事：先跑一次 encode 或 remember。' : 'Nothing remembered yet: run encode or remember first.')
    return out
  }
  if (verdict === 'starving') {
    out.push(zh ? '全部记忆都已作废：检查 replay 的合并规则，或从备份导入。' : 'Every memory is superseded: check replay merging rules or import a backup.')
  }
  if (events.weak > 0) {
    out.push(zh
      ? `${events.weak} 条记忆快到地板了（平均强度 ${events.avgStrength}）：最近没聊过的主题在自然变淡，属正常。`
      : `${events.weak} memories near the floor (avg ${events.avgStrength}): topics you stopped talking about are fading, which is expected.`)
  }
  if (events.stale > 0) {
    out.push(zh
      ? `${events.stale} 条超过 ${staleDays} 天没被召回：想留住的用 pin，不想留的用 forget。`
      : `${events.stale} memories older than ${staleDays} days: pin what matters, forget what does not.`)
  }
  if (knots.length) {
    out.push(zh
      ? `还有 ${knots.length} 个人的疙瘩没解开（${knots.map((k) => `${k.subject}×${k.unresolved}`).join('、')}）。`
      : `${knots.length} unresolved knot(s): ${knots.map((k) => `${k.subject}×${k.unresolved}`).join(', ')}.`)
  }
  if (openGaps) {
    out.push(zh ? `${openGaps} 个不懂的词还挂着，下次聊到会主动问。` : `${openGaps} term(s) still unknown; she will ask about them next time.`)
  }
  if (layers.facts && events.active && layers.facts > events.active) {
    out.push(zh ? '事实条数比事件还多：可能把聊天流水写进了事实层。' : 'More facts than events: chat log may be leaking into the fact layer.')
  }
  if (!out.length) out.push(zh ? '状态不错：记忆有梯度、没有堆积、也没落下没解开的事。' : 'Healthy: graded strengths, no pile-up, nothing unresolved.')
  return out
}

/** 命令行 / 面板用的纯文本版 */
export function formatHealth(h, language = 'zh') {
  const zh = language !== 'en'
  const label = {
    empty: zh ? '空的' : 'empty',
    starving: zh ? '饿死了' : 'starving',
    tired: zh ? '有点撑' : 'tired',
    healthy: zh ? '健康' : 'healthy',
  }[h.verdict]
  const e = h.events
  const lines = [
    `${zh ? '记忆体检测' : 'Memory check'}（${h.today}）：${label}`,
    `${zh ? '事件' : 'events'}  总 ${e.total} / 活跃 ${e.active} / 作废 ${e.superseded} / 置顶 ${e.pinned}`,
    `${zh ? '强度' : 'strength'}  平均 ${e.avgStrength}；快见底 ${e.weak}，超过 45 天 ${e.stale}`,
    `${zh ? '分层' : 'layers'}  关系 ${h.layers.relations} / 事实 ${h.layers.facts} / 章节 ${h.layers.chapters} / 技能 ${h.layers.skills} / 缺口 ${h.layers.gaps}`,
    `${zh ? '涉及' : 'subjects'} ${h.subjects.count} ${zh ? '个人' : 'subject(s)'}${h.subjects.names.length ? `（${h.subjects.names.join('、')}）` : ''}`,
    ...h.advice.map((line) => `· ${line}`),
  ]
  return lines.join('\n')
}

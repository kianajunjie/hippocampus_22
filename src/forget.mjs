/**
 * 主动遗忘。
 *
 * 自然的遗忘交给 replay 的衰减曲线；这里处理"人让她忘"的情况：
 * 用户说"上次那件事别再提了"、测试数据混进真实记忆、某段对话不该留。
 *
 * 两条原则：
 *   1. 默认是**软遗忘**（superseded = 1，强度归零）：召回不到、但 audit 还能查到，
 *      免得哪天想弄明白"这条怎么不见了"时无迹可寻。
 *   2. 置顶的（pinned）默认不动：置顶就是"别忘"，要删必须显式 force。
 */
import { localDay } from './health.mjs'

export function forget(db, options = {}) {
  const { id, ids, topic, subject, olderThan, force = false, dryRun = false, hard = false, today = localDay() } = options
  const clauses = []
  const params = []

  if (id !== undefined) {
    clauses.push('id = ?')
    params.push(Number(id))
  }
  if (Array.isArray(ids) && ids.length) {
    clauses.push(`id in (${ids.map(() => '?').join(',')})`)
    params.push(...ids.map(Number))
  }
  if (topic) {
    clauses.push('topic = ?')
    params.push(String(topic))
  }
  if (subject) {
    clauses.push('subject = ?')
    params.push(String(subject))
  }
  if (olderThan !== undefined) {
    const days = Number(olderThan)
    if (!Number.isFinite(days) || days < 0) throw new Error('forget: olderThan 必须是"多少天之前"的非负数字')
    const cutoff = new Date(Date.now() - days * 86400000).toLocaleDateString('sv-SE')
    clauses.push('day <= ?')
    params.push(cutoff)
  }

  if (!clauses.length) {
    throw new Error('forget: 至少给一个条件（id / ids / topic / subject / olderThan），否则等于清空整份记忆')
  }

  const pinnedGuard = force ? '' : ' and pinned = 0'
  const rows = db.prepare(`select id, day, who, topic, what, pinned from events
    where (${clauses.join(' and ')}) and superseded = 0${pinnedGuard} order by id`).all(...params)
  const skipped = force ? 0 : countPinned(db, clauses, params)

  if (!rows.length || dryRun) {
    return { matched: rows.length, ids: rows.map((r) => r.id), events: rows.slice(0, 20), skipped, dryRun: !!dryRun, mode: hard ? 'hard' : 'soft' }
  }

  const idsToDrop = rows.map((r) => r.id)
  const ph = idsToDrop.map(() => '?').join(',')

  db.exec('begin')
  try {
    if (hard) {
      db.prepare(`delete from events where id in (${ph})`).run(...idsToDrop)
    } else {
      db.prepare(`update events set superseded = 1, strength = 0 where id in (${ph})`).run(...idsToDrop)
    }
    // 指向被遗忘事件的联想边一并清掉，别让召回顺着边又摸回来
    db.prepare(`delete from edges where a in (${ph}) or b in (${ph})`).run(...idsToDrop, ...idsToDrop)
    db.exec('commit')
  } catch (error) {
    db.exec('rollback')
    throw error
  }

  return { matched: rows.length, ids: idsToDrop, skipped, dryRun: false, mode: hard ? 'hard' : 'soft' }
}

function countPinned(db, clauses, params) {
  return db.prepare(`select count(*) as n from events
    where (${clauses.join(' and ')}) and superseded = 0 and pinned = 1`).get(...params)?.n ?? 0
}

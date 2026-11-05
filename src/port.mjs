/**
 * 记忆的导入导出。
 *
 * 一个 `.db` 文件就是全部记忆，但"拷文件"在两种场景下不够用：
 *   1. 换机器 / 换版本时想先看一眼里面到底有什么；
 *   2. 想只把某一段记忆并进另一份记忆（比如从旧测试库搬几条真人对话）。
 * 所以这里做的是**纯 JSON 的全量快照**，不依赖 SQLite 版本，人能读、能 diff。
 */
import { localDay } from './health.mjs'

export const EXPORT_FORMAT = 'hippocampus-22/memory'
export const EXPORT_VERSION = 1

/** 每张表的列白名单：导入时只认这些列，避免脏字段拼进 SQL。 */
const SCHEMA = {
  identities: ['channel', 'external_id', 'subject', 'created'],
  relations: ['subject', 'trust', 'intimacy', 'unresolved', 'last_shift', 'updated'],
  facts: ['id', 'subject', 'relation', 'object', 'valid_from', 'valid_to', 'source', 'created'],
  chapters: ['id', 'period_from', 'period_to', 'title', 'summary', 'created'],
  skills: ['id', 'name', 'keywords', 'steps', 'uses', 'last_used'],
  gaps: ['id', 'term', 'note', 'asked', 'created'],
  events: ['id', 'day', 'who', 'topic', 'what', 'detail', 'affect', 'strength', 'last_recall', 'created', 'vec', 'pinned', 'superseded', 'subject'],
  edges: ['a', 'b', 'w'],
}

const TABLES = Object.keys(SCHEMA)

export function exportState(db, { exportedAt = new Date().toISOString(), day = localDay() } = {}) {
  const tables = {}
  for (const table of TABLES) {
    tables[table] = db.prepare(`select ${SCHEMA[table].join(',')} from ${table} order by rowid`).all()
      .map((row) => ({ ...row }))
  }
  const counts = Object.fromEntries(TABLES.map((t) => [t, tables[t].length]))
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt, day, counts, tables }
}

/**
 * @param {'merge'|'replace'} [opts.mode]
 *   replace：先清空再导入，用原 id（备份恢复场景）
 *   merge  ：追加，事件 id 重映射，联想边跟着改（把它当"搬几段记忆过去"）
 */
export function importState(db, data, { mode = 'merge' } = {}) {
  assertShape(data)
  const out = Object.fromEntries(TABLES.map((t) => [t, 0]))

  db.exec('begin')
  try {
    if (mode === 'replace') {
      for (const table of [...TABLES].reverse()) db.exec(`delete from ${table}`)
      for (const table of TABLES) out[table] = insertRows(db, table, data.tables[table] || [], { keepIds: true })
    } else if (mode === 'merge') {
      const idMap = new Map()
      out.events = insertRows(db, 'events', data.tables.events || [], {
        keepIds: false,
        onRow: (oldRow, newId) => { if (oldRow.id !== undefined) idMap.set(Number(oldRow.id), newId) },
      })
      out.edges = remapEdges(db, data.tables.edges || [], idMap)
      for (const table of TABLES) {
        if (table === 'events' || table === 'edges') continue
        out[table] = insertRows(db, table, data.tables[table] || [], { keepIds: false })
      }
    } else {
      throw new Error(`importState: 不认识的 mode "${mode}"，只支持 merge / replace`)
    }
    db.exec('commit')
  } catch (error) {
    db.exec('rollback')
    throw error
  }
  return { mode, imported: out }
}

function assertShape(data) {
  if (!data || typeof data !== 'object') throw new Error('importState: 需要一个导出对象')
  if (data.format !== EXPORT_FORMAT) {
    throw new Error(`importState: 这不是 hippocampus_22 的导出文件（format=${data.format ?? '缺失'}）`)
  }
  if (Number(data.version) > EXPORT_VERSION) {
    throw new Error(`importState: 导出文件版本 ${data.version} 比当前支持的 ${EXPORT_VERSION} 新，请先升级`)
  }
  if (!data.tables || typeof data.tables !== 'object') throw new Error('importState: 缺少 tables 段')
}

function insertRows(db, table, rows, { keepIds = false, onRow } = {}) {
  if (!Array.isArray(rows)) throw new Error(`importState: tables.${table} 应该是数组`)
  const columns = SCHEMA[table]
  let n = 0
  for (const row of rows) {
    const use = columns.filter((c) => row[c] !== undefined && (keepIds || c !== 'id'))
    if (!use.length) continue
    const sql = `insert into ${table}(${use.join(',')}) values(${use.map(() => '?').join(',')})`
    const result = db.prepare(sql).run(...use.map((c) => row[c]))
    n++
    onRow?.(row, Number(result.lastInsertRowid))
  }
  return n
}

function remapEdges(db, rows, idMap) {
  let n = 0
  for (const row of rows) {
    const a = idMap.get(Number(row.a))
    const b = idMap.get(Number(row.b))
    if (a === undefined || b === undefined) continue // 另一端没导进来，这条边就没有意义
    db.prepare('insert or replace into edges(a,b,w) values(?,?,?)').run(a, b, row.w ?? 1)
    n++
  }
  return n
}

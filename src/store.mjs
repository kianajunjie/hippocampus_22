import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export function openStore(dbPath) {
  if (typeof dbPath !== 'string' || !dbPath) {
    // 走不到这里才是正常的；走到了说明配置合并出了问题，给一句能看懂的提示
    throw new Error('openStore 需要一个记忆文件路径：请传 options.db，或先用 resolveConfig() 合并默认值')
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec(`
    create table if not exists events(
      id integer primary key autoincrement,
      day text, who text, topic text, what text,
      detail text default '', affect integer default 0,
      strength real default 1.0, last_recall text default '',
      created text
    );
    create index if not exists ev_day on events(day);
    create index if not exists ev_topic on events(topic);
    create table if not exists edges(a integer, b integer, w real default 1, primary key(a,b));
  `)
  // 兼容旧库：补列
  const cols = db.prepare('select name from pragma_table_info(\'events\')').all().map((r) => r.name)
  if (!cols.includes('vec')) db.exec('alter table events add column vec text default \'\'')
  if (!cols.includes('pinned')) db.exec('alter table events add column pinned integer default 0')
  if (!cols.includes('superseded')) db.exec('alter table events add column superseded integer default 0')
  if (!cols.includes('subject')) db.exec('alter table events add column subject text default \'\'')
  return db
}

export function insertEvent(db, e) {
  const st = db.prepare(`insert into events(day,who,topic,what,detail,affect,strength,created,subject,pinned)
    values(?,?,?,?,?,?,?,?,?,?)`)
  st.run(e.day, e.who, e.topic, e.what, e.detail || '', e.affect || 0, e.strength ?? 1,
    new Date().toISOString(), e.subject || '', e.pinned ? 1 : 0)
  return db.prepare('select last_insert_rowid() as id').get().id
}

export function link(db, a, b, w = 1) {
  if (a === b) return
  db.prepare('insert or replace into edges(a,b,w) values(?,?,?)').run(a, b, w)
}

export function daysBetween(day, today) {
  const a = new Date(day).getTime()
  if (Number.isNaN(a)) return 0
  return Math.max(0, Math.round((new Date(today).getTime() - a) / 86400000))
}

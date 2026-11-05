/**
 * The extra memory layers: relationship, temporal facts, life chapters,
 * procedural skills, and known gaps.
 *
 * They sit on the same SQLite file as events, so one file is still the whole memory.
 */

export function ensureLayers(db) {
  db.exec(`create table if not exists relations(subject text primary key, trust real default 5, intimacy real default 5,
    unresolved integer default 0, last_shift text, updated text);
  create table if not exists facts(id integer primary key autoincrement, subject text, relation text, object text,
    valid_from text, valid_to text default '', source text default '', created text);
  create table if not exists chapters(id integer primary key autoincrement, period_from text, period_to text,
    title text, summary text, created text);
  create table if not exists skills(id integer primary key autoincrement, name text, keywords text, steps text,
    uses integer default 0, last_used text);
  create table if not exists gaps(id integer primary key autoincrement, term text, note text default '',
    asked integer default 0, created text);`)
}

/* ---------- 关系 ---------- */

export function relGet(db, subject) {
  return db.prepare('select * from relations where subject=?').get(subject)
    || { subject, trust: 5, intimacy: 5, unresolved: 0 }
}

export function relShift(db, subject, delta = {}) {
  const cur = relGet(db, subject)
  const next = {
    trust: clamp(cur.trust + (delta.trust || 0)),
    intimacy: clamp(cur.intimacy + (delta.intimacy || 0)),
    unresolved: Math.max(0, Math.min(5, cur.unresolved + (delta.unresolved || 0))),
  }
  const at = new Date().toISOString()
  db.prepare(`insert into relations(subject,trust,intimacy,unresolved,last_shift,updated) values(?,?,?,?,?,?)
    on conflict(subject) do update set trust=excluded.trust, intimacy=excluded.intimacy,
    unresolved=excluded.unresolved, last_shift=excluded.last_shift, updated=excluded.updated`)
    .run(subject, next.trust, next.intimacy, next.unresolved, delta.why || '', at)
  return next
}

const clamp = (n) => Math.max(0, Math.min(10, Number.isFinite(n) ? n : 5))

export function relLine(db, subject, language = 'zh') {
  const r = relGet(db, subject)
  if (language === 'en') {
    const closeness = r.intimacy >= 8 ? 'very close' : r.intimacy >= 6 ? 'close' : r.intimacy >= 4 ? 'casual' : 'distant'
    const trust = r.trust >= 8 ? 'trusts you' : r.trust >= 6 ? 'mostly trusts' : r.trust >= 4 ? 'undecided' : 'guarded'
    const tension = r.unresolved > 0 ? `, ${r.unresolved} unresolved thing(s)` : ''
    return `${subject}: ${closeness}, ${trust}${tension}`
  }
  const closeness = r.intimacy >= 8 ? '很亲近' : r.intimacy >= 6 ? '挺熟' : r.intimacy >= 4 ? '一般' : '有点生'
  const trust = r.trust >= 8 ? '很信' : r.trust >= 6 ? '基本信' : r.trust >= 4 ? '半信半疑' : '还没放下戒心'
  const tension = r.unresolved > 0 ? `，还有 ${r.unresolved} 件没解开的疙瘩` : ''
  return `跟 ${subject}：${closeness}、${trust}${tension}`
}

/* ---------- 时序事实 ---------- */

/**
 * Records `subject relation object` and closes the previous value of the same
 * (subject, relation) pair — changing your mind invalidates the old fact.
 */
export function factAdd(db, subject, relation, object, from) {
  const day = from || new Date().toLocaleDateString('sv-SE')
  db.prepare("update facts set valid_to=? where subject=? and relation=? and (valid_to is null or valid_to='')")
    .run(day, subject, relation)
  const r = db.prepare('insert into facts(subject,relation,object,valid_from,created) values(?,?,?,?,?)')
    .run(subject, relation, object, day, new Date().toISOString())
  return Number(r.lastInsertRowid)
}

export function factList(db, subject, limit = 20) {
  const rows = subject
    ? db.prepare("select subject,relation,object,valid_from from facts where subject=? and (valid_to is null or valid_to='') order by id desc limit ?").all(subject, limit)
    : db.prepare("select subject,relation,object,valid_from from facts where (valid_to is null or valid_to='') order by id desc limit ?").all(limit)
  return rows.map((f) => `${f.subject} ${f.relation} ${f.object}（自 ${f.valid_from}）`)
}

/* ---------- 人生章节 ---------- */

export function chapterAdd(db, from, to, title, summary) {
  const r = db.prepare('insert into chapters(period_from,period_to,title,summary,created) values(?,?,?,?,?)')
    .run(from, to, title, summary, new Date().toISOString())
  return Number(r.lastInsertRowid)
}

export function chapterLatest(db) {
  return db.prepare('select period_from,period_to,title,summary from chapters order by id desc limit 1').get() || null
}

/* ---------- 程序性记忆 ---------- */

export function skillAdd(db, name, keywords, steps) {
  const r = db.prepare('insert into skills(name,keywords,steps,last_used) values(?,?,?,?)').run(name, keywords, steps, '')
  return Number(r.lastInsertRowid)
}

export function skillsFor(db, text, limit = 2) {
  const all = db.prepare('select name,keywords,steps from skills').all()
  return all
    .filter((s) => (s.keywords || '').split(/[,，\s]+/).some((k) => k && String(text).includes(k)))
    .slice(0, limit)
}

/* ---------- 元记忆缺口 ---------- */

export function gapAdd(db, term, note) {
  const r = db.prepare('insert into gaps(term,note,created) values(?,?,?)').run(term, note || '', new Date().toISOString())
  return Number(r.lastInsertRowid)
}

export function gapList(db, limit = 5) {
  return db.prepare('select term,note from gaps where asked=0 order by id desc limit ?').all(limit)
}

/**
 * One block of text ready to drop into a system prompt.
 * Order matters: relationship first (sets the tone), then what is known,
 * then where the story is, then what she can do, then what she does not know.
 */
export function contextBlock(db, { subject = '', text = '', today, language = 'zh' } = {}) {
  const out = []
  if (subject) out.push((language === 'en' ? '[relationship] ' : '【关系】') + relLine(db, subject, language))
  const facts = factList(db, subject)
  if (facts.length) out.push((language === 'en' ? '[facts]' : `【关于${subject}的事实】`) + '\n' + facts.join('\n'))
  const ch = chapterLatest(db)
  if (ch) out.push((language === 'en' ? '[chapter] ' : '【最近的章节】') + `${ch.title}：${ch.summary}`)
  const sk = text ? skillsFor(db, text) : []
  if (sk.length) {
    out.push((language === 'en' ? '[what I can do] ' : '【我会的】') + sk.map((s) => `${s.name}：${s.steps}`).join('；'))
  }
  const gaps = gapList(db)
  if (gaps.length) {
    const hint = language === 'en' ? ' (ask about these instead of pretending to know)' : '（遇到这些词，主动问一句求解释，别只说不知道）'
    out.push((language === 'en' ? '[I do not understand] ' : '【我不太懂的】') + gaps.map((g) => g.term).join('、') + hint)
  }
  return out.join('\n\n')
}

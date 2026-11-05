/**
 * Identity mapping across channels.
 *
 * The same person shows up as a QQ uid, an IM user id, a web session, a
 * Telegram handle… Memory is keyed on a stable `subject`, so every channel maps
 * into it here. One person, one memory, however many doors they come through.
 *
 *   channel + externalId  →  subject
 */

export function ensureIdentities(db) {
  db.exec(`create table if not exists identities(
    channel text, external_id text, subject text, created text,
    primary key(channel, external_id));`)
}

/** Bind an external id to a subject (idempotent, re-binds on change). */
export function bindIdentity(db, channel, externalId, subject) {
  ensureIdentities(db)
  db.prepare(`insert into identities(channel,external_id,subject,created) values(?,?,?,?)
    on conflict(channel,external_id) do update set subject=excluded.subject`)
    .run(String(channel), String(externalId), String(subject), new Date().toISOString())
  return { channel, externalId: String(externalId), subject }
}

/**
 * Resolve the subject for an incoming message.
 * Falls back to `${channel}:${externalId}` so an unknown visitor still gets a
 * stable, isolated memory instead of sharing the default one.
 */
export function resolveIdentity(db, channel, externalId, fallback) {
  ensureIdentities(db)
  const row = db.prepare('select subject from identities where channel=? and external_id=?')
    .get(String(channel), String(externalId))
  if (row?.subject) return row.subject
  if (fallback) return fallback
  return `${channel}:${externalId}`
}

export function identitiesOf(db, subject) {
  ensureIdentities(db)
  return db.prepare('select channel, external_id from identities where subject=?').all(String(subject))
}

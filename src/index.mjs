import { resolveConfig } from './config.mjs'
import { openStore, daysBetween, insertEvent } from './store.mjs'
import { makeLLM } from './llm.mjs'
import { encodeTurns } from './encode.mjs'
import { replay as runReplay } from './replay.mjs'
import { recall as runRecall, recallHybrid, formatRecall, candidates } from './recall.mjs'
import { expandQuery } from './expand.mjs'
import {
  ensureLayers, relGet, relShift, relLine, factAdd, factList,
  chapterAdd, chapterLatest, skillAdd, skillsFor, gapAdd, gapList, contextBlock,
} from './layers.mjs'
import { ensureIdentities, bindIdentity, resolveIdentity, identitiesOf } from './identity.mjs'
import { handleTurn } from './turn.mjs'

/**
 * Create a hippocampus instance.
 *
 * @param {object} options
 * @param {string} [options.db]        sqlite file path
 * @param {string} [options.apiKey]    LLM key (defaults to DEEPSEEK_API_KEY)
 * @param {string} [options.model]     model name
 * @param {string} [options.baseUrl]   OpenAI-compatible base URL
 * @param {Function} [options.llm]     inject your own chat(messages, maxTokens) => string
 * @param {'zh'|'en'} [options.language]
 * @param {object} [options.decay]     { base, emotionBoost, floor, mergeCap }
 * @param {object} [options.confidence]{ clearDays, vagueDays }
 * @param {object} [options.recall]    { limit, hop }
 * @param {object} [options.encode]    { maxPerBatch, batchTurns }
 */
export async function createHippocampus(options = {}) {
  const cfg = resolveConfig(options)
  const db = openStore(cfg.db)
  ensureLayers(db)
  ensureIdentities(db)
  const llm = options.llm || (cfg.apiKey ? makeLLM(cfg) : null)
  const today = () => new Date().toLocaleDateString('sv-SE')

  return {
    cfg,
    db,

    /** Display label for whoever spoke on a channel (used in stored events). */
    channelLabel(channel) {
      return channel === 'default' ? 'user' : String(channel)
    },

    /* ---------- relationship ---------- */

    /** Adjust how close / trusting the relationship is with someone. */
    relationship(subject = 'user') {
      return relGet(db, subject)
    },

    /** e.g. relation('user', { intimacy: +0.2, unresolved: +1, why: 'had a fight' }) */
    relation(subject, delta) {
      return relShift(db, subject, delta)
    },

    relationLine(subject, language = cfg.language) {
      return relLine(db, subject, language)
    },

    /* ---------- temporal facts ---------- */

    /** A durable fact; changing it closes the previous value automatically. */
    fact(subject, relation, object, from) {
      return factAdd(db, subject, relation, object, from)
    },

    facts(subject) {
      return factList(db, subject)
    },

    /* ---------- life chapters ---------- */

    chapter(from, to, title, summary) {
      return chapterAdd(db, from, to, title, summary)
    },

    latestChapter() {
      return chapterLatest(db)
    },

    /* ---------- procedural memory ---------- */

    skill(name, keywords, steps) {
      return skillAdd(db, name, keywords, steps)
    },

    skillsFor(text) {
      return skillsFor(db, text)
    },

    /* ---------- metacognition ---------- */

    /** Record something she does not understand, so she can ask next time. */
    gap(term, note) {
      return gapAdd(db, term, note)
    },

    gaps() {
      return gapList(db)
    },

    /** Everything above, assembled for a system prompt. */
    context(opts = {}) {
      return contextBlock(db, { ...opts, language: opts.language || cfg.language })
    },

    /* ---------- channels ---------- */

    /** Point a channel identity (QQ uid, IM id, web session) at a subject. */
    bindIdentity(channel, externalId, subject) {
      return bindIdentity(db, channel, externalId, subject)
    },

    /** Who is this channel id? Unknown ids get their own isolated subject. */
    resolveIdentity(channel, externalId, fallback) {
      return resolveIdentity(db, channel, externalId, fallback)
    },

    identitiesOf(subject) {
      return identitiesOf(db, subject)
    },

    /**
     * One turn from any channel: resolve the speaker, build the prompt block,
     * recall, and (when a reply is given) record the exchange.
     */
    async handleTurn(input) {
      return handleTurn(this, input)
    },

    /** Encode turns into events. turn = { at, user, reply } */
    async encode(turns = []) {
      if (!llm) throw new Error('encode needs an llm (pass options.llm or apiKey)')
      return encodeTurns({ db, llm, cfg, turns })
    },

    /** Consolidate: merge near-duplicates, apply emotion-weighted decay, write an impression. */
    async replay() {
      return runReplay({ db, llm, cfg, today: today() })
    },

    /** Recalls events relevant to a sentence, with confidence labels. */
    recall(text, opts = {}) {
      return runRecall({ db, cfg, text, today: today(), subject: opts.subject })
    },

    /**
     * Recall that survives paraphrases: lexical first, then (if an llm/embedder
     * is available) query expansion or vector similarity.
     * @returns {Promise<{items: object[], via: 'lexical'|'vector'|'expanded'|'none', expansions: string[]}>}
     */
    async recallDeep(text, opts = {}) {
      return recallHybrid({
        db, cfg, text, today: today(), subject: opts.subject,
        llm: options.llm || (cfg.apiKey ? makeLLM(cfg) : null),
        expandQuery,
        embedder: options.embedder,
      })
    },

    /** Recalls and formats as text lines, ready to drop into a prompt. */
    recallText(text, opts = {}) {
      return formatRecall(this.recall(text, opts))
    },

    /**
     * She decides to remember something. No LLM needed — this is her own note.
     * @param {string} text
     * @param {{topic?: string, who?: string, subject?: string, affect?: number, pin?: boolean, day?: string}} [opts]
     */
    remember(text, opts = {}) {
      if (!String(text || '').trim()) throw new Error('remember() needs text')
      const id = db.prepare(`insert into events(day,who,topic,what,detail,affect,strength,created,subject,pinned)
        values(?,?,?,?,?,?,?,?,?,?)`).run(
        opts.day || today(),
        opts.who || 'agent',
        opts.topic || 'self',
        String(text).slice(0, 300),
        'remembered by agent',
        opts.affect ?? 0,
        1,
        new Date().toISOString(),
        opts.subject || '',
        opts.pin ? 1 : 0,
      ).lastInsertRowid
      return { id: Number(id) }
    },

    /** Recent memories, strongest first — for a memory page or a check-up. */
    list(limit = 30) {
      return db.prepare(`select id,day,who,topic,what,strength,pinned,superseded,subject from events
        order by strength desc, day desc limit ?`).all(limit)
    },

    /** Async counterpart of recallText that also tries expansion/vectors. */
    async recallTextDeep(text) {
      const r = await this.recallDeep(text)
      return formatRecall(r.items)
    },

    stats() {
      const n = db.prepare('select count(*) as n, round(avg(strength),2) as strength from events').get()
      const e = db.prepare('select count(*) as n from edges').get()
      return { events: n.n, avgStrength: n.strength, edges: e.n }
    },

    /**
     * Insert an event directly (useful for tests / migrations).
     * 走 store 的 insertEvent：subject 与 pinned 都要落库，否则"按人隔离"和置顶
     * 对这条通路都是失效的。
     */
    addEvent(e) {
      return insertEvent(db, e)
    },

    link(a, b, w = 1) {
      db.prepare('insert or replace into edges(a,b,w) values(?,?,?)').run(a, b, w)
    },

    /** Pin a memory so it never decays (user said "remember this"). */
    pin(id, pinned = true) {
      db.prepare('update events set pinned=? where id=?').run(pinned ? 1 : 0, id)
      return { id, pinned: !!pinned }
    },

    /** What superseded / merged lately — for auditing why a memory vanished. */
    audit() {
      const superseded = db.prepare('select id,day,who,topic,what from events where superseded=1 order by id desc limit 20').all()
      const pinned = db.prepare('select id,day,who,what from events where pinned=1').all()
      return { superseded, pinned }
    },

    close() { db.close() },
  }
}

export { resolveConfig, candidates, formatRecall, daysBetween }

import { insertEvent, link } from './store.mjs'

const PROMPT_ZH = `抽事件，最多 {max} 条，每行：日期|谁|主题词|发生了什么|情绪(-2..2)
只抽约定/近况变化/偏好/情绪转折/重要的事，寒暄不抽。没有就输出「无」。`
const PROMPT_EN = `Extract at most {max} events, one per line: date|who|topic|what-happened|affect(-2..2)
Only commitments, changes, preferences, emotional turns, or important facts. Skip small talk. Output "none" if nothing.`

export function buildExtractionPrompt(cfg, max) {
  const tpl = cfg.language === 'en' ? PROMPT_EN : PROMPT_ZH
  return tpl.replace('{max}', String(max))
}

/** turn: {at, user, reply} */
export async function encodeTurns({ db, llm, cfg, turns }) {
  if (!turns.length) return { events: 0, ids: [] }
  const allIds = []
  const size = Math.max(1, cfg.encode.batchTurns)
  // 分批，别只处理最后一批
  for (let start = 0; start < turns.length; start += size) {
    const batch = turns.slice(start, start + size)
    const text = batch
      .map((t) => `[${t.at}] ${cfg.language === 'en' ? 'user' : '主人'}：${t.user}\n${cfg.language === 'en' ? 'agent' : '她'}：${t.reply}`)
      .join('\n\n')
    const out = await llm([
      { role: 'system', content: buildExtractionPrompt(cfg, cfg.encode.maxPerBatch) },
      { role: 'user', content: text },
    ], 500)
    const ids = []
    for (const line of out.split('\n').map((l) => l.trim()).filter((l) => l.includes('|'))) {
      const [day, who, topic, what, affect] = line.split('|').map((s) => s.trim())
      if (!what || !topic) continue
      const detail = batch.slice(-1)[0]
        ? `${batch.slice(-1)[0].user} / ${batch.slice(-1)[0].reply}`.slice(0, 160)
        : ''
      ids.push(insertEvent(db, {
        day, who, topic, what, detail,
        affect: Number(affect) || 0,
        subject: batch.slice(-1)[0].subject || '',   // 这段记忆是关于谁的
      }))
    }
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) link(db, ids[i], ids[j])
    allIds.push(...ids)
  }
  return { events: allIds.length, ids: allIds }
}

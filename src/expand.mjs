/**
 * Query expansion: turn paraphrase probes into lexical terms the store can match.
 * Cheap (one short call, only when direct recall misses) and needs no embeddings.
 */
const PROMPT_ZH = `把这句话拆成 3-6 个可能出现在记忆里的关键词/近义词，只输出词，用空格分隔。
例子：「运动之后的肌肉疼」→ 运动 骑车 腿 酸 疼 锻炼`
const PROMPT_EN = `Rewrite this question as 3-6 keywords or paraphrases that might appear in a memory. Output words only, space separated.
Example: "muscle pain after exercise" -> exercise cycling legs sore pain workout`

export async function expandQuery(llm, cfg, text) {
  if (!llm) return []
  try {
    const out = await llm([
      { role: 'system', content: cfg.language === 'en' ? PROMPT_EN : PROMPT_ZH },
      { role: 'user', content: text },
    ], 80)
    return out
      .split(/[\s,，、;；]+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2 && w.length <= 8)
      .slice(0, 6)
  } catch {
    return []
  }
}

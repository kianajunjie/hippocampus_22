import path from 'node:path'

export const DEFAULTS = {
  db: path.resolve('.hippocampus/memory.db'),
  model: 'deepseek-flash',
  baseUrl: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY || '',
  language: 'zh',
  decay: { base: 0.95, emotionBoost: 2, floor: 0.05, mergeCap: 5, mergeWindowDays: 7 },
  confidence: { clearDays: 7, vagueDays: 30 },
  recall: { limit: 3, hop: 2, minStrength: 0.1 },
  encode: { maxPerBatch: 3, batchTurns: 12 },
}

/**
 * 只保留"真的给了值"的键。
 * 命令行会把 `--db` 的缺省值拼成 `{ db: undefined }`，如果直接展开就会把 DEFAULTS
 * 里的默认路径覆盖成 undefined，随后 path.dirname(undefined) 直接抛 TypeError。
 */
const defined = (obj = {}) => Object.fromEntries(
  Object.entries(obj || {}).filter(([, value]) => value !== undefined),
)

export function resolveConfig(partial = {}) {
  const explicit = defined(partial)
  return {
    ...DEFAULTS,
    ...explicit,
    decay: { ...DEFAULTS.decay, ...defined(explicit.decay) },
    confidence: { ...DEFAULTS.confidence, ...defined(explicit.confidence) },
    recall: { ...DEFAULTS.recall, ...defined(explicit.recall) },
    encode: { ...DEFAULTS.encode, ...defined(explicit.encode) },
  }
}

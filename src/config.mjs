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

export function resolveConfig(partial = {}) {
  return {
    ...DEFAULTS,
    ...partial,
    decay: { ...DEFAULTS.decay, ...(partial.decay || {}) },
    confidence: { ...DEFAULTS.confidence, ...(partial.confidence || {}) },
    recall: { ...DEFAULTS.recall, ...(partial.recall || {}) },
    encode: { ...DEFAULTS.encode, ...(partial.encode || {}) },
  }
}

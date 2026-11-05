/**
 * 命令行参数解析（从 cli.mjs 抽出来，方便单测，也方便以后加子命令时复用）。
 *
 * 规则很简单，够用就好：
 *   --key value    取值
 *   --flag         取 true
 *   其余           按位置参数收集
 */

export function parseArgs(argv = []) {
  const flags = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (typeof token === 'string' && token.startsWith('--') && token.length > 2) {
      const key = token.slice(2)
      const next = argv[i + 1]
      const hasValue = next !== undefined && (typeof next !== 'string' || !next.startsWith('--'))
      flags[key] = hasValue ? argv[++i] : true
    } else {
      positional.push(token)
    }
  }
  return { flags, positional }
}

/**
 * `list` 的条数：位置参数优先（`hippo list 20`），其次 `--limit`，最后默认 20。
 * 非法数字一律回退到默认值，不让命令行因为手滑就崩。
 */
export function listCount(positional = [], flags = {}, fallback = 20) {
  const fromPositional = toPositiveInt(positional[0])
  if (fromPositional) return fromPositional
  const fromFlag = toPositiveInt(flags.limit)
  if (fromFlag) return fromFlag
  return fallback
}

export function toPositiveInt(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

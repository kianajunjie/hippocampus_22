import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULTS, resolveConfig } from '../src/config.mjs'
import { openStore } from '../src/store.mjs'

test('不传任何选项时，db 用默认路径', async () => {
  const cfg = resolveConfig({})
  assert.equal(cfg.db, DEFAULTS.db)
  assert.equal(cfg.language, 'zh')
})

test('显式传 undefined 不能把默认值冲掉（命令行就是这么传的）', () => {
  const cfg = resolveConfig({ db: undefined, apiKey: undefined, model: undefined })
  assert.equal(cfg.db, DEFAULTS.db)
  assert.equal(cfg.model, DEFAULTS.model)
})

test('嵌套配置同样只覆盖真给了值的键', () => {
  const cfg = resolveConfig({ decay: { floor: 0.2, base: undefined }, recall: { limit: 5 } })
  assert.equal(cfg.decay.floor, 0.2)
  assert.equal(cfg.decay.base, DEFAULTS.decay.base)
  assert.equal(cfg.recall.limit, 5)
  assert.equal(cfg.recall.hop, DEFAULTS.recall.hop)
})

test('给了路径就用给的路径', () => {
  const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-cfg-')), 'm.db')
  assert.equal(resolveConfig({ db }).db, db)
})

test('路径缺失时 openStore 给出能看懂的报错，而不是 TypeError', () => {
  assert.throws(() => openStore(undefined), /openStore 需要一个记忆文件路径/)
})

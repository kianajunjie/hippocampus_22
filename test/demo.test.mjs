import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

/**
 * demo 里那组"情绪加权对照"是给人看的，但它同时是一个可验证的断言：
 * 同一天发生、初始强度相同，只有 affect 不同的事件，经过同一次巩固后，
 * 有情绪的那条必须比普通那条更硬。这条测试守着别让它悄悄退化成"两条一样"。
 */
test('demo 的情绪加权对照：有情绪的那条衰减得更慢', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-demo-'))
  const db = path.join(dir, 'm.db')
  const cli = path.join(import.meta.dirname, '..', 'cli.mjs')

  execFileSync(process.execPath, [cli, 'demo', '--db', db], { stdio: 'ignore' })

  const conn = new DatabaseSync(db)
  const plain = conn.prepare("select strength from events where topic='compare-plain'").get()
  const harsh = conn.prepare("select strength from events where topic='compare-harsh'").get()
  conn.close()

  assert.ok(plain && harsh, '两条对照事件都应该入库')
  assert.ok(harsh.strength > plain.strength, `有情绪的应更硬：${harsh.strength} > ${plain.strength}`)
  assert.ok(plain.strength <= 0.1, '普通的应该已经衰减到地板附近')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { createHippocampus } from '../src/index.mjs'

const today = new Date().toLocaleDateString('sv-SE')
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('sv-SE')
const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hippo2-')), 'm.db')

test('changing your mind supersedes the old memory instead of merging it', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: daysAgo(3), who: 'user', topic: 'coffee', what: '主人很喜欢喝咖啡', affect: 1 })
  hip.addEvent({ day: daysAgo(1), who: 'user', topic: 'coffee', what: '主人戒了咖啡，改喝茶', affect: 0 })
  await hip.replay()
  const items = hip.recall('咖啡')
  const audit = hip.audit()
  assert.ok(audit.superseded.length >= 1, 'old preference should be marked superseded')
  assert.ok(!items.some((i) => i.what.includes('很喜欢喝咖啡')), 'recall must not surface the outdated preference')
  hip.close()
})

test('near-duplicates still merge (not supersede)', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: daysAgo(3), who: 'user', topic: 'cycling', what: '主人骑车二十公里腿酸' })
  hip.addEvent({ day: daysAgo(2), who: 'user', topic: 'cycling', what: '主人又骑车二十公里腿酸' })
  const r = await hip.replay()
  assert.equal(r.superseded, 0)
  assert.equal(r.merged, 1)
  hip.close()
})

test('memories are isolated per subject', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.remember('A 说他喜欢猫', { subject: 'A', topic: 'preference' })
  hip.remember('B 说他怕狗', { subject: 'B', topic: 'preference' })
  assert.equal(hip.recall('猫', { subject: 'A' }).length, 1)
  assert.equal(hip.recall('猫', { subject: 'B' }).length, 0, 'B must not see A memory')
  assert.equal(hip.recall('怕', { subject: 'B' }).length, 1)
  // 不指定 subject 时能看到全部（群里通用语境）
  assert.ok(hip.recall('猫').length >= 1)
  hip.close()
})

test('agent can remember and pin on purpose', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  const { id } = hip.remember('主人怕黑，晚上留一盏灯', { pin: true, subject: 'owner', topic: 'fear' })
  await hip.replay()
  const row = hip.db.prepare('select strength, pinned from events where id=?').get(id)
  assert.equal(row.pinned, 1)
  assert.equal(row.strength, 1)
  assert.equal(hip.list(5)[0].pinned, 1)
  hip.close()
})

test('pinned memories do not decay', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  const id = hip.addEvent({ day: daysAgo(60), who: 'user', topic: 'rule', what: '主人怕黑，晚上留一盏灯' })
  hip.pin(id)
  await hip.replay()
  const row = hip.db.prepare('select strength, pinned from events where id=?').get(id)
  assert.equal(row.pinned, 1)
  assert.equal(row.strength, 1)
  hip.close()
})

test('CLI 不会把命令行选项当正文记下来', () => {
  const db = tmpDb()
  const cli = path.join(import.meta.dirname, '..', 'cli.mjs')
  // stdio 用 ignore：不抓子进程输出，断言直接读库，比断言行格式稳
  execFileSync(process.execPath, [
    cli, 'remember', '主人怕黑，留盏灯', '--subject', 'owner', '--pin', '--topic', 'fear', '--db', db,
  ], { stdio: 'ignore' })

  const row = new DatabaseSync(db).prepare('select what, subject, pinned from events').get()
  assert.equal(row.what, '主人怕黑，留盏灯', '正文就是正文，选项不能被当成正文')
  assert.ok(!String(row.what).includes('--'), 'flag names must not leak into text')
  assert.equal(row.subject, 'owner', '--subject 要落库')
  assert.equal(row.pinned, 1, '--pin 要落库')
})

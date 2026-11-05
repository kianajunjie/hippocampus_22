import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHippocampus } from '../src/index.mjs'
import { exportState, importState, EXPORT_FORMAT } from '../src/port.mjs'

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-port-')), 'm.db')
const today = () => new Date().toLocaleDateString('sv-SE')

async function seeded(db) {
  const hip = await createHippocampus({ db })
  const a = hip.addEvent({ day: today(), who: 'user', topic: 'cycling', what: '主人骑车腿酸', subject: '主人', affect: -1 })
  const b = hip.addEvent({ day: today(), who: 'agent', topic: 'care', what: '她提醒拉伸', subject: '主人', affect: 2 })
  hip.link(a, b)
  hip.fact('主人', '住在', '杭州')
  hip.chapter('2026-10', '2026-11', '认识', '刚开始聊')
  hip.skill('剪视频', '剪,视频', 'whisper')
  hip.gap('quokkacore', '群友提过')
  hip.relation('主人', { intimacy: 1, why: '聊了一晚' })
  hip.bindIdentity('qq', '1001', '主人')
  hip.pin(a)
  return hip
}

test('导出结构：format/version/counts/八张表', async () => {
  const hip = await seeded(tmpDb())
  const dump = exportState(hip.db)
  assert.equal(dump.format, EXPORT_FORMAT)
  assert.equal(dump.version, 1)
  assert.equal(dump.counts.events, 2)
  assert.equal(dump.counts.edges, 1)
  assert.deepEqual(Object.keys(dump.tables).sort(), ['chapters', 'edges', 'events', 'facts', 'gaps', 'identities', 'relations', 'skills'])
  assert.ok(JSON.stringify(dump).length > 100)
  hip.close()
})

test('replace 导入：整份搬过去，条数与内容一致', async () => {
  const from = await seeded(tmpDb())
  const dump = from.exportMemory()
  const to = await createHippocampus({ db: tmpDb() })
  const r = to.importMemory(dump, { mode: 'replace' })
  assert.equal(r.imported.events, 2)
  assert.equal(to.stats().events, 2)
  assert.equal(to.list(5)[0].pinned, 1, '置顶要跟着过来')
  assert.match(to.facts('主人')[0], /杭州/)
  assert.deepEqual(
    to.identitiesOf('主人').map((row) => ({ channel: row.channel, external_id: row.external_id })),
    [{ channel: 'qq', external_id: '1001' }],
  )
  from.close()
  to.close()
})

test('merge 导入：事件 id 重映射，联想边跟着改', async () => {
  const from = await seeded(tmpDb())
  const dump = from.exportMemory()
  const to = await createHippocampus({ db: tmpDb() })
  const existing = to.addEvent({ day: today(), who: 'user', topic: 'misc', what: '本来就有一条' })
  const r = to.importMemory(dump, { mode: 'merge' })
  assert.equal(r.imported.events, 2)
  assert.equal(to.stats().events, 3)
  const edges = to.db.prepare('select a, b from edges').all()
  assert.equal(edges.length, 1)
  assert.ok(edges[0].a !== existing, '边必须指向新插入的事件，而不是原 id')
  const target = to.db.prepare('select what from events where id=?').get(edges[0].b)
  assert.match(target.what, /拉伸/)
  from.close()
  to.close()
})

test('导入前会校验：不是本项目的文件 / 版本太新 / 缺 tables', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  assert.throws(() => hip.importMemory({ format: 'other', version: 1, tables: {} }), /不是 hippocampus_22 的导出文件/)
  assert.throws(() => hip.importMemory({ format: EXPORT_FORMAT, version: 99, tables: {} }), /比当前支持的/)
  assert.throws(() => hip.importMemory({ format: EXPORT_FORMAT, version: 1 }), /缺少 tables/)
  assert.throws(() => hip.importMemory({ format: EXPORT_FORMAT, version: 1, tables: {} }, { mode: 'append' }), /不认识的 mode/)
  hip.close()
})

test('导入失败会回滚，不会留下半份数据', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.addEvent({ day: today(), who: 'user', topic: 'misc', what: '原有记忆' })
  const bad = { format: EXPORT_FORMAT, version: 1, tables: { events: 'not-an-array' } }
  assert.throws(() => hip.importMemory(bad, { mode: 'merge' }), /应该是数组/)
  assert.equal(hip.stats().events, 1)
  hip.close()
})

test('命令行：export 落盘、import 回灌到另一个库', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-port-cli-'))
  const src = await seeded(path.join(dir, 'a.db'))
  const dumpFile = path.join(dir, 'memory.json')
  src.close()

  const cli = path.join(import.meta.dirname, '..', 'cli.mjs')
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { stdio: 'ignore' })

  run('export', '--out', dumpFile, '--db', path.join(dir, 'a.db'))
  assert.ok(fs.existsSync(dumpFile))
  const parsed = JSON.parse(fs.readFileSync(dumpFile, 'utf8'))
  assert.equal(parsed.counts.events, 2)

  run('import', '--in', dumpFile, '--mode', 'replace', '--db', path.join(dir, 'b.db'))
  const copy = await createHippocampus({ db: path.join(dir, 'b.db') })
  assert.equal(copy.stats().events, 2)
  assert.equal(copy.stats().edges, 1)
  assert.match(copy.facts('主人')[0], /杭州/)
  copy.close()
})

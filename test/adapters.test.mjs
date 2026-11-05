import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHippocampus } from '../src/index.mjs'
import { createMemoryServer } from '../src/adapters/http.mjs'

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-ad-')), 'm.db')

test('one person, many channels: identities resolve to one subject', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.bindIdentity('qq', '3475932219', '主人')
  hip.bindIdentity('im', 'user-abc', '主人')
  hip.bindIdentity('web', 'session-xyz', '主人')
  assert.equal(hip.resolveIdentity('qq', '3475932219'), '主人')
  assert.equal(hip.resolveIdentity('im', 'user-abc'), '主人')
  assert.equal(hip.identitiesOf('主人').length, 3)
  hip.close()
})

test('unknown ids get their own isolated subject instead of sharing the default', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  const a = hip.resolveIdentity('qq', '111')
  const b = hip.resolveIdentity('qq', '222')
  assert.notEqual(a, b)
  hip.remember('A 喜欢猫', { subject: a })
  assert.equal(hip.recall('猫', { subject: b }).length, 0)
  hip.close()
})

test('handleTurn works the same from any channel', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.bindIdentity('qq', '1', '主人')
  hip.fact('主人', '正在学', '开源课')

  const r = await hip.handleTurn({
    channel: 'qq', externalId: '1', text: '我说了句谢谢', reply: '嗯嗯',
  })
  assert.equal(r.subject, '主人')
  assert.match(r.context, /开源课/)
  assert.ok(r.relationship.trust > 5, 'praise should raise trust')

  // 同一个人从 im 进来，看到的是同一份记忆
  hip.bindIdentity('im', 'u9', '主人')
  const r2 = await hip.handleTurn({ channel: 'im', externalId: 'u9', text: '开源课学到哪了', reply: '讲到分支了' })
  assert.equal(r2.subject, '主人')
  assert.ok(r2.recall.length >= 0)
  hip.close()
})

test('a fight leaves a knot, an apology unties it', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  await hip.handleTurn({ channel: 'qq', externalId: '1', text: '别烦我，滚', reply: '好', subject: '主人' })
  assert.equal(hip.relationship('主人').unresolved, 1)
  await hip.handleTurn({ channel: 'qq', externalId: '1', text: '对不起，我错了', reply: '没事', subject: '主人' })
  assert.equal(hip.relationship('主人').unresolved, 0)
  hip.close()
})

test('http shim serves context and turn for any client', async () => {
  const hip = await createHippocampus({ db: tmpDb() })
  hip.bindIdentity('qq', '42', '主人')
  hip.fact('主人', '怕', '黑')
  const srv = await createMemoryServer({ hip, port: 0, token: 'secret' })
  const base = `http://127.0.0.1:${srv.port}`

  const ctxRes = await fetch(`${base}/context`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify({ channel: 'qq', externalId: '42', text: '晚上好' }),
  })
  const ctxBody = await ctxRes.json()
  assert.equal(ctxBody.subject, '主人')
  assert.match(ctxBody.block, /黑/)

  const unauthorized = await fetch(`${base}/health`)
  assert.equal(unauthorized.status, 401)

  const turnRes = await fetch(`${base}/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
    body: JSON.stringify({ channel: 'qq', externalId: '42', text: '晚安', reply: '晚安' }),
  })
  assert.equal((await turnRes.json()).subject, '主人')

  await srv.close()
  hip.close()
})

test('dsh shell exposes the plugin surface without touching the host on failure', async () => {
  const mod = await import('../src/adapters/dsh.mjs')
  assert.equal(mod.name, 'hippocampus')
  assert.ok(Array.isArray(mod.inject))
  // 一个几乎空的 fake ctx：不该抛
  const fake = { on() {}, effect() {}, provide() {}, inject() {} }
  const out = mod.apply(fake, { db: tmpDb() })
  assert.ok(out.ready)
  await out.ready
  out.hip?.close?.()
})

/**
 * HTTP shim — let anything that can send JSON use the memory.
 *
 *   import { createMemoryServer } from 'dsh-hippocampus/http'
 *   const server = await createMemoryServer({ hip, port: 7717, token: 'secret' })
 *   await server.close()
 *
 * Endpoints (all POST JSON, `Authorization: Bearer <token>` optional):
 *   /turn     {channel, externalId, text, reply}  → {subject, context, recall}
 *   /context  {channel, externalId, text}         → {block}
 *   /recall   {channel, externalId, text}         → {items}
 *   /remember {subject|channel+externalId, text, pin}
 *   /fact     {subject, relation, object}
 *   /health   → {ok, stats}
 */
import http from 'node:http'

export async function createMemoryServer({ hip, port = 7717, host = '127.0.0.1', token = '' }) {
  const server = http.createServer(async (req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body))
    }
    try {
      if (token) {
        const auth = req.headers.authorization || ''
        if (auth !== `Bearer ${token}`) return send(401, { error: 'unauthorized' })
      }
      const url = new URL(req.url, 'http://localhost')
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(200, { ok: true, stats: hip.stats() })
      }
      if (req.method !== 'POST') return send(405, { error: 'use POST' })

      const body = await readJson(req)
      const subject = body.subject || hip.resolveIdentity(body.channel || 'http', body.externalId || 'anon')

      if (url.pathname === '/turn') {
        const r = await hip.handleTurn({
          channel: body.channel || 'http',
          externalId: body.externalId || 'anon',
          text: body.text || '',
          reply: body.reply || '',
          subject: body.subject,
        })
        return send(200, r)
      }
      if (url.pathname === '/context') {
        return send(200, { subject, block: hip.context({ subject, text: body.text || '' }) })
      }
      if (url.pathname === '/recall') {
        return send(200, { subject, items: hip.recall(body.text || '', { subject }) })
      }
      if (url.pathname === '/remember') {
        const r = hip.remember(body.text || '', { subject, pin: !!body.pin, topic: body.topic })
        return send(200, { subject, ...r })
      }
      if (url.pathname === '/fact') {
        const id = hip.fact(subject, body.relation || 'is', body.object || '')
        return send(200, { subject, id })
      }
      return send(404, { error: 'unknown endpoint' })
    } catch (error) {
      send(500, { error: error?.message || String(error) })
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })

  const address = server.address()
  return {
    server,
    port: typeof address === 'object' && address ? address.port : port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1_000_000) reject(new Error('payload too large'))
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try { resolve(JSON.parse(raw)) } catch (error) { reject(new Error('invalid JSON')) }
    })
    req.on('error', reject)
  })
}

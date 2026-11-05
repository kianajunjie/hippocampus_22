/**
 * DSH plugin shell.
 *
 * Everything below is defensive on purpose: if the host's service surface
 * differs from what we expect, the plugin logs and keeps running instead of
 * taking the host down. The library itself has no DSH dependency at all.
 *
 * What it wires up, when the services exist:
 *   - ctx.provide('hippocampus')        read the memory from other plugins
 *   - ctx.systemPrompt.section(...)     inject the memory block every turn
 *   - ctx.tools.register(...)           let the agent recall / remember itself
 *   - ctx.on('session/event', ...)      record finished turns
 *   - ctx.effect(...)                   daily consolidation
 */
import os from 'node:os'
import path from 'node:path'
import { createHippocampus } from '../index.mjs'

export const name = 'hippocampus'
export const inject = ['tools', 'systemPrompt']

export function apply(ctx, config = {}) {
  const log = (...args) => {
    try { ctx.logger?.info?.('[hippocampus]', ...args) } catch { /* ignore */ }
  }
  let hip = null
  let closed = false

  const ready = (async () => {
    const db = config.db || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'hippocampus', 'memory.db')
    const marker = async (line) => {
      try {
        const fs = await import('node:fs')
        fs.mkdirSync(path.dirname(db), { recursive: true })
        fs.appendFileSync(path.join(path.dirname(db), 'load.log'), `${new Date().toISOString()} ${line}\n`)
      } catch { /* ignore */ }
    }
    await marker('apply fired')
    hip = await createHippocampus({
      db,
      apiKey: config.apiKey || process.env.DEEPSEEK_API_KEY,
      language: config.language || 'zh',
      subject: config.defaultSubject || '主人',
    })
    try { ctx.provide?.('hippocampus', hip) } catch (error) { log('provide failed', error?.message) }
    wire(ctx, hip, config, log)
    await marker('wired')
    return hip
  })().catch((error) => log('init failed', error?.message || String(error)))

  try {
    ctx.effect?.(() => () => {
      closed = true
      try { hip?.close() } catch { /* ignore */ }
    }, 'hippocampus:close')
  } catch { /* ignore */ }

  return { ready, get hip() { return hip }, get closed() { return closed } }
}

function wire(ctx, hip, config, log) {
  const subjectOf = (assemble) => {
    const session = assemble?.agent?.session
    const cwd = session?.header?.cwd
    return (cwd && session?.header?.subject) || config.defaultSubject || '主人'
  }

  // 1) prompt block, recomputed every turn
  try {
    ctx.systemPrompt?.section?.({
      name: 'hippocampus:memory',
      order: config.order ?? 30,
      text: (assemble) => {
        try {
          const agent = assemble?.agent
          const session = agent?.session
          if (!session) return ''
          const text = lastUserText(session)
          return hip.context({ subject: subjectOf(assemble), text })
        } catch (error) {
          log('prompt failed', error?.message)
          return ''
        }
      },
    })
    log('prompt section registered')
  } catch (error) { log('prompt section failed', error?.message) }

  // 2) tools she can call herself
  try {
    const register = ctx.tools?.register
    if (typeof register === 'function') {
      register.call(ctx.tools, {
        name: 'memory_recall',
        description: 'Recall what you remember about the person you are talking to.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'what to look for' },
            subject: { type: 'string', description: 'whose memory (defaults to 主人)' },
          },
          required: ['query'],
        },
        handler: async (args = {}) => hip.recallText(String(args.query || ''), { subject: args.subject || config.defaultSubject || '主人' }) || '(nothing)',
      })
      register.call(ctx.tools, {
        name: 'memory_remember',
        description: 'Deliberately remember something. Use pin for things that must never fade.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            pin: { type: 'boolean' },
            subject: { type: 'string' },
          },
          required: ['text'],
        },
        handler: async (args = {}) => JSON.stringify(hip.remember(String(args.text || ''), { pin: !!args.pin, subject: args.subject || config.defaultSubject || '主人' })),
      })
      log('tools registered')
    }
  } catch (error) { log('tools failed', error?.message) }

  // 3) record turns as they finish
  try {
    ctx.on?.('session/event', (session, event) => {
      try {
        const text = lastUserText(session)
        if (!text) return
        hip.relation(config.defaultSubject || '主人', { intimacy: 0.1, why: '聊了一句' })
      } catch { /* ignore */ }
    })
  } catch (error) { log('session hook failed', error?.message) }

  // 4) daily consolidation
  try {
    const timer = setInterval(() => { hip.replay().catch((error) => log('replay failed', error?.message)) }, 24 * 3600 * 1000)
    timer.unref?.()
    ctx.effect?.(() => () => clearInterval(timer), 'hippocampus:replay')
  } catch (error) { log('replay timer failed', error?.message) }
}

function lastUserText(session) {
  try {
    const rows = session?.messages || session?.history || []
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]?.role === 'user' && rows[i]?.content) return String(rows[i].content).slice(0, 200)
    }
  } catch { /* ignore */ }
  return ''
}

/**
 * One turn, any channel.
 *
 *   const r = await hip.handleTurn({ channel: 'qq', externalId: '3475932219',
 *                                    text: '腿好酸', reply: '昨天骑车累的吧' })
 *
 * It resolves who is talking, pulls what should be in the prompt, and (if the
 * turn carries a reply) records the exchange and nudges the relationship.
 * The bot itself can be a QQ bridge, an IM adapter, a web chat, or cron-
 * triggered code — the shape of the call is identical.
 */

const CONFLICT = /吵|生气|凶|滚|别烦|讨厌/
const REPAIR = /对不起|抱歉|和好|不气了|原谅/
const PRAISE = /夸|喜欢|谢谢|你最|真好/

export async function handleTurn(hip, input = {}) {
  const {
    channel = 'default',
    externalId = '',
    text = '',
    reply = '',
    subject: explicitSubject,
    fallbackSubject,
    record = true,
    recallLimit,
  } = input

  const subject = explicitSubject
    || hip.resolveIdentity(channel, externalId, fallbackSubject)

  const context = hip.context({ subject, text })
  const hits = hip.recall(text, { subject }).slice(0, recallLimit || undefined)

  let delta = null
  if (record && reply) {
    hip.addEvent({
      day: new Date().toLocaleDateString('sv-SE'),
      who: hip.channelLabel ? hip.channelLabel(channel) : 'user',
      topic: 'chat',
      what: String(text).slice(0, 200),
      detail: String(reply).slice(0, 160),
      affect: CONFLICT.test(text) ? -1 : PRAISE.test(text) ? 1 : 0,
      subject,
    })
    delta = relationshipDelta(text)
    if (delta) hip.relation(subject, delta)
  }

  return { subject, channel, context, recall: hits, relationship: hip.relationship(subject), delta }
}

/** Heuristic nudge: arguments leave a knot, apologies untie it, praise builds trust. */
export function relationshipDelta(text = '') {
  if (CONFLICT.test(text)) return { intimacy: -0.5, unresolved: 1, why: '有点冲' }
  if (REPAIR.test(text)) return { unresolved: -1, intimacy: 0.8, why: '和好了' }
  if (PRAISE.test(text)) return { trust: 0.3, why: '被夸了' }
  return { intimacy: 0.2, why: '聊了一句' }
}

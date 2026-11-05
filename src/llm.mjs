export function makeLLM(cfg) {
  return async function chat(messages, maxTokens = 400) {
    if (!cfg.apiKey) throw new Error('missing apiKey (set DEEPSEEK_API_KEY or config.apiKey)')
    const res = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({
        model: cfg.model,
        thinking: { type: 'disabled' },
        messages,
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(90000),
    })
    if (!res.ok) throw new Error('llm http ' + res.status)
    const j = await res.json()
    return (j.choices?.[0]?.message?.content || '').trim()
  }
}

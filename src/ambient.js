import { logger } from './logger.js'

const VERDICT_YES = /^(yes|是|可以|接)/i

export function keywordHit(text, keywords = []) {
  const value = String(text || '').toLowerCase()
  if (!value) return false
  return (keywords || []).some((keyword) => {
    const word = String(keyword || '').trim().toLowerCase()
    return word && value.includes(word)
  })
}

export function buildTranscript(recent = [], limit = 8) {
  return (recent || [])
    .slice(-limit)
    .map((item) => {
      const who = item.nickname || item.userId || '群友'
      const text = String(item.text || '').trim() || '[图片]'
      return `${who}: ${text}`
    })
    .join('\n')
}

/**
 * 让文字模型判断最后一条群消息是否值得以角色身份接一句。
 * 调用失败按“不接”处理:旁听是锦上添花,不能因为它打断正常回复。
 */
export async function judgeJoin({ recent, persona, llm, timeoutMs = 8000 } = {}) {
  const transcript = buildTranscript(recent, 8)
  if (!transcript || !llm?.endpoint) return false

  const personaBrief = String(persona?.systemPrompt || '').slice(0, 500)
  const system = [
    '你是 QQ 群聊的旁听者,只负责判断要不要接话。',
    `角色名:${persona?.name || '角色'}。`,
    persona?.voiceHint ? `角色语气:${persona.voiceHint}` : '',
    personaBrief ? `角色设定摘要:\n${personaBrief}` : '',
    '判断最后一条消息是否适合由这个角色自然接一句。',
    '适合:话题与角色相关、有人提问/求助/感叹、点到角色、群里正在讨论角色熟悉的事。',
    '不适合:两人私聊、争吵、刷屏、已经有人给出完整回答、角色插话会显得突兀。',
    '只回答 YES 或 NO,不要解释。',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const response = await fetch(llm.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${llm.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: llm.model,
        temperature: 0,
        max_tokens: 8,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `最近群聊:\n${transcript}\n\n只回答 YES 或 NO。` },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error(`旁听判定 HTTP ${response.status}`)
    const payload = await response.json()
    const verdict = String(payload?.choices?.[0]?.message?.content ?? '').trim()
    return VERDICT_YES.test(verdict)
  } catch (err) {
    logger.warn(`旁听判定失败,本轮不接话: ${err?.message}`)
    return false
  }
}

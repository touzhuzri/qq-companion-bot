import { cleanSpeech } from './speech.js'
import { logger } from './logger.js'

const COOL_MIN_CHARS = 18
const COOL_MAX_CHARS = 70
const EXPAND_TIMEOUT_MS = 10000

/**
 * 依据情绪叠态判断现在是不是“态度好”的回合。
 * attachment/trust 高、hurt/guard 低时,她更愿意多说几句。
 */
export function isWarm(affect = {}) {
  const attachment = Number(affect?.attachment) || 0
  const trust = Number(affect?.trust) || 0
  const hurt = Number(affect?.hurt) || 0
  const guard = Number(affect?.guard) || 0
  return attachment + trust - hurt - guard >= 0.6
}

export function expansionPolicy(affect = {}, persona = {}) {
  const warm = isWarm(affect)
  const format = persona?.format || {}
  if (warm) {
    return {
      warm,
      minChars: Math.max(30, Number(format.minTotal) || 35),
      maxChars: Math.max(80, Number(format.maxTotal) || 180),
      minSentences: Math.max(2, Number(format.minSentences) || 2),
      maxSentences: Math.max(3, Number(format.maxSentences) || 3),
    }
  }
  return {
    warm,
    minChars: COOL_MIN_CHARS,
    maxChars: COOL_MAX_CHARS,
    minSentences: 1,
    maxSentences: 2,
  }
}

function buildPrompt({ draft, userMessage, persona, policy }) {
  const format = persona?.format || {}
  const minSentenceChars = Number(format.minSentenceChars) || 15
  const maxSentenceChars = Number(format.maxSentenceChars) || 45
  const mood = policy.warm
    ? '你现在对她更亲近、更放松,可以多说两句,把关心和态度讲完整。'
    : '你现在的态度偏克制,不必热情,但至少要把一句完整的话说清楚。'

  return [
    persona?.systemPrompt || '',
    persona?.voiceHint ? `语气:${persona.voiceHint}` : '',
    '',
    '【改写任务】',
    mood,
    `把下面的草稿改写成${policy.minSentences}～${policy.maxSentences}句,每句约${minSentenceChars}～${maxSentenceChars}字,` +
      `整轮约${policy.minChars}～${policy.maxChars}字。`,
    '保留原意和角色语气,可以补充自然的细节和回应,但不要编造新事实。',
    '只输出角色说出口的话;不要解释,不要括号动作/神态,不要角色名前缀。',
    '',
    `对方刚说:${userMessage}`,
    `草稿:${draft}`,
  ]
    .filter(Boolean)
    .join('\n')
}

async function rewrite({ draft, userMessage, persona, policy, llm, timeoutMs }) {
  const response = await fetch(llm.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${llm.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: llm.model,
      temperature: 0.7,
      max_tokens: 512,
      messages: [
        { role: 'system', content: buildPrompt({ draft, userMessage, persona, policy }) },
        { role: 'user', content: '请改写。' },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`改写 HTTP ${response.status}`)
  const payload = await response.json()
  return cleanSpeech(payload?.choices?.[0]?.message?.content || '')
}

/**
 * 模型太简洁时的兜底:只重写一次,失败就保留原回复。
 * @returns {Promise<{lines: string[], expanded: boolean, before: number, after: number, warm: boolean}>}
 */
export async function expandIfNeeded({
  lines,
  userMessage,
  affect,
  persona,
  llm,
  timeoutMs = EXPAND_TIMEOUT_MS,
}) {
  const original = (lines || []).filter(Boolean)
  const draft = original.join(' ')
  const policy = expansionPolicy(affect, persona)
  const before = draft.length

  if (!draft || before >= policy.minChars) {
    return { lines: original, expanded: false, before, after: before, warm: policy.warm }
  }

  try {
    const rewritten = await rewrite({ draft, userMessage, persona, policy, llm, timeoutMs })
    if (!rewritten) throw new Error('改写结果为空')
    const after = rewritten.length
    if (after < before) throw new Error('改写后反而更短')
    logger.info(`回复扩写 ${before} -> ${after} 字 (${policy.warm ? 'warm' : 'cool'})`)
    return { lines: [rewritten], expanded: true, before, after, warm: policy.warm }
  } catch (err) {
    logger.warn(`回复扩写失败,保留原回复: ${err?.message}`)
    return { lines: original, expanded: false, before, after: before, warm: policy.warm }
  }
}

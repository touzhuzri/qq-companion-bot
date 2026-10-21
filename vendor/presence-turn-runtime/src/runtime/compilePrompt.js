import { getActivePack } from '../pack/context.js'
import { buildTurnConstraintCard } from './userTurnPolicy.js'
import { getReplyFormatInstructions } from './composer.js'
import { buildMemoryPrompt } from './memory.js'

export function buildDialogueRhythm(turnKind = 'default', format = {}) {
  const maxSentences = Math.min(4, Math.max(1, Number(format?.maxSentences) || 2))
  const minSentences = Math.min(
    maxSentences,
    Math.max(1, Number(format?.minSentences) || 1),
  )
  const minTotal = Math.max(0, Math.min(600, Number(format?.minTotal) || 0))
  const maxTotal = Math.max(minTotal || 40, Math.min(800, Number(format?.maxTotal) || 240))
  const length = minTotal > 0 ? `整轮约${minTotal}～${maxTotal}字` : `整轮≤${maxTotal}字`
  const lines = [
    '【短聊节奏】',
    `像熟人闲话：${minSentences}～${maxSentences}句，${length}。`,
    '必须有说出口的人话；禁止任何括号动作旁白；只输出台词本身。',
  ]
  if (turnKind === 'greeting') {
    lines.push('招呼轮可以短一些，但至少说一句完整的话。')
  }
  if (turnKind === 'short_ack') {
    lines.push('短附和：接住上一句，再补半句；不要只回嗯/好。')
  }
  return lines.join('\n')
}

function historyLimit(turnKind) {
  return turnKind === 'greeting' ? 4 : 10
}

export function compilePrompt({
  userMessage,
  history = [],
  policy,
  presence,
  memories = [],
} = {}) {
  const pack = getActivePack()
  const system = [
    pack.systemPrompt,
    `你现在的名字：${pack.name}。对方可称为「${pack.userName}」。`,
    pack.voiceHint,
    buildTurnConstraintCard(policy),
    presence?.promptText || '',
    buildDialogueRhythm(policy?.turnKind, pack.format || {}),
    buildMemoryPrompt(memories),
    getReplyFormatInstructions(presence?.maxBubbles || 2, pack.format || {}),
  ]
    .filter(Boolean)
    .join('\n\n')

  const limit = historyLimit(policy?.turnKind)
  const trimmed = (history || []).slice(-limit)
  const messages = [{ role: 'system', content: system }]
  for (const item of trimmed) {
    const role = item.role === 'assistant' ? 'assistant' : 'user'
    const content = String(item.content || item.displayText || item.text || '').trim()
    if (!content) continue
    messages.push({ role, content })
  }
  messages.push({ role: 'user', content: String(userMessage || '').trim() })
  return { messages, system }
}

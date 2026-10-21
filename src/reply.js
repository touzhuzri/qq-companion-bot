import { splitForChat } from './split.js'
import { logger } from './logger.js'

export function randomBetween(min, max) {
  const low = Math.min(Number(min) || 0, Number(max) || 0)
  const high = Math.max(Number(min) || 0, Number(max) || 0)
  return low + Math.floor(Math.random() * (high - low + 1))
}

export function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

export function buildSegments(lines, replyConfig = {}) {
  return (lines || []).flatMap((line) =>
    splitForChat(line, {
      minChars: replyConfig.segmentMinChars,
      targetChars: replyConfig.segmentTargetChars,
      maxChars: replyConfig.segmentMaxChars,
      maxMessages: replyConfig.segmentMaxMessages,
    }),
  )
}

/**
 * 发送一轮已经剥离好的台词。
 *
 * 语音模式:只发语音,不发文字,不等待;失败则降级到文字流程。
 * 文字模式:API 返回后只等一次随机延迟,分段之间再有短随机间隔。
 *
 * @returns {Promise<{ mode: 'voice'|'text'|'none', segments: string[] }>}
 */
export async function deliverReply({
  lines,
  groupId,
  config,
  client,
  tts,
  voiceEnabled,
  contextStore,
}) {
  const replies = (lines || []).filter(Boolean)
  if (!replies.length) return { mode: 'none', segments: [] }

  if (voiceEnabled) {
    try {
      const spoken = replies.join(' ')
      const wavPath = await tts.synthesize(spoken)
      await client.sendGroupMessage(groupId, [
        { type: 'record', data: { file: `file://${wavPath}` } },
      ])
      tts.cleanupLater(wavPath)
      contextStore.append(groupId, 'assistant', spoken)
      return { mode: 'voice', segments: [spoken] }
    } catch (err) {
      logger.warn(`语音发送失败,降级为文字: ${err?.message}`)
    }
  }

  const segments = buildSegments(replies, config.reply)
  if (!segments.length) return { mode: 'none', segments: [] }

  await sleep(randomBetween(config.reply.delayMinMs, config.reply.delayMaxMs))

  const sent = []
  for (let index = 0; index < segments.length; index++) {
    if (index > 0) {
      await sleep(
        randomBetween(config.reply.segmentGapMinMs, config.reply.segmentGapMaxMs),
      )
    }
    const segment = segments[index]
    try {
      await client.sendGroupText(groupId, segment)
    } catch (err) {
      logger.error(`发送失败: ${err?.message}`)
      break
    }
    contextStore.append(groupId, 'assistant', segment)
    sent.push(segment)
  }

  return { mode: 'text', segments: sent }
}

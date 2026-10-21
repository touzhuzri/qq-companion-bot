/**
 * OneBot 11 消息事件 → 结构化轮次输入。
 * 群聊只认 @bot(不认 @全体成员);私聊没有 @,默认每条都算触发,
 * 由 bot 层用 privateChat.allow 决定是否响应。
 */

/**
 * @param {object} event OneBot message event
 * @param {string|number} botQQ
 * @returns {{
 *   isPrivate: boolean,
 *   messageType: 'group'|'private',
 *   triggered: boolean,
 *   text: string,
 *   images: {url: string, file: string}[],
 *   senderId: string,
 *   nickname: string,
 *   targetId: string,
 *   groupId: string,
 * }}
 */
export function parseMessage(event, botQQ) {
  const segments = Array.isArray(event?.message) ? event.message : []
  const botId = String(botQQ)
  const isPrivate = event?.message_type === 'private'

  const triggered = isPrivate
    ? true
    : segments.some((seg) => seg?.type === 'at' && String(seg?.data?.qq ?? '') === botId)

  const textParts = []
  const images = []
  for (const seg of segments) {
    if (seg?.type === 'text') {
      const t = String(seg?.data?.text ?? '').trim()
      if (t) textParts.push(t)
    } else if (seg?.type === 'image') {
      const url = String(seg?.data?.url ?? '')
      if (url) images.push({ url, file: String(seg?.data?.file ?? '') })
    }
  }

  const senderId = String(event?.user_id ?? '')
  const targetId = isPrivate ? senderId : String(event?.group_id ?? '')

  return {
    isPrivate,
    messageType: isPrivate ? 'private' : 'group',
    triggered,
    text: textParts.join(' ').trim(),
    images,
    senderId,
    nickname: String(event?.sender?.nickname ?? event?.sender?.card ?? '').trim(),
    targetId,
    groupId: isPrivate ? '' : targetId,
  }
}

/** 兼容旧调用:按群消息解析 */
export function parseGroupMessage(event, botQQ) {
  return parseMessage(event, botQQ)
}

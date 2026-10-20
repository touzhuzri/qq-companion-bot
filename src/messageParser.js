/**
 * OneBot 11 群消息事件 → 结构化轮次输入。
 * 只认 @bot 触发;@全体成员不触发。
 */

/**
 * @param {object} event OneBot group message event
 * @param {string|number} botQQ
 * @returns {{
 *   triggered: boolean,
 *   text: string,
 *   images: {url: string, file: string}[],
 *   senderId: string,
 *   nickname: string,
 *   groupId: string,
 * }}
 */
export function parseGroupMessage(event, botQQ) {
  const segments = Array.isArray(event?.message) ? event.message : []
  const botId = String(botQQ)

  const triggered = segments.some(
    (seg) => seg?.type === 'at' && String(seg?.data?.qq ?? '') === botId,
  )

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

  return {
    triggered,
    text: textParts.join(' ').trim(),
    images,
    senderId: String(event?.user_id ?? ''),
    nickname: String(event?.sender?.nickname ?? event?.sender?.card ?? '').trim(),
    groupId: String(event?.group_id ?? ''),
  }
}

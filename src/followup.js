import { askYesNo, buildTranscript } from './ambient.js'

export const FOLLOW_UP_DEFAULTS = {
  /** 是否启用 @ 后的续聊判断 */
  enabled: false,
  /** @ 回复成功后,这个窗口内特别留意同一人的非 @ 发言 */
  windowMs: 20_000,
  /** 一次 @ 最多续聊几轮,避免每句话都接 */
  maxTurns: 2,
  /** 同一人连续发消息时,等这么久再判断 */
  debounceMs: 2000,
  judgeTimeoutMs: 8000,
  /** 续聊回复之间的最小间隔,避免对方每句都接 */
  minReplyGapMs: 8000,
  /** 判断为「不是在和我说话」后,这段时间内不再对该用户尝试旁听 */
  muteAfterNoMs: 60_000,
}

export class FollowUpTracker {
  #config
  #active = new Map()
  #muted = new Map()

  constructor(config = {}) {
    this.#config = { ...FOLLOW_UP_DEFAULTS, ...config }
  }

  get enabled() {
    return Boolean(this.#config.enabled)
  }

  get config() {
    return this.#config
  }

  arm(key, now = Date.now()) {
    if (!this.enabled) return
    this.#active.set(key, {
      until: now + this.#config.windowMs,
      remaining: Math.max(1, Number(this.#config.maxTurns) || 1),
      lastReplyAt: null,
    })
    this.#muted.delete(key)
  }

  isActive(key, now = Date.now()) {
    const state = this.#active.get(key)
    if (!state) return false
    if (now >= state.until || state.remaining <= 0) {
      this.#active.delete(key)
      return false
    }
    return true
  }

  /** 距离上一轮续聊回复是否已经够久 */
  canReply(key, now = Date.now()) {
    const state = this.#active.get(key)
    if (!state) return false
    if (state.lastReplyAt == null) return true
    return now - state.lastReplyAt >= (Number(this.#config.minReplyGapMs) || 0)
  }

  /** 续聊成功一轮:消耗次数并记录间隔,但不延长 20 秒窗口 */
  noteReply(key, now = Date.now()) {
    const state = this.#active.get(key)
    if (!state) return
    state.lastReplyAt = now
    state.remaining -= 1
    if (state.remaining <= 0) this.#active.delete(key)
  }

  clear(key) {
    this.#active.delete(key)
  }

  mute(key, now = Date.now()) {
    this.#active.delete(key)
    this.#muted.set(key, now + this.#config.muteAfterNoMs)
  }

  isMuted(key, now = Date.now()) {
    const until = this.#muted.get(key)
    if (!until) return false
    if (now >= until) {
      this.#muted.delete(key)
      return false
    }
    return true
  }
}

/**
 * @ 之后的续聊判断:最后一条非 @ 消息是否还在和角色说话。
 */
export async function judgeFollowUp({
  recent,
  lastBotReply,
  persona,
  llm,
  timeoutMs = 8000,
} = {}) {
  const transcript = buildTranscript(recent, 8)
  if (!transcript || !llm?.endpoint) return false

  const system = [
    '你是 QQ 群聊的旁听者,只负责判断对方是不是还在和角色说话。',
    `角色名:${persona?.name || '角色'}。`,
    '对方刚刚 @ 过角色,现在又发了一条没有 @ 的消息。',
    '不要每句都接。只有同时满足下面几条才回答 YES:',
    '1. 明显是在对角色说:回应角色上一句、叫角色、问角色;',
    '2. 内容对角色或你们正在聊的事有实际意义,关系/话题相关度高;',
    '3. 不是可以忽略的应答、玩笑、自言自语或对别人说的话。',
    '普通闲聊、单字附和、突然换话题、在和其他人聊天,一律 NO。',
    lastBotReply ? `角色上一句:${lastBotReply}` : '',
    '只回答 YES 或 NO,不要解释。',
  ]
    .filter(Boolean)
    .join('\n')

  return askYesNo({
    system,
    user: `最近群聊:\n${transcript}\n\n只回答 YES 或 NO。`,
    llm,
    timeoutMs,
    label: '续聊判定',
  })
}

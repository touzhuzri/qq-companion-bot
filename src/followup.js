import { askYesNo, buildTranscript } from './ambient.js'

export const FOLLOW_UP_DEFAULTS = {
  /** 是否启用 @ 后的续聊判断 */
  enabled: false,
  /** @ 回复成功后,这个窗口内继续观察同一人的非 @ 发言 */
  windowMs: 5 * 60_000,
  /** 一次 @ 最多续聊几轮,避免无限对话 */
  maxTurns: 6,
  /** 同一人连续发消息时,等这么久再判断 */
  debounceMs: 2000,
  judgeTimeoutMs: 8000,
  /** 判断为「不是在和我说话」后,这段时间内不再对该用户尝试旁听 */
  muteAfterNoMs: 2 * 60_000,
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

  /** 续聊成功一轮:延长窗口并消耗次数 */
  noteReply(key, now = Date.now()) {
    const state = this.#active.get(key)
    if (!state) return
    state.until = now + this.#config.windowMs
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
    '判断这条消息是否仍在和角色说话:回应角色上一句、继续问角色、接角色的话。',
    '不适合:在和其他人说话、换新话题、自言自语、只是群里的一般发言。',
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

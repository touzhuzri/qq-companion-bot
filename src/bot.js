import { resolve } from 'node:path'
import { loadConfig } from './config.js'
import { logger } from './logger.js'
import { flushNow, installStorageShim, setStorageNamespace } from './storage.js'
import { ContextStore } from './contextStore.js'
import { VisionService } from './vision.js'
import { TTSService } from './voice.js'
import { OneBotClient } from './onebot.js'
import { parseMessage } from './messageParser.js'
import { PERSONA } from './persona.js'
import { judgeJoin, keywordHit } from './ambient.js'
import { VoiceControl } from './control.js'
import { deliverReply } from './reply.js'
import { assertLlmUsable } from './llm.js'
import { prepareRuntimeLlm } from './llm-runtime.js'
import { sendTurn } from '../vendor/presence-turn-runtime/src/index.js'

/**
 * 只留纯台词:优先 runtime 已剥过句首旁白的 spokenText,
 * 再把残余的任意括号内容全部去掉——动作描写不允许出现在 QQ 消息里。
 */
function pureSpeech(reply) {
  const base = String(reply?.spokenText || reply?.displayText || reply?.content || '')
  return base
    .replace(/^[（(][^）)]*[）)]\s*/, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

main().catch((err) => {
  logger.error(`启动失败: ${err?.stack ?? err?.message}`)
  process.exit(1)
})

async function main() {
  const config = loadConfig(process.env.BOT_CONFIG || './config.json')
  const stateDir = resolve(config.stateDir)

  assertLlmUsable(config.llm, 'llm')
  if (config.vision.enabled) assertLlmUsable(config.vision.llm, 'vision.llm')
  const { llm: runtimeLlm, bridge } = await prepareRuntimeLlm(config)

  installStorageShim(stateDir)
  const contextStore = new ContextStore(stateDir, config.history.maxItems)
  const vision = new VisionService({ stateDir, ...config.vision, llm: config.vision.llm })
  const tts = new TTSService({
    ...config.voice,
    // 必须绝对路径:SnowLuma 进程的工作目录和 bot 不同,相对路径它打不开
    tempDir: resolve(config.voice.tempDir),
  })
  const voiceControl = new VoiceControl({
    stateDir,
    ...config.control,
    initialEnabled: config.voice.enabled,
    onChange: (enabled) => logger.info(`语音模式已${enabled ? '开启' : '关闭'}`),
  })
  if (config.control.enabled) voiceControl.start()

  const ambientGroups = new Set((config.ambient.groups || []).map(String))

  // 全局回合锁:sendTurn 内部有多个 await,串行化避免跨群串状态
  let tail = Promise.resolve()
  const withTurnLock = (fn) => {
    const run = tail.then(() => fn())
    tail = run.then(
      () => {},
      () => {},
    )
    return run
  }

  /** @type {Map<string, object>} key: sessionKey:userId */
  const pendingTurns = new Map()
  /** @type {Map<string, object[]>} 每群最近的群聊消息(旁听判定用) */
  const recentByGroup = new Map()
  /** @type {Map<string, NodeJS.Timeout>} key: groupId */
  const ambientTimers = new Map()
  /** @type {Map<string, number>} key: groupId,上次旁听接话时间 */
  const lastAmbientAt = new Map()

  const client = new OneBotClient(config.onebot, handleMessage)

  function handleMessage(event) {
    if (String(event.user_id) === String(config.botQQ)) return

    const parsed = parseMessage(event, config.botQQ)

    if (parsed.isPrivate) {
      if (!config.privateChat.enabled) return
      const allow = config.privateChat.allow.map(String)
      if (!allow.includes(parsed.senderId)) return
    } else {
      const allowList = config.groups.allow.map(String)
      if (allowList.length && !allowList.includes(parsed.groupId)) return

      recordRecent(parsed)

      if (!parsed.triggered) {
        scheduleAmbient(parsed)
        return
      }

      cancelAmbient(parsed.groupId)
    }

    const sessionKey = parsed.isPrivate
      ? `private:${parsed.targetId}`
      : `group:${parsed.groupId}`
    const contextKey = parsed.isPrivate ? `private_${parsed.targetId}` : parsed.groupId
    const key = `${sessionKey}:${parsed.senderId}`

    const existing = pendingTurns.get(key)
    if (existing) {
      collectInto(existing, parsed)
      resetTimer(key, existing)
      return
    }

    const turn = {
      isPrivate: parsed.isPrivate,
      targetId: parsed.targetId,
      sessionKey,
      contextKey,
      groupId: parsed.groupId,
      userId: parsed.senderId,
      nickname: parsed.nickname,
      texts: [],
      images: [],
    }
    collectInto(turn, parsed)
    pendingTurns.set(key, turn)
    resetTimer(key, turn)
  }

  function recordRecent(parsed) {
    if (!parsed.text && !parsed.images.length) return
    const list = recentByGroup.get(parsed.groupId) || []
    const next = [
      ...list,
      {
        userId: parsed.senderId,
        nickname: parsed.nickname,
        text: parsed.text,
        images: parsed.images,
        at: Date.now(),
      },
    ]
    const cap = Math.max(8, config.ambient.maxContextMessages + 2)
    recentByGroup.set(parsed.groupId, next.slice(-cap))
  }

  function scheduleAmbient(parsed) {
    if (!config.ambient.enabled) return
    if (!ambientGroups.has(parsed.groupId)) return
    if (!parsed.text && !parsed.images.length) return

    const existing = ambientTimers.get(parsed.groupId)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      ambientTimers.delete(parsed.groupId)
      maybeAmbient(parsed.groupId).catch((err) =>
        logger.warn(`旁听处理失败: ${err?.message}`),
      )
    }, config.ambient.debounceMs)
    ambientTimers.set(parsed.groupId, timer)
  }

  function cancelAmbient(groupId) {
    const timer = ambientTimers.get(groupId)
    if (!timer) return
    clearTimeout(timer)
    ambientTimers.delete(groupId)
  }

  function hasPendingTurn(sessionKey) {
    for (const key of pendingTurns.keys()) {
      if (key.startsWith(`${sessionKey}:`)) return true
    }
    return false
  }

  async function maybeAmbient(groupId) {
    const recent = recentByGroup.get(groupId) || []
    const last = recent[recent.length - 1]
    if (!last) return

    if (Date.now() - (lastAmbientAt.get(groupId) || 0) < config.ambient.minIntervalMs) return
    if (hasPendingTurn(`group:${groupId}`)) return

    if (config.ambient.keywords.length && !keywordHit(last.text, config.ambient.keywords)) {
      return
    }

    if (config.ambient.useLlmJudge) {
      const accepted = await judgeJoin({
        recent,
        persona: PERSONA,
        llm: runtimeLlm,
        timeoutMs: config.ambient.judgeTimeoutMs,
      })
      if (!accepted) {
        logger.info(`群 ${groupId} 旁听判定:不接话`)
        return
      }
    }

    lastAmbientAt.set(groupId, Date.now())
    logger.info(`群 ${groupId} 旁听判定:接话`)
    const turn = {
      isPrivate: false,
      targetId: groupId,
      sessionKey: `group:${groupId}`,
      contextKey: groupId,
      groupId,
      userId: last.userId,
      nickname: last.nickname,
      texts: last.text ? [last.text] : [],
      images: last.images || [],
    }
    await withTurnLock(() => runTurn(turn, { ambient: true }))
  }

  function collectInto(turn, parsed) {
    if (parsed.text) turn.texts.push(parsed.text)
    turn.images.push(...parsed.images)
    if (parsed.nickname && !turn.nickname) turn.nickname = parsed.nickname
  }

  function resetTimer(key, turn) {
    if (turn.timer) clearTimeout(turn.timer)
    turn.timer = setTimeout(() => {
      pendingTurns.delete(key)
      withTurnLock(() => runTurn(turn)).catch((err) =>
        logger.error(`回合异常中断: ${err?.stack ?? err?.message}`),
      )
    }, config.trigger.debounceMs)
  }

  async function runTurn(turn, { ambient = false } = {}) {
    const userMessage = await composeUserMessage(turn)
    if (!userMessage.trim()) return

    setStorageNamespace(turn.sessionKey)
    const label = turn.isPrivate ? `私聊 ${turn.targetId}` : `群 ${turn.groupId}`
    logger.info(
      `${label} | ${ambient ? '[旁听] ' : ''}${turn.nickname || turn.userId}: ` +
        userMessage.replace(/\n/g, ' ⏎ '),
    )

    let result
    try {
      result = await sendTurn({
        userMessage,
        history: ambient
          ? ambientHistory(turn.groupId)
          : contextStore.getHistory(turn.contextKey),
        pack: PERSONA,
        llm: runtimeLlm,
      })
    } catch (err) {
      // 不往群里灌错误文案,保持安静,只记日志
      logger.error(`sendTurn 失败: ${err?.stack ?? err?.message}`)
      return
    }

    contextStore.append(turn.contextKey, 'user', userMessage)
    const lines = result.replies.map(pureSpeech).filter(Boolean)
    if (!lines.length) {
      logger.info('本轮无有效台词(剥空且未抢救成功),保持沉默')
      return
    }

    const delivery = await deliverReply({
      lines,
      target: { isPrivate: turn.isPrivate, targetId: turn.targetId },
      contextKey: turn.contextKey,
      config,
      client,
      tts,
      voiceEnabled: voiceControl.enabled,
      contextStore,
    })
    if (delivery.mode === 'none') {
      logger.info('分段后无有效台词,保持沉默')
      return
    }

    logDone(result, delivery)
  }

  function logDone(result, delivery) {
    const lengths = (delivery?.segments || []).map((segment) => segment.length).join('/')
    logger.info(
      `回复完成 | mode=${delivery?.mode || '?'} segments=${delivery?.segments?.length || 0} ` +
        `lengths=${lengths || '-'} | kind=${result.policy.turnKind} salvage=${
          result.salvage.used ? (result.salvage.adopted ? 'used' : 'rejected') : 'none'
        } affect=${JSON.stringify(result.presence.affect ?? {})}`,
    )
  }

  /** 旁听轮次用最近群聊当上下文,最后一条就是当前 userMessage */
  function ambientHistory(groupId) {
    const list = (recentByGroup.get(groupId) || [])
      .slice(0, -1)
      .slice(-config.ambient.maxContextMessages)
    return list.map((item) => ({
      role: 'user',
      content: `${item.nickname || item.userId || '群友'}: ${item.text || '[图片]'}`,
    }))
  }

  /** 文字 + 图片描述合成一条 user 消息;识图失败降级为通用描述。 */
  async function composeUserMessage(turn) {
    const parts = []
    const text = turn.texts.join(' ').trim()
    if (text) parts.push(text)

    for (const image of turn.images) {
      let description = '一张表情包(识别失败)'
      if (config.vision.enabled) {
        try {
          description = await vision.describe(image.url)
        } catch (err) {
          logger.warn(`识图失败,使用通用描述: ${err?.message}`)
        }
      } else {
        description = '一张表情包(识图未开启)'
      }
      parts.push(`[对方发了一张表情包:${description}]`)
    }
    return parts.join('\n')
  }

  client.connect()

  function shutdown() {
    logger.info('退出中…')
    client.close()
    voiceControl.stop()
    bridge?.stop()
    flushNow()
    process.exit(0)
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown)
}

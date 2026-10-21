import { resolve } from 'node:path'
import { loadConfig } from './config.js'
import { logger } from './logger.js'
import { flushNow, installStorageShim, setStorageNamespace } from './storage.js'
import { ContextStore } from './contextStore.js'
import { VisionService } from './vision.js'
import { TTSService } from './voice.js'
import { OneBotClient } from './onebot.js'
import { parseGroupMessage } from './messageParser.js'
import { PERSONA } from './persona.js'
import { sendTurn } from '../vendor/presence-turn-runtime/src/index.js'

const REPLY_GAP_MS = 800

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

  installStorageShim(stateDir)
  const contextStore = new ContextStore(stateDir, config.history.maxItems)
  const vision = new VisionService({ stateDir, ...config.vision, llm: config.llm })
  const tts = new TTSService({
    ...config.voice,
    // 必须绝对路径:SnowLuma 进程的工作目录和 bot 不同,相对路径它打不开
    tempDir: resolve(config.voice.tempDir),
  })

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

  /** @type {Map<string, object>} key: groupId:userId */
  const pendingTurns = new Map()
  /** @type {Map<string, number>} key: groupId */
  const lastReplyAt = new Map()

  const client = new OneBotClient(config.onebot, handleGroupMessage)

  function handleGroupMessage(event) {
    if (String(event.user_id) === String(config.botQQ)) return

    const parsed = parseGroupMessage(event, config.botQQ)
    if (!parsed.triggered) return
    const allowList = config.groups.allow.map(String)
    if (allowList.length && !allowList.includes(parsed.groupId)) return

    const key = `${parsed.groupId}:${parsed.senderId}`
    const existing = pendingTurns.get(key)
    if (existing) {
      collectInto(existing, parsed)
      resetTimer(key, existing)
      return
    }

    const turn = {
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

  async function runTurn(turn) {
    const last = lastReplyAt.get(turn.groupId) ?? 0
    if (Date.now() - last < config.trigger.cooldownMs) {
      logger.info(`群 ${turn.groupId} 冷却中,跳过本轮`)
      return
    }

    const userMessage = await composeUserMessage(turn)
    if (!userMessage.trim()) return

    setStorageNamespace(turn.groupId)
    logger.info(
      `群 ${turn.groupId} | ${turn.nickname || turn.userId}: ${userMessage.replace(/\n/g, ' ⏎ ')}`,
    )

    let result
    try {
      result = await sendTurn({
        userMessage,
        history: contextStore.getHistory(turn.groupId),
        pack: PERSONA,
        llm: config.llm,
      })
    } catch (err) {
      // 不往群里灌错误文案,保持安静,只记日志
      logger.error(`sendTurn 失败: ${err?.stack ?? err?.message}`)
      return
    }

    contextStore.append(turn.groupId, 'user', userMessage)
    const lines = result.replies.map(pureSpeech).filter(Boolean)
    if (!lines.length) {
      logger.info('本轮无有效台词(剥空且未抢救成功),保持沉默')
      return
    }

    for (const line of lines) {
      try {
        await client.sendGroupText(turn.groupId, line)
      } catch (err) {
        logger.error(`发送失败: ${err?.message}`)
        break
      }
      contextStore.append(turn.groupId, 'assistant', line)
      await sleep(REPLY_GAP_MS)
    }

    // 语音跟在文字后面;失败静默降级为纯文字
    if (config.voice.enabled) {
      try {
        const wavPath = await tts.synthesize(lines.join(''))
        await client.sendGroupMessage(turn.groupId, [
          { type: 'record', data: { file: `file://${wavPath}` } },
        ])
        tts.cleanupLater(wavPath)
      } catch (err) {
        logger.warn(`语音发送失败(文字已发出): ${err?.message}`)
      }
    }

    lastReplyAt.set(turn.groupId, Date.now())
    logger.info(
      `回复完成 | kind=${result.policy.turnKind} salvage=${
        result.salvage.used ? (result.salvage.adopted ? 'used' : 'rejected') : 'none'
      } affect=${JSON.stringify(result.presence.affect ?? {})}`,
    )
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
    flushNow()
    process.exit(0)
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown)

  function sleep(ms) {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
  }
}

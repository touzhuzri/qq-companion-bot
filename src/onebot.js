import { randomUUID } from 'node:crypto'
import { logger } from './logger.js'

const WATCHDOG_TICK_MS = 15000

/**
 * SnowLuma / NapCat(OneBot 11)正向 WebSocket 客户端。
 * Node 26 自带全局 WebSocket,零依赖;access_token 走 query 参数
 * (Node 内置 WebSocket 不支持自定义 header)。
 *
 * 假死检测:统计最近一帧时间(含心跳等 meta 事件),超时强制断开重连,
 * 避免休眠恢复/静默丢包后长期"已连接但失聪"。
 */
export class OneBotClient {
  #url
  #reconnectBaseMs
  #reconnectMaxMs
  #staleTimeoutMs
  #onGroupMessage
  /** @type {WebSocket|null} */
  #ws = null
  #closedByUs = false
  #pendingCalls = new Map()
  #attempts = 0
  #lastFrameAt = 0
  /** @type {NodeJS.Timeout|null} */
  #watchdog = null
  /** @type {NodeJS.Timeout|null} */
  #reconnectTimer = null

  constructor(
    { wsUrl, accessToken, reconnectBaseMs, reconnectMaxMs, staleTimeoutMs },
    onGroupMessage,
  ) {
    const token = String(accessToken || '')
    this.#url = token
      ? `${wsUrl}${wsUrl.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`
      : wsUrl
    this.#reconnectBaseMs = reconnectBaseMs
    this.#reconnectMaxMs = reconnectMaxMs
    this.#staleTimeoutMs = staleTimeoutMs
    this.#onGroupMessage = onGroupMessage
  }

  connect() {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = null
    }
    this.#closedByUs = false
    const ws = new WebSocket(this.#url)
    this.#ws = ws
    this.#lastFrameAt = Date.now()
    this.#startWatchdog()

    ws.addEventListener('open', () => {
      // 已被看门狗丢弃的旧连接迟到 open,忽略
      if (this.#ws !== ws) return
      this.#attempts = 0
      logger.info(`OneBot 已连接: ${this.#url.replace(/access_token=[^&]+/, 'access_token=***')}`)
    })

    ws.addEventListener('message', ({ data }) => {
      if (this.#ws !== ws) return
      this.#lastFrameAt = Date.now()
      this.#handleFrame(String(data))
    })

    ws.addEventListener('close', () => {
      // 看门狗强制重连时已置空 #ws 并自行重连,这里不再重复处理
      if (this.#ws !== ws) return
      this.#ws = null
      this.#stopWatchdog()
      this.#rejectPending()
      if (this.#closedByUs) return
      this.#scheduleReconnect()
    })

    ws.addEventListener('error', (err) => {
      logger.warn(`WebSocket 错误: ${err?.message || err?.error?.message || '连接失败'}`)
    })
  }

  close() {
    this.#closedByUs = true
    this.#stopWatchdog()
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = null
    }
    this.#ws?.close()
  }

  /**
   * 调 OneBot action 并等回包。
   * @returns {Promise<object>} action 响应里的 data 字段
   */
  call(action, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
        reject(new Error('OneBot 未连接'))
        return
      }
      const echo = randomUUID()
      this.#pendingCalls.set(echo, { resolve, reject })
      this.#ws.send(JSON.stringify({ action, params, echo }))
      setTimeout(() => {
        if (this.#pendingCalls.delete(echo)) {
          reject(new Error(`OneBot ${action} 超时`))
        }
      }, 10000)
    })
  }

  sendGroupMessage(groupId, segments) {
    return this.call('send_group_msg', {
      group_id: Number(groupId),
      message: segments,
    })
  }

  async sendGroupText(groupId, text) {
    return this.sendGroupMessage(groupId, [{ type: 'text', data: { text } }])
  }

  #scheduleReconnect() {
    const attempt = this.#attempts++
    const delay = Math.min(this.#reconnectMaxMs, this.#reconnectBaseMs * 2 ** attempt)
    logger.warn(`连接断开(第 ${attempt + 1} 次重试),${delay}ms 后重连`)
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null
      try {
        this.connect()
      } catch (err) {
        // 构造连接抛异常也要继续重试,不让重连循环停摆
        logger.error(`重连失败: ${err?.stack ?? err?.message}`)
        this.#scheduleReconnect()
      }
    }, delay)
  }

  #startWatchdog() {
    this.#stopWatchdog()
    this.#watchdog = setInterval(() => {
      const idleFor = Date.now() - this.#lastFrameAt
      if (idleFor <= this.#staleTimeoutMs) return
      logger.warn(`${Math.round(idleFor / 1000)}s 未收到任何帧,判定连接假死,强制重连`)
      this.#dropAndReconnect()
    }, WATCHDOG_TICK_MS)
  }

  /**
   * 假死连接不能只靠 close() 等事件:半开连接可能永远不触发 close。
   * 这里先摘掉引用(让旧连接的 close 回调失效),再主动发起重连。
   */
  #dropAndReconnect() {
    const ws = this.#ws
    this.#ws = null
    this.#stopWatchdog()
    this.#rejectPending()
    try {
      ws?.close()
    } catch {
      // 已关闭或状态异常都无所谓,下面直接重连
    }
    this.#scheduleReconnect()
  }

  #rejectPending() {
    for (const { reject } of this.#pendingCalls.values()) {
      reject(new Error('OneBot 连接已断开'))
    }
    this.#pendingCalls.clear()
  }

  #stopWatchdog() {
    if (this.#watchdog) {
      clearInterval(this.#watchdog)
      this.#watchdog = null
    }
  }

  #handleFrame(raw) {
    let frame
    try {
      frame = JSON.parse(raw)
    } catch {
      return
    }
    if (frame.echo && this.#pendingCalls.has(frame.echo)) {
      const { resolve, reject } = this.#pendingCalls.get(frame.echo)
      this.#pendingCalls.delete(frame.echo)
      // retcode 1200 = 已受理异步执行,消息会送达,不算失败
      const isFailure =
        frame.status === 'failed' ||
        (frame.retcode !== undefined && frame.retcode !== 0 && frame.retcode !== 1200)
      if (isFailure) {
        reject(new Error(frame.message || frame.wording || `retcode=${frame.retcode}`))
      } else {
        resolve(frame.data)
      }
      return
    }
    if (frame.post_type === 'message' && frame.message_type === 'group') {
      try {
        this.#onGroupMessage(frame)
      } catch (err) {
        logger.error(`处理群消息出错: ${err?.stack ?? err?.message}`)
      }
    }
  }
}

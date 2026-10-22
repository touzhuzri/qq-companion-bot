import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { logger } from './logger.js'

const MAX_BODY_BYTES = 4 * 1024 * 1024
const RETRYABLE_STATUS = new Set([401, 403, 408, 409, 425, 429, 500, 502, 503, 504])
const COOLDOWN_MS = {
  auth: 5 * 60_000,
  rate: 30_000,
  // 超时/网络异常往往意味着这个 key 当前不可用,冷却久一点避免每轮都先撞它
  server: 60_000,
}

/**
 * 把 OpenAI Chat Completions 请求翻译成 Anthropic Messages 请求,
 * 再转回 OpenAI 响应。运行时(以及它的视觉/旁听调用方)只认 OpenAI 协议,
 * 智谱的 /api/anthropic 端点则只认 Anthropic 协议。
 *
 * 多个 apiKey 轮询使用;遇到 429/401/5xx 自动换下一个 key,
 * 并给出错的 key 一个短期冷却,避免每次请求都先撞一次坏 key。
 */
export class AnthropicBridge {
  #endpoint
  #apiKeys
  #model
  #version
  #host
  #port
  #actualPort
  #timeoutMs
  #thinking
  #maxTokens
  #token
  #server = null
  #nextIndex = 0
  #cooldownUntil

  constructor({
    endpoint,
    apiKeys = [],
    model,
    anthropicVersion = '2023-06-01',
    host = '127.0.0.1',
    port = 8090,
    timeoutMs = 60000,
    thinking = 'auto',
    maxTokens = 0,
    token,
  } = {}) {
    this.#endpoint = endpoint
    this.#apiKeys = (apiKeys || []).filter(Boolean)
    this.#model = model
    this.#version = anthropicVersion
    this.#host = host
    this.#port = port
    this.#timeoutMs = timeoutMs
    this.#thinking = thinking
    this.#maxTokens = maxTokens
    this.#token = token || randomBytes(24).toString('hex')
    this.#cooldownUntil = this.#apiKeys.map(() => 0)
  }

  get token() {
    return this.#token
  }

  get url() {
    return `http://${this.#host}:${this.#actualPort}/v1/chat/completions`
  }

  start() {
    return new Promise((resolveStart, rejectStart) => {
      if (this.#server) {
        resolveStart(this.url)
        return
      }
      const server = createServer((req, res) => this.#handle(req, res))
      server.once('error', rejectStart)
      server.listen(this.#port, this.#host, () => {
        this.#server = server
        this.#actualPort = server.address().port
        logger.info(`Anthropic 桥已启动: ${this.url} (keys=${this.#apiKeys.length})`)
        resolveStart(this.url)
      })
    })
  }

  stop() {
    this.#server?.close()
    this.#server = null
  }

  #handle(req, res) {
    if (!this.#authorized(req)) {
      sendJson(res, 401, { error: { message: 'unauthorized' } })
      return
    }

    const path = new URL(req.url || '/', 'http://localhost').pathname
    if (req.method === 'GET' && path === '/v1/models') {
      sendJson(res, 200, {
        object: 'list',
        data: [{ id: this.#model, object: 'model', created: Math.floor(Date.now() / 1000) }],
      })
      return
    }
    if (req.method === 'POST' && path === '/v1/chat/completions') {
      this.#readBody(req, res)
      return
    }
    sendJson(res, 404, { error: { message: 'not found' } })
  }

  #authorized(req) {
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    const key = String(req.headers['x-api-key'] || '')
    return bearer === this.#token || key === this.#token
  }

  #readBody(req, res) {
    let body = ''
    let tooLarge = false
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      if (tooLarge) return
      body += chunk
      if (body.length > MAX_BODY_BYTES) {
        tooLarge = true
        sendJson(res, 413, { error: { message: 'request body too large' } })
        req.destroy()
      }
    })
    req.on('end', () => {
      if (tooLarge) return
      let parsed
      try {
        parsed = JSON.parse(body)
      } catch {
        sendJson(res, 400, { error: { message: 'invalid JSON body' } })
        return
      }
      this.#complete(parsed)
        .then((payload) => sendJson(res, 200, payload))
        .catch((err) => {
          logger.error(`Anthropic 桥请求失败: ${err?.message}`)
          sendJson(res, 502, { error: { message: err?.message || 'upstream failed' } })
        })
    })
  }

  async #complete(body) {
    const request = toAnthropicRequest(body, this.#model, {
      thinking: this.#thinking,
      maxTokens: this.#maxTokens,
    })
    const payload = await this.#callUpstream(request)
    return toOpenAiResponse(payload, this.#model)
  }

  async #callUpstream(request) {
    if (!this.#apiKeys.length) throw new Error('没有可用的 apiKey')
    const url = messagesUrl(this.#endpoint)
    const errors = []
    const now = Date.now()

    const ready = []
    const cooling = []
    for (let offset = 0; offset < this.#apiKeys.length; offset++) {
      const index = (this.#nextIndex + offset) % this.#apiKeys.length
      if (this.#cooldownUntil[index] > now) cooling.push(index)
      else ready.push(index)
    }
    const order = [...ready, ...cooling]

    for (const index of order) {
      const key = this.#apiKeys[index]
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'anthropic-version': this.#version,
            'x-api-key': key,
            // 智谱的 Claude 搬家计划也接受 Bearer,两个都带以兼容不同网关
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(this.#timeoutMs),
        })

        if (response.ok) {
          const payload = await response.json()
          if (payload?.error) throw new Error(formatUpstreamError(payload))
          this.#nextIndex = (index + 1) % this.#apiKeys.length
          this.#cooldownUntil[index] = 0
          return payload
        }

        const detail = (await response.text().catch(() => '')).slice(0, 160)
        const label = `key#${index + 1}`
        errors.push(`${label} HTTP ${response.status} ${detail}`)
        logger.warn(`Anthropic 上游 ${label} 失败: HTTP ${response.status}`)

        if (response.status === 401 || response.status === 403) {
          this.#cooldownUntil[index] = Date.now() + COOLDOWN_MS.auth
        } else if (response.status === 429) {
          this.#cooldownUntil[index] = Date.now() + COOLDOWN_MS.rate
        } else {
          this.#cooldownUntil[index] = Date.now() + COOLDOWN_MS.server
        }
        if (!RETRYABLE_STATUS.has(response.status)) break
      } catch (err) {
        errors.push(`key#${index + 1} ${err?.message || err}`)
        logger.warn(`Anthropic 上游 key#${index + 1} 请求异常: ${err?.message || err}`)
        this.#cooldownUntil[index] = Date.now() + COOLDOWN_MS.server
      }
    }

    throw new Error(`上游 Anthropic 请求失败: ${errors.join(' | ')}`)
  }
}

export function messagesUrl(endpoint) {
  const base = String(endpoint || '').replace(/\/+$/, '')
  return base.endsWith('/v1/messages') ? base : `${base}/v1/messages`
}

export function toAnthropicRequest(
  body = {},
  fallbackModel,
  { thinking = 'auto', maxTokens = 0 } = {},
) {
  const systemParts = []
  const messages = []

  for (const message of body.messages || []) {
    if (message?.role === 'system') {
      systemParts.push(contentToText(message.content))
      continue
    }
    messages.push({
      role: message?.role === 'assistant' ? 'assistant' : 'user',
      content: toAnthropicContent(message?.content),
    })
  }

  const request = {
    model: body.model || fallbackModel,
    max_tokens: Math.max(Number(body.max_tokens) || 512, Number(maxTokens) || 0),
    messages,
    stream: false,
  }
  if (systemParts.join('\n\n').trim()) request.system = systemParts.join('\n\n').trim()
  if (Number.isFinite(body.temperature)) request.temperature = body.temperature
  if (Number.isFinite(body.top_p)) request.top_p = body.top_p
  // GLM-4.5 等模型默认先输出 thinking,会吃掉回复的 token 预算。
  // 聊天场景显式关闭,让预算全部用于说出口的台词。
  if (thinking === 'disabled') request.thinking = { type: 'disabled' }
  return request
}

function toAnthropicContent(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return [{ type: 'text', text: ' ' }]

  const blocks = []
  for (const part of content) {
    if (part?.type === 'text') {
      blocks.push({ type: 'text', text: String(part.text ?? '') })
      continue
    }
    if (part?.type === 'image_url') {
      const url = String(part.image_url?.url || '')
      const data = parseDataUrl(url)
      if (data) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: data.mediaType, data: data.base64 },
        })
      } else if (url) {
        blocks.push({ type: 'image', source: { type: 'url', url } })
      }
    }
  }
  return blocks.length ? blocks : [{ type: 'text', text: ' ' }]
}

function contentToText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part?.type === 'text')
    .map((part) => String(part.text ?? ''))
    .join('')
}

function parseDataUrl(url) {
  const match = /^data:([^;,]+);base64,(.*)$/is.exec(url)
  if (!match) return null
  return { mediaType: match[1], base64: match[2] }
}

function toOpenAiResponse(payload, fallbackModel) {
  const text = (payload?.content || [])
    .filter((block) => block?.type === 'text')
    .map((block) => String(block.text || ''))
    .join('')
  const inputTokens = Number(payload?.usage?.input_tokens) || 0
  const outputTokens = Number(payload?.usage?.output_tokens) || 0

  return {
    id: payload?.id || `chatcmpl-${randomBytes(8).toString('hex')}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: payload?.model || fallbackModel,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: mapStopReason(payload?.stop_reason),
      },
    ],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  }
}

function mapStopReason(reason) {
  if (reason === 'max_tokens') return 'length'
  if (reason === 'tool_use') return 'tool_calls'
  return 'stop'
}

function formatUpstreamError(payload) {
  return String(payload?.error?.message || payload?.error || 'upstream error')
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

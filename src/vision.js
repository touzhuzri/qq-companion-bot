import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from './logger.js'

/**
 * 表情包/图片识别:
 * 1. MD5 缓存命中 → 直接返回旧描述(免费、前后认知一致)
 * 2. 未命中 → 同一个 llama-server 端点带图问一句,压成短结构化输出
 */
export class VisionService {
  /** @type {Map<string, string>} */
  #cache = new Map()
  #cachePath
  #llm
  #maxImageBytes
  #fetchTimeoutMs
  #inflight = new Map()

  constructor({ stateDir, llm, maxImageBytes, fetchTimeoutMs }) {
    this.#cachePath = join(stateDir, 'image-cache.json')
    this.#llm = llm
    this.#maxImageBytes = maxImageBytes
    this.#fetchTimeoutMs = fetchTimeoutMs
    mkdirSync(stateDir, { recursive: true })
    try {
      const raw = JSON.parse(readFileSync(this.#cachePath, 'utf8'))
      if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) this.#cache.set(k, String(v))
      }
    } catch {
      // 首次运行为空
    }
  }

  async describe(url) {
    const bytes = await downloadImage(url, { maxBytes: this.#maxImageBytes, timeoutMs: this.#fetchTimeoutMs })
    const md5 = createHash('md5').update(bytes).digest('hex')
    const cached = this.#cache.get(md5)
    if (cached) return cached
    if (this.#inflight.has(md5)) return this.#inflight.get(md5)

    const promise = this.#describeFresh(bytes)
      .then((desc) => {
        this.#remember(md5, desc)
        return desc
      })
      .finally(() => this.#inflight.delete(md5))
    this.#inflight.set(md5, promise)
    return promise
  }

  async #describeFresh(bytes) {
    const dataUrl = `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
    const response = await fetch(this.#llm.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.#llm.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.#llm.model,
        temperature: 0.2,
        max_tokens: 80,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  '这是一张QQ聊天表情包。用一句话回答:主体是什么+什么情绪+想表达什么意思。不超过30个字,不要评价画质和构图。',
              },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    })
    if (!response.ok) {
      throw new Error(`视觉模型 HTTP ${response.status}`)
    }
    const payload = await response.json()
    const text = String(payload?.choices?.[0]?.message?.content ?? '').trim()
    if (!text) throw new Error('视觉模型未返回内容')
    return text.slice(0, 120)
  }

  #remember(md5, desc) {
    this.#cache.set(md5, desc)
    while (this.#cache.size > 1000) {
      const oldest = this.#cache.keys().next().value
      this.#cache.delete(oldest)
    }
    try {
      writeFileSync(
        this.#cachePath,
        JSON.stringify(Object.fromEntries([...this.#cache].slice(-500))),
      )
    } catch (err) {
      logger.warn(`表情包缓存写盘失败: ${err?.message}`)
    }
  }
}

async function downloadImage(url, { maxBytes, timeoutMs }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // QQ 多媒体域名的直链通常需要浏览器式 UA
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
    })
    if (!response.ok) throw new Error(`下载图片 HTTP ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > maxBytes) throw new Error(`图片超过大小上限(${maxBytes})`)
    return buffer
  } finally {
    clearTimeout(timer)
  }
}

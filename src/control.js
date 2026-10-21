import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { logger } from './logger.js'

const MAX_BODY_BYTES = 2048

const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QQ bot 控制台</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Noto Sans SC", sans-serif;
         max-width: 34rem; margin: 10vh auto; padding: 0 1.25rem; line-height: 1.7; }
  main { border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
         border-radius: 14px; padding: 1.5rem 1.75rem; }
  h1 { font-size: 1.15rem; margin: 0 0 1rem; }
  label { display: flex; gap: .75rem; align-items: center; font-size: 1.05rem; }
  input { width: 1.15rem; height: 1.15rem; }
  #status { margin-top: 1rem; font-size: .9rem; opacity: .7; }
</style>
</head>
<body>
<main>
  <h1>QQ bot 控制台</h1>
  <label>
    <input id="voice" type="checkbox">
    <span>发送语音(开启后只发语音,不发文字)</span>
  </label>
  <div id="status">读取中…</div>
</main>
<script>
const voice = document.getElementById('voice')
const status = document.getElementById('status')
async function refresh() {
  try {
    const data = await fetch('/status', { cache: 'no-store' }).then((r) => r.json())
    voice.checked = Boolean(data.voice)
    status.textContent = data.voice ? '当前:语音模式' : '当前:文字模式'
  } catch {
    status.textContent = '无法连接 bot'
  }
}
voice.addEventListener('change', async () => {
  status.textContent = '保存中…'
  try {
    await fetch('/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: voice.checked }),
    })
    status.textContent = voice.checked ? '当前:语音模式' : '当前:文字模式'
  } catch {
    status.textContent = '保存失败'
    await refresh()
  }
})
refresh()
</script>
</body>
</html>`

/**
 * bot 自带的本地语音开关。
 * SnowLuma 的 WebUI 没有插件接口,所以开关放在这里;默认只监听 127.0.0.1。
 */
export class VoiceControl {
  #enabled
  #server = null
  #statePath
  #host
  #port
  #onChange

  constructor({ stateDir, host = '127.0.0.1', port = 5100, initialEnabled = false, onChange } = {}) {
    this.#statePath = join(stateDir, 'voice.json')
    this.#host = host
    this.#port = port
    this.#onChange = onChange
    this.#enabled = loadSavedEnabled(this.#statePath, initialEnabled)
  }

  get enabled() {
    return this.#enabled
  }

  setEnabled(value) {
    const next = Boolean(value)
    if (next === this.#enabled) return
    this.#enabled = next
    persist(this.#statePath, next)
    this.#onChange?.(next)
  }

  start() {
    if (this.#server) return
    this.#server = createServer((req, res) => this.#handle(req, res))
    this.#server.on('error', (err) => {
      logger.error(`控制页启动失败(:${this.#port}): ${err?.message}`)
    })
    this.#server.listen(this.#port, this.#host, () => {
      logger.info(`语音控制页: http://${this.#host}:${this.#port}`)
    })
  }

  stop() {
    this.#server?.close()
    this.#server = null
  }

  #handle(req, res) {
    const url = new URL(req.url || '/', 'http://localhost')

    if (req.method === 'GET' && url.pathname === '/') {
      send(res, 200, 'text/html; charset=utf-8', PAGE)
      return
    }
    if (req.method === 'GET' && url.pathname === '/status') {
      send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ voice: this.#enabled }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/voice') {
      this.#readVoiceToggle(req, res)
      return
    }
    send(res, 404, 'text/plain; charset=utf-8', 'not found')
  }

  #readVoiceToggle(req, res) {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > MAX_BODY_BYTES) req.destroy()
    })
    req.on('end', () => {
      const enabled = parseEnabled(body, req.headers['content-type'] || '')
      if (enabled === null) {
        send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: 'invalid body' }))
        return
      }
      this.setEnabled(enabled)
      send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ voice: this.#enabled }))
    })
  }
}

function parseEnabled(body, contentType) {
  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(body)
      return typeof parsed?.enabled === 'boolean' ? parsed.enabled : null
    } catch {
      return null
    }
  }
  const form = new URLSearchParams(body)
  const value = form.get('enabled')
  if (value === 'on' || value === 'true' || value === '1') return true
  if (value === 'off' || value === 'false' || value === '0') return false
  return null
}

function loadSavedEnabled(path, fallback) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed?.enabled === 'boolean' ? parsed.enabled : Boolean(fallback)
  } catch {
    return Boolean(fallback)
  }
}

function persist(path, enabled) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ enabled }))
  } catch (err) {
    logger.warn(`语音开关落盘失败: ${err?.message}`)
  }
}

function send(res, status, contentType, body) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

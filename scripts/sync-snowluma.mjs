/**
 * 从 SnowLuma 的 config/onebot_<UIN>.json 同步:
 *   - botQQ(登录的 UIN)
 *   - onebot.wsUrl
 *   - onebot.accessToken
 *
 * SnowLuma 每次生成/保存 OneBot 配置时可能带一个随机 access token,
 * 手动复制很容易漏。start.sh 启动前会自动跑一次;也可以单独执行:
 *
 *   node scripts/sync-snowluma.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BOT_CONFIG = join(ROOT, 'config.json')

function snowlumaCandidates() {
  const candidates = []
  for (const base of [ROOT, dirname(ROOT)]) {
    for (const name of ['SnowLuma']) {
      const path = join(base, name)
      if (existsSync(join(path, 'launcher.sh'))) candidates.push(path)
    }
    let entries = []
    try {
      entries = readdirSync(base)
    } catch {
      continue
    }
    for (const name of entries) {
      if (!/^SnowLuma-/.test(name)) continue
      const path = join(base, name)
      if (existsSync(join(path, 'launcher.sh'))) candidates.push(path)
    }
  }
  return [...new Set(candidates)]
}

function onebotConfigs(dir) {
  const configDir = join(dir, 'config')
  try {
    return readdirSync(configDir)
      .map((name) => ({ name, match: /^onebot_(\d+)\.json$/.exec(name) }))
      .filter((item) => item.match)
      .map((item) => ({
        path: join(configDir, item.name),
        uin: item.match[1],
        mtime: statSync(join(configDir, item.name)).mtimeMs,
      }))
  } catch {
    return []
  }
}

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function wsUrlFor(network) {
  const host = network.host || '127.0.0.1'
  const port = Number(network.port) || 3001
  const path = network.path || '/'
  return `ws://${host}:${port}${path.startsWith('/') ? path : `/${path}`}`
}

function main() {
  if (!existsSync(BOT_CONFIG)) {
    console.log('[snowluma] 找不到 config.json,跳过同步')
    return
  }
  const config = loadJson(BOT_CONFIG)
  if (!config) {
    console.warn('[snowluma] config.json 解析失败,跳过同步')
    return
  }

  const dirs = snowlumaCandidates()
  if (!dirs.length) {
    console.log('[snowluma] 未找到 SnowLuma 发行包,跳过同步')
    return
  }

  const currentUin = String(config.botQQ || '')
  let picked = null
  for (const dir of dirs) {
    const configs = onebotConfigs(dir)
    if (!configs.length) continue
    const preferred = configs.find((item) => item.uin === currentUin)
    const chosen = preferred || configs.sort((a, b) => b.mtime - a.mtime)[0]
    picked = { dir, ...chosen }
    break
  }

  if (!picked) {
    console.log('[snowluma] 尚未生成 OneBot 配置。先在 SnowLuma 接入 QQ 并启用 OneBot,再运行 start.sh。')
    return
  }

  const onebot = loadJson(picked.path)
  const ws = onebot?.networks?.wsServers?.find((server) => server?.port)
  if (!ws) {
    console.log(`[snowluma] ${picked.path} 里没有 WebSocket 服务端配置,跳过同步`)
    return
  }

  const token = String(ws.accessToken || '')
  const wsUrl = wsUrlFor(ws)
  const next = {
    ...config,
    botQQ: Number(picked.uin) || config.botQQ,
    onebot: {
      ...config.onebot,
      wsUrl,
      accessToken: token,
    },
  }

  const changed =
    String(config.botQQ) !== String(next.botQQ) ||
    config.onebot?.wsUrl !== wsUrl ||
    String(config.onebot?.accessToken || '') !== token

  if (!changed) {
    console.log(`[snowluma] 配置已是最新: WS ${wsUrl}, token ${token.length} 字符`)
    return
  }

  writeFileSync(BOT_CONFIG, `${JSON.stringify(next, null, 2)}\n`)
  console.log(
    `[snowluma] 已同步: botQQ ${currentUin || '?'} -> ${next.botQQ}, ` +
      `WS ${wsUrl}, token ${token.length} 字符`,
  )
}

main()

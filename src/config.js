import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const DEFAULTS = {
  onebot: {
    wsUrl: 'ws://127.0.0.1:3001',
    accessToken: '',
    reconnectBaseMs: 1000,
    reconnectMaxMs: 30000,
    /** 超过该毫秒数没收到任何帧(含心跳)就判定假死并重连 */
    staleTimeoutMs: 120000,
  },
  llm: {
    endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
    modelsEndpoint: 'http://127.0.0.1:8080/v1/models',
    apiKey: 'local',
    model: 'qwen3-vl-4b',
  },
  groups: {
    /** 空 = 所有群都响应 */
    allow: [],
  },
  trigger: {
    debounceMs: 2000,
    cooldownMs: 8000,
  },
  history: {
    maxItems: 24,
  },
  vision: {
    enabled: true,
    maxImageBytes: 10 * 1024 * 1024,
    fetchTimeoutMs: 15000,
  },
  voice: {
    /** 开启前必须填 refAudioPath / promptText（见 README「语音」一节） */
    enabled: false,
    apiEndpoint: 'http://127.0.0.1:9880/tts',
    /** GPT-SoVITS 参考音频的绝对路径（3~10 秒、干净无背景音） */
    refAudioPath: '',
    /** 参考音频里说的那句话，必须逐字一致 */
    promptText: '',
    tempDir: './state/tts',
  },
  stateDir: './state',
}

/**
 * 加载并校验配置。必填项缺失直接抛错(fail fast)。
 * @param {string} configPath
 */
export function loadConfig(configPath = './config.json') {
  let fileRaw = {}
  try {
    fileRaw = JSON.parse(readFileSync(resolve(configPath), 'utf8'))
  } catch (err) {
    if (err?.code === 'ENOENT') {
      throw new Error(
        `找不到配置文件 ${configPath}。请复制 config.example.json 为 config.json 并填写 botQQ 等。`,
      )
    }
    throw new Error(`配置文件解析失败: ${err.message}`)
  }

  const merged = deepMerge(DEFAULTS, fileRaw)

  const missing = []
  if (!merged.onebot?.wsUrl) missing.push('onebot.wsUrl')
  if (!merged.botQQ) missing.push('botQQ')
  if (!merged.llm?.endpoint || !merged.llm?.model) missing.push('llm.endpoint / llm.model')
  if (missing.length) {
    throw new Error(`配置缺少必填项: ${missing.join(', ')}`)
  }
  if (merged.voice?.enabled) {
    const voiceMissing = []
    if (!merged.voice.apiEndpoint) voiceMissing.push('voice.apiEndpoint')
    if (!merged.voice.refAudioPath) voiceMissing.push('voice.refAudioPath')
    if (!merged.voice.promptText) voiceMissing.push('voice.promptText')
    if (voiceMissing.length) {
      throw new Error(
        `voice.enabled 为 true 但缺少: ${voiceMissing.join(', ')}。` +
          '填好参考音频，或把 voice.enabled 设为 false。',
      )
    }
  }
  return merged
}

function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override
  }
  const out = { ...base }
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value
  }
  return out
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

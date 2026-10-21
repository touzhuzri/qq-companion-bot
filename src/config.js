import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertLlmUsable, isAnthropic, resolveLlm, resolveVisionLlm } from './llm.js'

export const DEFAULTS = {
  onebot: {
    wsUrl: 'ws://127.0.0.1:3001',
    accessToken: '',
    reconnectBaseMs: 1000,
    reconnectMaxMs: 30000,
    /** 超过该毫秒数没收到任何帧(含心跳)就判定假死并重连 */
    staleTimeoutMs: 120000,
  },
  /**
   * 文字模型;endpoint/apiKey 由 provider 预设补齐,
   * 这里不要放默认端点,否则用户只写 provider: "openai" 时会被本地端点覆盖。
   */
  llm: {
    provider: 'local',
    model: 'qwen3-vl-4b',
    /** anthropic/zhipu 协议用多 key 轮换;openai 协议只用 apiKey */
    apiKeys: [],
    anthropicVersion: '2023-06-01',
    timeoutMs: 60000,
    /** 本地 Anthropic→OpenAI 桥,仅 text provider 为 anthropic/zhipu 时启动 */
    bridge: {
      host: '127.0.0.1',
      port: 8090,
    },
  },
  groups: {
    /** 空 = 所有群都响应 */
    allow: [],
  },
  privateChat: {
    /** 私聊默认关闭;开启时必须填写 allow,避免对陌生人回复 */
    enabled: false,
    allow: [],
  },
  trigger: {
    /** 合并同一人连续消息的窗口,不是回复冷却 */
    debounceMs: 2000,
  },
  reply: {
    /** API 返回后,回复前只等一次 4~8 秒 */
    delayMinMs: 4000,
    delayMaxMs: 8000,
    /** 按长度切分:单条最少/理想/最多字数,单轮最多几条 */
    segmentMinChars: 12,
    segmentTargetChars: 24,
    segmentMaxChars: 45,
    segmentMaxMessages: 6,
    /** 同一条回复的多个分段之间,模拟打字的短间隔 */
    segmentGapMinMs: 1200,
    segmentGapMaxMs: 2800,
  },
  ambient: {
    /** 旁听接话默认关闭;开启后只对 groups 里的群生效 */
    enabled: false,
    groups: [],
    /** 非空时先做关键词预筛,再用模型判定 */
    keywords: [],
    useLlmJudge: true,
    /** 群消息静止多久后判定,避免对半句话接话 */
    debounceMs: 3000,
    /** 同一群两次旁听接话的最小间隔,防止刷屏(不是回复冷却) */
    minIntervalMs: 60000,
    maxContextMessages: 8,
    judgeTimeoutMs: 8000,
  },
  control: {
    /** bot 自带语音开关控制页 */
    enabled: true,
    host: '127.0.0.1',
    port: 5100,
  },
  history: {
    maxItems: 24,
  },
  vision: {
    enabled: true,
    maxImageBytes: 10 * 1024 * 1024,
    fetchTimeoutMs: 15000,
    /** 独立视觉端点;留空则回退到文字 llm */
    llm: null,
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

  // 深拷贝默认值,避免多次 loadConfig 时把解析结果写回 DEFAULTS
  const merged = deepMerge(structuredClone(DEFAULTS), fileRaw)
  merged.llm = resolveLlm(merged.llm)
  merged.vision = { ...merged.vision, llm: resolveVisionLlm(merged) }

  const missing = []
  if (!merged.onebot?.wsUrl) missing.push('onebot.wsUrl')
  if (!merged.botQQ) missing.push('botQQ')
  if (missing.length) {
    throw new Error(`配置缺少必填项: ${missing.join(', ')}`)
  }

  // 文本模型与视觉模型各自校验,任一不可用都在启动时失败
  assertLlmUsable(merged.llm, 'llm')
  if (merged.vision?.enabled) {
    if (isAnthropic(merged.vision.llm)) {
      throw new Error(
        'vision.llm 必须是 OpenAI 兼容的多模态端点(如本地 Qwen)。' +
          '智谱 GLM 的 Anthropic 端点只用于文字,请单独填写 vision.llm 或关闭 vision.enabled。',
      )
    }
    assertLlmUsable(merged.vision.llm, 'vision.llm')
  }

  if (merged.privateChat?.enabled && !(merged.privateChat.allow || []).length) {
    throw new Error(
      'privateChat.enabled 为 true 但 privateChat.allow 为空。请填写允许私聊的 QQ 号。',
    )
  }

  if (merged.ambient?.enabled && !(merged.ambient.groups || []).length) {
    throw new Error(
      'ambient.enabled 为 true 但 ambient.groups 为空。请填写允许旁听接话的群号。',
    )
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

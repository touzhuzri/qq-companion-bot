/**
 * 文本模型 / 视觉模型的端点解析与校验。
 *
 * 支持两类协议:
 *   - openai:    /v1/chat/completions + Authorization: Bearer
 *   - anthropic: /v1/messages + x-api-key(智谱 GLM 也走这个)
 *
 * 运行时只认 OpenAI 协议,所以 anthropic 端点会先交给本地桥
 * (src/anthropic-bridge.js) 转换,再把桥的地址当作 llm.endpoint。
 */

const LOCAL_ENDPOINT = 'http://127.0.0.1:8080/v1/chat/completions'
const OLLAMA_ENDPOINT = 'http://127.0.0.1:11434/v1/chat/completions'
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
const ZHIPU_ANTHROPIC_ENDPOINT = 'https://open.bigmodel.cn/api/anthropic'

export const PROVIDER_PRESETS = {
  local: { protocol: 'openai', endpoint: LOCAL_ENDPOINT, apiKey: 'local' },
  ollama: { protocol: 'openai', endpoint: OLLAMA_ENDPOINT, apiKey: 'ollama' },
  openai: { protocol: 'openai', endpoint: OPENAI_ENDPOINT, apiKeyEnv: 'OPENAI_API_KEY' },
  anthropic: {
    protocol: 'anthropic',
    endpoint: 'https://api.anthropic.com',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },
  zhipu: {
    protocol: 'anthropic',
    endpoint: ZHIPU_ANTHROPIC_ENDPOINT,
    model: 'glm-4.5-flash',
    apiKeyEnvs: ['ZHIPU_API_KEY', 'ZHIPU_API_KEY_2'],
  },
  'openai-compatible': { protocol: 'openai' },
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
}

/**
 * 按 provider 补齐 endpoint / key / model,并归一化多 key。
 * 已显式填写的字段永远优先;env 只作为兜底。
 * @param {object} raw
 */
export function resolveLlm(raw = {}) {
  const input = isPlainObject(raw) ? raw : {}
  const provider = String(input.provider || 'openai-compatible')
  const preset = PROVIDER_PRESETS[provider] || {}
  const out = { ...input, provider, protocol: preset.protocol || input.protocol || 'openai' }

  if (!out.endpoint) out.endpoint = preset.endpoint || ''
  if (!out.model && preset.model) out.model = preset.model

  const keys = []
  if (Array.isArray(out.apiKeys)) keys.push(...out.apiKeys)
  if (out.apiKey) keys.push(out.apiKey)
  for (const envName of preset.apiKeyEnvs || []) keys.push(process.env[envName] || '')
  if (preset.apiKeyEnv) keys.push(process.env[preset.apiKeyEnv] || '')
  if (preset.apiKey) keys.push(preset.apiKey)
  if (!keys.length) keys.push(process.env.LLM_API_KEY || '')

  out.apiKeys = unique(keys)
  out.apiKey = out.apiKeys[0] || ''
  out.bridge = isPlainObject(out.bridge) ? out.bridge : {}
  return out
}

/**
 * 视觉端点:配置了 vision.llm 就完全独立使用它,否则回退到文本 llm。
 * 不做“字段级继承”,避免用户以为换了视觉模型、实际仍混用文本端点。
 */
export function resolveVisionLlm(config = {}) {
  const raw = config.vision?.llm
  const configured =
    isPlainObject(raw) && Boolean(raw.endpoint || raw.provider || raw.model || raw.apiKey || raw.apiKeys)
  return configured ? resolveLlm(raw) : resolveLlm(config.llm || {})
}

export function isAnthropic(llm) {
  return llm?.protocol === 'anthropic'
}

export function assertLlmUsable(llm, label) {
  if (!llm?.endpoint) throw new Error(`${label} 缺少 endpoint`)
  if (!llm?.model) throw new Error(`${label} 缺少 model`)
  if (isAnthropic(llm)) {
    if (!(llm.apiKeys || []).length) {
      throw new Error(
        `${label} 缺少 apiKey。请填写 apiKeys 数组,或设置环境变量 ZHIPU_API_KEY / ZHIPU_API_KEY_2。`,
      )
    }
    return
  }
  if (!llm?.apiKey) {
    throw new Error(
      `${label} 缺少 apiKey。请直接填写,或设置环境变量 OPENAI_API_KEY / LLM_API_KEY。`,
    )
  }
}

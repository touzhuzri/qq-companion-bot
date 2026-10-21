/**
 * 文本模型 / 视觉模型的端点解析与校验。
 * 两者都是 OpenAI 兼容协议,但可以指向不同服务:
 *   - local            本地 llama.cpp / vLLM
 *   - ollama           Ollama 的 OpenAI 兼容层
 *   - openai           OpenAI 官方
 *   - openai-compatible 任意兼容端点(默认)
 */

const LOCAL_ENDPOINT = 'http://127.0.0.1:8080/v1/chat/completions'
const OLLAMA_ENDPOINT = 'http://127.0.0.1:11434/v1/chat/completions'
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'

export const PROVIDER_PRESETS = {
  local: { endpoint: LOCAL_ENDPOINT, apiKey: 'local' },
  ollama: { endpoint: OLLAMA_ENDPOINT, apiKey: 'ollama' },
  openai: { endpoint: OPENAI_ENDPOINT, apiKeyEnv: 'OPENAI_API_KEY' },
  'openai-compatible': {},
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 按 provider 补齐 endpoint / apiKey / model 的默认值。
 * 已显式填写的字段永远优先;env 只作为兜底。
 * @param {object} raw
 * @returns {{provider:string, endpoint:string, apiKey:string, model:string}}
 */
export function resolveLlm(raw = {}) {
  const input = isPlainObject(raw) ? raw : {}
  const provider = String(input.provider || 'openai-compatible')
  const preset = PROVIDER_PRESETS[provider] || {}
  const out = { ...input, provider }

  if (!out.endpoint) out.endpoint = preset.endpoint || ''
  if (!out.apiKey) {
    if (preset.apiKey) out.apiKey = preset.apiKey
    else if (preset.apiKeyEnv) out.apiKey = process.env[preset.apiKeyEnv] || ''
  }
  if (!out.apiKey && provider === 'openai') out.apiKey = process.env.OPENAI_API_KEY || ''
  if (!out.apiKey) out.apiKey = process.env.LLM_API_KEY || ''
  if (!out.model) out.model = process.env.LLM_MODEL || ''

  return out
}

/**
 * 视觉端点:配置了 vision.llm 就完全独立使用它,否则回退到文本 llm。
 * 不做“字段级继承”,避免用户以为换了视觉模型、实际仍混用文本端点。
 */
export function resolveVisionLlm(config = {}) {
  const raw = config.vision?.llm
  const configured =
    isPlainObject(raw) && Boolean(raw.endpoint || raw.provider || raw.model || raw.apiKey)
  return configured ? resolveLlm(raw) : resolveLlm(config.llm || {})
}

export function assertLlmUsable(llm, label) {
  if (!llm?.endpoint) throw new Error(`${label} 缺少 endpoint`)
  if (!llm?.model) throw new Error(`${label} 缺少 model`)
  if (!llm?.apiKey) {
    throw new Error(
      `${label} 缺少 apiKey。请直接填写,或设置环境变量 OPENAI_API_KEY / LLM_API_KEY。`,
    )
  }
}

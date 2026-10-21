import { AnthropicBridge } from './anthropic-bridge.js'
import { isAnthropic, resolveLlm } from './llm.js'

/**
 * 运行时只接受 OpenAI 协议。若文本模型是 Anthropic 协议(智谱 GLM),
 * 先启动本地桥,返回一个指向桥的 llm 配置。
 *
 * 视觉模型不走这里:它的 provider 可以独立设为 local/openai。
 *
 * @returns {Promise<{ llm: object, bridge: AnthropicBridge|null }>}
 */
export async function prepareRuntimeLlm(config) {
  const llm = resolveLlm(config.llm || {})
  if (!isAnthropic(llm)) return { llm, bridge: null }

  const bridge = new AnthropicBridge({
    endpoint: llm.endpoint,
    apiKeys: llm.apiKeys || [],
    model: llm.model,
    anthropicVersion: llm.anthropicVersion,
    host: llm.bridge?.host,
    port: llm.bridge?.port,
    timeoutMs: llm.timeoutMs,
    thinking: llm.thinking,
    maxTokens: llm.maxTokens,
  })
  const url = await bridge.start()

  return {
    llm: {
      ...llm,
      protocol: 'openai',
      endpoint: url,
      apiKey: bridge.token,
      apiKeys: [],
    },
    bridge,
  }
}

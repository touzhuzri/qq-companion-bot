/**
 * 端到端冒烟测试(不接 QQ):
 * 直接调 sendTurn 走完 分类→约束→生成→剥离→抢救 全流程。
 * 前置:文字模型端点可达。若 provider 是 zhipu/anthropic,会先起本地桥。
 *
 *   npm run smoke            # 默认三连问,看人设与叠态
 *   npm run smoke -- "你好"   # 单句自测
 */
import { resolve } from 'node:path'
import { loadConfig } from '../src/config.js'
import { prepareRuntimeLlm } from '../src/llm-runtime.js'
import { installStorageShim, setStorageNamespace } from '../src/storage.js'
import { PERSONA } from '../src/persona.js'
import { logger } from '../src/logger.js'

const config = loadConfig(process.env.BOT_CONFIG || './config.json')
const { llm: runtimeLlm, bridge } = await prepareRuntimeLlm(config)

async function assertLlmUp() {
  try {
    const modelsUrl = runtimeLlm.endpoint.replace(/\/chat\/completions$/, '/models')
    const response = await fetch(modelsUrl, {
      headers: { Authorization: `Bearer ${runtimeLlm.apiKey}` },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    logger.info(`文字模型在线,model=${JSON.stringify(data?.data?.[0]?.id ?? '?')}`)
  } catch (err) {
    throw new Error(`文字模型不可达(${runtimeLlm.endpoint}):${err.message}`)
  }
}

async function turn(sendTurn, userMessage, history) {
  const result = await sendTurn({
    userMessage,
    history,
    pack: PERSONA,
    llm: runtimeLlm,
  })
  const spoken = result.replies.map((reply) => reply.displayText).filter(Boolean)
  console.log(`\n>>> ${userMessage}`)
  console.log(
    `    kind=${result.policy.turnKind} salvage=${result.salvage.used}${
      result.salvage.adopted ? '(adopted)' : ''
    }`,
  )
  for (const line of spoken) console.log(`<<< ${line}`)
  return [
    ...history,
    { role: 'user', content: userMessage },
    ...spoken.map((line) => ({ role: 'assistant', content: line })),
  ]
}

try {
  await assertLlmUp()
  installStorageShim(resolve('./state-smoke'))
  setStorageNamespace('smoke')
  const { sendTurn } = await import('../vendor/presence-turn-runtime/src/index.js')

  const single = process.argv[2]
  if (single) {
    await turn(sendTurn, single, [])
  } else {
    let history = []
    for (const message of ['在吗', '今天忙到现在才吃上饭，累死了', '对了，你还记得我叫什么吗']) {
      history = await turn(sendTurn, message, history)
    }
  }
  console.log('\n冒烟完成。')
} finally {
  bridge?.stop()
}

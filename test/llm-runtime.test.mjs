import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareRuntimeLlm } from '../src/llm-runtime.js'

test('anthropic text models are exposed to the runtime through a local bridge', async () => {
  const { llm, bridge } = await prepareRuntimeLlm({
    llm: {
      provider: 'anthropic',
      endpoint: 'http://127.0.0.1:1',
      apiKeys: ['real-secret-key'],
      model: 'glm-test',
      bridge: { host: '127.0.0.1', port: 0 },
    },
  })

  try {
    assert.ok(llm.endpoint.startsWith('http://127.0.0.1:'))
    assert.match(llm.endpoint, /\/v1\/chat\/completions$/)
    assert.equal(llm.protocol, 'openai')
    assert.notEqual(llm.apiKey, 'real-secret-key')
    assert.deepEqual(llm.apiKeys, [])
  } finally {
    bridge.stop()
  }
})

test('openai-compatible text models pass through without a bridge', async () => {
  const config = {
    llm: {
      provider: 'openai-compatible',
      endpoint: 'http://example.test/v1/chat/completions',
      apiKey: 'key',
      model: 'model',
    },
  }
  const { llm, bridge } = await prepareRuntimeLlm(config)
  assert.equal(bridge, null)
  assert.equal(llm.endpoint, config.llm.endpoint)
  assert.equal(llm.apiKey, 'key')
})

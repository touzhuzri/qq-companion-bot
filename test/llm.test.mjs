import test from 'node:test'
import assert from 'node:assert/strict'
import { assertLlmUsable, resolveLlm, resolveVisionLlm } from '../src/llm.js'

test('zhipu provider resolves the Anthropic endpoint and multiple keys', () => {
  const previous = [process.env.ZHIPU_API_KEY, process.env.ZHIPU_API_KEY_2]
  process.env.ZHIPU_API_KEY = 'zhipu-one'
  process.env.ZHIPU_API_KEY_2 = 'zhipu-two'
  try {
    const llm = resolveLlm({ provider: 'zhipu' })
    assert.equal(llm.protocol, 'anthropic')
    assert.equal(llm.endpoint, 'https://open.bigmodel.cn/api/anthropic')
    assert.equal(llm.model, 'glm-4.5-flash')
    assert.deepEqual(llm.apiKeys, ['zhipu-one', 'zhipu-two'])
  } finally {
    if (previous[0] === undefined) delete process.env.ZHIPU_API_KEY
    else process.env.ZHIPU_API_KEY = previous[0]
    if (previous[1] === undefined) delete process.env.ZHIPU_API_KEY_2
    else process.env.ZHIPU_API_KEY_2 = previous[1]
  }
})

test('anthropic endpoints require at least one key', () => {
  assert.throws(
    () =>
      assertLlmUsable(
        { protocol: 'anthropic', endpoint: 'https://x', model: 'm', apiKeys: [] },
        'llm',
      ),
    /apiKey/,
  )
})

test('local provider fills the local endpoint and key', () => {
  const llm = resolveLlm({ provider: 'local', model: 'qwen3' })
  assert.equal(llm.endpoint, 'http://127.0.0.1:8080/v1/chat/completions')
  assert.equal(llm.apiKey, 'local')
  assert.equal(llm.model, 'qwen3')
})

test('openai provider reads OPENAI_API_KEY', () => {
  const previous = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-key'
  try {
    const llm = resolveLlm({ provider: 'openai', model: 'gpt-test' })
    assert.equal(llm.endpoint, 'https://api.openai.com/v1/chat/completions')
    assert.equal(llm.apiKey, 'test-key')
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previous
  }
})

test('openai-compatible keeps explicit endpoint and key', () => {
  const llm = resolveLlm({
    provider: 'openai-compatible',
    endpoint: 'http://example.test/v1/chat/completions',
    apiKey: 'custom',
    model: 'custom-model',
  })
  assert.deepEqual(
    { endpoint: llm.endpoint, apiKey: llm.apiKey, model: llm.model },
    {
      endpoint: 'http://example.test/v1/chat/completions',
      apiKey: 'custom',
      model: 'custom-model',
    },
  )
})

test('vision llm is independent when configured, otherwise falls back to text llm', () => {
  const text = { provider: 'local', model: 'text-model' }
  const fallback = resolveVisionLlm({ vision: { llm: null }, llm: text })
  assert.equal(fallback.model, 'text-model')

  const independent = resolveVisionLlm({
    vision: {
      llm: {
        provider: 'openai-compatible',
        endpoint: 'http://vision.test/v1/chat/completions',
        apiKey: 'vision-key',
        model: 'vision-model',
      },
    },
    llm: text,
  })
  assert.equal(independent.endpoint, 'http://vision.test/v1/chat/completions')
  assert.equal(independent.model, 'vision-model')
})

test('assertLlmUsable rejects incomplete endpoints', () => {
  assert.throws(() => assertLlmUsable({}, 'llm'), /endpoint/)
  assert.throws(() => assertLlmUsable({ endpoint: 'http://x', apiKey: 'k' }, 'llm'), /model/)
  assert.throws(
    () => assertLlmUsable({ endpoint: 'http://x', model: 'm' }, 'llm'),
    /apiKey/,
  )
  assert.doesNotThrow(() =>
    assertLlmUsable({ endpoint: 'http://x', model: 'm', apiKey: 'k' }, 'llm'),
  )
})

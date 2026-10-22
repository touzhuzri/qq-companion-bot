import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config.js'

function withConfig(raw, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'))
  const path = join(dir, 'config.json')
  writeFileSync(path, JSON.stringify(raw))
  try {
    fn(path)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const base = {
  botQQ: 10000,
  onebot: { wsUrl: 'ws://127.0.0.1:3001' },
  llm: { provider: 'local', model: 'text-model' },
}

test('resolves local text and vision endpoints from provider presets', () => {
  withConfig(base, (path) => {
    const config = loadConfig(path)
    assert.equal(config.llm.endpoint, 'http://127.0.0.1:8080/v1/chat/completions')
    assert.equal(config.vision.llm.endpoint, config.llm.endpoint)
    assert.equal(config.reply.delayMinMs, 0)
    assert.equal(config.reply.delayMaxMs, 4000)
    assert.equal(config.trigger.cooldownMs, undefined)
  })
})

test('provider presets are not overridden by local defaults', () => {
  const previous = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-key'
  try {
    withConfig(
      { ...base, llm: { provider: 'openai', model: 'gpt-test' } },
      (path) => {
        const config = loadConfig(path)
        assert.equal(config.llm.endpoint, 'https://api.openai.com/v1/chat/completions')
        assert.equal(config.llm.apiKey, 'test-key')
      },
    )
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previous
  }
})

test('zhipu text can use an independent local vision model', () => {
  withConfig(
    {
      ...base,
      llm: { provider: 'zhipu', apiKeys: ['key-one', 'key-two'] },
      vision: {
        enabled: true,
        llm: { provider: 'local', model: 'qwen3-vl-4b' },
      },
    },
    (path) => {
      const config = loadConfig(path)
      assert.equal(config.llm.protocol, 'anthropic')
      assert.equal(config.llm.endpoint, 'https://open.bigmodel.cn/api/anthropic')
      assert.deepEqual(config.llm.apiKeys, ['key-one', 'key-two'])
      assert.equal(config.vision.llm.protocol, 'openai')
      assert.equal(config.vision.llm.endpoint, 'http://127.0.0.1:8080/v1/chat/completions')
    },
  )
})

test('rejects falling back to an Anthropic endpoint for vision', () => {
  withConfig(
    {
      ...base,
      llm: { provider: 'zhipu', apiKeys: ['key-one'] },
      vision: { enabled: true },
    },
    (path) => {
      assert.throws(() => loadConfig(path), /vision\.llm/)
    },
  )
})

test('keeps vision llm independent from the text llm', () => {
  withConfig(
    {
      ...base,
      vision: {
        enabled: true,
        llm: {
          provider: 'openai-compatible',
          endpoint: 'http://vision.test/v1/chat/completions',
          apiKey: 'vision-key',
          model: 'vision-model',
        },
      },
    },
    (path) => {
      const config = loadConfig(path)
      assert.equal(config.vision.llm.model, 'vision-model')
      assert.notEqual(config.vision.llm.endpoint, config.llm.endpoint)
    },
  )
})

test('private chat requires an explicit allow list when enabled', () => {
  withConfig({ ...base, privateChat: { enabled: true, allow: [] } }, (path) => {
    assert.throws(() => loadConfig(path), /privateChat\.allow/)
  })
})

test('private chat accepts allow-listed users', () => {
  withConfig(
    { ...base, privateChat: { enabled: true, allow: ['12345'] } },
    (path) => {
      const config = loadConfig(path)
      assert.equal(config.privateChat.enabled, true)
      assert.deepEqual(config.privateChat.allow, ['12345'])
    },
  )
})

test('rejects ambient mode without an explicit group list', () => {
  withConfig({ ...base, ambient: { enabled: true, groups: [] } }, (path) => {
    assert.throws(() => loadConfig(path), /ambient\.groups/)
  })
})

test('rejects voice mode without a reference audio', () => {
  withConfig({ ...base, voice: { enabled: true } }, (path) => {
    assert.throws(() => loadConfig(path), /refAudioPath/)
  })
})

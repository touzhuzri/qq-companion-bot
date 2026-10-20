import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flushNow, installStorageShim, setStorageNamespace } from '../src/storage.js'
import { PERSONA } from '../src/persona.js'
import { sendTurn } from '../vendor/presence-turn-runtime/src/index.js'

test('sendTurn composes a prompt from the template persona (mocked LLM)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'turn-'))
  installStorageShim(dir)
  setStorageNamespace('12345')

  const originalFetch = globalThis.fetch
  let requestBody = null
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body)
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '在呢，什么事？' } }] }),
      { status: 200 },
    )
  }

  try {
    const result = await sendTurn({
      userMessage: '在吗',
      history: [],
      pack: PERSONA,
      llm: { endpoint: 'http://mock/v1/chat/completions', apiKey: 'test', model: 'test' },
    })

    const system = requestBody.messages[0]
    assert.equal(system.role, 'system')
    assert.match(system.content, new RegExp(PERSONA.name))
    assert.ok(result.replies.length > 0)
    assert.ok(result.policy.turnKind)
  } finally {
    globalThis.fetch = originalFetch
    flushNow()
    rmSync(dir, { recursive: true, force: true })
  }
})

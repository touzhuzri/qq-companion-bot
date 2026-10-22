import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FollowUpTracker,
  FOLLOW_UP_DEFAULTS,
  judgeFollowUp,
} from '../src/followup.js'

function tracker(overrides = {}) {
  return new FollowUpTracker({
    enabled: true,
    windowMs: 1000,
    maxTurns: 2,
    muteAfterNoMs: 500,
    ...overrides,
  })
}

test('follow-up window expires and consumes turns', () => {
  const store = tracker()
  store.arm('g:u', 0)
  assert.equal(store.isActive('g:u', 0), true)

  store.noteReply('g:u', 100)
  assert.equal(store.isActive('g:u', 100), true)

  store.noteReply('g:u', 200)
  assert.equal(store.isActive('g:u', 200), false)
})

test('disabled tracker never arms', () => {
  const store = tracker({ enabled: false })
  store.arm('g:u', 0)
  assert.equal(store.isActive('g:u', 0), false)
})

test('a NO mutes the user for the configured duration', () => {
  const store = tracker()
  store.arm('g:u', 0)
  store.mute('g:u', 0)
  assert.equal(store.isActive('g:u', 0), false)
  assert.equal(store.isMuted('g:u', 0), true)
  assert.equal(store.isMuted('g:u', 501), false)
})

test('exits only after consecutive low-relevance judgments', () => {
  const store = tracker({ maxMisses: 2, muteAfterNoMs: 500 })
  store.arm('g:u', 0)

  assert.equal(store.noteMiss('g:u', 0), false)
  assert.equal(store.isActive('g:u', 0), true)
  assert.equal(store.missCount('g:u'), 1)

  assert.equal(store.noteMiss('g:u', 1), true)
  assert.equal(store.isActive('g:u', 1), false)
  assert.equal(store.isMuted('g:u', 1), true)
})

test('a successful follow-up resets the miss counter', () => {
  const store = tracker({ maxMisses: 2 })
  store.arm('g:u', 0)
  store.noteMiss('g:u', 0)
  store.noteReply('g:u', 1)
  assert.equal(store.missCount('g:u'), 0)
})

test('defaults are off, with a five-minute active window', () => {
  assert.equal(FOLLOW_UP_DEFAULTS.enabled, false)
  assert.equal(FOLLOW_UP_DEFAULTS.windowMs, 300000)
  assert.equal(FOLLOW_UP_DEFAULTS.maxTurns, 7)
  assert.equal(FOLLOW_UP_DEFAULTS.minReplyGapMs, 10000)
  assert.equal(FOLLOW_UP_DEFAULTS.maxMisses, 2)
})

test('follow-up replies are spaced out inside the window', () => {
  const store = tracker({ windowMs: 20000, maxTurns: 2, minReplyGapMs: 8000 })
  store.arm('g:u', 0)
  assert.equal(store.canReply('g:u', 0), true)
  store.noteReply('g:u', 100)
  assert.equal(store.canReply('g:u', 200), false)
  assert.equal(store.canReply('g:u', 8100), true)
})

test('judgeFollowUp accepts YES and rejects NO or errors', async () => {
  const originalFetch = globalThis.fetch
  const llm = { endpoint: 'http://mock', apiKey: 'k', model: 'm' }
  const input = {
    recent: [{ nickname: '小明', text: '刚才你说的小说，后来呢？' }],
    lastBotReply: '还差几章，别催。',
    persona: { name: '茜特菈莉' },
    llm,
  }

  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'YES' } }] }), {
        status: 200,
      })
    assert.equal(await judgeFollowUp(input), true)

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'NO' } }] }), {
        status: 200,
      })
    assert.equal(await judgeFollowUp(input), false)

    globalThis.fetch = async () => {
      throw new Error('network down')
    }
    assert.equal(await judgeFollowUp(input), null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

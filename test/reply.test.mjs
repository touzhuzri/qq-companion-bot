import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSegments, deliverReply } from '../src/reply.js'

function makeClient() {
  const calls = []
  return {
    calls,
    async sendGroupText(groupId, text) {
      calls.push({ kind: 'text', groupId, text })
    },
    async sendGroupMessage(groupId, segments) {
      calls.push({ kind: 'message', groupId, segments })
    },
  }
}

function makeStore() {
  const items = []
  return {
    items,
    append(groupId, role, content) {
      items.push({ groupId, role, content })
    },
  }
}

const replyConfig = {
  reply: {
    delayMinMs: 0,
    delayMaxMs: 0,
    segmentGapMinMs: 0,
    segmentGapMaxMs: 0,
    segmentMinChars: 8,
    segmentTargetChars: 16,
    segmentMaxChars: 24,
    segmentMaxMessages: 4,
  },
}

test('buildSegments splits long lines', () => {
  const segments = buildSegments(
    ['今天下班路上看到一家新开的店，排队的人特别多，我就没进去。'],
    replyConfig.reply,
  )
  assert.ok(segments.length > 1)
  for (const segment of segments) assert.ok(segment.length <= 24)
})

test('text mode waits once and sends every segment', async () => {
  const client = makeClient()
  const store = makeStore()
  const result = await deliverReply({
    lines: ['今天下班路上看到一家新开的店，排队的人特别多，我就没进去。'],
    groupId: 'g1',
    config: replyConfig,
    client,
    tts: {},
    voiceEnabled: false,
    contextStore: store,
  })

  assert.equal(result.mode, 'text')
  assert.ok(client.calls.length > 1)
  assert.ok(client.calls.every((call) => call.kind === 'text'))
  assert.equal(
    client.calls.map((call) => call.text).join(''),
    '今天下班路上看到一家新开的店，排队的人特别多，我就没进去。',
  )
  assert.equal(store.items.length, client.calls.length)
})

test('voice mode sends only a record and does not wait', async () => {
  const client = makeClient()
  const store = makeStore()
  let cleaned = false
  const startedAt = Date.now()
  const result = await deliverReply({
    lines: ['在呢，什么事？'],
    groupId: 'g1',
    config: {
      reply: { ...replyConfig.reply, delayMinMs: 10000, delayMaxMs: 10000 },
    },
    client,
    tts: {
      async synthesize() {
        return '/tmp/voice.wav'
      },
      cleanupLater() {
        cleaned = true
      },
    },
    voiceEnabled: true,
    contextStore: store,
  })

  assert.equal(result.mode, 'voice')
  assert.equal(client.calls.length, 1)
  assert.equal(client.calls[0].kind, 'message')
  assert.equal(client.calls[0].segments[0].type, 'record')
  assert.ok(Date.now() - startedAt < 2000, 'voice mode must not wait for text delay')
  assert.equal(cleaned, true)
  assert.deepEqual(store.items, [
    { groupId: 'g1', role: 'assistant', content: '在呢，什么事？' },
  ])
})

test('voice failure falls back to text', async () => {
  const client = makeClient()
  const store = makeStore()
  const result = await deliverReply({
    lines: ['在呢，什么事？'],
    groupId: 'g1',
    config: replyConfig,
    client,
    tts: {
      async synthesize() {
        throw new Error('tts down')
      },
    },
    voiceEnabled: true,
    contextStore: store,
  })

  assert.equal(result.mode, 'text')
  assert.ok(client.calls.length >= 1)
  assert.ok(client.calls.every((call) => call.kind === 'text'))
})

test('returns none when there is nothing to say', async () => {
  const client = makeClient()
  const result = await deliverReply({
    lines: [],
    groupId: 'g1',
    config: replyConfig,
    client,
    tts: {},
    voiceEnabled: false,
    contextStore: makeStore(),
  })
  assert.deepEqual(result, { mode: 'none', segments: [] })
  assert.equal(client.calls.length, 0)
})

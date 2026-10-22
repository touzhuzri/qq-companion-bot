import test from 'node:test'
import assert from 'node:assert/strict'
import { expandIfNeeded, expansionPolicy, isWarm } from '../src/expand.js'
import { cleanSpeech } from '../src/speech.js'

const persona = {
  systemPrompt: '你是茜特菈莉。',
  voiceHint: '冷淡但关心。',
  format: {
    minSentences: 2,
    maxSentences: 3,
    minSentenceChars: 15,
    maxSentenceChars: 45,
    minTotal: 35,
    maxTotal: 180,
  },
}

const llm = { endpoint: 'http://mock/v1/chat/completions', apiKey: 'k', model: 'm' }

test('warmth follows attachment and trust versus hurt and guard', () => {
  assert.equal(
    isWarm({ attachment: 0.6, trust: 0.5, hurt: 0.05, guard: 0.1 }),
    true,
  )
  assert.equal(
    isWarm({ attachment: 0.2, trust: 0.2, hurt: 0.1, guard: 0.3 }),
    false,
  )
})

test('warm policy asks for two or three sentences, cool policy keeps it short', () => {
  const warm = expansionPolicy(
    { attachment: 0.6, trust: 0.5, hurt: 0, guard: 0.1 },
    persona,
  )
  assert.equal(warm.warm, true)
  assert.equal(warm.minChars, 35)
  assert.equal(warm.maxChars, 180)
  assert.equal(warm.minSentences, 2)

  const cool = expansionPolicy({ attachment: 0.1, trust: 0.1 }, persona)
  assert.equal(cool.warm, false)
  assert.equal(cool.minChars, 18)
  assert.equal(cool.minSentences, 1)
})

test('expands a short warm reply once', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                '累就歇着，少想那些烦心事。两百年来，我见过太多疲惫，但天亮了，还得继续走。',
            },
          },
        ],
      }),
      { status: 200 },
    )

  try {
    const result = await expandIfNeeded({
      lines: ['累就歇着。'],
      userMessage: '今天有点累',
      affect: { attachment: 0.6, trust: 0.5, hurt: 0, guard: 0.1 },
      persona,
      llm,
    })
    assert.equal(result.expanded, true)
    assert.equal(result.warm, true)
    assert.ok(result.after > result.before)
    assert.match(result.lines[0], /两百年来/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('does not call the model when the reply is long enough', async () => {
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = async () => {
    called = true
    throw new Error('should not be called')
  }
  try {
    const result = await expandIfNeeded({
      lines: ['这句话已经足够长了，不需要再扩写，也不会触发第二次模型调用。'],
      userMessage: '在吗',
      // 冷淡回合的门槛是 18 字,这句已经超过
      affect: { attachment: 0.1, trust: 0.1, hurt: 0.1, guard: 0.3 },
      persona,
      llm,
    })
    assert.equal(result.expanded, false)
    assert.equal(called, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('keeps the draft when expansion fails or comes back empty', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => {
      throw new Error('network down')
    }
    const failed = await expandIfNeeded({
      lines: ['累就歇着。'],
      userMessage: '今天有点累',
      affect: { attachment: 0.6, trust: 0.5, hurt: 0, guard: 0.1 },
      persona,
      llm,
    })
    assert.equal(failed.expanded, false)
    assert.deepEqual(failed.lines, ['累就歇着。'])

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), {
        status: 200,
      })
    const empty = await expandIfNeeded({
      lines: ['累就歇着。'],
      userMessage: '今天有点累',
      affect: { attachment: 0.6, trust: 0.5, hurt: 0, guard: 0.1 },
      persona,
      llm,
    })
    assert.equal(empty.expanded, false)
    assert.deepEqual(empty.lines, ['累就歇着。'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('cleanSpeech removes action parentheses', () => {
  assert.equal(cleanSpeech('（顿了顿）累就歇着。'), '累就歇着。')
  assert.equal(cleanSpeech('累就歇着（笑）。'), '累就歇着。')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTranscript, judgeJoin, keywordHit } from '../src/ambient.js'

test('keywordHit is case-insensitive and ignores empty keywords', () => {
  assert.equal(keywordHit('你们在聊 Python 吗', ['python']), true)
  assert.equal(keywordHit('你们在聊 Python 吗', ['', '  ']), false)
  assert.equal(keywordHit('别的话题', ['python']), false)
})

test('buildTranscript includes the speaker name', () => {
  const transcript = buildTranscript(
    [
      { nickname: '小明', text: '在吗' },
      { userId: '42', text: '' },
    ],
    8,
  )
  assert.match(transcript, /小明: 在吗/)
  assert.match(transcript, /42: \[图片\]/)
})

test('judgeJoin accepts a YES verdict', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'YES' } }] }), {
      status: 200,
    })
  try {
    const accepted = await judgeJoin({
      recent: [{ nickname: '小明', text: '你觉得这个怎么样？' }],
      persona: { name: '角色', voiceHint: '口语' },
      llm: { endpoint: 'http://mock', apiKey: 'k', model: 'm' },
    })
    assert.equal(accepted, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('judgeJoin returns false on NO or request failure', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'NO' } }] }), {
        status: 200,
      })
    assert.equal(
      await judgeJoin({
        recent: [{ text: '他们两个在吵架' }],
        persona: { name: '角色' },
        llm: { endpoint: 'http://mock', apiKey: 'k', model: 'm' },
      }),
      false,
    )

    globalThis.fetch = async () => {
      throw new Error('network down')
    }
    assert.equal(
      await judgeJoin({
        recent: [{ text: '在吗' }],
        persona: { name: '角色' },
        llm: { endpoint: 'http://mock', apiKey: 'k', model: 'm' },
      }),
      false,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

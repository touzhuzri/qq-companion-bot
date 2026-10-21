import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import {
  AnthropicBridge,
  messagesUrl,
  toAnthropicRequest,
} from '../src/anthropic-bridge.js'

function postJson(url, body, token) {
  return new Promise((resolveRequest, rejectRequest) => {
    const target = new URL(url)
    const req = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          resolveRequest({ status: res.statusCode, body: JSON.parse(data) })
        })
      },
    )
    req.on('error', rejectRequest)
    req.end(JSON.stringify(body))
  })
}

test('messagesUrl appends /v1/messages only once', () => {
  assert.equal(
    messagesUrl('https://open.bigmodel.cn/api/anthropic'),
    'https://open.bigmodel.cn/api/anthropic/v1/messages',
  )
  assert.equal(
    messagesUrl('https://open.bigmodel.cn/api/anthropic/v1/messages'),
    'https://open.bigmodel.cn/api/anthropic/v1/messages',
  )
})

test('translates OpenAI messages into Anthropic Messages', () => {
  const requestBody = toAnthropicRequest(
    {
      model: 'glm-4.5-flash',
      messages: [
        { role: 'system', content: '你是角色' },
        { role: 'user', content: '在吗' },
        { role: 'assistant', content: '在呢' },
      ],
      max_tokens: 200,
      temperature: 0.7,
    },
    'fallback',
  )

  assert.equal(requestBody.model, 'glm-4.5-flash')
  assert.equal(requestBody.system, '你是角色')
  assert.equal(requestBody.max_tokens, 200)
  assert.equal(requestBody.temperature, 0.7)
  assert.deepEqual(requestBody.messages, [
    { role: 'user', content: [{ type: 'text', text: '在吗' }] },
    { role: 'assistant', content: [{ type: 'text', text: '在呢' }] },
  ])
})

test('bridge rotates keys on 429 and converts the response back', async () => {
  const originalFetch = globalThis.fetch
  const upstreamCalls = []
  globalThis.fetch = async (url, options) => {
    upstreamCalls.push({
      url,
      key: options.headers['x-api-key'],
      body: JSON.parse(options.body),
    })
    if (upstreamCalls.length === 1) {
      return new Response('rate limited', { status: 429 })
    }
    return new Response(
      JSON.stringify({
        id: 'msg_test',
        model: 'glm-4.5-flash',
        content: [{ type: 'text', text: '你好呀' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  const bridge = new AnthropicBridge({
    endpoint: 'https://open.bigmodel.cn/api/anthropic',
    apiKeys: ['key-one', 'key-two'],
    model: 'glm-4.5-flash',
    port: 0,
  })

  try {
    const url = await bridge.start()
    const response = await postJson(
      url,
      {
        model: 'glm-4.5-flash',
        messages: [
          { role: 'system', content: '系统提示' },
          { role: 'user', content: '在吗' },
        ],
        max_tokens: 64,
      },
      bridge.token,
    )

    assert.equal(response.status, 200)
    assert.equal(response.body.choices[0].message.content, '你好呀')
    assert.equal(response.body.choices[0].finish_reason, 'stop')
    assert.equal(response.body.usage.total_tokens, 15)
    assert.equal(upstreamCalls.length, 2)
    assert.deepEqual(
      upstreamCalls.map((call) => call.key),
      ['key-one', 'key-two'],
    )
    assert.equal(upstreamCalls[0].url, 'https://open.bigmodel.cn/api/anthropic/v1/messages')
    assert.equal(upstreamCalls[0].body.system, '系统提示')
  } finally {
    bridge.stop()
    globalThis.fetch = originalFetch
  }
})

test('bridge rejects requests without its local token', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), { status: 200 })
  const bridge = new AnthropicBridge({
    endpoint: 'http://mock',
    apiKeys: ['k'],
    model: 'm',
    port: 0,
  })
  try {
    const url = await bridge.start()
    const response = await postJson(
      url,
      { messages: [{ role: 'user', content: 'hi' }] },
      'wrong-token',
    )
    assert.equal(response.status, 401)
  } finally {
    bridge.stop()
  }
})

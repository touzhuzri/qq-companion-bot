import test from 'node:test'
import assert from 'node:assert/strict'
import { parseGroupMessage, parseMessage } from '../src/messageParser.js'

const at = (qq) => ({ type: 'at', data: { qq } })
const text = (t) => ({ type: 'text', data: { text: t } })
const image = (url) => ({ type: 'image', data: { url, file: 'img.png' } })

test('recognizes @bot trigger and extracts text and images', () => {
  const event = {
    message_type: 'group',
    group_id: 123,
    user_id: 456,
    sender: { nickname: '小明' },
    message: [at('10000'), text(' 在吗 '), image('https://example.com/a.png')],
  }
  const parsed = parseGroupMessage(event, 10000)
  assert.equal(parsed.triggered, true)
  assert.equal(parsed.text, '在吗')
  assert.equal(parsed.images.length, 1)
  assert.equal(parsed.nickname, '小明')
  assert.equal(parsed.groupId, '123')
})

test('ignores @全体成员', () => {
  const event = {
    message: [at('all'), text('大家看一下')],
  }
  const parsed = parseGroupMessage(event, 10000)
  assert.equal(parsed.triggered, false)
})

test('plain text without @ does not trigger', () => {
  const parsed = parseGroupMessage({ message: [text('有人吗')] }, 10000)
  assert.equal(parsed.triggered, false)
})

test('@bot with only an image still triggers with no text', () => {
  const parsed = parseGroupMessage(
    { message: [at('10000'), image('https://example.com/sticker.gif')] },
    10000,
  )
  assert.equal(parsed.triggered, true)
  assert.equal(parsed.text, '')
  assert.equal(parsed.images.length, 1)
})

test('private messages trigger without an @ mention', () => {
  const parsed = parseMessage(
    {
      message_type: 'private',
      user_id: 456,
      sender: { nickname: '小明' },
      message: [text('在吗'), image('https://example.com/a.png')],
    },
    10000,
  )
  assert.equal(parsed.isPrivate, true)
  assert.equal(parsed.messageType, 'private')
  assert.equal(parsed.triggered, true)
  assert.equal(parsed.targetId, '456')
  assert.equal(parsed.groupId, '')
  assert.equal(parsed.text, '在吗')
  assert.equal(parsed.images.length, 1)
})

test('group messages carry an explicit target and are not private', () => {
  const parsed = parseMessage(
    {
      message_type: 'group',
      group_id: 123,
      user_id: 456,
      message: [at('10000'), text('在吗')],
    },
    10000,
  )
  assert.equal(parsed.isPrivate, false)
  assert.equal(parsed.targetId, '123')
  assert.equal(parsed.groupId, '123')
})

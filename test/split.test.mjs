import test from 'node:test'
import assert from 'node:assert/strict'
import { splitForChat, splitSentences } from '../src/split.js'

test('keeps short replies as one message', () => {
  assert.deepEqual(splitForChat('在呢，刚才没看手机。'), ['在呢，刚才没看手机。'])
  assert.deepEqual(splitForChat('   '), [])
})

test('splits long multi-sentence text and obeys the hard limit', () => {
  const text =
    '今天下班路上看到一家新开的店，排队的人特别多，我就没进去。' +
    '下次我们早点去试试吧！要是你也有空，我们可以约周末。'
  const parts = splitForChat(text, {
    minChars: 12,
    targetChars: 24,
    maxChars: 45,
    maxMessages: 6,
  })

  assert.ok(parts.length > 1)
  for (const part of parts) assert.ok(part.length <= 45, part)
  assert.equal(parts.join(''), text)
})

test('does not split inside quotes', () => {
  const text =
    '她慢慢地说：“今天真的不去吗？我等你很久了。”然后转身走了。' +
    '外面风很大，路边的灯一盏一盏亮起来。'
  const parts = splitForChat(text, {
    minChars: 12,
    targetChars: 24,
    maxChars: 40,
    maxMessages: 6,
  })

  assert.ok(parts.some((part) => part.includes('今天真的不去吗？我等你很久了。')))
})

test('hard-splits text without punctuation without exceeding the limit', () => {
  const text = '这是一段没有任何标点符号的很长的文字用来测试硬切分是否会把内容切成不超过限制的消息'
  const parts = splitForChat(text, { maxChars: 20, minChars: 8, targetChars: 16 })
  assert.ok(parts.length > 1)
  for (const part of parts) assert.ok(part.length <= 20, part)
  assert.equal(parts.join(''), text)
})

test('does not treat English abbreviations as sentence ends', () => {
  const sentences = splitSentences('Mr. Smith is here. He left after lunch.')
  assert.equal(sentences.length, 2)
  assert.ok(sentences[0].includes('Mr. Smith'))
})

test('enforces the maximum number of messages', () => {
  const text = '一二三四五六七八九十。'.repeat(12)
  const parts = splitForChat(text, {
    minChars: 8,
    targetChars: 16,
    maxChars: 24,
    maxMessages: 3,
  })
  assert.ok(parts.length <= 3, `got ${parts.length}`)
  assert.equal(parts.join(''), text)
})

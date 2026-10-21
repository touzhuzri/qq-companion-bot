/**
 * 聊天回复按长度切分,模拟真人一条条发。
 *
 * 断句与打包思路移植自 qikou (Cadence) —— MIT License,
 * Copyright (c) 2026 Grabrun, https://github.com/Grabrun/qikou
 * 这里按 QQ 纯台词场景精简:保留标点/引号/括号/英文缩写/波浪号保护,
 * 去掉 Markdown、代码块、表格、颜文字语料等本项目用不到的部分。
 */

const STRONG_ENDS = new Set(['。', '！', '？', '!', '?', '…'])
const TILDES = new Set(['~', '～', '〜', '˜', '˷', '∼', '∽', '⁓'])
const OPEN_BRACKETS = '([{（【「『'
const CLOSE_BRACKETS = ')]}）】」』'
const CLOSE_CHARS = ')]}）】」』"\'`”’'
const LEADING_MOVE = '，。！？；：、）】」』”’'
const SOFT_SEPS = ['\n\n', '\n', '。', '！', '？', '；', ';', '：', ':', '，', ',', '、', ' ']

const EN_ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'ave', 'blvd', 'jr', 'sr', 'vs',
  'etc', 'eg', 'ie', 'am', 'pm', 'us', 'uk', 'no', 'vol', 'pp', 'fig',
  'al', 'inc', 'ltd', 'dept', 'univ', 'approx', 'est',
  'e.g', 'i.e', 'u.s', 'u.k', 'a.m', 'p.m', 'u.n', 'e.u', 'ph.d',
])

function isCjk(char) {
  if (!char) return false
  const code = char.codePointAt(0)
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff)
  )
}

function hasAny(text, pos, chars) {
  return [...chars].some((char) => text.indexOf(char, pos) >= 0)
}

/** 切点是否落在未闭合的括号/引号里(且后面还有机会闭合) */
function inUnclosedBracket(text, pos) {
  const before = text.slice(0, pos)
  let depth = 0
  for (const char of before) {
    if (OPEN_BRACKETS.includes(char)) depth++
    else if (CLOSE_BRACKETS.includes(char) && depth > 0) depth--
  }
  if (depth > 0 && hasAny(text, pos, CLOSE_BRACKETS)) return true

  for (const [open, close] of [
    ['“', '”'],
    ['「', '」'],
    ['『', '』'],
  ]) {
    const opens = before.split(open).length - 1
    const closes = before.split(close).length - 1
    if (opens > closes && text.indexOf(close, pos) >= 0) return true
  }
  return false
}

function previousWord(text, dotPos) {
  let index = dotPos - 1
  while (index >= 0 && /[A-Za-z0-9.']/.test(text[index])) index--
  return text.slice(index + 1, dotPos).toLowerCase()
}

function dotEndsSentence(text, dotPos) {
  const next = text[dotPos + 1]
  if (EN_ABBREV.has(previousWord(text, dotPos))) return false
  if (/^[A-Z]\.$/.test(text.slice(Math.max(0, dotPos - 1), dotPos + 1))) {
    if (!next || /\s/.test(next)) return false
  }
  return !next || /\s/.test(next) || isCjk(next)
}

function tildeEndsSentence(text, pos) {
  const prev = text[pos - 1] || ''
  const next = text[pos + 1] || ''
  if (!prev || /\s/.test(prev)) return false
  if (TILDES.has(prev) || TILDES.has(next)) return false
  if ('=<>!'.includes(next)) return false
  if (prev && next && /[A-Za-z0-9]/.test(prev) && /[A-Za-z0-9]/.test(next)) return false
  if (/[0-9]/.test(next) && prev && !isCjk(prev)) return false
  return true
}

function mergeLeadingPunct(parts) {
  if (parts.length < 2) return parts
  const fixed = [parts[0]]
  for (const part of parts.slice(1)) {
    if (part && LEADING_MOVE.includes(part[0])) {
      fixed[fixed.length - 1] += part[0]
      const rest = part.slice(1).trim()
      if (rest) fixed.push(rest)
    } else {
      fixed.push(part)
    }
  }
  return fixed
}

/** 按句末标点断句,引号/括号内的标点不切 */
export function splitSentences(text) {
  const result = []
  let buffer = ''
  const value = String(text || '')

  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    buffer += char

    let isEnd = STRONG_ENDS.has(char)
    if (char === '.') isEnd = dotEndsSentence(value, i)
    if (TILDES.has(char)) isEnd = tildeEndsSentence(value, i)
    if (!isEnd || inUnclosedBracket(value, i + 1)) continue

    while (i + 1 < value.length && CLOSE_CHARS.includes(value[i + 1])) {
      buffer += value[++i]
    }
    const sentence = buffer.trim()
    if (sentence) result.push(sentence)
    buffer = ''
  }

  if (buffer.trim()) result.push(buffer.trim())
  return mergeLeadingPunct(result)
}

function hardSplit(text, maxChars) {
  const chunks = []
  let rest = text

  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars)
    let cut = -1
    for (const sep of SOFT_SEPS) {
      const at = window.lastIndexOf(sep)
      if (at >= maxChars * 0.4) {
        cut = at + sep.length
        break
      }
    }
    if (cut <= 0) {
      const space = window.lastIndexOf(' ')
      cut = space >= maxChars * 0.4 ? space + 1 : maxChars
    }
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks.filter(Boolean)
}

function joinText(left, right) {
  if (!left) return right
  if (!right) return left
  if (/[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right)) return `${left} ${right}`
  return left + right
}

function packSentences(sentences, { minChars, targetChars, maxChars }) {
  const units = sentences.flatMap((sentence) =>
    sentence.length <= maxChars ? [sentence] : hardSplit(sentence, maxChars),
  )

  const messages = []
  let buffer = ''
  for (const unit of units) {
    if (!buffer) {
      buffer = unit
      continue
    }

    const combined = buffer.length + unit.length
    const shortFragment = unit.length < minChars
    if (combined <= maxChars && (buffer.length < targetChars || shortFragment)) {
      buffer = joinText(buffer, unit)
    } else {
      messages.push(buffer)
      buffer = unit
    }
  }
  if (buffer) messages.push(buffer)

  // 尾巴太短时并回上一条,但不能把上一条撑过硬上限
  while (messages.length > 1 && messages[messages.length - 1].length < minChars) {
    const tail = messages[messages.length - 1]
    const previous = messages[messages.length - 2]
    if (previous.length + tail.length > maxChars) break
    messages.splice(messages.length - 2, 2, joinText(previous, tail))
  }

  return messages
}

/** 超过条数上限时,反复合并最短的相邻两条 */
function enforceMaxMessages(messages, maxMessages, maxChars) {
  if (!maxMessages || messages.length <= maxMessages) return messages

  const mergeLimit = Math.ceil(maxChars * 1.5)
  const result = [...messages]
  while (result.length > maxMessages) {
    let bestIndex = -1
    let bestLength = Infinity
    let fallbackIndex = -1
    let fallbackLength = Infinity

    for (let i = 0; i < result.length - 1; i++) {
      const total = result[i].length + result[i + 1].length
      if (total < fallbackLength) {
        fallbackLength = total
        fallbackIndex = i
      }
      if (total > mergeLimit) continue
      if (total < bestLength) {
        bestLength = total
        bestIndex = i
      }
    }

    // 所有相邻对都超过软上限时,仍然合并最短的一对,保证条数上限生效
    if (bestIndex < 0) bestIndex = fallbackIndex
    if (bestIndex < 0) break

    result[bestIndex] = joinText(result[bestIndex], result[bestIndex + 1])
    result.splice(bestIndex + 1, 1)
  }
  return result
}

/**
 * @param {string} text
 * @param {{
 *   minChars?: number, targetChars?: number, maxChars?: number, maxMessages?: number
 * }} options
 * @returns {string[]}
 */
export function splitForChat(
  text,
  { minChars = 12, targetChars = 24, maxChars = 45, maxMessages = 6 } = {},
) {
  const value = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!value) return []

  const max = Math.max(8, Number(maxChars) || 45)
  const target = Math.min(max, Math.max(1, Number(targetChars) || 24))
  const min = Math.min(target, Math.max(1, Number(minChars) || 12))
  const limit = Math.max(1, Number(maxMessages) || 6)

  if (value.length <= max) return [value]

  const sentences = splitSentences(value)
  const packed = packSentences(sentences, { minChars: min, targetChars: target, maxChars: max })
  return enforceMaxMessages(packed, limit, max)
}

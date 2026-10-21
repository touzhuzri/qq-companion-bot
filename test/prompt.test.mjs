import test from 'node:test'
import assert from 'node:assert/strict'
import { getReplyFormatInstructions } from '../vendor/presence-turn-runtime/src/runtime/composer.js'
import { buildDialogueRhythm } from '../vendor/presence-turn-runtime/src/runtime/compilePrompt.js'

const format = {
  minSentences: 2,
  maxSentences: 3,
  minSentenceChars: 15,
  maxSentenceChars: 45,
  minTotal: 60,
  maxTotal: 180,
}

test('persona format controls reply length instructions', () => {
  const instructions = getReplyFormatInstructions(2, format)
  assert.match(instructions, /2～3句/)
  assert.match(instructions, /15～45字/)
  assert.match(instructions, /60～180字/)
  assert.match(instructions, /连成一段/)
})

test('dialogue rhythm stays consistent with the persona format', () => {
  const rhythm = buildDialogueRhythm('default', format)
  assert.match(rhythm, /2～3句/)
  assert.match(rhythm, /60～180字/)
})

test('blank packs keep the original short-chat defaults', () => {
  const instructions = getReplyFormatInstructions(2)
  assert.match(instructions, /1～2句/)
  assert.match(instructions, /整轮≤240字/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { PERSONA } from '../src/persona.js'

test('persona exposes the fields the runtime needs', () => {
  assert.equal(typeof PERSONA.id, 'string')
  assert.ok(PERSONA.id.length > 0)
  assert.equal(typeof PERSONA.name, 'string')
  assert.ok(PERSONA.name.length > 0)
  assert.equal(typeof PERSONA.systemPrompt, 'string')
  assert.ok(PERSONA.systemPrompt.length > 0)
  assert.equal(typeof PERSONA.voiceHint, 'string')
  assert.ok(PERSONA.voiceHint.length > 0)
})

test('persona keeps the shared conversation guardrails by default', () => {
  assert.ok(PERSONA.forbidFamilies.includes('servant'))
  assert.ok(PERSONA.forbidFamilies.includes('order_scold'))
  assert.ok(PERSONA.forbidFamilies.includes('peer_dodge'))
  assert.ok(PERSONA.affect.attachmentFloor >= 0 && PERSONA.affect.attachmentFloor <= 1)
})

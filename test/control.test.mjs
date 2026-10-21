import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VoiceControl } from '../src/control.js'

test('voice toggle persists across instances', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-'))
  try {
    const first = new VoiceControl({ stateDir: dir, initialEnabled: false })
    assert.equal(first.enabled, false)
    first.setEnabled(true)

    const second = new VoiceControl({ stateDir: dir, initialEnabled: false })
    assert.equal(second.enabled, true)

    second.setEnabled(false)
    const third = new VoiceControl({ stateDir: dir, initialEnabled: true })
    assert.equal(third.enabled, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

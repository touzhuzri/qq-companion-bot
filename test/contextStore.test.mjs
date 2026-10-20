import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContextStore } from '../src/contextStore.js'

test('appends history and trims to maxItems', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-'))
  try {
    const store = new ContextStore(dir, 4)
    for (let i = 0; i < 6; i++) {
      store.append('g1', 'user', `消息${i}`)
    }
    const history = store.getHistory('g1')
    assert.equal(history.length, 4)
    assert.deepEqual(history.map((item) => item.content), ['消息2', '消息3', '消息4', '消息5'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('persists across instances and isolates groups', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-'))
  try {
    const first = new ContextStore(dir)
    first.append('111', 'user', '在吗')
    first.append('222', 'assistant', '嗯。')

    const second = new ContextStore(dir)
    assert.deepEqual(second.getHistory('111'), [{ role: 'user', content: '在吗' }])
    assert.deepEqual(second.getHistory('222'), [{ role: 'assistant', content: '嗯。' }])
    assert.deepEqual(second.getHistory('999'), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('skips empty content appends', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ctx-'))
  try {
    const store = new ContextStore(dir)
    store.append('g1', 'user', '   ')
    assert.deepEqual(store.getHistory('g1'), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flushNow, installStorageShim, setStorageNamespace } from '../src/storage.js'

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'stor-'))
  installStorageShim(dir)
  return dir
}

test('namespaces isolate mood/memory state per group', () => {
  setup()
  setStorageNamespace(111)
  localStorage.setItem('ptr_affect_state_v1', '{"hurt":1}')

  setStorageNamespace(222)
  assert.equal(localStorage.getItem('ptr_affect_state_v1'), null)
  localStorage.setItem('ptr_affect_state_v1', '{"hurt":5}')

  setStorageNamespace(111)
  assert.equal(localStorage.getItem('ptr_affect_state_v1'), '{"hurt":1}')
})

test('flush writes per-group files that reload on next install', () => {
  const dir = setup()
  setStorageNamespace(333)
  localStorage.setItem('ptr_local_memories_v1', '[{"text":"用户名叫小周"}]')
  flushNow()

  const path = join(dir, 'group_333.json')
  assert.ok(existsSync(path))
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), {
    ptr_local_memories_v1: '[{"text":"用户名叫小周"}]',
  })

  // 模拟重启:重新 install 后同一命名空间数据还在
  installStorageShim(dir)
  setStorageNamespace(333)
  assert.equal(
    localStorage.getItem('ptr_local_memories_v1'),
    '[{"text":"用户名叫小周"}]',
  )
  rmSync(dir, { recursive: true, force: true })
})

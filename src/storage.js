import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from './logger.js'

/**
 * presence-turn runtime 在浏览器里用 localStorage 落盘叠态与记忆;
 * Node 下这里垫一个按群隔离的文件版实现。
 * runtime 是在函数调用时才读写 globalThis.localStorage,
 * 所以只要在第一轮 sendTurn 之前 installStorageShim() 即可。
 */

/** @type {Map<string, Record<string, string>>} */
const namespaces = new Map()
let activeNs = ''
let stateDir = './state'
let flushTimer = null

export function installStorageShim(dir) {
  stateDir = dir
  mkdirSync(stateDir, { recursive: true })
  globalThis.localStorage = {
    getItem(key) {
      return loadNamespace(currentNs())[key] ?? null
    },
    setItem(key, value) {
      loadNamespace(currentNs())[key] = String(value)
      scheduleFlush()
    },
    removeItem(key) {
      delete loadNamespace(currentNs())[key]
      scheduleFlush()
    },
    clear() {
      namespaces.set(currentNs(), {})
      scheduleFlush()
    },
  }
}

/** 每轮 sendTurn 前切换到对应群的命名空间,防止跨群串情绪/记忆。 */
export function setStorageNamespace(groupId) {
  activeNs = namespaceKey(groupId)
}

export function flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  for (const [ns, data] of namespaces) {
    writeFileSync(join(stateDir, `${ns}.json`), JSON.stringify(data))
  }
}

function currentNs() {
  return activeNs || '_default_'
}

function namespaceKey(groupId) {
  return `group_${String(groupId).replace(/[^0-9-]/g, '')}`
}

function loadNamespace(ns) {
  if (!namespaces.has(ns)) {
    const path = join(stateDir, `${ns}.json`)
    let data = {}
    try {
      const raw = readFileSync(path, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed
    } catch {
      // 文件不存在或损坏:从空状态开始
    }
    namespaces.set(ns, data)
  }
  return namespaces.get(ns)
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    try {
      flushNow()
    } catch (err) {
      logger.error(`叠态落盘失败: ${err?.message}`)
    }
  }, 500)
}

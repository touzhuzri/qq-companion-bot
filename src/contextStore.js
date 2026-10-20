import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 每群滚动短上下文。只存最近 maxItems 条;
 * 真正塞进 prompt 的条数由 runtime 按 turnKind 自裁(招呼4条/普通10条)。
 */
export class ContextStore {
  constructor(stateDir, maxItems = 24) {
    this.stateDir = stateDir
    this.maxItems = maxItems
    mkdirSync(stateDir, { recursive: true })
  }

  getHistory(groupId) {
    return this.#load(groupId).history
  }

  append(groupId, role, content) {
    const value = String(content || '').trim()
    if (!value) return
    const data = this.#load(groupId)
    data.history = [...data.history, { role, content: value }].slice(-this.maxItems)
    this.#save(groupId, data)
  }

  #path(groupId) {
    return join(this.stateDir, `history_${sanitize(groupId)}.json`)
  }

  #load(groupId) {
    try {
      const parsed = JSON.parse(readFileSync(this.#path(groupId), 'utf8'))
      if (Array.isArray(parsed?.history)) return parsed
    } catch {
      // 首次或损坏:空历史
    }
    return { history: [] }
  }

  #save(groupId, data) {
    writeFileSync(this.#path(groupId), JSON.stringify(data))
  }
}

function sanitize(groupId) {
  return String(groupId).replace(/[^0-9-]/g, '')
}

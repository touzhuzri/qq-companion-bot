import { setDefaultResultOrder } from 'node:dns'

/**
 * 本机到 open.bigmodel.cn 的 IPv6 路径不可达,而 Node 默认会优先尝试 IPv6,
 * 表现为 fetch 一直等到超时。强制 IPv4 优先,避免每个 key 都白等一轮。
 *
 * 想恢复默认顺序可设置 BOT_DNS_ORDER=verbatim。
 */
const order = process.env.BOT_DNS_ORDER || 'ipv4first'
try {
  setDefaultResultOrder(order)
} catch {
  // 旧版 Node 不认识该选项时保持默认行为
}

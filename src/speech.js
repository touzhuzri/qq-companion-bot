/** 去掉模型偶尔夹带的括号动作/神态,只留说出口的话。 */
export function cleanSpeech(text) {
  return String(text || '')
    .replace(/^[（(][^）)]*[）)]\s*/, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function pureSpeech(reply) {
  return cleanSpeech(reply?.spokenText || reply?.displayText || reply?.content || '')
}

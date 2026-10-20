import { randomUUID } from 'node:crypto'
import { mkdirSync, unlink, writeFile } from 'node:fs'
import { join } from 'node:path'

const CLEANUP_DELAY_MS = 60000
const TTS_TIMEOUT_MS = 90000

/**
 * GPT-SoVITS api_v2 客户端:文本 → wav 临时文件。
 * 失败抛错由调用方兜底(语音失败不影响已发的文字)。
 */
export class TTSService {
  #apiEndpoint
  #refAudioPath
  #promptText
  #tempDir

  constructor({ apiEndpoint, refAudioPath, promptText, tempDir }) {
    this.#apiEndpoint = apiEndpoint
    this.#refAudioPath = refAudioPath
    this.#promptText = promptText
    this.#tempDir = tempDir
    mkdirSync(tempDir, { recursive: true })
  }

  /**
   * @param {string} text 要念出来的台词
   * @returns {Promise<string>} wav 文件绝对路径,发送后由 cleanupLater 延时删除
   */
  async synthesize(text) {
    const value = String(text || '').trim()
    if (!value) throw new Error('TTS 文本为空')
    if (!this.#refAudioPath) throw new Error('未配置参考音频 refAudioPath')

    const params = new URLSearchParams({
      text: value.slice(0, 200),
      text_lang: 'zh',
      ref_audio_path: this.#refAudioPath,
      prompt_text: this.#promptText,
      prompt_lang: 'zh',
      media_type: 'wav',
      streaming: 'false',
    })
    const response = await fetch(`${this.#apiEndpoint}?${params}`, {
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    })
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 120)
      throw new Error(`TTS HTTP ${response.status} ${detail}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength < 1000) throw new Error('TTS 返回内容过短')

    // 直接透传模型原始输出(v2=32kHz,NapCat 转码器对 32k 通过、对 24k/48k 会失败)
    const path = join(this.#tempDir, `tts_${randomUUID()}.wav`)
    await new Promise((resolveWrite, rejectWrite) =>
      writeFile(path, buffer, (err) => (err ? rejectWrite(err) : resolveWrite())),
    )
    return path
  }

  /** NapCat 异步读文件,延迟删除避免发送中途文件消失 */
  cleanupLater(path) {
    setTimeout(() => {
      unlink(path, () => {})
    }, CLEANUP_DELAY_MS)
  }
}

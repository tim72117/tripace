// photoRecognition——上傳圖片後,把前端產生的 llm 縮圖(見 photoVariants.ts,最長邊 1024)送給 onagent
// 辨識,取回一句場景描述,當作這張圖的備註。
//
// 每張圖各開一條獨立、用完即關的 AgentBridge 連線(= 獨立對話):onagent 的圖片會留在對話裡、之後每輪都再送一次
// (見 onagent CHANGELOG v0.7.8 Known limits),共用一條長對話會讓 token 越滾越大;一張圖只問一次,用完關掉最省。
// 這個 app 不掛任何工具(tools: {}),只做圖片描述。app 端要先開啟圖片輸入(apps.max_prompt_images,預設關閉),
// 沒開時 onagent 回 images_not_allowed,這裡會當成辨識失敗。
//
// 功能由 feature flag VITE_FEATURE_BLOG_PHOTO_RECOGNITION=true 開啟(預設關閉,卡片上不會出現「辨識」按鈕);
// 開啟後仍需設定 VITE_ONAGENT_URL 與 VITE_BLOG_IMAGE_ONAGENT_APP_KEY,缺了按下去會顯示「尚未設定圖片辨識服務」。
import { AgentBridge, imageFromBlob } from '@onagent/bridge'

const APP_ID = 'blog-image-note'
const PROMPT =
  '請用繁體中文,以一句話(不超過 40 字)描述這張旅遊照片的場景與主要內容。只輸出描述本身,不要加引號、標點結尾以外的符號或任何前後說明。'
// 備註上限:模型偶爾會多話,截斷避免撐爆卡片(後端 note 沒有長度限制)。
const MAX_NOTE_LENGTH = 120
const TIMEOUT_MS = 60_000

const HTTP_URL = import.meta.env.VITE_ONAGENT_URL as string | undefined
const APP_KEY = import.meta.env.VITE_BLOG_IMAGE_ONAGENT_APP_KEY as string | undefined

export const BLOG_PHOTO_RECOGNITION_ENABLED = import.meta.env.VITE_FEATURE_BLOG_PHOTO_RECOGNITION === 'true'

// normalizeNote:去掉前後空白與包住整句的引號,多行只留第一個非空行,超過長度截斷。空字串代表沒有可用內容。
export function normalizeNote(raw: string): string {
  const firstLine = raw.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? ''
  const unquoted = firstLine.replace(/^["'「『“]+/, '').replace(/["'」』”]+$/, '').trim()
  return Array.from(unquoted).slice(0, MAX_NOTE_LENGTH).join('')
}

// recognizePhoto:送出一張圖,回傳描述文字;失敗或逾時丟出 Error。
export async function recognizePhoto(image: Blob): Promise<string> {
  if (!HTTP_URL || !APP_KEY) throw new Error('尚未設定圖片辨識服務')
  const payload = await imageFromBlob(image)

  return new Promise<string>((resolve, reject) => {
    let settled = false
    const bridge = new AgentBridge({
      url: HTTP_URL.replace(/^http/, 'ws') + '/ws',
      appId: APP_ID,
      apiKey: APP_KEY,
      transport: 'sse',
      lazyConnect: true,
      tools: {},
      onAssistantMessage: (text) => finish(() => {
        const note = normalizeNote(text)
        if (note === '') reject(new Error('辨識結果是空的'))
        else resolve(note)
      }),
      onError: (err) => finish(() => reject(new Error(err.message || `辨識失敗(${err.code})`))),
      onQuotaExceeded: () => finish(() => reject(new Error('辨識額度已用完'))),
    })
    const timer = setTimeout(() => finish(() => reject(new Error('辨識逾時'))), TIMEOUT_MS)
    function finish(settle: () => void) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      bridge.close()
      settle()
    }
    bridge.prompt(PROMPT, { images: [payload] })
  })
}

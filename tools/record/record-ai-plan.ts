// record-ai-plan.ts — 自動化錄製 /ai-plan(透過 home/record/RecordAiPlanPage.tsx
// 的手機外框頁)展示動畫,產出可直接拿去剪輯/投放的影片檔,不需要人在
// 旁邊手動操作滑鼠或啟動/停止螢幕錄製軟體。
//
// 設計依據(2026-10 技術調研結論,詳見對話記錄):
// - 用 Playwright 的 library API(不是 Playwright Test runner)——這支
//   script 的性質是「執行一次、產出檔案」的工具,不是斷言式測試,混進
//   tests/ 目錄會讓兩種性質的東西擠在一起,也不需要 Test runner 的
//   retry/reporter 等機制。
// - 錄製視窗尺寸直接設成目標輸出解析度(見下方 ASPECT_PRESETS),不是
//   開一個小視窗再放大裁切——原生 1:1 像素對應,畫質最穩定,不會有縮放
//   模糊(見這次調研對「畫質考量」的結論)。
// - 這個工具(tools/record)獨立於 web/:自己的 package.json、依賴與 Vite dev server,
//   不掛在正式站任何路由上,**也不改任何正式元件**。錄製需要的行為(固定節奏、亮色、字卡
//   觸發、播完偵測)都在這支腳本與殼層頁面(src/RecordAiPlanPage.tsx)裡,從外面做:
//   * 版面:殼層 iframe 用主站既有的 ?embedded=1(隱藏頂部浮動導覽與捲軸把手)。
//   * 亮色:Playwright 的 colorScheme: 'light'。
//   * 節奏:installPacing 透過 addInitScript 在主站頁面載入前調整計時器(見該函式說明)。
//   * 字卡與播完:waitForPlaybackDone 從外面觀察主站頁面(站點卡片數量、文字是否還在變),
//     再通知殼層頁面;不是固定睡幾秒,劇本內容調整長度時不需要改這支腳本。
// - --pace 對應廣告企劃(2026-10 Fable 模型規劃)的兩個版本:normal 是
//   30 秒原速主版(展示頁預設 90ms/字打字速度),fast 是 15 秒剪輯版
//   建議的 60ms/字(企劃明確要求「不要用後製變速,會讓送出鈕樣式切換
//   閃爍」,故由頁面載入時就決定好節奏,見 RecordAiPlanPage.tsx
//   PACE_PRESETS 的完整說明)。
//
// 錄製方式(2026-10 改版,取代原本的 Playwright recordVideo):原本用
// Playwright context 的 recordVideo 選項自動產生 WebM,但 Playwright
// 的 screencast 固定用 VP8 低位元率編碼、不提供任何畫質/位元率調整
// 參數(這是 Playwright 本身的限制,設計給測試除錯用,不是給正式產出
// 高畫質素材用的)——使用者實際發布到 Facebook 後肉眼檢查,發現畫面
// 色彩飽和度不足、邊緣發糊,這是 VP8 對大面積純色/漸層區塊處理不夠
// 精細造成的壓縮副作用,不是畫面本身的 CSS 設計問題。改成「連續無損
// 截圖 + ffmpeg 把圖片序列編碼成影片」:
//   1. page.screenshot() 以固定頻率(見 SCREENSHOT_FPS)連續截取無損
//      PNG,存進一個暫時的影格資料夾
//   2. 錄製結束後用 ffmpeg -framerate 把整個圖片序列編碼成 H.264 MP4
// 這個方式畫質是真正的無損(PNG 本身不失真),唯一的畫質損耗來自最後
// 一次 H.264 編碼(用 -crf 18 高品質設定,視覺上接近無損),比「錄成
// VP8 再轉檔」少了一層壓縮損失。曾評估改用 ffmpeg 的 avfoundation
// 直接擷取螢幕畫面(macOS 原生螢幕錄製),但那個方式需要使用者授權
// 螢幕錄製權限、且會錄到整個實體螢幕畫面(容易被其他視窗或系統 UI
// 干擾、解析度跟系統螢幕 DPI 綁定),不像 Playwright 截圖那樣乾淨地
// 只拿到瀏覽器 viewport 本身的像素內容,故不採用。
//
// 用法:
//   先在兩個終端機視窗各啟動一個 dev server(這支腳本不會自動啟動它們,
//   理由同 playwright.config.ts 對 webServer 選項的既有取捨——dev
//   server 啟動/重整/HMR 的生命週期不該被一次性錄製腳本綁住):
//     cd web && npm run dev                 # 主站(5173),提供被錄的 /ai-plan
//     cd tools/record && npm run dev        # 錄製頁(5195),手機外框,不屬於正式站
//
//   再執行(可重複執行,每次覆寫 output/ 底下同名檔案):
//     cd tools/record && npm run record --
//     cd tools/record && npm run record -- --ratio=4:5
//     cd tools/record && npm run record -- --ratio=all
//     cd tools/record && npm run record -- --ratio=all --pace=fast
//
// 除錯選項:
//   --frames-only    只錄影格(留在 output/.frames-*),不編碼 MP4、不需要 ffmpeg
//   RECORD_FPS=2     環境變數,降低截圖頻率(預設 30),搭配 --frames-only 快速驗證
//   RECORD_URL=...   環境變數,錄製頁網址(預設 http://localhost:5195)
//
// 輸出:tools/record/output/ai-plan-<ratio>-<pace>.mp4

import { chromium, type Frame, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const execFileAsync = promisify(execFile)

// ASPECT_PRESETS——對齊 RecordAiPlanPage.tsx 的 ASPECT_RATIOS,刻意用
// 同一組比例/尺寸命名,兩邊改動時容易互相對照。viewport 尺寸直接等於
// 最終輸出解析度(見檔頭說明的畫質考量),不是縮小後再放大。
const ASPECT_PRESETS = {
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '9:16': { width: 1080, height: 1920 },
} as const

type AspectKey = keyof typeof ASPECT_PRESETS

// PACE_PRESETS——對應廣告企劃(2026-10 Fable 模型規劃)的兩個版本:30 秒原速主版用
// 展示頁預設的 90ms/字打字速度;15 秒剪輯版企劃明確建議 60ms/字,「不要用後製變速,
// 變速會讓送出鈕的樣式切換也被加速,看起來閃爍」,所以在頁面載入當下就決定好節奏。
// startDelayMs 是開場定格:讓第一個畫面先停在輸入框,再開始打字。
// 這些都由下面的 installPacing 在瀏覽器端套用,不需要(也不該)為了錄製去改正式元件。
const PACE_PRESETS = {
  normal: { typeSpeedMs: 90, startDelayMs: 800 },
  fast: { typeSpeedMs: 60, startDelayMs: 400 },
} as const
const PACE_KEYS = Object.keys(PACE_PRESETS) as (keyof typeof PACE_PRESETS)[]
type PaceKey = keyof typeof PACE_PRESETS

// SIM_STOP_IDS——劇本(web/src/planning/preview/planSimScript.ts)站點出現的順序。
// 外面的殼層字卡(RecordAiPlanPage.tsx CAPTIONS)是依 stop id 觸發的;主站不再廣播
// 任何錄製信號,所以由這支腳本數畫面上的站點卡片數量,第 N 張出現就通知殼層第 N 個 id。
// 劇本站點順序改變時,這份清單要跟著改(跟殼層 CAPTIONS 綁的 id 是同一份對照)。
const SIM_STOP_IDS = [
  'stop-chikanlou-area',
  'stop-lunch',
  'stop-shennong',
  'stop-confucius-area',
  'stop-literature-museum',
  'stop-fire-museum',
  'stop-evening',
  'stop-dinner',
  'stop-anping-fort',
  'stop-anping-treehouse',
  'stop-anping-mazu',
] as const

// STOP_CARD_SELECTOR——時間軸上每個站點卡片(PlanTimelineView.module.css 的 .stopCard)。
// 正式元件沒有為此加任何 data 屬性,所以靠 CSS Modules 的 class 名稱:dev server 產生的名稱
// 形如 _stopCard_xxxxx。前後都帶底線比對,才不會誤中同一個檔案裡的 .stopCardWrap、
// .stopCardSelected(選取時同一個元素會同時帶 _stopCard_ 與 _stopCardSelected_,不能用
// 子字串 stopCard 比對,否則包覆層與選取狀態會讓數量加倍)。
// PlanTimelineView.module.css 改名或 CSS Modules 命名規則改變時,這裡要跟著改。
const STOP_CARD_SELECTOR = '[class*="_stopCard_"]'

// RECORD_URL——錄製頁(tools/record 自己的 dev server,見 vite.config.ts)。它內嵌的
// 主站(web/ 的 dev server,預設 5173)由錄製頁的 ?main= / VITE_MAIN_URL 決定。
const RECORD_URL = process.env.RECORD_URL ?? 'http://localhost:5195'
const OUTPUT_DIR = path.join(import.meta.dirname, 'output')

// 播放完成的判斷:主站正式元件不再設任何「播完」標記,改看畫面——時間軸站點卡片
// 與頁面文字連續 DONE_QUIET_MS 都沒有變化,就視為劇本播完。劇本每一步之間最長約
// 1.5 秒,4 秒的安靜期足以區分「步驟之間的停頓」與「播完」。
// DONE_TIMEOUT_MS 是整段播放的逾時上限(劇本 11 站、每步約 1.1 秒,寬裕數倍)。
const OBSERVE_INTERVAL_MS = 250
const DONE_QUIET_MS = 4_000
const DONE_TIMEOUT_MS = 120_000

// SCREENSHOT_FPS——連續截圖的頻率。30fps 是社群媒體短影音的標準幀率,
// 高於這個數字對這種「字卡切換、卡片依序出現」的介面動畫而言畫面感
// 提升有限,卻會讓截圖/編碼耗時與磁碟用量等比例增加。
// RECORD_FPS 環境變數可覆寫(除錯用,例如 RECORD_FPS=2 搭配 --frames-only 快速驗證,不產生上千張影格)。
const recordFpsEnv = Number(process.env.RECORD_FPS)
const SCREENSHOT_FPS = Number.isFinite(recordFpsEnv) && recordFpsEnv > 0 ? recordFpsEnv : 30
const SCREENSHOT_INTERVAL_MS = 1000 / SCREENSHOT_FPS

function parseArgs(): { ratios: AspectKey[]; pace: PaceKey; framesOnly: boolean } {
  const ratioArg = process.argv.find((a) => a.startsWith('--ratio='))?.split('=')[1] ?? '9:16'
  const ratios =
    ratioArg === 'all' ? (Object.keys(ASPECT_PRESETS) as AspectKey[]) : [ratioArg as AspectKey]
  if (ratioArg !== 'all' && !(ratioArg in ASPECT_PRESETS)) {
    throw new Error(`未知的 --ratio 值:${ratioArg}(可用:${Object.keys(ASPECT_PRESETS).join(', ')}, all)`)
  }

  const paceArg = process.argv.find((a) => a.startsWith('--pace='))?.split('=')[1] ?? 'normal'
  if (!PACE_KEYS.includes(paceArg as PaceKey)) {
    throw new Error(`未知的 --pace 值:${paceArg}(可用:${PACE_KEYS.join(', ')})`)
  }

  // --frames-only:只錄影格(留在 output/.frames-*),不編碼 MP4、不需要 ffmpeg——除錯用,
  // 例如確認節奏/字卡/播完偵測正常,或想自己用別的工具編碼。
  return { ratios, pace: paceArg as PaceKey, framesOnly: process.argv.includes('--frames-only') }
}

// waitForSimFrame——找出錄製頁裡內嵌 /ai-plan 的 iframe(主站),等它載入完成。
async function waitForSimFrame(page: Page): Promise<Frame> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const frame = page.frames().find((f) => f !== page.mainFrame() && f.url().includes('/ai-plan'))
    if (frame) {
      await frame.waitForLoadState('domcontentloaded')
      return frame
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('找不到內嵌的 /ai-plan iframe(主站 dev server 有在跑嗎?預設 http://localhost:5173)')
}

// installPacing——在瀏覽器端(主站 /ai-plan 的 frame 內,頁面腳本執行之前)套用錄製用節奏。
// 透過 context.addInitScript 注入,所以完全不改 web/ 的程式碼。兩個調整都依賴主站目前的實作細節,對不上時只是「退回主站原本的
// 隨機/預設節奏」,不會讓錄製失敗:
//   1. 劇本每一步之間的隨機延遲(web/src/planning/preview/planSimFakeSource.ts randomDelayMs,
//      900~1500ms)改成固定值,每次錄出來總長度一致,方便重錄與對齊剪輯。
//      副作用:同一個 frame 裡任何落在 900~1499ms 的 setTimeout 都會被改掉。
//   2. 開場打字動畫的 setInterval(web/src/planning/preview/Content.tsx,90ms/字)改成指定速度,
//      並延後 startDelayMs 才開始。副作用:同一個 frame 裡所有 90ms 的 setInterval 都會被改。
// 注意:這個函式會被序列化後在瀏覽器裡執行,不能引用外面的變數,參數只能走 opts。
function installPacing(opts: {
  typeSpeedMs: number
  startDelayMs: number
  fixedDelayMs: number
  hookDelayMs: number
  hookSteps: number
}): void {
  if (location.pathname !== '/ai-plan') return
  const realSetTimeout = window.setTimeout.bind(window)
  const realClearTimeout = window.clearTimeout.bind(window)
  const realSetInterval = window.setInterval.bind(window)
  const realClearInterval = window.clearInterval.bind(window)

  // 開場前 hookSteps 步用較短的 hookDelayMs(前 3 秒要快速抓住觀眾),之後回到 fixedDelayMs,
  // 殼層字卡的出現時機是依這個「開頭快、中段穩」的節奏校正的。
  let stepsSeen = 0
  window.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    let delay = ms
    if (typeof ms === 'number' && ms >= 900 && ms < 1500) {
      delay = stepsSeen < opts.hookSteps ? opts.hookDelayMs : opts.fixedDelayMs
      stepsSeen += 1
    }
    return realSetTimeout(fn, delay, ...args)
  }) as typeof window.setTimeout

  // 打字動畫的 interval 要「延後開始」,但呼叫端拿到的是同步回傳的 id、之後用它 clearInterval,
  // 所以回傳一個負數代理 id,記住真正的 timer;clearInterval 時兩種都清掉。
  const aliases = new Map<number, { start?: number; id?: number }>()
  let nextAlias = -1
  window.setInterval = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    if (ms !== 90) return realSetInterval(fn, ms, ...args)
    const alias = nextAlias--
    const entry: { start?: number; id?: number } = {}
    entry.start = realSetTimeout(() => {
      entry.id = realSetInterval(fn, opts.typeSpeedMs, ...args)
    }, opts.startDelayMs)
    aliases.set(alias, entry)
    return alias
  }) as typeof window.setInterval
  window.clearInterval = ((id?: number) => {
    const entry = typeof id === 'number' ? aliases.get(id) : undefined
    if (entry) {
      if (entry.start !== undefined) realClearTimeout(entry.start)
      if (entry.id !== undefined) realClearInterval(entry.id)
      aliases.delete(id as number)
      return
    }
    realClearInterval(id)
  }) as typeof window.clearInterval
}

// postSignal——在殼層頁面自己 postMessage,觸發字卡(見 RecordAiPlanPage.tsx useCaption)。
async function postSignal(
  page: Page,
  signal: { type: 'stop-added'; stopId: string } | { type: 'plan-sim-done' },
): Promise<void> {
  await page.evaluate((s) => window.postMessage({ source: 'ai-plan-sim', ...s }, '*'), signal)
}

// findSimFrame——目前內嵌 /ai-plan 的 frame(沒有就回 null)。內嵌頁面若重新載入,舊的
// Frame 物件會失效,所以每一輪觀察都重新找,不快取。
function findSimFrame(page: Page): Frame | null {
  return page.frames().find((f) => f !== page.mainFrame() && f.url().includes('/ai-plan')) ?? null
}

// waitForPlaybackDone——從外面觀察內嵌的主站頁面:
//   - 數站點卡片,每多出一張就通知殼層對應的 stop id(字卡跟著劇本真實進度走);
//   - 站點數與「站點卡片本身的文字」連續 DONE_QUIET_MS 沒變化就視為播完,通知殼層切到 CTA 字卡。
//     只看卡片文字、不看整頁文字:地圖的介面文字會持續變動,會讓整頁永遠等不到安靜期。
// frame.evaluate 對跨來源的 frame 也能執行(主站是另一個來源的 dev server)。單次讀取失敗
// (例如頁面剛好重新載入、execution context 被銷毀)只略過這一輪,不中止整段錄製。
async function waitForPlaybackDone(page: Page): Promise<void> {
  const startedAt = Date.now()
  let announced = 0
  let lastSnapshot = ''
  let lastChangeAt = Date.now()
  let lastError = ''
  while (Date.now() - startedAt < DONE_TIMEOUT_MS) {
    const frame = findSimFrame(page)
    let reading: { stops: number; cardText: number } | null = null
    if (frame) {
      try {
        reading = await frame.evaluate((sel) => {
          // 只算最外層的卡片(祖先沒有再符合選擇器的),避免巢狀元素重複計算。
          const cards = Array.from(document.querySelectorAll<HTMLElement>(sel)).filter(
            (el) => !el.parentElement?.closest(sel),
          )
          return { stops: cards.length, cardText: cards.reduce((n, el) => n + el.innerText.length, 0) }
        }, STOP_CARD_SELECTOR)
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }

    if (reading) {
      while (announced < Math.min(reading.stops, SIM_STOP_IDS.length)) {
        await postSignal(page, { type: 'stop-added', stopId: SIM_STOP_IDS[announced] })
        announced += 1
      }
      const snapshot = `${reading.stops}:${reading.cardText}`
      if (snapshot !== lastSnapshot) {
        lastSnapshot = snapshot
        lastChangeAt = Date.now()
      } else if (reading.stops > 0 && Date.now() - lastChangeAt >= DONE_QUIET_MS) {
        await postSignal(page, { type: 'plan-sim-done' })
        return
      }
    }
    await new Promise((resolve) => setTimeout(resolve, OBSERVE_INTERVAL_MS))
  }
  throw new Error(
    `等待劇本播完逾時(${DONE_TIMEOUT_MS / 1000} 秒;已觀察到 ${announced} 站)。` +
      `站點卡片選擇器 ${STOP_CARD_SELECTOR} 可能已對不上。` +
      (lastError ? ` 最後一次讀取錯誤:${lastError}` : ''),
  )
}

// ensureFfmpeg——執行前先確認系統裝了 ffmpeg(圖片序列編碼成影片需要),
// 給出明確的安裝指引而不是讓它在錄完一長串截圖之後才失敗(連續截圖
// 本身要花二三十秒,早一點失敗省時間)。
async function ensureFfmpeg(): Promise<void> {
  try {
    await execFileAsync('ffmpeg', ['-version'])
  } catch {
    throw new Error(
      '找不到 ffmpeg(圖片序列編碼成影片需要)。請先安裝:\n' +
        '  macOS: brew install ffmpeg\n' +
        '  Windows: winget install ffmpeg\n' +
        '安裝後重開一個終端機視窗(讓 PATH 生效)再重跑這支腳本。',
    )
  }
}

async function recordOneRatio(ratio: AspectKey, pace: PaceKey, framesOnly: boolean): Promise<void> {
  const { width, height } = ASPECT_PRESETS[ratio]
  const safeRatioName = `${ratio.replace(":", "x")}-${pace}`

  console.log(`\n=== 錄製 ${ratio}(${width}×${height})/ ${pace} ===`)

  // framesDir——這次錄製的暫存影格資料夾,錄完編碼成影片後整個刪除,
  // 不留在 output/ 裡(每個影格都是未壓縮/輕壓縮 PNG,數量可能上百張,
  // 混進 output/ 會讓人誤以為是正式產出檔案)。用 safeRatioName 當
  // 子目錄名稱,同時錄多種比例時彼此的暫存影格不會互相覆蓋。
  const framesDir = path.join(OUTPUT_DIR, `.frames-${safeRatioName}`)
  if (existsSync(framesDir)) rmSync(framesDir, { recursive: true, force: true })
  mkdirSync(framesDir, { recursive: true })

  const browser = await chromium.launch()
  // viewport 直接等於目標輸出解析度——錄製頁(RecordAiPlanPage.tsx)的
  // .canvasOuter 用 aspect-ratio + max-width/max-height 自動撐滿可用
  // 視窗,只要視窗本身就是正確比例,畫面會自動填滿,不需要額外計算裁切
  // 區域。不再傳 recordVideo(見檔頭「錄製方式」的完整說明,改用連續
  // 截圖取代)。
  // colorScheme: 'light'——廣告素材的字卡配色/米白畫布是針對亮色設計,不受系統深色偏好
  // 影響。
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: 'light' })
  await context.addInitScript(installPacing, { ...PACE_PRESETS[pace], fixedDelayMs: 1100, hookDelayMs: 500, hookSteps: 2 })
  const page = await context.newPage()

  // hideControls=1——實際發生過的真實問題(2026-10):第一次自動化錄製
  // 拿到的成品檢查發現,RecordAiPlanPage.tsx 頂部的控制列(錄製比例/
  // 節奏/背景色按鈕)整排都入鏡了,不是單純裁切範圍抓歪——viewport 被
  // 設成目標輸出解析度後,控制列佔掉的高度會讓 .canvasOuter 的縮放
  // 公式把畫布連同控制列一起塞進 viewport。這個參數讓該頁面完全不
  // 渲染控制列(見 RecordAiPlanPage.tsx hideControls 的完整說明),
  // .canvasOuter 才會真的撐滿跟 viewport 一致的高度,畫面構圖才正確。
  await page.goto(
    `${RECORD_URL}/?ratio=${encodeURIComponent(ratio)}&hideControls=1`,
    // domcontentloaded 就夠:內嵌的主站頁面(地圖圖磚、照片)網路一直在忙,等 networkidle 會逾時;
    // 截圖迴圈本來就要在載入完成後立刻開始(見下方 startScreenshotLoop 的說明)。
    { waitUntil: 'domcontentloaded' },
  )

  // startScreenshotLoop——用 setInterval 固定頻率連續截圖,對齊
  // SCREENSHOT_FPS。截圖檔名用補零的流水號(frame-000001.png)確保
  // ffmpeg 讀取圖片序列時的字典順序就是正確的時間順序。截圖失敗(例如
  // 頁面短暫未就緒)只記錄警告跳過,不中斷整段錄製——漏一兩張影格對
  // 30fps 的動畫不明顯,但讓單次截圖失敗就整個錄製失敗反而更脆弱。
  //
  // 實際發生過的真實問題(2026-10):原本這個迴圈是在 page.goto() 之後
  // 先 waitForTimeout(1500)(等真實景點照片載入)才啟動,使用者檢查
  // 錄製成品後回報「前面輸入文字幾秒怎麼不見了」——/ai-plan 一載入就
  // 立刻開始打字動畫(startDelayMs 預設 0,fast pace 只有 400ms),這
  // 1.5 秒的等待期間打字動畫甚至後面幾步劇本已經在背景播完,截圖迴圈
  // 開始時早就錯過了開場。改成 page.goto() 完成後立刻啟動截圖迴圈,
  // 不再有任何「先等待再開始錄」的空窗期——原本等待照片載入的理由
  // (避免錄到縮圖空白)現在直接變成「錄到縮圖從空白淡入變成真實照片
  // 的過程」,這本來就是展示內容的一部分,不需要跳過。
  let frameIndex = 0
  let capturing = true
  const captureLoop = (async () => {
    while (capturing) {
      const frameStartedAt = Date.now()
      try {
        frameIndex += 1
        const frameName = `frame-${String(frameIndex).padStart(6, '0')}.png`
        await page.screenshot({ path: path.join(framesDir, frameName) })
      } catch (err) {
        console.warn(`截圖失敗(第 ${frameIndex} 張),已跳過:`, err instanceof Error ? err.message : err)
      }
      const elapsed = Date.now() - frameStartedAt
      const waitMs = Math.max(0, SCREENSHOT_INTERVAL_MS - elapsed)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  })()

  console.log('開始連續截圖,等待劇本播放完成(畫面安靜 4 秒即視為播完)…')
  const startedAt = Date.now()
  try {
    // 先等內嵌的主站 iframe 出現(主站 dev server 沒開時,在這裡給出明確訊息)。
    await waitForSimFrame(page)
    await waitForPlaybackDone(page)
    console.log(`劇本播放完成,耗時 ${((Date.now() - startedAt) / 1000).toFixed(1)} 秒`)

    // 結尾多留 1.5 秒——讓「立即使用」按鈕展開動畫完整播完,呼應廣告企劃
    // 分鏡裡「結尾定格強調完成狀態」的節奏設計,不要一偵測到完成就立刻
    // 切斷畫面。
    await page.waitForTimeout(1500)
  } finally {
    // 成功或失敗都要收尾:停止截圖迴圈、關閉瀏覽器,否則失敗時截圖迴圈與瀏覽器會殘留。
    capturing = false
    await captureLoop
    await context.close()
    await browser.close()
  }
  console.log(`連續截圖完成,共 ${frameIndex} 張影格`)

  if (framesOnly) {
    console.log(`--frames-only:不編碼,影格留在 ${framesDir}`)
    return
  }

  const mp4Path = path.join(OUTPUT_DIR, `ai-plan-${safeRatioName}.mp4`)
  console.log('將影格序列編碼成 MP4…')
  // -framerate 指定輸入圖片序列的播放速率(對齊截圖頻率,不是輸出
  // 幀率——兩者在這裡數值相同,但語意不同:-framerate 是「每秒讀幾張
  // 輸入圖」,放在 -i 之前才會正確套用在輸入端)。
  // -crf 18:視覺上接近無損,檔案大小仍可接受,優先畫質而非壓縮率——
  // 這是最終要投放的廣告素材,不是暫存用的壓縮檔。-pix_fmt yuv420p:
  // 確保輸出的色彩格式被各平台(含 Facebook)廣泛支援,避免播放異常。
  await execFileAsync('ffmpeg', [
    '-y',
    '-framerate', String(SCREENSHOT_FPS),
    '-i', path.join(framesDir, 'frame-%06d.png'),
    '-c:v', 'libx264',
    '-crf', '18',
    '-preset', 'slow',
    '-pix_fmt', 'yuv420p',
    mp4Path,
  ])
  console.log(`MP4 已輸出:${mp4Path}`)

  rmSync(framesDir, { recursive: true, force: true })
}

async function main(): Promise<void> {
  const { ratios, pace, framesOnly } = parseArgs()
  if (!framesOnly) await ensureFfmpeg()

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true })

  for (const ratio of ratios) {
    await recordOneRatio(ratio, pace, framesOnly)
  }

  console.log(`\n全部完成,輸出目錄:${OUTPUT_DIR}`)
}

main().catch((err) => {
  console.error('\n錄製失敗:', err instanceof Error ? err.message : err)
  process.exit(1)
})

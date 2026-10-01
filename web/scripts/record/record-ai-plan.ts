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
// - 用 iframe 內 <body data-plan-sim-done> 屬性判斷播放是否結束(見
//   AIPlanTimelinePage.tsx composerCollapsed 的完整說明),不是固定
//   睡幾秒——劇本內容之後若調整長度,這支腳本不需要跟著改。
// - RecordAiPlanPage 的 iframe 固定帶 ?recordMode=1,讓劇本改用固定
//   節奏(見 planSimFakeSource.ts RECORD_DELAY_MS 的完整說明),每次
//   錄出來的總長度/時間點都一致,方便重錄/對齊剪輯。
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
//   先在另一個終端機視窗啟動 dev server(這支腳本不會自動啟動它,
//   理由同 playwright.config.ts 對 webServer 選項的既有取捨——dev
//   server 啟動/重整/HMR 的生命週期不該被一次性錄製腳本綁住):
//     cd web && npm run dev
//
//   再執行(可重複執行,每次覆寫 output/ 底下同名檔案):
//     cd web && npx tsx scripts/record/record-ai-plan.ts
//     cd web && npx tsx scripts/record/record-ai-plan.ts --ratio=4:5
//     cd web && npx tsx scripts/record/record-ai-plan.ts --ratio=all
//     cd web && npx tsx scripts/record/record-ai-plan.ts --ratio=all --pace=fast
//
// 輸出:web/scripts/record/output/ai-plan-<ratio>-<pace>.mp4

import { chromium } from '@playwright/test'
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

// PACE_KEYS——對齊 RecordAiPlanPage.tsx 的 PACE_PRESETS 鍵值,不重複定義
// 速度數值本身(那些數值只需要存在於網頁那一側,這支腳本只是把 ?pace=
// 原封不動轉傳給 /record/ai-plan,不需要知道實際的 ms 數字)。
const PACE_KEYS = ['normal', 'fast'] as const
type PaceKey = (typeof PACE_KEYS)[number]

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'
const OUTPUT_DIR = path.join(import.meta.dirname, 'output')

// DONE_POLL_INTERVAL_MS/DONE_TIMEOUT_MS——輪詢 iframe 內
// data-plan-sim-done 屬性的頻率與逾時上限。逾時值抓得比劇本固定節奏
// (RECORD_DELAY_MS=1100ms × 約 21 個動作,見 planSimFakeSource.ts/
// planSimScript.ts)實際播放時長(~25 秒)寬裕一倍以上,避免 dev server
// 偶爾卡頓或照片載入變慢時誤判逾時而提早截斷。
const DONE_POLL_INTERVAL_MS = 500
const DONE_TIMEOUT_MS = 60_000

// SCREENSHOT_FPS——連續截圖的頻率。30fps 是社群媒體短影音的標準幀率,
// 高於這個數字對這種「字卡切換、卡片依序出現」的介面動畫而言畫面感
// 提升有限,卻會讓截圖/編碼耗時與磁碟用量等比例增加。
const SCREENSHOT_FPS = 30
const SCREENSHOT_INTERVAL_MS = 1000 / SCREENSHOT_FPS

function parseArgs(): { ratios: AspectKey[]; pace: PaceKey } {
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

  return { ratios, pace: paceArg as PaceKey }
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

async function recordOneRatio(ratio: AspectKey, pace: PaceKey): Promise<void> {
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
  const context = await browser.newContext({ viewport: { width, height } })
  const page = await context.newPage()

  // hideControls=1——實際發生過的真實問題(2026-10):第一次自動化錄製
  // 拿到的成品檢查發現,RecordAiPlanPage.tsx 頂部的控制列(錄製比例/
  // 節奏/背景色按鈕)整排都入鏡了,不是單純裁切範圍抓歪——viewport 被
  // 設成目標輸出解析度後,控制列佔掉的高度會讓 .canvasOuter 的縮放
  // 公式把畫布連同控制列一起塞進 viewport。這個參數讓該頁面完全不
  // 渲染控制列(見 RecordAiPlanPage.tsx hideControls 的完整說明),
  // .canvasOuter 才會真的撐滿跟 viewport 一致的高度,畫面構圖才正確。
  await page.goto(
    `${BASE_URL}/record/ai-plan?ratio=${encodeURIComponent(ratio)}&pace=${encodeURIComponent(pace)}&hideControls=1`,
    { waitUntil: 'networkidle' },
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

  console.log('開始連續截圖,等待劇本播放完成(輪詢 data-plan-sim-done)…')
  const startedAt = Date.now()
  await page.waitForFunction(
    () => {
      const iframe = document.querySelector('iframe')
      const iframeBody = iframe?.contentDocument?.body
      return iframeBody?.getAttribute('data-plan-sim-done') === 'true'
    },
    { timeout: DONE_TIMEOUT_MS, polling: DONE_POLL_INTERVAL_MS },
  )
  console.log(`劇本播放完成,耗時 ${((Date.now() - startedAt) / 1000).toFixed(1)} 秒`)

  // 結尾多留 1.5 秒——讓「立即使用」按鈕展開動畫完整播完,呼應廣告企劃
  // 分鏡裡「結尾定格強調完成狀態」的節奏設計,不要一偵測到完成就立刻
  // 切斷畫面。
  await page.waitForTimeout(1500)

  capturing = false
  await captureLoop
  console.log(`連續截圖完成,共 ${frameIndex} 張影格`)

  await context.close()
  await browser.close()

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
  await ensureFfmpeg()

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true })

  const { ratios, pace } = parseArgs()
  for (const ratio of ratios) {
    await recordOneRatio(ratio, pace)
  }

  console.log(`\n全部完成,輸出目錄:${OUTPUT_DIR}`)
}

main().catch((err) => {
  console.error('\n錄製失敗:', err instanceof Error ? err.message : err)
  process.exit(1)
})

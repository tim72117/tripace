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
// - Chromium 的 screencast 只能輸出 WebM,FB 廣告管理員偏好 MP4——錄完
//   後自動呼叫 ffmpeg 轉檔(需要系統已安裝 ffmpeg,見下方 ensureFfmpeg
//   的檢查與安裝提示)。
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
// 輸出:web/scripts/record/output/ai-plan-<ratio>-<pace>.mp4(與對應的
// .webm 原始檔一併保留,轉檔失敗時至少還有可用素材)。

import { chromium } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
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

// ensureFfmpeg——執行前先確認系統裝了 ffmpeg,給出明確的安裝指引而不是
// 讓它在錄完 WebM 之後才失敗(錄製本身要花二三十秒,早一點失敗省時間)。
async function ensureFfmpeg(): Promise<void> {
  try {
    await execFileAsync('ffmpeg', ['-version'])
  } catch {
    throw new Error(
      '找不到 ffmpeg(WebM→MP4 轉檔需要)。請先安裝:\n' +
        '  winget install ffmpeg\n' +
        '安裝後重開一個終端機視窗(讓 PATH 生效)再重跑這支腳本。',
    )
  }
}

async function recordOneRatio(ratio: AspectKey, pace: PaceKey): Promise<void> {
  const { width, height } = ASPECT_PRESETS[ratio]
  const safeRatioName = `${ratio.replace(":", "x")}-${pace}`

  console.log(`\n=== 錄製 ${ratio}(${width}×${height})/ ${pace} ===`)

  const browser = await chromium.launch()
  // viewport 直接等於目標輸出解析度——錄製頁(RecordAiPlanPage.tsx)的
  // .canvasOuter 用 aspect-ratio + max-width/max-height 自動撐滿可用
  // 視窗,只要視窗本身就是正確比例,畫面會自動填滿,不需要額外計算裁切
  // 區域。
  const context = await browser.newContext({
    viewport: { width, height },
    recordVideo: { dir: OUTPUT_DIR, size: { width, height } },
  })
  const page = await context.newPage()

  await page.goto(
    `${BASE_URL}/record/ai-plan?ratio=${encodeURIComponent(ratio)}&pace=${encodeURIComponent(pace)}`,
    { waitUntil: 'networkidle' },
  )

  // 等 iframe 內的展示頁把真實景點照片都載入完成一次,理由見
  // RecordAiPlanPage.tsx 檔頭「照片載入」的說明——避免錄到縮圖空白。
  // 這裡用簡單的固定等待,不是精確訊號:照片載入沒有像
  // data-plan-sim-done 那樣的完成屬性,且發生在頁面掛載當下、不影響
  // 後續計時起點(真正計時從下面 waitForFunction 的輪詢開始)。
  await page.waitForTimeout(1500)

  console.log('等待劇本播放完成(輪詢 data-plan-sim-done)…')
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

  await context.close()
  await browser.close()

  // Playwright 把影片檔存成雜湊檔名(例如 <uuid>.webm),錄製當下無法
  // 預先指定檔名——context 關閉後才拿得到實際路徑,故錄完再手動搬移/
  // 重新命名成好辨識的檔名。
  const video = await page.video()
  if (!video) throw new Error('Playwright 沒有產生影片檔(recordVideo 設定可能未生效)')
  const webmPath = await video.path()
  const finalWebmPath = path.join(OUTPUT_DIR, `ai-plan-${safeRatioName}.webm`)
  renameSync(webmPath, finalWebmPath)
  console.log(`WebM 已輸出:${finalWebmPath}`)

  const mp4Path = path.join(OUTPUT_DIR, `ai-plan-${safeRatioName}.mp4`)
  console.log('轉檔為 MP4…')
  // -crf 18:視覺上接近無損,檔案大小仍可接受,優先畫質而非壓縮率——
  // 這是最終要投放的廣告素材,不是暫存用的壓縮檔。-pix_fmt yuv420p:
  // 確保輸出的色彩格式被各平台(含 Facebook)廣泛支援,避免播放異常。
  await execFileAsync('ffmpeg', [
    '-y',
    '-i', finalWebmPath,
    '-c:v', 'libx264',
    '-crf', '18',
    '-preset', 'slow',
    '-pix_fmt', 'yuv420p',
    mp4Path,
  ])
  console.log(`MP4 已輸出:${mp4Path}`)
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

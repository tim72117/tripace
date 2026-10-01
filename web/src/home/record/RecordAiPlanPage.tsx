import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import styles from './RecordAiPlanPage.module.css'

// RecordAiPlanPage — 錄製 /ai-plan 展示動畫用的專屬頁面,不是給一般使用者
// 看的正式頁面。把 /ai-plan 的真實內容(對話輸入框+逐步生成的行程時間軸)
// 裝進一個手機造型外框裡,畫面背景留白,方便直接對這個瀏覽器分頁做螢幕
// 錄製,輸出的素材看起來像「畫面裡有一支手機正在播放 App」,不需要後製
// 另外合成手機外框。
//
// 用 <iframe src="/ai-plan"> 而不是直接 import <AIPlanTimelinePage />
// 渲染——原因:
// 1. AIPlanTimelinePage.tsx 的 .page 用 height: 100dvh(相對瀏覽器
//    viewport),若直接內嵌渲染,它會把「整個瀏覽器視窗高度」當作自己的
//    高度撐滿,不會乖乖縮進手機外框這個固定尺寸的容器——iframe 有自己
//    獨立的 viewport,100dvh 算的是 iframe 本身的尺寸,外框要多大就是
//    多大,不需要去改動或 fork 一份 AIPlanTimelinePage 的樣式。
// 2. 完全零侵入——/ai-plan 展示頁之後若有任何改版(腳本內容、視覺調整),
//    這個錄製頁面自動跟著更新,不需要同步維護兩份。
// 3. iframe 內部仍是完整可互動的真實頁面,錄製時可以直接在畫面裡點擊
//    輸入框/送出鈕觸發腳本,不需要額外寫一套「遙控」機制。
//
// 自動化錄製配合點(給之後的腳本化錄製工具用,這個元件本身不依賴它們):
// - /ai-plan 展示頁的劇本是自動播放的,載入後不需要任何點擊就會自己開始
//   播(見 AIPlanTimelinePage.tsx 的打字動畫/usePlanSimSocket),適合純
//   無人值守的自動化腳本直接「開頁等它播完」,不需要模擬使用者互動。
// - iframe src 帶 ?recordMode=1——劇本原本每一步之間是 900~1500ms 隨機
//   延遲(對一般展示是好設計,看起來像真的在思考),但這會讓同一段動畫
//   每次錄出來總長度/節奏都不同,無法重拍、無法跟配樂或字卡剪輯對齊
//   時間點。這個參數讓 planSimFakeSource.ts 改用固定 1100ms 延遲(見
//   該檔案 RECORD_DELAY_MS 的完整說明),錄幾次都是同一個節奏,方便
//   挑選/重錄特定片段。
// - 劇本播放結束時,AIPlanTimelinePage.tsx 會在 <body> 掛上
//   data-plan-sim-done="true"(見該檔案 composerCollapsed 的完整說明)
//   ——外部自動化腳本(例如 Playwright)可以直接輪詢偵測這個 iframe 內部
//   document.body 的屬性值,精確等到腳本真的播完才停止錄製,不需要用
//   「固定睡幾秒」這種容易跟實際播放時長(腳本內容調整後可能變長/變短)
//   脫節的做法。
// - 畫質考量:這個頁面的手機外框尺寸(PHONE_WIDTH/PHONE_HEIGHT × 各比例
//   的 scale)只是「瀏覽器裡顯示多大」,不是最終輸出影片的真實像素
//   解析度——若用螢幕錄製工具直接錄這個瀏覽器分頁,實際畫質取決於系統
//   顯示縮放比例與螢幕 DPI,容易因為縮放/裁切而模糊。若改用 Playwright
//   等工具自動化錄製,建議直接把瀏覽器視窗(viewport)設成等於目標輸出
//   解析度(例如 1080×1920),不要開一個小視窗再放大裁切——原生 1:1
//   像素對應的錄製結果畫質最穩定,不會有縮放模糊或系統效能波動造成的
//   額外失真。
//
// ASPECT_RATIOS——提供幾種常見的廣告影片比例讓人錄製前先選,對應
// Facebook 動態消息(1:1 或 4:5)、限時動態/Reels(9:16)。尺寸刻意抓
// 1080 基準(乘以比例算出另一邊),錄製時瀏覽器視窗/分頁只要整個框住
// .frameOuter 范圍即可,不需要使用者自己換算像素。
const ASPECT_RATIOS = [
  { key: '1:1', label: '1:1 方形(動態消息)', width: 1080, height: 1080 },
  { key: '4:5', label: '4:5 直式(動態消息加大版)', width: 1080, height: 1350 },
  { key: '9:16', label: '9:16 全螢幕(限時動態/Reels)', width: 1080, height: 1920 },
] as const

type AspectKey = (typeof ASPECT_RATIOS)[number]['key']

// PACE_PRESETS——對應廣告企劃(2026-10 Fable 模型規劃)的兩個版本:30 秒
// 原速主版用展示頁預設的 90ms/字打字速度、不額外定格;15 秒剪輯版企劃
// 明確建議「60ms/字,不要用後製變速,變速會讓送出鈕的樣式切換也被加速,
// 看起來閃爍」,故把這個差異做成頁面載入當下就決定好的參數,而非事後
// 剪輯調整。typeSpeedMs/startDelayMs 對應 AIPlanTimelinePage.tsx 讀取
// 的同名 URL 參數(見該檔案打字動畫 effect 的完整說明)。
const PACE_PRESETS = {
  normal: { label: '原速(30 秒主版)', typeSpeedMs: 90, startDelayMs: 800 },
  fast: { label: '加速(15 秒剪輯版打字速度)', typeSpeedMs: 60, startDelayMs: 400 },
} as const

type PaceKey = keyof typeof PACE_PRESETS

function isPaceKey(v: string | null): v is PaceKey {
  return v != null && (Object.keys(PACE_PRESETS) as string[]).includes(v)
}

// PHONE_WIDTH/PHONE_HEIGHT——手機外框本身的固定尺寸(對齊 iPhone 14/15
// 的邏輯解析度比例,390:844 ≈ 0.4621),不隨 ASPECT_RATIOS 切換而改變
// ——外框尺寸代表「手機看起來多大」,跟外層背景畫布的比例是兩件獨立的事
// (例如 9:16 全螢幕版面,手機可以置中並稍微放大;1:1 方形版面,手機維持
// 原尺寸置中,四周留白)。BACKGROUND_SCALE_BY_ASPECT 讓每種比例各自決定
// 手機要縮放多少才能在對應畫布裡呈現恰當的留白比例,純粹是視覺微調,
// 數值由預覽調整,不是嚴謹算出來的。
// 2026-10(Fable 模型評估):'1:1' 原本是 0.92,精算後手機頂緣距畫布
// 頂端只有 151.8px,字卡(.caption)若換成兩行文字,底部會壓到
// 137~187px 這段,直接蓋住手機外框頂緣與動態島,是真實的遮擋風險。
// 降到 0.88 讓手機頂緣後退到約 168px,配合 .caption 改用 bottom 錨定
// (見下方 --phone-h 的說明)留出的固定間距,兩行文字也不會貼到手機。
const PHONE_WIDTH = 390
const PHONE_HEIGHT = 844
const BACKGROUND_SCALE_BY_ASPECT: Record<AspectKey, number> = {
  '1:1': 0.88,
  '4:5': 1.05,
  '9:16': 1.28,
}

// isAspectKey——執行期驗證網址 ?ratio= 參數是否為合法值,理由同專案裡
// isPanelMode 等既有慣例(見 DesktopShared.tsx):URL 參數是外部輸入,
// 不能直接斷言成 AspectKey 使用。
function isAspectKey(v: string | null): v is AspectKey {
  return v != null && (Object.keys(BACKGROUND_SCALE_BY_ASPECT) as string[]).includes(v)
}

// CAPTIONS——疊在手機外框外側(背景留白區)的字卡,時間點對照廣告企劃
// (2026-10 Fable 模型規劃)的分鏡表,並依目前的混合節奏實際校正過:
// 開場前兩步用 RECORD_HOOK_DELAY_MS(500ms,見 planSimFakeSource.ts)
// 加速,之後回到 RECORD_DELAY_MS(1100ms)的正常節奏,故字卡時間點不是
// 原企劃算出的秒數照搬,而是跟著這個「開頭快、中段穩」的實際節奏重新
// 對點。只有 normal(30 秒主版)節奏有完整字卡時間表——fast(15 秒
// 剪輯版)字卡改用精簡版(見下方 useCaption 的完整說明),兩者各自的
// 陣列分開維護,不共用同一份再做條件判斷,避免其中一版改了秒數卻忘記
// 同步另一版。
//
// text 刻意簡短(多半 4-10 字),活潑的進場動畫本身已經有足夠的視覺
// 吸引力,字卡不需要再靠長句子撐場面——FB 使用者滑動很快,一次只讀得完
//一句短話。
interface Caption {
  atMs: number
  text: string
  // isCta——標記結尾 CTA 字卡(2026-10 Fable 模型評估建議):反轉配色
  // (米白底+硃砂字,見 .module.css .captionCta)讓結尾的視覺語氣跟前面
  // 的敘事字卡明顯不同,觀眾會注意到「這句不一樣」,呼應它是整支影片
  // 唯一真正要求觀眾行動的一句。
  isCta?: boolean
}

const CAPTIONS_NORMAL: Caption[] = [
  { atMs: 0, text: '旅行計畫，一句話就好 ✨' },
  { atMs: 3200, text: 'AI 先想，再排 🧠' },
  { atMs: 5200, text: '連交通時間都幫你算好 🚶' },
  { atMs: 9500, text: '吃的、喝的、要排隊的，都有提醒 🍜' },
  { atMs: 14500, text: 'Day 1 排好了 ✅' },
  { atMs: 16500, text: '第二天也一起排，天氣都考慮進去 ☀️' },
  { atMs: 21500, text: '週一店休？它會自己改路線 🔀' },
  { atMs: 26000, text: '兩天 14 站，30 秒排完 🎉' },
  { atMs: 28500, text: '免費試試 AI 編排行程 →', isCta: true },
]

const CAPTIONS_FAST: Caption[] = [
  { atMs: 0, text: '旅行計畫，一句話就好 ✨' },
  { atMs: 3000, text: '景點、交通、提醒，一次排好 🧠' },
  { atMs: 9000, text: 'Day 2 也一起 ☀️' },
  { atMs: 12500, text: '兩天 14 站，一句話搞定 🎉' },
  { atMs: 13500, text: '免費試試 AI 編排行程 →', isCta: true },
]

// useCaption——依目前播放經過的毫秒數,找出「應該顯示的那一張字卡」
// (陣列裡 atMs 小於等於目前經過時間、且時間最接近的一筆),不是逐一
// setTimeout 排程——這樣切換 pace 或重新整理時,直接重算一次就能得到
// 正確的當前字卡,不需要清理一堆散落的計時器。用單一 1 秒間隔的
// setInterval 更新「已經過的毫秒數」,字卡本身的切換時機由這個
// elapsed 值 derive 出來,不是各自獨立的計時器。回傳完整 Caption 物件
// (不只是文字字串)讓呼叫端能讀 isCta 決定配色。
function useCaption(pace: PaceKey): Caption | null {
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    setElapsedMs(0)
    const startedAt = Date.now()
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - startedAt)
    }, 200)
    return () => clearInterval(timer)
  }, [pace])

  const captions = pace === 'fast' ? CAPTIONS_FAST : CAPTIONS_NORMAL
  let current: Caption | null = null
  for (const c of captions) {
    if (c.atMs <= elapsedMs) current = c
  }
  return current
}

export function RecordAiPlanPage() {
  // ?ratio=——讓 scripts/record/record-ai-plan.ts 這類自動化腳本能直接
  // 指定比例開啟頁面,不需要像人工操作那樣先載入再點擊切換按鈕(見該
  // 腳本 page.goto 呼叫處的說明)。只在「網址帶合法值」時覆寫預設,其餘
  // 情況(沒帶/帶錯字串)都維持原本的 useState 初始值與手動切換行為,
  // 不影響一般人工操作這個頁面時的使用方式。
  const [searchParams] = useSearchParams()
  const ratioFromURL = searchParams.get('ratio')
  const [aspect, setAspect] = useState<AspectKey>(isAspectKey(ratioFromURL) ? ratioFromURL : '9:16')
  // bgColor——錄製畫布背景色。使用者明確要求「整體用亮色系」,預設改成
  // home/ 行銷頁語言的 --paper 米白(#F7F3EC,見 ProductPage.css 等既有
  // 定義),呼應 Fable 模型廣告企劃對背景的建議(紙感暖色、非飽和漸層)。
  // 開放切換是因為實際剪輯時可能想换成品牌色或其他測試效果,不想每次
  // 都要改程式碼。
  const [bgColor, setBgColor] = useState('#F7F3EC')
  // pace——?pace= 同理可被自動化腳本直接指定(見 ASPECT_RATIOS 的
  // isAspectKey 說明,同一套模式)。
  const paceFromURL = searchParams.get('pace')
  const [pace, setPace] = useState<PaceKey>(isPaceKey(paceFromURL) ? paceFromURL : 'normal')

  const activeRatio = ASPECT_RATIOS.find((r) => r.key === aspect) ?? ASPECT_RATIOS[0]
  const canvasAspectRatio = `${activeRatio.width} / ${activeRatio.height}`
  // canvasRatioNumber——寬高比的純數字(width/height),給 CSS 的
  // height: min(..., calc(... / var(--canvas-ratio))) 做反推運算用
  // (見 RecordAiPlanPage.module.css .canvasOuter 的完整說明)。CSS 原生
  // 的 aspect-ratio 屬性只接受 "1080 / 1080" 這種字串語法,無法直接
  // 拿來除某個 calc() 值,故另外算一個數字版本透過 CSS 自訂屬性傳入。
  const canvasRatioNumber = activeRatio.width / activeRatio.height
  const phoneScale = BACKGROUND_SCALE_BY_ASPECT[aspect]
  const activePace = PACE_PRESETS[pace]
  const caption = useCaption(pace)

  return (
    <div className={styles.page}>
      {/* 控制列——這排按鈕本身不會出現在最終錄製素材裡,只要錄製時把
          螢幕錄製工具的擷取範圍框在 .canvasOuter 內部(不含這排控制列)
          即可。放在頁面最上方而非浮動疊層,理由是這個頁面唯一的使用者
          就是「準備要錄影的人自己」,不需要漂亮的隱藏/淡出設計,直接
          露出最省事。 */}
      <div className={styles.controls}>
        <span className={styles.controlsLabel}>錄製比例</span>
        {ASPECT_RATIOS.map((r) => (
          <button
            key={r.key}
            type="button"
            className={r.key === aspect ? `${styles.ratioBtn} ${styles.ratioBtnActive}` : styles.ratioBtn}
            onClick={() => setAspect(r.key)}
          >
            {r.label}
          </button>
        ))}
        <span className={styles.controlsDivider} />
        <span className={styles.controlsLabel}>節奏</span>
        {(Object.keys(PACE_PRESETS) as PaceKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className={key === pace ? `${styles.ratioBtn} ${styles.ratioBtnActive}` : styles.ratioBtn}
            onClick={() => setPace(key)}
          >
            {PACE_PRESETS[key].label}
          </button>
        ))}
        <span className={styles.controlsDivider} />
        <span className={styles.controlsLabel}>背景色</span>
        <input
          type="color"
          value={bgColor}
          onChange={(e) => setBgColor(e.target.value)}
          className={styles.colorPicker}
        />
        <span className={styles.controlsHint}>
          螢幕錄製工具的擷取範圍請框住下方畫布(不含這排控制列)
        </span>
      </div>

      {/* canvasWrap——吃掉扣除控制列後的剩餘空間,讓 .canvasOuter 能用
          100% 取得準確的可用高度(見 RecordAiPlanPage.module.css 的
          完整說明)。 */}
      <div className={styles.canvasWrap}>
        {/* canvasOuter——實際要被錄進去的範圍,aspect-ratio 固定成目前選
            的比例,手機外框在裡面置中。背景用 inline style 讀 bgColor
            (使用者可即時調整),不走 CSS Module 固定值。 */}
        <div
          className={styles.canvasOuter}
          style={{
            aspectRatio: canvasAspectRatio,
            background: bgColor,
            ['--canvas-ratio' as string]: canvasRatioNumber,
            // --phone-h:手機外框的實際像素高度,給 .caption 的
            // bottom: calc(50% + var(--phone-h) / 2 + 間距) 算出「離
            // 手機頂緣固定距離」用(見 2026-10 Fable 模型評估的完整
            // 說明)——手機在 .canvasOuter 裡永遠置中,頂緣位置等於
            // 「畫布中心往上半個手機高度」,用這個算式取代原本寫死的
            // top: 6%(跟手機實際位置完全無關,比例切換/手機縮放改變時
            // 字卡與手機的間距會跟著不一致)。
            ['--phone-h' as string]: `${PHONE_HEIGHT * phoneScale}px`,
          }}
        >
          {/* caption——疊在手機外框外側(背景留白區頂部)的字卡,見
              useCaption 的完整說明(時間點對齊廣告企劃分鏡、依實際混合
              節奏校正過)。key={caption.text} 讓每次文字切換時重新掛載,
              觸發 CSS 的進場動畫重播(見 .module.css .caption 的完整
              說明——使用者明確要求「活潑一點」,每張字卡換上都要有彈跳
              進場感,不是淡入淡出這種文靜效果)。結尾 CTA 字卡
              (caption.isCta)疊加 .captionCta 反轉配色(見該 class 的
              完整說明)。caption 為 null 時(劇本還沒開始播放前的極短暫
              瞬間)不渲染任何東西。 */}
          {caption && (
            <div
              key={caption.text}
              className={caption.isCta ? `${styles.caption} ${styles.captionCta}` : styles.caption}
            >
              {caption.text}
            </div>
          )}
          <div
            className={styles.phoneFrame}
            style={{
              width: PHONE_WIDTH * phoneScale,
              height: PHONE_HEIGHT * phoneScale,
            }}
          >
            {/* 側邊按鈕裝飾——純視覺,對照使用者提供的參考圖補上(真實
                iPhone 的音量鍵+電源鍵凸起),強化「這是一支實體手機」的
                第一眼辨識度。 */}
            <div className={styles.phoneButtonVolumeUp} />
            <div className={styles.phoneButtonVolumeDown} />
            <div className={styles.phoneButtonPower} />
            {/* phoneBezel——邊框內緣的窄黑邊,讓螢幕(iframe)不直接貼著
                金屬色外框,視覺上更接近真機的「螢幕鑲嵌在殼裡」。 */}
            <div className={styles.phoneBezel}>
              {/* 動態島裝飾——懸浮在螢幕頂端內側,不影響 iframe 內容本身。 */}
              <div className={styles.phoneNotch} />
              {/* key 包含 aspect 與 pace——切換比例或節奏時 iframe 內容
                  需要重新載入:比例切換是因為內部響應式版面卡在舊的量測
                  結果(resize 事件在某些瀏覽器下對 iframe 內部不會可靠
                  觸發);節奏切換是因為打字速度/定格秒數只在
                  AIPlanTimelinePage.tsx 掛載當下讀一次 URL 參數(見該
                  檔案打字動畫 effect 的完整說明),不是即時響應的
                  state。重新整理代表每次切換都要重新手動觸發一次腳本,
                  這是刻意的取捨,換取參數永遠正確套用。 */}
              <iframe
                key={`${aspect}-${pace}`}
                className={styles.phoneScreen}
                src={`/ai-plan?recordMode=1&typeSpeedMs=${activePace.typeSpeedMs}&startDelayMs=${activePace.startDelayMs}`}
                title="AI 編排行程展示（錄製用）"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

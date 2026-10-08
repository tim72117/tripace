import { useEffect, useRef, useState } from 'react'
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
// 2026-10(使用者實測回報):'9:16' 原本是 1.28,算出來的手機外框只有
// 499×1080px,寬度只佔畫布(1080px)約 46%、高度只佔畫布(1920px)約
// 56%,上下左右留白過多——FB/IG Reels 廣告素材的慣例是手機主體盡量
// 撐滿版面,當時調高到 2.08(手機寬度佔畫布約 75%、高度約 1755px,
// 上下各只留 82px)。
// 2026-10 第二次修正(Reels 安全區校對):2.08 這個數字只考慮「不超出
// 畫布」,沒考慮 Reels 播放介面本身會疊在影片上的 UI——依真實截圖量測
// (見 .module.css .reelsSafeZoneTop/-Bottom 的完整說明),畫布頂部 13%
// (約 250px)與底部 16%(約 307px)會被平台的帳號名/文案/音樂標籤蓋
// 住,而 2.08 的手機頂緣在 82px、底緣在 1838px,上下各有約 170px 的
// App 畫面(動態島、第一張卡片、底部輸入框)實際上會被平台 UI 遮掉,
// 觀眾在 Reels 上根本看不到。故 '9:16' 不再手調數字,改由下方
// REELS_SAFE_* 常數算出:手機必須完整落在畫布 13%~84% 這段可視區,
// 且垂直置中對齊「可視區中心」而不是整個畫布中心(見
// PHONE_OFFSET_Y_BY_ASPECT)。1:1/4:5 是動態消息版位,沒有同一套平台
// UI 遮擋規則,維持原本的手調數值不變。
const PHONE_WIDTH = 390
const PHONE_HEIGHT = 844

// REELS_SAFE_TOP_RATIO/REELS_SAFE_BOTTOM_RATIO——Reels 頂部/底部安全區
// 佔畫布高度的比例,必須跟 .module.css 的 .reelsSafeZoneTop height:13%
// 與 .reelsSafeZoneBottom height:16% 一致(CSS 那邊是視覺預覽層,這裡
// 是版面計算,同一組量測值兩邊各用一份——CSS 自訂屬性無法反過來餵給
// JS 的 scale 計算,故接受這個刻意的重複,改數字時兩邊要一起改)。
// REELS_PHONE_EDGE_MARGIN_PX——手機外框跟安全區邊界之間額外保留的
// 緩衝(畫布像素),吃掉 .phoneFrame 的 1px 外描邊 box-shadow、側邊
// 按鈕凸出的 3px 經 scale 放大後的量,以及百分比換算的小數誤差,
// 避免「理論上剛好貼齊、實際渲染多出 1~2px 壓線」。
const REELS_SAFE_TOP_RATIO = 0.13
const REELS_SAFE_BOTTOM_RATIO = 0.16
const REELS_PHONE_EDGE_MARGIN_PX = 6

// computeReelsPhoneFit——9:16 畫布下,手機要縮放多少、垂直要往哪個方向
// 偏移多少,才能完整落在 Reels 安全區之外。計算方式(1080×1920 畫布):
//   可視區高度 = 1920 × (1 − 0.13 − 0.16) = 1363.2px
//   可用高度   = 1363.2 − 6×2 = 1351.2px
//   scale      = 1351.2 / 844 ≈ 1.601(取到小數第三位、無條件捨去,
//                保證不會因四捨五入反而多出來)
//   手機尺寸   = 390×1.601 ≈ 624px 寬(佔畫布寬 57.8%)、
//                844×1.601 ≈ 1351px 高
//   可視區中心 = 1920 × (0.13 + (1 − 0.13 − 0.16) / 2) = 931.2px
//   offsetY    = 931.2 − 960 = −28.8px(手機中心比畫布中心往上 28.8px,
//                因為頂部安全區 13% 比底部 16% 小,可視區不是上下對稱)
//   最終手機頂緣 ≈ 931.2 − 675.6 ≈ 255.6px(> 249.6px 頂部安全區下緣)、
//   底緣 ≈ 1606.8px(< 1612.8px 底部安全區上緣)、右緣 ≈ 852px(< 969.8px
//   右側互動欄左緣,且互動欄只從 61% 高度開始,手機整段都在它左側)。
// 寬度不是限制因素(手機 9:16 比畫布 9:16 更修長,高度先頂到),所以
// 不需要另外算水平方向。
function computeReelsPhoneFit(canvasHeight: number): { scale: number; offsetY: number } {
  const safeRatio = 1 - REELS_SAFE_TOP_RATIO - REELS_SAFE_BOTTOM_RATIO
  const usableHeight = canvasHeight * safeRatio - REELS_PHONE_EDGE_MARGIN_PX * 2
  const scale = Math.floor((usableHeight / PHONE_HEIGHT) * 1000) / 1000
  const safeCenterY = canvasHeight * (REELS_SAFE_TOP_RATIO + safeRatio / 2)
  const offsetY = safeCenterY - canvasHeight / 2
  return { scale, offsetY }
}

const REELS_PHONE_FIT = computeReelsPhoneFit(ASPECT_RATIOS[2].height)

const BACKGROUND_SCALE_BY_ASPECT: Record<AspectKey, number> = {
  '1:1': 0.88,
  '4:5': 1.05,
  '9:16': REELS_PHONE_FIT.scale,
}

// PHONE_OFFSET_Y_BY_ASPECT——手機中心相對畫布中心的垂直偏移(畫布像素,
// 負值往上)。只有 9:16 需要偏移(見 computeReelsPhoneFit 的完整說明),
// 1:1/4:5 維持純置中。套用在 .phoneFrame 的 transform 裡、寫在 scale()
// 前面——CSS transform 函式從左到右依序套用時,translate 的像素值是以
// 父層(.scaleWrap,1080 基準)座標計算,不會被後面的 scale() 放大,
// 這裡算出來的畫布像素可以直接填入,不需要再除以 phoneScale。
const PHONE_OFFSET_Y_BY_ASPECT: Record<AspectKey, number> = {
  '1:1': 0,
  '4:5': 0,
  '9:16': REELS_PHONE_FIT.offsetY,
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
//
// Edge/anchor——2026-10 委託 Fable 模型研究「手機展示型廣告字卡排版
// 慣例」後的正式設計(先前兩輪嘗試:固定貼頂端置中、四角落疊外框外側
// 留白、四邊疊螢幕內邊緣輪流,分別撞到「字太小」「太邊邊」「裁切看
// 不見」「跟 Reels 平台 UI 安全區衝突」等問題,完整歷程見下方與
// .module.css 的記錄)。Fable 報告的核心結論:
// - 直式畫面下「左緣/右緣」辨識度低(中文字卡寬度遠大於可視寬度一半,
//   貼左貼右視覺上看不太出差異),且右側會撞上 Reels 互動直欄(讚/
//   留言/分享,約佔畫布右側 120px)。四邊輪流的「找字成本」也會累積
//   成觀眾的閱讀疲勞。
// - 真實廣告素材幾乎都只用「上緣(敘事)+下緣(CTA)」兩個固定錨點,
//   活潑感改由傾斜角度/配色/進場方向交替提供,不是靠換位置。
// - Reels/FB 平台 UI 安全區:頂部約 220px(狀態列+標題列)、底部約
//   420px(帳號名/文案/音樂/CTA 按鈕)、右側約 120px(互動直欄)在
//   1080 寬畫布上會被平台介面蓋住,字卡必須避開。
// 故改成只有 top/bottom 兩種 anchor,不再有 left/right;isCta 固定
// anchor 是 bottom(CTA 本來就該固定在下緣,不納入循環)。
type Anchor = 'top' | 'bottom'
const CTA_ANCHOR: Anchor = 'bottom'

// Colorway——使用者明確要求「可以混合不同顏色」,敘事字卡不再全部
// 同一個底色,改成三種同屬品牌紅色調性、但彩度/明度有層次差異的
// 實色塊依序輪替(見 .module.css .caption-colorway-1/-2/-3 的完整
// 說明)。固定依陣列順序循環(1→2→3→1…),不是隨機——固定循環讓
// 每輪錄製的配色節奏一致,方便重錄/剪輯時對照。CTA 字卡不納入這個
// 循環,維持自己獨立的反轉配色(.captionCta)。
type Colorway = 1 | 2 | 3
const COLORWAY_CYCLE: Colorway[] = [1, 2, 3]

// triggerStopId——使用者明確要求「可以使用推論的信號觸發字卡，編排
// 一下時機」。原本用字卡自己的 setInterval 對照寫死的 atMs(毫秒數)
// 猜「劇本大概播到第幾秒該出現什麼內容」——這只是兩條完全獨立時間軸
// 的巧合對齊,劇本內容/節奏(planSimScript.ts 的站點順序、
// planSimFakeSource.ts 的延遲時間)一旦調整,字卡時間點就會跟著跑掉,
// 需要手動重新校正,且完全無法保證對得準。改成每張字卡綁定劇本裡
// 「某個真實 stop 被加入」這個推論信號(AIPlanTimelinePage.tsx 透過
// postMessage 廣播的 stop id,見該檔案「推論信號廣播」區塊的完整
// 說明)——劇本順序本身改變時,只要同步調整這裡綁定的 stop id,不需要
// 重新量測任何毫秒數。triggerStopId 為 null 的那一筆代表「一開場就
// 顯示」,不等待任何推論信號。stop id 對照 planSimScript.ts 目前的
// 完整順序(Day 1:赤崁樓→大天后宮→武廟愛玉→鳳凰卷→祀典武廟→
// 冬瓜茶→午餐→神農街;Day 2:孔廟→孔廟商圈→文學館→消防史料館→
// 林百貨→晚餐)。
type TriggerStopId = string | null

interface Caption {
  triggerStopId: TriggerStopId
  text: string
  // anchor——這張字卡貼著手機螢幕的上緣或下緣(見上方 Fable 模型
  // 報告摘要)。敘事字卡預設都在 top,只有畫面當下頂部剛好有關鍵內容
  // 時才讓該句借用 bottom(例如「Day 1 排好了」這句,畫面頂部這時
  // 正顯示前一天最後一張卡片,借 bottom 可避免文字跟內容打架,同時
  // 也提前讓觀眾習慣 bottom 這個位置,CTA 出現時不會顯得突兀)。
  anchor: Anchor
  // colorway——這張字卡的底色輪替(見 COLORWAY_CYCLE 的完整說明)。
  // CTA 字卡(isCta)不使用這個欄位,固定走 .captionCta 的獨立配色。
  colorway: Colorway
  // isCta——標記結尾 CTA 字卡(2026-10 Fable 模型評估建議):反轉配色
  // 讓結尾的視覺語氣跟前面的敘事字卡明顯不同,觀眾會注意到「這句不
  // 一樣」,呼應它是整支影片唯一真正要求觀眾行動的一句。這句不綁 stop
  // id,靠 isGenerating 從 true 翻成 false(劇本真正播完,同
  // AIPlanTimelinePage.tsx composerCollapsed 判斷下降邊的既有邏輯)
  // 觸發,理由同樣是用真實推論信號,而不是再猜一個毫秒數或 stop id。
  isCta?: boolean
}

// 文案長度——Fable 模型報告指出先前兩句原本 13-15 字過長,兩行會佔用
// 過多螢幕高度,已縮短到 10 字以內,維持一行或最多工整兩行。normal/
// fast 兩種節奏共用同一份劇本對照表(不像先前 atMs 版本要各自維護
// 一份時間表)——觸發信號是劇本內容本身的真實事件,不是播放節奏,
// normal/fast 只差打字/定格速度,不影響劇本站點順序,故共用同一份
// CAPTIONS,不需要為每種節奏分別維護對照表。
const CAPTIONS: Caption[] = [
  { triggerStopId: null, text: '旅行計畫，一句話就好 ✨', anchor: 'top', colorway: COLORWAY_CYCLE[0] },
  { triggerStopId: 'stop-chikanlou', text: 'AI 先想，再排 🧠', anchor: 'top', colorway: COLORWAY_CYCLE[1] },
  { triggerStopId: 'stop-wumiao', text: '連交通時間都幫你算好 🚶', anchor: 'top', colorway: COLORWAY_CYCLE[2] },
  { triggerStopId: 'stop-lunch', text: '吃喝排隊，都幫你提醒 🍜', anchor: 'top', colorway: COLORWAY_CYCLE[0] },
  { triggerStopId: 'stop-shennong', text: 'Day 1 排好了 ✅', anchor: 'bottom', colorway: COLORWAY_CYCLE[1] },
  { triggerStopId: 'stop-confucius-temple', text: 'Day 2 連天氣都算好 ☀️', anchor: 'top', colorway: COLORWAY_CYCLE[2] },
  { triggerStopId: 'stop-evening', text: '週一店休？它會自己改路線 🔀', anchor: 'top', colorway: COLORWAY_CYCLE[0] },
  { triggerStopId: 'stop-dinner', text: '兩天 14 站，30 秒排完 🎉', anchor: 'top', colorway: COLORWAY_CYCLE[1] },
]

const CAPTION_CTA: Caption = {
  triggerStopId: null,
  text: '免費試試 AI 編排行程 →',
  anchor: CTA_ANCHOR,
  colorway: COLORWAY_CYCLE[0],
  isCta: true,
}

// useCaption——監聽 iframe(AIPlanTimelinePage.tsx)透過 postMessage
// 廣播的推論信號,依「目前已經觸發過的 stop id 集合」找出 CAPTIONS
// 裡最後一筆「triggerStopId 已經出現過」的字卡——跟原本依毫秒數找
// 「atMs 小於等於目前經過時間」的邏輯是同一種「找最後一個已滿足條件
// 的項目」寫法,只是判斷條件從時間換成真實事件集合。isGenerating 從
// true 翻成 false(劇本真正播完)時直接切到 CAPTION_CTA,不需要等待
// 任何 stop id——這是比任何 stop id 都更明確的「劇本結束」信號。
function useCaption(): Caption | null {
  const [triggeredIds, setTriggeredIds] = useState<Set<string>>(() => new Set())
  const [done, setDone] = useState(false)

  useEffect(() => {
    setTriggeredIds(new Set())
    setDone(false)
    function handleMessage(event: MessageEvent) {
      const data = event.data as { source?: string; type?: string; stopId?: string } | null
      if (!data || data.source !== 'ai-plan-sim') return
      if (data.type === 'stop-added' && data.stopId) {
        setTriggeredIds((prev) => {
          if (prev.has(data.stopId as string)) return prev
          const next = new Set(prev)
          next.add(data.stopId as string)
          return next
        })
      } else if (data.type === 'plan-sim-done') {
        setDone(true)
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  if (done) return CAPTION_CTA

  let current: Caption | null = null
  for (const c of CAPTIONS) {
    if (c.triggerStopId === null || triggeredIds.has(c.triggerStopId)) current = c
  }
  return current
}

// useCanvasScale——量測 .canvasOuter 容器(ref)的實際渲染寬度,除以
// designWidth(排版設計基準,例如 9:16 是 1080px)算出縮放倍率。
// 實際發生過的 bug(2026-10):原本試過讓 .phoneFrame 直接改用「相對於
// .canvasOuter 的百分比」取代寫死的絕對像素寬高,想法是「容器多大,
// 手機就跟著等比例縮」——但 .phoneFrame 本身是 flex 容器裡的子元素,
// 且內部還有 padding(.phoneFrame 本身 3px、.phoneBezel 2px,皆為固定
// 像素)與多個用 % 或固定像素混合定位的裝飾元素(.phoneNotch 的
// top/width、.phoneButtonPower 等側邊按鈕的 top/height),百分比寬高
// 在這些巢狀固定值交互作用下,會讓最終渲染出來的外框變形(實測看到
// 接近圓形的畸變)、內部 iframe 內容跟著跑版,而不是單純等比例縮小。
// 改用 transform: scale() 才是真正安全的「整體縮小」方案:內部所有
// 元素(.phoneFrame/.phoneBezel/.phoneNotch/側邊按鈕/.caption)完全
// 維持原本以 1080px 為基準設計的絕對像素尺寸與定位邏輯不變,只在最外層
// 對整個已經排好版的區塊做一次性縮放,不會觸及任何內部的巢狀計算,
// 不可能因此變形。
function useCanvasScale(containerRef: React.RefObject<HTMLDivElement | null>, designWidth: number): number {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) setScale(width / designWidth)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [containerRef, designWidth])

  return scale
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
  // bgColor——錄製畫布背景色。原本預設是行銷頁語言的 --paper 米白
  // (#F7F3EC),呼應 Fable 模型廣告企劃對背景的建議(紙感暖色、非飽和
  // 漸層);2026-10 使用者實際比對後認為純黑背景視覺效果更好——手機
  // 外框跟字卡的彩度/對比在純黑底下更突出,米白底色反而讓整體畫面偏
  // 平淡。改成純黑 #000000 當預設值。開放切換是因為實際剪輯時可能
  // 想换成品牌色或其他測試效果,不想每次都要改程式碼。
  const [bgColor, setBgColor] = useState('#000000')
  // pace——?pace= 同理可被自動化腳本直接指定(見 ASPECT_RATIOS 的
  // isAspectKey 說明,同一套模式)。
  const paceFromURL = searchParams.get('pace')
  const [pace, setPace] = useState<PaceKey>(isPaceKey(paceFromURL) ? paceFromURL : 'normal')
  // hideControls——實際發生過的真實問題(2026-10):
  // scripts/record/record-ai-plan.ts 把 Playwright 的 viewport 直接設成
  // 目標輸出解析度(例如 1080×1920),原本假設 .canvasOuter 會自動撐滿
  // 整個 viewport——但這個頁面的 .controls(錄製比例/節奏/背景色那排
  // 按鈕)佔掉了頂部一段高度,.canvasOuter 的 height: min(100%, ...)
  // 縮放公式(見 .module.css 的完整說明)拿到的「可用高度」因此被壓縮,
  // 導致 .canvasOuter 自己又整體縮小,viewport 裡除了縮小後的畫布,
  // 還多了控制列跟周圍留白一起被錄進影片——第一次自動化錄製拿到的
  // 成品實際檢查發現控制列整排都入鏡了,不是單純「裁切範圍抓歪」這種
  // 可以後製修正的問題,畫面構圖整個錯了。修法是讓自動化錄製時直接不
  // 渲染 .controls,.canvasWrap 改撐滿整個 .page,.canvasOuter 的
  // height: min(100%, ...) 才會真的算出等於 viewport 高度的畫布,
  // viewport 與畫布兩者尺寸一致,不需要額外裁切或縮放補償。只在網址帶
  // ?hideControls=1 時生效,人工操作這個頁面時仍要看得到控制列,不受
  // 影響。
  const hideControls = searchParams.get('hideControls') === '1'
  // showReelsSafeZone——使用者明確要求「在畫面中模擬真實會出現的文字
  // 區」,方便調整字卡位置(.caption-top/-bottom,見 .module.css 的
  // 完整說明)時直接對照 Reels 實際會疊加 UI 的範圍,不需要每次都另外
  // 截圖、用 Python 疊加模擬圖才能驗證位置——那是一次性的驗證方式,
  // 這裡做成頁面本身的可開關預覽層,之後調整字卡位置時能即時看到
  // 效果。只做視覺預覽,不影響任何版面计算或實際錄製輸出(見下方
  // ReelsSafeZoneOverlay 的完整說明,pointer-events: none 且預設關閉)。
  const [showReelsSafeZone, setShowReelsSafeZone] = useState(false)

  const activeRatio = ASPECT_RATIOS.find((r) => r.key === aspect) ?? ASPECT_RATIOS[0]
  const canvasAspectRatio = `${activeRatio.width} / ${activeRatio.height}`
  // canvasRatioNumber——寬高比的純數字(width/height),給 CSS 的
  // height: min(..., calc(... / var(--canvas-ratio))) 做反推運算用
  // (見 RecordAiPlanPage.module.css .canvasOuter 的完整說明)。CSS 原生
  // 的 aspect-ratio 屬性只接受 "1080 / 1080" 這種字串語法,無法直接
  // 拿來除某個 calc() 值,故另外算一個數字版本透過 CSS 自訂屬性傳入。
  const canvasRatioNumber = activeRatio.width / activeRatio.height
  const phoneScale = BACKGROUND_SCALE_BY_ASPECT[aspect]
  const phoneOffsetY = PHONE_OFFSET_Y_BY_ASPECT[aspect]
  const activePace = PACE_PRESETS[pace]
  const caption = useCaption()

  // canvasOuterRef/canvasScale——見 useCanvasScale 的完整說明:量測
  // .canvasOuter 實際渲染寬度相對於設計基準(activeRatio.width,例如
  // 1080px)的縮放倍率,讓裡面的手機外框+字卡整塊用 transform: scale()
  // 等比例縮小,不改動任何內部元素原本以 1080px 為基準寫死的像素尺寸。
  const canvasOuterRef = useRef<HTMLDivElement | null>(null)
  const canvasScale = useCanvasScale(canvasOuterRef, activeRatio.width)

  return (
    <div className={`${styles.page} ${hideControls ? styles.pageHideControls : ''}`}>
      {/* 控制列——這排按鈕本身不會出現在最終錄製素材裡,人工操作時只要
          把螢幕錄製工具的擷取範圍框在 .canvasOuter 內部(不含這排控制列)
          即可。放在頁面最上方而非浮動疊層,理由是這個頁面唯一的使用者
          就是「準備要錄影的人自己」,不需要漂亮的隱藏/淡出設計,直接
          露出最省事。
          hideControls 時完全不渲染(見上方 hideControls 宣告處的完整
          說明)——自動化錄製(scripts/record/record-ai-plan.ts)把
          Playwright 的 viewport 直接設成目標輸出解析度,若保留這排
          控制列佔掉的高度,.canvasOuter 的縮放公式會把畫布連同控制列
          一起塞進 viewport,導致控制列整排入鏡,這是實際發生過的真實
          構圖錯誤,不是單純「裁切範圍抓歪」可以靠後製救回來的問題。 */}
      {!hideControls && (
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
          <span className={styles.controlsDivider} />
          {/* showReelsSafeZone 開關——見該 state 宣告處的完整說明。 */}
          <button
            type="button"
            className={showReelsSafeZone ? `${styles.ratioBtn} ${styles.ratioBtnActive}` : styles.ratioBtn}
            onClick={() => setShowReelsSafeZone((v) => !v)}
          >
            {showReelsSafeZone ? '隱藏 Reels 安全區預覽' : '顯示 Reels 安全區預覽'}
          </button>
          <span className={styles.controlsHint}>
            螢幕錄製工具的擷取範圍請框住下方畫布(不含這排控制列)
          </span>
        </div>
      )}

      {/* canvasWrap——吃掉扣除控制列(若有渲染)後的剩餘空間,讓
          .canvasOuter 能用 100% 取得準確的可用高度(見
          RecordAiPlanPage.module.css 的完整說明)。hideControls 時
          控制列完全不佔用版面空間(flex 子元素被整個拿掉,不是只是視覺
          隱藏),.canvasWrap 自然撐滿 .page 全部高度。 */}
      <div className={styles.canvasWrap}>
        {/* canvasOuter——實際要被錄進去的範圍,aspect-ratio 固定成目前選
            的比例,手機外框在裡面置中。背景用 inline style 讀 bgColor
            (使用者可即時調整),不走 CSS Module 固定值。 */}
        <div
          ref={canvasOuterRef}
          className={styles.canvasOuter}
          style={{
            aspectRatio: canvasAspectRatio,
            background: bgColor,
            ['--canvas-ratio' as string]: canvasRatioNumber,
          }}
        >
          {/* scaleWrap——見 useCanvasScale 的完整說明:裡面的字卡+手機
              外框全部維持以 1080px(activeRatio.width)為基準的絕對像素
              尺寸與定位,不隨 .canvasOuter 實際渲染大小改變;整塊只用
              transform: scale(canvasScale) 做一次性等比例縮小。
              width/height 寫死成 activeRatio.width/height(設計基準,
              不是 .canvasOuter 的實際渲染尺寸)——scale 是視覺縮放,
              不會改變元素原本佔用的版面空間大小,若不手動對齊,縮小後
              的內容會留在容器左上角一小塊,而不是置中鋪滿;
              transform-origin: top left 搭配置中用的 translate 修正
              (縮放後尺寸變小,需要把左上角往右下平移,補回「視覺置中」
              的偏移量,等同於在 top-left 原點縮放後再置中)。 */}
          <div
            className={styles.scaleWrap}
            style={{
              width: activeRatio.width,
              height: activeRatio.height,
              transform: `scale(${canvasScale})`,
            }}
          >
            <div
              className={styles.phoneFrame}
              style={{
                // width/height 固定用 PHONE_WIDTH/PHONE_HEIGHT(不乘
                // phoneScale)——這是實測發現的真實問題(2026-10):若直接
                // 把 phoneScale 乘進 width/height,.phoneFrame 的 CSS
                // 佈局寬度本身會變大(例如 9:16 的 phoneScale=2.08 時
                // 變成 811px),裡面的 iframe(.phoneScreen)元素寬度跟著
                // 變大,iframe 內部的 AIPlanTimelinePage.tsx 收到的
                // window.innerWidth 真的是 811px 這麼寬(遠超過真實手機
                // 的 390px 左右)——展示頁的響應式排版會把這個寬度當成
                // 平板/桌面尺寸來渲染,留白、字體大小比例全部跟著跑掉
                // (使用者回報「手機內的內容都變小了,旁邊留下很大的
                // 間距」)。
                // 正確做法:iframe 永遠收到跟真實手機一致的 CSS 佈局
                // 寬度(PHONE_WIDTH=390px 左右),手機看起來要放大的視覺
                // 需求改用 transform: scale(phoneScale) 達成——transform
                // 只影響視覺渲染尺寸,不改變元素本身的佈局尺寸,iframe
                // 內部的 window.innerWidth 不受影響,展示頁排版邏輯
                // 维持跟真實手機瀏覽器一致。
                // translateY 寫在 scale 前面——見 PHONE_OFFSET_Y_BY_ASPECT
                // 的完整說明:讓 9:16 的手機對齊 Reels 安全可視區的中心,
                // 而不是整個畫布的中心。
                width: PHONE_WIDTH,
                height: PHONE_HEIGHT,
                transform: `translateY(${phoneOffsetY}px) scale(${phoneScale})`,
              }}
            >
              {/* 側邊按鈕裝飾——純視覺,對照使用者提供的參考圖補上(真實
                  iPhone 的音量鍵+電源鍵凸起),強化「這是一支實體手機」的
                  第一眼辨識度。 */}
              <div className={styles.phoneButtonVolumeUp} />
              <div className={styles.phoneButtonVolumeDown} />
              <div className={styles.phoneButtonPower} />
              {/* phoneBezel——邊框內緣的窄黑邊,讓螢幕(iframe)不直接貼著
                  金屬色外框,視覺上更接近真機的「螢幕鑲嵌在殼裡」。這層
                  有 overflow: hidden(裁出圓角螢幕形狀),caption 若留在
                  這層裡面絕對無法超出手機邊框,故字卡改放到外層
                  .phoneFrame 底下(見下方),跟 .phoneBezel 同層、疊在
                  整支手機外框之上。 */}
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
          {/* caption——使用者明確要求「字卡不要縮小」:原本 caption 是
              .phoneFrame 的子元素,跟著手機一起被 transform: scale()
              縮放,手機從 2.08 縮到 REELS_PHONE_FIT.scale(≈1.6,見該
              常數的完整說明)避開安全區後,字卡的視覺大小也跟著等比例
              縮小了約 23%,這是使用者不能接受的副作用。改成跟
              .phoneFrame 平行、是 .scaleWrap 的直接子元素——.scaleWrap
              本身只受 canvasScale(.canvasOuter 實際渲染尺寸相對
              1080px 設計基準的縮放,見 useCanvasScale 的完整說明)影響,
              不受 phoneScale(手機外框自己的縮放倍率)影響,字卡因此
              維持原本設計的視覺大小,不管手機縮多小都不受影響。
              定位基準也跟著從「相對 .phoneFrame」改成「相對
              .scaleWrap」(即整個 1080×1920 設計畫布),.caption-top/
              -bottom 的 top/bottom/left/right 百分比與 cqw 字級/間距
              因此需要重新設計(見 .module.css 的完整說明),不能沿用
              原本相對手機尺寸算出的數值。
              貼著畫布上緣或下緣(見 Caption.anchor 的完整說明)。
              key={caption.text} 讓每次文字切換時重新掛載,觸發 CSS 的
              進場動畫重播(見 .module.css .caption 的完整說明)。結尾
              CTA 字卡(caption.isCta)疊加 .captionCta 反轉配色。
              caption 為 null 時(劇本還沒開始播放前的極短暫瞬間)不
              渲染任何東西。 */}
          {caption && (
            <div
              key={caption.text}
              className={[
                styles.caption,
                styles[`caption-${caption.anchor}`],
                caption.isCta ? styles.captionCta : styles[`caption-colorway-${caption.colorway}`],
              ].join(' ')}
            >
              {caption.text}
            </div>
          )}
          {/* reelsSafeZoneOverlay——見 showReelsSafeZone 宣告處的完整
              說明。只在 9:16(aspect === '9:16')時顯示,因為這組安全區
              數值是 Meta 官方公布的 Reels 專屬規格,1:1/4:5 是一般
              動態消息版位,沒有同一套平台 UI 遮擋規則,套用同一組數字
              只會誤導判斷。疊在 .canvasOuter 底下(跟 .scaleWrap 平行,
              不是它的子元素)、不隨 .scaleWrap 的 transform: scale()
              縮放——安全區是相對整個畫布(.canvasOuter 實際渲染尺寸)
              計算的百分比,不應該跟著手機外框的縮放倍率一起變動。
              pointer-events: none,純視覺預覽,不攔截任何互動,也完全
              不影響 .canvasOuter 的版面計算或最終錄製輸出(錄製時這層
              不會被繪製進去,因為它是 React 條件渲染,預設
              showReelsSafeZone=false 不會出現在任何自動化錄製流程裡)。 */}
          {showReelsSafeZone && aspect === '9:16' && (
            <div className={styles.reelsSafeZoneOverlay}>
              {/* 使用者回報第一版(細描邊圖示模擬真實 UI)不夠顯眼,改成
                  整塊警示斜紋色塊 + 大字標籤,犧牲一點「像不像真實
                  Reels 介面」的擬真度換取一眼辨識度(見 .module.css
                  reelsSafeZoneOverlay 的完整說明)——這層是給製作者
                  自己校對字卡位置用的工具,不是最終要給觀眾看的畫面。 */}
              <div className={styles.reelsSafeZoneTop}>
                <span className={styles.reelsSafeZoneLabel}>⚠ 頂部安全區(帳號/音樂標籤)</span>
              </div>
              <div className={styles.reelsSafeZoneRightRail}>
                <span className={styles.reelsSafeZoneLabel}>⚠ 互動按鈕區</span>
              </div>
              <div className={styles.reelsSafeZoneBottom}>
                <span className={styles.reelsSafeZoneLabel}>⚠ 底部安全區(帳號名/文案/音樂)</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

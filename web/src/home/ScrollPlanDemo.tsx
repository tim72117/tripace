import { useCallback, useEffect, useRef, useState } from 'react'
import { AiPlanPhoneDemo } from './AiPlanPhoneDemo'
import { createDemoScrollSource, type DemoScrollSource } from '../planning/preview/demoScrollSource'
import type { PlanSimSource } from '../planning/preview/planSimSource'
import { trackEvent } from '../analytics'
import demoMapSrc from './assets/ai-plan-demo-map.png'
import styles from './ScrollPlanDemo.module.css'

// ScrollPlanDemo — 首頁的 AI 規劃展示:使用者捲動時,行程一站一站排出來。
//
// 跟 /product 功能介紹卡裡的那個小展示是同一個外框、同一張地圖、同一套
// 版面(都是 AiPlanPhoneDemo → AiPlanPhoneDemoScreen),唯一的差別是
// 推論層:
//   - /product:createDemoSimSource(計時器自動播完),使用者被動觀看
//   - 首頁:createDemoScrollSource(捲動位置推進),節奏在使用者手上
//
// 這正是推論層抽成 PlanSimSource 介面的用途——換掉一個工廠函式即可,
// 外框與渲染完全不需要知道差別。
//
// 2026-10(使用者明確要求「小展示只留 5 個」景點站,並確認要「另寫一套
// 獨立的 demo source」):這兩支改讀獨立的 demoScript.ts(DEMO_SCRIPT,
// 只有前 5 站),不再是 planSimScrollSource.ts/planSimFakeSource.ts 讀的
// 完整 planSimScript.ts(PLAN_SIM_SCRIPT,播放態 /ai-plan 展示頁專用)
// ——見 demoScript.ts 檔頭的完整說明:小展示跟播放態是分離的兩套概念,
// 不是同一份資料的不同播放範圍。
//
// 往回捲以「天」為單位清除(使用者明確要求「當往回滾到前一天時,清除
// 當天的資料」):跨出某一天時那一天整個收回去,前幾天維持原樣;同一天
// 內來回捲動不會有任何變化。不做逐站倒退——見 demoScrollSource.ts
// 對串流模型與回捲的完整說明。
//
// 但往上捲回區塊頂端會整個清空、重新開始(使用者明確要求「上滾清除」)
// ——那不需要串流能倒退,只需要換一個新的來源實例,見下方 effect。

// SCROLL_SPAN_VH — 這個區塊佔多少視窗高度,也就是「捲完整段劇本需要
// 捲多遠」。
// 2026-10(第二輪,使用者明確要求「把捲動距離跟節流拉長看看」,根因是
// 使用者回報「小小的滾動馬上就動了三步」「掠過骨架卡的階段」):
// ADVANCE_THRESHOLD_PX(見該常數的完整說明)讓每次真正呼叫 advanceTo
// 之間至少間隔一段像素距離,但 advanceTo 每次呼叫只推進一個播放步驟
// (thinking/骨架卡跟 action/完整卡各自獨立一步,見
// planSimScrollSource.ts resolveStep 的完整說明)——若捲動進度換算出
// 的目標 step 索引,在兩次真正呼叫之間就跨過不只一步(因為原本 300vh
// 對應的「每一步平均捲動距離」比節流閾值還短),node 下一次呼叫推進的
// 那一步永遠是目標索引最新的那一步,中間被跳過的 thinking step 就
// 永遠不會真的被送出、骨架卡階段因此被跳過。把總捲動距離拉長,讓
// 「每一步平均對應的捲動距離」明顯大於節流閾值,使用者在這段距離內
// 的捲動自然會在閾值累積到之前就已經推進到下一步,不會一次跨過兩步
// 以上。900vh(九個螢幕高)是拉長後的新值。
const SCROLL_SPAN_VH = 900

// PHONE_CSS_HEIGHT — AiPlanPhoneDemo 內部手機外框的 CSS 高度(390×844,
// 見該元件的常數)。算縮放倍率時當分母。
const PHONE_CSS_HEIGHT = 844
// HEADER_RESERVED_PX — 手機外框「之外」還要讓出多少垂直空間,算可用
// 高度時先扣掉。
//
// 2026-10 從 260 降到 120:原本的 260 是「eyebrow + 標題 + 說明」三段
// 文字都在外框上方時估的,但那三段後來陸續搬進手機畫面內(使用者先要求
// 「手機版文字在手機裡面」,再要求「將『編排行程』文字也放進手機內」)
// ——非並排斷點下外框上方只剩漂浮 nav 列的高度,260 變成嚴重超估,
// 直接把 phoneScale 壓到 0.76 左右,使用者要求的「放大」實質沒有生效
// (註解當時還寫著「一般視窗高度下通常落在 0.95~1.1」,與行為矛盾)。
//
// 2026-10(第二輪,review 實測發現):120 仍然多扣了 60px。那個值是照
// 「漂浮 nav 列 52px + 呼吸空間」推導的,但 nav 是 position: fixed,
// 完全不佔 .sticky 的內容流——真正讓開 nav 的是 .sticky 自己的
// padding-top: 56px。拿 nav 的高度再扣一次,等於同一段空間算了兩次。
//
// 60 的組成(實測 DevTools 量到的實際佔用):
//   .sticky 的 padding-top    56px
//   .phone 的 margin-top       4px
// 以上就是全部。.sticky 的 gap: 32px 與 .header(eyebrow + 標題)都不
// 計入——那兩段文字後來已經搬進手機畫面內(captionEyebrow/captionTitle),
// .sticky 實際只剩手機這一個子元素,gap 沒有第二個元素可以撐開。
//
// 改成 60 之後實測:視窗高 901px → phoneScale 0.997(原本 0.925)、
// 800px → 0.877、768px → 0.839。
const HEADER_RESERVED_PX = 60

// PHONE_SCALE_MIN——phoneScale 的安全下限,見該 state 宣告處的完整
// 說明:只在極端矮的視窗才會介入,一般視窗高度下 phoneScale 由
// available / PHONE_CSS_HEIGHT 實際算出,不會被這個下限夾住。
const PHONE_SCALE_MIN = 0.75

// START_AT——捲動進度超過這個比例才開始播放(見下方 effect 的完整說明)。
// SCROLL_SPAN_VH 是 900vh、可推進的距離是 800vh,所以 0.08 約等於
// 64vh(2026-10 修正:這段推導原本寫「SCROLL_SPAN_VH 是 300vh⋯
// 0.08 × 200vh ≈ 16vh」,是 SCROLL_SPAN_VH 還是 300 時算的,那之後
// 它調成 900 卻沒回來改,差了 4 倍——而這段推導正是別人要調這個值時
// 唯一的依據)。
const START_AT = 0.08

// END_AT——2026-10 新增(使用者明確要求「往下要退出地圖時，也要有遮罩
// 還原效果」,並確認「時機是捲到整個展示區塊的底部(progress 接近 1,
// 即將離開 .sticky 區塊)」):progress 超過這個值時,地圖的圓形遮罩
// 收回(見下方 mapRevealed state 的完整說明)。留一小段緩衝到 1 之前
// (而不是 progress === 1 才觸發)——.sticky 本身在 progress 到 1 前
// 的最後一小段已經要開始離開視窗、準備交棒給下一個區塊,收圖動畫提前
// 一點點開始,使用者實際捲出這個區塊時圓形已經收得差不多,不會在畫面
// 切換的瞬間還看到動畫進行到一半。跟 START_AT(0.08)不是對稱的鏡像
// 值——開場緩衝是為了晚一點點才開始播(讓打字動畫先出現),收尾緩衝
// 则是為了提前一點點開始收,兩者解決的是不同方向的時間差問題。
// 0.94→0.98(code review 發現):progress 的分母已扣掉一個視窗高度,
// 0.94~1 仍是 .sticky 固定在視窗內「停下來看完整結果」的範圍(約
// 400px 捲動距離),0.94 就收回會在使用者還在看成果時把地圖與時間軸
// 蓋掉。0.98 只留最後約 135px,收回動畫(1.1s,由門檻觸發、不與捲動
// 連動)剛好在使用者捲出區塊的過程中播完。
const END_AT = 0.98

// DESKTOP_WIDE_BREAKPOINT——跟 ScrollPlanDemo.module.css
// @media (min-width: 1440px) 並排斷點的數值一致(見該處的完整說明:
// 這是這個區塊自己的視覺決定,不是 useIsDesktop 的 768px 功能性斷點,
// 兩者刻意分開,不要混用)。2026-10 使用者明確要求「手機版文字在手機
// 裡面,桌面版文字在外面」:caption(主標題+描述文字)是否傳給手機
// 畫面內部的插槽,取決於目前是不是處在這個並排斷點——並排時文字回到
// 外部 .header,上下排列(手機版)時文字疊在手機畫面內,兩種版面各自
// 決定,不是同一份文字兩邊都顯示或都隱藏的全域開關。
const DESKTOP_WIDE_BREAKPOINT = 1440

// PHONE_FRAMELESS_BREAKPOINT——2026-10(第七輪,使用者明確回報手機
// 斷點下手機外框會因為 phoneScale 算法在不同視窗高度/行動瀏覽器網址
// 列收合情境下產生跳動/貼邊/疊壓等一連串問題,最終確認「手機斷點不
// 顯示邊框、到平板直式時才顯示，完全不用縮放的方式」)——低於這個
// 寬度時 AiPlanPhoneDemo 改用 frameless 模式(見該元件 frameless prop
// 的完整說明):不渲染手機外框裝飾(鈦金屬邊框/notch/側邊按鈕)、不套用
// transform: scale(),只剩螢幕內容本身用自然版面撐滿容器寬度。
// 徹底迴避本檔先前幾輪繞著 phoneScale 打轉、反覆修正又反覆冒出新邊界
// 情況(視窗高度變化跳動、窄螢幕貼邊、矮螢幕疊壓導覽列)的整個問題
// 類別——手機斷點下既然沒有「手機外框」這個造型需求,就不需要再用
// JS 算一個倍率去模擬手機的樣子。
//
// 768px——常見的平板直式寬度下限(iPad mini/Air 直式),跟專案裡
// useIsDesktop 的手機/桌面功能性斷點數值相同,但這裡刻意獨立成自己的
// 常數(不直接 import useIsDesktop)——理由同 DESKTOP_WIDE_BREAKPOINT
// 的既有說明,這是這個區塊自己的視覺決定,兩者數值相同是巧合,不是
// 同一個語意、不該耦合在一起維護。
const PHONE_FRAMELESS_BREAKPOINT = 768

// ADVANCE_THRESHOLD_PX——2026-10 使用者明確回報「小小的滾動馬上就動了
// 三步」:根因不是 advanceTo 算錯目標索引(它本來就是依絕對捲動位置
// 算的,這本身沒有問題),而是瀏覽器把「使用者感受到的一次捲動」拆成
// 十幾個連續的 scroll 事件(慣性捲動本身就是連續的位置更新,不是單一
// 事件),每個事件各自觸發一次 requestAnimationFrame、各自呼叫一次
// advanceTo——advanceTo 內部雖然限制「每次呼叫只真正推進一步」,但
// 十幾次呼叫疊加起來就是十幾步。改成累積捲動距離超過這個像素量才真正
// 呼叫一次 advanceTo,中間的 scroll 事件只更新「目前算出的目標進度」、
// 不觸發 advanceTo——使用者的捲動手勢需要滾過這段距離,才會被視為
// 「這是一次有意義的捲動動作」,對齊使用者要的「捲動一次才動一次
// 斷點」。
// 2026-10(第二輪,使用者明確要求「把捲動距離跟節流拉長看看」,根因見
// SCROLL_SPAN_VH 的完整說明):連同總捲動距離一起拉長,80px 搭配拉長
// 後的 SCROLL_SPAN_VH(900vh),讓節流閾值依然明顯小於「每一步平均
// 對應的捲動距離」,這樣目標 step 索引在兩次真正呼叫之間不會一次跨過
// 超過一步,骨架卡(thinking)階段才不會被跳過。
const ADVANCE_THRESHOLD_PX = 80

export function ScrollPlanDemo() {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  // started — 區塊進入視窗才建立來源,避免使用者還沒捲到就開始播。
  const [started, setStarted] = useState(false)
  const [source, setSource] = useState<PlanSimSource | null>(null)
  // mapRevealed——2026-10 新增(見 END_AT 的完整說明):地圖圓形遮罩的
  // 展開/收回狀態,跟 started 分開管理——雖然「開始展開」的時機
  // (progress > START_AT)目前跟 started 轉 true 是同一個訊號,但
  // 「收回」的時機(progress > END_AT)沒有對應的既有 state 可以借用,
  // started 在使用者捲出區塊後仍然維持 true(它的語意是「這個展示有
  // 沒有啟動過」,不是「地圖現在看不看得見」,見上方該 state 處理
  // 上滾清除的完整說明),不能直接拿它的反向值當收回條件。獨立一個
  // state 也讓「地圖何時可見」這個視覺判斷有單一事實來源,不用在兩個
  // 不完全同義的 state 之間推導。
  const [mapRevealed, setMapRevealed] = useState(false)

  // handleSource 用 useCallback 包住:它會進 AiPlanPhoneDemoScreen 裡
  // 一個 effect 的依賴陣列,每次 render 都換新參照會讓那個 effect 反覆
  // 執行。
  const handleSource = useCallback((s: PlanSimSource | null) => setSource(s), [])

  // isDesktopWide——見 DESKTOP_WIDE_BREAKPOINT 的完整說明:是否處在
  // 1440px 並排斷點,決定 caption 要不要傳給手機畫面內部。
  const [isDesktopWide, setIsDesktopWide] = useState(
    () => window.matchMedia(`(min-width: ${DESKTOP_WIDE_BREAKPOINT}px)`).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${DESKTOP_WIDE_BREAKPOINT}px)`)
    const onChange = () => setIsDesktopWide(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  // isPhoneFrameless——見 PHONE_FRAMELESS_BREAKPOINT 的完整說明:是否
  // 處於手機斷點(< 768px),決定要不要把 frameless 傳給 AiPlanPhoneDemo
  // (見下方 JSX)。用 matchMedia 而非 window.innerWidth——跟
  // isDesktopWide 同一套既有模式,change 事件比自己監聽 resize 更精準
  // (不會在不影響這個斷點的寬度變化時白白觸發)。
  const [isPhoneFrameless, setIsPhoneFrameless] = useState(
    () => window.matchMedia(`(max-width: ${PHONE_FRAMELESS_BREAKPOINT - 1}px)`).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${PHONE_FRAMELESS_BREAKPOINT - 1}px)`)
    const onChange = () => setIsPhoneFrameless(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  // phoneScale——依視窗高度決定手機要多大,只在非手機斷點(平板直式
  // 以上,顯示外框)才有意義——見 PHONE_FRAMELESS_BREAKPOINT 的完整
  // 說明,手機斷點改用 frameless 模式,不套用 transform: scale(),這裡
  // 算出的值在那個模式下不會被使用。
  //
  // 這個展示是整個視窗的主角(sticky 滿版),手機應該盡量撐大;但上方
  // 還有標題區塊,不能真的填滿。扣掉標題與上下留白後的可用高度,除以
  // 手機的 CSS 高度(844)就是倍率。
  //
  // 夾在 PHONE_SCALE_MIN~1.1 之間:2026-10 使用者明確要求「再放大」,
  // 原本下限從 0.88 調到 0.95,但在約 800px 高的常見視窗下,
  // available / PHONE_CSS_HEIGHT 算出的值本來就小於 0.95,被夾到
  // 0.95 這個固定下限後,手機實際高度加上文字區塊會超出視窗,導致
  // 手機頂部蓋住上方漂浮 nav 列(見 HEADER_RESERVED_PX 的完整說明:
  // 那只是算可用空間的粗估值,不是保證手機不會超出視窗的硬限制)。
  // PHONE_SCALE_MIN 改成遠低於常見視窗算出值的安全下限(0.75)——這樣
  // 一般視窗高度下 phoneScale 幾乎都是用 available 算出的實際值,
  // 視覺上達到「放大」的效果。上限維持 1.1,避免在超高螢幕上被放大
  // 到失真。
  //
  // 實際落點(HEADER_RESERVED_PX = 60,見其完整說明):768px 視窗
  // 0.839、800px 0.877、900px 0.995、1080px 以上一律撞 1.1 上限。
  // 下限 0.75 在視窗高度低於約 693px 時開始介入——那不算極端(縮小的
  // 桌面視窗、橫向手機都會到),被夾住後手機實際高度 633px 加上
  // 56+4 的留白會超出視窗,底部被 .sticky 的 overflow: hidden 裁掉
  // (不會出現頁面卷軸,但時間軸最下面一截看不到)。那是刻意的取捨:
  // 再往下縮手機內的文字就無法辨識了,寧可裁掉底部也不要整個看不清。
  //
  // 2026-10(第七輪)補上先前已驗證正確、跟這次問題不同根因的獨立
  // 修法:改用 window.visualViewport(行動裝置上專門反映「實際可視
  // 區域」的 API)+ debounce 200ms + 只在「寬度」真的變化時才重算——
  // 這是處理「手機瀏覽器捲動時網址列收合/展開導致 window.innerHeight
  // 瞬時變化,連帶讓 phoneScale 跳動」這個問題,跟這一輪處理的「手機
  // 斷點下手機貼邊/疊壓」是兩個不同成因、但都源自同一套 phoneScale
  // 計算的獨立問題,只在非手機斷點(平板直式以上)還需要這套計算時
  // 才有意義,保留下來。
  const [phoneScale, setPhoneScale] = useState(0.95)
  useEffect(() => {
    if (isPhoneFrameless) return
    const viewport = window.visualViewport
    const applyHeight = (height: number) => {
      const available = height - HEADER_RESERVED_PX
      setPhoneScale(Math.min(Math.max(available / PHONE_CSS_HEIGHT, PHONE_SCALE_MIN), 1.1))
    }
    let lastWidth = viewport?.width ?? window.innerWidth
    applyHeight(viewport?.height ?? window.innerHeight)
    const calc = () => {
      const width = viewport?.width ?? window.innerWidth
      if (width === lastWidth) return
      lastWidth = width
      applyHeight(viewport?.height ?? window.innerHeight)
    }
    let debounceTimer: ReturnType<typeof setTimeout> | undefined
    const onViewportChange = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(calc, 200)
    }
    if (viewport) {
      viewport.addEventListener('resize', onViewportChange)
    } else {
      window.addEventListener('resize', onViewportChange)
    }
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      if (viewport) {
        viewport.removeEventListener('resize', onViewportChange)
      } else {
        window.removeEventListener('resize', onViewportChange)
      }
    }
  }, [isPhoneFrameless])

  // 捲動 → 推進播放,同時由捲動進度決定 started(啟動與清除)。
  //
  // 這兩件事綁在同一個 effect、同一份 progress 計算上,是因為「該不該
  // 開始播」與「該播到第幾則」問的是同一個問題——捲到哪裡了。原本用
  // IntersectionObserver 判斷啟動/清除,但這個區塊有 SCROLL_SPAN_VH
  // (300vh)那麼高:從區塊內往上捲回頂端的整個過程,元素都還有一大半
  // 在視窗裡、isIntersecting 一直是 true,所以 started 永遠不會轉回
  // false,清除也就不會發生(使用者回報「上滾清除沒有做」)。
  // 進度本身才是正確的訊號:progress 回到 0 就是真的捲回區塊頂端了。
  //
  // 使用者明確要求「上滾的時候不用停留,做清除安排的動作」:往上捲回
  // 頂端時行程整個清掉,再往下捲是從頭重新演一次,而不是停在上次播到
  // 的進度。usePlanSimSocket 的 start 轉 false 會 setTimeline(
  // createEmptyTimeline()) 並丟掉來源、轉回 true 時重建一個新的(見該
  // hook 的 effect),所以「整個重來」只需要讓 started 跳一次 false。
  // 這跟逐站倒退(真正的回撥)不同——串流模型無法收回已送出的訊息,
  // 見 demoScrollSource.ts 的完整說明。
  //
  // 用 requestAnimationFrame 節流:捲動事件的觸發頻率遠高於畫面更新,
  // 每次都算 getBoundingClientRect 是浪費。
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const scrollSource = source as DemoScrollSource | null
    let raf = 0
    // lastAdvanceScrollYRef——見 ADVANCE_THRESHOLD_PX 的完整說明:記錄
    // 上一次真正呼叫 advanceTo 當下的 window.scrollY,下一次 onScroll
    // 要比對目前位置跟這個記錄值的差距,只有累積超過閾值才算「一次有
    // 意義的捲動」。null 代表這個 effect 剛掛載、還沒有基準點,第一次
    // onScroll 一律放行(對齊原本「一進畫面就先算一次」的既有行為)。
    let lastAdvanceScrollY: number | null = null
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const rect = el.getBoundingClientRect()
        // progress:0 = 區塊頂端剛到視窗頂端,1 = 區塊底端捲到視窗頂端。
        // 分母扣掉一個視窗高度——最後那段是「停在畫面上看完整結果」的
        // 空間,不該還在推進播放。
        const span = rect.height - window.innerHeight
        const progress = span <= 0 ? 1 : Math.min(Math.max(-rect.top / span, 0), 1)
        // START_AT——超過這個進度才開始播。留一小段緩衝(而不是 progress
        // > 0 就啟動)有兩個作用:一是使用者剛捲到區塊頂端時先看到打字
        // 開場、而不是立刻跳出第一站;二是避免在 0 附近來回微調捲動時,
        // started 反覆跳動、每次都重建來源。
        setStarted(progress > START_AT)
        // mapRevealed——見該 state 宣告處的完整說明:START_AT~END_AT
        // 這段區間展開,兩端之外收回(圓形遮罩蓋住地圖)。跟 started
        // 用同一個 progress 計算結果,不需要另外量測。
        setMapRevealed(progress > START_AT && progress < END_AT)
        // source 還沒建立(started 剛轉 true、effect 尚未跑完)時只更新
        // started,下一次捲動事件自然會推進——不需要在這裡補推。
        if (!scrollSource?.advanceTo) return
        const scrollY = window.scrollY
        // 累積捲動距離未超過閾值:只記錄這次的 progress 可能已經算出的
        // 目標(不做任何事),等之後真的累積夠了、或使用者停下來改變
        // 方向繼續捲,才會在超過閾值的那次 onScroll 一次性推進到當時
        // 的目標進度——這跟原本「每次 scroll 都呼叫 advanceTo」的差異
        // 只在於「多久呼叫一次」,呼叫時用的仍然是當下最新的絕對進度,
        // 不會因為跳過中間幾次呼叫而漏播。
        if (lastAdvanceScrollY != null && Math.abs(scrollY - lastAdvanceScrollY) < ADVANCE_THRESHOLD_PX) {
          return
        }
        lastAdvanceScrollY = scrollY
        // 進度換算成索引時扣掉開場那段緩衝,讓 START_AT~1 對應完整劇本,
        // 否則最後幾則會被壓縮在尾端捲不完。
        const played = Math.min(Math.max((progress - START_AT) / (1 - START_AT), 0), 1)
        scrollSource.advanceTo(Math.ceil(played * scrollSource.total))
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [source, isPhoneFrameless])

  return (
    <div ref={wrapRef} className={styles.wrap} style={{ height: `${SCROLL_SPAN_VH}vh` }}>
      {/* sticky 容器:整個區塊有 SCROLL_SPAN_VH 的高度提供捲動距離,
          但顯示的內容黏在視窗上——使用者捲動時看到的是「同一支手機裡
          行程逐漸長出來」,而不是內容跟著往上跑掉。
          stickyFrameless——2026-10(第九輪)手機斷點下疊加,見
          ScrollPlanDemo.module.css 該 class 的完整說明:左右 padding
          歸零讓地圖真正滿版。 */}
      <div className={isPhoneFrameless ? `${styles.sticky} ${styles.stickyFrameless}` : styles.sticky}>
        {/* stickyMapBackdrop——2026-10(使用者明確回報「上方地圖沒有
            滿版」,並確認「地圖要真正滿版，貼齊視窗最頂端（被導覽列
            蓋住都行）」)frameless 模式專用的獨立地圖層,只在這裡渲染、
            不透過 AiPlanPhoneDemoScreen 內部的 mapBackground 插槽
            (該插槽在 stacked=true 時改成不渲染,見該檔案的完整說明,
            避免兩層地圖疊影)。
            position: absolute 的子層預設相對父層 padding box 定位,
            不受父層自身 padding 影響——這層是 .sticky 的直接子元素,
            inset: 0 因此會貼齊 .sticky 本身的邊界,完全忽略
            .stickyFrameless 的 padding-top(讓文字/時間軸避開漂浮
            導覽列用的留白,見該 class 的完整說明)。地圖因此能真正
            貼齊視窗頂端(被導覽列蓋住的部分也沒關係——導覽列是
            position: fixed、z-index 比這裡高,視覺上就是「地圖從
            導覽列底下穿出去」),文字與時間軸仍留在 padding 保護的
            文件流層級,不會被導覽列橫切。
            z-index 不需要特別設定——後面的 .phoneFrameless(手機展示
            框本身,文字/時間軸所在的那層)在文件流中排在這層之後,
            預設 stacking order 已經在它上面。 */}
        {isPhoneFrameless && (
          <>
            <div className={styles.stickyMapBackdrop} aria-hidden="true">
              <img src={demoMapSrc} alt="" className={styles.stickyMapImg} />
              <div className={styles.stickyMapScrim} />
            </div>
            {/* stickyRevealMask——2026-10(使用者明確要求「做一個遮罩，
                往下時，遮住地圖區，整個地圖區進入時，從中間圓形的漸漸
                顯示整個地圖」「往下要退出地圖時，也要有遮罩還原效果」
                「也要把時間軸遮住」「共用同一個遮罩，不要用兩個」)。
                單一遮罩元素,靠 z-index 蓋在地圖與時間軸之上、caption
                文字之下(見 ScrollPlanDemo.module.css .stickyRevealMask
                的完整說明:z-index 與 DOM 親子無關,所以不必把地圖和
                時間軸塞進同一個容器)。mapRevealed 為 true 時洞放大
                (圓形擴散顯現),false 時洞縮回 0(收回遮住)——為 true
                的區間是 START_AT~END_AT,見 END_AT/mapRevealed 的說明。
                只有 frameless 手機版面渲染,其他斷點不受影響。 */}
            <div className={styles.stickyRevealMask} aria-hidden="true">
              <div
                className={mapRevealed ? `${styles.stickyRevealHole} ${styles.stickyRevealHoleOpen}` : styles.stickyRevealHole}
              />
            </div>
          </>
        )}
        {/* header——2026-10 使用者明確要求「手機版文字在手機裡面,桌面
            版文字在外面」,後確認「desc 絕對在手機裡,title 跟斷點走」,
            再確認「手機版將『編排行程』文字也放進手機內」:
            並排斷點(isDesktopWide,見 DESKTOP_WIDE_BREAKPOINT 的完整
            說明)以上時,eyebrow 與 title 都放在手機外框左側的外部
            header;以下時三段文字(eyebrow/title/desc)全部進手機畫面
            內部,外部 header 整個不渲染——手機版的版面是上下排列,
            外框上方再放文字會把手機擠下去。 */}
        {isDesktopWide && (
          <div className={styles.header}>
            <div className={styles.eyebrow}>編排行程</div>
            <h2 className={styles.title}>不只是排滿行程，而是與你一起規劃</h2>
          </div>
        )}
        {/* 外框、地圖、版面完全沿用 /product 功能介紹卡的那一份,
            只把推論層換成捲動驅動(見檔頭說明)。
            frameless——見 PHONE_FRAMELESS_BREAKPOINT 的完整說明,手機
            斷點下不顯示外框、不套用縮放,只有這個呼叫端這樣用(/product
            功能介紹卡維持原本永遠顯示外框的既有行為,見
            AiPlanPhoneDemo.tsx frameless prop 的完整說明)。
            phoneFrameless——2026-10(第九輪)手機斷點下疊加,見
            ScrollPlanDemo.module.css 該 class 的完整說明:讓這層撐滿
            .sticky 剩餘的垂直空間與全部水平空間,地圖才能真正滿版。 */}
        <AiPlanPhoneDemo
          className={isPhoneFrameless ? `${styles.phone} ${styles.phoneFrameless}` : styles.phone}
          scale={phoneScale}
          frameless={isPhoneFrameless}
          onClick={() => trackEvent('landing_cta_click', { page: 'home', position: 'feature-ai-plan' })}
          screenProps={{
            createSource: createDemoScrollSource,
            started,
            onSource: handleSource,
            // focusLatest——2026-10 使用者明確要求「做在首頁的展示上」
            // 的單卡聚焦堆疊版面(見 AiPlanPhoneDemoScreen.tsx 該 prop
            // 的完整說明),只有首頁這個情境開啟。
            focusLatest: true,
            // stacked——2026-10(第九輪,使用者明確回報「文字區要給固定
            // 容器大小，不要被時間軸往上推覆蓋了」,並確認改用「真正
            // flex 文件流」)跟 isPhoneFrameless 綁一起:手機斷點下 caption
            // 文字區跟 timeline 時間軸區改成上下排列的實體區塊(見
            // PhoneDemoLayout.tsx stacked prop 的完整說明),不再是
            // 疊在地圖上的絕對定位層,兩者高度由 flex 版面引擎保證
            // 不重疊。非手機斷點(顯示外框的情況)維持原本疊圖模式。
            stacked: isPhoneFrameless,
            // caption——見上方 header 註解的完整說明:desc 永遠放這裡;
            // eyebrow 與 title 只在非並排斷點(手機版上下排列)時才一起
            // 放進來,並排時那兩段已經在外部 header 顯示,不重複。
            //
            // 「試試看」按鈕(2026-10 第八輪新增)——只在 isPhoneFrameless
            // 時加進來,見 AiPlanPhoneDemo.tsx frameless 分支開頭的完整
            // 說明:手機斷點下按鈕移進 caption、疊在文字正下方,不再由
            // AiPlanPhoneDemo 獨立渲染,避免矮螢幕下被 .sticky 的
            // overflow: hidden 連同地圖下緣一起裁掉。非手機斷點(顯示
            // 外框的情況)維持原樣,按鈕仍由 AiPlanPhoneDemo 渲染在
            // .phoneFrame 之外(.tryItCtaOutside),不經過這裡。
            caption: (
              <>
                {!isDesktopWide && (
                  <>
                    <div className={styles.captionEyebrow}>編排行程</div>
                    <h2 className={styles.captionTitle}>不只是排滿行程，而是與你一起規劃</h2>
                  </>
                )}
                {/* captionDesc——2026-10(使用者明確要求「往下捲動的字
                    放在時間軸還沒顯示的區域」)frameless 模式下不再在
                    這裡渲染:改成由 AiPlanPhoneDemoScreen.tsx 的
                    timelineHint 疊在 timeline 插槽本身(steps.length
                    === 0 時置中顯示、第一張卡片出現後消失),理由見該處
                    的完整說明——這段提示指的是「往下捲動讓時間軸長出
                    卡片」這個動作,固定常駐在上方文字區(跟時間軸所在
                    的下半部版面脫節)不如直接疊在使用者真正該看的那塊
                    區域、且動作完成後自然收起。非 frameless(疊圖模式,
                    仍是傳統手機外框版面,沒有「進度=0 時疊在 timeline
                    區域」這個概念)維持原樣常駐顯示。 */}
                {!isPhoneFrameless && (
                  <p className={styles.captionDesc}>往下捲動，看 AI 排出一天的行程</p>
                )}
                {isPhoneFrameless && (
                  <div className={styles.tryItCtaCaption} aria-hidden="true">
                    試試看
                  </div>
                )}
              </>
            ),
          }}
        />
      </div>
    </div>
  )
}

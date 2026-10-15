import { useCallback, useEffect, useRef, useState } from 'react'
import { AiPlanPhoneDemo } from './AiPlanPhoneDemo'
import { createPlanSimScrollSource, type ScrollPlanSource } from './plan-ai-sim/planSimScrollSource'
import type { PlanSimSource } from './plan-ai-sim/planSimSource'
import { trackEvent } from '../analytics'
import styles from './ScrollPlanDemo.module.css'

// ScrollPlanDemo — 首頁的 AI 規劃展示:使用者捲動時,行程一站一站排出來。
//
// 跟 /product 功能介紹卡裡的那個小展示是同一個外框、同一張地圖、同一套
// 版面(都是 AiPlanPhoneDemo → AiPlanPhoneDemoScreen),唯一的差別是
// 推論層:
//   - /product:createPlanSimFakeSource(計時器自動播完),使用者被動觀看
//   - 首頁:createPlanSimScrollSource(捲動位置推進),節奏在使用者手上
//
// 這正是推論層抽成 PlanSimSource 介面的用途——換掉一個工廠函式即可,
// 外框與渲染完全不需要知道差別。
//
// 往回捲以「天」為單位清除(使用者明確要求「當往回滾到前一天時,清除
// 當天的資料」):跨出某一天時那一天整個收回去,前幾天維持原樣;同一天
// 內來回捲動不會有任何變化。不做逐站倒退——見 planSimScrollSource.ts
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
// HEADER_RESERVED_PX — 標題區塊(eyebrow + 標題 + 說明)加上下留白佔掉
// 的高度,算可用空間時先扣掉。粗估值,不需要精確——phoneScale 本來就
// 夾在上下限之間,差個幾十 px 不會讓版面壞掉。
const HEADER_RESERVED_PX = 260

// START_AT——捲動進度超過這個比例才開始播放(見下方 effect 的完整說明)。
// 0.08 約等於區塊頂端往下捲四分之一個視窗高度(SCROLL_SPAN_VH 是 300vh,
// 可推進的距離是 200vh,0.08 × 200vh ≈ 16vh)。
const START_AT = 0.08

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

  // handleSource 用 useCallback 包住:它會進 AiPlanPhoneDemoScreen 裡
  // 一個 effect 的依賴陣列,每次 render 都換新參照會讓那個 effect 反覆
  // 執行。
  const handleSource = useCallback((s: PlanSimSource | null) => setSource(s), [])

  // phoneScale——依視窗高度決定手機要多大。
  //
  // 這個展示是整個視窗的主角(sticky 滿版),手機應該盡量撐大;但上方
  // 還有標題區塊,不能真的填滿。扣掉標題與上下留白後的可用高度,除以
  // 手機的 CSS 高度(844)就是倍率。
  //
  // 夾在 0.62~1.1 之間:下限是 /product 卡片用的尺寸(再小就看不清楚
  // 時間軸上的字),上限避免在超高螢幕上被放大到失真——手機外框的
  // 邊框、動態島這些細節是照 1x 畫的,放太大會顯得粗糙。
  const [phoneScale, setPhoneScale] = useState(0.62)
  useEffect(() => {
    const calc = () => {
      const available = window.innerHeight - HEADER_RESERVED_PX
      setPhoneScale(Math.min(Math.max(available / PHONE_CSS_HEIGHT, 0.62), 1.1))
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

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
  // 見 planSimScrollSource.ts 的完整說明。
  //
  // 用 requestAnimationFrame 節流:捲動事件的觸發頻率遠高於畫面更新,
  // 每次都算 getBoundingClientRect 是浪費。
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const scrollSource = source as ScrollPlanSource | null
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
  }, [source])

  return (
    <div ref={wrapRef} className={styles.wrap} style={{ height: `${SCROLL_SPAN_VH}vh` }}>
      {/* sticky 容器:整個區塊有 SCROLL_SPAN_VH 的高度提供捲動距離,
          但顯示的內容黏在視窗上——使用者捲動時看到的是「同一支手機裡
          行程逐漸長出來」,而不是內容跟著往上跑掉。 */}
      <div className={styles.sticky}>
        <div className={styles.header}>
          <div className={styles.eyebrow}>編排行程</div>
          <h2 className={styles.title}>說一句話，行程就排好了</h2>
          <p className={styles.desc}>往下捲動，看 AI 排出一天的行程</p>
        </div>
        {/* 外框、地圖、版面完全沿用 /product 功能介紹卡的那一份,
            只把推論層換成捲動驅動(見檔頭說明)。 */}
        <AiPlanPhoneDemo
          className={styles.phone}
          scale={phoneScale}
          onClick={() => trackEvent('landing_cta_click', { page: 'home', position: 'feature-ai-plan' })}
          screenProps={{
            createSource: createPlanSimScrollSource,
            started,
            onSource: handleSource,
            // focusLatest——2026-10 使用者明確要求「做在首頁的展示上」
            // 的單卡聚焦堆疊版面(見 AiPlanPhoneDemoScreen.tsx 該 prop
            // 的完整說明),只有首頁這個情境開啟。
            focusLatest: true,
          }}
        />
      </div>
    </div>
  )
}

import { useEffect, useState, type ReactNode } from 'react'
import { SignalHigh, Wifi, BatteryFull } from 'lucide-react'
import type { PlanSimSource } from './plan-ai-sim/planSimSource'
import { HorizontalPlanTimeline } from './plan-ai-sim/HorizontalPlanTimeline'
import { usePlanSimSocket } from './plan-ai-sim/usePlanSimSocket'
import { listNodes } from '../plan-core/planTimeline'
import { PlanDataProvider } from '../plan-core/PlanDataProvider'
import { planAiFakeDataSource } from './plan-ai-sim/planAiFakeDataSource'
import { PhoneDemoLayout } from './PhoneDemoLayout'
import demoMapSrc from './assets/ai-plan-demo-map.png'
import styles from './AiPlanPhoneDemoScreen.module.css'

// AiPlanPhoneDemoScreen — 功能介紹頁手機外框(AiPlanPhoneDemo.tsx)內部
// 顯示的展示畫面(方案 B,2026-10 使用者明確確認:「試做B我試試看效果」)。
//
// 背景:這個小展示原本用 <iframe src="/ai-plan?embedded=1"> 整頁嵌入
// home/plan-ai-sim/Content.tsx,後來 plan-ai-sim/Content 的地圖換成真實互動
// 地圖(NativeMapBase,見該檔案的完整說明)後,使用者希望小展示改回
// 「靜態圖片地圖 + 模擬元件」——但若直接把這個元件(非 iframe)嵌進
// 功能介紹頁再用 CSS transform:scale() 縮小,plan-ai-sim/Content 現有的
// 響應式版面(@media (max-width: 767px) 手機斷點)會判斷錯誤:
// media query 看的是瀏覽器真實視窗寬度,不是縮放後的視覺尺寸,縮小後的
// 外框在桌面瀏覽器裡仍然會套用桌面版版面規則,版面會跟手機外框的形狀
// 衝突。
//
// 這個元件採用「方案 B」解法:整個版面寫死成手機尺寸(不依賴任何
// @media 判斷),專門只給這個固定尺寸的手機外框使用,不透過 iframe、
// 也不是整頁 plan-ai-sim/Content 的縮小版——只共用它的劇本模擬邏輯
// (usePlanSimSocket,已改成 export 供這裡 import,見該函式宣告處的
// 完整說明),地圖、composer、頂部導覽列等版面相關的部分都是這裡重新
// 寫的簡化版,不是原頁面的複製貼上。
//
// 地圖用存好的靜態圖片(assets/ai-plan-demo-map.png,跟
// home/plan-ai-sim/Content.tsx 先前 NativeMapBase 用的 CENTER/ZOOM 同一組
// 構圖參數,2026-10 用 Static Maps API 產生並存檔),不是即時 API 呼叫
// ——這個小展示本身在功能介紹頁上是裝飾性質的縮圖,不需要每次頁面
// 載入都重新打一次 API 或掛載完整的 Maps JS SDK。
//
// 這個元件本身不處理手機外框造型(鈦金屬邊框/notch/按鈕等,那是
// AiPlanPhoneDemo.tsx 的職責),只負責「螢幕裡顯示的內容」,呼叫端把
// 它放進 .screen 容器裡即可。
//
// 2026-10(第二輪,使用者明確要求「功能介紹的小展示換成橫向版」):
// 時間軸渲染從縱向 PlanTimelineView 換成 plan-ai-sim/HorizontalPlanTimeline
// (/ai-plan 展示頁手機版模擬中用的同一個元件),跟那邊共用同一套橫向
// 卡片+迷你時間尺視覺語言,不再需要原本透過 renderStopCard 插槽自訂的
// 放大版地點卡(那是縱向版才有的客製化管道,HorizontalPlanTimeline
// 沒有、也不需要這個插槽——它本身的卡片設計已經適合這個尺寸)。不再
// 需要 mountedIdsRef/scrollRef/scrollToLatest 這套縱向版的輔助機制,
// HorizontalPlanTimeline 自己管理卡片捲動與置中。
// createSource/started——選填,讓呼叫端注入不同的播放節奏。
//
// 省略時維持原本行為:掛載就用計時器自動播完(/product 的功能介紹卡)。
// 首頁的捲動展示傳 createPlanSimScrollSource 與自己的進場時機,改由捲動
// 位置推進(見 planSimScrollSource.ts)——外框、版面、渲染元件全部沿用
// 這一份,只有「誰推進播放」不同。
//
// onSource 把來源實例交還給呼叫端:捲動版需要拿到它才能呼叫 advanceTo()。
//
// focusLatest——2026-10 新增(使用者明確要求「做在首頁的展示上」:
// 「第一張卡滿版,第二個骨架推論中時,第一張壓小,……後面比照前面」的
// 單卡聚焦版面,見 HorizontalPlanTimeline.tsx 該 prop 的完整說明)。
// 這個元件同時被兩處呼叫:首頁 ScrollPlanDemo.tsx(捲動驅動)跟
// /product 功能介紹頁 FeatureShowcase.tsx(計時器驅動,透過
// AiPlanPhoneDemo 預設 screenProps),使用者這次明確只要首頁這個情境
// 套用,不影響 /product 那張卡片維持原本固定寬度橫向捲動的既有外觀
// ——選填,省略時預設 false,呼叫端(ScrollPlanDemo.tsx)自行傳 true
// 開啟。
//
// caption——2026-10 新增(使用者明確要求「最小版面,上方的字放進手機
// 裡面的上方看看」,並確認「文字是放在地圖的主顯示區」、「只有首頁
// 顯示,/product 不動」):選填,原樣轉交給 PhoneDemoLayout 的 caption
// 插槽(見該元件的完整說明)。只有 ScrollPlanDemo.tsx(首頁)傳入主
// 標題+描述文字,FeatureShowcase.tsx(/product)不傳,維持原本沒有
// 任何標題文字疊在地圖上的樣子。
export function AiPlanPhoneDemoScreen({
  createSource,
  started = true,
  onSource,
  focusLatest = false,
  caption,
  stacked = false,
}: {
  createSource?: () => PlanSimSource
  started?: boolean
  onSource?: (source: PlanSimSource | null) => void
  focusLatest?: boolean
  caption?: ReactNode
  // stacked——2026-10(第九輪)新增,原樣轉交給 PhoneDemoLayout 的
  // stacked prop(見該元件的完整說明)。只有 ScrollPlanDemo.tsx 在
  // frameless 模式下傳 true,/product 功能介紹卡維持原狀不傳(預設
  // false,疊圖模式)。
  stacked?: boolean
} = {}) {
  // 2026-10 使用者明確要求「首頁展示不要輸入框」:移除開場假打字動畫
  // 與輸入膠囊(原本的 typedPrompt/promptTyped state 與下方 .composer
  // 區塊),這個小展示本身是 pointer-events:none、本來就不接受真的
  // 輸入(見下方 .screen 的完整說明),輸入框只是純視覺的開場效果。
  //
  // 拿掉後,usePlanSimSocket 的 start 參數直接傳 started(區塊進入
  // 視窗),不再透過「假打字播完」這個中間步驟——這不影響劇本的實際
  // 播放進度,首頁版的 PlanSimSource 是 createPlanSimScrollSource(見
  // 檔頭說明),站點是靠呼叫端(ScrollPlanDemo.tsx)的 advanceTo(progress)
  // 依捲動位置推進,不是建立來源後自動播完,started 本身只決定「要不要
  // 建立這個來源」這一層。
  const { timeline, nodeStatus, isGenerating, source } = usePlanSimSocket(started, createSource)
  useEffect(() => { onSource?.(source) }, [source, onSource])

  // selectedStopId——2026-10(使用者明確要求「功能介紹的小展示換成
  // 橫向版」):HorizontalPlanTimeline 必填這個 prop 並自己管理捲動/
  // 卡片置中(不像縱向版 PlanTimelineView 那樣由呼叫端自己接手
  // scrollRef/scrollToLatest),這裡只需要給它一個內部 state 讓「最新
  // 長出來的站點」能被標成選中、卡片列自動捲到該站,不需要自訂
  // scrollToLatest 邏輯——HorizontalPlanTimeline 內部的
  // scrollToStop/handleScroll 已經處理了「捲到指定站點」這件事。
  //
  // 新站點長出來時自動選中它(呼應原本「永遠跟隨到底」的展示效果:
  // 排程過程中新站點陸續出現,畫面跟著捲到最新一站),用最後一個 stop
  // 節點的 id——這個展示框本身是 pointer-events:none(見
  // AiPlanPhoneDemo.tsx 的完整說明),使用者無法手動點選/捲動,不會有
  // 「使用者正在看某一站、卻被自動跳走」的衝突情境,永遠選中最新一站
  // 即可。
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)
  useEffect(() => {
    const stops = listNodes(timeline).filter((s) => s.type === 'stop')
    const latest = stops[stops.length - 1]
    if (latest) setSelectedStopId(latest.id)
  }, [timeline])

  // mapBackground——見 PhoneDemoLayout.tsx mapBackground 插槽的完整
  // 說明。地圖用存好的靜態圖片(見檔頭說明),不即時呼叫 API。
  // pointer-events:none(見 .module.css):這張圖本身不可互動,整個
  // 展示框的點擊事件由外層 AiPlanPhoneDemo.tsx 的 <Link> 接收。
  //
  // stacked 時不渲染(2026-10,使用者明確回報「上方地圖沒有滿版」後
  // 查出的根因修正):stacked=true 只有 ScrollPlanDemo.tsx(首頁
  // frameless 模式)會傳,那個呼叫端已經在 .sticky 容器自己另外畫了
  // 一層不受 padding-top 影響、真正貼齊視窗頂端的獨立地圖層(見該
  // 檔案 stickyMapBackdrop 的完整說明)——這裡的 mapBackground 插槽
  // 位於 PhoneDemoLayout 的 .screenFrameless 內部,仍然會被外層
  // .stickyFrameless 的 padding-top 往下推,兩層地圖一起渲染只會
  // 疊出一張對不齊的重複地圖,不如直接關掉這裡的。非 stacked(疊圖
  // 模式,/product 功能介紹卡)維持原樣,繼續由這裡渲染。
  const mapBackground = stacked ? undefined : (
    <>
      <img src={demoMapSrc} alt="" className={styles.mapBackdrop} aria-hidden="true" />
      <div className={styles.scrim} />
    </>
  )

  // statusBar——2026-10 新增(使用者明確要求「手機上方放信號跟電量」):
  // 動態島兩側的 iOS 狀態列裝飾,純視覺、不即時更新(對齊 Apple 行銷
  // 素材慣用的固定時間「9:41」,這裡同樣寫死一個時間字串,不需要真的
  // 讀系統時鐘——這個展示框本身就是模擬畫面,不是在演示系統 UI 本身的
  // 即時性)。aria-hidden:這些圖示/文字不帶任何實際資訊,不該被輔助
  // 技術當成有意義內容朗讀。
  //
  // stacked 時不渲染(2026-10,使用者明確要求「手機版的不用時間與手機
  // 信號這些」):frameless 模式(stacked=true,只有首頁 ScrollPlanDemo
  // 會傳)本來就已經拿掉手機外框造型(見 AiPlanPhoneDemo.module.css
  // .screenFrameless 圓角拿掉時的完整說明:「這個模式視覺上就是一塊
  // 普通內容區,不假裝自己是手機螢幕的一部分」)——外框都不裝了,內部
  // 卻還疊著「9:41+訊號+WiFi+電量」這組只有真正手機螢幕造型才有意義
  // 的狀態列裝飾,邏輯上互相矛盾。/product 功能介紹卡(疊圖模式,仍是
  // 完整手機外框)維持原樣,繼續渲染這個狀態列。
  const statusBar = stacked ? undefined : (
    <div aria-hidden="true" className={styles.statusBarContent}>
      <span className={styles.statusBarTime}>9:41</span>
      <span className={styles.statusBarIcons}>
        <SignalHigh size={15} strokeWidth={2.2} />
        <Wifi size={15} strokeWidth={2.2} />
        <BatteryFull size={18} strokeWidth={1.8} />
      </span>
    </div>
  )

  return (
    <PhoneDemoLayout
      mapBackground={mapBackground}
      statusBar={statusBar}
      // caption 插槽另外帶上 timelineHint——2026-10(使用者明確要求「往下
      // 捲動的字放在時間軸還沒顯示的區域」,只有 stacked=frameless 才有):
      // timeline 還沒有任何一天時,把提示文字絕對定位在時間軸那塊區域置中
      // (見 .timelineHint),第一張卡片長出來後(出現第一天之後)自動
      // 消失。為什麼放在 caption 插槽而不是 timeline 插槽:首頁有單一
      // 圓形遮罩蓋在地圖與時間軸(z=2)之上、caption(z=3)之下(見
      // ScrollPlanDemo.module.css .stickyRevealMask),提示文字寫在
      // timeline 插槽裡會被遮罩蓋住、揭示前看不到;放進 caption 插槽就
      // 跟文字同層,不受遮罩影響。絕對定位的 containing block 是
      // .screen(位置 relative),不會被 .captionStacked 的 overflow:
      // hidden 裁掉。
      caption={
        stacked && timeline.days.length === 0 ? (
          <>
            {caption}
            <p className={styles.timelineHint}>往下捲動，看 AI 排出一天的行程</p>
          </>
        ) : caption
      }
      stacked={stacked}
      // timeline——onSelectStop/onOpenPhotos:這個展示框不做互動
      // (2026-10 使用者明確定調「小展示不做互動」,這次換成橫向版延續
      // 同一個定調),給最小可用的 no-op 滿足型別:onSelectStop 仍然
      // 接上 setSelectedStopId(讓使用者手動點擊卡片時至少視覺上能
      // 正確反應,雖然整個展示框是 pointer-events:none、實際上點不到),
      // onOpenPhotos 整個不處理(沒有 Lightbox 覆蓋層可以開,這個
      // 展示框沒有那層 UI)。
      //
      // composer 插槽——2026-10 開場輸入膠囊、以及後續「試試看」按鈕
      // 都已整個移除(使用者明確要求「首頁展示不要輸入框」;「試試看」
      // 按鈕的真正位置已搬到 AiPlanPhoneDemo.tsx 的 .tryItCtaOutside,
      // 在縮放容器之外,見該檔案的完整說明——這裡原本殘留一份引用已
      // 刪除 CSS class 的重複死碼,一併清除,不留在 composer 插槽裡)。
      // 不傳 composer,插槽不會渲染,.timelineSlot 的 padding-bottom
      // 維持原有數值撐出相同的版面空間(視覺位置不變)。
      // 資料存取層在這個展示的根部決定一次:假資料(純前端,不打後端),時間軸向 PlanDataProvider 的共用 store 取解析結果。
      timeline={(
        <PlanDataProvider dataSource={planAiFakeDataSource}>
          <HorizontalPlanTimeline
            timeline={timeline}
            nodeStatus={nodeStatus}
            selectedStopId={selectedStopId}
            onSelectStop={setSelectedStopId}
            onOpenPhotos={() => {}}
            isGenerating={isGenerating}
            focusLatest={focusLatest}
            stackedLayout={stacked}
          />
        </PlanDataProvider>
      )}
    />
  )
}

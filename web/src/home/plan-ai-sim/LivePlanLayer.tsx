import { useCallback, useMemo, useState } from 'react'
import { TripPlanPage } from '../../trip-plan/TripPlanPage'
import { BASE_URL } from '../../AppCommon'
import type { ClientConfig } from '../../api'
import { useIsDesktop } from '../../hooks/useIsDesktop'
import { NEW_TRIP_DRAFT_ENABLED } from '../../DesktopShared'
// createDraftPlanTimelineStore/startNewDraft——「新行程」按鈕(見
// NEW_TRIP_DRAFT_ENABLED 的完整說明,定義在 DesktopShared.tsx,跟
// TIME_DRAG_ENABLED 等既有 feature flag 放在同一個共用檔案)的資料層,
// plan-core/planTimelineDrafts.ts 已經實作完成(多份草稿的索引/各自
// 獨立 localStorage key/store 工廠函式),這裡只負責「交接後的真實層
// 要不要接上這個功能」這一層決定。
import { localStoragePlanTimelineStore, type PlanTimelineStore } from '../../plan-core/planTimelineStorage'
import { createPlanAiPublicDataSource } from './planAiPublicDataSource'
import { createDraftPlanTimelineStore, startNewDraft } from '../../plan-core/planTimelineDrafts'

// LivePlanLayer — /ai-plan 按下「讓我試看看」之後接手的真實 AI 對話層。
//
// 跟同目錄 AIPlanTimelinePage 的模擬層是互斥的兩層:模擬層播固定腳本
// (planSimScript)、不打任何後端;這一層直接複用 /app 的正式功能元件
// TripPlanPage,連真的 onagent、呼叫真的工具、排出真的行程。
//
// 為什麼直接用 TripPlanPage 而不是另寫一份:它已經是完整的「對話 +
// 時間軸」實作(agent bridge、工具註冊、地點補查、交通估算、持久化),
// 而且介面乾淨——只有 cfg 是必填,其餘都是選填的回調。兩邊共用同一份
// 實作,日後正式功能的改進會自動反映到這個展示入口,不需要兩邊各改一次。
//
// ─────────────────────────────────────────────────────────────
// TODO(交接):這一層目前只是框架,還差這些事
//
// 1. 訪客無法真的排行程(最優先)——已完成,見另一個 commit:
//    handlePublicGeo* 系列已多註冊一份到 publicMux,搭配 IP 節流。
//
// 2. 交接後地圖沒有跟著走——已完成:見下方 onStopsChange/
//    onSelectedStopChange/onHoverStopChange 三個 props,原樣轉呼叫給
//    TripPlanPage 同名 prop,由外層 AIPlanTimelinePage 接住寫進
//    liveStops/liveSelectedStopId/liveHoverStopId 這組 state,餵給
//    usePlanStopMarkers(handedOver 為 true 時的資料來源)。
//
// 3. 沒有回到模擬的路徑
//    handedOver 是單向的,按下去就回不去。目前沒有需求,但如果要做,
//    注意模擬的腳本播放是一次性的(usePlanSimSocket 的 start 參數),
//    重播需要另外設計。
// ─────────────────────────────────────────────────────────────
//
// 已知限制(2026-10 更新):對話本身(送出訊息/收 AI 回覆存檔)已經不受
// 這個限制——TripPlanPage 的 postPlanAiChat/postPlanAiChatReply(見
// api.ts 兩者的完整說明)會依 cfg.token 是否存在,自動切換打需登入版
// 或新增的免登入版(POST /public/plan-ai/chat[/reply],見後端
// handlePlanAiChat 開頭的完整說明),訪客能正常對話、訊息也會正確存檔
// 到各自獨立的身分底下(見 web/src/guestId.ts 的完整說明)。
//
// 2026-10 已完成:agent 工具(search_attraction/add_attraction 等,見
// plan-core/attractionTools.ts)用的那幾支前端函式
// (fetchPlanAiPlaceSearch/fetchPlanAiAttractionSearch/
// fetchPlanAiPlaceDetailsAny)已比照 postPlanAiChat 依 cfg.token 切換
// /internal 與 /public 兩組路徑,未登入訪客打的是公開版
// (見 server/internal/api/geo_plan_ai.go 開頭的完整說明),工具呼叫
// 不再拿到 401,訪客可以真的排出站點。api.plan-ai-guest.integration.test.ts
// 守住這件事。唯一的例外是 transit-estimate:後端沒有公開版,訪客模式
// 那一段交通資訊完全不顯示(見 planAiPublicDataSource.ts 的完整說明)。
// LivePlanLayerProps——onStopsChange/onSelectedStopChange/onHoverStopChange
// 三個型別直接取自 TripPlanPage 本身對應 prop 的型別(用 Parameters 萃取
// 而非重新宣告一份一樣的型別字面值),這一層只是原樣轉呼叫給內部的
// TripPlanPage(見下方 JSX),型別定義只需要有一份,TripPlanPage 的 props
// 日後若調整,這裡不會因為手動複製一份而悄悄跟著脫鉤。
type TripPlanPageProps = Parameters<typeof TripPlanPage>[0]

interface LivePlanLayerProps {
  onStopsChange?: TripPlanPageProps['onStopsChange']
  onSelectedStopChange?: TripPlanPageProps['onSelectedStopChange']
  onHoverStopChange?: TripPlanPageProps['onHoverStopChange']
}

export function LivePlanLayer({ onStopsChange, onSelectedStopChange, onHoverStopChange }: LivePlanLayerProps) {
  // activeDraftId——null 代表「還在用舊的固定單一草稿」(/app 共用的
  // localStoragePlanTimelineStore,見下方 store 的完整說明),非 null
  // 代表使用者已經按過至少一次「新行程」,目前指向 planTimelineDrafts.ts
  // 管理的某一份獨立草稿。只有 NEW_TRIP_DRAFT_ENABLED 開啟時才可能變成
  // 非 null(見下方 handleNewDraft 的完整說明)。
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)

  // store——依 activeDraftId 決定這次掛載的 TripPlanPage 要用哪個
  // PlanTimelineStore。null 時維持原本行為(跟 /app 共用同一份固定
  // localStorage 草稿,見下方 TripPlanPage store prop 呼叫處的既有
  // 說明),不受這次新增的「多份草稿」機制影響——這正是使用者要求「不要
  // 讓 /app 等既有單一草稿行為受到任何影響」的落地:沒有按過「新行程」
  // 之前,這個呼叫端的行為跟這次改動之前完全一樣。
  const store: PlanTimelineStore = useMemo(
    () => (activeDraftId == null ? localStoragePlanTimelineStore : createDraftPlanTimelineStore(activeDraftId)),
    [activeDraftId],
  )

  // handleNewDraft——「新行程」按鈕的點擊處理(見
  // plan-core/planTimelineDrafts.ts startNewDraft 的完整說明)。
  //
  // 目前這份內容(若非空)先歸檔進草稿清單,再切到一份全新的草稿 id——
  // 讀「目前這份內容」用目前的 store.loadTimelineWithRev(),不需要從
  // TripPlanPage 內部另外把 timeline 往上傳一份:store 本身就是讀寫這份
  // 內容的介面,這裡要讀的正是它。
  const handleNewDraft = useCallback(() => {
    const current = store.loadTimelineWithRev()
    const newId = startNewDraft(activeDraftId, current.timeline)
    setActiveDraftId(newId)
  }, [store, activeDraftId])

  // mountKey——activeDraftId 改變時,靠 React key 讓 TripPlanPage 整個
  // 重新掛載,改用新的 store 從頭初始化(見該元件 useTripPlanTimeline 的
  // initialRef 寫法:store 只在掛載當下讀一次,不支援執行中途換掉背後的
  // key 空間)。null 時給一個固定字串,不是 TripPlanPage 本身需要知道的
  // 概念,純粹是這裡用來控制掛載時機的實作細節。
  const mountKey = activeDraftId ?? 'legacy'
  // isDesktop——2026-10 新增(使用者明確要求「兩個不同的層,時間軸要
  // 共用相同的,只有資料層不一樣」):手機版時對內部 TripPlanPage 傳
  // horizontalTimeline,讓交接後的真實層手機版畫面跟交接前的模擬層
  // 手機版畫面共用同一個 HorizontalPlanTimeline 渲染元件,不是各自一份
  // (模擬層橫向、交接後縱向)。桌面版不受影響,繼續渲染縱向
  // PlanTimelineView(horizontalTimeline 預設 false,見該 prop 的完整
  // 說明)。
  const isDesktop = useIsDesktop()
  // publicDataSource——見下方 dataSource prop 的完整說明。useMemo 讓
  // 參照穩定:它會往下傳進 TripPlanPage 的 useMemo 依賴陣列。
  const publicDataSource = useMemo(() => createPlanAiPublicDataSource(BASE_URL), [])
  // cfg — 從 localStorage 讀目前的登入 token。
  //
  // 刻意不走 useAppState():那支 hook 還負責旅程清單、主題、登出等一整
  // 套登入後的狀態機,這個公開展示頁只需要「有沒有 token」這一件事,
  // 引進整個 hook 會讓這一層依賴到跟它無關的東西。
  //
  // 讀不到 token 時傳 null(訪客)——request() 會因此不帶
  // Authorization header,行為跟其他公開頁的 GUEST_CFG 一致。
  const cfg = useMemo<ClientConfig>(() => {
    let token: string | null = null
    try {
      token = localStorage.getItem('tripace.auth.token')
    } catch {
      // localStorage 被停用(無痕模式等)——當作訪客處理,不讓整頁壞掉。
    }
    return { baseURL: BASE_URL, token }
  }, [])

  // compact — 這一層被放進 /ai-plan 的 .timelinePanel 裡(固定寬度的
  // 側欄,不是整頁),跟地圖對話小匡是同一種容器情境:沒有祖先在管捲動,
  // 需要 TripPlanPage 自己變成固定高度的 flex 容器、由時間軸區塊接手
  // 捲動。見該元件 compact prop 的完整說明。
  return (
    <TripPlanPage
      // key——activeDraftId 改變時強制重新掛載(見 mountKey 的完整
      // 說明),不是 TripPlanPage 本身支援「執行中途換 store」。
      key={mountKey}
      cfg={cfg}
      compact
      // store——2026-10(第三輪,「新行程」按鈕,見 activeDraftId/handleNewDraft
      // 的完整說明):activeDraftId 為 null 時維持第二輪的既有行為,傳
      // localStoragePlanTimelineStore(使用者明確要求「讓我試試看進入後的
      // 介面,置換成持久的對話內容」——交接後跟 /app 共用同一份
      // localStorage 草稿,使用者在 /ai-plan 排的內容,之後打開 /app
      // 應該看得到同一份)。按過「新行程」之後改傳指向新草稿 id 的
      // createDraftPlanTimelineStore 實例,這份內容不寫進 /app 共用的那個
      // 固定 key,兩者的 localStorage key 空間完全分開(見
      // plan-core/planTimelineDrafts.ts 的完整說明)。
      store={store}
      // transparentBackground——讓底下 AIPlanTimelinePage 的
      // NativeMapBase(交接前後同一個地圖實例,不會重新掛載)能透出來,
      // 不被這個元件自己預設的實色背景蓋住(見該 prop 的完整說明:
      // 實機回報「試試看時背景是空白的」,根因是這個元件的空狀態提示
      // 文字疊在不透明背景上,把地圖整個蓋住了)。
      transparentBackground
      // hideEmptyState——不顯示「想去哪裡玩?跟我說說你的想法……」這段
      // /app 新手引導文案(見該 prop 的完整說明:使用者剛看完展示按下
      // 「讓我試看看」,不需要這段對一般使用者合理的引導提示)。
      hideEmptyState
      // horizontalTimeline——見上方 isDesktop 的完整說明。
      horizontalTimeline={!isDesktop}
      // dataSource——展示頁推論態固定用公開實作(使用者明確要求「展示內
      // 用公開的」、「展示的撥放態跟推論態也是不一樣的存取層」)。
      //
      // 這個頁面不需要登入就能看,TripPlanPage 預設的
      // createPlanAiApiDataSource 打的是 /internal/*,未登入一律 401
      // ——實機看到照片連噴 8 次、交通 2 次。公開實作全部改打 /public/*。
      //
      // 三個階段三份實作,不是一份實作內部判斷 cfg.token:
      //   播放態(模擬劇本)  planAiFakeDataSource        純前端假資料
      //   推論態(這裡)      createPlanAiPublicDataSource /public/*
      //   /app              createPlanAiApiDataSource    /internal/*
      dataSource={publicDataSource}
      // onNewDraft——見 TripPlanPage.tsx 該 prop 的完整說明。只在
      // NEW_TRIP_DRAFT_ENABLED(DesktopShared.tsx)開啟時傳,關閉時維持
      // undefined——TripPlanPage 沒收到這個 callback 就不會渲染「新行程」
      // 按鈕,不需要在這裡另外包一層條件判斷要不要渲染什麼 UI,呼叫端
      // 只需要決定要不要給它這個能力。
      onNewDraft={NEW_TRIP_DRAFT_ENABLED ? handleNewDraft : undefined}
      // initialAskPage——2026-10(使用者明確要求「進入推論態一開始就顯示
      // 詢問要去那裡的國家清單」):交接後一掛載就把國家選單擺上,使用者
      // 點一下就能往下走,不用先自己想出一句話描述需求。
      //
      // { country: {} }——空的 AskPageCountryInput 表示「顯示全部國家」
      // (countryIds 省略即不篩選,見 askPageTools.ts 該型別的完整說明),
      // 跟 LLM 呼叫 ask_travel_country 不帶 countryIds 時走的是同一條
      // 渲染路徑,不是另一套只有這裡用的特例。
      //
      // 不帶 reason:那個欄位是給 LLM 用一句話說明「為什麼現在問這個」
      // (會取代畫面上的預設標題)。這次開啟不是 LLM 的決定,是進頁的
      // 固定行為,沒有特別的意圖要說明——交給 RegionPanel 用它自己的
      // 預設標題(「要去哪個國家?」)即可。
      //
      // 選完之後的串接不在這裡:使用者點完國家會由 TripPlanPage 的
      // handleAskPageDone 自動接到城市層、選完城市再送一句話給 LLM
      // (見該函式的完整說明),這個呼叫端只負責「開啟第一層」。
      initialAskPage={{ country: {} }}
      onStopsChange={onStopsChange}
      onSelectedStopChange={onSelectedStopChange}
      onHoverStopChange={onHoverStopChange}
    />
  )
}

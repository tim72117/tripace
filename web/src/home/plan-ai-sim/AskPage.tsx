import { useEffect, useState } from 'react'
import { Bike, Bus, Car, Check, MapPin, PersonStanding, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { PlanAiDataSource } from './planAiDataSource'
import type {
  AskPageCandidate,
  AskPageCityInput,
  AskPageCountryInput,
  AskPageExplore,
  AskPageInput,
  AskPageSelection,
  TransportMode,
} from '../../plan-core/askPageTools'
import { findTravelCountry, listTravelCities, listTravelCountries } from '../../plan-core/travelRegionData'
import styles from './AskPage.module.css'

// AskPage——2026-10 新增(使用者明確要求「時間軸下的圖卡區可以更換
// 顯示,類似頁籤轉換,但不要顯示頁籤,先製作另一個頁面,一進來的時候
// 先顯示,就是只顯示一個圖卡」)。
//
// 跟 HorizontalPlanTimeline(時間尺下方的橫向站點卡片列,溝通時雙方
// 稱為「軸線頁」)共用同一塊版面空間,互斥顯示——不是疊加,同一時刻
// 只有一個在畫面上。這個元件自己稱為「詢問頁」(對齊溝通時的代稱)。
//
// 2026-10(第二輪,使用者明確要求「目前要可以輸出 attraction id 與
// place id,前端拿到後用對應的 UI 呈現」):內容從「選行程類別」(古蹟/
// 美食/展館/戶外活動,DESTINATION_DIRECTIONS)整個改成「選具體景點」。
// 候選景點由呼叫端(open_ask_page 工具,見 plan-core/askPageTools.ts
// 的完整說明)透過 candidates prop 傳入,每筆只帶 placeId(+ 選填的
// name/summary 當暫時標題)——這個元件掛載時對每筆候選背景呼叫
// dataSource.placeDetails(placeId)補齊完整資料(真實名稱/簡介/照片,
// 已建檔景點另有 attractionId),查詢完成前先顯示候選本身帶來的暫時
// 標題,查無資料或查詢失敗就維持暫時標題、不顯示照片——這套「先用
// 輕量識別碼顯示、背景補完整資料」的模式對齊 attractionTools.ts 的
// addAttraction 既有設計(loading 佔位 + 背景反查),不是這個元件自己
// 發明一套。
//
// dataSource 用 PlanAiDataSource 介面(見該檔案的完整說明),不是直接
// 收 ClientConfig 呼叫 fetchPlanAiPlaceDetailsAny——這個元件同時被
// /app 正式頁(TripPlanPage.tsx,真後端,candidates 的 placeId 是真實
// Google Place ID)跟 /ai-plan 展示頁(home/plan-ai-sim/Content.tsx,假資料,
// candidates 的 placeId 是 attractionPool.ts 自己的 id,見
// planSimScript.ts 開頭說明)共用,若直接打需要登入的後端 API,對展示
// 頁傳入的假 placeId 查詢必然失敗(查無資料,或命中真實後端但查不到
// 對應紀錄)。兩邊呼叫端各自注入對應的 PlanAiDataSource 實作
// (planAiFakeDataSource/createPlanAiApiDataSource,見該檔案的完整
// 說明),這個元件不需要知道自己被哪一邊呼叫。
//
// 選取邏輯(toggleCandidate/selectedPlaceIds)是這個元件自己獨立管理的
// state。onDone 現在帶一個 AskPageSelection[] 參數(取代舊版無參數的
// onDone()):「確認選擇」按鈕回傳使用者勾選的候選(對應的 attractionId
// 從已查到的詳細資料帶出,查無資料的候選只回傳 placeId);「不用了」
// 按鈕(使用者明確要求取代舊版「都可以」的語意)回傳空陣列,讓呼叫端
// (open_ask_page 工具)知道使用者明確拒絕了這批候選,不是隨便選了
// 一個。呼叫端(TripPlanPage.tsx 的 askPageCtx)把這個陣列轉成
// AskPageSelection[] resolve 掉 open_ask_page 回傳給 LLM 的 Promise。
//
// 2026-10(第三輪,使用者明確要求「open_ask_page 輸入支援一個模式,
// 探查模式,參數有三個類別 目的地（文字）地圖中心 使用者位置,會自動
// 用這些資訊送入 search_attraction 取得清單後顯示」):input prop 從
// 單純的 candidates 陣列改成 candidates 或 explore 其中一種(見
// plan-core/askPageTools.ts AskPageExplore 的完整說明)。explore 模式
// 下這個元件自己呼叫 dataSource.searchNearby(見該方法的完整說明)查出
// 候選清單,查到之後走跟 candidates 模式完全一樣的「背景查詢每筆候選
// 完整資料」流程(resolveCandidates,見下方)——兩種模式的差異只在
// 「候選清單從哪裡來」,查到候選之後的渲染/選取/confirm 邏輯共用同一
// 套,不需要分岔成兩套畫面。
//
// 2026-10(第四輪,使用者明確要求「後端的純文字對話也統一在 ask page
// 裡面顯示對話氣泡」):新增第三種 input 形態 { text }——後端 LLM 的
// 一般文字回覆(沒有呼叫 open_ask_page 工具,只是常規對話),不帶任何
// 候選景點。這個形態原本是 HorizontalPlanTimeline.tsx 自己渲染的
// agentBubbleRow(見該檔案被移除的那段完整說明),搬過來統一由這個
// 元件負責——呼叫端(TripPlanPage.tsx/Content.tsx 的
// onAssistantMessage)收到純文字回覆時改成呼叫 openAskPage({ text })
// 讓畫面自動切到這裡,不再是「插入時間軸節點 + 軸線頁上方疊一個獨立
// 氣泡」兩件事分開做。使用者關閉氣泡或畫面被新一輪 open_ask_page/
// 文字覆蓋時,都走同一條 onDone([]) 路徑切回軸線頁。
//
// 2026-10(第五輪,使用者明確要求「使用相同的 ask page 外殼,但是內部的
// 詢問元件可以搭配不同的工具顯示不同的項目,目前有選擇旅遊區域,交通
// 方式,感興趣地點三種不同的工具」):這個元件原本只有一種「候選卡片」
// 內部畫面(candidates/explore 共用),現在重構成「外殼 + 依 input 分派
// 的內部元件」——外殼(.wrap/.bubble/.question/.actions,見
// AskPage.module.css 的完整說明)維持不變,原本的候選卡片邏輯整段抽成
// CandidatesPanel(見下方),新增 RegionPanel(旅遊區域,單選)、
// TransportPanel(交通方式,單選)兩個內部元件,這個元件本體只負責讀
// input 是哪個 key、把對應的內容交給外殼包起來顯示,不在這裡混寫三種
// 元件各自的渲染邏輯。
//
// 三個面板的「確認」語意不同,刻意不共用同一套 selectedIds state:
// CandidatesPanel 複選(可以同時選好幾個景點,「確認選擇」按鈕才送出),
// RegionPanel/TransportPanel 單選且點選當下就直接送出(不需要再按一次
// 確認——單選情境下「點了就是選了」比「點了還要再按確認」更直覺,少一
// 次操作),只保留一個「不用了」按鈕。

// CandidateDetails——每筆候選背景查詢完成後補上的完整資料,只保留這個
// 卡片畫面實際會用到的欄位(名稱/簡介/照片/attractionId),不是整份
// GeoPlanAiPlaceDetailsAnyResult 原樣存下來——這個元件不需要 lat/lng/
// address 等它不顯示的欄位。
interface CandidateDetails {
  name?: string
  summary?: string
  photoUrl?: string
  attractionId?: string
  loading: boolean
}

export interface AskPageProps {
  // dataSource——背景查詢候選完整資料需要的讀取層(見 planAiDataSource.ts
  // 的完整說明:真後端/假資料各自的實作),對齊
  // attractionTools.ts/Content.tsx 既有的注入慣例。探查模式
  // 下還會用到 dataSource.searchNearby(見該方法的完整說明)。
  dataSource: PlanAiDataSource
  // input——AskPageInput(見 plan-core/askPageTools.ts 的完整說明),
  // 依哪個 key 存在分派到對應的內部元件。
  input: AskPageInput
  // onDone——使用者完成詢問頁的操作時觸發,帶使用者選取的候選(「不用了」
  // 時是空陣列,見上方檔頭的完整說明)。呼叫端收到後把顯示切回軸線頁,
  // 並把這個陣列轉發給等待中的 open_ask_page/ask_travel_country/
  // ask_travel_city/ask_transport_mode 工具呼叫。
  onDone: (selected: AskPageSelection[]) => void
  // onBack——2026-10(第十輪)只有 CityPanel 在 input.city.back 有值時
  // 會用到(見 CityPanel 的完整說明:「返回上一層」按鈕),選填——
  // home/plan-ai-sim/Content.tsx 的展示頁劇本不支援這個互動(劇本內容固定,
  // 沒有真正的國家/城市串接流程),不傳就不渲染這顆按鈕。跟 onDone 不
  // 同:onDone 結束整個詢問(resolve 掉等待中的工具呼叫),onBack 只是
  // 换另一個 input 重新開一個詢問頁,不結束任何東西——呼叫端
  // (TripPlanPage.tsx)收到後呼叫 openAskPage({ country: { countryIds }
  // }),不是 resolveAskPage。
  onBack?: (countryIds?: string[]) => void
  // stacked——寬螢幕側欄(PlanOverlayPanel 的 wide 分支,見該元件的完整說明)改用
  // 縱向堆疊的橫式列表,取代預設的橫向捲動小卡(使用者明確要求「所有的
  // 詢問項目都要換」,2026-10 新增)。往下傳給四個子面板(CandidatesPanel/
  // CountryPanel/CityPanel/TransportPanel),各自依這個值切換對應的
  // *Stacked class(見 AskPage.module.css 的完整說明)。text 模式(純
  // 文字對話氣泡)沒有候選卡片這種排列可言,不受這個 prop 影響。選填,
  // 省略時維持原本的橫向捲動,對齊既有呼叫端(/ai-plan 手機版、尚未
  // 接上這個 prop 的其他呼叫點)不需要改動就能繼續運作。
  stacked?: boolean
}

export function AskPage({ dataSource, input, onDone, onBack, stacked }: AskPageProps) {
  // text 模式(見上方檔頭「第四輪」的完整說明):純文字對話氣泡,沒有
  // 候選卡片/選取/確認這些互動,跟其餘模式的渲染邏輯完全不共用,在這裡
  // 直接短路回傳,不進外殼的 .bubble/.question/.actions 結構(文字氣泡
  // 用自己的 .messageBubble,視覺語言不同於候選/選項卡片)。關閉氣泡
  // 視同使用者「不用了」,統一走 onDone([]) 切回軸線頁——這則文字本身
  // 已經在 onAssistantMessage 當下被插入時間軸的 message 節點存檔,
  // 不需要這裡另外回報什麼。
  if ('text' in input) {
    return (
      <div className={styles.wrap}>
        <div className={[styles.bubble, styles.messageBubble, input.stale ? styles.messageBubbleStale : '']
          .filter(Boolean)
          .join(' ')}
        >
          <button
            type="button"
            className={styles.messageCloseBtn}
            onClick={() => onDone([])}
            title="關閉"
          >
            <X size={14} strokeWidth={2} />
          </button>
          <div className={styles.messageMarkdown}>
            <ReactMarkdown>{input.text}</ReactMarkdown>
          </div>
        </div>
      </div>
    )
  }

  if ('country' in input) {
    return <CountryPanel input={input.country} onDone={onDone} stacked={stacked} />
  }

  if ('city' in input) {
    return <CityPanel input={input.city} onBack={onBack} onDone={onDone} stacked={stacked} />
  }

  if ('transport' in input) {
    return <TransportPanel modes={input.transport} reason={input.reason} onDone={onDone} stacked={stacked} />
  }

  return <CandidatesPanel dataSource={dataSource} input={input} onDone={onDone} stacked={stacked} />
}

// CandidatesPanel——感興趣地點:候選景點照片卡片,可複選,「確認選擇」
// 才送出。這是原本整個 AskPage.tsx 的內容(candidates/explore 兩種
// input 共用同一套渲染,見上方檔頭「第三輪」的完整說明),重構時整段
// 原封不動搬進這個子元件,邏輯沒有變動。
function CandidatesPanel({
  dataSource,
  input,
  onDone,
  stacked,
}: {
  dataSource: PlanAiDataSource
  input: { candidates: AskPageCandidate[]; reason?: string } | { explore: AskPageExplore; reason?: string }
  onDone: (selected: AskPageSelection[]) => void
  stacked?: boolean
}) {
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<string[]>([])
  // candidates——這個元件實際要顯示的候選清單,explore 模式下由
  // resolveCandidates(見下方 effect)查出後寫入,candidates 模式下
  // 直接是 input.candidates。用自己的 state 管理(而非直接讀
  // input.candidates),是因為 explore 模式下候選清單要等
  // searchNearby 查完才有值,掛載當下是空的。
  const [candidates, setCandidates] = useState<AskPageCandidate[]>('candidates' in input ? input.candidates : [])
  // exploring——探查模式查詢候選清單期間的 loading 狀態,渲染一個
  // 「查詢中…」的空狀態,對齊查詢完整資料階段每張卡片各自顯示「查詢
  // 中…」的既有視覺語言(見下方 directionLabel 的渲染邏輯),不是這次
  // 另外發明一套載入樣式。
  const [exploring, setExploring] = useState('explore' in input)
  // details——key 是 placeId,value 是該候選背景查詢的結果(或查詢中的
  // loading 狀態)。用 Map 而非在 candidates 陣列本身疊加欄位,是因為
  // candidates 是呼叫端傳入的 prop(不該被這個元件直接修改),查詢結果
  // 另外用自己的 state 管理,渲染時兩者合併讀取(見下方 JSX)。
  const [details, setDetails] = useState<Map<string, CandidateDetails>>(new Map())

  function toggleCandidate(placeId: string) {
    setSelectedPlaceIds((prev) => (prev.includes(placeId) ? prev.filter((x) => x !== placeId) : [...prev, placeId]))
  }

  // explore 模式:查詢候選清單本身——掛載時執行一次(理由同下方
  // resolveCandidates 的 effect:呼叫端每次開詢問頁都是重新掛載一個
  // 新的 AskPage 實例,input 在這個元件的生命週期內不會變)。
  // searchNearby 未提供(dataSource 沒有實作這個選填方法)或查詢失敗
  // 時,candidates 維持空陣列——使用者會看到一個沒有候選卡片、只剩
  // 「不用了」按鈕可按的空狀態,不會整頁壞掉。
  useEffect(() => {
    if (!('explore' in input)) return
    const explore = input.explore
    if (!dataSource.searchNearby) {
      setExploring(false)
      return
    }
    // searchInput——依 plan-core/askPageTools.ts parseOpenAskPageArgs
    // 的既有優先序(destination > mapCenter > userLocation,見該函式
    // 的完整說明)決定實際查詢依據,這裡沿用同一個順序,保持前後端(其實
    // 是同一份前端程式碼的兩個檔案,但語意上對齊「決策只該有一處」)
    // 判斷一致。
    const searchInput = explore.destination
      ? { query: explore.destination }
      : explore.mapCenter
        ? { coords: explore.mapCenter }
        : explore.userLocation
          ? { coords: explore.userLocation }
          : null
    if (!searchInput) {
      setExploring(false)
      return
    }
    let cancelled = false
    dataSource.searchNearby(searchInput)
      .then((result) => {
        if (cancelled) return
        setCandidates(result.candidates)
        setExploring(false)
      })
      .catch(() => {
        if (cancelled) return
        setExploring(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, dataSource])

  // 背景查詢每筆候選的完整資料——candidates 模式下掛載時執行一次;
  // explore 模式下候選清單由上面的 effect 查到才會有值,這個 effect
  // 的依賴陣列包含 candidates,查到候選的那一刻會自然觸發一次。
  useEffect(() => {
    if (candidates.length === 0) return
    let cancelled = false
    setDetails(new Map(candidates.map((c) => [c.placeId, { name: c.name, summary: c.summary, loading: true }])))
    for (const candidate of candidates) {
      dataSource.placeDetails(candidate.placeId)
        .then((result) => {
          if (cancelled) return
          setDetails((prev) => {
            const next = new Map(prev)
            next.set(candidate.placeId, {
              name: result.found && result.name ? result.name : candidate.name,
              summary: result.found ? result.summary : candidate.summary,
              photoUrl: result.found ? result.googlePhotoUrls?.[0] : undefined,
              attractionId: result.found ? result.attractionId : undefined,
              loading: false,
            })
            return next
          })
        })
        .catch(() => {
          // 查詢失敗(網路問題等)不影響整體流程——維持候選本身帶來的
          // 暫時標題,只是沒有照片/attractionId 可用,理由同
          // attractionTools.ts 其餘查詢失敗時的既有降級慣例。
          if (cancelled) return
          setDetails((prev) => {
            const next = new Map(prev)
            next.set(candidate.placeId, { name: candidate.name, summary: candidate.summary, loading: false })
            return next
          })
        })
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, dataSource])

  function handleConfirm() {
    const selected: AskPageSelection[] = selectedPlaceIds.map((placeId) => ({
      placeId,
      attractionId: details.get(placeId)?.attractionId,
    }))
    onDone(selected)
  }


  // exploring 時只顯示查詢中的提示,不渲染卡片列/操作按鈕——這個階段
  // candidates 必然是空陣列(探查查詢還沒回來),渲染空的卡片列跟「不用
  // 了/確認選擇」按鈕沒有意義,使用者此刻唯一能做的事是等待,對齊整個
  // 專案「查詢中顯示明確提示,不留一片空白」的既有慣例(見
  // frontend-design-guidelines 的「狀態要看得見」一節)。
  if (exploring) {
    return (
      <div className={styles.wrap}>
        <div className={styles.bubble}>
          <p className={styles.question}>{input.reason ?? '正在附近探查地點…'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={[styles.wrap, stacked ? styles.wrapStacked : ''].filter(Boolean).join(' ')}>
      <div className={[styles.bubble, stacked ? styles.bubbleStacked : ''].filter(Boolean).join(' ')}>
        <p className={styles.question}>{input.reason ?? '要安排這些地點嗎?'}</p>
        <div className={[styles.directionScroller, stacked ? styles.directionScrollerStacked : ''].filter(Boolean).join(' ')}>
          {candidates.map((candidate) => {
            const checked = selectedPlaceIds.includes(candidate.placeId)
            const detail = details.get(candidate.placeId)
            return (
              <button
                key={candidate.placeId}
                type="button"
                aria-pressed={checked}
                className={[
                  styles.directionCard,
                  stacked ? styles.directionCardStacked : '',
                  checked ? styles.directionCardChecked : '',
                ].filter(Boolean).join(' ')}
                onClick={() => toggleCandidate(candidate.placeId)}
              >
                {detail?.photoUrl ? (
                  <img
                    src={detail.photoUrl}
                    alt=""
                    className={[styles.directionPhoto, stacked ? styles.directionPhotoStacked : ''].filter(Boolean).join(' ')}
                  />
                ) : (
                  // stacked 模式的佔位縮圖——使用者明確指出「手機版的有
                  // 留空間,桌面版的連空間都沒有」:橫向捲動模式下卡片本身
                  // 是固定尺寸的方塊(見 .directionCard 的完整說明),沒有
                  // 照片時卡片仍維持同樣大小、只是內容空白,視覺上像是
                  // 「有留空間」;stacked 模式是圖文並排的列表樣式,沒有
                  // <img> 時沒有東西撐出縮圖寬度,整行會變成只剩文字靠左,
                  // 跟有照片的項目排列不整齊。這裡補一個跟
                  // .directionPhotoStacked 同尺寸的佔位色塊,維持版面
                  // 對齊。用通用的地圖釘子 icon(MapPin,跟 CountryPanel/
                  // CityPanel 既有的 .regionIcon 同一顆圖示,不是另外引入
                  // 新圖示),不依景點類型(餐廳/公園/景點等)顯示不同圖示
                  // ——AskPageCandidate/CandidateDetails 目前整條資料鏈路
                  // 都沒有攜帶類型欄位(2026-10,使用者明確要求「先改成
                  // 通用的地圖釘子佔位圖,最小改動先解決沒有空間的問題」,
                  // 類型區分留待之後有需要再擴充資料結構)。只在 stacked
                  // 模式顯示——橫向捲動模式本來就有「留空間」的效果,不
                  // 需要額外補一個佔位圖示。
                  stacked && (
                    <span className={styles.directionPhotoPlaceholder} aria-hidden="true">
                      <MapPin size={20} strokeWidth={2} />
                    </span>
                  )
                )}
                <span className={[styles.directionLabel, stacked ? styles.directionLabelStacked : ''].filter(Boolean).join(' ')}>
                  {detail?.loading ? '查詢中…' : (detail?.name ?? candidate.name ?? '未命名地點')}
                </span>
                {checked && <Check size={14} strokeWidth={3} className={styles.directionCheck} />}
              </button>
            )
          })}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.optionBtn} onClick={() => onDone([])}>
            不用了
          </button>
          <button
            type="button"
            className={`${styles.optionBtn} ${styles.directionConfirm}`}
            disabled={selectedPlaceIds.length === 0}
            onClick={handleConfirm}
          >
            {selectedPlaceIds.length > 0 ? `確認選擇(${selectedPlaceIds.length})` : '確認選擇'}
          </button>
        </div>
      </div>
    </div>
  )
}

// CountryPanel——旅遊國家:2026-10(第六輪,使用者明確要求「詢問區域的
// UI 不要做太細,主要是選國家跟區域」「UI 本身設定好選項,可以自動預設
// 顯示,也可以透過 LLM 進行部分控制」)從前端內建的固定清單
// (travelRegionData.ts,見該檔案的完整說明)讀取選項,不再由 LLM 自訂
// 候選內容——LLM 只用選填的 countryIds 篩選/排序要顯示哪些。
//
// 2026-10(第十輪,使用者明確要求「將國家與地區的工具分開,並做自動
// 串接」)從原本 RegionPanel(level 參數在同一個元件內部切層)拆成
// CountryPanel/CityPanel 兩個獨立元件——點選國家後不在這個元件內部
// 切換畫面,而是呼叫 onDone 結束這次詢問,交由呼叫端(TripPlanPage.tsx
// 的 handleAskPageDone,見該函式的完整說明)接著呼叫 openAskPage
// ({ city: {...} }) 開啟下一個詢問頁——跟「選完城市自動查景點」是
// 同一套串接機制(使用者明確指出「其他 next 也是這樣」:串接的本質是
// 前端在 handleAskPageDone 連續呼叫 openAskPage,不是靠單一元件內部
// state 切換),不是兩套不同的設計。
//
// 沒有背景查詢完整資料這一段——選項內容是前端內建的靜態清單,不像景點
// 候選需要另外查 Google Places 補照片,這個面板比 CandidatesPanel
// 單純得多,不共用它的 state/effect。
function CountryPanel({
  input,
  onDone,
  stacked,
}: {
  input: AskPageCountryInput
  onDone: (selected: AskPageSelection[]) => void
  stacked?: boolean
}) {
  // listTravelCountries——篩選邏輯抽到 travelRegionData.ts 共用(見該
  // 函式的完整說明:uiStateStore 要算出同一份清單,兩邊各寫一份會不一致)。
  const countries = listTravelCountries(input.countryIds)
  return (
    <div className={[styles.wrap, stacked ? styles.wrapStacked : ''].filter(Boolean).join(' ')}>
      <div className={[styles.bubble, stacked ? styles.bubbleStacked : ''].filter(Boolean).join(' ')}>
        <p className={styles.question}>{input.reason ?? '要去哪個國家?'}</p>
        <div className={[styles.directionScroller, stacked ? styles.directionScrollerStacked : ''].filter(Boolean).join(' ')}>
          {countries.map((c) => (
            <button
              key={c.id}
              type="button"
              className={[styles.regionCard, stacked ? styles.regionCardStacked : ''].filter(Boolean).join(' ')}
              onClick={() => onDone([{ placeId: c.id }])}
            >
              <MapPin size={18} strokeWidth={2} className={styles.regionIcon} />
              <span className={[styles.regionName, stacked ? styles.regionNameStacked : ''].filter(Boolean).join(' ')}>{c.name}</span>
            </button>
          ))}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.optionBtn} onClick={() => onDone([])}>
            不用了
          </button>
        </div>
      </div>
    </div>
  )
}

// CityPanel——旅遊城市:2026-10(第十輪)從 RegionPanel 拆出來的獨立
// 元件,顯示 input.countryId 底下的城市清單(cityIds 可篩選)。
//
// 返回上一層——2026-10 使用者明確要求「選單都要有選項可以返回上一層」
// 「CityPanel 記住上一次 country input 的 countryIds,原樣重現」:這個
// 元件本身不持有「上一層國家清單長什麼樣」的 state(拆成獨立工具後,
// 國家層跟城市層是兩次各自獨立的 AskPage 掛載,不是同一個元件內部
// 切換,見 CountryPanel 檔頭的完整說明),靠 input.back(見
// AskPageCityInput 的完整說明)重新生成——這個欄位只在「前端自動從
// 國家層串接到城市層」時才會有值,所以「返回上一層」按鈕只在這種情況
// 顯示;LLM 直接呼叫 ask_travel_city 問城市(沒有先問過國家)時,
// input.back 是 undefined,沒有「上一層」可以回去,不渲染這顆按鈕。
// onBack 由呼叫端(TripPlanPage.tsx)提供,點擊時重新呼叫
// openAskPage({ country: { countryIds: input.back.countryIds } }),
// 不是走 onDone——這不是使用者放棄這次詢問,只是想改選別的國家。
function CityPanel({
  input,
  onBack,
  onDone,
  stacked,
}: {
  input: AskPageCityInput
  onBack?: (countryIds?: string[]) => void
  onDone: (selected: AskPageSelection[]) => void
  stacked?: boolean
}) {
  const country = findTravelCountry(input.countryId)
  // listTravelCities——理由同 RegionPanel 的 listTravelCountries。
  const cities = listTravelCities(input.countryId, input.cityIds)
  const question = input.reason ?? (country ? `${country.name}要去哪裡?` : '要安排哪個城市?')
  return (
    <div className={[styles.wrap, stacked ? styles.wrapStacked : ''].filter(Boolean).join(' ')}>
      <div className={[styles.bubble, stacked ? styles.bubbleStacked : ''].filter(Boolean).join(' ')}>
        <p className={styles.question}>{question}</p>
        <div className={[styles.directionScroller, stacked ? styles.directionScrollerStacked : ''].filter(Boolean).join(' ')}>
          {cities.map((city) => (
            <button
              key={city.id}
              type="button"
              className={[styles.regionCard, stacked ? styles.regionCardStacked : ''].filter(Boolean).join(' ')}
              onClick={() => onDone([{ placeId: city.id }])}
            >
              <MapPin size={18} strokeWidth={2} className={styles.regionIcon} />
              <span className={[styles.regionName, stacked ? styles.regionNameStacked : ''].filter(Boolean).join(' ')}>{city.name}</span>
            </button>
          ))}
        </div>
        <div className={styles.actions}>
          {input.back && onBack && (
            <button type="button" className={styles.optionBtn} onClick={() => onBack(input.back!.countryIds)}>
              返回上一層
            </button>
          )}
          <button type="button" className={styles.optionBtn} onClick={() => onDone([])}>
            不用了
          </button>
        </div>
      </div>
    </div>
  )
}

// TRANSPORT_MODE_META——每種交通方式固定的圖示與中文標籤(見
// plan-core/askPageTools.ts TransportMode 的完整說明:LLM 只傳值本身,
// 不自訂顯示文字,避免每次呼叫顯示字樣不一致)。
const TRANSPORT_MODE_META: Record<TransportMode, { label: string; Icon: typeof Car }> = {
  walk: { label: '步行', Icon: PersonStanding },
  scooter: { label: '機車', Icon: Bike },
  car: { label: '開車', Icon: Car },
  transit: { label: '大眾運輸', Icon: Bus },
  bike: { label: '腳踏車', Icon: Bike },
}

// TransportPanel——交通方式:固定列舉(見 TRANSPORT_MODE_META),modes
// 參數決定顯示哪些、依什麼順序(見 askPageTools.ts
// parseAskTransportModeArgs 的完整說明),單選、點選當下直接送出。跟
// RegionPanel 同樣不需要背景查詢完整資料。
function TransportPanel({
  modes,
  reason,
  onDone,
  stacked,
}: {
  modes: TransportMode[]
  reason?: string
  onDone: (selected: AskPageSelection[]) => void
  stacked?: boolean
}) {
  return (
    <div className={[styles.wrap, stacked ? styles.wrapStacked : ''].filter(Boolean).join(' ')}>
      <div className={[styles.bubble, stacked ? styles.bubbleStacked : ''].filter(Boolean).join(' ')}>
        <p className={styles.question}>{reason ?? '這段要怎麼移動?'}</p>
        <div className={[styles.transportRow, stacked ? styles.transportRowStacked : ''].filter(Boolean).join(' ')}>
          {modes.map((mode) => {
            const meta = TRANSPORT_MODE_META[mode]
            return (
              <button
                key={mode}
                type="button"
                className={[styles.transportCard, stacked ? styles.transportCardStacked : ''].filter(Boolean).join(' ')}
                onClick={() => onDone([{ placeId: mode }])}
              >
                <meta.Icon size={22} strokeWidth={2} />
                <span className={styles.transportLabel}>{meta.label}</span>
              </button>
            )
          })}
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.optionBtn} onClick={() => onDone([])}>
            不用了
          </button>
        </div>
      </div>
    </div>
  )
}

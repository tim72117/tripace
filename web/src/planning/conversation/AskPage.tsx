import { useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { PlanAiDataSource } from '../data/source'
import { AskShell } from './AskShell'
import { SkeletonBlock, SkeletonRegion } from '../../components/Skeleton'
import { AskOptionList } from './AskOptionList'
import { RegionOption } from './RegionOption'
import { TransportOption } from './TransportOption'
import { CandidateCard } from './CandidateCard'
import { useHeightTransition } from './useHeightTransition'
import { askDirectionBetween, askLayerOf } from './askTransition'
import type {
  AskPageCandidate,
  AskPageCandidatesBack,
  AskPageCityInput,
  AskPageCountryInput,
  AskPageExplore,
  AskPageInput,
  AskPageSelection,
  TransportMode,
} from './asktools'
import { findTravelCountry, listTravelCities, listTravelCountries } from './travelRegionData'
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
// 候選景點由呼叫端(open_ask_page 工具,見 planning/conversation/asktools.ts
// 的完整說明)透過 candidates prop 傳入,每筆只帶 placeId(+ 選填的
// name/summary 當暫時標題)——這個元件掛載時對每筆候選背景呼叫
// dataSource.placeDetails(placeId)補齊完整資料(真實名稱/簡介/照片,
// 已建檔景點另有 attractionId),查詢完成前先顯示候選本身帶來的暫時
// 標題,查無資料或查詢失敗就維持暫時標題、不顯示照片——這套「先用
// 輕量識別碼顯示、背景補完整資料」的模式對齊 tools.ts 的
// addAttraction 既有設計(loading 佔位 + 背景反查),不是這個元件自己
// 發明一套。
//
// dataSource 用 PlanAiDataSource 介面(見該檔案的完整說明),不是直接
// 收 ClientConfig 呼叫 fetchPlanAiPlaceDetailsAny——這個元件同時被
// /app 正式頁(TripPlanPage.tsx,真後端,candidates 的 placeId 是真實
// Google Place ID)跟 /ai-plan 展示頁(planning/preview/Content.tsx,假資料,
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
// (使用者明確要求取代舊版「都可以」的語意;2026-10 起是氣泡右上角的關閉圖示鈕,aria-label 仍為「不用了」,
// 見 AskShell 的 onClose)回傳空陣列,讓呼叫端
// (open_ask_page 工具)知道使用者明確拒絕了這批候選,不是隨便選了
// 一個。呼叫端(TripPlanPage.tsx 的 askPageCtx)把這個陣列轉成
// AskPageSelection[] resolve 掉 open_ask_page 回傳給 LLM 的 Promise。
//
// 2026-10(第三輪,使用者明確要求「open_ask_page 輸入支援一個模式,
// 探查模式,參數有三個類別 目的地（文字）地圖中心 使用者位置,會自動
// 用這些資訊送入 search_attraction 取得清單後顯示」):input prop 從
// 單純的 candidates 陣列改成 candidates 或 explore 其中一種(見
// planning/conversation/asktools.ts AskPageExplore 的完整說明)。explore 模式
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
// 次操作),只保留「不用了」(氣泡右上角的關閉圖示鈕,見 AskShell 的 onClose)。

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
  // dataSource——背景查詢候選完整資料需要的讀取層(見 planning/data/source.ts
  // 的完整說明:真後端/假資料各自的實作),對齊
  // tools.ts/Content.tsx 既有的注入慣例。探查模式
  // 下還會用到 dataSource.searchNearby(見該方法的完整說明)。
  dataSource: PlanAiDataSource
  // input——AskPageInput(見 planning/conversation/asktools.ts 的完整說明),
  // 依哪個 key 存在分派到對應的內部元件。
  input: AskPageInput
  // onDone——使用者完成詢問頁的操作時觸發,帶使用者選取的候選(「不用了」
  // 時是空陣列,見上方檔頭的完整說明)。呼叫端收到後把顯示切回軸線頁,
  // 並把這個陣列轉發給等待中的 open_ask_page/ask_travel_country/
  // ask_travel_city/ask_transport_mode 工具呼叫。
  onDone: (selected: AskPageSelection[]) => void
  // onBack——「返回上一層」圖示鈕。兩處會用到:CityPanel(input.city.back 有值,帶 back.countryIds 呼叫)與
  // 2026-10 起的景點候選/查詢中(input.back 有值,即由城市頁選完城市進來,不帶參數呼叫)。選填——
  // planning/preview/Content.tsx 的展示頁劇本不支援這個互動(劇本內容固定,
  // 沒有真正的國家/城市串接流程),不傳就不渲染這顆按鈕。跟 onDone 不
  // 同:onDone 結束整個詢問(resolve 掉等待中的工具呼叫),onBack 只是
  // 原地換回上一層的 input,不結束任何東西——呼叫端(useAskPageFlow 的 handleAskPageBack)
  // 依目前的 input 決定回哪一層,用 replaceAskPage 換頁,不是 resolveAskPage。
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

// AskPage——外層只負責「換步驟時的轉場」(內容滑入 + 手機版面板高度過渡):判斷前進或返回的方向,用 display: contents 的外殼標出
// data-direction,內容(標題、選項、按鈕)依方向滑入,外殼氣泡本身不動(見 AskPage.module.css 的 .transition)。
// 方向由 askTransition.ts 依步驟層級(國家→城市→景點)判斷;換步驟後把焦點移到新的標題,
// 讓鍵盤與讀屏使用者知道畫面已換。實際的面板渲染在 AskPageContent。
export function AskPage(props: AskPageProps) {
  const layer = askLayerOf(props.input)
  // 「依 props 變化調整 state」的標準寫法:層級變了才在 render 中 setState 一次,方向存在 state 裡,
  // 之後同一步驟內的重繪方向不變(不會在動畫進行中被清掉)。第一次掛載沒有方向。
  const [nav, setNav] = useState<{ layer: number | undefined; direction: ReturnType<typeof askDirectionBetween> }>({
    layer,
    direction: 'none',
  })
  if (nav.layer !== layer) setNav({ layer, direction: askDirectionBetween(nav.layer, layer) })

  const rootRef = useRef<HTMLDivElement>(null)
  // 換步驟後把焦點移到新標題——只在「焦點本來就沒有落在別處」時才移:
  //   - document.activeElement 是 body/null:剛點的卡片隨舊面板一起被移除,焦點掉回 body(最常見的情況);
  //   - 焦點仍在詢問頁根節點內:使用者正在操作詢問頁本身。
  // 其餘情況(例如使用者正在下方輸入匡打字,詢問頁開著時輸入匡不鎖)AI 推進頁面不能搶焦點,否則字會打到別處/消失。
  // tabindex="-1" 只為了讓 <p> 可以被程式聚焦,標題 blur 後就移除,不留殘留。blur 監聽刻意不在 effect cleanup 移除:
  // 轉場結束時 direction 會清回 none(見下方 animationend 監聽)讓這個 effect 重跑,那時標題可能還在聚焦中,
  // 清掉監聽會讓 tabindex 永遠留著;監聽掛在元素上、once,元素被移除就跟著回收。
  useEffect(() => {
    if (nav.direction === 'none') return
    const root = rootRef.current
    const title = root?.querySelector('p')
    if (!root || !title) return
    const active = document.activeElement
    const focusIsFree = !active || active === document.body || root.contains(active)
    if (!focusIsFree) return
    title.setAttribute('tabindex', '-1')
    title.addEventListener('blur', () => title.removeAttribute('tabindex'), { once: true })
    title.focus({ preventScroll: true })
  }, [nav.layer, nav.direction])

  // 手機版面板高度過渡:換步驟(input 換了)時 .bubble 高度從舊值平滑動到新值,不上下跳(見 useHeightTransition.ts)。
  // 寬螢幕側欄(stacked)是固定高度,不需要。
  useHeightTransition(rootRef, props.input, { selector: `.${styles.bubble}`, disabled: props.stacked })

  // 滑入只在換步驟那一刻播:CSS 對 .bubble 的「直接子元素」套方向動畫,若方向一直留著,同一步驟內之後才插入的子元素
  // (例如查詢中換成候選時新出現的卡片列、操作列)也會再滑入一次。所以 .bubble 直接子元素的滑入動畫一結束,就把方向清回
  // none(之後同一步驟內的重繪方向仍穩定是 none;下一次換層級才再有方向)。只認 .bubble 直接子元素,卡片內部、查詢中
  // 圖示(無限旋轉,不會結束)等其他動畫不影響。選這個做法而不是「只對掛載時已存在的子元素播放」:後者要逐一標記子元素,
  // 而子元素是各面板自己渲染的,標記會散落各處。
  // 用原生監聽而不是 React 的 onAnimationEnd:React 在沒有 AnimationEvent 的環境(jsdom)會改聽 webkit 前綴事件名稱,
  // 行為跟瀏覽器不一致;原生 animationend 在兩邊都一樣。
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onEnd = (e: Event) => {
      const target = e.target as HTMLElement | null
      if (!target?.parentElement?.matches('[data-ask-part="bubble"]')) return
      setNav((n) => (n.direction === 'none' ? n : { ...n, direction: 'none' }))
    }
    root.addEventListener('animationend', onEnd)
    return () => root.removeEventListener('animationend', onEnd)
  }, [])

  return (
    <div
      ref={rootRef}
      className={styles.transition}
      data-ask-part="transition"
      data-direction={nav.direction}
      data-stacked={props.stacked ? 'true' : undefined}
    >
      <AskPageContent {...props} />
    </div>
  )
}

function AskPageContent({ dataSource, input, onDone, onBack, stacked }: AskPageProps) {
  // text 模式(見上方檔頭「第四輪」的完整說明):純文字對話氣泡,沒有
  // 候選卡片/選取/確認這些互動,跟其餘模式的渲染邏輯完全不共用,在這裡
  // 直接短路回傳,不進外殼的 .bubble/.question/.actions 結構(文字氣泡
  // 用自己的 .messageBubble,視覺語言不同於候選/選項卡片)。關閉氣泡
  // 視同使用者「不用了」,統一走 onDone([]) 切回軸線頁——這則文字本身
  // 已經在 onAssistantMessage 當下被寫進獨立的對話狀態(planning/conversation/messages.ts,記憶體),
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

  return <CandidatesPanel dataSource={dataSource} input={input} onDone={onDone} onBack={onBack} stacked={stacked} />
}

// CandidatesPanel——感興趣地點:候選景點照片卡片,可複選,「確認選擇」
// 才送出。這是原本整個 AskPage.tsx 的內容(candidates/explore 兩種
// input 共用同一套渲染,見上方檔頭「第三輪」的完整說明),重構時整段
// 原封不動搬進這個子元件,邏輯沒有變動。
function CandidatesPanel({
  dataSource,
  input,
  onDone,
  onBack,
  stacked,
}: {
  dataSource: PlanAiDataSource
  input:
    | { candidates: AskPageCandidate[]; reason?: string; loading?: boolean; back?: AskPageCandidatesBack }
    | { explore: AskPageExplore; reason?: string }
  onDone: (selected: AskPageSelection[]) => void
  onBack?: () => void
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
  // 2026-10:呼叫端可以原地換掉 input(選完城市先給「查詢中」{ loading: true },查完換成真正的候選,見
  // planning/panel/useAskPageFlow.ts),這個元件不會重新掛載——用「依 props 調整 state」的標準寫法,input 換了
  // 就以新的 input 重設候選與選取(candidates/exploring 原本只在掛載時從 input 初始化一次)。
  const [prevInput, setPrevInput] = useState(input)
  if (prevInput !== input) {
    setPrevInput(input)
    setCandidates('candidates' in input ? input.candidates : [])
    setSelectedPlaceIds([])
    setExploring('explore' in input)
  }
  const loading = exploring || ('candidates' in input && !!input.loading)
  // handleBack——由城市頁選完城市進來的查詢中/候選(input.back 有值,見 asktools.ts AskPageCandidatesBack)才有返回;
  // LLM 直接開的候選與 explore 沒有。呼叫端(useAskPageFlow.handleAskPageBack)依目前 input 的 back 換回城市頁,不需要參數。
  const handleBack = 'candidates' in input && input.back && onBack ? () => onBack() : undefined

  function toggleCandidate(placeId: string) {
    setSelectedPlaceIds((prev) => (prev.includes(placeId) ? prev.filter((x) => x !== placeId) : [...prev, placeId]))
  }

  // explore 模式:查詢候選清單本身——掛載時執行一次(理由同下方
  // resolveCandidates 的 effect:呼叫端每次開詢問頁都是重新掛載一個
  // 新的 AskPage 實例,input 在這個元件的生命週期內不會變)。
  // searchNearby 未提供(dataSource 沒有實作這個選填方法)或查詢失敗
  // 時,candidates 維持空陣列——使用者會看到一個沒有候選卡片、只剩
  // 右上角「不用了」關閉鈕可按的空狀態,不會整頁壞掉。
  useEffect(() => {
    if (!('explore' in input)) return
    const explore = input.explore
    if (!dataSource.searchNearby) {
      setExploring(false)
      return
    }
    // searchInput——依 planning/conversation/asktools.ts parseOpenAskPageArgs
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
          // tools.ts 其餘查詢失敗時的既有降級慣例。
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
  // 選完城市後的「查詢中」({ loading: true })也走同一個外殼——同一個步驟、同一個 CandidatesPanel,查完換成候選時
  // .wrap/.bubble/標題/卡片列容器沿用同一批 DOM(標題文字換掉、骨架換成卡片,不重新滑入),只有按鈕列是新出現的。
  // 選完城市的查詢中(input.loading)有右上角關閉鈕(2026-10:查詢掛住時原本只能等,現在可以「不用了」以 onDone([]) 結束,
  // 語意同其他頁的關閉;逾時另見 useAskPageFlow 的 CITY_LOOKUP_TIMEOUT_MS)。explore 查詢中沿用既有行為,不給關閉鈕。
  // role="status":讀屏會唸出查詢中,查完換成候選標題時也會唸出新的文字。
  // 查詢中與候選兩個分支都回傳同一個 <AskShell>(同型別、同位置),React 沿用同一批 DOM 與 AskShell 內的 hover 鎖定狀態。
  if (loading) {
    return (
      <AskShell
        stacked={stacked}
        loading
        onBack={handleBack}
        onClose={'candidates' in input && input.loading ? () => onDone([]) : undefined}
        question={
          <>
            <Loader2 size={16} strokeWidth={2.5} className={styles.loadingIcon} aria-hidden="true" />
            {input.reason ?? '正在附近探查地點…'}
          </>
        }
      >
        {/* 骨架卡——手機版先佔住照片卡那一列的高度,查完換成真正的卡片時面板只多出按鈕列,不會先縮成一行字再撐開
            (縮了又長的上下晃動,正是高度過渡要避免的)。寬螢幕側欄是固定高度,不需要。 */}
        {/* 共用 Skeleton:SkeletonRegion 本身就是卡片列容器(內層 display:contents,flex 排版直接作用在骨架上),
            SkeletonBlock 的尺寸與圓角對齊 .directionCard(140px、10/7、12px),邊框由 .skeletonCard 補上。 */}
        {!stacked && (
          <SkeletonRegion label="景點查詢中" className={styles.directionScroller}>
            {[0, 1, 2].map((i) => (
              <SkeletonBlock key={i} width={140} aspectRatio="10 / 7" radius={12} className={styles.skeletonCard} />
            ))}
          </SkeletonRegion>
        )}
      </AskShell>
    )
  }

  return (
    <AskShell
      stacked={stacked}
      question={input.reason ?? '要安排這些地點嗎?'}
      onBack={handleBack}
      onClose={() => onDone([])}
      // 操作列只有「確認選擇」。2026-10:原本的「我要直接說明」按鈕(展開說明面板)已移除,改由下方輸入匡直接說明
      // (詢問頁開著時輸入匡不鎖、提示文字引導,見 planning/panel/composerMode.ts)。
      actions={
        <button
          type="button"
          className={`${styles.optionBtn} ${styles.directionConfirm}`}
          disabled={selectedPlaceIds.length === 0}
          onClick={handleConfirm}
        >
          {selectedPlaceIds.length > 0 ? `確認選擇(${selectedPlaceIds.length})` : '確認選擇'}
        </button>
      }
    >
      <AskOptionList stacked={stacked}>
        {candidates.map((candidate) => {
          const detail = details.get(candidate.placeId)
          return (
            <CandidateCard
              key={candidate.placeId}
              name={detail?.name ?? candidate.name}
              loading={detail?.loading}
              photoUrl={detail?.photoUrl}
              checked={selectedPlaceIds.includes(candidate.placeId)}
              stacked={stacked}
              onToggle={() => toggleCandidate(candidate.placeId)}
            />
          )
        })}
      </AskOptionList>
    </AskShell>
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
    <AskShell
      stacked={stacked}
      question={input.reason ?? '要去哪個國家?'}
      onClose={() => onDone([])}
    >
      <AskOptionList stacked={stacked}>
        {countries.map((c) => (
          <RegionOption key={c.id} name={c.name} stacked={stacked} onSelect={() => onDone([{ placeId: c.id }])} />
        ))}
      </AskOptionList>
    </AskShell>
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
  const back = input.back
  return (
    <AskShell
      stacked={stacked}
      question={question}
      onBack={back && onBack ? () => onBack(back.countryIds) : undefined}
      onClose={() => onDone([])}
    >
      <AskOptionList stacked={stacked}>
        {cities.map((city) => (
          <RegionOption key={city.id} name={city.name} stacked={stacked} onSelect={() => onDone([{ placeId: city.id }])} />
        ))}
      </AskOptionList>
    </AskShell>
  )
}

// TransportPanel——交通方式:固定列舉(圖示與中文標籤見 TransportOption.tsx 的 TRANSPORT_META),modes
// 參數決定顯示哪些、依什麼順序(見 asktools.ts
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
    <AskShell
      stacked={stacked}
      question={reason ?? '這段要怎麼移動?'}
      onClose={() => onDone([])}
    >
      <AskOptionList stacked={stacked} variant="transport">
        {modes.map((mode) => (
          <TransportOption key={mode} mode={mode} stacked={stacked} onSelect={() => onDone([{ placeId: mode }])} />
        ))}
      </AskOptionList>
    </AskShell>
  )
}

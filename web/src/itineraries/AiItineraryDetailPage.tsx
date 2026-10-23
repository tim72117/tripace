import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CalendarDays, MapPin } from 'lucide-react'
import { BASE_URL } from '../AppCommon'
import { ApiError, fetchPublicItineraryPage, type ClientConfig } from '../api'
import { PlanTimelineView } from '../plan-core/PlanTimelineView'
import { toRenderList } from '../plan-core/planTimeline'
import { Lightbox } from '../geo-planning/PhotoCarousel'
import { SiteNavBrand } from '../home/SiteNavButtons'
import { findItinerary, isSampleItineraryShape, toPlanTimeline } from './catalog'
import { AiItineraryDetailPageMapView } from './AiItineraryDetailPageMapView'
import { renderAnchorIcon } from './renderAnchorIcon'
import type { SampleItinerary } from './types'
import styles from './AiItineraryDetailPage.module.css'

// GUEST_CFG——讀取已發布範例行程是公開頁面的訪客動作,不需要使用者自己
// 的 JWT,token 傳 null,理由同 web/src/blog/BlogArticlePage.tsx 的
// GUEST_CFG。
const GUEST_CFG: ClientConfig = { baseURL: BASE_URL, token: null }

type ApiFetchState =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; itinerary: SampleItinerary }

// useApiBackedItinerary——2026-10 改版,使用者明確要求「將 tainan-chikan-2day
// 整體的模板做成獨立通用的元件,透過讀取後端端點資料來呈現不同地點」,
// 並明確拍板「寬所有 id 都先試 API,404 再退回靜態檔案」:取代原本只對
// API_BACKED_ITINERARY_IDS 白名單內的 id 才查詢的做法,改成每份行程掛載
// 時都無條件打一次 GET /v1/itinerary-pages/{id}(見 api.ts
// fetchPublicItineraryPage 的完整說明)——這份端點目前只有少數行程
// (tainan-chikan-2day)真的發布進資料庫,其餘十幾份查詢會收到 404,這是
// 已知且接受的代價(使用者在前一個問題明確選擇這個方向,而非維護一份
// 前端白名單)。
//
// state 用 'unavailable'(而非原本的 'not-found')表示「API 這邊沒有這份
// 資料」,不是「這份行程完全不存在」——呼叫端(AiItineraryDetailPage)
// 收到 'unavailable' 後還會嘗試退回靜態 registry.ts 查詢,只有兩邊都查無
// 時才真的顯示「找不到這份行程」畫面,見下方完整說明。
function useApiBackedItinerary(id: string): ApiFetchState {
  const [state, setState] = useState<ApiFetchState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    fetchPublicItineraryPage(GUEST_CFG, id)
      .then((res) => {
        if (cancelled) return
        if (!isSampleItineraryShape(res.content)) {
          setState({ kind: 'unavailable' })
          return
        }
        setState({ kind: 'ready', itinerary: res.content })
      })
      .catch((err) => {
        if (cancelled) return
        // 404(行程還沒發布進資料庫)是目前最常見的失敗原因,不特別印
        // console.error——其餘十幾份走靜態 registry 的行程,每次進入
        // 詳細頁都會打到這支端點收到 404,这是已知且預期內的行為(見
        // 上方完整說明),不該被當成異常噴進 console。只有非預期的錯誤
        // (網路層級失敗、500 等)才印出來方便排查。用 ApiError.call.status
        // 判斷狀態碼,不是比對 err.message 字串——後端錯誤回應的 message
        // 欄位內容不保證包含狀態碼數字(見 api.ts request() 的完整說明,
        // 優先用後端回傳的 errBody.error.message)。
        if (!(err instanceof ApiError) || err.call.status !== 404) {
          console.error('[AiItineraryDetailPage] fetchPublicItineraryPage 失敗:', err)
        }
        setState({ kind: 'unavailable' })
      })
    return () => {
      cancelled = true
    }
  }, [id])

  return state
}

// AiItineraryDetailPage — 點進某一份範例行程後的畫面:標題與簡介在上方,下面是
// 完整的時間軸(跨天有日期分隔)。
//
// 時間軸直接用 plan-core/PlanTimelineView——跟 AI 規劃(/trip-plan、地圖對話匡)
// 用的是同一個元件,所以訪客在這裡看到的就是真實 AI 規劃出來的樣子;範例資料經
// catalog.toPlanTimeline 轉成它吃的格式。這裡是唯讀展示:不傳任何編輯類的選填
// props(刪除、拖拉改時間、換交通方式),卡片只有點選高亮與開照片。
//
// 找不到 id(網址打錯、或行程被下架)時顯示「找不到這份行程」並導回清單,不是
// 空白頁。
export function AiItineraryDetailPage({ items, id, dark = false }: { items: SampleItinerary[]; id: string; dark?: boolean }) {
  // apiState——2026-10 改版,使用者明確要求「做成獨立通用的元件,透過
  // 讀取後端端點資料來呈現不同地點」:每份行程都無條件查詢 API(見
  // useApiBackedItinerary 的完整說明),不再有 enabled 旗標/前端白名單。
  const apiState = useApiBackedItinerary(id)
  const staticItinerary = useMemo(() => findItinerary(items, id), [items, id])
  // itinerary——API 查到就優先用 API 版本(未來資料遷移完成後這會是
  // 唯一的資料來源);API 還在查詢中或查無(unavailable)時,退回
  // registry.ts 收錄的靜態版本當樂觀初始值,避免這份行程明明有靜態
  // 資料可以立即顯示,卻因為同時在等一個注定 404 的 API 請求而讓訪客
  // 先看到一次「載入中」閃爍——只有 API 查詢中「且」完全沒有靜態版本
  // 可用時,才需要顯示 loading 畫面(見下方判斷)。
  const itinerary = apiState.kind === 'ready' ? apiState.itinerary : staticItinerary

  const steps = useMemo(() => (itinerary ? toRenderList(toPlanTimeline(itinerary).timeline) : []), [itinerary])
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<{ photos: string[]; alt: string } | null>(null)
  // 記錄已播過進場動畫的節點 id(PlanTimelineView 的必填 prop);展示頁一次載入
  // 整份行程,不需要這個機制做任何事,給一個永遠空的 ref 即可。
  const mountedIdsRef = useRef<Set<string>>(new Set())

  if (!itinerary && apiState.kind === 'loading') {
    return (
      <main className={styles.page}>
        <SiteNavBrand pageLabel="精選行程" />
        <Link to="/itineraries" className={styles.back}><ArrowLeft size={14} strokeWidth={2} />所有範例行程</Link>
        <div className={styles.notFound}>
          <p className={styles.notFoundTitle}>載入中...</p>
        </div>
      </main>
    )
  }

  if (!itinerary) {
    return (
      <main className={styles.page}>
        <SiteNavBrand pageLabel="精選行程" />
        <Link to="/itineraries" className={styles.back}><ArrowLeft size={14} strokeWidth={2} />所有範例行程</Link>
        <div className={styles.notFound}>
          <p className={styles.notFoundTitle}>找不到這份行程</p>
          <p className={styles.notFoundHint}>網址可能打錯了,或這份行程已經下架。</p>
          <Link to="/itineraries" className={styles.notFoundCta}>回到範例行程</Link>
        </div>
      </main>
    )
  }

  // SiteNavBrand——2026-10 新增,使用者明確要求「標頭不要用 AI 排好的
  // 行程」:左上角這顆品牌標記旁的頁面標籤,原本固定寫死在
  // AiItinerariesRoute.tsx 的 pageLabel="精選行程",改成拿到真正
  // 的 itinerary 物件後用行程自己的 title。
  //
  // 這裡刻意不再用 react-helmet-async 的 <Helmet> 設定 <title>/<meta
  // name="description">——使用者後續明確要求「SEO 直接用行程標頭就好」
  // 「跟部落格用同一套 SEO 存放機制」:部落格文章(/u/{handle}/{slug})
  // 的 SEO meta 不是靠前端 Helmet 動態改寫,而是 server 端
  // (cmd/server/seo_meta.go)在請求 index.html 當下依路徑查資料庫、
  // 直接字串取代寫死的 placeholder——這份檔案開頭的完整說明記錄了
  // 棄用 Helmet 的實測根因:Googlebot 第一次抓取時 JS 還沒執行,讀到的
  // canonical/title 仍是首頁的,且 react-helmet-async 不會移除
  // index.html 裡已經寫死的標籤,只會追加,造成同一份 <head> 裡出現
  // 兩個互相矛盾的 canonical。/itineraries/{slug} 現在用同一套
  // itineraryPageSEOMeta 機制(見該函式的完整說明),這裡不需要、也不該
  // 再用 Helmet 重複設定一次。
  const headBrand = <SiteNavBrand pageLabel={itinerary.title} />

  // mapStyle——2026-10 改版,使用者明確要求「做成獨立通用的元件」:走
  // 地圖基底展示版面(AiItineraryDetailPageMapView)改成讀行程資料本身
  // 的 mapStyle 欄位(見 types.ts 的完整說明)決定,取代原本寫死的
  // MAP_VIEW_ITINERARY_IDS 前端 id 白名單——任何行程只要 content JSON
  // 裡設定了 mapStyle,就會走地圖版面,不需要回來改這個檔案的程式碼。
  if (itinerary.mapStyle != null) {
    return (
      <>
        {headBrand}
        <AiItineraryDetailPageMapView itinerary={itinerary} dark={dark} />
      </>
    )
  }

  return (
    <main className={styles.page}>
      {headBrand}
      <Link to="/itineraries" className={styles.back}><ArrowLeft size={14} strokeWidth={2} />所有範例行程</Link>
      <header className={styles.header}>
        <h1 className={styles.title}>{itinerary.title}</h1>
        <div className={styles.meta}>
          <span className={styles.metaItem}><MapPin size={13} strokeWidth={2} />{itinerary.region}</span>
          <span className={styles.metaItem}><CalendarDays size={13} strokeWidth={2} />{itinerary.days} 天 · {itinerary.stops.length} 站</span>
        </div>
        <div className={styles.tags}>
          {itinerary.categories.map((c) => <span key={c} className={styles.tag}>{c}</span>)}
        </div>
        <p className={styles.summary}>{itinerary.summary}</p>
      </header>
      <PlanTimelineView
        steps={steps}
        isThinking={false}
        emptyStateMessage=""
        hideEmptyState
        endMarkerMessage="行程結束"
        selectedStopId={selectedStopId}
        showJumpPill={false}
        onJumpToLatest={() => {}}
        onPanToStop={(step) => setSelectedStopId(step.id)}
        onOpenPhotos={setLightbox}
        mountedIdsRef={mountedIdsRef}
        renderAnchorIcon={renderAnchorIcon}
        anchorDotSize={22}
      />
      {lightbox && <Lightbox photos={lightbox.photos} alt={lightbox.alt} onClose={() => setLightbox(null)} />}
    </main>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Share2 } from 'lucide-react'
import styles from './PaceChart.module.css'
import { BASE_URL } from './AppCommon'
import { fetchEntries, type ClientConfig } from './api'

// 單車配速表(UI 試做):手機優先的直向卡片堆疊,每張卡片是一個檢查站,
// 核心資訊是「離站時間」(視覺上用最大字級呈現)。設計與互動邏輯直接
// 移植自已驗證過的靜態原型(pace-chart.html):
// - 頂部 sticky 摘要列(總里程/出發/抵達)
// - 距離進度條 + 依裝置目前時間定位的圓點
// - 比對目前時間與各站離站時間表,自動標記「目前站」、捲動到該卡片
// - 長休息站(午餐)用不同底色系與其他短暫停留區分
// 顏色/字體全部沿用 styles.css 既有的 --ios-*/--color-* token(專案本身
// 沒有 prefers-color-scheme/data-theme 這套深色模式機制,故不額外新增)。

export interface Checkpoint {
  // id:對應後端 Entry.id——點擊卡片要往上通知父層是哪一筆 entry,後續
  // PATCH /internal/entries/{id}/latlng 儲存座標時需要用到。
  id: string
  name: string
  km: number | null // null:純轉彎指示,紙條上沒寫里程(仍依原始順序顯示,只是不進里程進度條)
  tag: string | null // null:起點/終點無標籤(顯示起點/終點徽章代替)
  arrive: string | null // "HH:MM",起點無抵達時間
  dwellMin: number | null // 停留分鐘數,起點/終點無停留
  depart: string | null // "HH:MM",終點無離站時間(用抵達時間當核心數字);兩者皆 null 表示紙條沒記錄時刻
  isStart?: boolean
  isFinish?: boolean
  isLongRest?: boolean // 長休息站(如午餐):視覺上用警示色系區分
  // lat/lng:對應後端 Entry 的頂層座標欄位(不是 Detail 裡的東西),點擊這張
  // 卡片時要能通知地圖平移過去就得知道座標;沒有座標(entry 尚未 geocode)
  // 時為 null,呼叫端(PaceChart)遇到 null 就不觸發平移,不假裝有位置。
  lat: number | null
  lng: number | null
}

// PublicEntry:GET /v1/public/{token} 回傳的 entries 陣列元素形狀(對應後端
// model.Entry,只列出轉換成 Checkpoint 會用到的欄位)。detail 是我們自訂塞進
// 去的配速表專屬資料(見 server/internal/store 的 Detail 欄位機制),後端對
// 這個欄位沒有固定 schema 驗證,故這裡的型別只是前端這端的假設,不是後端
// 強制保證的格式。
// PaceSegment:對應後端 Detail.segment 的合法值,即這個元件四個分頁各自的
// key——寫入端(cmd/cli entry-update -detail)與這裡的 key 命名必須一致。
type PaceSegment = 'leg1' | 'leg2' | 'leg3' | 'leg4'

interface PublicEntry {
  id: string
  title: string
  lat: number | null
  lng: number | null
  detail: {
    km: number | null
    isStart: boolean
    isFinish: boolean
    dwellMin: number | null
    isLongRest: boolean
    tag?: string
    departTime: string | null
    arriveTime: string | null
    // order:顯示順序,寫入時明確指定(見 server 端資料),不依賴
    // ListEntriesByChannel 的 "start ASC, created_at ASC" 排序——同一天的
    // checkpoint 全部同一個 start 日期,實際順序完全靠 created_at,一旦事後
    // 用 entry-update 補資料(而非重新 entry-add),created_at 不會跟著變,
    // 但也可能因為批次寫入時機不同而跟原始紙條順序對不上,故改成由這個
    // 明確欄位決定顯示順序,不依賴任何隱含的資料庫寫入順序。
    order: number
    // segment:標記這筆屬於哪一段路線(leg1~leg4)。D1(2026-07-31)實際涵蓋
    // leg1+leg2 兩段,單靠 start 日期無法區分同一天的兩個路段,故需要這個
    // 明確欄位,不能只靠 start/order 反推。
    segment: PaceSegment
  } | null
}

// entryToCheckpoint:把後端 Entry 轉成這個元件既有的 Checkpoint 形狀,讓
// 下方所有既有的呈現/「目前站」判斷邏輯不需要因為資料來源改變而跟著改。
function entryToCheckpoint(e: PublicEntry): Checkpoint {
  const d = e.detail
  return {
    id: e.id,
    name: e.title,
    km: d?.km ?? null,
    tag: d?.tag ?? null,
    arrive: d?.arriveTime ?? null,
    dwellMin: d?.dwellMin ?? null,
    depart: d?.departTime ?? null,
    isStart: d?.isStart ?? false,
    isFinish: d?.isFinish ?? false,
    isLongRest: d?.isLongRest ?? false,
    // e.lat/e.lng:後端沒有座標時整個欄位會直接省略(`json:"lat,omitempty"`,
    // 見 server/internal/model/model.go),不是回傳 null——這裡型別雖然宣告
    // 成 number | null,但解析 JSON 後缺欄位的實際執行期值是 undefined,
    // 用 ?? null 收斂,讓下游(PaceRouteMap.tsx 的 selectedEntry.lat === null
    // 判斷)可以用嚴格的 null 檢查,不必額外處理 undefined。
    lat: e.lat ?? null,
    lng: e.lng ?? null,
  }
}

// groupBySegment:依 detail.segment 分組、組內再依 detail.order 排序,回傳
// 四段各自的 Checkpoint 陣列。缺少 segment/order 的條目(理論上不該發生)
// 直接跳過,不強行塞進某一段造成錯誤分類。
function groupBySegment(entries: PublicEntry[]): Record<PaceSegment, Checkpoint[]> {
  const bySeg: Record<PaceSegment, PublicEntry[]> = { leg1: [], leg2: [], leg3: [], leg4: [] }
  for (const e of entries) {
    const seg = e.detail?.segment
    if (seg && seg in bySeg) bySeg[seg].push(e)
  }
  const sorted = (list: PublicEntry[]) =>
    [...list].sort((a, b) => (a.detail?.order ?? Infinity) - (b.detail?.order ?? Infinity)).map(entryToCheckpoint)
  return { leg1: sorted(bySeg.leg1), leg2: sorted(bySeg.leg2), leg3: sorted(bySeg.leg3), leg4: sorted(bySeg.leg4) }
}

// RouteMeta:每段路線的摘要資訊。date 為必填(YYYY-MM-DD)——「目前站」
// 判斷需要拿裝置今天的日期跟這裡比對(見 computeNowMark 呼叫處),沒有
// 「不綁日期」這種路線,故不用 string | null。
interface RouteMeta {
  title: string
  subtitle: string
  eyebrow: string
  totalKm: number
  startTime: string
  finishTime: string
  avgSpeedKmh: number | null
  date: string
}

// ---- 花東193公路 pace note(真實手寫紀錄轉錄,與 ch_57910e64 頻道底下的
// entries 資料一致——這裡的陣列順序即建立順序,也就是紙條原始的先後順序)----
// 收錄全部條目,含沒記錄到時刻的純轉彎指示(km/depart/arrive 皆為 null)。
// 這批純轉彎指示依然依原始順序顯示,只是:
// - 右側不出現「離站/抵達」時間(顯示 —,見 CheckpointCard 的 hasTime 判斷)
// - 不計入里程進度條與「目前站」判斷(km 或時刻缺一,scheduleTime()/
//   進度條圓點都會直接跳過,見 computeNowMark)
// 里程數照紙條原始寫法保留,不強行從 0 起算(某幾段本來就是從路線中段
// 開始記錄),故部分路段的進度條起點不是 0%。

// PACE_PUBLIC_LINK_TOKEN:未登入的公開分享頁(/demo/pace,見
// PublicPaceDemoPage.tsx)讀取固定展示頻道用的公開分享連結 token。由
// VITE_PACE_PUBLIC_LINK_TOKEN 決定(見 .env.development)。登入後的正式
// 介面(DesktopLayout.tsx)不使用這個 token——跟時間軸(Timeline)同一套
// 邏輯,改讀登入使用者目前選取的頻道(見下方 channelID prop 與
// useEffect),不綁定固定頻道,也不需要經過公開連結機制。
const PACE_PUBLIC_LINK_TOKEN = import.meta.env.VITE_PACE_PUBLIC_LINK_TOKEN as string | undefined

// 四段路線的摘要資訊(RouteMeta)。這些是純展示用的文字/彙總數字,後端
// Entry/Detail 目前沒有對應的「整段路線摘要」資料結構可以承載,故仍維持
// 手動維護的常數——跟 Checkpoint 本身(逐站資料,已改讀後端)是分開的兩件
// 事,不在這次「把 checkpoint 資料串接到後端」的範圍內。
const LEG1_META: RouteMeta = {
  title: '光復橋 → 富興客棧', subtitle: '193縣道・大農大富平地森林園區段', eyebrow: '配速表 · 花東193公路(Day 1 上半)',
  totalKm: 21.0, startTime: '09:00', finishTime: '12:30', avgSpeedKmh: null,
  date: '2026-07-31',
}
const LEG2_META: RouteMeta = {
  title: '193縣道83K → 老家後山菜', subtitle: '瑞穗・虎爺溫泉段', eyebrow: '配速表 · 花東193公路(Day 1 下半)',
  totalKm: 16.3, startTime: '14:50', finishTime: '18:00', avgSpeedKmh: null,
  date: '2026-07-31',
}
const LEG3_META: RouteMeta = {
  title: '青蓮寺 → 安通溫泉', subtitle: '193縣道・玉里柴埔天堂路段', eyebrow: '配速表 · 花東193公路(Day 2 上半)',
  totalKm: 28.0, startTime: '08:30', finishTime: '13:00', avgSpeedKmh: null,
  date: '2026-08-01',
}
const LEG4_META: RouteMeta = {
  title: '安通鐵路驛站 → 太司步廊', subtitle: '板塊交接上橋段', eyebrow: '配速表 · 花東193公路(Day 2 下半)',
  totalKm: 7.5, startTime: '13:00', finishTime: '16:40', avgSpeedKmh: null,
  date: '2026-08-01',
}

// buildRoutes:bySegment 是 fetch 回來、依 segment 分組排序好的資料(見
// groupBySegment)——四段全部改讀後端,不再有任何寫死的 Checkpoint 常數。
function buildRoutes(
  bySegment: Record<PaceSegment, Checkpoint[]>,
): { key: string; label: string; checkpoints: Checkpoint[]; meta: RouteMeta }[] {
  return [
    { key: 'leg1', label: 'Day1 光復橋', checkpoints: bySegment.leg1, meta: LEG1_META },
    { key: 'leg2', label: 'Day1 193/83K', checkpoints: bySegment.leg2, meta: LEG2_META },
    { key: 'leg3', label: 'Day2 青蓮寺', checkpoints: bySegment.leg3, meta: LEG3_META },
    { key: 'leg4', label: 'Day2 安通驛站', checkpoints: bySegment.leg4, meta: LEG4_META },
  ]
}

// ---- 「目前站」判斷邏輯(移植自原型的 highlightNow) ----

function parseHM(hm: string): number {
  const [h, m] = hm.split(':').map((s) => parseInt(s, 10))
  return h * 60 + m
}

// 每站拿來跟目前時間比較的時刻:離站時間優先(起點/中途站),終點站沒有
// 離站時間,改用抵達時間(原型的 data-dep 對終點站也是填抵達時間 12:57)。
// null:紙條沒記錄到這站的時刻(純轉彎指示),不參與「目前站」判斷。
function scheduleTime(cp: Checkpoint): number | null {
  const hm = cp.depart ?? cp.arrive
  return hm ? parseHM(hm) : null
}

interface NowMark {
  checkpointIndex: number
  fracKm: number // 0~1,用來定位進度條上的圓點
}

// 早於出發時間、或晚於終點時刻 + 5 分鐘,都不標記(這份表只在騎乘當天有意義)。
// 只在「有時刻」的檢查站之間比對——沒時刻的純轉彎指示不參與判斷,但仍會
// 依原始順序顯示在清單裡(checkpointIndex 指的是它在完整 checkpoints 陣列
// 裡的位置,不是篩選後的位置,捲動/高亮才會對到正確的卡片)。
function computeNowMark(checkpoints: Checkpoint[], totalKm: number, nowMin: number): NowMark | null {
  const timed = checkpoints
    .map((cp, index) => ({ index, time: scheduleTime(cp), km: cp.km }))
    .filter((c): c is { index: number; time: number; km: number } => c.time !== null && c.km !== null)
  if (timed.length === 0) return null

  let current: { index: number; time: number; km: number } | null = null
  for (const c of timed) {
    if (c.time <= nowMin) current = c
    else break
  }

  if (!current || nowMin < timed[0].time || nowMin > timed[timed.length - 1].time + 5) {
    return null
  }

  return { checkpointIndex: current.index, fracKm: current.km / totalKm }
}

// ---- 呈現用小工具 ----

function tagColorClass(cp: Checkpoint): string {
  if (cp.isLongRest) return `${styles.tag} ${styles.tagRest}`
  if (cp.isFinish) return `${styles.tag} ${styles.tagFinish}`
  return styles.tag
}

function CheckpointCard({
  cp,
  isNow,
  cardRef,
  onClick,
}: {
  cp: Checkpoint
  isNow: boolean
  cardRef?: React.RefObject<HTMLDivElement>
  // onClick:通知父層「使用者點了這個檢查站」,由 PaceChart 的
  // onCheckpointClick prop 往下傳——沒有座標(cp.lat/lng 為 null)的卡片
  // 完全不掛這個 handler,點擊沒有任何效果,不會呼叫一個沒有意義的
  // (null, null) 平移。
  onClick?: () => void
}) {
  const stateClass = [
    styles.stop,
    cp.isLongRest ? styles.isRestLong : '',
    cp.isFinish ? styles.isFinish : '',
    isNow ? styles.isNow : '',
    onClick ? styles.isClickable : '',
  ].filter(Boolean).join(' ')

  // 核心數字:起點/中途站顯示離站時間(離站是配速表的重點),終點顯示抵達時間。
  // 兩者皆無(紙條沒記錄到這站的時刻)時顯示 —,不留空、不讓卡片右側整塊消失。
  const hasTime = cp.depart !== null || cp.arrive !== null
  const coreLabel = !hasTime ? '' : cp.isFinish ? '抵達' : cp.isStart ? '出發' : '離站'
  const coreValue = !hasTime ? '—' : cp.isFinish ? cp.arrive : cp.depart

  return (
    <div className={stateClass} ref={cardRef} onClick={onClick}>
      <div className={styles.stopLeft}>
        {isNow && (
          <div className={styles.nowFlag}>
            <span className={styles.nowDot} />
            目前站
          </div>
        )}
        {cp.isStart && <div className={styles.startBadge}>🚩 起點</div>}
        {cp.isFinish && <div className={styles.finishBadge}>🏁 終點</div>}
        <div className={styles.locName}>{cp.name}</div>
        {(cp.tag || cp.km !== null) && (
          <div className={styles.locMeta}>
            {cp.tag && <span className={tagColorClass(cp)}>{cp.tag}</span>}
            {cp.km !== null && <span className={`${styles.kmVal} ${styles.mono}`}>{cp.km.toFixed(1)} km</span>}
          </div>
        )}
      </div>
      <div className={styles.stopRight}>
        <div className={styles.depLabel}>{coreLabel}</div>
        <div className={`${styles.depVal} ${styles.mono}`}>{coreValue}</div>
        {cp.arrive && !cp.isFinish && (
          <span className={cp.isLongRest ? `${styles.dwellVal} ${styles.long}` : styles.dwellVal}>
            抵 {cp.arrive}・停 {cp.dwellMin}m{cp.isLongRest ? ' 午餐' : ''}
          </span>
        )}
      </div>
    </div>
  )
}

// 今天(YYYY-MM-DD),用裝置本地時區——與 meta.date(手寫紀錄轉錄時指定的
// 騎乘日期)比對,只有日期相符才標記「目前站」,避免比如今天剛好是任何一天
// 的某個時刻,卻誤標成 7/31 那段路線的目前站。
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function PaceChart({
  cfg,
  channelID,
  onCheckpointClick,
}: {
  // cfg:登入後正式介面(DesktopLayout.tsx)傳入自己的 ClientConfig,改走
  // 認證過的 fetchEntries 讀取資料。不傳(PublicPaceDemoPage.tsx 公開分享頁)
  // 則 fallback 走公開連結 token(見下方 useEffect)。
  cfg?: ClientConfig
  // channelID:登入後正式介面要讀取的頻道 ID,跟時間軸(MultiTrackTimeline)
  // 同一套邏輯——用使用者目前選取的 activeChannel?.id,不綁定固定頻道。
  // 沒有選取頻道時(undefined/null)顯示提示訊息,不發任何請求(見下方
  // useEffect)。cfg 為 undefined(公開分享頁)時這個 prop 不會被使用。
  channelID?: string | null
  // onCheckpointClick:通知父層(DesktopLayout.tsx 登入後正式介面)使用者
  // 點了哪個檢查站,讓地圖(PaceRouteMap)能平移過去、進入手動微調座標模式。
  // 可選是因為 PublicPaceDemoPage.tsx(/demo/pace 公開分享頁)刻意不接這套
  // 互動(寫入座標需要登入身分,不該出現在公開頁),掛載時不傳這個 prop。
  onCheckpointClick?: (entry: { id: string; lat: number | null; lng: number | null }) => void
}) {
  const [routeIdx, setRouteIdx] = useState(0)
  const [nowMark, setNowMark] = useState<NowMark | null>(null)
  // copied:分享按鈕點擊後短暫顯示「已複製連結」的回饋文字,2 秒後恢復。
  const [copied, setCopied] = useState(false)
  // checkpointsBySegment/loadError:四段(leg1~leg4)全部改讀後端真實 Entry
  // (見 PACE_PUBLIC_LINK_TOKEN 的說明),一次 fetch 拿全部 28 筆再依
  // detail.segment 分組。null 代表還在載入中或已失敗——刻意不用假資料
  // 頂著,fetch 失敗時要讓使用者看到明確的錯誤,而不是安靜地顯示一份可能
  // 早已過時的寫死資料,掩蓋掉真實的失敗狀態。
  const [checkpointsBySegment, setCheckpointsBySegment] = useState<Record<
    PaceSegment,
    Checkpoint[]
  > | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    // 登入後正式介面(cfg 有值)但還沒選頻道:比照時間軸「選擇一個行程後
    // 顯示時間軸。」的作法,不發任何請求,只顯示提示訊息,也不當成錯誤。
    if (cfg && !channelID) {
      setCheckpointsBySegment(null)
      setLoadError(null)
      return
    }
    let cancelled = false
    // 登入後正式介面(cfg 有值):走一般認證過的頻道 entries API,讀取
    // 使用者目前選取的頻道(channelID),不再經過公開連結 token。未登入的
    // 公開分享頁(cfg 為 undefined):維持走公開連結 token(這是它本來就
    // 該有的合法用途,不是臨時接法)。
    const load = cfg
      ? fetchEntries(cfg, channelID!).then((entries) => entries as unknown as PublicEntry[])
      : (() => {
          if (!PACE_PUBLIC_LINK_TOKEN) {
            return Promise.reject(new Error('未設定 VITE_PACE_PUBLIC_LINK_TOKEN(見 web/.env.development)'))
          }
          return fetch(`${BASE_URL}/v1/public/${PACE_PUBLIC_LINK_TOKEN}`).then(async (res) => {
            if (!res.ok) {
              const text = await res.text().catch(() => '')
              throw new Error(`載入配速表資料失敗(${res.status}): ${text.slice(0, 200)}`)
            }
            return (await res.json() as { entries: PublicEntry[] }).entries
          })
        })()
    load
      .then((entries) => {
        if (cancelled) return
        setCheckpointsBySegment(groupBySegment(entries))
      })
      .catch((e) => {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [cfg, channelID])

  const routes = buildRoutes(
    checkpointsBySegment ?? { leg1: [], leg2: [], leg3: [], leg4: [] },
  )
  const route = routes[routeIdx]
  // 沿用 App.tsx todayRef 的既有寫法:型別維持非 nullable 的 RefObject<HTMLDivElement>
  // (跟 React 18 的 RefObject<T> 定義一致,才能直接傳給 <div ref>),掛載前用
  // as unknown as HTMLDivElement 頂住初始值,實際使用前一律先檢查 .current 是否存在。
  const nowCardRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement)

  // 切換路線分頁、或裝置時間變動時重算一次即可(「進來看一眼」的情境,
  // 不需要每秒即時追蹤)。
  useEffect(() => {
    if (route.meta.date !== todayStr()) {
      setNowMark(null)
      return
    }
    const now = new Date()
    const nowMin = now.getHours() * 60 + now.getMinutes()
    setNowMark(computeNowMark(route.checkpoints, route.meta.totalKm, nowMin))
  }, [route])

  // 自動捲動到目前站(等 nowMark 算出來、DOM 掛上 ref 之後才捲動)。
  useEffect(() => {
    if (nowMark && nowCardRef.current) {
      nowCardRef.current.scrollIntoView({ behavior: 'instant', block: 'center' })
    }
  }, [nowMark])

  // 跟時間軸(desktop-timeline-panel 的「選擇一個行程後顯示時間軸。」)
  // 同一套邏輯:登入後正式介面還沒選頻道時,只顯示提示,不當成錯誤、
  // 也不用「載入中」那組畫面(根本沒有發出任何請求)。
  if (cfg && !channelID) {
    return (
      <div className="pace-chart">
        <div className="empty">選擇一個行程後顯示配速表。</div>
      </div>
    )
  }

  // 四段 checkpoint 資料共用同一次 fetch,還在載入或已失敗時,四個分頁
  // 都顯示同一組載入中/錯誤畫面,不再有「只影響其中一段」的情況。
  if (loadError) {
    return (
      <div className="pace-chart">
        <div className="rp-map-error">
          <span>配速表載入失敗</span>
          <span className="rp-map-error-detail">{loadError}</span>
        </div>
      </div>
    )
  }
  if (checkpointsBySegment === null) {
    return (
      <div className="pace-chart">
        <p className={styles.eyebrow}>載入配速表資料中…</p>
      </div>
    )
  }

  return (
    <div className="pace-chart">
      <div className="pace-route-tabs">
        {routes.map((r, i) => (
          <button
            key={r.key}
            type="button"
            className={i === routeIdx ? `${styles.routeTab} ${styles.isActive}` : styles.routeTab}
            onClick={() => setRouteIdx(i)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* 這是 ?demo 才會出現的固定示範資料(花東193公路),不是真實使用者
          頻道,分享出去的公開頁不需要登入、不涉及任何真實資料權限問題——
          跟 /public/{token} 那套給真實頻道用的公開分享連結是分開的機制,
          直接複製一個固定網址即可,不用走後端建立/驗證 token 那套流程。 */}
      <button
        type="button"
        className={styles.shareBtn}
        onClick={() => {
          const url = `${window.location.origin}/demo/pace`
          navigator.clipboard.writeText(url).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          })
        }}
      >
        <Share2 size={14} strokeWidth={2} />
        {copied ? '已複製連結' : '分享這個配速表'}
      </button>

      <p className={styles.eyebrow}>{route.meta.eyebrow}</p>
      <h1 className={styles.title}>{route.meta.title}</h1>
      <p className={styles.routeSub}>{route.meta.subtitle}</p>

      <div className={styles.summary}>
        <div className={styles.statRow}>
          <div className={styles.stat}>
            <div className={styles.statLabel}>總里程</div>
            <div className={`${styles.statValue} ${styles.accent} ${styles.mono}`}>
              {route.meta.totalKm.toFixed(1)}<span className={styles.unit}> km</span>
            </div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>出發</div>
            <div className={`${styles.statValue} ${styles.mono}`}>{route.meta.startTime}</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statLabel}>抵達</div>
            <div className={`${styles.statValue} ${styles.mono}`}>{route.meta.finishTime}</div>
          </div>
        </div>
      </div>

      <div className={styles.stripWrap}>
        <div className={styles.stripTrack}>
          <div className={styles.stripFill} />
          {nowMark && (
            <div className={styles.stripNow} style={{ left: `${nowMark.fracKm * 100}%` }} />
          )}
        </div>
        <div className={styles.stripLabels}>
          <span>0 km</span>
          <span>{(route.meta.totalKm / 2).toFixed(0)} km</span>
          <span>{route.meta.totalKm.toFixed(0)} km</span>
        </div>
      </div>

      <div className={styles.tableTitle}>
        <span>檢查站</span>
        <span className={styles.count}>{route.checkpoints.length} 站</span>
      </div>

      <div className={styles.stops}>
        {route.checkpoints.map((cp, i) => (
          <CheckpointCard
            key={cp.name}
            cp={cp}
            isNow={nowMark?.checkpointIndex === i}
            cardRef={nowMark?.checkpointIndex === i ? nowCardRef : undefined}
            onClick={onCheckpointClick ? () => onCheckpointClick({ id: cp.id, lat: cp.lat, lng: cp.lng }) : undefined}
          />
        ))}
      </div>
    </div>
  )
}

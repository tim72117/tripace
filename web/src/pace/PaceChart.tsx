import { useEffect, useMemo, useRef, useState } from 'react'
import { Share2 } from 'lucide-react'
import styles from './PaceChart.module.css'
import './PaceMap.css'
import { BASE_URL } from '../AppCommon'
import { fetchEntries, geocodeEntry, type ClientConfig } from '../api'

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

// PaceSegment:對應後端 Detail.segment 的值——任意行程可以自訂任何段名,
// 不再假設固定是 leg1~leg4 這四個(那是原本花東193公路 demo 行程自己選用
// 的 key,不是後端強制的合法值集合)。型別因此收斂成單純的 string;
// leg1~leg4 仍然是「已知/手動維護摘要資料」的其中幾個 key,見下方
// KNOWN_ROUTE_META。
type PaceSegment = string

// PaceCheckpointDetail:Entry.detail 這個自訂 JSON 欄位裡,配速表專屬會
// 用到的形狀——對齊後端
// server/internal/model/entry_detail_pace.go 的 PaceCheckpointDetail
// struct(權威定義,兩邊欄位需保持一致)。這是目前唯一有實際資料寫進
// Entry.Detail 的用法(用 CLI/entry-update 手動標註),Entry.Detail
// 本身對後端沒有固定 schema 強制驗證,前端這份型別只是配合後端結構的
// 假設。匯出讓 PhoneScreens.tsx 直接引用這一份,不再各自維護一份容易
// 悄悄不同步的複本(過去發生過的實際案例:PhoneScreens.tsx 那份漏了
// isLongRest 欄位)。
export interface PaceCheckpointDetail {
  km: number | null
  isStart: boolean
  isFinish: boolean
  dwellMin: number | null
  isLongRest: boolean
  tag?: string
  departTime: string | null
  arriveTime: string | null
  // order:顯示順序,寫入時明確指定(見 server 端資料),不依賴
  // ListEntriesByTrip 的 "start ASC, created_at ASC" 排序——同一天的
  // checkpoint 全部同一個 start 日期,實際順序完全靠 created_at,一旦事後
  // 用 entry-update 補資料(而非重新 entry-add),created_at 不會跟著變,
  // 但也可能因為批次寫入時機不同而跟原始紙條順序對不上,故改成由這個
  // 明確欄位決定顯示順序,不依賴任何隱含的資料庫寫入順序。
  order: number
  // segment:標記這筆屬於哪一段路線(leg1~leg4)。D1(2026-07-31)實際涵蓋
  // leg1+leg2 兩段,單靠 start 日期無法區分同一天的兩個路段,故需要這個
  // 明確欄位,不能只靠 start/order 反推。
  segment: PaceSegment
}

// PublicEntry:GET /v1/public/{token} 回傳的 entries 陣列元素形狀(對應後端
// model.Entry,只列出轉換成 Checkpoint 會用到的欄位)。
interface PublicEntry {
  id: string
  title: string
  lat: number | null
  lng: number | null
  detail: PaceCheckpointDetail | null
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
// 一個依 segment 分組好的 Map,依 segment key 字母序排序(跟
// PhoneScreens.tsx 的 PublicPaceList 同一套分組/排序寫法,見該檔案
// `[...groups.entries()].sort(([a], [b]) => a.localeCompare(b))`)——任意
// 行程會出現任意數量、任意命名的 segment,不再假設剛好四段、也不再假設
// key 一定是 leg1~leg4。缺少 segment 的條目(理論上不該發生)直接跳過,
// 不強行塞進某一段造成錯誤分類。
function groupBySegment(entries: PublicEntry[]): Map<string, Checkpoint[]> {
  const groups = new Map<string, PublicEntry[]>()
  for (const e of entries) {
    const seg = e.detail?.segment
    if (!seg) continue
    const list = groups.get(seg) ?? []
    list.push(e)
    groups.set(seg, list)
  }
  const sorted = new Map<string, Checkpoint[]>()
  for (const [seg, list] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    sorted.set(
      seg,
      [...list].sort((a, b) => (a.detail?.order ?? Infinity) - (b.detail?.order ?? Infinity)).map(entryToCheckpoint),
    )
  }
  return sorted
}

// RouteMeta:每段路線的摘要資訊。title/subtitle/eyebrow 是純展示用文字,
// 對任意行程的 segment 沒有對應的後端資料來源,故改成可選——沒有值時
// 對應的區塊直接不渲染(見下方渲染邏輯),不用假資料頂著。totalKm 同理
// 可能算不出來(checkpoint 完全沒有 km 資料),故也允許 null。date 一樣
// 允許 null/undefined——「目前站」判斷(computeNowMark)拿不到可靠日期時,
// 直接視為不比對、不標記,不當成錯誤。
interface RouteMeta {
  title?: string
  subtitle?: string
  eyebrow?: string
  totalKm: number | null
  startTime: string
  finishTime: string
  avgSpeedKmh: number | null
  date?: string | null
}

// ---- 花東193公路 pace note(真實手寫紀錄轉錄,與 ch_57910e64 行程底下的
// entries 資料一致——這裡的陣列順序即建立順序,也就是紙條原始的先後順序)----
// 收錄全部條目,含沒記錄到時刻的純轉彎指示(km/depart/arrive 皆為 null)。
// 這批純轉彎指示依然依原始順序顯示,只是:
// - 右側不出現「離站/抵達」時間(顯示 —,見 CheckpointCard 的 hasTime 判斷)
// - 不計入里程進度條與「目前站」判斷(km 或時刻缺一,scheduleTime()/
//   進度條圓點都會直接跳過,見 computeNowMark)
// 里程數照紙條原始寫法保留,不強行從 0 起算(某幾段本來就是從路線中段
// 開始記錄),故部分路段的進度條起點不是 0%。

// PACE_PUBLIC_LINK_TOKEN:未登入的公開分享頁(/demo/pace,見
// pace/PacePage.tsx)讀取固定展示行程用的公開分享連結 token。由
// VITE_PACE_PUBLIC_LINK_TOKEN 決定(見 .env.development)。登入後的正式
// 介面(DesktopLayout.tsx)不使用這個 token——跟時間軸(Timeline)同一套
// 邏輯,改讀登入使用者目前選取的行程(見下方 tripID prop 與
// useEffect),不綁定固定行程,也不需要經過公開連結機制。
// export:pace/PacePage.tsx 掛載 PaceRouteMap 時也需要同一把 token(公開
// 頁的 compute-route 改走 /v1/public/{token}/compute-route,見 PaceRouteMap.tsx
// 的 publicToken prop 說明),不重複讀一次 import.meta.env,直接共用這份。
export const PACE_PUBLIC_LINK_TOKEN = import.meta.env.VITE_PACE_PUBLIC_LINK_TOKEN as string | undefined

// KNOWN_ROUTE_META:已知/手動維護的路線摘要,目前只有花東193公路 demo
// 行程的 leg1~leg4 四段——這些是純展示用的文字/彙總數字,後端 Entry/Detail
// 沒有對應的「整段路線摘要」資料結構可以承載,故仍維持手動維護的常數。
// 任意真實行程的 segment 名稱不會出現在這個表裡,會落到下方
// computeRouteMeta() 的通用推算路徑,不是這裡的責任。
const KNOWN_ROUTE_META: Record<string, RouteMeta> = {
  leg1: {
    title: '光復橋 → 富興客棧', subtitle: '193縣道・大農大富平地森林園區段', eyebrow: '路徑 · 花東193公路(Day 1 上半)',
    totalKm: 21.0, startTime: '09:00', finishTime: '12:30', avgSpeedKmh: null,
    date: '2026-07-31',
  },
  leg2: {
    title: '193縣道83K → 老家後山菜', subtitle: '瑞穗・虎爺溫泉段', eyebrow: '路徑 · 花東193公路(Day 1 下半)',
    totalKm: 16.3, startTime: '14:50', finishTime: '18:00', avgSpeedKmh: null,
    date: '2026-07-31',
  },
  leg3: {
    title: '青蓮寺 → 安通溫泉', subtitle: '193縣道・玉里柴埔天堂路段', eyebrow: '路徑 · 花東193公路(Day 2 上半)',
    totalKm: 28.0, startTime: '08:30', finishTime: '13:00', avgSpeedKmh: null,
    date: '2026-08-01',
  },
  leg4: {
    title: '安通鐵路驛站 → 太司步廊', subtitle: '板塊交接上橋段', eyebrow: '路徑 · 花東193公路(Day 2 下半)',
    totalKm: 7.5, startTime: '13:00', finishTime: '16:40', avgSpeedKmh: null,
    date: '2026-08-01',
  },
}

// KNOWN_ROUTE_LABELS:已知 segment 對應的分頁標籤文字,同樣只涵蓋
// leg1~leg4——維持既有 demo 行程的確切文案。
const KNOWN_ROUTE_LABELS: Record<string, string> = {
  leg1: 'Day1 光復橋',
  leg2: 'Day1 193/83K',
  leg3: 'Day2 青蓮寺',
  leg4: 'Day2 安通驛站',
}

// computeRouteMeta:任意行程的 segment(不在 KNOWN_ROUTE_META 裡)沒有
// 手動維護的摘要文字/數字可用,改由這一段的 checkpoints 本身推算出合理的
// 預設值——totalKm 取最大 km(或終點站 km);startTime/finishTime 取第一筆
// 有時刻的離站時間、最後一筆(終點優先)有時刻的抵達時間;title 用「起點
// → 終點」名稱組出來;subtitle/eyebrow 沒有對應資料來源,留空(渲染端會
// 因此不顯示這兩塊,見下方 JSX);date 沒有可靠來源,留 null,「目前站」
// 判斷會因此直接不比對(不是當成錯誤)。
function computeRouteMeta(checkpoints: Checkpoint[]): RouteMeta {
  const kms = checkpoints.map((cp) => cp.km).filter((km): km is number => km !== null)
  const finish = checkpoints.find((cp) => cp.isFinish)
  const totalKm = finish?.km ?? (kms.length > 0 ? Math.max(...kms) : null)

  const firstTimed = checkpoints.find((cp) => cp.depart !== null || cp.arrive !== null)
  const startTime = firstTimed?.depart ?? firstTimed?.arrive ?? '—'
  const lastTimed = [...checkpoints].reverse().find((cp) => cp.arrive !== null || cp.depart !== null)
  const finishTime = (finish ?? lastTimed)?.arrive ?? lastTimed?.depart ?? '—'

  const first = checkpoints[0]
  const last = checkpoints[checkpoints.length - 1]
  const title = first && last && first !== last ? `${first.name} → ${last.name}` : first?.name

  return {
    title,
    subtitle: undefined,
    eyebrow: undefined,
    totalKm,
    startTime,
    finishTime,
    avgSpeedKmh: null,
    date: null,
  }
}

// buildRoutes:bySegment 是 fetch 回來、依 segment 分組排序好的資料(見
// groupBySegment),依 segment key 字母序排列(Map 本身已經是排序過的,見
// groupBySegment)。已知 segment(leg1~leg4)套用手動維護的
// KNOWN_ROUTE_META/KNOWN_ROUTE_LABELS,維持既有 demo 行程的確切文案;
// 其餘任意 segment 落到 computeRouteMeta() 通用推算、標籤直接用 segment
// key 本身(沒有更好的來源可用)。
function buildRoutes(
  bySegment: Map<string, Checkpoint[]>,
): { key: string; label: string; checkpoints: Checkpoint[]; meta: RouteMeta }[] {
  return [...bySegment.entries()].map(([key, checkpoints]) => ({
    key,
    label: KNOWN_ROUTE_LABELS[key] ?? key,
    checkpoints,
    meta: KNOWN_ROUTE_META[key] ?? computeRouteMeta(checkpoints),
  }))
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
  geocoding,
}: {
  cp: Checkpoint
  isNow: boolean
  cardRef?: React.RefObject<HTMLDivElement>
  // onClick:通知父層「使用者點了這個檢查站」,由 PaceChart 的
  // handleCheckpointClick 往下傳——沒有座標的卡片一樣會掛這個 handler
  // (跟以前不同,以前完全不可點擊),點擊後由 handleCheckpointClick 決定
  // 要不要先呼叫後端補座標(見該函式的說明),不是在這裡判斷。
  onClick?: () => void
  // geocoding:這張卡片目前正在補座標(見 PaceChart 的 geocodingID)——
  // 顯示「定位中…」取代原本的離站/抵達時間,同時停用點擊,避免重複觸發。
  geocoding?: boolean
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
    <div className={stateClass} ref={cardRef} onClick={geocoding ? undefined : onClick}>
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
        {geocoding ? (
          <div className={`${styles.depVal} ${styles.mono}`}>定位中…</div>
        ) : (
          <>
            <div className={styles.depLabel}>{coreLabel}</div>
            <div className={`${styles.depVal} ${styles.mono}`}>{coreValue}</div>
          </>
        )}
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
  tripID,
  publicToken,
  onCheckpointClick,
  onRouteChange,
  savedEntry,
}: {
  // cfg:登入後正式介面(DesktopLayout.tsx)傳入自己的 ClientConfig,改走
  // 認證過的 fetchEntries 讀取資料。不傳時走公開連結 token(見下方
  // useEffect),依 publicToken 是否有值決定用哪一個 token(見該 prop
  // 說明)。
  cfg?: ClientConfig
  // tripID:登入後正式介面要讀取的行程 ID,跟時間軸(MultiTrackTimeline)
  // 同一套邏輯——用使用者目前選取的 activeTrip?.id,不綁定固定行程。
  // 沒有選取行程時(undefined/null)顯示提示訊息,不發任何請求(見下方
  // useEffect)。cfg 為 undefined(公開分享頁)時這個 prop 不會被使用。
  tripID?: string | null
  // publicToken:未登入的公開分享頁(cfg 為 undefined 時)要查詢的公開連結
  // token——真正的分享連結 /public/{token}(見 PublicViewScreen.tsx,任意
  // 使用者行程的分享連結,網址列上的動態 token)應該傳這個 prop 指定實際的
  // token。不傳時 fallback 用 PACE_PUBLIC_LINK_TOKEN(見下方常數說明,固定
  // 的 demo 展示行程專用,/demo/pace 那個獨立示範頁在用),維持該頁既有行為
  // 不變。
  publicToken?: string
  // onCheckpointClick:通知父層(DesktopLayout.tsx 登入後正式介面)使用者
  // 點了哪個檢查站,讓地圖(PaceRouteMap)能平移過去、進入手動微調座標模式。
  // 可選是因為 pace/PacePage.tsx(/demo/pace 公開分享頁)刻意不接這套
  // 互動(寫入座標需要登入身分,不該出現在公開頁),掛載時不傳這個 prop。
  onCheckpointClick?: (entry: { id: string; lat: number | null; lng: number | null }) => void
  // onRouteChange:目前選取的那一段(routeIdx 對應的 route.checkpoints)
  // 變動時往上通知——PaceRouteMap(地圖)畫路線需要這份依序排列的
  // checkpoint 清單(entry id,依 order 排序),但地圖跟這個元件是分開掛載
  // 的兩個 sibling(桌面版側欄+主區、手機版抽屜+主顯示區皆然),資料只有
  // 這裡有,故用這個 callback 把「目前這一段有哪些 checkpoint」往上鏡像給
  // 共同的父層(DesktopLayout.tsx/PhoneContent.tsx),再由父層轉傳給
  // PaceRouteMap——同一套模式比照 ChatScreen 的 onTimelineData 鏡像
  // 機制。可選是因為 pace/PacePage.tsx 公開分享頁沒有相鄰的地圖
  // 元件可以接收這份資料,不需要傳。
  onRouteChange?: (checkpoints: Checkpoint[]) => void
  // savedEntry:地圖(PaceRouteMap.tsx)那邊手動拖曳選點、按下「儲存座標」
  // 成功後,由共同的父層把「哪一筆存了什麼座標」轉傳回來——這裡收到後就地
  // 更新 checkpointsBySegment 對應那一筆的 lat/lng,理由同
  // handleCheckpointClick 內 geocode 成功後的本地 state patch:PaceChart
  // 是 checkpointsBySegment 這份資料唯一的擁有者,PaceRouteMap 那邊的
  // PATCH .../latlng 直接打後端、不會自動同步回這裡,沒有這個 prop 的話
  // 存完座標後側欄清單/下一次算路線用的座標都還是存檔前的舊值,只能整頁
  // 重新整理才會反映。用物件參照本身(而非拆開的 id/lat/lng)當 useEffect
  // 依賴值,呼叫端每次「真的存了一筆新座標」才會建立新物件,不會因為父層
  // 其他無關的重渲染而重複觸發。
  savedEntry?: { id: string; lat: number; lng: number } | null
}) {
  const [routeIdx, setRouteIdx] = useState(0)
  const [nowMark, setNowMark] = useState<NowMark | null>(null)
  // copied:分享按鈕點擊後短暫顯示「已複製連結」的回饋文字,2 秒後恢復。
  const [copied, setCopied] = useState(false)
  // checkpointsBySegment/loadError:任意數量的段落,全部改讀後端真實 Entry
  // (見 PACE_PUBLIC_LINK_TOKEN 的說明),一次 fetch 拿全部條目再依
  // detail.segment 分組(見 groupBySegment,依實際出現過的 segment 值動態
  // 建立,不假設剛好四段)。null 代表還在載入中或已失敗——刻意不用假資料
  // 頂著,fetch 失敗時要讓使用者看到明確的錯誤,而不是安靜地顯示一份可能
  // 早已過時的寫死資料,掩蓋掉真實的失敗狀態。
  const [checkpointsBySegment, setCheckpointsBySegment] = useState<Map<
    PaceSegment,
    Checkpoint[]
  > | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // geocodingID/geocodeErr:點擊尚未有座標的檢查站卡片時,先呼叫後端
  // geocodeEntry(用這筆 entry 的 title 查座標並自動寫回)補上座標,成功後
  // 才呼叫 onCheckpointClick 通知父層平移地圖——地圖(PaceRouteMap.tsx)的
  // 既有互動假設 lat/lng 已知,沒座標的卡片不能直接套用同一條路徑。
  // geocodingID 記錄「目前正在補座標的是哪一筆」,驅動該卡片的載入態視覺
  // 回饋;一次只會有一筆在補(卡片點擊處理中會忽略後續點擊,見下方
  // handleCheckpointClick)。
  const [geocodingID, setGeocodingID] = useState<string | null>(null)
  const [geocodeErr, setGeocodeErr] = useState<string | null>(null)

  useEffect(() => {
    // 登入後正式介面(cfg 有值)但還沒選行程:比照時間軸「選擇一個行程後
    // 顯示時間軸。」的作法,不發任何請求,只顯示提示訊息,也不當成錯誤。
    if (cfg && !tripID) {
      setCheckpointsBySegment(null)
      setLoadError(null)
      return
    }
    let cancelled = false
    // 登入後正式介面(cfg 有值):走一般認證過的行程 entries API,讀取
    // 使用者目前選取的行程(tripID),不再經過公開連結 token。未登入的
    // 公開分享頁(cfg 為 undefined):走公開連結 token——優先用呼叫端傳入的
    // publicToken(真正的分享連結 /public/{token},見該 prop 說明),沒傳
    // 才 fallback 用固定的 PACE_PUBLIC_LINK_TOKEN(/demo/pace 那個獨立示範
    // 頁專用)。
    const effectiveToken = publicToken ?? PACE_PUBLIC_LINK_TOKEN
    const load = cfg
      ? fetchEntries(cfg, tripID!).then((entries) => entries as unknown as PublicEntry[])
      : (() => {
          if (!effectiveToken) {
            return Promise.reject(new Error('未設定 VITE_PACE_PUBLIC_LINK_TOKEN(見 web/.env.development)'))
          }
          return fetch(`${BASE_URL}/v1/public/${effectiveToken}`).then(async (res) => {
            if (!res.ok) {
              const text = await res.text().catch(() => '')
              throw new Error(`載入路徑資料失敗(${res.status}): ${text.slice(0, 200)}`)
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
  }, [cfg, tripID, publicToken])

  // routes/route 用 useMemo 包住,只在 checkpointsBySegment 真的變動(重新
  // fetch 完成)時才重新建立——buildRoutes() 每次呼叫都會回傳新的陣列/物件
  // 參照,若不memo,route.checkpoints 這個參照會在「每一次渲染」都不同,
  // 即使底層資料完全沒變。這會讓下方 onRouteChange 那個 effect(依賴
  // route.checkpoints)每次渲染都判定「依賴變了」而重新觸發、呼叫
  // setPaceCheckpoints(在父層),導致父層重渲染、這裡再重渲染,形成無窮
  // 迴圈(實測會直接跳出 React 的 "Maximum update depth exceeded" 警告)。
  const routes = useMemo(
    () => buildRoutes(checkpointsBySegment ?? new Map()),
    [checkpointsBySegment],
  )
  // route:routes 現在长度不再保證固定為 4(依實際出現的 segment 數量而
  // 定),理論上也可能是空陣列(行程所有 entries 都沒有 detail.segment)。
  // fallback 一個空段落,避免下方邏輯對 undefined 取屬性而炸掉——渲染端
  // 對 checkpoints.length === 0 本身就有既有的空清單呈現方式,不需要額外
  // 處理。用 useMemo 包住 fallback 物件本身:routes 為空陣列時(例如這個
  // 行程完全沒有 detail.segment 資料)每次 render 若直接 new 一個 fallback
  // 物件字面量,route.checkpoints 參照每次都不同,會讓下方依賴
  // route.checkpoints 的 onRouteChange effect 誤判「變了」而每次渲染都重新
  // 觸發、setPaceCheckpoints(在父層)→ 父層重渲染 → 這裡再重渲染,形成無窮
  // 迴圈(實測會跳出 React 的 "Maximum update depth exceeded")。
  const route = useMemo(
    () =>
      routes[routeIdx] ?? {
        key: '',
        label: '',
        checkpoints: [] as Checkpoint[],
        meta: { totalKm: null, startTime: '—', finishTime: '—', avgSpeedKmh: null } as RouteMeta,
      },
    [routes, routeIdx],
  )
  // 沿用 App.tsx todayRef 的既有寫法:型別維持非 nullable 的 RefObject<HTMLDivElement>
  // (跟 React 18 的 RefObject<T> 定義一致,才能直接傳給 <div ref>),掛載前用
  // as unknown as HTMLDivElement 頂住初始值,實際使用前一律先檢查 .current 是否存在。
  const nowCardRef = useRef<HTMLDivElement>(null as unknown as HTMLDivElement)

  // 切換路線分頁、或裝置時間變動時重算一次即可(「進來看一眼」的情境,
  // 不需要每秒即時追蹤)。
  useEffect(() => {
    // meta.date 沒有值(通用推算路徑,見 computeRouteMeta)或 totalKm 算不
    // 出來時,直接不比對、不標記「目前站」,不當成錯誤——理由見 RouteMeta
    // 的說明。
    if (!route.meta.date || route.meta.date !== todayStr() || route.meta.totalKm === null) {
      setNowMark(null)
      return
    }
    const now = new Date()
    const nowMin = now.getHours() * 60 + now.getMinutes()
    setNowMark(computeNowMark(route.checkpoints, route.meta.totalKm, nowMin))
  }, [route])

  // 把目前這一段的 checkpoints 鏡像給外層(見上方 onRouteChange 的說明)。
  // 依賴陣列刻意用 route.checkpoints(陣列參照,只有 checkpointsBySegment
  // 真的重新 setState 或 routeIdx 切換時才會變),不放 onRouteChange 本身
  // ——理由同 ChatScreen.tsx 的 onTimelineData effect:呼叫端若用內聯函式
  // 傳入,每次重渲染都是新的參照,放進依賴陣列會導致這個 effect 過度重跑。
  useEffect(() => {
    onRouteChange?.(route.checkpoints)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.checkpoints])

  // savedEntry 變動時,就地更新 checkpointsBySegment 對應那一筆的座標——
  // 見上方 savedEntry prop 的說明,同一套 patch 寫法比照
  // handleCheckpointClick 內 geocode 成功後的處理。
  useEffect(() => {
    if (!savedEntry) return
    setCheckpointsBySegment((prev) => {
      if (!prev) return prev
      const next = new Map(prev)
      for (const [key, list] of next) {
        next.set(
          key,
          list.map((c) => (c.id === savedEntry.id ? { ...c, lat: savedEntry.lat, lng: savedEntry.lng } : c)),
        )
      }
      return next
    })
  }, [savedEntry])

  // 自動捲動到目前站(等 nowMark 算出來、DOM 掛上 ref 之後才捲動)。
  useEffect(() => {
    if (nowMark && nowCardRef.current) {
      nowCardRef.current.scrollIntoView({ behavior: 'instant', block: 'center' })
    }
  }, [nowMark])

  // handleCheckpointClick:點擊檢查站卡片——已經有座標的直接照原本邏輯通知
  // 父層(onCheckpointClick);沒有座標的先呼叫後端 geocodeEntry 用 title
  // 查座標並寫回,成功後才通知父層,讓地圖能照常平移過去。cfg 必為真值
  // 才會呼叫這個函式(見下方 CheckpointCard 的 onClick 只在 cfg &&
  // onCheckpointClick 都存在時才掛,公開分享頁沒有 cfg,不接這套互動,
  // 理由同 onCheckpointClick prop 本身的說明)。
  async function handleCheckpointClick(cp: Checkpoint) {
    if (!onCheckpointClick) return
    if (cp.lat !== null && cp.lng !== null) {
      onCheckpointClick({ id: cp.id, lat: cp.lat, lng: cp.lng })
      return
    }
    if (!cfg || geocodingID) return
    setGeocodingID(cp.id)
    setGeocodeErr(null)
    try {
      const result = await geocodeEntry(cfg, cp.id)
      // 把查到的座標寫回本地狀態,讓卡片立刻反映「已有座標」(不用等下次
      // 重新 fetch 整個行程),理由同 checkpointsBySegment 本身的資料流:
      // 這裡是唯一的資料來源,route/routes 都是從它 useMemo 出來的。
      setCheckpointsBySegment((prev) => {
        if (!prev) return prev
        const next = new Map(prev)
        for (const [key, list] of next) {
          next.set(
            key,
            list.map((c) => (c.id === cp.id ? { ...c, lat: result.lat, lng: result.lng } : c)),
          )
        }
        return next
      })
      onCheckpointClick({ id: cp.id, lat: result.lat, lng: result.lng })
    } catch (e) {
      setGeocodeErr(e instanceof Error ? e.message : String(e))
      // 自動定位失敗(常見於純轉彎指示這類非地名文字,查無結果)不代表使用者
      // 就此無法儲存座標——仍然通知父層(帶 null 座標),讓地圖
      // (PaceRouteMap.tsx)開啟選點圖釘與「儲存座標」按鈕,使用者可以自己在
      // 地圖上手動拖曳選位置存檔,不需要卡在「自動查不到就完全沒有入口」。
      onCheckpointClick({ id: cp.id, lat: null, lng: null })
    } finally {
      setGeocodingID(null)
    }
  }

  // 跟時間軸(DesktopLayout.tsx 的「選擇一個行程後顯示時間軸。」)
  // 同一套邏輯:登入後正式介面還沒選行程時,只顯示提示,不當成錯誤、
  // 也不用「載入中」那組畫面(根本沒有發出任何請求)。
  if (cfg && !tripID) {
    return (
      <div className="pace-chart">
        <div className="empty">選擇一個行程後顯示路徑。</div>
      </div>
    )
  }

  // 四段 checkpoint 資料共用同一次 fetch,還在載入或已失敗時,四個分頁
  // 都顯示同一組載入中/錯誤畫面,不再有「只影響其中一段」的情況。
  if (loadError) {
    return (
      <div className="pace-chart">
        <div className="rp-map-error">
          <span>路徑載入失敗</span>
          <span className="rp-map-error-detail">{loadError}</span>
        </div>
      </div>
    )
  }
  if (checkpointsBySegment === null) {
    return (
      <div className="pace-chart">
        <p className={styles.eyebrow}>載入路徑資料中…</p>
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
          行程,分享出去的公開頁不需要登入、不涉及任何真實資料權限問題——
          跟 /public/{token} 那套給真實行程用的公開分享連結是分開的機制,
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
        {copied ? '已複製連結' : '分享這個路徑'}
      </button>

      {/* eyebrow/subtitle 是純裝飾文字,通用推算路徑(computeRouteMeta)
          沒有對應資料來源,值為 undefined 時直接不渲染,不顯示假標題;
          title 有值(已知路線的手動文案,或通用推算的「起點 → 終點」)才
          渲染。 */}
      {route.meta.eyebrow && <p className={styles.eyebrow}>{route.meta.eyebrow}</p>}
      {route.meta.title && <h1 className={styles.title}>{route.meta.title}</h1>}
      {route.meta.subtitle && <p className={styles.routeSub}>{route.meta.subtitle}</p>}

      <div className={styles.summary}>
        <div className={styles.statRow}>
          {/* totalKm 可能算不出來(checkpoints 完全沒有 km 資料)——這種
              情況下不顯示總里程這個 stat,而不是顯示 NaN/0.0。 */}
          {route.meta.totalKm !== null && (
            <div className={styles.stat}>
              <div className={styles.statLabel}>總里程</div>
              <div className={`${styles.statValue} ${styles.accent} ${styles.mono}`}>
                {route.meta.totalKm.toFixed(1)}<span className={styles.unit}> km</span>
              </div>
            </div>
          )}
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
          {nowMark && route.meta.totalKm !== null && (
            <div className={styles.stripNow} style={{ left: `${nowMark.fracKm * 100}%` }} />
          )}
        </div>
        <div className={styles.stripLabels}>
          <span>0 km</span>
          <span>{route.meta.totalKm !== null ? (route.meta.totalKm / 2).toFixed(0) : '—'} km</span>
          <span>{route.meta.totalKm !== null ? route.meta.totalKm.toFixed(0) : '—'} km</span>
        </div>
      </div>

      <div className={styles.tableTitle}>
        <span>檢查站</span>
        <span className={styles.count}>{route.checkpoints.length} 站</span>
      </div>

      {geocodeErr && <div className="banner">定位失敗:{geocodeErr}</div>}
      <div className={styles.stops}>
        {route.checkpoints.map((cp, i) => (
          <CheckpointCard
            key={cp.name}
            cp={cp}
            isNow={nowMark?.checkpointIndex === i}
            cardRef={nowMark?.checkpointIndex === i ? nowCardRef : undefined}
            onClick={onCheckpointClick ? () => handleCheckpointClick(cp) : undefined}
            geocoding={geocodingID === cp.id}
          />
        ))}
      </div>
    </div>
  )
}

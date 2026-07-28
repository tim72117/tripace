import { useEffect, useRef, useState } from 'react'
import { PaceRouteMap } from './PaceRouteMap'

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
  name: string
  km: number | null // null:純轉彎指示,紙條上沒寫里程(仍依原始順序顯示,只是不進里程進度條)
  tag: string | null // null:起點/終點無標籤(顯示起點/終點徽章代替)
  arrive: string | null // "HH:MM",起點無抵達時間
  dwellMin: number | null // 停留分鐘數,起點/終點無停留
  depart: string | null // "HH:MM",終點無離站時間(用抵達時間當核心數字);兩者皆 null 表示紙條沒記錄時刻
  isStart?: boolean
  isFinish?: boolean
  isLongRest?: boolean // 長休息站(如午餐):視覺上用警示色系區分
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
  assumptions: string
  footer: string
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

const LEG1_CHECKPOINTS: Checkpoint[] = [
  { name: '光復橋啟', km: 0.0, tag: null, arrive: null, dwellMin: null, depart: '09:00', isStart: true },
  { name: '左轉 明池街(花52)', km: null, tag: null, arrive: null, dwellMin: null, depart: null },
  { name: 'R轉193', km: 5.0, tag: null, arrive: null, dwellMin: null, depart: null },
  { name: '(68.5K路牌)〔補〕', km: 6.0, tag: '補給', arrive: null, dwellMin: null, depart: '10:00' },
  { name: 'R轉大農大富', km: 9.3, tag: null, arrive: null, dwellMin: null, depart: null },
  { name: '大農停車廠〔進〕', km: 10.5, tag: null, arrive: null, dwellMin: null, depart: '10:55' },
  { name: 'L轉「南自行車道」', km: null, tag: null, arrive: null, dwellMin: null, depart: null },
  { name: '七彩釣竿橋', km: 12.0, tag: null, arrive: null, dwellMin: null, depart: null },
  { name: '過橋L轉、R.L往南自行車道', km: 12.1, tag: null, arrive: null, dwellMin: null, depart: '11:20' },
  { name: '大富火車站', km: 17.0, tag: null, arrive: null, dwellMin: null, depart: '12:00' },
  { name: '過富源國中續轉', km: 19.0, tag: null, arrive: null, dwellMin: null, depart: null },
  { name: 'L轉富源火車路旁 富興客棧', km: 21.0, tag: null, arrive: '12:30', dwellMin: null, depart: null, isFinish: true },
]
const LEG1_META: RouteMeta = {
  title: '光復橋 → 富興客棧', subtitle: '193縣道・大農大富平地森林園區段', eyebrow: '配速表 · 花東193公路(Day 1 上半)',
  totalKm: 21.0, startTime: '09:00', finishTime: '12:30', avgSpeedKmh: null,
  assumptions: '手寫 pace note 轉錄,時刻為紙條原始紀錄的離站/抵達時間,非估算值。沒記錄到時刻的轉彎指示一併列出,只是不計入進度條。',
  footer: '里程與地標依手寫 pace note 轉錄。',
  date: '2026-07-31',
}

const LEG2_CHECKPOINTS: Checkpoint[] = [
  { name: '193 83公里處', km: 6.6, tag: null, arrive: null, dwellMin: null, depart: '14:50', isStart: true },
  { name: '屋拉力商店', km: 8.9, tag: null, arrive: null, dwellMin: null, depart: '15:10' },
  { name: '瑞穗大橋', km: 9.0, tag: null, arrive: null, dwellMin: null, depart: null },
  { name: '虎爺溫泉', km: 13.5, tag: null, arrive: null, dwellMin: null, depart: '17:40' },
  { name: '老家後山菜', km: 16.3, tag: null, arrive: '18:00', dwellMin: null, depart: null, isFinish: true },
]
const LEG2_META: RouteMeta = {
  title: '193縣道83K → 老家後山菜', subtitle: '瑞穗・虎爺溫泉段', eyebrow: '配速表 · 花東193公路(Day 1 下半)',
  totalKm: 16.3, startTime: '14:50', finishTime: '18:00', avgSpeedKmh: null,
  assumptions: '手寫 pace note 轉錄,時刻為紙條原始紀錄的離站/抵達時間,非估算值。里程從紙條原始數字起算(非重新歸零)。',
  footer: '里程與地標依手寫 pace note 轉錄。',
  date: '2026-07-31',
}

const LEG3_CHECKPOINTS: Checkpoint[] = [
  { name: '青蓮寺', km: 0.0, tag: null, arrive: null, dwellMin: null, depart: '08:30', isStart: true },
  { name: '花62接193', km: null, tag: null, arrive: null, dwellMin: null, depart: null },
  { name: '泰林社區籃球場〔補〕', km: 6.8, tag: '補給', arrive: null, dwellMin: null, depart: '09:30' },
  { name: '193 97.2K處、R轉玉里柴埔天堂路〔進〕', km: 9.0, tag: null, arrive: null, dwellMin: null, depart: '10:15' },
  { name: '東豐愛心樹〔進〕', km: 17.0, tag: null, arrive: null, dwellMin: null, depart: '11:30' },
  { name: '安通溫泉', km: 28.0, tag: null, arrive: '13:00', dwellMin: null, depart: null, isFinish: true },
]
const LEG3_META: RouteMeta = {
  title: '青蓮寺 → 安通溫泉', subtitle: '193縣道・玉里柴埔天堂路段', eyebrow: '配速表 · 花東193公路(Day 2 上半)',
  totalKm: 28.0, startTime: '08:30', finishTime: '13:00', avgSpeedKmh: null,
  assumptions: '手寫 pace note 轉錄,時刻為紙條原始紀錄的離站/抵達時間,非估算值。沒記錄到時刻的轉彎指示一併列出,只是不計入進度條。',
  footer: '里程與地標依手寫 pace note 轉錄。',
  date: '2026-08-01',
}

const LEG4_CHECKPOINTS: Checkpoint[] = [
  { name: '安通鐵路驛站', km: 2.5, tag: null, arrive: null, dwellMin: null, depart: '13:00', isStart: true },
  { name: '板塊交接上橋', km: 5.5, tag: null, arrive: null, dwellMin: null, depart: null },
  { name: '忠孝紀念碑', km: 6.0, tag: null, arrive: null, dwellMin: null, depart: '16:40' },
  { name: '出口．中心路一段R轉', km: null, tag: null, arrive: null, dwellMin: null, depart: null },
  { name: '太司步廊', km: 7.5, tag: null, arrive: null, dwellMin: null, depart: null, isFinish: true },
]
const LEG4_META: RouteMeta = {
  title: '安通鐵路驛站 → 太司步廊', subtitle: '板塊交接上橋段', eyebrow: '配速表 · 花東193公路(Day 2 下半)',
  totalKm: 7.5, startTime: '13:00', finishTime: '16:40', avgSpeedKmh: null,
  assumptions: '手寫 pace note 轉錄,時刻為紙條原始紀錄的離站/抵達時間,非估算值。終點「太司步廊」紙條沒記錄時刻(最後一個有時刻的點是忠孝紀念碑 16:40)。',
  footer: '里程與地標依手寫 pace note 轉錄。',
  date: '2026-08-01',
}

const ROUTES: { key: string; label: string; checkpoints: Checkpoint[]; meta: RouteMeta }[] = [
  { key: 'leg1', label: 'Day1 光復橋', checkpoints: LEG1_CHECKPOINTS, meta: LEG1_META },
  { key: 'leg2', label: 'Day1 193/83K', checkpoints: LEG2_CHECKPOINTS, meta: LEG2_META },
  { key: 'leg3', label: 'Day2 青蓮寺', checkpoints: LEG3_CHECKPOINTS, meta: LEG3_META },
  { key: 'leg4', label: 'Day2 安通驛站', checkpoints: LEG4_CHECKPOINTS, meta: LEG4_META },
]

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
  if (cp.isLongRest) return 'pace-tag pace-tag-rest'
  if (cp.isFinish) return 'pace-tag pace-tag-finish'
  return 'pace-tag'
}

function CheckpointCard({
  cp,
  isNow,
  cardRef,
}: {
  cp: Checkpoint
  isNow: boolean
  cardRef?: React.RefObject<HTMLDivElement>
}) {
  const stateClass = [
    'pace-stop',
    cp.isLongRest ? 'is-rest-long' : '',
    cp.isFinish ? 'is-finish' : '',
    isNow ? 'is-now' : '',
  ].filter(Boolean).join(' ')

  // 核心數字:起點/中途站顯示離站時間(離站是配速表的重點),終點顯示抵達時間。
  // 兩者皆無(紙條沒記錄到這站的時刻)時顯示 —,不留空、不讓卡片右側整塊消失。
  const hasTime = cp.depart !== null || cp.arrive !== null
  const coreLabel = !hasTime ? '' : cp.isFinish ? '抵達' : cp.isStart ? '出發' : '離站'
  const coreValue = !hasTime ? '—' : cp.isFinish ? cp.arrive : cp.depart

  return (
    <div className={stateClass} ref={cardRef}>
      <div className="pace-stop-left">
        {isNow && (
          <div className="pace-now-flag">
            <span className="pace-now-dot" />
            目前站
          </div>
        )}
        {cp.isStart && <div className="pace-start-badge">🚩 起點</div>}
        {cp.isFinish && <div className="pace-finish-badge">🏁 終點</div>}
        <div className="pace-loc-name">{cp.name}</div>
        {(cp.tag || cp.km !== null) && (
          <div className="pace-loc-meta">
            {cp.tag && <span className={tagColorClass(cp)}>{cp.tag}</span>}
            {cp.km !== null && <span className="pace-km-val pace-mono">{cp.km.toFixed(1)} km</span>}
          </div>
        )}
      </div>
      <div className="pace-stop-right">
        <div className="pace-dep-label">{coreLabel}</div>
        <div className="pace-dep-val pace-mono">{coreValue}</div>
        {cp.arrive && !cp.isFinish && (
          <span className={cp.isLongRest ? 'pace-dwell-val long' : 'pace-dwell-val'}>
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

export function PaceChartDemo() {
  const [routeIdx, setRouteIdx] = useState(0)
  const [nowMark, setNowMark] = useState<NowMark | null>(null)
  const route = ROUTES[routeIdx]
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

  return (
    <div className="pace-chart">
      <div className="pace-route-tabs">
        {ROUTES.map((r, i) => (
          <button
            key={r.key}
            type="button"
            className={i === routeIdx ? 'pace-route-tab is-active' : 'pace-route-tab'}
            onClick={() => setRouteIdx(i)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <p className="pace-eyebrow">{route.meta.eyebrow}</p>
      <h1 className="pace-title">{route.meta.title}</h1>
      <p className="pace-route-sub">{route.meta.subtitle}</p>

      <div className="pace-summary">
        <div className="pace-stat-row">
          <div className="pace-stat">
            <div className="pace-stat-label">總里程</div>
            <div className="pace-stat-value accent pace-mono">
              {route.meta.totalKm.toFixed(1)}<span className="unit"> km</span>
            </div>
          </div>
          <div className="pace-stat">
            <div className="pace-stat-label">出發</div>
            <div className="pace-stat-value pace-mono">{route.meta.startTime}</div>
          </div>
          <div className="pace-stat">
            <div className="pace-stat-label">抵達</div>
            <div className="pace-stat-value pace-mono">{route.meta.finishTime}</div>
          </div>
        </div>
      </div>

      <div className="pace-strip-wrap">
        <div className="pace-strip-track">
          <div className="pace-strip-fill" />
          {nowMark && (
            <div className="pace-strip-now" style={{ left: `${nowMark.fracKm * 100}%` }} />
          )}
        </div>
        <div className="pace-strip-labels">
          <span>0 km</span>
          <span>{(route.meta.totalKm / 2).toFixed(0)} km</span>
          <span>{route.meta.totalKm.toFixed(0)} km</span>
        </div>
      </div>

      <p className="pace-assumptions">
        <b>配速假設</b> — {route.meta.assumptions}
      </p>

      <div className="pace-table-title">
        <span>檢查站</span>
        <span className="count">{route.checkpoints.length} 站</span>
      </div>

      <div className="pace-stops">
        {route.checkpoints.map((cp, i) => (
          <CheckpointCard
            key={cp.name}
            cp={cp}
            isNow={nowMark?.checkpointIndex === i}
            cardRef={nowMark?.checkpointIndex === i ? nowCardRef : undefined}
          />
        ))}
      </div>

      <div className="pace-table-title">
        <span>路線地圖示範</span>
      </div>
      <PaceRouteMap />

      <footer className="pace-footer">{route.meta.footer}</footer>
    </div>
  )
}

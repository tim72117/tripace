import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PLAYFUL_ITINERARY, type PlayfulStop } from './itineraryPlayfulMapData'
import styles from './ItineraryPlayfulMapPage.module.css'

// ItineraryPlayfulMapPage:構想一附錄四——「尋寶手帳攤開頁」版面雛形。
//
// 緣起(2026-10):正式功能 AiItineraryDetailPageMapView.tsx 的「地圖全幅
// 背景 + 左美食面板 + 右時間軸面板」版面最近做了局部活潑化(手繪貼紙卡、
// 古城風格地圖邊框),使用者進一步想看「整體版面構圖本身」能不能更活潑。
// 這份雛形把整個畫面當成一本攤開的旅行手帳:
//
//   左頁(地圖頁)——手繪尋寶地圖:暖色漸層+格線+暗角三層底圖(沿用
//     RoutePathMapSkeletonPage.module.css 的 .mapCanvas 做法),路徑線是
//     虛線「尋寶步徑」,站點是帶號碼的水滴圖釘貼紙(景點硃紅、美食苔綠),
//     目前站點腳下畫一個「X 藏寶標記」+ 脈動光圈;右上角有羅盤裝飾。
//   右頁(手帳頁)——橫線筆記紙上貼拍立得:每一站是一張用和紙膠帶貼住、
//     微微歪斜的拍立得,左上角蓋橡皮章式的時間戳;美食口袋名單做成
//     「夾在頁裡的收據」(對齊正式功能的美食清單面板概念)。
//   頁緣 Day 索引標籤——像筆記本側邊的索引耳,切換第幾天;另一天的
//     圖釘與路徑在地圖上淡化但仍可點,點了會自動翻到那天。
//   下緣護照戳章列——跨天連續編號的圓戳,走到的站點蓋上「已到」墨色,
//     還沒到的只剩虛線框;點戳章可直接跳站,「上一站/下一站」按鈕也接
//     在這一列,讓「順序感」有一個獨立於地圖與手帳的進度列。
//
// 跟構想一附錄(路徑線斜切地圖 + 單一卡片)/附錄二(整頁懶人包)/附錄三
// (大富翁棋盤)一樣是同一份行程的另一種瀏覽骨架:附錄聚焦地圖互動、附錄二
// 聚焦一次看完、附錄三聚焦棋盤繞圈順序感,這裡聚焦「地圖與時間軸並置成
// 一本手帳的兩頁」,讓地圖跟時間軸是平起平坐的兩個主角,而不是「地圖是
// 背景、面板浮在上面」。
//
// 互動模式沿用 activeId 慣例(對齊附錄/附錄三):地圖圖釘、手帳拍立得、
// 護照戳章三處點擊都寫同一個 activeId,三處視覺同步高亮。
const ITINERARY = PLAYFUL_ITINERARY

// buildTrailPath——把同一天的站點依 order 串成平滑的 SVG 路徑(viewBox
// 100x75,對齊 4:3 畫布)。用相鄰兩點的中點當 Q 曲線的錨點,讓線條像
// 手畫的彎曲步徑,而不是尺畫的折線。
function buildTrailPath(stops: PlayfulStop[]): string {
  const pts = stops.map((s) => ({ x: s.xPct, y: (s.yPct * 75) / 100 }))
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]
    const cur = pts[i]
    const mx = (prev.x + cur.x) / 2
    const my = (prev.y + cur.y) / 2
    // 控制點往垂直方向偏一點,讓每一段都有一個小弧度。
    const bend = i % 2 === 0 ? 4 : -4
    d += ` Q ${mx + bend} ${my - bend} ${cur.x} ${cur.y}`
  }
  return d
}

function CompassRose() {
  return (
    <svg className={styles.compass} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="18" className={styles.compassRing} />
      <circle cx="20" cy="20" r="13" className={styles.compassRingInner} />
      <path d="M20 3 L23 20 L20 37 L17 20 Z" className={styles.compassNeedleN} />
      <path d="M3 20 L20 17 L37 20 L20 23 Z" className={styles.compassNeedleE} />
      <text x="20" y="9" textAnchor="middle" className={styles.compassText}>
        N
      </text>
    </svg>
  )
}

export function ItineraryPlayfulMapPage() {
  const stops = [...ITINERARY.stops].sort((a, b) => a.order - b.order)
  const [activeId, setActiveId] = useState<string>(stops[0].id)
  const active = stops.find((s) => s.id === activeId) ?? stops[0]
  const day = active.day
  const dayInfo = ITINERARY.days.find((d) => d.day === day) ?? ITINERARY.days[0]
  const dayStops = stops.filter((s) => s.day === day)
  const activeIndex = stops.findIndex((s) => s.id === active.id)

  const goTo = (index: number) => {
    const next = stops[Math.max(0, Math.min(stops.length - 1, index))]
    if (next) setActiveId(next.id)
  }

  // 切換天數時跳到那天的第一站——Day 索引耳是「翻頁」,翻過去自然停在
  // 那一頁的第一站。
  const switchDay = (d: 1 | 2) => {
    const first = stops.find((s) => s.day === d)
    if (first) setActiveId(first.id)
  }

  // 兩天之間的連接線——第一天最後一站 → 第二天第一站,用更淡的點線畫,
  // 表示「隔天移動」而非同一天步行。
  const day1 = stops.filter((s) => s.day === 1)
  const day2 = stops.filter((s) => s.day === 2)
  const bridge =
    day1.length && day2.length
      ? `M ${day1[day1.length - 1].xPct} ${(day1[day1.length - 1].yPct * 75) / 100} L ${day2[0].xPct} ${(day2[0].yPct * 75) / 100}`
      : ''

  const foodPicksOfDay = ITINERARY.foodPicks.filter((f) => dayStops.some((s) => s.id === f.nearStopId))

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link to="/" className={styles.back}>
          ← 回雛形列表
        </Link>
        <h1 className={styles.heading}>構想一附錄四：尋寶手帳攤開頁</h1>
        <p className={styles.subheading}>
          把整個畫面當成一本攤開的旅行手帳——左頁是手繪尋寶地圖，右頁是貼滿拍立得與和紙膠帶的日記頁，
          頁緣的索引耳翻 Day 1 / Day 2，下緣一排護照戳章標示「走到第幾站」。
          地圖與時間軸是平起平坐的兩頁，不再是「地圖當背景、面板浮在上面」。
        </p>

        <div className={styles.journal}>
          {/* 左頁：尋寶地圖 */}
          <section className={styles.pageLeft} aria-label="尋寶地圖頁">
            <div className={styles.pageHeaderLeft}>
              <span className={styles.pageTitleScript}>{ITINERARY.title}</span>
              <span className={styles.pageDayTheme}>
                {dayInfo.label}・{dayInfo.theme}
              </span>
            </div>

            <div className={styles.mapFrame}>
              <div className={styles.mapCanvas}>
                <div className={styles.mapGrid} />
                <div className={styles.mapVignette} />
                <div className={`${styles.doodle} ${styles.doodleSea}`} aria-hidden="true">
                  ～ 台江內海 ～
                </div>
                <div className={`${styles.doodle} ${styles.doodleCanal}`} aria-hidden="true">
                  安平運河
                </div>
                <div className={`${styles.doodle} ${styles.doodleOld}`} aria-hidden="true">
                  府城舊城區
                </div>
                <CompassRose />

                <svg className={styles.mapSvg} viewBox="0 0 100 75" preserveAspectRatio="none" aria-hidden="true">
                  <path d={bridge} className={styles.trailBridge} />
                  {ITINERARY.days.map((d) => {
                    const path = buildTrailPath(stops.filter((s) => s.day === d.day))
                    const dim = d.day !== day
                    return (
                      <g key={d.day} className={dim ? styles.trailDim : undefined}>
                        <path d={path} className={styles.trailShadow} />
                        <path d={path} className={styles.trail} />
                      </g>
                    )
                  })}
                  {/* X 藏寶標記——畫在目前站點腳下 */}
                  <g
                    className={styles.xMark}
                    transform={`translate(${active.xPct} ${(active.yPct * 75) / 100 + 2})`}
                  >
                    <path d="M-2.4 -2.4 L2.4 2.4 M2.4 -2.4 L-2.4 2.4" />
                  </g>
                </svg>

                {stops.map((s) => {
                  const isActive = s.id === active.id
                  const dim = s.day !== day
                  const cls = [
                    styles.pin,
                    s.kind === 'food' ? styles.pinFood : styles.pinSpot,
                    isActive ? styles.pinActive : '',
                    dim ? styles.pinDim : '',
                  ]
                    .filter(Boolean)
                    .join(' ')
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={cls}
                      style={{ left: `${s.xPct}%`, top: `${s.yPct}%` }}
                      onClick={() => setActiveId(s.id)}
                      aria-label={`第 ${s.order} 站 ${s.name}`}
                      aria-pressed={isActive}
                    >
                      {isActive && <span className={styles.pinPulse} />}
                      <span className={styles.pinHead}>
                        <span className={styles.pinNumber}>{s.order}</span>
                      </span>
                      <span className={styles.pinLabel}>
                        {s.emoji} {s.name}
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className={styles.mapLegend}>
                <span className={`${styles.legendDot} ${styles.legendSpot}`} /> 景點
                <span className={`${styles.legendDot} ${styles.legendFood}`} /> 美食
                <span className={styles.legendTrail} /> 當天步徑
                <span className={styles.legendBridge} /> 隔天移動
              </div>
            </div>
          </section>

          {/* 書脊 */}
          <div className={styles.spine} aria-hidden="true" />

          {/* 右頁：手帳 */}
          <section className={styles.pageRight} aria-label="手帳日記頁">
            <div className={styles.dayTabs} role="tablist" aria-label="切換天數">
              {ITINERARY.days.map((d) => (
                <button
                  key={d.day}
                  type="button"
                  role="tab"
                  aria-selected={d.day === day}
                  className={`${styles.dayTab}${d.day === day ? ` ${styles.dayTabActive}` : ''}`}
                  onClick={() => switchDay(d.day)}
                >
                  {d.label}
                </button>
              ))}
            </div>

            <div className={styles.pageHeaderRight}>
              <span className={styles.pageDateStamp}>{dayInfo.label}</span>
              <span className={styles.pageDayThemeRight}>{dayInfo.theme}</span>
            </div>

            <ol className={styles.polaroidList}>
              {dayStops.map((s) => {
                const isActive = s.id === active.id
                return (
                  <li key={s.id} className={styles.polaroidItem}>
                    <button
                      type="button"
                      className={`${styles.polaroid}${isActive ? ` ${styles.polaroidActive}` : ''}${
                        s.kind === 'food' ? ` ${styles.polaroidFood}` : ''
                      }`}
                      onClick={() => setActiveId(s.id)}
                      aria-pressed={isActive}
                    >
                      <span className={styles.washi} aria-hidden="true" />
                      <span className={styles.timeStamp}>{s.time}</span>
                      <span className={styles.polaroidPhoto}>
                        <span className={styles.polaroidEmoji}>{s.emoji}</span>
                        <span className={styles.polaroidOrder}>#{s.order}</span>
                      </span>
                      <span className={styles.polaroidCaption}>
                        <span className={styles.polaroidName}>{s.name}</span>
                        <span className={styles.polaroidMeta}>
                          {s.kind === 'food' ? '🍴 美食' : '📍 景點'}・停留約 {s.stayMinutes} 分
                        </span>
                        <span className={styles.polaroidNote}>{s.note}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>

            {foodPicksOfDay.length > 0 && (
              <div className={styles.receipt}>
                <div className={styles.receiptHead}>
                  <span>順路小吃口袋名單</span>
                  <span className={styles.receiptHeadSub}>{dayInfo.label}</span>
                </div>
                <ul className={styles.receiptList}>
                  {foodPicksOfDay.map((f) => {
                    const near = stops.find((s) => s.id === f.nearStopId)
                    return (
                      <li key={f.id} className={styles.receiptRow}>
                        <button
                          type="button"
                          className={styles.receiptRowBtn}
                          onClick={() => near && setActiveId(near.id)}
                          title={near ? `靠近第 ${near.order} 站 ${near.name}` : undefined}
                        >
                          <span className={styles.receiptName}>
                            {f.emoji} {f.name}
                          </span>
                          <span className={styles.receiptHint}>{f.hint}</span>
                          <span className={styles.receiptPrice}>{f.price}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <div className={styles.receiptFoot}>＊ 點一下會跳到附近那一站</div>
              </div>
            )}
          </section>
        </div>

        {/* 下緣：護照戳章進度列 */}
        <div className={styles.passport}>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => goTo(activeIndex - 1)}
            disabled={activeIndex <= 0}
          >
            ← 上一站
          </button>
          <ol className={styles.stampRow} aria-label="行程站點進度">
            {stops.map((s, i) => {
              const visited = i < activeIndex
              const isActive = i === activeIndex
              const cls = [
                styles.stamp,
                visited ? styles.stampVisited : '',
                isActive ? styles.stampActive : '',
                s.kind === 'food' ? styles.stampFood : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <li key={s.id} className={styles.stampItem}>
                  {i > 0 && <span className={styles.stampDots} aria-hidden="true" />}
                  <button
                    type="button"
                    className={cls}
                    onClick={() => setActiveId(s.id)}
                    aria-label={`第 ${s.order} 站 ${s.name}${visited ? '（已到）' : isActive ? '（目前）' : ''}`}
                    aria-current={isActive ? 'step' : undefined}
                  >
                    <span className={styles.stampEmoji}>{s.emoji}</span>
                    <span className={styles.stampOrder}>{s.order}</span>
                    {s.day === 2 && s.order === day2[0]?.order && (
                      <span className={styles.stampDayFlag}>D2</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ol>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => goTo(activeIndex + 1)}
            disabled={activeIndex >= stops.length - 1}
          >
            下一站 →
          </button>
        </div>
        <div className={styles.passportCaption}>
          現在在第 {active.order} 站「{active.name}」，已蓋 {activeIndex} 個章，還有 {stops.length - 1 - activeIndex}{' '}
          站。
        </div>

        <div className={styles.note}>
          <strong>雛形限制：</strong>
          地圖是純 CSS 漸層+格線+暗角三層模擬（沿用構想一附錄的做法），站點座標是依大致地理相對位置手排的假資料，
          不是真實經緯度；拍立得縮圖以 emoji 代替照片。跟
          <Link to="/route-path-map-skeleton">構想一附錄</Link>（路徑線斜切地圖）、
          <Link to="/itinerary-poster">附錄二</Link>（整頁懶人包）、
          <Link to="/itinerary-monopoly">附錄三</Link>（大富翁棋盤）是同一份行程的不同瀏覽骨架；
          這裡聚焦「地圖與時間軸並置成一本手帳的兩頁」。資料是台南赤崁・府城兩日遊假資料（見 itineraryPlayfulMapData.ts）。
        </div>
      </div>
    </div>
  )
}

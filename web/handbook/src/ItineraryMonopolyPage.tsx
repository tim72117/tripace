import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MONOPOLY_ITINERARY, type MonopolySquare } from './itineraryMonopolyData'
import styles from './ItineraryMonopolyPage.module.css'

// ItineraryMonopolyPage:構想一附錄三——大富翁棋盤時間軸雛形。
//
// 緣起(2026-10):使用者提出「時間軸做成大富翁，地圖中間，外圈掛上
// 時間軸」——瀏覽一份已排好的行程時，把地圖放在畫面正中央當棋盤的
// 「內盤」，行程站點依序排成棋盤外圈的方格，像走大富翁一樣一格一格
// 繞一圈，呼應「依序走過的站點」這個行程本質。這是構想一(AI 排過的
// 主題行程展示)底下第三種延伸呈現方式，平行於構想一附錄(地圖為主要
// 互動介面，路徑線斜切過畫面，見 RoutePathMapSkeletonPage.tsx)、
// 構想一附錄二(整頁總覽式懶人包，見 ItineraryPosterPage.tsx)。三者是
// 同一份行程資料的三種不同瀏覽骨架，互補不互斥。
//
// 棋盤外圈 16 格怎麼排成「回字形」:用絕對定位依 slot 算出格子在棋盤
// 四邊上的 row/col 位置(見 squareGridStyle)，而不是 grid-template-areas
// 手刻 16 個具名區域——16 個 area 名稱手刻太冗長且難以對齊角落格共用
// 邏輯，絕對定位配合固定的格子尺寸更直接。中間地圖畫布也用絕對定位
// 置中，三層疊加對齊 RoutePathMapSkeletonPage.module.css 的
// .mapCanvas/.mapGrid/.mapVignette 既有做法(純 CSS 漸層+格線模擬，
// 這個子專案沒有真的串接地圖 SDK)。
//
// 互動模式比照 RoutePathMapSkeletonPage.tsx 的 activeId 慣例:點擊
// stop 格子切換 activeId，下方顯示對應的簡化站點卡片；pass 格子不可
// 點擊，視覺上明顯比 stop 格子低調(淡底 + 中性圖案)，不搶視覺重點。
const ITINERARY = MONOPOLY_ITINERARY

// BOARD_SIZE——棋盤一邊排幾格(含兩端角落)。16 格外圈、四邊對稱分配，
// 每邊 5 格(兩端角落 + 中間 3 格)，四邊共用角落格，算出來正好
// 4*(5-1) = 16 格，跟 itineraryMonopolyData.ts 的 TOTAL_SLOTS 對齊。
const BOARD_SIZE = 5

// slotToPosition——把 0-based、從左上角順時針繞的 slot 數字換算成棋盤
// 的 (row, col) 格位(1-based,對齊 CSS Grid 慣例)。四邊各 BOARD_SIZE-1
// 格(角落格算在下一邊的起點),依序:上緣(左→右)、右緣(上→下)、
// 下緣(右→左)、左緣(下→上)。
function slotToPosition(slot: number): { row: number; col: number } {
  const perEdge = BOARD_SIZE - 1
  const edge = Math.floor(slot / perEdge)
  const offset = slot % perEdge
  if (edge === 0) return { row: 1, col: 1 + offset } // 上緣：左→右
  if (edge === 1) return { row: 1 + offset, col: BOARD_SIZE } // 右緣：上→下
  if (edge === 2) return { row: BOARD_SIZE, col: BOARD_SIZE - offset } // 下緣：右→左
  return { row: BOARD_SIZE - offset, col: 1 } // 左緣：下→上
}

function isCorner(slot: number, totalSlots: number): boolean {
  const perEdge = totalSlots / 4
  return slot % perEdge === 0
}

function MonopolySquareCard({ square }: { square: MonopolySquare }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardThumb}>{square.emoji}</div>
      <div className={styles.cardBody}>
        <div className={styles.cardMetaRow}>
          <span className={styles.cardTime}>{square.time}</span>
          <span className={styles.cardCategory}>{square.category}</span>
        </div>
        <h3 className={styles.cardTitle}>{square.name}</h3>
        {square.stayMinutes && <div className={styles.cardStay}>建議停留約 {square.stayMinutes} 分鐘</div>}
        <p className={styles.cardText}>{square.desc}</p>
      </div>
    </div>
  )
}

export function ItineraryMonopolyPage() {
  const stopSquares = ITINERARY.squares.filter((s) => s.kind === 'stop')
  const [activeId, setActiveId] = useState<string | null>(stopSquares[0]?.id ?? null)
  const activeSquare = stopSquares.find((s) => s.id === activeId) ?? null

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link to="/" className={styles.back}>
          ← 回雛形列表
        </Link>
        <h1 className={styles.heading}>構想一附錄三：大富翁棋盤時間軸</h1>
        <p className={styles.subheading}>
          瀏覽「{ITINERARY.title}」這份已經排好的行程時，把地圖放在畫面正中央當棋盤的「內盤」，
          行程站點依序排成棋盤外圈的方格，像走大富翁一樣一格一格繞一圈——呼應「依序走過的站點」這個行程本質。
          站點之間的空格顯示為低調的「過路格」，不論行程站數多寡，棋盤外觀都維持同樣大小。
        </p>

        <div className={styles.routeCard}>
          <div className={styles.routeCardInfo}>
            <div className={styles.routeCardTitle}>{ITINERARY.title}</div>
            <div className={styles.routeCardMeta}>
              {stopSquares.length} 個站點 · 共 {ITINERARY.totalSlots} 格棋盤
            </div>
          </div>
          <button type="button" className={styles.viewToggle} disabled>
            棋盤瀏覽模式
          </button>
        </div>

        <div className={styles.board}>
          <div className={styles.mapCanvas}>
            <div className={styles.mapGrid} />
            <div className={styles.mapVignette} />
            <div className={styles.mapLabel}>🗺️ 行程地圖（示意）</div>
          </div>

          {ITINERARY.squares.map((square) => {
            const { row, col } = slotToPosition(square.slot)
            const corner = isCorner(square.slot, ITINERARY.totalSlots)
            const isActive = square.kind === 'stop' && square.id === activeId
            const classNames = [
              styles.square,
              square.kind === 'pass' ? styles.squarePass : styles.squareStop,
              corner ? styles.squareCorner : '',
              isActive ? styles.squareActive : '',
            ]
              .filter(Boolean)
              .join(' ')

            if (square.kind === 'pass') {
              return (
                <div
                  key={square.slot}
                  className={classNames}
                  style={{ gridRow: row, gridColumn: col }}
                  aria-hidden="true"
                >
                  <span className={styles.passMark}>·</span>
                </div>
              )
            }

            return (
              <button
                key={square.slot}
                type="button"
                className={classNames}
                style={{ gridRow: row, gridColumn: col }}
                onClick={() => setActiveId((cur) => (cur === square.id ? null : square.id ?? null))}
                aria-label={square.name}
              >
                <span className={styles.squareEmoji}>{square.emoji}</span>
                <span className={styles.squareName}>{square.name}</span>
                <span className={styles.squareTime}>{square.time}</span>
              </button>
            )
          })}
        </div>

        {activeSquare ? (
          <MonopolySquareCard square={activeSquare} />
        ) : (
          <div className={styles.emptyHint}>點棋盤上的站點格，展開這個站點的簡介。</div>
        )}

        <div className={styles.note}>
          <strong>雛形限制：</strong>
          中間地圖畫布是純 CSS 漸層+格線模擬，不是真實地圖 SDK；棋盤外圈固定 16 格，站點格位(slot)是寫死的假資料，
          不是依真實地理位置排列。站點卡片內容只做簡化示意。地圖為主要互動介面的版本見{' '}
          <Link to="/route-path-map-skeleton">構想一附錄</Link>，整頁總覽式懶人包版面見{' '}
          <Link to="/itinerary-poster">構想一附錄二</Link>，三者是同一份行程資料的不同瀏覽骨架。
          資料是九份一日散策的假資料（見 itineraryMonopolyData.ts）。
        </div>
      </div>
    </div>
  )
}

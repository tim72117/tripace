import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ALL_CATEGORIES, SHOWCASE_ITINERARIES, type ShowcaseCategory, type ShowcaseItinerary } from './itineraryShowcaseData'
import styles from './ItineraryShowcasePage.module.css'

// ItineraryShowcasePage:構想一(AI 排過的主題行程展示)雛形——對應
// brainstorm 文件「卡片牆」「依地區/天數/旅遊類型分類篩選」「點進去
// 看完整時間軸預覽（唯讀）」「套用這個行程／用這個當起點跟 AI 聊」
// 幾個延伸方案。純前端假資料(itineraryShowcaseData.ts),卡片點擊只開
// 彈窗預覽,「套用」「用這個跟 AI 聊」兩個 CTA 目前只是視覺雛形(alert
// 提示),沒有串接真實的建立行程/開啟對話流程——雛形階段先驗證版面與
// 互動動線,實際串接需要先確認這個展示牆最終該怎麼接進 /app 的建立
// 行程流程。
export function ItineraryShowcasePage() {
  const [activeCategory, setActiveCategory] = useState<ShowcaseCategory | null>(null)
  const [preview, setPreview] = useState<ShowcaseItinerary | null>(null)

  const filtered = activeCategory
    ? SHOWCASE_ITINERARIES.filter((it) => it.categories.includes(activeCategory))
    : SHOWCASE_ITINERARIES

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link to="/category/prototypes" className={styles.back}>
          ← 回雛形列表
        </Link>
        <h1 className={styles.heading}>AI 排過的主題行程</h1>
        <p className={styles.subheading}>看看 AI 能排出什麼樣的行程——點卡片查看完整時間軸。</p>

        <div className={styles.filterBar}>
          <button
            type="button"
            className={`${styles.filterChip}${activeCategory === null ? ` ${styles.filterChipActive}` : ''}`}
            onClick={() => setActiveCategory(null)}
          >
            全部
          </button>
          {ALL_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`${styles.filterChip}${activeCategory === cat ? ` ${styles.filterChipActive}` : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className={styles.grid}>
          {filtered.map((it) => (
            <button key={it.id} type="button" className={styles.card} onClick={() => setPreview(it)}>
              <div className={styles.cardCover}>{it.coverEmoji}</div>
              <div className={styles.cardBody}>
                <h2 className={styles.cardTitle}>{it.title}</h2>
                <div className={styles.cardMeta}>
                  {it.region} · {it.days} 天
                </div>
                <p className={styles.cardSummary}>{it.summary}</p>
                <div className={styles.cardFooter}>
                  <div className={styles.cardTags}>
                    {it.categories.map((c) => (
                      <span key={c} className={styles.tag}>
                        {c}
                      </span>
                    ))}
                  </div>
                  <span>★ {it.savedCount}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {preview && (
        <div className={styles.modalBackdrop} onClick={() => setPreview(null)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                {preview.coverEmoji} {preview.title}
              </h2>
              <button type="button" className={styles.modalClose} onClick={() => setPreview(null)}>
                ✕
              </button>
            </div>
            <div className={styles.modalMeta}>
              {preview.region} · {preview.days} 天 · ★ {preview.savedCount} 人收藏
            </div>
            <ul className={styles.timeline}>
              {preview.stops.map((stop, i) => (
                <li key={i} className={styles.timelineItem}>
                  <div className={styles.timelineTime}>{stop.time}</div>
                  <div className={styles.timelineBody}>
                    <h3 className={styles.timelineName}>{stop.name}</h3>
                    <p className={styles.timelineNote}>{stop.note}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalActionSecondary}
                onClick={() => alert('雛形：跳轉到建立行程流程（未串接）')}
              >
                套用這個行程
              </button>
              <button
                type="button"
                className={styles.modalActionPrimary}
                onClick={() => alert('雛形：開新對話並帶入這個行程當起點（未串接）')}
              >
                用這個跟 AI 聊
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { KEY_DECISIONS, PLACEMENT_DEMOS } from './adSystemData'
import styles from './AdSystemPage.module.css'

// AdSystemPage:構想六(廣告投放系統)雛形——對應
// 構想頁 /ideas/product-direction-6-ad-system(原 docs/brainstorm 產品方向腦力激盪文件的構想六)。
//
// 跟其他五項構想的雛形性質不同:那些是 UI 呈現構想的互動雛形,這裡的
// 廣告投放系統大半是後端架構與商業決策(資料模型、投放演算法、計費
// 模式、合規),不是一個可以完整互動的功能雛形。這個頁面只做兩件事:
// 1. 視覺示意「贊助卡片」放進三個候選版位(城市頁/文章頁/範例行程
//    列表)時,在既有版面語言下大概長什麼樣子,幫助直覺理解版位設計;
// 2. 摘錄 Opus 子代理探索報告裡最關鍵的幾項待確認決策,方便快速瀏覽——
//    完整報告內容在 docs/brainstorm 文件與對話紀錄裡,不是這裡要取代的。
//
// 卡片本身不可點擊(沒有真實 landing page 可以導去),純視覺展示。
export function AdSystemPage() {
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link to="/category/prototypes" className={styles.back}>
          ← 回雛形列表
        </Link>
        <h1 className={styles.heading}>廣告投放系統</h1>
        <p className={styles.subheading}>
          站內贊助版位示意——依頁面所屬城市等語境篩選素材，以「原生卡片」融入既有版面，
          而非傳統橫幅廣告。下方是三個 MVP 候選版位的視覺示意，純前端假資料。
        </p>

        <div className={styles.placementList}>
          {PLACEMENT_DEMOS.map((p) => (
            <section key={p.key} className={styles.placementBlock}>
              <div className={styles.placementMeta}>
                <h2 className={styles.placementPage}>{p.pageLabel}</h2>
                <p className={styles.placementPosition}>{p.positionDesc}</p>
              </div>

              {/* 贊助卡片本身——視覺語言對齊 ItineraryShowcasePage 的
                  .card(圓角卡片+色塊封面+內文),額外加上「贊助」標示,
                  對應 brainstorm 文件「明確的『贊助』標示」的要求。 */}
              <div className={styles.sponsoredCard} style={{ '--accent': p.creative.accentColor } as CSSProperties}>
                <div className={styles.sponsoredCover}>{p.creative.coverEmoji}</div>
                <div className={styles.sponsoredBody}>
                  <span className={styles.sponsoredLabel}>{p.creative.sponsorLabel}</span>
                  <h3 className={styles.sponsoredTitle}>{p.creative.title}</h3>
                  <p className={styles.sponsoredDesc}>{p.creative.desc}</p>
                  <button type="button" className={styles.sponsoredCta} disabled>
                    {p.creative.ctaLabel}
                  </button>
                </div>
              </div>
            </section>
          ))}
        </div>

        <h2 className={styles.sectionHeading}>關鍵決策摘要</h2>
        <p className={styles.sectionSub}>
          完整的現況探索與架構建議（資料模型、投放演算法、精準投放訊號、分階段 MVP 範圍等）
          已整理在 docs/brainstorm 文件與對話紀錄，這裡只摘錄最關鍵的幾項待確認方向。
        </p>
        <ul className={styles.decisionList}>
          {KEY_DECISIONS.map((d) => (
            <li key={d.question} className={styles.decisionItem}>
              <div className={styles.decisionQ}>⚠️ {d.question}</div>
              <p className={styles.decisionA}>{d.recommendation}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

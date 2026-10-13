import { Link } from 'react-router-dom'
import { PLANNING_MODE_EXAMPLES, resolvePresentationMode, type PlanningModeExample } from './planningModesData'
import styles from './PlanningModesPage.module.css'

// PlanningModesPage:構想三(依地點特性分化規劃模式)雛形——對應文件
// 「先定義模式分類的維度，而非窮舉地名」延伸方案:不是寫死「九份模式」
// 「赤崁模式」這種地名對照表,而是用一組抽象維度
// (density/timeSensitivity/focus,見 planningModesData.ts)決定呈現
// 模式,這裡示範同一套規則下,九份型跟赤崁型兩個例子各自落在哪種呈現。
//
// resolvePresentationMode() 是雛形階段最簡化的規則函式,真正落地時這個
// 判斷應該由 LLM 直接輸出,不是前端寫死規則表——這個頁面只驗證「同一份
// 維度資料可以對應到兩種完全不同的 UI 呈現」這個概念本身的可行性。
function PanelFor({ example }: { example: PlanningModeExample }) {
  const mode = resolvePresentationMode(example.dims)
  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{example.title}</h2>
        <div className={styles.dims}>
          <span className={styles.dimTag}>density: {example.dims.density}</span>
          <span className={styles.dimTag}>timeSensitivity: {example.dims.timeSensitivity}</span>
          <span className={styles.dimTag}>focus: {example.dims.focus}</span>
        </div>
        <div>
          <span
            className={`${styles.modeLabel}${mode === 'highlight-map' ? ` ${styles.modeLabelMap}` : ` ${styles.modeLabelTimeline}`}`}
          >
            {mode === 'highlight-map' ? '亮點地圖模式' : '時間軸列表模式'}
          </span>
        </div>
      </div>

      {mode === 'highlight-map' ? (
        <ol className={styles.highlightList}>
          {example.stops.map((stop, i) => (
            <li key={stop.name} className={styles.highlightItem}>
              <div className={styles.highlightIndex}>{i + 1}</div>
              <div className={styles.highlightBody}>
                <h3 className={styles.highlightName}>{stop.name}</h3>
                {i > 0 && <p className={styles.highlightMeta}>步行約 {stop.walkMinutesFromPrev} 分鐘</p>}
                <p className={styles.highlightReason}>{stop.reason}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <ul className={styles.timelineList}>
          {example.stops.map((stop) => (
            <li key={stop.name} className={styles.timelineItem}>
              <div className={styles.timelineTime}>{stop.time}</div>
              <div className={styles.timelineBody}>
                <h3 className={styles.timelineName}>{stop.name}</h3>
                <p className={styles.timelineReason}>{stop.reason}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function PlanningModesPage() {
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link to="/" className={styles.back}>
          ← 回雛形列表
        </Link>
        <h1 className={styles.heading}>依地點特性分化規劃模式</h1>
        <p className={styles.subheading}>
          同一套抽象維度（景點密度／時間敏感度／主要訴求）決定呈現方式，
          而不是用地名窮舉「九份模式」「赤崁模式」——新地點不需要人工預先分類也能套用。
        </p>

        <div className={styles.pair}>
          {PLANNING_MODE_EXAMPLES.map((ex) => (
            <PanelFor key={ex.id} example={ex} />
          ))}
        </div>

        <div className={styles.note}>
          <strong>雛形限制：</strong>
          目前 <code>resolvePresentationMode()</code> 是前端寫死的簡化規則（只看
          density + timeSensitivity 兩軸），真正落地時這個判斷應該由 LLM
          直接輸出（幫每個節點的維度打分數），不是前端硬推規則表。混合型行程
          （同一趟多天、部分天數該切換模式）的資料結構設計——例如
          PlanNode 加「所屬規劃模式」標記——尚未在這個雛形裡實作。
        </div>
      </div>
    </div>
  )
}

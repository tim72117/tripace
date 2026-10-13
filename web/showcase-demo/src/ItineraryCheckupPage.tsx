import { Link } from 'react-router-dom'
import { CHECKUP_SAMPLE, runCheckup } from './itineraryCheckupData'
import styles from './ItineraryCheckupPage.module.css'

const ISSUE_ICON: Record<string, string> = {
  'time-conflict': '⏱️',
  'transit-gap': '🚶',
  'closed-day': '🚪',
  'meal-gap': '🍽️',
}

const ISSUE_LABEL: Record<string, string> = {
  'time-conflict': '時間衝突',
  'transit-gap': '交通銜接',
  'closed-day': '營業時間/公休',
  'meal-gap': '餐期安排',
}

// ItineraryCheckupPage:構想四(AI 自動化處理)裡「行程健檢」子功能的
// 雛形——對應文件「設計一個『行程健檢』功能，AI 掃過整個時間軸，主動
// 標出潛在問題」,列出的四種檢查項目(時間衝突/交通銜接不合理/營業時間
// 公休日衝突/餐期安排)在這裡都各自出現一次假資料示範。
//
// runCheckup() 目前是前端寫死的簡化規則(見 itineraryCheckupData.ts 的
// 完整說明),真正落地時應該交給 AI 判斷,不是前端用時間加減土法煉鋼——
// 這個雛形只驗證「健檢結果怎麼呈現給使用者」這個 UI 層,不驗證規則本身
// 的正確性,也對應文件延伸方案「『行程健檢』可以先獨立成一個小功能
// 上線，驗證需求」。
export function ItineraryCheckupPage() {
  const issues = runCheckup(CHECKUP_SAMPLE)
  const issueStopIds = new Set(issues.map((i) => i.stopId))
  const warningCount = issues.filter((i) => i.severity === 'warning').length
  const infoCount = issues.filter((i) => i.severity === 'info').length

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link to="/" className={styles.back}>
          ← 回雛形列表
        </Link>
        <h1 className={styles.heading}>行程健檢</h1>
        <p className={styles.subheading}>
          AI 掃過整個時間軸，主動標出潛在問題——時間衝突、交通銜接不合理、
          景點公休日/營業時間衝突、餐期安排。
        </p>

        <div className={styles.summaryBar}>
          <span className={`${styles.summaryPill} ${styles.summaryPillWarning}`}>⚠️ {warningCount} 項需要注意</span>
          <span className={`${styles.summaryPill} ${styles.summaryPillInfo}`}>ℹ️ {infoCount} 項提醒</span>
        </div>

        <ul className={styles.timeline}>
          {CHECKUP_SAMPLE.stops.map((stop) => {
            const hasIssue = issueStopIds.has(stop.id)
            return (
              <li
                key={stop.id}
                className={`${styles.timelineItem}${hasIssue ? ` ${styles.timelineItemIssue}` : ''}`}
              >
                <div className={styles.timelineTime}>
                  {stop.arriveTime}–{stop.leaveTime}
                </div>
                <div className={styles.timelineBody}>
                  <h3 className={styles.timelineName}>{stop.name}</h3>
                  {stop.isMeal && (
                    <div className={styles.timelineBadges}>
                      <span className={`${styles.badge} ${styles.badgeMeal}`}>餐期</span>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        <div className={styles.issueSection}>
          <h2 className={styles.issueSectionTitle}>健檢結果</h2>
          {issues.length === 0 ? (
            <div className={styles.emptyIssues}>沒有發現問題，行程安排順暢！</div>
          ) : (
            <ul className={styles.issueList}>
              {issues.map((issue, i) => (
                <li
                  key={i}
                  className={`${styles.issueCard}${issue.severity === 'warning' ? ` ${styles.issueCardWarning}` : ''}`}
                >
                  <span className={styles.issueIcon}>{ISSUE_ICON[issue.type]}</span>
                  <div className={styles.issueBody}>
                    <p className={styles.issueType}>{ISSUE_LABEL[issue.type]}</p>
                    <p className={styles.issueMessage}>{issue.message}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

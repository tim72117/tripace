import { Link } from 'react-router-dom'
import {
  POSTER_BLOCKS,
  POSTER_TITLE,
  POSTER_SUBTITLE,
  type PosterBlock,
  type RouteMapBlock,
  type StopCardBlock,
  type TimelineDayBlock,
  type CalloutBlock,
} from './itineraryPosterData'
import styles from './ItineraryPosterPage.module.css'

// ItineraryPosterPage:構想一附錄二——版面化行程懶人包雛形。
//
// 緣起(2026-10):使用者分享一張圖文整合的旅遊攻略截圖(插畫地圖+編號
// 路線+城市色卡+景點條列,社群常見的「XX人做的OO攻略」懶人包風格),
// 指出重點不是重現那張圖的插畫美術,而是「CLI 可以加入圖卡、標註、
// 路線、時間軸....不同的呈現方式」——也就是驗證同一份行程資料能不能
// 用結構化區塊組出一張總覽式懶人包版面,呼應部落格 content_pages 的
// blocks 扁平陣列機制(見 .claude/skills/blog-article-content):一個
// kind 決定一種排版,陣列順序即渲染順序,未來若要收進 CLI schema,
// 同一套「扁平區塊陣列、依 kind 分派渲染」的設計可以直接沿用。
//
// 這裡示範四種區塊 kind(見 itineraryPosterData.ts 的完整型別定義):
//   - route-map:整段路線的縮圖地圖,編號圓點 + 連線,點一次看全局
//   - stop-card:單一城市/站點的色卡(對齊西班牙攻略截圖的城市卡概念)
//   - timeline-day:單日逐時間軸的詳細排程(跟 PlanTimelineView 唯讀
//     展示是同一種資訊,但這裡的版面目的是「總覽一天」而非「逐站導覽」)
//   - callout:版面收尾的強調語句(呼應截圖底部「收藏這份攻略」)
//
// 地圖本身是純 CSS/SVG 模擬(漸層底 + SVG 路徑線 + 圓點),對齊
// RoutePathMapSkeletonPage.tsx 的既有慣例——這個子專案向來沒有真的串
// 接地圖 SDK,地圖視覺只做示意,不是這次要驗證的重點(重點是「區塊化
// 版面機制」本身)。
//
// 跟構想一附錄(地圖基底介面骨架,/route-path-map-skeleton)的差異:
// 附錄是「瀏覽一份行程時,把地圖當成主要互動介面」(逐站點開才看細節);
// 這裡是「把一份行程總覽式地印成一張可以整頁看完、適合分享的懶人包」
// (不需要互動展開,滾動瀏覽即可看完全部內容)——兩種是互補的呈現
// 方式,不是互相取代。
function RouteMapView({ block }: { block: RouteMapBlock }) {
  const pathD = `M ${block.stops.map((s) => `${s.xPct} ${s.yPct}`).join(' L ')}`
  return (
    <div className={styles.routeMapBlock}>
      <h2 className={styles.blockHeading}>{block.title}</h2>
      <div className={styles.routeMapCanvas}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={styles.routeMapSvg}>
          <path d={pathD} className={styles.routeMapPath} />
        </svg>
        {block.stops.map((s) => (
          <div
            key={s.id}
            className={styles.routeMapPin}
            style={{ left: `${s.xPct}%`, top: `${s.yPct}%`, background: s.accentColor }}
          >
            <span className={styles.routeMapPinIndex}>{s.index}</span>
            <span className={styles.routeMapPinLabel}>{s.city}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function StopCardView({ block }: { block: StopCardBlock }) {
  const { stop } = block
  return (
    <div className={styles.stopCard} style={{ borderTopColor: stop.accentColor }}>
      <div className={styles.stopCardHead}>
        <span className={styles.stopCardIndex} style={{ background: stop.accentColor }}>
          {stop.index}
        </span>
        <h3 className={styles.stopCardTitle} style={{ color: stop.accentColor }}>
          {stop.city}
        </h3>
      </div>
      <ul className={styles.stopCardList}>
        {stop.highlights.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
      <div className={styles.stopCardPhoto}>
        <span className={styles.stopCardPhotoEmoji}>{stop.photoEmoji}</span>
        <span className={styles.stopCardPhotoCaption}>{stop.photoCaption}</span>
      </div>
    </div>
  )
}

function TimelineDayView({ block }: { block: TimelineDayBlock }) {
  return (
    <div className={styles.timelineBlock}>
      <h2 className={styles.blockHeading}>{block.city} 單日時間軸</h2>
      <ol className={styles.timelineList}>
        {block.items.map((item) => (
          <li key={item.time} className={styles.timelineItem}>
            <span className={styles.timelineTime}>{item.time}</span>
            <span className={styles.timelineActivity}>{item.activity}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function CalloutView({ block }: { block: CalloutBlock }) {
  return <p className={styles.callout}>{block.text}</p>
}

function renderBlock(block: PosterBlock, i: number) {
  switch (block.kind) {
    case 'route-map':
      return <RouteMapView key={i} block={block} />
    case 'stop-card':
      return <StopCardView key={block.stop.id} block={block} />
    case 'timeline-day':
      return <TimelineDayView key={i} block={block} />
    case 'callout':
      return <CalloutView key={i} block={block} />
  }
}

export function ItineraryPosterPage() {
  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link to="/category/prototypes" className={styles.back}>
          ← 回雛形列表
        </Link>
        <h1 className={styles.heading}>構想一附錄二：版面化行程懶人包</h1>
        <p className={styles.subheading}>
          使用者分享一張圖文整合的旅遊攻略截圖，指出重點是「CLI 可以加入圖卡、標註、路線、時間軸……不同的呈現方式」——
          這裡驗證的不是重現那張截圖的插畫美術，而是同一份行程資料能不能用結構化區塊（route-map / stop-card /
          timeline-day / callout）組出一張總覽式懶人包版面，呼應部落格 content_pages 的 blocks 扁平陣列機制。
          下方整頁示範四種區塊依序排列的效果，純前端假資料（台灣西部五城路線），地圖為 SVG 模擬示意，無真實地圖 SDK。
        </p>

        <div className={styles.poster}>
          <header className={styles.posterHeader}>
            <h2 className={styles.posterTitle}>{POSTER_TITLE}</h2>
            <p className={styles.posterSubtitle}>{POSTER_SUBTITLE}</p>
          </header>
          {POSTER_BLOCKS.map(renderBlock)}
        </div>
      </div>
    </div>
  )
}

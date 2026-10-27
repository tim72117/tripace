import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ROUTE_PATH_MAP_SKELETON, type SkeletonThemePoint } from './routePathMapSkeletonData'
import styles from './RoutePathMapSkeletonPage.module.css'

// RoutePathMapSkeletonPage:構想一附錄——地圖基底介面骨架雛形。
//
// 歸屬說明(2026-10 調整):這個雛形最初是從構想七(路徑機制)文案稿
// 「場景二:沿途主題點的呈現——地圖為版面骨架」那段描繪展開的,但地圖
// 基底本身是「瀏覽一份已經排好的行程」的呈現方式問題,跟構想七要解決
// 的「AI 排行程前能不能參考既有路徑骨架」是不同層次的事——所以歸屬
// 調整為構想一(AI 排過的主題行程展示)的延伸雛形:使用者瀏覽
// ItineraryShowcasePage.tsx 卡片牆點開的一份主題行程時,除了原本的
// 唯讀時間軸預覽彈窗,也可以選擇切換成「地圖基底」的瀏覽方式——地圖是
// 主角,路徑線是這份行程走過的路線,沿線的縮圖徽章是行程裡的站點,點開
// 才看站點細節。這裡不是在規劃/套用一條路徑,而是在瀏覽一份已經成形
// 的行程。
//
// 這次雛形的重點是地圖介面本身(地圖畫布的層次感、路徑線怎麼畫、
// 縮圖徽章沿線怎麼分佈、點擊時的視覺回饋)——站點卡片的內容呈現只做
// 簡化示意(仍保留「Google 相片」跟「部落格摘錄」兩種質感的影子,但
// 不展開成重頭戲),避免模糊掉地圖介面才是這次要驗證的核心。
//
// 地圖畫布本身是純 CSS 模擬(漸層+格線),對齊 PlanningModesPage.tsx
// 的既有慣例——這個子專案向來沒有真的串接地圖 SDK。路徑線用 SVG
// <path> 畫一條斜切過畫面的曲線,主題點縮圖徽章沿線定位,依站點順序
// 編號,點擊展開下方簡化卡片。
const PATH = ROUTE_PATH_MAP_SKELETON

// SVG 路徑線——沿著幾個主題點的座標畫一條平滑曲線,視覺上像緞帶斜切
// 過地圖。座標直接對齊 themePoints 的 xPct/yPct(用 0~100 的 viewBox
// 剛好對應百分比),避免兩邊資料各算一份容易兜不齊。
const PATH_D = `M ${PATH.themePoints.map((p) => `${p.xPct} ${p.yPct}`).join(' L ')}`

// 簡化版站點卡片——只留「這個站點是什麼質感的素材」的示意,不展開成
// 完整的照片排/摘錄長文,把篇幅留給上面的地圖互動。
function ThemePointCard({ point }: { point: SkeletonThemePoint }) {
  const isGoogle = point.photoCase === 'google'
  return (
    <div className={styles.card}>
      <div className={styles.cardThumb}>{isGoogle ? '📷' : point.blogCoverEmoji}</div>
      <div className={styles.cardBody}>
        <div className={styles.cardCaseTag}>{isGoogle ? 'Google 相片' : `摘自：〈${point.blogTitle}〉`}</div>
        <h3 className={styles.cardTitle}>{point.name}</h3>
        {isGoogle && point.stayMinutes && <div className={styles.cardMeta}>建議停留約 {point.stayMinutes} 分鐘</div>}
        <p className={styles.cardText}>{isGoogle ? point.blurb : point.blogExcerpt}</p>
      </div>
    </div>
  )
}

export function RoutePathMapSkeletonPage() {
  const [activeId, setActiveId] = useState<string | null>(PATH.themePoints[1].id)
  const activePoint = PATH.themePoints.find((p) => p.id === activeId) ?? null

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <Link to="/category/prototypes" className={styles.back}>
          ← 回雛形列表
        </Link>
        <h1 className={styles.heading}>構想一附錄：地圖基底介面骨架雛形</h1>
        <p className={styles.subheading}>
          瀏覽「{PATH.name}」這份已經排好的主題行程時，除了構想一原本的卡片牆，也可以切換成地圖基底的瀏覽方式——
          地圖是主角，行程走過的路線沿著畫面斜切而過，沿線的圓形縮圖徽章是行程裡的站點，點進去才展開細節。
          這個雛形的重點在地圖畫布、路徑線、縮圖徽章的排版與互動本身。
        </p>

        <div className={styles.routeCard}>
          <div className={styles.routeCardInfo}>
            <div className={styles.routeCardTitle}>{PATH.name}</div>
            <div className={styles.routeCardMeta}>
              {PATH.suggestedDays} 天行程 · {PATH.themePoints.length} 個站點 · {PATH.travelModes.join('／')}
            </div>
          </div>
          <button type="button" className={styles.viewToggle} disabled>
            地圖瀏覽模式
          </button>
        </div>

        <div className={styles.mapCanvas}>
          <div className={styles.mapGrid} />
          <div className={styles.mapVignette} />
          <svg className={styles.mapSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d={PATH_D} className={styles.routeLineShadow} vectorEffect="non-scaling-stroke" />
            <path d={PATH_D} className={styles.routeLine} vectorEffect="non-scaling-stroke" />
          </svg>
          {PATH.themePoints.map((point, i) => (
            <button
              key={point.id}
              type="button"
              className={`${styles.badge}${activeId === point.id ? ` ${styles.badgeActive}` : ''}`}
              style={{ left: `${point.xPct}%`, top: `${point.yPct}%` }}
              onClick={() => setActiveId((cur) => (cur === point.id ? null : point.id))}
              aria-label={point.name}
            >
              {activeId === point.id && <span className={styles.badgePulse} />}
              <span className={styles.badgeThumb}>{i + 1}</span>
              <span className={styles.badgeLabel}>{point.shortLabel}</span>
            </button>
          ))}
        </div>

        {activePoint ? (
          <ThemePointCard point={activePoint} />
        ) : (
          <div className={styles.emptyHint}>點地圖上的縮圖徽章，展開這個站點的簡介。</div>
        )}

        <div className={styles.note}>
          <strong>雛形限制：</strong>
          地圖畫布是純 CSS 漸層+格線模擬，路徑線跟縮圖徽章座標是寫死的百分比座標，不是真實經緯度，
          沒有串接任何地圖 SDK。站點卡片內容只做簡化示意（Google 相片／部落格摘錄兩種質感留一點影子），
          不是本雛形的重點，完整的兩種照片呈現版型構想見{' '}
          <Link to="/route-path-planning">構想七：路徑機制</Link>
          文案稿。資料是花東縱谷沿線的假資料（見 routePathMapSkeletonData.ts）。
        </div>
      </div>
    </div>
  )
}

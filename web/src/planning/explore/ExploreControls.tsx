import type { CSSProperties } from 'react'
import { Compass, Loader2, Search } from 'lucide-react'
import styles from '../map/PlanMap.module.css'

// ExploreControls——「探索景點區域」的觸發控制項(2026-10 從登入後的 planning/map/PlanMap 抽出,/ai-plan 的 PlanMap 共用):
//   - ExploreTagButton:「探索」標籤。唯一保留 activeCategory「點下去查、再點取消」語意的標籤,查的是自建景點區域(免費,
//     只查自家資料庫)而非搜尋框路徑。刻意不顯示選取視覺(使用者要求),選取邏輯在 useExploreQueries。
//   - SearchThisAreaButton:「搜尋這個區域」。areaDirty(拖曳/縮放過但尚未查新範圍)時顯示,是重查景點區域的入口;
//     查詢中顯示旋轉圖示。
//   - ExploreControls:兩者的組合版(/ai-plan 用:沒有類別標籤與搜尋框,只有這兩顆),各自帶位置。
// 查詢政策(2026-08 起):景點區域「按下才查」,地圖移動本身只標記「這個範圍還沒查過」,不自動重打(見 useExploreQueries)。
// 樣式沿用 PlanMap.module.css(登入後與 /ai-plan 同一組毛玻璃按鈕)。

export function ExploreTagButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={styles.categoryTag} onClick={onClick} title="探索">
      <Compass size={14} aria-hidden="true" />
      探索
    </button>
  )
}

export function SearchThisAreaButton({
  onClick,
  searching,
  style,
}: {
  onClick: () => void
  searching: boolean
  style?: CSSProperties
}) {
  return (
    <button type="button" className={styles.searchThisAreaButton} style={style} onClick={onClick} aria-busy={searching}>
      {searching ? (
        <Loader2 size={14} className={styles.searchThisAreaIconLoading} aria-hidden="true" />
      ) : (
        <Search size={14} aria-hidden="true" />
      )}
      搜尋這個區域
    </button>
  )
}

export function ExploreControls({
  onExplore,
  showSearchThisArea,
  searching,
  onSearchThisArea,
  top = 16,
}: {
  onExplore: () => void
  // showSearchThisArea:地圖移動過(areaDirty)且探索已選中時才顯示。
  showSearchThisArea: boolean
  searching: boolean
  onSearchThisArea: () => void
  // top:第一列的上緣(px)。/ai-plan 的漂浮導覽列佔掉頂端 72px,要往下讓開。
  top?: number
}) {
  return (
    <>
      <div className={styles.categoryTags} style={{ top }}>
        <ExploreTagButton onClick={onExplore} />
      </div>
      {showSearchThisArea && (
        <SearchThisAreaButton onClick={onSearchThisArea} searching={searching} style={{ top: top + 46 }} />
      )}
    </>
  )
}

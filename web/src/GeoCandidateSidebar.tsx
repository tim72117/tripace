import type { GeoDistrict, GeoHotel } from './api'
import styles from './GeoCandidateSidebar.module.css'

// GeoCandidateSidebar:候選籃(構想 1,見
// docs/TRIP_PLANNING_DESIGN_DISCUSSION.md)——地理輪廓底圖(構想 6)的
// 桌面版試做承載元件,渲染在 rail 與主顯示區之間的 side panel(跟
// trips/timeline/pace 用同一個 .desktop-sidepanel 位置,見
// DesktopLayout.tsx 的 isSidepanelMode),對齊構想 1 定案的「候選籃是
// 規劃引導介面的主結構」空間配置。
//
// 目前只是純前端試做:候選清單只存在記憶體(DesktopContent 的
// geoCandidates state),重新整理頁面會消失,尚未接上任何持久化——構想
// 1 定案要求的「跨 session 保存」留待這個功能確定要正式化時再實作。
//
// 加入候選的入口是右側 GeoHotelSidebar(飯店/地點清單)每一項卡片上的
// 「+」按鈕(見該元件),這裡只負責顯示已加入的候選與移除。
export type GeoCandidate =
  | ({ kind: 'hotel' } & GeoHotel)
  | ({ kind: 'district' } & GeoDistrict)

export function GeoCandidateSidebar({
  candidates,
  onRemove,
}: {
  candidates: GeoCandidate[]
  onRemove?: (candidate: GeoCandidate) => void
}) {
  return (
    <div className={styles.panel}>
      <div className="desktop-sidebar-head">
        <span className="desktop-sidebar-title">候選籃 · {candidates.length}</span>
      </div>
      <div className={styles.list}>
        {candidates.length === 0 ? (
          <div className={styles.empty}>
            搜尋或點地圖,把想去的丟進來——右側清單每一項卡片上的「+」可以加入候選。
          </div>
        ) : (
          candidates.map((c) => {
            const photoUrl = c.kind === 'hotel' ? c.photoUrl : c.landmarkPhotoUrl
            const name = c.kind === 'hotel' ? c.name : c.name
            const meta = c.kind === 'hotel' ? c.address : (c.landmarkName ?? '')
            return (
              <div key={`${c.kind}-${name}-${c.lat}-${c.lng}`} className={styles.item}>
                {photoUrl ? (
                  <img className={styles.itemPhoto} src={photoUrl} alt={name} loading="lazy" />
                ) : (
                  <div className={styles.itemPhotoPlaceholder} />
                )}
                <div className={styles.itemInfo}>
                  <span className={styles.itemName}>{name}</span>
                  {meta && <span className={styles.itemMeta}>{meta}</span>}
                </div>
                <button
                  type="button"
                  className={styles.removeBtn}
                  onClick={() => onRemove?.(c)}
                  title="移除候選"
                >
                  ×
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

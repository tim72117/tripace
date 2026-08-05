import type { GeoAttraction, GeoHotel, GeoPlace, GeoTripEntry } from './api'
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
// entry 種類:行程本身已有座標的 entry(見 GeoOutlineMap.tsx 的
// tripEntries 說明)——這批點不是使用者手動用「+」加入的,是進入規劃
// 分頁時自動帶入的行程既有內容(見 DesktopLayout.tsx 的
// onTripEntriesChange),但仍走同一份候選籃資料結構與顯示邏輯,不另開
// 一份平行清單。
export type GeoCandidate =
  | ({ kind: 'hotel' } & GeoHotel)
  | ({ kind: 'attraction' } & GeoAttraction)
  | ({ kind: 'place' } & GeoPlace)
  | ({ kind: 'entry' } & GeoTripEntry)

// CandidateRow:單一候選項目的卡片,已排入行程組與純候選組共用同一份
// 渲染邏輯,只有外層分組容器不同。
function CandidateRow({ c, onRemove }: { c: GeoCandidate; onRemove?: (candidate: GeoCandidate) => void }) {
  const photoUrl = c.kind === 'attraction' ? c.landmarkPhotoUrl : c.kind === 'entry' ? undefined : c.photoUrl
  const name = c.name
  const meta = c.kind === 'attraction' ? (c.landmarkName ?? '') : c.kind === 'entry' ? (c.location ?? '') : c.address
  return (
    <div className={styles.item}>
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
}

export function GeoCandidateSidebar({
  candidates,
  onRemove,
}: {
  candidates: GeoCandidate[]
  onRemove?: (candidate: GeoCandidate) => void
}) {
  // 已排入行程 vs 純候選:kind === 'entry' 是行程本身已有座標的既有內容
  // (進入規劃分頁時自動帶入,見上方型別註解),不是使用者用「+」手動加入
  // 的——這批天然就等於「已排入行程」,其餘 kind(hotel/attraction/place)
  // 是使用者主動丟進候選籃、但尚未真正寫回行程的項目,故以 kind 分組,不
  // 需要另外比對是否重複。
  const inTrip = candidates.filter((c) => c.kind === 'entry')
  const onlyCandidate = candidates.filter((c) => c.kind !== 'entry')

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
          <>
            {inTrip.length > 0 && (
              <div className={styles.group}>
                <div className={styles.groupTitle}>已排入行程 · {inTrip.length}</div>
                {inTrip.map((c) => (
                  <CandidateRow key={`${c.kind}-${c.name}-${c.lat}-${c.lng}`} c={c} onRemove={onRemove} />
                ))}
              </div>
            )}
            {onlyCandidate.length > 0 && (
              <div className={styles.group}>
                <div className={styles.groupTitle}>候選中 · {onlyCandidate.length}</div>
                {onlyCandidate.map((c) => (
                  <CandidateRow key={`${c.kind}-${c.name}-${c.lat}-${c.lng}`} c={c} onRemove={onRemove} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

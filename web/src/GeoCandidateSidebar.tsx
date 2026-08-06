import { isSubmitEnter } from './AppCommon'
import type { GeoAttraction, GeoHotel, GeoPlace, GeoTripEntry } from './api'
import type { GeoSelectedKey } from './GeoHotelSidebar'
import { geoItemKey } from './GeoHotelSidebar'
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
// 渲染邏輯,只有外層分組容器不同。onSelect:點擊卡片本體(而非「×」)時
// 觸發,打開地點介紹面板(見 DesktopLayout.tsx 的接線)——理由同
// GeoHotelSidebar 卡片點擊的既有慣例,卡片本體不能整張都是
// <button>(HTML 不允許 button 巢狀 button),故沿用「本體是可點擊的
// <div role="button">,移除是卡片內獨立的 <button>」這個既有模式。
function CandidateRow({
  c,
  onRemove,
  onSelect,
  onHover,
}: {
  c: GeoCandidate
  onRemove?: (candidate: GeoCandidate) => void
  onSelect?: (candidate: GeoCandidate) => void
  onHover?: (key: GeoSelectedKey) => void
}) {
  const photoUrl = c.kind === 'attraction' ? c.landmarkPhotoUrl : c.kind === 'entry' ? undefined : c.photoUrl
  const name = c.name
  const meta = c.kind === 'attraction' ? (c.landmarkName ?? '') : c.kind === 'entry' ? (c.location ?? '') : c.address
  return (
    <div className={styles.item}>
      <div
        role="button"
        tabIndex={0}
        className={styles.itemBody}
        onClick={() => onSelect?.(c)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSelect?.(c) }}
        onMouseEnter={() => onHover?.(geoItemKey(c.kind, c))}
        onMouseLeave={() => onHover?.(null)}
      >
        {photoUrl ? (
          <img className={styles.itemPhoto} src={photoUrl} alt={name} loading="lazy" />
        ) : (
          <div className={styles.itemPhotoPlaceholder} />
        )}
        <div className={styles.itemInfo}>
          <span className={styles.itemName}>{name}</span>
          {meta && <span className={styles.itemMeta}>{meta}</span>}
        </div>
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

// GeoCandidateSidebar 的城市搜尋欄 props——原本是 GeoOutlinePanel.tsx 疊在
// 地圖上方的浮動搜尋列(毛玻璃卡片),改放進這個側欄最上方,以側欄慣用的
// 靜態表單列呈現(不再需要 backdrop-filter 毛玻璃處理,側欄本身已經是
// 不透明底色,不會有內容從底下透出來的疑慮)。查詢邏輯本身(呼叫
// fetchGeoGeocode、算 panTarget)仍留在 GeoOutlinePanel.tsx——這裡只負責
// 呈現輸入框/按鈕/錯誤訊息,狀態與行為透過 props 從外部傳入,理由同
// candidates/onRemove 這組既有 props 的模式,維持這個元件單純是「受控
// 呈現層」。
export function GeoCandidateSidebar({
  candidates,
  onRemove,
  onSelect,
  onHover,
  city,
  onCityChange,
  onSearch,
  searching,
  searchError,
}: {
  candidates: GeoCandidate[]
  onRemove?: (candidate: GeoCandidate) => void
  onSelect?: (candidate: GeoCandidate) => void
  onHover?: (key: GeoSelectedKey) => void
  city: string
  onCityChange: (city: string) => void
  onSearch: () => void
  searching?: boolean
  searchError?: string | null
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
      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="輸入目的地城市,如「東京」"
          value={city}
          onChange={(e) => onCityChange(e.target.value)}
          onKeyDown={(e) => { if (isSubmitEnter(e)) onSearch() }}
        />
        <button className={styles.searchBtn} onClick={onSearch} disabled={searching || !city.trim()}>
          {searching ? '查詢中...' : '查看'}
        </button>
      </div>
      {searchError && <div className={styles.searchError}>{searchError}</div>}
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
                  <CandidateRow key={`${c.kind}-${c.name}-${c.lat}-${c.lng}`} c={c} onRemove={onRemove} onSelect={onSelect} onHover={onHover} />
                ))}
              </div>
            )}
            {onlyCandidate.length > 0 && (
              <div className={styles.group}>
                <div className={styles.groupTitle}>候選中 · {onlyCandidate.length}</div>
                {onlyCandidate.map((c) => (
                  <CandidateRow key={`${c.kind}-${c.name}-${c.lat}-${c.lng}`} c={c} onRemove={onRemove} onSelect={onSelect} onHover={onHover} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

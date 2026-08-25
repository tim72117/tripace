import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { ClientConfig, GeoSearchResult } from '../api'
import { geoItemKey, type GeoSelectedKey } from './GeoHotelSidebar'
import { type GeoCandidate, dayGroupLabel, searchResultToCandidate, useCandidateDatePicker } from './geoCandidateHelpers'
import { GeoListItemCard } from './GeoListItemCard'
import { useDragToClose } from '../hooks/useDragToClose'
import styles from './GeoOutlinePhoneListDrawer.module.css'

// GeoOutlinePhoneListDrawer:手機版「飯店/推薦地點/搜尋結果」清單——第三
// 階段新增,由下往上彈出(bottom sheet)——使用者要求「地點清單跟旅程
// 清單一樣從下方彈出」,視覺語言與拖曳關閉手勢對齊
// trip/PhoneTripsDrawer.tsx(同一套 bottom sheet 模式:垂直拖曳關閉、
// 貼齊底部常駐列上緣、上緣圓角、拖曳把手)。
//
// 飯店/推薦地點/搜尋結果三種來源(見 api.ts GeoSearchResult 的完整說明)
// 合併成單一 results 陣列,不分段、不重排——對齊桌面版 GeoHotelSidebar.tsx
// 現行的合併清單設計(使用者明確要求「同一份清單、同一套邏輯」,不再
// 各自獨立分段加小標題)。
//
// 純邏輯全部複用既有模組,不重新定義:geoItemKey 來自
// GeoHotelSidebar.tsx(與桌面版共用同一套識別鍵),
// createEntryFromCandidate/dayGroupLabel 來自 geoCandidateHelpers.ts。
//
// 清單項目本身不像桌面版 AddCandidateButton 那樣用懸浮彈出層選日期
// (GeoHotelSidebar.tsx 的 addCandidatePopover 是絕對定位彈出,手機觸控
// 對懸浮選單的點外部收合手勢沒有滑鼠事件可用)——改成點「+」原地展開
// inline 日期選擇區,寫法比照 GeoOutlinePhoneCandidateDrawer.tsx 的
// CandidateRow 展開模式:選一個行程既有日期的 chip,或輸入新日期,或
// 「僅加入候選」不排定日期。geocode 類型不能加入候選籃(理由見
// GeoSearchResult 的說明),不顯示這顆按鈕。
//
// 點擊卡片本體(非「+」)——比照桌面版 onSelect,把該項目往上回報,由
// GeoOutlinePhoneView.tsx 中介觸發移動地圖、同步 selectedKey 高亮對應
// marker,並開啟資訊卡(複用既有的 GeoOutlinePhoneInfoSheet,不在這個
// 抽屜內部重複刻一份資訊卡 UI)。
const SHEET_MAX_HEIGHT_VH = 70

function ItemAddButton({
  cfg,
  tripID,
  candidate,
  scheduledDates,
  onAddCandidate,
  onCreated,
}: {
  cfg: ClientConfig
  tripID?: string | null
  candidate: GeoCandidate
  scheduledDates: string[]
  onAddCandidate: (c: GeoCandidate) => void
  onCreated: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [dateValue, setDateValue] = useState('')
  const { saving, err, handlePick } = useCandidateDatePicker({
    cfg,
    tripID,
    getCandidate: () => candidate,
    onScheduled: () => {
      onCreated()
      setExpanded(false)
      setDateValue('')
    },
  })

  const addWithoutDate = () => {
    onAddCandidate(candidate)
    setExpanded(false)
    setDateValue('')
  }

  return (
    <div className={styles.addWrap}>
      <button
        type="button"
        className={styles.addBtn}
        title="加入候選"
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
      >
        <Plus size={15} strokeWidth={2} />
      </button>
      {expanded && (
        <div className={styles.addPanel} onClick={(e) => e.stopPropagation()}>
          {scheduledDates.length > 0 && (
            <div className={styles.dateChips}>
              {scheduledDates.map((date) => (
                <button
                  key={date}
                  type="button"
                  className={styles.dateChip}
                  disabled={saving}
                  onClick={() => handlePick(date)}
                >
                  {dayGroupLabel(date)}
                </button>
              ))}
            </div>
          )}
          <div className={styles.dateInputRow}>
            <input
              type="date"
              className={styles.dateInput}
              value={dateValue}
              onChange={(e) => setDateValue(e.target.value)}
            />
            <button
              type="button"
              className={styles.dateConfirmBtn}
              disabled={!dateValue || !tripID || saving}
              onClick={() => handlePick(dateValue)}
            >
              {saving ? '加入中…' : '加入這天'}
            </button>
          </div>
          <button type="button" className={styles.skipBtn} onClick={addWithoutDate}>
            僅加入候選
          </button>
          {err && <div className={styles.err}>{err}</div>}
        </div>
      )}
    </div>
  )
}

export function GeoOutlinePhoneListDrawer({
  cfg,
  tripID,
  open,
  onClose,
  results,
  selectedKey,
  candidateKeys,
  scheduledDates,
  onSelect,
  onAddCandidate,
  onCandidateCreated,
}: {
  cfg: ClientConfig
  tripID?: string | null
  open: boolean
  onClose: () => void
  // results:飯店/推薦地點/搜尋結果三種來源合併後的單一清單(見 api.ts
  // GeoSearchResult 的完整說明),由 GeoOutlinePhoneView.tsx 透過
  // useGeoPlanningState 中介——取代原本各自獨立的 hotels/places/
  // geocodeCandidates 三個 prop。
  results: GeoSearchResult[]
  selectedKey: GeoSelectedKey
  // candidateKeys:已在候選籃中的項目識別鍵集合——桌面版 GeoHotelSidebar.tsx
  // 本身沒有這個視覺標記,這裡手機版額外加一個「已加入候選」小標籤,讓
  // 使用者滑清單時能一眼看出哪些已經加過,不需要另外開候選籃核對。仍然
  // 允許重複按「+」再加一次(不擋開,理由同桌面版 AddCandidateButton 沒有
  // 針對重複加入做防呆——addGeoCandidate 呼叫端本身已用「名稱+座標」去重,
  // 見 GeoOutlinePhoneView.tsx 的 addGeoCandidate)。
  candidateKeys: Set<string>
  scheduledDates: string[]
  onSelect: (result: GeoSearchResult) => void
  onAddCandidate: (c: GeoCandidate) => void
  onCandidateCreated: () => void
}) {
  // geocodePhotos:搜尋結果(geocode)的照片延遲載入快取,理由同桌面版
  // GeoHotelSidebar.tsx 的同名 state。
  const [geocodePhotos, setGeocodePhotos] = useState<Record<string, string | null>>({})
  const { translate, transition, onTouchStart, onTouchMove, onTouchEnd } = useDragToClose({
    axis: 'y',
    open,
    onClose,
  })

  const isEmpty = results.length === 0

  return (
    <>
      {open && <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />}
      <div
        className={styles.panel}
        style={{
          maxHeight: `${SHEET_MAX_HEIGHT_VH}vh`,
          transform: `translateY(${translate})`,
          transition,
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className={styles.dragHandle}>
          <div className={styles.dragHandleBar} />
        </div>
        <div className={styles.head}>
          <span className={styles.title}>地點</span>
          <button type="button" className={styles.closeBtn} onClick={onClose} title="關閉">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className={styles.list}>
          {isEmpty ? (
            <div className={styles.empty}>
              還沒有查詢結果——移動地圖或按「搜尋這個區域」,查到的地點會列在這裡。
            </div>
          ) : (
            results.map((r) => {
              const key = geoItemKey(r.kind, r)
              return (
                <GeoListItemCard
                  key={key}
                  cfg={cfg}
                  name={r.name}
                  address={r.address}
                  photoUrl={r.kind === 'geocode' ? (r.placeId ? geocodePhotos[r.placeId] : null) : r.photoUrl}
                  placeId={r.kind === 'geocode' ? r.placeId : undefined}
                  onPhotoLoaded={(placeId, url) => {
                    setGeocodePhotos((prev) => ({ ...prev, [placeId]: url }))
                  }}
                  selected={selectedKey === key}
                  onSelect={() => onSelect(r)}
                  styles={styles}
                  badgeSlot={candidateKeys.has(key) && <span className={styles.inCandidateBadge}>已加入候選</span>}
                  addSlot={
                    r.kind !== 'geocode' && (
                      <ItemAddButton
                        cfg={cfg}
                        tripID={tripID}
                        candidate={searchResultToCandidate(r)}
                        scheduledDates={scheduledDates}
                        onAddCandidate={onAddCandidate}
                        onCreated={onCandidateCreated}
                      />
                    )
                  }
                />
              )
            })
          )}
        </div>
      </div>
    </>
  )
}

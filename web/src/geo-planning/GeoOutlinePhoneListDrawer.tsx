import { useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'
import { Compass, Hotel, Plus, X } from 'lucide-react'
import type { ClientConfig, GeoHotel, GeoPlace } from '../api'
import { geoItemKey, type GeoSelectedKey, type Tab } from './GeoHotelSidebar'
import { type GeoCandidate, createEntryFromCandidate, dayGroupLabel } from './geoCandidateHelpers'
import styles from './GeoOutlinePhoneListDrawer.module.css'

// GeoOutlinePhoneListDrawer:手機版「飯店/推薦地點」清單——第三階段新增。
// 對齊桌面版 GeoHotelSidebar.tsx 的分頁概念(Tab = 'hotels' | 'places'),
// 但這裡是「從左側滑入」的抽屜,不是常駐側欄——手機螢幕沒有桌面版那種
// 固定寬度側欄的空間,同候選籃(GeoOutlinePhoneCandidateDrawer.tsx)的
// 判斷,滑入抽屜能佔滿畫面高度容納完整清單。選左側滑入(不是右側)是因為
// 候選籃已經佔用右側滑入語意(見 GeoOutlinePhoneCandidateDrawer.tsx 的
// 說明:右上角候選籃圖示 → 右側滑入),這裡改成左上角新增的清單圖示 →
// 左側滑入,跟 PhoneNavDrawer.tsx(左側選單)共用同一個方向,但這個抽屜
// 疊在 PhoneNavDrawer 之上時兩者不會同時開啟(各自獨立的開關 state,使用
// 情境也不重疊:PhoneNavDrawer 是切換主畫面模式,這裡是規劃地圖內部的
// 清單瀏覽),手勢寫法完全比照 PhoneNavDrawer.tsx 的左側抽屜模式(拖曳
// 關閉方向 delta 為負)。
//
// 純邏輯全部複用既有模組,不重新定義:geoItemKey/Tab 來自
// GeoHotelSidebar.tsx(與桌面版共用同一套識別鍵/分頁型別),
// createEntryFromCandidate/dayGroupLabel 來自 geoCandidateHelpers.ts。
//
// 清單項目本身不像桌面版 AddCandidateButton 那樣用懸浮彈出層選日期
// (GeoHotelSidebar.tsx 的 addCandidatePopover 是絕對定位彈出,手機觸控
// 對懸浮選單的點外部收合手勢沒有滑鼠事件可用)——改成點「+」原地展開
// inline 日期選擇區,寫法比照 GeoOutlinePhoneCandidateDrawer.tsx 的
// CandidateRow 展開模式:選一個行程既有日期的 chip,或輸入新日期,或
// 「僅加入候選」不排定日期。
//
// 點擊卡片本體(非「+」)——比照桌面版 onSelectHotel/onSelectPlace,把
// 座標往上回報移動地圖、同步 selectedKey 高亮對應 marker,並開啟資訊卡
// (呼叫端 GeoOutlinePhoneView.tsx 複用既有的 GeoOutlinePhoneInfoSheet,不
// 在這個抽屜內部重複刻一份資訊卡 UI)。
const DRAWER_WIDTH_PERCENT = 86

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
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handlePick = async (date: string) => {
    if (!tripID) return
    setSaving(true)
    setErr(null)
    try {
      await createEntryFromCandidate(cfg, tripID, candidate, date)
      onCreated()
      setExpanded(false)
      setDateValue('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const addWithoutDate = () => {
    onAddCandidate(candidate)
    setExpanded(false)
    setDateValue('')
    setErr(null)
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
  hotels,
  places,
  placesCategory,
  activeTab,
  onTabChange,
  selectedKey,
  candidateKeys,
  scheduledDates,
  onSelectHotel,
  onSelectPlace,
  onAddCandidate,
  onCandidateCreated,
}: {
  cfg: ClientConfig
  tripID?: string | null
  open: boolean
  onClose: () => void
  hotels: GeoHotel[]
  places: GeoPlace[]
  placesCategory?: string | null
  activeTab: Tab
  onTabChange: (tab: Tab) => void
  selectedKey: GeoSelectedKey
  // candidateKeys:已在候選籃中的項目識別鍵集合——桌面版 GeoHotelSidebar.tsx
  // 本身沒有這個視覺標記,這裡手機版額外加一個「已加入候選」小標籤,讓
  // 使用者滑清單時能一眼看出哪些已經加過,不需要另外開候選籃核對。仍然
  // 允許重複按「+」再加一次(不擋開,理由同桌面版 AddCandidateButton 沒有
  // 針對重複加入做防呆——addGeoCandidate 呼叫端本身已用「名稱+座標」去重,
  // 見 GeoOutlinePhoneView.tsx 的 addGeoCandidate)。
  candidateKeys: Set<string>
  scheduledDates: string[]
  onSelectHotel: (hotel: GeoHotel) => void
  onSelectPlace: (place: GeoPlace) => void
  onAddCandidate: (c: GeoCandidate) => void
  onCandidateCreated: () => void
}) {
  const [dragOffset, setDragOffset] = useState(0)
  const startXRef = useRef<number | null>(null)
  const draggingRef = useRef(false)

  // 拖曳關閉手勢:左側滑入,比照 PhoneNavDrawer.tsx——開啟時只能往左拖
  // (關閉方向,delta 為負)。
  function onTouchStart(e: ReactTouchEvent) {
    startXRef.current = e.touches[0].clientX
    draggingRef.current = true
  }
  function onTouchMove(e: ReactTouchEvent) {
    if (!draggingRef.current || startXRef.current === null) return
    const delta = Math.min(0, e.touches[0].clientX - startXRef.current)
    setDragOffset(delta)
  }
  function onTouchEnd() {
    if (!draggingRef.current) return
    draggingRef.current = false
    const threshold = 60
    if (dragOffset < -threshold) onClose()
    setDragOffset(0)
    startXRef.current = null
  }

  const translate = open ? `${dragOffset}px` : `calc(-100% + ${dragOffset}px)`
  const placesLabel = placesCategory
    ? { tourist_attraction: '景點', lodging: '飯店', restaurant: '餐廳' }[placesCategory] ?? '附近推薦'
    : '附近推薦'

  return (
    <>
      {open && <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />}
      <div
        className={styles.panel}
        style={{
          width: `${DRAWER_WIDTH_PERCENT}%`,
          transform: `translateX(${translate})`,
          transition: draggingRef.current ? 'none' : 'transform 0.25s ease',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className={styles.head}>
          <span className={styles.title}>{activeTab === 'hotels' ? '飯店' : placesLabel}</span>
          <button type="button" className={styles.closeBtn} onClick={onClose} title="關閉">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab}${activeTab === 'hotels' ? ` ${styles.tabActive}` : ''}`}
            onClick={() => onTabChange('hotels')}
          >
            <Hotel size={16} strokeWidth={1.8} />
            飯店
          </button>
          <button
            type="button"
            className={`${styles.tab}${activeTab === 'places' ? ` ${styles.tabActive}` : ''}`}
            onClick={() => onTabChange('places')}
          >
            <Compass size={16} strokeWidth={1.8} />
            {placesLabel}
          </button>
        </div>
        <div className={styles.list}>
          {activeTab === 'hotels' ? (
            hotels.length === 0 ? (
              <div className={styles.empty}>還沒有飯店資料——移動地圖或按「搜尋這個區域」,附近的住宿會列在這裡。</div>
            ) : (
              hotels.map((h) => {
                const key = geoItemKey('hotel', h)
                return (
                  <div key={key} className={`${styles.item}${selectedKey === key ? ` ${styles.itemSelected}` : ''}`}>
                    <div
                      role="button"
                      tabIndex={0}
                      className={styles.itemBody}
                      onClick={() => onSelectHotel(h)}
                      onKeyDown={(e) => { if (e.key === 'Enter') onSelectHotel(h) }}
                    >
                      {h.photoUrl ? (
                        <img className={styles.itemPhoto} src={h.photoUrl} alt={h.name} loading="lazy" />
                      ) : (
                        <div className={styles.itemPhotoPlaceholder} />
                      )}
                      <div className={styles.itemInfo}>
                        <span className={styles.itemName}>{h.name}</span>
                        <span className={styles.itemAddress}>{h.address}</span>
                      </div>
                    </div>
                    {candidateKeys.has(key) && <span className={styles.inCandidateBadge}>已加入候選</span>}
                    <ItemAddButton
                      cfg={cfg}
                      tripID={tripID}
                      candidate={{ kind: 'hotel', ...h }}
                      scheduledDates={scheduledDates}
                      onAddCandidate={onAddCandidate}
                      onCreated={onCandidateCreated}
                    />
                  </div>
                )
              })
            )
          ) : places.length === 0 ? (
            <div className={styles.empty}>
              {placesCategory
                ? `還沒有${placesLabel}資料——這個範圍內查不到${placesLabel},試試移動地圖再查一次。`
                : '還沒有附近推薦——點地圖上的地標圖示,或按上方類別標籤(飯店/景點/餐廳),附近的地點會列在這裡。'}
            </div>
          ) : (
            places.map((p) => {
              const key = geoItemKey('place', p)
              return (
                <div key={key} className={`${styles.item}${selectedKey === key ? ` ${styles.itemSelected}` : ''}`}>
                  <div
                    role="button"
                    tabIndex={0}
                    className={styles.itemBody}
                    onClick={() => onSelectPlace(p)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onSelectPlace(p) }}
                  >
                    {p.photoUrl ? (
                      <img className={styles.itemPhoto} src={p.photoUrl} alt={p.name} loading="lazy" />
                    ) : (
                      <div className={styles.itemPhotoPlaceholder} />
                    )}
                    <div className={styles.itemInfo}>
                      <span className={styles.itemName}>{p.name}</span>
                      <span className={styles.itemAddress}>{p.address}</span>
                    </div>
                  </div>
                  {candidateKeys.has(key) && <span className={styles.inCandidateBadge}>已加入候選</span>}
                  <ItemAddButton
                    cfg={cfg}
                    tripID={tripID}
                    candidate={{ kind: 'place', ...p }}
                    scheduledDates={scheduledDates}
                    onAddCandidate={onAddCandidate}
                    onCreated={onCandidateCreated}
                  />
                </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}

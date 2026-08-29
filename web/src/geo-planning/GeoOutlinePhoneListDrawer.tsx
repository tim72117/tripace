import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import type { ClientConfig, GeoSearchResult } from '../api'
import { geoItemKey, type GeoSelectedKey } from './GeoHotelSidebar'
import { type GeoCandidate, dayGroupLabel, searchResultToCandidate, useCandidateDatePicker } from './geoCandidateHelpers'
import { GeoListItemCard } from './GeoListItemCard'
import { PhoneBottomSheet, PHONE_BOTTOM_SHEET_EXIT_MS, SheetHead } from '../components/PhoneBottomSheet'
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
// SHEET_MIN_HEIGHT/SHEET_SNAP_POINTS:這個抽屜專屬的三段式吸附(使用者
// 明確要求「地點清單改成三層」,原本只有收合+一個展開段共兩層)——跟
// GeoOutlinePhoneInfoSheet.tsx 的三段式是各自獨立的段落組合,共用容器
// components/PhoneBottomSheet.tsx 本身就是為了讓不同呼叫端各自帶一組
// 段落參數而設計,不是全站共用同一組段落(見該元件的說明)。
// SHEET_MIN_HEIGHT:收合狀態的固定高度,只顯示標頭(標題+關閉鈕)——
// 理由同 GeoOutlinePhoneInfoSheet.tsx 的 SHEET_MIN_HEIGHT。TODO(使用者
// 稍後決定合理數值):暫時估算。
// SHEET_SNAP_POINTS(由大到小排序,數值越小展開越多):
// [0] 中間狀態:可看清單內容,離頂部距離比照
//     GeoOutlinePhoneInfoSheet.tsx 三段式的中間值。TODO(使用者稍後
//     決定合理數值):暫時估算。
// [1] 滿版狀態:離頂部距離比照 GeoOutlinePhoneInfoSheet.tsx 三段式的
//     滿版值。TODO(使用者稍後決定合理數值):暫時估算。
const SHEET_MIN_HEIGHT = 100
const SHEET_SNAP_POINTS = [400, 80]

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
  loading = false,
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
  // loading:搜尋觸發後、結果還沒回來前顯示置中轉圈動畫——使用者明確
  // 要求「搜尋時要先開啟地點清單並顯示載入中」,呼叫端
  // (GeoOutlinePhoneView.tsx)在觸發搜尋的同一刻就開啟這個抽屜
  // (setListDrawerOpen(true))並傳 true,不用等查詢結果回來才開啟清單。
  // 轉傳給 PhoneBottomSheet 的 loading prop,見該元件的說明。
  loading?: boolean
}) {
  // lazyPhotos:依 placeId 延遲載入的照片快取,理由同桌面版
  // GeoHotelSidebar.tsx 的同名 state(2026-08 起不分 kind、只要有
  // placeId 就共用同一份快取)。
  const [lazyPhotos, setLazyPhotos] = useState<Record<string, string | null>>({})
  // activeSnapIndex:這個抽屜自己的吸附段落狀態,初始為展開(索引 1)——
  // 理由同 GeoOutlinePhoneInfoSheet.tsx 的同名 state,每次重新開啟都重設
  // 回展開,不延續上次被拖曳收合的狀態。
  const [activeSnapIndex, setActiveSnapIndex] = useState(1)
  useEffect(() => {
    if (open) setActiveSnapIndex(1)
  }, [open])

  const isEmpty = results.length === 0

  return (
    <PhoneBottomSheet
      open={open}
      onClose={onClose}
      snapPoints={SHEET_SNAP_POINTS}
      minHeightPx={SHEET_MIN_HEIGHT}
      activeSnapIndex={activeSnapIndex}
      onSnapIndexChange={setActiveSnapIndex}
      showBackdrop={false}
      exitDurationMs={PHONE_BOTTOM_SHEET_EXIT_MS}
      // panelStyle:bottom: 0、zIndex 36——使用者明確要求清單要蓋住底部
      // 常駐導覽列 PhoneTabBar.tsx(z-index: 35),不是貼齊它的上緣讓開
      // 空間(原本的 bottom 算式跟 z-index: 13 都只適合「清單在導覽列之上
      // 但不遮住它」的版面,實測遮住了導覽列的可點擊區域,理由同
      // GeoOutlinePhoneInfoSheet.tsx 的 panelStyle 說明——該元件用的就是
      // bottom: 0、zIndex: 36,這裡改成一致)。
      panelStyle={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 36 }}
      head={<SheetHead title="地點" onClose={onClose} />}
      loading={loading}
    >
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
                photoUrl={r.placeId ? lazyPhotos[r.placeId] : r.photoUrl}
                placeId={r.placeId}
                onPhotoLoaded={(placeId, url) => {
                  setLazyPhotos((prev) => ({ ...prev, [placeId]: url }))
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
    </PhoneBottomSheet>
  )
}

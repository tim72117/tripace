import { useCallback, useMemo, useState } from 'react'
import { AlignLeft, ListPlus, MapPinned } from 'lucide-react'
import type { ClientConfig, GeoAttraction, GeoHotel, GeoPlace } from '../api'
import type { Trip } from '../trip/types'
import type { User } from '../user/types'
import { Avatar } from '../AppCommon'
import { GeoOutlinePanel } from './GeoOutlinePanel'
import { geoItemKey, type GeoSelectedKey, type Tab } from './GeoHotelSidebar'
import type { GeoInfoContent } from './GeoInfoPanel'
import { hotelInfoContent, placeInfoContent, poiInfoContent } from './geoInfoContent'
import { type GeoCandidate, createEntryFromCandidate } from './geoCandidateHelpers'
import { GeoOutlinePhoneInfoSheet } from './GeoOutlinePhoneInfoSheet'
import { GeoOutlinePhoneCandidateDrawer } from './GeoOutlinePhoneCandidateDrawer'
import { GeoOutlinePhoneListDrawer } from './GeoOutlinePhoneListDrawer'
import styles from './GeoOutlinePhoneView.module.css'

// candidateInfoContent:候選籃項目本體被點擊(候選籃抽屜內的卡片)時開
// 資訊卡——對齊桌面版 DesktopLayout.tsx 的同名函式,candidate 欄位刻意
// 不帶(這個項目已經在候選籃裡,不需要再顯示一次「加入候選」按鈕)。
// 候選籃不會出現 kind==='attraction' 的項目(attraction 沒有任何入口能
// 被加入候選籃,理由同桌面版),故這裡不處理該分支。
function candidateInfoContent(c: Exclude<GeoCandidate, { kind: 'attraction' }>): GeoInfoContent {
  if (c.kind === 'entry') {
    return { name: c.name, subtitle: c.location ?? undefined, badges: [] }
  }
  return { name: c.name, photoUrl: c.photoUrl, subtitle: c.address, badges: [] }
}

// GeoOutlinePhoneView:手機版規劃地圖(geo-outline)主容器。第一階段是
// 地圖瀏覽 + 唯讀資訊卡;第二階段(這次)新增候選籃——讓使用者能把地圖上
// 瀏覽到的飯店/景點/地點加入候選籃,並排入行程的某一天。地圖引擎
// (GeoOutlinePanel/GeoOutlineMap)與桌面版共用同一份,平台無關,這裡只
// 負責手機版排版與候選籃資料流。
//
// 候選籃 UI 選用「從右側滑入的抽屜」(GeoOutlinePhoneCandidateDrawer),
// 不是再開一層 bottom sheet——理由見該元件開頭的說明:手機螢幕放不下
// 桌面版並排的兩張側欄(GeoCandidateSidebar+AddFromCandidateSidebar),
// 抽屜可以佔滿畫面高度,比 bottom sheet(必須跟地圖並存可見、高度受限
// 60vh)更適合放得下「候選中」+「已排入行程日層架」兩段內容。地圖固定
// 不動的底層 + 側邊滑入抽屜,對齊 pace/PacePhoneSwipe.tsx 的既有先例。
//
// 候選籃相關 state 對照桌面版 DesktopLayout.tsx 的同名 geo* state,只是
// 拿掉桌面版「兩個獨立浮動側欄」才需要的中介 state(pickingDayKey/
// onlyGeoCandidate/draggingCandidate——手機版候選籃合併成一個抽屜元件,
// 「候選中」清單直接由抽屜元件自己用 candidates prop 篩出,不需要呼叫端
// 另外算一份;不支援拖曳排期,見 GeoOutlinePhoneCandidateDrawer.tsx 的
// 說明)。純邏輯(GeoCandidate 型別/分組/建立 entry)完全複用
// geoCandidateHelpers.ts,與桌面版共用同一份,不重新實作。
//
// 第三階段新增「飯店/推薦地點」清單(GeoOutlinePhoneListDrawer)——同樣是
// 從一側滑入的抽屜,選左側(候選籃已佔用右側滑入語意,見
// GeoOutlinePhoneListDrawer.tsx 的說明)。資料來源對照桌面版
// DesktopLayout.tsx 的 geoHotels/geoPlaces/geoActiveTab/geoActiveCategory
// ——GeoOutlinePanel 本來就已經把 onHotelsChange/onPlacesNearby/
// onActiveCategoryChange 轉傳給 GeoOutlineMap(第一、二階段的手機版容器
// 沒有接這幾個 callback,地圖仍會查詢,只是查到的結果沒有清單可以顯示,
// 這次補上)。
export function GeoOutlinePhoneView({
  cfg,
  tripID,
  activeTrip,
  user,
  onOpenDrawer,
  onOpenSettings,
}: {
  cfg: ClientConfig
  tripID?: string | null
  // activeTrip:候選籃「加入 {tripName}」按鈕文字需要行程名稱——理由同
  // 桌面版 DesktopLayout.tsx 傳給 GeoInfoPanel 的 tripName prop。
  activeTrip?: Trip | null
  user: User
  onOpenDrawer: () => void
  onOpenSettings: () => void
}) {
  const [searchCity, setSearchCity] = useState('')
  const [searchTrigger, setSearchTrigger] = useState(0)
  const [selectedKey, setSelectedKey] = useState<GeoSelectedKey>(null)
  const [infoContent, setInfoContent] = useState<GeoInfoContent | null>(null)
  const [attractionContent, setAttractionContent] = useState<GeoAttraction | null>(null)
  const [panTarget, setPanTarget] = useState<{ lat: number; lng: number } | null>(null)

  // geoCandidates/geoCandidateKeys/addGeoCandidate/geoScheduledDates/
  // refetchTripEntriesTrigger:候選籃資料流,對照桌面版 DesktopLayout.tsx
  // 的同名 state/函式,見該檔案各自的完整說明,這裡不重複——行為完全
  // 一致(同一份去重規則、同一份 tripEntries 併入邏輯),只是掛在這個元件
  // 而非 DesktopLayout。
  const [geoCandidates, setGeoCandidates] = useState<GeoCandidate[]>([])
  const geoCandidateKeys = useMemo(
    () =>
      new Set(
        geoCandidates
          .filter((c): c is Extract<GeoCandidate, { kind: 'hotel' | 'attraction' | 'place' }> => c.kind !== 'entry')
          .map((c) => geoItemKey(c.kind, c)),
      ),
    [geoCandidates],
  )
  const addGeoCandidate = useCallback((c: GeoCandidate) => {
    setGeoCandidates((prev) =>
      prev.some((p) => p.kind === c.kind && p.name === c.name && p.lat === c.lat && p.lng === c.lng)
        ? prev
        : [...prev, c],
    )
  }, [])
  const removeGeoCandidate = useCallback((c: GeoCandidate) => {
    setGeoCandidates((prev) =>
      prev.filter((p) => !(p.kind === c.kind && p.name === c.name && p.lat === c.lat && p.lng === c.lng)),
    )
  }, [])
  const geoScheduledDates = useMemo(
    () =>
      Array.from(
        new Set(
          geoCandidates
            .filter((c): c is GeoCandidate & { kind: 'entry'; inTrip: true } => c.kind === 'entry' && c.inTrip && !!c.start)
            .map((c) => c.start as string),
        ),
      ).sort(),
    [geoCandidates],
  )
  const [geoRefetchTripEntriesTrigger, setGeoRefetchTripEntriesTrigger] = useState(0)

  // candidateDrawerOpen/candidateFlashTrigger:候選籃抽屜開關與「剛加入
  // 東西了」的短暫提示——理由同桌面版 geoCandidateFlashTrigger,見
  // GeoOutlinePhoneCandidateDrawer.module.css 的 .panelFlash。
  const [candidateDrawerOpen, setCandidateDrawerOpen] = useState(false)
  const [candidateFlashTrigger, setCandidateFlashTrigger] = useState(0)

  // geoHotels/geoPlaces/geoActiveTab/geoPlacesCategory:飯店/推薦地點清單
  // 資料流(第三階段新增),對照桌面版 DesktopLayout.tsx 的同名 geo* state
  // ——GeoOutlinePanel 本來就已經把 onHotelsChange/onPlacesNearby/
  // onActiveCategoryChange 轉傳給 GeoOutlineMap(見該檔案),只是第一/
  // 二階段的手機版容器沒有接這幾個 callback,這裡補上,資料來源與桌面版
  // 完全一致(地圖依可視範圍/使用者點擊類別標籤自己查詢,這裡只是接住
  // 往上回報的結果)。listDrawerOpen 是清單抽屜開關,對照桌面版側欄本身
  // 常駐展開(桌面版沒有這個 state,側欄固定顯示)。
  const [geoHotels, setGeoHotels] = useState<GeoHotel[]>([])
  const [geoPlaces, setGeoPlaces] = useState<GeoPlace[]>([])
  const [geoPlacesCategory, setGeoPlacesCategory] = useState<string | null>(null)
  const [geoActiveTab, setGeoActiveTab] = useState<Tab>('hotels')
  const [listDrawerOpen, setListDrawerOpen] = useState(false)

  // handleScheduleCandidate:資訊卡「加入 {tripName}」在候選沒有排定日期
  // 時,選好日期觸發——對齊桌面版 DesktopLayout.tsx 的同名函式。
  const handleScheduleCandidate = useCallback(async (c: GeoCandidate, date: string) => {
    if (!activeTrip?.id) return
    try {
      await createEntryFromCandidate(cfg, activeTrip.id, c, date)
      setGeoRefetchTripEntriesTrigger((n) => n + 1)
    } catch (err) {
      console.error('[GeoOutlinePhoneView] 加入行程(選定日期)失敗:', err)
    }
  }, [activeTrip?.id, cfg])

  // handleAddCandidateAndReveal:資訊卡「加入候選」按鈕(候選已有排定
  // 日期,直接加入)成功後順便打開候選籃抽屜給使用者看——手機版沒有
  // 桌面版「側欄本來就常駐展開」的前提(側欄本身可收合,見
  // candidateDrawerOpen),故這裡不像桌面版分成 onAddCandidate/
  // onAddAndReveal 兩顆按鈕,加入候選這個單一動作統一都順便打開抽屜、
  // 觸發一次 flash 提示,讓使用者確實看到剛加的項目,不需要使用者自己
  // 再多按一次「候選籃」圖示才看得到結果。
  const handleAddCandidate = useCallback((c: GeoCandidate) => {
    addGeoCandidate(c)
    setCandidateDrawerOpen(true)
    setCandidateFlashTrigger((n) => n + 1)
  }, [addGeoCandidate])

  const closeSheet = () => {
    setInfoContent(null)
    setAttractionContent(null)
  }

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.drawerBtn} onClick={onOpenDrawer} title="選單">
        <AlignLeft size={20} strokeWidth={1.8} />
      </button>
      <button type="button" className={styles.avatarBtn} onClick={onOpenSettings} title="設定">
        <Avatar user={user} />
      </button>
      <button
        type="button"
        className={styles.candidateBtn}
        onClick={() => setCandidateDrawerOpen(true)}
        title="候選籃"
      >
        <ListPlus size={18} strokeWidth={1.8} />
        {geoCandidates.length > 0 && <span className={styles.candidateBadge}>{geoCandidates.length}</span>}
      </button>
      <button
        type="button"
        className={styles.listBtn}
        onClick={() => setListDrawerOpen(true)}
        title="飯店/推薦地點"
      >
        <MapPinned size={18} strokeWidth={1.8} />
      </button>
      <GeoOutlinePanel
        cfg={cfg}
        tripID={tripID}
        city={searchCity}
        onCityChange={setSearchCity}
        onSearch={() => setSearchTrigger((n) => n + 1)}
        searchTrigger={searchTrigger}
        refetchTripEntriesTrigger={geoRefetchTripEntriesTrigger}
        onTripEntriesChange={(entries) => {
          // 行程本身已有座標的 entry 自動併入候選籃——對齊桌面版
          // DesktopLayout.tsx onTripEntriesChange 的完整邏輯(見該處說明),
          // 這裡原封不動搬過來,理由與桌面版完全一致,不重新設計。
          setGeoCandidates((prev) => {
            const keptCandidates = prev.filter((p) => !(p.kind === 'entry' && p.inTrip))
            const freshEntries = entries.map((e): GeoCandidate => ({
              ...e,
              kind: 'entry',
              inTrip: true,
              entryKind: e.kind,
            }))
            return [...keptCandidates, ...freshEntries]
          })
        }}
        onAttractionSelect={(a) => {
          setSelectedKey(geoItemKey('attraction', a))
          setInfoContent(null)
          setAttractionContent(a)
        }}
        onHotelSelect={(h) => {
          setSelectedKey(geoItemKey('hotel', h))
          setAttractionContent(null)
          setInfoContent(hotelInfoContent(h))
        }}
        onPlaceSelect={(p) => {
          setSelectedKey(geoItemKey('place', p))
          setAttractionContent(null)
          setInfoContent(placeInfoContent(p))
        }}
        onPoiSelect={(details) => {
          setAttractionContent(null)
          setInfoContent(poiInfoContent(details))
        }}
        onGeocodeCandidateSelect={(c) => {
          setAttractionContent(null)
          setInfoContent({ name: c.name, subtitle: c.address, badges: [] })
        }}
        onHotelsChange={setGeoHotels}
        onPlacesNearby={setGeoPlaces}
        onActiveCategoryChange={setGeoPlacesCategory}
        selectedKey={selectedKey}
        candidateKeys={geoCandidateKeys}
        panTarget={panTarget}
      />
      <GeoOutlinePhoneInfoSheet
        content={infoContent}
        attraction={attractionContent}
        tripName={activeTrip?.name ?? '行程'}
        scheduledDates={geoScheduledDates}
        onClose={closeSheet}
        onAddCandidate={handleAddCandidate}
        onSchedule={handleScheduleCandidate}
      />
      <GeoOutlinePhoneCandidateDrawer
        cfg={cfg}
        tripID={tripID}
        open={candidateDrawerOpen}
        onClose={() => setCandidateDrawerOpen(false)}
        candidates={geoCandidates}
        scheduledDates={geoScheduledDates}
        onRemove={removeGeoCandidate}
        onSelect={(c) => {
          if (c.kind === 'attraction') return
          setSelectedKey(c.kind === 'entry' ? null : geoItemKey(c.kind, c))
          setAttractionContent(null)
          setInfoContent(candidateInfoContent(c))
          setPanTarget({ lat: c.lat, lng: c.lng })
          setCandidateDrawerOpen(false)
        }}
        onReturnToCandidate={(c) => {
          setGeoCandidates((prev) => prev.map((p) => (p === c ? { ...p, inTrip: false } : p)))
        }}
        onScheduled={() => setGeoRefetchTripEntriesTrigger((n) => n + 1)}
        flashTrigger={candidateFlashTrigger}
      />
      <GeoOutlinePhoneListDrawer
        cfg={cfg}
        tripID={tripID}
        open={listDrawerOpen}
        onClose={() => setListDrawerOpen(false)}
        hotels={geoHotels}
        places={geoPlaces}
        placesCategory={geoPlacesCategory}
        activeTab={geoActiveTab}
        onTabChange={setGeoActiveTab}
        selectedKey={selectedKey}
        candidateKeys={geoCandidateKeys}
        scheduledDates={geoScheduledDates}
        onSelectHotel={(h) => {
          setSelectedKey(geoItemKey('hotel', h))
          setAttractionContent(null)
          setInfoContent(hotelInfoContent(h))
          setPanTarget({ lat: h.lat, lng: h.lng })
          setListDrawerOpen(false)
        }}
        onSelectPlace={(p) => {
          setSelectedKey(geoItemKey('place', p))
          setAttractionContent(null)
          setInfoContent(placeInfoContent(p))
          setPanTarget({ lat: p.lat, lng: p.lng })
          setListDrawerOpen(false)
        }}
        onAddCandidate={handleAddCandidate}
        onCandidateCreated={() => setGeoRefetchTripEntriesTrigger((n) => n + 1)}
      />
    </div>
  )
}

import { useCallback, useState } from 'react'
import { ListPlus, MapPinned, Timeline } from 'lucide-react'
import type { ClientConfig } from '../api'
import type { Trip } from '../trip/types'
import type { User } from '../user/types'
import { Avatar } from '../AppCommon'
import { GeoOutlinePanel } from './GeoOutlinePanel'
import { useGeoPlanningState } from './useGeoPlanningState'
import type { GeoCandidate } from './geoCandidateHelpers'
import { GeoOutlinePhoneInfoSheet } from './GeoOutlinePhoneInfoSheet'
import { GeoOutlinePhoneCandidateDrawer } from './GeoOutlinePhoneCandidateDrawer'
import { GeoOutlinePhoneListDrawer } from './GeoOutlinePhoneListDrawer'
import styles from './GeoOutlinePhoneView.module.css'

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
// DesktopLayout.tsx 的 geo.searchResults——GeoOutlinePanel 本來就已經
// 把 onSearchResultsChange 轉傳給 GeoOutlineMap(第一、二階段的
// 手機版容器沒有接這個 callback,地圖仍會查詢,只是查到的結果沒有
// 清單可以顯示,這次補上)。清單合併顯示飯店/推薦地點/搜尋結果,不分頁
// 切換——對齊桌面版 GeoHotelSidebar.tsx 現行的合併清單設計,原本這裡
// 分成 hotels/places 兩個 tab 的設計已移除(見 GeoOutlinePhoneListDrawer.tsx
// 的說明)。
export function GeoOutlinePhoneView({
  cfg,
  tripID,
  activeTrip,
  user,
  onOpenSettings,
  onOpenTimeline,
  onOpenTrips,
}: {
  cfg: ClientConfig
  tripID?: string | null
  // activeTrip:判斷使用者是否已選定旅程——為空時「加入行程」按下要先
  // 導向旅程列表(見下方 onOpenTrips),理由同桌面版 DesktopLayout.tsx
  // 的 pendingSchedule 機制。
  activeTrip?: Trip | null
  user: User
  // onOpenTimeline:左下角「時間軸」按鈕觸發,由 PhoneContent.tsx 傳入
  // (呼叫 setDrawerMode('timeline')切換主畫面)——這個元件本身不管全域
  // drawerMode 導航,只負責觸發。使用者要求「時間軸放左側」,原本是
  // PhoneTabBar.tsx 底部常駐三分頁之一,改成規劃地圖專屬、併入候選籃/
  // 清單所在的 candidateGroup(見下方 JSX)——時間軸入口從此只在規劃
  // 地圖畫面才看得到,已與使用者確認其他主畫面(配速表/對話)不再需要
  // 直接切到時間軸的入口。
  onOpenTimeline?: () => void
  onOpenSettings: () => void
  // onOpenTrips:候選籃「加入行程」流程裡,使用者還沒選定任何旅程
  // (activeTrip 為空,見上方 activeTrip 的說明——這個畫面本身允許不選
  // 旅程就瀏覽)時觸發,由呼叫端(PhoneContent.tsx)切到旅程列表分頁,
  // 引導使用者先選一個旅程。原本沒有這個 prop 時,geo.handleScheduleCandidate
  // 內部的 tripID guard 會直接靜默 no-op——使用者點了日期、資訊卡正常
  // 關閉,卻完全沒有任何提示告訴他「因為沒有選旅程所以沒加成功」,是
  // 實際發生過的 bug(桌面版 DesktopLayout.tsx 對應改成開啟旅程列表
  // 浮動卡,這裡是同一個修法的手機版對應)。
  onOpenTrips: () => void
}) {
  const [searchCity, setSearchCity] = useState('')
  const [searchTrigger, setSearchTrigger] = useState(0)
  // geo:選取狀態/候選籃/搜尋候選等地理規劃共用邏輯,與桌面版
  // DesktopLayout.tsx 共用同一個 hook(geo-planning/useGeoPlanningState.ts),
  // 不是各自實作一份形狀相同但獨立維護的版本。
  const geo = useGeoPlanningState({ cfg, tripID })

  // candidateDrawerOpen/candidateFlashTrigger:候選籃抽屜開關與「剛加入
  // 東西了」的短暫提示——理由同桌面版 geoCandidateFlashTrigger,見
  // GeoOutlinePhoneCandidateDrawer.module.css 的 .panelFlash。
  const [candidateDrawerOpen, setCandidateDrawerOpen] = useState(false)
  const [candidateFlashTrigger, setCandidateFlashTrigger] = useState(0)

  // listDrawerOpen:清單抽屜開關,對照桌面版側欄本身常駐展開(桌面版沒有
  // 這個 state,側欄固定顯示)。清單本身的資料(geo.searchResults)已由
  // useGeoPlanningState 統一管理,不再需要這個元件自己持有 geoHotels/
  // geoPlaces/geoGeocodeCandidates 三組 state。
  const [listDrawerOpen, setListDrawerOpen] = useState(false)
  // listSearchLoading:搜尋觸發後、查詢結果還沒回來前的載入中狀態——
  // 使用者明確要求「搜尋時要先開啟地點清單並顯示載入中」,不用等查到
  // 結果才開啟清單抽屜。搜尋觸發時(下方 GeoOutlinePanel 的 onSearch)
  // 同時開啟抽屜跟設 true,結果透過 onSearchResultsChange 回來時
  // (不論查到多少筆,含 0 筆)一律設回 false——查詢本身是非同步的
  // Google Places API 呼叫,由 GeoOutlineMap/GeoOutlinePanel 內部處理,
  // 這裡不重複實作查詢邏輯,只是在既有的資料回呼上多接一個旗標。
  const [listSearchLoading, setListSearchLoading] = useState(false)
  // handleAddCandidateAndReveal:資訊卡「加入候選」按鈕(候選已有排定
  // 日期,直接加入)成功後順便打開候選籃抽屜給使用者看——手機版沒有
  // 桌面版「側欄本來就常駐展開」的前提(側欄本身可收合,見
  // candidateDrawerOpen),故這裡不像桌面版分成 onAddCandidate/
  // onAddAndReveal 兩顆按鈕,加入候選這個單一動作統一都順便打開抽屜、
  // 觸發一次 flash 提示,讓使用者確實看到剛加的項目,不需要使用者自己
  // 再多按一次「候選籃」圖示才看得到結果。
  const handleAddCandidate = useCallback((c: GeoCandidate) => {
    geo.addCandidate(c)
    setCandidateDrawerOpen(true)
    setCandidateFlashTrigger((n) => n + 1)
  }, [geo])

  return (
    <div className={styles.wrap}>
      <div className={styles.candidateGroup}>
        <button
          type="button"
          className={styles.candidateBtn}
          onClick={() => setCandidateDrawerOpen(true)}
          title="候選籃"
        >
          <ListPlus size={20} strokeWidth={1.8} />
          {geo.candidates.length > 0 && <span className={styles.candidateBadge}>{geo.candidates.length}</span>}
        </button>
        <button
          type="button"
          className={styles.listBtn}
          onClick={() => setListDrawerOpen(true)}
          title="飯店/推薦地點"
        >
          <MapPinned size={20} strokeWidth={1.8} />
        </button>
        {onOpenTimeline && (
          <button
            type="button"
            className={styles.listBtn}
            onClick={onOpenTimeline}
            title="時間軸"
          >
            <Timeline size={20} strokeWidth={1.8} />
          </button>
        )}
      </div>
      <GeoOutlinePanel
        cfg={cfg}
        tripID={tripID}
        city={searchCity}
        onCityChange={setSearchCity}
        onSearch={() => {
          // 重新搜尋時清空目前選取的地點,關閉正在顯示的地點介紹卡——
          // 理由同 DesktopLayout.tsx 對應的 onSearch 說明。搜尋觸發的
          // 同一刻就開啟地點清單抽屜並進入載入中狀態(見上方
          // listSearchLoading 的說明),不用等查詢結果回來才開啟。
          geo.clearSelection()
          setSearchTrigger((n) => n + 1)
          setListDrawerOpen(true)
          setListSearchLoading(true)
        }}
        searchTrigger={searchTrigger}
        showZoomControl={false}
        searchRightSlot={
          <button type="button" className={styles.avatarBtn} onClick={onOpenSettings} title="設定">
            <Avatar user={user} />
          </button>
        }
        refetchTripEntriesTrigger={geo.refetchTripEntriesTrigger}
        onSearchResultsChange={(results) => {
          // 查詢結果回來時(不論查到多少筆,含 0 筆)結束載入中狀態——見
          // 上方 listSearchLoading 的說明。
          geo.setSearchResults(results)
          setListSearchLoading(false)
        }}
        externalGeocodeCandidateSelect={geo.searchResultSelect}
        onTripEntriesChange={geo.onTripEntriesChange}
        onAttractionSelect={geo.selectAttraction}
        onSearchResultSelect={geo.selectSearchResult}
        onPoiSelect={geo.selectPoi}
        onGeocodeCandidateText={(_placeId, text) => geo.patchGeocodeCandidateText(text)}
        onGeocodeCandidatePhoto={(_placeId, photoUrl) => geo.patchGeocodeCandidatePhoto(photoUrl)}
        selectedKey={geo.selectedKey}
        candidateKeys={geo.candidateKeys}
        panTarget={geo.panTarget}
      />
      <GeoOutlinePhoneInfoSheet
        content={geo.infoContent}
        attraction={geo.attractionContent}
        scheduledDates={geo.scheduledDates}
        onClose={geo.clearSelection}
        onAddCandidate={handleAddCandidate}
        onSchedule={(c, date) => {
          if (!activeTrip) {
            onOpenTrips()
            return
          }
          geo.handleScheduleCandidate(c, date, 'GeoOutlinePhoneView')
        }}
      />
      <GeoOutlinePhoneCandidateDrawer
        cfg={cfg}
        tripID={tripID}
        open={candidateDrawerOpen}
        onClose={() => setCandidateDrawerOpen(false)}
        candidates={geo.candidates}
        scheduledDates={geo.scheduledDates}
        onRemove={(c) => geo.handleRemoveCandidate(c, 'GeoOutlinePhoneCandidateDrawer')}
        onSelect={(c) => {
          geo.selectCandidateFromBasket(c)
          setCandidateDrawerOpen(false)
        }}
        onReturnToCandidate={(c) => geo.handleReturnToCandidate(c, 'GeoOutlinePhoneCandidateDrawer')}
        onScheduled={() => geo.setRefetchTripEntriesTrigger((n) => n + 1)}
        flashTrigger={candidateFlashTrigger}
      />
      <GeoOutlinePhoneListDrawer
        cfg={cfg}
        tripID={tripID}
        open={listDrawerOpen}
        onClose={() => setListDrawerOpen(false)}
        loading={listSearchLoading}
        results={geo.searchResults}
        selectedKey={geo.selectedKey}
        candidateKeys={geo.candidateKeys}
        scheduledDates={geo.scheduledDates}
        onSelect={(r) => {
          // 三種來源(飯店/地點/搜尋結果)既然合併成同一份清單,點擊行為
          // 一律走 selectSearchResultFromList,對齊桌面版
          // GeoHotelSidebar——讓 GeoOutlinePanel 觸發完整查詢(含
          // onlyIfOutOfView 移動地圖,見 useGeoPlanningState.ts 對這個
          // 函式的說明),不在這裡重新實作一份簡化版邏輯。
          geo.selectSearchResultFromList(r)
          setListDrawerOpen(false)
        }}
        onAddCandidate={handleAddCandidate}
        onCandidateCreated={() => geo.setRefetchTripEntriesTrigger((n) => n + 1)}
      />
    </div>
  )
}

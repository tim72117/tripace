import { useCallback, useState } from 'react'
import { ListPlus, Timeline } from 'lucide-react'
import type { ClientConfig } from '../api'
import type { Trip } from '../trip/types'
import type { User } from '../user/types'
import type { Theme } from '../theme'
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
//
// 2026-08:移除獨立的「飯店/推薦地點」手動開啟按鈕(原本的 .listBtn,
// MapPinned 圖示)——清單唯一入口改成「搜尋後自動打開」,不需要使用者
// 額外按一顆按鈕才看得到查詢結果。listDrawerOpen 因此改成掛在查詢結果
// 真正回來的那一刻(onSearchResultsChange),不是查詢觸發的那一刻
// (onSearch)——這是刻意選擇的邊緣觸發(edge-triggered)設計:查詢入口
// 有三個(城市搜尋框的 onSearch、地圖上方類別標籤、「搜尋這個區域」
// 按鈕),後兩者已經改走 GeoOutlineMap.tsx 內部的 runPlacesQuery,不經過
// onSearch(見該函式的說明),若「打開清單」的邏輯留在 onSearch 裡,這兩個
// 入口永遠不會觸發它。onSearchResultsChange 則是三個入口查詢完成後都會
// 流經的單一匯合點(GeoOutlineMap.tsx 的 searchResults 變動 effect,見該
// 檔案的說明),不論由誰觸發查詢,只要真的查到結果(含 0 筆),清單就該
// 打開——不會有 level-triggered 那種「資料因無關原因重新計算就誤開啟
// 使用者剛手動關掉的清單」的疑慮,因為這個 effect 天生只在查詢真正完成
// 時觸發一次。
export function GeoOutlinePhoneView({
  cfg,
  tripID,
  activeTrip,
  user,
  onOpenSettings,
  onOpenTimeline,
  onOpenTrips,
  theme,
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
  // theme:這個 App 的深色/淺色模式偏好(useAppState() 的 theme,見
  // theme.ts),由 PhoneContent.tsx 中介(props.theme)——原封不動轉傳給
  // GeoOutlinePanel → GeoOutlineMap 決定建圖時的 colorScheme,見
  // GeoOutlineMap.tsx 對這個 prop 的完整說明。這個元件本身不消費 theme,
  // 純轉傳。
  theme?: Theme
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
  // geoPlaces/geoGeocodeCandidates 三組 state。沒有獨立的手動開啟入口
  // (見上方元件開頭 2026-08 註解)——只在 onSearchResultsChange 打開、
  // 點清單項目或按關閉鈕時收起。
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
          // 理由同 DesktopLayout.tsx 對應的 onSearch 說明。「打開清單」
          // 的動作不在這裡做(見上方 2026-08 註解)——這個 callback 只有
          // 城市搜尋框這個入口會呼叫到,地圖上方類別標籤/「搜尋這個
          // 區域」按鈕完全不經過它,若把開清單的邏輯留在這裡會讓那兩個
          // 入口永遠打不開清單。loading 狀態則三個入口都共用同一個
          // onSearchResultsChange 收尾,起始的 loading=true 只需要在
          // 這個入口(唯一會提前知道「即將查詢」的地方)設定即可——地圖
          // 上方那兩個入口沒有對應的「查詢開始前」時機可掛,查詢很快,
          // 沒有 loading 動畫可接受。
          geo.clearSelection()
          setSearchTrigger((n) => n + 1)
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
          // 查詢結果回來時(不論查到多少筆,含 0 筆)結束載入中狀態、
          // 打開清單抽屜——見上方 2026-08 註解:這是三個查詢入口(城市
          // 搜尋框/類別標籤/搜尋這個區域)共用的唯一匯合點,不論誰觸發
          // 查詢,結果回來就開,不需要呼叫端各自記得開清單。
          geo.setSearchResults(results)
          setListSearchLoading(false)
          setListDrawerOpen(true)
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
        theme={theme}
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

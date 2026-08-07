import { useState } from 'react'
import { Compass, Hotel, Plus } from 'lucide-react'
import type { ClientConfig, GeoHotel, GeoPlace } from './api'
import { type GeoCandidate, createEntryFromCandidate } from './GeoCandidateSidebar'
import styles from './GeoHotelSidebar.module.css'

// GeoHotelSidebar:地理輪廓底圖(構想 6)查詢到的飯店/推薦地點清單,顯示在
// 整個桌面版介面(rail+side panel+main)最外側——比照 DesktopLayout.tsx
// 既有的 DemoPanel(debug 面板)固定寬度側欄模式,跟 .desktop-main
// 平行,而非塞在 main 內部的某一欄。只在使用者實際查看地理輪廓底圖
// (panelMode === 'geo-outline')時才顯示,見 DesktopLayout.tsx
// 的掛載條件。
//
// 頂部分頁標籤(飯店/附近推薦)切換要顯示哪一份清單,視覺語言比照
// 左側 DesktopRail 的 active 態(左緣 accent 豎條 + 淡底色),讓使用者
// 一眼認出這是同一套導覽介面慣例,不是另一套新樣式。
//
// 原本還有一個「地點」分頁(人工建檔的景點區域,見 model.Attraction)已
// 整個移除(使用者明確要求)——attraction 改成只透過地圖上本來就會畫出的
// 自訂地標圖示(光暈+標籤,見 GeoOutlineMap.tsx)瀏覽/點擊,不再提供這份
// 文字清單瀏覽入口;點擊地圖上的地標仍會開啟 AttractionInfoPanel(見該
// 檔案),含「探索周邊」按鈕,這條路徑完全不受這次移除影響。
//
// onSelectHotel:點擊清單項目本體時觸發,把該項目座標往上回報——這個側欄
// 跟實際的地圖(GeoOutlineMap)是分開掛載的 sibling(側欄在 DesktopLayout
// 最外側,地圖在 main 內部的 GeoOutlinePanel 裡),點擊「移動地圖到這個
// 座標」的意圖只能靠 DesktopLayout 中介,往下傳給 GeoOutlinePanel 再傳給
// GeoOutlineMap 執行實際的 panTo。
//
// onAddCandidate:卡片右側的「+」按鈕觸發,把該項目加入候選籃
// (GeoCandidateSidebar,見該元件的說明)——跟 onSelectHotel(移動地圖)
// 是兩個獨立的動作,故卡片本體不能整張都是 <button>(HTML 不允許 button
// 巢狀 button),改成卡片本體是可點擊的 <div role="button">,「+」是卡片
// 內獨立的 <button>。
//
// selectedKey:目前被選中的項目識別鍵(見下方 geoItemKey),由 DesktopLayout
// 中介(理由同 geoPanTarget——側欄與地圖是分開掛載的 sibling)。點擊項目
// 本體時「移動地圖」與「標記選取」是同一個使用者意圖,故沿用 onSelectHotel
// 這個既有 callback 觸發,不另外新增 onSelect 系列 prop。
export type GeoSelectedKey = string | null

// geoItemKey:飯店/景點區域/推薦地點都沒有穩定的 id(飯店/推薦地點是
// 即時查詢結果,景點區域可能來自三種不同來源,見 api.ts 的 GeoAttraction
// 說明),用「名稱+座標」組合當識別鍵——同一份查詢結果內足以識別惟一
// 項目,不需要额外引入 id 欄位。entry(行程本身已有座標的 entry,見
// GeoTripEntry)雖然有穩定 id,仍沿用同一套「名稱+座標」規則,跟其他
// 三種來源保持一致,不需要為它另外分岔一套識別邏輯。'attraction' 這個
// kind 值仍保留(地圖上的地標圖示/AttractionInfoPanel 仍會用到,見
// GeoOutlineMap.tsx),只是這個側欄不再渲染 attraction 清單。
export function geoItemKey(
  kind: 'hotel' | 'attraction' | 'place' | 'entry',
  item: { name: string; lat: number; lng: number },
) {
  return `${kind}:${item.name}:${item.lat}:${item.lng}`
}

export type Tab = 'hotels' | 'places'

// places:點擊地圖上的地標(見 GeoOutlineMap.tsx 的 handleAttractionClick)
// 時,即時查詢該地標附近的推薦地點(景點/餐廳/商店等,不限類型,對齊
// server 的 GET /internal/geo/places/nearby)——跟地點/飯店兩個分頁是
// 常駐、跟著地圖範圍持續更新的圖層不同,這個分頁是「使用者點了某個
// 地標才會有內容」的一次性查詢結果,查無資料或還沒點過任何地標時顯示
// 對應的空狀態提示。
// onSelectPlace:同 onSelectHotel/onSelectAttraction,點擊項目本體時把
// 座標往上回報以移動地圖。
//
// activeTab:目前要顯示哪個分頁,由 DesktopLayout.tsx 中介——原本是這個
// 元件的內部 state,但地圖上點擊地標/飯店/推薦地點(見
// GeoOutlineMap.tsx 的 onAttractionSelect/onHotelSelect/onPlaceSelect)
// 也需要能「開啟右側對應項目的介紹」,而地圖跟這個側欄是分開掛載的
// sibling,只能靠父層中介的 state 驅動分頁切換,不能再讓分頁停留在
// 使用者上次手動點的那一頁——例如目前在「飯店」分頁,點了地圖上的
// 地標,若分頁不跟著切到「地點」,使用者根本看不到剛點的地標介紹跑
// 去了哪裡。不傳時 fallback 一份未受控的內部 state(維持 demo/獨立
// 使用情境下的既有行為)。
// PLACES_CATEGORY_LABELS:「附近推薦」分頁標題/空狀態文字要顯示的類別
// 名稱,key 必須跟 GeoOutlineMap.tsx 的 CATEGORY_TAGS/後端 allowedPlaceTypes
// 一致——這裡不 import 那份定義(避免地圖元件被非地圖用途的側欄引入),
// 純粹是同一組值域各自維護一份對照表,理由同 CATEGORY_TAGS 本身跟後端
// allowedPlaceTypes 的既有慣例。
const PLACES_CATEGORY_LABELS: Record<string, string> = {
  tourist_attraction: '景點',
  lodging: '飯店',
  restaurant: '餐廳',
}

// AddCandidateButton:卡片右側「+」按鈕——按下後原地展開一個極簡的日期
// 輸入(單一 <input type="date"> + 確定按鈕),寫法比照
// GeoCandidateSidebar.tsx 的 NoDateDayHead。選了日期按確定,直接呼叫
// createEntryFromCandidate 建立一筆有 start 日期的真正行程 entry(不再
// 只是丟進純前端候選籃);不想選日期時可以按「僅加入候選」,行為維持
// 原本的 onAddCandidate(丟進 geoCandidates,純前端、不寫入後端)——兩條
// 路徑並存,讓使用者自行決定要不要當場定案日期。tripID 為空(理論上不該
// 發生,這個側欄只在已選行程的情境下渲染)時不顯示日期輸入选項,只保留
// 「僅加入候選」,避免呼叫 createEntryFromCandidate 時沒有行程可寫。
function AddCandidateButton({
  cfg,
  tripID,
  candidate,
  onAddCandidate,
  onCreated,
}: {
  cfg: ClientConfig
  tripID?: string | null
  candidate: GeoCandidate
  onAddCandidate?: (candidate: GeoCandidate) => void
  // onCreated:直接建立成後端 entry 成功後觸發,通知呼叫端(DesktopLayout.tsx)
  // 重新查一次 tripEntries——這個元件自己沒有 tripEntries 可以更新,只能
  // 請上游重新查詢,新條目會在下一次渲染出現在正確的日期分組(同
  // GeoCandidateSidebar.tsx 的 onDatesAssigned 既有模式)。
  onCreated?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const confirmWithDate = async () => {
    if (!date || !tripID) return
    setSaving(true)
    setErr(null)
    try {
      await createEntryFromCandidate(cfg, tripID, candidate, date)
      setEditing(false)
      setDate('')
      onCreated?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const addWithoutDate = () => {
    onAddCandidate?.(candidate)
    setEditing(false)
    setDate('')
    setErr(null)
  }

  return (
    <div className={styles.addCandidateWrap}>
      <button
        type="button"
        className={styles.addBtn}
        title="加入候選"
        onClick={() => setEditing((v) => !v)}
      >
        <Plus size={16} strokeWidth={2} />
      </button>
      {editing && (
        <div className={styles.addCandidatePopover} onClick={(e) => e.stopPropagation()}>
          <input
            type="date"
            className={styles.addCandidateDateInput}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            autoFocus
          />
          <button
            type="button"
            className={styles.addCandidateConfirmBtn}
            onClick={confirmWithDate}
            disabled={!date || !tripID || saving}
          >
            {saving ? '加入中…' : '加入這天'}
          </button>
          <button type="button" className={styles.addCandidateSkipBtn} onClick={addWithoutDate}>
            僅加入候選
          </button>
          {err && <div className={styles.addCandidateErr}>{err}</div>}
        </div>
      )}
    </div>
  )
}

export function GeoHotelSidebar({
  cfg,
  tripID,
  hotels,
  places = [],
  placesCategory,
  selectedKey,
  activeTab,
  onTabChange,
  onSelectHotel,
  onSelectPlace,
  onAddCandidate,
  onCandidateCreated,
  onHover,
}: {
  cfg: ClientConfig
  // tripID:「+」按鈕展開日期選擇、直接建立成後端 entry 時需要知道寫進
  // 哪個行程(見 AddCandidateButton 呼叫 createEntryFromCandidate 的說明)
  // ——這個側欄本來就綁定在已選行程的情境下渲染,故 undefined/null 理論
  // 上不該發生,但保守起見 AddCandidateButton 內部仍會判斷,沒有 tripID
  // 就不允許選日期,只保留「僅加入候選」。
  tripID?: string | null
  hotels: GeoHotel[]
  places?: GeoPlace[]
  // placesCategory:目前 places 內容屬於地圖上方哪個類別標籤(飯店/景點/
  // 餐廳,見 GeoOutlineMap.tsx 的 onActiveCategoryChange),null 代表不屬於
  // 任何特定類別(來自點擊地標查附近推薦)——用來讓「附近推薦」分頁的
  // 標題/空狀態文字反映目前實際查的是哪個類別,而不是籠統的「附近推薦」
  // 四個字,使用者才看得出來點餐廳標籤查到的清單「就是」這個分頁,不是
  // 沒反應或查到別的東西。刻意不新增第四顆分頁按鈕(用戶明確要求不要),
  // 沿用既有的「附近推薦」分頁位置,只是內容標題動態換字。
  placesCategory?: string | null
  selectedKey?: GeoSelectedKey
  activeTab?: Tab
  onTabChange?: (tab: Tab) => void
  onSelectHotel?: (hotel: GeoHotel) => void
  onSelectPlace?: (place: GeoPlace) => void
  onAddCandidate?: (candidate: GeoCandidate) => void
  // onCandidateCreated:AddCandidateButton 選了日期、直接建立成後端 entry
  // 成功後觸發,轉發給呼叫端(DesktopLayout.tsx)重新查一次 tripEntries
  // (見 AddCandidateButton 的 onCreated 說明)。
  onCandidateCreated?: () => void
  // onHover:滑鼠移到/移出項目本體時觸發,傳入該項目的 geoItemKey(移出時
  // 傳 null)——由 DesktopLayout.tsx 中介,驅動地圖上對應 marker 暫時顯示
  // 選取樣式(見 GeoOutlineMap.tsx 的 hoverKey prop 說明)。跟 onSelectXxx
  // 是兩個獨立的互動:hover 是滑鼠移過去的臨時預覽,不需要區分是哪種
  // 來源(hotel/place),呼叫端只需要知道「現在滑鼠在哪個 key 上」,故這裡
  // 統一傳字串,不比照 onSelectXxx 拆成各自帶完整物件的 callback。
  onHover?: (key: GeoSelectedKey) => void
}) {
  const [internalTab, setInternalTab] = useState<Tab>('hotels')
  // activeTab 有傳時視為受控元件,忽略內部 state;沒傳時退回內部 state,
  // 維持既有(尚未接上父層中介邏輯的情境)行為不變。
  const tab = activeTab ?? internalTab
  const setTab = onTabChange ?? setInternalTab
  const placesLabel = (placesCategory && PLACES_CATEGORY_LABELS[placesCategory]) || '附近推薦'

  return (
    <aside className={styles.sidebar}>
      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab}${tab === 'hotels' ? ` ${styles.tabActive}` : ''}`}
          onClick={() => setTab('hotels')}
          title="飯店"
        >
          <Hotel size={18} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className={`${styles.tab}${tab === 'places' ? ` ${styles.tabActive}` : ''}`}
          onClick={() => setTab('places')}
          title={placesLabel}
        >
          <Compass size={18} strokeWidth={1.8} />
        </button>
      </div>
      <div className={styles.list}>
        {tab === 'hotels' ? (
          hotels.length === 0 ? (
            <div className={styles.empty}>還沒有飯店資料——按下地圖上的「搜尋這個區域」,附近的住宿會列在這裡。</div>
          ) : (
            hotels.map((h) => (
              <div
                key={`${h.name}-${h.lat}-${h.lng}`}
                className={`${styles.item}${selectedKey === geoItemKey('hotel', h) ? ` ${styles.itemSelected}` : ''}`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  className={styles.itemBody}
                  onClick={() => onSelectHotel?.(h)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onSelectHotel?.(h) }}
                  onMouseEnter={() => onHover?.(geoItemKey('hotel', h))}
                  onMouseLeave={() => onHover?.(null)}
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
                <AddCandidateButton
                  cfg={cfg}
                  tripID={tripID}
                  candidate={{ kind: 'hotel', ...h }}
                  onAddCandidate={onAddCandidate}
                  onCreated={onCandidateCreated}
                />
              </div>
            ))
          )
        ) : places.length === 0 ? (
          <div className={styles.empty}>
            {placesCategory
              ? `還沒有${placesLabel}資料——這個範圍內查不到${placesLabel},試試移動地圖再查一次。`
              : '還沒有附近推薦——點地圖上的地標圖示,或按上方類別標籤(飯店/景點/餐廳),附近的地點會列在這裡。'}
          </div>
        ) : (
          <>
            {/* placesCategory 有值時額外顯示一行小標題,標明目前清單是哪個
                類別標籤查出來的結果——分頁按鈕本身只有圖示+hover
                title,不夠顯眼,使用者點了「餐廳」標籤後很容易誤以為清單
                沒反應,加這行文字讓對應關係一眼可見。沒有 placesCategory
                時(來自點地標的泛用推薦)不顯示,維持原本簡潔。 */}
            {placesCategory && <div className={styles.placesCategoryHead}>{placesLabel}</div>}
            {places.map((p) => (
              <div
                key={`${p.name}-${p.lat}-${p.lng}`}
                className={`${styles.item}${selectedKey === geoItemKey('place', p) ? ` ${styles.itemSelected}` : ''}`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  className={styles.itemBody}
                  onClick={() => onSelectPlace?.(p)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onSelectPlace?.(p) }}
                  onMouseEnter={() => onHover?.(geoItemKey('place', p))}
                  onMouseLeave={() => onHover?.(null)}
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
                <AddCandidateButton
                  cfg={cfg}
                  tripID={tripID}
                  candidate={{ kind: 'place', ...p }}
                  onAddCandidate={onAddCandidate}
                  onCreated={onCandidateCreated}
                />
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  )
}

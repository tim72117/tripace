import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { ClientConfig, GeoSearchResult } from '../api'
import { type GeoCandidate } from './GeoCandidateSidebar'
import { searchResultToCandidate, useCandidateDatePicker } from './geoCandidateHelpers'
import { GeoListItemCard } from './GeoListItemCard'
import { PanelHead } from '../components/PanelHead'
import styles from './GeoHotelSidebar.module.css'

// GeoHotelSidebar:地理輪廓底圖(構想 6)查詢到的飯店/推薦地點/搜尋結果
// 清單,顯示在整個桌面版介面(rail+side panel+main)最外側——比照
// DesktopLayout.tsx 既有的 DemoPanel(debug 面板)固定寬度側欄模式,跟
// .desktop-main 平行,而非塞在 main 內部的某一欄。只在使用者實際查看
// 地理輪廓底圖(panelMode === 'geo-outline')時才顯示,見 DesktopLayout.tsx
// 的掛載條件。
//
// 使用者要求飯店/推薦地點/搜尋結果三種來源(見 api.ts GeoSearchResult 的
// 完整說明)「同一份清單、同一套邏輯」,不分段、不重排,依 results 陣列
// 原本的順序(GeoOutlineMap.tsx 組裝 searchResults 時決定,見該處說明)
// 直接顯示,不再像先前版本各自獨立分段加小標題——原本的分段標題/排序
// 邏輯已整個移除,不是視覺調整,是底層資料流收斂成單一陣列後的自然
// 結果。
//
// 原本還有一個「地點」分頁(人工建檔的景點區域,見 model.Attraction)已
// 整個移除(使用者明確要求)——attraction 改成只透過地圖上本來就會畫出的
// 自訂地標圖示(光暈+標籤,見 GeoOutlineMap.tsx)瀏覽/點擊,不再提供這份
// 文字清單瀏覽入口;點擊地圖上的地標仍會開啟 AttractionInfoPanel(見該
// 檔案),含「探索周邊」按鈕,這條路徑完全不受這次移除影響。
//
// onSelect:點擊清單項目本體時觸發,把該項目往上回報——這個側欄跟實際的
// 地圖(GeoOutlineMap)是分開掛載的 sibling(側欄在 DesktopLayout 最
// 外側,地圖在 main 內部的 GeoOutlinePanel 裡),點擊「移動地圖到這個
// 座標」的意圖只能靠 DesktopLayout 中介,往下傳給 GeoOutlinePanel 再傳給
// GeoOutlineMap 執行實際的 panTo。
//
// onAddCandidate:卡片右側的「+」按鈕觸發,把該項目加入候選籃
// (GeoCandidateSidebar,見該元件的說明)——跟 onSelect(移動地圖)是
// 兩個獨立的動作,故卡片本體不能整張都是 <button>(HTML 不允許 button
// 巢狀 button),改成卡片本體是可點擊的 <div role="button">,「+」是卡片
// 內獨立的 <button>。geocode 類型純定位用途,不能加入候選籃(理由見
// GeoSearchResult 的說明),不顯示這顆按鈕。
//
// selectedKey:目前被選中的項目識別鍵(見下方 geoItemKey),由 DesktopLayout
// 中介(理由同 geoPanTarget——側欄與地圖是分開掛載的 sibling)。點擊項目
// 本體時「移動地圖」與「標記選取」是同一個使用者意圖,故沿用 onSelect
// 這個既有 callback 觸發,不另外新增其他 prop。
export type GeoSelectedKey = string | null

// geoItemKey:飯店/景點區域/推薦地點/搜尋結果都沒有穩定的 id(飯店/
// 推薦地點/搜尋結果是即時查詢結果,景點區域可能來自三種不同來源,見
// api.ts 的 GeoAttraction 說明),用「名稱+座標」組合當識別鍵——同一份
// 查詢結果內足以識別惟一項目,不需要额外引入 id 欄位。entry(旅程本身
// 已有座標的 entry,見 GeoTripEntry)雖然有穩定 id,仍沿用同一套
// 「名稱+座標」規則,跟其他來源保持一致,不需要為它另外分岔一套識別
// 邏輯。'attraction' 這個 kind 值仍保留(地圖上的地標圖示/
// AttractionInfoPanel 仍會用到,見 GeoOutlineMap.tsx),只是這個側欄不再
// 渲染 attraction 清單。
export function geoItemKey(
  kind: 'hotel' | 'attraction' | 'place' | 'entry' | 'geocode',
  item: { name: string; lat: number; lng: number },
) {
  return `${kind}:${item.name}:${item.lat}:${item.lng}`
}

// AddCandidateButton:卡片右側「+」按鈕——按下後原地展開一個極簡的日期
// 輸入(單一 <input type="date"> + 確定按鈕),寫法比照
// GeoCandidateSidebar.tsx 的 NoDateDayHead。選了日期按確定,直接呼叫
// createEntryFromCandidate 建立一筆有 start 日期的真正旅程 entry(不再
// 只是丟進純前端候選籃);不想選日期時可以按「僅加入候選」,行為維持
// 原本的 onAddCandidate(丟進 geoCandidates,純前端、不寫入後端)——兩條
// 路徑並存,讓使用者自行決定要不要當場定案日期。tripID 為空(理論上不該
// 發生,這個側欄只在已選旅程的情境下渲染)時不顯示日期輸入选項,只保留
// 「僅加入候選」,避免呼叫 createEntryFromCandidate 時沒有旅程可寫。
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
  const { saving, err, handlePick } = useCandidateDatePicker({
    cfg,
    tripID,
    getCandidate: () => candidate,
    onScheduled: () => {
      setEditing(false)
      setDate('')
      onCreated?.()
    },
  })

  const confirmWithDate = () => handlePick(date)

  const addWithoutDate = () => {
    onAddCandidate?.(candidate)
    setEditing(false)
    setDate('')
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
  results,
  selectedKey,
  onSelect,
  onAddCandidate,
  onCandidateCreated,
  onHover,
  onClose,
}: {
  cfg: ClientConfig
  // tripID:「+」按鈕展開日期選擇、直接建立成後端 entry 時需要知道寫進
  // 哪個旅程(見 AddCandidateButton 呼叫 createEntryFromCandidate 的說明)
  // ——這個側欄本來就綁定在已選旅程的情境下渲染,故 undefined/null 理論
  // 上不該發生,但保守起見 AddCandidateButton 內部仍會判斷,沒有 tripID
  // 就不允許選日期,只保留「僅加入候選」。
  tripID?: string | null
  // results:飯店/推薦地點/搜尋結果三種來源合併後的單一清單(見 api.ts
  // GeoSearchResult 的完整說明),由 DesktopLayout.tsx 透過
  // useGeoPlanningState 中介——取代原本各自獨立的 hotels/places/
  // geocodeCandidates 三個 prop。
  results: GeoSearchResult[]
  selectedKey?: GeoSelectedKey
  onSelect?: (result: GeoSearchResult) => void
  onAddCandidate?: (candidate: GeoCandidate) => void
  // onCandidateCreated:AddCandidateButton 選了日期、直接建立成後端 entry
  // 成功後觸發,轉發給呼叫端(DesktopLayout.tsx)重新查一次 tripEntries
  // (見 AddCandidateButton 的 onCreated 說明)。
  onCandidateCreated?: () => void
  // onHover:滑鼠移到/移出項目本體時觸發,傳入該項目的 geoItemKey(移出時
  // 傳 null)——由 DesktopLayout.tsx 中介,驅動地圖上對應 marker 暫時顯示
  // 選取樣式(見 GeoOutlineMap.tsx 的 hoverKey prop 說明)。
  onHover?: (key: GeoSelectedKey) => void
  // onClose:頂部標題列的關閉按鈕觸發——使用者明確要求跟候選籃側欄
  // (AddFromCandidateSidebar)一樣的頂部條樣式(標題文字+關閉按鈕),
  // 原本這個側欄的關閉按鈕由呼叫端(DesktopLayout.tsx)在外層容器額外
  // 疊加、沒有標題文字搭配,這次改成側欄自己渲染完整的頂部條,呼叫端
  // 只需要傳這個 callback,不用再自己管理按鈕定位/樣式。未接這個 prop
  // 時不顯示頂部條(理論上不該發生,這個側欄目前唯一的呼叫端
  // DesktopLayout.tsx 一定會傳)。
  onClose?: () => void
}) {
  const isEmpty = results.length === 0
  // lazyPhotos:依 placeId 延遲載入的照片快取(見 GeoListItemCard 的
  // 說明)——原本只有 geocode(搜尋結果)會用到,2026-08 起 place(附近
  // 推薦地點,見 api.ts GeoPlace.placeId 的說明)也改成同一套延遲查詢,
  // 故泛化成不分 kind、只要有 placeId 就共用同一份快取。key 是
  // placeId——存在這裡(而非每個 GeoListItemCard 各自記憶)是因為清單
  // 重新渲染(hover/選取狀態變化)不該讓已經查過的照片消失重查,且同一個
  // placeId 若因為使用者上下捲動導致項目重新 mount,也不該重複觸發查詢。
  // value 為 undefined 代表還沒查過,null 代表查過但沒有照片,string
  // 代表查到的照片網址。
  const [lazyPhotos, setLazyPhotos] = useState<Record<string, string | null>>({})

  return (
    <aside className={styles.sidebar}>
      <PanelHead title="搜尋結果" onClose={onClose} />
      <div className={styles.list}>
        {isEmpty ? (
          <div className={styles.empty}>
            還沒有查詢結果——按上方類別標籤(飯店/景點/餐廳)、地圖上的地標圖示,或使用城市搜尋框,查到的地點會列在這裡。
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
                onSelect={() => onSelect?.(r)}
                onHoverChange={(hovering) => onHover?.(hovering ? key : null)}
                styles={styles}
                addSlot={
                  r.kind !== 'geocode' && (
                    <AddCandidateButton
                      cfg={cfg}
                      tripID={tripID}
                      candidate={searchResultToCandidate(r)}
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
    </aside>
  )
}

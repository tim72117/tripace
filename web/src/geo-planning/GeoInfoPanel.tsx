import { useEffect, useRef, useState } from 'react'
import { PanelLeft, Plus, X } from 'lucide-react'
import { dayGroupLabel, type GeoCandidate } from './GeoCandidateSidebar'
import { candidateHasScheduledDate } from './geoCandidateHelpers'
import { DatePickerPopover } from './DatePickerPopover'
import { PhotoCarousel } from './PhotoCarousel'
import styles from './GeoInfoPanel.module.css'

// GeoInfoPanel:一張浮動卡片,絕對定位疊在地圖上方,貼齊主顯示區右緣
// (即 GeoHotelSidebar 左側),與主顯示區同高、四周留出間距,不像
// GeoHotelSidebar/GeoCandidateSidebar 那樣佔用一份平行的 flex 版面
// 空間。故渲染位置放在 .desktop-main(見 DesktopLayout.tsx,該容器已有
// position: relative)底下、跟 GeoOutlinePanel 同層,而非跟
// GeoHotelSidebar 同層。
//
// 有兩個觸發來源,呼叫端(DesktopLayout.tsx)統一轉成 GeoInfoContent 後
// 才傳進來,這個元件不需要知道資料原始來自哪裡:
//  1. 地點清單(GeoHotelSidebar「地點」分頁)點擊項目本體——刻意不移動
//     地圖(不再 setGeoPanTarget),理由:原本點擊會讓地圖平移過去,但
//     那個互動假設「使用者想看這個地點在地圖上的位置」,這次要的是
//     「先看介紹內容」,不需要地圖跟著動,尤其地圖目前顯示的範圍可能就是
//     使用者刻意瀏覽的範圍,點清單項目把它搬走反而打斷瀏覽。地圖上直接
//     點自訂地標圖示(useAttractionOverlays.ts 的 handleAttractionClick)維持
//     原本「放大到該範圍+查附近推薦」的行為不變——那是使用者已經在
//     地圖上、明確想放大看這個地點的意圖,跟清單點擊是兩種不同情境。
//  2. 點擊底圖上 Google 原生繪製的 POI 圖標(見 GeoOutlineMap.tsx 攔截
//     IconMouseEvent、event.stop() 停用預設 InfoWindow 後改查
//     fetchGeoPlaceDetails)——這種來源沒有知名度分級/景點數量/範圍
//     半徑這些只有自建 district 資料才有的欄位,改顯示 Google 評分。
export interface GeoInfoContent {
  name: string
  photoUrl?: string
  // googlePhotoUrls/pexelsPhotoUrls:目前只有「點擊地圖上 Google 原生 POI
  // 圖標」這個來源(poiInfoContent,見 geoInfoContent.ts)會帶值——其餘
  // 來源(地點清單/候選籃項目)只有單一 photoUrl,這兩個欄位維持
  // undefined,PhotoCarousel 收到兩者皆空時會 fallback 回 photoUrl,行為
  // 不受影響。顯示順序「先 Google 後 Pexels」,見 PhotoCarousel.tsx。
  // placeId:2026-08 起,推薦地點(GeoPlace)不再帶 eager photoUrl(後端
  // 照片查詢改成背景預熱快取,見 server 端 handleGeoPlacesNearby 的
  // 說明),故這張卡片開啟時若 photoUrl 未知、但有 placeId,呼叫端
  // (useGeoPlanningState.ts 的 infoContentPhotoFetch effect)會另外呼叫
  // fetchGeoPlacePhoto 補查、查到後用 PATCH_INFO_CONTENT 補上——這個
  // 元件本身不主動發起查詢(維持純展示,理由同其餘 GeoInfoContent 欄位
  // 的設計),只是要保留這個欄位讓呼叫端知道「這張卡片有沒有東西可補查」。
  // geocode(搜尋結果)本身已經有另一套獨立的文字/照片補查流程(見
  // GeoOutlinePanel.tsx 的 selectedCandidate effect),不依賴這個欄位。
  placeId?: string
  googlePhotoUrls?: string[]
  pexelsPhotoUrls?: string[]
  subtitle?: string
  summary?: string
  badges: string[]
  // candidate:這張卡片對應的候選籃項目——由呼叫端(DesktopLayout.tsx)
  // 在兩個觸發來源(側欄「地點」清單點擊/點擊地圖上 Google 原生 POI
  // 圖標)各自組好傳入,這個元件不需要知道資料原始形狀差異,只負責在
  // 有值時顯示「加入候選」按鈕、按下時原封不動往上回報。undefined 代表
  // 這個來源目前組不出候選籃需要的形狀(理論上不該發生,兩個觸發來源
  // 都有對應資料可組),但保留 optional 避免未來新增第三種觸發來源時
  // 忘記處理就直接編譯錯誤擋下來。
  candidate?: GeoCandidate
}

export function GeoInfoPanel({
  content,
  onClose,
  onAddCandidate,
  onAddAndReveal,
  onSchedule,
  scheduledDates,
  shiftBy,
  style,
}: {
  content: GeoInfoContent | null
  onClose: () => void
  // shiftBy:右緣可能同時有 GeoHotelSidebar(飯店/附近推薦清單,見
  // FloatingPanel.tsx 的 side="right")與對話浮動小匡(見
  // DesktopLayout.tsx 的 .chatPopover),兩者都跟這張卡片預設的定位
  // 重疊——由呼叫端(DesktopLayout.tsx)判斷目前右緣實際被哪個佔用、
  // 傳入對應值,把卡片推到它左側。'chat' 偏移量大於 'hotel'(對話小匡
  // 較寬),兩者都存在時呼叫端只會傳其中較寬的那個,不是疊加,詳見
  // GeoInfoPanel.module.css 的 .shiftedHotel/.shiftedChat。
  shiftBy?: 'none' | 'hotel' | 'chat'
  // style:2026-08 新增的逃生艙——目前唯一的用途是 DesktopLayout.tsx
  // 讓「附近景點」點擊後開的第二個 GeoInfoPanel 執行個體,動態算出要
  // 疊在 AttractionInfoPanel 左側多少距離(這個距離還要疊加
  // infoPanelShiftBy 本身是否已經因為飯店側欄/對話小匡而往左推,是三種
  // shiftBy 組合各自的動態值,不適合再展開成更多固定的 shiftBy enum
  // 字面值——那樣可讀性反而更差)。用 style(而非再擴充 shiftBy)是因為
  // 這個位移量是執行期算出來的數字,不是有限枚舉。
  style?: React.CSSProperties
  // onAddCandidate:「加入候選」按鈕觸發,理由同 GeoHotelSidebar 卡片上
  // 既有的同名 callback——這裡刻意不做「已在候選籃裡就不顯示按鈕」的
  // 判斷,重複加入由呼叫端的候選籃 state 用內容比對去重(見
  // DesktopLayout.tsx 的 onAddCandidate 說明),這個元件不需要知道候選籃
  // 目前的完整內容。按下直接加入候選籃(純前端,不寫入後端)——刻意不像
  // GeoHotelSidebar.tsx 的 AddCandidateButton 那樣展開日期選擇,使用者
  // 明確要求「地點介紹」的加入候選維持單純的一鍵加入,日期改到已排入
  // 行程分組的「從候選加入」入口(見 GeoCandidateSidebar.tsx)再指定。
  // 按下時的行為依候選是否已有排定日期分岔(見 candidateHasScheduledDate/
  // handleAddClick):已有日期時直接呼叫這個 callback;沒有日期時改在原地
  // 展開日期選擇 UI,選好日期按確定後改呼叫下面的 onSchedule,不呼叫這個
  // callback——「加入候選籃」跟「排進行程的哪一天」在沒有日期可用時,
  // 對使用者而言是同一個決定,不該先無日期地塞進候選籃、之後才回頭補,
  // 那樣「已排入行程」分組會多一輪「未排定日期」的中繼狀態(見
  // GeoCandidateSidebar.tsx 的 dayGroupKey/NO_DATE_GROUP 分組邏輯)。
  onAddCandidate?: (candidate: GeoCandidate) => void
  // onSchedule:候選沒有已排定日期時,日期選擇 UI 選好日期按「確定」觸發
  // ——把候選跟選定的日期一起回報給呼叫端(DesktopLayout.tsx),由它決定
  // 怎麼寫入(理由同 createEntryFromCandidate 需要 cfg/tripID,這個元件
  // 沒有,也不該有)。
  onSchedule?: (candidate: GeoCandidate, date: string) => void
  // onAddAndReveal:複合按鈕右半邊(只有 PanelLeft icon)觸發——跟左半邊
  // onAddCandidate 一樣是單純加入候選籃(同一個動作、不涉及日期選擇),
  // 差別只在於這顆按鈕額外承諾「加入後讓使用者看得到剛加的項目」:候選籃
  // 側欄(GeoCandidateSidebar)在這個複合按鈕能被按到的情境下(panelMode
  // === 'geo-outline')本來就已經展開顯示,沒有獨立的「收合/展開」開關
  // 可以在這個情境下額外觸發,故這裡改成呼叫端在側欄上打一個短暫的
  // highlight 動畫(見 DesktopLayout.tsx 的 geoCandidateFlashTrigger),
  // 讓使用者感覺到「東西加進候選籃了、去左邊看」。這個元件不知道呼叫端
  // 具體怎麼做視覺提示,只負責原封不動往上回報使用者按了這顆按鈕。
  onAddAndReveal?: (candidate: GeoCandidate) => void
  // scheduledDates:行程本身目前已排定的日期清單(YYYY-MM-DD),由呼叫端
  // (DesktopLayout.tsx)算好傳入——這個元件不需要知道怎麼從候選籃/行程
  // entries 推導出這份清單。候選沒有自己的日期、但行程已有排定日期時,
  // 「加入行程」改先跳下拉選單列出這些日期(格式比照
  // GeoCandidateSidebar.tsx 的 dayGroupLabel),而不是直接展開日曆——
  // 多數情況下使用者是把新地點加進「已經在排的行程」,列出既有日期讓
  // 一鍵選比每次都要重新開日曆挑日期快。undefined 或空陣列都視為「沒有
  // 既有日期可選」,行為退回原本直接展開日曆,見 handleAddClick。使用者
  // 明確要求按鈕文字不用串上旅程名稱(原本是「加入 {tripName}」),故
  // tripName prop 已移除,不再由呼叫端傳入。
  scheduledDates?: string[]
}) {
  // addUiMode:「加入行程」按下、候選沒有排定日期時展開的 UI 狀態
  // ——'closed' 沒有展開任何東西、'menu' 展開既有日期下拉選單、'calendar'
  // 展開日期選擇 UI(比照 GeoCandidateSidebar.tsx NoDateDayHead 的既有樣式
  // 慣例)。用 content 的參照當依賴重置——切換到別的地點介紹卡時,不該讓
  // 上一張卡片展開的 UI 殘留在新內容上。
  const [addUiMode, setAddUiMode] = useState<'closed' | 'menu' | 'calendar'>('closed')
  useEffect(() => {
    setAddUiMode('closed')
  }, [content])

  // dateMenuOpenUp/addCandidateWrapRef:.dateMenu 與 .calendarPopover(見
  // GeoInfoPanel.module.css)預設都往下展開(top: calc(100% + 6px)),但
  // 這張卡片本身可能出現在視窗下半部(例如點擊地圖上靠近視窗底部的
  // 地點),導致按鈕位置偏低、往下展開會被視窗邊界截斷或推出可視範圍
  // 外。addUiMode 切到 'menu' 或 'calendar' 時都量測按鈕組
  // (.addCandidateWrap)相對視窗底部的剩餘空間,不夠容納估計高度時改成
  // 往上展開(dateMenuOpenUp=true,CSS 端對應切換 bottom 取代 top)。用
  // getBoundingClientRect 量測而非 CSS-only 方案(如 @supports
  // position-try),因為選單項目數隨 scheduledDates 長度變動、日曆本身
  // 高度也不是固定值,無法只靠 CSS 預先得知。
  const addCandidateWrapRef = useRef<HTMLDivElement>(null)
  const [dateMenuOpenUp, setDateMenuOpenUp] = useState(false)
  useEffect(() => {
    if (addUiMode === 'closed') return
    const wrap = addCandidateWrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    if (addUiMode === 'menu') {
      // 估計選單高度:每個選項約 30px(padding 7px*2 + 字高約 16px,見
      // .dateMenuItem)+ 一個固定的「其他日期」選項 + 選單自身 padding
      // (4px*2)+ 跟按鈕的間距(6px,見 CSS top: calc(100% + 6px))。用
      // 估計值而非實際渲染後量測,避免「先渲染量測、量完發現不夠再翻轉」
      // 這種會讓使用者看到選單先在錯誤位置閃一下的做法。
      const estimatedItemCount = (scheduledDates?.length ?? 0) + 1
      const estimatedMenuHeight = estimatedItemCount * 30 + 8 + 6
      setDateMenuOpenUp(spaceBelow < estimatedMenuHeight)
    } else {
      // 日曆浮動匡估計高度:月份標題列(約32px)+ 星期列(約28px)+
      // 最多 6 週 * 34px(見 DatePickerPopover.module.css 的
      // --rdp-day-height)+ 外層 padding(8px*2,見 .wrap)+ 跟按鈕的
      // 間距(6px)——用最寬鬆的 6 週估計,避免月份跨 6 週時才發現空間
      // 不夠、UI 突然跳動。
      const estimatedCalendarHeight = 32 + 28 + 6 * 34 + 16 + 6
      setDateMenuOpenUp(spaceBelow < estimatedCalendarHeight)
    }
  }, [addUiMode, scheduledDates])

  // 點選單/日曆以外的地方收合:'menu'/'calendar' 展開時,在 document 上
  // 掛一個 mousedown 監聽——點擊落在 addCandidateWrapRef(按鈕組 + 懸浮
  // 選單/日曆本身,見上方 ref 掛載處)之外就收回 'closed'。用 mousedown
  // 而非 click,是為了在選單項目自己的 onClick(handlePickScheduledDate/
  // 切到 'calendar')或日曆格子的 onSelect 觸發前就能正確判斷「這次點擊
  // 是不是點在浮層內」,避免兩個事件的觸發順序打架。
  useEffect(() => {
    if (addUiMode === 'closed') return
    const handlePointerDown = (e: MouseEvent) => {
      if (addCandidateWrapRef.current?.contains(e.target as Node)) return
      setAddUiMode('closed')
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [addUiMode])

  if (!content) return null

  const candidate = content.candidate

  // handleAddClick:「加入 {tripName}」按下時的三路分岔——候選已有排定
  // 日期(candidateHasScheduledDate)直接呼叫 onAddCandidate,維持既有行為;
  // 候選沒有日期時,行程本身有既有排定日期(scheduledDates 非空)就先展開
  // 下拉選單,否則直接展開日曆(見 onAddCandidate/onSchedule 的完整說明)。
  const handleAddClick = () => {
    if (!candidate) return
    if (candidateHasScheduledDate(candidate)) {
      onAddCandidate?.(candidate)
      return
    }
    if (scheduledDates && scheduledDates.length > 0) {
      setAddUiMode('menu')
      return
    }
    setAddUiMode('calendar')
  }

  const handlePickScheduledDate = (date: string) => {
    if (!candidate) return
    onSchedule?.(candidate, date)
    setAddUiMode('closed')
  }

  const handleConfirmDate = (date: string) => {
    if (!candidate) return
    onSchedule?.(candidate, date)
    setAddUiMode('closed')
  }

  const shiftClass = shiftBy === 'chat' ? ` ${styles.shiftedChat}` : shiftBy === 'hotel' ? ` ${styles.shiftedHotel}` : ''
  return (
    <div className={`${styles.panel}${shiftClass}`} style={style}>
      <button type="button" className={styles.closeBtn} onClick={onClose} title="關閉">
        <X size={16} strokeWidth={2} />
      </button>
      <div className={styles.body}>
        <div className={styles.imageWrap}>
          <PhotoCarousel
            googlePhotoUrls={content.googlePhotoUrls}
            pexelsPhotoUrls={content.pexelsPhotoUrls}
            fallbackUrl={content.photoUrl}
            alt={content.name}
          />
        </div>
        <div className={styles.content}>
          <h2 className={styles.name}>{content.name}</h2>
          {content.subtitle && <span className={styles.landmarkName}>{content.subtitle}</span>}
          {content.badges.length > 0 && (
            <div className={styles.metaRow}>
              {content.badges.map((b) => (
                <span key={b} className={styles.badge}>{b}</span>
              ))}
            </div>
          )}
          {content.summary ? (
            <p className={styles.summary}>{content.summary}</p>
          ) : (
            <p className={styles.summaryEmpty}>這個地點還沒有簡介資料。</p>
          )}
          {candidate && (
            <>
              {/* addCandidateWrap:position: relative 錨點——讓下面的
                  .dateMenu 懸浮選單能用 position: absolute 貼齊這個按鈕組
                  正下方,不擠壓卡片其餘內容版面(選單展開/收合不會讓底下的
                  日曆 UI 位置跳動)。 */}
              <div className={styles.addCandidateWrap} ref={addCandidateWrapRef}>
                <div className={styles.addCandidateGroup}>
                  <button
                    type="button"
                    className={styles.addCandidateBtn}
                    onClick={handleAddClick}
                  >
                    <Plus size={14} strokeWidth={2} />
                    加入行程
                  </button>
                  <button
                    type="button"
                    className={styles.addToNewTripBtn}
                    onClick={() => onAddAndReveal?.(candidate)}
                    title="加入候選並顯示候選籃"
                    aria-label="加入候選並顯示候選籃"
                  >
                    <PanelLeft size={14} strokeWidth={2} />
                  </button>
                </div>
                {/* 既有日期懸浮選單:候選沒有排定日期、但行程本身已有排定
                    日期時,按下「加入 {tripName}」先展開,列出 scheduledDates
                    每一天(格式同 GeoCandidateSidebar.tsx 的 dayGroupLabel)+
                    一個「其他日期」選項,見 scheduledDates prop 的說明。
                    絕對定位疊在按鈕下方,不推擠卡片其餘內容。 */}
                {addUiMode === 'menu' && (
                  <div className={`${styles.dateMenu}${dateMenuOpenUp ? ` ${styles.dateMenuOpenUp}` : ''}`}>
                    {scheduledDates?.map((date) => (
                      <button
                        key={date}
                        type="button"
                        className={styles.dateMenuItem}
                        onClick={() => handlePickScheduledDate(date)}
                      >
                        {dayGroupLabel(date)}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={styles.dateMenuItem}
                      onClick={() => setAddUiMode('calendar')}
                    >
                      其他日期
                    </button>
                  </div>
                )}
                {/* 日期選擇日曆浮動匡:候選沒有排定日期時,按下「加入
                    {tripName}」(或從上方下拉選單點「其他日期」)展開,
                    絕對定位疊在按鈕組正下方,不推擠卡片其餘內容版面——
                    跟 .dateMenu 是同一種疊層手法(見 .calendarPopover 的
                    說明),使用者明確要求改成浮動小匡而非原地展開。改用
                    DatePickerPopover(月曆格線 UI,見該元件開頭的說明,
                    取代原本的原生 <input type="date">)。點選日期格子即
                    視為確定,不需要額外的「確定」按鈕——原本的按鈕是
                    搭配原生 date input 沒有選取瞬間回饋才需要的中介
                    步驟。 */}
                {addUiMode === 'calendar' && (
                  <div className={`${styles.calendarPopover}${dateMenuOpenUp ? ` ${styles.calendarPopoverOpenUp}` : ''}`}>
                    <DatePickerPopover onSelect={handleConfirmDate} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

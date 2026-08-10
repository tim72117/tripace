import { useEffect, useRef, useState } from 'react'
import { PanelLeft, Plus, X } from 'lucide-react'
import { dayGroupLabel, type GeoCandidate } from './GeoCandidateSidebar'
import styles from './GeoInfoPanel.module.css'

// candidateHasScheduledDate:判斷這個候選是否已經有排定日期——只有
// kind==='entry' 且 start 非空字串的候選才符合(entry 是「返回候選」後
// 暫時退回候選籃、但仍保留原本 start/startTime 的項目,見 GeoCandidate
// 型別定義的完整說明;hotel/attraction/place 三種來源天生沒有日期概念,
// 一律視為「沒有排定日期」)。供「加入 {tripName}」按鈕決定要不要先跳
// 日期選擇,見下方 handleAddClick 的說明。
function candidateHasScheduledDate(c: GeoCandidate): boolean {
  return c.kind === 'entry' && !!c.start
}

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
//     點自訂地標圖示(GeoOutlineMap.tsx 的 handleDistrictClick)維持
//     原本「放大到該範圍+查附近推薦」的行為不變——那是使用者已經在
//     地圖上、明確想放大看這個地點的意圖,跟清單點擊是兩種不同情境。
//  2. 點擊底圖上 Google 原生繪製的 POI 圖標(見 GeoOutlineMap.tsx 攔截
//     IconMouseEvent、event.stop() 停用預設 InfoWindow 後改查
//     fetchGeoPlaceDetails)——這種來源沒有知名度分級/景點數量/範圍
//     半徑這些只有自建 district 資料才有的欄位,改顯示 Google 評分。
export interface GeoInfoContent {
  name: string
  photoUrl?: string
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
  tripName,
  scheduledDates,
  shiftLeft,
}: {
  content: GeoInfoContent | null
  onClose: () => void
  // shiftLeft:GeoHotelSidebar(飯店/附近推薦清單)有內容顯示時,那個
  // 側欄會漂浮在 .desktop-main 右緣之上(見 styles-desktop.css 的
  // .geo-hotel-sidebar-wrap),跟這張卡片預設的定位重疊——由呼叫端
  // (DesktopLayout.tsx)判斷 GeoHotelSidebar 目前是否顯示、傳入這個
  // flag,把卡片推到它左側,詳見 GeoInfoPanel.module.css 的 .shifted。
  shiftLeft?: boolean
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
  // tripName:左半邊按鈕文字「加入 {tripName}」要顯示的行程名稱,由呼叫端
  // (DesktopLayout.tsx)傳入 activeTrip?.name——這個元件不猜行程名稱從
  // 哪來,呼叫端已經有 activeTrip 可用,由它決定 fallback 文字。
  tripName: string
  // scheduledDates:行程本身目前已排定的日期清單(YYYY-MM-DD),由呼叫端
  // (DesktopLayout.tsx)算好傳入——這個元件不需要知道怎麼從候選籃/行程
  // entries 推導出這份清單。候選沒有自己的日期、但行程已有排定日期時,
  // 「加入 {tripName}」改先跳下拉選單列出這些日期(格式比照
  // GeoCandidateSidebar.tsx 的 dayGroupLabel),而不是直接展開日曆——
  // 多數情況下使用者是把新地點加進「已經在排的行程」,列出既有日期讓
  // 一鍵選比每次都要重新開日曆挑日期快。undefined 或空陣列都視為「沒有
  // 既有日期可選」,行為退回原本直接展開日曆,見 handleAddClick。
  scheduledDates?: string[]
}) {
  // addUiMode:「加入 {tripName}」按下、候選沒有排定日期時展開的 UI 狀態
  // ——'closed' 沒有展開任何東西、'menu' 展開既有日期下拉選單、'calendar'
  // 展開日期選擇 UI(比照 GeoCandidateSidebar.tsx NoDateDayHead 的既有樣式
  // 慣例)。用 content 的參照當依賴重置——切換到別的地點介紹卡時,不該讓
  // 上一張卡片展開的 UI 殘留在新內容上。
  const [addUiMode, setAddUiMode] = useState<'closed' | 'menu' | 'calendar'>('closed')
  const [dateValue, setDateValue] = useState('')
  useEffect(() => {
    setAddUiMode('closed')
    setDateValue('')
  }, [content])

  // dateMenuOpenUp/addCandidateWrapRef:.dateMenu 預設往下展開(見 CSS
  // top: calc(100% + 6px)),但這張卡片本身可能出現在視窗下半部(例如
  // 點擊地圖上靠近視窗底部的地點),導致按鈕位置偏低、選單往下展開會被
  // 視窗邊界截斷或推出可視範圍外。addUiMode 切到 'menu' 時量測按鈕組
  // (.addCandidateWrap)相對視窗底部的剩餘空間,不夠容納選單估計高度時
  // 改成往上展開(dateMenuOpenUp=true,CSS 端對應切換 bottom 取代 top,
  // 見 GeoInfoPanel.module.css 的 .dateMenuOpenUp)。用 getBoundingClientRect
  // 量測而非 CSS-only 方案(如 @supports position-try),因為選單項目數
  // 隨 scheduledDates 長度變動、實際高度無法只靠 CSS 預先得知。
  const addCandidateWrapRef = useRef<HTMLDivElement>(null)
  const [dateMenuOpenUp, setDateMenuOpenUp] = useState(false)
  useEffect(() => {
    if (addUiMode !== 'menu') return
    const wrap = addCandidateWrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    // 估計選單高度:每個選項約 30px(padding 7px*2 + 字高約 16px,見
    // .dateMenuItem)+ 一個固定的「其他日期」選項 + 選單自身 padding
    // (4px*2)+ 跟按鈕的間距(6px,見 CSS top: calc(100% + 6px))。用
    // 估計值而非實際渲染後量測,避免「先渲染量測、量完發現不夠再翻轉」
    // 這種會讓使用者看到選單先在錯誤位置閃一下的做法。
    const estimatedItemCount = (scheduledDates?.length ?? 0) + 1
    const estimatedMenuHeight = estimatedItemCount * 30 + 8 + 6
    setDateMenuOpenUp(spaceBelow < estimatedMenuHeight)
  }, [addUiMode, scheduledDates])

  // 點選單以外的地方收合:'menu' 展開時,在 document 上掛一個 mousedown
  // 監聽——點擊落在 addCandidateWrapRef(按鈕組 + 懸浮選單本身,見上方
  // ref 掛載處)之外就收回 'closed'。用 mousedown 而非 click,是為了
  // 在選單項目自己的 onClick(handlePickScheduledDate/切到 'calendar')
  // 觸發前就能正確判斷「這次點擊是不是點在選單內」,避免兩個事件的
  // 觸發順序打架;只在 addUiMode === 'menu' 時才掛監聽、離開時立刻
  // 移除,'calendar' 模式不受影響(那個模式沒有懸浮選單、原地展開,
  // 也不需要點外部收合這個行為)。
  useEffect(() => {
    if (addUiMode !== 'menu') return
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

  const handleConfirmDate = () => {
    if (!candidate || !dateValue) return
    onSchedule?.(candidate, dateValue)
    setAddUiMode('closed')
    setDateValue('')
  }

  return (
    <div className={`${styles.panel}${shiftLeft ? ` ${styles.shifted}` : ''}`}>
      <div className={styles.head}>
        <span className={styles.title}>地點介紹</span>
        <button type="button" className={styles.closeBtn} onClick={onClose} title="關閉">
          <X size={16} strokeWidth={2} />
        </button>
      </div>
      <div className={styles.body}>
        {content.photoUrl ? (
          <img className={styles.photo} src={content.photoUrl} alt={content.name} />
        ) : (
          <div className={styles.photoPlaceholder} />
        )}
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
                    加入 {tripName}
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
              </div>
              {/* 日期選擇 UI:候選沒有排定日期時,按下「加入 {tripName}」
                  (或從上方下拉選單點「其他日期」)原地展開,不彈跳窗——
                  樣式比照 GeoCandidateSidebar.tsx NoDateDayHead 的既有慣例
                  (單一 <input type="date"> + 一顆確定按鈕),讓兩處「補日期」
                  的互動語言一致。 */}
              {addUiMode === 'calendar' && (
                <div className={styles.dateEdit}>
                  <input
                    type="date"
                    className={styles.dateInput}
                    value={dateValue}
                    onChange={(e) => setDateValue(e.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    className={styles.dateConfirmBtn}
                    onClick={handleConfirmDate}
                    disabled={!dateValue}
                  >
                    確定
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

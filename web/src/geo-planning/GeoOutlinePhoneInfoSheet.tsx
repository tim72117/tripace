import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { GeoAttraction } from '../api'
import type { GeoInfoContent } from './GeoInfoPanel'
import { attractionBadges } from './geoInfoContent'
import { candidateHasScheduledDate, dayGroupLabel, type GeoCandidate } from './geoCandidateHelpers'
import { PhoneBottomSheet, PHONE_BOTTOM_SHEET_EXIT_MS } from '../components/PhoneBottomSheet'
import styles from './GeoOutlinePhoneInfoSheet.module.css'

// SHEET_SNAP_POINTS:三段式高度(vh,使用者明確要求「最小/中間/滿版」
// 三段吸附,見 components/PhoneBottomSheet.tsx 的 mode="snap" 說明,
// 共用容器泛化支援任意段數,不限兩段)——
// [0] 最小/收合狀態:只顯示標頭,見該值選擇理由(12 才能完整容納
//     .head 的實際內容:名稱可能到 2 行 + 副標 + badges 換行 + 拖曳
//     把手,原本用 8 太小導致標頭被裁切只剩一小條)。
// [1] 中間狀態:能看到圖片+標頭,簡介文字部分被截斷(卡片高度不夠完整
//     顯示,使用者可以再往上拉到 SHEET_SNAP_POINTS[2] 或靠 .body 的
//     overflow-y: auto 捲動看更多)。
// [2] 滿版/展開狀態:完整內容,理由與做法對齊
//     GeoOutlinePhoneListDrawer.tsx 的 SHEET_MAX_HEIGHT_VH(該檔案用
//     70vh,這裡維持原本的 90vh,資訊卡內容含圖片/簡介較長,需要更多
//     空間)。
const SHEET_SNAP_POINTS = [12, 50, 90]

// GeoOutlinePhoneInfoSheet:手機版規劃地圖資訊卡,從畫面下方滑入蓋住下
// 半部——桌面版對應的 GeoInfoPanel/AttractionInfoPanel 是絕對定位疊在
// 地圖右緣的浮動卡片,手機螢幕沒有那個空間,改用 bottom sheet(同 iOS/
// Material Design 地圖 App 的資訊卡呈現方式)。
//
// 外殼(backdrop/panel/dragHandle)與拖曳手勢改用共用容器
// components/PhoneBottomSheet.tsx(mode="snap"),對齊 GeoOutlinePhoneListDrawer.tsx
// 「整張卡片都能拖曳,不限頂部把手」的觸控區域(使用者明確要求),但
// 「拖曳到底」的語意跟地點清單不同,不是滑出畫面消失,而是收合成只剩
// head 標題列並保留在畫面上(使用者明確要求)——用 SHEET_SNAP_POINTS
// 兩段式吸附高度表達:
//  - 往下拖:吸附到索引 0(收合成標題列),卡片仍留在畫面上,不觸發
//    onClose。
//  - 收合狀態下往上拖:吸附到索引 1(展開回完整卡片)。
//  - 點 .closeBtn(X):不分展開/收合狀態,一律呼叫 onClose 真正關閉
//    (卡片從畫面消失,下次選新地點才再出現)。
// 卡片高度固定為 snap point 的值,不再支援「往上拖曳展開高度」,內容
// 過長時交給 body 的 overflow-y: auto 原生捲動——這是舊版「往上拖曳
// 展開卡片高度、到頂後接手捲動內容」複雜手勢邏輯的來源問題(使用者實測
// 回報拖到頂後完全沒反應,根因是同一個 touchmove 事件裡先 setState 改
// 高度、緊接著讀 DOM 量測捲動空間,state 更新的非同步特性導致讀到舊的
// 版面),改成固定高度後不再有這個問題。
//
// 第二階段新增候選籃相關按鈕與互動(第一階段唯讀瀏覽時特意拿掉,見舊版
// 註解)——「加入候選」按鈕行為對齊桌面版 GeoInfoPanel.tsx 的
// handleAddClick 分岔邏輯,但簡化掉「懸浮選單 vs 展開日曆」的位置量測
// (dateMenuOpenUp,桌面版是因為卡片可能出現在視窗下半部、選單需要
// 動態翻轉方向;這裡的 bottom sheet 本身已經是從下滑入、卡片內容本來就
// 會自然被 sheet 自己的 overflow-y: auto 捲動接住,不需要另外翻轉選單
// 方向)。三路分岔完全比照桌面版:
//  1. 候選已有排定日期(candidateHasScheduledDate)→ 直接呼叫 onAddCandidate。
//  2. 候選沒有日期,但行程本身已有排定日期(scheduledDates 非空)→ 展開
//     既有日期的按鈕列(比照桌面版 .dateMenu,這裡改成常駐在卡片內的
//     一列 chips,不用懸浮選單——手機觸控對懸浮選單的點外部收合手勢
//     沒有滑鼠 mousedown 事件可用,原地展開更符合觸控慣例)。
//  3. 兩者都沒有 → 直接展開日期輸入(<input type="date">)。
//
// attraction 沒有候選籃入口(理由同桌面版:AttractionInfoPanel.tsx 沒有
// 加入候選按鈕,自建景點區域本身沒有座標點以外的入口,見該檔案說明)。
export function GeoOutlinePhoneInfoSheet({
  content,
  attraction,
  scheduledDates,
  onClose,
  onAddCandidate,
  onSchedule,
}: {
  content: GeoInfoContent | null
  attraction: GeoAttraction | null
  onClose: () => void
  // scheduledDates:行程本身目前已排定的日期清單,由呼叫端算好傳入——
  // 理由同桌面版 GeoInfoPanel.tsx 的同名 prop。使用者明確要求「加入行程」
  // 按鈕文字不用串上旅程名稱(原本是「加入 {tripName}」),故 tripName
  // prop 已移除,不再由呼叫端傳入。
  scheduledDates: string[]
  // onAddCandidate:候選已有排定日期時直接加入候選籃(純前端,不寫入
  // 後端)——理由同桌面版 GeoInfoPanel.tsx 的同名 prop。
  onAddCandidate?: (candidate: GeoCandidate) => void
  // onSchedule:候選沒有排定日期、選好日期按確定觸發——把候選跟選定的
  // 日期一起回報給呼叫端,由它決定怎麼寫入(理由同桌面版
  // GeoInfoPanel.tsx 的同名 prop)。
  onSchedule?: (candidate: GeoCandidate, date: string) => void
}) {
  // addUiMode:同桌面版 GeoInfoPanel.tsx 的同名 state,拿掉 'menu'
  // 對應的懸浮選單模式(見上方元件說明,改成常駐 chips,不需要獨立的
  // UI 模式區分「選單」跟「日曆」兩種展開形態,一律用 'open' 表示
  // 「展開了選日期的區塊」,區塊內部視 scheduledDates 是否非空決定要不要
  // 多顯示一排 chips)。
  const [addUiMode, setAddUiMode] = useState<'closed' | 'open'>('closed')
  const [dateValue, setDateValue] = useState('')
  // activeSnapIndex:卡片高度狀態,對應 SHEET_SNAP_POINTS 三段式索引
  // (0 = 最小/收合,1 = 中間,2 = 滿版/展開)——使用者明確要求卡片開啟
  // 時的初始狀態是中間(不是滿版),每次換一張新卡片(content/attraction
  // 變動)都重設回中間,不延續上一張卡片被拖曳到其他段的狀態(比照
  // addUiMode 同一個 useEffect 依賴)。
  const [activeSnapIndex, setActiveSnapIndex] = useState(1)
  useEffect(() => {
    setAddUiMode('closed')
    setDateValue('')
    setActiveSnapIndex(1)
  }, [content, attraction])

  const open = content != null || attraction != null

  if (!open) return null

  const name = attraction ? attraction.name : content!.name
  const photoUrl = attraction ? attraction.landmarkPhotoUrl : content!.photoUrl
  const subtitle = attraction
    ? attraction.landmarkName && attraction.landmarkName !== attraction.name
      ? attraction.landmarkName
      : undefined
    : content!.subtitle
  const summary = attraction ? attraction.summary : content!.summary
  const badges = attraction ? attractionBadges(attraction) : content!.badges
  const candidate = attraction ? undefined : content!.candidate

  // handleAddClick:「加入 {tripName}」按下時的分岔——理由同桌面版
  // GeoInfoPanel.tsx 的 handleAddClick,見上方元件說明。
  const handleAddClick = () => {
    if (!candidate) return
    if (candidateHasScheduledDate(candidate)) {
      onAddCandidate?.(candidate)
      return
    }
    setAddUiMode('open')
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

  // panelStyle 的 zIndex 36:比 PhoneTabBar.module.css 的 .bar
  // (z-index: 35)高一階,使用者明確要求資訊卡(不論展開或收合)要疊在
  // 底部常駐導覽列上面、蓋住它,不是讓開空間避開——維持 bottom: 0 貼齊
  // 螢幕最底,兩者本來就該重疊,只是疊放順序要反過來(資訊卡在上)。
  return (
    <PhoneBottomSheet
      open={open}
      onClose={onClose}
      mode="snap"
      snapPoints={SHEET_SNAP_POINTS}
      activeSnapIndex={activeSnapIndex}
      onSnapIndexChange={setActiveSnapIndex}
      panelStyle={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 36 }}
      backdropStyle={{ position: 'fixed', inset: 0, zIndex: 35, background: 'rgba(0, 0, 0, 0.32)' }}
      showBackdrop={false}
      exitDurationMs={PHONE_BOTTOM_SHEET_EXIT_MS}
      head={
        /* head:標頭區塊(名稱/副標/badges),使用者明確要求放在圖片
           上方——原本圖片在最上面、關閉按鈕疊在圖片右上角,改成標頭先
           顯示基本資訊,關閉按鈕跟著移到標頭這裡(見 .head 的說明)。
           candidate 存在時,「加入行程」也改成放在關閉按鈕左邊的純
           icon 按鈕(使用者明確要求),不再是圖片下方帶文字的按鈕——
           點下去展開的日期選擇區塊(既有日期 chips/日期輸入)不跟著
           移到這裡,標頭這排太窄放不下,維持顯示在下方 .content 裡
           (見該處 addUiMode === 'open' 分支)。 */
        <div className={styles.head}>
          <div className={styles.headText}>
            <h2 className={styles.name}>{name}</h2>
            {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
            {badges.length > 0 && (
              <div className={styles.metaRow}>
                {badges.map((b) => (
                  <span key={b} className={styles.badge}>{b}</span>
                ))}
              </div>
            )}
          </div>
          {candidate && (
            <button
              type="button"
              className={styles.addCandidateIconBtn}
              onClick={handleAddClick}
              title="加入行程"
              aria-label="加入行程"
            >
              <Plus size={16} strokeWidth={2} />
            </button>
          )}
          <button type="button" className={styles.closeBtn} onClick={onClose} title="關閉">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      }
    >
      {/* imageWrap:圖片左右留間距(見 .imageWrap 的說明),不再滿版貼齊
          卡片邊緣——使用者明確要求。 */}
      <div className={styles.imageWrap}>
        {photoUrl ? (
          <img className={styles.photo} src={photoUrl} alt={name} />
        ) : (
          <div className={styles.photoPlaceholder} />
        )}
      </div>
      <div className={styles.content}>
        {/* 日期選擇展開區塊:由標頭的加入行程 icon 按鈕觸發(見上方
            .head 的說明),不再包在 .addCandidateWrap 裡跟著按鈕本身
            移到標頭——這排區塊(既有日期 chips + 日期輸入)需要的寬度
            比標頭那排能容納的空間大,維持顯示在這裡。 */}
        {candidate && addUiMode === 'open' && (
          <div className={styles.dateEdit}>
            {scheduledDates.length > 0 && (
              <div className={styles.dateChips}>
                {scheduledDates.map((date) => (
                  <button
                    key={date}
                    type="button"
                    className={styles.dateChip}
                    onClick={() => handlePickScheduledDate(date)}
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
          </div>
        )}
        {summary ? (
          <p className={styles.summary}>{summary}</p>
        ) : (
          <p className={styles.summaryEmpty}>這個地點還沒有簡介資料。</p>
        )}
      </div>
    </PhoneBottomSheet>
  )
}

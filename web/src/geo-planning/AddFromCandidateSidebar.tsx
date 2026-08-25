import {
  type GeoCandidate, candidateEntryKind, candidateListKey, dayGroupLabel, entryKindIcon,
} from './GeoCandidateSidebar'
import { geoItemKey, type GeoSelectedKey } from './GeoHotelSidebar'
import { PanelHead } from '../PanelHead'
import styles from './AddFromCandidateSidebar.module.css'

// CandidateRow:單一候選項目的卡片——原本是 GeoCandidateSidebar.tsx 的
// 「候選中」清單卡片,搬到這裡是因為候選中清單本身已經搬進第二側欄
// (使用者明確要求「日程側欄不要顯示候選項目」)。樣式對齊候選籃「已排入
// 行程」分組底下的日層架卡片(DayEntryCard,見 GeoCandidateSidebar.tsx),
// 用 candidateEntryKind 推導出的圖示 + 名稱的緊湊橫列——分類資訊在候選
// ↔ entry 互相轉換時本來就要保留,乾脆讓兩種分組共用同一套視覺語言,
// 使用者在候選中跟已排入行程之間拖曳/切換時不會感覺是兩套完全不同的
// 卡片。
//
// onPick:點擊卡片本體(而非「×」)時觸發,直接把這個候選加入目前開啟
// 這個側欄的那一天(見呼叫端 DesktopLayout.tsx 的 handlePickFromCandidate)
// ——這裡刻意不是打開地點介紹欄(跟候選籃裡「候選中」卡片原本的點擊
// 行為不同,使用者明確要求「點卡片本體=直接加入這天,不開資訊欄」)。
// 卡片本體不能整張都是 <button>(HTML 不允許 button 巢狀 button),故
// 沿用「本體是可點擊的 <div role="button">,移除是卡片內獨立的
// <button>」這個既有模式。
function CandidateRow({
  c,
  onRemove,
  onPick,
  onHover,
  onDragStart,
  onDragEnd,
}: {
  c: GeoCandidate
  onRemove?: (candidate: GeoCandidate) => void
  onPick?: (candidate: GeoCandidate) => void
  onHover?: (key: GeoSelectedKey) => void
  // onDragStart/onDragEnd:拖曳把這張候選卡片放進候選籃(GeoCandidateSidebar)
  // 的日層架某一天——這是跨元件的拖曳(起點在第二側欄,放開目標在候選籃
  // 側欄的日期分組),draggingCandidate 由共同的父層(DesktopLayout.tsx)
  // 持有並往下傳給兩邊,見該檔案的說明。
  onDragStart?: (c: GeoCandidate) => void
  onDragEnd?: () => void
}) {
  return (
    <div
      className={styles.candidateCard}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        // 部分瀏覽器(尤其某些 Chrome 版本)在 dragstart 完全沒有呼叫
        // dataTransfer.setData(...) 時,會判定這次拖曳無效而立即中止——
        // 這裡不需要真的傳遞資料出去(接收端是同一個 React tree,用
        // draggingCandidate state 就能取得完整物件),純粹是為了讓瀏覽器
        // 認定這是一次合法的拖曳操作而補上最小可行的 setData 呼叫。
        e.dataTransfer.setData('text/plain', c.name)
        onDragStart?.(c)
      }}
      onDragEnd={() => onDragEnd?.()}
    >
      <div
        role="button"
        tabIndex={0}
        className={styles.candidateCardBody}
        onClick={() => onPick?.(c)}
        onKeyDown={(e) => { if (e.key === 'Enter') onPick?.(c) }}
        onMouseEnter={() => onHover?.(geoItemKey(c.kind, c))}
        onMouseLeave={() => onHover?.(null)}
      >
        <span className={styles.itemPin}>
          {(() => {
            const Icon = entryKindIcon(candidateEntryKind(c))
            return <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
          })()}
        </span>
        <span className={styles.itemName}>{c.name}</span>
      </div>
      <button
        type="button"
        className={styles.removeBtn}
        onClick={() => onRemove?.(c)}
        title="移除候選"
      >
        ×
      </button>
    </div>
  )
}

// AddFromCandidateSidebar:「第二側欄」——絕對定位疊在主顯示區(地圖)
// 左緣之上(見 DesktopLayout.tsx 的接線與 FloatingPanel.tsx),不佔用
// flex 版面空間、不推擠地圖——使用者明確要求漂浮在主顯示上方,不要壓縮
// 主顯示的可用寬度。
//
// 由候選籃(GeoCandidateSidebar)每個已排入行程日期分組標題列的「從候選
// 加入」按鈕觸發開啟。內容是候選中(hotel/place/inTrip===false 的
// entry)清單——這批候選原本顯示在候選籃側欄自己的「候選中」分組,已
// 依需求整個搬到這裡(使用者明確要求「日程側欄不要顯示候選項目」),
// 候選籃現在只顯示「已排入行程」。
//
// 保留候選中清單原本的部分互動:hover(同步地圖 marker 高亮)、「×」
// 移除、拖曳到候選籃側欄的日期分組建立成 entry——拖曳目標(日期分組
// .dayBody)仍畫在 GeoCandidateSidebar,故拖曳狀態(draggingCandidate)
// 提升到共同的父層 DesktopLayout.tsx 持有,兩個側欄各自是
// onDragStart/onDrop 事件的一端。點擊卡片本體則改為直接加入目前開啟
// 這個側欄的那一天(onPick),不是打開地點介紹欄(跟原本候選籃裡「候選
// 中」卡片的點擊行為不同,使用者明確要求)。點選一項不會自動關閉這一
// 欄——使用者明確要求可以連續加入多項,選取後會透過上游重新查詢
// tripEntries,從候選中清單移到「已排入行程」對應日期分組。
export function AddFromCandidateSidebar({
  dayLabel,
  candidates,
  onRemove,
  onPick,
  onHover,
  onDragStart,
  onDragEnd,
  onClose,
}: {
  dayLabel: string
  candidates: GeoCandidate[]
  onRemove?: (candidate: GeoCandidate) => void
  onPick?: (candidate: GeoCandidate) => void
  onHover?: (key: GeoSelectedKey) => void
  onDragStart?: (c: GeoCandidate) => void
  onDragEnd?: () => void
  onClose: () => void
}) {
  return (
    <aside className={styles.sidebar}>
      <PanelHead title={`從候選加入 · ${dayLabel}`} onClose={onClose} />
      <div className={styles.list}>
        {candidates.length === 0 ? (
          <div className={styles.empty}>候選籃目前是空的——先從左側清單「+」加入幾個候選,再回來這裡挑選。</div>
        ) : (
          candidates.map((c) => (
            <CandidateRow
              key={candidateListKey(c)}
              c={c}
              onRemove={onRemove}
              onPick={onPick}
              onHover={onHover}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))
        )}
      </div>
    </aside>
  )
}

// dayGroupLabel 重新匯出,方便呼叫端(DesktopLayout.tsx)不需要另外從
// GeoCandidateSidebar.tsx import 同一個函式——這個元件本來就依賴它組出
// dayLabel prop,呼叫端算 pickingDayKey 對應的顯示文字時剛好也需要同一份
// 邏輯,沒有理由讓兩處分別 import 兩次。
export { dayGroupLabel }

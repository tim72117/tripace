import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import styles from './DesktopInfoCard.module.css'

// DesktopInfoCard:桌面版浮動資訊卡共用外框(定位/避讓/關閉鍵/捲動
// 容器),PlacePanel/AttractionInfoPanel 的內容(照片/名稱/簡介/按鈕組)
// 透過 children 放進來——見 DesktopInfoCard.module.css 開頭對「為什麼
// 從各自獨立一份改成共用」的完整說明。這個元件不知道 content 的形狀,
// 純粹負責外框視覺與 shiftBy/style 這兩種定位輸入的套用邏輯。
//
// DESKTOP_INFO_CARD_WIDTH_PX/DESKTOP_INFO_CARD_BASE_RIGHT_PX:這個外框的
// 固定寬度與預設貼右緣距離(DesktopInfoCard.module.css 的 .panel width/
// right,見該檔案),獨立匯出成常數供呼叫端計算「並存疊放時第二張卡片
// 要貼齊多少 right」使用——第二張卡片要疊在第一張左側時,起算點是這張
// 卡片實際佔用的 right(預設情況下就是 BASE_RIGHT_PX,若呼叫端另外用
// shiftBy 往左推過,要以呼叫端自己算出的那個值為準,不是這裡的預設值)
// 加上這個寬度、再加上下面的 STACK_GAP_PX。呼叫端不需要另外複製這些
// 數字,CSS/間距若之後調整,這裡跟著改一處即可,不會有多處各自寫死的
// 數字彼此不同步——DESKTOP_INFO_CARD_STACK_GAP_PX 原本是
// DesktopLayout.tsx 自己散落的字面值(12px),沒有共用來源,這裡一併
// 收進來一起匯出,讓「兩張卡片並存疊放」這整組定位規則(寬度/基準/間距
// 三個數字)只有一個權威來源,不是寬度共用了、間距卻各自繼續各寫一份。
export const DESKTOP_INFO_CARD_WIDTH_PX = 340
export const DESKTOP_INFO_CARD_BASE_RIGHT_PX = 16
export const DESKTOP_INFO_CARD_STACK_GAP_PX = 12

// stackedInfoCardRightPx:多張 DesktopInfoCard 並存疊放時,某一張卡片
// 該貼齊的 right 值——用「順位陣列」取代舊有「nearbyInfoPanelRightPx
// 假設主題卡一定已開」那種針對特定卡片組合寫死的公式(見這個檔案改動
// 前的版本,與 DesktopLayout.tsx 對應公式的說明)。每一類卡片(主題卡/
// 並存地點卡/未來可能的第三類)固定分配一個順位數字(數字越小越靠右),
// 渲染時只看「目前哪些順位的卡片實際有出現」(presentOrders),把這張卡
// 前面(順位更小)實際存在的卡片數量算出來,乘上一張卡的佔用寬度
// (寬度+間距)就是這張卡要往左推多少——某張卡消失時,它後面的卡片
// 用同一份 presentOrders 重新計算就會自動往右滑補位,不需要為每種卡片
// 組合各自寫一條公式,也不需要任何卡片的存在與否依賴另一張卡的狀態。
//
// baseRightPx:預設 DESKTOP_INFO_CARD_BASE_RIGHT_PX,呼叫端若因為飯店
// 側欄/對話小匡等因素需要把整組卡片疊放再往左推(見 DesktopLayout.tsx
// infoPanelShiftBy 的說明),可傳入已經算好的起始 right 值取代預設值。
export function stackedInfoCardRightPx(
  order: number,
  presentOrders: ReadonlySet<number>,
  baseRightPx: number = DESKTOP_INFO_CARD_BASE_RIGHT_PX,
): number {
  let slotsBefore = 0
  for (const o of presentOrders) {
    if (o < order) slotsBefore += 1
  }
  return baseRightPx + slotsBefore * (DESKTOP_INFO_CARD_WIDTH_PX + DESKTOP_INFO_CARD_STACK_GAP_PX)
}

export function DesktopInfoCard({
  onClose,
  shiftBy,
  style,
  children,
}: {
  onClose: () => void
  // shiftBy/style:理由與既有用法完全同 PlacePanel.tsx 對應 prop 的
  // 說明——shiftBy 是呼叫端依飯店側欄/對話小匡是否佔用右緣算出的三段式
  // 固定值,style 是「附近景點/level4-5 地標」並存卡片需要的動態 right
  // 位移逃生艙,兩者理論上不會同時傳(呼叫端目前的用法各自只用其中一種),
  // 但同時傳入時 style 的 CSS 優先序高於 class,以 style 為準。
  shiftBy?: 'none' | 'hotel' | 'chat'
  style?: React.CSSProperties
  children: ReactNode
}) {
  const shiftClass = shiftBy === 'chat' ? ` ${styles.shiftedChat}` : shiftBy === 'hotel' ? ` ${styles.shiftedHotel}` : ''
  return (
    <div className={`${styles.panel}${shiftClass}`} style={style}>
      <button type="button" className={styles.closeBtn} onClick={onClose} title="關閉">
        <X size={16} strokeWidth={2} />
      </button>
      <div className={styles.body}>{children}</div>
    </div>
  )
}

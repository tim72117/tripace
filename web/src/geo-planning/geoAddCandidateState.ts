// geoAddCandidateState:管理 GeoOutlinePhoneInfoSheet.tsx「加入行程」按鈕
// 成功後短暫顯示打勾提示這段互動的純 reducer——比照
// geoListDrawerState.ts/geoCategoryTagsState.ts 的既有模式抽出。
//
// 背景(2026-08 日期選擇搬進獨立 bottom sheet 之前的舊形狀):原本這個
// reducer 是 { mode: 'closed' } | { mode: 'open'; dateValue: string } |
// { mode: 'added' } 三態——'open' 態表示「資訊卡內部展開了日期選擇區塊
// (既有日期 chips + <input type="date">)」,dateValue 是輸入框當下的值。
//
// 2026-08 這次改動把日期選擇 UI 整個搬出資訊卡,改成兩層獨立的 bottom
// sheet(日期清單 sheet GeoOutlinePhoneDatePickerSheet.tsx、日曆 sheet
// GeoOutlinePhoneDateCalendarSheet.tsx,由呼叫端 GeoOutlinePhoneView.tsx
// 透過 sheetStack 管理該不該顯示——見該檔案開頭 SheetEntry 型別的說明)。
// 資訊卡本身不再有「展開日期編輯區塊」這件事,'open' 態因此完全失去存在
// 意義:
//   - 「該不該顯示日期選擇 UI」現在百分之百由 sheetStack 決定(是否存在
//     {type:'date-picker'}/{type:'date-calendar'}),不再需要資訊卡自己
//     另外持有一份「展開中」的 UI 狀態去重複表達同一件事(這正是使用者
//     「開關 sheet 一律由堆疊控制,不能自己另外用一個 useState 管開關」
//     這條原則要避免的重複真相來源)。
//   - dateValue(<input type="date"> 的即時輸入值)搬進
//     GeoOutlinePhoneDateCalendarSheet.tsx 自己的 useState——那是純表單
//     輸入值,不是複合互動狀態,元件內部自己管即可,不需要透過這個共用
//     reducer 往上暴露給資訊卡持有。
//
// 因此這個 reducer 簡化成只剩 'closed'/'added' 兩態——'added' 這個「短暫
// 顯示打勾提示」的既有機制原封不動保留(使用者明確要求不能破壞這個既有
// 功能),不論加入行程的路徑是候選已有日期直接加入、或透過新的兩層 sheet
// 選定日期後加入,呼叫端都一律 dispatch 'added' 觸發同一份提示。
export type AddCandidateUiState =
  | { mode: 'closed' }
  | { mode: 'added' }

export const initialAddCandidateUiState: AddCandidateUiState = { mode: 'closed' }

// AddCandidateUiEvent 對應的實際觸發時機:
//   added   候選成功排入某個日期(不論是候選本身已有日期直接加入、點日期
//           清單 sheet 的既有日期 chip、或日曆 sheet 選好日期按確定)——
//           進入短暫的「已加入」提示狀態。三條路徑最終都會讓
//           GeoOutlinePhoneInfoSheet.tsx 的 addFlashTrigger prop 遞增,
//           由該檔案的 useEffect 統一 dispatch 這個事件(見該檔案的
//           說明)——不是三條路徑各自呼叫 dispatch,避免同一段「觸發打勾
//           提示」的邏輯散落多處。
//   reset   換一張新卡片(content/attraction 變動)、或 'added' 提示顯示
//           完畢的 setTimeout——回到初始狀態。
export type AddCandidateUiEvent =
  | { type: 'added' }
  | { type: 'reset' }

export function reduceAddCandidateUiState(
  state: AddCandidateUiState,
  event: AddCandidateUiEvent,
): AddCandidateUiState {
  switch (event.type) {
    case 'added':
      return { mode: 'added' }
    case 'reset':
      return { mode: 'closed' }
    default:
      return state
  }
}

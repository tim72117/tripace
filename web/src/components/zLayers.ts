// zLayers.ts——2026-10 新增(使用者明確要求「業界有什麼設計模式可以管理
// 這種有元件間的關聯性,而不是用設定 z 軸來做,會很不穩定」):把手機版
// bottom sheet 體系裡散落各處、靠裸數字比大小的 z-index 收斂成一組具名
// 常數,對齊業界常見的 z-index scale/token 做法(例如 Tailwind 的
// z-10/z-20/z-50 分級、Ant Design 的 zIndexPopupBase 等)——升降某個 sheet
// 跟功能列/其他 sheet 的疊放關係時,改的是「引用哪個具名常數」,不是去算一個
// 新數字跟誰比大小、也不用擔心改了一處會不會不小心跟另一處撞號或排序反了。
//
// 這裡解決的是「跟底部常駐功能列(PhoneTabBar.tsx)的相對疊放關係」這一層
// ——10 個 bottom sheet 裡,大多數(設定頁/對話/配速/行程清單/地點清單)是
// 各自獨立開關、彼此之間沒有嚴格的疊放順序要求,只需要知道「蓋過功能列」
// 或「被功能列蓋住」這兩種語意,共用同一個具名層級即可;只有
// geo-planning/useSheetStack.ts 管理的那三層(地點資訊卡/日期選單/日曆)
// 彼此之間有嚴格的疊放順序(後開啟的必須疊在先開啟的之上),這組關係延伸到
// useSheetStack.ts 自己內部處理(見該檔案的完整說明),不是這裡能表達的
// ——這裡只提供那個堆疊「整體」該從哪個 z-index 開始往上疊的起點
// (SHEET_STACK_BASE),堆疊內部每一層實際的偏移量由 useSheetStack 算。
//
// PhoneTabBar.module.css 的 .bar 本身的 z-index(目前是 35)不搬進這裡
// 用常數表達——那份 CSS 檔案跟這裡是不同語言(CSS vs TypeScript),硬要
// 共用需要額外的建置工具支援(例如 CSS Modules 的 :export,這個專案目前
// 沒有這套機制),這裡的 TAB_BAR 常數只是一份「給 TypeScript 讀者看」的
// 複製值,兩邊数值需要保持一致,見下方 TAB_BAR 的完整說明。
//
// 2026-10 補充(code review 發現的設計缺口修正):雖然 TypeScript 端
// 仍無法避免這份複製值,但「CSS 檔案之間彼此寫死數字各自為政」這一半
// 問題已經解決——PhoneTabBar.module.css 改成讀取
// components/zLayers.css 定義的 CSS 自訂屬性 var(--z-tab-bar),不再
// 自己寫死 35,往後 CSS 端若要調整這個層級,只需要改 zLayers.css 一處,
// 見該檔案的完整說明。
export const Z_LAYERS = {
  // BELOW_TAB_BAR_1/BELOW_TAB_BAR_2——這兩個 sheet 都甘願被底部功能列
  // 蓋住(例如使用者展開功能列「清單」/「時間軸」分頁時,不需要連功能列
  // 本身都蓋過去),但兩者之間仍有明確的相對順序——原始數值是
  // trip/PhoneTripsDrawer.tsx(旅程清單)用 33、timeline/PhoneTimelineDrawer.tsx
  // (時間軸)用 13,代表旅程清單原本就設計成疊在時間軸之上(兩者
  // open state 彼此獨立,理論上可能同時開啟,見 PhoneContent.tsx 的
  // tripsDrawerOpen/timelineDrawerOpen 說明),這裡保留這個相對順序、
  // 只是改成具名常數,不是把兩者合併成同一層級(合併會意外改變原本的
  // 疊放行為,不在這次「把裸數字換成具名常數」的範圍內)。
  BELOW_TAB_BAR_2: 13,
  BELOW_TAB_BAR_1: 33,
  // TAB_BAR——PhoneTabBar.module.css 的 .bar 本身(見上方完整說明,兩邊
  // 數值需要保持一致,目前都是 35)。這裡列出來純粹是給閱讀這份常數表的
  // 人一個完整的對照全貌,程式碼不會真的 import 這個值去設 PhoneTabBar
  // 自己的 z-index(那份 CSS 本來就寫死,不透過這裡)。
  TAB_BAR: 35,
  // ABOVE_TAB_BAR——這個 sheet 要蓋過底部功能列(使用者正在跟它互動的
  // 期間,功能列被完全蓋住比較不會讓使用者誤以為還能點功能列切換畫面)。
  // 對應設定頁/對話小匡/配速面板/geo-planning/PlanPhoneTripListDrawer.tsx
  // (行程清單)——這三個是各自獨立開關、不屬於 useSheetStack 管理的堆疊,
  // 彼此之間沒有嚴格的疊放順序要求(使用者操作流程上不會同時開啟兩個以上,
  // 見各自檔案的 open state 管理),共用同一個層級即可,不需要再往上細分。
  //
  // geo-planning/PlanPhoneListDrawer.tsx(地點清單)雖然語意上也是「蓋過
  // 功能列」,但它同時是 PLAN_SHEET_STACK 這組堆疊裡最底層的一員(見下方
  // 完整說明),直接共用 PLAN_SHEET_STACK.list 這個具名層級,不重複引用
  // ABOVE_TAB_BAR——兩者數值相同(都是 36)是刻意設計成同一個起點,不是
  // 巧合,但語意上「地點清單是堆疊的第一層」比「地點清單剛好蓋過功能列」
  // 更準確,用專屬常數表達這個語意差異。
  ABOVE_TAB_BAR: 36,
} as const

// PLAN_SHEET_STACK——geo-planning/PlanPhoneView.tsx 的「加入行程」流程
// 堆疊(地點清單 → 資訊卡 → 日期選單 → 日曆,最多四層同時存在,見該檔案
// SheetEntry 型別的完整說明)固定的疊放順序表。
//
// 這組疊放順序不是「依照 push 的時間先後動態算」——它是依 sheet 的
// **種類**(type)決定的固定深度:地點清單永遠是最底層、資訊卡永遠疊在
// 清單之上、日期選單再疊在資訊卡之上、日曆永遠疊在最上面,不論實際的
// push/replace 操作順序為何(例如使用者可能跳過清單直接從地圖點某個
// marker 開啟資訊卡,這時堆疊裡沒有 list 這一項,但 info 仍然固定對應
// 到這張表裡 list 的下一層,不會因為「這次 push 的順序不同」而讓 info
// 的 z-index 變成 36)。
//
// 這也是為什麼這張表直接用具名欄位(而非 useSheetStack 提供一個依
// stack.indexOf(entry) 動態算的輔助函式)——useSheetStack 本身是泛型
// hook,完全不知道呼叫端的 T 長什麼樣子、也不該知道「地點清單該疊在
// 資訊卡下面」這種屬於 geo-planning 這個領域的知識,這份對應表只適合
// 放在知道這些語意的呼叫端這一側維護。
export const PLAN_SHEET_STACK = {
  list: 36,
  info: 37,
  datePicker: 38,
  dateCalendar: 39,
} as const

// PLAN_SHEET_BACKDROP——地點資訊卡/日期選單/日曆這組堆疊各自的半透明
// 背景遮罩(backdropStyle 的 zIndex,見各檔案對應的完整說明)固定比
// PLAN_SHEET_STACK 裡任何一層都低一階,確保遮罩永遠在這組堆疊面板本身
// 之下、但仍然蓋過功能列與其他不相關的 ABOVE_TAB_BAR 層級內容(三個
// 檔案原本各自寫死 35,跟 TAB_BAR 同值是巧合,不是刻意設計成跟功能列
// 同一層——這裡收斂成獨立常數,語意上更清楚是「這組堆疊的背景」,不是
// 「功能列本身」)。
export const PLAN_SHEET_BACKDROP = 35

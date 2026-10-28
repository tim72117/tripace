// tripEntryTools — 行程條目(TripEntry)的共用型別。
//
// 原本 trip_entry_* 系列工具(web/src/clienttools/tools/ 底下)與其轉型
// helper(asString/asNonNegativeInt)、TripBatches 型別,隨 ChatScreen 一併
// 移除;目前只剩 api.ts 引用的 TripEntry 型別——不含任何 React/UI 依賴。

export type TripEntry = {
  id: string
  title: string
  date: string
  time: string
  note: string
}

// planAiDataSource.ts — 資料存取層介面的原路徑。介面與型別已搬到 plan-core/dataSource.ts(plan-core 不該反向依賴展示頁目錄,
// 見該檔案開頭的說明),這裡只重新匯出,讓既有的 import 路徑不必全部改動。新程式碼請直接從 plan-core/dataSource 引用。
export * from '../../plan-core/dataSource'

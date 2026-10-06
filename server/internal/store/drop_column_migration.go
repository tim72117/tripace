package store

// drop_column_migration.go 專供 cmd/migrate-drop-photo-url
// (一次性維運工具,見該指令開頭的完整說明)使用——這幾個相容欄位已經
// 從對應的 Go struct 定義移除,但 GORM AutoMigrate 只會新增缺少的欄位,
// 不會主動刪除資料庫裡已經不再對應任何 struct 欄位的舊欄位——這裡提供
// 的方法讓那支工具能安全地檢查欄位是否還存在、並真正執行 DROP COLUMN,
// 不需要在 cmd/ 底下直接操作底層 *sql.DB 或拼接原始 SQL 字串,維持
// 「store 套件封裝所有資料庫存取細節」的既有慣例。
//
// 涵蓋的欄位:
//   - attractions.photo_url(見 model.Attraction 的完整說明:人工建檔
//     當下自動查 Pexels 補一張示意圖、或使用者手動帶入的相容欄位,
//     主題卡現在一律透過 PlaceID 走漸進補圖機制取得照片)。
//   - place_details_cache.new_photo_count/google_photo_target_count
//     (見 placeDetailsCacheRow 的完整說明:舊版漸進補圖機制靠這兩個
//     計數器決定要不要補圖,但「已補張數追上目標值」後即使 photo_assets
//     裡的照片已經過期也永遠不會重新觸發,新機制改成直接查
//     photo_assets 的新鮮度狀態,不再需要這兩個計數器)。

// HasColumn 回報 table(資料庫實際的表名字串,例如 "attractions")目前
// 是否還有 column 欄位——底層透過 GORM Migrator().HasColumn(對 Postgres
// 查 information_schema、對 SQLite 查 pragma table_info,見
// schema_check.go CheckSchema 用同一個 Migrator 介面查詢欄位的既有
// 慣例),不需要自己為不同資料庫各寫一套查詢。傳表名字串(而非對應的
// row struct 指標)是因為這個方法要給 cmd/ 底下的維運工具呼叫,呼叫端
// 不需要、也不該認識套件內部未匯出的 row struct 定義——GORM 的
// Migrator 本身就支援直接傳字串當 table 名(見 RunWithValue 的
// 實作),不需要額外包一層型別轉換。
func (s *Store) HasColumn(table, column string) bool {
	return s.db.Migrator().HasColumn(table, column)
}

// DropColumn 真正執行 ALTER TABLE table DROP COLUMN column——不可逆的
// schema 變更,呼叫端(cmd/migrate-drop-photo-url)應該先用 HasColumn
// 確認欄位仍存在、且已確認過 -dry-run 的輸出符合預期才呼叫這支方法。
// 這裡不自己重複呼叫 HasColumn 判斷是否該跳過——冪等性(欄位已經不
// 存在時安全 no-op)由呼叫端的流程保證,這支方法單純執行這一個動作,
// 保持職責單一。
func (s *Store) DropColumn(table, column string) error {
	return s.db.Migrator().DropColumn(table, column)
}

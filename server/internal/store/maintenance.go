package store

// maintenance.go 存放「一次性」資料庫維運操作，不屬於任何常規業務流程，
// 也不會被 Open()/AutoMigrate 呼叫。僅供 cmd/cli 的維運子命令手動觸發。

// legacyEntryColumns 是 entries 表已改名、目前 entryRow struct 上已不存在的舊欄位
// (item -> title, summary -> note)。用資料庫欄位名稱字串(不是 struct 欄位名)表示。
var legacyEntryColumns = []string{"item", "summary"}

// DropLegacyEntryColumns 移除 entries 表上已改名淘汰的舊欄位(item/summary)。
//
// 背景:entryRow 已從 Item/Summary 改名為 Title/Note(對應 column item/summary
// 改成 title/note)，但 AutoMigrate 只增不減，不會自動砍掉舊欄位，資料庫裡
// 可能還留著 item/summary 兩個死欄位。這個方法就是用來手動清掉它們。
//
// 冪等:呼叫前會先用 Migrator().HasColumn 檢查欄位是否存在，只有存在才刪除，
// 所以重複執行多次是安全的，不會因為欄位已經不在而報錯。
//
// 注意:DropColumn 的第二個參數是資料庫欄位名稱字串，不是 struct 欄位名。
// item/summary 已經不在目前的 entryRow 定義裡，但 GORM 的 Migrator().DropColumn
// 在 struct 上找不到對應欄位時，會直接把傳入的字串當作 DB column name 使用，
// 只靠 entryRow.TableName()(即 "entries")定位資料表，因此可以正常操作。
//
// 這是一次性維運指令，只能透過 cmd/cli 手動執行，不會出現在 Open()/AutoMigrate
// 或任何伺服器啟動流程裡。
func (s *Store) DropLegacyEntryColumns() (dropped []string, err error) {
	m := s.db.Migrator()
	for _, col := range legacyEntryColumns {
		if !m.HasColumn(&entryRow{}, col) {
			continue
		}
		if err := m.DropColumn(&entryRow{}, col); err != nil {
			return dropped, err
		}
		dropped = append(dropped, col)
	}
	return dropped, nil
}

// PurgeAllCliAuthSessions 清空 cli_auth_sessions 表的所有資料列。
//
// 背景（實際在正式站觀察到、修正過一次認知的過程，見下方）:
// cliAuthSessionRow.UserCode 加了 `not null` 標籤是後來（device code 流程
// 上線時）才有的（見 cliauth.go）。AutoMigrate 幫既有資料表新增這個欄位時，
// PostgreSQL 對「在非空的表上新增一個沒有 DEFAULT 的 NOT NULL 欄位」的行為
// 是整個 ALTER TABLE ADD COLUMN 語句直接失敗、原子性回滾（錯誤訊息正是
// `column "user_code" ... contains null values`，SQLSTATE 23502）——不是
// 「先加成 nullable 欄位、裡面留了一些 NULL 值」，而是**欄位從頭到尾沒有被
// 建立過**。這裡曾經誤判成前者，寫過一版「刪除 user_code IS NULL 的列」
// 的實作，結果那個查詢本身就因為 user_code 欄位根本不存在而報
// `column "user_code" does not exist`（SQLSTATE 42703）——這正是為什麼同一個
// 根因會在正式站的錯誤訊息裡看起來像「先說欄位不存在，後來又說欄位有 NULL
// 值，現在又說欄位不存在」在兩種錯誤間循環:AutoMigrate 每次啟動都重新嘗試
// 同一個會失敗的 ADD COLUMN,失敗後欄位當然還是不存在。
//
// 修正後的做法:既然問題是「表非空」，不是「某些列的某個欄位是 NULL」，
// 就不能下任何引用 user_code 欄位的查詢條件（該欄位根本不存在，查詢會直接
// 報 42703），必須清空整張表——之後 AutoMigrate 的 ADD COLUMN ... NOT NULL
// 在空表上就能成功（PostgreSQL 允許在空表上新增沒有 DEFAULT 的 NOT NULL
// 欄位，因為沒有既有列會違反這個約束）。
//
// 安全性:cli_auth_sessions 本來就是短命的 pending 登入 session（cliAuthTTL
// 只有 10 分鐘，見本檔案上方常數），清空整張表最多只會讓使用者剛好在這幾秒
// 內、還沒完成核准的登入流程需要重新開始一次，不影響任何已登入的使用者或
// 其他資料。
//
// 冪等:表已空時刪 0 筆，重複執行安全。
//
// 這是一次性維運指令，只能透過 cmd/cli 手動執行，不會出現在 Open()/AutoMigrate
// 或任何伺服器啟動流程裡。
func (s *Store) PurgeAllCliAuthSessions() (deleted int64, err error) {
	res := s.db.Exec("DELETE FROM cli_auth_sessions")
	if res.Error != nil {
		return 0, res.Error
	}
	return res.RowsAffected, nil
}

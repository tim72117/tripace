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

// PurgeCliAuthSessionsMissingUserCode 刪除 cli_auth_sessions 表裡 user_code
// 為 NULL 的舊資料列。
//
// 背景:cliAuthSessionRow.UserCode 加了 `not null` 標籤是後來（device code 流程
// 上線時）才有的（見 cliauth.go）；AutoMigrate 幫既有的 user_code 欄位補上
// NOT NULL 約束前，資料庫裡可能還留著這個欄位上線前建立的舊 session——那些
// 列的 user_code 天生就是 NULL，讓 AutoMigrate 的 ALTER COLUMN ... SET NOT
// NULL 直接失敗（SQLSTATE 23502），使整個 AutoMigrate 中斷、後面排隊的表都
// 同步跟著沒套上（見 store.go Open() 對這個失敗模式的說明）。
//
// 安全性:目前程式碼裡，不管是 loopback 回呼流程（StartCliAuth）還是 device
// code 流程（StartDeviceAuth），都一定會生成 user_code（見
// startCliAuthSession），沒有任何路徑會建立 user_code 為 NULL 的合法 session
// ——換句話說，NULL 的列只可能是這個欄位存在之前留下的舊資料。而
// cli_auth_sessions 本來就是短命的 pending 登入 session（cliAuthTTL 只有 10
// 分鐘，見本檔案上方常數），這些舊列必然早已過期、沒有任何使用中的登入流程
// 會依賴它們，故直接整批刪除是安全的，不需要先個別檢查 expires_at。
//
// 冪等:沒有 NULL 列時刪 0 筆，重複執行安全。
//
// 這是一次性維運指令，只能透過 cmd/cli 手動執行，不會出現在 Open()/AutoMigrate
// 或任何伺服器啟動流程裡。
func (s *Store) PurgeCliAuthSessionsMissingUserCode() (deleted int64, err error) {
	res := s.db.Where("user_code IS NULL").Delete(&cliAuthSessionRow{})
	if res.Error != nil {
		return 0, res.Error
	}
	return res.RowsAffected, nil
}

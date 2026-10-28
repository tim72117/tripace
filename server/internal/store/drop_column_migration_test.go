package store

import "testing"

// drop_column_migration_test.go 驗證 cmd/migrate-drop-photo-url 依賴的四個
// 方法(HasColumn/DropColumn/HasTable/DropTable)。這支工具執行的是不可逆
// 的 schema 變更,至少要確認「存在判斷正確」「刪除後確實消失」「對已不存在
// 的對象重複呼叫安全」——工具的冪等性就建立在這幾點上。
//
// 用 scratch 表而不是真的 attractions/pexels_photo_cache,避免測試依賴正式
// schema 的演變(那些表/欄位正是這支工具要刪的)。

func TestHasTableDropTable(t *testing.T) {
	s := OpenTest(t)

	if s.HasTable("scratch_drop_table") {
		t.Fatal("建立前不該存在 scratch_drop_table")
	}
	if err := s.db.Exec("CREATE TABLE scratch_drop_table (id TEXT PRIMARY KEY)").Error; err != nil {
		t.Fatalf("建立 scratch 表: %v", err)
	}
	if !s.HasTable("scratch_drop_table") {
		t.Fatal("建立後 HasTable 應為 true")
	}

	if err := s.DropTable("scratch_drop_table"); err != nil {
		t.Fatalf("DropTable: %v", err)
	}
	if s.HasTable("scratch_drop_table") {
		t.Error("DropTable 後 HasTable 應為 false")
	}

	// 冪等:表已不存在時再呼叫不該報錯(DROP TABLE IF EXISTS)。
	if err := s.DropTable("scratch_drop_table"); err != nil {
		t.Errorf("對不存在的表重複 DropTable 不該報錯,得到: %v", err)
	}
}

func TestHasTable_ExistingStoreTablesUnaffected(t *testing.T) {
	// 刪除 scratch 表不能影響正式表:users 是 Open 時 AutoMigrate 建立的。
	s := OpenTest(t)
	if err := s.db.Exec("CREATE TABLE scratch_other (id TEXT PRIMARY KEY)").Error; err != nil {
		t.Fatalf("建立 scratch 表: %v", err)
	}
	if err := s.DropTable("scratch_other"); err != nil {
		t.Fatalf("DropTable: %v", err)
	}
	if !s.HasTable("users") {
		t.Error("DropTable 一個 scratch 表後,users 表不該消失")
	}
}

func TestHasColumn(t *testing.T) {
	s := OpenTest(t)

	if err := s.db.Exec("CREATE TABLE scratch_cols (id TEXT PRIMARY KEY, legacy TEXT)").Error; err != nil {
		t.Fatalf("建立 scratch 表: %v", err)
	}
	if !s.HasColumn("scratch_cols", "legacy") {
		t.Error("legacy 欄位建立後 HasColumn 應為 true")
	}
	if s.HasColumn("scratch_cols", "missing") {
		t.Error("不存在的欄位 HasColumn 應為 false")
	}
	if s.HasColumn("no_such_table", "legacy") {
		t.Error("不存在的表 HasColumn 應為 false")
	}
}

// 這裡刻意沒有測 DropColumn:測試環境用的是 SQLite(glebarez/sqlite),它的
// Migrator.DropColumn 會走 recreateTable,傳「字串表名」時沒有 model schema,
// 在 gorm 的 RunWithValue 內對 nil schema 呼叫 LookUpField 而 panic(實測)。
// 正式環境是 Postgres,走的是不同的 DropColumn 實作(2026-10 對本機 Postgres
// 實際刪除 public_links.view_mode 成功),所以這是測試環境限制,不是工具缺陷。
// DropColumn 的實際行為靠對 Postgres 的 -dry-run 與備份後執行來把關。

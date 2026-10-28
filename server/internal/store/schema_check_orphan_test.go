package store

import "testing"

// OrphanTables 的兩個測試:
//   - 全新資料庫(Open 已 AutoMigrate 所有正式表)不該有任何遺留表——這同時
//     鎖住 schemaCheckTargets 與 AutoMigrate 清單必須保持鏡像,漏列任何一張
//     正式表都會在這裡失敗,而不是在正式環境被誤報成遺留表。
//   - 手動建一張沒有 struct 的表,要被列為遺留表。

func TestOrphanTables_NoneAfterOpen(t *testing.T) {
	s := OpenTest(t)
	got, err := s.OrphanTables()
	if err != nil {
		t.Fatalf("OrphanTables: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("全新資料庫不該有遺留表,得到 %v(schemaCheckTargets 可能漏列了 AutoMigrate 的表)", got)
	}
}

func TestOrphanTables_DetectsTableWithoutStruct(t *testing.T) {
	s := OpenTest(t)
	if err := s.db.Exec("CREATE TABLE legacy_zzz (id TEXT PRIMARY KEY)").Error; err != nil {
		t.Fatalf("建立遺留表: %v", err)
	}
	if err := s.db.Exec("CREATE TABLE legacy_aaa (id TEXT PRIMARY KEY)").Error; err != nil {
		t.Fatalf("建立遺留表: %v", err)
	}
	got, err := s.OrphanTables()
	if err != nil {
		t.Fatalf("OrphanTables: %v", err)
	}
	if len(got) != 2 || got[0] != "legacy_aaa" || got[1] != "legacy_zzz" {
		t.Fatalf("應依序列出 legacy_aaa、legacy_zzz,得到 %v", got)
	}

	// DropTable 之後就不再是遺留表。
	if err := s.DropTable("legacy_aaa"); err != nil {
		t.Fatalf("DropTable: %v", err)
	}
	got, _ = s.OrphanTables()
	if len(got) != 1 || got[0] != "legacy_zzz" {
		t.Fatalf("DropTable 後應只剩 legacy_zzz,得到 %v", got)
	}
}

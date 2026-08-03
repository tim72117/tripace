package store

// maintenance.go 存放「一次性」資料庫維運操作，不屬於任何常規業務流程，
// 也不會被 Open()/AutoMigrate 呼叫。僅供 cmd/cli 的維運子命令手動觸發。
//
// 這裡的內容是會被清掉的:每支維運指令在正式站執行完、確認生效之後就該
// 移除,不需要永久留著(留著只會讓人以為還有什麼待辦的 schema 問題)。
// 已執行完畢並移除的有:DropLegacyEntryColumns(清 entries 表改名後殘留的
// item/summary 欄位)、PurgeAllCliAuthSessions(清空 cli_auth_sessions 表,
// 解除 AutoMigrate 加 NOT NULL 欄位失敗的問題)。

// DropTripGroupingObjects 移除「trip 歸組」機制留下的孤兒資料庫物件:
// entries.trip_id 欄位與整張 trips 表。
//
// 背景:trip 歸組(把 entries 依時間自動分組成一趟趟 trip)這套機制已整個
// 移除——移除當下才發現它其實早就是死碼:註冊 LLM 工具的 wanttools/trip
// package 從未被任何地方 import(靠 func init() 註冊,沒 import 就不會執行)、
// assistant_agent.go 的歸組 prompt 被標 //nolint:unused 從未進入 system
// prompt、CLI 的 delete-trip 打的路由 server 端從未註冊過。程式碼層面已在
// 同一次改動裡清乾淨,但 AutoMigrate 只增不減,資料庫裡的 trips 表與
// entries.trip_id 欄位不會自動消失,需要這支手動清理。
//
// 順序:先刪 entries.trip_id 再刪 trips 表。這兩者之間沒有真正的外鍵約束
// (GORM 標籤只有 index,沒有 foreign key),順序在技術上不影響結果,但照
// 「先斷引用、再刪被引用者」的順序寫比較不會讓之後讀這段的人困惑。
//
// 冪等:HasColumn/HasTable 檢查過才動手,重複執行安全。
//
// 注意:DropColumn 的第二個參數是資料庫欄位名稱字串,不是 struct 欄位名。
// trip_id 已經不在目前的 entryRow 定義裡,但 GORM 的 Migrator().DropColumn
// 在 struct 上找不到對應欄位時,會直接把傳入的字串當作 DB column name 使用,
// 只靠 entryRow.TableName()(即 "entries")定位資料表,因此可以正常操作。
// trips 表更是連 struct 都沒有了(tripRow 已刪),只能用表名字串操作。
//
// 這是一次性維運指令，只能透過 cmd/cli 手動執行，不會出現在 Open()/AutoMigrate
// 或任何伺服器啟動流程裡。
func (s *Store) DropTripGroupingObjects() (dropped []string, err error) {
	m := s.db.Migrator()
	if m.HasColumn(&entryRow{}, "trip_id") {
		if err := m.DropColumn(&entryRow{}, "trip_id"); err != nil {
			return dropped, err
		}
		dropped = append(dropped, "entries.trip_id")
	}
	if m.HasTable("trips") {
		if err := m.DropTable("trips"); err != nil {
			return dropped, err
		}
		dropped = append(dropped, "trips")
	}
	return dropped, nil
}

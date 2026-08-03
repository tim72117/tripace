package store

import "fmt"

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

// RenameChannelToTrip 把 channel→trip 改名這次程式碼重構對應的資料庫結構
// 變更真正落到資料庫上:channels 表改名成 trips,entries/members/public_links
// 三張表的 channel_id 欄位改名成 trip_id,並同步改掉相關索引名稱。
//
// 背景:這次改名(把「頻道」概念改叫「行程」,對齊介面文案早已使用的用語,
// 見 docs/TERMINOLOGY.md)是程式碼層面先行——model.Channel/channelRow 等
// Go 型別、tripsvc/api 的路由與 handler、CLI 都已經改成假設資料庫欄位叫
// trips/trip_id。
//
// 陷阱(實測踩過、務必留意):呼叫這支函式前,store.Open()一定已經跑過
// AutoMigrate(見 newDBClient()的呼叫順序),而 AutoMigrate 看到的是新的
// tripRow/entryRow(欄位已改名),所以它會在還沒真正 RENAME 之前,就搶先在
// 資料庫裡「另外建出」一張全新的空 trips 表、以及在 entries/members/
// public_links 上各自補一個全新的空 trip_id 欄位——這些都是 AutoMigrate
// 只增不減的正常行為,但會讓「trips 表已存在」「trip_id 欄位已存在」這種
// 存在性檢查在改名之前就先變成真,使得原本設計成「目標不存在才動手」的
// 判斷邏輯直接被跳過、實際的 RENAME 完全沒有執行,channels/channel_id 的
// 舊資料就這樣被晾在一邊,程式碼卻已經全部指向新名稱、完全讀不到舊資料。
//
// 故這裡的判斷邏輯反過來:不是看「目標是否存在」,而是看「舊表/舊欄位是否
// 還在」——只要 channels 表還在,就先把 AutoMigrate 搶建的那個空 trips 表
// 刪掉(反正是空的,沒有真實資料),再把 channels RENAME 成 trips;
// channel_id 欄位同理,先刪掉 AutoMigrate 補的空 trip_id 欄位,再把
// channel_id RENAME 成 trip_id。
//
// 順序:表格本身改名放最前面;其餘三張表各自獨立改名,順序不影響正確性。
//
// 索引:entries 的 idx_entries_channel_id、public_links 的
// idx_public_links_channel_id 這兩個索引名稱也一併改名,保持索引名稱與欄位
// 名稱一致,避免留下名不符實的索引造成日後排查困惑。members 表的複合主鍵
// members_pkey 不含欄位名稱本身,不需要改名。
//
// 冪等:每一步都先確認「舊物件是否還在」才動手,已經改名過的資料庫(舊表/
// 舊欄位已經不存在)重複執行不會出錯、也不會重複改名。
//
// 這是一次性維運指令,只能透過 cmd/cli 手動執行,不會出現在 Open()/AutoMigrate
// 或任何伺服器啟動流程裡。
func (s *Store) RenameChannelToTrip() (renamed []string, err error) {
	m := s.db.Migrator()

	if m.HasTable("channels") {
		// AutoMigrate 可能已經搶先建出一張空的 trips 表(見上方陷阱說明),
		// 必須先清掉才能真正 RENAME channels -> trips。
		if m.HasTable("trips") {
			var n int64
			if err := s.db.Table("trips").Count(&n).Error; err != nil {
				return renamed, fmt.Errorf("count trips before drop: %w", err)
			}
			if n > 0 {
				return renamed, fmt.Errorf("trips 表已存在且有 %d 筆資料,無法確認是 AutoMigrate 誤建的空表還是真實資料,為安全起見中止遷移", n)
			}
			if err := m.DropTable("trips"); err != nil {
				return renamed, fmt.Errorf("drop empty trips (AutoMigrate 搶建): %w", err)
			}
		}
		if err := m.RenameTable("channels", "trips"); err != nil {
			return renamed, fmt.Errorf("rename channels -> trips: %w", err)
		}
		renamed = append(renamed, "channels -> trips")
	}

	type colRename struct {
		table   string
		fromCol string
		toCol   string
	}
	for _, c := range []colRename{
		{"entries", "channel_id", "trip_id"},
		{"members", "channel_id", "trip_id"},
		{"public_links", "channel_id", "trip_id"},
	} {
		if !m.HasColumn(c.table, c.fromCol) {
			continue // 已經改名過(舊欄位不存在),冪等略過。
		}
		if m.HasColumn(c.table, c.toCol) {
			// 同上陷阱:AutoMigrate 可能已經搶先補了一個全新的空 trip_id
			// 欄位。這個欄位理論上全是 NULL(entries/members/public_links
			// 的 trip_id 都設了 not null 或有實際資料才會寫入,AutoMigrate
			// 新增欄位不會回填值),先確認真的是空的再刪除,不是真實資料
			// 被誤判。
			var n int64
			if err := s.db.Table(c.table).Where(c.toCol + " IS NOT NULL").Count(&n).Error; err != nil {
				return renamed, fmt.Errorf("count %s.%s before drop: %w", c.table, c.toCol, err)
			}
			if n > 0 {
				return renamed, fmt.Errorf("%s.%s 已存在且有 %d 筆非 NULL 資料,無法確認是 AutoMigrate 誤建的空欄位還是真實資料,為安全起見中止遷移", c.table, c.toCol, n)
			}
			if err := m.DropColumn(c.table, c.toCol); err != nil {
				return renamed, fmt.Errorf("drop empty %s.%s (AutoMigrate 搶建): %w", c.table, c.toCol, err)
			}
		}
		if err := s.db.Exec(fmt.Sprintf("ALTER TABLE %s RENAME COLUMN %s TO %s", c.table, c.fromCol, c.toCol)).Error; err != nil {
			return renamed, fmt.Errorf("rename %s.%s -> %s: %w", c.table, c.fromCol, c.toCol, err)
		}
		renamed = append(renamed, fmt.Sprintf("%s.%s -> %s.%s", c.table, c.fromCol, c.table, c.toCol))
	}

	type idxRename struct {
		table    string
		fromName string
		toName   string
	}
	for _, ix := range []idxRename{
		{"entries", "idx_entries_channel_id", "idx_entries_trip_id"},
		{"public_links", "idx_public_links_channel_id", "idx_public_links_trip_id"},
	} {
		if m.HasIndex(ix.table, ix.fromName) && !m.HasIndex(ix.table, ix.toName) {
			if err := m.RenameIndex(ix.table, ix.fromName, ix.toName); err != nil {
				return renamed, fmt.Errorf("rename index %s -> %s: %w", ix.fromName, ix.toName, err)
			}
			renamed = append(renamed, fmt.Sprintf("index %s -> %s", ix.fromName, ix.toName))
		}
	}

	return renamed, nil
}

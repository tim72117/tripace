package store

import "gorm.io/gorm"

// SchemaCheck 是單一資料表的 struct 定義 vs 實際資料庫欄位的比對結果——
// 供 adminconsole 的 schema-check 端點使用,讓管理員能主動發現「GORM
// AutoMigrate 沒有真的把 schema 套用成 struct 預期的樣子」這類問題。
//
// 觸發這個檢查介面的背景:AutoMigrate 只會新增缺少的欄位/索引,遇到
// 「欄位改名」或「改變主鍵」這類結構性變更時不會自動處理——它會在
// struct 上看到新欄位名稱,誤判成「這是一個全新的欄位」而新增一欄,
// 完全不會去刪除/重新命名資料庫裡原本的舊欄位,主鍵也維持原樣不變。
// 這種情況下 AutoMigrate 執行本身不會報錯(MissingColumns/舊欄位仍
// 存在都是合法狀態),Store.MigrationOK 也不會反映出這個問題——必須
// 額外比對「struct 預期的欄位/主鍵」與「資料庫實際的欄位/主鍵」才抓
// 得到,這正是這個檢查要補上的缺口。
type SchemaCheck struct {
	Table string `json:"table"`
	// MissingColumns:struct 定義了、但資料庫實際沒有這個欄位——通常代表
	// AutoMigrate 從未成功執行過,或執行時因型別衝突等原因失敗略過。
	MissingColumns []string `json:"missingColumns,omitempty"`
	// ExtraColumns:資料庫有這個欄位、但目前的 struct 定義已經沒有——
	// 常見成因是欄位改名(舊名字留在資料庫,新名字被當成新欄位加入),
	// 或該欄位已被棄用但資料庫端從未清理過。
	ExtraColumns []string `json:"extraColumns,omitempty"`
	// PrimaryKeyMismatch:struct 定義的主鍵欄位集合,與資料庫實際主鍵
	// 約束涵蓋的欄位集合不一致——AutoMigrate 完全不會修改既有資料表的
	// 主鍵,這是最容易被忽略、也最需要主動檢查才抓得到的一類問題。
	// 兩者相同時這個欄位是 nil。
	PrimaryKeyMismatch *primaryKeyMismatch `json:"primaryKeyMismatch,omitempty"`
	// Ok:MissingColumns、ExtraColumns 皆為空,且沒有 PrimaryKeyMismatch。
	Ok bool `json:"ok"`
}

type primaryKeyMismatch struct {
	Expected []string `json:"expected"`
	Actual   []string `json:"actual"`
}

// schemaCheckTargets 是 Open() 裡 AutoMigrate 清單的鏡像——刻意不共用
// 同一個 slice/常數,因為兩者的用途不同(一個是「套用 schema」,一個是
// 「檢查 schema」),硬要共用反而讓兩處都要遷就對方的簽章。新增/移除
// AutoMigrate 的表時,記得同步更新這裡,否則新表不會被這個檢查涵蓋到。
func schemaCheckTargets() []any {
	return []any{
		&userRow{}, &tripRow{}, &entryRow{}, &memberLink{}, &publicLinkRow{},
		&adminUserRow{}, &adminSessionRow{}, &cliAuthSessionRow{},
		&attractionRow{}, &photoCacheRow{}, &placeDetailsCacheRow{}, &pexelsPhotoCacheRow{},
		&apiRequestLogRow{}, &geoAPICallLogRow{},
	}
}

// CheckSchema 對 schemaCheckTargets 逐一比對 struct 定義與資料庫實際
// 欄位/主鍵,回傳每張表各自的檢查結果(依 AutoMigrate 清單的順序)。
// 單一表比對失敗(例如表整個不存在)不中斷其餘表的檢查,該表的錯誤
// 直接反映在回傳的 error 裡,由呼叫端決定如何呈現。
func (s *Store) CheckSchema() ([]SchemaCheck, error) {
	migrator := s.db.Migrator()
	out := make([]SchemaCheck, 0, len(schemaCheckTargets()))
	for _, dst := range schemaCheckTargets() {
		check, err := checkOneSchema(s.db, migrator, dst)
		if err != nil {
			return nil, err
		}
		out = append(out, check)
	}
	return out, nil
}

func checkOneSchema(db *gorm.DB, migrator gorm.Migrator, dst any) (SchemaCheck, error) {
	stmt := &gorm.Statement{DB: db}
	if err := stmt.Parse(dst); err != nil {
		return SchemaCheck{}, err
	}
	tableName := stmt.Schema.Table

	// expectedColumns/expectedPK:struct 定義「應該」長什麼樣子,直接從
	// GORM 已解析好的 schema.Schema 讀,不需要自己重新反射一次 struct tag。
	expectedColumns := make(map[string]bool, len(stmt.Schema.Fields))
	expectedPK := make([]string, 0, 2)
	for _, f := range stmt.Schema.Fields {
		if f.DBName == "" {
			continue
		}
		expectedColumns[f.DBName] = true
		if f.PrimaryKey {
			expectedPK = append(expectedPK, f.DBName)
		}
	}

	// actualColumns/actualPK:資料庫「實際」長什麼樣子,透過 GORM
	// Migrator 的 ColumnTypes 取得——這個介面底層各 driver(Postgres/
	// SQLite)都是查 information_schema/pragma table_info 這類系統目錄,
	// 不需要自己為兩種資料庫各寫一套查詢。
	columnTypes, err := migrator.ColumnTypes(dst)
	if err != nil {
		return SchemaCheck{}, err
	}
	actualColumns := make(map[string]bool, len(columnTypes))
	actualPK := make([]string, 0, 2)
	for _, ct := range columnTypes {
		actualColumns[ct.Name()] = true
		if isPK, ok := ct.PrimaryKey(); ok && isPK {
			actualPK = append(actualPK, ct.Name())
		}
	}

	check := SchemaCheck{Table: tableName}
	for col := range expectedColumns {
		if !actualColumns[col] {
			check.MissingColumns = append(check.MissingColumns, col)
		}
	}
	for col := range actualColumns {
		if !expectedColumns[col] {
			check.ExtraColumns = append(check.ExtraColumns, col)
		}
	}
	if !sameStringSet(expectedPK, actualPK) {
		check.PrimaryKeyMismatch = &primaryKeyMismatch{Expected: expectedPK, Actual: actualPK}
	}
	check.Ok = len(check.MissingColumns) == 0 && len(check.ExtraColumns) == 0 && check.PrimaryKeyMismatch == nil
	return check, nil
}

func sameStringSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	set := make(map[string]int, len(a))
	for _, s := range a {
		set[s]++
	}
	for _, s := range b {
		set[s]--
	}
	for _, n := range set {
		if n != 0 {
			return false
		}
	}
	return true
}

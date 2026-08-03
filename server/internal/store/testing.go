package store

// testing.go 提供給測試用的 store 建構 helper。
//
// 放在正式檔案(不是 _test.go)是因為 internal/api、internal/adminauth、
// internal/adminconsole 這些 package 的測試也需要它——Go 的 _test.go 只在
// 自己 package 內可見,跨 package 用不到。這裡沒有引入任何測試專用相依
// (testing 只出現在參數型別上),不會被連進正式 binary 的執行路徑。

import (
	"fmt"
	"sync/atomic"
	"testing"
)

// memDBCounter 供 OpenTest 產生互不重複的記憶體資料庫名稱。
var memDBCounter atomic.Uint64

// OpenTest 開一個「這次呼叫專屬」的 SQLite 記憶體資料庫,並在測試結束時關閉。
// 每次呼叫都是全新的空資料庫,彼此完全隔離。
//
// DSN 的形式是 file:<唯一名>?mode=memory&cache=shared,三個部分缺一不可:
//
//   - <唯一名>:SQLite 的記憶體資料庫以名稱識別。過去這些測試一律用
//     "file::memory:?cache=shared"(名稱為空),結果是整個測試程序裡的每次
//     Open 都連到同一個資料庫——前一個測試寫的資料會留給下一個測試看見。
//     實際踩到的症狀是第二個測試建立使用者時撞上 users.email 的 UNIQUE
//     限制。加上遞增序號後才真的是每個測試各自一份。
//
//   - mode=memory:指明這是記憶體資料庫而不是同名的磁碟檔案。
//
//   - cache=shared:必要,不能省。SQLite 的匿名/非共用記憶體資料庫是「每條
//     連線各一份」,而 database/sql 底下是連線池——GORM 隨時可能開第二條
//     連線,那條連線會拿到一個全新的空資料庫,查詢直接 no such table。
//     實測過:純 ":memory:" 在 50 次並發查詢下有 42 次失敗於
//     "no such table: users",序列查詢則剛好都復用同一條連線而看不出問題,
//     是典型的偶發性失敗。cache=shared 讓同名資料庫在連線間共用,才安全。
//
// 呼叫端不需要自己 Close,已註冊 t.Cleanup。
func OpenTest(t *testing.T) *Store {
	t.Helper()
	name := fmt.Sprintf("tripace_test_%d", memDBCounter.Add(1))
	s, err := Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", name))
	if err != nil {
		t.Fatalf("開啟測試用 store: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

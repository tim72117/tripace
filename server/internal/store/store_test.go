package store

import (
	"testing"
)

// newTestStore 用 SQLite 記憶體 DB 建一個乾淨的 store(毫秒級,免外部依賴)。
// 實作見 testing.go 的 OpenTest——每次呼叫都是一個獨立的空資料庫,測試之間
// 不會互相看見資料,也會自動在測試結束時關閉。
func newTestStore(t *testing.T) *Store {
	t.Helper()
	return OpenTest(t)
}

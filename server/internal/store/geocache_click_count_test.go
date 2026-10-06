package store

// geocache_click_count_test.go 測 IncrementPlaceClickCount——供
// server/internal/api/geo_outline.go 的 photoCapForClickCount/
// decidePlacePhotoRefreshIndex 判斷補圖節奏使用。用 newTestStore(見
// store_test.go/testing.go 的 OpenTest)開一個真的 SQLite 記憶體資料庫
// (走完整的 AutoMigrate),不是 mock DB——這樣才能驗證 SQL 陳述式本身
// (尤其是原子遞增)實際執行的結果是否正確。
//
// 2026-10:原本這裡還測 UpdatePlacePhotoProgress/
// ListPlaceDetailsWithZeroPhotoTarget 兩支函式與
// GooglePhotoTargetCount/NewPhotoCount 兩欄——舊版漸進補圖機制靠這兩個
// 計數器決定要不要補圖,新機制改成直接查 photo_assets 的新鮮度狀態,
// 這兩個計數器與配套函式已經一併移除(見 cmd/migrate-drop-photo-url
// 的完整說明),對應的測試也隨之刪除,不是遺漏。
import (
	"testing"
	"time"
)

func TestIncrementPlaceClickCount_MissingRowReturnsZeroNoError(t *testing.T) {
	s := newTestStore(t)

	clickCount, err := s.IncrementPlaceClickCount("place-not-yet-cached")
	if err != nil {
		t.Fatalf("IncrementPlaceClickCount() 對不存在的 place_id 應該回傳 nil error,got %v", err)
	}
	if clickCount != 0 {
		t.Fatalf("IncrementPlaceClickCount() 對不存在的 place_id 應回傳 0,got clickCount=%d", clickCount)
	}
}

func TestIncrementPlaceClickCount_IncrementsFromExistingRow(t *testing.T) {
	s := newTestStore(t)

	const placeID = "place-abc"
	if err := s.SetCachedPlaceDetails(placeID, "測試地點", "測試地址", 25.0, 121.5, 4.5, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails failed: %v", err)
	}

	clickCount, err := s.IncrementPlaceClickCount(placeID)
	if err != nil {
		t.Fatalf("IncrementPlaceClickCount failed: %v", err)
	}
	if clickCount != 1 {
		t.Errorf("第一次點擊後 clickCount = %d, want 1", clickCount)
	}

	clickCount, err = s.IncrementPlaceClickCount(placeID)
	if err != nil {
		t.Fatalf("IncrementPlaceClickCount (2nd) failed: %v", err)
	}
	if clickCount != 2 {
		t.Errorf("第二次點擊後 clickCount = %d, want 2", clickCount)
	}
}

func TestIncrementPlaceClickCount_ConcurrentIncrementsDoNotRace(t *testing.T) {
	s := newTestStore(t)

	const placeID = "place-concurrent"
	if err := s.SetCachedPlaceDetails(placeID, "併發測試地點", "地址", 1, 1, 0, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails failed: %v", err)
	}

	const n = 50
	done := make(chan error, n)
	for i := 0; i < n; i++ {
		go func() {
			_, err := s.IncrementPlaceClickCount(placeID)
			done <- err
		}()
	}
	for i := 0; i < n; i++ {
		if err := <-done; err != nil {
			t.Fatalf("併發 IncrementPlaceClickCount 發生錯誤: %v", err)
		}
	}

	row, ok, err := s.GetCachedPlaceDetails(placeID, 24*time.Hour) // 遠大於測試耗時
	if err != nil {
		t.Fatalf("GetCachedPlaceDetails failed: %v", err)
	}
	if !ok {
		t.Fatalf("GetCachedPlaceDetails 應該命中")
	}
	if row.ClickCount != n {
		t.Errorf("併發 %d 次遞增後 click_count = %d, want %d(SQL 端原子遞增,不應漏加)", n, row.ClickCount, n)
	}
}

// TestSetCachedPlaceDetails_RepeatedCallsPreserveClickCount 驗證
// SetCachedPlaceDetails 重複呼叫同一個 place_id(例如快取過期後文字
// 欄位被重新查詢)不會覆蓋掉既有的 click_count——這欄是補圖節奏機制
// 自己累積的獨立狀態,SetCachedPlaceDetails 的參數列完全不含這欄,不該
// 被它的呼叫意外歸零(原本用 db.Save(&row) 整列覆寫會踩到這個問題,見
// 該函式的完整說明)。
func TestSetCachedPlaceDetails_RepeatedCallsPreserveClickCount(t *testing.T) {
	s := newTestStore(t)
	const placeID = "place-repeat"
	if err := s.SetCachedPlaceDetails(placeID, "測試地點", "測試地址", 25.0, 121.5, 4.5, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails (initial) failed: %v", err)
	}

	if _, err := s.IncrementPlaceClickCount(placeID); err != nil {
		t.Fatalf("IncrementPlaceClickCount failed: %v", err)
	}

	// 之後 SetCachedPlaceDetails 又被呼叫一次(例如 24 小時文字快取過期
	// 重新查詢)——不該把上面累積的點擊次數洗掉。
	if err := s.SetCachedPlaceDetails(placeID, "測試地點(更新後)", "測試地址", 25.0, 121.5, 4.6, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails (repeat) failed: %v", err)
	}

	row, ok, err := s.GetCachedPlaceDetails(placeID, time.Hour)
	if err != nil {
		t.Fatalf("GetCachedPlaceDetails failed: %v", err)
	}
	if !ok {
		t.Fatal("expected cache hit")
	}
	if row.ClickCount != 1 {
		t.Fatalf("expected ClickCount to survive repeated SetCachedPlaceDetails, got %d", row.ClickCount)
	}
	// 文字欄位本身應該有真的更新到最新值。
	if row.Name != "測試地點(更新後)" {
		t.Fatalf("expected Name to be updated by repeated SetCachedPlaceDetails, got %q", row.Name)
	}
}

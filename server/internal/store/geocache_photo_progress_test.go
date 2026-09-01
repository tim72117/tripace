package store

// geocache_photo_progress_test.go 測 IncrementPlaceClickCount/
// UpdatePlacePhotoProgress——兩支函式支援 handleGeoPlaceDetails 的「漸進
// 補圖」機制(見 server/internal/api/geo_outline.go 的
// shouldAddGooglePlacePhoto/resetPhotoProgressOnTargetChange 規格,以及
// placeDetailsCacheRow 裡 ClickCount/GooglePhotoTargetCount/NewPhotoCount
// 三欄的完整說明)。用 newTestStore(見 store_test.go/testing.go 的
// OpenTest)開一個真的 SQLite 記憶體資料庫(走完整的 AutoMigrate),不是
// mock DB——這樣才能驗證 SQL 陳述式本身(尤其是 IncrementPlaceClickCount
// 的原子遞增)實際執行的結果是否正確。
import (
	"testing"
	"time"
)

func TestIncrementPlaceClickCount_MissingRowReturnsZeroNoError(t *testing.T) {
	s := newTestStore(t)

	clickCount, newPhotoCount, googlePhotoTargetCount, err := s.IncrementPlaceClickCount("place-not-yet-cached")
	if err != nil {
		t.Fatalf("IncrementPlaceClickCount() 對不存在的 place_id 應該回傳 nil error,got %v", err)
	}
	if clickCount != 0 || newPhotoCount != 0 || googlePhotoTargetCount != 0 {
		t.Fatalf("IncrementPlaceClickCount() 對不存在的 place_id 應回傳全 0,got clickCount=%d newPhotoCount=%d googlePhotoTargetCount=%d",
			clickCount, newPhotoCount, googlePhotoTargetCount)
	}
}

func TestIncrementPlaceClickCount_IncrementsFromExistingRow(t *testing.T) {
	s := newTestStore(t)

	const placeID = "place-abc"
	if err := s.SetCachedPlaceDetails(placeID, "測試地點", "測試地址", 25.0, 121.5, 4.5, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails failed: %v", err)
	}

	// 第一次點擊:click_count 應該從 0 變成 1。
	clickCount, newPhotoCount, googlePhotoTargetCount, err := s.IncrementPlaceClickCount(placeID)
	if err != nil {
		t.Fatalf("IncrementPlaceClickCount failed: %v", err)
	}
	if clickCount != 1 {
		t.Errorf("第一次點擊後 clickCount = %d, want 1", clickCount)
	}
	if newPhotoCount != 0 || googlePhotoTargetCount != 0 {
		t.Errorf("SetCachedPlaceDetails 剛寫入時 newPhotoCount/googlePhotoTargetCount 應為 0,got %d/%d", newPhotoCount, googlePhotoTargetCount)
	}

	// 寫入補圖進度後,再次點擊應該原封不動帶回這兩欄、並繼續累加 click_count。
	if err := s.UpdatePlacePhotoProgress(placeID, 2, 5, false); err != nil {
		t.Fatalf("UpdatePlacePhotoProgress failed: %v", err)
	}
	clickCount, newPhotoCount, googlePhotoTargetCount, err = s.IncrementPlaceClickCount(placeID)
	if err != nil {
		t.Fatalf("IncrementPlaceClickCount (2nd) failed: %v", err)
	}
	if clickCount != 2 {
		t.Errorf("第二次點擊後 clickCount = %d, want 2", clickCount)
	}
	if newPhotoCount != 2 || googlePhotoTargetCount != 5 {
		t.Errorf("第二次點擊回傳的 newPhotoCount/googlePhotoTargetCount = %d/%d, want 2/5", newPhotoCount, googlePhotoTargetCount)
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
			_, _, _, err := s.IncrementPlaceClickCount(placeID)
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

func TestUpdatePlacePhotoProgress_OnlyUpdatesTargetFields(t *testing.T) {
	s := newTestStore(t)

	const placeID = "place-xyz"
	summary := "一段簡介"
	if err := s.SetCachedPlaceDetails(placeID, "原始名稱", "原始地址", 10, 20, 4.2, &summary); err != nil {
		t.Fatalf("SetCachedPlaceDetails failed: %v", err)
	}
	// 先累積幾次點擊,確保 click_count 非 0,才能驗證 UpdatePlacePhotoProgress
	// 不會把它清空成 0。
	for i := 0; i < 3; i++ {
		if _, _, _, err := s.IncrementPlaceClickCount(placeID); err != nil {
			t.Fatalf("IncrementPlaceClickCount failed: %v", err)
		}
	}

	if err := s.UpdatePlacePhotoProgress(placeID, 1, 4, false); err != nil {
		t.Fatalf("UpdatePlacePhotoProgress failed: %v", err)
	}

	row, ok, err := s.GetCachedPlaceDetails(placeID, 24*time.Hour)
	if err != nil {
		t.Fatalf("GetCachedPlaceDetails failed: %v", err)
	}
	if !ok {
		t.Fatalf("GetCachedPlaceDetails 應該命中")
	}
	if row.NewPhotoCount != 1 || row.GooglePhotoTargetCount != 4 {
		t.Errorf("NewPhotoCount/GooglePhotoTargetCount = %d/%d, want 1/4", row.NewPhotoCount, row.GooglePhotoTargetCount)
	}
	// 其他欄位不應被 UpdatePlacePhotoProgress 動到。
	if row.ClickCount != 3 {
		t.Errorf("UpdatePlacePhotoProgress 不應影響 click_count,got %d, want 3", row.ClickCount)
	}
	if row.Name != "原始名稱" || row.Address != "原始地址" {
		t.Errorf("UpdatePlacePhotoProgress 不應影響 name/address,got name=%q address=%q", row.Name, row.Address)
	}
	if row.Summary == nil || *row.Summary != "一段簡介" {
		t.Errorf("UpdatePlacePhotoProgress 不應影響 summary,got %v", row.Summary)
	}
}

// TestUpdatePlacePhotoProgress_TouchFetchedAtTrue 對應「有打過
// ListPlacePhotoRefs/GetPlaceDetails 跟 Google 確認過 target」的情境
// (不論最後有沒有真的觸發補圖下載)——見 UpdatePlacePhotoProgress 對
// touchFetchedAt 參數的完整說明:只要打過這次查詢,就該讓 fetched_at
// 重置成現在,讓「距離上次真正查過 Google 已經超過 7 天」這個時間觸發
// 條件重新從現在起算。
func TestUpdatePlacePhotoProgress_TouchFetchedAtTrue(t *testing.T) {
	s := newTestStore(t)

	const placeID = "place-touch-fetched-at"
	if err := s.SetCachedPlaceDetails(placeID, "原始名稱", "原始地址", 10, 20, 4.2, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails failed: %v", err)
	}

	before, ok, err := s.GetCachedPlaceDetails(placeID, 24*time.Hour)
	if err != nil || !ok {
		t.Fatalf("GetCachedPlaceDetails (before) failed: ok=%v err=%v", ok, err)
	}

	// 確保時間戳記有機會前進,避免測試機器時鐘精度太粗,前後兩次
	// fetched_at 剛好完全相同、無法區分是否真的被更新。
	time.Sleep(2 * time.Millisecond)

	if err := s.UpdatePlacePhotoProgress(placeID, 1, 4, true); err != nil {
		t.Fatalf("UpdatePlacePhotoProgress failed: %v", err)
	}

	after, ok, err := s.GetCachedPlaceDetails(placeID, 24*time.Hour)
	if err != nil || !ok {
		t.Fatalf("GetCachedPlaceDetails (after) failed: ok=%v err=%v", ok, err)
	}
	if !after.FetchedAt.After(before.FetchedAt) {
		t.Errorf("touchFetchedAt=true 時 fetched_at 應該被更新成現在,before=%v after=%v", before.FetchedAt, after.FetchedAt)
	}
}

// TestUpdatePlacePhotoProgress_TouchFetchedAtFalse 對應「查過 Google 但
// 沒有觸發補圖」以外的情況——即這次呼叫本身根本沒有打過任何 Google
// 查詢,fetched_at 不該被這支函式動到,維持原值不變(讓 7 天時間觸發
// 條件的計時基準保持原本的查詢時間點,不會因為單純寫入補圖進度就被
// 無故延後)。
func TestUpdatePlacePhotoProgress_TouchFetchedAtFalse(t *testing.T) {
	s := newTestStore(t)

	const placeID = "place-no-touch-fetched-at"
	if err := s.SetCachedPlaceDetails(placeID, "原始名稱", "原始地址", 10, 20, 4.2, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails failed: %v", err)
	}

	before, ok, err := s.GetCachedPlaceDetails(placeID, 24*time.Hour)
	if err != nil || !ok {
		t.Fatalf("GetCachedPlaceDetails (before) failed: ok=%v err=%v", ok, err)
	}

	time.Sleep(2 * time.Millisecond)

	if err := s.UpdatePlacePhotoProgress(placeID, 1, 4, false); err != nil {
		t.Fatalf("UpdatePlacePhotoProgress failed: %v", err)
	}

	after, ok, err := s.GetCachedPlaceDetails(placeID, 24*time.Hour)
	if err != nil || !ok {
		t.Fatalf("GetCachedPlaceDetails (after) failed: ok=%v err=%v", ok, err)
	}
	if !after.FetchedAt.Equal(before.FetchedAt) {
		t.Errorf("touchFetchedAt=false 時 fetched_at 不應被動到,before=%v after=%v", before.FetchedAt, after.FetchedAt)
	}
	if after.NewPhotoCount != 1 || after.GooglePhotoTargetCount != 4 {
		t.Errorf("touchFetchedAt=false 不影響 NewPhotoCount/GooglePhotoTargetCount 本身仍要正確寫入,got %d/%d, want 1/4",
			after.NewPhotoCount, after.GooglePhotoTargetCount)
	}
}

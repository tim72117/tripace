package store

import (
	"testing"
	"time"
)

// EnsureCachedPlaceDetailsRow:確保 place_details_cache 有這個 place_id 的一列,
// 但不覆蓋既有資料(2026-10)。
//
// 為什麼需要:AI 版 place-details-any 命中已建檔景點時要累加點擊數、判斷補圖,
// 這些都靠 place_details_cache 的那一列存在。原本用 SetCachedPlaceDetails
// (upsert)建列,每次請求都把 Google 存的地址/評分覆蓋成「城市名/0」,並把
// fetched_at 重設成現在,讓地圖版的 24 小時重查永遠不會發生。
//
// 新建出來的列內容是用建檔資料湊的,所以 fetched_at 設成 epoch(視為過期):
// 它只負責「列存在」,不能被當成 Google 的新鮮資料。

func TestEnsureCachedPlaceDetailsRow_Isolated_CreatesStaleRowWhenAbsent(t *testing.T) {
	s := OpenTest(t)
	summary := "建檔簡介"
	if err := s.EnsureCachedPlaceDetailsRow("p1", "建檔名稱", "台南", 23.1, 120.2, &summary); err != nil {
		t.Fatalf("EnsureCachedPlaceDetailsRow: %v", err)
	}

	row, ok, err := s.GetCachedPlaceDetails("p1", 999999*time.Hour)
	if err != nil || !ok {
		t.Fatalf("應建立一列: ok=%v err=%v", ok, err)
	}
	if row.Name != "建檔名稱" || row.Address != "台南" || row.Lat != 23.1 || row.Lng != 120.2 {
		t.Errorf("欄位不對: %+v", row)
	}
	if row.Summary == nil || *row.Summary != "建檔簡介" {
		t.Errorf("簡介不對: %v", row.Summary)
	}
	if time.Since(row.FetchedAt) < 365*24*time.Hour {
		t.Errorf("新建的湊合列必須標成過期(epoch),fetched_at=%v", row.FetchedAt)
	}
}

func TestEnsureCachedPlaceDetailsRow_Isolated_DoesNotOverwriteExistingRow(t *testing.T) {
	s := OpenTest(t)
	if err := s.SetCachedPlaceDetails("p1", "Google 名稱", "Google 地址", 1.1, 2.2, 4.6, nil); err != nil {
		t.Fatalf("SetCachedPlaceDetails: %v", err)
	}
	_, _ = s.IncrementPlaceClickCount("p1")
	before, _, _ := s.GetCachedPlaceDetails("p1", 999999*time.Hour)

	if err := s.EnsureCachedPlaceDetailsRow("p1", "建檔名稱", "台南", 9.9, 8.8, nil); err != nil {
		t.Fatalf("EnsureCachedPlaceDetailsRow: %v", err)
	}

	after, _, _ := s.GetCachedPlaceDetails("p1", 999999*time.Hour)
	if after.Name != before.Name || after.Address != before.Address || after.Lat != before.Lat ||
		after.Lng != before.Lng || after.Rating != before.Rating {
		t.Errorf("既有列不該被覆蓋:%+v → %+v", before, after)
	}
	if !after.FetchedAt.Equal(before.FetchedAt) {
		t.Errorf("fetched_at 不該被重設:%v → %v", before.FetchedAt, after.FetchedAt)
	}
	if after.ClickCount != before.ClickCount {
		t.Errorf("click_count 不該動:%d → %d", before.ClickCount, after.ClickCount)
	}
}

func TestEnsureCachedPlaceDetailsRow_Isolated_RowCanThenBeClicked(t *testing.T) {
	s := OpenTest(t)
	_ = s.EnsureCachedPlaceDetailsRow("p1", "名", "址", 1, 2, nil)
	n, err := s.IncrementPlaceClickCount("p1")
	if err != nil || n != 1 {
		t.Errorf("建好的列應能累加點擊數,n=%d err=%v", n, err)
	}
}

func TestEnsureCachedPlaceDetailsRow_Isolated_IsIdempotent(t *testing.T) {
	s := OpenTest(t)
	for i := 0; i < 3; i++ {
		if err := s.EnsureCachedPlaceDetailsRow("p1", "名", "址", 1, 2, nil); err != nil {
			t.Fatalf("第 %d 次: %v", i+1, err)
		}
	}
}

// 合併:湊合列 → 之後 Google 資料寫入 → 再 Ensure 不會把 Google 資料蓋回湊合內容。
func TestEnsureCachedPlaceDetailsRow_Combined_GoogleDataWinsOverStub(t *testing.T) {
	s := OpenTest(t)
	_ = s.EnsureCachedPlaceDetailsRow("p1", "建檔名稱", "台南", 1, 2, nil)
	_ = s.SetCachedPlaceDetails("p1", "Google 名稱", "Google 地址", 3, 4, 4.8, nil)
	_ = s.EnsureCachedPlaceDetailsRow("p1", "建檔名稱", "台南", 1, 2, nil)

	row, _, _ := s.GetCachedPlaceDetails("p1", 999999*time.Hour)
	if row.Name != "Google 名稱" || row.Rating != 4.8 || time.Since(row.FetchedAt) > time.Minute {
		t.Errorf("Google 資料應保留且是新鮮的: %+v", row)
	}
}

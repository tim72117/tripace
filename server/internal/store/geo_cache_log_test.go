package store

import (
	"testing"
	"time"
)

func TestGeoCacheStatsByPeriod(t *testing.T) {
	s := newTestStore(t)
	add := func(ts, cache, outcome string) {
		at, err := time.Parse(time.RFC3339, ts)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.db.Create(&geoCacheLogRow{Cache: cache, Outcome: outcome, Caller: "c", CreatedAt: at}).Error; err != nil {
			t.Fatal(err)
		}
	}
	// UTC 16:30 在 Asia/Taipei 是隔天 00:30。
	add("2026-10-19T16:30:00Z", "place_details", "hit")
	add("2026-10-20T01:00:00Z", "place_details", "hit")
	add("2026-10-20T01:05:00Z", "place_details", "miss")
	add("2026-10-20T01:06:00Z", "place_details", "shared")
	add("2026-10-20T01:07:00Z", "other_cache", "hit")   // 別的快取不算
	add("2026-10-21T20:00:00Z", "place_details", "hit") // 區間外

	taipei := time.FixedZone("UTC+8", 8*3600)
	from := time.Date(2026, 10, 20, 0, 0, 0, 0, taipei)
	to := time.Date(2026, 10, 22, 0, 0, 0, 0, taipei)

	got, err := s.GeoCacheStatsByPeriod("place_details", from, to, taipei, "day")
	if err != nil {
		t.Fatal(err)
	}
	want := []GeoCachePeriodBucket{
		{"2026-10-20", "hit", 2}, {"2026-10-20", "miss", 1}, {"2026-10-20", "shared", 1},
	}
	if len(got) != len(want) {
		t.Fatalf("got %+v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("第 %d 筆 = %+v,預期 %+v", i, got[i], want[i])
		}
	}
	if _, err := s.GeoCacheStatsByPeriod("place_details", from, to, taipei, "week"); err == nil {
		t.Fatal("不支援的 period 應回錯誤")
	}
}

func TestLogGeoCache(t *testing.T) {
	s := newTestStore(t)
	if err := s.LogGeoCache("place_details", "hit", "handlerA", "/p", "place1"); err != nil {
		t.Fatal(err)
	}
	var row geoCacheLogRow
	if err := s.db.First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Cache != "place_details" || row.Outcome != "hit" || row.Caller != "handlerA" || row.Path != "/p" || row.PlaceID != "place1" || row.CreatedAt.IsZero() {
		t.Fatalf("row = %+v", row)
	}
}

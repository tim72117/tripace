package store

import (
	"testing"
	"time"
)

func TestGeoAPICallStatsByPeriod(t *testing.T) {
	s := newTestStore(t)
	add := func(ts string, endpoint string, status int) {
		at, err := time.Parse(time.RFC3339, ts)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.db.Create(&geoAPICallLogRow{Endpoint: endpoint, Caller: "c", StatusCode: status, CreatedAt: at}).Error; err != nil {
			t.Fatal(err)
		}
	}
	// UTC 16:30 在 Asia/Taipei 已是隔天 00:30。
	add("2026-10-19T16:30:00Z", "places.get", 200)
	add("2026-10-20T01:00:00Z", "places.get", 429)
	add("2026-10-20T01:10:00Z", "places.photoMedia", 200)
	add("2026-10-21T20:00:00Z", "places.get", 200) // 區間外(台北 10/22)

	taipei := time.FixedZone("UTC+8", 8*3600)
	from := time.Date(2026, 10, 20, 0, 0, 0, 0, taipei)
	to := time.Date(2026, 10, 22, 0, 0, 0, 0, taipei)

	got, err := s.GeoAPICallStatsByPeriod(from, to, taipei, "day")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != (GeoAPIPeriodBucket{"2026-10-20", "places.get", 2, 1}) ||
		got[1] != (GeoAPIPeriodBucket{"2026-10-20", "places.photoMedia", 1, 0}) {
		t.Fatalf("day 分組不對(台北時區 10/20 應含 UTC 10/19 16:30): %+v", got)
	}

	hours, err := s.GeoAPICallStatsByPeriod(from, to, taipei, "hour")
	if err != nil {
		t.Fatal(err)
	}
	if len(hours) != 3 || hours[0].Bucket != "2026-10-20 00:00" || hours[1].Bucket != "2026-10-20 09:00" {
		t.Fatalf("hour 分組不對: %+v", hours)
	}

	if _, err := s.GeoAPICallStatsByPeriod(from, to, taipei, "week"); err == nil {
		t.Fatal("不支援的 period 應回錯誤")
	}
}

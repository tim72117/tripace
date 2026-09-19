package store

// geo_rate_limits_test.go 測 UpsertGeoRateLimit/ListGeoRateLimits/
// IncrementGeoRateLimitDailyUsage(見 geoRateLimitRow 與這三支方法的完整
// 說明)。用 newTestStore 開一個真的 SQLite 記憶體資料庫,不是 mock DB
// ——理由同 geocache_photo_progress_test.go 的說明,尤其
// IncrementGeoRateLimitDailyUsage 的換日歸零邏輯是純 SQL CASE 表達式,
// 必須實際跑過真正的 SQL engine 才能驗證正確性。
import "testing"

func TestUpsertGeoRateLimit_CreatesThenOverwrites(t *testing.T) {
	s := newTestStore(t)

	if err := s.UpsertGeoRateLimit("places.get", 10, 1, 0); err != nil {
		t.Fatalf("UpsertGeoRateLimit (create) failed: %v", err)
	}
	rows, err := s.ListGeoRateLimits()
	if err != nil {
		t.Fatalf("ListGeoRateLimits failed: %v", err)
	}
	if len(rows) != 1 || rows[0].WindowSec != 10 || rows[0].MaxCalls != 1 || rows[0].DailyMax != 0 {
		t.Fatalf("unexpected rows after create: %+v", rows)
	}

	// 第二次呼叫同一個 endpoint——應該覆蓋既有列,不是新增第二列。
	if err := s.UpsertGeoRateLimit("places.get", 20, 5, 100); err != nil {
		t.Fatalf("UpsertGeoRateLimit (overwrite) failed: %v", err)
	}
	rows, err = s.ListGeoRateLimits()
	if err != nil {
		t.Fatalf("ListGeoRateLimits failed: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected still exactly 1 row after overwrite, got %d", len(rows))
	}
	if rows[0].WindowSec != 20 || rows[0].MaxCalls != 5 || rows[0].DailyMax != 100 {
		t.Fatalf("overwrite did not take effect, got %+v", rows[0])
	}
}

func TestListGeoRateLimits_OrderedByEndpoint(t *testing.T) {
	s := newTestStore(t)

	if err := s.UpsertGeoRateLimit("places.photoMedia", 5, 1, 100); err != nil {
		t.Fatalf("UpsertGeoRateLimit failed: %v", err)
	}
	if err := s.UpsertGeoRateLimit("places.get", 10, 1, 0); err != nil {
		t.Fatalf("UpsertGeoRateLimit failed: %v", err)
	}

	rows, err := s.ListGeoRateLimits()
	if err != nil {
		t.Fatalf("ListGeoRateLimits failed: %v", err)
	}
	if len(rows) != 2 || rows[0].Endpoint != "places.get" || rows[1].Endpoint != "places.photoMedia" {
		t.Fatalf("expected alphabetical order [places.get, places.photoMedia], got %+v", rows)
	}
}

func TestIncrementGeoRateLimitDailyUsage_MissingRowReturnsNotOkNoError(t *testing.T) {
	s := newTestStore(t)

	usedToday, dailyMax, ok, err := s.IncrementGeoRateLimitDailyUsage("places.photoMedia", "2026-09-19")
	if err != nil {
		t.Fatalf("IncrementGeoRateLimitDailyUsage() 對不存在的 endpoint 應該回傳 nil error,got %v", err)
	}
	if ok {
		t.Fatal("IncrementGeoRateLimitDailyUsage() 對不存在的 endpoint 應回傳 ok=false")
	}
	if usedToday != 0 || dailyMax != 0 {
		t.Fatalf("expected zero values when not ok, got usedToday=%d dailyMax=%d", usedToday, dailyMax)
	}
}

func TestIncrementGeoRateLimitDailyUsage_IncrementsWithinSameDay(t *testing.T) {
	s := newTestStore(t)
	if err := s.UpsertGeoRateLimit("places.photoMedia", 5, 1, 100); err != nil {
		t.Fatalf("UpsertGeoRateLimit failed: %v", err)
	}

	for i := 1; i <= 3; i++ {
		usedToday, dailyMax, ok, err := s.IncrementGeoRateLimitDailyUsage("places.photoMedia", "2026-09-19")
		if err != nil {
			t.Fatalf("IncrementGeoRateLimitDailyUsage failed: %v", err)
		}
		if !ok {
			t.Fatalf("expected ok=true on call %d", i)
		}
		if usedToday != i {
			t.Fatalf("call %d: expected usedToday=%d, got %d", i, i, usedToday)
		}
		if dailyMax != 100 {
			t.Fatalf("call %d: expected dailyMax=100, got %d", i, dailyMax)
		}
	}
}

func TestIncrementGeoRateLimitDailyUsage_ResetsOnNewDay(t *testing.T) {
	s := newTestStore(t)
	if err := s.UpsertGeoRateLimit("places.photoMedia", 5, 1, 100); err != nil {
		t.Fatalf("UpsertGeoRateLimit failed: %v", err)
	}

	for i := 0; i < 5; i++ {
		if _, _, _, err := s.IncrementGeoRateLimitDailyUsage("places.photoMedia", "2026-09-19"); err != nil {
			t.Fatalf("IncrementGeoRateLimitDailyUsage failed: %v", err)
		}
	}

	// 換到隔天——應該重新從 1 開始計數,不是延續昨天的 5。
	usedToday, _, ok, err := s.IncrementGeoRateLimitDailyUsage("places.photoMedia", "2026-09-20")
	if err != nil {
		t.Fatalf("IncrementGeoRateLimitDailyUsage failed: %v", err)
	}
	if !ok {
		t.Fatal("expected ok=true")
	}
	if usedToday != 1 {
		t.Fatalf("expected usedToday to reset to 1 on new day, got %d", usedToday)
	}
}

func TestUpsertGeoRateLimit_DoesNotResetDailyUsage(t *testing.T) {
	s := newTestStore(t)
	if err := s.UpsertGeoRateLimit("places.photoMedia", 5, 1, 100); err != nil {
		t.Fatalf("UpsertGeoRateLimit failed: %v", err)
	}
	if _, _, _, err := s.IncrementGeoRateLimitDailyUsage("places.photoMedia", "2026-09-19"); err != nil {
		t.Fatalf("IncrementGeoRateLimitDailyUsage failed: %v", err)
	}

	// 後台管理介面調整 maxCalls/dailyMax——不應該連帶把今天已經用掉的
	// 用量歸零(見 UpsertGeoRateLimit 的完整說明)。
	if err := s.UpsertGeoRateLimit("places.photoMedia", 5, 2, 200); err != nil {
		t.Fatalf("UpsertGeoRateLimit (adjust) failed: %v", err)
	}

	rows, err := s.ListGeoRateLimits()
	if err != nil {
		t.Fatalf("ListGeoRateLimits failed: %v", err)
	}
	if len(rows) != 1 || rows[0].UsedToday != 1 || rows[0].UsedDay != "2026-09-19" {
		t.Fatalf("expected UsedToday/UsedDay to survive an unrelated Upsert, got %+v", rows[0])
	}
	if rows[0].MaxCalls != 2 || rows[0].DailyMax != 200 {
		t.Fatalf("expected MaxCalls/DailyMax to reflect the new values, got %+v", rows[0])
	}
}

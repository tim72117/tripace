package store

import "testing"

// TestMiyakoTrip 驗證使用者實測案例:三筆分散的「單點」事件
//   - 宮古島          2026-06-21
//   - 游泳            2026-06-29
//   - 宮古島換旅館     2026-07-03
//
// 三者皆為單點(無區間跨度)、日期彼此不重疊,且無區間事件當骨架,
// 故依 FindOrCreateTrip 的重疊判定(trip.Start <= eEnd && tEnd >= eStart),
// 彼此互不命中 → 預期各自新建 trip,不會歸成同一個「宮古島」行程。
func TestMiyakoTrip(t *testing.T) {
	s := newTestStore(t)
	ch := "ch_miyako"

	type rec struct {
		item, start string
	}
	// 依使用者給的時間順序(非日期順序)記錄,貼近實際輸入。
	inputs := []rec{
		{"宮古島", "2026-06-21"},
		{"宮古島換旅館", "2026-07-03"},
		{"游泳", "2026-06-29"},
	}

	tripOf := map[string]string{} // item -> tripID
	for _, in := range inputs {
		tid, err := s.FindOrCreateTrip(ch, in.start, "", in.item)
		if err != nil {
			t.Fatalf("%s: %v", in.item, err)
		}
		if tid == nil {
			t.Fatalf("%s(有日期)應產生 trip,卻得 nil", in.item)
		}
		tripOf[in.item] = *tid
		t.Logf("%-12s %s → trip=%s", in.item, in.start, *tid)
	}

	trips, err := s.ListTripsByChannel(ch)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	t.Logf("總共產生 %d 個 trip:", len(trips))
	for _, tr := range trips {
		t.Logf("  - %s 「%s」(%s ~ %s)", tr.ID, tr.Title, tr.Start, tr.End)
	}

	// 斷言:三筆分散單點事件 → 三個獨立 trip(不歸組)。
	if len(trips) != 3 {
		t.Fatalf("預期 3 個獨立 trip(分散單點不歸組),實際 %d 個", len(trips))
	}
	if tripOf["宮古島"] == tripOf["游泳"] {
		t.Errorf("宮古島(6/21)與游泳(6/29)不重疊,不應同一 trip")
	}
	if tripOf["宮古島"] == tripOf["宮古島換旅館"] {
		t.Errorf("宮古島(6/21)與換旅館(7/03)不重疊,不應同一 trip")
	}
}

// TestMiyakoTrip_WithSpan 對照組:若先記一筆「宮古島旅遊 6/21~7/05」的區間事件
// 當骨架,則游泳(6/29)、換旅館(7/03)會落在範圍內 → 全部歸入同一 trip。
// 證明要正確歸組成一趟行程,需要一個有跨度的區間事件框出範圍。
func TestMiyakoTrip_WithSpan(t *testing.T) {
	s := newTestStore(t)
	ch := "ch_miyako2"

	// 骨架:有跨度的區間事件。
	span, err := s.FindOrCreateTrip(ch, "2026-06-21", "2026-07-05", "宮古島旅遊")
	if err != nil || span == nil {
		t.Fatalf("span: %v / %v", err, deref(span))
	}

	for _, in := range []struct{ item, start string }{
		{"游泳", "2026-06-29"},
		{"宮古島換旅館", "2026-07-03"},
	} {
		tid, err := s.FindOrCreateTrip(ch, in.start, "", in.item)
		if err != nil {
			t.Fatalf("%s: %v", in.item, err)
		}
		if tid == nil || *tid != *span {
			t.Fatalf("%s(%s)落在宮古島旅遊範圍內,應歸入同 trip(%s),卻得 %s",
				in.item, in.start, *span, deref(tid))
		}
	}

	trips, _ := s.ListTripsByChannel(ch)
	if len(trips) != 1 {
		t.Fatalf("有區間骨架時應歸成 1 個 trip,卻有 %d 個", len(trips))
	}
	t.Logf("歸成單一行程: %s ~ %s", trips[0].Start, trips[0].End)
}

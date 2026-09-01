package api

// place_details_in_flight_test.go 驗證 Server.placeDetailsInFlight（見
// api.go 該欄位的完整說明）確實提供「丟棄」語意，取代原本 singleflight
// 的「合併」語意——同一時間對同一個 placeID 的並發呼叫，只有第一個
// 搶到執行權，其餘立即被告知「這次被丟棄」，不等待、不共享結果。
//
// 這裡直接測 tryClaimPlaceDetailsInFlight/releasePlaceDetailsInFlight
// 這兩個方法本身的搶佔/釋放邏輯，不透過完整的 handleGeoPlaceDetails
// （理由同原本的 place_details_singleflight_test.go：那支 handler 內部
// 寫死 geo.New(apiKey)，要測到 handler 層級需要額外的可注入 gateway，
// 這裡先驗證核心搶佔機制本身正確）。
import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestTryClaimPlaceDetailsInFlight_ConcurrentCallsOnlyOneClaims 發起多個
// 併發 goroutine，各自對同一個 placeID 呼叫 tryClaimPlaceDetailsInFlight，
// 斷言只有一個真正搶到（claimed=true），其餘全部立即拿到 false——這是
// 跟舊 singleflight 版本最本質的行為差異：舊版本所有呼叫最終都會拿到
// 同一份執行結果（合併），新版本只有一個呼叫端會真正執行，其餘應該
// 幾乎瞬間返回 false，不會被阻塞等待。
func TestTryClaimPlaceDetailsInFlight_ConcurrentCallsOnlyOneClaims(t *testing.T) {
	s := newTestServer(t)

	const placeID = "ChIJ_test_place_id"
	const concurrency = 20

	var claimedCount atomic.Int64
	var wg sync.WaitGroup
	returnedAt := make([]time.Time, concurrency)

	start := time.Now()
	wg.Add(concurrency)
	for i := range concurrency {
		go func(idx int) {
			defer wg.Done()
			if s.tryClaimPlaceDetailsInFlight(placeID) {
				claimedCount.Add(1)
				// 模擬真實查詢的耗時（打 Google/Pexels API 需要網路
				// 往返）——若沒有這個延遲，20 個 goroutine 可能在搶佔
				// 判斷之前就已經全部啟動完畢，退化成看不出「其餘 19 個
				// 應該立即返回、不等待這段耗時」的效果。搶到的這個
				// goroutine 負責在「執行完成」後才釋放標記，理由同
				// handleGeoPlaceDetails 的 defer 呼叫慣例。
				time.Sleep(50 * time.Millisecond)
				s.releasePlaceDetailsInFlight(placeID)
			}
			returnedAt[idx] = time.Now()
		}(i)
	}
	wg.Wait()

	if got := claimedCount.Load(); got != 1 {
		t.Fatalf("搶到執行權的 goroutine 數量 = %d, want 1（20 個併發呼叫應該只有 1 個搶到，其餘全部立即被丟棄）", got)
	}

	// 驗證「立即丟棄」而非「排隊等待」——沒搶到的 19 個 goroutine 理應
	// 幾乎瞬間返回（遠早於搶到那個 goroutine 睡滿 50ms 才釋放標記的
	// 時間點），這是跟舊 singleflight「等待第一個完成再拿結果」語意的
	// 核心差異：這裡驗證的是「沒搶到就不等」，不是「沒搶到但最終仍會
	// 拿到同一份結果」。取所有 goroutine 裡「最快返回」的那個時間點——
	// 至少要有 19 個 goroutine 沒搶到、立即返回，其中最快的那個理應
	// 遠早於 50ms（搶到者需要睡滿的時間），用這個最小值驗證「確實存在
	// 未被阻塞、立即丟棄的呼叫」，比逐一檢查每個 goroutine 更穩定
	// （不需要判斷哪一個是搶到者本身，避免誤判它的合理耗時）。
	fastest := returnedAt[0]
	for _, t2 := range returnedAt[1:] {
		if t2.Before(fastest) {
			fastest = t2
		}
	}
	const earlyReturnThreshold = 30 * time.Millisecond
	if elapsed := fastest.Sub(start); elapsed > earlyReturnThreshold {
		t.Errorf("最快返回的 goroutine 耗時 = %v, want < %v（應該有 goroutine 立即被丟棄、不等待搶到者的 50ms 處理時間）", elapsed, earlyReturnThreshold)
	}
}

// TestTryClaimPlaceDetailsInFlight_DifferentPlaceIDsClaimIndependently
// 驗證不同 placeID 之間不會互相阻塞或誤判——這是用 placeID 當 key 的
// 基本保證，確認搶佔邏輯沒有不小心讓所有地點的查詢都擠成同一組。
func TestTryClaimPlaceDetailsInFlight_DifferentPlaceIDsClaimIndependently(t *testing.T) {
	s := newTestServer(t)

	placeIDs := []string{"place-a", "place-b", "place-c"}
	for _, id := range placeIDs {
		if !s.tryClaimPlaceDetailsInFlight(id) {
			t.Errorf("placeID %q 應該能獨立搶到執行權，卻被拒絕", id)
		}
	}
	for _, id := range placeIDs {
		s.releasePlaceDetailsInFlight(id)
	}
}

// TestTryClaimPlaceDetailsInFlight_ReleaseAllowsSubsequentClaim 驗證
// release 之後，同一個 placeID 能被重新搶到——這確保「查詢完成後標記
// 正確清除」，不會讓某個 placeID 因為忘記釋放而永久卡住、之後所有請求
// 都被誤判為丟棄（見 releasePlaceDetailsInFlight 的完整說明：查詢失敗
// 也要釋放，這裡用循序呼叫驗證最基本的搶佔/釋放/再搶佔循環）。
func TestTryClaimPlaceDetailsInFlight_ReleaseAllowsSubsequentClaim(t *testing.T) {
	s := newTestServer(t)

	const placeID = "ChIJ_test_place_id"

	if !s.tryClaimPlaceDetailsInFlight(placeID) {
		t.Fatal("第一次搶佔應該成功")
	}
	if s.tryClaimPlaceDetailsInFlight(placeID) {
		t.Fatal("標記尚未釋放時，第二次搶佔應該失敗，卻成功了")
	}

	s.releasePlaceDetailsInFlight(placeID)

	if !s.tryClaimPlaceDetailsInFlight(placeID) {
		t.Fatal("釋放後應該能重新搶到，卻失敗")
	}
}

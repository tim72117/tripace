package apigateway

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestRateLimiter_AllowsUpToMaxCallsWithinWindow 驗證單一 key 在視窗內
// 恰好只能被放行 maxCalls 次，超過就一律拒絕——循序呼叫，先確認
// 最基本的計數行為正確，併發情境另見
// TestRateLimiter_ConcurrentCallsNeverExceedLimit。
func TestRateLimiter_AllowsUpToMaxCallsWithinWindow(t *testing.T) {
	rl := NewRateLimiter()
	rl.SetLimitForKey("k", time.Minute, 3)

	for i := 0; i < 3; i++ {
		if !rl.Allow("k") {
			t.Fatalf("第 %d 次呼叫應被放行，卻被拒絕", i+1)
		}
	}
	if rl.Allow("k") {
		t.Fatal("第 4 次呼叫應被拒絕（已超過視窗內上限 3 次），卻被放行")
	}
}

// TestRateLimiter_UnconfiguredKeyIsNeverLimited 驗證從未透過
// SetLimitForKey 設定過規則的 key 完全不受限——這是「只有明確設定過的
// key 才會被限流,其餘 key 一律直接放行」這個核心設計目標的直接驗證
// （見 RateLimiter 的完整說明,這是刻意的設計,不是「所有 key 共用一個
// 預設規則」）。
func TestRateLimiter_UnconfiguredKeyIsNeverLimited(t *testing.T) {
	rl := NewRateLimiter()
	rl.SetLimitForKey("places.get", time.Minute, 1)

	// "places.searchText" 從未被設定過限流規則,即使呼叫遠超過
	// "places.get" 的上限次數,也應該永遠放行。
	for i := 0; i < 50; i++ {
		if !rl.Allow("places.searchText") {
			t.Fatalf("未設定限流規則的 key 第 %d 次呼叫應被放行，卻被拒絕", i+1)
		}
	}
}

// TestRateLimiter_DifferentKeysHaveIndependentWindows 驗證不同 key 各自
// 獨立計數，某個 key 被打滿額度不會連帶影響其他 key——這是「依 endpoint
// 分開限流」這個核心設計目標的直接驗證。
func TestRateLimiter_DifferentKeysHaveIndependentWindows(t *testing.T) {
	rl := NewRateLimiter()
	rl.SetLimitForKey("places.get", time.Minute, 1)
	rl.SetLimitForKey("places.photoMedia", time.Minute, 1)

	if !rl.Allow("places.get") {
		t.Fatal("places.get 第 1 次呼叫應被放行")
	}
	if rl.Allow("places.get") {
		t.Fatal("places.get 第 2 次呼叫應被拒絕（已用滿額度）")
	}
	// 不同 key，即使 places.get 已經用滿，places.photoMedia 仍應該可以
	// 放行——證明兩者的視窗狀態完全獨立，不共用同一份計數。
	if !rl.Allow("places.photoMedia") {
		t.Fatal("places.photoMedia 第 1 次呼叫應被放行，不應受 places.get 用滿額度影響")
	}
}

// TestRateLimiter_KeysHaveIndependentWindowLengths 驗證不同 key 可以各自
// 設定不同的視窗長度（不只是上限次數不同）——對應「地點照片下載給更長的
// 視窗、地點資訊查詢給較短的視窗」這個實際使用情境（見
// geo.RateLimitConfig 的完整說明）。用可覆寫的 now 欄位模擬時間前進。
func TestRateLimiter_KeysHaveIndependentWindowLengths(t *testing.T) {
	rl := NewRateLimiter()
	rl.SetLimitForKey("places.get", 10*time.Second, 1)
	rl.SetLimitForKey("places.photoMedia", 10*time.Minute, 1)
	current := time.Unix(0, 0)
	rl.now = func() time.Time { return current }

	if !rl.Allow("places.get") || !rl.Allow("places.photoMedia") {
		t.Fatal("兩個 key 各自第 1 次呼叫都應被放行")
	}

	// 時間前進 30 秒——超過 places.get 的 10 秒視窗（應該重置並放行），
	// 但遠小於 places.photoMedia 的 10 分鐘視窗（應該仍在原視窗內，維持
	// 拒絕）。
	current = current.Add(30 * time.Second)
	if !rl.Allow("places.get") {
		t.Fatal("places.get 的 10 秒視窗應已過期，第 2 次呼叫應被放行，卻被拒絕")
	}
	if rl.Allow("places.photoMedia") {
		t.Fatal("places.photoMedia 的 10 分鐘視窗尚未過期，第 2 次呼叫應被拒絕，卻被放行")
	}
}

// TestRateLimiter_WindowResetsAfterExpiry 驗證視窗過期後計數會重置，
// 過期前用滿額度的 key，過期後應該能重新從頭計數——用可覆寫的 now
// 欄位模擬時間前進，不需要真的等待（同套件內部測試，可直接存取私有
// 欄位注入假時鐘，這是這個元件刻意設計成可測試的方式，見 RateLimiter
// 的完整說明）。
func TestRateLimiter_WindowResetsAfterExpiry(t *testing.T) {
	rl := NewRateLimiter()
	rl.SetLimitForKey("k", time.Minute, 1)
	current := time.Unix(0, 0)
	rl.now = func() time.Time { return current }

	if !rl.Allow("k") {
		t.Fatal("視窗內第 1 次呼叫應被放行")
	}
	if rl.Allow("k") {
		t.Fatal("視窗內第 2 次呼叫應被拒絕（已用滿額度）")
	}

	// 時間前進到超過視窗長度——視窗應該重置，這次呼叫視為新視窗的第一次。
	current = current.Add(time.Minute + time.Second)
	if !rl.Allow("k") {
		t.Fatal("視窗過期後應該重新計數，第 1 次呼叫應被放行，卻被拒絕")
	}
}

// TestRateLimiter_ConcurrentCallsNeverExceedLimit 是這個元件最關鍵的
// 併發正確性驗證：大量 goroutine 同時對同一個 key 呼叫 Allow，統計實際
// 被放行的次數必須精準等於上限，不多不少——若內部的視窗判斷/計數沒有
// 正確加鎖，併發下容易出現「超賣」（放行次數超過上限，多個 goroutine
// 同時讀到 count < max、都各自判定可以放行，實際遞增後總數超標）。
// 這是比循序呼叫更嚴格的正確性測試，用 -race 一併執行時還能額外抓出
// 潛在的資料競爭。
func TestRateLimiter_ConcurrentCallsNeverExceedLimit(t *testing.T) {
	const maxCalls = 10
	const concurrency = 100
	rl := NewRateLimiter()
	rl.SetLimitForKey("k", time.Minute, maxCalls)

	var allowedCount atomic.Int64
	var wg sync.WaitGroup
	wg.Add(concurrency)
	for i := 0; i < concurrency; i++ {
		go func() {
			defer wg.Done()
			if rl.Allow("k") {
				allowedCount.Add(1)
			}
		}()
	}
	wg.Wait()

	if got := allowedCount.Load(); got != maxCalls {
		t.Fatalf("100 個併發呼叫，實際放行次數 = %d, want %d（放行次數必須精準等於上限，不能超賣也不能少放）", got, maxCalls)
	}
}

// TestRateLimiter_ConcurrentCallsAcrossDifferentKeys 併發情境下驗證不同
// key 的獨立性——多個 goroutine 同時打兩個不同的 key，各自的放行次數
// 應該分別精準等於各自的上限，不會互相干擾（例如誤用同一把鎖卻共用同一
// 個計數器之類的實作錯誤，會讓兩個 key 的放行總數混在一起算）。
func TestRateLimiter_ConcurrentCallsAcrossDifferentKeys(t *testing.T) {
	rl := NewRateLimiter()
	rl.SetLimitForKey("places.get", time.Minute, 5)
	rl.SetLimitForKey("places.photoMedia", time.Minute, 3)

	var getAllowed, photoAllowed atomic.Int64
	var wg sync.WaitGroup
	const perKeyConcurrency = 50
	wg.Add(perKeyConcurrency * 2)
	for i := 0; i < perKeyConcurrency; i++ {
		go func() {
			defer wg.Done()
			if rl.Allow("places.get") {
				getAllowed.Add(1)
			}
		}()
		go func() {
			defer wg.Done()
			if rl.Allow("places.photoMedia") {
				photoAllowed.Add(1)
			}
		}()
	}
	wg.Wait()

	if got := getAllowed.Load(); got != 5 {
		t.Errorf("places.get 併發放行次數 = %d, want 5", got)
	}
	if got := photoAllowed.Load(); got != 3 {
		t.Errorf("places.photoMedia 併發放行次數 = %d, want 3", got)
	}
}

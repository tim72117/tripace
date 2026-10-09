package apigateway

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestRateLimiter_AllowsUpToMaxCallsWithinWindow 驗證單一 key 在視窗內
// 恰好只能被放行 maxCalls 次，超過就一律拒絕——循序、不間斷地快速連續
// 呼叫（不在呼叫之間插入任何等待），先確認最基本的計數行為正確，
// 併發情境另見 TestRateLimiter_ConcurrentCallsNeverExceedLimit。
//
// 2026-10 改用 cmd/server/main.go 裡 places.get 實際套用的視窗/次數
// （60 秒視窗、300 次上限）取代原本任意挑選的 3 次——讓這個測試案例
// 直接對應產品的真實配置：固定視窗計數器只看「視窗內已經放行幾次」，
// 不區分呼叫節奏是瞬間打完還是平均分散在整個視窗內（見 RateLimiter
// 檔頭對這個特性的完整說明），所以這裡用「不間斷連續呼叫 300 次」
// 驗證即可代表「60 秒內無論怎麼分佈打滿 300 次」這整類情境，不需要
// 真的讓測試耗時 60 秒、模擬「一秒一次」的節奏。
func TestRateLimiter_AllowsUpToMaxCallsWithinWindow(t *testing.T) {
	rl := NewRateLimiter()
	const window = 60 * time.Second
	const maxCalls = 300
	rl.SetLimitForKey("places.get", window, maxCalls)

	for i := 0; i < maxCalls; i++ {
		if !rl.Allow("places.get") {
			t.Fatalf("第 %d 次呼叫應被放行，卻被拒絕", i+1)
		}
	}
	if rl.Allow("places.get") {
		t.Fatalf("第 %d 次呼叫應被拒絕（已超過視窗內上限 %d 次），卻被放行", maxCalls+1, maxCalls)
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

// TestRateLimiter_SetLimitForKeyWithNonPositiveMaxCallsRemovesLimit 驗證
// 執行期用 maxCalls<=0 重新呼叫 SetLimitForKey 會真的移除這個 key 的
// 限流規則,退回未設定過的狀態(Allow 一律放行)——這是 2026-09 支援後台
// 執行期調整限流設定後新增的語意(見 SetLimitForKey 的完整說明:在只有
// 啟動時呼叫一次的舊假設下,maxCalls<=0「不寫入」與「移除」是等價的,
// 但執行期重設情境下兩者不同,必須驗證真的走到移除分支,而不是維持
// 先前已設定的規則不變)。
func TestRateLimiter_SetLimitForKeyWithNonPositiveMaxCallsRemovesLimit(t *testing.T) {
	rl := NewRateLimiter()
	rl.SetLimitForKey("k", time.Minute, 1)

	if !rl.Allow("k") {
		t.Fatal("第 1 次呼叫應被放行")
	}
	if rl.Allow("k") {
		t.Fatal("第 2 次呼叫應被拒絕（已超過視窗內上限 1 次），卻被放行")
	}

	rl.SetLimitForKey("k", time.Minute, 0)

	for i := 0; i < 10; i++ {
		if !rl.Allow("k") {
			t.Fatalf("移除限流規則後第 %d 次呼叫應被放行，卻被拒絕", i+1)
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
// TestRateLimiter_SweepRemovesIdleKeys 驗證 maybeSweepLocked 會把閒置
// 超過 idleWindowTTL 的 key 從 windows map 移除——閒置期間過後,這個 key
// 的視窗狀態消失,下一次 Allow 視為全新視窗重新計數(用滿額度後,中間
// 完全不呼叫、純粹讓時間前進超過 idleWindowTTL,之後第 1 次呼叫應被
// 放行,證明視窗狀態確實被清掉而非只是重置計數——跟
// TestRateLimiter_WindowResetsAfterExpiry 的差異是:這裡在閒置期間完全
// 沒有呼叫 Allow,純粹靠達到 sweepEveryNCalls 次數門檻時的被動清除,不是
// 視窗長度 limit.window 本身的自然過期判斷)。
func TestRateLimiter_SweepRemovesIdleKeys(t *testing.T) {
	rl := NewRateLimiter()
	rl.SetLimitForKey("k", time.Minute, 1)
	current := time.Unix(0, 0)
	rl.now = func() time.Time { return current }

	if !rl.Allow("k") {
		t.Fatal("第 1 次呼叫應被放行")
	}

	// 時間前進超過 idleWindowTTL(1 小時),讓 "k" 的視窗狀態變成
	// 「閒置」,但不呼叫 Allow(不能靠視窗自然過期判斷,見上方說明)。
	current = current.Add(idleWindowTTL + time.Minute)

	// 用其他呼叫把 sweepCounter 推到下一次 sweepEveryNCalls 的倍數,
	// 觸發一次掃描——這些呼叫用不同的、從未設定過限流規則的 key,
	// 不會影響 "k" 本身的視窗狀態。
	for i := 0; i < sweepEveryNCalls; i++ {
		rl.Allow("unrelated-key")
	}

	rl.mu.Lock()
	_, stillPresent := rl.windows["k"]
	rl.mu.Unlock()
	if stillPresent {
		t.Fatal("閒置超過 idleWindowTTL 後,\"k\" 的視窗狀態應該已被清除,卻仍存在")
	}
}

// TestRateLimiter_SweepDoesNotRemoveActiveKeyWithLongWindow 驗證當某個
// key 的視窗長度(limit.window)本身大於等於 idleWindowTTL 時,即使距離
// windowStart 已經超過 idleWindowTTL,只要還沒超過這個 key 自己的視窗
// 長度,maybeSweepLocked 不會把它當成閒置清除——這是子代理 code review
// 發現的問題(CONFIRMED-2):若只用固定的 idleWindowTTL 當門檻、不參照
// limit.window,會把一個視窗長度本身就很長、仍在計數中的活躍 key 誤判成
// 閒置並提早清除,等於讓它的限流在視窗走完前被重置歸零,變相繞過原本
// 設定的上限。
func TestRateLimiter_SweepDoesNotRemoveActiveKeyWithLongWindow(t *testing.T) {
	rl := NewRateLimiter()
	const longWindow = idleWindowTTL + time.Hour
	rl.SetLimitForKey("k", longWindow, 1)
	current := time.Unix(0, 0)
	rl.now = func() time.Time { return current }

	if !rl.Allow("k") {
		t.Fatal("第 1 次呼叫應被放行")
	}
	if rl.Allow("k") {
		t.Fatal("第 2 次呼叫應被拒絕(已用滿額度)")
	}

	// 時間前進超過 idleWindowTTL,但還沒超過 "k" 自己的視窗長度
	// (longWindow)——這個視窗仍在計數中,不該被當成閒置清除。
	current = current.Add(idleWindowTTL + time.Minute)
	for i := 0; i < sweepEveryNCalls; i++ {
		rl.Allow("unrelated-key")
	}

	// 若視窗狀態被誤刪,下一次呼叫會被當成全新視窗重新計數、重新放行;
	// 若清除邏輯正確參照了 limit.window,視窗仍在原本的額度耗盡狀態,
	// 這次呼叫應該仍被拒絕。
	if rl.Allow("k") {
		t.Fatal("視窗長度本身超過 idleWindowTTL 時,仍在原視窗內的 key 不應被誤判成閒置、提早清除並重新放行")
	}
}

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

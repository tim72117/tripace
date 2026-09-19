package apigateway

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

var errFakeDailyQuotaChecker = errors.New("fakeDailyQuotaChecker: simulated failure")

// fakeDoer 是測試用的 HTTPDoer 假實作——記錄每次呼叫的時間,不真的發送
// HTTP 請求,示範這個元件「可以 mock」的設計目標。
type fakeDoer struct {
	mu    sync.Mutex
	calls []time.Time
	// inFlight/maxInFlight 觀察同一時間有幾個呼叫正在執行,驗證併發數限制。
	inFlight    int32
	maxInFlight int32
}

func (d *fakeDoer) Do(req *http.Request) (*http.Response, error) {
	cur := atomic.AddInt32(&d.inFlight, 1)
	defer atomic.AddInt32(&d.inFlight, -1)
	for {
		max := atomic.LoadInt32(&d.maxInFlight)
		if cur <= max || atomic.CompareAndSwapInt32(&d.maxInFlight, max, cur) {
			break
		}
	}

	d.mu.Lock()
	d.calls = append(d.calls, time.Now())
	d.mu.Unlock()

	// 模擬一點點處理時間,讓併發測試有機會真的重疊執行。
	time.Sleep(5 * time.Millisecond)
	return &http.Response{StatusCode: http.StatusOK}, nil
}

// fakeDailyQuotaChecker 是測試用的 DailyQuotaChecker 假實作——用一個
// map 記錄每個 endpoint 目前允許的結果與要不要回傳 error,不真的連資料庫。
type fakeDailyQuotaChecker struct {
	allowed bool
	err     error
}

func (c *fakeDailyQuotaChecker) AllowDaily(endpoint string) (bool, error) {
	return c.allowed, c.err
}

func newTestRequest(t *testing.T) *http.Request {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, "http://example.invalid/", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	return req
}

func TestGateway_EnforcesMinInterval(t *testing.T) {
	doer := &fakeDoer{}
	gw := New(doer, Config{MaxConcurrency: 5, MinInterval: 30 * time.Millisecond}, nil)

	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if _, err := gw.Do(ctx, newTestRequest(t), "test.endpoint", "test.caller", "/test/path"); err != nil {
			t.Fatalf("Do #%d: %v", i, err)
		}
	}

	doer.mu.Lock()
	defer doer.mu.Unlock()
	if len(doer.calls) != 3 {
		t.Fatalf("expected 3 calls, got %d", len(doer.calls))
	}
	// 允許少量 timer 精度誤差(觀察到過幾百微秒的抖動)——這裡驗證的是
	// 「大致遵守間隔」而非計時器層級的絕對精確度,tolerance 給 2ms 緩衝。
	const tolerance = 2 * time.Millisecond
	for i := 1; i < len(doer.calls); i++ {
		gap := doer.calls[i].Sub(doer.calls[i-1])
		if gap < 30*time.Millisecond-tolerance {
			t.Errorf("call %d fired only %v after call %d, want >= ~30ms", i, gap, i-1)
		}
	}
}

func TestGateway_EnforcesMaxConcurrency(t *testing.T) {
	doer := &fakeDoer{}
	gw := New(doer, Config{MaxConcurrency: 2, MinInterval: 0}, nil)

	ctx := context.Background()
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := gw.Do(ctx, newTestRequest(t), "test.endpoint", "test.caller", "/test/path"); err != nil {
				t.Errorf("Do: %v", err)
			}
		}()
	}
	wg.Wait()

	if got := atomic.LoadInt32(&doer.maxInFlight); got > 2 {
		t.Errorf("observed max in-flight = %d, want <= 2", got)
	}
}

// mockLogger 驗證 CallLogger 這個記錄回呼確實有被呼叫、且帶對了
// endpoint/caller/path——這是「記錄打哪一個端點、對應的 api 路徑、
// 請求方是誰」需求的驗證。
type mockLogger struct {
	mu    sync.Mutex
	calls []loggedCall
}

type loggedCall struct {
	endpoint, caller, path string
	statusCode             int
}

func (m *mockLogger) LogCall(endpoint, caller, path string, statusCode int, _ int64, _ error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls = append(m.calls, loggedCall{endpoint, caller, path, statusCode})
}

func TestGateway_LogsEndpointCallerAndPath(t *testing.T) {
	doer := &fakeDoer{}
	logger := &mockLogger{}
	gw := New(doer, Config{MaxConcurrency: 1, MinInterval: 0}, logger)

	if _, err := gw.Do(context.Background(), newTestRequest(t), "places.searchNearby", "handleGeoAttractionsNearby", "/internal/geo/attractions/nearby"); err != nil {
		t.Fatalf("Do: %v", err)
	}

	// LogCall 是在獨立 goroutine 呼叫的(見 Gateway.Do 的說明),用短暫輪詢
	// 等待它完成,避免測試中出現不必要的固定 sleep。
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		logger.mu.Lock()
		n := len(logger.calls)
		logger.mu.Unlock()
		if n > 0 {
			break
		}
		time.Sleep(time.Millisecond)
	}

	logger.mu.Lock()
	defer logger.mu.Unlock()
	if len(logger.calls) != 1 {
		t.Fatalf("expected 1 logged call, got %d", len(logger.calls))
	}
	got := logger.calls[0]
	if got.endpoint != "places.searchNearby" || got.caller != "handleGeoAttractionsNearby" ||
		got.path != "/internal/geo/attractions/nearby" || got.statusCode != http.StatusOK {
		t.Errorf("unexpected logged call: %+v", got)
	}
}

// TestGateway_DailyQuotaCheckerRejectsWhenNotAllowed 驗證
// DailyQuotaChecker.AllowDaily 回傳 false 時,Gateway.Do 直接回傳
// ErrDailyQuotaExceeded,完全不送出任何 HTTP 請求(doer 沒有被呼叫)——
// 對稱 RateLimiter 拒絕時的既有行為。
func TestGateway_DailyQuotaCheckerRejectsWhenNotAllowed(t *testing.T) {
	doer := &fakeDoer{}
	checker := &fakeDailyQuotaChecker{allowed: false}
	gw := New(doer, Config{MaxConcurrency: 1, MinInterval: 0, DailyQuotaChecker: checker}, nil)

	_, err := gw.Do(context.Background(), newTestRequest(t), "places.photoMedia", "caller", "/path")
	if err != ErrDailyQuotaExceeded {
		t.Fatalf("expected ErrDailyQuotaExceeded, got %v", err)
	}

	doer.mu.Lock()
	n := len(doer.calls)
	doer.mu.Unlock()
	if n != 0 {
		t.Fatalf("expected doer.Do to never be called, got %d calls", n)
	}
}

// TestGateway_DailyQuotaCheckerAllowsWhenUnderLimit 驗證額度未超過時
// 正常放行、真的送出請求。
func TestGateway_DailyQuotaCheckerAllowsWhenUnderLimit(t *testing.T) {
	doer := &fakeDoer{}
	checker := &fakeDailyQuotaChecker{allowed: true}
	gw := New(doer, Config{MaxConcurrency: 1, MinInterval: 0, DailyQuotaChecker: checker}, nil)

	if _, err := gw.Do(context.Background(), newTestRequest(t), "places.photoMedia", "caller", "/path"); err != nil {
		t.Fatalf("Do: %v", err)
	}

	doer.mu.Lock()
	n := len(doer.calls)
	doer.mu.Unlock()
	if n != 1 {
		t.Fatalf("expected doer.Do to be called once, got %d calls", n)
	}
}

// TestGateway_DailyQuotaCheckerFailsOpenOnError 驗證 AllowDaily 回傳
// error 時採取 fail open 策略——不擋下這次呼叫(見 DailyQuotaChecker
// 的完整說明:底層資料庫暫時不可用不該連帶讓核心查詢功能整個中斷)。
func TestGateway_DailyQuotaCheckerFailsOpenOnError(t *testing.T) {
	doer := &fakeDoer{}
	checker := &fakeDailyQuotaChecker{allowed: false, err: errFakeDailyQuotaChecker}
	gw := New(doer, Config{MaxConcurrency: 1, MinInterval: 0, DailyQuotaChecker: checker}, nil)

	if _, err := gw.Do(context.Background(), newTestRequest(t), "places.photoMedia", "caller", "/path"); err != nil {
		t.Fatalf("Do: %v (expected fail-open, no error)", err)
	}

	doer.mu.Lock()
	n := len(doer.calls)
	doer.mu.Unlock()
	if n != 1 {
		t.Fatalf("expected doer.Do to be called once (fail open), got %d calls", n)
	}
}

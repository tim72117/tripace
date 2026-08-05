package apigateway

import (
	"context"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

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

	if _, err := gw.Do(context.Background(), newTestRequest(t), "places.searchNearby", "handleGeoDistrictsNearby", "/internal/geo/districts/nearby"); err != nil {
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
	if got.endpoint != "places.searchNearby" || got.caller != "handleGeoDistrictsNearby" ||
		got.path != "/internal/geo/districts/nearby" || got.statusCode != http.StatusOK {
		t.Errorf("unexpected logged call: %+v", got)
	}
}

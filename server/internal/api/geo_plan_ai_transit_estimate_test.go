package api

// geo_outline_public_transit_estimate_test.go 測
// GET /public/geo/transit-estimate(handlePublicGeoTransitEstimate)——
// 免登入版、兩點間交通方式/時間/距離的模擬預估,供 /plan-ai 的
// insertAttractionAfter 在插入第二個站點後自動查詢用(見該 handler 的
// 完整說明)。

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestHandlePublicGeoTransitEstimate_MissingParams_Returns400(t *testing.T) {
	s := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/public/geo/transit-estimate", nil)
	rec := httptest.NewRecorder()
	s.handlePublicGeoTransitEstimate(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing params, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

// TestHandlePublicGeoTransitEstimate_MissingParams_ReturnsImmediately 驗證
// 參數驗證失敗時立即回應,不會被下方故意加的延遲拖住——無效請求不該
// 陪著呼叫端等一段沒有意義的延遲(見 handlePublicGeoTransitEstimate
// 的完整說明)。
func TestHandlePublicGeoTransitEstimate_MissingParams_ReturnsImmediately(t *testing.T) {
	s := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/public/geo/transit-estimate", nil)
	rec := httptest.NewRecorder()

	start := time.Now()
	s.handlePublicGeoTransitEstimate(rec, req)
	elapsed := time.Since(start)

	if elapsed >= transitEstimateMinDelay {
		t.Fatalf("expected immediate response for invalid params, took %v (delay range is %v~%v)", elapsed, transitEstimateMinDelay, transitEstimateMaxDelay)
	}
}

// TestHandlePublicGeoTransitEstimate_ValidRequest_DelaysWithinExpectedRange
// 驗證使用者明確要求的「後端做一點延遲」確實生效:合法請求的回應時間
// 落在 transitEstimateMinDelay~transitEstimateMaxDelay 這個範圍內(留
// 一點寬容度給執行環境本身的排程延遲,不用卡死在精確邊界)。
func TestHandlePublicGeoTransitEstimate_ValidRequest_DelaysWithinExpectedRange(t *testing.T) {
	s := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/public/geo/transit-estimate?fromLat=23.0&fromLng=120.2&toLat=23.01&toLng=120.21", nil)
	rec := httptest.NewRecorder()

	start := time.Now()
	s.handlePublicGeoTransitEstimate(rec, req)
	elapsed := time.Since(start)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	if elapsed < transitEstimateMinDelay {
		t.Fatalf("expected response to take at least %v, took %v", transitEstimateMinDelay, elapsed)
	}
	// 上限給一點寬容度(+200ms),避免測試環境排程抖動導致 flaky——重點是
	// 驗證「確實有延遲」,不是精確卡死在 transitEstimateMaxDelay 這個
	// 邊界上。
	if maxAllowed := transitEstimateMaxDelay + 200*time.Millisecond; elapsed > maxAllowed {
		t.Fatalf("expected response within %v, took %v", maxAllowed, elapsed)
	}
}

// TestHandlePublicGeoTransitEstimate_ContextCanceled_ReturnsWithoutWaitingFullDelay
// 驗證延遲用 select 而非單純 time.Sleep(見 handlePublicGeoTransitEstimate
// 的完整說明)——請求的 context 被取消時應該立刻中止,不會讓 handler
// 白白等完整個延遲時間才返回。
func TestHandlePublicGeoTransitEstimate_ContextCanceled_ReturnsWithoutWaitingFullDelay(t *testing.T) {
	s := newTestServer(t)

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/public/geo/transit-estimate?fromLat=23.0&fromLng=120.2&toLat=23.01&toLng=120.21", nil).WithContext(ctx)
	rec := httptest.NewRecorder()

	go func() {
		time.Sleep(20 * time.Millisecond)
		cancel()
	}()

	start := time.Now()
	s.handlePublicGeoTransitEstimate(rec, req)
	elapsed := time.Since(start)

	if elapsed >= transitEstimateMinDelay {
		t.Fatalf("expected early return on context cancellation, took %v (delay range is %v~%v)", elapsed, transitEstimateMinDelay, transitEstimateMaxDelay)
	}
}

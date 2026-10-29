package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

// 假的 tripace server:exchange 依 status 回應,並計算被呼叫幾次
func fakeExchangeServer(t *testing.T, status int, calls *int32) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(calls, 1)
		if status != http.StatusOK {
			http.Error(w, `{"error":"expired"}`, status)
			return
		}
		_, _ = w.Write([]byte(`{"token":"tok-123"}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func callback(h http.HandlerFunc, query string) string {
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/callback"+query, nil))
	return rec.Body.String()
}

func TestLoginCallbackShowsRealResult(t *testing.T) {
	t.Run("換 token 成功才顯示登入完成", func(t *testing.T) {
		var calls int32
		srv := fakeExchangeServer(t, http.StatusOK, &calls)
		result := make(chan loginCallbackResult, 1)
		body := callback(loginCallbackHandler(&cliAuthClient{base: srv.URL}, result), "?code=abc")
		if !strings.Contains(body, "登入完成") {
			t.Fatalf("成功時頁面應顯示登入完成,得到:%s", body)
		}
		if r := <-result; r.err != nil || r.token != "tok-123" {
			t.Fatalf("result = %+v", r)
		}
	})
	t.Run("換 token 失敗時頁面不宣稱成功", func(t *testing.T) {
		var calls int32
		srv := fakeExchangeServer(t, http.StatusGone, &calls)
		result := make(chan loginCallbackResult, 1)
		body := callback(loginCallbackHandler(&cliAuthClient{base: srv.URL}, result), "?code=abc")
		if strings.Contains(body, "登入完成") || !strings.Contains(body, "登入未完成") {
			t.Fatalf("失敗時頁面應顯示登入未完成,得到:%s", body)
		}
		if r := <-result; r.err == nil {
			t.Fatal("result 應帶錯誤")
		}
	})
	t.Run("沒帶 code:不呼叫 server,頁面顯示未完成", func(t *testing.T) {
		var calls int32
		srv := fakeExchangeServer(t, http.StatusOK, &calls)
		result := make(chan loginCallbackResult, 1)
		body := callback(loginCallbackHandler(&cliAuthClient{base: srv.URL}, result), "")
		if !strings.Contains(body, "登入未完成") || atomic.LoadInt32(&calls) != 0 {
			t.Fatalf("calls=%d body=%s", calls, body)
		}
	})
	t.Run("同時多個重複請求:只換一次 token、只送一次結果,每個請求都拿到同一個結果", func(t *testing.T) {
		var calls int32
		srv := fakeExchangeServer(t, http.StatusOK, &calls)
		result := make(chan loginCallbackResult, 1)
		h := loginCallbackHandler(&cliAuthClient{base: srv.URL}, result)
		var wg sync.WaitGroup
		bodies := make([]string, 5)
		for i := range bodies {
			wg.Add(1)
			go func(i int) { defer wg.Done(); bodies[i] = callback(h, "?code=abc") }(i)
		}
		wg.Wait()
		if n := atomic.LoadInt32(&calls); n != 1 {
			t.Fatalf("exchange 被呼叫 %d 次,應為 1", n)
		}
		for i, b := range bodies {
			if !strings.Contains(b, "登入完成") {
				t.Fatalf("第 %d 個請求頁面不對:%s", i, b)
			}
		}
		if len(result) != 1 {
			t.Fatalf("result 應只有 1 筆,得到 %d", len(result))
		}
	})
}

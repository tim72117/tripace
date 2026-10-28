package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// testClient 起一個假後端並備妥假 token(把設定目錄指到暫存處,不碰真實登入狀態)。
func testClient(t *testing.T, h http.HandlerFunc) *httpClient {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("APPDATA", dir)
	t.Setenv("XDG_CONFIG_HOME", dir)
	t.Setenv("HOME", dir)
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	if err := saveToken(srv.URL, "test-token"); err != nil {
		t.Fatal(err)
	}
	return newHTTPClient(srv.URL)
}

func TestServerErrorReadable(t *testing.T) {
	cases := []struct {
		name, body, want string
	}{
		{"標準格式", `{"error":{"code":"invalid_kkday","message":"landingUrl 的網域必須是 kkday.com"}}`,
			"server error 400: invalid_kkday: landingUrl 的網域必須是 kkday.com"},
		{"非 JSON 保留原文", "<html>bad gateway</html>", "server error 400: <html>bad gateway</html>"},
		{"空 body", "", "server error 400: (無回應內容)"},
		{"JSON 但不是約定格式保留原文", `{"foo":"bar"}`, `server error 400: {"foo":"bar"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(400)
				_, _ = io.WriteString(w, tc.body)
			})
			_, err := c.do("GET", "/x", nil)
			if err == nil || err.Error() != tc.want {
				t.Fatalf("got %v, want %q", err, tc.want)
			}
		})
	}
}

func captureStdout(t *testing.T) *bytes.Buffer {
	t.Helper()
	old := stdout
	buf := &bytes.Buffer{}
	stdout = buf
	t.Cleanup(func() { stdout = old })
	return buf
}

func TestPrintResultQuietOnlyID(t *testing.T) {
	res := map[string]any{"id": "abc-123", "name": "x"}

	buf := captureStdout(t)
	printResult(res, true)
	if buf.String() != "abc-123\n" {
		t.Fatalf("quiet 應只印 id 一行, got %q", buf.String())
	}

	buf.Reset()
	printResult(res, false)
	var m map[string]any
	if err := json.Unmarshal(buf.Bytes(), &m); err != nil || m["name"] != "x" {
		t.Fatalf("非 quiet 應印完整 JSON, got %q", buf.String())
	}
}

func TestApplyStatusSuccessAndFailure(t *testing.T) {
	var gotPath, gotBody string
	fail := false
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotPath, gotBody = r.Method+" "+r.URL.Path, string(b)
		if fail {
			w.WriteHeader(400)
			_, _ = io.WriteString(w, `{"error":{"code":"no_plans","message":"活動尚無方案"}}`)
			return
		}
		_, _ = io.WriteString(w, `{"id":"c1","status":"active"}`)
	})

	res, err := applyStatus(c, "/partner/api/campaigns/", "active", map[string]any{"id": "c1", "status": "draft"})
	if err != nil || res["status"] != "active" {
		t.Fatalf("res=%v err=%v", res, err)
	}
	if gotPath != "PUT /partner/api/campaigns/c1/status" || gotBody != `{"status":"active"}` {
		t.Fatalf("請求不對: %s %s", gotPath, gotBody)
	}

	fail = true
	_, err = applyStatus(c, "/partner/api/campaigns/", "active", map[string]any{"id": "c1"})
	if err == nil {
		t.Fatal("第二步失敗應回錯誤")
	}
	for _, want := range []string{"已建立但上架失敗", "id=c1", "no_plans: 活動尚無方案"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("錯誤訊息缺少 %q: %v", want, err)
		}
	}

	if _, err := applyStatus(c, "/partner/api/plans/", "published", map[string]any{}); err == nil || !strings.Contains(err.Error(), "已建立但") {
		t.Fatalf("建立回應沒有 id 應明確報錯: %v", err)
	}
}

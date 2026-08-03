package main

// http_test.go 測 httpClient:每個方法打出去的 HTTP method、路徑、request body,
// 以及有沒有帶上 Authorization header。
//
// 為什麼值得測這一層:先前有過 CLI 打 /internal/trips/{id}、但 server 端從未
// 註冊過這條路由的情況——兩邊各自看起來都合理,編譯也過,只有實際打才會發現。
// 這裡用 httptest.Server 把 CLI 真的送出去的請求攔下來斷言,再搭配
// internal/api 那側的 handler 測試,兩邊夾出這條接縫。
//
// 只寫 happy path(server 一律回 200)。錯誤處理留給日後需要時再補。

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/tim72117/tripace/internal/tripsvc"
)

// capturedReq 是 fake server 記錄下來的請求。
type capturedReq struct {
	method string
	path   string
	auth   string
	body   map[string]any
}

// newFakeServer 起一個一律回 200 {"ok":true} 的 server,並把收到的請求存進
// *capturedReq 供斷言。
func newFakeServer(t *testing.T) (*httptest.Server, *capturedReq) {
	t.Helper()
	got := &capturedReq{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.method = r.Method
		got.path = r.URL.Path
		got.auth = r.Header.Get("Authorization")
		if b, _ := io.ReadAll(r.Body); len(b) > 0 {
			_ = json.Unmarshal(b, &got.body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(srv.Close)
	return srv, got
}

// withToken 讓 loadToken() 讀得到一把假 token。
//
// tokenPath() 走 os.UserConfigDir(),那是讀環境變數決定的(Windows 讀 AppData、
// 其餘平台讀 XDG_CONFIG_HOME,沒設才 fallback 到 ~/.config),所以用 t.Setenv
// 把它導到測試專屬的暫存目錄即可,不需要為了測試在 production code 開一個
// 可注入的路徑參數。t.Setenv 會在測試結束時自動還原。
func withToken(t *testing.T, token string) {
	t.Helper()
	dir := t.TempDir()
	if runtime.GOOS == "windows" {
		t.Setenv("AppData", dir)
	} else {
		t.Setenv("XDG_CONFIG_HOME", dir)
	}
	if err := os.MkdirAll(filepath.Join(dir, "tripace"), 0700); err != nil {
		t.Fatalf("建立 token 目錄: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "tripace", "token"), []byte(token), 0600); err != nil {
		t.Fatalf("寫入 token: %v", err)
	}
	// 確認上面的環境變數操作真的生效——否則後續斷言會在「其實讀到了開發者本機
	// 真實 token」的情況下通過,測試就失去意義。
	path, err := tokenPath()
	if err != nil {
		t.Fatalf("tokenPath: %v", err)
	}
	if want := filepath.Join(dir, "tripace", "token"); path != want {
		t.Fatalf("tokenPath 指向 %q，預期 %q（環境變數沒有生效）", path, want)
	}
}

func TestHTTPClientListChannels(t *testing.T) {
	withToken(t, "tok_test")
	srv, got := newFakeServer(t)

	if _, err := newHTTPClient(srv.URL).listChannels(); err != nil {
		t.Fatalf("listChannels: %v", err)
	}

	assertReq(t, got, "GET", "/internal/channels")
}

func TestHTTPClientCreateChannel(t *testing.T) {
	withToken(t, "tok_test")
	srv, got := newFakeServer(t)

	if _, err := newHTTPClient(srv.URL).createChannel("花蓮三日"); err != nil {
		t.Fatalf("createChannel: %v", err)
	}

	// createChannel 是唯一走 /v1/ 而非 /internal/ 的方法(建頻道需要一個
	// 「以誰為 owner」的已驗證身分,見 http.go 上的說明)。
	assertReq(t, got, "POST", "/v1/channels")
	if got.body["name"] != "花蓮三日" {
		t.Errorf("body name = %v，預期 花蓮三日", got.body["name"])
	}
}

func TestHTTPClientTripEntries(t *testing.T) {
	withToken(t, "tok_test")
	srv, got := newFakeServer(t)

	if _, err := newHTTPClient(srv.URL).tripEntries("ch_abc"); err != nil {
		t.Fatalf("tripEntries: %v", err)
	}

	assertReq(t, got, "GET", "/internal/channels/ch_abc/entries")
}

func TestHTTPClientRecord(t *testing.T) {
	withToken(t, "tok_test")
	srv, got := newFakeServer(t)

	_, err := newHTTPClient(srv.URL).record("ch_abc", "光復糖廠", "2026-03-01", "09:00", "2026-03-01", "10:30", "花蓮縣光復鄉")
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	assertReq(t, got, "POST", "/internal/channels/ch_abc/entries")
	for k, want := range map[string]string{
		"title": "光復糖廠", "start": "2026-03-01", "startTime": "09:00",
		"end": "2026-03-01", "endTime": "10:30", "location": "花蓮縣光復鄉",
	} {
		if got.body[k] != want {
			t.Errorf("body %s = %v，預期 %q", k, got.body[k], want)
		}
	}
}

func TestHTTPClientUpdateEntry(t *testing.T) {
	withToken(t, "tok_test")
	srv, got := newFakeServer(t)

	err := newHTTPClient(srv.URL).updateEntry(tripsvc.UpdateEntryInput{
		ID: "ent_1", Title: "光復糖廠", Kind: "activity",
		Detail: map[string]any{"distanceKm": 12.5},
	})
	if err != nil {
		t.Fatalf("updateEntry: %v", err)
	}

	assertReq(t, got, "PATCH", "/internal/entries/ent_1")
	if got.body["title"] != "光復糖廠" {
		t.Errorf("body title = %v，預期 光復糖廠", got.body["title"])
	}
	detail, ok := got.body["detail"].(map[string]any)
	if !ok {
		t.Fatalf("body detail 不是物件: %v", got.body["detail"])
	}
	if detail["distanceKm"] != 12.5 {
		t.Errorf("body detail.distanceKm = %v，預期 12.5", detail["distanceKm"])
	}
}

// TestHTTPClientSetEntryLatLng 對應 geocode -entry 把查到的座標寫回 entry
// 這條路徑。這裡曾經漏帶 Authorization header,所以 assertReq 對 auth 的檢查
// 在這個 case 特別有意義。
func TestHTTPClientSetEntryLatLng(t *testing.T) {
	withToken(t, "tok_test")
	srv, got := newFakeServer(t)

	if err := newHTTPClient(srv.URL).setEntryLatLng("ent_1", 23.6697, 121.4218); err != nil {
		t.Fatalf("setEntryLatLng: %v", err)
	}

	assertReq(t, got, "PATCH", "/internal/entries/ent_1/latlng")
	if got.body["lat"] != 23.6697 || got.body["lng"] != 121.4218 {
		t.Errorf("body lat/lng = %v/%v，預期 23.6697/121.4218", got.body["lat"], got.body["lng"])
	}
}

func TestHTTPClientDeleteEntry(t *testing.T) {
	withToken(t, "tok_test")
	srv, got := newFakeServer(t)

	if err := newHTTPClient(srv.URL).deleteEntry("ent_1"); err != nil {
		t.Fatalf("deleteEntry: %v", err)
	}

	assertReq(t, got, "DELETE", "/internal/entries/ent_1")
}

func TestHTTPClientReset(t *testing.T) {
	withToken(t, "tok_test")
	srv, got := newFakeServer(t)

	if err := newHTTPClient(srv.URL).reset("ch_abc"); err != nil {
		t.Fatalf("reset: %v", err)
	}

	assertReq(t, got, "DELETE", "/internal/channels/ch_abc/entries")
}

// assertReq 斷言 method、path,以及一定要帶上 bearer token。
func assertReq(t *testing.T, got *capturedReq, method, path string) {
	t.Helper()
	if got.method != method {
		t.Errorf("method = %s，預期 %s", got.method, method)
	}
	if got.path != path {
		t.Errorf("path = %s，預期 %s", got.path, path)
	}
	if got.auth != "Bearer tok_test" {
		t.Errorf("Authorization = %q，預期 %q", got.auth, "Bearer tok_test")
	}
}

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
	"strings"
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
// tokenPath() 走 os.UserConfigDir(),這個函式依平台分三種情況(見該函式
// 的 doc):Windows 讀 %AppData%;Darwin 固定回傳 $HOME/Library/Application
// Support,完全不讀任何環境變數;其餘 Unix 系統才讀 XDG_CONFIG_HOME
// (沒設才 fallback 到 ~/.config)。曾經誤以為「非 Windows 就是讀
// XDG_CONFIG_HOME」,導致這個 helper 在 Darwin 上設的環境變數完全沒有
// 效果、實際寫到了開發者本機真實的 ~/Library/Application Support/
// tripace/(而非測試暫存目錄)——這是一次實際發生過的事故:跑測試時
// 覆蓋掉了開發者已經登入過的真實 token,見 sync_token_test.go 開頭
// withSyncTokenDir 的同款修正。改用 setUserConfigDirEnv 統一依平台設定
// 正確的環境變數。
func withToken(t *testing.T, token string) {
	t.Helper()
	dir := t.TempDir()
	setUserConfigDirEnv(t, dir)
	// 不假設 tripace 設定目錄跟 dir 的相對關係(平台不同、關係也不同——
	// 例如 Darwin 上設 HOME=dir 之後,實際的設定目錄是
	// dir/Library/Application Support/tripace,不是 dir/tripace)。改成
	// 直接呼叫 tokenPath() 拿到 os.UserConfigDir() 實際解析出的路徑,
	// 這樣不管哪個平台、哪種環境變數對應關係,都一定寫到真正會被
	// loadToken() 讀到的位置,也不需要重複一份「這個平台的路徑長怎樣」
	// 的假設。
	path, err := tokenPath()
	if err != nil {
		t.Fatalf("tokenPath: %v", err)
	}
	// 確認 path 真的落在這次測試專屬的暫存目錄底下,而不是不小心又解析回
	// 開發者本機真實的設定目錄——這正是本檔案開頭註解提到的那次事故的
	// 防呆:任何一次環境變數對應關係設錯,都會在這裡直接 fail,而不是
	// 悄悄寫到真實路徑後才被發現。
	if !strings.HasPrefix(path, dir) {
		t.Fatalf("tokenPath 指向 %q，不在這次測試的暫存目錄 %q 底下（環境變數沒有生效）", path, dir)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatalf("建立 token 目錄: %v", err)
	}
	if err := os.WriteFile(path, []byte(token), 0600); err != nil {
		t.Fatalf("寫入 token: %v", err)
	}
}

// setUserConfigDirEnv 把 os.UserConfigDir() 導到 dir——依平台設定它實際
// 會讀的環境變數(見上方 withToken 的說明),而不是想當然爾地只處理
// Windows/其餘兩種情況。同時被 withToken(本檔案)與 withSyncTokenDir
// (sync_token_test.go)使用,只在這裡維護一份「各平台該設哪個環境變數」
// 的知識,不重複兩份、容易顧此失彼。
func setUserConfigDirEnv(t *testing.T, dir string) {
	t.Helper()
	switch runtime.GOOS {
	case "windows":
		t.Setenv("AppData", dir)
	case "darwin":
		t.Setenv("HOME", dir)
	default:
		t.Setenv("XDG_CONFIG_HOME", dir)
	}
}

func TestHTTPClientListTrips(t *testing.T) {
	withToken(t, "tok_test")
	srv, got := newFakeServer(t)

	if _, err := newHTTPClient(srv.URL).listTrips(); err != nil {
		t.Fatalf("listTrips: %v", err)
	}

	assertReq(t, got, "GET", "/internal/trips")
}

func TestHTTPClientCreateTrip(t *testing.T) {
	withToken(t, "tok_test")
	srv, got := newFakeServer(t)

	if _, err := newHTTPClient(srv.URL).createTrip("花蓮三日"); err != nil {
		t.Fatalf("createTrip: %v", err)
	}

	// createTrip 是唯一走 /v1/ 而非 /internal/ 的方法(建行程需要一個
	// 「以誰為 owner」的已驗證身分,見 http.go 上的說明)。
	assertReq(t, got, "POST", "/v1/trips")
	if got.body["name"] != "花蓮三日" {
		t.Errorf("body name = %v，預期 花蓮三日", got.body["name"])
	}
}

func TestHTTPClientTripEntries(t *testing.T) {
	withToken(t, "tok_test")
	srv, got := newFakeServer(t)

	if _, err := newHTTPClient(srv.URL).tripEntries("tr_abc"); err != nil {
		t.Fatalf("tripEntries: %v", err)
	}

	assertReq(t, got, "GET", "/internal/trips/tr_abc/entries")
}

func TestHTTPClientRecord(t *testing.T) {
	withToken(t, "tok_test")
	srv, got := newFakeServer(t)

	_, err := newHTTPClient(srv.URL).record("tr_abc", "光復糖廠", "2026-03-01", "09:00", "2026-03-01", "10:30", "花蓮縣光復鄉")
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	assertReq(t, got, "POST", "/internal/trips/tr_abc/entries")
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

	if err := newHTTPClient(srv.URL).reset("tr_abc"); err != nil {
		t.Fatalf("reset: %v", err)
	}

	assertReq(t, got, "DELETE", "/internal/trips/tr_abc/entries")
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

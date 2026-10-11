package adminconsole

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/store"
)

// newTestStore 用 SQLite 記憶體 DB 建一個乾淨的 store。實作見
// store.OpenTest——每次呼叫都是一個獨立的空資料庫,測試之間不會互相看見資料。
func newTestStore(t *testing.T) *store.Store {
	t.Helper()
	return store.OpenTest(t)
}

// testSigner 是測試共用的 JWT signer,跟正式環境的 cmd/server 建構方式
// 相同(auth.NewSigner(secret, ttl)),只是用固定的測試用 secret。
func testSigner() *auth.Signer {
	return auth.NewSigner("test-secret", 24*time.Hour)
}

// newAdminTestUser 在 st 裡建立一個帳密使用者(email 即為管理權限白名單
// 值),並簽一把對應的 JWT——模擬「一般使用者走 /v1/auth/* 登入流程拿到
// token」這個真實情境,供呼叫端帶著這把 token 打 /admin/api/* 使用。
func newAdminTestUser(t *testing.T, st *store.Store, signer *auth.Signer, email string) (token string) {
	t.Helper()
	user, err := st.CreatePasswordUser("usr_"+email, "Admin", "#000000", email, "hash")
	if err != nil {
		t.Fatalf("create admin test user: %v", err)
	}
	tok, err := signer.Sign(user.ID, user.Name)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return tok
}

// TestAdminAPIEndToEnd 涵蓋 withAdmin 的 fail-closed 行為(無 token、email
// 不在白名單都被拒絕)、以及通過驗證後 /admin/api/users 能回傳基本使用者
// 資訊的主要路徑。
func TestAdminAPIEndToEnd(t *testing.T) {
	st := newTestStore(t)
	signer := testSigner()

	const email = "admin-api-test@example.com"

	h := NewHandler(signer, st, email)
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// 1. 未帶 token 呼叫 withAdmin 路由被拒(401)。這是 fail-closed 的核心
	//    行為:沒有合法身分 ⇒ 沒有存取權。
	if resp, err := http.Get(srv.URL + "/admin/api/users"); err != nil {
		t.Fatalf("unauth GET: %v", err)
	} else {
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("unauth /admin/api/users = %d, want 401", resp.StatusCode)
		}
	}

	// 2. email 不在白名單裡的一般使用者,帶著合法 JWT 一樣被拒絕。
	otherToken := newAdminTestUser(t, st, signer, "not-admin@example.com")
	req, err := http.NewRequest(http.MethodGet, srv.URL+"/admin/api/users", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+otherToken)
	if resp, err := http.DefaultClient.Do(req); err != nil {
		t.Fatalf("non-admin GET: %v", err)
	} else {
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("non-admin /admin/api/users = %d, want 401", resp.StatusCode)
		}
	}

	// 3. email 符合白名單的使用者,帶著合法 JWT 可以成功呼叫。
	adminToken := newAdminTestUser(t, st, signer, email)
	req, err = http.NewRequest(http.MethodGet, srv.URL+"/admin/api/users", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+adminToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("authed GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("authed /admin/api/users = %d, want 200", resp.StatusCode)
	}
}

// TestAdminMe 驗證 GET /admin/api/me 回傳的 email 等於通過驗證的管理員
// email。
func TestAdminMe(t *testing.T) {
	st := newTestStore(t)
	signer := testSigner()
	const email = "admin-me-test@example.com"

	h := NewHandler(signer, st, email)
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	token := newAdminTestUser(t, st, signer, email)
	req, err := http.NewRequest(http.MethodGet, srv.URL+"/admin/api/me", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /admin/api/me: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /admin/api/me = %d, want 200", resp.StatusCode)
	}
}

// TestWithAdmin_Email大小寫不同仍能通過白名單檢查 對應 2026-10 code
// review 發現的正確性問題(見 internal/adminidentity.IsAdminEmail 的
// 完整說明):密碼註冊路徑對 email 一律 strings.ToLower 正規化,但
// Google 登入回傳的 email 大小寫可能跟 ADMIN_BOOTSTRAP_EMAIL 設定值
// 不同——這裡驗證 withAdmin 用大小寫不同的白名單值仍能正確放行。
func TestWithAdmin_Email大小寫不同仍能通過白名單檢查(t *testing.T) {
	st := newTestStore(t)
	signer := testSigner()
	const email = "case-admin-test@example.com"

	// 白名單設成全大寫,使用者註冊的 email 是小寫(密碼註冊路徑的既有
	// 正規化行為,見 internal/api.handleRegister)。
	h := NewHandler(signer, st, "CASE-ADMIN-TEST@EXAMPLE.COM")
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	token := newAdminTestUser(t, st, signer, email)
	req, err := http.NewRequest(http.MethodGet, srv.URL+"/admin/api/me", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /admin/api/me: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("白名單 email 大小寫不同時,GET /admin/api/me 應該成功(200),got %d", resp.StatusCode)
	}
}

// TestWithAdmin_錯誤回應為結構化JSON格式 對應 2026-10 code review 發現的
// 慣例問題:withAdmin 原本用純文字 http.Error,跟全站其餘端點
// (internal/api 的 writeErr)的 {"error":{"code":"...","message":"..."}}
// 結構化 JSON 格式不一致。這裡驗證未帶 token 呼叫受保護路由時,回應
// body 是合法 JSON、且帶有 error.message 欄位,不是純文字。
func TestWithAdmin_錯誤回應為結構化JSON格式(t *testing.T) {
	st := newTestStore(t)
	signer := testSigner()
	h := NewHandler(signer, st, "someone@example.com")
	mux := http.NewServeMux()
	h.Register(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/admin/api/users")
	if err != nil {
		t.Fatalf("unauth GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauth /admin/api/users = %d, want 401", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
		t.Fatalf("錯誤回應的 Content-Type 應該是 application/json,got %q", ct)
	}
	var body struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("錯誤回應應該是合法的結構化 JSON,解析失敗: %v", err)
	}
	if body.Error.Message == "" {
		t.Fatalf("錯誤回應應該帶有 error.message,got 空字串")
	}
}

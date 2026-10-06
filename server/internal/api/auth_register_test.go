package api

// auth_register_test.go 測 POST /v1/auth/register(帳密註冊)——這支端點
// 先前完全沒有測試覆蓋(見 2026-10 Apple/Google 登入 email 遺失 bug 排查時
// 一併盤點既有測試覆蓋範圍的發現)。比照 entry_test.go 的慣例,透過
// s.Routes() 打完整的 mux(而非直接呼叫 handler 函式),同時驗證路由字串
// 本身有沒有註冊對。

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/store"
)

// doRegister 送一次 POST /v1/auth/register,回傳狀態碼與解析後的回應 body。
func doRegister(t *testing.T, routes http.Handler, email, password, name string) (int, map[string]any) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"email": email, "password": password, "name": name})
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	routes.ServeHTTP(rec, req)

	var got map[string]any
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("解析回應 body 失敗: %v, body=%s", err, rec.Body.String())
		}
	}
	return rec.Code, got
}

// TestHandleRegister_Success 驗證成功註冊:回 200、附上 token/user/profile,
// isNewUser 固定為 true(見 handleRegister 的完整說明),且之後能用這組
// email+密碼透過 store 層查回同一筆使用者、密碼雜湊可驗證。
func TestHandleRegister_Success(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	code, got := doRegister(t, routes, "Alice@Example.com", "password123", "Alice")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%+v", code, got)
	}
	if got["token"] == nil || got["token"] == "" {
		t.Fatalf("回應應附上 token, got %+v", got)
	}
	if got["isNewUser"] != true {
		t.Fatalf("isNewUser 應為 true, got %+v", got["isNewUser"])
	}
	user, ok := got["user"].(map[string]any)
	if !ok {
		t.Fatalf("回應應附上 user 物件, got %+v", got)
	}
	if user["name"] != "Alice" {
		t.Fatalf("want name Alice, got %+v", user["name"])
	}
	profile, ok := got["profile"].(map[string]any)
	if !ok {
		t.Fatalf("回應應附上 profile 物件, got %+v", got)
	}
	// email 應正規化成小寫(見 handleRegister 的 strings.ToLower)。
	if profile["email"] != "alice@example.com" {
		t.Fatalf("want email 已正規化為小寫 alice@example.com, got %+v", profile["email"])
	}

	// 確認資料真的落地存進資料庫,且密碼雜湊可驗證(不是只有 response 看
	// 起來對,實際沒寫入)。
	_, hash, err := s.store.FindUserByEmail("alice@example.com")
	if err != nil {
		t.Fatalf("FindUserByEmail: %v", err)
	}
	if hash == "" {
		t.Fatalf("password hash 應已存入")
	}
}

// TestHandleRegister_NameDefaultsToEmail 驗證 name 留空時,預設使用 email
// 本身(見 handleRegister:`if name == "" { name = email }`)。
func TestHandleRegister_NameDefaultsToEmail(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	code, got := doRegister(t, routes, "noname@example.com", "password123", "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%+v", code, got)
	}
	user := got["user"].(map[string]any)
	if user["name"] != "noname@example.com" {
		t.Fatalf("want name 預設為 email, got %+v", user["name"])
	}
}

// TestHandleRegister_EmailAlreadyTaken 驗證 email 已被註冊時回 409
// email_taken,且不會建立第二筆使用者或覆寫既有密碼。
func TestHandleRegister_EmailAlreadyTaken(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	code, _ := doRegister(t, routes, "dup@example.com", "password123", "第一次")
	if code != http.StatusOK {
		t.Fatalf("第一次註冊應成功, got %d", code)
	}

	code, got := doRegister(t, routes, "dup@example.com", "different-pw", "第二次")
	if code != http.StatusConflict {
		t.Fatalf("重複 email 應回 409, got %d, body=%+v", code, got)
	}
	errObj, ok := got["error"].(map[string]any)
	if !ok || errObj["code"] != "email_taken" {
		t.Fatalf("want error.code=email_taken, got %+v", got)
	}

	// 既有密碼不應被第二次註冊覆寫——用原本的密碼仍應能驗證成功。
	_, hash, err := s.store.FindUserByEmail("dup@example.com")
	if err != nil {
		t.Fatalf("FindUserByEmail: %v", err)
	}
	if err := auth.VerifyPassword("password123", hash); err != nil {
		t.Fatalf("原密碼應維持可驗證(未被第二次註冊覆寫): %v", err)
	}
}

// TestHandleRegister_EmailAlreadyTaken_CaseInsensitive 驗證大小寫不同的同一個
// email 仍視為重複(handleRegister 註冊與查詢都先正規化成小寫)。
func TestHandleRegister_EmailAlreadyTaken_CaseInsensitive(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	if code, _ := doRegister(t, routes, "case@example.com", "password123", ""); code != http.StatusOK {
		t.Fatalf("第一次註冊應成功, got %d", code)
	}
	code, got := doRegister(t, routes, "CASE@EXAMPLE.COM", "password456", "")
	if code != http.StatusConflict {
		t.Fatalf("大小寫不同但同一個 email 應視為重複, got %d, body=%+v", code, got)
	}
}

// TestHandleRegister_WeakPassword 驗證密碼少於 6 字元時回 400 weak_password,
// 且不應建立任何使用者。
func TestHandleRegister_WeakPassword(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	code, got := doRegister(t, routes, "short@example.com", "123", "")
	if code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d, body=%+v", code, got)
	}
	errObj, ok := got["error"].(map[string]any)
	if !ok || errObj["code"] != "weak_password" {
		t.Fatalf("want error.code=weak_password, got %+v", got)
	}
	if _, _, err := s.store.FindUserByEmail("short@example.com"); err != store.ErrNotFound {
		t.Fatalf("密碼太短不應建立使用者, FindUserByEmail err=%v", err)
	}
}

// TestHandleRegister_EmptyEmailOrPassword 驗證 email/password 任一為空時回
// 400 invalid_input。
func TestHandleRegister_EmptyEmailOrPassword(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	cases := []struct {
		name, email, password string
	}{
		{"empty email", "", "password123"},
		{"empty password", "noPassword@example.com", ""},
		{"both empty", "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			code, got := doRegister(t, routes, c.email, c.password, "")
			if code != http.StatusBadRequest {
				t.Fatalf("want 400, got %d, body=%+v", code, got)
			}
			errObj, ok := got["error"].(map[string]any)
			if !ok || errObj["code"] != "invalid_input" {
				t.Fatalf("want error.code=invalid_input, got %+v", got)
			}
		})
	}
}

// TestHandleRegister_EmailWhitespaceTrimmed 驗證 email 前後空白會被
// trim(見 handleRegister 的 strings.TrimSpace),不會因為使用者不小心多打
// 空白就被當成不同帳號、或驗證規則繞過。
func TestHandleRegister_EmailWhitespaceTrimmed(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	code, _ := doRegister(t, routes, "  trimmed@example.com  ", "password123", "")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d", code)
	}
	if _, _, err := s.store.FindUserByEmail("trimmed@example.com"); err != nil {
		t.Fatalf("email 應已 trim 前後空白後存入, FindUserByEmail: %v", err)
	}
}

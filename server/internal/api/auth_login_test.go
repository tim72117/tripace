package api

// auth_login_test.go 測 POST /v1/auth/login(帳密登入)——先前完全沒有測試
// 覆蓋(見 auth_register_test.go 開頭補齊註冊測試時一併盤點的發現)。手法
// 比照 auth_register_test.go:透過 s.Routes() 打完整 mux。

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// doLogin 送一次 POST /v1/auth/login,回傳狀態碼與解析後的回應 body。
func doLogin(t *testing.T, routes http.Handler, email, password string) (int, map[string]any) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"email": email, "password": password})
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", bytes.NewReader(body))
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

// TestHandleLogin_Success 驗證正確的 email+密碼可以登入成功:回 200、附上
// token/user/profile,isNewUser 固定為 false(帳密登入不可能建立新帳號,
// 見 handleLogin 的完整說明)。
func TestHandleLogin_Success(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	if code, _ := doRegister(t, routes, "login-ok@example.com", "password123", "小明"); code != http.StatusOK {
		t.Fatalf("前置註冊應成功, got %d", code)
	}

	code, got := doLogin(t, routes, "login-ok@example.com", "password123")
	if code != http.StatusOK {
		t.Fatalf("want 200, got %d, body=%+v", code, got)
	}
	if got["token"] == nil || got["token"] == "" {
		t.Fatalf("回應應附上 token, got %+v", got)
	}
	if got["isNewUser"] != false {
		t.Fatalf("isNewUser 應為 false, got %+v", got["isNewUser"])
	}
	user, ok := got["user"].(map[string]any)
	if !ok || user["name"] != "小明" {
		t.Fatalf("回應應附上正確的 user 物件, got %+v", got)
	}
	profile, ok := got["profile"].(map[string]any)
	if !ok || profile["email"] != "login-ok@example.com" {
		t.Fatalf("回應應附上正確的 profile.email, got %+v", got)
	}
}

// TestHandleLogin_EmailCaseInsensitive 驗證登入時 email 大小寫不敏感(先
// normalize 成小寫再查,對稱 handleRegister 的正規化行為)。
func TestHandleLogin_EmailCaseInsensitive(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	if code, _ := doRegister(t, routes, "caselogin@example.com", "password123", ""); code != http.StatusOK {
		t.Fatalf("前置註冊應成功, got %d", code)
	}

	code, _ := doLogin(t, routes, "CaseLogin@Example.com", "password123")
	if code != http.StatusOK {
		t.Fatalf("大小寫不同但同一個 email 應能登入成功, got %d", code)
	}
}

// TestHandleLogin_WrongPassword 驗證密碼錯誤回 401 invalid_credentials——
// 不應洩漏「帳號存在但密碼錯」與「帳號不存在」的差異(見 handleLogin 的
// 完整說明:兩種情況回傳同一個錯誤)。
func TestHandleLogin_WrongPassword(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	if code, _ := doRegister(t, routes, "wrongpw@example.com", "password123", ""); code != http.StatusOK {
		t.Fatalf("前置註冊應成功, got %d", code)
	}

	code, got := doLogin(t, routes, "wrongpw@example.com", "incorrect-password")
	if code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d, body=%+v", code, got)
	}
	errObj, ok := got["error"].(map[string]any)
	if !ok || errObj["code"] != "invalid_credentials" {
		t.Fatalf("want error.code=invalid_credentials, got %+v", got)
	}
}

// TestHandleLogin_UnknownEmail 驗證不存在的 email 回傳與密碼錯誤完全相同的
// 401 invalid_credentials——這是刻意的安全設計(不讓攻擊者用回應差異枚舉
// 出哪些 email 已註冊),這裡把它當一個明確的回歸測試釘住,避免之後有人
// 不小心把這支端點改成洩漏「帳號不存在」這個更精確的錯誤訊息。
func TestHandleLogin_UnknownEmail(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	code, got := doLogin(t, routes, "nobody@example.com", "whatever123")
	if code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d, body=%+v", code, got)
	}
	errObj, ok := got["error"].(map[string]any)
	if !ok || errObj["code"] != "invalid_credentials" {
		t.Fatalf("want error.code=invalid_credentials(與密碼錯誤同一個錯誤碼,不洩漏帳號是否存在), got %+v", got)
	}
}

// TestHandleLogin_GoogleOnlyUser_NoPassword 驗證「只用 Google 登入、從未
// 設定過密碼」的使用者嘗試帳密登入時,同樣回 401 invalid_credentials(而非
// 500 或其他錯誤)——這條路徑容易被忽略:這類使用者的 password_hash 是
// NULL,見 handleLogin 的 `hash == ""` 短路判斷,必須在 auth.VerifyPassword
// 之前就擋下來,否則對空字串雜湊做比對可能產生非預期行為。
func TestHandleLogin_GoogleOnlyUser_NoPassword(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	if _, err := s.store.CreateGoogleUser("usr_google_only", "Google 使用者", "#8C7B6A", "google-sub-only", "googleonly@example.com"); err != nil {
		t.Fatalf("建立 Google-only 使用者: %v", err)
	}

	code, got := doLogin(t, routes, "googleonly@example.com", "any-password")
	if code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d, body=%+v", code, got)
	}
	errObj, ok := got["error"].(map[string]any)
	if !ok || errObj["code"] != "invalid_credentials" {
		t.Fatalf("want error.code=invalid_credentials, got %+v", got)
	}
}

// TestHandleLogin_EmptyBody 驗證 email/password 皆空時仍走同一條
// invalid_credentials 路徑(handleLogin 沒有像 handleRegister 那樣的
// invalid_input 前置檢查,空字串會直接在 FindUserByEmail("") 查無此人,
// 落到跟一般登入失敗相同的分支)——這裡釘住目前的實際行為,避免之後改動
// 誤以為這個情境該回不同的錯誤碼。
func TestHandleLogin_EmptyBody(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	code, got := doLogin(t, routes, "", "")
	if code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d, body=%+v", code, got)
	}
	errObj, ok := got["error"].(map[string]any)
	if !ok || errObj["code"] != "invalid_credentials" {
		t.Fatalf("want error.code=invalid_credentials, got %+v", got)
	}
}

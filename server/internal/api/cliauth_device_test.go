package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestHandleStartDeviceAuth 驗證 POST /v1/cli-auth/device/start 回傳一組
// 非空、彼此不同的 deviceCode/userCode——這兩個值的用途完全不同(見
// server/internal/store/cliauth.go StartDeviceAuth 的說明),混用會讓整套
// device code 流程的安全性假設不成立。
func TestHandleStartDeviceAuth(t *testing.T) {
	s := newTestServer(t)

	req := httptest.NewRequest(http.MethodPost, "/v1/cli-auth/device/start", strings.NewReader(`{"name":"test-cli"}`))
	rec := httptest.NewRecorder()
	s.handleStartDeviceAuth(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("handleStartDeviceAuth 應回 201,卻回 %d,body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		DeviceCode string `json:"deviceCode"`
		UserCode   string `json:"userCode"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("解析回應失敗: %v", err)
	}
	if out.DeviceCode == "" || out.UserCode == "" {
		t.Fatalf("deviceCode/userCode 不應為空,得到 %+v", out)
	}
	if out.DeviceCode == out.UserCode {
		t.Fatal("deviceCode 與 userCode 不應相同")
	}
}

// TestHandleGetDeviceAuth_NotFound 驗證未知 userCode 回 404,不 panic。
func TestHandleGetDeviceAuth_NotFound(t *testing.T) {
	s := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/v1/cli-auth/device/NOSUCH-CODE", nil)
	req.SetPathValue("userCode", "NOSUCH-CODE")
	rec := httptest.NewRecorder()
	s.handleGetDeviceAuth(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("未知 userCode 應回 404,卻回 %d,body=%s", rec.Code, rec.Body.String())
	}
}

// TestHandleGetDeviceAuth_Success 驗證用 StartDeviceAuth 產生的 userCode
// 可以查到當初登記的名稱——對應 /device 核准頁面載入時顯示「XXX 想要登入」
// 這一步。
func TestHandleGetDeviceAuth_Success(t *testing.T) {
	s := newTestServer(t)
	_, userCode, err := s.store.StartDeviceAuth("test-cli")
	if err != nil {
		t.Fatalf("StartDeviceAuth: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/cli-auth/device/"+userCode, nil)
	req.SetPathValue("userCode", userCode)
	rec := httptest.NewRecorder()
	s.handleGetDeviceAuth(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("handleGetDeviceAuth 應回 200,卻回 %d,body=%s", rec.Code, rec.Body.String())
	}
	var out struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("解析回應失敗: %v", err)
	}
	if out.Name != "test-cli" {
		t.Fatalf("name = %q,want \"test-cli\"", out.Name)
	}
}

// TestHandleApproveDeviceAuth_RequiresLogin 對應 handleApproveCliAuth 的
// 既有安全設計(見 authenticatedUserForApproval):沒有 Authorization 一律
// 401,不接受訪客身分核准。
func TestHandleApproveDeviceAuth_RequiresLogin(t *testing.T) {
	s := newTestServer(t)
	_, userCode, err := s.store.StartDeviceAuth("test-cli")
	if err != nil {
		t.Fatalf("StartDeviceAuth: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/cli-auth/device/"+userCode+"/approve", nil)
	req.SetPathValue("userCode", userCode)
	rec := httptest.NewRecorder()
	s.handleApproveDeviceAuth(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("缺少 Authorization 應回 401,卻回 %d,body=%s", rec.Code, rec.Body.String())
	}
	if ok := s.store.ApproveDeviceAuth(userCode, "should-not-matter"); !ok {
		t.Fatal("上面那次未帶身分的核准不應該已經把這個 userCode 標記為已核准過——這裡的 ApproveDeviceAuth 應該還是第一次核准,才會成功")
	}
}

// TestHandleApproveDeviceAuth_DeletedUser 對應
// TestHandleApproveCliAuth_DeletedUser(auth_test.go)在 device code 流程上
// 的版本:token 簽章有效但對應使用者已不存在於資料庫時,不應該核准成功,
// 也不應該讓這筆 session 被標記為已核准(否則之後這個查無此人的身份就能
// 透過 ExchangeCliAuth 换到一把新 token,無限循環延續下去)。
func TestHandleApproveDeviceAuth_DeletedUser(t *testing.T) {
	s := newTestServer(t)

	ghostToken, err := s.signer.Sign("usr_ghost", "ghost")
	if err != nil {
		t.Fatalf("sign ghost token: %v", err)
	}
	deviceCode, userCode, err := s.store.StartDeviceAuth("test-cli")
	if err != nil {
		t.Fatalf("StartDeviceAuth: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/cli-auth/device/"+userCode+"/approve", nil)
	req.Header.Set("Authorization", "Bearer "+ghostToken)
	req.SetPathValue("userCode", userCode)
	rec := httptest.NewRecorder()
	s.handleApproveDeviceAuth(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("查無此人的 token 核准 device 登入應回 401,卻回 %d,body=%s", rec.Code, rec.Body.String())
	}
	if _, ok := s.store.ExchangeCliAuth(deviceCode); ok {
		t.Fatal("查無此人的核准請求不應讓這筆 device auth session 變成已核准狀態")
	}
}

// TestDeviceAuthEndToEnd 走過真正的使用者身分完整跑一次 device code 流程:
// start(CLI)→ getName(/device 頁面載入)→ approve(使用者按下核准,真實
// 登入身分)→ exchange(CLI 輪詢,用 deviceCode 換到 approve 當下簽出的
// token)。驗證換到的 token 對應核准時使用的使用者 ID,不是別人。
func TestDeviceAuthEndToEnd(t *testing.T) {
	s := newTestServer(t)

	user, err := s.store.CreatePasswordUser("usr_alice", "Alice", "#ffffff", "alice@example.com", "hash-not-checked-here")
	if err != nil {
		t.Fatalf("CreatePasswordUser: %v", err)
	}
	userToken, err := s.signer.Sign(user.ID, user.Name)
	if err != nil {
		t.Fatalf("sign user token: %v", err)
	}

	deviceCode, userCode, err := s.store.StartDeviceAuth("test-cli")
	if err != nil {
		t.Fatalf("StartDeviceAuth: %v", err)
	}

	// /device 頁面載入:查名稱。
	getReq := httptest.NewRequest(http.MethodGet, "/v1/cli-auth/device/"+userCode, nil)
	getReq.SetPathValue("userCode", userCode)
	getRec := httptest.NewRecorder()
	s.handleGetDeviceAuth(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("handleGetDeviceAuth 應回 200,卻回 %d,body=%s", getRec.Code, getRec.Body.String())
	}

	// 使用者按下核准。
	approveReq := httptest.NewRequest(http.MethodPost, "/v1/cli-auth/device/"+userCode+"/approve", nil)
	approveReq.Header.Set("Authorization", "Bearer "+userToken)
	approveReq.SetPathValue("userCode", userCode)
	approveRec := httptest.NewRecorder()
	s.handleApproveDeviceAuth(approveRec, approveReq)
	if approveRec.Code != http.StatusOK {
		t.Fatalf("handleApproveDeviceAuth 應回 200,卻回 %d,body=%s", approveRec.Code, approveRec.Body.String())
	}

	// CLI 輪詢 exchange(用 deviceCode,不是 userCode)。
	exchangeReq := httptest.NewRequest(http.MethodPost, "/v1/cli-auth/"+deviceCode+"/exchange", nil)
	exchangeReq.SetPathValue("id", deviceCode)
	exchangeRec := httptest.NewRecorder()
	s.handleExchangeCliAuth(exchangeRec, exchangeReq)
	if exchangeRec.Code != http.StatusOK {
		t.Fatalf("handleExchangeCliAuth 應回 200,卻回 %d,body=%s", exchangeRec.Code, exchangeRec.Body.String())
	}
	var out struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(exchangeRec.Body.Bytes(), &out); err != nil {
		t.Fatalf("解析回應失敗: %v", err)
	}
	if out.Token == "" {
		t.Fatal("exchange 回應的 token 不應為空")
	}

	claims, err := s.signer.Verify(out.Token)
	if err != nil {
		t.Fatalf("換到的 token 應能通過驗證: %v", err)
	}
	if claims.Sub != user.ID {
		t.Fatalf("token 對應的使用者 ID = %q,want %q", claims.Sub, user.ID)
	}

	// 用 userCode 當 deviceCode 去 exchange 應該失敗——兩者不能互換。
	if _, ok := s.store.ExchangeCliAuth(userCode); ok {
		t.Fatal("ExchangeCliAuth(userCode) 不應成功——只有 deviceCode 才是換 token 的合法憑證")
	}
}

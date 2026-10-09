package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tim72117/tripace/internal/model"
)

// plan_test.go 測 GET /internal/plan/me 與 POST /internal/plan/claim-fan
// (見 plan.go 開頭的完整說明)。比照 plan_ai_chat_test.go 的風格:用
// httptest + newTestServer,不打真實網路。

// planTestToken 簽一把有效的登入 JWT,並確保對應使用者存在於資料庫——
// 理由同 plan_ai_chat_test.go 的 planAiChatTestToken。
func planTestToken(t *testing.T, s *Server, userID string) string {
	t.Helper()
	if err := s.store.UpsertUser(model.User{ID: userID, Name: "測試使用者"}); err != nil {
		t.Fatalf("upsert test user: %v", err)
	}
	token, err := s.signer.Sign(userID, "測試使用者")
	if err != nil {
		t.Fatalf("簽 token 失敗: %v", err)
	}
	return token
}

func getMyPlan(t *testing.T, routes http.Handler, token string) (*http.Response, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/internal/plan/me", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	routes.ServeHTTP(rec, req)
	resp := rec.Result()
	var body map[string]any
	if resp.Body != nil {
		_ = json.NewDecoder(resp.Body).Decode(&body)
	}
	return resp, body
}

func postClaimFanPlan(t *testing.T, routes http.Handler, token, code string) (*http.Response, map[string]any) {
	t.Helper()
	b, err := json.Marshal(map[string]any{"code": code})
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/internal/plan/claim-fan", bytes.NewReader(b))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	routes.ServeHTTP(rec, req)
	resp := rec.Result()
	var body map[string]any
	if resp.Body != nil {
		_ = json.NewDecoder(resp.Body).Decode(&body)
	}
	return resp, body
}

// TestHandleGetMyPlan_DefaultsToFree 驗證新使用者沒有任何方案紀錄操作時,
// 查詢回來的方案是免費版,且 plans 清單帶有兩個方案定義。
func TestHandleGetMyPlan_DefaultsToFree(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()
	token := planTestToken(t, s, "usr_plan_default")

	resp, body := getMyPlan(t, routes, token)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200,body = %+v", resp.StatusCode, body)
	}
	if body["currentTier"] != string(model.PlanTierFree) {
		t.Fatalf("期待 currentTier = free,實際 = %+v", body["currentTier"])
	}
	currentPlan, _ := body["currentPlan"].(map[string]any)
	if currentPlan == nil {
		t.Fatalf("期待 currentPlan 非空,實際 body = %+v", body)
	}
	if got, want := currentPlan["monthlyAIRequests"], float64(10); got != want {
		t.Fatalf("期待免費版 monthlyAIRequests = %v,實際 = %v", want, got)
	}
	plans, _ := body["plans"].([]any)
	if len(plans) != 2 {
		t.Fatalf("期待 plans 長度為 2,實際 = %+v", plans)
	}
}

// TestHandleGetMyPlan_Guest 驗證未登入(沒帶 token,userFor 回退訪客)
// 查詢方案被拒絕。
func TestHandleGetMyPlan_Guest(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	resp, body := getMyPlan(t, routes, "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("狀態碼 = %d,期待 401,body = %+v", resp.StatusCode, body)
	}
}

// TestHandleClaimFanPlan_RequiresLogin 驗證未登入呼叫 claim-fan 被拒絕,
// 即使 code 剛好正確也一樣——必須先登入才有「自己的帳號」可以標記方案。
func TestHandleClaimFanPlan_RequiresLogin(t *testing.T) {
	t.Setenv("FAN_PLAN_CLAIM_CODE", "secret-code")
	s := newTestServer(t)
	routes := s.Routes()

	resp, body := postClaimFanPlan(t, routes, "", "secret-code")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("狀態碼 = %d,期待 401,body = %+v", resp.StatusCode, body)
	}
}

// TestHandleClaimFanPlan_WrongCode 驗證 code 錯誤時被拒絕,且使用者方案
// 維持不變(仍是免費版)。
func TestHandleClaimFanPlan_WrongCode(t *testing.T) {
	t.Setenv("FAN_PLAN_CLAIM_CODE", "secret-code")
	s := newTestServer(t)
	routes := s.Routes()
	token := planTestToken(t, s, "usr_plan_wrong_code")

	resp, body := postClaimFanPlan(t, routes, token, "wrong-code")
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("狀態碼 = %d,期待 400,body = %+v", resp.StatusCode, body)
	}

	// 確認沒有被誤升級。
	_, meBody := getMyPlan(t, routes, token)
	if meBody["currentTier"] != string(model.PlanTierFree) {
		t.Fatalf("code 錯誤後方案應維持 free,實際 = %+v", meBody["currentTier"])
	}
}

// TestHandleClaimFanPlan_NotConfigured 驗證伺服器未設定
// FAN_PLAN_CLAIM_CODE 時(空字串),任何 code 都視為無效——不洩漏
// 「功能尚未啟用」這個內部狀態(見 handleClaimFanPlan 的完整說明)。
func TestHandleClaimFanPlan_NotConfigured(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()
	token := planTestToken(t, s, "usr_plan_not_configured")

	resp, body := postClaimFanPlan(t, routes, token, "")
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("狀態碼 = %d,期待 400,body = %+v", resp.StatusCode, body)
	}
}

// TestHandleClaimFanPlan_Success 驗證 code 正確時,使用者方案被更新成
// fan,且回應立刻帶回更新後的方案資訊——之後查詢 GET /internal/plan/me
// 也要反映同樣的結果(確認真的寫進資料庫,不是只有回應騙人)。
func TestHandleClaimFanPlan_Success(t *testing.T) {
	t.Setenv("FAN_PLAN_CLAIM_CODE", "secret-code")
	s := newTestServer(t)
	routes := s.Routes()
	token := planTestToken(t, s, "usr_plan_claim_ok")

	resp, body := postClaimFanPlan(t, routes, token, "secret-code")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200,body = %+v", resp.StatusCode, body)
	}
	if body["currentTier"] != string(model.PlanTierFan) {
		t.Fatalf("期待 currentTier = fan,實際 = %+v", body["currentTier"])
	}

	_, meBody := getMyPlan(t, routes, token)
	if meBody["currentTier"] != string(model.PlanTierFan) {
		t.Fatalf("核發後查詢應回傳 fan,實際 = %+v", meBody["currentTier"])
	}
}

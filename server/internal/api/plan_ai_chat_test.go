package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tim72117/tripace/internal/model"
)

// plan_ai_chat_test.go 測 POST /internal/plan-ai/chat 與
// POST /internal/plan-ai/chat/reply(見 plan_ai_chat.go 開頭的完整說明)。

// planAiChatTestToken 簽一把有效的登入 JWT,並確保對應使用者存在於資料庫
// (handlePlanAiChat/handlePlanAiChatReply 都會呼叫 s.userFor(r) 查
// FindUserByID,不存在會退回訪客,見 isGuestUser 的完整說明)。
func planAiChatTestToken(t *testing.T, s *Server, userID string) string {
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

func postPlanAiChat(t *testing.T, routes http.Handler, token string, body map[string]any) (*http.Response, map[string]any) {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/internal/plan-ai/chat", bytes.NewReader(b))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	routes.ServeHTTP(rec, req)
	resp := rec.Result()
	var respBody map[string]any
	if resp.Body != nil {
		_ = json.NewDecoder(resp.Body).Decode(&respBody)
	}
	return resp, respBody
}

func postPlanAiChatReply(t *testing.T, routes http.Handler, token string, body map[string]any) (*http.Response, map[string]any) {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/internal/plan-ai/chat/reply", bytes.NewReader(b))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	routes.ServeHTTP(rec, req)
	resp := rec.Result()
	var respBody map[string]any
	if resp.Body != nil {
		_ = json.NewDecoder(resp.Body).Decode(&respBody)
	}
	return resp, respBody
}

// TestHandlePlanAiChat_Success 驗證成功送訊息的基本流程:沒帶
// conversationID 視為開新對話,回應帶回正規化(trim)後的 content。
func TestHandlePlanAiChat_Success(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()
	token := planAiChatTestToken(t, s, "usr_chat_ok")

	resp, body := postPlanAiChat(t, routes, token, map[string]any{
		"content": "  幫我規劃台南兩天一夜行程  ",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200,body = %+v", resp.StatusCode, body)
	}
	convID, _ := body["conversationID"].(string)
	if convID == "" {
		t.Fatalf("期待回傳非空 conversationID,實際 body = %+v", body)
	}
	content, _ := body["content"].(string)
	if content != "幫我規劃台南兩天一夜行程" {
		t.Fatalf("期待 content 已 trim,得到 %q", content)
	}
	if _, ok := body["messageID"]; !ok {
		t.Fatalf("期待回應帶 messageID,實際 body = %+v", body)
	}
}

// TestHandlePlanAiChat_EmptyContent_Returns400 驗證空白(或純空白字元)訊息
// 被拒絕,不寫入任何記錄。
func TestHandlePlanAiChat_EmptyContent_Returns400(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()
	token := planAiChatTestToken(t, s, "usr_chat_empty")

	resp, body := postPlanAiChat(t, routes, token, map[string]any{
		"content": "   ",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("狀態碼 = %d,期待 400,body = %+v", resp.StatusCode, body)
	}
}

// TestHandlePlanAiChat_ContentTooLong_Returns400 驗證超過
// planAiChatMaxMessageRunes(500 字)的訊息被拒絕。
func TestHandlePlanAiChat_ContentTooLong_Returns400(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()
	token := planAiChatTestToken(t, s, "usr_chat_long")

	tooLong := strings.Repeat("測", planAiChatMaxMessageRunes+1)
	resp, body := postPlanAiChat(t, routes, token, map[string]any{
		"content": tooLong,
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("狀態碼 = %d,期待 400,body = %+v", resp.StatusCode, body)
	}
	errObj, _ := body["error"].(map[string]any)
	if errObj == nil || errObj["code"] != "content_too_long" {
		t.Fatalf("期待 error.code = content_too_long,實際 body = %+v", body)
	}
}

// TestHandlePlanAiChat_GuestRejected 驗證沒有合法 JWT 的請求被擋下——
// internalAuth 理論上已經擋掉完全沒帶 Authorization header 的請求(見
// middleware.go),這裡改驗證 handler 本身對「userFor 退回訪客」這個邊界
// 情況的額外防線(見 isGuestUser 的完整說明)：不帶任何 Authorization
// header 直接打完整路由,應該先被 internalAuth 擋成 401。
func TestHandlePlanAiChat_GuestRejected(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	resp, body := postPlanAiChat(t, routes, "", map[string]any{
		"content": "測試",
	})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("狀態碼 = %d,期待 401,body = %+v", resp.StatusCode, body)
	}
}

// TestHandlePlanAiChatReply_Success 驗證 reply 端點的成功流程:先用
// handlePlanAiChat 建立一筆使用者訊息,拿到 conversationID/messageID 後
// 回報 AI 回覆。
func TestHandlePlanAiChatReply_Success(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()
	token := planAiChatTestToken(t, s, "usr_reply_ok")

	_, chatBody := postPlanAiChat(t, routes, token, map[string]any{"content": "你好"})
	convID, _ := chatBody["conversationID"].(string)
	msgIDFloat, _ := chatBody["messageID"].(float64)

	resp, body := postPlanAiChatReply(t, routes, token, map[string]any{
		"conversationID": convID,
		"messageID":      msgIDFloat,
		"content":        "這是 AI 的回覆",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200,body = %+v", resp.StatusCode, body)
	}
	if ok, _ := body["ok"].(bool); !ok {
		t.Fatalf("期待 ok = true,實際 body = %+v", body)
	}
}

// TestHandlePlanAiChatReply_WrongUser_Returns404 驗證 reply 端點會拒絕
// 「conversationID/messageID 屬於別的使用者」的跨用戶寫入——用使用者 A
// 的 conversationID/messageID,帶使用者 B 的 token 回報,應回 404,不是
// 200。
func TestHandlePlanAiChatReply_WrongUser_Returns404(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()
	tokenA := planAiChatTestToken(t, s, "usr_reply_owner")
	tokenB := planAiChatTestToken(t, s, "usr_reply_intruder")

	_, chatBody := postPlanAiChat(t, routes, tokenA, map[string]any{"content": "使用者 A 的訊息"})
	convID, _ := chatBody["conversationID"].(string)
	msgIDFloat, _ := chatBody["messageID"].(float64)

	resp, body := postPlanAiChatReply(t, routes, tokenB, map[string]any{
		"conversationID": convID,
		"messageID":      msgIDFloat,
		"content":        "使用者 B 想冒充回覆",
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("狀態碼 = %d,期待 404,body = %+v", resp.StatusCode, body)
	}
}

// TestHandlePlanAiChatReply_MissingFields_Returns400 驗證
// conversationID/messageID/content 任一缺漏都會被擋下。
func TestHandlePlanAiChatReply_MissingFields_Returns400(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()
	token := planAiChatTestToken(t, s, "usr_reply_missing")

	cases := []map[string]any{
		{"conversationID": "", "messageID": float64(1), "content": "x"},
		{"conversationID": "conv_x", "messageID": float64(0), "content": "x"},
		{"conversationID": "conv_x", "messageID": float64(1), "content": ""},
	}
	for i, c := range cases {
		resp, body := postPlanAiChatReply(t, routes, token, c)
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("case %d: 狀態碼 = %d,期待 400,body = %+v", i, resp.StatusCode, body)
		}
	}
}

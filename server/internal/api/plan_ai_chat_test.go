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
	return postPlanAiChatTo(t, routes, "/internal/plan-ai/chat", token, "", body)
}

// postPlanAiChatTo——postPlanAiChat 的通用版本,額外接受自訂路徑(供測試
// /public/plan-ai/chat 這條新路由)與 guestID(帶上 X-Guest-Id header,
// 空字串代表不帶這個 header)。token 與 guestID 可以同時傳空字串,模擬
// 「完全沒有身分資訊」的請求。
func postPlanAiChatTo(t *testing.T, routes http.Handler, path, token, guestID string, body map[string]any) (*http.Response, map[string]any) {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(b))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if guestID != "" {
		req.Header.Set(guestIDHeader, guestID)
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
	return postPlanAiChatReplyTo(t, routes, "/internal/plan-ai/chat/reply", token, "", body)
}

// postPlanAiChatReplyTo——postPlanAiChatReply 的通用版本,理由同
// postPlanAiChatTo。
func postPlanAiChatReplyTo(t *testing.T, routes http.Handler, path, token, guestID string, body map[string]any) (*http.Response, map[string]any) {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(b))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if guestID != "" {
		req.Header.Set(guestIDHeader, guestID)
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

// TestHandlePlanAiChat_GuestRejected 驗證完全沒有身分資訊(沒 JWT、也沒
// X-Guest-Id)的請求被擋下——internalAuth 本身會先擋掉沒帶 Authorization
// header 打 /internal/plan-ai/chat 的請求(見 middleware.go),這裡改打
// /public/plan-ai/chat(2026-10 新增的訪客公開路由,不經過 internalAuth,
// 見 api.go Routes 內該區塊的完整說明)驗證 handler 本身
// userOrGuestFor(見該函式的完整說明)對「兩種身分資訊都沒有」這個情況
// 的防線——沒有 X-Guest-Id 時不該悄悄放行成某種共用身分。
func TestHandlePlanAiChat_GuestRejected(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	resp, body := postPlanAiChatTo(t, routes, "/public/plan-ai/chat", "", "", map[string]any{
		"content": "測試",
	})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("狀態碼 = %d,期待 401,body = %+v", resp.StatusCode, body)
	}
}

// TestHandlePlanAiChat_InternalRouteStillRequiresLogin 驗證
// /internal/plan-ai/chat(需登入版)在完全沒帶 Authorization header 時仍然
// 被 internalAuth 中間件擋下(2026-10 新增公開版 /public/plan-ai/chat 之後
// 這條既有行為要維持不變,不能因為新增訪客路徑而連帶放寬了需登入版的
// 保護)。
func TestHandlePlanAiChat_InternalRouteStillRequiresLogin(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	resp, body := postPlanAiChat(t, routes, "", map[string]any{
		"content": "測試",
	})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("狀態碼 = %d,期待 401,body = %+v", resp.StatusCode, body)
	}
}

// TestHandlePlanAiChat_PublicRoute_GuestWithValidID_Success 驗證
// /public/plan-ai/chat(訪客公開路由)帶合法格式的 X-Guest-Id 時能成功
// 送出訊息——沒有 Authorization header,不需要登入。
func TestHandlePlanAiChat_PublicRoute_GuestWithValidID_Success(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	resp, body := postPlanAiChatTo(t, routes, "/public/plan-ai/chat", "", "guest_abc123", map[string]any{
		"content": "訪客的訊息",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200,body = %+v", resp.StatusCode, body)
	}
	if _, ok := body["conversationID"]; !ok {
		t.Fatalf("期待回應帶 conversationID,實際 body = %+v", body)
	}
}

// TestHandlePlanAiChat_PublicRoute_InvalidGuestID_Returns401 驗證
// X-Guest-Id 格式不符(不是 guest_ 前綴,例如惡意呼叫端嘗試冒充真實帳號
// 的 usr_ ID)時一律拒絕,不會把任意字串直接當成 userID 使用——見
// userOrGuestFor 的完整說明:若不檢查前綴,呼叫端能把 X-Guest-Id 設成
// 已知的真實使用者 ID,讓這筆訪客訊息被誤植到別人帳號底下。
func TestHandlePlanAiChat_PublicRoute_InvalidGuestID_Returns401(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	cases := []string{
		"usr_someone_else", // 嘗試冒充真實帳號格式
		"guest_",           // 前綴正確但內容為空
		"not-a-valid-id",
	}
	for _, guestID := range cases {
		resp, body := postPlanAiChatTo(t, routes, "/public/plan-ai/chat", "", guestID, map[string]any{
			"content": "測試",
		})
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("guestID=%q: 狀態碼 = %d,期待 401,body = %+v", guestID, resp.StatusCode, body)
		}
	}
}

// TestHandlePlanAiChatReply_PublicRoute_DifferentGuests_Returns404 驗證
// 兩個不同的訪客(各自獨立的 X-Guest-Id)無法互相讀寫對方的對話記錄——
// 這正是 userOrGuestFor 要求訪客必須帶各自獨立 id(而不是共用固定的
// guestUser.ID)的理由,見該函式的完整說明:若訪客共用同一個 userID,
// 這個測試會失敗(訪客 B 能成功回報訪客 A 的對話)。
func TestHandlePlanAiChatReply_PublicRoute_DifferentGuests_Returns404(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	_, chatBody := postPlanAiChatTo(t, routes, "/public/plan-ai/chat", "", "guest_owner", map[string]any{
		"content": "訪客 A 的訊息",
	})
	convID, _ := chatBody["conversationID"].(string)
	msgIDFloat, _ := chatBody["messageID"].(float64)

	resp, body := postPlanAiChatReplyTo(t, routes, "/public/plan-ai/chat/reply", "", "guest_intruder", map[string]any{
		"conversationID": convID,
		"messageID":      msgIDFloat,
		"content":        "訪客 B 想冒充回覆",
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("狀態碼 = %d,期待 404,body = %+v", resp.StatusCode, body)
	}
}

// TestHandlePlanAiChatReply_PublicRoute_SameGuest_Success 驗證同一個訪客
// (相同 X-Guest-Id)能正常對自己開的對話回報內容——確保上一個測試驗證
// 的是「跨訪客」被擋,而不是訪客身分整個無法使用 reply 端點。
func TestHandlePlanAiChatReply_PublicRoute_SameGuest_Success(t *testing.T) {
	s := newTestServer(t)
	routes := s.Routes()

	_, chatBody := postPlanAiChatTo(t, routes, "/public/plan-ai/chat", "", "guest_self", map[string]any{
		"content": "訪客的訊息",
	})
	convID, _ := chatBody["conversationID"].(string)
	msgIDFloat, _ := chatBody["messageID"].(float64)

	resp, body := postPlanAiChatReplyTo(t, routes, "/public/plan-ai/chat/reply", "", "guest_self", map[string]any{
		"conversationID": convID,
		"messageID":      msgIDFloat,
		"content":        "AI 的回覆",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("狀態碼 = %d,期待 200,body = %+v", resp.StatusCode, body)
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

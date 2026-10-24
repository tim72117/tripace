package api

import (
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/tim72117/tripace/internal/model"
)

// guestIDHeader 是前端(web/src/guestId.ts)帶上的訪客識別碼 header——
// 每個瀏覽器各自生成一個隨機 id、存在 localStorage,每次沒有登入 token
// 的請求都帶上(見該檔案與 web/src/api.ts request() 的完整說明)。
const guestIDHeader = "X-Guest-Id"

// guestIDPrefix 是前端生成訪客 id 時固定使用的前綴(見 guestId.ts
// randomGuestId)。這裡驗證收到的值確實以這個前綴開頭,而不是直接信任
// 呼叫端送來的任意字串當 userID——真實帳號 ID 固定是 "usr_" 前綴(見
// newID 的呼叫端慣例),若不檢查前綴,惡意呼叫端可以把 X-Guest-Id 設成
// 任意已知的真實 usr_ ID,讓這次訪客對話記錄被誤植到別人的帳號底下
// (InsertPlanAiChatMessage 原樣把這個字串存進 user_id 欄位,沒有另外的
// 資料庫層級檢查)。
const guestIDPrefix = "guest_"

// userOrGuestFor 解析這次請求的身分,同時支援兩種情境:
//
//  1. 已登入:s.userFor(r) 拿到真實使用者(見該函式的完整說明)。
//  2. 未登入訪客:帶著合法格式的 X-Guest-Id header——這是 2026-10
//     使用者明確要求「/internal/plan-ai/chat 要沒登入時也可以做」、
//     「沒有登入時給一個獨立 id」後新增的分支。背景:這支端點原本對
//     s.isGuestUser(user)(即 userFor 在沒有合法 JWT 時回退的那個固定
//     共用身分,ID 固定 "usr_me")一律擋掉——如果直接放行、讓所有訪客
//     共用這個固定 ID,PlanAiChatMessageBelongsToUser(見該函式的完整
//     說明)會把「這個 userID 底下的任一筆對話記錄」都判定為「屬於
//     你」,等於任一訪客都能對另一個訪客開的 conversationID 回報內容,
//     是真正的跨訪客資料污染/竄改風險,不只是體驗問題。改成每個訪客
//     各自帶一個獨立、不跟真實帳號格式衝突的 id(guestIDPrefix 開頭),
//     用它取代固定的 guestUser.ID 當這次請求的身分,訪客彼此之間就
//     跟真實使用者之間一樣,靠不同的 userID 天然互相隔離。
//
// 回傳的第二個值為 false 代表兩種情境都不成立(真的沒登入、也沒有帶
// 合法格式的 X-Guest-Id)——呼叫端應視為未授權,比照既有的 401 回應
// 慣例處理。
//
// 這支函式刻意只放在 plan_ai_chat.go、只給這兩支 handler 使用,不是
// 改寫 auth.go 的 userFor 本身或 internalAuth 中間件——userFor/
// internalAuth 是全站共用的身分解析與路由保護機制,若在那一層放行帶
// X-Guest-Id header 的請求,會讓所有掛在 internalAuth 底下、原本假設
// 「通過這層就代表已登入」的端點都意外被訪客繞過,是嚴重的權限範圍
// 擴大。這裡的放行範圍刻意收斂到「呼叫端明確呼叫了這支函式的這兩支
// handler」,不會外溢到其他端點。
func (s *Server) userOrGuestFor(r *http.Request) (model.User, bool) {
	user := s.userFor(r)
	if !s.isGuestUser(user) {
		return user, true
	}
	guestID := strings.TrimSpace(r.Header.Get(guestIDHeader))
	if !strings.HasPrefix(guestID, guestIDPrefix) || guestID == guestIDPrefix {
		return model.User{}, false
	}
	return model.User{ID: guestID, Name: "訪客"}, true
}

// plan_ai_chat.go — AI 規劃對話(/app 的 web/src/planning/panel/TripPlanPage.tsx)
// 訊息先經過 tripace 自家後端這一段的端點。
//
// 背景:TripPlanPage.tsx 原本直接拿瀏覽器可見的
// VITE_PLAN_AI_ONAGENT_APP_KEY 建立 WebSocket 直連 onagent,沒有任何自家
// 後端的 rate-limit 或訊息記錄。比照 /Users/caitingyu/Documents/
// ai-support/backend 的 internal/public/public.go 開頭說明的流程(另一個
// 專案,行為參考,不是程式碼依賴):
//
//  1. 使用者在前端送出訊息前,先呼叫這裡的 POST /internal/plan-ai/chat——
//     這支端點驗證、rate-limit、存記錄,回傳正規化後的內容。
//  2. 前端拿這支端點回傳的 content(不是使用者原始輸入)轉發給 onagent。
//  3. onagent 回覆後,前端呼叫 POST /internal/plan-ai/chat/reply 把回覆
//     存檔。
//
// 與 ai-support 的差異(刻意的簡化,見任務範圍限制):
//   - 訊息記錄只關聯 userID,不關聯 tripID——AI 規劃本身不依附特定旅程
//     (見 TripPlanPage.tsx 裡 usePlanAiChatBridge 附近「不接 tripID」的
//     既有註解),跟 ai-support 用 businessID 當租戶維度的做法不同。
//   - 這次先不做配額限制(ai-support 有 quota.Service 檢查
//     business owner 的用量上限),只做 rate-limit + 存記錄。
//   - 工具呼叫(search_attraction/add_attraction 等,走
//     /internal/geo/plan-ai/* 端點,見 geo_plan_ai.go)完全不動,不在這批
//     端點的範圍內。
//
// 兩支端點都掛在 internalAuth 底下(見 api.go 的 /internal/plan-ai/*
// 區塊,跟 /internal/geo/plan-ai/* 用同一組 internalMux)——這組端點理論
// 上已經擋掉未登入請求,但 s.userFor(r) 本身的 fallback 行為是回傳訪客
// (guestUser,ID 固定 "usr_me",見 userFor/userFromToken 的完整說明),
// 不是回 401,故 handler 內仍需明確擋掉訪客呼叫。

// planAiChatMaxMessageRunes 是訊息內容長度上限——沿用
// ai-support/backend(internal/public/public.go 的 MaxMessageRunes)的
// 500 字數字,理由是那裡對齊 onagent 預設的 per-prompt 長度限制
// (inference.defaultMaxPromptLength = 500);tripace 這裡的 onagent app
// 設定若之後跟那個預設值不同,需要調整這個常數。
const planAiChatMaxMessageRunes = 500

// isGuestUser 判斷這個 user 是不是 s.guestUser 這個固定的訪客身分
// (ID 固定 "usr_me",見 userFor/userFromToken 的完整說明:token 無效、
// 或簽章有效但對應使用者已不存在於資料庫時一律回退成這個值)——
// handlePlanAiChat/handlePlanAiChatReply 都需要明確擋掉這個情境,不能
// 假設掛在 internalAuth 底下就等於一定是真實使用者。
func (s *Server) isGuestUser(u model.User) bool {
	return u.ID == s.guestUser.ID
}

// planAiChatRequest 是 POST /internal/plan-ai/chat 的請求 body——
// conversationID 選填,沒有就視為開新對話(見 handlePlanAiChat)。
type planAiChatRequest struct {
	ConversationID string `json:"conversationID"`
	Content        string `json:"content"`
}

// planAiChatResponse 是 POST /internal/plan-ai/chat 的回應形狀。
// content 是存檔後、經過這支端點正規化(trim)的內容,不是使用者原始
// 輸入——前端後續把這個值轉發給 onagent,概念上一致但正規化的職責收在
// 後端這一層,前端不需要重複處理。
type planAiChatResponse struct {
	ConversationID string `json:"conversationID"`
	MessageID      int64  `json:"messageID"`
	Content        string `json:"content"`
}

// POST /internal/plan-ai/chat(需登入)、POST /public/plan-ai/chat(2026-10
// 新增,未登入訪客版,見 api.go Routes 內該區塊的完整說明與
// withPlanAiChatIPThrottle)——兩個路徑共用同一支 handler,行為差異只在
// 訪客版額外疊加一層 IP 節流(路由層面),handler 本身的邏輯完全相同。
// Body: { "conversationID": "可選,沒有就開新對話", "content": "訊息內容" }
//
// 使用者送出 AI 規劃訊息前的第一站:驗證身分、per-user rate-limit、
// 驗證並正規化 content、存一筆 role="user" 的記錄,回傳給前端轉發給
// onagent。
func (s *Server) handlePlanAiChat(w http.ResponseWriter, r *http.Request) {
	// userOrGuestFor(見該函式的完整說明)——2026-10 改成同時支援已登入
	// 使用者與帶合法格式 X-Guest-Id 的未登入訪客,不再無條件擋掉訪客。
	// ok 為 false 代表兩者皆非(真的沒登入、也沒有帶合法格式的訪客 id),
	// 一律視同未登入,要求重新登入或改用展示頁(措辭比照 internalAuth
	// 對一般 token 失效的既有慣例)。
	user, ok := s.userOrGuestFor(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "登入已過期,請重新登入")
		return
	}

	// per-user rate-limit:見 planAiChatRateLimiter 欄位與
	// planAiChatRateLimitWindow/MaxCalls 的完整說明——懶惰呼叫
	// SetLimitForKey,理由同 throttleGeoQueryByUser 的既有慣例。
	s.planAiChatRateLimiter.SetLimitForKey(user.ID, planAiChatRateLimitWindow, planAiChatRateLimitMaxCalls)
	if !s.planAiChatRateLimiter.Allow(user.ID) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited", "訊息送得太快了,請稍後再試")
		return
	}

	var body planAiChatRequest
	if !decode(w, r, &body) {
		return
	}
	content := strings.TrimSpace(body.Content)
	if content == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "訊息內容不可為空")
		return
	}
	if utf8.RuneCountInString(content) > planAiChatMaxMessageRunes {
		writeErr(w, http.StatusBadRequest, "content_too_long", "訊息內容過長,最多 500 字")
		return
	}

	conversationID := strings.TrimSpace(body.ConversationID)
	if conversationID == "" {
		// 沒帶 conversationID 視為開新對話——用跟其餘資源相同的
		// newID() 慣例產生,不依賴資料庫自增 ID(ConversationID 不是
		// 這張表的主鍵,見 model.PlanAiChatMessage 的完整說明)。
		conversationID = "conv_" + newID()
	}

	msg, err := s.store.InsertPlanAiChatMessage(user.ID, conversationID, "user", content)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "store_failed", "訊息記錄寫入失敗")
		return
	}

	writeJSON(w, http.StatusOK, planAiChatResponse{
		ConversationID: msg.ConversationID,
		MessageID:      msg.ID,
		Content:        msg.Content,
	})
}

// planAiChatReplyRequest 是 POST /internal/plan-ai/chat/reply 的請求
// body——三個欄位皆必填:conversationID/messageID 用來確認這則回覆對應
// 的是呼叫端自己先前送出的訊息(見下方權限檢查),content 是 onagent
// 回覆的內容。
type planAiChatReplyRequest struct {
	ConversationID string `json:"conversationID"`
	MessageID      int64  `json:"messageID"`
	Content        string `json:"content"`
}

// POST /internal/plan-ai/chat/reply(需登入)、POST /public/plan-ai/chat/reply
// (2026-10 新增,未登入訪客版,見 handlePlanAiChat 開頭對兩個路徑共用
// 同一支 handler 的完整說明)
// Body: { "conversationID", "messageID", "content" }
//
// onagent 回覆後,前端呼叫這裡把回覆存檔——role="assistant"。
// messageID 必須是呼叫端自己這個 userID 底下、屬於 conversationID 的一筆
// 既有記錄(即 handlePlanAiChat 回傳過的 messageID),否則一律回 404,
// 不洩漏「這個 ID 其實存在,只是不是你的」這個資訊(理由同
// store.PlanAiChatMessageBelongsToUser 的完整說明;對齊
// handlePublicGeoAttractionByID 對「呼叫端傳來的 id 沒有對應到自己資料」
// 這種情境一律回標準 404 的既有慣例,而不是 403——404 讓呼叫端不需要
// 分辨「不存在」與「存在但不是你的」兩種狀態)。
//
// 這裡的權限邊界(PlanAiChatMessageBelongsToUser 用 userID 比對)正是
// userOrGuestFor 要求訪客必須帶各自獨立 X-Guest-Id 的理由:若訪客共用
// 固定的 guestUser.ID,任一訪客都能對另一個訪客開的 conversationID/
// messageID 呼叫這支端點並通過這裡的檢查,見該函式的完整說明。
func (s *Server) handlePlanAiChatReply(w http.ResponseWriter, r *http.Request) {
	user, ok := s.userOrGuestFor(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "登入已過期,請重新登入")
		return
	}

	var body planAiChatReplyRequest
	if !decode(w, r, &body) {
		return
	}
	conversationID := strings.TrimSpace(body.ConversationID)
	content := strings.TrimSpace(body.Content)
	if conversationID == "" || body.MessageID <= 0 || content == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "conversationID、messageID、content 皆不可為空")
		return
	}

	belongs, err := s.store.PlanAiChatMessageBelongsToUser(conversationID, body.MessageID, user.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "store_failed", "查詢訊息記錄失敗")
		return
	}
	if !belongs {
		writeErr(w, http.StatusNotFound, "not_found", "查無這則對話訊息")
		return
	}

	if _, err := s.store.InsertPlanAiChatMessage(user.ID, conversationID, "assistant", content); err != nil {
		writeErr(w, http.StatusInternalServerError, "store_failed", "訊息記錄寫入失敗")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

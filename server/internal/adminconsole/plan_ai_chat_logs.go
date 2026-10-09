// AI 規劃對話訊息記錄(GET /admin/api/plan-ai-chat-logs)。顯示所有使用者的
// 所有 AI 規劃對話訊息(/trip-plan,web/src/trip-plan/TripPlanPage.tsx),
// 依 CreatedAt 降冪排序(最新在前)——是一張列出全部訊息的表格,類似 log
// 瀏覽器,不是先選使用者才看單一對話。讀取來源是
// server/internal/store/plan_ai_chat.go 寫入的 plan_ai_chat_messages 表。
package adminconsole

import (
	"net/http"
	"strconv"

	"github.com/tim72117/tripace/internal/adminauth"
	"github.com/tim72117/tripace/internal/model"
)

// planAiChatLogEntry 是單筆回應項目,比照 model.PlanAiChatMessage 的欄位,
// 額外附上 UserEmail(見下方 listPlanAiChatLogs 的查詢說明)。
type planAiChatLogEntry struct {
	model.PlanAiChatMessage
	UserEmail string `json:"userEmail"`
}

// planAiChatLogsResponse 是 GET /admin/api/plan-ai-chat-logs 的回應格式,
// 比照 usersResponse/requestStatsResponse 的既有慣例,用
// 「total + 資料陣列」的物件包裝,而非單純回傳一個 JSON 陣列——這樣之後
// 要加其他統計欄位(如總訊息數、不同於目前這批 limit 回傳的筆數)不需要
// 改變回應的最外層型別。
type planAiChatLogsResponse struct {
	Total    int                  `json:"total"`
	Messages []planAiChatLogEntry `json:"messages"`
}

// listPlanAiChatLogs 讀 ?limit= 查詢參數決定回傳筆數(預設 200 筆,最大
// 1000 筆——這張表會隨每一次使用者傳訊息/AI 回覆持續累積,且單筆內容
// (Content)可能是很長的一段文字,不像 request_stats 那種輕量數字列,不
// 限制筆數的話單次查詢/單次回應 payload 都可能明顯拖慢管理後台頁面載入;
// 200 筆已經足夠操作者瀏覽「最近發生了什麼」,真要看更久以前的紀錄可以
// 自行調高 limit,但設一個上限避免誤帶極大值整張表掃出來)。
//
// userEmail 的取得方式:這裡刻意不在 SQL 查詢裡對 users 表逐筆 JOIN 或
// N+1 查詢——plan_ai_chat_messages 的 UserID 沒有特別的筆數上限假設,同一
// 個使用者可能有大量訊息,逐筆查 users 表會是「訊息筆數次」查詢。改用
// Store.ListUsers()(UsersTab 用的同一支方法)一次性撈出全部使用者、在
// 記憶體裡建 ID -> Email 的對照表,整個端點固定只有兩次查詢(訊息 +
// 使用者清單),跟訊息筆數、使用者筆數都無關——使用者總數在這個產品的
// 量級下(見 UsersTab 同樣沒有分頁)一次性撈全部是可接受的作法。查無對應
// 使用者(帳號後來被刪除等情況)時 UserEmail 留空字串,前端顯示時退回顯示
// UserID,不視為錯誤。
func (h *Handler) listPlanAiChatLogs(w http.ResponseWriter, r *http.Request, _ *adminauth.Admin) {
	const defaultLimit = 200
	const maxLimit = 1000

	limit := defaultLimit
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
			if limit > maxLimit {
				limit = maxLimit
			}
		}
	}

	messages, err := h.Store.ListPlanAiChatMessages(limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// 不需要再對 messages 做 nil 檢查——store.ListPlanAiChatMessages 內部
	// 用 make([]model.PlanAiChatMessage, 0, len(rows)) 建立回傳值,查詢
	// 結果為零筆時回傳的是空 slice 而非 nil(見該函式的完整說明)。

	emailByUserID := map[string]string{}
	if users, err := h.Store.ListUsers(); err == nil {
		for _, u := range users {
			emailByUserID[u.ID] = u.Email
		}
	}
	// 刻意忽略 ListUsers 的錯誤而非讓整個端點失敗——使用者清單查詢失敗
	// 不該連帶讓訊息記錄也看不到,退回全部顯示空 email(前端再退回顯示
	// UserID)比整頁報錯更有用。

	out := make([]planAiChatLogEntry, 0, len(messages))
	for _, m := range messages {
		out = append(out, planAiChatLogEntry{
			PlanAiChatMessage: m,
			UserEmail:         emailByUserID[m.UserID],
		})
	}

	writeJSON(w, http.StatusOK, planAiChatLogsResponse{Total: len(out), Messages: out})
}

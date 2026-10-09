package store

import (
	"github.com/tim72117/tripace/internal/model"
)

// plan_ai_chat.go — AI 規劃對話訊息記錄的資料存取層,服務
// internal/api/plan_ai_chat.go 的 handlePlanAiChat/handlePlanAiChatReply。
// 見 model.PlanAiChatMessage 的完整說明:只關聯 UserID,刻意不綁 TripID。

func toPlanAiChatMessage(r planAiChatMessageRow) model.PlanAiChatMessage {
	return model.PlanAiChatMessage{
		ID:             r.ID,
		UserID:         r.UserID,
		ConversationID: r.ConversationID,
		Role:           r.Role,
		Content:        r.Content,
		CreatedAt:      r.CreatedAt,
	}
}

// InsertPlanAiChatMessage 寫入一筆 AI 規劃對話訊息記錄,回傳寫入後的完整
// 記錄(含資料庫指派的自增 ID 與 CreatedAt)——呼叫端(handlePlanAiChat/
// handlePlanAiChatReply)需要 ID 組回應,CreatedAt 則由這裡統一用 now()
// 填入,不假設呼叫端已經設好時間,理由同 geo_rate_limits.go 其餘寫入
// 方法的既有慣例。
func (s *Store) InsertPlanAiChatMessage(userID, conversationID, role, content string) (model.PlanAiChatMessage, error) {
	r := planAiChatMessageRow{
		UserID:         userID,
		ConversationID: conversationID,
		Role:           role,
		Content:        content,
		CreatedAt:      now(),
	}
	if err := s.db.Create(&r).Error; err != nil {
		return model.PlanAiChatMessage{}, err
	}
	return toPlanAiChatMessage(r), nil
}

// PlanAiChatMessageBelongsToUser 確認 conversationID 底下是否存在一筆
// messageID 符合、且 UserID 等於傳入 userID 的訊息記錄——供
// handlePlanAiChatReply 防止跨使用者寫入用(使用者 A 不能對使用者 B 的
// conversationID/messageID 回報 AI 回覆)。
//
// 回傳 (true, nil) 代表這筆記錄存在且屬於這個 userID;(false, nil) 代表
// 查無這筆記錄,或記錄存在但屬於別的使用者——呼叫端不需要分辨這兩種
// 「查無資料」情境(對外一律視為「這個 conversationID/messageID 不屬於
// 你」,不洩漏「這個 ID 其實存在,只是不是你的」這個資訊,理由同
// GetAttraction 對 ErrRecordNotFound 的既有處理慣例,不把 gorm 的
// ErrRecordNotFound 原樣往上傳)。
func (s *Store) PlanAiChatMessageBelongsToUser(conversationID string, messageID int64, userID string) (bool, error) {
	var count int64
	err := s.db.Model(&planAiChatMessageRow{}).
		Where("conversation_id = ? AND id = ? AND user_id = ?", conversationID, messageID, userID).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// ListPlanAiChatMessages 列出最近的 AI 規劃對話訊息,依 CreatedAt 降冪排序
// (最新在前),供管理後台「AI 規劃對話」分頁(adminconsole 的
// listPlanAiChatLogs)顯示所有使用者的訊息紀錄用——跟
// PlanAiChatMessageBelongsToUser 不同,這裡刻意不過濾 UserID,因為管理後台
// 要看的是全站訊息,不是單一使用者的對話。
//
// limit 必須 > 0(呼叫端已先決定好預設值/上限,見 adminconsole 該端點的
// 註解說明理由),這裡不自己補預設值——store 層只單純照給定的 limit 查詢,
// 避免「預設值該是多少」這個產品判斷分散在兩層各自維護一份。
func (s *Store) ListPlanAiChatMessages(limit int) ([]model.PlanAiChatMessage, error) {
	var rows []planAiChatMessageRow
	if err := s.db.Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]model.PlanAiChatMessage, 0, len(rows))
	for _, r := range rows {
		out = append(out, toPlanAiChatMessage(r))
	}
	return out, nil
}

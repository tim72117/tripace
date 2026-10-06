package model

import (
	"encoding/json"
	"time"
)

// themePageJSON 是 ThemePage 對外序列化的實際形狀——Content 在這裡是
// json.RawMessage(原始 JSON bytes,不先解析成具體 struct),讓
// MarshalJSON 能把它當成一個巢狀物件直接拼進外層 JSON,而不是把整份
// ThemePageContent 字串當成一個普通字串欄位(那樣前端拿到的會是
// "content": "{\"version\":1,...}" 這種雙重編碼,還要再解析一次)。
// 見 ThemePage.Content 欄位的完整說明。
type themePageJSON struct {
	ID        string          `json:"id"`
	Slug      string          `json:"slug"`
	Content   json.RawMessage `json:"content"`
	Status    string          `json:"status"`
	UpdatedBy string          `json:"updatedBy,omitempty"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// MarshalJSON 把 Content(原始 JSON 字串)當成巢狀物件輸出,而不是
// Go 預設會做的「字串欄位 = 加雙引號轉義」。Content 為空字串時
// (理論上不該發生,CreateThemePage/UpdateThemePageContent 都要求非空)
// 輸出 null,避免傳一個空字串給 json.RawMessage 造成 json.Marshal 出
// 語法錯誤的 JSON。
func (t ThemePage) MarshalJSON() ([]byte, error) {
	raw := json.RawMessage(t.Content)
	if len(raw) == 0 {
		raw = json.RawMessage("null")
	}
	return json.Marshal(themePageJSON{
		ID:        t.ID,
		Slug:      t.Slug,
		Content:   raw,
		Status:    t.Status,
		UpdatedBy: t.UpdatedBy,
		CreatedAt: t.CreatedAt,
		UpdatedAt: t.UpdatedAt,
	})
}

// Package model 定義 API 與資料層共用的資料結構。
// JSON 欄位對齊 docs/API.md,讓 iOS App 的 Codable 模型可直接解析。
package model

import "time"

type Channel struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	OwnerID            string    `json:"ownerID"`
	MemberCount        int       `json:"memberCount"`
	LastMessagePreview *string   `json:"lastMessagePreview"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

// Message 是使用者說的「原話」:純文字 + 作者 + 時間。
// LLM 處理後的結構化資訊(分類/標籤/摘要/事件時間)改放在 Entry。
type Message struct {
	ID         string    `json:"id"`
	ChannelID  string    `json:"channelID"`
	AuthorID   string    `json:"authorID"`
	AuthorName string    `json:"authorName"`
	Text       string    `json:"text"`
	CreatedAt  time.Time `json:"createdAt"`
}

// User 是公開身分(成員列表、訊息作者等到處可見),不含私密資料。
type User struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	AvatarColor string `json:"avatarColor"`
}

// 頻道成員角色:決定該成員在頻道內的權限。
const (
	RoleEditor = "editor" // 可修改(記事/編輯條目);owner 預設為此。
	RoleViewer = "viewer" // 只能查詢(自然語言提問),不能記事。
)

// Member 是頻道成員:公開身分 + 在該頻道的角色。
type Member struct {
	User
	Role string `json:"role"` // "editor" | "viewer"
}

// Profile 是使用者的私密資料,只在「自己的帳號」端點回傳。
type Profile struct {
	Email string `json:"email"`
}

// Me 代表登入後的自己:公開身分(user)+ 私密資料(profile)。
// /me、login、register、apple 回傳此結構。
type Me struct {
	User    User    `json:"user"`
	Profile Profile `json:"profile"`
}

// SearchAnswer 對應語意查詢回應。
type SearchAnswer struct {
	Answer          string   `json:"answer"`
	CitedMessageIDs []string `json:"citedMessageIDs"`
	Confidence      *float64 `json:"confidence,omitempty"`
}

// Entry 是主體:LLM 處理訊息後產出的「事件/條目」,承載所有結構化結果。
// 可獨立存在,並可關聯多則來源訊息(多對多)。
type Entry struct {
	ID        string `json:"id"`
	ChannelID string `json:"channelID"`
	Item      string `json:"item"`          // 事項描述
	Start     string `json:"start"`         // 'YYYY-MM-DD HH:MM' 或全日 'YYYY-MM-DD';可空
	End       string `json:"end,omitempty"` // 範圍結束;可空
	AllDay    bool   `json:"allDay"`        // 全日事件
	Location  string `json:"location"`      // 地點(可空);目前由人工/前端填,LLM 暫不自動抽取
	// LLM 標注(原本在 Message 上,改放 Entry;目前先留空,待後續接上 Classify)。
	Category  *string   `json:"category"`
	Tags      []string  `json:"tags"`
	Summary   *string   `json:"summary"`
	CreatedAt time.Time `json:"createdAt"`
}

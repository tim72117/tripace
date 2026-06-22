// Package model 定義 API 與資料層共用的資料結構。
// JSON 欄位對齊 docs/API.md,讓 iOS App 的 Codable 模型可直接解析。
package model

import "time"

type Channel struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	MemberCount        int       `json:"memberCount"`
	LastMessagePreview *string   `json:"lastMessagePreview"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type Message struct {
	ID         string    `json:"id"`
	ChannelID  string    `json:"channelID"`
	AuthorID   string    `json:"authorID"`
	AuthorName string    `json:"authorName"`
	Text       string    `json:"text"`
	Category   *string   `json:"category"`
	Tags       []string  `json:"tags"`
	Summary    *string   `json:"summary"`
	CreatedAt  time.Time `json:"createdAt"`
}

type User struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	AvatarColor string `json:"avatarColor"`
}

// SearchAnswer 對應語意查詢回應。
type SearchAnswer struct {
	Answer          string   `json:"answer"`
	CitedMessageIDs []string `json:"citedMessageIDs"`
	Confidence      *float64 `json:"confidence,omitempty"`
}

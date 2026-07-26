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

// AdminUserSummary 是 /admin/api/users 回傳的單筆使用者資訊,供管理後台的使用者
// 列表使用。刻意只含基本身分欄位——不含方案/額度/用量(那些不在管理後台的
// 整合範圍內)。
type AdminUserSummary struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
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

// PresentedEntry 是查詢回答附帶、要展示給使用者的結構化條目。
// 形狀與 llm.AssistEntry / wanttools.PresentedEntry 一致,讓前端用同一套列表渲染。
// 時間欄位語意同 Entry(見其註解)。
type PresentedEntry struct {
	Title   string     `json:"title"`
	StartAt *time.Time `json:"startAt,omitempty"`
	EndAt   *time.Time `json:"endAt,omitempty"`
	TZ      string     `json:"tz,omitempty"`
	AllDay  bool       `json:"allDay,omitempty"`
}

// SearchAnswer 對應語意查詢回應。
// Entries 為結構化行程項目:回答文字保持簡短,項目改由前端用卡片列表顯示。
type SearchAnswer struct {
	Answer          string           `json:"answer"`
	CitedMessageIDs []string         `json:"citedMessageIDs"`
	Confidence      *float64         `json:"confidence,omitempty"`
	Entries         []PresentedEntry `json:"entries"`
}

// Entry 是主體:LLM 處理訊息後產出的「事件/條目」,承載所有結構化結果。
// 可獨立存在,並可關聯多則來源訊息(多對多)。
//
// 時間欄位(2026-07 從字串改為 timestamptz,見 store/entity.go 的完整說明):
// StartAt/EndAt 是 UTC 絕對時刻,TZ 是事件所屬的 IANA 時區(如 "Asia/Tokyo")。
// 顯示端一律應以 TZ 換算再呈現給使用者,而非用裝置/瀏覽器的當地時區——
// 旅遊行程的時間是「目的地當地時間」,不是「觀看者所在地時間」,兩者在使用者
// 抵達目的地前後會不一致。AllDay=true 時 StartAt 存當日在 TZ 時區的 00:00。
type Entry struct {
	ID        string     `json:"id"`
	ChannelID string     `json:"channelID"`
	Title     string     `json:"title"`             // 事項描述
	StartAt   *time.Time `json:"startAt,omitempty"` // UTC;nil=無時間資訊
	EndAt     *time.Time `json:"endAt,omitempty"`   // UTC;nil=無結束時間
	TZ        string     `json:"tz,omitempty"`      // IANA 時區名,如 "Asia/Tokyo"
	AllDay    bool       `json:"allDay,omitempty"`  // true=全日事件(忽略時刻部分)
	Location  string     `json:"location"`          // 地點(可空)
	Lat       *float64   `json:"lat,omitempty"`     // 緯度(由 Places API 自動補)
	Lng       *float64   `json:"lng,omitempty"`     // 經度
	// 所屬行程(Trip)。後端依時間自動歸組:未歸組為 null。
	TripID *string `json:"tripID,omitempty"`
	// LLM 標注(原本在 Message 上,改放 Entry;目前先留空,待後續接上 Classify)。
	Category  *string        `json:"category"`
	Tags      []string       `json:"tags"`
	Note      *string        `json:"note"`
	Kind      *string        `json:"kind,omitempty"`   // "stay"|"flight"|"activity"|"note"|"car"|"restaurant"|"ticket"
	Detail    map[string]any `json:"detail,omitempty"` // kind 專屬結構化欄位
	CreatedAt time.Time      `json:"createdAt"`
}

// Trip 是 entries 的命名分組(同一趟行程/連續安排)。
// 由後端依時間自動歸組:有跨度的「區間性」事件(如住宿、出差)框出行程範圍,
// 落在範圍內的單點事件(如機票、開會)歸入同一 Trip。時間欄位語意同 Entry。
type Trip struct {
	ID        string     `json:"id"`
	ChannelID string     `json:"channelID"`
	Title     string     `json:"title"`             // 行程名(暫用首筆 entry.Title)
	StartAt   *time.Time `json:"startAt,omitempty"` // 行程起(UTC);可空
	EndAt     *time.Time `json:"endAt,omitempty"`   // 行程訖(UTC);可空
	TZ        string     `json:"tz,omitempty"`      // IANA 時區名
	CreatedAt time.Time  `json:"createdAt"`
}

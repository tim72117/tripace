package store

import "time"

// 以下 entity 是 GORM 的資料表映射(帶 gorm tag),與 API DTO(model.*)分離。
// store 方法負責 entity <-> model 的轉換。

type userRow struct {
	ID           string  `gorm:"primaryKey;column:id"`
	Name         string  `gorm:"column:name;not null"`
	AvatarColor  string  `gorm:"column:avatar_color;not null"`
	AppleSub     *string `gorm:"column:apple_sub;uniqueIndex"` // 可為 NULL
	Email        *string `gorm:"column:email;uniqueIndex"`     // 可為 NULL
	PasswordHash *string `gorm:"column:password_hash"`         // 可為 NULL

	// 多對多:此使用者參與的頻道(透過 members 中介表)。
	Channels []channelRow `gorm:"many2many:members;joinForeignKey:user_id;joinReferences:channel_id"`
}

func (userRow) TableName() string { return "users" }

type channelRow struct {
	ID        string    `gorm:"primaryKey;column:id"`
	Name      string    `gorm:"column:name;not null"`
	OwnerID   string    `gorm:"column:owner_id;not null;default:''"`
	CreatedAt time.Time `gorm:"column:created_at;not null"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null"`

	// Has Many:頻道的訊息(刪頻道時級聯刪訊息)。
	Messages []messageRow `gorm:"foreignKey:ChannelID;constraint:OnDelete:CASCADE"`
	// 多對多:頻道成員(透過 members 中介表)。
	Members []userRow `gorm:"many2many:members;joinForeignKey:channel_id;joinReferences:user_id"`
}

func (channelRow) TableName() string { return "channels" }

// messageRow 是使用者說的「原話」:純文字 + 作者 + 時間。
// LLM 處理後的結構化資訊(分類/標籤/摘要/事件時間)改存在 entryRow。
// 一則 message 可關聯多個 entry(多對多,透過 entry_messages 中介表)。
type messageRow struct {
	ID         string    `gorm:"primaryKey;column:id"`
	ChannelID  string    `gorm:"column:channel_id;not null;index"`
	AuthorID   string    `gorm:"column:author_id;not null"`
	AuthorName string    `gorm:"column:author_name;not null"`
	Text       string    `gorm:"column:text;not null"`
	CreatedAt  time.Time `gorm:"column:created_at;not null"`
}

func (messageRow) TableName() string { return "messages" }

// entryRow 是主體:LLM 處理一則(或多則)訊息後產出的「事件/條目」。
// 承載所有 LLM 結構化結果——事件時間(item/start/end/allDay)與標注(category/tags/summary)。
// entry 可獨立存在(不強制依附 message),並可關聯多則來源 message(多對多)。
type entryRow struct {
	ID        string    `gorm:"primaryKey;column:id"`
	ChannelID string    `gorm:"column:channel_id;not null;index"`
	Item      string    `gorm:"column:item;not null"`
	Start     string    `gorm:"column:start"`
	End       string    `gorm:"column:end_at"` // end 是 SQL 保留字,欄位改名 end_at
	AllDay    bool      `gorm:"column:all_day"`
	Location  string    `gorm:"column:location"` // 地點(可空)
	// LLM 標注(原本在 message 上,改存 entry)。
	Category  *string   `gorm:"column:category"`
	Tags      []string  `gorm:"column:tags;serializer:json"` // JSON 陣列存單一 TEXT 欄位
	Summary   *string   `gorm:"column:summary"`
	CreatedAt time.Time `gorm:"column:created_at;not null"`

	// 多對多:此 entry 的來源訊息(透過 entry_messages 中介表)。
	// 刪 entry 時級聯解除關聯(中介表記錄一併清除)。
	Messages []messageRow `gorm:"many2many:entry_messages;joinForeignKey:entry_id;joinReferences:message_id;constraint:OnDelete:CASCADE"`
}

func (entryRow) TableName() string { return "entries" }

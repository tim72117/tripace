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

	// 多對多:頻道成員(透過 members 中介表)。
	Members []userRow `gorm:"many2many:members;joinForeignKey:channel_id;joinReferences:user_id"`
}

func (channelRow) TableName() string { return "channels" }

// entryRow 是主體:LLM 處理使用者輸入後產出的「事件/條目」。
// 承載所有 LLM 結構化結果——事件時間(item/start/end/allDay)與標注(category/tags/summary)。
// 原話(message)不存後端,改由各裝置端 DB 保存(local-first)。
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
}

func (entryRow) TableName() string { return "entries" }

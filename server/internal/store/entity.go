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

	// 多對多:此使用者參與的行程(透過 members 中介表)。
	Trips []tripRow `gorm:"many2many:members;joinForeignKey:user_id;joinReferences:trip_id"`
}

func (userRow) TableName() string { return "users" }

type tripRow struct {
	ID        string    `gorm:"primaryKey;column:id"`
	Name      string    `gorm:"column:name;not null"`
	OwnerID   string    `gorm:"column:owner_id;not null;default:''"`
	CreatedAt time.Time `gorm:"column:created_at;not null"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null"`

	// 多對多:行程成員(透過 members 中介表)。
	Members []userRow `gorm:"many2many:members;joinForeignKey:trip_id;joinReferences:user_id"`
}

func (tripRow) TableName() string { return "trips" }

// entryRow 是主體:LLM 處理使用者輸入後產出的「事件/條目」。
// 承載所有 LLM 結構化結果——事件時間(title/start/end/allDay)與標注(category/tags/note)。
// 原話(message)不存後端,改由各裝置端 DB 保存(local-first)。
type entryRow struct {
	ID        string   `gorm:"primaryKey;column:id"`
	TripID    string   `gorm:"column:trip_id;not null;index"`
	Title     string   `gorm:"column:title;not null"`
	Start     string   `gorm:"column:start"`
	StartTime string   `gorm:"column:start_time"` // 'HH:MM';空=全日
	End       string   `gorm:"column:end_at"`     // end 是 SQL 保留字,欄位改名 end_at
	EndTime   string   `gorm:"column:end_time"`   // 'HH:MM'
	Location  string   `gorm:"column:location"`
	Lat       *float64 `gorm:"column:lat"`
	Lng       *float64 `gorm:"column:lng"`
	// LLM 標注(原本在 message 上,改存 entry)。
	Category  *string        `gorm:"column:category"`
	Tags      []string       `gorm:"column:tags;serializer:json"`
	Note      *string        `gorm:"column:note"`
	Kind      *string        `gorm:"column:kind"`
	Detail    map[string]any `gorm:"column:detail;serializer:json"`
	CreatedAt time.Time      `gorm:"column:created_at;not null"`
}

func (entryRow) TableName() string { return "entries" }

// publicLinkRow 是行程公開分享連結，一個行程最多一條。
type publicLinkRow struct {
	ID        string `gorm:"primaryKey;column:id"`
	TripID    string `gorm:"uniqueIndex;column:trip_id;not null"`
	LinkToken string `gorm:"uniqueIndex;column:link_token;not null"`
	CreatedBy string `gorm:"column:created_by;not null"`
	Editable  bool   `gorm:"column:editable;not null;default:false"`
	// ViewMode:公開頁要顯示「時間軸」還是「配速表」，值為 "timeline"／"pace"。
	// 存字串而非 bool，是因為這是「選其中一種呈現方式」而非開關，未來若再
	// 加第三種呈現方式不需要改型別。空字串（舊資料/尚未設定）由讀取端視為
	// "timeline"，不特別遷移既有資料。
	ViewMode  string    `gorm:"column:view_mode;not null;default:timeline"`
	CreatedAt time.Time `gorm:"column:created_at;not null"`
}

func (publicLinkRow) TableName() string { return "public_links" }

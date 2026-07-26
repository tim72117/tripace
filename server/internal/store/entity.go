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
// 承載所有 LLM 結構化結果——事件時間與標注(category/tags/note)。
// 原話(message)不存後端,改由各裝置端 DB 保存(local-first)。
//
// 時間表示法(2026-07 從字串改為 timestamptz):
//
//	StartAt/EndAt 存 UTC 絕對時刻,TZ 存該事件所屬的 IANA 時區名(如 Asia/Tokyo)。
//	顯示時一律用 TZ 換算,而非觀看者的裝置時區——這對旅遊 app 是必要的:
//	使用者常在台北規劃東京行程,若用裝置時區顯示,人飛到東京後裝置時區一變,
//	所有行程時間就會整個偏掉。存了事件自己的時區才能保證「東京 10 點」在
//	哪裡看都是東京 10 點。
//
//	AllDay=true 代表全日事件(取代舊的 start_time 空字串約定):此時 StartAt
//	存的是該日在 TZ 時區的 00:00 換算成的 UTC 值,顯示時取 TZ 換算後的日期部分。
//
//	單一 TZ(而非 start_tz/end_tz 兩個)是刻意的簡化:一則條目代表「在某地
//	發生的一件事」,起訖同時區。跨時區移動(如航班起降地不同)是現有資料模型
//	(單一 location 欄位)本來就無法表達的情境,不在這次改動範圍。
type entryRow struct {
	ID        string     `gorm:"primaryKey;column:id"`
	ChannelID string     `gorm:"column:channel_id;not null;index"`
	Title     string     `gorm:"column:title;not null"`
	StartAt   *time.Time `gorm:"column:start_at;index"` // UTC;NULL=無時間資訊
	EndAt     *time.Time `gorm:"column:end_at"`         // UTC;NULL=無結束時間
	TZ        string     `gorm:"column:tz;not null;default:''"`
	AllDay    bool       `gorm:"column:all_day;not null;default:false"`
	Location  string     `gorm:"column:location"`
	Lat       *float64   `gorm:"column:lat"`
	Lng       *float64   `gorm:"column:lng"`
	// 所屬行程;NULL=未歸組。後端依時間自動歸組。
	TripID *string `gorm:"column:trip_id;index"`
	// LLM 標注(原本在 message 上,改存 entry)。
	Category  *string        `gorm:"column:category"`
	Tags      []string       `gorm:"column:tags;serializer:json"`
	Note      *string        `gorm:"column:note"`
	Kind      *string        `gorm:"column:kind"`
	Detail    map[string]any `gorm:"column:detail;serializer:json"`
	CreatedAt time.Time      `gorm:"column:created_at;not null"`
}

func (entryRow) TableName() string { return "entries" }

// tripRow 是 entries 的行程分組(時間表示法對齊 entryRow,見其說明)。
type tripRow struct {
	ID        string     `gorm:"primaryKey;column:id"`
	ChannelID string     `gorm:"column:channel_id;not null;index"`
	Title     string     `gorm:"column:title"`
	StartAt   *time.Time `gorm:"column:start_at;index"` // UTC;NULL=無時間資訊
	EndAt     *time.Time `gorm:"column:end_at"`         // UTC
	TZ        string     `gorm:"column:tz;not null;default:''"`
	CreatedAt time.Time  `gorm:"column:created_at;not null"`
}

func (tripRow) TableName() string { return "trips" }

// publicLinkRow 是頻道公開分享連結，一個頻道最多一條。
type publicLinkRow struct {
	ID        string    `gorm:"primaryKey;column:id"`
	ChannelID string    `gorm:"uniqueIndex;column:channel_id;not null"`
	LinkToken string    `gorm:"uniqueIndex;column:link_token;not null"`
	CreatedBy string    `gorm:"column:created_by;not null"`
	Editable  bool      `gorm:"column:editable;not null;default:false"`
	CreatedAt time.Time `gorm:"column:created_at;not null"`
}

func (publicLinkRow) TableName() string { return "public_links" }

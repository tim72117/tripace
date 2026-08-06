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
	// PlaceID:對應座標的 Google Place ID,見 model.Entry.PlaceID 的完整
	// 說明——只有座標來自後端 Geocoding API 查詢時才會有值。
	PlaceID *string `gorm:"column:place_id"`
	// LLM 標注(原本在 message 上,改存 entry)。
	Category  *string        `gorm:"column:category"`
	Tags      []string       `gorm:"column:tags;serializer:json"`
	Note      *string        `gorm:"column:note"`
	Kind      *string        `gorm:"column:kind"`
	Detail    map[string]any `gorm:"column:detail;serializer:json"`
	CreatedAt time.Time      `gorm:"column:created_at;not null"`
}

func (entryRow) TableName() string { return "entries" }

// attractionRow 是地理輪廓底圖(構想 6)用的景點區域資料,對應
// model.Attraction 的完整說明。cityName 加索引——查詢入口固定是
// 「這個城市底下所有 Attraction」(見 store 層 ListAttractionsByCity)。
type attractionRow struct {
	ID       string `gorm:"primaryKey;column:id"`
	Name     string `gorm:"column:name;not null"`
	CityName string `gorm:"column:city_name;not null;index"`
	// Lat/Lng 複合索引(idx_attractions_lat_lng)供 ListAttractionsNearby 的
	// bounding box 查詢(WHERE lat BETWEEN ... AND lng BETWEEN ...)使用——
	// 沒有索引時是全表掃描,資料量成長後會越來越慢。這裡仍是一般 B-tree
	// 複合索引,不是地理空間索引(如 PostGIS 的 GiST),只能加速「先用 lat
	// 範圍篩、再用 lng 範圍篩」這種寫法,篩出來的仍是方形 bounding box、
	// 不是精確的圓形範圍(精度問題見 ListAttractionsNearby 的說明)。
	Lat          float64 `gorm:"column:lat;not null;index:idx_attractions_lat_lng,priority:1"`
	Lng          float64 `gorm:"column:lng;not null;index:idx_attractions_lat_lng,priority:2"`
	Level        int     `gorm:"column:level;not null"`
	RadiusMeters int     `gorm:"column:radius_meters;not null;default:0"`
	Summary      *string `gorm:"column:summary"`
	PhotoURL     *string `gorm:"column:photo_url"`

	CreatedAt time.Time `gorm:"column:created_at;not null"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null"`
}

func (attractionRow) TableName() string { return "attractions" }

// photoCacheRow 快取 Google Places Photo Media API 已下載過的圖片(見
// server/internal/geo/places.go 的 fetchPhotoAsDataURI)——同一個地點
// (place id + 寬度組合)重複被查詢時直接吃快取,不重新打 Photo Media
// API。同一個 place id 在不同呼叫端可能要求不同 maxWidthPx(如飯店/
// 推薦地點縮圖用 200px、地標圖/POI 詳情用 400px),不同寬度的圖片資料
// 不同,故複合主鍵含寬度。
//
// 主鍵刻意用 place_id(穩定、不過期)而非 photo resource name(俗稱
// "photo name")——Google Maps Platform Terms of Service 3.2.3(b) 明文
// 禁止長期快取 photo name,且該值本身會過期,不適合當持久化的主鍵。
// place_id 才是允許持久保存、拿來定位「這是哪個地點的圖」的識別碼。
//
// PhotoIndex:同一個地點可能存多張照片(Google 依 photos[] 陣列順序
// 回傳),0-based,對應該次查詢當下的順序位置——刻意不是 Google 的照片
// 識別碼本身(那正是不能持久保存的 photo resource name),而是我方
// 自訂的序數,用來在讀取時保證顯示順序(ORDER BY photo_index)、以及
// 判斷「這個位置的照片還在不在 Google 目前的清單裡」。目前實際只取
// Google 清單的第一張(PhotoIndex 固定為 0),機制上支援多張,之後要
// 擴充只需調整查詢端取幾筆,這個 schema 不需要再改。
type photoCacheRow struct {
	PlaceID    string    `gorm:"primaryKey;column:place_id"`
	PhotoIndex int       `gorm:"primaryKey;column:photo_index"`
	MaxWidthPx int       `gorm:"primaryKey;column:max_width_px"`
	DataURI    string    `gorm:"column:data_uri;not null"`
	FetchedAt  time.Time `gorm:"column:fetched_at;not null"`
}

func (photoCacheRow) TableName() string { return "photo_cache" }

// placeDetailsCacheRow 快取 Google Places Place Details 查詢結果(見
// server/internal/geo/places.go 的 GetPlaceDetails)——供「使用者點擊
// 地圖上 Google 原生 POI 圖標」情境使用,同一個地點短期內重複被點擊時
// 直接吃快取,不重新打 Place Details API。PhotoURL 存的是已經轉換好的
// data: URI(圖片本身也走 photoCacheRow 快取,這裡直接存最終結果,快取
// 命中時不需要再組一次轉換邏輯)。
type placeDetailsCacheRow struct {
	PlaceID   string    `gorm:"primaryKey;column:place_id"`
	Name      string    `gorm:"column:name;not null"`
	Address   string    `gorm:"column:address"`
	Lat       float64   `gorm:"column:lat;not null"`
	Lng       float64   `gorm:"column:lng;not null"`
	Rating    float64   `gorm:"column:rating"`
	Summary   *string   `gorm:"column:summary"`
	PhotoURL  *string   `gorm:"column:photo_url"`
	FetchedAt time.Time `gorm:"column:fetched_at;not null"`
}

func (placeDetailsCacheRow) TableName() string { return "place_details_cache" }

// apiRequestLogRow 記錄後端每一個 HTTP 請求(見 middleware.go 的
// requestLogging)——method/path/狀態碼/耗時/呼叫者,供之後排查異常流量
// (如本次要解決的 Photo Media 重複呼叫問題)、或觀察哪些端點被呼叫
// 頻率最高。UserID 可能是 guestUser 的固定 ID(未登入/token 無效時,見
// Server.userFor),不代表每筆記錄都對應到一個真實已註冊帳號。
type apiRequestLogRow struct {
	ID         uint      `gorm:"primaryKey;autoIncrement;column:id"`
	Method     string    `gorm:"column:method;not null"`
	Path       string    `gorm:"column:path;not null;index"`
	StatusCode int       `gorm:"column:status_code;not null"`
	DurationMs int64     `gorm:"column:duration_ms;not null"`
	UserID     string    `gorm:"column:user_id;index"`
	CreatedAt  time.Time `gorm:"column:created_at;not null;index"`
}

func (apiRequestLogRow) TableName() string { return "api_request_logs" }

// geoAPICallLogRow 記錄每一次對 Google Places/Geocoding API 發出的請求
// (見 server/internal/apigateway 的 CallLogger、server/internal/geo 的
// Gateway 派送邏輯)——跟 apiRequestLogRow 是兩張不同語意的表:
// apiRequestLogRow 記的是「別人打進我們的 server」(inbound),這張表記的
// 是「我們的 server 打出去給 Google」(outbound)。同一次使用者操作
// (例如地圖拖曳觸發 handleGeoAttractionsNearby)可能對應到這裡的多筆記錄
// (一次 Nearby Search + 多次 Photo Media),兩張表不是一對一關係。
//
// Endpoint 是 geo 套件內部固定的邏輯端點名稱(如 "places.searchNearby"、
// "places.photoMedia"、"geocode"),不是完整網址——完整網址含 API key 等
// 敏感資訊,不該存進資料庫。Caller 是呼叫端透過 geo.WithCaller(ctx, ...)
// 標記的識別字串(如 "handleGeoAttractionsNearby"),未標記時為 "unknown"。
// Path 是觸發這次呼叫的我方 API 路徑(如 "/internal/geo/attractions/
// nearby",見 geo.WithPath 的說明)——跟 Caller 是兩個獨立維度:Caller
// 指向程式碼位置,Path 指向對外曝露的路由。LLM 工具呼叫沒有對應的單一
// REST path 時為空字串,不強行湊一個不準確的值。
type geoAPICallLogRow struct {
	ID         uint      `gorm:"primaryKey;autoIncrement;column:id"`
	Endpoint   string    `gorm:"column:endpoint;not null;index"`
	Caller     string    `gorm:"column:caller;not null;index"`
	Path       string    `gorm:"column:path;index"`
	StatusCode int       `gorm:"column:status_code;not null"`
	DurationMs int64     `gorm:"column:duration_ms;not null"`
	Errored    bool      `gorm:"column:errored;not null"` // true 代表連線層失敗(逾時等),連 HTTP 回應都沒收到
	CreatedAt  time.Time `gorm:"column:created_at;not null;index"`
}

func (geoAPICallLogRow) TableName() string { return "geo_api_call_logs" }

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

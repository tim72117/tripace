package store

import "time"

// 以下 entity 是 GORM 的資料表映射(帶 gorm tag),與 API DTO(model.*)分離。
// store 方法負責 entity <-> model 的轉換。

type userRow struct {
	ID           string  `gorm:"primaryKey;column:id"`
	Name         string  `gorm:"column:name;not null"`
	AvatarColor  string  `gorm:"column:avatar_color;not null"`
	AppleSub     *string `gorm:"column:apple_sub;uniqueIndex"`  // 可為 NULL
	GoogleSub    *string `gorm:"column:google_sub;uniqueIndex"` // 可為 NULL
	Email        *string `gorm:"column:email;uniqueIndex"`      // 可為 NULL
	PasswordHash *string `gorm:"column:password_hash"`          // 可為 NULL

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
	Lat   float64 `gorm:"column:lat;not null;index:idx_attractions_lat_lng,priority:1"`
	Lng   float64 `gorm:"column:lng;not null;index:idx_attractions_lat_lng,priority:2"`
	Level int     `gorm:"column:level;not null"`
	// IsTheme:見 model.Attraction.IsTheme 的完整說明——與 Level 並存,不
	// 取代它。default:false 只影響 AutoMigrate 新增這個欄位時既有資料列
	// 的補值,新資料一律由 CreateAttraction/CreateAttractionWithID 明確
	// 帶入,不依賴這個 DB 層預設值(理由同其餘欄位一貫的顯式帶入慣例)。
	IsTheme      bool    `gorm:"column:is_theme;not null;default:false"`
	RadiusMeters int     `gorm:"column:radius_meters;not null;default:0"`
	Summary      *string `gorm:"column:summary"`
	PhotoURL     *string `gorm:"column:photo_url"`
	// PlaceID:對應這個景點區域的 Google Place ID,可為 NULL——人工建檔時
	// 若沒有透過 -place/-place-id 指定(或建檔當下查無對應地點)就不會有
	// 值。有值時前端優先改用「地點照片漸進補圖機制」(place_details_cache/
	// google_place_photos/place_pexels_photos 三張表,見這幾個型別的完整
	// 說明)取得的 Google/Pexels 雙來源照片陣列顯示,取代/補強單一的
	// PhotoURL;沒有值時維持原本 PhotoURL 這條路徑不變。兩套機制刻意並存
	// 而非一次性遷移——PhotoURL 是人工建檔當下落地存進 GCS 的單張快照,
	// PlaceID 對應的漸進補圖結果會隨使用者點擊持續累積更新,兩者服務的
	// 情境不同(見 docs/audit-place-photo-cost-control-2026-09.md 的完整
	// 討論),沒有理由讓其中一套機制完全取代另一套。
	//
	// place_id 本身是 Google 官方文件明確允許長期保存與展示的穩定識別碼
	// (跟 photo resource name 那種禁止長期快取的欄位規則不同,見
	// photoCacheRow 型別說明的 Google Maps Platform ToS 3.2.3(b) 引用),
	// 存進資料庫、對外曝露都沒有 Google TOS 疑慮。
	PlaceID *string `gorm:"column:place_id"`
	// Category:見 model.Attraction.Category 的完整說明。跟 Summary/
	// PhotoURL 一樣是選填的 *string,AutoMigrate 新增這個欄位時既有資料列
	// 一律補 NULL(未設定),不像 IsTheme 有 default 值——這個欄位的空值
	// 語意本身就是合法的最終狀態(不是所有景點都適用這四類語彙),不需要
	// 補一個預設分類。
	Category *string `gorm:"column:category"`

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

// pexelsPhotoCacheRow 快取 Pexels Search API 查到的示意圖(見
// server/internal/pexels 的完整說明)——同一個查詢字串重複被查詢時直接
// 吃快取,不重新打 Pexels API。
//
// 主鍵刻意是 search_query(搜尋時用的原始字串,如 attraction-add 用
// CityName+Name 組成的查詢字串),而非任何 Google place_id——Pexels 是
// 純關鍵字比對的圖庫服務,搜尋結果不綁定任何地點識別碼,search_query
// 才是這裡唯一有意義、可重現的快取鍵(同 photoCacheRow 用 place_id 當
// 主鍵是同一種思路:用「查詢當下唯一能重現這次結果的識別值」當鍵)。
//
// PageURL 是這張照片在 pexels.com 的原始頁面網址(非下載連結)——依
// Pexels License 的建議保留可追溯到來源的連結,供日後需要核對/移除
// 特定照片時使用,不是要在畫面上顯示署名(目前產品未實作署名 UI)。
type pexelsPhotoCacheRow struct {
	SearchQuery string    `gorm:"primaryKey;column:search_query"`
	ImageURL    string    `gorm:"column:image_url;not null"`
	PageURL     string    `gorm:"column:page_url;not null"`
	FetchedAt   time.Time `gorm:"column:fetched_at;not null"`
}

func (pexelsPhotoCacheRow) TableName() string { return "pexels_photo_cache" }

// placeDetailsCacheRow 快取 Google Places Place Details 查詢結果(見
// server/internal/geo/places.go 的 GetPlaceDetails)——供「使用者點擊
// 地圖上 Google 原生 POI 圖標」情境使用,同一個地點短期內重複被點擊時
// 直接吃快取,不重新打 Place Details API。PhotoURL 存的是已經轉換好的
// data: URI(圖片本身也走 photoCacheRow 快取,這裡直接存最終結果,快取
// 命中時不需要再組一次轉換邏輯)。
// ClickCount/GooglePhotoTargetCount/NewPhotoCount 三欄支援「漸進補圖」
// 機制(見 server/internal/api/geo_outline.go 的 shouldAddGooglePlacePhoto/
// resetPhotoProgressOnTargetChange 兩支純函式的完整規格)：
//
//   - ClickCount:這個地點被點擊的累積總次數,只增不減、永遠不歸零——
//     即使 GooglePhotoTargetCount 中途變動導致 NewPhotoCount 被重置,
//     點擊次數本身仍是一路累加的歷史事實,不隨補圖進度重置而重置。
//   - GooglePhotoTargetCount:上次查詢 Google 時 photos[] 陣列的實際
//     長度——用來偵測「這次查到的張數跟上次不一樣」(resetPhotoProgressOnTargetChange
//     的輸入),不是「這個地點理論上有幾張圖」的固定值,會隨每次查詢
//     覆寫。**預設值是 -1,不是 0**——2026-09 修正一個實測到的死鎖
//     bug(順正/清水順正 Okabe家 這筆資料是實際案例:初次查詢當下
//     Google 剛好回傳空的 photos[],target 被寫成合法值 0 之後,
//     shouldAddGooglePlacePhoto 的 newPhotoCount(0) >= googlePhotoTargetCount(0)
//     恆為 true,永遠不再觸發 ListPlacePhotoRefs 重新確認,即使 Google
//     之後真的補上了照片也永遠不會被發現)。-1 代表「這個地點從未真正
//     跟 Google 確認過 photos[] 長度」,跟 0(已確認過、當下真的是 0
//     張)在語意上是兩種不同狀態,不能用同一個值表示——shouldAddGooglePlacePhoto
//     必須先特判這個 sentinel、無條件觸發第一次確認,才能跳出「target
//     卡在 0 之後永遠沒有機會重新驗證」的迴圈。
//   - NewPhotoCount:目前已經漸進補到第幾張(0-based 累積數,不是
//     photo_index)——即 shouldAddGooglePlacePhoto 的 newPhotoCount
//     參數,每次觸發補圖後 +1,target 變動時可能被歸零重置。
//
// ClickCount/NewPhotoCount 給預設值 0(gorm default),GooglePhotoTargetCount
// 給預設值 -1(見上方說明)——這三欄都對應「這個地點第一次被查詢/點擊」
// 的初始狀態,新增欄位時既有的舊資料列也會因為 AutoMigrate 的
// ALTER TABLE ADD COLUMN 而自動補上對應預設值,不需要額外的資料回填;
// 但 AutoMigrate 只在「新增這個欄位」當下套用一次性的 DEFAULT,不會
// 回頭修正已經因為這個 bug 而卡在合法值 0 的既有資料列(見
// docs 或 CHANGELOG 記錄的一次性資料修復,若需要讓既有卡住的資料列
// 重新有機會被確認,需要另外執行一次性的資料修復,把這些列的
// google_photo_target_count 從 0 改回 -1)。
type placeDetailsCacheRow struct {
	PlaceID                string    `gorm:"primaryKey;column:place_id"`
	Name                   string    `gorm:"column:name;not null"`
	Address                string    `gorm:"column:address"`
	Lat                    float64   `gorm:"column:lat;not null"`
	Lng                    float64   `gorm:"column:lng;not null"`
	Rating                 float64   `gorm:"column:rating"`
	Summary                *string   `gorm:"column:summary"`
	FetchedAt              time.Time `gorm:"column:fetched_at;not null"`
	ClickCount             int64     `gorm:"column:click_count;not null;default:0"`
	GooglePhotoTargetCount int       `gorm:"column:google_photo_target_count;not null;default:-1"`
	NewPhotoCount          int       `gorm:"column:new_photo_count;not null;default:0"`
}

func (placeDetailsCacheRow) TableName() string { return "place_details_cache" }

// googlePlacePhotoRow 存放「使用者點擊地圖上 Google 原生 POI 圖標」情境
// 下,從 Google Places 取得的照片(見 server/internal/api/geo_outline.go
// 的 handleGeoPlaceDetails 一般模式)——欄位存的是已經落地到 GCS 的公開
// URL(或落地失敗降級的原始 data URI/來源網址,見 landmarkPhotoURLFromDataURI
// 的說明),不是圖片內容本身(那是 photoCacheRow 的職責,見該型別說明
// 「place_details_cache 是上層產物,photo_cache 是它可能依賴的下層快取」)。
//
// 跟 Pexels 的照片分成獨立的 placePexelsPhotoRow 表,不是同一張表加一個
// 「來源」欄位——兩者要存的欄位本來就不一樣(Pexels 依授權條款需要額外
// 保留 PageURL 可追溯來源,Google 這邊沒有這個需求),且兩者是要「同時
// 並列顯示」的兩份獨立清單,不是互斥的單一選擇,分表比同一張表用
// 一個 kind 判別欄位更直接對應這個使用情境。
//
// PhotoIndex 從 0 開始,對應 Google Places API 回傳 photos[] 陣列裡的
// 原始順序,前端依此排序顯示——這批圖排在 Pexels 那批之前(見前端
// GeoInfoPanel 的說明)。
type googlePlacePhotoRow struct {
	PlaceID    string    `gorm:"primaryKey;column:place_id"`
	PhotoIndex int       `gorm:"primaryKey;column:photo_index"`
	PhotoURL   string    `gorm:"column:photo_url;not null"`
	FetchedAt  time.Time `gorm:"column:fetched_at;not null"`
}

func (googlePlacePhotoRow) TableName() string { return "google_place_photos" }

// placePexelsPhotoRow 存放同一個 POI 點擊情境下,從 Pexels 取得的照片,
// 與 googlePlacePhotoRow 同時並列顯示、互不取代(見該型別的完整說明)。
// PageURL 是這張照片在 pexels.com 的原始頁面網址(非下載連結)——依
// Pexels License 的建議保留可追溯到來源的連結,同 pexelsPhotoCacheRow
// 的說明。
type placePexelsPhotoRow struct {
	PlaceID    string    `gorm:"primaryKey;column:place_id"`
	PhotoIndex int       `gorm:"primaryKey;column:photo_index"`
	PhotoURL   string    `gorm:"column:photo_url;not null"`
	PageURL    string    `gorm:"column:page_url;not null"`
	FetchedAt  time.Time `gorm:"column:fetched_at;not null"`
}

func (placePexelsPhotoRow) TableName() string { return "place_pexels_photos" }

// photoAssetRow — 2026-09 新增,全站共通的圖檔落地紀錄表。動機:
// google_place_photos/photo_cache 兩張表目前實務上存的是完整 base64
// data: URI(本機未設定 GCS_PHOTO_BUCKET 時,landmarkPhotoURLFromDataURI
// 落地失敗降級保留原始 data URI,見該函式的完整說明——這是本機開發環境
// 的實際現況,不是設計如此),資料庫因此背負不必要的儲存負擔,且違反
// Google Maps Platform ToS 3.2.3(b) 對長期保存的精神(見 photoCacheRow
// 的完整說明——雖然 data URI 本身不是 photo name,但把完整圖片內容
// 無限期存在自家資料庫,同樣不是這批快取機制原本設計要做的事,應該
// 落地成 GCS 物件,只在資料庫存一個會過期的參照)。
//
// 這張表統一用 PlaceID 當識別鍵(不分 google_place_photos/photo_cache/
// 日後 attractions 各自的情境)——理由是 attractions 表本身已經存了
// PlaceID(見 attractionRow.PlaceID 的完整說明),不需要另外發明
// attraction_id 這種只服務單一情境的識別欄位,統一用 place_id 讓這張表
// 可以同時服務所有跟 Google 地點相關的圖檔快取來源。
//
// Usage 區分同一個 PlaceID 底下的不同規格(而不是區分「這張圖服務哪個
// 功能」)——例如 "full"(原始尺寸,對應 googlePlacePhotoRow 情境)、
// "thumb_200"(200px 縮圖,對應 photoCacheRow 依 maxWidthPx 分列的情境)。
// 同一個 (PlaceID, PhotoIndex) 底下可以有多筆不同 Usage 的紀錄,對應
// 同一張原始照片被查詢過不同尺寸的情況。
//
// Source 記錄這張圖片的原始來源("google"/"pexels"),供之後需要依授權
// 條款分開處理、或排查特定來源圖片時使用——理由同 placePexelsPhotoRow
// 保留 PageURL 可追溯來源的既有慣例。
//
// ExpiresAt:2026-09 使用者明確要求「設定過期 1 週」——這批圖是從既有
// base64 快取一次性遷移落地,不像 attractions.photo_url 那樣是人工
// 建檔、預期長期存在的正式資產,過期後應視為「需要重新確認來源是否
// 仍然有效」的暫存物件,而非永久保存;呼叫端讀取時應檢查這個欄位,
// 過期則視為快取未命中,理由對齊 placeDetailsCacheMaxAge 等既有的
// 快取新鮮度慣例。允許 NULL(不過期)是保留給日後其他情境使用的彈性,
// 目前遷移腳本一律會帶入 fetched_at + 7 天的值。
type photoAssetRow struct {
	PlaceID    string     `gorm:"primaryKey;column:place_id"`
	PhotoIndex int        `gorm:"primaryKey;column:photo_index"`
	Usage      string     `gorm:"primaryKey;column:usage"`
	Source     string     `gorm:"column:source;not null"`
	GCSURL     string     `gorm:"column:gcs_url;not null"`
	FetchedAt  time.Time  `gorm:"column:fetched_at;not null"`
	ExpiresAt  *time.Time `gorm:"column:expires_at"`
}

func (photoAssetRow) TableName() string { return "photo_assets" }

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

// geoRateLimitRow 是 Google Places API 限流設定,每個 endpoint key
// (見 geo.placeGetEndpoint/photoMediaEndpoint,如 "places.get"/
// "places.photoMedia")一列——取代原本寫死在 cmd/server/main.go 啟動
// flag/環境變數的做法,讓限速視窗、上限次數、每日額度可以透過後台
// 管理介面(adminconsole)執行期修改,不需要改程式碼重新部署。
//
// WindowSec/MaxCalls 對應 apigateway.RateLimiter.SetLimitForKey 的
// window/maxCalls 兩個參數(固定視窗計數器,見該函式完整說明)。
//
// DailyMax/UsedToday/UsedDay 是每日額度的原子計數器,比照
// IncrementPlaceClickCount(見 geocache.go)的「單一 UPDATE 陳述式完成
// 加一 + 判斷換日歸零」設計,刻意存在資料庫而非記憶體——這是跨
// Cloud Run 多實例真正共用一份額度的唯一辦法(RateLimiter 本身是
// process 內記憶體單例,見該型別的完整說明,多實例各自一份、無法用來
// 實作「整天總共只能打幾次」這種計費語意的額度)。UsedDay 存
// "2006-01-02" 格式的日期字串(UTC,伺服器所在時區—— now() 回傳 UTC,
// 見 store.go 的說明),不是完整 timestamp:每次遞增時比對 UsedDay 是否
// 等於今天,不同就在同一條 UPDATE 陳述式裡把 UsedToday 重設成 1、
// UsedDay 改成今天,相同就单純 UsedToday+1,兩種情況都不需要另外查詢
// 判斷再各自送不同的 UPDATE(見 IncrementGeoRateLimitDailyUsage 的完整
// 說明)。DailyMax 為 0 代表不限制每日額度(比照 RateLimiter.SetLimitForKey
// 「maxCalls<=0 視為不限流」的既有語意,不需要另外用 nullable 欄位表達
// 「未設定」)。
type geoRateLimitRow struct {
	Endpoint  string    `gorm:"primaryKey;column:endpoint"`
	WindowSec int       `gorm:"column:window_sec;not null"`
	MaxCalls  int       `gorm:"column:max_calls;not null"`
	DailyMax  int       `gorm:"column:daily_max;not null;default:0"`
	UsedToday int       `gorm:"column:used_today;not null;default:0"`
	UsedDay   string    `gorm:"column:used_day;not null;default:''"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null"`
}

func (geoRateLimitRow) TableName() string { return "geo_rate_limits" }

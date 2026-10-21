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
	// PlaceID:對應這個景點區域的 Google Place ID,可為 NULL——人工建檔時
	// 若沒有透過 -place/-place-id 指定(或建檔當下查無對應地點)就不會有
	// 值。有值時前端改用「地點照片漸進補圖機制」(place_details_cache/
	// google_place_photos/place_pexels_photos 三張表,見這幾個型別的完整
	// 說明)取得的 Google/Pexels 雙來源照片陣列顯示。2026-10 徹底移除
	// PhotoURL 這個相容欄位(資料庫 photo_url 欄位本身也已經 DROP COLUMN,
	// 見 cmd/migrate-drop-photo-url 的完整說明)——PlaceID 為 NULL 的
	// 景點,主題卡一律顯示 placeholder,不會回退顯示任何靜態快照。這代表
	// PlaceID 欄位事實上已經是主題卡取得照片的唯一路徑。
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

// blogProfileRow 是「部落客公開身份」設定——2026-10 新增,見
// showcase-demo 構想頁 /ideas/product-direction-5-publishing-tool(原產品方向腦力激盪文件)「發文工具
// 產品線」的完整說明:讓使用者可以用一個人類可讀、URL 安全的 handle
// (例如 "tim72117")發表文章(content_pages,見該 entity 的完整說明),
// 而不是把內部隨機 UserID(usr_xxx 格式,見 userRow)直接曝露在公開
// 網址裡。
//
// 獨立成新表、不是在 userRow 上加欄位——理由:
//   - 不是每個使用者都會開部落格,這是「使用者」概念底下的一個選擇性
//     子身份(opt-in),加進 userRow 會讓完全不相關的使用情境(單純用
//     行程規劃功能、從未發過文)也背負這些欄位。
//   - handle 允許之後改名(使用者要求「user_id 穩定、不因改 handle
//     而變」,見 contentPageRow.OwnerID 的完整說明)——獨立表讓「使用者
//     身份」(userRow,穩定)跟「公開發文身份」(這張表,handle 可能
//     被使用者自己修改)的生命週期清楚分開,不會把「這個 ID 會不會變」
//     這種不同穩定性保證的欄位混在同一張表裡。
//
// UserID 設 uniqueIndex——目前設計是「一個使用者只能有一組部落客設定」
// (一對一),不支援一個使用者開多個部落格身份;Handle 也是
// uniqueIndex——這是整個系統裡唯一、拿來組 URL(/u/{handle}/{slug})
// 的識別字,不可重複。
type blogProfileRow struct {
	ID        string    `gorm:"primaryKey;column:id"`
	UserID    string    `gorm:"column:user_id;not null;uniqueIndex"`
	Handle    string    `gorm:"column:handle;not null;uniqueIndex"`
	AvatarURL string    `gorm:"column:avatar_url"`
	CreatedAt time.Time `gorm:"column:created_at;not null"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null"`
}

func (blogProfileRow) TableName() string { return "blog_profiles" }

// uploadedPhotoRow 是「使用者上傳圖片」(部落客發文用)的原圖記錄——
// 2026-10 新增,見 showcase-demo 構想頁 /ideas/product-direction-5-publishing-tool(原產品方向腦力激盪文件)
// 「發文工具產品線」:使用者寫部落格文章(content_pages,見
// contentPageRow 的完整說明)時,自行上傳的圖片先落地成原圖記錄,之後
// 再非同步產生縮圖/內文大圖等衍生版本(見 photoVariantRow)。
//
// 獨立成新表、不跟既有 photoAssetRow 共用——兩者語意完全不同:
// photoAssetRow 是「Google 地點照片」的落地快取(主鍵是 PlaceID+
// PhotoIndex+Usage,服務的是景點照片快取情境,見該型別的完整說明),
// 這張表是「使用者自己上傳的原創圖片」,沒有 PlaceID 可以掛,也沒有
// 「同一張圖查詢過不同尺寸快取」這種快取語意——這裡每張圖都是使用者
// 主動上傳的單一事件,不是查詢觸發的快取填補,混在同一張表只會讓
// PlaceID 這個欄位出現「使用者上傳圖片根本沒有 PlaceID」的尷尬空值,
// 也混淆兩種完全不同的生命週期(快取可以被動過期重查,使用者上傳的
// 原圖不能說丟就丟)。
//
// OwnerID 建索引——供之後「網頁上部落客管理自己上傳過的圖片」頁面
// (ListUploadedPhotosByOwner)查詢「這個使用者上傳過哪些圖」使用。
//
// OriginalURL 是原圖在 GCS 的完整網址——這裡只定義欄位跟寫入方法,
// 實際簽發 pre-signed URL、接收上傳內容寫入這個欄位的 API 邏輯還在
// 跟使用者討論設計,之後另外派工(見本次任務範圍限制)。
//
// Status 用裸字串而非型別化 enum("pending"/"ready"/"failed")——對齊
// 這個專案「後端用字串存列舉值,不另外定義型別」的既有慣例(例如
// contentPageRow.Status 也是用裸字串 "draft"/"published")。預設
// "pending":圖片上傳完成、衍生尺寸(photoVariantRow)還沒處理完的
// 初始狀態,轉成 "ready" 或 "failed" 是之後非同步圖片處理 goroutine
// 的職責,這次任務只負責定義狀態欄位跟 SetUploadedPhotoStatus 寫入
// 方法,不實作真正觸發轉換的處理邏輯。
//
// FocalX/FocalY 可為 NULL——這兩個欄位是選填的裁切焦點座標(0~1
// 相對值,對應 web/src/blog/types.ts 的 FocalPoint)。使用者上傳完圖片
// 不會馬上就設定裁切焦點,網頁上的裁切編輯器是之後才讓使用者操作的
// 步驟;沒設定時前端渲染端預期會 fallback 成置中裁切,這跟
// FocalPoint「可省略,省略時以置中裁切處理」的既有語意完全對應,只是
// 這裡是把同一套「可省略」語意存進資料庫層,用 *float64 表達「尚未
// 設定」而非用 0,0 這種容易跟「使用者真的選了左上角」混淆的魔術值。
//
// 焦點刻意綁在這張表(原圖)上,而不是綁在「文章引用」那一層——這是
// 已經確認過的設計決策:同一張圖通常只會被一篇文章用到,全部引用
// 共用同一個焦點即可,不需要再設計一套「依引用情境各自設定焦點」的
// 更複雜機制(那種機制要另外開一張「引用」中介表,且目前沒有實際
// 使用情境需要同一張圖在不同文章裡用不同焦點裁切)。
//
// Width/Height 可為 NULL——原圖上傳當下,如果像素寬高還沒解析完成
// (解析本身也是之後非同步處理階段的工作,不在本次任務範圍),就先
// 留空;不像 photoVariantRow 的 Width/Height 是「衍生版本產生時就
// 必然知道的明確尺寸」,不需要 nullable。
type uploadedPhotoRow struct {
	ID          string    `gorm:"primaryKey;column:id"`
	OwnerID     string    `gorm:"column:owner_id;not null;index"`
	OriginalURL string    `gorm:"column:original_url;not null"`
	Status      string    `gorm:"column:status;not null;default:pending"`
	FocalX      *float64  `gorm:"column:focal_x"` // 可為 NULL,見上方型別說明
	FocalY      *float64  `gorm:"column:focal_y"` // 可為 NULL,同上
	Width       *int      `gorm:"column:width"`   // 可為 NULL,解析完成前未知
	Height      *int      `gorm:"column:height"`  // 可為 NULL,同上
	// Note 用 not null default '' 而非 *string——見 model.UploadedPhoto.Note
	// 的完整說明,這是純文字備註,跟 Status 等欄位同樣用「空字串代表未設定」
	// 的既有慣例(對照 contentPageRow.Status 用裸字串的既有說明),不需要
	// 分辨「NULL」跟「空字串」兩種狀態。
	Note string `gorm:"column:note;not null;default:''"`
	// Rating 用 *int(可為 NULL)而非 Note 那種「空字串代表未設定」的
	// 慣例——見 model.UploadedPhoto.Rating 的完整說明:評分合法值是
	// 1~3,0 不是合法評分值但也不是明確的「未評分」語意(容易跟「使用者
	// 刻意評 0 分」混淆),用 nil 明確區分「從未評分」與「評過分」兩種
	// 狀態,比照 FocalX/FocalY 用指標型別的既有慣例。
	Rating    *int      `gorm:"column:rating"`
	CreatedAt time.Time `gorm:"column:created_at;not null"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null"`
}

func (uploadedPhotoRow) TableName() string { return "uploaded_photos" }

// photoVariantRow 是原圖(uploadedPhotoRow)的各種尺寸衍生版本——同一張
// 原圖經過非同步處理後,會產生多個固定用途的尺寸版本(目前預期
// "thumbnail" 縮圖、"large" 內文大圖兩種),供前端依顯示情境(列表縮圖
// vs 文章內文大圖)直接選用對應尺寸的圖,不需要每次顯示都用原圖現場
// 縮放。
//
// Kind 用裸字串而非型別化 enum——對齊這個專案「後端用字串存列舉值,
// 不另外定義型別」的既有慣例(同 uploadedPhotoRow.Status 的說明,也
// 同 contentPageRow.Status 用裸字串 "draft"/"published" 的先例)。
//
// PhotoID 建索引——查詢入口固定是「這張原圖底下的所有衍生版本」(見
// GetUploadedPhoto 的完整說明)。
//
// 複合唯一索引 ux_photo_variants_photo_id_kind(PhotoID, Kind)——同一張
// 原圖的同一種尺寸只會有一筆記錄,不該重複產生;命名比照
// contentPageRow 複合索引 ux_content_pages_owner_slug 的既有命名規則
// (ux_<table>_<欄位1>_<欄位2>)。
//
// Width/Height 不像 uploadedPhotoRow 那樣可為 NULL——衍生版本是處理
// 完成後才會寫入的記錄,寫入當下必然已經知道實際像素寬高,不存在
// 「暫時未知」的中間狀態。
type photoVariantRow struct {
	ID        string    `gorm:"primaryKey;column:id"`
	PhotoID   string    `gorm:"column:photo_id;not null;index;uniqueIndex:ux_photo_variants_photo_id_kind,priority:1"`
	Kind      string    `gorm:"column:kind;not null;uniqueIndex:ux_photo_variants_photo_id_kind,priority:2"`
	URL       string    `gorm:"column:url;not null"`
	Width     int       `gorm:"column:width;not null"`
	Height    int       `gorm:"column:height;not null"`
	CreatedAt time.Time `gorm:"column:created_at;not null"`
}

func (photoVariantRow) TableName() string { return "photo_variants" }

// contentPageRow 是主題介紹頁/部落格文章的規格化內容(見 docs/
// refactor-theme-page-content-cms-plan-2026-10.md、
// web/src/blog/types.ts 的 ThemePageContent)——九份/京都/台南等城市
// 主題介紹頁,原本整篇文案都是手寫在各自的 .tsx 檔案裡,這張表讓
// 管理者改成透過 CLI 編輯、存進資料庫,前端改成打 API 讀取內容渲染;
// 2026-10 起同一張表也承載部落客發文(見 blogProfileRow 的完整說明)。
// 這張表同時服務兩種用途(官方城市介紹頁、使用者自己的部落格文章),
// 表名/型別名從原本只反映前者的 theme_pages/themePageRow 改成更通用的
// content_pages/contentPageRow,理由即此——命名跟上實際涵蓋的範圍,
// 不是只剩歷史包袱的舊稱呼。
//
// Content 存整份 ThemePageContent JSON(version/title/blocks/...),
// 用法對齊既有 entryRow.Detail 的 `serializer:json` 先例(見該欄位),
// 不是另外拆成多個欄位或子表——blocks 本身是順序敏感的扁平聯集陣列
// (paragraph/image/gallery/stop 四種 kind,見 ThemePageBlock 的完整
// 說明),拆表會需要額外的排序欄位與多次查詢才能還原陣列順序,JSON
// 欄位整份存取、整份覆寫更貼合「CLI get 一份 JSON、編輯、set 整份
// 寫回」的操作模式。型別用 string 而非 map[string]any——內容本身
// 是前端定義的 TypeScript 型別(ThemePageContent),後端只負責原樣
// 存取轉發,不需要在 Go 端重新定義一份對應的巢狀 struct 來解析每個
// Block kind 的欄位,也避免序列化/反序列化時 Go map 不保證欄位順序
// 導致 JSON 字串 diff 困難。
//
// OwnerID(2026-10 新增)——選填,見構想五的完整說明:九份/京都/台南
// 等既有城市介紹頁沒有「作者」概念,OwnerID 留空字串;部落客發文時
// 填入該使用者的 UserID(usr_xxx,不是 handle——見 blogProfileRow 的
// 完整說明,handle 可能被使用者改名,UserID 穩定不變)。Slug 的唯一性
// 範圍從原本「全域唯一」改成「同一個 OwnerID 之內唯一」(見下方
// uniqueIndex 標籤與複合索引 ux_content_pages_owner_slug),允許不同
// 使用者各自使用相同的 slug(例如兩個人都寫一篇 slug="tainan-chikan"
// 的文章,只要 OwnerID 不同就不衝突);原本沒有 OwnerID 概念的既有
// 內容(城市介紹頁)視為 OwnerID="" 這個共用的「系統帳號」命名空間,
// 彼此之間仍然互斥、不能重複 slug,跟改動前的全域唯一行為一致。
type contentPageRow struct {
	ID        string    `gorm:"primaryKey;column:id"`
	OwnerID   string    `gorm:"column:owner_id;not null;default:'';uniqueIndex:ux_content_pages_owner_slug"`
	Slug      string    `gorm:"column:slug;not null;uniqueIndex:ux_content_pages_owner_slug"`
	Content   string    `gorm:"column:content;not null"`
	Status    string    `gorm:"column:status;not null;default:draft"`
	UpdatedBy string    `gorm:"column:updated_by"`
	CreatedAt time.Time `gorm:"column:created_at;not null"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null"`
}

func (contentPageRow) TableName() string { return "content_pages" }

// itineraryPageRow——範例行程內容(對齊「AI 排過的主題行程展示」構想,
// 見 web/src/itineraries/ 的完整說明),結構完全比照 contentPageRow
// ——同一套 CLI 發布模式(OwnerID+Slug 複合唯一索引、Content 整份 JSON
// 字串、Status draft/published),不是重新發明一套。
//
// OwnerID 目前只用空字串這個「官方」命名空間(範例行程全部是內部
// 團隊發布的官方展示內容,沒有使用者自己發布行程的概念),跟
// contentPageRow 不同的是,這裡沒有對應 content-page 的「official vs
// 使用者自己」雙重身份切換邏輯——保留這個欄位只是為了跟 contentPageRow
// 的表結構一致、未來若要開放使用者自己發布行程,不需要改資料表結構,
// 只需要在 API 層加回身份切換邏輯即可。
type itineraryPageRow struct {
	ID        string    `gorm:"primaryKey;column:id"`
	OwnerID   string    `gorm:"column:owner_id;not null;default:'';uniqueIndex:ux_itinerary_pages_owner_slug"`
	Slug      string    `gorm:"column:slug;not null;uniqueIndex:ux_itinerary_pages_owner_slug"`
	Content   string    `gorm:"column:content;not null"`
	Status    string    `gorm:"column:status;not null;default:draft"`
	UpdatedBy string    `gorm:"column:updated_by"`
	CreatedAt time.Time `gorm:"column:created_at;not null"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null"`
}

func (itineraryPageRow) TableName() string { return "itinerary_pages" }

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
//
// ClickCount:這個地點被點擊/查詢的累積總次數,只增不減、永遠不歸零
// ——供 server/internal/api/geo_outline.go 的 photoCapForClickCount/
// decidePlacePhotoRefreshIndex 判斷補圖節奏(點擊越多次,允許補到的
// 照片張數上限越高,見該函式的完整規格)。
//
// 2026-10:移除 GooglePhotoTargetCount/NewPhotoCount 兩欄(連同資料庫
// 欄位本身,見 cmd/migrate-drop-photo-url 的完整說明)——舊版漸進補圖
// 機制(shouldAddGooglePlacePhoto/resetPhotoProgressOnTargetChange)靠
// 這兩個計數器決定要不要補圖,但「已補張數追上目標值」後即使
// photo_assets 裡的照片已經過期也永遠不會重新觸發(清水寺是實際踩到
// 的案例),新機制改成直接查 photo_assets 的新鮮度狀態
// (decidePlacePhotoRefreshIndex 的 fresh 參數),不再需要這兩個計數器。
type placeDetailsCacheRow struct {
	PlaceID    string    `gorm:"primaryKey;column:place_id"`
	Name       string    `gorm:"column:name;not null"`
	Address    string    `gorm:"column:address"`
	Lat        float64   `gorm:"column:lat;not null"`
	Lng        float64   `gorm:"column:lng;not null"`
	Rating     float64   `gorm:"column:rating"`
	Summary    *string   `gorm:"column:summary"`
	FetchedAt  time.Time `gorm:"column:fetched_at;not null"`
	ClickCount int64     `gorm:"column:click_count;not null;default:0"`
	// PhotoCount:這個地點在 Google 上「實際有幾張照片」(2026-10)。
	// 指標而非數值:NULL=還沒查過、不知道;0=查過、確認這個地點沒有照片
	// ——兩者語意不同,補圖判斷(internal/api 的 effectivePhotoCap)對 NULL
	// 沿用點擊數上限、對 0 則完全不補。
	//
	// 為什麼要記:補圖判斷只看「上限範圍內每個索引有沒有新鮮的 photo_assets」,
	// 地點實際照片數少於上限時,多出來的索引永遠沒有紀錄、永遠被判成「缺」,
	// 每次請求都白打一次 places.get 卻什麼都補不到。記下實際張數,判斷時把
	// 上限截到這個數字,就不會再追一個不存在的索引。
	//
	// 由補圖背景任務與同步查詢在拿到 Google 的照片清單時寫入;
	// SetCachedPlaceDetails 的 DoUpdates 刻意不含這欄(同 click_count),否則每次
	// 請求都會把記下的張數洗回 NULL。
	PhotoCount *int `gorm:"column:photo_count"`
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

// planAiChatMessageRow 對應 model.PlanAiChatMessage(見該型別的完整
// 說明)——AI 規劃對話的單一訊息記錄,只關聯 UserID,刻意不綁 TripID。
// ID 用自增主鍵(對齊 apiRequestLogRow/geoAPICallLogRow 等既有 log 風格
// 資料表的慣例),ConversationID/UserID 各自加索引供
// handlePlanAiChat/handlePlanAiChatReply 查詢「這個 conversationID 底下
// 的訊息」與「這個使用者這次請求的節流」使用。
type planAiChatMessageRow struct {
	ID             int64     `gorm:"primaryKey;autoIncrement;column:id"`
	UserID         string    `gorm:"column:user_id;not null;index"`
	ConversationID string    `gorm:"column:conversation_id;not null;index"`
	Role           string    `gorm:"column:role;not null"`
	Content        string    `gorm:"column:content;not null"`
	CreatedAt      time.Time `gorm:"column:created_at;not null;index"`
}

func (planAiChatMessageRow) TableName() string { return "plan_ai_chat_messages" }

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

// geoFieldMaskRow 是 geo_field_masks 表的一列:一個 Google Places API
// 查詢情境要取哪些欄位。
//
// 2026-10 新增(使用者明確要求「加入可以控制欄位的設定,也讓 cli 可以
// 設定」)。
//
// 背景:Google Places API (New) 用 X-Goog-FieldMask header 指定要回傳
// 哪些欄位,而**計費層級由請求裡最高層級的那個欄位決定**——
// displayName/formattedAddress/location 是 Essentials(最便宜)、
// rating/photos 是 Pro、editorialSummary 是 Enterprise + Atmosphere
// (最貴)。所以 field mask 直接決定每次呼叫的單價,而它原本寫死在
// internal/geo/places.go 的 const 裡,要調整只能改程式碼重新部署。
//
// 這是跟 geo_rate_limits 同一類的設定(成本相關、需要運維調整、不該
// 寫死在程式碼),故沿用同一個形狀:endpoint/key 當主鍵、一列一個情境、
// 由後台或 CLI 修改、背景迴圈定期重讀套用。
type geoFieldMaskRow struct {
	// Key 是查詢情境的識別字串(見 internal/geo/fieldmasks 的登錄表),
	// 不是 Google 的 endpoint 名稱——同一個 Google endpoint 可能有多種
	// 查詢情境、各自需要不同的欄位組合(例如 searchText 同時服務
	// 「單純查座標」與「查城市景點並反推行政區」兩種)。
	Key string `gorm:"primaryKey;column:key"`
	// Fields 是逗號分隔的欄位清單,內容原樣送進 X-Goog-FieldMask。
	// 存字串而非正規化成多列:這個值的消費方式就是一個 header 字串,
	// 拆成多列只會讓讀取端每次都要重新 join 回去。
	Fields    string    `gorm:"column:fields;not null"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null"`
}

func (geoFieldMaskRow) TableName() string { return "geo_field_masks" }

// geoSettingRow 是 geo_settings 表的一列:一項「可線上調整的數值設定」的
// 自訂值(登錄表見 internal/geosettings)。沒有資料列 = 沿用登錄表預設值,
// 所以不需要 seeding——跟 geo_rate_limits/geo_field_masks 不同,單一數值
// 沒有「多個欄位要一起寫入才算完整」的問題。
type geoSettingRow struct {
	Key       string    `gorm:"primaryKey;column:key"`
	Value     int       `gorm:"column:value;not null"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null"`
}

func (geoSettingRow) TableName() string { return "geo_settings" }

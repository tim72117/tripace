// Package model 定義 API 與資料層共用的資料結構。
// JSON 欄位對齊 docs/API.md,讓 iOS App 的 Codable 模型可直接解析。
package model

import "time"

type Trip struct {
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
	TripID     string    `json:"tripID"`
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

// 行程成員角色:決定該成員在行程內的權限。
const (
	RoleEditor = "editor" // 可修改(記事/編輯條目);owner 預設為此。
	RoleViewer = "viewer" // 只能查詢(自然語言提問),不能記事。
)

// Member 是行程成員:公開身分 + 在該行程的角色。
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
type PresentedEntry struct {
	Title     string `json:"title"`
	Start     string `json:"start"`
	StartTime string `json:"startTime"`
	End       string `json:"end"`
	EndTime   string `json:"endTime"`
}

// SearchAnswer 對應語意查詢回應。
// Entries 為結構化行程項目:回答文字保持簡短,項目改由前端用卡片列表顯示。
type SearchAnswer struct {
	Answer          string           `json:"answer"`
	CitedMessageIDs []string         `json:"citedMessageIDs"`
	Confidence      *float64         `json:"confidence,omitempty"`
	Entries         []PresentedEntry `json:"entries"`
}

// Attraction 是地理輪廓底圖(構想 6,見
// docs/TRIP_PLANNING_DESIGN_DISCUSSION.md)用的景點區域資料,人工建檔,
// 依知名程度分成 5 級,供地圖依縮放層級決定顯示哪些粒度的地名——
// Level 數字越小代表越知名、範圍越廣(1 級如整座城市地標「101」,
// 5 級如在地商圈「永康商圈」),對齊使用者提出的分級範例:
//
//	1 國際級(如 101)
//	2 國家級(如中正紀念堂)
//	3 區域級(如淡水、陽明山)
//	4 城市級(如象山)
//	5 在地級(如博愛特區、永康商圈、公館商圈)
//
// 正式用語定為「景點區域」(見 docs/TERMINOLOGY.md「地理輪廓底圖」一節)
// ——可以是單點地標(如「101」)也可以是有範圍的區域(如「古城區」),
// 不拆成兩個型別,用同一個符號涵蓋兩種情況,見下方 RadiusMeters 的說明。
//
// 這是取代/擴充 server/internal/geo/district_aliases.go(手動整理的
// 少量城市觀光慣稱分區,寫死在 Go 程式碼)的正式資料庫版本——後者
// 只能靠改程式碼+重新部署才能新增資料,這個模型讓資料能透過 CLI
// (tripace-cli attraction-add 等,見 cmd/cli)直接寫入資料庫,不需要
// 改程式碼。
type Attraction struct {
	ID   string `json:"id"`
	Name string `json:"name"` // 白話名稱,如「古城區」「101」
	// CityName 用來查詢範圍(對齊 GET /internal/geo/attractions?city= 的
	// city 參數),同一個城市底下可以有任意數量、任意 Level 的 Attraction。
	CityName string  `json:"cityName"`
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	// Level 是知名度分級,1(國際)~5(在地),見上方型別註解的完整說明。
	Level int `json:"level"`
	// RadiusMeters 是這個景點區域的大致範圍半徑(公尺),0 代表這是單點
	// 地標(如「101」)而非有範圍的區域(如「古城區」)——前端據此判斷
	// 要不要在地圖上疊加範圍圓圈。
	RadiusMeters int     `json:"radiusMeters,omitempty"`
	Summary      *string `json:"summary,omitempty"`
	PhotoURL     *string `json:"photoUrl,omitempty"`
	// UpdatedAt 是這筆資料最後一次寫入的時間(建立或透過
	// UpdateAttractionPhoto 等方式更新)——目前只單純曝露出來供人工核對
	// 哪些資料較舊,尚未實作自動過期判斷/自動重新整理。
	UpdatedAt time.Time `json:"updatedAt"`
}

// Entry 是主體:LLM 處理訊息後產出的「事件/條目」,承載所有結構化結果。
// 可獨立存在,並可關聯多則來源訊息(多對多)。
type Entry struct {
	ID        string   `json:"id"`
	TripID    string   `json:"tripID"`
	Title     string   `json:"title"`             // 事項描述
	Start     string   `json:"start"`             // 'YYYY-MM-DD';可空
	StartTime string   `json:"startTime"`         // 'HH:MM';空=全日
	End       string   `json:"end,omitempty"`     // 範圍結束日期;可空
	EndTime   string   `json:"endTime,omitempty"` // 範圍結束時刻;可空
	Location  string   `json:"location"`          // 地點(可空)
	Lat       *float64 `json:"lat,omitempty"`     // 緯度(由 Places API 自動補)
	Lng       *float64 `json:"lng,omitempty"`     // 經度
	// PlaceID 是這組座標對應的 Google Place ID,供之後跟 Places API 其他
	// 已快取的資料(如 photo_cache/place_details_cache)關聯比對用——只有
	// 座標來自後端呼叫 Geocoding API 查詢時才會有值(見
	// handleGeocodeEntry);手動在地圖上拖曳選點存座標(見
	// handleInternalSetLatLng)沒有對應的 place_id 可知,此時為 nil,且會
	// 明確清空先前可能存在的舊值——座標已經改到別處,保留舊 place_id
	// 只會造成錯誤的關聯,不留下不一致的殘留資料。
	PlaceID *string `json:"placeID,omitempty"`
	// LLM 標注(原本在 Message 上,改放 Entry;目前先留空,待後續接上 Classify)。
	Category  *string        `json:"category"`
	Tags      []string       `json:"tags"`
	Note      *string        `json:"note"`
	Kind      *string        `json:"kind,omitempty"`   // "stay"|"flight"|"activity"|"note"|"car"|"restaurant"|"ticket"
	Detail    map[string]any `json:"detail,omitempty"` // kind 專屬結構化欄位
	CreatedAt time.Time      `json:"createdAt"`
}

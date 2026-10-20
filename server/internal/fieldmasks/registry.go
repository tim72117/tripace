// Package fieldmasks 是全專案 Google Places API field mask 設定的單一
// 登錄表——每個查詢情境要取哪些欄位、預設值是什麼、各欄位落在哪個計費
// 層級,全部集中在這個檔案。
//
// 2026-10 新增(使用者明確要求「加入可以控制欄位的設定,也讓 cli 可以
// 設定」)。
//
// 為什麼這件事值得一個設定管道:Places API (New) 用
// X-Goog-FieldMask header 指定回傳欄位,而**計費層級由請求裡最高層級的
// 那一個欄位決定**。實例:placeDetails 這個情境原本固定帶
// editorialSummary,於是每一次呼叫都按最貴的 Enterprise + Atmosphere
// 計費(Google Cloud 帳單上顯示為「Places API Place Details
// Enterprise + Atmosphere」)——即使那次查詢其實只需要名稱與座標。
// 這些常數原本寫死在 internal/geo/places.go,調整只能改程式碼重新部署。
//
// 設計上刻意跟 internal/ratelimits 同構(登錄表 + 資料表 + 背景重讀 +
// CLI/後台),因為兩者是同一類東西:成本相關、需要運維依實際用量調整、
// 不該寫死在程式碼裡。
package fieldmasks

import "strings"

// Tier 是一個欄位的計費層級——決定它會把整次呼叫推到哪個價格。
//
// Google 的規則是「取最高層級的那一個」,所以一個 mask 的實際單價等於
// 它裡面最貴的那個欄位,不是各欄位的總和。這也是為什麼移除單一欄位
// (例如 editorialSummary)就能讓整個情境降一檔。
type Tier string

const (
	TierEssentials Tier = "Essentials"
	TierPro        Tier = "Pro"
	TierEnterprise Tier = "Enterprise+Atmosphere"
)

// FieldInfo 描述一個可選欄位:它的計費層級,以及拿掉它會失去什麼。
// CLI 與後台顯示這份資訊,讓調整的人看得出代價——只給欄位名稱的話,
// 操作者無從判斷哪個該留、哪個可以砍。
type FieldInfo struct {
	Name string
	Tier Tier
	// Desc 說明這個欄位在產品上支撐什麼。拿掉它不會讓程式壞掉(回應
	// 解析一律是零值降級,見 geo/places.go 各 handler 的 struct),
	// 但對應的畫面內容會變成空的。
	Desc string
}

// Scenario 是一個查詢情境的定義。
type Scenario struct {
	// Key 是這個情境的識別字串,同時是 geo_field_masks 表的主鍵與
	// CLI 的 -scenario 參數值。
	//
	// 用情境名稱而不是 Google endpoint 名稱:同一個 endpoint 可能服務
	// 多種查詢情境、各自需要不同欄位(searchText 同時服務「單純查座標」
	// 與「查城市景點並反推行政區」),用 endpoint 當 key 就表達不了。
	Key string
	// Endpoint 是這個情境最終打到哪個 Google endpoint——跟
	// ratelimits 的 endpoint key 對得上(places.get/places.searchText
	// 等),讓「這個情境的成本計入哪條限流」這件事看得出來。
	Endpoint string
	// Prefix 是每個欄位在 mask 裡的前綴。Places API 的
	// searchText/searchNearby 回傳的是陣列,欄位要寫成
	// "places.displayName";Place Details 回傳單一物件,寫成
	// "displayName"。這個差異是 Google API 的規定,不是這裡的選擇。
	Prefix string
	// Required 是不可移除的欄位——沒有它們呼叫端拿不到最基本的結果
	// (名稱、座標)。CLI 不允許把這些拿掉,避免設定出一個查了也沒用的
	// mask。全部是 Essentials 級,所以留著不影響價格。
	Required []FieldInfo
	// Optional 是可以依成本取捨的欄位。這裡才是真正會影響帳單的部分。
	Optional []FieldInfo
	// Desc 給人看的一句話說明。
	Desc string
}

const (
	ScenarioPlaceDetails  = "placeDetails"
	ScenarioNearbySearch  = "nearbySearch"
	ScenarioTextSearch    = "textSearch"
	ScenarioCityDistricts = "cityDistricts"
)

// Registry 是全部可設定的 field mask 情境。
var Registry = []Scenario{
	{
		Key:      ScenarioPlaceDetails,
		Endpoint: "places.get",
		Prefix:   "",
		Desc:     "查單一地點的詳細資料(景點卡的名稱/簡介/照片)",
		Required: []FieldInfo{
			{"displayName", TierEssentials, "地點名稱——景點卡標題"},
			{"formattedAddress", TierEssentials, "格式化地址"},
			{"location", TierEssentials, "經緯度——地圖圓點與交通時間估算都要它"},
		},
		Optional: []FieldInfo{
			{"photos", TierPro, "照片參照——景點卡縮圖與 Lightbox 的來源,拿掉就只剩佔位圖"},
			{"rating", TierPro, "Google 評分"},
			{"editorialSummary", TierEnterprise, "Google 編輯撰寫的簡介——景點卡的敘述文字。這是唯一會把這個情境推到最貴層級的欄位"},
		},
	},
	{
		Key:      ScenarioNearbySearch,
		Endpoint: "places.searchNearby",
		Prefix:   "places.",
		Desc:     "依座標查附近地點(search_attraction 的候選來源)",
		Required: []FieldInfo{
			{"id", TierEssentials, "placeId——後續 add_attraction 要用的識別碼"},
			{"displayName", TierEssentials, "地點名稱"},
			{"formattedAddress", TierEssentials, "格式化地址"},
			{"location", TierEssentials, "經緯度"},
		},
		// 刻意不放 rating/photos:改動前的 nearbyFieldMask 只有 Essentials
		// 級欄位,原註解明寫「rating/userRatingCount 屬 Pro 級(較貴),
		// 目前不取;若之後需要依評分排序,再評估是否值得多付費升級」。
		//
		// 2026-10（review 發現並修正）：第一版把它們放進 Optional,而
		// DefaultFields() 是 Required + 全部 Optional——於是 seeding 把
		// 兩個 Pro 級欄位寫進資料庫、套上線,讓這個高頻情境
		// (search_attraction 的候選查詢)從 Essentials 整檔跳到 Pro。
		// 那違反這份登錄表自己宣稱的「預設值等於改動前的那一份,不是在
		// 使用者沒有同意的情況下偷偷改變行為」。
		//
		// 要加回來的話:連同「這會讓這個情境升檔計費」一起評估,不是
		// 當成一個無害的選項列進來。
		Optional: []FieldInfo{
			{"primaryType", TierEssentials, "主要類型(餐廳/景點等)"},
		},
	},
	{
		Key:      ScenarioTextSearch,
		Endpoint: "places.searchText",
		Prefix:   "places.",
		Desc:     "用文字查地點座標(查地名、搜尋框)",
		Required: []FieldInfo{
			{"id", TierEssentials, "placeId"},
			{"displayName", TierEssentials, "地點名稱"},
			{"location", TierEssentials, "經緯度——這個情境的主要目的就是取座標"},
		},
		Optional: []FieldInfo{
			{"formattedAddress", TierEssentials, "格式化地址"},
		},
	},
	{
		Key:      ScenarioCityDistricts,
		Endpoint: "places.searchText",
		Prefix:   "places.",
		Desc:     "查城市景點並反推所屬行政區(地理輪廓底圖)",
		Required: []FieldInfo{
			{"id", TierEssentials, "placeId"},
			{"displayName", TierEssentials, "地點名稱"},
			{"formattedAddress", TierEssentials, "格式化地址"},
			{"location", TierEssentials, "經緯度"},
			{"addressComponents", TierEssentials, "行政區層級——這個情境靠它反推景點屬於哪一區,拿掉就無法分組"},
		},
		Optional: []FieldInfo{
			{"rating", TierPro, "Google 評分——同區內挑「最具代表性」的景點時用"},
			{"photos", TierPro, "照片參照"},
			{"editorialSummary", TierEnterprise, "Google 編輯簡介。會把這個情境推到最貴層級"},
		},
	},
}

// Find 依 key 取出情境定義,查無回 nil。
func Find(key string) *Scenario {
	for i := range Registry {
		if Registry[i].Key == key {
			return &Registry[i]
		}
	}
	return nil
}

// AllFields 回傳這個情境的全部欄位(必填 + 選填),供 CLI 列出可用值。
func (s Scenario) AllFields() []FieldInfo {
	out := make([]FieldInfo, 0, len(s.Required)+len(s.Optional))
	out = append(out, s.Required...)
	out = append(out, s.Optional...)
	return out
}

// DefaultFields 是這個情境的預設欄位名稱清單(必填 + 全部選填)。
//
// 預設值刻意等於「改動前程式碼裡寫死的那一份」,不是「最省錢的那一份」
// ——這個設定的目的是讓運維**能夠**調整,不是在使用者沒有同意的情況下
// 偷偷改變行為。想省錢的人自己用 CLI 砍欄位。
func (s Scenario) DefaultFields() []string {
	out := make([]string, 0, len(s.Required)+len(s.Optional))
	for _, f := range s.Required {
		out = append(out, f.Name)
	}
	for _, f := range s.Optional {
		out = append(out, f.Name)
	}
	return out
}

// IsRequired 判斷一個欄位名稱是不是這個情境的必填欄位。
func (s Scenario) IsRequired(name string) bool {
	for _, f := range s.Required {
		if f.Name == name {
			return true
		}
	}
	return false
}

// Knows 判斷一個欄位名稱是否屬於這個情境(必填或選填)。不在登錄表裡的
// 欄位一律拒絕,不是靜默忽略——送一個 Google 不認得的欄位名稱會讓整支
// API 回 400,那會讓這個情境的查詢全部失敗,不該讓它有機會被設定進去。
func (s Scenario) Knows(name string) bool {
	for _, f := range s.AllFields() {
		if f.Name == name {
			return true
		}
	}
	return false
}

// TierOf 回傳一組欄位實際落在哪個計費層級——取最高的那一個(Google 的
// 計費規則)。供 CLI 顯示「這樣設定會是哪一檔」。
func (s Scenario) TierOf(names []string) Tier {
	tier := TierEssentials
	byName := map[string]Tier{}
	for _, f := range s.AllFields() {
		byName[f.Name] = f.Tier
	}
	for _, n := range names {
		switch byName[n] {
		case TierEnterprise:
			return TierEnterprise
		case TierPro:
			tier = TierPro
		}
	}
	return tier
}

// Mask 把欄位名稱清單組成 X-Goog-FieldMask header 的值(加上這個情境
// 該有的前綴)。
func (s Scenario) Mask(names []string) string {
	prefixed := make([]string, 0, len(names))
	for _, n := range names {
		prefixed = append(prefixed, s.Prefix+n)
	}
	return strings.Join(prefixed, ",")
}

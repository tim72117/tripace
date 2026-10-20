// Package ratelimits 是全專案所有「可設定的拒絕型限流規則」的單一登錄表
// ——每一條規則的 endpoint key、預設視窗長度、預設上限次數、每日額度、
// 以及給人看的說明文字,全部集中在這個檔案的 Registry 變數裡。
//
// 2026-10 新增(使用者明確要求「都加進去,並讓所有回退的數值統一管理」)。
//
// 背景:在這之前,同一條限流規則的資訊散在四個地方,而且 endpoint key
// 是字串字面值、各處重複:
//   - cmd/server/main.go           CLI flag 的預設值(places.* 五個)
//   - cmd/server/geo_rate_limit.go seeding 與重讀時的 switch/case
//   - internal/api/api.go          plan-ai 兩支端點的硬編碼
//     SetLimitForKey(10s/1, 500ms/1)
//   - internal/geo/places.go       RateLimitConfig 的欄位
//
// 新增一條規則要同時改四處、漏一處就靜默失效(plan-ai 那兩支正是漏掉的
// 證據:geo_rate_limits 表、後台管理介面、重讀迴圈全部沒有它們,只能改
// 程式碼重新部署)。
//
// 這份登錄表是那四處共同的來源:
//   - main.go 的 flag 預設值讀 Registry
//   - seeding 遍歷 Registry,不再逐條手寫 if !seeded[...]
//   - 重讀迴圈遍歷 Registry,不再用 switch/case 逐條對應欄位
//   - CLI 的 rate-limit list 直接印 Registry 配上資料庫現值
//
// 什麼東西「不」屬於這裡:per-user / per-IP 那兩層(見
// api.go 的 geoQueryUserThrottle* / geoQueryIPThrottle* 常數)。那兩層的
// key 是使用者 ID 與來源 IP——數量無上限、隨流量動態出現,不是這裡這種
// 「固定的少數幾個 endpoint 字串」,無法也不該逐條存進資料庫設定
// (見 api.go 對 AllowWithLimit 與 SetLimitForKey 取捨的完整說明)。
package ratelimits

import "time"

// Kind 區分一條規則是由哪一個限流器執行的——決定「改了之後誰要去套用
// 這個新值」。兩者的 endpoint key 共存在同一張 geo_rate_limits 表裡
// (表本身只存 endpoint/windowSec/maxCalls/dailyMax,不關心是誰在用),
// 但套用的對象不同,不能混。
type Kind string

const (
	// KindGoogleAPI——由 geo 套件的 defaultGateway 執行,保護「不同呼叫
	// 來源共用同一個 Google API 額度」,只在真正打 Google API 時生效
	// (透過 Gateway.Do)。套用方式:geo.UpdateDefaultGatewayRateLimit。
	KindGoogleAPI Kind = "google-api"
	// KindPlanAIEndpoint——由 api 套件的 Server.planAiRateLimiter 執行,
	// 保護「tripace 自己的這兩支查詢端點不被失控的呼叫節奏觸發大量
	// 計費」。這層針對的是 LLM 工具迴圈(見 api.go planAiRateLimiter
	// 欄位的完整說明:稽核記錄過 LLM 撞到錯誤後反覆重試同一次查詢,
	// 前端無法攔截,因為重試決策發生在 LLM 端),跟 KindGoogleAPI 那層
	// 語意不同、不能互相取代。
	KindPlanAIEndpoint Kind = "plan-ai-endpoint"
)

// RefreshInterval 是背景重讀迴圈多久從資料庫重讀一次設定並套用。
//
// 2026-10（review 發現）：這個數字原本在三處各寫死一份——cmd/server 的
// geoRateLimitRefreshInterval、維運端點回應的 appliesWithinSec、以及 CLI
// 列表結尾那行「修改後約 45 秒內生效」。有人調整重讀間隔時,端點與 CLI
// 會繼續回報舊數字,運維照著等卻沒生效,是難查的誤導。
//
// 放在這個套件:它已經是 cmd/server、internal/api、cmd/cli 三方共用的
// 登錄表,而這個常數的消費者正好是同樣的三方。
const RefreshInterval = 45 * time.Second

// Rule 是一條限流規則的靜態定義(預設值與說明),不含執行期的現值——
// 現值存在 geo_rate_limits 表,由 store.ListGeoRateLimits 讀取。
type Rule struct {
	// Endpoint 是這條規則的 key,同時是 geo_rate_limits 表的主鍵、
	// RateLimiter.SetLimitForKey 的 key、CLI/後台顯示用的識別字串。
	Endpoint string
	Kind     Kind
	// DefaultWindow/DefaultMaxCalls 是「資料庫裡還沒有這條規則」或
	// 「讀取資料庫失敗」時的回退值(seeding 用它寫入初始列,重讀失敗時
	// 維持它)。
	DefaultWindow   time.Duration
	DefaultMaxCalls int
	// DefaultDailyMax 是每日總額度上限,0 表示不限制。只有
	// places.photoMedia 這種依張數計費的呼叫需要(見 cmd/server/main.go
	// 對 geoRateLimitPhotoMediaDailyMax 的說明);其餘規則一律 0。
	//
	// 注意每日額度不需要重讀迴圈才生效——storeGeoDailyQuotaChecker
	// .AllowDaily 每次呼叫都直接查資料庫目前的值,天生即時。
	DefaultDailyMax int
	// Desc 是給人看的一句話說明,CLI 的 rate-limit list 與後台管理介面
	// 都讀它,不需要各自維護一份對照表。
	Desc string
	// RejectBehavior 說明這條規則被觸發(超過上限)時呼叫端會看到什麼。
	// 這件事各條規則並不一致——有的回 429 讓呼叫端失敗,有的靜默降級成
	// 較少的結果,調整數值前需要知道代價,所以寫在規則本身而不是散在
	// 各 handler 的註解裡。
	RejectBehavior string
}

// 以下 endpoint key 常數是全專案唯一的定義處。api 套件與 geo 套件原本
// 各自宣告自己那幾個字串字面值,改成引用這裡,避免「改了一處、另一處
// 還是舊字串」造成的靜默失效(key 不相符時 SetLimitForKey 設定的是另一
// 條規則,而 Allow 查的那條永遠是未設定狀態,等於沒有限流)。
const (
	EndpointPlaceGet     = "places.get"
	EndpointPhotoMedia   = "places.photoMedia"
	EndpointSearchText   = "places.searchText"
	EndpointSearchNearby = "places.searchNearby"
	EndpointGeocode      = "geocode"

	// EndpointPublicPlaceSearch/EndpointNearbyAttractionSearch——plan-ai
	// 的兩支查詢端點。值沿用 api 套件原本的字串("public." 前綴),不
	// 改名:這兩個字串已經是 geo_rate_limits 表的資料(若某個環境先前
	// 手動設定過)與既有 log 的一部分,改名會讓既有設定與記錄對不上,
	// 而重新命名本身沒有帶來任何好處。
	EndpointPublicPlaceSearch      = "public.placeSearch"
	EndpointNearbyAttractionSearch = "public.nearbyAttractionSearch"
)

// Registry 是全部可設定的限流規則。順序決定 CLI/後台列出時的顯示順序
// ——先 Google API 五條(依計費風險由高到低),再 plan-ai 兩條。
var Registry = []Rule{
	{
		Endpoint: EndpointPhotoMedia,
		Kind:     KindGoogleAPI,
		// 60s/60——與 cmd/server/main.go 原本的 flag 預設值一致
		// (-geo-rate-limit-photo-media-window-sec / -max-calls)。
		// 注意 geo.RateLimitConfig 的欄位註解寫著「地點照片 10 分鐘
		// 視窗內最多 1 次」,那是更早一版的值、已經與 flag 不符;這裡
		// 一律以 flag 的實際預設值為準,不照註解寫。
		DefaultWindow:   60 * time.Second,
		DefaultMaxCalls: 60,
		DefaultDailyMax: 100,
		Desc:            "地點照片下載(依張數計費,風險最高)",
		RejectBehavior:  "拒絕這次下載,呼叫端改用佔位圖或既有快取",
	},
	{
		Endpoint: EndpointPlaceGet,
		Kind:     KindGoogleAPI,
		// 60s/300——與 flag 預設值一致(同 photoMedia:geo 套件註解裡
		// 「10 秒內最多 1 次」是舊值,不採用)。
		DefaultWindow:   60 * time.Second,
		DefaultMaxCalls: 300,
		Desc:            "地點資訊查詢(GetPlaceDetails / ListPlacePhotoRefs)",
		RejectBehavior:  "回傳 apigateway.ErrRateLimited,呼叫端各自降級",
	},
	{
		Endpoint:        EndpointSearchText,
		Kind:            KindGoogleAPI,
		DefaultWindow:   60 * time.Second,
		DefaultMaxCalls: 120,
		Desc:            "城市/文字搜尋(以文字查地點)",
		RejectBehavior:  "回傳 apigateway.ErrRateLimited,呼叫端各自降級",
	},
	{
		Endpoint:        EndpointSearchNearby,
		Kind:            KindGoogleAPI,
		DefaultWindow:   60 * time.Second,
		DefaultMaxCalls: 120,
		Desc:            "附近景點/飯店查詢(以座標查地點)",
		RejectBehavior:  "回傳 apigateway.ErrRateLimited,呼叫端各自降級",
	},
	{
		Endpoint:        EndpointGeocode,
		Kind:            KindGoogleAPI,
		DefaultWindow:   60 * time.Second,
		DefaultMaxCalls: 120,
		Desc:            "地址轉座標",
		RejectBehavior:  "回傳 apigateway.ErrRateLimited,呼叫端各自降級",
	},
	{
		Endpoint:      EndpointPublicPlaceSearch,
		Kind:          KindPlanAIEndpoint,
		DefaultWindow: 10 * time.Second,
		// 1 次——全域共用同一個 key,不分呼叫者。注意這代表同一時間
		// 不同使用者會互相排擠:一個人查過之後,10 秒內另一個人會拿到
		// 429。這是刻意的成本保護(額度是專案共用的,不是 per-user 的),
		// 但也是這條規則最可能需要依實際使用量調整的地方。
		DefaultMaxCalls: 1,
		Desc:            "plan-ai 查地名取座標(search_attraction 的第一段)",
		RejectBehavior:  "回 429,search_attraction 工具呼叫失敗",
	},
	{
		Endpoint: EndpointNearbyAttractionSearch,
		Kind:     KindPlanAIEndpoint,
		// 500ms——2026-10 使用者明確要求從原本沿用的 10 秒縮短(真實
		// 踩坑:10 秒視窗下 /ai-plan 對話中連續幾次查詢很容易撞上同一
		// 個視窗,導致後面的呼叫降級成只回傳資料庫候選、完全沒機會觸發
		// Google Nearby Search 補點,候選數從預期的 10 筆掉到只剩幾筆)。
		// 這代表這層保護幾乎不再能防住短時間內重複觸發計費 API,是使用者
		// 評估過後接受的取捨。
		DefaultWindow:   500 * time.Millisecond,
		DefaultMaxCalls: 1,
		Desc:            "plan-ai 查附近景點候選(search_attraction 的第二段)",
		RejectBehavior:  "靜默降級成只回傳資料庫候選(HTTP 200,筆數較少)",
	},
}

// Find 依 endpoint key 取出規則定義,查無時回傳 nil——呼叫端自行決定
// 要當成錯誤(CLI 的 rate-limit set 收到不存在的 endpoint)或忽略
// (重讀時遇到資料庫裡有、但程式已經移除的舊 endpoint)。
func Find(endpoint string) *Rule {
	for i := range Registry {
		if Registry[i].Endpoint == endpoint {
			return &Registry[i]
		}
	}
	return nil
}

// OfKind 取出某一類的全部規則,供各自的套用方使用(geo 那邊只關心
// KindGoogleAPI、api 那邊只關心 KindPlanAIEndpoint)。
func OfKind(k Kind) []Rule {
	var out []Rule
	for _, r := range Registry {
		if r.Kind == k {
			out = append(out, r)
		}
	}
	return out
}

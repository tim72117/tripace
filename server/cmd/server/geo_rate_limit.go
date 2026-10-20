package main

import (
	"log"
	"time"

	"github.com/tim72117/tripace/internal/apigateway"
	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/ratelimits"
	"github.com/tim72117/tripace/internal/store"
)

// storeGeoDailyQuotaChecker 是 apigateway.DailyQuotaChecker 的實作,把
// 每日額度的用量計數存進 store 的 geo_rate_limits 表(見
// store.IncrementGeoRateLimitDailyUsage)——轉接手法同 storeGeoCallLogger
// (見該型別的完整說明:geo/apigateway 套件本身都不依賴 store,由持有
// *store.Store 的這一層做轉接)。
//
// AllowDaily 每次呼叫都對資料庫做一次原子遞增(不是先查再判斷再寫),
// 理由同 store.IncrementGeoRateLimitDailyUsage 的完整說明——避免
// read-modify-write 競態。today 用呼叫當下的 UTC 日期字串(對齊
// store.now() 回傳 UTC 的既有慣例,見 store.go 的說明),不是伺服器
// 本地時區——這樣才能保證跟 store 層寫入 UpdatedAt 用的同一個時間基準
// 一致,避免「日額度重置時間點」因為兩處各自求值用了不同時區而產生
// 微妙的偏差。
type storeGeoDailyQuotaChecker struct {
	store *store.Store
}

func (c storeGeoDailyQuotaChecker) AllowDaily(endpoint string) (bool, error) {
	today := time.Now().UTC().Format("2006-01-02")
	usedToday, dailyMax, ok, err := c.store.IncrementGeoRateLimitDailyUsage(endpoint, today)
	if err != nil {
		return false, err
	}
	if !ok {
		// 這個 endpoint 還沒有透過後台管理介面/UpsertGeoRateLimit 設定過
		// 任何規則(見該方法與 geo_rate_limits 表的完整說明)——視同「沒有
		// 每日額度限制」,不擋下這次呼叫。
		return true, nil
	}
	if dailyMax <= 0 {
		// dailyMax<=0 代表「不限制每日額度」(比照
		// apigateway.RateLimiter.SetLimitForKey 的既有語意,見
		// geoRateLimitRow.DailyMax 欄位的完整說明)——即使 UsedToday
		// 已經遞增,也不套用任何上限判斷。
		return true, nil
	}
	return usedToday <= dailyMax, nil
}

var _ apigateway.DailyQuotaChecker = storeGeoDailyQuotaChecker{}

// geoRateLimitRefreshInterval 是 startGeoRateLimitRefreshLoop 重讀資料庫
// 的週期——45 秒是「後台改完設定後,合理的等待時間內就能看到生效」與
// 「不需要頻繁到造成資料庫負擔」之間的折衷,對這個場景(限流規則不是
// 高頻變動的設定)已經足夠即時,不需要做成可設定項。
// 2026-10（review 發現）：值改為引用 ratelimits.RefreshInterval——這個
// 數字原本在三處各寫死一份,調整時會漏改(見該常數的完整說明)。
const geoRateLimitRefreshInterval = ratelimits.RefreshInterval

// seedGeoRateLimitsIfEmpty 在 process 啟動時,對五個 endpoint
// ("places.get"/"places.photoMedia"/"places.searchText"/
// "places.searchNearby"/"geocode")各自檢查資料庫是否已有資料列——沒有
// 的話,用啟動參數(fallback)讀到的值(加上這裡額外指定的
// photoMediaDailyMax)寫入一筆,讓後台管理介面第一次開啟時就能看到目前
// 實際生效的規則可編輯,而不是空白表格。已經有資料列的 endpoint 完全
// 不動(見 UpsertGeoRateLimit 的完整說明:這裡呼叫的是同一支 upsert,
// 但只在「先前沒有列」時才呼叫,不是每次啟動都覆蓋),避免每次重啟都用
// 啟動參數蓋掉後台已經儲存過的自訂設定。
//
// 2026-10 新增 places.searchText/searchNearby 兩個 endpoint 的 seed——
// 理由同 main.go geoRateLimitFallback 的說明:排隊節流解除後,這兩個
// endpoint 若沒有拒絕型限流規則可套用,會是完全沒有總量上限防護的
// 缺口。code review 另外抓到 geocode(server/internal/geo/geocode.go)
// 也是同一類缺口,這裡一併補上 seed。
//
// "places.get"/"searchText"/"searchNearby"/"geocode" 都沒有對應的每日
// 額度啟動參數(目前只對 photoMedia 設計每日額度,見 main.go 的完整
// 說明),故 dailyMax 固定傳 0(不限制)。
func seedGeoRateLimitsIfEmpty(st *store.Store, fallback geo.RateLimitConfig, photoMediaDailyMax int) {
	existing, err := st.ListGeoRateLimits()
	if err != nil {
		log.Printf("rate limit 設定初始化讀取失敗,略過 seed: %v", err)
		return
	}
	seeded := make(map[string]bool, len(existing))
	for _, r := range existing {
		seeded[r.Endpoint] = true
	}

	// 2026-10:改成遍歷 ratelimits.Registry(見該套件檔頭的完整說明),
	// 不再逐條手寫 if !seeded["places.get"] { ... } 這種樣板——原本七條
	// 規則裡只有五條被 seed,plan-ai 那兩條從來沒進過這張表(那正是
	// 「新增規則要同時改四處、漏一處就靜默失效」的實例)。遍歷之後,
	// 登錄表加一條規則就自動被 seed,不需要記得回來改這裡。
	for _, r := range ratelimits.Registry {
		if seeded[r.Endpoint] {
			continue
		}
		window, maxCalls := effectiveFallback(r, fallback, photoMediaDailyMax)
		if err := st.UpsertGeoRateLimit(r.Endpoint, windowSecForStore(window), maxCalls, r.DefaultDailyMax); err != nil {
			log.Printf("rate limit 初始化 %s 失敗: %v", r.Endpoint, err)
		}
	}
}

// windowSecForStore 把視窗長度轉成 geo_rate_limits 表能存的整數秒。
//
// 2026-10（review 發現）：原本直接寫 int(window/time.Second),對不滿
// 一秒的視窗會截斷成 0——ratelimits.Registry 裡
// public.nearbyAttractionSearch 的預設值正是 500ms,在全新環境
// (資料庫還沒有這條規則)seeding 會寫入 0 秒。
//
// 0 秒不會讓限流失效(RateLimiter.SetLimitForKey 對 window <= 0 會夾成
// 1 秒,見該方法),所以不是安全漏洞;但它會造成兩個靜默的錯誤:
//  1. 實際生效的視窗變成 1 秒,不是設計的 500ms——方向上更嚴格,
//     而這條規則當初刻意縮短到 500ms 就是因為 10 秒太嚴格會讓候選
//     數量掉下來(見登錄表對這條規則的完整說明),被夾成 1 秒等於
//     把那次調整的一半效果吃掉。
//  2. CLI/後台會顯示「視窗 0 秒」,看起來像沒有限制。
//
// 改成不滿一秒時進位成 1 秒,並明確記一則 log——進位後的值跟夾取後
// 實際生效的值一致(都是 1 秒),資料庫裡存的因此不再是個會誤導人的 0,
// 而 log 讓「這條規則的設計值存不進資料表」這件事看得見,不是悄悄發生。
func windowSecForStore(window time.Duration) int {
	sec := int(window / time.Second)
	if sec == 0 && window > 0 {
		log.Printf("rate limit: 視窗 %v 不滿一秒,geo_rate_limits 表只存整數秒,進位成 1 秒寫入"+
			"(實際生效值與此一致——RateLimiter 對不滿一秒的視窗也會夾成 1 秒)", window)
		return 1
	}
	return sec
}

// effectiveFallback 算出一條規則的回退值:KindGoogleAPI 的五條仍以啟動
// 參數(geo.RateLimitConfig,來自 CLI flag/環境變數)為準,KindPlanAIEndpoint
// 的兩條直接用登錄表的預設值。
//
// 為什麼 Google 那五條不直接用登錄表的 DefaultWindow:那五條有既有的
// CLI flag 與環境變數管道(見 main.go),運維上可能已經在用;登錄表的
// 預設值只是「連 flag 都沒給」時的最終回退。兩者數值目前一致(登錄表
// 的預設值就是照 flag 的預設值寫的),但 flag 的優先序必須保留,否則
// 現有部署的設定會在這次改動後被靜默忽略。
//
// photoMediaDailyMax 參數保留不變(仍由 main.go 的 flag 傳入),但只對
// photoMedia 那一條有意義——其餘規則的 DefaultDailyMax 是 0。
func effectiveFallback(r ratelimits.Rule, fallback geo.RateLimitConfig, photoMediaDailyMax int) (time.Duration, int) {
	switch r.Endpoint {
	case ratelimits.EndpointPlaceGet:
		return fallback.PlaceGetWindow, fallback.PlaceGetMaxCalls
	case ratelimits.EndpointPhotoMedia:
		return fallback.PhotoMediaWindow, fallback.PhotoMediaMaxCalls
	case ratelimits.EndpointSearchText:
		return fallback.SearchTextWindow, fallback.SearchTextMaxCalls
	case ratelimits.EndpointSearchNearby:
		return fallback.SearchNearbyWindow, fallback.SearchNearbyMaxCalls
	case ratelimits.EndpointGeocode:
		return fallback.GeocodeWindow, fallback.GeocodeMaxCalls
	default:
		return r.DefaultWindow, r.DefaultMaxCalls
	}
}

// startGeoRateLimitRefreshLoop 啟動一個背景 goroutine,定期(見
// geoRateLimitRefreshInterval)從 geo_rate_limits 表重讀限流規則並套用
// (見 geo.UpdateDefaultGatewayRateLimit),讓後台管理介面(見
// server/internal/adminconsole)修改限速視窗/上限次數後,不需要重啟這支
// process 就能在短時間內生效——每日額度(DailyMax)不需要這個重讀迴圈
// 才能生效,因為 storeGeoDailyQuotaChecker.AllowDaily 每次呼叫都直接查
// 資料庫目前的值,天生就是即時的;這裡只處理 WindowSec/MaxCalls 這兩個
// 被複製進 apigateway.RateLimiter 記憶體狀態的欄位。
//
// 用 context 取消而非時間到就結束——這個迴圈預期跟 process 生命週期
// 一樣長,呼叫端(main.go)傳入的 ctx 通常是 context.Background(),不會
// 真的被取消,除非未來有需要優雅關閉的情境。
//
// 資料庫暫時查詢失敗只記 log、不中斷迴圈——理由同 storeGeoCallLogger
// 的既有慣例,可觀測性/設定同步機制本身不該讓 process 整個掛掉,下一輪
// 重試即可。
func startGeoRateLimitRefreshLoop(st *store.Store, interval time.Duration, fallback geo.RateLimitConfig, applier planAILimitApplier) {
	go func() {
		for {
			time.Sleep(interval)
			applyRateLimitsFromStore(st, fallback, applier)
			// field mask 跟限流同一個重讀週期(見
			// cmd/server/geo_field_masks.go 的完整說明)——兩者都是成本
			// 設定、調整頻率同樣低,不需要各跑一個 goroutine。
			applyFieldMasksFromStore(st)
		}
	}()
}

// planAILimitApplier 是 applyRateLimitsFromStore 套用 KindPlanAIEndpoint
// 規則的目標——實際上是 *api.Server(見其 ApplyPlanAIRateLimits 方法)。
// 宣告成介面而不是直接依賴 *api.Server:這個檔案屬於 cmd/server,本來就
// 持有 Server 實例,但用介面能讓 applyRateLimitsFromStore 在測試或未來
// 有第二個套用目標時不被綁死,也讓這裡的依賴方向看得出來是「cmd 層把
// 設定推給 api 層」,不是反過來。
type planAILimitApplier interface {
	ApplyPlanAIRateLimits(map[string]struct {
		Window   time.Duration
		MaxCalls int
	})
}

// applyRateLimitsFromStore 從 geo_rate_limits 表讀出全部規則,依 Kind
// 分派給各自的套用方:KindGoogleAPI 交給 geo.UpdateDefaultGatewayRateLimit,
// KindPlanAIEndpoint 交給 planAILimitApplier(*api.Server)。
//
// 2026-10 改名(原 applyGeoRateLimitsFromStore)並擴充(使用者明確要求
// 「都加進去」):原本只處理 Google API 那五條,plan-ai 兩條完全不在
// 這條路徑上——它們在 api.New 裡硬編碼,改了資料庫也不會生效。
//
// 資料庫裡沒有某條規則的資料列時(例如全新環境、後台尚未儲存過),該
// 規則退回呼叫端傳入的 fallback 值(啟動時的 flag/環境變數),不是
// 「那條規則不受限流」——這是刻意的:讓「從未設定過」等同「維持啟動
// 參數」,而非意外把原本設定好的保護關掉。
//
// applier 可以是 nil(例如還沒建立 Server 就先套用一次設定的情境),
// 這時只套用 Google API 那一側,不當成錯誤。
func applyRateLimitsFromStore(st *store.Store, fallback geo.RateLimitConfig, applier planAILimitApplier) {
	rows, err := st.ListGeoRateLimits()
	if err != nil {
		log.Printf("rate limit 設定讀取失敗,維持目前規則不變: %v", err)
		return
	}

	cfg := fallback
	planAI := make(map[string]struct {
		Window   time.Duration
		MaxCalls int
	})
	for _, r := range rows {
		rule := ratelimits.Find(r.Endpoint)
		if rule == nil {
			// 資料庫裡有、但登錄表沒有的 endpoint——程式已經移除那條
			// 規則,資料列還留著。忽略即可,不必刪:留著不影響行為,
			// 而自動刪除別人手動設定過的資料列風險更高。
			continue
		}
		window := time.Duration(r.WindowSec) * time.Second
		// window_sec <= 0 視為「這一列沒有有效的視窗值」,退回登錄表的
		// 預設值,不要把 0 套進限流器。
		//
		// 2026-10（review 發現）：seeding 原本用 int(window/time.Second)
		// 截斷,對不滿一秒的規則(nearbyAttractionSearch 的 500ms)會寫入
		// 0。seeding 本身已經修好(見 windowSecForStore),但「已有資料列
		// 就完全不動」的語意代表**既有環境資料庫裡已經寫壞的那一列不會
		// 被自動修正**——沒有這道守衛,那些環境每 45 秒就會把 0 套進
		// SetLimitForKey,被夾成 1 秒(見 apigateway.RateLimiter 該方法),
		// 視窗靜默變成設計值的兩倍長。
		//
		// 退回預設值而不是略過整列:maxCalls/dailyMax 可能是管理員刻意
		// 設定過的有效值,不該因為 window 欄位壞掉就一併丟棄。
		if r.WindowSec <= 0 {
			log.Printf("rate limit %s 的資料列 window_sec=%d 無效,這次改用程式碼預設值 %v"+
				"（要清掉這筆壞值,用 tripace-cli rate-limit set 設一個有效的整數秒）",
				r.Endpoint, r.WindowSec, rule.DefaultWindow)
			window = rule.DefaultWindow
		}
		switch rule.Kind {
		case ratelimits.KindGoogleAPI:
			switch r.Endpoint {
			case ratelimits.EndpointPlaceGet:
				cfg.PlaceGetWindow, cfg.PlaceGetMaxCalls = window, r.MaxCalls
			case ratelimits.EndpointPhotoMedia:
				cfg.PhotoMediaWindow, cfg.PhotoMediaMaxCalls = window, r.MaxCalls
			case ratelimits.EndpointSearchText:
				cfg.SearchTextWindow, cfg.SearchTextMaxCalls = window, r.MaxCalls
			case ratelimits.EndpointSearchNearby:
				cfg.SearchNearbyWindow, cfg.SearchNearbyMaxCalls = window, r.MaxCalls
			case ratelimits.EndpointGeocode:
				cfg.GeocodeWindow, cfg.GeocodeMaxCalls = window, r.MaxCalls
			}
		case ratelimits.KindPlanAIEndpoint:
			planAI[r.Endpoint] = struct {
				Window   time.Duration
				MaxCalls int
			}{Window: window, MaxCalls: r.MaxCalls}
		}
	}
	geo.UpdateDefaultGatewayRateLimit(cfg)
	if applier != nil {
		applier.ApplyPlanAIRateLimits(planAI)
	}
}

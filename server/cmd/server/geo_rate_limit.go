package main

import (
	"log"
	"time"

	"github.com/tim72117/tripace/internal/apigateway"
	"github.com/tim72117/tripace/internal/geo"
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
const geoRateLimitRefreshInterval = 45 * time.Second

// seedGeoRateLimitsIfEmpty 在 process 啟動時,對 "places.get"/
// "places.photoMedia" 兩個 endpoint 各自檢查資料庫是否已有資料列——
// 沒有的話,用啟動參數(fallback)讀到的值(加上這裡額外指定的
// photoMediaDailyMax)寫入一筆,讓後台管理介面第一次開啟時就能看到
// 目前實際生效的規則可編輯,而不是空白表格。已經有資料列的 endpoint
// 完全不動(見 UpsertGeoRateLimit 的完整說明:這裡呼叫的是同一支
// upsert,但只在「先前沒有列」時才呼叫,不是每次啟動都覆蓋),避免每次
// 重啟都用啟動參數蓋掉後台已經儲存過的自訂設定。
//
// "places.get" 沒有對應的每日額度啟動參數(這次只對 photoMedia 新增
// 每日額度,見 main.go 的完整說明),故 dailyMax 固定傳 0(不限制)。
func seedGeoRateLimitsIfEmpty(st *store.Store, fallback geo.RateLimitConfig, photoMediaDailyMax int) {
	existing, err := st.ListGeoRateLimits()
	if err != nil {
		log.Printf("geo rate limit 設定初始化讀取失敗,略過 seed: %v", err)
		return
	}
	seeded := make(map[string]bool, len(existing))
	for _, r := range existing {
		seeded[r.Endpoint] = true
	}

	if !seeded["places.get"] {
		if err := st.UpsertGeoRateLimit("places.get", int(fallback.PlaceGetWindow/time.Second), fallback.PlaceGetMaxCalls, 0); err != nil {
			log.Printf("geo rate limit 初始化 places.get 失敗: %v", err)
		}
	}
	if !seeded["places.photoMedia"] {
		if err := st.UpsertGeoRateLimit("places.photoMedia", int(fallback.PhotoMediaWindow/time.Second), fallback.PhotoMediaMaxCalls, photoMediaDailyMax); err != nil {
			log.Printf("geo rate limit 初始化 places.photoMedia 失敗: %v", err)
		}
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
func startGeoRateLimitRefreshLoop(st *store.Store, interval time.Duration, fallback geo.RateLimitConfig) {
	go func() {
		for {
			time.Sleep(interval)
			applyGeoRateLimitsFromStore(st, fallback)
		}
	}()
}

// applyGeoRateLimitsFromStore 讀一次 geo_rate_limits 表,把
// "places.get"/"places.photoMedia" 兩個 key 目前的 WindowSec/MaxCalls
// 套用到預設 Gateway 的 RateLimiter——資料庫裡沒有某個 key 的資料列時
// (例如全新環境、後台管理介面尚未儲存過任何設定),該 key 退回呼叫端
// 傳入的 fallback 值(啟動時的 flag/環境變數預設值,見 main.go 呼叫端的
// 說明),不是「該 key 不受限流」——這是刻意的:讓「後台從未設定過」
// 這個狀態等同「維持啟動參數」,而非意外把原本設定好的保護關掉。
func applyGeoRateLimitsFromStore(st *store.Store, fallback geo.RateLimitConfig) {
	rows, err := st.ListGeoRateLimits()
	if err != nil {
		log.Printf("geo rate limit 設定讀取失敗,維持目前規則不變: %v", err)
		return
	}

	cfg := fallback
	for _, r := range rows {
		switch r.Endpoint {
		case "places.get":
			cfg.PlaceGetWindow = time.Duration(r.WindowSec) * time.Second
			cfg.PlaceGetMaxCalls = r.MaxCalls
		case "places.photoMedia":
			cfg.PhotoMediaWindow = time.Duration(r.WindowSec) * time.Second
			cfg.PhotoMediaMaxCalls = r.MaxCalls
		}
	}
	geo.UpdateDefaultGatewayRateLimit(cfg)
}

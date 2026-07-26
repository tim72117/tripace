// Command server 啟動 Trip 後端 HTTP 服務(SQLite 原型)。
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/tim72117/tripace/internal/adminconsole"
	"github.com/tim72117/tripace/internal/api"
	"github.com/tim72117/tripace/internal/apigateway"
	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/geosettings"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/store"

	"github.com/joho/godotenv"
)

func main() {
	// 載入 .env(若存在):讓 DATABASE_URL 等環境變數免手動 export。
	// 找不到 .env 不算錯誤(維持本機 SQLite 後備)。
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		log.Printf("載入 .env: %v", err)
	}

	// 預設只綁 127.0.0.1:本機開發不對外部網路開放,Windows 防火牆不會跳出詢問框。
	// 雲端(Cloud Run 等)需要監聽所有介面時,由下方 PORT 環境變數覆寫。
	addr := flag.String("addr", "127.0.0.1:8080", "HTTP 監聽位址")
	dbPath := flag.String("db", "tripace.db", "DB 連線:SQLite 檔案路徑,或 DATABASE_URL 未設時的後備")
	seed := flag.Bool("seed", true, "資料庫為空時寫入示範資料")
	jwtSecret := flag.String("jwt-secret", auth.DefaultDevJWTSecret, "JWT 簽章金鑰")
	devMode := flag.Bool("dev", true, "開發模式:Apple token 不驗簽章")
	// admin:是否在這支 binary 裡一併掛載管理後台路由(/admin/*)——低耦合
	// 的「可選合併」開關,見 static_admin.go 開頭的說明。預設關閉,維持
	// 這支主服務 binary 原本不含 adminconsole 依賴的既有行為;
	// 需要合併部署時才透過這個 flag 或下方的 ADMIN_ENABLED 環境變數開啟。
	// 這與 cmd/adminserver 那支獨立 binary 完全無關,兩者可以同時存在、
	// 各自獨立部署,不互相影響(這次刻意不變動 cmd/adminserver 與其部署
	// 設定,只是讓 cmd/server 多一個「可選掛載」的能力)。
	admin := flag.Bool("admin", false, "是否一併掛載管理後台路由(/admin/*),與獨立部署的 cmd/adminserver 二選一或並存")
	// geoMaxConcurrency/geoMinIntervalMs:對 Google Places/Geocoding API
	// 的排隊型節流設定(見 internal/apigateway 的說明),整個 process 共用
	// 一份額度,不是每個請求各自的限制。
	//
	// 2026-10 使用者明確要求移除這組排隊機制,預設值改成不限制(見
	// apigateway.DefaultConfig 的完整說明:實測這組排隊在短時間一批查詢
	// 湧入時,會讓排在後面的請求等待逾時,但排隊本身又不能真正防止總量
	// 無上限累積)——保留這兩個 flag/環境變數是為了不破壞既有部署設定的
	// 相容性與偵錯彈性(例如懷疑某次事故與併發暴衝有關時,可以臨時調
	// 緊),但預設不再啟用排隊,總量控管責任完全交給下面的拒絕型
	// RateLimiter(geoRateLimit* 這組參數)。
	geoMaxConcurrency := flag.Int("geo-max-concurrency", apigateway.DefaultConfig().MaxConcurrency, "對 Google Places/Geocoding API 同時可以在飛行中的最大請求數,<=0 表示不限制(預設)")
	geoMinIntervalMs := flag.Int64("geo-min-interval-ms", apigateway.DefaultConfig().MinInterval.Milliseconds(), "對 Google Places/Geocoding API 連續請求之間至少間隔多少毫秒,<=0 表示不限制(預設)")
	// geoRateLimit*:對 Google Places/Geocoding API 五個 endpoint 分別
	// 設定的拒絕型限流(見 apigateway.RateLimiter、geo.RateLimitConfig
	// 的完整說明)——"places.get"(地點資訊——GetPlaceDetails/
	// ListPlacePhotoRefs)、"places.photoMedia"(地點照片——
	// PhotoDataURI,依張數計費的圖片下載)、"places.searchText"(城市/
	// 文字搜尋)、"places.searchNearby"(附近景點/飯店查詢)、"geocode"
	// (地址轉座標,見 geo.Client.Geocode)。跟上面
	// geoMaxConcurrency/geoMinIntervalMs 是完全不同的機制:那組參數
	// (2026-10 起預設不限制)是「排隊,最終還是會送出」;這裡才是真正
	// 「超過就拒絕」的總量上限,目的是防止惡意或異常流量長時間持續
	// 發送、最終累積無上限的計費呼叫(這個風險原本記在
	// docs/audit-place-photo-cost-control-2026-09.md 的 R1,已由這組總量上限
	// 修復並從該文件移除)。
	//
	// 2026-10 之前只有 places.get/places.photoMedia 兩個 endpoint 套用
	// 這組拒絕型限流,其餘 endpoint 只靠上面的排隊節流保護。使用者明確
	// 要求移除排隊節流後,若不讓其餘 endpoint 也納入拒絕型限流,會變成
	// 完全沒有任何總量上限的缺口,故先把 geoRateLimitFallback 擴充成
	// searchText/searchNearby 都有對應設定;code review 另外抓到
	// geocode 也遺漏在這波擴充之外,之後一併補上第五個 endpoint(見下方)。
	//
	// 2026-10 使用者明確要求把 places.get/photoMedia 這兩個 endpoint 的
	// 視窗單位從「秒」改成「分鐘」:原本 10 秒/1 次、5 秒/1 次的視窗太短,
	// AI 對話連續查詢多個景點時容易在短短幾秒內就把額度用完、被固定
	// 視窗的邊界效應卡住(見 RateLimiter 檔頭對這個邊緣效應的完整說明)。
	// 兩個 endpoint 視窗長度都改成 60 秒。
	//
	// places.get(地點資訊查詢)上限次數:使用者後續再次明確要求改成
	// 「一分鐘 300 次」(比先前以「每秒 1 次」換算出的 60 次更寬鬆)——
	// 地點資訊查詢相對便宜,這個數字已經足夠覆蓋正常使用情境下的連續
	// 查詢節奏,仍保有「總量有上限」的核心防護目的。
	//
	// places.photoMedia(地點照片下載,依張數計費)維持以「每秒 1 次」
	// 換算出的 60 秒視窗 60 次上限——使用者只明確要求調整 places.get 的
	// 數字,photoMedia 風險較高(依張數計費),沒有要求跟著放寬,維持原本
	// 換算結果。
	//
	// places.searchText/places.searchNearby:新納入保護,預設值比
	// places.get 更保守(60 秒視窗 120 次)——這兩個 endpoint 對應的是
	// 城市搜尋/附近景點查詢,正常使用節奏比單點地點資訊查詢更稀疏,先用
	// 比 places.get 寬鬆但比 photoMedia 寬鬆的中間值起步,待有實際流量
	// 數據後可再經由後台管理介面調整,不需要重啟 process。
	geoRateLimitPlaceGetWindowSec := flag.Int64("geo-rate-limit-place-get-window-sec", 60, "對 places.get(地點資訊查詢)限流的視窗長度(秒)")
	geoRateLimitPlaceGetMaxCalls := flag.Int("geo-rate-limit-place-get-max-calls", 300, "對 places.get(地點資訊查詢)視窗內最多可放行的呼叫次數,超過直接拒絕")
	geoRateLimitPhotoMediaWindowSec := flag.Int64("geo-rate-limit-photo-media-window-sec", 60, "對 places.photoMedia(地點照片下載,依張數計費)限流的視窗長度(秒)")
	geoRateLimitPhotoMediaMaxCalls := flag.Int("geo-rate-limit-photo-media-max-calls", 60, "對 places.photoMedia(地點照片下載)視窗內最多可放行的呼叫次數,超過直接拒絕")
	geoRateLimitPhotoMediaDailyMax := flag.Int("geo-rate-limit-photo-media-daily-max", 100, "對 places.photoMedia(地點照片下載)每日總額度上限,0 表示不限制")
	geoRateLimitSearchTextWindowSec := flag.Int64("geo-rate-limit-search-text-window-sec", 60, "對 places.searchText(城市/文字搜尋)限流的視窗長度(秒)")
	geoRateLimitSearchTextMaxCalls := flag.Int("geo-rate-limit-search-text-max-calls", 120, "對 places.searchText(城市/文字搜尋)視窗內最多可放行的呼叫次數,超過直接拒絕")
	geoRateLimitSearchNearbyWindowSec := flag.Int64("geo-rate-limit-search-nearby-window-sec", 60, "對 places.searchNearby(附近景點/飯店查詢)限流的視窗長度(秒)")
	geoRateLimitSearchNearbyMaxCalls := flag.Int("geo-rate-limit-search-nearby-max-calls", 120, "對 places.searchNearby(附近景點/飯店查詢)視窗內最多可放行的呼叫次數,超過直接拒絕")
	// geoRateLimitGeocode*:2026-10 code review 抓到的缺口——geocode(見
	// server/internal/geo/geocode.go 第 55 行)在排隊節流解除前至少受
	// Gateway 的 MaxConcurrency/MinInterval 保底,解除後若不補上拒絕型
	// 限流規則,會變成唯一完全不受節流的 Google API 呼叫路徑。預設值
	// 比照 searchText/searchNearby,視窗 60 秒、上限 120 次,待有實際
	// 流量數據後可再經由後台管理介面調整。
	geoRateLimitGeocodeWindowSec := flag.Int64("geo-rate-limit-geocode-window-sec", 60, "對 geocode(地址轉座標)限流的視窗長度(秒)")
	geoRateLimitGeocodeMaxCalls := flag.Int("geo-rate-limit-geocode-max-calls", 120, "對 geocode(地址轉座標)視窗內最多可放行的呼叫次數,超過直接拒絕")
	// geoFetchPhotos:要不要真的向 Google Photo Media API 下載照片(見
	// geo.SetPhotosEnabled 的完整說明)。預設關閉——Photo Media 依張數
	// 計費,這是刻意保守的預設值,需要明確透過這個 flag 或下方的
	// GOOGLE_PLACES_FETCH_PHOTOS 環境變數開啟。關閉時飯店/景點/POI 查詢
	// 仍正常運作,只是拿不到照片(降級,不是整體失敗)。
	geoFetchPhotos := flag.Bool("geo-fetch-photos", false, "是否向 Google Photo Media API 下載照片(依張數計費,預設關閉)")
	// googleClientID:Google 登入(GSI 模式)驗證 ID Token 用的 OAuth Client
	// ID,見 auth.VerifyGoogleToken 的 audience 檢查。留空代表 Google 登入
	// 功能未設定,POST /v1/auth/google 會一律回 401(見該 handler)。這裡
	// 沒有對應的 flag(只走環境變數),理由同這個功能的定位:純粹是
	// 部署環境設定,不需要本機開發時用 flag 覆寫。
	googleClientID := os.Getenv("GOOGLE_OAUTH_CLIENT_ID")
	flag.Parse()

	// Cloud Run 等托管環境只方便傳環境變數(不方便改 ENTRYPOINT 傳 flag),
	// 故讓環境變數在有設時覆寫對應 flag 預設值;未設則維持本機 flag 行為不變。
	// PORT 由平台注入(Cloud Run 預設 8080),覆寫監聽位址。
	if p := os.Getenv("PORT"); p != "" {
		*addr = ":" + p
	}
	// JWT_SECRET 環境變數有設時覆寫 flag 預設值——與 cmd/adminserver 共用
	// 同一套「讀環境變數、預設值是 auth.DefaultDevJWTSecret」邏輯(見
	// auth.ResolveSecretFromEnv 的完整說明:cmd/server 跟 cmd/adminserver
	// 必須使用完全相同的 JWT secret 才能互相驗證對方簽發的 token)。這裡
	// 刻意不直接整段改呼叫 auth.ResolveSecretFromEnv()取代——這支 main.go
	// 允許 -jwt-secret flag 在「沒有 JWT_SECRET 環境變數」時仍能本機覆寫
	// 預設值(cmd/adminserver 沒有對應的 flag,只走環境變數),保留這個
	// flag 覆寫路徑,只是讓預設值常數跟環境變數讀取規則與
	// ResolveSecretFromEnv 保持一致。
	if s := os.Getenv("JWT_SECRET"); s != "" {
		*jwtSecret = s
	}
	if v := os.Getenv("DEV_MODE"); v != "" {
		*devMode = v == "1" || strings.EqualFold(v, "true")
	}
	if v := os.Getenv("SEED"); v != "" {
		*seed = v == "1" || strings.EqualFold(v, "true")
	}
	if v := os.Getenv("ADMIN_ENABLED"); v != "" {
		*admin = v == "1" || strings.EqualFold(v, "true")
	}
	if v := os.Getenv("GOOGLE_PLACES_MAX_CONCURRENCY"); v != "" {
		if parsed, perr := strconv.Atoi(v); perr == nil {
			*geoMaxConcurrency = parsed
		}
	}
	if v := os.Getenv("GOOGLE_PLACES_MIN_INTERVAL_MS"); v != "" {
		if parsed, perr := strconv.ParseInt(v, 10, 64); perr == nil {
			*geoMinIntervalMs = parsed
		}
	}
	if v := os.Getenv("GOOGLE_PLACES_FETCH_PHOTOS"); v != "" {
		*geoFetchPhotos = v == "1" || strings.EqualFold(v, "true")
	}
	if v := os.Getenv("GOOGLE_PLACES_GET_RATE_LIMIT_WINDOW_SEC"); v != "" {
		if parsed, perr := strconv.ParseInt(v, 10, 64); perr == nil {
			*geoRateLimitPlaceGetWindowSec = parsed
		}
	}
	if v := os.Getenv("GOOGLE_PLACES_GET_RATE_LIMIT_MAX_CALLS"); v != "" {
		if parsed, perr := strconv.Atoi(v); perr == nil {
			*geoRateLimitPlaceGetMaxCalls = parsed
		}
	}
	if v := os.Getenv("GOOGLE_PLACES_PHOTO_MEDIA_RATE_LIMIT_WINDOW_SEC"); v != "" {
		if parsed, perr := strconv.ParseInt(v, 10, 64); perr == nil {
			*geoRateLimitPhotoMediaWindowSec = parsed
		}
	}
	if v := os.Getenv("GOOGLE_PLACES_PHOTO_MEDIA_RATE_LIMIT_MAX_CALLS"); v != "" {
		if parsed, perr := strconv.Atoi(v); perr == nil {
			*geoRateLimitPhotoMediaMaxCalls = parsed
		}
	}
	if v := os.Getenv("GOOGLE_PLACES_PHOTO_MEDIA_RATE_LIMIT_DAILY_MAX"); v != "" {
		if parsed, perr := strconv.Atoi(v); perr == nil {
			*geoRateLimitPhotoMediaDailyMax = parsed
		}
	}
	if v := os.Getenv("GOOGLE_PLACES_SEARCH_TEXT_RATE_LIMIT_WINDOW_SEC"); v != "" {
		if parsed, perr := strconv.ParseInt(v, 10, 64); perr == nil {
			*geoRateLimitSearchTextWindowSec = parsed
		}
	}
	if v := os.Getenv("GOOGLE_PLACES_SEARCH_TEXT_RATE_LIMIT_MAX_CALLS"); v != "" {
		if parsed, perr := strconv.Atoi(v); perr == nil {
			*geoRateLimitSearchTextMaxCalls = parsed
		}
	}
	if v := os.Getenv("GOOGLE_PLACES_SEARCH_NEARBY_RATE_LIMIT_WINDOW_SEC"); v != "" {
		if parsed, perr := strconv.ParseInt(v, 10, 64); perr == nil {
			*geoRateLimitSearchNearbyWindowSec = parsed
		}
	}
	if v := os.Getenv("GOOGLE_PLACES_SEARCH_NEARBY_RATE_LIMIT_MAX_CALLS"); v != "" {
		if parsed, perr := strconv.Atoi(v); perr == nil {
			*geoRateLimitSearchNearbyMaxCalls = parsed
		}
	}
	if v := os.Getenv("GOOGLE_PLACES_GEOCODE_RATE_LIMIT_WINDOW_SEC"); v != "" {
		if parsed, perr := strconv.ParseInt(v, 10, 64); perr == nil {
			*geoRateLimitGeocodeWindowSec = parsed
		}
	}
	if v := os.Getenv("GOOGLE_PLACES_GEOCODE_RATE_LIMIT_MAX_CALLS"); v != "" {
		if parsed, perr := strconv.Atoi(v); perr == nil {
			*geoRateLimitGeocodeMaxCalls = parsed
		}
	}

	// geoRateLimitPlaceGetMaxCalls/geoRateLimitPhotoMediaMaxCalls 必須是
	// 正整數才有意義——apigateway.RateLimiter.SetLimitForKey 把
	// maxCalls<=0 解讀成「明確要求移除這個 key 的限流」(見該函式的完整
	// 說明),不是「非常寬鬆的限制」。這兩個值最終會流入
	// seedGeoRateLimitsIfEmpty 寫進資料庫、再被 applyGeoRateLimitsFromStore
	// 讀出套用(見兩者的完整說明),若操作者透過環境變數/flag 不小心填入
	// 0 或負數(例如部署設定誤植、或誤以為 0 代表關閉某個上限),會讓
	// 這兩個依張數/次數計費的高風險 endpoint 直接失去限流保護且沒有任何
	// 錯誤訊息——後台管理介面的 updateGeoRateLimit 已經對這個情境做了
	// 同樣的驗證(見該檔案的說明),這裡補上對稱的檢查,讓啟動參數這條
	// 路徑也不可能把 0/負數當成合法設定值送進去。
	if *geoRateLimitPlaceGetMaxCalls <= 0 {
		log.Fatalf("geo-rate-limit-place-get-max-calls 必須是正整數，收到 %d", *geoRateLimitPlaceGetMaxCalls)
	}
	if *geoRateLimitPhotoMediaMaxCalls <= 0 {
		log.Fatalf("geo-rate-limit-photo-media-max-calls 必須是正整數，收到 %d", *geoRateLimitPhotoMediaMaxCalls)
	}
	if *geoRateLimitSearchTextMaxCalls <= 0 {
		log.Fatalf("geo-rate-limit-search-text-max-calls 必須是正整數，收到 %d", *geoRateLimitSearchTextMaxCalls)
	}
	if *geoRateLimitSearchNearbyMaxCalls <= 0 {
		log.Fatalf("geo-rate-limit-search-nearby-max-calls 必須是正整數，收到 %d", *geoRateLimitSearchNearbyMaxCalls)
	}
	if *geoRateLimitGeocodeMaxCalls <= 0 {
		log.Fatalf("geo-rate-limit-geocode-max-calls 必須是正整數，收到 %d", *geoRateLimitGeocodeMaxCalls)
	}

	// DATABASE_URL(postgres://…,正式環境為 Cloud SQL)優先;未設時退回 -db 的 SQLite。
	dsn := *dbPath
	if env := os.Getenv("DATABASE_URL"); env != "" {
		dsn = env
	}

	st, err := store.Open(dsn)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	// 必須在任何 geo.New() 呼叫之前設定(見 geo.ConfigureDefaultGateway
	// 的說明,底層用 sync.Once 延遲建立、重複呼叫或太晚呼叫都不會生效)——
	// 這裡是 process 生命週期最早期、st 剛建立完成的時機點,之後才會有
	// 任何 HTTP 請求進來觸發 geo.New()。
	geo.ConfigureDefaultGateway(
		apigateway.Config{MaxConcurrency: *geoMaxConcurrency, MinInterval: time.Duration(*geoMinIntervalMs) * time.Millisecond},
		storeGeoCallLogger{store: st},
	)
	// geoRateLimitFallback:啟動 flag/環境變數讀到的值,當資料庫
	// geo_rate_limits 表尚未有對應 endpoint 資料列時的退回值(見
	// applyGeoRateLimitsFromStore 的完整說明)——同一組值也用來初次
	// seed 進資料庫(見下方 seedGeoRateLimitsIfEmpty),讓後台管理介面
	// 一開啟就能看到目前實際生效的規則可編輯,而不是空白表格。
	geoRateLimitFallback := geo.RateLimitConfig{
		PlaceGetWindow:       time.Duration(*geoRateLimitPlaceGetWindowSec) * time.Second,
		PlaceGetMaxCalls:     *geoRateLimitPlaceGetMaxCalls,
		PhotoMediaWindow:     time.Duration(*geoRateLimitPhotoMediaWindowSec) * time.Second,
		PhotoMediaMaxCalls:   *geoRateLimitPhotoMediaMaxCalls,
		SearchTextWindow:     time.Duration(*geoRateLimitSearchTextWindowSec) * time.Second,
		SearchTextMaxCalls:   *geoRateLimitSearchTextMaxCalls,
		SearchNearbyWindow:   time.Duration(*geoRateLimitSearchNearbyWindowSec) * time.Second,
		SearchNearbyMaxCalls: *geoRateLimitSearchNearbyMaxCalls,
		GeocodeWindow:        time.Duration(*geoRateLimitGeocodeWindowSec) * time.Second,
		GeocodeMaxCalls:      *geoRateLimitGeocodeMaxCalls,
	}
	// 對五個 endpoint(places.get/photoMedia/searchText/searchNearby/
	// geocode)的拒絕型限流(見 geoRateLimitPlaceGet*/geoRateLimitPhotoMedia*/
	// geoRateLimitSearchText*/geoRateLimitSearchNearby*/geoRateLimitGeocode*
	// 的說明)——必須同樣在任何 geo.New() 呼叫之前設定,理由與上面
	// ConfigureDefaultGateway 相同。這裡先用啟動參數值建立,緊接著
	// seedGeoRateLimitsIfEmpty/applyGeoRateLimitsFromStore 會視資料庫
	// 內容決定要不要覆蓋成資料庫儲存的值(見兩者的完整說明)。
	geo.ConfigureDefaultGatewayRateLimit(geoRateLimitFallback)
	// 每日額度檢查器(見 storeGeoDailyQuotaChecker 的完整說明)——同樣
	// 必須在任何 geo.New() 呼叫之前設定。
	geo.ConfigureDefaultGatewayDailyQuota(storeGeoDailyQuotaChecker{store: st})
	// 統一的地點詳情快取(見 internal/geo/details_cache.go 的說明)——同樣必須在
	// 任何 geo.New() 呼叫之前設定:geo.New 建 client 的當下就會帶上這份預設快取,
	// 之後所有呼叫端(handler、onagent 工具、維運端點)自動受快取保護,
	// 不需要各自記得去接。有效期由 geo-setting 的 placeDetailsCacheHours 調整,
	// 啟動後由 startGeoSettingsRefreshLoop 套用資料庫的值。
	geo.SetDefaultDetailsCache(api.NewPlaceDetailsCache(st))
	// 啟動時把 geoRateLimitFallback(含這次新增的 photoMediaDailyMax)
	// 寫進資料庫——但只在該 endpoint 尚未有任何資料列時才寫入(見
	// seedGeoRateLimitsIfEmpty 的完整說明),避免每次重啟都用啟動參數
	// 覆蓋掉後台管理介面已經儲存過的自訂設定。緊接著讀一次資料庫套用
	// (可能該次 seed 剛寫入、也可能資料庫早已有自訂值),讓
	// defaultRateLimiter 建立當下就反映資料庫的最終結果,不需要等第一次
	// 背景重讀週期。
	seedGeoRateLimitsIfEmpty(st, geoRateLimitFallback, *geoRateLimitPhotoMediaDailyMax)
	// 這裡 applier 傳 nil:api.New() 還沒被呼叫(在下方),plan-ai 的
	// 限流器此刻還不存在。那兩條規則的初值由 api.New 自己從
	// ratelimits.Registry 套用(見該處),資料庫的現值則由下方啟動的
	// 背景重讀迴圈在第一個週期套上——plan-ai 這兩條不像 Google API 那
	// 五條必須在 geo.New() 之前就位(那是 defaultGateway 建立時機的
	// 限制),晚一個週期才套用資料庫自訂值是可接受的。
	applyRateLimitsFromStore(st, geoRateLimitFallback, nil)
	// field mask 設定(見 cmd/server/geo_field_masks.go 的完整說明)——
	// 必須在任何 geo API 呼叫之前套用,否則第一批請求會用程式碼的預設
	// mask(可能是較貴的計費層級)。seeding 與套用的順序理由同上方
	// 限流設定。
	seedGeoFieldMasksIfEmpty(st)
	applyFieldMasksFromStore(st)
	geo.SetPhotosEnabled(*geoFetchPhotos)
	if *geoFetchPhotos {
		log.Printf("Google Photo Media 下載已啟用(依張數計費)")
	} else {
		log.Printf("Google Photo Media 下載已關閉(預設值,飯店/景點/POI 查詢仍正常運作,只是拿不到照片)")
	}

	if *seed {
		if err := seedUsers(st); err != nil {
			log.Printf("seed users: %v", err)
		}
		if err := seedIfEmpty(st); err != nil {
			log.Printf("seed: %v", err)
		}
	}

	if googleClientID == "" {
		log.Printf("GOOGLE_OAUTH_CLIENT_ID 未設定,Google 登入功能停用(POST /v1/auth/google 一律回 401)")
	}

	// ADMIN_BOOTSTRAP_EMAIL 啟動期檢查(2026-10,code review 發現的維運
	// 體驗問題)——api.New() 內部會直接讀這個環境變數(見 internal/api/
	// api.go 的 Server.adminBootstrapEmail 欄位),用於
	// resolveContentPageOwnerID 的 official 模式白名單判斷,這件事跟下面
	// `-admin`/ADMIN_ENABLED 這個「要不要在這支 binary 裡一併掛載管理
	// 後台路由」的開關完全無關——即使沒有合併掛載 /admin/*,這個環境
	// 變數空白仍然代表 content-page official 模式(城市介紹頁等官方內容
	// 的管理)永遠回 403,不是只有 /admin/* 這一條路徑受影響。原本只有
	// `*admin` 分支內才會印警告(且訊息只提到 /admin/* 未設定管理權限的
	// 情境),這裡在呼叫 api.New() 之前補上一則不論 `-admin` 是否開啟都會
	// 印出的明確警告,訊息直接點名「所有 content-page official 端點都會
	// 回 403」,讓維運者不需要先搞懂 `-admin` 旗標邏輯也能定位問題——
	// 不中斷啟動(對齊「輔助功能可以降級、不影響核心功能」的既有慣例,
	// 比照上面 GOOGLE_OAUTH_CLIENT_ID 未設定時的既有降級模式:官方內容
	// 管理是輔助性的維運功能,不影響行程規劃、部落格發文等核心功能)。
	if os.Getenv("ADMIN_BOOTSTRAP_EMAIL") == "" {
		log.Printf("!!! ADMIN_BOOTSTRAP_EMAIL 未設定:所有 content-page official 模式端點(城市介紹頁等官方內容管理)會永遠回 403,/admin/* 管理後台(若有合併掛載)所有端點也會永遠回 401。如果這是預期外的情況,請檢查 ADMIN_BOOTSTRAP_EMAIL 環境變數是否正確設定——其餘核心功能(行程規劃、部落格發文等)不受影響")
	}

	signer := auth.NewSigner(*jwtSecret, 30*24*time.Hour)
	srv := api.New(st, signer, *devMode, googleClientID)
	// 背景定期重讀(見 startGeoRateLimitRefreshLoop 的完整說明)——讓後台
	// 管理介面/CLI 之後修改設定時,不需要重啟這支 process 就能在
	// geoRateLimitRefreshInterval 之內生效。
	//
	// 2026-10 移到 api.New() 之後(原本在上面 seed 緊接著):這個迴圈
	// 現在也負責把 plan-ai 兩條規則推進 srv 的限流器(見
	// applyRateLimitsFromStore),需要 srv 已經存在才能傳進去。
	startGeoRateLimitRefreshLoop(st, geoRateLimitRefreshInterval, geoRateLimitFallback, srv)
	// 數值設定(照片最大張數、照片過期週期,見 geo_settings.go):啟動時套用一次,
	// 之後背景重讀。api.New 之後才有 srv 可以套用,所以放在這裡。
	startGeoSettingsRefreshLoop(st, geosettings.RefreshInterval, srv)

	dbKind := "sqlite:" + dsn
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		dbKind = "postgres" // 不印含密碼的 DSN
	}
	// 組合最終 handler:API 路由優先;其餘交給前端靜態檔(SPA fallback)。
	// 注意:/public/{token} 由前端 React 路由處理,不放在後端 API 路由裡。
	mux := http.NewServeMux()
	mux.Handle("/v1/", srv.Routes())
	mux.Handle("/internal/", srv.Routes())
	mux.Handle("/health", srv.Routes())
	// /onagent/ — onagent 平台 BackendDispatch 主動打過來的端點,見
	// internal/api/onagent_dispatch.go 開頭說明。跟上面三個前綴一樣要明確
	//轉給 srv.Routes(),否則會落到下方 staticHandler()的 SPA fallback
	// (對任何未知路徑都回 200 + index.html,表面上「有回應」但完全沒有
	// 真正處理請求——這正是 web/tools/onagent-tools.yaml 開頭警告過的
	// 那個陷阱,這次在新增這個路由時實際踩到)。
	mux.Handle("/onagent/", srv.Routes())
	// /public/geo/ — GET /public/geo/place-details(見
	// internal/api/geo_outline.go handlePublicGeoPlaceDetails/
	// publicPlaceDetailsAllowlist 的完整說明),供登入前的公開展示頁
	// (web/src/home/KiyomizuDemoPage.tsx)免登入查詢白名單內固定景點的
	// Google Place Details。刻意只轉發 /public/geo/ 這個更深的前綴,不是
	// 整個 /public/——/public/{token} 仍照上面第 207 行註解交給前端 React
	// 路由處理(SPA fallback),兩者路徑前綴不同不會互相搶路由,但若改成
	// 轉發整個 /public/ 會連帶把 /public/{token} 也送進 srv.Routes(),
	// 那裡沒有對應 handler、Go 1.22+ mux 會回 404,反而打壞現有的分享
	// 連結頁面。同一個「新路徑要明確轉發、否則落到 SPA fallback」的陷阱,
	// 見上面 /onagent/ 的說明。
	// 2026-09:這行現在服務的是主題介紹頁/訪客分享頁用的三支端點
	// (place-details/place-photo-assets/attractions)。plan-ai 那批查詢
	// 端點原本也走這個前綴,已改為需登入、搬到 /internal/geo/plan-ai/*
	// (由上面第 258 行的 /internal/ 轉發涵蓋),**但這一行不可以跟著移除**
	// ——主題介紹頁仍然依賴它,拿掉會讓那三支端點落進 SPA fallback
	// (回 200 + index.html,前端把 HTML 當 JSON 解析失敗),是那種不會
	// 出現明顯 404、很難追查的靜默故障。
	mux.Handle("/public/geo/", srv.Routes())
	// 原本這裡還有 /public/plan-sim/ 的轉發(模擬推論 WebSocket),該端點
	// 已改為需登入並搬到 GET /internal/geo/plan-ai/sim-ws(見
	// internal/api/plan_sim_demo.go 與 api.go 路由註冊處的完整說明),由
	// 上面 /internal/ 的轉發涵蓋,不需要獨立一行。
	// /public/blog/(見 internal/api/blog_photo.go
	// handlePublicBlogPhotosByIDs 的完整說明)——部落格文章公開讀取時,
	// 把內容裡存的 photoId 批次展開成實際圖片網址用。2026-10 code
	// review 時實測發現:這支端點原本完全沒有被轉發到這裡,所有請求都
	// 落到下面的 SPA fallback(staticHandler,回 200 + 前端 index.html),
	// 而不是這支 handler——正是 /public/geo/ 這段註解提過的同一個陷阱
	// (新增 /public/* 路由忘記同步這裡,正式環境會靜默故障,不是顯眼的
	// 404)。補上這行,刻意只轉發 /public/blog/ 這個更深的前綴,理由同
	// /public/geo/:不影響 /public/{token} 的 SPA fallback 路由。
	mux.Handle("/public/blog/", srv.Routes())
	// /public/plan-ai/ — POST /public/plan-ai/chat、
	// /public/plan-ai/chat/reply(見 internal/api/plan_ai_chat.go
	// handlePlanAiChat/handlePlanAiChatReply 開頭的完整說明與
	// api.go Routes 內該區塊的註冊)——2026-10 新增,讓 /ai-plan 展示頁
	// 的未登入訪客也能送出 AI 規劃對話。同一個「新路徑要明確轉發、否則
	// 落到 SPA fallback」的陷阱,見上面 /onagent/、/public/geo/、
	// /public/blog/ 的說明——這次新增時第一次 smoke test 就實際踩到
	// (curl 打這支端點回了 200 + "build not found" 的 SPA fallback
	// 內容,而不是預期的 JSON 回應,不是顯眼的 404,若沒有手動測試會
	// 悄悄部署出一個完全無法運作的訪客對話功能)。刻意只轉發
	// /public/plan-ai/ 這個前綴,不影響 /public/{token} 的 SPA fallback
	// 路由。
	mux.Handle("/public/plan-ai/", srv.Routes())

	// 管理後台(/admin/api/*)預設拆分成獨立的 cmd/adminserver binary/
	// Cloud Run 服務(見 server/cmd/adminserver/main.go),那條部署路徑
	// 完全不受這裡影響。這裡新增的是低耦合的「可選合併」開關:-admin
	// flag 或 ADMIN_ENABLED 環境變數開啟時,同一支 cmd/server binary
	// 也能一併掛載管理後台路由,供想合併成單一部署單位的情境使用——
	// 兩種部署方式可以並存,不是互斥的。
	if *admin {
		// 管理後台的身分驗證改成消費一般使用者的 JWT(跟 /v1、/internal
		// 共用同一把 signer),用 email 白名單(ADMIN_BOOTSTRAP_EMAIL)
		// 決定誰有管理權限——不再有獨立的管理員帳號/密碼/session,見
		// adminconsole.Handler.withAdmin 的完整說明。
		adminBootstrapEmail := os.Getenv("ADMIN_BOOTSTRAP_EMAIL")
		adminMux := http.NewServeMux()
		adminconsole.NewHandler(signer, st, adminBootstrapEmail).Register(adminMux)
		adminMux.Handle("/admin/", adminStaticHandler())
		// 只有 /admin/* 這個前綴套用 withAdminCORS(credentials 政策跟
		// 一般 /v1、/internal 路由不同,見該函式的說明),不影響其餘路由。
		mux.Handle("/admin/", withAdminCORS(adminMux))
		if adminBootstrapEmail == "" {
			// 空白時的完整警告已經在上面(呼叫 api.New() 之前)統一印過
			// 一次,這裡不重複印整段訊息,只補充「這支 binary 這次啟動確實
			// 合併掛載了 /admin/*」這個額外事實,方便從 log 判斷是哪一種
			// 部署型態。
			log.Printf("管理後台已合併掛載於這支 binary(/admin/*),但 ADMIN_BOOTSTRAP_EMAIL 未設定,任何人都無法通過管理權限檢查")
		} else {
			log.Printf("管理後台已合併掛載於這支 binary(/admin/*,管理權限 email 白名單: %s)", adminBootstrapEmail)
		}
	}

	mux.Handle("/", staticHandler(st))

	log.Printf("Tripace server 監聽 %s,DB=%s", *addr, dbKind)
	if err := http.ListenAndServe(*addr, withLegacyDomainRedirect(mux)); err != nil {
		log.Fatalf("server: %v", err)
	}
}

// 舊網域(遷移前)與正式網域(遷移後)。整個服務原掛在 legacyDomain,現遷移到
// canonicalDomain(同一個 Cloud Run 服務,雙網域 domain-mapping,見
// gcloud run domain-mappings list 的實際設定)。集中定義成具名常數,未來
// 若再換網域只需改這兩處,不必到 withLegacyDomainRedirect 內部找字串。
//
// 2026-10 使用者明確要求把更早期的舊網域 app.shuttle.tools 轉址支援整個
// 移除(含獨立的 cmd/redirectserver binary、Dockerfile.redirect、
// .github/workflows/deploy-redirect.yml 與對應的 tripace-redirect Cloud
// Run 服務一併下線)——這裡的 legacyDomain/canonicalDomain 改成處理
// 新一輪的網域遷移:tripace.shuttle.tools(先前的正式網域)→ tripace.io
// (現在的正式網域),機制與原本處理 app.shuttle.tools 完全相同,只是
// 兩個常數的值換成這次要轉址的網域,不是新發明一套邏輯。
const (
	legacyDomain    = "tripace.shuttle.tools"
	canonicalDomain = "tripace.io"
)

// withLegacyDomainRedirect 包在最外層(所有路由,含 /v1、/internal、/admin、
// 靜態檔案共用):請求 Host 若是舊網域 legacyDomain,整站 301 導到
// canonicalDomain 的相同 path + query string,讓沿用舊網址的使用者與
// 搜尋引擎索引盡量轉移到新網域;其餘 Host 一律原樣放行到 next,不做任何處理。
func withLegacyDomainRedirect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host == legacyDomain {
			target := "https://" + canonicalDomain + r.URL.RequestURI()
			http.Redirect(w, r, target, http.StatusMovedPermanently)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// seedUsers 確保可邀請的使用者目錄存在(冪等,每次啟動都套用)。
// 同時為示範使用者設定可登入的 email 與預設密碼(開發測試用),
// 帳號為 <name>@channel.dev,密碼一律 "password"。
//
// 這幾個 @channel.dev 的 email 值刻意不隨這次 channel→trip 改名更動:它們
// 是既有帳號的登入憑證識別值(SetUserPassword 用 email 查找/建立使用者),
// 改動會讓本機/正式站既有帳號的 email 對不上,造成無法登入;email 只是一個
// 不透明的字串識別值,不需要跟目前的功能命名同步。
func seedUsers(st *store.Store) error {
	directory := []struct {
		user  model.User
		email string
	}{
		// usr_me 是示範行程(seedIfEmpty)的建立者/owner,需先存在於 users 表,
		// 否則寫入 members 中介表會違反外鍵約束(Postgres 會擋,SQLite 預設放行)。
		{model.User{ID: "usr_me", Name: "我", AvatarColor: "#8C7B6A"}, "me@channel.dev"},
		{model.User{ID: "usr_alice", Name: "Alice", AvatarColor: "#E07A5F"}, "alice@channel.dev"},
		{model.User{ID: "usr_bob", Name: "Bob", AvatarColor: "#3D9970"}, "bob@channel.dev"},
		{model.User{ID: "usr_carol", Name: "Carol", AvatarColor: "#B07AE0"}, "carol@channel.dev"},
		{model.User{ID: "usr_dave", Name: "Dave", AvatarColor: "#E0B24A"}, "dave@channel.dev"},
	}
	// 預設密碼只算一次雜湊(四個帳號共用同一明文 "password")。
	devHash, err := auth.HashPassword("password")
	if err != nil {
		return err
	}
	for _, d := range directory {
		if err := st.UpsertUser(d.user); err != nil {
			return err
		}
		if err := st.SetUserPassword(d.user.ID, d.email, devHash); err != nil {
			return err
		}
	}
	return nil
}

// seedIfEmpty 在沒有任何行程時建立一個示範行程(對齊 App 端 Mock)。
func seedIfEmpty(st *store.Store) error {
	n, err := st.CountTrips()
	if err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	me := model.User{ID: "usr_me", Name: "我", AvatarColor: "#8C7B6A"}
	tr, err := st.CreateTrip("tr_001", "產品討論", me)
	if err != nil {
		return err
	}
	// 原話不存後端;seed 直接寫入示範 entry(事件/條目),對齊「entry 為主體」。
	// date/clock 維持人類可讀字串,用 DefaultTimeZone() 轉成 UTC timestamp——
	// seed 資料跟真實寫入路徑(tripsvc.Record)用同一套轉換規則。
	loc := store.DefaultTimeZone()
	for _, seed := range []struct{ title, date, clock string }{
		{"開會敲定 Q3 產品規格", "2026-06-29", "15:00"},
		{"準備預算上調提案(+15%)", "2026-06-30", ""},
		{"修登入頁的 bug", "", ""},
	} {
		startAt, allDay := store.ParseLocalDateTime(seed.date, seed.clock, loc)
		tz := ""
		if startAt != nil {
			tz = loc.String()
		}
		e := model.Entry{
			ID:        "ent_" + randHex(),
			TripID:    tr.ID,
			Title:     seed.title,
			StartAt:   startAt,
			TZ:        tz,
			AllDay:    allDay,
			CreatedAt: nowUTC(),
		}
		_ = st.InsertEntry(e)
	}
	log.Printf("已寫入示範行程 %s", tr.ID)
	return nil
}

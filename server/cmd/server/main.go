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

	"github.com/tim72117/tripace/internal/adminauth"
	"github.com/tim72117/tripace/internal/adminconsole"
	"github.com/tim72117/tripace/internal/api"
	"github.com/tim72117/tripace/internal/apigateway"
	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/geo"
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
	jwtSecret := flag.String("jwt-secret", "dev-secret-change-me", "JWT 簽章金鑰")
	devMode := flag.Bool("dev", true, "開發模式:Apple token 不驗簽章")
	// admin:是否在這支 binary 裡一併掛載管理後台路由(/admin/*)——低耦合
	// 的「可選合併」開關,見 static_admin.go 開頭的說明。預設關閉,維持
	// 這支主服務 binary 原本不含 adminauth/adminconsole 依賴的既有行為;
	// 需要合併部署時才透過這個 flag 或下方的 ADMIN_ENABLED 環境變數開啟。
	// 這與 cmd/adminserver 那支獨立 binary 完全無關,兩者可以同時存在、
	// 各自獨立部署,不互相影響(這次刻意不變動 cmd/adminserver 與其部署
	// 設定,只是讓 cmd/server 多一個「可選掛載」的能力)。
	admin := flag.Bool("admin", false, "是否一併掛載管理後台路由(/admin/*),與獨立部署的 cmd/adminserver 二選一或並存")
	// geoMaxConcurrency/geoMinIntervalMs:對 Google Places/Geocoding API
	// 的節流設定(見 internal/apigateway 的說明),整個 process 共用一份
	// 額度,不是每個請求各自的限制。預設值(併發 1、間隔 2 秒)是刻意保守
	// 的選擇,避免任何單一功能(如地圖被高頻拖曳觸發的附近搜尋)短時間內
	// 對 Google API 發出大量請求,產生非預期的計費/額度消耗——這正是
	// 這個節流元件存在的理由。
	geoMaxConcurrency := flag.Int("geo-max-concurrency", apigateway.DefaultConfig().MaxConcurrency, "對 Google Places/Geocoding API 同時可以在飛行中的最大請求數")
	geoMinIntervalMs := flag.Int64("geo-min-interval-ms", apigateway.DefaultConfig().MinInterval.Milliseconds(), "對 Google Places/Geocoding API 連續請求之間至少間隔多少毫秒")
	// geoRateLimit*:對 Google Places 的 "places.get"(地點資訊——
	// GetPlaceDetails/ListPlacePhotoRefs)與 "places.photoMedia"(地點
	// 照片——PhotoDataURI,依張數計費的圖片下載)這兩個 endpoint 分別
	// 設定的拒絕型限流(見 apigateway.RateLimiter、geo.RateLimitConfig
	// 的完整說明)——跟上面 geoMaxConcurrency/geoMinIntervalMs 是完全
	// 不同的機制:那組參數只是「排隊,最終還是會送出」,不設總量上限;
	// 這裡才是真正「超過就拒絕」的總量上限,目的是防止惡意或異常流量
	// 長時間持續發送、最終累積無上限的計費呼叫(見
	// docs/audit-place-photo-cost-control-2026-09.md 的 R1 風險項目)。
	//
	// 只涵蓋這兩個 endpoint——"places.searchText"(城市搜尋)/
	// "places.searchNearby"(附近景點/飯店查詢)等其餘 endpoint 不套用
	// 這個拒絕型限流,繼續只受上面 Gateway 的排隊節流保護,理由見
	// geo.RateLimitConfig 的完整說明:這兩個 endpoint 對應「單點地點
	// 介紹」這條已評估過需要拒絕型限流保護的路徑,其餘 endpoint 目前
	// 沒有同等急迫性,不需要跟著一起收緊。
	//
	// 兩個 endpoint 各自獨立的視窗長度與上限次數(不共用同一份視窗)——
	// 地點照片下載是依張數計費、風險最高的一種呼叫,給它更長的視窗
	// 搭配更少的次數(預設 10 分鐘視窗內最多 1 次);地點資訊查詢相對
	// 便宜,給它較短的視窗(預設 10 秒視窗內最多 1 次)。這兩組預設值都
	// 是刻意保守但不會擋到正常使用的量級——一般使用者操作(點擊地圖
	// POI 觸發單點地點介紹)遠低於這個頻率,精確數字之後可以再依實際
	// 觀察調整。
	geoRateLimitPlaceGetWindowSec := flag.Int64("geo-rate-limit-place-get-window-sec", 10, "對 places.get(地點資訊查詢)限流的視窗長度(秒)")
	geoRateLimitPlaceGetMaxCalls := flag.Int("geo-rate-limit-place-get-max-calls", 1, "對 places.get(地點資訊查詢)視窗內最多可放行的呼叫次數,超過直接拒絕")
	geoRateLimitPhotoMediaWindowSec := flag.Int64("geo-rate-limit-photo-media-window-sec", 600, "對 places.photoMedia(地點照片下載,依張數計費)限流的視窗長度(秒)")
	geoRateLimitPhotoMediaMaxCalls := flag.Int("geo-rate-limit-photo-media-max-calls", 1, "對 places.photoMedia(地點照片下載)視窗內最多可放行的呼叫次數,超過直接拒絕")
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
	// 只對 places.get/places.photoMedia 兩個 endpoint 的拒絕型限流(見
	// geoRateLimitPlaceGet*/geoRateLimitPhotoMedia* 的說明)——必須同樣
	// 在任何 geo.New() 呼叫之前設定,理由與上面 ConfigureDefaultGateway
	// 相同。
	geo.ConfigureDefaultGatewayRateLimit(geo.RateLimitConfig{
		PlaceGetWindow:     time.Duration(*geoRateLimitPlaceGetWindowSec) * time.Second,
		PlaceGetMaxCalls:   *geoRateLimitPlaceGetMaxCalls,
		PhotoMediaWindow:   time.Duration(*geoRateLimitPhotoMediaWindowSec) * time.Second,
		PhotoMediaMaxCalls: *geoRateLimitPhotoMediaMaxCalls,
	})
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

	signer := auth.NewSigner(*jwtSecret, 30*24*time.Hour)
	srv := api.New(st, signer, *devMode, googleClientID)

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
	// 真正處理請求——這正是 server/tools/onagent-tools.yaml 開頭警告過的
	// 那個陷阱,這次在新增這個路由時實際踩到)。
	mux.Handle("/onagent/", srv.Routes())

	// 管理後台(/admin/api/*)預設拆分成獨立的 cmd/adminserver binary/
	// Cloud Run 服務(見 server/cmd/adminserver/main.go),那條部署路徑
	// 完全不受這裡影響。這裡新增的是低耦合的「可選合併」開關:-admin
	// flag 或 ADMIN_ENABLED 環境變數開啟時,同一支 cmd/server binary
	// 也能一併掛載管理後台路由,供想合併成單一部署單位的情境使用——
	// 兩種部署方式可以並存,不是互斥的。
	if *admin {
		adminAuth := adminauth.New(st, !*devMode)
		if created, err := adminAuth.Bootstrap(os.Getenv("ADMIN_BOOTSTRAP_EMAIL"), os.Getenv("ADMIN_BOOTSTRAP_PASSWORD")); err != nil {
			log.Printf("admin bootstrap: %v", err)
		} else if created {
			log.Printf("已建立管理員帳號 %s", os.Getenv("ADMIN_BOOTSTRAP_EMAIL"))
		}
		adminMux := http.NewServeMux()
		adminconsole.NewHandler(adminAuth, st).Register(adminMux)
		adminMux.Handle("/admin/", adminStaticHandler())
		// 只有 /admin/* 這個前綴套用 withAdminCORS(credentials 政策跟
		// 一般 /v1、/internal 路由不同,見該函式的說明),不影響其餘路由。
		mux.Handle("/admin/", withAdminCORS(adminMux))
		log.Printf("管理後台已合併掛載於這支 binary(/admin/*,目前管理員帳號數: %d)", adminAuth.Count())
	}

	mux.Handle("/", staticHandler())

	log.Printf("Tripace server 監聽 %s,DB=%s", *addr, dbKind)
	if err := http.ListenAndServe(*addr, withLegacyDomainRedirect(mux)); err != nil {
		log.Fatalf("server: %v", err)
	}
}

// 舊網域(遷移前)與正式網域(遷移後)。整個服務原掛在 legacyDomain,現遷移到
// canonicalDomain(各自獨立的 Cloud Run 服務,非同服務雙網域)。集中定義成
// 具名常數,未來若再換網域只需改這兩處,不必到 withLegacyDomainRedirect 內部找字串。
const (
	legacyDomain    = "app.shuttle.tools"
	canonicalDomain = "tripace.shuttle.tools"
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
	for _, e := range []model.Entry{
		{Title: "開會敲定 Q3 產品規格", Start: "2026-06-29", StartTime: "15:00"},
		{Title: "準備預算上調提案(+15%)", Start: "2026-06-30"},
		{Title: "修登入頁的 bug", Start: ""},
	} {
		e.ID = "ent_" + randHex()
		e.TripID = tr.ID
		e.CreatedAt = nowUTC()
		_ = st.InsertEntry(e)
	}
	log.Printf("已寫入示範行程 %s", tr.ID)
	return nil
}

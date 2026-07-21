// Command server 啟動 Channel 後端 HTTP 服務(SQLite 原型)。
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/tim72117/tripace/internal/api"
	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/llm"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/store"
	"github.com/tim72117/tripace/internal/toolschema"
	"github.com/tim72117/tripace/internal/wanttools"

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
	llmKind := flag.String("llm", "want", "分析器:want(真實 LLM)| mock(假 LLM,送出觸發預設情境,供 web 操作)")
	clientToolsPOC := flag.Bool("clienttools-poc", false, "是否啟用「LLM 呼叫前端 tool」試做(POC,/internal/clienttools/*);預設不啟用,端點維持回 503。僅在 -llm=want 下有意義(需要 want provider 已初始化)")
	clientToolsDir := flag.String("clienttools-dir", "tools", "clienttools POC 的工具定義目錄(*.yaml),相對路徑同 -db 慣例,相對於執行時的工作目錄")
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

	if *seed {
		if err := seedUsers(st); err != nil {
			log.Printf("seed users: %v", err)
		}
		if err := seedIfEmpty(st); err != nil {
			log.Printf("seed: %v", err)
		}
	}

	// 分析器:預設 want LLM 引擎;-llm mock 改用假分析器(供 web 實際操作,免連 LLM)。
	var analyzer llm.Analyzer
	if *llmKind == "mock" {
		// mock 不接真 LLM:送出觸發預設情境,直接用 store 寫 entry(走相同的
		// FindOrCreateTrip 歸組路徑)。不需 BindSink/BindStore(那是 want 工具用的)。
		analyzer = llm.NewMock(st)
		log.Printf("LLM 分析器: mock(假 LLM,送出觸發預設情境)")
	} else {
		// want LLM 引擎(WantPool,per-session orchestrator 外殼)。初始化失敗直接 fatal。
		pool, err := llm.NewWantPool()
		if err != nil {
			log.Fatalf("初始化 want 分析器失敗: %v", err)
		}
		analyzer = pool
		// 注入條目持久化:record_entry 工具解析出的條目同步寫進 DB(entry 為主體,
		// 獨立寫入),回傳新 entry ID。
		wanttools.BindSink(func(channelID string, e wanttools.RecordedEntry) (string, error) {
			id := "ent_" + randHex()
			// kind 空字串存 nil(model.Entry.Kind 為 *string),非空才帶指標。
			var kind *string
			if e.Kind != "" {
				kind = &e.Kind
			}
			// 寫入時不自動歸組(TripID 留 nil):record_entry 會列出時間相符的候選行程,
			// 由 LLM 判斷後呼叫 add_to_trip 工具歸入(或新建)。
			err := st.InsertEntry(model.Entry{
				ID:        id,
				ChannelID: channelID,
				Title:     e.Title,
				Start:     e.Start,
				StartTime: e.StartTime,
				End:       e.End,
				EndTime:   e.EndTime,
				Kind:      kind,
				CreatedAt: nowUTC(),
			})
			return id, err
		})
		// 提供 query_entries 工具查詢用的 store:agent 提問時自己按時間範圍查條目。
		wanttools.BindStore(st)
		log.Printf("LLM 分析器: want 引擎(WantPool)")
	}

	signer := auth.NewSigner(*jwtSecret, 30*24*time.Hour)
	srv := api.New(st, analyzer, signer, *devMode)

	// trip_entry_* 工具註冊(clienttools.RegisterApp,經由 llm.NewClientToolsAnalyzer)
	// 過去只在 -clienttools-poc 這個試做開關底下才會執行;但現在正式 assistant
	// role(assistant_agent.go)的 Tools 白名單已經改用 trip_entry_add/
	// trip_entry_update 取代 entry_add/entry_update,是正式對話會用到的東西了,
	// 不能再綁死在一個語意上是「試做開關」的 flag 底下——若使用者只帶 -llm=want
	// 沒帶 -clienttools-poc,assistant role 白名單裡列的 trip_entry_* 工具會
	// 在 want 的全域 registry 裡完全不存在,LLM 一旦嘗試呼叫就會失敗。
	// 故這裡改成:只要 -llm=want(不論 -clienttools-poc 是否開啟),就一定
	// 執行這段註冊 + EnableClientTools(掛 /internal/clienttools/* 端點,見
	// clienttools_ws.go)——ChatScreen.tsx 的第二條 WS 連線需要這個端點存在,
	// 才能把 assistant 對話的 sessionID 註冊進 clienttools.RegisterAsker
	// (見 want_analyzer.go Assist/Answer 的 SetSessionEnvs 說明)。
	// -clienttools-poc 本身保留(不拿掉、不改名),但不再是「工具有沒有被註冊」
	// 的唯一開關;它目前只影響是否印出下面這行試做專屬的啟動 log。
	// 任何一步失敗都直接 log.Fatalf,不靜默略過——否則伺服器會「看起來啟動
	// 成功」但 /internal/clienttools/* 端點其實還是回 503(EnableClientTools
	// 沒被呼叫時的行為),或 assistant 對話呼叫 trip_entry_add 時才第一次
	// 發現工具不存在,造成誤判。
	if *llmKind == "want" {
		// NewClientToolsAnalyzer 內部假設 want provider 已經初始化過一次(見
		// clienttools_agent.go 的文件註解:它不會自己呼叫 wantorch.SetupWith,
		// 第一次 Submit 時若 GlobalEngine 還是 nil 會 panic)。此處已在
		// -llm=want 分支內(NewWantPool 已完成 provider 初始化),條件成立。
		registry, err := toolschema.NewRegistry(*clientToolsDir)
		if err != nil {
			log.Fatalf("載入 clienttools 工具定義目錄 %s 失敗: %v", *clientToolsDir, err)
		}
		app, ok := registry.Get("clienttools")
		if !ok {
			log.Fatalf("clienttools 工具定義目錄 %s 底下找不到 appId=clienttools 的 App", *clientToolsDir)
		}
		// 註冊 trip_entry_add/trip_entry_delete/trip_entry_update/trip_entry_list
		// 進 want 的全域 tool registry(clienttools.RegisterApp,在
		// NewClientToolsAnalyzer 內部呼叫),讓 assistant role 的白名單真的能
		// 呼叫到這些工具,同時保留 clienttoolsRole 這條獨立 orchestrator
		// 供 DebugApp.tsx 的既有試做頁面沿用(不受這次改動影響)。
		clientToolsAnalyzer := llm.NewClientToolsAnalyzer(app)
		srv.EnableClientTools(registry, clientToolsAnalyzer)
		if *clientToolsPOC {
			log.Printf("clienttools POC 試做頁面已啟用(/internal/clienttools/*,工具目錄=%s)", *clientToolsDir)
		} else {
			log.Printf("trip_entry_* 工具已註冊(供正式 assistant 對話使用;/internal/clienttools/* 端點同時可用,工具目錄=%s)", *clientToolsDir)
		}
	} else if *clientToolsPOC {
		// -clienttools-poc 帶了但 -llm 不是 want:過去這裡會 log.Fatalf
		// (clienttools POC 需要已初始化的 want provider)。這個檢查繼續保留
		// ——mock 分析器不會建立任何 want provider,靜默忽略這個 flag 只會讓
		// 使用者以為試做已啟用,實際上呼叫時才 panic。
		log.Fatalf("clienttools POC 需要 -llm=want(已初始化的 want provider);目前 -llm=%s", *llmKind)
	}

	wanttools.BindNotify(srv.NotifyEntriesUpdated)
	wanttools.BindEntryUpdating(srv.NotifyEntryUpdating)
	wanttools.BindAskUser(srv.NotifyAskUser)
	wanttools.BindAskChoice(srv.NotifyAskChoice)
	wanttools.BindTaskCreated(srv.NotifyTaskCreated)
	wanttools.BindTaskEntryReady(srv.NotifyTaskEntryReady)
	wanttools.BindEntriesLoaded(srv.NotifyEntriesLoaded)

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

	// 管理後台(/admin/api/*)已拆分成獨立的 cmd/adminserver binary/Cloud Run
	// 服務,不再由這支主服務 binary 掛載——見 server/cmd/adminserver/main.go。
	// 這裡刻意不留任何 /admin/* 路由,主服務完全不含 adminauth/adminconsole
	// 的程式碼依賴(達成安全隔離:即使主業務程式碼有漏洞,不會牽連管理後台)。

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
func seedUsers(st *store.Store) error {
	directory := []struct {
		user  model.User
		email string
	}{
		// usr_me 是示範頻道(seedIfEmpty)的建立者/owner,需先存在於 users 表,
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

// seedIfEmpty 在沒有任何頻道時建立一個示範頻道(對齊 App 端 Mock)。
func seedIfEmpty(st *store.Store) error {
	n, err := st.CountChannels()
	if err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	me := model.User{ID: "usr_me", Name: "我", AvatarColor: "#8C7B6A"}
	ch, err := st.CreateChannel("ch_001", "產品討論", me)
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
		e.ChannelID = ch.ID
		e.CreatedAt = nowUTC()
		_ = st.InsertEntry(e)
	}
	log.Printf("已寫入示範頻道 %s", ch.ID)
	return nil
}

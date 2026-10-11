// Command adminserver 是管理後台(/admin/api/*)的獨立進入點——與 cmd/server
// 完全分開編譯、分開部署,不共用同一個 binary,達成程式碼層面的隔離(見
// server/internal/adminconsole 這個套件只依賴 internal/auth、internal/model、
// internal/store,完全不依賴 internal/llm、internal/api、internal/wanttools
// 等主業務套件,故能單獨編譯成這支獨立 binary)。DATABASE_URL 目前與
// cmd/server 指向同一個 Postgres(共用資料,不是各自獨立的資料來源)。
//
// 這支獨立 binary 目前只處理路由掛載與啟動,不含 cmd/server 裡 DEV_MODE/
// SEED/AI_PROVIDER 等主業務專屬設定——那些邏輯留在 cmd/server,這裡刻意
// 精簡到只剩管理後台需要的部分。
//
// 身分驗證:管理後台不再有獨立的帳號/密碼/session 系統,改成消費一般使用者
// 的 JWT(跟 cmd/server 簽發的是同一種 token,見 internal/auth.Signer),
// 再用 email 白名單(ADMIN_BOOTSTRAP_EMAIL)判斷誰有管理權限(見
// adminconsole.Handler.withAdmin 的完整說明)。**這裡簽發/驗證 JWT 用的
// secret 必須跟 cmd/server 完全相同**——否則這個進程驗證的 JWT 會跟主要
// server 進程簽發的 JWT 互不相認(使用者在主站登入拿到的 token,打這支
// adminserver 的 /admin/api/* 會一律被判定為無效)。cmd/server 讀這個值的
// 方式是:flag -jwt-secret 預設 "dev-secret-change-me",環境變數 JWT_SECRET
// 有設定時覆寫(見 cmd/server/main.go)。這裡比照同一個環境變數名稱
// JWT_SECRET、同一個預設值,確保兩個進程最終使用同一把 secret——只要兩邊
// 部署時設定同一個 JWT_SECRET 環境變數,就能保證一致。
package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/tim72117/tripace/internal/adminconsole"
	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/store"

	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		log.Printf("載入 .env: %v", err)
	}

	addr := ":8081"
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatalf("adminserver 需要 DATABASE_URL(與主服務共用同一個 Postgres)")
	}

	st, err := store.Open(dsn)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	// jwtSecret:必須跟 cmd/server 的 -jwt-secret / JWT_SECRET 完全相同
	// (見本檔案開頭的完整說明)——改用 auth.ResolveSecretFromEnv()共用
	// 函式(見該函式的完整說明:原本這裡跟 cmd/server 各自獨立寫一次
	// 「讀環境變數、預設值是 dev-secret-change-me」,只靠註解提醒兩邊要
	// 保持同步,抽成共用函式後兩邊不可能再各自改到不一致)。ttl 本身不
	// 影響簽章驗證(Verify 只檢查簽章與 exp,這裡的 ttl 只用於這個進程
	// 自己簽發 token 時——目前 adminserver 本身不簽發 token,只驗證
	// cmd/server 簽發的 token,故這裡的 ttl 值實際上不會被用到簽發路徑,
	// 但仍比照 cmd/server 填入相同值,保持兩處建構方式一致、不留下可能
	// 誤用的落差)。
	signer := auth.NewSigner(auth.ResolveSecretFromEnv(), 30*24*time.Hour)

	// ADMIN_BOOTSTRAP_EMAIL 啟動期檢查(2026-10,code review 發現的維運
	// 體驗問題)——這支 binary 唯一的職責就是服務 /admin/api/*,這個環境
	// 變數空白會讓整個 /admin/api/* 永遠回 401、完全不可用,卻只印一則
	// 容易被忽略的單行警告,沒有任何更醒目的提示。這裡不讓程式直接
	// fatal 退出(這個 binary 起不來本身不影響主服務 cmd/server,維持
	// 「輔助功能可以降級」的既有慣例),但訊息改得更明確、更醒目,直接
	// 點名「所有端點都會回 401」與該檢查哪個環境變數,讓維運者能快速
	// 定位問題。
	adminBootstrapEmail := os.Getenv("ADMIN_BOOTSTRAP_EMAIL")
	if adminBootstrapEmail == "" {
		log.Printf("!!! ADMIN_BOOTSTRAP_EMAIL 未設定:/admin/api/* 所有端點都會永遠回 401,沒有任何帳號能通過管理權限檢查。如果這是預期外的情況,請檢查 ADMIN_BOOTSTRAP_EMAIL 環境變數是否正確設定(這支 adminserver binary 唯一的職責就是服務這些端點,此設定缺漏會讓整支服務形同不可用)")
	}

	mux := http.NewServeMux()
	adminconsole.NewHandler(signer, st, adminBootstrapEmail).Register(mux)
	// admin SPA(web/admin,base: '/admin/')embed 進這支 binary,同源掛在
	// /admin/ 底下(見 static.go)——不再需要獨立部署前端、也不需要跨源
	// CORS 設定就能直接開啟 Cloud Run URL 使用。/admin/api/* 已被上面
	// Register 註冊,http.ServeMux 依規則優先匹配較精確的 pattern,不會
	// 被這裡的 /admin/ 攔截。
	mux.Handle("/admin/", staticHandler())

	log.Printf("adminserver 監聽 %s(管理權限 email 白名單: %s)", addr, adminBootstrapEmail)
	if err := http.ListenAndServe(addr, withAdminCORS(mux)); err != nil {
		log.Fatalf("server: %v", err)
	}
}

// withAdminCORS 複製自 cmd/server/main.go 的同名函式。管理 SPA 現在改用
// localStorage 存 JWT、每次 fetch 帶 Authorization header,不再依賴
// cookie——但仍保留 Allow-Credentials 與回顯 Origin 的既有寫法,對帶
// Authorization header 的跨源請求同樣適用(瀏覽器的 CORS 檢查只看
// Access-Control-Allow-Origin/Headers,不要求 credentials 相關標頭就
// 不能帶自訂 header),不特別為了不再用 cookie 而收斂行為。
func withAdminCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

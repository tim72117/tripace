// Command partnerserver 是廣告業主/聯盟行銷夥伴控制台(/partner/api/*)
// 的獨立進入點——與 cmd/server、cmd/adminserver 完全分開編譯、分開部署
// (見 server/internal/partnerconsole 套件只依賴 internal/auth、
// internal/model、internal/store,完全不依賴 internal/llm、internal/api
// 等主業務套件,故能單獨編譯成這支獨立 binary,比照 cmd/adminserver 的
// 既有模式)。DATABASE_URL 與 cmd/server、cmd/adminserver 指向同一個
// Postgres(共用資料,不是各自獨立的資料來源)。
//
// 身分驗證:跟 adminserver 相同模式(2026-10 改動,見
// internal/partnerconsole 套件開頭的完整說明)——業主不再有獨立的
// 帳號/密碼/register/login,改成消費一般使用者的 JWT(跟 cmd/server
// 簽發的是同一種 token,見 internal/auth.Signer),再用資料庫關聯
// (partnerRow.UserID)判斷這個使用者是不是業主。**這裡簽發/驗證 JWT
// 用的 secret 必須跟 cmd/server 完全相同**(理由同 cmd/adminserver/
// main.go 開頭的同一段說明)——否則這支進程驗證的 JWT 會跟主要 server
// 進程簽發的 JWT 互不相認。
package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/partnerconsole"
	"github.com/tim72117/tripace/internal/store"

	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		log.Printf("載入 .env: %v", err)
	}

	addr := ":8082"
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatalf("partnerserver 需要 DATABASE_URL(與主服務共用同一個 Postgres)")
	}

	st, err := store.Open(dsn)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}
	defer st.Close()

	signer := auth.NewSigner(auth.ResolveSecretFromEnv(), 30*24*time.Hour)

	mux := http.NewServeMux()
	partnerconsole.NewHandler(signer, st).Register(mux)
	// partner SPA(web/partner,base: '/partner/')embed 進這支 binary,
	// 同源掛在 /partner/ 底下(見 static.go)——比照 cmd/adminserver 的
	// 既有模式,不需要獨立部署前端、也不需要跨源 CORS 設定就能直接開啟
	// Cloud Run URL 使用。/partner/api/* 已被上面 Register 註冊,
	// http.ServeMux 依規則優先匹配較精確的 pattern,不會被這裡的
	// /partner/ 攔截。
	mux.Handle("/partner/", staticHandler())

	log.Printf("partnerserver 監聽 %s", addr)
	if err := http.ListenAndServe(addr, withPartnerCORS(mux)); err != nil {
		log.Fatalf("server: %v", err)
	}
}

// withPartnerCORS 複製自 cmd/adminserver/main.go 的 withAdminCORS——業主
// SPA 用 localStorage 存 JWT、每次 fetch 帶 Authorization header,不依賴
// cookie,但仍保留 Allow-Credentials 與回顯 Origin 的既有寫法(理由同
// adminserver 的同名函式註解)。
func withPartnerCORS(next http.Handler) http.Handler {
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

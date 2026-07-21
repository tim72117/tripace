// Command adminserver 是管理後台(/admin/api/*)的獨立進入點——與 cmd/server
// 完全分開編譯、分開部署,不共用同一個 binary,達成程式碼層面的隔離(見
// server/internal/adminconsole、server/internal/adminauth 這兩個套件本身
// 只依賴 internal/model、internal/store,完全不依賴 internal/llm、
// internal/api、internal/wanttools 等主業務套件,故能單獨編譯成這支獨立
// binary)。DATABASE_URL 目前與 cmd/server 指向同一個 Postgres(共用資料,
// 不是各自獨立的資料來源)。
//
// 這支獨立 binary 目前只處理路由掛載與啟動,不含 cmd/server 裡 DEV_MODE/
// SEED/AI_PROVIDER 等主業務專屬設定——那些邏輯留在 cmd/server,這裡刻意
// 精簡到只剩管理後台需要的部分。
package main

import (
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/tim72117/tripace/internal/adminauth"
	"github.com/tim72117/tripace/internal/adminconsole"
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

	devMode := true
	if v := os.Getenv("DEV_MODE"); v != "" {
		devMode = v == "1" || strings.EqualFold(v, "true")
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

	adminAuth := adminauth.New(st, !devMode)
	if created, err := adminAuth.Bootstrap(os.Getenv("ADMIN_BOOTSTRAP_EMAIL"), os.Getenv("ADMIN_BOOTSTRAP_PASSWORD")); err != nil {
		log.Printf("admin bootstrap: %v", err)
	} else if created {
		log.Printf("已建立管理員帳號 %s", os.Getenv("ADMIN_BOOTSTRAP_EMAIL"))
	}
	log.Printf("adminserver 啟動(目前管理員帳號數: %d)", adminAuth.Count())

	mux := http.NewServeMux()
	adminconsole.NewHandler(adminAuth, st).Register(mux)
	// admin SPA(web/admin,base: '/admin/')embed 進這支 binary,同源掛在
	// /admin/ 底下(見 static.go)——不再需要獨立部署前端、也不需要跨源
	// CORS/cookie 設定就能直接開啟 Cloud Run URL 使用。/admin/api/* 已被
	// 上面 Register 註冊,http.ServeMux 依規則優先匹配較精確的 pattern,
	// 不會被這裡的 /admin/ 攔截。
	mux.Handle("/admin/", staticHandler())

	log.Printf("adminserver 監聽 %s", addr)
	if err := http.ListenAndServe(addr, withAdminCORS(mux)); err != nil {
		log.Fatalf("server: %v", err)
	}
}

// withAdminCORS 複製自 cmd/server/main.go 的同名函式:讓管理 SPA(獨立部署,
// credentials: 'include')能在開發/正式環境都正常帶到 admin_session cookie。
func withAdminCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

package main

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

// 管理後台(web/admin)的建置產物,embed 進這支 binary、掛在 /admin/ 底下——
// 見 main.go 的 -admin/ADMIN_ENABLED 開關的說明。目錄刻意取名 webadmin
// (而非 web),避免跟上面一般使用者前端的 //go:embed web/dist 撞路徑
// (同一個 package main 裡兩個 go:embed 指令的來源目錄不能重複)。
//
// 這份邏輯與變數/函式命名複製自 cmd/adminserver/static.go,但改名
// adminWebDist/adminStaticHandler 避免跟上面 static.go 的 webDist/
// staticHandler 撞名——cmd/adminserver 那支獨立 binary 本身完全不受
// 這裡的異動影響,兩份程式碼目前刻意保持重複,不合併成共用套件(見
// main.go 開頭的說明,這次只低耦合地讓 cmd/server 多一個「可選掛載」的
// 能力,不變動 cmd/adminserver 的既有部署路徑)。
//
//go:embed webadmin/dist
var adminWebDist embed.FS

// adminStaticHandler 回傳 admin SPA 的靜態檔 handler,掛在 /admin/(比照
// cmd/server/static.go 的 staticHandler,但這裡多一層路徑前綴——
// web/admin/vite.config.ts 設定 base: '/admin/',build 產物內部資源路徑
// (script src、link href 等)都假設自己活在 /admin/ 底下,故 fs.Sub 只切到
// webadmin/dist,不再往下切,靠 strings.TrimPrefix 把請求路徑的 /admin/
// 前綴剝掉才拿去對應到嵌入的檔案樹。/admin/api/* 不會走到這裡——mux 的
// Register(見 adminconsole.go)註冊了更精確的 pattern("GET /admin/api/me"
// 等),Go 1.22+ http.ServeMux 依規則優先匹配較精確的 pattern,不需要在
// 這裡額外排除。
//
// 找不到檔案一律回傳 /admin/index.html(SPA fallback,讓前端 router 處理
// 子路徑,如 /admin/users)。
func adminStaticHandler() http.Handler {
	sub, err := fs.Sub(adminWebDist, "webadmin/dist")
	if err != nil {
		panic(err)
	}
	fileServer := http.StripPrefix("/admin/", http.FileServer(http.FS(sub)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/admin/"), "/")
		if name == "" {
			name = "."
		}
		f, err := sub.Open(name)
		if err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/admin/"
		fileServer.ServeHTTP(w, r2)
	})
}

// withAdminCORS 複製自 cmd/adminserver/main.go 的同名函式——管理 SPA
// 需要帶 credentials: 'include'(admin_session cookie),必須回傳精確的
// Origin(不能用 "*")並開啟 Allow-Credentials,這跟一般 /v1、/internal
// 路由用的 cors middleware(見 internal/api/middleware.go,固定放行 "*"、
// 不帶 credentials)是兩種不同的 CORS 政策,故只包在 /admin/ 這個路由
// 前綴上,不影響其餘路由。
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

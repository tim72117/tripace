package main

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed web/dist
var webDist embed.FS

// staticHandler 回傳 admin SPA 的靜態檔 handler,掛在 /admin/(比照
// cmd/server/static.go 的做法,但這裡多一層路徑前綴——web/admin/vite.config.ts
// 設定 base: '/admin/',build 產物內部資源路徑(script src、link href 等)都
// 假設自己活在 /admin/ 底下,故 fs.Sub 只切到 web/dist,不再往下切,靠
// strings.TrimPrefix 把請求路徑的 /admin/ 前綴剝掉才拿去對應到嵌入的檔案
// 樹。/admin/api/* 不會走到這裡——mux 的 Register(見 adminconsole.go)註冊
// 了更精確的 pattern("POST /admin/api/login" 等),Go 1.22+ http.ServeMux
// 依規則優先匹配較精確的 pattern,不需要在這裡額外排除。
//
// 找不到檔案一律回傳 /admin/index.html(SPA fallback,讓前端 router 處理
// 子路徑,如 /admin/users)。
func staticHandler() http.Handler {
	sub, err := fs.Sub(webDist, "web/dist")
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
		// SPA fallback:改成請求 /admin/index.html 本身。
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/admin/"
		fileServer.ServeHTTP(w, r2)
	})
}

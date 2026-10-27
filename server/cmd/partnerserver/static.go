package main

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed web/dist
var webDist embed.FS

// staticHandler 回傳業主 SPA 的靜態檔 handler,掛在 /partner/(比照
// cmd/adminserver/static.go 的既有做法,見該檔案的完整說明——這裡只是
// 把路徑前綴從 /admin/ 換成 /partner/,邏輯完全相同)。
func staticHandler() http.Handler {
	sub, err := fs.Sub(webDist, "web/dist")
	if err != nil {
		panic(err)
	}
	fileServer := http.StripPrefix("/partner/", http.FileServer(http.FS(sub)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/partner/"), "/")
		if name == "" {
			name = "."
		}
		f, err := sub.Open(name)
		if err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}
		// SPA fallback:改成請求 /partner/index.html 本身。
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/partner/"
		fileServer.ServeHTTP(w, r2)
	})
}

package main

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed web/dist
var webDist embed.FS

// staticHandler 回傳 SPA 的靜態檔 handler。
// /api、/v1、/internal 路徑不走這裡(由呼叫端先行攔截)。
// 找不到檔案一律回傳 index.html(讓前端 router 處理)。
func staticHandler() http.Handler {
	sub, err := fs.Sub(webDist, "web/dist")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 嘗試直接找檔案;找不到則回傳 index.html(SPA fallback)。
		f, err := sub.Open(strings.TrimPrefix(r.URL.Path, "/"))
		if err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}
		// SPA fallback
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/"
		fileServer.ServeHTTP(w, r2)
	})
}

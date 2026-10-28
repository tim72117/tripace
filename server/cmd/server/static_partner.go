package main

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

// 業主控制台(web/partner)的建置產物,embed 進這支 binary、掛在 /partner/
// 底下,與 /partner/api/*(partnerconsole)同一台主機、同一個網域,業主與
// partner-cli 都用主站網址即可。目錄取名
// webpartner,避免跟 web/dist、webadmin/dist 的 go:embed 撞路徑。
//
// 邏輯複製自 static_admin.go 的 adminStaticHandler,只是前綴換成 /partner/。
// /partner/api/* 由 partnerconsole.Register 註冊了更精確的 pattern,
// http.ServeMux 會優先匹配,不會被這裡攔截。
//
//go:embed webpartner/dist
var partnerWebDist embed.FS

func partnerStaticHandler() http.Handler {
	sub, err := fs.Sub(partnerWebDist, "webpartner/dist")
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
		// SPA fallback:交給前端 router 處理子路徑。
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/partner/"
		fileServer.ServeHTTP(w, r2)
	})
}

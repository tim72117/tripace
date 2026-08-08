package main

import (
	"embed"
	"io/fs"
	"net/http"
	"regexp"
	"strings"
)

//go:embed web/dist
var webDist embed.FS

// knownRoutePatterns 是前端 React Router(web/src/App.tsx)實際定義的合法
// 路由 pattern。找不到對應靜態檔案時,只有匹配這些 pattern 的路徑才視為
// 「合法的 SPA 路由」、回 200+index.html 交給前端 router 處理;其餘一律
// 回真正的 404 狀態碼。這份清單需要跟 App.tsx 的 <Route> 定義保持同步——
// 新增/刪除前端路由時記得一併更新這裡,否則會誤傷合法路由或讓過期路由
// 繼續回 200。
var knownRoutePatterns = []*regexp.Regexp{
	regexp.MustCompile(`^/$`),
	regexp.MustCompile(`^/privacy$`),
	regexp.MustCompile(`^/terms$`),
	regexp.MustCompile(`^/public/[^/]+$`),
	regexp.MustCompile(`^/cli-auth$`),
	regexp.MustCompile(`^/device$`),
	regexp.MustCompile(`^/demo/pace$`),
	regexp.MustCompile(`^/app(/[^/]+)?$`),
}

func isKnownRoute(path string) bool {
	for _, p := range knownRoutePatterns {
		if p.MatchString(path) {
			return true
		}
	}
	return false
}

// staticHandler 回傳 SPA 的靜態檔 handler。
// /api、/v1、/internal 路徑不走這裡(由呼叫端先行攔截)。
//
// 找不到對應靜態檔案時,依路徑是否符合 knownRoutePatterns 分兩種處理:
// 符合的話回 200+index.html(SPA fallback,交給前端 router 渲染對應頁面);
// 不符合的話回 404+index.html(前端 catch-all 路由會渲染 NotFoundPage,
// 但 HTTP 狀態碼是真正的 404)。這是為了修正先前「任何未知路徑都回 200」
// 的問題——Google 會把打錯字的網址、失效的分享連結都當成有效內容索引,
// 稀釋掉真正該被索引的頁面。見 web/src/App.tsx 的 catch-all 路由與
// web/src/NotFoundPage.tsx。
func staticHandler() http.Handler {
	sub, err := fs.Sub(webDist, "web/dist")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 嘗試直接找檔案;找到就直接回傳。
		f, err := sub.Open(strings.TrimPrefix(r.URL.Path, "/"))
		if err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		r2 := r.Clone(r.Context())
		r2.URL.Path = "/"
		if !isKnownRoute(r.URL.Path) {
			w.WriteHeader(http.StatusNotFound)
		}
		fileServer.ServeHTTP(w, r2)
	})
}

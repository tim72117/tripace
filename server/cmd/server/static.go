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
	regexp.MustCompile(`^/product$`),
	regexp.MustCompile(`^/jiufen$`),
	regexp.MustCompile(`^/kyoto-kiyomizu$`),
	regexp.MustCompile(`^/tainan-anping$`),
	regexp.MustCompile(`^/tainan-chikan$`),
	regexp.MustCompile(`^/privacy$`),
	regexp.MustCompile(`^/terms$`),
	regexp.MustCompile(`^/public/[^/]+$`),
	regexp.MustCompile(`^/cli-auth$`),
	regexp.MustCompile(`^/device$`),
	regexp.MustCompile(`^/demo/pace$`),
	regexp.MustCompile(`^/ai-plan$`),
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
//
// 2026-10:回 index.html 這個分支(SPA fallback)改成自己讀檔案內容、
// 依路徑套用 applySEOMeta(見 seo_meta.go 的完整說明)後手動寫出,不再
// 直接把這個請求交給 http.FileServer 處理——FileServer 會自己決定
// Content-Length/寫入 body,沒有介入點可以在它寫出前修改內容。只有這個
// SPA fallback 分支改動,檔案直接命中的那個分支(真正的靜態資源,如 JS/
// CSS/圖片)維持原樣交給 FileServer,不需要也不該套用這段替換邏輯。
func staticHandler() http.Handler {
	sub, err := fs.Sub(webDist, "web/dist")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(sub))
	indexHTML, err := fs.ReadFile(sub, "index.html")
	if err != nil {
		panic(err)
	}
	// 2026-10:啟動時就驗證 applySEOMeta 預期能找到的每個字串片段,在
	// index.html 裡恰好出現一次(見 seo_meta.go 的 checkIndexHTMLHasAllSEOTargets
	// 完整說明)——這個字串取代策略找不到比對目標時不會報錯,只會靜默
	// 跳過,若不在這裡檢查,index.html 格式一旦變動(前端調整 meta 標籤
	// 縮排、Vite 版本升級改變輸出格式等),子頁面的 SEO meta 取代會悄悄
	// 失效,回到這次要修的原始問題,卻不會有任何警訊。
	//
	// checked-in 的 placeholder index.html(見檔頭 webDist embed 的完整
	// 說明)本來就不包含任何這些目標字串,是開發者/CI 尚未執行過前端
	// build 時的已知、刻意情境,不該觸發 panic——用 isPlaceholderIndexHTML
	// (seo_meta.go)跟固定的 placeholder 位元組精確比對判斷,對齊
	// seo_meta_test.go 判斷要不要跳過測試用的同一個函式,不用「是否包含
	// <title>」這種誤判風險較高的啟發式特徵(見該函式的完整說明)。
	if !isPlaceholderIndexHTML(indexHTML) {
		if err := checkIndexHTMLHasAllSEOTargets(indexHTML); err != nil {
			panic(err)
		}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 嘗試直接找檔案;找到就直接回傳。
		f, err := sub.Open(strings.TrimPrefix(r.URL.Path, "/"))
		if err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		// Header 必須在 WriteHeader 之前設定——WriteHeader 會把目前已
		// 累積的 header 一起送出並鎖定,之後再 Set 不會反映到實際回應裡
		// (2026-10 code review 抓到:這裡原本的順序是先 WriteHeader(404)
		// 才 Set Content-Type,404 分支的 Content-Type 設定從未真正生效
		// 過,只是 net/http 預設的內容類型偵測機制碰巧也是 text/html,
		// 沒有造成可觀察的錯誤,但語意上是錯的)。
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if !isKnownRoute(r.URL.Path) {
			w.WriteHeader(http.StatusNotFound)
		}
		body := applySEOMeta(indexHTML, r.URL.Path)
		w.Write(body)
	})
}

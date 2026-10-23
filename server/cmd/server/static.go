package main

import (
	"embed"
	"io/fs"
	"net/http"
	"regexp"
	"strings"

	"github.com/tim72117/tripace/internal/store"
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
	// /itineraries(清單)與 /itineraries/:id(詳細頁):精選行程展示
	// (2026-10 頁面文案從「AI 排好的範例行程」改名,見 web/src/App.tsx
	// AiItinerariesRoute import 處的完整說明),公開頁。2026-10 使用者
	// 明確要求「路由不要加 ai」,從原本的 /ai-itineraries 改名(見
	// web/src/App.tsx 對應路由的完整說明)。
	regexp.MustCompile(`^/itineraries(/[^/]+)?$`),
	// /momiji-front:紅葉前線視覺示意頁(2026-10 新增,見 web/src/App.tsx
	// MomijiFrontPage import 處與 web/src/momiji-front/MomijiFrontPage.tsx
	// 的完整說明),公開頁、不需要登入。
	regexp.MustCompile(`^/momiji-front$`),
	// /u/:handle/:slug:部落客發文正式頁面(2026-10,見 web/src/App.tsx
	// 對應路由與 web/src/blog/BlogArticlePage.tsx 的完整說明)——取代原本
	// 固定的 /demo/theme-page demo 路徑。
	regexp.MustCompile(`^/u/[^/]+/[^/]+$`),
	// /blog/photos:部落客圖片管理頁(2026-10 新增,見
	// web/src/blog/PhotoManagerPage.tsx 的完整說明)——需要登入才能實際
	// 使用,但路由本身跟 /app 等既有頁面一樣不攔截訪客(頁面內部
	// 自行判斷 isGuest 顯示登入表單),故訪客直接造訪這個網址時,前端
	// router 本身仍要能接手渲染,不能被這裡擋成 404。
	regexp.MustCompile(`^/blog/photos$`),
	regexp.MustCompile(`^/app(/[^/]+)?$`),
	// /dev/layouts:開發用的版型目錄頁(2026-10 新增,見
	// web/src/blog/LayoutGalleryPage.tsx 的完整說明)——陳列
	// BlogArticle.css 支援的所有版型,骨架圖+範例文字,純開發工具,不是
	// 產品功能,但路由本身仍走正常 SPA 入口,需要在這裡註冊才能在正式
	// 環境直接重新整理這個網址而不被誤判成 404。
	regexp.MustCompile(`^/dev/layouts$`),
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
//
// st(2026-10 新增)——部落格文章的 SEO meta(title/description/
// canonical)不像城市介紹頁那樣能窮舉進固定的 seoMetaByPath 對照表,
// 每篇文章的路徑跟內容都不同、數量會持續成長,必須在請求當下查資料庫
// 才能組出對應的值(見 seo_meta.go blogArticleSEOMeta 的完整說明)。
// main.go 呼叫端傳入已經開好的 *store.Store(跟其餘 API handler 共用
// 同一個連線,不另外開一條)。允許傳 nil(測試情境,見
// seo_meta_test.go)——applySEOMeta 對 nil store 會直接跳過部落格文章
// 這條查詢路徑,不會 panic。
func staticHandler(st *store.Store) http.Handler {
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
		body := applySEOMeta(indexHTML, r.URL.Path, st)
		w.Write(body)
	})
}

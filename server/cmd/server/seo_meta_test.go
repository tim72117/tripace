package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/store"
)

// 用真正的建置產物(web/dist/index.html)驗證,不是手寫的假 HTML 片段——
// applySEOMeta 的正確性完全仰賴字串精確比對(見該函式的完整說明:找不到
// 比對目標時靜默不生效,不會報錯),用跟實際 embed 進 Go binary 的同一份
// 檔案測試,才能真正保證不會悄悄失效。這份檔案是 vite build 的輸出,不
// 在版控裡(見 .gitignore),故測試在還沒跑過 vite build 時跳過而非失敗
// ——CI/其他開發者尚未跑過前端 build 時,這個測試不該擋住其他測試執行。
//
// 2026-10 修正:原本只判斷檔案存不存在——但這個目錄底下有一份刻意提交
// 進版控的 .gitkeep + placeholder index.html(內容固定是
// placeholderIndexHTML,見 seo_meta.go 的完整說明),目的是讓沒跑過前端
// build 的開發者也能讓 cmd/server 的 go:embed 成功編譯。這個 placeholder
// 檔案「存在」,但內容完全不是真正的建置產物,原本的判斷式會讓測試誤判
// 「檔案存在」而繼續往下跑,實際上拿 placeholder 去比對一定找不到任何
// 目標字串、全部斷言失敗(不是 applySEOMeta 真的有 bug,是測試前提條件
// 沒有真正滿足)。改成用 isPlaceholderIndexHTML 跟固定位元組精確比對,
// 排除掉 placeholder 這個已知的例外情況(跟 static.go 共用同一個判斷
// 函式,不是「是否包含 <title>」這種各自維護、容易誤判的啟發式特徵)。
//
// SEO_META_TEST_REQUIRE_REAL_BUILD 環境變數(Dockerfile 這組測試唯一能
// 真正執行到的階段會設定它,見該檔案的完整說明):設定時,skip 視為失敗
// 而非略過——避免「go test -run 參數打錯字/測試改名導致比對不到任何
// 測試」或「這個分支其實還是讀到 placeholder」這類情況被 go test 的
// exit code 0 悄悄蓋過去,讓 Docker build 誤以為驗證通過。
func readRealIndexHTML(t *testing.T) []byte {
	t.Helper()
	requireReal := os.Getenv("SEO_META_TEST_REQUIRE_REAL_BUILD") != ""
	data, err := os.ReadFile("web/dist/index.html")
	if err != nil {
		if requireReal {
			t.Fatalf("web/dist/index.html 不存在,但 SEO_META_TEST_REQUIRE_REAL_BUILD 已設定,預期此時一定要有真實建置產物:%v", err)
		}
		t.Skipf("web/dist/index.html 不存在(尚未執行 vite build):%v", err)
	}
	if isPlaceholderIndexHTML(data) {
		if requireReal {
			t.Fatal("web/dist/index.html 是 placeholder,但 SEO_META_TEST_REQUIRE_REAL_BUILD 已設定,預期此時一定要有真實建置產物")
		}
		t.Skip("web/dist/index.html 是 placeholder(尚未執行 vite build,見該檔案內容)")
	}
	return data
}

// 2026-10 code review 抓到:checkIndexHTMLHasAllSEOTargets 原本只靠
// TestStaticHandler_ServesCorrectSEOMetaOverHTTP 間接觸發(且那個測試
// 還依賴真實建置產物,沒有真實產物時整組跳過),缺乏直接針對這個函式
// 本身、不依賴 web/dist/index.html 的單元測試,「找不到目標(0 次)」跟
// 「目標重複出現(2 次以上)」這兩種該回傳 error 的情況完全沒有測試
// 覆蓋。這裡用手寫的最小 HTML 片段(只含 seoReplaceTargets() 其中一個
// 目標,其餘九個刻意不放進去)驗證,不依賴 vite build,CI/開發機永遠
// 會真正執行,不會被跳過。
func TestCheckIndexHTMLHasAllSEOTargets_MissingTargetReturnsError(t *testing.T) {
	html := []byte("<html><head><title>某個跟任何目標都不相關的標題</title></head></html>")
	if err := checkIndexHTMLHasAllSEOTargets(html); err == nil {
		t.Fatal("預期找不到任何 seoReplaceTargets() 目標時回傳 error,但實際回傳 nil")
	}
}

func TestCheckIndexHTMLHasAllSEOTargets_DuplicateTargetReturnsError(t *testing.T) {
	target := "<title>" + defaultTitle + "</title>"
	// 刻意讓同一個目標字串出現兩次,模擬 index.html 格式異常(例如建置
	// 流程出錯重複輸出)導致取代目標不再是「恰好一次」的情況。
	html := []byte(target + target)
	if err := checkIndexHTMLHasAllSEOTargets(html); err == nil {
		t.Fatal("預期目標字串重複出現兩次時回傳 error,但實際回傳 nil")
	}
}

// siteBaseURL()/defaultCanonical/defaultImage/套件層級的 seoMetaByPath
// 都是在 package 初始化時算好一次的值(var,不是函式呼叫時才讀環境
// 變數),所以在個別測試裡用 t.Setenv("SITE_BASE_URL", ...) 不會影響到
// 它們——test binary 啟動時 init 早就跑過了。要測試「SITE_BASE_URL 真的
// 會改變組出來的網址」這個行為,必須直接呼叫 siteBaseURL()/
// buildSeoMetaByPath(自訂 baseURL),不能依賴套件層級變數的初始化時機。
func TestSiteBaseURL_UsesEnvVarAndTrimsTrailingSlash(t *testing.T) {
	t.Setenv("SITE_BASE_URL", "https://example.test/")
	if got := siteBaseURL(); got != "https://example.test" {
		t.Errorf("siteBaseURL() = %q,預期去掉結尾斜線後的 %q", got, "https://example.test")
	}
}

func TestSiteBaseURL_FallsBackToTripaceIOWhenUnset(t *testing.T) {
	t.Setenv("SITE_BASE_URL", "")
	if got := siteBaseURL(); got != "https://tripace.io" {
		t.Errorf("siteBaseURL() 未設定時 = %q,預期 fallback 到 %q", got, "https://tripace.io")
	}
}

func TestBuildSeoMetaByPath_UsesGivenBaseURL(t *testing.T) {
	meta := buildSeoMetaByPath("https://example.test")
	m, ok := meta["/jiufen"]
	if !ok {
		t.Fatal("buildSeoMetaByPath 的結果缺少 /jiufen")
	}
	if want := "https://example.test/jiufen"; m.canonical != want {
		t.Errorf("/jiufen 的 canonical = %q,預期 %q", m.canonical, want)
	}
}

func TestApplySEOMeta_KnownRouteReplacesTitleDescriptionCanonical(t *testing.T) {
	html := readRealIndexHTML(t)

	out := string(applySEOMeta(html, "/jiufen", nil))

	wantTitle := "九份——礦業興衰與人文重生的山城故事 | Tripace"
	if !strings.Contains(out, "<title>"+wantTitle+"</title>") {
		t.Errorf("輸出沒有包含九份頁的 <title>,got title area: %q", wantTitle)
	}
	if strings.Contains(out, "<title>Tripace — 從探索到行程，深入走訪一個想去的地方</title>") {
		t.Error("輸出仍包含首頁的 <title>,取代沒有生效")
	}

	wantCanonical := `<link rel="canonical" href="https://tripace.io/jiufen" />`
	if !strings.Contains(out, wantCanonical) {
		t.Errorf("輸出沒有包含九份頁正確的 canonical:%q", wantCanonical)
	}
	if strings.Contains(out, `<link rel="canonical" href="https://tripace.io/" />`) {
		t.Error("輸出仍包含指向首頁的 canonical,這正是要修的 bug")
	}

	wantDescription := "從基隆山的地形限制，到金瓜石礦業的興衰，再到老街、茶樓與海景交錯的人文重生——跟著 Tripace 走一趟九份的散策路線，讀懂這座山城為何長成現在的樣子。"
	// 2026-10 修正(code review 抓到):原本只用 strings.Contains 檢查
	// description 文字本身——但這段文字在輸出裡會出現三次(name=
	// description/og:description/twitter:description,見 applySEOMeta
	// 的完整說明),只要其中任一處取代成功、其餘兩處仍殘留首頁舊值,這個
	// 斷言依然會通過,測不出「只改了一處、漏了另外兩處」這種部分失效。
	// 改成針對三個完整標籤各自精確比對。
	wantDescTags := []string{
		`<meta
      name="description"
      content="` + wantDescription + `"
    />`,
		`<meta
      property="og:description"
      content="` + wantDescription + `"
    />`,
		`<meta
      name="twitter:description"
      content="` + wantDescription + `"
    />`,
	}
	for _, tag := range wantDescTags {
		if !strings.Contains(out, tag) {
			t.Errorf("輸出沒有包含九份頁完整的 description 標籤:%q", tag)
		}
	}

	// og:url/og:title/twitter:title/og:image/twitter:image 也要一併確認
	// 有換成九份頁的值,不是只改了 <title> 卻漏掉其他標籤(這組標籤的用字
	// 跟 defaultTitle/defaultCanonical/defaultImage 完全相同,比較容易
	// 因為複製貼上疏漏其中一處)。
	if !strings.Contains(out, `<meta property="og:url" content="https://tripace.io/jiufen" />`) {
		t.Error("og:url 沒有換成九份頁的網址")
	}
	if !strings.Contains(out, `<meta property="og:title" content="`+wantTitle+`" />`) {
		t.Error("og:title 沒有換成九份頁的標題")
	}
	if !strings.Contains(out, `<meta name="twitter:title" content="`+wantTitle+`" />`) {
		t.Error("twitter:title 沒有換成九份頁的標題")
	}
	wantImage := "https://storage.googleapis.com/shuttle-tripace-web-assets/landing/jiufen/n0.jpg"
	if !strings.Contains(out, `<meta property="og:image" content="`+wantImage+`" />`) {
		t.Error("og:image 沒有換成九份頁的圖片")
	}
	if !strings.Contains(out, `<meta name="twitter:image" content="`+wantImage+`" />`) {
		t.Error("twitter:image 沒有換成九份頁的圖片")
	}
	if strings.Contains(out, `content="https://tripace.io/og-image.png"`) {
		t.Error("輸出仍包含首頁的 og-image.png,image 取代沒有生效")
	}
}

// 2026-10 code review 抓到:seoMetaByPath(server 端)跟各城市頁 tsx 裡
// 的 SEO_TITLE/SEO_DESCRIPTION/SEO_URL 常數(前端,仍用於 JSON-LD)是
// 兩份需要手動同步的資料,沒有自動檢查——完整比對兩邊內容需要從 tsx
// 用 regex 抽常數,成本較高,這裡先做一個低成本但仍有意義的守門:確保
// seoMetaByPath 的每個 key 都落在 isKnownRoute(static.go)認得的路由
// 清單裡,避免兩邊的路由清單(這裡新增/刪除城市頁 vs knownRoutePatterns
// 新增/刪除 <Route>)不同步——例如新增一個城市頁卻忘記更新
// knownRoutePatterns,會導致該路徑被誤判為 404 而非合法 SPA 路由。
func TestSeoMetaByPath_EveryKeyIsKnownRoute(t *testing.T) {
	for path := range seoMetaByPath {
		if !isKnownRoute(path) {
			t.Errorf("seoMetaByPath 裡的路徑 %s 不在 knownRoutePatterns(static.go)裡,兩份路由清單已經不同步", path)
		}
	}
}

func TestApplySEOMeta_AllFourCityPagesHaveDistinctCanonical(t *testing.T) {
	html := readRealIndexHTML(t)

	paths := []string{"/jiufen", "/kyoto-kiyomizu", "/tainan-anping", "/tainan-chikan"}
	seen := map[string]bool{}
	for _, p := range paths {
		out := string(applySEOMeta(html, p, nil))
		wantCanonical := `<link rel="canonical" href="https://tripace.io` + p + `" />`
		if !strings.Contains(out, wantCanonical) {
			t.Errorf("路徑 %s 的輸出沒有包含正確的 canonical:%q", p, wantCanonical)
		}
		if seen[wantCanonical] {
			t.Errorf("路徑 %s 的 canonical 跟先前某個路徑重複,表示 seoMetaByPath 設定有誤", p)
		}
		seen[wantCanonical] = true
	}
}

// 首頁本身、/privacy、/terms 這幾個路徑不在 seoMetaByPath 裡(見該變數
// 的完整說明——/privacy/terms 本來就沒有自己的 Helmet SEO meta,首頁的
// 內容就是 index.html 的原始值),applySEOMeta 應該原樣傳回、不做任何
// 取代。/product 2026-10 已補上專屬 SEO meta(見 seoMetaByPath 的完整
// 說明),故不在這份清單裡,改由下面 TestApplySEOMeta_ProductPageHasOwnSEOMeta
// 驗證。
func TestApplySEOMeta_UnknownRouteReturnsUnchanged(t *testing.T) {
	html := readRealIndexHTML(t)

	for _, p := range []string{"/", "/privacy", "/terms", "/app", "/some-unknown-path"} {
		out := applySEOMeta(html, p, nil)
		if string(out) != string(html) {
			t.Errorf("路徑 %s 不在 seoMetaByPath 裡,applySEOMeta 不該修改內容,但輸出跟原始內容不同", p)
		}
	}
}

// /product 沒有自己的代表圖(seoMetaByPath["/product"].image 是空字串),
// 驗證 applySEOMeta 對這種情況的 fallback 行為:canonical/title 換成
// /product 自己的值,但 og:image/twitter:image 仍沿用 defaultImage,
// 不會被取代成空字串(見 applySEOMeta 對 image 變數的完整說明——空字串
// 比沿用首頁的圖更糟,社群分享會完全沒有預覽圖)。
func TestApplySEOMeta_ProductPageHasOwnSEOMetaButFallsBackToDefaultImage(t *testing.T) {
	html := readRealIndexHTML(t)

	out := string(applySEOMeta(html, "/product", nil))

	wantCanonical := `<link rel="canonical" href="https://tripace.io/product" />`
	if !strings.Contains(out, wantCanonical) {
		t.Errorf("/product 的輸出沒有包含自己的 canonical:%q", wantCanonical)
	}
	if strings.Contains(out, `<link rel="canonical" href="https://tripace.io/" />`) {
		t.Error("/product 的輸出仍包含指向首頁的 canonical,取代沒有生效")
	}

	if !strings.Contains(out, `<meta property="og:image" content="`+defaultImage+`" />`) {
		t.Error("/product 沒有自己的代表圖,og:image 應該沿用 defaultImage,但輸出沒有包含")
	}
	if !strings.Contains(out, `<meta name="twitter:image" content="`+defaultImage+`" />`) {
		t.Error("/product 沒有自己的代表圖,twitter:image 應該沿用 defaultImage,但輸出沒有包含")
	}
	if strings.Contains(out, `content=""`) {
		t.Error("/product 的輸出裡出現空的 content 屬性,image 的空字串 fallback 沒有生效")
	}
}

// 端對端驗證:透過真正的 http.Handler(staticHandler(),不是直接呼叫
// applySEOMeta)送出真實 HTTP 請求,確認整條路徑(含 Content-Type header
// 設定、200 狀態碼)都正確串起來,不是只有 applySEOMeta 這個函式本身
// 正確、但接線接錯地方。store 傳 nil——這裡只驗證 /jiufen(固定路徑)
// 這條既有路徑,不涉及部落格文章動態查詢,見 TestApplySEOMeta_
// BlogArticle* 系列針對 blogArticleSEOMeta 的獨立測試(有自己的 Store)。
func TestStaticHandler_ServesCorrectSEOMetaOverHTTP(t *testing.T) {
	// 複用 readRealIndexHTML 的判斷邏輯(檔案存在且不是 placeholder)
	// 決定要不要跳過——這裡不需要用到回傳值,staticHandler() 內部會自己
	// 重新讀一次 web/dist/index.html(見該函式的完整說明)。
	readRealIndexHTML(t)

	handler := staticHandler(nil)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/jiufen")
	if err != nil {
		t.Fatalf("GET /jiufen: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("預期 200,實際 %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "text/html") {
		t.Errorf("預期 Content-Type 含 text/html,實際 %q", ct)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("讀取 body: %v", err)
	}
	s := string(body)
	if !strings.Contains(s, `<link rel="canonical" href="https://tripace.io/jiufen" />`) {
		t.Error("透過真實 HTTP 請求 /jiufen,回應內容沒有正確的 canonical")
	}
}

// newBlogArticleTestStore 建立一個測試用 Store,並寫入一位作者 + 一篇
// 已發布文章,供下面幾個 blogArticleSEOMeta 測試共用——每個測試關心的
// 斷言不同,但建立資料的流程完全一樣(對齊
// internal/api/content_page_test.go TestPublicBlogArticle_PublishedReturnsOK
// 的既有建立資料模式),抽成 helper 避免每個測試都重複寫一次。
func newBlogArticleTestStore(t *testing.T) *store.Store {
	t.Helper()
	st := store.OpenTest(t)
	user, err := st.CreatePasswordUser("usr_seo_blogger", "SEO 測試部落客", "#112233", "seo-blogger@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	if _, err := st.CreateBlogProfile(user.ID, "seo-blogger", ""); err != nil {
		t.Fatalf("建立部落客設定: %v", err)
	}
	content := `{"version":1,"slug":"seo-post","title":"九份夜遊完整記錄","eyebrow":"山城散策","lede":"從基山街到阿妹茶樓,一趟九份夜晚的散步路線。","blocks":[]}`
	if _, err := st.CreateContentPage(user.ID, "seo-post", content, "tester"); err != nil {
		t.Fatalf("建立文章: %v", err)
	}
	if err := st.SetContentPageStatus(user.ID, "seo-post", "published"); err != nil {
		t.Fatalf("發布文章: %v", err)
	}
	return st
}

// TestBlogArticleSEOMeta_PublishedArticleReturnsOwnMeta 驗證 happy
// path:已發布文章用 lede 當 description、title 加上站台後綴、
// canonical 指向文章自己的 /u/{handle}/{slug} 網址(而不是首頁或任何
// 固定路徑)。
func TestBlogArticleSEOMeta_PublishedArticleReturnsOwnMeta(t *testing.T) {
	st := newBlogArticleTestStore(t)

	meta, ok := blogArticleSEOMeta(st, "https://example.test", "seo-blogger", "seo-post")
	if !ok {
		t.Fatal("已發布文章預期找得到對應的 seoMeta,但回傳 ok=false")
	}
	if want := "九份夜遊完整記錄 | Tripace"; meta.title != want {
		t.Errorf("title = %q, want %q", meta.title, want)
	}
	if want := "從基山街到阿妹茶樓,一趟九份夜晚的散步路線。"; meta.description != want {
		t.Errorf("description = %q, want %q(應該優先用 lede)", meta.description, want)
	}
	if want := "https://example.test/u/seo-blogger/seo-post"; meta.canonical != want {
		t.Errorf("canonical = %q, want %q", meta.canonical, want)
	}
}

// TestBlogArticleSEOMeta_DescriptionFallsBackToEyebrowThenTitle 驗證
// description 的三層 fallback 順序(見 blogArticleSEOMeta 的完整說明:
// lede → eyebrow → title),用兩篇分別缺 lede、缺 lede+eyebrow 的文章
// 各自驗證退一層的行為。
func TestBlogArticleSEOMeta_DescriptionFallsBackToEyebrowThenTitle(t *testing.T) {
	st := store.OpenTest(t)
	user, err := st.CreatePasswordUser("usr_seo_blogger2", "SEO 測試部落客2", "#223344", "seo-blogger2@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	if _, err := st.CreateBlogProfile(user.ID, "seo-blogger2", ""); err != nil {
		t.Fatalf("建立部落客設定: %v", err)
	}

	noLedeContent := `{"version":1,"slug":"no-lede","title":"沒有導言的文章","eyebrow":"副標籤文字","blocks":[]}`
	if _, err := st.CreateContentPage(user.ID, "no-lede", noLedeContent, "tester"); err != nil {
		t.Fatalf("建立文章(無 lede): %v", err)
	}
	if err := st.SetContentPageStatus(user.ID, "no-lede", "published"); err != nil {
		t.Fatalf("發布文章(無 lede): %v", err)
	}

	minimalContent := `{"version":1,"slug":"minimal","title":"只有標題的文章","blocks":[]}`
	if _, err := st.CreateContentPage(user.ID, "minimal", minimalContent, "tester"); err != nil {
		t.Fatalf("建立文章(僅 title): %v", err)
	}
	if err := st.SetContentPageStatus(user.ID, "minimal", "published"); err != nil {
		t.Fatalf("發布文章(僅 title): %v", err)
	}

	meta, ok := blogArticleSEOMeta(st, "https://example.test", "seo-blogger2", "no-lede")
	if !ok {
		t.Fatal("預期找得到文章")
	}
	if want := "副標籤文字"; meta.description != want {
		t.Errorf("無 lede 時 description = %q, want %q(應退回 eyebrow)", meta.description, want)
	}

	meta, ok = blogArticleSEOMeta(st, "https://example.test", "seo-blogger2", "minimal")
	if !ok {
		t.Fatal("預期找得到文章")
	}
	if want := "只有標題的文章"; meta.description != want {
		t.Errorf("無 lede 也無 eyebrow 時 description = %q, want %q(應退回 title)", meta.description, want)
	}
}

// TestBlogArticleSEOMeta_DraftArticleReturnsNotFound 驗證草稿(未發布)
// 文章不會被拿來組 SEO meta——草稿內容不該被搜尋引擎索引到標題/描述
// 預覽,見 blogArticleSEOMeta 的完整說明。
func TestBlogArticleSEOMeta_DraftArticleReturnsNotFound(t *testing.T) {
	st := store.OpenTest(t)
	user, err := st.CreatePasswordUser("usr_seo_blogger3", "SEO 測試部落客3", "#334455", "seo-blogger3@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	if _, err := st.CreateBlogProfile(user.ID, "seo-blogger3", ""); err != nil {
		t.Fatalf("建立部落客設定: %v", err)
	}
	content := `{"version":1,"slug":"draft-post","title":"還沒發布的草稿","blocks":[]}`
	if _, err := st.CreateContentPage(user.ID, "draft-post", content, "tester"); err != nil {
		t.Fatalf("建立文章: %v", err)
	}
	// 刻意不呼叫 SetContentPageStatus——CreateContentPage 預設建立的
	// 文章就是草稿狀態,不需要額外操作就能測到「未發布」這個情境。

	_, ok := blogArticleSEOMeta(st, "https://example.test", "seo-blogger3", "draft-post")
	if ok {
		t.Error("草稿文章不應該回傳 ok=true 的 seoMeta")
	}
}

// TestBlogArticleSEOMeta_UnknownHandleOrSlugReturnsNotFound 驗證
// handle 不存在、或 handle 存在但 slug 查無此文章時,都回傳
// ok=false——兩種情境理由不同(作者不存在 vs 文章不存在),但對外行為
// 一致,比照 handlePublicBlogArticle 既有的「兩種情境都回 404,不洩漏
// 細節」設計。
func TestBlogArticleSEOMeta_UnknownHandleOrSlugReturnsNotFound(t *testing.T) {
	st := newBlogArticleTestStore(t)

	if _, ok := blogArticleSEOMeta(st, "https://example.test", "no-such-handle", "seo-post"); ok {
		t.Error("不存在的 handle 不應該回傳 ok=true")
	}
	if _, ok := blogArticleSEOMeta(st, "https://example.test", "seo-blogger", "no-such-slug"); ok {
		t.Error("不存在的 slug 不應該回傳 ok=true")
	}
}

// TestApplySEOMeta_BlogArticlePathInjectsOwnMeta 端對端驗證:
// applySEOMeta 對 /u/{handle}/{slug} 路徑,會實際查資料庫並把
// title/description/canonical 換成這篇文章自己的值,不是沿用首頁預設
// 內容——這是整條串接(blogArticlePathPattern 比對 → 查 handle → 查
// slug → 組 seoMeta → 套用既有的字串取代機制)的驗證,不是只測
// blogArticleSEOMeta 這個函式本身。
func TestApplySEOMeta_BlogArticlePathInjectsOwnMeta(t *testing.T) {
	html := readRealIndexHTML(t)
	t.Setenv("SITE_BASE_URL", "https://tripace.io")
	st := newBlogArticleTestStore(t)

	out := string(applySEOMeta(html, "/u/seo-blogger/seo-post", st))

	wantTitle := "九份夜遊完整記錄 | Tripace"
	if !strings.Contains(out, "<title>"+wantTitle+"</title>") {
		t.Errorf("輸出沒有包含文章自己的 <title>,want %q", wantTitle)
	}
	wantCanonical := `<link rel="canonical" href="https://tripace.io/u/seo-blogger/seo-post" />`
	if !strings.Contains(out, wantCanonical) {
		t.Errorf("輸出沒有包含文章自己的 canonical:%q", wantCanonical)
	}
	if strings.Contains(out, `<link rel="canonical" href="https://tripace.io/" />`) {
		t.Error("輸出仍包含指向首頁的 canonical,部落格文章的取代沒有生效")
	}
}

// TestApplySEOMeta_UnpublishedBlogArticlePathLeavesDefaultMeta 驗證
// 路徑符合 /u/{handle}/{slug} 格式、但文章不存在或未發布時,
// applySEOMeta 原樣傳回 index.html(維持首頁預設內容),不會因為路徑
// 格式匹配就誤以為一定找得到對應文章。
func TestApplySEOMeta_UnpublishedBlogArticlePathLeavesDefaultMeta(t *testing.T) {
	html := readRealIndexHTML(t)
	st := store.OpenTest(t)

	out := applySEOMeta(html, "/u/nobody/nothing", st)
	if string(out) != string(html) {
		t.Error("路徑符合 /u/{handle}/{slug} 格式但查無文章時,applySEOMeta 不該修改內容")
	}
}

// TestApplySEOMeta_BlogArticlePathWithNilStoreLeavesDefaultMeta 驗證
// st 傳 nil 時(例如某些呼叫端刻意不想處理部落格文章這條路徑),
// applySEOMeta 不會 panic,而是安全地跳過部落格文章查詢、原樣傳回。
func TestApplySEOMeta_BlogArticlePathWithNilStoreLeavesDefaultMeta(t *testing.T) {
	html := readRealIndexHTML(t)

	out := applySEOMeta(html, "/u/someone/some-post", nil)
	if string(out) != string(html) {
		t.Error("st 為 nil 時,applySEOMeta 應該原樣傳回,不應 panic 也不應修改內容")
	}
}

// TestHeroPhotoImageURL_PrefersLargeVariant 驗證 heroPhotoImageURL
// 的挑選順序:有 large 版本時優先用它,不用原圖——見 blogArticleSEOMeta
// 對 image 欄位的完整說明。
func TestHeroPhotoImageURL_PrefersLargeVariant(t *testing.T) {
	photo := model.UploadedPhoto{
		OriginalURL: "https://example.test/original.jpg",
		Variants: []model.PhotoVariant{
			{Kind: "thumbnail", URL: "https://example.test/thumb.jpg"},
			{Kind: "large", URL: "https://example.test/large.jpg"},
		},
	}
	if got := heroPhotoImageURL(photo); got != "https://example.test/large.jpg" {
		t.Errorf("heroPhotoImageURL() = %q, want large 版本的網址", got)
	}
}

// TestHeroPhotoImageURL_FallsBackToOriginalWhenNoLargeVariant 驗證
// 查無 large 版本時(例如剛上傳完成、背景處理還沒跑完)退回原圖——
// 對齊 BlogArticlePage.tsx resolvePhotoURL 對同一種情境的既有處理。
func TestHeroPhotoImageURL_FallsBackToOriginalWhenNoLargeVariant(t *testing.T) {
	photo := model.UploadedPhoto{
		OriginalURL: "https://example.test/original.jpg",
		Variants: []model.PhotoVariant{
			{Kind: "thumbnail", URL: "https://example.test/thumb.jpg"},
		},
	}
	if got := heroPhotoImageURL(photo); got != "https://example.test/original.jpg" {
		t.Errorf("heroPhotoImageURL() = %q, want 原圖網址(無 large 版本時的 fallback)", got)
	}
}

// TestBlogArticleSEOMeta_UsesHeroPhotoAsImage 驗證使用者明確要求的
// 行為:「og:image 要用頁面 hero 圖」——文章內容裡設定了 heroPhotoId
// 時,blogArticleSEOMeta 回傳的 image 要是這張照片的實際網址,不是
// 空字串。
func TestBlogArticleSEOMeta_UsesHeroPhotoAsImage(t *testing.T) {
	st := store.OpenTest(t)
	user, err := st.CreatePasswordUser("usr_seo_blogger4", "SEO 測試部落客4", "#445566", "seo-blogger4@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	if _, err := st.CreateBlogProfile(user.ID, "seo-blogger4", ""); err != nil {
		t.Fatalf("建立部落客設定: %v", err)
	}
	photo, err := st.CreateUploadedPhoto(user.ID, "https://example.test/hero-original.jpg", "")
	if err != nil {
		t.Fatalf("建立照片: %v", err)
	}
	if _, err := st.CreatePhotoVariant(photo.ID, "large", "https://example.test/hero-large.jpg", 1200, 800); err != nil {
		t.Fatalf("建立照片衍生版本: %v", err)
	}
	content := `{"version":1,"slug":"with-hero","title":"有 Hero 圖的文章","heroPhotoId":"` + photo.ID + `","blocks":[]}`
	if _, err := st.CreateContentPage(user.ID, "with-hero", content, "tester"); err != nil {
		t.Fatalf("建立文章: %v", err)
	}
	if err := st.SetContentPageStatus(user.ID, "with-hero", "published"); err != nil {
		t.Fatalf("發布文章: %v", err)
	}

	meta, ok := blogArticleSEOMeta(st, "https://example.test", "seo-blogger4", "with-hero")
	if !ok {
		t.Fatal("預期找得到文章")
	}
	if want := "https://example.test/hero-large.jpg"; meta.image != want {
		t.Errorf("image = %q, want %q(應該是 heroPhotoId 對應照片的 large 版本)", meta.image, want)
	}
}

// TestBlogArticleSEOMeta_NoHeroPhotoLeavesImageEmpty 驗證兩個 hero
// photoId 欄位都沒設定時 image 留空字串——呼叫端(applySEOMeta)的
// 既有邏輯會接手 fallback 到 defaultImage,這裡只需要確認
// blogArticleSEOMeta 本身不會對空的 photoId 做任何查詢或產生錯誤的
// 網址。
func TestBlogArticleSEOMeta_NoHeroPhotoLeavesImageEmpty(t *testing.T) {
	st := newBlogArticleTestStore(t)

	meta, ok := blogArticleSEOMeta(st, "https://example.test", "seo-blogger", "seo-post")
	if !ok {
		t.Fatal("預期找得到文章")
	}
	if meta.image != "" {
		t.Errorf("image = %q, 沒有設定 heroPhotoId/heroStandalonePhotoId 時應該是空字串", meta.image)
	}
}

// TestBlogArticleSEOMeta_FallsBackToHeroStandalonePhotoWhenNoHeroPhoto
// 驗證 heroPhotoId 的 fallback 行為(2026-10 新增,使用者實機發現
// night-jiufen 文章只有 heroStandalonePhotoId、沒有 heroPhotoId,
// og:image 因此沒有換成文章的圖):沒有 heroPhotoId 但有
// heroStandalonePhotoId 時,image 要退回用 heroStandalonePhotoId 對應
// 的照片,不是直接放棄、留空字串——見 blogArticleSEOMeta 對 image
// 變數的完整說明(兩者優先順位的理由)。
func TestBlogArticleSEOMeta_FallsBackToHeroStandalonePhotoWhenNoHeroPhoto(t *testing.T) {
	st := store.OpenTest(t)
	user, err := st.CreatePasswordUser("usr_seo_blogger6", "SEO 測試部落客6", "#667788", "seo-blogger6@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	if _, err := st.CreateBlogProfile(user.ID, "seo-blogger6", ""); err != nil {
		t.Fatalf("建立部落客設定: %v", err)
	}
	photo, err := st.CreateUploadedPhoto(user.ID, "https://example.test/standalone-original.jpg", "")
	if err != nil {
		t.Fatalf("建立照片: %v", err)
	}
	if _, err := st.CreatePhotoVariant(photo.ID, "large", "https://example.test/standalone-large.jpg", 1200, 800); err != nil {
		t.Fatalf("建立照片衍生版本: %v", err)
	}
	content := `{"version":1,"slug":"standalone-only","title":"只有 standalone 大圖的文章","heroStandalonePhotoId":"` + photo.ID + `","blocks":[]}`
	if _, err := st.CreateContentPage(user.ID, "standalone-only", content, "tester"); err != nil {
		t.Fatalf("建立文章: %v", err)
	}
	if err := st.SetContentPageStatus(user.ID, "standalone-only", "published"); err != nil {
		t.Fatalf("發布文章: %v", err)
	}

	meta, ok := blogArticleSEOMeta(st, "https://example.test", "seo-blogger6", "standalone-only")
	if !ok {
		t.Fatal("預期找得到文章")
	}
	if want := "https://example.test/standalone-large.jpg"; meta.image != want {
		t.Errorf("image = %q, want %q(無 heroPhotoId 時應退回 heroStandalonePhotoId 對應的圖)", meta.image, want)
	}
}

// TestApplySEOMeta_BlogArticlePathInjectsHeroImageAsOGImage 端對端
// 驗證:applySEOMeta 對有 heroPhotoId 的文章,實際輸出的
// og:image/twitter:image 標籤要換成這張照片的網址,不是沿用
// defaultImage——這是整條串接(blogArticleSEOMeta 查出 image → 套用
// applySEOMeta 既有的字串取代機制)的驗證,不是只測
// blogArticleSEOMeta 這個函式本身。
func TestApplySEOMeta_BlogArticlePathInjectsHeroImageAsOGImage(t *testing.T) {
	html := readRealIndexHTML(t)
	t.Setenv("SITE_BASE_URL", "https://tripace.io")
	st := store.OpenTest(t)
	user, err := st.CreatePasswordUser("usr_seo_blogger5", "SEO 測試部落客5", "#556677", "seo-blogger5@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	if _, err := st.CreateBlogProfile(user.ID, "seo-blogger5", ""); err != nil {
		t.Fatalf("建立部落客設定: %v", err)
	}
	photo, err := st.CreateUploadedPhoto(user.ID, "https://example.test/hero-original.jpg", "")
	if err != nil {
		t.Fatalf("建立照片: %v", err)
	}
	if _, err := st.CreatePhotoVariant(photo.ID, "large", "https://example.test/hero-large.jpg", 1200, 800); err != nil {
		t.Fatalf("建立照片衍生版本: %v", err)
	}
	content := `{"version":1,"slug":"with-hero","title":"有 Hero 圖的文章","heroPhotoId":"` + photo.ID + `","blocks":[]}`
	if _, err := st.CreateContentPage(user.ID, "with-hero", content, "tester"); err != nil {
		t.Fatalf("建立文章: %v", err)
	}
	if err := st.SetContentPageStatus(user.ID, "with-hero", "published"); err != nil {
		t.Fatalf("發布文章: %v", err)
	}

	out := string(applySEOMeta(html, "/u/seo-blogger5/with-hero", st))

	wantImageTag := `<meta property="og:image" content="https://example.test/hero-large.jpg" />`
	if !strings.Contains(out, wantImageTag) {
		t.Errorf("輸出沒有包含文章 hero 圖的 og:image:%q", wantImageTag)
	}
	wantTwitterImageTag := `<meta name="twitter:image" content="https://example.test/hero-large.jpg" />`
	if !strings.Contains(out, wantTwitterImageTag) {
		t.Errorf("輸出沒有包含文章 hero 圖的 twitter:image:%q", wantTwitterImageTag)
	}
	if strings.Contains(out, `content="https://tripace.io/og-image.png"`) {
		t.Error("輸出仍包含首頁預設的 og-image.png,hero 圖的取代沒有生效")
	}
}

package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
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

func TestApplySEOMeta_KnownRouteReplacesTitleDescriptionCanonical(t *testing.T) {
	html := readRealIndexHTML(t)

	out := string(applySEOMeta(html, "/jiufen"))

	wantTitle := "九份——礦業興衰與人文重生的山城故事 | Tripace"
	if !strings.Contains(out, "<title>"+wantTitle+"</title>") {
		t.Errorf("輸出沒有包含九份頁的 <title>,got title area: %q", wantTitle)
	}
	if strings.Contains(out, "<title>Tripace — 從探索到行程，深入走訪一個想去的地方</title>") {
		t.Error("輸出仍包含首頁的 <title>,取代沒有生效")
	}

	wantCanonical := `<link rel="canonical" href="https://tripace.shuttle.tools/jiufen" />`
	if !strings.Contains(out, wantCanonical) {
		t.Errorf("輸出沒有包含九份頁正確的 canonical:%q", wantCanonical)
	}
	if strings.Contains(out, `<link rel="canonical" href="https://tripace.shuttle.tools/" />`) {
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
	if !strings.Contains(out, `<meta property="og:url" content="https://tripace.shuttle.tools/jiufen" />`) {
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
	if strings.Contains(out, `content="https://tripace.shuttle.tools/og-image.png"`) {
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
		out := string(applySEOMeta(html, p))
		wantCanonical := `<link rel="canonical" href="https://tripace.shuttle.tools` + p + `" />`
		if !strings.Contains(out, wantCanonical) {
			t.Errorf("路徑 %s 的輸出沒有包含正確的 canonical:%q", p, wantCanonical)
		}
		if seen[wantCanonical] {
			t.Errorf("路徑 %s 的 canonical 跟先前某個路徑重複,表示 seoMetaByPath 設定有誤", p)
		}
		seen[wantCanonical] = true
	}
}

// 首頁本身、/product、/privacy、/terms 這幾個路徑不在 seoMetaByPath 裡
// (見該變數的完整說明——/product/privacy/terms 本來就沒有自己的 Helmet
// SEO meta,首頁的內容就是 index.html 的原始值),applySEOMeta 應該原樣
// 傳回、不做任何取代。
func TestApplySEOMeta_UnknownRouteReturnsUnchanged(t *testing.T) {
	html := readRealIndexHTML(t)

	for _, p := range []string{"/", "/product", "/privacy", "/terms", "/app", "/some-unknown-path"} {
		out := applySEOMeta(html, p)
		if string(out) != string(html) {
			t.Errorf("路徑 %s 不在 seoMetaByPath 裡,applySEOMeta 不該修改內容,但輸出跟原始內容不同", p)
		}
	}
}

// 端對端驗證:透過真正的 http.Handler(staticHandler(),不是直接呼叫
// applySEOMeta)送出真實 HTTP 請求,確認整條路徑(含 Content-Type header
// 設定、200 狀態碼)都正確串起來,不是只有 applySEOMeta 這個函式本身
// 正確、但接線接錯地方。
func TestStaticHandler_ServesCorrectSEOMetaOverHTTP(t *testing.T) {
	// 複用 readRealIndexHTML 的判斷邏輯(檔案存在且不是 placeholder)
	// 決定要不要跳過——這裡不需要用到回傳值,staticHandler() 內部會自己
	// 重新讀一次 web/dist/index.html(見該函式的完整說明)。
	readRealIndexHTML(t)

	handler := staticHandler()
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
	if !strings.Contains(s, `<link rel="canonical" href="https://tripace.shuttle.tools/jiufen" />`) {
		t.Error("透過真實 HTTP 請求 /jiufen,回應內容沒有正確的 canonical")
	}
}

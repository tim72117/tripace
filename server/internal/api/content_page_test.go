package api

// content_page_test.go 測主題介紹頁/部落格文章的管理端點(/internal/
// maintenance/content-pages/*)與公開讀取端點(/v1/content-pages/{slug}),
// 見 content_page.go 開頭的完整說明。
//
// 刻意透過 s.Routes() 打完整的 mux(對齊 entry_test.go 的既有理由),
// 不直接呼叫 handler 函式——驗證的重點包含路由字串本身是否正確註冊
// (api.go 的 HandleFunc 呼叫),繞過 mux 就等於繞過了這個檢查。
//
// 核心案例:草稿(draft)在管理端點可見、但公開端點必須回 404(訪客
// 不該看到還在編輯中的內容)——發布(publish)之後公開端點才能讀到。
// 只寫 happy path + 這個關鍵的草稿/發布狀態差異。
import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// mustMarshalJSON 把測試用的 content map 轉成 JSON 字串,供直接呼叫
// store.CreateContentPage 時使用(該方法的 content 參數是已序列化的字串,
// 見 CreateContentPage 的簽名;走 API 的 handleMaintenanceContentPageCreate
// 則是收巢狀物件再自己序列化,兩邊呼叫層級不同,這裡測的是
// handlePublicBlogArticle,直接灌資料進 store 比較直接,不需要額外帶
// JWT 走一次管理端點)。
func mustMarshalJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

func (f *testFixture) doNoAuth(t *testing.T, method, path string, wantStatus int) map[string]any {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	rec := httptest.NewRecorder()
	f.routes.ServeHTTP(rec, req)
	if rec.Code != wantStatus {
		t.Fatalf("%s %s: got status %d, want %d, body=%s", method, path, rec.Code, wantStatus, rec.Body.String())
	}
	var out map[string]any
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("unmarshal body: %v, raw=%s", err, rec.Body.String())
		}
	}
	return out
}

func TestContentPage_CRUDAndPublishFlow(t *testing.T) {
	f := newEntryFixture(t)
	// official 模式 2026-10 改成需要 email 白名單(見
	// resolveContentPageOwnerID 的完整說明,修正 code review 發現的權限
	// 提升漏洞)——這個測試整段都在測 official 模式(城市介紹頁情境),
	// 直接把 fixture 內建的測試使用者 email(owner@example.com)設成
	// 這次測試用的白名單,讓既有的 CRUD/發布流程斷言維持原本的測試意圖
	// (驗證 official 模式本身的行為,不是在測權限檢查——權限檢查本身
	// 另有獨立測試涵蓋,見 TestContentPage_Official模式需要admin權限)。
	f.srv.adminBootstrapEmail = "owner@example.com"

	// 1. 建立——管理端點,帶 JWT。
	content := map[string]any{
		"version": 1, "slug": "test-city", "title": "測試城市",
		"status": "draft",
		"blocks": []map[string]any{
			{"id": "b1", "kind": "paragraph", "text": "這是一段測試文案"},
		},
	}
	created := f.do(t, "POST", "/internal/maintenance/content-pages", map[string]any{
		"slug": "test-city", "content": content, "updatedBy": "tester", "official": true,
	}, http.StatusCreated)
	if created["slug"] != "test-city" {
		t.Fatalf("建立回應的 slug 不符: %v", created)
	}
	if created["status"] != "draft" {
		t.Fatalf("新建立的主題頁應該是 draft,got: %v", created["status"])
	}

	// 2. 公開端點此時應該 404——還是草稿,訪客不該看到。
	f.doNoAuth(t, "GET", "/v1/content-pages/test-city", http.StatusNotFound)

	// 3. 管理端點 get 應該看得到(含草稿)。
	got := f.do(t, "GET", "/internal/maintenance/content-pages/test-city?official=true", nil, http.StatusOK)
	gotContent, ok := got["content"].(map[string]any)
	if !ok {
		t.Fatalf("content 應該是展開的物件,不是字串,got %T: %v", got["content"], got["content"])
	}
	if gotContent["title"] != "測試城市" {
		t.Fatalf("內容 title 不符: %v", gotContent)
	}

	// 4. list 應該包含這一筆。
	listRes := f.do(t, "GET", "/internal/maintenance/content-pages", nil, http.StatusOK)
	pages, ok := listRes["contentPages"].([]any)
	if !ok || len(pages) != 1 {
		t.Fatalf("list 應該有 1 筆,got: %v", listRes)
	}

	// 5. 整份覆寫內容。
	newContent := map[string]any{
		"version": 1, "slug": "test-city", "title": "更新後的標題",
		"status": "draft",
		"blocks": []map[string]any{
			{"id": "b1", "kind": "paragraph", "text": "更新後的文案"},
		},
	}
	f.do(t, "PUT", "/internal/maintenance/content-pages/test-city", map[string]any{
		"content": newContent, "updatedBy": "tester2", "official": true,
	}, http.StatusOK)
	got2 := f.do(t, "GET", "/internal/maintenance/content-pages/test-city?official=true", nil, http.StatusOK)
	gotContent2 := got2["content"].(map[string]any)
	if gotContent2["title"] != "更新後的標題" {
		t.Fatalf("覆寫後的內容未反映,got: %v", gotContent2)
	}

	// 6. 發布——公開端點之後應該能讀到。
	f.do(t, "PATCH", "/internal/maintenance/content-pages/test-city/publish", map[string]any{
		"published": true, "official": true,
	}, http.StatusOK)
	public := f.doNoAuth(t, "GET", "/v1/content-pages/test-city", http.StatusOK)
	publicContent, ok := public["content"].(map[string]any)
	if !ok || publicContent["title"] != "更新後的標題" {
		t.Fatalf("發布後公開端點應該讀到最新內容,got: %v", public)
	}

	// 7. 取消發布——公開端點應該再次 404。
	f.do(t, "PATCH", "/internal/maintenance/content-pages/test-city/publish", map[string]any{
		"published": false, "official": true,
	}, http.StatusOK)
	f.doNoAuth(t, "GET", "/v1/content-pages/test-city", http.StatusNotFound)

	// 8. 刪除。
	f.do(t, "DELETE", "/internal/maintenance/content-pages/test-city?official=true", nil, http.StatusOK)
	f.do(t, "GET", "/internal/maintenance/content-pages/test-city?official=true", nil, http.StatusNotFound)
}

func TestContentPage_GetMissing(t *testing.T) {
	f := newEntryFixture(t)
	f.do(t, "GET", "/internal/maintenance/content-pages/does-not-exist", nil, http.StatusNotFound)
}

// TestContentPage_已刪除使用者的合法JWT在使用者模式被拒絕 對應 2026-10
// code review 發現的身份衝突漏洞:resolveContentPageOwnerID 原本在非
// official 模式下直接信任 s.userFor(r).ID,但 JWT 簽章合法、claims.Sub
// 對應的使用者已被刪除時,userFor 會悄悄回退成共用的 s.guestUser(ID
// 固定 "usr_me")——兩個「使用者已被刪除、JWT 還沒過期」的請求會被當成
// 同一個 ownerID 處理,一個已刪除使用者的殘留 token 能讀寫/刪除另一個
// 已刪除使用者殘留 token 建立的 content page。
//
// 改用 requireRealUser 後,這裡驗證建立端點(使用者模式,不帶 official)
// 面對這種 ghost token 應該回 403(權限不足),不應該成功建立、也不該
// 把內容寫進 "usr_me" 這個共用命名空間。
func TestContentPage_已刪除使用者的合法JWT在使用者模式被拒絕(t *testing.T) {
	f := newEntryFixture(t)
	ghostToken, err := f.srv.signer.Sign("usr_ghost_content_page", "ghost")
	if err != nil {
		t.Fatalf("簽 ghost token: %v", err)
	}
	content := map[string]any{
		"version": 1, "slug": "ghost-city", "title": "不該被建立的內容",
		"status": "draft",
		"blocks": []map[string]any{{"id": "b1", "kind": "paragraph", "text": "x"}},
	}
	f.doAs(t, ghostToken, "POST", "/internal/maintenance/content-pages", map[string]any{
		"slug": "ghost-city", "content": content, "updatedBy": "tester",
		// 刻意不帶 official,測的是使用者模式(預設行為)。
	}, http.StatusForbidden)

	// 確認真的沒有寫進共用的訪客命名空間("usr_me",見 s.guestUser)——
	// 不只是回應狀態碼對了,資料也真的沒有悄悄落在一個共用身份底下。
	if _, err := f.srv.store.GetContentPageBySlug(f.srv.guestUser.ID, "ghost-city"); err == nil {
		t.Fatalf("已刪除使用者的 ghost token 不應該能寫進共用的訪客命名空間(%q)", f.srv.guestUser.ID)
	}

	// 其餘動詞(get/update/publish/delete)同樣要被擋下。
	f.doAs(t, ghostToken, "GET", "/internal/maintenance/content-pages/ghost-city", nil, http.StatusForbidden)
	f.doAs(t, ghostToken, "PUT", "/internal/maintenance/content-pages/ghost-city", map[string]any{
		"content": content,
	}, http.StatusForbidden)
	f.doAs(t, ghostToken, "PATCH", "/internal/maintenance/content-pages/ghost-city/publish", map[string]any{
		"published": true,
	}, http.StatusForbidden)
	f.doAs(t, ghostToken, "DELETE", "/internal/maintenance/content-pages/ghost-city", nil, http.StatusForbidden)
}

// TestContentPage_Official模式Email大小寫不同仍能正確比對 驗證 2026-10
// 修正過的 email 大小寫正規化(見 internal/adminidentity.IsAdminEmail 的
// 完整說明):adminBootstrapEmail 設定成全大寫,使用者註冊時的 email 是
// 原本的大小寫(密碼註冊路徑一律 strings.ToLower 正規化存入資料庫,見
// handleRegister),official 模式的白名單比對仍然要能成功,不能因為
// 大小寫不同就把 admin 本人鎖在白名單外。
func TestContentPage_Official模式Email大小寫不同仍能正確比對(t *testing.T) {
	f := newEntryFixture(t)
	// fixture 內建使用者 email 固定是小寫的 "owner@example.com"(見
	// newEntryFixture),這裡把白名單設成完全不同大小寫型態,驗證比對時
	// 不分大小寫。
	f.srv.adminBootstrapEmail = "OWNER@EXAMPLE.COM"

	content := map[string]any{
		"version": 1, "slug": "case-insensitive-city", "title": "大小寫測試",
		"status": "draft",
		"blocks": []map[string]any{{"id": "b1", "kind": "paragraph", "text": "x"}},
	}
	created := f.do(t, "POST", "/internal/maintenance/content-pages", map[string]any{
		"slug": "case-insensitive-city", "content": content, "updatedBy": "tester", "official": true,
	}, http.StatusCreated)
	if created["slug"] != "case-insensitive-city" {
		t.Fatalf("白名單 email 大小寫不同時,official 模式仍應該成功建立,got: %v", created)
	}
}

// TestContentPage_Official模式需要admin權限 驗證修正過的權限提升漏洞——
// 不在 ADMIN_BOOTSTRAP_EMAIL 白名單裡的一般登入使用者,就算帶著合法的
// JWT,傳 official:true 也應該被拒絕(403),不能真的寫進/讀出/修改/
// 刪除官方命名空間的內容(見 resolveContentPageOwnerID 的完整說明)。
func TestContentPage_Official模式需要admin權限(t *testing.T) {
	f := newEntryFixture(t)
	// fixture 內建的使用者 email 是 owner@example.com,刻意不設成
	// adminBootstrapEmail(維持空字串的預設值,對齊 fail-closed 的既有
	// 設計——環境變數未設定時,視為「沒有任何人有 official 權限」,而不是
	// 「沒有限制、任何人都能用」)。
	content := map[string]any{
		"version": 1, "slug": "forbidden-city", "title": "不該被建立的內容",
		"status": "draft",
		"blocks": []map[string]any{{"id": "b1", "kind": "paragraph", "text": "x"}},
	}
	f.do(t, "POST", "/internal/maintenance/content-pages", map[string]any{
		"slug": "forbidden-city", "content": content, "updatedBy": "tester", "official": true,
	}, http.StatusForbidden)

	// 確認上面那次被拒絕的建立呼叫,真的沒有在任何命名空間留下記錄
	// (不只是回應狀態碼對了,資料也真的沒有寫進去)。
	if _, err := f.srv.store.GetContentPageBySlug("", "forbidden-city"); err == nil {
		t.Fatalf("official(空字串 ownerID)命名空間不應該有這筆記錄——權限檢查應該在寫入前就擋下")
	}
	if _, err := f.srv.store.GetContentPageBySlug("usr_owner", "forbidden-city"); err == nil {
		t.Fatalf("使用者自己的命名空間也不應該有這筆記錄——official:true 的請求不該被悄悄降級成使用者模式寫入")
	}

	// 其餘四個動詞(get/update/publish/delete)同樣要被擋下,全部用
	// 不在白名單的 owner@example.com 身份測試,確認這個權限檢查套用到
	// 全部五支 official 相關端點,不是只做了 create 這一支。
	f.do(t, "GET", "/internal/maintenance/content-pages/forbidden-city?official=true", nil, http.StatusForbidden)
	f.do(t, "PUT", "/internal/maintenance/content-pages/forbidden-city", map[string]any{
		"content": content, "official": true,
	}, http.StatusForbidden)
	f.do(t, "PATCH", "/internal/maintenance/content-pages/forbidden-city/publish", map[string]any{
		"published": true, "official": true,
	}, http.StatusForbidden)
	f.do(t, "DELETE", "/internal/maintenance/content-pages/forbidden-city?official=true", nil, http.StatusForbidden)

	// adminBootstrapEmail 設定後,同一個使用者(假設他的 email 剛好就是
	// 白名單)才能成功——驗證這不是「official 模式整個壞掉」,而是精準
	// 的白名單檢查,換成符合白名單的身份就能正常運作。
	f.srv.adminBootstrapEmail = "owner@example.com"
	f.do(t, "POST", "/internal/maintenance/content-pages", map[string]any{
		"slug": "forbidden-city", "content": content, "updatedBy": "tester", "official": true,
	}, http.StatusCreated)
}

func TestContentPage_CreateRequiresSlugAndContent(t *testing.T) {
	f := newEntryFixture(t)
	req := httptest.NewRequest("POST", "/internal/maintenance/content-pages", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Authorization", "Bearer "+f.token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	f.routes.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("缺 slug/content 應該回 400,got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestContentPage_CreateRequiresObjectContent 驗證 content 必須是 JSON
// 物件——裸數字/字串/null 等語法合法但形狀不對的值應該被 400 擋下來,
// 不該被原樣存進資料庫(見 isJSONObject 的完整說明)。
func TestContentPage_CreateRequiresObjectContent(t *testing.T) {
	f := newEntryFixture(t)
	for _, body := range []string{
		`{"slug":"x","content":null}`,
		`{"slug":"x","content":0}`,
		`{"slug":"x","content":"not an object"}`,
		`{"slug":"x","content":[1,2,3]}`,
	} {
		req := httptest.NewRequest("POST", "/internal/maintenance/content-pages", bytes.NewReader([]byte(body)))
		req.Header.Set("Authorization", "Bearer "+f.token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		f.routes.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("content=%s 應該回 400,got %d: %s", body, rec.Code, rec.Body.String())
		}
	}
}

// TestContentPage_CreateDuplicateSlugConflicts 驗證重複建立同一個 slug
// 回 409(slug_taken),而不是把底層 driver 的 unique constraint 錯誤
// 字串原樣當 500 吐出去(見 store.CreateContentPage 的完整說明)。
func TestContentPage_CreateDuplicateSlugConflicts(t *testing.T) {
	f := newEntryFixture(t)
	content := map[string]any{"version": 1, "slug": "dup-city", "title": "x", "status": "draft", "blocks": []map[string]any{}}
	f.do(t, "POST", "/internal/maintenance/content-pages", map[string]any{"slug": "dup-city", "content": content}, http.StatusCreated)
	resp := f.do(t, "POST", "/internal/maintenance/content-pages", map[string]any{"slug": "dup-city", "content": content}, http.StatusConflict)
	errBody, ok := resp["error"].(map[string]any)
	if !ok || errBody["code"] != "slug_taken" {
		t.Fatalf("重複 slug 應該回 slug_taken 錯誤碼,got: %v", resp)
	}
}

// TestContentPage_MutateMissingSlugReturns404 驗證對不存在的 slug 做
// update/publish/delete 都正確回 404,而不是誤判成「更新/刪除成功」
// ——GORM 的 Updates()/Delete() 在 WHERE 條件沒有命中任何列時 Error
// 仍是 nil,若 store 層不額外檢查 RowsAffected,這三個操作會對一個
// 根本不存在的 slug 靜默回 200(見 store.UpdateContentPageContent/
// SetContentPageStatus/DeleteContentPage 的完整說明)。
func TestContentPage_MutateMissingSlugReturns404(t *testing.T) {
	f := newEntryFixture(t)
	content := map[string]any{"version": 1, "slug": "x", "title": "x", "status": "draft", "blocks": []map[string]any{}}

	f.do(t, "PUT", "/internal/maintenance/content-pages/does-not-exist", map[string]any{"content": content}, http.StatusNotFound)
	f.do(t, "PATCH", "/internal/maintenance/content-pages/does-not-exist/publish", map[string]any{"published": true}, http.StatusNotFound)
	f.do(t, "DELETE", "/internal/maintenance/content-pages/does-not-exist", nil, http.StatusNotFound)
}

// TestPublicBlogArticle_HandleNotFound 驗證 handle 本身查無此人時回
// 404——這是跟 handlePublicContentPage 不同的新增判斷分支(多了一層
// handle→UserID 解析),要確保 store.GetBlogProfileByHandle 回傳
// ErrNotFound 時有被正確轉成 404,而不是誤判成 500。
func TestPublicBlogArticle_HandleNotFound(t *testing.T) {
	f := newEntryFixture(t)
	f.doNoAuth(t, "GET", "/v1/blog/no-such-handle/some-slug", http.StatusNotFound)
}

// TestPublicBlogArticle_SlugNotFoundUnderOwner 驗證 handle 存在,但
// 該作者底下沒有這個 slug 時回 404——確保 ownerID 真的有被正確代入
// GetContentPageBySlug 查詢(而不是誤查到系統帳號命名空間或其他使用者
// 的文章)。
func TestPublicBlogArticle_SlugNotFoundUnderOwner(t *testing.T) {
	f := newEntryFixture(t)
	user, err := f.srv.store.CreatePasswordUser("usr_blogger", "部落客", "#112233", "blogger@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	if _, err := f.srv.store.CreateBlogProfile(user.ID, "blogger-a", ""); err != nil {
		t.Fatalf("建立部落客設定: %v", err)
	}
	f.doNoAuth(t, "GET", "/v1/blog/blogger-a/does-not-exist", http.StatusNotFound)
}

// TestPublicBlogArticle_DraftReturns404 驗證文章存在但還是草稿時,
// 公開端點一樣要回 404——訪客不該看到未發布的部落格文章,判斷邏輯
// 比照 handlePublicContentPage 的草稿/發布差異(見該測試的既有說明)。
func TestPublicBlogArticle_DraftReturns404(t *testing.T) {
	f := newEntryFixture(t)
	user, err := f.srv.store.CreatePasswordUser("usr_blogger2", "部落客2", "#334455", "blogger2@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	if _, err := f.srv.store.CreateBlogProfile(user.ID, "blogger-b", ""); err != nil {
		t.Fatalf("建立部落客設定: %v", err)
	}
	content := map[string]any{
		"version": 1, "slug": "draft-post", "title": "還沒發布的文章",
		"status": "draft",
		"blocks": []map[string]any{
			{"id": "b1", "kind": "paragraph", "text": "草稿內容"},
		},
	}
	if _, err := f.srv.store.CreateContentPage(user.ID, "draft-post", mustMarshalJSON(t, content), "tester"); err != nil {
		t.Fatalf("建立文章: %v", err)
	}
	f.doNoAuth(t, "GET", "/v1/blog/blogger-b/draft-post", http.StatusNotFound)
}

// ---------------------------------------------------------------------
// handlePublicContentPage 獨立測試(原本完全沒有專屬測試,只在
// TestContentPage_CRUDAndPublishFlow 的 CRUD 流程中順便走過一次)。
// ---------------------------------------------------------------------

// TestPublicContentPage_SlugNotFound 驗證 slug 根本不存在時回 404。
func TestPublicContentPage_SlugNotFound(t *testing.T) {
	f := newEntryFixture(t)
	f.doNoAuth(t, "GET", "/v1/content-pages/does-not-exist", http.StatusNotFound)
}

// TestPublicContentPage_DraftReturns404 驗證 slug 存在但狀態是 draft
// (未發布)時,公開端點一樣要回 404——訪客不該看到草稿(見
// handlePublicContentPage 的完整說明)。
func TestPublicContentPage_DraftReturns404(t *testing.T) {
	f := newEntryFixture(t)
	content := map[string]any{
		"version": 1, "slug": "draft-city", "title": "草稿城市",
		"status": "draft",
		"blocks": []map[string]any{
			{"id": "b1", "kind": "paragraph", "text": "還沒發布"},
		},
	}
	if _, err := f.srv.store.CreateContentPage("", "draft-city", mustMarshalJSON(t, content), "tester"); err != nil {
		t.Fatalf("建立內容: %v", err)
	}
	f.doNoAuth(t, "GET", "/v1/content-pages/draft-city", http.StatusNotFound)
}

// TestPublicContentPage_PublishedReturnsOK 驗證 slug 存在且已發布時,
// 公開端點回 200,內容正確。
func TestPublicContentPage_PublishedReturnsOK(t *testing.T) {
	f := newEntryFixture(t)
	content := map[string]any{
		"version": 1, "slug": "published-city", "title": "已發布城市",
		"status": "draft",
		"blocks": []map[string]any{
			{"id": "b1", "kind": "paragraph", "text": "正式內容"},
		},
	}
	if _, err := f.srv.store.CreateContentPage("", "published-city", mustMarshalJSON(t, content), "tester"); err != nil {
		t.Fatalf("建立內容: %v", err)
	}
	if err := f.srv.store.SetContentPageStatus("", "published-city", "published"); err != nil {
		t.Fatalf("發布: %v", err)
	}

	public := f.doNoAuth(t, "GET", "/v1/content-pages/published-city", http.StatusOK)
	if public["slug"] != "published-city" {
		t.Fatalf("slug 不符: %v", public)
	}
	if public["status"] != "published" {
		t.Fatalf("status 應該是 published,got: %v", public)
	}
	publicContent, ok := public["content"].(map[string]any)
	if !ok || publicContent["title"] != "已發布城市" {
		t.Fatalf("content 應該展開為正確的物件,got: %v", public["content"])
	}
}

// TestPublicContentPage_固定查ownerID空字串命名空間 驗證
// handlePublicContentPage 的實際行為:它固定以 ownerID="" 查詢(見
// 該函式的完整說明,刻意不支援 official 切換),所以即使某個使用者
// 底下也用相同 slug 建立並發布了一篇內容,這支公開端點依然只看得到
// ownerID="" 命名空間下的那一筆,看不到使用者命名空間下同名 slug 的
// 那一筆——這是這支端點「只給城市介紹頁這種無作者概念內容用」的
// 既有設計,用測試把這個行為鎖住,而非假設它應該要能跨命名空間查詢。
func TestPublicContentPage_固定查ownerID空字串命名空間(t *testing.T) {
	f := newEntryFixture(t)
	user, err := f.srv.store.CreatePasswordUser("usr_author_x", "作者X", "#223344", "authorx@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}

	// 使用者命名空間下,同樣的 slug,且已發布。
	userContent := map[string]any{
		"version": 1, "slug": "shared-slug", "title": "使用者版本",
		"status": "draft",
		"blocks": []map[string]any{{"id": "b1", "kind": "paragraph", "text": "使用者寫的"}},
	}
	if _, err := f.srv.store.CreateContentPage(user.ID, "shared-slug", mustMarshalJSON(t, userContent), "tester"); err != nil {
		t.Fatalf("建立使用者內容: %v", err)
	}
	if err := f.srv.store.SetContentPageStatus(user.ID, "shared-slug", "published"); err != nil {
		t.Fatalf("發布使用者內容: %v", err)
	}

	// 這個 slug 在 ownerID="" 命名空間下根本沒有建立過,公開端點固定
	// 查 ownerID="",應該查不到剛剛建立的使用者內容,回 404。
	f.doNoAuth(t, "GET", "/v1/content-pages/shared-slug", http.StatusNotFound)

	// 現在也在 ownerID="" 命名空間建立同一個 slug 並發布——公開端點
	// 應該讀到的是這一筆(official/系統帳號命名空間),而不是使用者
	// 命名空間下的那一筆,即使兩者 slug 相同。
	officialContent := map[string]any{
		"version": 1, "slug": "shared-slug", "title": "官方版本",
		"status": "draft",
		"blocks": []map[string]any{{"id": "b1", "kind": "paragraph", "text": "官方寫的"}},
	}
	if _, err := f.srv.store.CreateContentPage("", "shared-slug", mustMarshalJSON(t, officialContent), "tester"); err != nil {
		t.Fatalf("建立官方內容: %v", err)
	}
	if err := f.srv.store.SetContentPageStatus("", "shared-slug", "published"); err != nil {
		t.Fatalf("發布官方內容: %v", err)
	}

	public := f.doNoAuth(t, "GET", "/v1/content-pages/shared-slug", http.StatusOK)
	publicContent, ok := public["content"].(map[string]any)
	if !ok || publicContent["title"] != "官方版本" {
		t.Fatalf("公開端點應該讀到官方命名空間下的內容,而非使用者命名空間,got: %v", public)
	}
}

// ---------------------------------------------------------------------
// handleMaintenanceContentPageList 獨立測試(原本只在
// TestContentPage_CRUDAndPublishFlow 中順便驗證過「有 1 筆」,沒有
// 專屬測試驗證排序與「不分 ownerID」這個刻意的設計決策)。
// ---------------------------------------------------------------------

// TestMaintenanceContentPageList_依ownerID與slug排序 驗證
// ListContentPages 的實際排序規則——依 (owner_id ASC, slug ASC) 排序
// (見 store.ListContentPages 的完整說明),不是單純依 slug 或建立時間。
func TestMaintenanceContentPageList_依ownerID與slug排序(t *testing.T) {
	f := newEntryFixture(t)
	userA, err := f.srv.store.CreatePasswordUser("usr_zzz_last", "使用者Z", "#112233", "zzz@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	userB, err := f.srv.store.CreatePasswordUser("usr_aaa_first", "使用者A", "#223344", "aaa@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}

	mk := func(ownerID, slug string) {
		c := map[string]any{"version": 1, "slug": slug, "title": slug, "status": "draft", "blocks": []map[string]any{}}
		if _, err := f.srv.store.CreateContentPage(ownerID, slug, mustMarshalJSON(t, c), "tester"); err != nil {
			t.Fatalf("建立內容(owner=%s slug=%s): %v", ownerID, slug, err)
		}
	}
	// 刻意打亂建立順序,驗證回應排序是依 (owner_id, slug),不是依
	// 建立/插入順序。
	mk("", "z-slug")
	mk(userA.ID, "b-slug")
	mk("", "a-slug")
	mk(userB.ID, "a-slug")

	listRes := f.do(t, "GET", "/internal/maintenance/content-pages", nil, http.StatusOK)
	pages, ok := listRes["contentPages"].([]any)
	if !ok || len(pages) != 4 {
		t.Fatalf("list 應該有 4 筆,got: %v", listRes)
	}
	var gotOrder [][2]string
	for _, p := range pages {
		row := p.(map[string]any)
		// ownerId 欄位是 `json:"ownerId,omitempty"`(見 model.ContentPage),
		// ownerID="" 時整個鍵在 JSON 回應裡會被省略,row["ownerId"] 讀到
		// 的是 nil,不能直接斷言成 string——用型別斷言的第二個回傳值
		// 處理「鍵不存在」等同空字串的情況。
		ownerID, _ := row["ownerId"].(string)
		gotOrder = append(gotOrder, [2]string{ownerID, row["slug"].(string)})
	}
	wantOrder := [][2]string{
		{"", "a-slug"},
		{"", "z-slug"},
		{userB.ID, "a-slug"},
		{userA.ID, "b-slug"},
	}
	for i := range wantOrder {
		if gotOrder[i] != wantOrder[i] {
			t.Fatalf("排序不符,第 %d 筆預期 %v,got %v(完整順序: %v)", i, wantOrder[i], gotOrder[i], gotOrder)
		}
	}
}

// TestMaintenanceContentPageList_不分ownerID列出全部 把
// handleMaintenanceContentPageList 開頭註解明講的刻意設計決策鎖進
// 測試:這支 list 端點不支援、也不受 official 參數影響,無論資料庫裡
// 同時有官方內容(ownerID="")跟不同使用者各自建立的內容,list 永遠
// 回傳全部,不分 ownerID——避免日後有人誤以為該比照其他端點加上
// official 篩選,不小心改壞這個既有語意。
func TestMaintenanceContentPageList_不分ownerID列出全部(t *testing.T) {
	f := newEntryFixture(t)
	userA, err := f.srv.store.CreatePasswordUser("usr_list_a", "使用者A", "#334455", "lista@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	userB, err := f.srv.store.CreatePasswordUser("usr_list_b", "使用者B", "#445566", "listb@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}

	mk := func(ownerID, slug string) {
		c := map[string]any{"version": 1, "slug": slug, "title": slug, "status": "draft", "blocks": []map[string]any{}}
		if _, err := f.srv.store.CreateContentPage(ownerID, slug, mustMarshalJSON(t, c), "tester"); err != nil {
			t.Fatalf("建立內容(owner=%s slug=%s): %v", ownerID, slug, err)
		}
	}
	mk("", "official-only")
	mk(userA.ID, "user-a-only")
	mk(userB.ID, "user-b-only")

	// 不帶 official 參數(query string 完全沒有這個鍵),list 仍應回傳
	// 全部 3 筆。
	listRes := f.do(t, "GET", "/internal/maintenance/content-pages", nil, http.StatusOK)
	pages, ok := listRes["contentPages"].([]any)
	if !ok || len(pages) != 3 {
		t.Fatalf("list 應該回傳全部 3 筆,不分 ownerID,got: %v", listRes)
	}

	// 即使明確帶 official=true/false 的 query string,list 端點本身
	// 根本沒有讀取這個參數(見 handleMaintenanceContentPageList 的
	// 實作),回應應該不受影響,一樣是全部 3 筆。
	listResOfficial := f.do(t, "GET", "/internal/maintenance/content-pages?official=true", nil, http.StatusOK)
	pagesOfficial, ok := listResOfficial["contentPages"].([]any)
	if !ok || len(pagesOfficial) != 3 {
		t.Fatalf("帶 official=true 的 list 一樣應回傳全部 3 筆,got: %v", listResOfficial)
	}
}

// ---------------------------------------------------------------------
// 核心缺口:official 旗標關閉時(使用者模式)的 ownerID 隔離行為。
// 這組測試驗證 2026-10 改名(theme_page → content_page)引入的
// ownerID 身份切換機制在「不帶 official / official=false」的預設
// 使用者模式下真的有正確生效——見 resolveContentPageOwnerID 與
// content_page.go 開頭的完整說明。
// ---------------------------------------------------------------------

// userFixtureWithToken 建立一個真實使用者並簽一把合法 JWT,回傳
// (userID, token)——用來模擬「使用者 A / B 已登入」各自獨立的身份,
// 對照 newEntryFixture 本身建立單一 owner 使用者+簽 token 的既有
// 做法(見該函式的完整說明)。
func userFixtureWithToken(t *testing.T, f *testFixture, id, name, color, email string) (userID, token string) {
	t.Helper()
	user, err := f.srv.store.CreatePasswordUser(id, name, color, email, "hash")
	if err != nil {
		t.Fatalf("建立使用者 %s: %v", id, err)
	}
	tok, err := f.srv.signer.Sign(user.ID, user.Name)
	if err != nil {
		t.Fatalf("簽 token for %s: %v", id, err)
	}
	return user.ID, tok
}

// doAs 用指定的 token(而非 f.token)發一個請求,斷言狀態碼符合預期,
// 回傳解析後的 JSON body——f.do 固定使用 f.token(fixture 的 owner
// 使用者),這裡需要能切換成「使用者 B」的 token 來模擬不同登入者。
func (f *testFixture) doAs(t *testing.T, token, method, path string, body any, wantStatus int) map[string]any {
	t.Helper()
	var r *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		r = bytes.NewReader(b)
	} else {
		r = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, r)
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	f.routes.ServeHTTP(rec, req)
	if rec.Code != wantStatus {
		t.Fatalf("%s %s → %d,預期 %d(body: %s)", method, path, rec.Code, wantStatus, rec.Body.String())
	}
	var out map[string]any
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("unmarshal body: %v, raw=%s", err, rec.Body.String())
		}
	}
	return out
}

// TestContentPage_使用者模式建立時OwnerID為登入者自己 驗證以「使用者
// A 已登入」身份呼叫建立端點、不帶 official 參數時,resolveContentPageOwnerID
// 回傳的確實是使用者 A 的 UserID,不是空字串(見該函式的完整說明)。
func TestContentPage_使用者模式建立時OwnerID為登入者自己(t *testing.T) {
	f := newEntryFixture(t)
	userAID, tokenA := userFixtureWithToken(t, f, "usr_blogger_a", "部落客A", "#556677", "bloggera@example.com")

	created := f.doAs(t, tokenA, "POST", "/internal/maintenance/content-pages", map[string]any{
		"slug": "my-trip",
		"content": map[string]any{
			"version": 1, "slug": "my-trip", "title": "我的旅程", "status": "draft",
			"blocks": []map[string]any{{"id": "b1", "kind": "paragraph", "text": "內容"}},
		},
		"updatedBy": "blogger-a",
		// 刻意不帶 official 欄位,驗證預設(使用者模式)行為。
	}, http.StatusCreated)
	if created["ownerId"] != userAID {
		t.Fatalf("使用者模式建立的內容 ownerId 應該是使用者 A 的 UserID,got: %v(userA=%s)", created["ownerId"], userAID)
	}

	// 直接查 store 二次確認,不只信任回應 body。
	page, err := f.srv.store.GetContentPageBySlug(userAID, "my-trip")
	if err != nil {
		t.Fatalf("GetContentPageBySlug: %v", err)
	}
	if page.OwnerID != userAID {
		t.Fatalf("store 裡的 OwnerID 不符,got %q,want %q", page.OwnerID, userAID)
	}
}

// TestContentPage_不同使用者可用相同slug互不衝突 驗證這次改名
// (theme_page → content_page)的核心設計目的:slug 唯一性範圍是
// 「同一個 ownerID 之內」,不同使用者可以各自用一模一樣的 slug
// (見 contentPageRow 與 CreateContentPage 的完整說明),不會回
// 409 slug_taken。
func TestContentPage_不同使用者可用相同slug互不衝突(t *testing.T) {
	f := newEntryFixture(t)
	userAID, tokenA := userFixtureWithToken(t, f, "usr_blogger_aa", "部落客AA", "#667788", "bloggeraa@example.com")
	userBID, tokenB := userFixtureWithToken(t, f, "usr_blogger_bb", "部落客BB", "#778899", "bloggerbb@example.com")

	contentFor := func(title string) map[string]any {
		return map[string]any{
			"version": 1, "slug": "my-trip", "title": title, "status": "draft",
			"blocks": []map[string]any{{"id": "b1", "kind": "paragraph", "text": title}},
		}
	}

	createdA := f.doAs(t, tokenA, "POST", "/internal/maintenance/content-pages", map[string]any{
		"slug": "my-trip", "content": contentFor("A的旅程"), "updatedBy": "blogger-a",
	}, http.StatusCreated)
	if createdA["ownerId"] != userAID {
		t.Fatalf("使用者 A 建立的內容 ownerId 不符,got: %v", createdA["ownerId"])
	}

	// 使用者 B 用一模一樣的 slug 建立,預期成功(201),不是 409。
	createdB := f.doAs(t, tokenB, "POST", "/internal/maintenance/content-pages", map[string]any{
		"slug": "my-trip", "content": contentFor("B的旅程"), "updatedBy": "blogger-b",
	}, http.StatusCreated)
	if createdB["ownerId"] != userBID {
		t.Fatalf("使用者 B 建立的內容 ownerId 不符,got: %v", createdB["ownerId"])
	}

	// 兩筆各自存在、內容互不干擾。
	pageA, err := f.srv.store.GetContentPageBySlug(userAID, "my-trip")
	if err != nil {
		t.Fatalf("查使用者 A 的內容: %v", err)
	}
	pageB, err := f.srv.store.GetContentPageBySlug(userBID, "my-trip")
	if err != nil {
		t.Fatalf("查使用者 B 的內容: %v", err)
	}
	if pageA.ID == pageB.ID {
		t.Fatalf("兩筆應該是不同記錄,got 相同 ID: %s", pageA.ID)
	}
}

// TestContentPage_使用者A無法透過相同slug動到使用者B的記錄 驗證
// ownerID 隔離在 update/publish/delete 這些「作用在既有記錄」的操作
// 上同樣確實生效——使用者 A 對「只存在於使用者 B 命名空間」的
// slug="my-trip" 發出 PUT(不帶 official),因為使用者 A 自己的
// 命名空間下根本沒有這個 slug,應該回 404,且絕對不能意外修改到
// 使用者 B 的那一筆記錄。這是驗證 ownerID 隔離是否確實生效的關鍵
// 測試。
func TestContentPage_使用者A無法透過相同slug動到使用者B的記錄(t *testing.T) {
	f := newEntryFixture(t)
	_, tokenA := userFixtureWithToken(t, f, "usr_blogger_cc", "部落客CC", "#8899AA", "bloggercc@example.com")
	userBID, tokenB := userFixtureWithToken(t, f, "usr_blogger_dd", "部落客DD", "#99AABB", "bloggerdd@example.com")

	// 只有使用者 B 建立了 slug="my-trip"。
	f.doAs(t, tokenB, "POST", "/internal/maintenance/content-pages", map[string]any{
		"slug": "my-trip",
		"content": map[string]any{
			"version": 1, "slug": "my-trip", "title": "B的原始標題", "status": "draft",
			"blocks": []map[string]any{{"id": "b1", "kind": "paragraph", "text": "B的內容"}},
		},
		"updatedBy": "blogger-b",
	}, http.StatusCreated)

	// 使用者 A 嘗試更新同樣 slug(不帶 official)——A 自己的命名空間
	// 下沒有這個 slug,應該回 404。
	f.doAs(t, tokenA, "PUT", "/internal/maintenance/content-pages/my-trip", map[string]any{
		"content": map[string]any{
			"version": 1, "slug": "my-trip", "title": "A想偷改的標題", "status": "draft",
			"blocks": []map[string]any{{"id": "b1", "kind": "paragraph", "text": "A的內容"}},
		},
		"updatedBy": "blogger-a",
	}, http.StatusNotFound)

	// 使用者 A 嘗試發布/刪除同樣 slug,預期同樣回 404。
	f.doAs(t, tokenA, "PATCH", "/internal/maintenance/content-pages/my-trip/publish", map[string]any{
		"published": true,
	}, http.StatusNotFound)
	f.doAs(t, tokenA, "DELETE", "/internal/maintenance/content-pages/my-trip", nil, http.StatusNotFound)

	// 確認使用者 B 的記錄完全沒被動到。
	pageB, err := f.srv.store.GetContentPageBySlug(userBID, "my-trip")
	if err != nil {
		t.Fatalf("使用者 B 的記錄應該還在: %v", err)
	}
	if pageB.Status != "draft" {
		t.Fatalf("使用者 B 的記錄狀態不該被 A 的 publish 呼叫動到,got status=%s", pageB.Status)
	}
	var contentObj map[string]any
	if err := json.Unmarshal([]byte(pageB.Content), &contentObj); err != nil {
		t.Fatalf("unmarshal content: %v", err)
	}
	if contentObj["title"] != "B的原始標題" {
		t.Fatalf("使用者 B 的內容不該被使用者 A 的 PUT 改到,got title=%v", contentObj["title"])
	}
}

// TestContentPage_使用者模式內容用official模式查不到 驗證使用者 A
// 用使用者模式(預設,不帶 official)建立的內容,改用 official=true
// 查詢時查不到——official 模式對應 ownerID="",使用者 A 建立的內容
// ownerID 是使用者 A 的 UserID,兩者是完全不同的命名空間(見
// resolveContentPageOwnerID 的完整說明)。
func TestContentPage_使用者模式內容用official模式查不到(t *testing.T) {
	f := newEntryFixture(t)
	_, tokenA := userFixtureWithToken(t, f, "usr_blogger_ee", "部落客EE", "#AABBCC", "bloggeree@example.com")
	// official 模式 2026-10 改成需要 email 白名單(見
	// resolveContentPageOwnerID 的完整說明)——這個測試要驗證的是「用
	// official=true 查詢時命名空間正確隔離」這件事本身,不是在測權限
	// 檢查,把使用者 A 設成白名單成員,讓第 688 行真正走到
	// GetContentPageBySlug("", "my-trip") 這條查詢邏輯、驗證查不到,而
	// 不是先被權限檢查擋成 403(那樣就測不到這個測試真正想驗證的行為)。
	f.srv.adminBootstrapEmail = "bloggeree@example.com"

	f.doAs(t, tokenA, "POST", "/internal/maintenance/content-pages", map[string]any{
		"slug": "my-trip",
		"content": map[string]any{
			"version": 1, "slug": "my-trip", "title": "使用者的旅程", "status": "draft",
			"blocks": []map[string]any{{"id": "b1", "kind": "paragraph", "text": "內容"}},
		},
		"updatedBy": "blogger-a",
	}, http.StatusCreated)

	// 用使用者 A 自己的 token,但這次帶 official=true 去查——應該
	// 查不到(因為實際存的 ownerID 是使用者 A 的 UserID,不是空字串)。
	f.doAs(t, tokenA, "GET", "/internal/maintenance/content-pages/my-trip?official=true", nil, http.StatusNotFound)

	// 直接查 store 的 ownerID="" 命名空間,二次確認根本沒有這一筆。
	if _, err := f.srv.store.GetContentPageBySlug("", "my-trip"); err == nil {
		t.Fatalf("official(空字串 ownerID)命名空間不應該有這筆記錄")
	}
}

// TestPublicBlogArticle_PublishedReturnsOK 驗證文章存在且已發布時,
// 公開端點回 200,且內容(含 content 展開後的物件、ownerId 欄位)正確
// ——這是這支新端點的 happy path,確保 handle→UserID→文章 這整條
// 查詢鏈路接起來是通的。
func TestPublicBlogArticle_PublishedReturnsOK(t *testing.T) {
	f := newEntryFixture(t)
	user, err := f.srv.store.CreatePasswordUser("usr_blogger3", "部落客3", "#556677", "blogger3@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	if _, err := f.srv.store.CreateBlogProfile(user.ID, "blogger-c", ""); err != nil {
		t.Fatalf("建立部落客設定: %v", err)
	}
	content := map[string]any{
		"version": 1, "slug": "published-post", "title": "已發布的文章",
		"status": "draft",
		"blocks": []map[string]any{
			{"id": "b1", "kind": "paragraph", "text": "正式內容"},
		},
	}
	if _, err := f.srv.store.CreateContentPage(user.ID, "published-post", mustMarshalJSON(t, content), "tester"); err != nil {
		t.Fatalf("建立文章: %v", err)
	}
	if err := f.srv.store.SetContentPageStatus(user.ID, "published-post", "published"); err != nil {
		t.Fatalf("發布文章: %v", err)
	}

	public := f.doNoAuth(t, "GET", "/v1/blog/blogger-c/published-post", http.StatusOK)
	if public["slug"] != "published-post" {
		t.Fatalf("slug 不符: %v", public)
	}
	if public["ownerId"] != user.ID {
		t.Fatalf("ownerId 應該是該作者的 UserID,got: %v", public)
	}
	if public["status"] != "published" {
		t.Fatalf("status 應該是 published,got: %v", public)
	}
	publicContent, ok := public["content"].(map[string]any)
	if !ok || publicContent["title"] != "已發布的文章" {
		t.Fatalf("content 應該展開為正確的物件,got: %v", public["content"])
	}
}

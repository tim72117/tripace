package api

// theme_page_test.go 測主題介紹頁的管理端點(/internal/maintenance/
// theme-pages/*)與公開讀取端點(/v1/theme-pages/{slug}),見
// theme_page.go 開頭的完整說明。
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

func TestThemePage_CRUDAndPublishFlow(t *testing.T) {
	f := newEntryFixture(t)

	// 1. 建立——管理端點,帶 JWT。
	content := map[string]any{
		"version": 1, "slug": "test-city", "title": "測試城市",
		"status": "draft",
		"blocks": []map[string]any{
			{"id": "b1", "kind": "paragraph", "text": "這是一段測試文案"},
		},
	}
	created := f.do(t, "POST", "/internal/maintenance/theme-pages", map[string]any{
		"slug": "test-city", "content": content, "updatedBy": "tester",
	}, http.StatusCreated)
	if created["slug"] != "test-city" {
		t.Fatalf("建立回應的 slug 不符: %v", created)
	}
	if created["status"] != "draft" {
		t.Fatalf("新建立的主題頁應該是 draft,got: %v", created["status"])
	}

	// 2. 公開端點此時應該 404——還是草稿,訪客不該看到。
	f.doNoAuth(t, "GET", "/v1/theme-pages/test-city", http.StatusNotFound)

	// 3. 管理端點 get 應該看得到(含草稿)。
	got := f.do(t, "GET", "/internal/maintenance/theme-pages/test-city", nil, http.StatusOK)
	gotContent, ok := got["content"].(map[string]any)
	if !ok {
		t.Fatalf("content 應該是展開的物件,不是字串,got %T: %v", got["content"], got["content"])
	}
	if gotContent["title"] != "測試城市" {
		t.Fatalf("內容 title 不符: %v", gotContent)
	}

	// 4. list 應該包含這一筆。
	listRes := f.do(t, "GET", "/internal/maintenance/theme-pages", nil, http.StatusOK)
	pages, ok := listRes["themePages"].([]any)
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
	f.do(t, "PUT", "/internal/maintenance/theme-pages/test-city", map[string]any{
		"content": newContent, "updatedBy": "tester2",
	}, http.StatusOK)
	got2 := f.do(t, "GET", "/internal/maintenance/theme-pages/test-city", nil, http.StatusOK)
	gotContent2 := got2["content"].(map[string]any)
	if gotContent2["title"] != "更新後的標題" {
		t.Fatalf("覆寫後的內容未反映,got: %v", gotContent2)
	}

	// 6. 發布——公開端點之後應該能讀到。
	f.do(t, "PATCH", "/internal/maintenance/theme-pages/test-city/publish", map[string]any{
		"published": true,
	}, http.StatusOK)
	public := f.doNoAuth(t, "GET", "/v1/theme-pages/test-city", http.StatusOK)
	publicContent, ok := public["content"].(map[string]any)
	if !ok || publicContent["title"] != "更新後的標題" {
		t.Fatalf("發布後公開端點應該讀到最新內容,got: %v", public)
	}

	// 7. 取消發布——公開端點應該再次 404。
	f.do(t, "PATCH", "/internal/maintenance/theme-pages/test-city/publish", map[string]any{
		"published": false,
	}, http.StatusOK)
	f.doNoAuth(t, "GET", "/v1/theme-pages/test-city", http.StatusNotFound)

	// 8. 刪除。
	f.do(t, "DELETE", "/internal/maintenance/theme-pages/test-city", nil, http.StatusOK)
	f.do(t, "GET", "/internal/maintenance/theme-pages/test-city", nil, http.StatusNotFound)
}

func TestThemePage_GetMissing(t *testing.T) {
	f := newEntryFixture(t)
	f.do(t, "GET", "/internal/maintenance/theme-pages/does-not-exist", nil, http.StatusNotFound)
}

func TestThemePage_CreateRequiresSlugAndContent(t *testing.T) {
	f := newEntryFixture(t)
	req := httptest.NewRequest("POST", "/internal/maintenance/theme-pages", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Authorization", "Bearer "+f.token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	f.routes.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("缺 slug/content 應該回 400,got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestThemePage_CreateRequiresObjectContent 驗證 content 必須是 JSON
// 物件——裸數字/字串/null 等語法合法但形狀不對的值應該被 400 擋下來,
// 不該被原樣存進資料庫(見 isJSONObject 的完整說明)。
func TestThemePage_CreateRequiresObjectContent(t *testing.T) {
	f := newEntryFixture(t)
	for _, body := range []string{
		`{"slug":"x","content":null}`,
		`{"slug":"x","content":0}`,
		`{"slug":"x","content":"not an object"}`,
		`{"slug":"x","content":[1,2,3]}`,
	} {
		req := httptest.NewRequest("POST", "/internal/maintenance/theme-pages", bytes.NewReader([]byte(body)))
		req.Header.Set("Authorization", "Bearer "+f.token)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		f.routes.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("content=%s 應該回 400,got %d: %s", body, rec.Code, rec.Body.String())
		}
	}
}

// TestThemePage_CreateDuplicateSlugConflicts 驗證重複建立同一個 slug
// 回 409(slug_taken),而不是把底層 driver 的 unique constraint 錯誤
// 字串原樣當 500 吐出去(見 store.CreateThemePage 的完整說明)。
func TestThemePage_CreateDuplicateSlugConflicts(t *testing.T) {
	f := newEntryFixture(t)
	content := map[string]any{"version": 1, "slug": "dup-city", "title": "x", "status": "draft", "blocks": []map[string]any{}}
	f.do(t, "POST", "/internal/maintenance/theme-pages", map[string]any{"slug": "dup-city", "content": content}, http.StatusCreated)
	resp := f.do(t, "POST", "/internal/maintenance/theme-pages", map[string]any{"slug": "dup-city", "content": content}, http.StatusConflict)
	errBody, ok := resp["error"].(map[string]any)
	if !ok || errBody["code"] != "slug_taken" {
		t.Fatalf("重複 slug 應該回 slug_taken 錯誤碼,got: %v", resp)
	}
}

// TestThemePage_MutateMissingSlugReturns404 驗證對不存在的 slug 做
// update/publish/delete 都正確回 404,而不是誤判成「更新/刪除成功」
// ——GORM 的 Updates()/Delete() 在 WHERE 條件沒有命中任何列時 Error
// 仍是 nil,若 store 層不額外檢查 RowsAffected,這三個操作會對一個
// 根本不存在的 slug 靜默回 200(見 store.UpdateThemePageContent/
// SetThemePageStatus/DeleteThemePage 的完整說明)。
func TestThemePage_MutateMissingSlugReturns404(t *testing.T) {
	f := newEntryFixture(t)
	content := map[string]any{"version": 1, "slug": "x", "title": "x", "status": "draft", "blocks": []map[string]any{}}

	f.do(t, "PUT", "/internal/maintenance/theme-pages/does-not-exist", map[string]any{"content": content}, http.StatusNotFound)
	f.do(t, "PATCH", "/internal/maintenance/theme-pages/does-not-exist/publish", map[string]any{"published": true}, http.StatusNotFound)
	f.do(t, "DELETE", "/internal/maintenance/theme-pages/does-not-exist", nil, http.StatusNotFound)
}

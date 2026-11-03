package api

// blog_public_test.go 測作者頁(GET /v1/blog/{handle})、部落格首頁
// (GET /v1/blog-index)、公開文章的 author/publishedAt 欄位,以及
// DELETE /v1/blog/articles/{slug},見 blog_public.go。
import (
	"net/http"
	"testing"
	"time"
)

// seedBlogger 建立使用者 + profile,並回傳 userID。
func seedBlogger(t *testing.T, f *testFixture, id, handle, avatar string) string {
	t.Helper()
	u, err := f.srv.store.CreatePasswordUser(id, handle, "#112233", id+"@example.com", "hash")
	if err != nil {
		t.Fatalf("建立使用者: %v", err)
	}
	if _, err := f.srv.store.CreateBlogProfile(u.ID, handle, avatar); err != nil {
		t.Fatalf("建立 profile: %v", err)
	}
	return u.ID
}

func seedArticle(t *testing.T, f *testFixture, owner, slug string, content map[string]any, publish bool) {
	t.Helper()
	if content["title"] == nil {
		content["title"] = "標題-" + slug
	}
	if _, err := f.srv.store.CreateContentPage(owner, slug, mustMarshalJSON(t, content), owner); err != nil {
		t.Fatalf("建立文章: %v", err)
	}
	if publish {
		if err := f.srv.store.SetContentPageStatus(owner, slug, "published"); err != nil {
			t.Fatalf("發布: %v", err)
		}
	}
}

func ptrTime(t time.Time) *time.Time { return &t }

func TestPublicBlogArticle_保有原欄位且多了author與publishedAt(t *testing.T) {
	f := newEntryFixture(t)
	uid := seedBlogger(t, f, "usr_pa", "pa-handle", "https://img.example/a.png")
	seedArticle(t, f, uid, "post", map[string]any{"blocks": []any{}}, true)

	got := f.doNoAuth(t, "GET", "/v1/blog/pa-handle/post", http.StatusOK)
	for _, k := range []string{"id", "ownerId", "slug", "title", "content", "status", "createdAt", "updatedAt"} {
		if _, ok := got[k]; !ok {
			t.Errorf("缺少原有欄位 %q: %v", k, got)
		}
	}
	author, ok := got["author"].(map[string]any)
	if !ok || author["handle"] != "pa-handle" || author["avatarUrl"] != "https://img.example/a.png" {
		t.Fatalf("author 不符: %v", got["author"])
	}
	if _, err := time.Parse(time.RFC3339, got["publishedAt"].(string)); err != nil {
		t.Fatalf("publishedAt 不是 RFC3339: %v", got["publishedAt"])
	}
}

func TestPublicBlogArticle_無頭像時author省略avatarUrl(t *testing.T) {
	f := newEntryFixture(t)
	uid := seedBlogger(t, f, "usr_na", "na-handle", "")
	seedArticle(t, f, uid, "post", map[string]any{}, true)
	got := f.doNoAuth(t, "GET", "/v1/blog/na-handle/post", http.StatusOK)
	author := got["author"].(map[string]any)
	if _, has := author["avatarUrl"]; has {
		t.Fatalf("avatarUrl 空字串時應省略: %v", author)
	}
}

func TestPublicBlogArticle_舊資料publishedAt為null退回createdAt(t *testing.T) {
	f := newEntryFixture(t)
	uid := seedBlogger(t, f, "usr_old", "old-handle", "")
	seedArticle(t, f, uid, "post", map[string]any{}, true)
	f.srv.store.SetContentPagePublishedAtForTest(uid, "post", nil)
	got := f.doNoAuth(t, "GET", "/v1/blog/old-handle/post", http.StatusOK)
	p, _ := time.Parse(time.RFC3339, got["publishedAt"].(string))
	c, _ := time.Parse(time.RFC3339, got["createdAt"].(string))
	if !p.Truncate(time.Second).Equal(c.Truncate(time.Second)) {
		t.Fatalf("publishedAt 應退回 createdAt: %v vs %v", got["publishedAt"], got["createdAt"])
	}
}

func TestPublicBlogAuthor(t *testing.T) {
	f := newEntryFixture(t)
	uid := seedBlogger(t, f, "usr_au", "au-handle", "")
	seedArticle(t, f, uid, "older", map[string]any{"lede": "前言", "heroPhotoId": "upf_x"}, true)
	seedArticle(t, f, uid, "newer", map[string]any{}, true)
	seedArticle(t, f, uid, "draft", map[string]any{}, false)
	f.srv.store.SetContentPagePublishedAtForTest(uid, "older", ptrTime(time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)))
	f.srv.store.SetContentPagePublishedAtForTest(uid, "newer", ptrTime(time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)))

	got := f.doNoAuth(t, "GET", "/v1/blog/au-handle", http.StatusOK)
	if got["author"].(map[string]any)["handle"] != "au-handle" {
		t.Fatalf("author 不符: %v", got)
	}
	arts := got["articles"].([]any)
	if len(arts) != 2 {
		t.Fatalf("草稿不該出現,應只有 2 篇,got %v", arts)
	}
	first, second := arts[0].(map[string]any), arts[1].(map[string]any)
	if first["slug"] != "newer" || second["slug"] != "older" {
		t.Fatalf("應新到舊: %v", arts)
	}
	if second["lede"] != "前言" || second["heroPhotoId"] != "upf_x" || second["publishedAt"] != "2024-01-01T00:00:00Z" {
		t.Fatalf("摘要欄位不符: %v", second)
	}
	if _, has := first["lede"]; has {
		t.Fatalf("沒有 lede 應省略 key: %v", first)
	}
}

func TestPublicBlogAuthor_無已發布文章回空陣列(t *testing.T) {
	f := newEntryFixture(t)
	uid := seedBlogger(t, f, "usr_em", "em-handle", "")
	seedArticle(t, f, uid, "draft", map[string]any{}, false)
	got := f.doNoAuth(t, "GET", "/v1/blog/em-handle", http.StatusOK)
	arts, ok := got["articles"].([]any)
	if !ok || len(arts) != 0 {
		t.Fatalf("應為空陣列而非 null: %v", got["articles"])
	}
}

func TestPublicBlogAuthor_handle不存在回404(t *testing.T) {
	f := newEntryFixture(t)
	f.doNoAuth(t, "GET", "/v1/blog/nobody", http.StatusNotFound)
}

func TestPublicBlogIndex(t *testing.T) {
	f := newEntryFixture(t)
	a := seedBlogger(t, f, "usr_ia", "ia", "https://img.example/ia.png")
	b := seedBlogger(t, f, "usr_ib", "ib", "")
	seedArticle(t, f, a, "a1", map[string]any{"lede": "L"}, true)
	seedArticle(t, f, b, "b1", map[string]any{}, true)
	seedArticle(t, f, b, "b-draft", map[string]any{}, false)
	// 沒有 profile 的 owner 的已發布文章不該出現。
	seedArticle(t, f, "usr_noprofile", "orphan", map[string]any{}, true)
	f.srv.store.SetContentPagePublishedAtForTest(a, "a1", ptrTime(time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)))
	f.srv.store.SetContentPagePublishedAtForTest(b, "b1", ptrTime(time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)))

	got := f.doNoAuth(t, "GET", "/v1/blog-index", http.StatusOK)
	arts := got["articles"].([]any)
	if len(arts) != 2 {
		t.Fatalf("應只有 2 篇,got %v", arts)
	}
	first, second := arts[0].(map[string]any), arts[1].(map[string]any)
	if first["slug"] != "b1" || first["handle"] != "ib" || second["slug"] != "a1" {
		t.Fatalf("順序/作者不符: %v", arts)
	}
	if _, has := first["avatarUrl"]; has {
		t.Fatalf("無頭像應省略: %v", first)
	}
	if second["avatarUrl"] != "https://img.example/ia.png" || second["lede"] != "L" {
		t.Fatalf("欄位不符: %v", second)
	}

	// limit 與非法值。
	if n := len(f.doNoAuth(t, "GET", "/v1/blog-index?limit=1", http.StatusOK)["articles"].([]any)); n != 1 {
		t.Fatalf("limit=1 應回 1 篇,got %d", n)
	}
	for _, q := range []string{"limit=abc", "limit=0", "limit=-3", "limit=1000"} {
		if n := len(f.doNoAuth(t, "GET", "/v1/blog-index?"+q, http.StatusOK)["articles"].([]any)); n != 2 {
			t.Fatalf("%s 應用預設值回 2 篇,got %d", q, n)
		}
	}
}

func TestPublicBlogIndex_空結果回空陣列(t *testing.T) {
	f := newEntryFixture(t)
	got := f.doNoAuth(t, "GET", "/v1/blog-index", http.StatusOK)
	arts, ok := got["articles"].([]any)
	if !ok || len(arts) != 0 {
		t.Fatalf("應為空陣列而非 null: %v", got["articles"])
	}
}

func TestMyContentPageDelete(t *testing.T) {
	f := newEntryFixture(t)
	// fixture 的登入者是 usr_owner。
	seedArticle(t, f, "usr_owner", "mine", map[string]any{}, false)
	other := seedBlogger(t, f, "usr_other", "other", "")
	seedArticle(t, f, other, "theirs", map[string]any{}, true)

	// 未登入。
	f.doNoAuth(t, "DELETE", "/v1/blog/articles/mine", http.StatusUnauthorized)

	// 刪別人的文章:404,且對方文章仍在。
	f.do(t, "DELETE", "/v1/blog/articles/theirs", nil, http.StatusNotFound)
	f.doNoAuth(t, "GET", "/v1/blog/other/theirs", http.StatusOK)

	// 刪自己的。
	got := f.do(t, "DELETE", "/v1/blog/articles/mine", nil, http.StatusOK)
	if got["status"] != "deleted" {
		t.Fatalf("回應不符: %v", got)
	}
	// 再刪一次 404。
	f.do(t, "DELETE", "/v1/blog/articles/mine", nil, http.StatusNotFound)
}

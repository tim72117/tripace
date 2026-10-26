package main

import (
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/store"
)

const baseSitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://tripace.io/</loc>
  </url>
</urlset>
`

func pub(slug string, updated time.Time) model.ItineraryPage {
	return model.ItineraryPage{Slug: slug, Status: "published", UpdatedAt: updated}
}

func TestInjectItinerarySitemapURLs_AddsPublishedBeforeUrlsetEnd(t *testing.T) {
	out := string(injectItinerarySitemapURLs([]byte(baseSitemap), "https://tripace.io",
		[]model.ItineraryPage{pub("jozankei-1day", time.Date(2026, 10, 14, 8, 0, 0, 0, time.UTC))}))
	if !strings.Contains(out, "<loc>https://tripace.io/itineraries/jozankei-1day</loc>") {
		t.Fatalf("沒有補上已發佈行程:\n%s", out)
	}
	if !strings.Contains(out, "<lastmod>2026-10-14</lastmod>") {
		t.Error("lastmod 應該是行程最後更新日(YYYY-MM-DD)")
	}
	if !strings.HasSuffix(strings.TrimSpace(out), "</urlset>") {
		t.Error("補上的 <url> 必須在 </urlset> 之前,檔案仍要以 </urlset> 結尾")
	}
	if strings.Count(out, "<urlset") != 1 || strings.Count(out, "</urlset>") != 1 {
		t.Error("不應該重複根元素")
	}
}

func TestInjectItinerarySitemapURLs_SkipsDraftEmptySlugAndDuplicates(t *testing.T) {
	pages := []model.ItineraryPage{
		{Slug: "draft-one", Status: "draft"},
		{Slug: "", Status: "published"},
		pub("a", time.Time{}),
		pub("a", time.Time{}), // 重複 slug
	}
	out := string(injectItinerarySitemapURLs([]byte(baseSitemap), "https://tripace.io", pages))
	if strings.Contains(out, "draft-one") {
		t.Error("草稿不應該列進 sitemap")
	}
	if strings.Count(out, "/itineraries/a</loc>") != 1 {
		t.Errorf("重複的 slug 只能出現一次:\n%s", out)
	}
	if strings.Contains(out, "<lastmod></lastmod>") {
		t.Error("沒有更新時間時不應該輸出空的 lastmod")
	}
}

func TestInjectItinerarySitemapURLs_EscapesAndNoOps(t *testing.T) {
	out := string(injectItinerarySitemapURLs([]byte(baseSitemap), "https://tripace.io", []model.ItineraryPage{pub("a&b c", time.Time{})}))
	if !strings.Contains(out, "<loc>https://tripace.io/itineraries/a&amp;b%20c</loc>") {
		t.Errorf("slug 要 URL 編碼並做 XML 跳脫:\n%s", out)
	}
	// 沒有可補的、沒有 </urlset>:原樣回傳
	if got := string(injectItinerarySitemapURLs([]byte(baseSitemap), "https://tripace.io", nil)); got != baseSitemap {
		t.Error("沒有行程時應原樣回傳")
	}
	bad := "<not-a-sitemap/>"
	if got := string(injectItinerarySitemapURLs([]byte(bad), "https://tripace.io", []model.ItineraryPage{pub("x", time.Time{})})); got != bad {
		t.Error("找不到 </urlset> 時應原樣回傳,不能破壞檔案")
	}
	// 已經在靜態檔裡的 loc 不重複加入
	static := strings.Replace(baseSitemap, "</urlset>", "  <url><loc>https://tripace.io/itineraries/x</loc></url>\n</urlset>", 1)
	if got := string(injectItinerarySitemapURLs([]byte(static), "https://tripace.io", []model.ItineraryPage{pub("x", time.Time{})})); got != static {
		t.Error("靜態檔已有的 loc 不應重複加入")
	}
}

func TestServeSitemap_StaticFileWithPublishedItinerariesFromDB(t *testing.T) {
	st := store.OpenTest(t)
	if _, err := st.CreateItineraryPage("", "published-trip", `{"title":"t"}`, "test"); err != nil {
		t.Fatal(err)
	}
	if err := st.SetItineraryPageStatus("", "published-trip", "published"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateItineraryPage("", "draft-trip", `{"title":"d"}`, "test"); err != nil {
		t.Fatal(err)
	}
	sub := fstest.MapFS{"sitemap.xml": {Data: []byte(baseSitemap)}}

	rec := httptest.NewRecorder()
	if !serveSitemap(rec, sub, st) {
		t.Fatal("有內嵌 sitemap.xml 時應該處理這個請求")
	}
	body := rec.Body.String()
	if !strings.Contains(body, "/itineraries/published-trip</loc>") {
		t.Errorf("資料庫裡已發佈的行程要出現:\n%s", body)
	}
	if strings.Contains(body, "draft-trip") {
		t.Error("草稿不應該出現")
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/xml") {
		t.Errorf("Content-Type 應為 application/xml,實際 %q", ct)
	}
	if rec.Header().Get("Cache-Control") == "" {
		t.Error("應該有 Cache-Control(行程會隨時發佈/下架,不要快取太久)")
	}
}

func TestServeSitemap_NilStoreAndMissingFile(t *testing.T) {
	sub := fstest.MapFS{"sitemap.xml": {Data: []byte(baseSitemap)}}
	rec := httptest.NewRecorder()
	if !serveSitemap(rec, sub, nil) || rec.Body.String() != baseSitemap {
		t.Error("沒有資料庫時應原樣回傳靜態 sitemap")
	}
	rec2 := httptest.NewRecorder()
	if serveSitemap(rec2, fstest.MapFS{}, nil) {
		t.Error("內嵌檔案不存在(開發機 placeholder)時不應該處理,讓呼叫端走原本流程")
	}
}

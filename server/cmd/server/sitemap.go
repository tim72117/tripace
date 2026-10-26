package main

import (
	"bytes"
	"encoding/xml"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/store"
)

// sitemap.go——動態補上 sitemap.xml 的「精選行程詳情頁」(/itineraries/{slug})。
//
// 靜態部分(web/public/sitemap.xml,打包後內嵌)列的是固定路由,包含 /itineraries 清單頁。
// 行程詳情頁是資料庫裡「已發佈」的內容,會隨時新增或下架,不能手寫進靜態檔:這裡在回應 /sitemap.xml 時,
// 從資料庫讀已發佈的行程,把對應的 <url> 補進 </urlset> 之前。
//
// 只列資料庫已發佈的行程:前端另有 16 份靜態範例行程檔(web/src/itineraries/example/),伺服器端不知道它們,
// 而且它們沒有專屬的 SEO meta(itineraryPageSEOMeta 只認資料庫裡已發佈的),所以不列進 sitemap。
// 資料庫讀取失敗時退回靜態 sitemap(不讓 sitemap 整個壞掉)。

// injectItinerarySitemapURLs 把已發佈行程的 <url> 補進 sitemap。回傳新的 XML;
// 沒有可補的、或找不到 </urlset> 時原樣回傳。已經存在的 <loc> 不會重複加入。
func injectItinerarySitemapURLs(sitemap []byte, baseURL string, pages []model.ItineraryPage) []byte {
	end := bytes.LastIndex(sitemap, []byte("</urlset>"))
	if end < 0 {
		return sitemap
	}
	var buf bytes.Buffer
	seen := map[string]bool{}
	for _, p := range pages {
		if p.Status != "published" || p.Slug == "" {
			continue
		}
		loc := baseURL + "/itineraries/" + url.PathEscape(p.Slug)
		if seen[loc] || bytes.Contains(sitemap, []byte("<loc>"+xmlEscape(loc)+"</loc>")) {
			continue
		}
		seen[loc] = true
		buf.WriteString("  <url>\n    <loc>" + xmlEscape(loc) + "</loc>\n")
		if !p.UpdatedAt.IsZero() {
			buf.WriteString("    <lastmod>" + p.UpdatedAt.UTC().Format("2006-01-02") + "</lastmod>\n")
		}
		buf.WriteString("    <changefreq>monthly</changefreq>\n    <priority>0.5</priority>\n  </url>\n")
	}
	if buf.Len() == 0 {
		return sitemap
	}
	out := make([]byte, 0, len(sitemap)+buf.Len())
	out = append(out, sitemap[:end]...)
	out = append(out, buf.Bytes()...)
	out = append(out, sitemap[end:]...)
	return out
}

func xmlEscape(s string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

// serveSitemap 回應 /sitemap.xml:讀內嵌的靜態檔,再補上資料庫裡已發佈的行程詳情頁。
// 回傳 false 表示沒有處理(內嵌檔案不存在,例如開發機的 placeholder 目錄),呼叫端走原本的流程。
func serveSitemap(w http.ResponseWriter, sub fs.FS, st *store.Store) bool {
	data, err := fs.ReadFile(sub, "sitemap.xml")
	if err != nil {
		return false
	}
	if st != nil {
		pages, err := st.ListItineraryPages()
		if err != nil {
			log.Printf("sitemap: 讀取已發佈行程失敗,退回靜態 sitemap: %v", err)
		} else {
			data = injectItinerarySitemapURLs(data, siteBaseURL(), pages)
		}
	}
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	// 行程可能隨時發佈或下架,不要讓 CDN/瀏覽器快取太久
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = w.Write(data)
	return true
}

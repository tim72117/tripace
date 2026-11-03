// blog_public.go——部落格的公開讀取端點(作者頁、首頁、文章回應的作者資訊)
// 與「刪除我的文章」。
//
// 公開端點全部免登入、只輸出 status=published 的文章;發布時間一律用
// model.ContentPage.EffectivePublishedAt(published_at 為 null 的舊資料
// 退回 created_at)。
package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/store"
)

const (
	blogIndexDefaultLimit = 30
	blogIndexMaxLimit     = 100
)

// blogAuthorJSON 是公開回應裡的作者資訊;avatarUrl 空字串時省略 key。
type blogAuthorJSON struct {
	Handle    string `json:"handle"`
	AvatarURL string `json:"avatarUrl,omitempty"`
}

func authorOf(p model.BlogProfile) blogAuthorJSON {
	return blogAuthorJSON{Handle: p.Handle, AvatarURL: p.AvatarURL}
}

// blogArticleSummary 是作者頁的文章摘要。
type blogArticleSummary struct {
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Lede        string `json:"lede,omitempty"`
	HeroPhotoID string `json:"heroPhotoId,omitempty"`
	PublishedAt string `json:"publishedAt"`
}

// blogIndexItem 是首頁的文章摘要:摘要欄位加上作者。
type blogIndexItem struct {
	Handle    string `json:"handle"`
	AvatarURL string `json:"avatarUrl,omitempty"`
	blogArticleSummary
}

// summarizeBlogArticle 從文章 Content JSON 抽 lede/heroPhotoId。後端對
// content 內部結構不做完整解析(見 contentPageRow 說明),這裡只讀兩個
// 頂層字串欄位;解析失敗或欄位缺漏就省略,不讓列表因單篇內容異常而失敗。
func summarizeBlogArticle(p model.ContentPage) blogArticleSummary {
	var parsed struct {
		Lede        string `json:"lede"`
		HeroPhotoID string `json:"heroPhotoId"`
	}
	_ = json.Unmarshal([]byte(p.Content), &parsed)
	return blogArticleSummary{
		Slug:        p.Slug,
		Title:       p.Title,
		Lede:        parsed.Lede,
		HeroPhotoID: parsed.HeroPhotoID,
		PublishedAt: p.EffectivePublishedAt().UTC().Format(time.RFC3339),
	}
}

// GET /v1/blog/{handle}——作者頁:作者資訊加上已發布文章(新到舊)。
// 與 /v1/blog/profile、/v1/blog/articles、/v1/blog/photos 字面路由並存,
// Go 的 mux 以較具體的字面路徑優先,所以這些字詞不能當 handle(見
// validateBlogProfileHandle)。
func (s *Server) handlePublicBlogAuthor(w http.ResponseWriter, r *http.Request) {
	profile, err := s.store.GetBlogProfileByHandle(r.PathValue("handle"))
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not_found", "找不到此作者")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	pages, err := s.store.ListPublishedContentPagesByOwner(profile.UserID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	// 空陣列而非 null,前端不用處理 null。
	articles := make([]blogArticleSummary, 0, len(pages))
	for _, p := range pages {
		articles = append(articles, summarizeBlogArticle(p))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"author":   authorOf(profile),
		"articles": articles,
	})
}

// GET /v1/blog-index?limit=N——部落格首頁:跨作者的最新已發布文章。
// limit 預設 30、最大 100,非法值(非數字、<=0、超過上限)用預設值。
func (s *Server) handlePublicBlogIndex(w http.ResponseWriter, r *http.Request) {
	limit := blogIndexDefaultLimit
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 && n <= blogIndexMaxLimit {
		limit = n
	}
	pages, err := s.store.ListPublishedBlogContentPages(limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	// 一次把需要的作者查齊,避免每篇文章各查一次 profile。
	profiles := map[string]model.BlogProfile{}
	articles := make([]blogIndexItem, 0, len(pages))
	for _, p := range pages {
		prof, ok := profiles[p.OwnerID]
		if !ok {
			prof, err = s.store.GetBlogProfileByUserID(p.OwnerID)
			if err != nil {
				// profile 在查詢之間被刪等極端競態:略過這篇即可。
				if errors.Is(err, store.ErrNotFound) {
					continue
				}
				writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
				return
			}
			profiles[p.OwnerID] = prof
		}
		articles = append(articles, blogIndexItem{
			Handle:             prof.Handle,
			AvatarURL:          prof.AvatarURL,
			blogArticleSummary: summarizeBlogArticle(p),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"articles": articles})
}

// DELETE /v1/blog/articles/{slug}——刪除登入者自己名下的文章。ownerID
// 固定取自登入身分,別人的 slug 查不到就是 404(不洩漏其存在)。
func (s *Server) handleMyContentPageDelete(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireRealUser(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "請先登入")
		return
	}
	if err := s.store.DeleteContentPage(user.ID, r.PathValue("slug")); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "not_found", "找不到此文章")
			return
		}
		writeErr(w, http.StatusInternalServerError, "delete_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// 範例行程內容(/internal/maintenance/itinerary-pages/* 管理端點、
// /v1/itinerary-pages/{slug} 公開讀取端點)——對應「AI 排過的主題行程
// 展示」構想,取代原本寫死在 web/src/itineraries/example/*.ts
// 的範例行程檔案。設計完全比照 content_page.go,見該檔開頭的完整說明
// ——同一套 CLI 發布模式,不是重新發明一套。
//
// 跟 content_page.go 的關鍵差異:這裡沒有「official vs 使用者自己」的
// 雙重身份切換——範例行程目前只有官方發布一種情境(沒有使用者自己發布
// 行程的概念,對齊 itineraryPageRow 的完整說明),所以管理端點固定要求
// 呼叫者是管理員(email 在 adminBootstrapEmail 白名單內),不需要像
// resolveContentPageOwnerID 那樣依請求 body 的 official 旗標動態決定
// ownerID——這裡永遠是空字串(官方命名空間)。
//
// Content 欄位(整份行程 JSON,含 title/region/days/stops 等)由前端
// 定義格式,後端全程原樣存取轉發,不解析/不驗證內部結構,對齊
// content_page.go 的既有不驗證慣例。
package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/tim72117/tripace/internal/adminidentity"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/store"
)

// requireItineraryPageAdmin 確認目前呼叫者是真實登入使用者且 email 在
// adminBootstrapEmail 白名單內——範例行程管理端點永遠只服務官方命名空間
// (ownerID=""),不像 content-page 有「使用者自己發文」這個情境需要
// 區分,所以直接把「是不是管理員」當成唯一的存取條件,理由同
// resolveContentPageOwnerID 的 official 分支:任何已登入使用者都不該
// 能寫入/刪除官方範例行程,只有白名單內的管理員可以。
func (s *Server) requireItineraryPageAdmin(r *http.Request) bool {
	user, ok := s.requireRealUser(r)
	if !ok {
		return false
	}
	email, err := s.store.GetUserEmail(user.ID)
	if err != nil {
		return false
	}
	return adminidentity.IsAdminEmail(email, s.adminBootstrapEmail)
}

// POST /internal/maintenance/itinerary-pages
//
// body: { "slug": "tainan-chikan-2day", "content": {...行程 JSON},
//         "updatedBy": "選填,操作者識別" }
//
// content 直接收巢狀 JSON 物件(而非字串),這裡重新 Marshal 回字串存
// 進資料庫,理由同 handleMaintenanceContentPageCreate 的完整說明。
func (s *Server) handleMaintenanceItineraryPageCreate(w http.ResponseWriter, r *http.Request) {
	if !s.requireItineraryPageAdmin(r) {
		writeErr(w, http.StatusForbidden, "forbidden", "沒有管理範例行程的權限")
		return
	}
	var body struct {
		Slug      string          `json:"slug"`
		Content   json.RawMessage `json:"content"`
		UpdatedBy string          `json:"updatedBy,omitempty"`
	}
	if !decode(w, r, &body) {
		return
	}
	slug := strings.TrimSpace(body.Slug)
	if slug == "" || !isJSONObject(body.Content) {
		writeErr(w, http.StatusBadRequest, "invalid_input", "slug 為必填,content 必須是 JSON 物件")
		return
	}
	res, err := s.store.CreateItineraryPage("", slug, string(body.Content), body.UpdatedBy)
	if errors.Is(err, store.ErrAlreadyExists) {
		writeErr(w, http.StatusConflict, "slug_taken", "此 slug 已存在,請改用 itinerary-page set 更新內容")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "create_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, res)
}

// GET /internal/maintenance/itinerary-pages
//
// 回傳全部範例行程(含 draft),供 CLI itinerary-page list 使用——管理
// 端點不分 draft/published,理由同 handleMaintenanceContentPageList。
func (s *Server) handleMaintenanceItineraryPageList(w http.ResponseWriter, r *http.Request) {
	if !s.requireItineraryPageAdmin(r) {
		writeErr(w, http.StatusForbidden, "forbidden", "沒有管理範例行程的權限")
		return
	}
	pages, err := s.store.ListItineraryPages()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"itineraryPages": pages})
}

// GET /internal/maintenance/itinerary-pages/{slug}
//
// 供 CLI itinerary-page get 使用——管理端點不分 draft/published,查詢的
// 是這個 slug 目前實際存的內容(可能是還在編輯中的草稿)。
func (s *Server) handleMaintenanceItineraryPageGet(w http.ResponseWriter, r *http.Request) {
	if !s.requireItineraryPageAdmin(r) {
		writeErr(w, http.StatusForbidden, "forbidden", "沒有管理範例行程的權限")
		return
	}
	slug := r.PathValue("slug")
	page, err := s.store.GetItineraryPageBySlug("", slug)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not_found", "找不到此範例行程")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// PUT /internal/maintenance/itinerary-pages/{slug}
//
// body: { "content": {...行程 JSON}, "updatedBy": "選填" }
//
// 整份覆寫 content,不是欄位級 patch,理由同
// handleMaintenanceContentPageUpdate 的完整說明。不動 status,發布狀態
// 透過獨立的 handleMaintenanceItineraryPagePublish 切換。
func (s *Server) handleMaintenanceItineraryPageUpdate(w http.ResponseWriter, r *http.Request) {
	if !s.requireItineraryPageAdmin(r) {
		writeErr(w, http.StatusForbidden, "forbidden", "沒有管理範例行程的權限")
		return
	}
	slug := r.PathValue("slug")
	var body struct {
		Content   json.RawMessage `json:"content"`
		UpdatedBy string          `json:"updatedBy,omitempty"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !isJSONObject(body.Content) {
		writeErr(w, http.StatusBadRequest, "invalid_input", "content 必須是 JSON 物件")
		return
	}
	if err := s.store.UpdateItineraryPageContent("", slug, string(body.Content), body.UpdatedBy); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "not_found", "找不到此範例行程")
			return
		}
		writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// PATCH /internal/maintenance/itinerary-pages/{slug}/publish
//
// body: { "published": true|false }
//
// 切換發布狀態,理由同 handleMaintenanceContentPagePublish 的完整說明
// ——合併成一支端點收 bool 參數,而非 publish/unpublish 兩支獨立端點。
func (s *Server) handleMaintenanceItineraryPagePublish(w http.ResponseWriter, r *http.Request) {
	if !s.requireItineraryPageAdmin(r) {
		writeErr(w, http.StatusForbidden, "forbidden", "沒有管理範例行程的權限")
		return
	}
	slug := r.PathValue("slug")
	var body struct {
		Published bool `json:"published"`
	}
	if !decode(w, r, &body) {
		return
	}
	status := "draft"
	if body.Published {
		status = "published"
	}
	if err := s.store.SetItineraryPageStatus("", slug, status); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "not_found", "找不到此範例行程")
			return
		}
		writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": status})
}

// DELETE /internal/maintenance/itinerary-pages/{slug}
func (s *Server) handleMaintenanceItineraryPageDelete(w http.ResponseWriter, r *http.Request) {
	if !s.requireItineraryPageAdmin(r) {
		writeErr(w, http.StatusForbidden, "forbidden", "沒有管理範例行程的權限")
		return
	}
	slug := r.PathValue("slug")
	if err := s.store.DeleteItineraryPage("", slug); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "not_found", "找不到此範例行程")
			return
		}
		writeErr(w, http.StatusInternalServerError, "delete_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// GET /v1/itinerary-pages/{slug} — 公開讀取端點,無需登入。
//
// 只回傳 status == "published" 的內容,理由同 handlePublicContentPage
// 的完整說明——草稿即使資料庫裡已經存在,對未登入的一般訪客也視為
// 不存在,回 404。固定用 ownerID=""(範例行程目前只有官方命名空間)。
func (s *Server) handlePublicItineraryPage(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	page, err := s.store.GetItineraryPageBySlug("", slug)
	if errors.Is(err, store.ErrNotFound) || (err == nil && page.Status != "published") {
		writeErr(w, http.StatusNotFound, "not_found", "找不到此範例行程")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// GET /v1/itinerary-pages — 公開讀取端點,無需登入,列出全部已發布的
// 範例行程(供 /itineraries 清單頁使用)。跟上面單筆查詢的
// handlePublicItineraryPage 不同,這裡只回傳 status == "published" 的
// 子集,不像管理端點 handleMaintenanceItineraryPageList 回傳全部
// (含 draft)——訪客不該看到還在編輯中的草稿行程。
func (s *Server) handlePublicItineraryPageList(w http.ResponseWriter, r *http.Request) {
	pages, err := s.store.ListItineraryPages()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	published := make([]model.ItineraryPage, 0, len(pages))
	for _, p := range pages {
		if p.Status == "published" {
			published = append(published, p)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"itineraryPages": published})
}

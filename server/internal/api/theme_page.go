// 主題介紹頁(/internal/maintenance/theme-pages/* 管理端點、
// /v1/theme-pages/{slug} 公開讀取端點)——見 docs/
// refactor-theme-page-content-cms-plan-2026-10.md、
// web/src/themepage/types.ts 的 ThemePageContent。
//
// 管理端點獨立放在 /internal/maintenance/theme-pages/*,不是
// /internal/geo/* 或其他既有命名空間——理由同 maintenance.go 開頭的
// 既有說明:這是只給 tripace-cli 用的低頻、人工觸發操作,跟前端會
// 實際打的端點分開命名空間,方便從請求統計辨識流量來源。公開讀取端點
// 放在 /v1/*,不經過 internalAuth(見 api.go 路由註冊)——這是城市
// 主題介紹頁(九份/京都/台南等)本身的公開頁面會打的端點,訪客不需要
// 登入就能看到已發布的內容,對齊 handlePublicView(public_link.go)
// 「公開分享頁免登入」的既有模式。
//
// Content 欄位(整份 ThemePageContent JSON)由前端定義格式,後端全程
// 原樣存取轉發,不解析/不驗證 blocks 內部結構——驗證 JSON 語法合法性
// 是這裡唯一做的檢查(decode 階段),blocks 陣列裡每個 kind 各自要填
// 哪些欄位,是前端 TypeScript 型別與 CLI 編輯流程的責任,不是後端
// 業務邏輯要介入的地方(對齊 entryRow.Detail 對 Entry.Detail 的既有
// 不驗證慣例)。
package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/tim72117/tripace/internal/store"
)

// isJSONObject 判斷 raw 是否為 JSON 物件({...}),而非裸數字/字串/布林/
// null/陣列——content 欄位只接受物件形狀(對應 ThemePageContent),
// len(body.Content) == 0 這個檢查只能擋掉完全沒帶欄位的情況,不會擋
// 像 `"content": null`、`"content": 0`、`"content": "x"` 這種語法上
// 合法、但不是物件的 JSON 值,那些值會被原樣存進資料庫,公開端點
// 之後吐出 "content": null 給任何預期拿到 ThemePageContent 物件的
// 消費端,導致下游直接壞掉。這裡只檢查最外層是不是物件,不深入驗證
// blocks 內部結構(理由見本檔開頭說明:內部結構驗證是前端/CLI 的
// 責任,不是後端業務邏輯要介入的地方)。
func isJSONObject(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) > 0 && trimmed[0] == '{'
}

// POST /internal/maintenance/theme-pages
//
// body: { "slug": "tainan-chikan", "content": {...ThemePageContent},
//         "updatedBy": "選填,操作者識別" }
//
// content 直接收巢狀 JSON 物件(而非字串),這裡重新 Marshal 回字串存
// 進資料庫——比起要求呼叫端先把內容字串化再傳(容易漏做/多做一次
// 轉義出錯),讓 CLI 端可以直接把解析好的 JSON 物件塞進 request body,
// 跟 GET 回應的形狀（content 是物件,不是字串）對稱,CLI 實作時
// 不需要為「讀」跟「寫」兩個方向各自處理不同的字串/物件轉換。
func (s *Server) handleMaintenanceThemePageCreate(w http.ResponseWriter, r *http.Request) {
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
	res, err := s.store.CreateThemePage(slug, string(body.Content), body.UpdatedBy)
	if errors.Is(err, store.ErrAlreadyExists) {
		writeErr(w, http.StatusConflict, "slug_taken", "此 slug 已存在,請改用 theme-page set 更新內容")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "create_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, res)
}

// GET /internal/maintenance/theme-pages
//
// 回傳全部主題介紹頁(含 draft),供 CLI theme-page list 使用——管理端點
// 不分 draft/published,管理者需要看到草稿才能決定要不要 publish(見
// store.ListThemePages 的完整說明)。
func (s *Server) handleMaintenanceThemePageList(w http.ResponseWriter, r *http.Request) {
	pages, err := s.store.ListThemePages()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"themePages": pages})
}

// GET /internal/maintenance/theme-pages/{slug}
//
// 供 CLI theme-page get 使用——管理端點不分 draft/published,查詢的是
// 這個 slug 目前實際存的內容(可能是還在編輯中的草稿)。
func (s *Server) handleMaintenanceThemePageGet(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	page, err := s.store.GetThemePageBySlug(slug)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not_found", "找不到此主題介紹頁")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// PUT /internal/maintenance/theme-pages/{slug}
//
// body: { "content": {...ThemePageContent}, "updatedBy": "選填" }
//
// 整份覆寫 content,不是欄位級 patch——對齊 store.UpdateThemePageContent
// 的既有說明(CLI 的操作模式是 get 一份、本機編輯、set 整份寫回)。
// 不動 status,發布狀態透過獨立的 handleMaintenanceThemePagePublish
// 切換,理由同 store 層的說明:避免改內容時意外動到發布狀態。
func (s *Server) handleMaintenanceThemePageUpdate(w http.ResponseWriter, r *http.Request) {
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
	if err := s.store.UpdateThemePageContent(slug, string(body.Content), body.UpdatedBy); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "not_found", "找不到此主題介紹頁")
			return
		}
		writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// PATCH /internal/maintenance/theme-pages/{slug}/publish
//
// body: { "published": true|false }
//
// 切換發布狀態——published=true 時設為 "published",false 時設回
// "draft"(對齊規劃文件「草稿/正式分離,避免半成品直接出現在正式
// 頁面」的設計)。合併成一支端點收 bool 參數,而非 publish/unpublish
// 兩支獨立端點——兩者都是「設定 status 欄位」這同一件事,差異只在
// 目標值,不需要為此多開一支路由。
func (s *Server) handleMaintenanceThemePagePublish(w http.ResponseWriter, r *http.Request) {
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
	if err := s.store.SetThemePageStatus(slug, status); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "not_found", "找不到此主題介紹頁")
			return
		}
		writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": status})
}

// DELETE /internal/maintenance/theme-pages/{slug}
func (s *Server) handleMaintenanceThemePageDelete(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if err := s.store.DeleteThemePage(slug); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "not_found", "找不到此主題介紹頁")
			return
		}
		writeErr(w, http.StatusInternalServerError, "delete_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// GET /v1/theme-pages/{slug} — 公開讀取端點,無需登入。
//
// 只回傳 status == "published" 的內容——草稿即使資料庫裡已經存在,
// 對未登入的一般訪客(城市主題介紹頁的真實讀者)也視為不存在,回
// 404,不是直接把 draft 原樣吐出去。這是管理端點(上面幾支,回傳
// 不分 draft/published)跟這支公開端點最主要的行為差異。
func (s *Server) handlePublicThemePage(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	page, err := s.store.GetThemePageBySlug(slug)
	if errors.Is(err, store.ErrNotFound) || (err == nil && page.Status != "published") {
		writeErr(w, http.StatusNotFound, "not_found", "找不到此主題介紹頁")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, page)
}

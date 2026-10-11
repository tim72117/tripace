// blog_profile.go——「部落客公開身份」設定(handle + 頭像網址,見
// store.blogProfileRow 的完整說明)的使用者自助端點。
//
// 兩支端點都需要登入,掛在 /v1/*(不是 /internal/*,那個命名空間專給
// CLI 維運端點用,見 blog_photo.go 開頭的完整說明)——這是一般使用者
// 在網頁上設定自己部落格身份時會直接呼叫的功能。身份解析一律用
// s.userFor(r),不接受呼叫端指定任意 UserID(使用者只能管理自己的
// profile),對齊 content_page.go 的 resolveContentPageOwnerID 既有
// 做法。
//
// GET/POST 合併成「查詢/upsert」兩支,不像 content-page 系列指令刻意
// 分成 add/update/publish 等多個獨立動詞——那是因為 CLI 維運場景
// (官方內容、多筆、需要明確分辨草稿/發布狀態)需要清楚區分每個操作;
// 這裡是「使用者設定自己的部落客身份」這種一對一、低頻的操作,upsert
// 更直覺,使用者不需要自己先查一次「我是要新增還是修改」。
package api

import (
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/tim72117/tripace/internal/store"
)

// handleBlogProfileLen 限制 handle 的長度上限——避免使用者輸入異常長的
// 字串塞進資料庫(這張表的 handle 本身沒有長度限制,見 blogProfileRow),
// 32 字元足夠容納任何合理的識別名稱,同時避免過長的字串破壞
// /u/{handle}/{slug} 這類網址的可讀性。
const handleMaxLen = 32

// handlePattern 限制 handle 只能是英數字加底線/連字符——這個欄位會
// 直接出現在公開網址 /u/{handle}/{slug} 裡(見 content_page.go 的
// handlePublicBlogArticle),必須是「URL 安全字元」:不含空白、斜線、
// 問號等會被瀏覽器/路由解析成分隔符或需要額外編碼的字元,也不含任何
// 可能造成顯示混淆或注入疑慮的符號。英數字+底線+連字符是最通用、
// 不需要額外 URL encode 就能直接組進路徑的字元集合(對齊常見部落格
// 平台的使用者名稱規則,如 GitHub/Medium 的 handle 慣例)。
var handlePattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// validateBlogProfileHandle 驗證 handle 格式——非空、長度在上限內、
// 只包含 URL 安全字元(見 handlePattern 的完整說明)。回傳人類可讀的
// 錯誤訊息,空字串代表合法。
func validateBlogProfileHandle(handle string) string {
	if handle == "" {
		return "handle 不可為空"
	}
	if len(handle) > handleMaxLen {
		return "handle 長度不可超過 32 字元"
	}
	if !handlePattern.MatchString(handle) {
		return "handle 只能包含英數字、底線(_)或連字符(-)"
	}
	return ""
}

// handleBlogProfileGet 處理 GET /v1/blog/profile——查詢登入者自己的
// 部落客設定。查無記錄(使用者還沒設定過)時回 404,讓前端據此顯示
// 「設定表單」(而非誤判成伺服器錯誤,或悄悄回傳一個空物件讓前端自己
// 猜測「這代表還沒設定過」還是「這就是合法的空設定」)。
func (s *Server) handleBlogProfileGet(w http.ResponseWriter, r *http.Request) {
	user := s.userFor(r)
	if s.isGuestUser(user) {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "請先登入")
		return
	}

	profile, err := s.store.GetBlogProfileByUserID(user.ID)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not_found", "尚未設定部落客身份")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

// handleBlogProfileSet 處理 POST /v1/blog/profile——設定或更新登入者
// 自己的部落客身份(upsert 語意,見本檔開頭的完整說明)。
//
// body: { "handle": "...", "avatarUrl": "..."(選填) }
//
// 邏輯:先查這個使用者是否已經有 profile,有就呼叫 UpdateBlogProfile,
// 沒有就呼叫既有的 CreateBlogProfile——跟 resolveContentPageOwnerID
// 不同,這裡不是由呼叫端明確指定要新增還是修改,而是由後端自己判斷
// (使用者的心智模型是「設定我的部落格身份」這單一動作,不該被要求
// 先知道自己目前有沒有設定過)。
func (s *Server) handleBlogProfileSet(w http.ResponseWriter, r *http.Request) {
	user := s.userFor(r)
	if s.isGuestUser(user) {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "請先登入")
		return
	}

	var body struct {
		Handle    string `json:"handle"`
		AvatarURL string `json:"avatarUrl,omitempty"`
	}
	if !decode(w, r, &body) {
		return
	}
	handle := strings.TrimSpace(body.Handle)
	if msg := validateBlogProfileHandle(handle); msg != "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", msg)
		return
	}

	_, err := s.store.GetBlogProfileByUserID(user.ID)
	switch {
	case err == nil:
		// 已有 profile——更新既有記錄。
		if uerr := s.store.UpdateBlogProfile(user.ID, handle, body.AvatarURL); uerr != nil {
			if errors.Is(uerr, store.ErrAlreadyExists) {
				writeErr(w, http.StatusConflict, "handle_taken", "這個 handle 已經被其他使用者使用")
				return
			}
			writeErr(w, http.StatusInternalServerError, "update_failed", uerr.Error())
			return
		}
		updated, gerr := s.store.GetBlogProfileByUserID(user.ID)
		if gerr != nil {
			writeErr(w, http.StatusInternalServerError, "query_failed", gerr.Error())
			return
		}
		writeJSON(w, http.StatusOK, updated)
	case errors.Is(err, store.ErrNotFound):
		// 還沒有 profile——建立新記錄。
		created, cerr := s.store.CreateBlogProfile(user.ID, handle, body.AvatarURL)
		if cerr != nil {
			if errors.Is(cerr, store.ErrAlreadyExists) {
				writeErr(w, http.StatusConflict, "handle_taken", "這個 handle 已經被其他使用者使用")
				return
			}
			writeErr(w, http.StatusInternalServerError, "create_failed", cerr.Error())
			return
		}
		writeJSON(w, http.StatusCreated, created)
	default:
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
	}
}

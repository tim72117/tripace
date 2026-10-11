// 主題介紹頁/部落格文章內容(/internal/maintenance/content-pages/* 管理
// 端點、/v1/content-pages/{slug} 公開讀取端點)——見 docs/
// refactor-theme-page-content-cms-plan-2026-10.md、
// web/src/blog/types.ts 的 ThemePageContent。
//
// 管理端點獨立放在 /internal/maintenance/content-pages/*,不是
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
//
// ownerID 身份切換(2026-10 新增)——這組管理端點原本只給 tripace-cli
// theme-page 系列指令管理城市介紹頁用,ownerID 寫死空字串。改名成
// content-page、CLI 開放部落格發文身份管理後,同一組端點現在要依照
// 呼叫端的意圖決定 ownerID 該用空字串(官方/系統帳號命名空間)還是
// 登入者自己的 UserID(部落客發文)。body 多一個 "official" bool 欄位
// (見 resolveContentPageOwnerID),由 CLI 根據有沒有 -official 旗標
// 決定要不要帶這個欄位——選擇在 body 加欄位、而非另外切一組 URL
// 路徑(例如 /internal/maintenance/official/content-pages),理由:
//  1. 這七支端點(add/list/get/set/publish/unpublish/delete)全部都要
//     套用同一套切換邏輯,另開一組路徑等於把七支端點的路由註冊、
//     handler 呼叫全部再複製一次,程式碼重複度高且容易兩邊改一邊漏改。
//  2. official 本質上是「這次呼叫要用哪個 ownerID」這個請求參數,
//     跟 slug/content/updatedBy 性質相同,放進 body 跟既有參數一起
//     解析,不需要為了這一個布林值新增路由層級的分支。
//  3. internalAuth 已確保呼叫端帶有效 JWT、s.userFor(r) 一定能解析出
//     真實使用者(見 resolveContentPageOwnerID 的完整說明),用 body
//     欄位搭配 s.userFor(r) 就能完整表達「官方 vs 使用者自己」這個
//     二選一,不需要額外的路由複雜度。
package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/tim72117/tripace/internal/adminidentity"
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

// resolveContentPageOwnerID 依請求是否標示「official」決定這次呼叫要用
// 哪個 ownerID——official 為 true 時固定回傳空字串(城市介紹頁等既有
// 內容共用的「系統帳號」命名空間,維持 2026-10 改動前的行為);否則
// 回傳 s.userFor(r).ID(登入者自己的 UserID,部落客發文情境,2026-10
// 新增的預設行為)。
//
// 身份衝突漏洞修正(2026-10,code review 發現):這裡原本直接信任
// s.userFor(r) 能解析出真實使用者,理由是「internalAuth 已經強制要求
// 合法 JWT,驗證失敗一律在 middleware 這層就回 401」——但這個推論漏了
// 一種情況:internalAuth 只驗 JWT 簽章,不檢查 claims.Sub 對應的使用者
// 是否還存在於資料庫。userFor/userFromToken 在「簽章有效但使用者已被
// 刪除」時會悄悄回退成共用的 s.guestUser(ID 固定 "usr_me")——這代表
// 任何兩個「使用者已被刪除、但簽發給他們的 JWT 還沒過期」的請求,都會
// 被當成同一個 ownerID("usr_me")處理,一個已刪除使用者的殘留 token,
// 能讀寫/刪除另一個已刪除使用者殘留 token 建立的 content page。
//
// 改用 s.requireRealUser(r)(見該函式的完整說明)取代直接信任
// s.userFor(r).ID——如果解析出的身份其實是訪客回退結果(對應已刪除
// 使用者的殘留 JWT),這裡回傳 ok=false,呼叫端視為權限不足回 403,
// 不能讓它靜默地共用訪客 ID 繼續操作 content pages。這跟下面 official
// 模式的白名單檢查是同一類「身份解析失敗時沒有正確拒絕,而是悄悄降級
// 成一個共用身份」的問題,修法思路一致。
//
// 權限檢查(2026-10 新增,修正 code review 發現的權限提升漏洞):
// official=true 原本只檢查「請求有沒有標示這個旗標」,沒有檢查「這個
// 使用者有沒有資格使用官方命名空間」——任何已登入使用者都能傳
// official:true 寫入/修改/刪除九份/京都/台南等公開頁面內容,等同從
// 「編輯我自己的部落格」直接提權到「編輯/刪除官方網站內容」。這裡補上
// email 白名單檢查(透過 internal/adminidentity.IsAdminEmail,與
// internal/adminconsole.Handler.withAdmin 共用同一套比對邏輯,見該套件
// 的完整說明,含 email 大小寫正規化),official 為 true 時,如果目前
// 使用者的 email 不在白名單內,回傳 ok=false,呼叫端應該視為權限不足、
// 回 403(不是 404/401——401 是「沒登入」,403 是「登入了但這個身份
// 不准做這件事」,語意不同,對齊 HTTP 既有慣例)。
func (s *Server) resolveContentPageOwnerID(r *http.Request, official bool) (ownerID string, ok bool) {
	user, ok := s.requireRealUser(r)
	if !ok {
		return "", false
	}
	if !official {
		return user.ID, true
	}
	email, err := s.store.GetUserEmail(user.ID)
	if err != nil || !adminidentity.IsAdminEmail(email, s.adminBootstrapEmail) {
		return "", false
	}
	return "", true
}

// POST /internal/maintenance/content-pages
//
// body: { "slug": "tainan-chikan", "content": {...ThemePageContent},
//         "updatedBy": "選填,操作者識別",
//         "official": true|false(選填,見本檔開頭 ownerID 身份切換說明)}
//
// content 直接收巢狀 JSON 物件(而非字串),這裡重新 Marshal 回字串存
// 進資料庫——比起要求呼叫端先把內容字串化再傳(容易漏做/多做一次
// 轉義出錯),讓 CLI 端可以直接把解析好的 JSON 物件塞進 request body,
// 跟 GET 回應的形狀（content 是物件,不是字串）對稱,CLI 實作時
// 不需要為「讀」跟「寫」兩個方向各自處理不同的字串/物件轉換。
func (s *Server) handleMaintenanceContentPageCreate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Slug      string          `json:"slug"`
		Content   json.RawMessage `json:"content"`
		UpdatedBy string          `json:"updatedBy,omitempty"`
		Official  bool            `json:"official,omitempty"`
	}
	if !decode(w, r, &body) {
		return
	}
	slug := strings.TrimSpace(body.Slug)
	if slug == "" || !isJSONObject(body.Content) {
		writeErr(w, http.StatusBadRequest, "invalid_input", "slug 為必填,content 必須是 JSON 物件")
		return
	}
	ownerID, ok := s.resolveContentPageOwnerID(r, body.Official)
	if !ok {
		writeErr(w, http.StatusForbidden, "forbidden", "沒有使用 official 模式的權限")
		return
	}
	res, err := s.store.CreateContentPage(ownerID, slug, string(body.Content), body.UpdatedBy)
	if errors.Is(err, store.ErrAlreadyExists) {
		writeErr(w, http.StatusConflict, "slug_taken", "此 slug 已存在,請改用 content-page set 更新內容")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "create_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, res)
}

// GET /internal/maintenance/content-pages?official=true|false
//
// 回傳全部主題介紹頁(含 draft),供 CLI content-page list 使用——管理
// 端點不分 draft/published,管理者需要看到草稿才能決定要不要 publish
// (見 store.ListContentPages 的完整說明)。
//
// 這支刻意不依 official 篩選 ownerID——ListContentPages 本來就是
// 「列出全部,不分 ownerID」的既有語意(見該方法的完整說明),CLI
// content-page list 不分官方/使用者身份,一次就能看到所有人建過的
// 頁面,不需要為了這支端點新增 official 篩選邏輯。
func (s *Server) handleMaintenanceContentPageList(w http.ResponseWriter, r *http.Request) {
	pages, err := s.store.ListContentPages()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"contentPages": pages})
}

// GET /internal/maintenance/content-pages/{slug}?official=true|false
//
// 供 CLI content-page get 使用——管理端點不分 draft/published,查詢的
// 是這個 slug 目前實際存的內容(可能是還在編輯中的草稿)。official
// 透過 query string 傳遞(GET 請求沒有 body),見本檔開頭 ownerID
// 身份切換的完整說明。
func (s *Server) handleMaintenanceContentPageGet(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	ownerID, ok := s.resolveContentPageOwnerID(r, r.URL.Query().Get("official") == "true")
	if !ok {
		writeErr(w, http.StatusForbidden, "forbidden", "沒有使用 official 模式的權限")
		return
	}
	page, err := s.store.GetContentPageBySlug(ownerID, slug)
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

// PUT /internal/maintenance/content-pages/{slug}
//
// body: { "content": {...ThemePageContent}, "updatedBy": "選填",
//         "official": true|false(選填,見本檔開頭 ownerID 身份切換說明)}
//
// 整份覆寫 content,不是欄位級 patch——對齊 store.UpdateContentPageContent
// 的既有說明(CLI 的操作模式是 get 一份、本機編輯、set 整份寫回)。
// 不動 status,發布狀態透過獨立的 handleMaintenanceContentPagePublish
// 切換,理由同 store 層的說明:避免改內容時意外動到發布狀態。
func (s *Server) handleMaintenanceContentPageUpdate(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	var body struct {
		Content   json.RawMessage `json:"content"`
		UpdatedBy string          `json:"updatedBy,omitempty"`
		Official  bool            `json:"official,omitempty"`
	}
	if !decode(w, r, &body) {
		return
	}
	if !isJSONObject(body.Content) {
		writeErr(w, http.StatusBadRequest, "invalid_input", "content 必須是 JSON 物件")
		return
	}
	ownerID, ok := s.resolveContentPageOwnerID(r, body.Official)
	if !ok {
		writeErr(w, http.StatusForbidden, "forbidden", "沒有使用 official 模式的權限")
		return
	}
	if err := s.store.UpdateContentPageContent(ownerID, slug, string(body.Content), body.UpdatedBy); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "not_found", "找不到此主題介紹頁")
			return
		}
		writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// PATCH /internal/maintenance/content-pages/{slug}/publish
//
// body: { "published": true|false,
//         "official": true|false(選填,見本檔開頭 ownerID 身份切換說明)}
//
// 切換發布狀態——published=true 時設為 "published",false 時設回
// "draft"(對齊規劃文件「草稿/正式分離,避免半成品直接出現在正式
// 頁面」的設計)。合併成一支端點收 bool 參數,而非 publish/unpublish
// 兩支獨立端點——兩者都是「設定 status 欄位」這同一件事,差異只在
// 目標值,不需要為此多開一支路由。
func (s *Server) handleMaintenanceContentPagePublish(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	var body struct {
		Published bool `json:"published"`
		Official  bool `json:"official,omitempty"`
	}
	if !decode(w, r, &body) {
		return
	}
	status := "draft"
	if body.Published {
		status = "published"
	}
	ownerID, ok := s.resolveContentPageOwnerID(r, body.Official)
	if !ok {
		writeErr(w, http.StatusForbidden, "forbidden", "沒有使用 official 模式的權限")
		return
	}
	if err := s.store.SetContentPageStatus(ownerID, slug, status); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "not_found", "找不到此主題介紹頁")
			return
		}
		writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": status})
}

// DELETE /internal/maintenance/content-pages/{slug}?official=true|false
//
// official 透過 query string 傳遞(DELETE 請求慣例上不帶 body,CLI
// 這支呼叫本來也沒有帶 body,見 httpClient.contentPageDelete),見本檔
// 開頭 ownerID 身份切換的完整說明。
func (s *Server) handleMaintenanceContentPageDelete(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	ownerID, ok := s.resolveContentPageOwnerID(r, r.URL.Query().Get("official") == "true")
	if !ok {
		writeErr(w, http.StatusForbidden, "forbidden", "沒有使用 official 模式的權限")
		return
	}
	if err := s.store.DeleteContentPage(ownerID, slug); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusNotFound, "not_found", "找不到此主題介紹頁")
			return
		}
		writeErr(w, http.StatusInternalServerError, "delete_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// GET /v1/content-pages/{slug} — 公開讀取端點,無需登入。
//
// 只回傳 status == "published" 的內容——草稿即使資料庫裡已經存在,
// 對未登入的一般訪客(城市主題介紹頁的真實讀者)也視為不存在,回
// 404,不是直接把 draft 原樣吐出去。這是管理端點(上面幾支,回傳
// 不分 draft/published)跟這支公開端點最主要的行為差異。
//
// 這支固定用 ownerID=""(系統帳號命名空間)查詢,不支援 official
// 切換——這支端點本來就是給「城市介紹頁」這種沒有作者概念的公開內容
// 用,部落客文章的公開讀取走獨立的 /v1/blog/{handle}/{slug}(見下方
// handlePublicBlogArticle),兩者網址與查詢邏輯本來就分開,不需要在
// 這支端點上疊加身份切換。
func (s *Server) handlePublicContentPage(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	page, err := s.store.GetContentPageBySlug("", slug)
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

// GET /v1/blog/{handle}/{slug} — 部落格文章公開讀取端點,無需登入。
//
// 跟上面的 handlePublicContentPage 是同一種「訪客免登入、只回已發布
// 內容」的端點,差別只在於多了一層 handle→UserID 的解析:城市主題
// 介紹頁用 ownerID="" 的系統帳號命名空間查詢(見 GetContentPageBySlug
// 的完整說明),部落格文章則是「每個使用者各自的 slug 命名空間」,
// URL 上只有人類可讀的 handle,沒有內部 UserID,所以要先查一次
// blog_profiles 把 handle 解析成 UserID,才能用同一支
// GetContentPageBySlug 查到正確的那一筆。
func (s *Server) handlePublicBlogArticle(w http.ResponseWriter, r *http.Request) {
	handle := r.PathValue("handle")
	slug := r.PathValue("slug")

	// 第一步:handle 解析成 UserID。這裡刻意跟下一步查文章分開處理
	// 404——handle 不存在(作者本人都查無此人)跟「這位作者存在,但
	// 沒有這篇文章/這篇還沒發布」是两種不同情境,分開給訊息方便除錯,
	// 但對外都是 404(對未登入訪客而言,兩者都等同於「這裡沒有內容」,
	// 不需要讓訪客分辨差異,也不該洩漏「這個 handle 到底存不存在」
	// 以外的任何細節)。
	profile, err := s.store.GetBlogProfileByHandle(handle)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not_found", "找不到此作者")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}

	// 第二步:用解析出的 UserID 當 ownerID,查這位作者底下的這篇文章。
	// 判斷邏輯完全比照 handlePublicContentPage——查無資料,或查到了但
	// status 不是 "published",都視為訪客看不到,一律回 404,不區分
	// 「slug 不存在」跟「slug 存在但還是草稿」,避免讓訪客用「存在但
	// 404」跟「完全不存在」的差異反推出作者有哪些還沒發布的草稿。
	page, err := s.store.GetContentPageBySlug(profile.UserID, slug)
	if errors.Is(err, store.ErrNotFound) || (err == nil && page.Status != "published") {
		writeErr(w, http.StatusNotFound, "not_found", "找不到此文章")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, page)
}

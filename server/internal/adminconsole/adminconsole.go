// Package adminconsole 提供管理後台 API,掛載於 /admin/api/*。身分驗證
// 不再是獨立系統——改成消費一般使用者的 JWT(跟 /internal/*、/v1/* 共用
// 同一套 internal/auth.Signer),再用 email 白名單(adminBootstrapEmail,
// 來自環境變數 ADMIN_BOOTSTRAP_EMAIL)決定誰有管理權限:通過 JWT 驗證的
// 使用者,其 email 必須與這個白名單值相符,才會被 withAdmin 放行。
//
// 這個改動移除了獨立的 admin_users/admin_sessions 資料表、獨立密碼、獨立
// cookie——管理員不再是「另一套帳號系統」,而是「一般使用者 + email 比對」。
// 整合範圍維持不變:「使用者列表查詢」+「外部服務健康檢查」(health.go)等,
// 不含方案(plan)/額度(quota)/用量追蹤。
package adminconsole

import (
	"encoding/json"
	"net/http"

	"github.com/tim72117/tripace/internal/adminidentity"
	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/store"
)

// Admin 是通過 withAdmin 驗證的管理員身分——解析自一般使用者的 JWT,
// 再核對 email 白名單後得到。
type Admin struct {
	UserID string
	Email  string
}

// Handler serves /admin/api/*。Signer 用來驗證呼叫端帶來的 JWT(跟
// /internal/*、/v1/* 共用同一套 internal/auth.Signer,見 internalAuth 的
// 既有寫法);Store 提供使用者查詢;AdminBootstrapEmail 是白名單——只有
// email 與此相符的一般使用者才會被 withAdmin 判定為管理員。
type Handler struct {
	Signer              *auth.Signer
	Store               *store.Store
	AdminBootstrapEmail string
}

func NewHandler(signer *auth.Signer, st *store.Store, adminBootstrapEmail string) *Handler {
	return &Handler{Signer: signer, Store: st, AdminBootstrapEmail: adminBootstrapEmail}
}

// Register mounts the admin API routes on mux。不再有獨立的 login/logout
// 端點——使用者透過一般的 /v1/auth/* 登入流程取得 JWT,直接帶著那把 JWT
// 打這裡的 /admin/api/* 端點。
func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /admin/api/me", h.withAdmin(h.me))
	mux.HandleFunc("GET /admin/api/users", h.withAdmin(h.listUsers))
	mux.HandleFunc("GET /admin/api/health/external", h.withAdmin(h.listExternalHealth))
	mux.HandleFunc("GET /admin/api/request-stats", h.withAdmin(h.listRequestStats))
	mux.HandleFunc("GET /admin/api/plan-ai-chat-logs", h.withAdmin(h.listPlanAiChatLogs))
	mux.HandleFunc("GET /admin/api/geo-api-stats", h.withAdmin(h.listGeoAPIStats))
	mux.HandleFunc("GET /admin/api/schema-check", h.withAdmin(h.checkSchema))
	mux.HandleFunc("GET /admin/api/geo-rate-limits", h.withAdmin(h.listGeoRateLimits))
	mux.HandleFunc("PUT /admin/api/geo-rate-limits", h.withAdmin(h.updateGeoRateLimit))
	mux.HandleFunc("GET /admin/api/attraction-missing-place-id-check", h.withAdmin(h.checkAttractionMissingPlaceID))
	mux.HandleFunc("POST /admin/api/attraction-missing-place-id-check/refetch", h.withAdmin(h.refetchAttractionPlaceID))
}

// withAdmin 是每一條特權管理路由共用的關卡:
//  1. 解析 Authorization: Bearer <token>(比照 internal/api/middleware.go
//     的 internalAuth 既有寫法)。
//  2. 用 Signer.Verify 驗證這是一把有效的自家 JWT,拿到 Claims。
//  3. 用 Claims.Sub(UserID)查 Store.FindUserByID 拿到完整 model.User。
//  4. 檢查該使用者的 email 是否在白名單內(透過
//     internal/adminidentity.IsAdminEmail,與 internal/api 的
//     resolveContentPageOwnerID official 模式共用同一套比對邏輯——兩個
//     套件刻意互不相依,見 internal/adminidentity 套件開頭的完整說明,
//     含 email 大小寫正規化的理由)。
//
// 任一步驟失敗(沒有 token、JWT 無效、使用者不存在、email 不符、白名單
// 未設定)一律回 401,不洩漏是哪一步失敗——fail-closed,比照原本 withAdmin
// 的既有行為。白名單為空字串時,IsAdminEmail 視為「沒有任何人是管理員」,
// 直接拒絕,不會意外放行 email 也是空字串的使用者。
//
// 已知架構限制(2026-10,未修正,記錄供日後維護者參考):admin 權限現在
// 完全依附在跟一般使用者共用的 30 天無狀態 JWT 上——這把 JWT 只驗簽章
// 與到期時間(見 internal/auth.Signer.Verify),沒有任何資料庫層級的
// session/撤銷紀錄可查。這代表:
//  - 如果一把帶有 admin email 的 JWT 外洩(例如使用者裝置失竊、token
//    被記錄進不該記錄的地方),在它自然到期(最長 30 天)前,唯一能讓它
//    立即失效的方法是轉動 JWT_SECRET——但這會讓簽章驗證對「所有」既有
//    JWT 失效,等於把所有一般使用者（不只是外洩的那個 admin token)一併
//    強制登出,是一個波及全站的補救手段,不是精準撤銷單一 token。
//  - 沒有獨立的「縮短 admin token 有效期」機制——admin 與一般使用者共用
//    同一個 Signer、同一個 ttl(建構於 cmd/server、cmd/adminserver 的
//    auth.NewSigner(..., 30*24*time.Hour)),無法只讓 admin 身份的 token
//    活得比較短。
//
// 這是這次「移除獨立 admin_users/admin_sessions 資料表、改用一般使用者
// JWT + email 白名單」改造方向下刻意接受的取捨(舊的 internal/adminauth
// 套件原本有資料庫 session 可以個別撤銷,但那套系統連同獨立帳號/密碼/
// cookie 一併被這次改造移除)——目前沒有重新引入一套完整 session 系統的
// 計畫(那會是過大的架構變更,與這次改造方向相反)。如果之後要緩解這個
// 限制,合理的輕量做法是在 model.User 或 store 層加一個「token 最小有效
// 版本號」欄位(簽發時寫入 claims,驗證時跟資料庫目前版本號比對,版本
// 不符就視為失效——類似「使用者改密碼後舊 token 全部失效」的常見做法,
// 不需要完整 session 系統也能做到精準撤銷),但這會動到 JWT claims 格式
// 與使用者資料表 schema,目前判斷風險與複雜度不值得在這裡順手做,留給
// 之後有實際需求時再評估。短期補救手段只有「轉動 JWT_SECRET(波及全站)」
// 或「縮短 JWT 有效期(ttl,目前 30 天)」兩種,沒有第三種選擇。
func (h *Handler) withAdmin(next func(http.ResponseWriter, *http.Request, *Admin)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, err := auth.ParseBearer(r.Header.Get("Authorization"))
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
			return
		}
		claims, err := h.Signer.Verify(token)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
			return
		}
		user, err := h.Store.FindUserByID(claims.Sub)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
			return
		}
		email, err := h.Store.GetUserEmail(claims.Sub)
		if err != nil || !adminidentity.IsAdminEmail(email, h.AdminBootstrapEmail) {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
			return
		}
		next(w, r, &Admin{UserID: user.ID, Email: email})
	}
}

// --- auth ----------------------------------------------------------------

type adminResponse struct {
	Email string `json:"email"`
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request, admin *Admin) {
	writeJSON(w, http.StatusOK, adminResponse{Email: admin.Email})
}

// --- users -----------------------------------------------------------------

type usersResponse struct {
	Total int                      `json:"total"`
	Users []model.AdminUserSummary `json:"users"`
}

// listUsers 回傳一般使用者清單(基本身分資訊——id/email/name/大頭貼顏色)。
// 刻意不含方案/額度/用量,這次整合範圍不含 quota 系統。
func (h *Handler) listUsers(w http.ResponseWriter, r *http.Request, _ *Admin) {
	users, err := h.Store.ListUsers()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, usersResponse{Total: len(users), Users: users})
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeErr 回應結構化 JSON 錯誤——{"error":{"code":"...","message":"..."}},
// 跟 internal/api 的 writeErr(見 internal/api/api.go)輸出格式對齊。
//
// 這裡自己寫一份,不直接呼叫 internal/api 的版本——internal/adminconsole
// 跟 internal/api 刻意互不相依(見本檔案開頭與 cmd/adminserver/main.go
// 的說明:adminconsole 只依賴 internal/auth、internal/model、
// internal/store,讓 cmd/adminserver 能獨立編譯、不帶入主業務依賴),
// 只需要兩邊輸出格式一致,不需要共用同一份程式碼。
//
// 這個套件原本全面使用 http.Error(純文字 body),跟全站其餘端點
// (internal/api 底下一律透過 writeErr 產生結構化 JSON)不一致——
// internal/api/middleware.go 的 internalAuth 有一段註解記載過同樣的
// 格式不一致問題並已修正(前端 api.ts 的 errBody?.error?.message 是
// 針對物件形狀寫的,純文字 error 欄位永遠讀不到 message),這裡補上
// 對稱的修正,admin 前端(web/admin/src/api.ts)也已同步改成解析這個
// 物件形狀。
func writeErr(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{"code": code, "message": msg},
	})
}

// Package partnerconsole 提供廣告業主/聯盟行銷夥伴控制台 API,掛載於
// /partner/api/*。2026-10 改動:身分驗證不再是獨立系統——改成比照
// adminconsole 的既有模式,消費一般使用者的 JWT(跟 /v1/*、/admin/*
// 共用同一套 internal/auth.Signer),差別在於 adminconsole 用 email
// 白名單判斷權限(全有全無的單一布林),這裡用「Claims.Sub(一般使用者
// ID)有沒有對應到一筆 partnerRow」判斷(真正的資料庫關聯,見
// store.partnerRow 完整說明)——這個差異是因為 partner 需要資料歸屬
// 隔離(業主 A 不能看到業主 B 的 campaign),白名單那種全有全無的判斷
// 方式做不到這件事,必須有真正的資料庫主鍵(partnerRow.ID)可以在
// campaign/adPlan 查詢層 WHERE partner_id = ? 過濾。
//
// 這裡沒有 register/login 端點——使用者透過一般的 /v1/auth/* 登入
// 流程取得 JWT,直接帶著那把 JWT 打這裡的 /partner/api/*(對齊
// adminconsole.Register 的同一句話:不再有獨立的 login/logout 端點)。
// 「一般使用者怎麼變成業主」目前沒有自助申請流程,只能由內部人員手動
// 寫入 partnerRow(見該型別完整說明)。
//
// 比照 adminconsole 的既有結構(獨立套件、只依賴 internal/auth、
// internal/model、internal/store,不依賴 internal/api/internal/llm 等
// 主業務套件),讓 cmd/partnerserver 能獨立編譯成一支不含主業務依賴的
// 精簡 binary。
package partnerconsole

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/tim72117/tripace/internal/auth"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/store"
)

// Partner 是通過 withPartner 驗證的業主身分。
type Partner struct {
	ID     string
	UserID string
	Name   string
}

// Handler serves /partner/api/*。
type Handler struct {
	Signer *auth.Signer
	Store  *store.Store
}

func NewHandler(signer *auth.Signer, st *store.Store) *Handler {
	return &Handler{Signer: signer, Store: st}
}

// Register mounts the partner console API routes on mux。不再有獨立的
// login/logout 端點——使用者透過一般的 /v1/auth/* 登入流程取得 JWT,
// 直接帶著那把 JWT 打這裡的 /partner/api/* 端點(對齊
// adminconsole.Register 的同一句話)。
func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /partner/api/me", h.withPartner(h.me))
	mux.HandleFunc("GET /partner/api/placements", h.withPartner(h.listPlacements))

	mux.HandleFunc("GET /partner/api/campaigns", h.withPartner(h.listCampaigns))
	mux.HandleFunc("POST /partner/api/campaigns", h.withPartner(h.createCampaign))
	mux.HandleFunc("GET /partner/api/campaigns/{id}", h.withPartner(h.getCampaign))
	mux.HandleFunc("PUT /partner/api/campaigns/{id}", h.withPartner(h.updateCampaign))
	mux.HandleFunc("PUT /partner/api/campaigns/{id}/status", h.withPartner(h.setCampaignStatus))
	mux.HandleFunc("DELETE /partner/api/campaigns/{id}", h.withPartner(h.deleteCampaign))

	mux.HandleFunc("GET /partner/api/campaigns/{campaignID}/plans", h.withPartner(h.listAdPlans))
	mux.HandleFunc("POST /partner/api/campaigns/{campaignID}/plans", h.withPartner(h.createAdPlan))
	mux.HandleFunc("GET /partner/api/plans/{id}", h.withPartner(h.getAdPlan))
	mux.HandleFunc("PUT /partner/api/plans/{id}", h.withPartner(h.updateAdPlan))
	mux.HandleFunc("PUT /partner/api/plans/{id}/status", h.withPartner(h.setAdPlanStatus))
	mux.HandleFunc("DELETE /partner/api/plans/{id}", h.withPartner(h.deleteAdPlan))
}

// withPartner 是每一條業主路由共用的關卡:
//  1. 解析 Authorization: Bearer <token>(比照 adminconsole.withAdmin
//     的既有寫法)。
//  2. 用 Signer.Verify 驗證這是一把有效的自家 JWT,拿到 Claims。
//  3. 用 Claims.Sub(一般使用者 ID)查 Store.FindPartnerByUserID——
//     查得到代表這個使用者有業主身分,查不到代表沒有。
//
// 任一步驟失敗(沒有 token、JWT 無效、使用者不是業主)一律回 401,不
// 洩漏是哪一步失敗——fail-closed,對齊 adminconsole.withAdmin 的既有
// 設計哲學。
func (h *Handler) withPartner(next func(http.ResponseWriter, *http.Request, *Partner)) http.HandlerFunc {
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
		p, err := h.Store.FindPartnerByUserID(claims.Sub)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
			return
		}
		next(w, r, &Partner{ID: p.ID, UserID: p.UserID, Name: p.Name})
	}
}

// --- auth --------------------------------------------------------------
//
// 不再有獨立的 register/login/authResponse——身分驗證改成消費一般
// 使用者 JWT(見本檔案開頭與 withPartner 的完整說明),/partner/api/me
// 單純回傳 withPartner 已經解析好的業主身分,不需要重新查一次 store。

func (h *Handler) me(w http.ResponseWriter, r *http.Request, p *Partner) {
	partner, err := h.Store.FindPartnerByID(p.ID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "partner not found")
		return
	}
	writeJSON(w, http.StatusOK, partner)
}

// --- placements ------------------------------------------------------------
//
// validPlacements——目前已知可投放廣告方案的主站頁面,對應
// web/src/home/ 底下實際存在、已經掛載 SponsoredPlanCard 的主題景點頁
// slug(見各頁面檔案裡的 <SponsoredPlanCard placement="..." /> 呼叫)。
// 這是後端唯一一份清單來源——web/partner 的 SPA 跟 partner-cli 都改成
// 透過 GET /partner/api/placements 查詢這份清單,不再各自寫死。新增一個
// 可投放頁面時,只需要在這裡加一行(以及實際在該頁面掛上
// SponsoredPlanCard),不需要同步改前端。
var validPlacements = []model.Placement{
	{Value: "kyoto-kiyomizu", Label: "京都清水寺"},
	{Value: "jiufen", Label: "九份"},
	{Value: "tainan-anping", Label: "台南安平"},
	{Value: "tainan-chikan", Label: "台南赤崁"},
}

type placementsResponse struct {
	Placements []model.Placement `json:"placements"`
}

func (h *Handler) listPlacements(w http.ResponseWriter, r *http.Request, p *Partner) {
	writeJSON(w, http.StatusOK, placementsResponse{Placements: validPlacements})
}

// --- campaigns -----------------------------------------------------------

type campaignsResponse struct {
	Campaigns []model.Campaign `json:"campaigns"`
}

func (h *Handler) listCampaigns(w http.ResponseWriter, r *http.Request, p *Partner) {
	campaigns, err := h.Store.ListCampaignsByPartner(p.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", "failed to list campaigns")
		return
	}
	writeJSON(w, http.StatusOK, campaignsResponse{Campaigns: campaigns})
}

type createCampaignRequest struct {
	Name      string `json:"name"`
	Placement string `json:"placement"`
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
}

func (h *Handler) createCampaign(w http.ResponseWriter, r *http.Request, p *Partner) {
	var body createCampaignRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		writeErr(w, http.StatusBadRequest, "bad_request", "name is required")
		return
	}
	if hasBadText(body.Name, body.Placement, body.StartDate, body.EndDate) {
		writeErr(w, http.StatusBadRequest, "invalid_text", badTextMessage)
		return
	}
	c, err := h.Store.CreateCampaign(p.ID, body.Name, body.Placement, body.StartDate, body.EndDate)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal", "failed to create campaign")
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (h *Handler) getCampaign(w http.ResponseWriter, r *http.Request, p *Partner) {
	id := r.PathValue("id")
	c, err := h.Store.GetCampaignForPartner(p.ID, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "campaign not found")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (h *Handler) updateCampaign(w http.ResponseWriter, r *http.Request, p *Partner) {
	id := r.PathValue("id")
	var body createCampaignRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		writeErr(w, http.StatusBadRequest, "bad_request", "name is required")
		return
	}
	if hasBadText(body.Name, body.Placement, body.StartDate, body.EndDate) {
		writeErr(w, http.StatusBadRequest, "invalid_text", badTextMessage)
		return
	}
	if err := h.Store.UpdateCampaignForPartner(p.ID, id, body.Name, body.Placement, body.StartDate, body.EndDate); err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "campaign not found")
		return
	}
	c, err := h.Store.GetCampaignForPartner(p.ID, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "campaign not found")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

type setStatusRequest struct {
	Status string `json:"status"`
}

func (h *Handler) setCampaignStatus(w http.ResponseWriter, r *http.Request, p *Partner) {
	id := r.PathValue("id")
	var body setStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Status == "" {
		writeErr(w, http.StatusBadRequest, "bad_request", "status is required")
		return
	}
	if err := h.Store.SetCampaignStatusForPartner(p.ID, id, body.Status); err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "campaign not found")
		return
	}
	c, err := h.Store.GetCampaignForPartner(p.ID, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "campaign not found")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (h *Handler) deleteCampaign(w http.ResponseWriter, r *http.Request, p *Partner) {
	id := r.PathValue("id")
	if err := h.Store.DeleteCampaignForPartner(p.ID, id); err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "campaign not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- ad plans --------------------------------------------------------------

type adPlansResponse struct {
	Plans []model.AdPlan `json:"plans"`
}

func (h *Handler) listAdPlans(w http.ResponseWriter, r *http.Request, p *Partner) {
	campaignID := r.PathValue("campaignID")
	plans, err := h.Store.ListAdPlansForPartner(p.ID, campaignID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "campaign not found")
		return
	}
	writeJSON(w, http.StatusOK, adPlansResponse{Plans: plans})
}

type createAdPlanRequest struct {
	Category string `json:"category"`
	Title    string `json:"title"`
	Detail   string `json:"detail"`
}

func (h *Handler) createAdPlan(w http.ResponseWriter, r *http.Request, p *Partner) {
	campaignID := r.PathValue("campaignID")
	var body createAdPlanRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Title == "" {
		writeErr(w, http.StatusBadRequest, "bad_request", "title is required")
		return
	}
	if hasBadText(body.Category, body.Title, body.Detail) {
		writeErr(w, http.StatusBadRequest, "invalid_text", badTextMessage)
		return
	}
	plan, err := h.Store.CreateAdPlanForPartner(p.ID, campaignID, body.Category, body.Title, body.Detail)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "campaign not found")
		return
	}
	writeJSON(w, http.StatusCreated, plan)
}

func (h *Handler) getAdPlan(w http.ResponseWriter, r *http.Request, p *Partner) {
	plan, err := h.Store.GetAdPlanForPartner(p.ID, r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "plan not found")
		return
	}
	writeJSON(w, http.StatusOK, plan)
}

func (h *Handler) updateAdPlan(w http.ResponseWriter, r *http.Request, p *Partner) {
	id := r.PathValue("id")
	var body createAdPlanRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Title == "" {
		writeErr(w, http.StatusBadRequest, "bad_request", "title is required")
		return
	}
	if hasBadText(body.Category, body.Title, body.Detail) {
		writeErr(w, http.StatusBadRequest, "invalid_text", badTextMessage)
		return
	}
	if err := h.Store.UpdateAdPlanForPartner(p.ID, id, body.Category, body.Title, body.Detail); err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "plan not found")
		return
	}
	plan, err := h.Store.GetAdPlanForPartner(p.ID, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "plan not found")
		return
	}
	writeJSON(w, http.StatusOK, plan)
}

func (h *Handler) setAdPlanStatus(w http.ResponseWriter, r *http.Request, p *Partner) {
	id := r.PathValue("id")
	var body setStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Status == "" {
		writeErr(w, http.StatusBadRequest, "bad_request", "status is required")
		return
	}
	if err := h.Store.SetAdPlanStatusForPartner(p.ID, id, body.Status); err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "plan not found")
		return
	}
	// 2026-10 code review 抓到:原本這裡只回 200 空 body,跟
	// setCampaignStatus 寫入後重新查出完整物件回傳的既有行為不一致
	// (呼叫端若預期拿到更新後的 plan JSON 會拿到空值)。補上
	// GetAdPlanForPartner 對齊。
	plan, err := h.Store.GetAdPlanForPartner(p.ID, id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "plan not found")
		return
	}
	writeJSON(w, http.StatusOK, plan)
}

func (h *Handler) deleteAdPlan(w http.ResponseWriter, r *http.Request, p *Partner) {
	id := r.PathValue("id")
	if err := h.Store.DeleteAdPlanForPartner(p.ID, id); err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "plan not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- helpers ---------------------------------------------------------------

const badTextMessage = "text contains invalid characters (U+FFFD); the client likely sent a mis-encoded string — resend as UTF-8"

// hasBadText 擋下已經損壞的文字:Go 的 JSON 解碼會把非法 UTF-8 位元組靜默
// 換成 U+FFFD,不擋的話亂碼會被當成正常內容存進資料庫,且無法還原。
func hasBadText(ss ...string) bool {
	for _, s := range ss {
		if !utf8.ValidString(s) || strings.ContainsRune(s, utf8.RuneError) {
			return true
		}
	}
	return false
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeErr 回應結構化 JSON 錯誤,格式對齊 internal/api 與 adminconsole
// 的既有慣例(見 adminconsole.writeErr 的完整說明)。
func writeErr(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{"code": code, "message": msg},
	})
}

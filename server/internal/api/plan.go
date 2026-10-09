package api

import (
	"net/http"
	"os"

	"github.com/tim72117/tripace/internal/model"
)

// plan.go — 訂閱方案機制第一階段(見使用者明確確認過的規格討論):只建置
// 方案定義跟訂閱介面,不做任何功能限制。這裡提供兩支端點:
//
//  1. GET  /internal/plan/me        查詢「我目前的方案」+ 全部方案定義
//  2. POST /internal/plan/claim-fan 憑固定 code 核發粉絲專案版(一次性,
//     不經金流)
//
// 刻意不做的事(下一階段才做,見 plan_ai_chat.go 對這批端點完全沒有任何
// 改動即可知道):額度扣除/攔截邏輯、金流/付款整合、admin 方案管理介面。
// model.Plan.MonthlyAIRequests 這個數字在這個階段只用來顯示,沒有任何
// 讀取路徑會拿它來做「超過額度就拒絕」的判斷。

// planMeResponse 是 GET /internal/plan/me 的回應形狀。
//
// 設計判斷:這支端點刻意回傳「我的方案」+「全部方案清單」兩者,而不是
// 只回「我的方案代號」——前端「訂閱方案」頁面需要同時列出兩個方案的
// 名稱/額度說明並標示目前方案是哪一個,如果這支端點只回代號,前端就得
// 自己在 TypeScript 裡重複定義一份方案清單(名稱、額度數字),之後改
// model/plan.go 的數字還要記得同步改前端常數,兩邊容易長期不同步。讓
// 後端的 model/plan.go 當唯一的權威來源、前端純粹顯示 API 回傳的內容,
// 設計上更乾淨、不會有兩份定義互相漂移的風險。
type planMeResponse struct {
	// CurrentTier 是這個使用者目前的方案代號。
	CurrentTier model.PlanTier `json:"currentTier"`
	// CurrentPlan 是 CurrentTier 對應的完整方案定義(名稱、額度),
	// 前端可以直接拿來顯示「你目前是 OOO,每月可用 N 次」,不需要自己
	// 從 Plans 清單裡再查一次。
	CurrentPlan model.Plan `json:"currentPlan"`
	// Plans 是目前定義的全部方案(見 model.AllPlans),供「訂閱方案」
	// 頁面列出兩個方案的名稱與額度說明。固定順序:[免費版, 粉絲專案版]。
	Plans []model.Plan `json:"plans"`
}

// GET /internal/plan/me
// 查詢目前使用者的方案資訊。掛在 internalAuth 底下(JWT 必須合法),但
// handler 內仍明確擋掉訪客(guestUser)——理由同 handlePlanAiChat 開頭的
// 既有說明:internalAuth 只驗 JWT 合法性,userFor 失敗時的 fallback 行為
// 是回傳訪客而非直接 401,訪客沒有「自己的方案」這個概念可言。
func (s *Server) handleGetMyPlan(w http.ResponseWriter, r *http.Request) {
	user := s.userFor(r)
	if s.isGuestUser(user) {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "登入已過期,請重新登入")
		return
	}

	tier, err := s.store.GetUserPlanTier(user.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "store_failed", "查詢方案失敗")
		return
	}

	writeJSON(w, http.StatusOK, planMeResponse{
		CurrentTier: tier,
		CurrentPlan: model.PlanFor(tier),
		Plans:       model.AllPlans(),
	})
}

// claimFanPlanRequest 是 POST /internal/plan/claim-fan 的請求 body。
type claimFanPlanRequest struct {
	Code string `json:"code"`
}

// POST /internal/plan/claim-fan
// Body: { "code": "..." }
//
// 粉絲專案連結核發端點——對應前端 /fan/<code> 路由。固定一組 code 寫死
// 在環境變數 FAN_PLAN_CLAIM_CODE(見下方 fanPlanClaimCode 的說明),使用者
// (必須已登入)造訪 /fan/<code>、code 吻合時,前端呼叫這支端點,直接把
// 自己的帳號方案標記成 fan,不經過金流,一次性核發。
//
// 驗證順序:
//  1. 必須已登入(非訪客)——理由同 handleGetMyPlan。
//  2. 伺服器必須設定了 FAN_PLAN_CLAIM_CODE——沒設定代表這個功能尚未
//     啟用,視同「這組連結不存在」處理,不洩漏「功能存在但沒設定」這
//     個內部狀態(對外一律回同一種 invalid_code 錯誤,下方說明)。
//  3. code 必須與環境變數完全比對相符(大小寫敏感,不 trim 空白——
//     這是一組固定、短小的核發碼,呼叫端應該原樣傳遞,不需要替使用者
//     的輸入做任何寬鬆處理;若之後要做容錯可以在前端輸入框處理)。
//
// 成功後回傳更新後的方案資訊(格式比照 handleGetMyPlan 的回應),讓前端
// 不需要再額外呼叫一次 GET /internal/plan/me 就能立刻顯示「已升級為
// 粉絲專案」。
func (s *Server) handleClaimFanPlan(w http.ResponseWriter, r *http.Request) {
	user := s.userFor(r)
	if s.isGuestUser(user) {
		writeErr(w, http.StatusUnauthorized, "unauthorized", "登入已過期,請重新登入")
		return
	}

	var body claimFanPlanRequest
	if !decode(w, r, &body) {
		return
	}

	// fanPlanClaimCode 每次請求時現讀環境變數(而非啟動時存進 Server
	// struct 快取)——理由同其餘直接讀 os.Getenv 的既有端點慣例(如
	// New() 裡的 GCS_PHOTO_BUCKET),這個值極少變動,現讀的成本可忽略,
	// 换來的好處是測試可以用 t.Setenv 針對單一測試案例覆寫這個值,不需要
	// 額外在 Server struct 上開一個建構參數。
	expectedCode := os.Getenv("FAN_PLAN_CLAIM_CODE")
	// 未設定或 code 不符合,一律回同一種錯誤訊息——不分辨「功能未啟用」
	// 與「code 打錯」這兩種情況,避免讓呼叫端(或外部探測者)從錯誤訊息
	// 差異反推出「這個環境到底有沒有設定這個功能」。
	if expectedCode == "" || body.Code != expectedCode {
		writeErr(w, http.StatusBadRequest, "invalid_code", "核發碼無效")
		return
	}

	if err := s.store.SetUserPlanTier(user.ID, model.PlanTierFan); err != nil {
		writeErr(w, http.StatusInternalServerError, "store_failed", "更新方案失敗")
		return
	}

	writeJSON(w, http.StatusOK, planMeResponse{
		CurrentTier: model.PlanTierFan,
		CurrentPlan: model.PlanFor(model.PlanTierFan),
		Plans:       model.AllPlans(),
	})
}

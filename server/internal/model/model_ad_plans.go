package model

import "time"

// Partner/Campaign/AdPlan——廣告業主自助控制台(/partner/*,見
// server/internal/partnerconsole 與 web/partner 的完整說明)的 API
// DTO。2026-10 定義從 model.go 搬到這個獨立檔案(比照 model_content_page.go/
// model_itinerary_page.go 的既有先例:每個領域各自一個檔案),讓這個
// 領域的型別異動不會跟其他領域混在同一份 diff 裡,能乾淨地獨立
// commit。

// Partner 對應 store.partnerRow(見該型別的完整說明)——廣告業主/聯盟
// 行銷夥伴帳號,/partner/api/* 回傳的身分資訊。2026-10 改動:不再有
// 獨立的 Email/PasswordHash(登入身分已改成複用一般使用者系統,見
// store.partnerRow 完整說明),改含 UserID——前端(web/partner)拿這個
// 值沒有特別用途,純粹讓呼叫端知道「這個業主身分底下是哪個一般使用者
// 帳號」,供除錯/對照用。
type Partner struct {
	ID        string    `json:"id"`
	UserID    string    `json:"userID"`
	Name      string    `json:"name"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

// Campaign 對應 store.campaignRow(見該型別的完整說明)——業主建立的
// 廣告活動檔期。不含 PartnerID——/partner/api/* 的每個端點都是「目前
// 登入業主自己的資源」這個隱含範圍,回應不需要重複告知呼叫端「這是你
// 自己的東西」(對齊 ContentPage 不在 JSON 裡重複暴露目前使用者身分的
// 既有慣例);若之後有需要跨業主彙總的管理端點(例如內部 admin 後台要
// 看全站 campaign),再另外設計專屬的 DTO。
type Campaign struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Status    string    `json:"status"`              // draft | scheduled | active | paused | ended
	Placement string    `json:"placement,omitempty"` // 投放頁面 slug,見 store.campaignRow.Placement
	StartDate string    `json:"startDate"`
	EndDate   string    `json:"endDate"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Placement——GET /partner/api/placements 回傳的單一可投放頁面選項(見
// partnerconsole.validPlacements 的完整說明)。Value 對應
// campaignRow.Placement 實際存進資料庫的 slug,Label 是給 web/partner
// 下拉選單顯示的中文名稱。
type Placement struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// AdPlan 對應 store.adPlanRow(見該型別的完整說明)——隸屬某個 campaign
// 的具體方案內容。Detail 維持原始 JSON 字串(不在這層解析成強型別),
// 比照 ContentPage.Content 的既有模式——不同 Category 的方案內容形狀
// 差異很大,解析/驗證交給前端或日後針對特定 Category 的專屬邏輯處理,
// 這個 DTO 層只負責原樣傳遞。
type AdPlan struct {
	ID         string    `json:"id"`
	CampaignID string    `json:"campaignID"`
	Category   string    `json:"category"`
	Title      string    `json:"title"`
	Status     string    `json:"status"` // draft | published
	Detail     string    `json:"detail"` // JSON 字串
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

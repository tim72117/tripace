package model

// plan.go 定義訂閱方案(第一階段:只建置方案定義跟訂閱介面,不做任何功能
// 限制——使用者明確規格討論確認:兩個方案(免費版/粉絲專案版)、免費版
// 每月 10 次 AI 請求、方案定義寫死常數不做資料庫表。這裡行為參考另一個
// 專案 /Users/caitingyu/Documents/ai-support/backend 的
// internal/quota/plan.go 設計(只是參考其取捨,不是程式碼依賴):方案
// 定義寫死在程式碼常數(一個 Go map),不做資料庫表。
//
// 這是刻意的取捨,不是偷懶:
//   - 好處:改額度(例如把免費版從 10 次調成 20 次)只要改這個檔案、
//     重新部署就立刻對全體免費方案使用者生效,不需要寫 migration、
//     不需要 backfill 既有資料列(如果額度存在資料庫裡,每個使用者
//     或每個方案都要有一筆對應的額度設定列,改價格變成一次資料庫
//     寫入操作,还要處理「新方案上線時舊資料沒有這筆設定」的邊界情況)。
//   - 代價:不能做「後台自助調整方案額度」這種介面——調額度永遠需要
//     工程師改程式碼並重新部署,沒有「營運人員自己在後台改個數字」
//     的彈性。這次任務明確不需要 admin 方案管理介面(見任務範圍),
//     這個代價目前不構成問題。

// PlanTier 是方案代號,存在 users.plan 欄位裡。用一般字串而非資料庫
// enum,新增一個方案代號只要在這裡加一個常數、不需要改資料庫 schema。
type PlanTier string

const (
	// PlanTierFree 是每個帳號預設的方案——沒有任何方案紀錄、或方案代號
	// 查不到對應定義時,一律視為這個方案(見 PlanFor 的 fallback 說明)。
	PlanTierFree PlanTier = "free"

	// PlanTierFan 是「粉絲專案版」——不經過金流,透過固定的核發連結
	// (/fan/<code>,見 server/internal/api/plan.go 的 handleClaimFanPlan)
	// 一次性核發給造訪者,之後就是永久方案(這階段沒有到期/收回機制)。
	PlanTierFan PlanTier = "fan"
)

// DefaultPlanTier 是新帳號建立時、以及任何查不到方案欄位時要 fallback
// 回去的預設方案。固定等於 PlanTierFree。
const DefaultPlanTier = PlanTierFree

// Plan 是一個方案代號對應的具體權益內容。目前只有「每月 AI 請求次數」
// 這一個維度,之後若要再加其他維度(例如同時可開的行程數上限),直接在
// 這個 struct 加欄位、在下面 plans 這個 map 裡各方案補上對應值即可。
type Plan struct {
	// Tier 是這個 Plan 所屬的方案代號,方便呼叫端在只拿到 Plan 值時仍能
	// 取得代號本身(例如序列化成 JSON 回應給前端)。
	Tier PlanTier `json:"tier"`
	// Name 是給使用者看的方案名稱(中文),UI 直接顯示。
	Name string `json:"name"`
	// MonthlyAIRequests 是這個方案每個月可呼叫 AI 規劃對話的次數上限
	// ——對應 POST /internal/plan-ai/chat 的呼叫次數(一次 handlePlanAiChat
	// 呼叫算一次,不是 token 數,也不是加上 reply 那一次)。
	//
	// <= 0 代表「不限制」。這個階段(訂閱方案機制第一階段)只是把這個
	// 數字定義出來、顯示在 UI 上,刻意不實作任何扣額度/攔截邏輯——
	// POST /internal/plan-ai/chat 不會因為這個數字而拒絕任何請求,見
	// server/internal/api/plan_ai_chat.go 開頭的任務範圍說明。下一階段
	// 若要做真正的額度攔截,才需要在這裡的數字基礎上加計數與比對。
	MonthlyAIRequests int `json:"monthlyAIRequests"`
}

// plans 是方案的權威定義表,以 Tier 為 key。新增/調整方案只需要改這個
// map,見檔案開頭的設計取捨說明。
var plans = map[PlanTier]Plan{
	PlanTierFree: {
		Tier:              PlanTierFree,
		Name:              "免費版",
		MonthlyAIRequests: 10,
	},
	PlanTierFan: {
		Tier: PlanTierFan,
		Name: "粉絲專案版",
		// 0 代表這個階段先不限制粉絲版的 AI 請求次數——真正要不要訂一個
		// 具體數字、要不要開始攔截,留給下一階段(額度扣除/攔截邏輯)
		// 決定,這裡只是先把「無限制」這個語意表達出來。
		MonthlyAIRequests: 0,
	},
}

// PlanFor 查詢某個方案代號對應的 Plan 定義,查不到時 fallback 回免費版
// ——理由同 ai-support 的 quota.PlanFor:userRow.Plan 欄位裡存的代號有可能
// 是舊版本留下、現在已經不存在於 plans 這個 map 裡的值(例如方案代號打
// 錯字的歷史資料、或未來真的下架了某個方案),這種情況下 fail safe 回最
// 保守的免費版,而不是直接 panic 或回傳一個空的 Plan{}。
func PlanFor(tier PlanTier) Plan {
	if p, ok := plans[tier]; ok {
		return p
	}
	return plans[PlanTierFree]
}

// AllPlans 回傳目前定義的全部方案,供「訂閱方案」頁面列出兩個方案的名稱
//與額度說明使用——固定回傳 [免費版, 粉絲專案版] 這個順序(UI 展示通常
// 希望方案由低到高排列,不應該依賴 map 的隨機疊代順序),之後若方案數量
// 增加,在這裡维護固定順序即可。
func AllPlans() []Plan {
	return []Plan{
		plans[PlanTierFree],
		plans[PlanTierFan],
	}
}

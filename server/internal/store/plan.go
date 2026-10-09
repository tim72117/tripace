package store

import (
	"errors"

	"github.com/tim72117/tripace/internal/model"
	"gorm.io/gorm"
)

// plan.go — 訂閱方案(model.Plan,見該檔案開頭的完整設計說明)在使用者
// 身上的資料存取層。方案「定義」(名稱、額度)寫死在 model/plan.go 的
// 常數表,這裡只處理「這個使用者目前屬於哪個方案代號」這件事本身的
// 讀寫,對應 users.plan 這個欄位。

// GetUserPlanTier 查詢某個使用者目前的方案代號,找不到使用者回傳
// ErrNotFound。供 GET /internal/plan/me、以及 /v1/me 等需要在回應裡帶
// PlanTier 的端點共用。
func (s *Store) GetUserPlanTier(userID string) (model.PlanTier, error) {
	var r userRow
	err := s.db.Select("plan").Where("id = ?", userID).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return toPlanTier(r.Plan), nil
}

// SetUserPlanTier 把某個使用者的方案代號更新成 tier——目前唯一呼叫端是
// handleClaimFanPlan(核發粉絲專案版),刻意不檢查「是否從 free 升級到
// fan」這種轉移合法性(這階段沒有方案降級/續約等狀態機,呼叫端自己決定
// 什麼時候呼叫這裡)。找不到使用者回傳 ErrNotFound,呼叫端應視為
// 「登入憑證對應的使用者已不存在」,比照其餘 store 方法對這種邊界情況
// 的既有慣例處理。
func (s *Store) SetUserPlanTier(userID string, tier model.PlanTier) error {
	res := s.db.Model(&userRow{}).Where("id = ?", userID).Update("plan", string(tier))
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

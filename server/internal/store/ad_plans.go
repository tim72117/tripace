package store

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/tim72117/tripace/internal/model"
	"gorm.io/gorm"
)

// adPlanRow——廣告方案內容(隸屬某個 campaign 的具體素材/版位/文案)。
// 一個 campaign 可以有多個 plan(例如同一檔期在不同版位各投放一份不同
// 文案),故 CampaignID 不是唯一索引,只是一般外鍵式 index。
//
// Detail 是整份方案內容的 JSON 字串(比照 entryRow.Detail 的既有模式,
// 見該欄位註解:先用 JSON 欄位+Category 判別式,不急著拆表)——不同
// Category(例如 "display"/"deeplink"/"sponsorship")的方案欄位形狀
// 差異很大(見 adAdminDemoData.ts 的 DemoCreative 以及其 group_tour/
// flight 擴充 union),用一個固定欄位的表硬凑所有形狀只會長出一堆
// 永遠是 NULL 的欄位;等實際方案種類與查詢需求穩定後,再評估是否要為
// 特定 Category 拆出獨立子表。
//
// 2026-10 定義從 entity.go 搬到這個檔案(見 entity.go 該處留下的指標
// 註解)——讓這個領域的型別異動不會跟其他領域混在同一份 diff 裡。
type adPlanRow struct {
	ID         string    `gorm:"primaryKey;column:id"`
	CampaignID string    `gorm:"column:campaign_id;not null;index"`
	Category   string    `gorm:"column:category;not null"`
	Title      string    `gorm:"column:title;not null"`
	Status     string    `gorm:"column:status;not null;default:draft"`
	Detail     string    `gorm:"column:detail;not null;default:'{}'"` // JSON
	CreatedAt  time.Time `gorm:"column:created_at;not null"`
	UpdatedAt  time.Time `gorm:"column:updated_at;not null"`
}

func (adPlanRow) TableName() string { return "ad_plans" }

func newAdPlanID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "plan_" + hex.EncodeToString(b)
}

func toAdPlan(r adPlanRow) model.AdPlan {
	return model.AdPlan{
		ID:         r.ID,
		CampaignID: r.CampaignID,
		Category:   r.Category,
		Title:      r.Title,
		Status:     r.Status,
		Detail:     r.Detail,
		CreatedAt:  r.CreatedAt,
		UpdatedAt:  r.UpdatedAt,
	}
}

// CreateAdPlanForPartner 在指定 campaign 底下建立一筆方案內容。先確認
// 這個 campaignID 確實屬於呼叫端業主(透過 GetCampaignForPartner),
// 避免業主把方案掛到別人的 campaign 底下——這是 adPlanRow 沒有直接存
// PartnerID 欄位、改用「先驗證 campaign 歸屬」間接把關的設計(campaignID
// 本身不是使用者可以憑空捏造就通過驗證的值,一定要先存在且屬於自己)。
func (s *Store) CreateAdPlanForPartner(partnerID, campaignID, category, title, detail string) (model.AdPlan, error) {
	if _, err := s.GetCampaignForPartner(partnerID, campaignID); err != nil {
		return model.AdPlan{}, err // 含 ErrNotFound:campaign 不存在或不屬於此業主
	}
	if detail == "" {
		detail = "{}"
	}
	r := adPlanRow{
		ID:         newAdPlanID(),
		CampaignID: campaignID,
		Category:   category,
		Title:      title,
		Status:     "draft",
		Detail:     detail,
		CreatedAt:  now(),
		UpdatedAt:  now(),
	}
	if err := s.db.Create(&r).Error; err != nil {
		return model.AdPlan{}, err
	}
	return toAdPlan(r), nil
}

// ListAdPlansForPartner 列出指定 campaign 底下的所有方案——同樣先驗證
// campaign 歸屬,理由同 CreateAdPlanForPartner。
func (s *Store) ListAdPlansForPartner(partnerID, campaignID string) ([]model.AdPlan, error) {
	if _, err := s.GetCampaignForPartner(partnerID, campaignID); err != nil {
		return nil, err
	}
	var rows []adPlanRow
	if err := s.db.Where("campaign_id = ?", campaignID).Order("created_at DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]model.AdPlan, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAdPlan(r))
	}
	return out, nil
}

// adPlansOwnedByPartner 回傳一個子查詢:屬於 partnerID 名下任一
// campaign 的所有 plan ID 集合。adPlanRow 沒有直接存 PartnerID 欄位
// (見 CreateAdPlanForPartner 的完整說明),所有「這個 plan 屬於哪個
// 業主」的判斷都要間接透過它掛的 campaign 歸屬,這個 helper 把這段
// 子查詢(2026-10 code review 抓到原本在 Update/SetStatus/Delete 三個
// 方法裡各自重複手刻同一段 SQL)收斂成一處——日後若歸屬判斷邏輯要加
// 條件(例如排除某種狀態的 campaign),只需要改這一個函式。
func (s *Store) adPlansOwnedByPartner(partnerID string) *gorm.DB {
	return s.db.Model(&campaignRow{}).Select("id").Where("partner_id = ?", partnerID)
}

// GetAdPlanForPartner 依 ID 查單一方案,同時檢查歸屬(透過
// adPlansOwnedByPartner 子查詢)——partnerID 不符或方案不存在時統一
// 回傳 ErrNotFound,不洩漏存在性,理由同 GetCampaignForPartner 的完整
// 說明。供 partnerconsole 的 updateAdPlan/setAdPlanStatus 在寫入後
// 重新查出完整物件回傳給呼叫端用(對齊 campaign 系列端點的既有行為,
// 2026-10 code review 抓到 setAdPlanStatus 原本漏了這一步,回應空
// body,跟 setCampaignStatus 的既有行為不一致)。
func (s *Store) GetAdPlanForPartner(partnerID, id string) (model.AdPlan, error) {
	var r adPlanRow
	err := s.db.Where("id = ? AND campaign_id IN (?)", id, s.adPlansOwnedByPartner(partnerID)).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.AdPlan{}, ErrNotFound
	}
	if err != nil {
		return model.AdPlan{}, err
	}
	return toAdPlan(r), nil
}

// ListPublishedAdPlansByCampaignID(2026-10 新增)——公開讀取端點用,
// 查指定 campaign 底下所有 status='published' 的方案,不驗證業主歸屬
// (呼叫端是前台公開頁面,campaignID 已經透過
// ListActiveCampaignsByPlacement 篩選過是公開可見的 active 活動,這裡
// 只需要再篩掉草稿方案——業主建方案時預設是 draft,見
// CreateAdPlanForPartner,草稿方案在還沒被業主自己按下「發布」前不該
// 出現在任何訪客看得到的頁面)。
func (s *Store) ListPublishedAdPlansByCampaignID(campaignID string) ([]model.AdPlan, error) {
	var rows []adPlanRow
	if err := s.db.Where("campaign_id = ? AND status = ?", campaignID, "published").
		Order("created_at DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]model.AdPlan, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAdPlan(r))
	}
	return out, nil
}

// UpdateAdPlanForPartner 更新方案內容(標題/分類/Detail JSON)。跟
// campaign 系列方法不同,這裡沒辦法只靠一條 WHERE 子句同時完成「存在
// 且屬於自己」的檢查,改用 adPlansOwnedByPartner 子查詢限定 campaign_id
// 必須落在這個業主名下的 campaign 集合——避免先 SELECT 再比對歸屬的
// 額外往返。
func (s *Store) UpdateAdPlanForPartner(partnerID, id, category, title, detail string) error {
	if detail == "" {
		detail = "{}"
	}
	res := s.db.Model(&adPlanRow{}).
		Where("id = ? AND campaign_id IN (?)", id, s.adPlansOwnedByPartner(partnerID)).
		Updates(map[string]any{"category": category, "title": title, "detail": detail, "updated_at": now()})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// SetAdPlanStatusForPartner 轉換方案狀態(draft/published)。查詢範圍
// 限定理由同 UpdateAdPlanForPartner。
func (s *Store) SetAdPlanStatusForPartner(partnerID, id, status string) error {
	res := s.db.Model(&adPlanRow{}).
		Where("id = ? AND campaign_id IN (?)", id, s.adPlansOwnedByPartner(partnerID)).
		Updates(map[string]any{"status": status, "updated_at": now()})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteAdPlanForPartner 刪除方案——查詢範圍限定理由同上。
func (s *Store) DeleteAdPlanForPartner(partnerID, id string) error {
	res := s.db.Where("id = ? AND campaign_id IN (?)", id, s.adPlansOwnedByPartner(partnerID)).
		Delete(&adPlanRow{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

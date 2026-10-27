package store

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/tim72117/tripace/internal/model"
	"gorm.io/gorm"
)

// campaignRow——廣告活動(業主建立的投放檔期)。PartnerID 是資料歸屬的
// 關鍵欄位——partnerconsole 的每一條查詢都必須帶上 WHERE partner_id = ?
// (呼叫端自己的 partner ID,解析自 JWT),防止業主 A 讀到/改到業主 B 的
// 活動。Status 比照 adSystemData.ts/adAdminDemoData.ts(見
// docs/brainstorm/2026-10-ad-placement-admin-ui-plan.md)的既有構想欄位
// 命名,沿用 draft/scheduled/active/paused/ended 這組狀態機,不重新發明。
//
// StartDate/EndDate 用純日期字串('YYYY-MM-DD',比照 entryRow.Start 的
// 既有模式),不用 time.Time——活動檔期是以「天」為單位的商業概念,不需要
// 時分秒精度,用純日期字串也省去時區換算的麻煩(與 entryRow 同樣理由)。
// Placement(2026-10 新增)——這個活動要投放在哪個前台頁面,最小可行
// 版本:單一字串欄位,直接存頁面 slug(例如 "kyoto-kiyomizu" 對應
// web/src/home/KyotoPage.tsx 的清水寺主題頁),空字串代表尚未指定/
// 不投放任何頁面。刻意不做成 docs/brainstorm/
// 2026-10-ad-placement-admin-ui-plan.md 第 3.2 節規劃的那種多版位
// (placements[])+城市(targetCities[])+裝置(targetDevice)組合條件
// ——那是給贊助模式(admin 代操)設計的完整規劃,業主自助控制台這裡
// 先求「選一個頁面、能夠實際顯示出來」這個最小閉環跑通,之後有實際
// 需求(同一活動要投多個頁面、依城市/裝置篩選)再擴充,不要一次把
// 範圍開太大。索引是因為公開端點(GET /public/ad-plans?placement=...)
// 的查詢路徑就是 WHERE placement = ? AND status = 'active'。
//
// 2026-10 定義從 entity.go 搬到這個檔案(見 entity.go 該處留下的指標
// 註解)——讓這個領域的型別異動不會跟其他領域混在同一份 diff 裡。
type campaignRow struct {
	ID        string    `gorm:"primaryKey;column:id"`
	PartnerID string    `gorm:"column:partner_id;not null;index"`
	Name      string    `gorm:"column:name;not null"`
	Status    string    `gorm:"column:status;not null;default:draft"`
	Placement string    `gorm:"column:placement;index"`
	StartDate string    `gorm:"column:start_date"`
	EndDate   string    `gorm:"column:end_date"`
	CreatedAt time.Time `gorm:"column:created_at;not null"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null"`
}

func (campaignRow) TableName() string { return "campaigns" }

func newCampaignID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "cmp_" + hex.EncodeToString(b)
}

func toCampaign(r campaignRow) model.Campaign {
	return model.Campaign{
		ID:        r.ID,
		Name:      r.Name,
		Status:    r.Status,
		Placement: r.Placement,
		StartDate: r.StartDate,
		EndDate:   r.EndDate,
		CreatedAt: r.CreatedAt,
		UpdatedAt: r.UpdatedAt,
	}
}

// CreateCampaign 替指定業主建立一個廣告活動,狀態固定從 "draft" 開始
// (比照 CreateContentPage 的既有慣例:新建資源一律是草稿,狀態轉換另
// 有專屬方法,不讓呼叫端在建立當下直接指定任意狀態)。placement 選填
// (見 campaignRow.Placement 的完整說明),空字串代表尚未指定投放頁面
// ——這個活動會一直存在但永遠不會被 ListActiveCampaignsByPlacement
// 查到,直到之後透過 UpdateCampaignForPartner 補上。
func (s *Store) CreateCampaign(partnerID, name, placement, startDate, endDate string) (model.Campaign, error) {
	r := campaignRow{
		ID:        newCampaignID(),
		PartnerID: partnerID,
		Name:      name,
		Status:    "draft",
		Placement: placement,
		StartDate: startDate,
		EndDate:   endDate,
		CreatedAt: now(),
		UpdatedAt: now(),
	}
	if err := s.db.Create(&r).Error; err != nil {
		return model.Campaign{}, err
	}
	return toCampaign(r), nil
}

// ListCampaignsByPartner 列出指定業主名下的所有活動,依建立時間新到舊
// ——partnerID 一律由呼叫端(partnerconsole)從驗證過的 JWT 取得,不是
// 使用者可控的輸入,這是整個 partnerconsole 資料歸屬隔離的關鍵:每一條
// 查詢都帶 WHERE partner_id = ?,業主之間互相看不到彼此的活動。
func (s *Store) ListCampaignsByPartner(partnerID string) ([]model.Campaign, error) {
	var rows []campaignRow
	if err := s.db.Where("partner_id = ?", partnerID).Order("created_at DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]model.Campaign, 0, len(rows))
	for _, r := range rows {
		out = append(out, toCampaign(r))
	}
	return out, nil
}

// GetCampaignForPartner 依 ID 查單一活動,同時檢查歸屬——partnerID 不符
// 的活動視同不存在(回傳 ErrNotFound,不回傳 403),避免讓業主能用枚舉
// ID 的方式探測其他業主有哪些活動 ID 存在(fail-closed,不洩漏存在性,
// 對齊 adminconsole.withAdmin 的既有設計哲學)。
func (s *Store) GetCampaignForPartner(partnerID, id string) (model.Campaign, error) {
	var r campaignRow
	err := s.db.Where("id = ? AND partner_id = ?", id, partnerID).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Campaign{}, ErrNotFound
	}
	if err != nil {
		return model.Campaign{}, err
	}
	return toCampaign(r), nil
}

// UpdateCampaignForPartner 更新活動的基本欄位(名稱/投放頁面/檔期),
// 同樣以 partnerID 範圍限定更新對象——WHERE 子句本身就是權限檢查,
// 不需要先 SELECT 再比對歸屬。RowsAffected == 0 代表活動不存在或不
// 屬於這個業主,回傳 ErrNotFound(呼叫端無從分辨兩者,比照
// GetCampaignForPartner 的 fail-closed 理由)。
func (s *Store) UpdateCampaignForPartner(partnerID, id, name, placement, startDate, endDate string) error {
	res := s.db.Model(&campaignRow{}).
		Where("id = ? AND partner_id = ?", id, partnerID).
		Updates(map[string]any{"name": name, "placement": placement, "start_date": startDate, "end_date": endDate, "updated_at": now()})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// SetCampaignStatusForPartner 轉換活動狀態(draft/scheduled/active/
// paused/ended,見 campaignRow 的完整說明)。這裡刻意不驗證狀態轉換的
// 合法順序(例如 ended 之後是否還能轉回 active)——第一版先讓呼叫端
// (日後的前端 SPA)自行決定允許哪些按鈕/轉換,把狀態機規則留在 UI 層,
// 等實際使用情境穩定後再評估是否要收斂到後端強制。
func (s *Store) SetCampaignStatusForPartner(partnerID, id, status string) error {
	res := s.db.Model(&campaignRow{}).
		Where("id = ? AND partner_id = ?", id, partnerID).
		Updates(map[string]any{"status": status, "updated_at": now()})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// ListActiveCampaignsByPlacement(2026-10 新增)——公開讀取端點用,查
// 指定 placement 底下所有 status='active' 的活動,不帶 partnerID(這是
// 前台頁面要顯示給一般訪客看的內容,不是業主自己管理畫面,沒有歸屬
// 範圍的概念)。只回傳 active 狀態——draft/scheduled/paused/ended 都
// 不該出現在公開頁面上(對齊 campaignRow.Status 的狀態機說明:投放
// 系統只看 status === 'active',不自己判斷檔期日期)。
func (s *Store) ListActiveCampaignsByPlacement(placement string) ([]model.Campaign, error) {
	var rows []campaignRow
	if err := s.db.Where("placement = ? AND status = ?", placement, "active").
		Order("created_at DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]model.Campaign, 0, len(rows))
	for _, r := range rows {
		out = append(out, toCampaign(r))
	}
	return out, nil
}

// DeleteCampaignForPartner 刪除活動——同樣以 partnerID 範圍限定。注意
// 這裡沒有串連刪除底下的 adPlanRow(見 ad_plans.go 的
// DeleteAdPlansByCampaign),呼叫端(API handler)需要自行先清掉方案再
// 刪活動,或接受方案變成孤兒列(第一版先不加資料庫層 FK CASCADE,
// 待確認實際刪除流程的需求後再補)。
func (s *Store) DeleteCampaignForPartner(partnerID, id string) error {
	res := s.db.Where("id = ? AND partner_id = ?", id, partnerID).Delete(&campaignRow{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

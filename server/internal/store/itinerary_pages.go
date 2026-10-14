package store

import (
	"crypto/rand"
	"encoding/hex"
	"errors"

	"github.com/tim72117/tripace/internal/model"
	"gorm.io/gorm"
)

// newItineraryPageID 產生範例行程內容 ID(對齊既有 lmk_/ent_/tr_/cpg_
// 風格,見 newContentPageID)。
func newItineraryPageID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "itp_" + hex.EncodeToString(b)
}

func toItineraryPage(r itineraryPageRow) model.ItineraryPage {
	return model.ItineraryPage{
		ID:        r.ID,
		OwnerID:   r.OwnerID,
		Slug:      r.Slug,
		Content:   r.Content,
		Status:    r.Status,
		UpdatedBy: r.UpdatedBy,
		CreatedAt: r.CreatedAt,
		UpdatedAt: r.UpdatedAt,
	}
}

// CreateItineraryPage 建立一筆範例行程內容。slug 的唯一性範圍是「同一個
// ownerID 之內」,對齊 CreateContentPage 的既有設計——目前範例行程只用
// ownerID="" 這個官方命名空間(見 itineraryPageRow 的完整說明),但保留
// 這個參數讓未來若開放使用者自己發布行程,不需要改簽名。
//
// 同一個 (ownerID, slug) 已存在時,交由呼叫端(CLI)決定要不要改用
// UpdateItineraryPageContent,這裡不自動判斷「建立或更新」,對齊
// CreateContentPage 的既有慣例。已存在時回傳 ErrAlreadyExists(建立前
// 先查一次,而非讓底層 unique constraint 違反直接往外傳),理由同
// CreateContentPage 的完整說明(跨 driver 一致、容易理解的錯誤判斷)。
func (s *Store) CreateItineraryPage(ownerID, slug, content, updatedBy string) (model.ItineraryPage, error) {
	if _, err := s.GetItineraryPageBySlug(ownerID, slug); err == nil {
		return model.ItineraryPage{}, ErrAlreadyExists
	} else if !errors.Is(err, ErrNotFound) {
		return model.ItineraryPage{}, err
	}
	r := itineraryPageRow{
		ID:        newItineraryPageID(),
		OwnerID:   ownerID,
		Slug:      slug,
		Content:   content,
		Status:    "draft",
		UpdatedBy: updatedBy,
		CreatedAt: now(),
		UpdatedAt: now(),
	}
	if err := s.db.Create(&r).Error; err != nil {
		// 「先查後建」本身無法防止 race condition,理由同
		// CreateContentPage 的完整說明——這裡同樣用 GORM TranslateError
		// 轉換出的 gorm.ErrDuplicatedKey 判斷(見 isUniqueConstraintViolation
		// 的完整說明),不依賴解析 driver 專屬錯誤字串。
		if isUniqueConstraintViolation(err) {
			return model.ItineraryPage{}, ErrAlreadyExists
		}
		return model.ItineraryPage{}, err
	}
	return toItineraryPage(r), nil
}

// GetItineraryPageBySlug 依 (ownerID, slug) 查單筆範例行程內容——CLI
// itinerary-page get、公開頁面讀取都走這支。查無資料時回傳 ErrNotFound
// (轉換 gorm.ErrRecordNotFound),對齊 GetContentPageBySlug 的既有慣例。
func (s *Store) GetItineraryPageBySlug(ownerID, slug string) (model.ItineraryPage, error) {
	var r itineraryPageRow
	if err := s.db.Where("owner_id = ? AND slug = ?", ownerID, slug).First(&r).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.ItineraryPage{}, ErrNotFound
		}
		return model.ItineraryPage{}, err
	}
	return toItineraryPage(r), nil
}

// ListItineraryPages 回傳全部範例行程內容(不分 ownerID,跨所有使用者),
// 依 owner_id、slug 排序——供 CLI itinerary-page list 列出目前已建檔的
// 行程,不分 draft/published(CLI 操作的是管理端點,管理者需要看到草稿
// 才能決定要不要 publish),對齊 ListContentPages 的既有慣例。
func (s *Store) ListItineraryPages() ([]model.ItineraryPage, error) {
	var rows []itineraryPageRow
	if err := s.db.Order("owner_id ASC, slug ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]model.ItineraryPage, 0, len(rows))
	for _, r := range rows {
		out = append(out, toItineraryPage(r))
	}
	return out, nil
}

// UpdateItineraryPageContent 覆寫一筆範例行程內容的整份內容(對齊
// UpdateContentPageContent 的既有「整段 JSON 覆寫」設計——CLI 的操作
// 模式是「get 一份 JSON、本機編輯、set 整份寫回」,不需要在這一層支援
// 細欄位 patch)。只更新 content/updated_by/updated_at,不動 status——
// 更新內容跟發布狀態是兩個獨立操作(對應 CLI 的 set 跟 publish 兩個
// 動詞),理由同 UpdateContentPageContent 的完整說明。(ownerID, slug)
// 不存在時回傳 ErrNotFound。
func (s *Store) UpdateItineraryPageContent(ownerID, slug, content, updatedBy string) error {
	res := s.db.Model(&itineraryPageRow{}).
		Where("owner_id = ? AND slug = ?", ownerID, slug).
		Updates(map[string]any{"content": content, "updated_by": updatedBy, "updated_at": now()})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// SetItineraryPageStatus 更新一筆範例行程內容的發布狀態("draft" 或
// "published")——供 CLI itinerary-page publish/unpublish 使用,獨立於
// UpdateItineraryPageContent,理由同該方法的完整說明。(ownerID, slug)
// 不存在時回傳 ErrNotFound,理由同 UpdateItineraryPageContent。
func (s *Store) SetItineraryPageStatus(ownerID, slug, status string) error {
	res := s.db.Model(&itineraryPageRow{}).
		Where("owner_id = ? AND slug = ?", ownerID, slug).
		Updates(map[string]any{"status": status, "updated_at": now()})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteItineraryPage 刪除一筆範例行程內容。(ownerID, slug) 不存在時
// 回傳 ErrNotFound,理由同 UpdateItineraryPageContent。
func (s *Store) DeleteItineraryPage(ownerID, slug string) error {
	res := s.db.Where("owner_id = ? AND slug = ?", ownerID, slug).Delete(&itineraryPageRow{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

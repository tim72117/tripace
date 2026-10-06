package store

import (
	"crypto/rand"
	"encoding/hex"
	"errors"

	"github.com/tim72117/tripace/internal/model"
	"gorm.io/gorm"
)

// newThemePageID 產生主題介紹頁 ID(對齊既有 lmk_/ent_/tr_ 風格,見
// newAttractionID)。
func newThemePageID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "thp_" + hex.EncodeToString(b)
}

func toThemePage(r themePageRow) model.ThemePage {
	return model.ThemePage{
		ID:        r.ID,
		Slug:      r.Slug,
		Content:   r.Content,
		Status:    r.Status,
		UpdatedBy: r.UpdatedBy,
		CreatedAt: r.CreatedAt,
		UpdatedAt: r.UpdatedAt,
	}
}

// CreateThemePage 建立一筆主題介紹頁內容。slug 必須唯一(uniqueIndex,
// 見 themePageRow)——同一個 slug 已存在時,交由呼叫端(CLI)決定是要
// 改用 UpdateThemePageContent,還是提示使用者這個 slug 已經建過,這裡
// 不自動判斷「建立或更新」,避免模糊了兩個指令各自的語意(對齊 CLI
// 資源導向語法 add/update 分開的既有慣例,見 main.go buildResources)。
//
// slug 已存在時回傳 ErrAlreadyExists(建立前先查一次,而非讓底層
// unique constraint 違反直接往外傳)——理由:gorm 回傳的違反唯一約束
// 錯誤,SQLite("UNIQUE constraint failed: ...")跟 Postgres
// ("duplicate key value violates unique constraint ...")的錯誤字串
// 格式完全不同,解析 driver 專屬字串來判斷「這是不是重複鍵錯誤」不可靠
// 也不好維護;這裡的建檔操作本身是低頻、人工觸發的 CLI 動作,先查後建
// 多一次查詢的成本可忽略,換來跨 driver 一致、容易理解的錯誤判斷。
func (s *Store) CreateThemePage(slug, content, updatedBy string) (model.ThemePage, error) {
	if _, err := s.GetThemePageBySlug(slug); err == nil {
		return model.ThemePage{}, ErrAlreadyExists
	} else if !errors.Is(err, ErrNotFound) {
		return model.ThemePage{}, err
	}
	r := themePageRow{
		ID:        newThemePageID(),
		Slug:      slug,
		Content:   content,
		Status:    "draft",
		UpdatedBy: updatedBy,
		CreatedAt: now(),
		UpdatedAt: now(),
	}
	if err := s.db.Create(&r).Error; err != nil {
		return model.ThemePage{}, err
	}
	return toThemePage(r), nil
}

// GetThemePageBySlug 依 slug 查單筆主題介紹頁內容——CLI
// theme-page get、公開頁面讀取(見 handlePublicThemePage)都走這支。
// 查無資料時回傳 ErrNotFound(轉換 gorm.ErrRecordNotFound),對齊
// GetPublicLink 等既有 store 方法的慣例,讓 API 層能用
// errors.Is(err, store.ErrNotFound) 判斷並回 404,不需要認得
// gorm 底層的錯誤型別。
func (s *Store) GetThemePageBySlug(slug string) (model.ThemePage, error) {
	var r themePageRow
	if err := s.db.Where("slug = ?", slug).First(&r).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.ThemePage{}, ErrNotFound
		}
		return model.ThemePage{}, err
	}
	return toThemePage(r), nil
}

// ListThemePages 回傳全部主題介紹頁,依 slug 排序——供 CLI
// theme-page list 列出目前已建檔的頁面,不分 draft/published(CLI 操作
// 的是管理端點,管理者需要看到草稿才能決定要不要 publish)。
func (s *Store) ListThemePages() ([]model.ThemePage, error) {
	var rows []themePageRow
	if err := s.db.Order("slug ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]model.ThemePage, 0, len(rows))
	for _, r := range rows {
		out = append(out, toThemePage(r))
	}
	return out, nil
}

// UpdateThemePageContent 覆寫一筆主題介紹頁的整份內容(對齊既有
// entry update -detail JSON 的「整段 JSON 覆寫」先例,見
// entryRow.Detail)——不是欄位級局部更新,CLI 的操作模式是「get 一份
// JSON、本機編輯、set 整份寫回」,不需要在這一層支援細欄位 patch。
// 只更新 content/updated_by/updated_at,不動 status——更新內容跟
// 發布狀態是兩個獨立操作(對應 CLI 的 set 跟 publish 兩個動詞),
// 避免每次改內容都意外把已發布的頁面打回草稿,或反過來意外發布
// 還在編輯中的草稿。slug 不存在時回傳 ErrNotFound(對齊
// UpdateAdminPassword 等既有方法檢查 RowsAffected 的慣例)——
// GORM 的 Updates() 在 WHERE 條件沒有命中任何列時,Error 仍是 nil,
// 若不額外檢查 RowsAffected,呼叫端(API handler)會把「這個 slug
// 根本不存在」誤判成「更新成功」。
func (s *Store) UpdateThemePageContent(slug, content, updatedBy string) error {
	res := s.db.Model(&themePageRow{}).
		Where("slug = ?", slug).
		Updates(map[string]any{"content": content, "updated_by": updatedBy, "updated_at": now()})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// SetThemePageStatus 更新一筆主題介紹頁的發布狀態("draft" 或
// "published")——供 CLI theme-page publish/unpublish 使用,獨立於
// UpdateThemePageContent,理由見該方法的完整說明。slug 不存在時回傳
// ErrNotFound,理由同 UpdateThemePageContent。
func (s *Store) SetThemePageStatus(slug, status string) error {
	res := s.db.Model(&themePageRow{}).
		Where("slug = ?", slug).
		Updates(map[string]any{"status": status, "updated_at": now()})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteThemePage 刪除一筆主題介紹頁內容。slug 不存在時回傳
// ErrNotFound,理由同 UpdateThemePageContent。
func (s *Store) DeleteThemePage(slug string) error {
	res := s.db.Where("slug = ?", slug).Delete(&themePageRow{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

package store

import (
	"crypto/rand"
	"encoding/hex"
	"errors"

	"github.com/tim72117/tripace/internal/model"
	"gorm.io/gorm"
)

// newContentPageID 產生主題介紹頁/部落格文章內容 ID(對齊既有 lmk_/
// ent_/tr_ 風格,見 newAttractionID)。前綴從改名前的 "thp_"
// (theme page)改成 "cpg_"(content page),對齊型別/表名一起改名
// (見 contentPageRow 的完整說明)——這張表從未進入 main、正式環境
// 未部署過,不存在既有資料列用舊前綴、需要相容新舊前綴並存的情境。
func newContentPageID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "cpg_" + hex.EncodeToString(b)
}

func toContentPage(r contentPageRow) model.ContentPage {
	return model.ContentPage{
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

// CreateContentPage 建立一筆主題介紹頁/部落格文章內容。slug 的唯一性
// 範圍是「同一個 ownerID 之內」,不是全域(2026-10 改動,見 contentPageRow
// 的完整說明)——ownerID 傳空字串時,等同既有城市介紹頁共用的「系統
// 帳號」命名空間,此時行為與改動前的全域唯一完全一致;ownerID 不是
// 空字串時,不同使用者可以各自使用相同的 slug 互不衝突。
//
// 同一個 (ownerID, slug) 已存在時,交由呼叫端(CLI/部落格發文 API)
// 決定是要改用 UpdateContentPageContent,還是提示使用者這組已經建過,
// 這裡不自動判斷「建立或更新」,避免模糊了兩個指令各自的語意(對齊
// CLI 資源導向語法 add/update 分開的既有慣例,見 main.go
// buildResources)。
//
// 已存在時回傳 ErrAlreadyExists(建立前先查一次,而非讓底層 unique
// constraint 違反直接往外傳)——理由:gorm 回傳的違反唯一約束錯誤,
// SQLite("UNIQUE constraint failed: ...")跟 Postgres("duplicate key
// value violates unique constraint ...")的錯誤字串格式完全不同,解析
// driver 專屬字串來判斷「這是不是重複鍵錯誤」不可靠也不好維護;這裡
// 的建檔操作本身是低頻動作,先查後建多一次查詢的成本可忽略,換來跨
// driver 一致、容易理解的錯誤判斷。
func (s *Store) CreateContentPage(ownerID, slug, content, updatedBy string) (model.ContentPage, error) {
	if _, err := s.GetContentPageBySlug(ownerID, slug); err == nil {
		return model.ContentPage{}, ErrAlreadyExists
	} else if !errors.Is(err, ErrNotFound) {
		return model.ContentPage{}, err
	}
	r := contentPageRow{
		ID:        newContentPageID(),
		OwnerID:   ownerID,
		Slug:      slug,
		Content:   content,
		Status:    "draft",
		UpdatedBy: updatedBy,
		CreatedAt: now(),
		UpdatedAt: now(),
	}
	if err := s.db.Create(&r).Error; err != nil {
		// 「先查後建」(上方的 GetContentPageBySlug)本身無法防止 race
		// condition:兩個併發請求可能都通過了那次查詢(當時都還不存在),
		// 其中一個最終在這裡撞上資料庫的唯一索引違反。這裡額外判斷寫入
		// 失敗是不是「違反唯一約束」造成的,是的話轉換成 ErrAlreadyExists
		// ——不依賴解析 driver 專屬錯誤字串(理由同上方「已存在時回傳
		// ErrAlreadyExists」一節的完整說明),而是透過 GORM TranslateError
		// 轉換出的 gorm.ErrDuplicatedKey 判斷(見 isUniqueConstraintViolation
		// 的完整說明),讓呼叫端的 errors.Is(err, store.ErrAlreadyExists)
		// 在併發情境下也能正確命中,回應設計中的 409 而非落入通用 500。
		if isUniqueConstraintViolation(err) {
			return model.ContentPage{}, ErrAlreadyExists
		}
		return model.ContentPage{}, err
	}
	return toContentPage(r), nil
}

// GetContentPageBySlug 依 (ownerID, slug) 查單筆主題介紹頁/部落格文章
// 內容——CLI content-page get、公開頁面讀取(見 handlePublicContentPage/
// handlePublicBlogArticle)都走這支。ownerID 傳空字串查詢既有城市
// 介紹頁的系統帳號命名空間(見 contentPageRow 的完整說明)。查無資料時
// 回傳 ErrNotFound(轉換 gorm.ErrRecordNotFound),對齊 GetPublicLink
// 等既有 store 方法的慣例,讓 API 層能用 errors.Is(err,
// store.ErrNotFound) 判斷並回 404,不需要認得 gorm 底層的錯誤型別。
func (s *Store) GetContentPageBySlug(ownerID, slug string) (model.ContentPage, error) {
	var r contentPageRow
	if err := s.db.Where("owner_id = ? AND slug = ?", ownerID, slug).First(&r).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.ContentPage{}, ErrNotFound
		}
		return model.ContentPage{}, err
	}
	return toContentPage(r), nil
}

// ListContentPages 回傳全部主題介紹頁/部落格文章(不分 ownerID,跨所有
// 使用者),依 owner_id、slug 排序——供 CLI content-page list 列出目前
// 已建檔的頁面,不分 draft/published(CLI 操作的是管理端點,管理者
// 需要看到草稿才能決定要不要 publish)。2026-10 排序鍵改成
// (owner_id, slug)——改動前只有 slug 一個排序鍵,當時 slug 全域唯一、
// 本身就是穩定排序依據;現在不同 owner 可能有相同 slug(見
// contentPageRow 的完整說明),只排 slug 會讓同名文章在清單裡交錯穿插、
// 難以辨認分別屬於哪個 owner,加上 owner_id 當第一排序鍵讓同一個
// owner 的文章聚在一起顯示。
func (s *Store) ListContentPages() ([]model.ContentPage, error) {
	var rows []contentPageRow
	if err := s.db.Order("owner_id ASC, slug ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]model.ContentPage, 0, len(rows))
	for _, r := range rows {
		out = append(out, toContentPage(r))
	}
	return out, nil
}

// UpdateContentPageContent 覆寫一筆主題介紹頁/部落格文章的整份內容
// (對齊既有 entry update -detail JSON 的「整段 JSON 覆寫」先例,見
// entryRow.Detail)——不是欄位級局部更新,CLI 的操作模式是「get 一份
// JSON、本機編輯、set 整份寫回」,不需要在這一層支援細欄位 patch。
// 只更新 content/updated_by/updated_at,不動 status——更新內容跟
// 發布狀態是兩個獨立操作(對應 CLI 的 set 跟 publish 兩個動詞),
// 避免每次改內容都意外把已發布的頁面打回草稿,或反過來意外發布
// 還在編輯中的草稿。(ownerID, slug) 不存在時回傳 ErrNotFound(對齊
// UpdateAdminPassword 等既有方法檢查 RowsAffected 的慣例)——
// GORM 的 Updates() 在 WHERE 條件沒有命中任何列時,Error 仍是 nil,
// 若不額外檢查 RowsAffected,呼叫端(API handler)會把「這組不存在」
// 誤判成「更新成功」。
func (s *Store) UpdateContentPageContent(ownerID, slug, content, updatedBy string) error {
	res := s.db.Model(&contentPageRow{}).
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

// SetContentPageStatus 更新一筆主題介紹頁/部落格文章的發布狀態("draft"
// 或 "published")——供 CLI content-page publish/unpublish 使用,獨立於
// UpdateContentPageContent,理由見該方法的完整說明。(ownerID, slug)
// 不存在時回傳 ErrNotFound,理由同 UpdateContentPageContent。
func (s *Store) SetContentPageStatus(ownerID, slug, status string) error {
	res := s.db.Model(&contentPageRow{}).
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

// DeleteContentPage 刪除一筆主題介紹頁/部落格文章內容。(ownerID, slug)
// 不存在時回傳 ErrNotFound,理由同 UpdateContentPageContent。
func (s *Store) DeleteContentPage(ownerID, slug string) error {
	res := s.db.Where("owner_id = ? AND slug = ?", ownerID, slug).Delete(&contentPageRow{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

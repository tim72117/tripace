package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

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
		Title:     r.Title,
		Content:   r.Content,
		Status:    r.Status,
		UpdatedBy: r.UpdatedBy,
		CreatedAt: r.CreatedAt,
		UpdatedAt: r.UpdatedAt,
	}
}

// extractContentPageTitle 從 content JSON 字串裡抽出 title 欄位,供
// CreateContentPage/UpdateContentPageContent 寫入時順便填入 contentPageRow.Title
// 這個反正規化快取欄位(見該欄位的完整說明)。
//
// 刻意只解析這一個欄位、用最小的匿名 struct,不是完整反序列化成對應
// ThemePageContent 的巢狀 struct——理由同本檔開頭/model.ContentPage.Content
// 的既有原則:後端不需要認得 blocks 內部每種 kind 的完整形狀,這裡只是
// 為了取出 title 這個頂層字串欄位做一次性的輕量解析,不是要反向驗證
// 或處理整份內容結構。
//
// 解析失敗(content 不是合法 JSON,或沒有 title 欄位)時回傳空字串,
// 不中斷呼叫端的建立/更新流程——title 只是輔助列表顯示用的快取,不是
// 資料正確性的關鍵路徑,content 本身才是權威來源(見 isJSONObject 在
// API 層已經做過的「至少是個 JSON 物件」檢查,這裡只是在那之後再往下
// 多抽一層,失敗時不應該讓整個寫入請求跟著失敗)。
func extractContentPageTitle(content string) string {
	var parsed struct {
		Title string `json:"title"`
	}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return ""
	}
	return parsed.Title
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
		Title:     extractContentPageTitle(content),
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

// ListContentPagesByOwner 回傳指定 ownerID 底下的全部主題介紹頁/部落格
// 文章(不分 draft/published),依 slug 排序——供「我的文章列表」這類
// 「使用者查詢自己發表過的文章」情境使用(對齊 ListContentPages 不分
// draft/published 的既有語意:使用者在自己的列表裡也該看到還沒發布的
// 草稿,才能決定要不要發布,不是只給 CLI 管理端點這個待遇)。
//
// 跟 ListContentPages 的差異只在多了 ownerID 篩選條件——ListContentPages
// 是「列出全站所有人的文章」(CLI 專用,不分 owner),這支是「只列出
// 這一個使用者自己的文章」(給一般使用者查詢自己資料的 API 用,見
// handleMyContentPageList)。排序鍵只需要 slug(不像 ListContentPages
// 還要多排 owner_id 來源——這裡本來就已經是單一 owner 底下的清單,不會
// 有跨 owner 交錯顯示的問題)。
func (s *Store) ListContentPagesByOwner(ownerID string) ([]model.ContentPage, error) {
	var rows []contentPageRow
	if err := s.db.Where("owner_id = ?", ownerID).Order("slug ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]model.ContentPage, 0, len(rows))
	for _, r := range rows {
		out = append(out, toContentPage(r))
	}
	return out, nil
}

// FilterPhotoIDsReferencedByPublishedContent 從給定的 photoId 清單裡
// 篩出「目前至少被一篇 status='published' 文章的 content 引用」的那些
// ——供 handlePublicBlogPhotosByIDs 做授權檢查用(見該 handler 的完整
// 說明)。
//
// Content 欄位刻意是不透明的 JSON 字串(見 contentPageRow 的完整
// 說明,後端不解析 ThemePageContent 內部結構),這裡延續同一個原則,
// 不把 content 反序列化成結構再逐一走訪 blocks 比對 photoId,改用
// SQL LIKE 直接對字串做子字串比對——photoId 固定是 "upf_" + 12 碼
// hex(見 newUploadedPhotoID),不含任何萬用字元特殊符號,也不會是
// 另一個 photoId 的子字串,字串比對不會有誤判風險。這個查詢規模是
// 「整個站台目前已發布的文章數」,不是依 owner 篩選過的小範圍,但
// 預期這批文章量體遠小於需要分頁處理的程度,一次性全表掃描在目前
// 規模下是合理的簡單實作;若未來文章量成長到有效能疑慮,可以考慮
// 改成在 publish 時把引用的 photoId 清單另存一張關聯表。
func (s *Store) FilterPhotoIDsReferencedByPublishedContent(ids []string) ([]string, error) {
	if len(ids) == 0 {
		return []string{}, nil
	}

	var rows []contentPageRow
	if err := s.db.Where("status = ?", "published").Find(&rows).Error; err != nil {
		return nil, err
	}

	referenced := make([]string, 0, len(ids))
	for _, id := range ids {
		for _, r := range rows {
			if strings.Contains(r.Content, id) {
				referenced = append(referenced, id)
				break
			}
		}
	}
	return referenced, nil
}

// UpdateContentPageContent 覆寫一筆主題介紹頁/部落格文章的整份內容
// (對齊既有 entry update -detail JSON 的「整段 JSON 覆寫」先例,見
// entryRow.Detail)——不是欄位級局部更新,CLI 的操作模式是「get 一份
// JSON、本機編輯、set 整份寫回」,不需要在這一層支援細欄位 patch。
// 只更新 content/title/updated_by/updated_at,不動 status——更新內容
// 跟發布狀態是兩個獨立操作(對應 CLI 的 set 跟 publish 兩個動詞),
// 避免每次改內容都意外把已發布的頁面打回草稿,或反過來意外發布
// 還在編輯中的草稿。title 每次都跟著 content 一起重新解析覆寫(見
// extractContentPageTitle 的完整說明)——這是它唯一的更新入口,保證
// 這個反正規化快取欄位不會跟 content 裡實際的 title 長期不同步(例如
// 使用者改了標題只更新 content、忘記同步另一個獨立的 title 參數這種
// 情境在這裡不存在,因為呼叫端從頭到尾不需要知道有這個欄位)。
// (ownerID, slug) 不存在時回傳 ErrNotFound(對齊 UpdateAdminPassword
// 等既有方法檢查 RowsAffected 的慣例)——GORM 的 Updates() 在 WHERE
// 條件沒有命中任何列時,Error 仍是 nil,若不額外檢查 RowsAffected,
// 呼叫端(API handler)會把「這組不存在」誤判成「更新成功」。
func (s *Store) UpdateContentPageContent(ownerID, slug, content, updatedBy string) error {
	res := s.db.Model(&contentPageRow{}).
		Where("owner_id = ? AND slug = ?", ownerID, slug).
		Updates(map[string]any{
			"content":    content,
			"title":      extractContentPageTitle(content),
			"updated_by": updatedBy,
			"updated_at": now(),
		})
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

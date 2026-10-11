// blog_profiles.go——「部落客公開身份」設定的 CRUD(見 blogProfileRow
// 的完整說明)。這張表的規模與存取頻率都遠低於 content_pages(每個使用者
// 最多一筆),目前只提供部落格文章路由(/u/{handle}/{slug})查詢需要的
// 最小操作集合:依 handle 查 profile(把 handle 解析成 UserID,供
// content_pages 查詢使用)、建立/更新 profile(讓使用者設定或修改自己的
// handle/頭像)。
package store

import (
	"crypto/rand"
	"encoding/hex"
	"errors"

	"github.com/tim72117/tripace/internal/model"
	"gorm.io/gorm"
)

// newBlogProfileID 產生部落客設定 ID(對齊既有 lmk_/ent_/tr_/cpg_ 風格,
// 見 newContentPageID)。
func newBlogProfileID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "bpf_" + hex.EncodeToString(b)
}

func toBlogProfile(r blogProfileRow) model.BlogProfile {
	return model.BlogProfile{
		ID:        r.ID,
		UserID:    r.UserID,
		Handle:    r.Handle,
		AvatarURL: r.AvatarURL,
		CreatedAt: r.CreatedAt,
		UpdatedAt: r.UpdatedAt,
	}
}

// GetBlogProfileByHandle 依 handle 查詢部落客設定——部落格文章路由
// (/u/{handle}/{slug})的第一步:先把 URL 上人類可讀的 handle 解析成
// 穩定的 UserID,再拿 UserID 去查 content_pages(見 GetContentPageBySlug
// 的完整說明,ownerID 參數即這裡解析出的 UserID)。查無資料時回傳
// ErrNotFound,對齊本檔案與其餘 store 方法的既有慣例。
func (s *Store) GetBlogProfileByHandle(handle string) (model.BlogProfile, error) {
	var r blogProfileRow
	if err := s.db.Where("handle = ?", handle).First(&r).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.BlogProfile{}, ErrNotFound
		}
		return model.BlogProfile{}, err
	}
	return toBlogProfile(r), nil
}

// GetBlogProfileByUserID 依 UserID 查詢部落客設定——供使用者自己查詢/
// 編輯自己的部落格設定時使用(UserID 來自登入後的 JWT,不是 URL 參數,
// 不需要像 GetBlogProfileByHandle 那樣先做一次名稱解析)。
func (s *Store) GetBlogProfileByUserID(userID string) (model.BlogProfile, error) {
	var r blogProfileRow
	if err := s.db.Where("user_id = ?", userID).First(&r).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.BlogProfile{}, ErrNotFound
		}
		return model.BlogProfile{}, err
	}
	return toBlogProfile(r), nil
}

// CreateBlogProfile 幫一個使用者建立部落客設定(一對一,見 blogProfileRow
// UserID 的 uniqueIndex 說明)。handle/userID 已存在時分別回傳
// ErrAlreadyExists——跟 CreateContentPage 同樣的「先查後建」理由(見該
// 方法的完整說明:避免依賴 driver 專屬的唯一約束錯誤字串解析)。
func (s *Store) CreateBlogProfile(userID, handle, avatarURL string) (model.BlogProfile, error) {
	if _, err := s.GetBlogProfileByUserID(userID); err == nil {
		return model.BlogProfile{}, ErrAlreadyExists
	} else if !errors.Is(err, ErrNotFound) {
		return model.BlogProfile{}, err
	}
	if _, err := s.GetBlogProfileByHandle(handle); err == nil {
		return model.BlogProfile{}, ErrAlreadyExists
	} else if !errors.Is(err, ErrNotFound) {
		return model.BlogProfile{}, err
	}
	r := blogProfileRow{
		ID:        newBlogProfileID(),
		UserID:    userID,
		Handle:    handle,
		AvatarURL: avatarURL,
		CreatedAt: now(),
		UpdatedAt: now(),
	}
	if err := s.db.Create(&r).Error; err != nil {
		// 理由同 CreateContentPage 的完整說明:上面兩次「先查」本身無法
		// 防止 race condition(兩個併發請求可能都通過檢查),這裡對最終
		// 寫入失敗再做一層判斷,是唯一約束違反就轉換成 ErrAlreadyExists,
		// 不依賴解析 driver 專屬錯誤字串(見 isUniqueConstraintViolation
		// 的完整說明)。
		if isUniqueConstraintViolation(err) {
			return model.BlogProfile{}, ErrAlreadyExists
		}
		return model.BlogProfile{}, err
	}
	return toBlogProfile(r), nil
}

// UpdateBlogProfile 更新一個使用者既有的部落客設定(改 handle 和/或
// 頭像網址)——供「使用者設定自己的部落客身份」這個 upsert 端點在
// GetBlogProfileByUserID 已經查到既有記錄時呼叫(見 api/blog_profile.go
// 的完整說明)。(userID, handle, avatarURL) 這組參數簽名比照
// CreateBlogProfile,呼叫端不需要為了「建立」跟「更新」各自組不同的
// 參數形狀。
//
// handle 唯一性檢查採「先查後改」模式(對齊 CreateBlogProfile 的「先查
// 後建」,見該方法的完整說明:避免依賴 driver 專屬的唯一約束錯誤字串
// 解析)——如果使用者想改成一個已經被別人用掉的 handle,要能偵測並
// 回傳 ErrAlreadyExists,而不是讓底層 unique constraint 違反直接往外
// 傳。這裡刻意排除「查到的那筆就是自己」的情況(用 UserID 比對),
// 否則使用者送出跟目前完全相同的 handle(例如只改了頭像網址,handle
// 沒變)會被誤判成「被別人用掉」。
//
// userID 本身不存在(從未呼叫過 CreateBlogProfile)時回傳 ErrNotFound
// (對齊 UpdateContentPageContent 檢查 RowsAffected 的既有慣例)——這支
// 方法只負責「改既有記錄」,呼叫端(handleBlogProfileSet)已經先用
// GetBlogProfileByUserID 確認過記錄存在才會呼叫到這裡,正常情況下不會
// 真的命中這個分支,但仍需要防呆,不能讓 RowsAffected == 0 被誤判成
// 更新成功。
func (s *Store) UpdateBlogProfile(userID, handle, avatarURL string) error {
	if existing, err := s.GetBlogProfileByHandle(handle); err == nil {
		if existing.UserID != userID {
			return ErrAlreadyExists
		}
	} else if !errors.Is(err, ErrNotFound) {
		return err
	}

	res := s.db.Model(&blogProfileRow{}).
		Where("user_id = ?", userID).
		Updates(map[string]any{"handle": handle, "avatar_url": avatarURL, "updated_at": now()})
	if res.Error != nil {
		// 理由同 CreateContentPage/CreateBlogProfile 的完整說明:上方
		// 「先查後改」本身無法防止 race condition(兩個併發請求都想把
		// handle 改成同一個還沒被佔用的值,都通過了上面那次檢查),這裡
		// 對最終寫入失敗再做一層判斷,是唯一約束違反就轉換成
		// ErrAlreadyExists,不依賴解析 driver 專屬錯誤字串(見
		// isUniqueConstraintViolation 的完整說明)。
		if isUniqueConstraintViolation(res.Error) {
			return ErrAlreadyExists
		}
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

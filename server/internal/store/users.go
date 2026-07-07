package store

import (
	"errors"

	"github.com/tim72117/shuttle/internal/model"
	"gorm.io/gorm"
)

// toUser 把 entity 轉成 API DTO(只取公開欄位)。
func toUser(r userRow) model.User {
	return model.User{ID: r.ID, Name: r.Name, AvatarColor: r.AvatarColor}
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// FindUserByAppleSub 依 Apple sub 查使用者,找不到回傳 ErrNotFound。
func (s *Store) FindUserByAppleSub(sub string) (model.User, error) {
	var r userRow
	err := s.db.Where("apple_sub = ?", sub).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.User{}, ErrNotFound
	}
	if err != nil {
		return model.User{}, err
	}
	return toUser(r), nil
}

// GetUserEmail 依使用者 ID 取 email(私密資料,供自己的帳號端點);無 email 回空字串。
func (s *Store) GetUserEmail(id string) (string, error) {
	var r userRow
	err := s.db.Select("email").Where("id = ?", id).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if r.Email == nil {
		return "", nil
	}
	return *r.Email, nil
}

// FindUserByID 依使用者 ID 查使用者。
func (s *Store) FindUserByID(id string) (model.User, error) {
	var r userRow
	err := s.db.Where("id = ?", id).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.User{}, ErrNotFound
	}
	if err != nil {
		return model.User{}, err
	}
	return toUser(r), nil
}

// CreateAppleUser 建立一個由 Apple 登入而來的使用者。
func (s *Store) CreateAppleUser(id, name, avatarColor, appleSub string) (model.User, error) {
	r := userRow{ID: id, Name: name, AvatarColor: avatarColor, AppleSub: strPtr(appleSub)}
	if err := s.db.Create(&r).Error; err != nil {
		return model.User{}, err
	}
	return toUser(r), nil
}

// FindUserByEmail 依 email 查使用者,連同密碼雜湊一併回傳(供登入驗證)。
// 找不到回傳 ErrNotFound;passwordHash 可能為空字串(該帳號未設密碼,如 Apple 使用者)。
func (s *Store) FindUserByEmail(email string) (model.User, string, error) {
	var r userRow
	err := s.db.Where("email = ?", email).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.User{}, "", ErrNotFound
	}
	if err != nil {
		return model.User{}, "", err
	}
	hash := ""
	if r.PasswordHash != nil {
		hash = *r.PasswordHash
	}
	return toUser(r), hash, nil
}

// CreatePasswordUser 建立一個帳密使用者。email 須唯一(衝突時回傳 error)。
func (s *Store) CreatePasswordUser(id, name, avatarColor, email, passwordHash string) (model.User, error) {
	r := userRow{
		ID:           id,
		Name:         name,
		AvatarColor:  avatarColor,
		Email:        strPtr(email),
		PasswordHash: strPtr(passwordHash),
	}
	if err := s.db.Create(&r).Error; err != nil {
		return model.User{}, err
	}
	return toUser(r), nil
}

// SetUserPassword 為既有使用者設定 email 與密碼雜湊(seed 示範使用者用,冪等)。
func (s *Store) SetUserPassword(id, email, passwordHash string) error {
	return s.db.Model(&userRow{}).Where("id = ?", id).
		Updates(map[string]any{"email": email, "password_hash": passwordHash}).Error
}

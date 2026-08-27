package store

import (
	"errors"

	"github.com/tim72117/tripace/internal/model"
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

// FindUserByGoogleSub 依 Google sub 查使用者,找不到回傳 ErrNotFound。
func (s *Store) FindUserByGoogleSub(sub string) (model.User, error) {
	var r userRow
	err := s.db.Where("google_sub = ?", sub).First(&r).Error
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

// CreateGoogleUser 建立一個由 Google 登入而來的使用者。
func (s *Store) CreateGoogleUser(id, name, avatarColor, googleSub string) (model.User, error) {
	r := userRow{ID: id, Name: name, AvatarColor: avatarColor, GoogleSub: strPtr(googleSub)}
	if err := s.db.Create(&r).Error; err != nil {
		return model.User{}, err
	}
	return toUser(r), nil
}

// LinkGoogleSubByEmail 把 googleSub 補到既有帳號(依 email 查找)上——供
// 「Google 登入時,google_sub 沒對應到任何使用者,但該 email(已驗證)已存在
// 於 users 表(不論原本是帳密使用者或 Apple 使用者)」的情境使用,讓同一個
// email 不論用哪種方式登入都能落到同一個帳號,而不是報錯或建立重複帳號。
//
// 呼叫端(handleGoogleAuth)必須先確認 Google 回傳的 email_verified 為
// true 才可呼叫這裡——這是這個「依 email 自動合併帳號」機制唯一的安全
// 前提,未驗證的 email 絕不可用來合併,否則會造成 account takeover
// (攻擊者用一個尚未驗證、但字面上等於受害者 email 的 Google 帳號登入,
// 就能接管受害者在 tripace 的既有帳號)。
//
// email 欄位有 uniqueIndex(見 entity.go),故最多只會有一筆吻合;找不到
// 回傳 ErrNotFound,呼叫端應改建立新使用者。
func (s *Store) LinkGoogleSubByEmail(email, googleSub string) (model.User, error) {
	var r userRow
	err := s.db.Where("email = ?", email).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.User{}, ErrNotFound
	}
	if err != nil {
		return model.User{}, err
	}
	if err := s.db.Model(&userRow{}).Where("id = ?", r.ID).
		Update("google_sub", googleSub).Error; err != nil {
		return model.User{}, err
	}
	r.GoogleSub = strPtr(googleSub)
	return toUser(r), nil
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

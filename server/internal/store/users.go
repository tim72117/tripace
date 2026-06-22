package store

import (
	"database/sql"
	"errors"

	"github.com/channel/server/internal/model"
)

// FindUserByAppleSub 依 Apple sub 查使用者,找不到回傳 ErrNotFound。
func (s *Store) FindUserByAppleSub(sub string) (model.User, error) {
	var u model.User
	err := s.db.QueryRow(
		`SELECT id, name, avatar_color FROM users WHERE apple_sub = ?`, sub).
		Scan(&u.ID, &u.Name, &u.AvatarColor)
	if errors.Is(err, sql.ErrNoRows) {
		return model.User{}, ErrNotFound
	}
	if err != nil {
		return model.User{}, err
	}
	return u, nil
}

// FindUserByID 依使用者 ID 查使用者。
func (s *Store) FindUserByID(id string) (model.User, error) {
	var u model.User
	err := s.db.QueryRow(
		`SELECT id, name, avatar_color FROM users WHERE id = ?`, id).
		Scan(&u.ID, &u.Name, &u.AvatarColor)
	if errors.Is(err, sql.ErrNoRows) {
		return model.User{}, ErrNotFound
	}
	if err != nil {
		return model.User{}, err
	}
	return u, nil
}

// CreateAppleUser 建立一個由 Apple 登入而來的使用者。
func (s *Store) CreateAppleUser(id, name, avatarColor, appleSub string) (model.User, error) {
	_, err := s.db.Exec(
		`INSERT INTO users (id, name, avatar_color, apple_sub) VALUES (?, ?, ?, ?)`,
		id, name, avatarColor, appleSub)
	if err != nil {
		return model.User{}, err
	}
	return model.User{ID: id, Name: name, AvatarColor: avatarColor}, nil
}

// FindUserByEmail 依 email 查使用者,連同密碼雜湊一併回傳(供登入驗證)。
// 找不到回傳 ErrNotFound;passwordHash 可能為空字串(該帳號未設密碼,如 Apple 使用者)。
func (s *Store) FindUserByEmail(email string) (u model.User, passwordHash string, err error) {
	var hash sql.NullString
	err = s.db.QueryRow(
		`SELECT id, name, avatar_color, password_hash FROM users WHERE email = ?`, email).
		Scan(&u.ID, &u.Name, &u.AvatarColor, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		return model.User{}, "", ErrNotFound
	}
	if err != nil {
		return model.User{}, "", err
	}
	return u, hash.String, nil
}

// CreatePasswordUser 建立一個帳密使用者。email 須唯一(衝突時回傳 error)。
func (s *Store) CreatePasswordUser(id, name, avatarColor, email, passwordHash string) (model.User, error) {
	_, err := s.db.Exec(
		`INSERT INTO users (id, name, avatar_color, email, password_hash) VALUES (?, ?, ?, ?, ?)`,
		id, name, avatarColor, email, passwordHash)
	if err != nil {
		return model.User{}, err
	}
	return model.User{ID: id, Name: name, AvatarColor: avatarColor}, nil
}

// SetUserPassword 為既有使用者設定 email 與密碼雜湊(seed 示範使用者用,冪等)。
func (s *Store) SetUserPassword(id, email, passwordHash string) error {
	_, err := s.db.Exec(
		`UPDATE users SET email = ?, password_hash = ? WHERE id = ?`,
		email, passwordHash, id)
	return err
}

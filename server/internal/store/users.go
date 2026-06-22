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

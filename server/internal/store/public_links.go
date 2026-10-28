package store

import (
	"crypto/rand"
	"encoding/hex"
	"errors"

	"gorm.io/gorm"
)

func newLinkToken() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "lnk_" + hex.EncodeToString(b)
}

// PublicLinkInfo 是公開連結的完整資訊。
type PublicLinkInfo struct {
	Token    string
	TripID   string
	Editable bool
}

// CreatePublicLink 為行程建立公開分享連結（一個行程只能有一條）。
func (s *Store) CreatePublicLink(tripID, createdBy string, editable bool) (string, error) {
	token := newLinkToken()
	row := publicLinkRow{
		ID:        token,
		TripID:    tripID,
		LinkToken: token,
		CreatedBy: createdBy,
		Editable:  editable,
		CreatedAt: now(),
	}
	if err := s.db.Create(&row).Error; err != nil {
		return "", err
	}
	return token, nil
}

// GetPublicLink 查詢行程的公開連結；查無資料回傳 ErrNotFound。
func (s *Store) GetPublicLink(tripID string) (PublicLinkInfo, error) {
	var row publicLinkRow
	err := s.db.Where("trip_id = ?", tripID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return PublicLinkInfo{}, ErrNotFound
	}
	return PublicLinkInfo{Token: row.LinkToken, TripID: tripID, Editable: row.Editable}, err
}

// GetPublicLinkTrip 由 token 反查行程資訊；查無資料回傳 ErrNotFound。
func (s *Store) GetPublicLinkTrip(token string) (PublicLinkInfo, error) {
	var row publicLinkRow
	err := s.db.Where("link_token = ?", token).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return PublicLinkInfo{}, ErrNotFound
	}
	return PublicLinkInfo{Token: row.LinkToken, TripID: row.TripID, Editable: row.Editable}, err
}

// SetPublicLinkEditable 更新公開連結的可編輯設定。
func (s *Store) SetPublicLinkEditable(tripID string, editable bool) error {
	return s.db.Model(&publicLinkRow{}).Where("trip_id = ?", tripID).
		Update("editable", editable).Error
}

// DeletePublicLink 刪除行程的公開連結；找不到不報錯。
func (s *Store) DeletePublicLink(tripID string) error {
	return s.db.Where("trip_id = ?", tripID).Delete(&publicLinkRow{}).Error
}

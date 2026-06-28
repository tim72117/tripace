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

// CreatePublicLink 為頻道建立公開分享連結（一個頻道只能有一條）。
func (s *Store) CreatePublicLink(channelID, createdBy string) (string, error) {
	token := newLinkToken()
	row := publicLinkRow{
		ID:        token,
		ChannelID: channelID,
		LinkToken: token,
		CreatedBy: createdBy,
		CreatedAt: now(),
	}
	if err := s.db.Create(&row).Error; err != nil {
		return "", err
	}
	return token, nil
}

// GetPublicLink 查詢頻道的公開連結 token；查無資料回傳 ErrNotFound。
func (s *Store) GetPublicLink(channelID string) (string, error) {
	var row publicLinkRow
	err := s.db.Where("channel_id = ?", channelID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", ErrNotFound
	}
	return row.LinkToken, err
}

// GetPublicLinkChannel 由 token 反查頻道 ID；查無資料回傳 ErrNotFound。
func (s *Store) GetPublicLinkChannel(token string) (string, error) {
	var row publicLinkRow
	err := s.db.Where("link_token = ?", token).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", ErrNotFound
	}
	return row.ChannelID, err
}

// DeletePublicLink 刪除頻道的公開連結；找不到不報錯。
func (s *Store) DeletePublicLink(channelID string) error {
	return s.db.Where("channel_id = ?", channelID).Delete(&publicLinkRow{}).Error
}

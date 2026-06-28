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
	Token     string
	ChannelID string
	Editable  bool
}

// CreatePublicLink 為頻道建立公開分享連結（一個頻道只能有一條）。
func (s *Store) CreatePublicLink(channelID, createdBy string, editable bool) (string, error) {
	token := newLinkToken()
	row := publicLinkRow{
		ID:        token,
		ChannelID: channelID,
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

// GetPublicLink 查詢頻道的公開連結；查無資料回傳 ErrNotFound。
func (s *Store) GetPublicLink(channelID string) (PublicLinkInfo, error) {
	var row publicLinkRow
	err := s.db.Where("channel_id = ?", channelID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return PublicLinkInfo{}, ErrNotFound
	}
	return PublicLinkInfo{Token: row.LinkToken, ChannelID: channelID, Editable: row.Editable}, err
}

// GetPublicLinkChannel 由 token 反查頻道資訊；查無資料回傳 ErrNotFound。
func (s *Store) GetPublicLinkChannel(token string) (PublicLinkInfo, error) {
	var row publicLinkRow
	err := s.db.Where("link_token = ?", token).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return PublicLinkInfo{}, ErrNotFound
	}
	return PublicLinkInfo{Token: row.LinkToken, ChannelID: row.ChannelID, Editable: row.Editable}, err
}

// SetPublicLinkEditable 更新公開連結的可編輯設定。
func (s *Store) SetPublicLinkEditable(channelID string, editable bool) error {
	return s.db.Model(&publicLinkRow{}).Where("channel_id = ?", channelID).
		Update("editable", editable).Error
}

// DeletePublicLink 刪除頻道的公開連結；找不到不報錯。
func (s *Store) DeletePublicLink(channelID string) error {
	return s.db.Where("channel_id = ?", channelID).Delete(&publicLinkRow{}).Error
}

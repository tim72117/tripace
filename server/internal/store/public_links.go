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
	// ViewMode:"timeline" 或 "pace"，見 publicLinkRow.ViewMode 的說明。
	ViewMode string
}

// normalizeViewMode 收斂空字串／未知值一律視為 "timeline"，避免呼叫端
// 各自重複判斷「這個值有效嗎」。
func normalizeViewMode(v string) string {
	if v == "pace" {
		return "pace"
	}
	return "timeline"
}

// CreatePublicLink 為頻道建立公開分享連結（一個頻道只能有一條）。
func (s *Store) CreatePublicLink(channelID, createdBy string, editable bool, viewMode string) (string, error) {
	token := newLinkToken()
	row := publicLinkRow{
		ID:        token,
		ChannelID: channelID,
		LinkToken: token,
		CreatedBy: createdBy,
		Editable:  editable,
		ViewMode:  normalizeViewMode(viewMode),
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
	return PublicLinkInfo{Token: row.LinkToken, ChannelID: channelID, Editable: row.Editable, ViewMode: normalizeViewMode(row.ViewMode)}, err
}

// GetPublicLinkChannel 由 token 反查頻道資訊；查無資料回傳 ErrNotFound。
func (s *Store) GetPublicLinkChannel(token string) (PublicLinkInfo, error) {
	var row publicLinkRow
	err := s.db.Where("link_token = ?", token).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return PublicLinkInfo{}, ErrNotFound
	}
	return PublicLinkInfo{Token: row.LinkToken, ChannelID: row.ChannelID, Editable: row.Editable, ViewMode: normalizeViewMode(row.ViewMode)}, err
}

// SetPublicLinkEditable 更新公開連結的可編輯設定。
func (s *Store) SetPublicLinkEditable(channelID string, editable bool) error {
	return s.db.Model(&publicLinkRow{}).Where("channel_id = ?", channelID).
		Update("editable", editable).Error
}

// SetPublicLinkViewMode 更新公開連結的呈現模式（時間軸／配速表）。
func (s *Store) SetPublicLinkViewMode(channelID string, viewMode string) error {
	return s.db.Model(&publicLinkRow{}).Where("channel_id = ?", channelID).
		Update("view_mode", normalizeViewMode(viewMode)).Error
}

// DeletePublicLink 刪除頻道的公開連結；找不到不報錯。
func (s *Store) DeletePublicLink(channelID string) error {
	return s.db.Where("channel_id = ?", channelID).Delete(&publicLinkRow{}).Error
}

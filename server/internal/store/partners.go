package store

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"github.com/tim72117/tripace/internal/model"
	"gorm.io/gorm"
)

// partnerRow——廣告業主/聯盟行銷夥伴帳號(對應新的「廣告業主控制台」
// /partner/*,見 server/internal/partnerconsole 與 web/partner 的完整
// 說明)。2026-10 改動:登入身分改成直接複用一般使用者系統(userRow),
// 不再有獨立的 Email/PasswordHash/register/login——比照 admin 後台的
// 既有模式(withAdmin 消費一般使用者 JWT + email 白名單),這裡消費
// 一般使用者 JWT + UserID 對應關係。partnerRow 退化成「使用者→業主
// 身分」的關聯/擴充表,不再是獨立帳號系統:
//  1. 使用者先用主站一般帳號登入(/v1/auth/login),拿到跟一般使用者
//     完全相同的 JWT。
//  2. partnerconsole 的 withPartner 中介層解析 JWT 拿到 UserID,再用
//     UserID 查這張表——查得到就是業主,查不到就不是(fail-closed,
//     跟一般使用者一樣的 401,不洩漏「這個帳號存不存在業主身分」)。
//
// 「一般使用者怎麼變成業主」目前**沒有自助申請流程**(2026-10 明確
// 決定延後)——只能由內部人員手動在資料庫寫入一筆 partnerRow 關聯到
// 某個既有 UserID,之後若要做自助申請,再加一個 Status="pending" 的
// 申請端點與審核流程,不需要改動這張表的欄位設計(Status 欄位已經
// 預留)。
//
// UserID 唯一索引——一個使用者最多只能對應一筆業主身分,不支援「一個
// 使用者同時代表多個業主」這種情境(如有需要再評估改成多對多)。
// Name 仍保留在這張表(而非從 userRow.Name 取用)——業主的對外顯示
// 名稱(例如公司/品牌名)跟這個人在 Tripace 一般使用者系統裡的個人
// 暱稱是兩回事,不應該混用同一個欄位。Status 預留 "active"/
// "suspended",目前 API 尚未實作停權邏輯,先讓欄位存在避免之後要做
// 時又要補 migration。
//
// 2026-10 定義從 entity.go 搬到這個檔案(見 entity.go 該處留下的指標
// 註解)——讓這個領域的型別異動不會跟其他領域混在同一份 diff 裡。
type partnerRow struct {
	ID        string    `gorm:"primaryKey;column:id"`
	UserID    string    `gorm:"column:user_id;not null;uniqueIndex"`
	Name      string    `gorm:"column:name;not null"`
	Status    string    `gorm:"column:status;not null;default:active"`
	CreatedAt time.Time `gorm:"column:created_at;not null"`
	UpdatedAt time.Time `gorm:"column:updated_at;not null"`
}

func (partnerRow) TableName() string { return "partners" }

// newPartnerID 對齊 newAttractionID/newContentPageID 的既有風格,前綴
// "ptn_"(partner)。
func newPartnerID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "ptn_" + hex.EncodeToString(b)
}

func toPartner(r partnerRow) model.Partner {
	return model.Partner{
		ID:        r.ID,
		UserID:    r.UserID,
		Name:      r.Name,
		Status:    r.Status,
		CreatedAt: r.CreatedAt,
	}
}

// CreatePartner 把一個既有的一般使用者帳號(userID)標記為業主身分。
// 目前沒有自助申請流程(2026-10 明確決定延後,見 partnerRow 的完整
// 說明)——這個方法只給內部人員手動操作用(例如之後補一個 CLI 指令,
// 或直接由營運人員透過資料庫工具呼叫),不是公開 API 端點背後的邏輯。
//
// 同一個 userID 已經是業主時回傳 ErrAlreadyExists(先查後建,理由同
// CreateContentPage 的完整說明:避免解析跨 driver 不一致的 unique
// constraint 錯誤字串)。
func (s *Store) CreatePartner(userID, name string) (model.Partner, error) {
	if _, err := s.FindPartnerByUserID(userID); err == nil {
		return model.Partner{}, ErrAlreadyExists
	} else if !errors.Is(err, ErrNotFound) {
		return model.Partner{}, err
	}
	r := partnerRow{
		ID:        newPartnerID(),
		UserID:    userID,
		Name:      name,
		Status:    "active",
		CreatedAt: now(),
		UpdatedAt: now(),
	}
	if err := s.db.Create(&r).Error; err != nil {
		return model.Partner{}, err
	}
	return toPartner(r), nil
}

// FindPartnerByUserID 依一般使用者 ID 查業主身分,找不到回傳
// ErrNotFound——這是 partnerconsole.withPartner 判斷「目前登入的使用者
// 是不是業主」的唯一依據(見該中介層的完整說明):解析 JWT 拿到 UserID
// 後,查不到對應的 partnerRow 就代表這個使用者沒有業主身分,一律 401,
// 不特別區分「帳號不存在」與「存在但不是業主」(fail-closed)。
func (s *Store) FindPartnerByUserID(userID string) (model.Partner, error) {
	var r partnerRow
	err := s.db.Where("user_id = ?", userID).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Partner{}, ErrNotFound
	}
	if err != nil {
		return model.Partner{}, err
	}
	return toPartner(r), nil
}

// FindPartnerByID 依業主主鍵查業主,找不到回傳 ErrNotFound。
func (s *Store) FindPartnerByID(id string) (model.Partner, error) {
	var r partnerRow
	err := s.db.Where("id = ?", id).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Partner{}, ErrNotFound
	}
	if err != nil {
		return model.Partner{}, err
	}
	return toPartner(r), nil
}

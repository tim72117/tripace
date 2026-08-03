package store

import (
	"errors"
	"time"

	"github.com/tim72117/tripace/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ListTripsForUser 回傳指定使用者參與(為成員)的行程,依更新時間新到舊。
// memberCount 與 lastMessagePreview 以子查詢取得。
func (s *Store) ListTripsForUser(userID string) ([]model.Trip, error) {
	type tripAgg struct {
		ID                 string
		Name               string
		OwnerID            string
		UpdatedAt          time.Time
		MemberCount        int
		LastMessagePreview *string
	}
	// 原話已移至裝置端,後端不再有 messages;預覽改取最近一筆 entry 的事項。
	var rows []tripAgg
	err := s.db.
		Table("trips t").
		Select(`t.id, t.name, t.owner_id, t.updated_at,
			(SELECT COUNT(*) FROM members m2 WHERE m2.trip_id = t.id) AS member_count,
			(SELECT title FROM entries e WHERE e.trip_id = t.id
			 ORDER BY e.created_at DESC LIMIT 1) AS last_message_preview`).
		Joins("JOIN members m ON m.trip_id = t.id AND m.user_id = ?", userID).
		Order("t.updated_at DESC").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	out := make([]model.Trip, 0, len(rows))
	for _, r := range rows {
		out = append(out, model.Trip{
			ID:                 r.ID,
			Name:               r.Name,
			OwnerID:            r.OwnerID,
			UpdatedAt:          r.UpdatedAt,
			MemberCount:        r.MemberCount,
			LastMessagePreview: r.LastMessagePreview,
		})
	}
	return out, nil
}

// CreateTrip 建立行程,建立者即為擁有者(owner),並自動成為成員。
func (s *Store) CreateTrip(id, name string, creator model.User) (model.Trip, error) {
	t := now()
	err := s.db.Transaction(func(tx *gorm.DB) error {
		tr := tripRow{ID: id, Name: name, OwnerID: creator.ID, CreatedAt: t, UpdatedAt: t}
		if err := tx.Create(&tr).Error; err != nil {
			return err
		}
		// 建立者加入成員(中介表)。
		// 建立者即 owner,預設給 editor 角色(可記事/編輯)。
		return tx.Create(&memberLink{TripID: id, UserID: creator.ID, Role: model.RoleEditor}).Error
	})
	if err != nil {
		return model.Trip{}, err
	}
	return model.Trip{ID: id, Name: name, OwnerID: creator.ID, MemberCount: 1, UpdatedAt: t}, nil
}

// GetTripOwner 回傳行程的 owner_id;行程不存在回 ErrNotFound。
func (s *Store) GetTripOwner(tripID string) (string, error) {
	var tr tripRow
	err := s.db.Select("owner_id").Where("id = ?", tripID).First(&tr).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return tr.OwnerID, nil
}

// GetTripName 回傳行程名稱；行程不存在回 ErrNotFound。
func (s *Store) GetTripName(tripID string) (string, error) {
	var tr tripRow
	err := s.db.Select("name").Where("id = ?", tripID).First(&tr).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return tr.Name, nil
}

// ListAllTrips 回傳所有行程(供 internal CLI 使用)。
func (s *Store) ListAllTrips() ([]model.Trip, error) {
	var rows []tripRow
	err := s.db.Order("updated_at DESC").Find(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]model.Trip, 0, len(rows))
	for _, r := range rows {
		out = append(out, model.Trip{ID: r.ID, Name: r.Name, OwnerID: r.OwnerID, UpdatedAt: r.UpdatedAt})
	}
	return out, nil
}

// CountTrips 回傳行程總數(seed 判斷資料庫是否為空用)。
func (s *Store) CountTrips() (int, error) {
	var n int64
	err := s.db.Model(&tripRow{}).Count(&n).Error
	return int(n), err
}

// tripExists 確認行程存在。
func (s *Store) tripExists(id string) (bool, error) {
	var n int64
	err := s.db.Model(&tripRow{}).Where("id = ?", id).Count(&n).Error
	return n > 0, err
}

// ----- 成員 -----

// ListMembers 回傳行程成員(從 users 表撈,依名稱排序)。
func (s *Store) ListMembers(tripID string) ([]model.Member, error) {
	type memberAgg struct {
		ID          string
		Name        string
		AvatarColor string
		Role        string
	}
	var rows []memberAgg
	err := s.db.
		Table("users").
		Select("users.id, users.name, users.avatar_color, m.role").
		Joins("JOIN members m ON m.user_id = users.id").
		Where("m.trip_id = ?", tripID).
		Order("users.name").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]model.Member, 0, len(rows))
	for _, r := range rows {
		out = append(out, model.Member{
			User: model.User{ID: r.ID, Name: r.Name, AvatarColor: r.AvatarColor},
			Role: r.Role,
		})
	}
	return out, nil
}

// AddMember 加入成員(冪等),以指定角色加入;role 留空則預設 viewer。
// 回傳更新後的成員清單(含角色)。
func (s *Store) AddMember(tripID string, u model.User, role string) ([]model.Member, error) {
	ok, err := s.tripExists(tripID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	if role == "" {
		role = model.RoleViewer
	}
	// 冪等:已是成員則忽略(不覆寫既有角色)。
	link := memberLink{TripID: tripID, UserID: u.ID, Role: role}
	if err := s.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&link).Error; err != nil {
		return nil, err
	}
	return s.ListMembers(tripID)
}

// SetMemberRole 變更成員在行程內的角色(editor/viewer)。成員不存在則回 ErrNotFound。
func (s *Store) SetMemberRole(tripID, userID, role string) error {
	res := s.db.Model(&memberLink{}).
		Where("trip_id = ? AND user_id = ?", tripID, userID).
		Update("role", role)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// GetMemberRole 回傳成員在行程內的角色;非成員回 ErrNotFound。
func (s *Store) GetMemberRole(tripID, userID string) (string, error) {
	var link memberLink
	err := s.db.Select("role").
		Where("trip_id = ? AND user_id = ?", tripID, userID).
		First(&link).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return link.Role, nil
}

// ----- 使用者目錄 -----

// UpsertUser 寫入或更新一筆使用者(供 seed)。
func (s *Store) UpsertUser(u model.User) error {
	r := userRow{ID: u.ID, Name: u.Name, AvatarColor: u.AvatarColor}
	return s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{"name", "avatar_color"}),
	}).Create(&r).Error
}

// memberLink 對應 many2many 的中介表 members(用於直接寫入/冪等)。
// Role 決定成員在行程內的權限(editor/viewer);預設 viewer。
type memberLink struct {
	TripID string `gorm:"primaryKey;column:trip_id"`
	UserID string `gorm:"primaryKey;column:user_id"`
	Role   string `gorm:"column:role;not null;default:viewer"`
}

func (memberLink) TableName() string { return "members" }

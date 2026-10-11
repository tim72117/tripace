package store

import (
	"github.com/tim72117/tripace/internal/model"
)

// ListUsers 列出一般使用者清單,供 /admin/api/users 使用。刻意只回傳基本資訊
// (id/email/name/大頭貼顏色),不含方案/額度/用量——那些功能不在這次整合範圍內。
// userRow 目前沒有 CreatedAt 欄位,故不虛構「建立時間」這個回傳欄位。
func (s *Store) ListUsers() ([]model.AdminUserSummary, error) {
	var rows []userRow
	if err := s.db.Order("id").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]model.AdminUserSummary, 0, len(rows))
	for _, r := range rows {
		email := ""
		if r.Email != nil {
			email = *r.Email
		}
		out = append(out, model.AdminUserSummary{
			ID:          r.ID,
			Email:       email,
			Name:        r.Name,
			AvatarColor: r.AvatarColor,
		})
	}
	return out, nil
}

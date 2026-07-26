package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/tim72117/tripace/internal/model"
	"gorm.io/gorm"
)

func toEntry(r entryRow) model.Entry {
	return model.Entry{
		ID:        r.ID,
		TripID:    r.TripID,
		Title:     r.Title,
		StartAt:   r.StartAt,
		EndAt:     r.EndAt,
		TZ:        r.TZ,
		AllDay:    r.AllDay,
		Location:  r.Location,
		Lat:       r.Lat,
		Lng:       r.Lng,
		PlaceID:   r.PlaceID,
		Category:  r.Category,
		Tags:      r.Tags,
		Note:      r.Note,
		Kind:      r.Kind,
		Detail:    r.Detail,
		CreatedAt: r.CreatedAt,
	}
}

// InsertEntry 寫入一筆條目。entry 為主體,可獨立存在(不依附 message)。
// 來源訊息的關聯改由 LinkEntryMessage 另外建立(多對多)。
func (s *Store) InsertEntry(e model.Entry) error {
	r := entryRow{
		ID:        e.ID,
		TripID:    e.TripID,
		Title:     e.Title,
		StartAt:   e.StartAt,
		EndAt:     e.EndAt,
		TZ:        e.TZ,
		AllDay:    e.AllDay,
		Location:  e.Location,
		Lat:       e.Lat,
		Lng:       e.Lng,
		PlaceID:   e.PlaceID,
		Category:  e.Category,
		Tags:      e.Tags,
		Note:      e.Note,
		Kind:      e.Kind,
		Detail:    e.Detail,
		CreatedAt: e.CreatedAt,
	}
	return s.db.Create(&r).Error
}

// SetEntryLatLng 更新 entry 的經緯度（由 geo goroutine 非同步呼叫），同時
// 清空 place_id——這支方法給「手動在地圖上拖曳選點存座標」這種情境用
// (見 handleInternalSetLatLng),呼叫端只知道座標,不知道(也無從得知)
// 這組座標對應 Google 的哪個 place_id,若保留舊值不動,會變成座標已經
// 改到別處、place_id 卻還指著原本那個地點的不一致狀態,故明確清空,不
// 留下錯誤關聯的風險。真的知道 place_id 時(例如後端呼叫 Geocoding API
// 查到)請改用 SetEntryLatLngWithPlaceID。
func (s *Store) SetEntryLatLng(id string, lat, lng float64) error {
	return s.db.Model(&entryRow{}).Where("id = ?", id).
		Updates(map[string]any{"lat": lat, "lng": lng, "place_id": nil}).Error
}

// SetEntryLatLngWithPlaceID 同 SetEntryLatLng,但額外寫入這組座標對應的
// Google place_id——供「後端呼叫 Geocoding API 查到座標」這種情境用
// (見 handleGeocodeEntry),查詢結果本身就帶著明確的 place_id,記錄下來
// 供之後跟 Places API 其他已快取資料(如 photo_cache/
// place_details_cache)關聯比對用。placeID 為空字串時視同呼叫
// SetEntryLatLng(仍然明確清空,不留舊值)。
func (s *Store) SetEntryLatLngWithPlaceID(id string, lat, lng float64, placeID string) error {
	if placeID == "" {
		return s.SetEntryLatLng(id, lat, lng)
	}
	return s.db.Model(&entryRow{}).Where("id = ?", id).
		Updates(map[string]any{"lat": lat, "lng": lng, "place_id": placeID}).Error
}

// EntryTimeUpdate 是 UpdateEntry 的時間相關參數,用具名 struct 取代多個
// string/bool 參數,避免呼叫端調換參數順序時編譯器無法檢查出錯誤
// (StartAt/EndAt 型別相同,順序寫反不會報錯,只會靜默寫錯欄位)。
//
// 三個指標各自獨立表示「是否要更新這個欄位」:nil=不變,非 nil=更新成該值
// (StartAt/EndAt 可以被明確設為 nil 時間點——但目前呼叫端沒有這個需求,
// 一律用「有沒有帶這個參數」表示要不要更新,細節見 UpdateEntry 呼叫處)。
type EntryTimeUpdate struct {
	StartAt *time.Time
	EndAt   *time.Time
	TZ      *string
	AllDay  *bool
}

// UpdateEntry 更新一筆 entry 的可編輯欄位;留空字串/nil 的欄位不更新。
func (s *Store) UpdateEntry(id, title string, tu EntryTimeUpdate, location, note, kind string, detail map[string]any) error {
	fields := map[string]any{}
	if title != "" {
		fields["title"] = title
	}
	if tu.StartAt != nil {
		fields["start_at"] = *tu.StartAt
	}
	if tu.EndAt != nil {
		fields["end_at"] = *tu.EndAt
	}
	if tu.TZ != nil {
		fields["tz"] = *tu.TZ
	}
	if tu.AllDay != nil {
		fields["all_day"] = *tu.AllDay
	}
	if location != "" {
		fields["location"] = location
	}
	if note != "" {
		fields["note"] = note
	}
	if kind != "" {
		fields["kind"] = kind
	}
	if detail != nil {
		// entryRow.Detail 的 `serializer:json` tag 只在透過具名 struct 更新時
		// 生效(見 InsertEntry);這裡用 map[string]any 呼叫 Updates,GORM 無法
		// 從欄位名稱字串反查回 struct tag,會把原始 Go map 直接交給資料庫驅動
		// 編碼進 text 欄位,導致 "unable to encode map[string]interface{}"
		// 錯誤。手動先序列化成 JSON 字串再放進 fields,繞開這個限制。
		b, err := json.Marshal(detail)
		if err != nil {
			return fmt.Errorf("序列化 detail 失敗: %w", err)
		}
		fields["detail"] = string(b)
	}
	if len(fields) == 0 {
		return nil
	}
	return s.db.Model(&entryRow{}).Where("id = ?", id).Updates(fields).Error
}

// EntryExists 確認 entry 是否存在。
func (s *Store) EntryExists(id string) (bool, error) {
	var count int64
	err := s.db.Model(&entryRow{}).Where("id = ?", id).Count(&count).Error
	return count > 0, err
}

// DeleteEntry 刪除一筆條目。
func (s *Store) DeleteEntry(id string) error {
	return s.db.Where("id = ?", id).Delete(&entryRow{}).Error
}

// GetEntry 依 ID 取單一條目;查無回 ErrNotFound。
func (s *Store) GetEntry(entryID string) (model.Entry, error) {
	var r entryRow
	err := s.db.Where("id = ?", entryID).First(&r).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.Entry{}, ErrNotFound
	}
	if err != nil {
		return model.Entry{}, err
	}
	return toEntry(r), nil
}

// ListEntriesByTrip 回傳行程的所有條目,依開始時間排序。
func (s *Store) ListEntriesByTrip(tripID string) ([]model.Entry, error) {
	var rows []entryRow
	err := s.db.Where("trip_id = ?", tripID).
		Order("start_at ASC, created_at ASC").Find(&rows).Error
	return mapEntries(rows), err
}

// ListEntriesByRange 回傳行程中 start_at 落在 [from, to] 的條目,依開始時間排序。
// from/to 為零值 time.Time 表示該端不設限。改成原生 timestamptz 比較後,
// 不再需要字串範圍的邊界特判(舊版 to 只到日期要補 23:59 的處理已不需要,
// 呼叫端直接傳當日 23:59:59 或隔天 00:00 即可,語意由呼叫端決定)。
// 註:start_at 為 NULL(無時間)的條目不會落在任何範圍內,僅在 from、to 皆為
// 零值時才納入(對應舊版「皆空時納入」的行為)。
func (s *Store) ListEntriesByRange(tripID string, from, to time.Time) ([]model.Entry, error) {
	q := s.db.Where("trip_id = ?", tripID)
	if !from.IsZero() {
		q = q.Where("start_at >= ?", from)
	}
	if !to.IsZero() {
		q = q.Where("start_at IS NOT NULL AND start_at <= ?", to)
	}
	var rows []entryRow
	err := q.Order("start_at ASC, created_at ASC").Find(&rows).Error
	return mapEntries(rows), err
}

func mapEntries(rows []entryRow) []model.Entry {
	out := make([]model.Entry, 0, len(rows))
	for _, r := range rows {
		out = append(out, toEntry(r))
	}
	return out
}

// DeleteTripEntries 清空某行程的所有 entries(不動行程/使用者本身)。
// 開發/測試重置用。
func (s *Store) DeleteTripEntries(tripID string) error {
	return s.db.Where("trip_id = ?", tripID).Delete(&entryRow{}).Error
}

package store

import (
	"crypto/rand"
	"encoding/hex"

	"github.com/tim72117/tripace/internal/model"
	"gorm.io/gorm"
)

// newAttractionID 產生景點區域 ID(對齊既有 ent_/tr_/usr_ 風格)。
func newAttractionID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "lmk_" + hex.EncodeToString(b)
}

func toAttraction(r attractionRow) model.Attraction {
	return model.Attraction{
		ID:           r.ID,
		Name:         r.Name,
		CityName:     r.CityName,
		Lat:          r.Lat,
		Lng:          r.Lng,
		Level:        r.Level,
		RadiusMeters: r.RadiusMeters,
		Summary:      r.Summary,
		PhotoURL:     r.PhotoURL,
		UpdatedAt:    r.UpdatedAt,
	}
}

// attachTags 依 attraction ID 批次查出對應的標籤,填回每筆 model.Attraction
// 的 Tags 欄位——所有回傳一批 Attraction 的方法(ListAttractionsByCity/
// ListAttractionsNearby)都呼叫這個共用步驟,不在各自方法內各自重複一次
// 查詢+填值邏輯。用「先查全部 attraction,再一次查這批 ID 對應的全部
// tag」兩趟查詢,而非每筆各自查一次標籤(N+1)——attraction 資料量小
// (幾百到幾千筆量級,見 docs/ATTRACTION_SYNC_DESIGN.md 對這批資料規模
// 的既有假設),兩趟查詢的成本遠低於 N 趟。就地修改 out 內每筆元素的
// Tags 欄位,不回傳新切片。
func (s *Store) attachTags(out []model.Attraction) error {
	if len(out) == 0 {
		return nil
	}
	ids := make([]string, len(out))
	for i, a := range out {
		ids[i] = a.ID
	}
	var rows []attractionTagRow
	if err := s.db.Where("attraction_id IN ?", ids).Order("tag ASC").Find(&rows).Error; err != nil {
		return err
	}
	tagsByID := make(map[string][]string, len(out))
	for _, r := range rows {
		tagsByID[r.AttractionID] = append(tagsByID[r.AttractionID], r.Tag)
	}
	for i := range out {
		out[i].Tags = tagsByID[out[i].ID]
	}
	return nil
}

// CreateAttraction 建立一筆景點區域資料(見 model.Attraction 的完整說明)。
// ID 由這裡產生、不由呼叫端指定——景點區域管理是人工透過 CLI 逐筆輸入,
// 不像 entry 需要跟 LLM 產生的 ID 對齊。
func (s *Store) CreateAttraction(in model.Attraction) (model.Attraction, error) {
	r := attractionRow{
		ID:           newAttractionID(),
		Name:         in.Name,
		CityName:     in.CityName,
		Lat:          in.Lat,
		Lng:          in.Lng,
		Level:        in.Level,
		RadiusMeters: in.RadiusMeters,
		Summary:      in.Summary,
		PhotoURL:     in.PhotoURL,
		CreatedAt:    now(),
		UpdatedAt:    now(),
	}
	if err := s.db.Create(&r).Error; err != nil {
		return model.Attraction{}, err
	}
	return toAttraction(r), nil
}

// ListAttractionsByCity 回傳指定城市的所有景點區域資料,依 Level 由小到大
// (國際→在地)、同 Level 內依建立時間排序——這個順序讓 CLI 列表輸出
// 時,知名度越高的景點區域排越前面,方便人工核對資料是否齊全。
func (s *Store) ListAttractionsByCity(cityName string) ([]model.Attraction, error) {
	var rows []attractionRow
	if err := s.db.Where("city_name = ?", cityName).
		Order("level ASC, created_at ASC").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]model.Attraction, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAttraction(r))
	}
	if err := s.attachTags(out); err != nil {
		return nil, err
	}
	return out, nil
}

// ListAttractionsNearby 回傳落在指定座標周圍矩形範圍內的所有景點區域
// 資料,依 Level 由小到大排序——供地圖依目前可視範圍檢索使用(見
// server/internal/api/geo_outline.go 的 handleGeoAttractionsNearby),
// 取代原本只能靠 ListAttractionsByCity(city 名稱)才能查到的限制,讓
// 使用者拖曳/縮放地圖到任何已建檔的城市範圍內都能查到資料,不需要先
// 知道城市名稱。
//
// 用經緯度差值算矩形範圍(bounding box)做初步篩選,而非精確的球面
// 距離公式(如 Haversine)——SQLite/一般 Postgres(未裝 PostGIS 擴充)
// 都沒有內建地理函式可以在 SQL 層算球面距離,矩形近似在這裡的使用情境
// (前端拿地圖可視範圍的經緯度差當半徑)已經足夠準確,不需要為此另外
// 引入地理擴充套件或在應用層逐筆算距離。緯度 1 度約 111km,經度 1 度
// 隨緯度不同而變化(赤道約 111km,越高緯度越短),這裡不做緯度校正
// (簡化計算,對城市尺度的查詢範圍誤差可接受)。
func (s *Store) ListAttractionsNearby(lat, lng, radiusMeters float64) ([]model.Attraction, error) {
	degRadius := radiusMeters / 111000.0
	var rows []attractionRow
	if err := s.db.
		Where("lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?",
			lat-degRadius, lat+degRadius, lng-degRadius, lng+degRadius).
		Order("level ASC, created_at ASC").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]model.Attraction, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAttraction(r))
	}
	if err := s.attachTags(out); err != nil {
		return nil, err
	}
	return out, nil
}

// ListAttractionCities 回傳目前資料庫裡已經有景點區域資料的城市名稱清單
// (去重、依名稱排序)——供 CLI 的 attraction-cities 子命令列出「已建檔
// 哪些城市」,不需要另外用其他方式查詢有沒有資料。
func (s *Store) ListAttractionCities() ([]string, error) {
	var cities []string
	if err := s.db.Model(&attractionRow{}).
		Distinct("city_name").
		Order("city_name ASC").
		Pluck("city_name", &cities).Error; err != nil {
		return nil, err
	}
	return cities, nil
}

// DeleteAttraction 刪除一筆景點區域資料。
func (s *Store) DeleteAttraction(id string) error {
	return s.db.Where("id = ?", id).Delete(&attractionRow{}).Error
}

// GetAttraction 依 ID 查單筆景點區域資料——供 CLI 的 attraction-update-photo
// 指令(見 cmd/cli/http.go)先取得該筆的 Name/CityName,當作重新查詢
// Google Places 圖片時的預設搜尋字串(未另外指定 -query 時)。
func (s *Store) GetAttraction(id string) (model.Attraction, error) {
	var r attractionRow
	if err := s.db.Where("id = ?", id).First(&r).Error; err != nil {
		return model.Attraction{}, err
	}
	a := toAttraction(r)
	out := []model.Attraction{a}
	if err := s.attachTags(out); err != nil {
		return model.Attraction{}, err
	}
	return out[0], nil
}

// SetAttractionTags 覆蓋一筆景點區域的完整標籤集合——用「先刪光這筆
// 現有的關聯、再整批寫入新的」而非逐一比對新增/刪除差異,理由是標籤
// 數量小(單一地點通常個位數到十幾個標籤),整批覆蓋的實作與呼叫端
// 語意都比「diff 後只變更差異部分」單純,呼叫端(CLI attraction-tag
// 指令)每次都是傳入這筆地點「現在該有的完整標籤清單」,不是增量的
// 加一個/減一個。tags 為空切片時等同清空該地點的所有標籤。
//
// 兩個步驟包在同一個交易裡——若刪除成功但寫入新標籤時中途失敗,不該
// 讓這筆地點停在「標籤被清空但沒有新標籤」的中間狀態,那樣呼叫端重試
// 前完全看不出來上次執行到哪裡,直接整個操作失敗回滾比較安全。
func (s *Store) SetAttractionTags(attractionID string, tags []string) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("attraction_id = ?", attractionID).Delete(&attractionTagRow{}).Error; err != nil {
			return err
		}
		if len(tags) == 0 {
			return nil
		}
		rows := make([]attractionTagRow, len(tags))
		for i, t := range tags {
			rows[i] = attractionTagRow{AttractionID: attractionID, Tag: t}
		}
		return tx.Create(&rows).Error
	})
}

// ListAttractionsByTagInCity 回傳同一個城市底下、帶有指定標籤的所有
// 景點區域資料(含目標地點本身,由呼叫端自行從結果中排除)——供
// AttractionInfoPanel「顯示周邊相同標籤的地點」使用。範圍刻意收在同
// 城市而非全域搜尋、也不另外限制半徑,理由見
// docs/TRIP_PLANNING_DESIGN_DISCUSSION.md 相關設計討論:同城市內的
// 「周邊」已經是使用者規劃單一城市行程時合理的地理範圍,呼叫端
// (handleMaintenanceAttractionTagNeighbors)再依實際距離排序、只取
// 前幾筆顯示,不需要在 SQL 層再加一層半徑篩選徒增複雜度。
func (s *Store) ListAttractionsByTagInCity(cityName, tag string) ([]model.Attraction, error) {
	var ids []string
	if err := s.db.Model(&attractionRow{}).
		Joins("JOIN attraction_tags ON attraction_tags.attraction_id = attractions.id").
		Where("attractions.city_name = ? AND attraction_tags.tag = ?", cityName, tag).
		Pluck("attractions.id", &ids).Error; err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return []model.Attraction{}, nil
	}
	var rows []attractionRow
	if err := s.db.Where("id IN ?", ids).Order("level ASC, created_at ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]model.Attraction, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAttraction(r))
	}
	if err := s.attachTags(out); err != nil {
		return nil, err
	}
	return out, nil
}

// UpdateAttractionPhoto 更新一筆景點區域的照片(data: URI,見
// geo.Client.PhotoDataURI)。只更新 photo_url 與 updated_at 兩欄,不動
// 其餘欄位——這支方法專門服務 CLI 的 attraction-update-photo(重新透過
// Google Places 抓圖後回寫),不是通用的景點區域編輯入口。
func (s *Store) UpdateAttractionPhoto(id, photoURL string) error {
	return s.db.Model(&attractionRow{}).
		Where("id = ?", id).
		Updates(map[string]any{"photo_url": photoURL, "updated_at": now()}).Error
}

// UpdateAttractionCoords 更新一筆景點區域的座標。只更新 lat/lng/
// updated_at 三欄,不動其餘欄位——這支方法專門服務 CLI 的
// attraction-update 指令,修正建檔時輸入錯誤的座標,不需要像
// UpdateAttractionPhoto 那樣重新查詢外部服務,單純覆蓋兩個數值欄位。
func (s *Store) UpdateAttractionCoords(id string, lat, lng float64) error {
	return s.db.Model(&attractionRow{}).
		Where("id = ?", id).
		Updates(map[string]any{"lat": lat, "lng": lng, "updated_at": now()}).Error
}

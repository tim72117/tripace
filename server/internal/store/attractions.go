package store

import (
	"crypto/rand"
	"encoding/hex"

	"github.com/tim72117/tripace/internal/model"
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
	return toAttraction(r), nil
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

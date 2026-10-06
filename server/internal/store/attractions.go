package store

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"

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
		IsTheme:      r.IsTheme,
		RadiusMeters: r.RadiusMeters,
		Summary:      r.Summary,
		PlaceID:      r.PlaceID,
		Category:     r.Category,
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
		IsTheme:      in.IsTheme,
		RadiusMeters: in.RadiusMeters,
		Summary:      in.Summary,
		PlaceID:      in.PlaceID,
		Category:     in.Category,
		CreatedAt:    now(),
		UpdatedAt:    now(),
	}
	if err := s.db.Create(&r).Error; err != nil {
		return model.Attraction{}, err
	}
	return toAttraction(r), nil
}

// CreateAttractionWithID 建立一筆景點區域資料,但沿用呼叫端指定的 ID,
// 不像 CreateAttraction 自動產生新 ID——專供景點資料同步機制(見
// server/internal/attractionsync、docs/ATTRACTION_SYNC_DESIGN.md)的
// push/pull 寫入使用:同步的本質是「讓目的方的某筆記錄跟來源方的那筆
// 記錄一致」,若目的方另外產生一個新 ID,下一輪同步比對 ID 時會誤判成
// 兩筆互不相干的記錄,導致同一筆資料被無限重複新增。一般人工建檔
// (CreateAttraction/attraction-add)不會遇到「這筆資料在別的伺服器已經
// 有固定 ID」的情境,故維持原本自動產生 ID 的行為不變,兩者分開提供。
func (s *Store) CreateAttractionWithID(in model.Attraction) (model.Attraction, error) {
	r := attractionRow{
		ID:           in.ID,
		Name:         in.Name,
		CityName:     in.CityName,
		Lat:          in.Lat,
		Lng:          in.Lng,
		Level:        in.Level,
		IsTheme:      in.IsTheme,
		RadiusMeters: in.RadiusMeters,
		Summary:      in.Summary,
		PlaceID:      in.PlaceID,
		Category:     in.Category,
		CreatedAt:    now(),
		UpdatedAt:    now(),
	}
	if err := s.db.Create(&r).Error; err != nil {
		return model.Attraction{}, err
	}
	return toAttraction(r), nil
}

// UpdateAttractionFields 用來源方版本覆蓋目的方既有記錄的全部比對
// 欄位(見 attractionsync.CompareFields 的欄位清單)——同步機制的「兩邊
// 都有、內容不同」情境用來源方版本覆蓋目的方,不是欄位級局部更新,
// 因此一次覆蓋全部比對欄位,不像 UpdateAttractionCoords 只動單一欄位。
//
// 刻意不含 PlaceID:attractionsync.compareFieldSpecs 目前只定義 8 個比對
// 欄位,PlaceID 尚未列入(見該檔案的完整說明,新增比對欄位只需要改那
// 一處)——這裡若單獨覆蓋 PlaceID 而比對邏輯完全不知道這個欄位存在,會
// 出現「這裡覆蓋了但 dry-run 報告不會顯示差異」的不一致。是否要讓
// PlaceID 加入同步比對範圍是後續可以再評估的獨立決策,目前先讓
// CreateAttractionWithID(建立新記錄時)帶入來源方的 PlaceID,已有記錄的
// 兩邊同步更新則維持現狀不動這個欄位。
func (s *Store) UpdateAttractionFields(in model.Attraction) error {
	return s.db.Model(&attractionRow{}).
		Where("id = ?", in.ID).
		Updates(map[string]any{
			"name":          in.Name,
			"city_name":     in.CityName,
			"lat":           in.Lat,
			"lng":           in.Lng,
			"level":         in.Level,
			"is_theme":      in.IsTheme,
			"radius_meters": in.RadiusMeters,
			"summary":       in.Summary,
			"updated_at":    now(),
		}).Error
}

// ListAllAttractions 回傳資料庫裡全部的景點區域資料,不分城市——供
// attractionsync(見 server/internal/attractionsync)的三層比對使用,
// 同步需要看到跨城市的完整資料集,不像 ListAttractionsByCity 是給地圖
// 依可視範圍查詢用的。依 UpdatedAt 由舊到新排序,對齊三層比對/交握式
// 傳輸「依時間序」的既有慣例(見 docs/ATTRACTION_SYNC_DESIGN.md「二、
// 傳輸流程」),呼叫端不需要自己再排一次序。
func (s *Store) ListAllAttractions() ([]model.Attraction, error) {
	var rows []attractionRow
	if err := s.db.Order("updated_at ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]model.Attraction, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAttraction(r))
	}
	return out, nil
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
// (去重、依名稱排序)——供 CLI 的 attraction cities 指令列出「已建檔
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

// ListAttractionsMissingGooglePhoto 回傳有登記 place_id、但 photo_assets
// 裡完全沒有仍在有效期內紀錄的景點區域——供 CLI 的
// attraction query -status no-google-photo 指令使用(見該指令完整
// 說明)。只檢查「有 place_id」的地標:沒有 place_id 的地標本來就不可能
// 出現在 photo_assets 裡(該表用 place_id 當主鍵,見 photoAssetRow 的
// 完整說明),這種情況屬於另一個獨立問題(缺 place_id,見
// internal/adminconsole/attraction_place_id_check.go 的既有核對工具),
// 不該混進這份清單——避免同一筆資料同時出現在兩份不同問題的清單裡,
// 讓操作者誤以為「補了照片就解決」,實際上根本原因是沒有 place_id 可以
// 拿去查照片。
//
// 用 LEFT JOIN + WHERE photo_assets.place_id IS NULL 一次查出結果,不是
// 先 ListAllAttractions 再逐筆呼叫 GetFreshPhotoAssetURL——後者是 N+1
// 查詢,地標數量成長後效能會線性變差;這裡是人工維運查詢,資料量不大,
// 但既然一次 SQL 就能做到,沒有理由刻意繞遠路。cityName 篩選是選填的
// WHERE 條件,空字串代表不篩選,查全部城市——對齊 ListAttractionsByCity
// 「cityName 必填」的既有慣例不同,這裡刻意讓它選填,因為核對範圍小的
// 時候(例如剛建檔一批新城市)更可能想先看全部,不想每個城市分開查一次。
func (s *Store) ListAttractionsMissingGooglePhoto(cityName string) ([]model.Attraction, error) {
	q := s.db.Model(&attractionRow{}).
		Joins("LEFT JOIN photo_assets ON photo_assets.place_id = attractions.place_id AND (photo_assets.expires_at IS NULL OR photo_assets.expires_at > ?)", now()).
		Where("attractions.place_id IS NOT NULL AND attractions.place_id != ''").
		Where("photo_assets.place_id IS NULL")
	if cityName != "" {
		q = q.Where("attractions.city_name = ?", cityName)
	}
	var rows []attractionRow
	if err := q.Order("attractions.level ASC, attractions.created_at ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]model.Attraction, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAttraction(r))
	}
	return out, nil
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

// GetAttractionByPlaceID 依 Google place_id 查單筆景點區域資料——供
// handlePublicGeoPlaceDetailsAny(見該函式的完整說明)優先查詢:已經
// 人工建檔過的地點(place_id 命中)直接回傳既有的 Name/Summary,
// 不需要為了查同一個地點反覆打 Google Places API 消耗配額與撞全域限流;
// 查無紀錄時才 fallback 到真的呼叫 geo.Client.GetPlaceDetails,理由是
// /plan-ai 的 search_attraction 仍需要能查任意地名,不能只侷限在已建檔
// 的固定清單內。sql.ErrNoRows(透過 gorm.ErrRecordNotFound)是正常的
// 「查無建檔紀錄」情境,呼叫端應該用 errors.Is 判斷、不當成異常記錄。
func (s *Store) GetAttractionByPlaceID(placeID string) (model.Attraction, error) {
	var r attractionRow
	if err := s.db.Where("place_id = ?", placeID).First(&r).Error; err != nil {
		return model.Attraction{}, err
	}
	return toAttraction(r), nil
}

// UpdateAttractionPlaceID 更新一筆景點區域對應的 Google place_id。只更新
// place_id 與 updated_at 兩欄,不動其餘欄位——這支方法專門服務 CLI 的
// attraction-set-place-id 指令(見 handleMaintenanceAttractionUpdatePlaceID
// 的完整說明),讓既有已建檔的 attraction(建檔當下沒有透過 -place/
// -place-id 帶入 place_id)也能事後補上,開始使用「地點照片漸進補圖
// 機制」。placeID 允許傳空字串(清空既有值)——這裡允許清空單純是
// place_id 本身可能需要被清除重綁(例如發現先前綁錯了 place_id),不像
// UpdateAttractionCoords 那些欄位「清空」沒有實際意義。
func (s *Store) UpdateAttractionPlaceID(id, placeID string) error {
	var value any
	if placeID != "" {
		value = placeID
	}
	return s.db.Model(&attractionRow{}).
		Where("id = ?", id).
		Updates(map[string]any{"place_id": value, "updated_at": now()}).Error
}

// UpdateAttractionCoords 更新一筆景點區域的座標。只更新 lat/lng/
// updated_at 三欄,不動其餘欄位——這支方法專門服務 CLI 的
// attraction-update 指令,修正建檔時輸入錯誤的座標,不需要重新查詢
// 外部服務,單純覆蓋兩個數值欄位。
func (s *Store) UpdateAttractionCoords(id string, lat, lng float64) error {
	return s.db.Model(&attractionRow{}).
		Where("id = ?", id).
		Updates(map[string]any{"lat": lat, "lng": lng, "updated_at": now()}).Error
}

// UpdateAttractionTheme 更新一筆景點區域是否為「主題點」(散策羅盤用語,
// 見 model.Attraction.IsTheme 欄位註解)。只更新 is_theme 與 updated_at
// 兩欄,不動其餘欄位——這支方法專門服務 CLI 的 attraction-set-theme
// 指令,讓既有已建檔的 attraction(is_theme 欄位剛新增時全部預設為
// false,不論原本 level 是多少)也能事後補上正確的主題點/精選點分類,
// 不適合塞進 attractionUpdatableFields(該白名單只收字串型欄位,
// is_theme 是布林型)。isTheme 允許明確傳 true 或 false(不像
// UpdateAttractionPlaceID 的空字串代表清空——布林值沒有「清空」的
// 語意,一律是明確的 true/false 覆蓋)。
func (s *Store) UpdateAttractionTheme(id string, isTheme bool) error {
	return s.db.Model(&attractionRow{}).
		Where("id = ?", id).
		Updates(map[string]any{"is_theme": isTheme, "updated_at": now()}).Error
}

// attractionUpdatableFields 是 UpdateAttractionField 允許寫入的欄位白
// 名單——key 是對外(CLI -field 參數/API field 欄位)使用的名稱,value 是
// 資料庫實際的欄位名。只收字串型欄位:lat/lng 需要同時更新兩個數字
// 欄位、且有 geocode 查詢邏輯,不適合塞進這個通用的單欄位字串更新機制,
// 維持獨立的 UpdateAttractionCoords。新增可更新的字串欄位只需要在這裡
// 加一行,不需要像 name/summary 原本那樣各自新增一支 store method +
// API handler + CLI flag。
var attractionUpdatableFields = map[string]string{
	"name":     "name",
	"summary":  "summary",
	"category": "category",
}

// UpdateAttractionField 更新一筆景點區域的單一字串欄位(白名單見
// attractionUpdatableFields)。只更新該欄位與 updated_at,不動其餘欄位
// ——通用版本取代原本 UpdateAttractionName/UpdateAttractionSummary 各自
// 獨立的 store method,供 CLI 的 attraction-update -field -value 使用,
// 不重新查詢外部服務。field 不在白名單時回傳錯誤,呼叫端(API handler)
// 應轉成 400 而非讓非預期欄位被寫入。
func (s *Store) UpdateAttractionField(id, field, value string) error {
	column, ok := attractionUpdatableFields[field]
	if !ok {
		return fmt.Errorf("不支援更新欄位 %q", field)
	}
	return s.db.Model(&attractionRow{}).
		Where("id = ?", id).
		Updates(map[string]any{column: value, "updated_at": now()}).Error
}

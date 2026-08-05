package api

import (
	"context"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/tim72117/tripace/internal/geo"
)

// hotelResponse 是 GET /internal/geo/districts 與
// GET /internal/geo/districts/nearby 回應裡單筆飯店的格式,對齊
// geo.NearbyPlace(見該型別的完整說明),PhotoURL 是已編碼的 data: URI。
// 兩支端點共用同一份飯店查詢邏輯(fetchNearbyHotels),故格式抽到套件
// 層級共用,不各自重複定義。
type hotelResponse struct {
	Name        string  `json:"name"`
	Address     string  `json:"address"`
	Lat         float64 `json:"lat"`
	Lng         float64 `json:"lng"`
	PrimaryType string  `json:"primaryType"`
	PhotoURL    string  `json:"photoUrl,omitempty"`
}

// fetchNearbyHotels 以指定中心座標做一次 Nearby Search 限定 lodging
// 類型(不細分 hotel/hostel/inn 等子類,泛用即可涵蓋大部分住宿選項),
// 逐筆把 photo resource name 轉成 data URI。查詢失敗時回傳空陣列而非
// error——飯店只是附加圖層,不應該讓呼叫端的整支 API 因此失敗,見兩個
// handler 呼叫端的說明。
func fetchNearbyHotels(ctx context.Context, client *geo.Client, lat, lng, radiusMeters float64) []hotelResponse {
	hotels := make([]hotelResponse, 0)
	found, err := client.SearchNearby(ctx, lat, lng, &geo.NearbyOptions{
		RadiusMeters:  radiusMeters,
		IncludedTypes: []string{"lodging"},
		MaxResults:    20,
		IncludePhotos: true,
	})
	if err != nil {
		return hotels
	}
	for _, h := range found {
		hr := hotelResponse{
			Name:        h.Name,
			Address:     h.Address,
			Lat:         h.Lat,
			Lng:         h.Lng,
			PrimaryType: h.PrimaryType,
		}
		if h.PhotoRef != "" {
			// 單張圖片下載失敗不影響這筆飯店資料本身——只是沒有照片
			// 可顯示,理由同分區地標圖的處理方式。
			if photoURL, pErr := client.PhotoDataURI(ctx, h.PhotoRef, 200); pErr == nil {
				hr.PhotoURL = photoURL
			}
		}
		hotels = append(hotels, hr)
	}
	return hotels
}

// districtResponse 是 GET /internal/geo/districts 回應裡單筆分區/地標的
// 統一格式——不論資料來自 store.ListLandmarksByCity(人工建檔,見
// model.Landmark)或 geo.SearchKnownDistricts/SearchDistricts(即時查
// Google Places),前端拿到的形狀一致,不需要依來源分別處理。
// Level 只有走資料庫路徑才會有值(1~5,見 model.Landmark 的完整說明);
// 走 Google Places 路徑的結果一律不帶 level(前端據此判斷全部顯示,
// 不受縮放層級篩選——這批資料目前沒有分級資訊可用)。
type districtResponse struct {
	Name             string  `json:"name"`
	Lat              float64 `json:"lat"`
	Lng              float64 `json:"lng"`
	PlaceCount       int     `json:"placeCount,omitempty"`
	LandmarkPhotoURL string  `json:"landmarkPhotoUrl,omitempty"`
	LandmarkName     string  `json:"landmarkName,omitempty"`
	RadiusMeters     int     `json:"radiusMeters,omitempty"`
	Summary          string  `json:"summary,omitempty"`
	Level            int     `json:"level,omitempty"`
}

// GET /internal/geo/districts?city={城市名稱}
//
// 供地理輪廓底圖(構想 6,見 docs/TRIP_PLANNING_DESIGN_DISCUSSION.md)使用:
// 用 Places API 對「{city} 觀光景點」做一次廣泛文字搜尋,依每筆結果所屬的
// 行政區/次分區分組、算出各區重心座標,不需要 LLM 生成。
//
// 這支端點刻意不依賴 Trip 資料——目前 Trip 型別沒有目的地城市欄位(見
// types.ts 的 Trip),暫由前端提供 city 查詢參數輸入,待之後 Trip 補上
// 目的地城市欄位時再改由後端從 Trip 帶出、前端不需再手動輸入。
//
// 回傳的每個 District 的 landmarkPhotoUrl 已經是編碼好的 data: URI
// (見 geo.SearchDistricts/fetchPhotoAsDataURI 的說明),圖片資料直接
// 內嵌在這支端點的 JSON 回應裡——不再另外開一支圖片代理端點:圖片是
// 隨這支已驗證(internalAuth)的 JSON 回應一起送出,前端透過既有的
// fetch()+Authorization header 拿到即可直接當 <img src> 用,不受
// 瀏覽器 <img> 標籤無法附加自訂驗證 header 的限制,也不需要額外開一支
// 不驗證的公開端點。
func (s *Server) handleGeoDistricts(w http.ResponseWriter, r *http.Request) {
	city := r.URL.Query().Get("city")
	if city == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 city 查詢參數")
		return
	}

	// 三層 fallback,依優先順序:
	//  1. store.ListLandmarksByCity——人工建檔的正式資料(見 model.Landmark、
	//     cmd/cli 的 landmark-add 等指令),含知名度分級(level),讓前端能
	//     依縮放層級篩選顯示粒度。這是最新、最準確的資料來源。
	//  2. geo.SearchKnownDistricts——手動整理但寫死在程式碼的少量城市資料
	//     (見 district_aliases.go),沒有分級,是資料庫方案上線前的過渡
	//     資料,之後應逐步把這裡的城市搬進資料庫、汰除這條路徑。
	//  3. geo.SearchDistricts——即時查 Google Places、依 addressComponents
	//     反推分組,涵蓋任何城市但只有官方行政區劃名稱,無法呈現「古城區」
	//     這類觀光慣稱,是完全沒有人工資料時的最終後備。
	var districts []districtResponse
	if landmarks, err := s.store.ListLandmarksByCity(city); err == nil && len(landmarks) > 0 {
		for _, l := range landmarks {
			dr := districtResponse{
				Name:         l.Name,
				Lat:          l.Lat,
				Lng:          l.Lng,
				RadiusMeters: l.RadiusMeters,
				Level:        l.Level,
			}
			if l.Summary != nil {
				dr.Summary = *l.Summary
			}
			if l.PhotoURL != nil {
				dr.LandmarkPhotoURL = *l.PhotoURL
			}
			districts = append(districts, dr)
		}
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)
	client.SetCache(s.photoCache)

	// 這支端點會同步下載每個分區的地標圖片(見 SearchDistricts 內部
	// fetchPhotoAsDataURI 的呼叫),逐張圖片各自一次 HTTP 請求,故逾時
	// 設寬鬆一些(原本純文字查詢只需要 8 秒)。
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	ctx = geo.WithCaller(ctx, "handleGeoDistricts")
	ctx = geo.WithPath(ctx, r.URL.Path)

	if len(districts) == 0 {
		if geoDistricts, ok := client.SearchKnownDistricts(ctx, city); ok {
			districts = toDistrictResponses(geoDistricts)
		} else {
			geoDistricts, err := client.SearchDistricts(ctx, city+" 觀光景點", 20)
			if err != nil {
				if err == geo.ErrNotFound {
					writeErr(w, http.StatusNotFound, "no_match", "查無「"+city+"」相關景點,無法產生地理輪廓")
					return
				}
				writeErr(w, http.StatusBadGateway, "geo_districts_failed", err.Error())
				return
			}
			districts = toDistrictResponses(geoDistricts)
		}
	}

	// 飯店圖層:以「所有分區重心的平均值」當整座城市的概略中心,查詢
	// 半徑刻意比一般地點推薦(recommend_nearby 預設 1500m)大得多,
	// 因為這裡要涵蓋的是整座城市,不是單一景點周邊。找不到飯店、或
	// 這一步查詢失敗都不視為整體端點失敗(見 fetchNearbyHotels 的說明)。
	hotels := make([]hotelResponse, 0)
	if len(districts) > 0 {
		var latSum, lngSum float64
		for _, d := range districts {
			latSum += d.Lat
			lngSum += d.Lng
		}
		centerLat := latSum / float64(len(districts))
		centerLng := lngSum / float64(len(districts))
		hotels = fetchNearbyHotels(ctx, client, centerLat, centerLng, 15000)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"city":      city,
		"districts": districts,
		"hotels":    hotels,
	})
}

// toDistrictResponses 把 geo.District(即時查 Google Places 得到的結果,
// 見 geo.SearchDistricts/SearchKnownDistricts)轉成統一的
// districtResponse 格式。這條路徑的資料沒有知名度分級,Level 固定為 0
// (json 的 omitempty 讓它不出現在回應裡)。
func toDistrictResponses(in []geo.District) []districtResponse {
	out := make([]districtResponse, 0, len(in))
	for _, d := range in {
		out = append(out, districtResponse{
			Name:             d.Name,
			Lat:              d.Lat,
			Lng:              d.Lng,
			PlaceCount:       d.PlaceCount,
			LandmarkPhotoURL: d.LandmarkPhotoURL,
			LandmarkName:     d.LandmarkName,
			RadiusMeters:     d.RadiusMeters,
			Summary:          d.Summary,
		})
	}
	return out
}

// GET /internal/geo/geocode?query={地名/城市名}
//
// 供地理輪廓底圖的城市搜尋框使用:只把輸入字串解析成一組座標,不查詢
// 景點/分區/飯店資料——「搜尋只負責定位,把地圖移過去」,之後畫面上
// 該顯示什麼資料,一律交給 handleGeoDistrictsNearby 依地圖當時的可視
// 範圍(bounds)另外查詢,兩個關注點刻意分開,不像 handleGeoDistricts
// 那樣把「找座標」與「查資料」耦合在同一支端點裡。
//
// 用 geo.Client.Geocode(傳統 Geocoding API)而非 Places API 文字搜尋:
// 只需要「這個地名大概在哪」這組座標,不需要 Places 額外回傳的分類/
// 評分/照片等資料,Geocoding API 對純地名/城市名查詢既快又不計入
// Places 配額,理由同 entry_geocode.go 的 handleGeocodeEntry。
func (s *Server) handleGeoGeocode(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("query")
	if query == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 query 查詢參數")
		return
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	ctx = geo.WithCaller(ctx, "handleGeoGeocode")
	ctx = geo.WithPath(ctx, r.URL.Path)

	result, err := client.Geocode(ctx, query)
	if err != nil {
		if err == geo.ErrNotFound {
			writeErr(w, http.StatusNotFound, "no_match", "查無「"+query+"」相關地點")
			return
		}
		writeErr(w, http.StatusBadGateway, "geocode_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"query":   query,
		"address": result.FormattedAddress,
		"lat":     result.Lat,
		"lng":     result.Lng,
	})
}

// GET /internal/geo/districts/nearby?lat={緯度}&lng={經度}&radius={公尺,選填}
//
// 供地理輪廓底圖「地圖移動到哪就查哪」使用:前端在地圖平移/縮放停止後
// (idle 事件),以目前地圖中心座標呼叫這支端點,不需要使用者先輸入
// 城市名稱、按查看鈕才能看到資料。
//
// 只查 store.ListLandmarksNearby(人工建檔的正式資料,見
// model.Landmark),刻意不 fallback 到即時查 Google Places(不像
// handleGeoDistricts 那樣有三層 fallback)——地圖移動是高頻互動,若
// 每次移動都即時打 Google Places API,會產生大量非預期的 API 呼叫
// 成本與延遲;只查自建資料庫既快又免費,代價是只能顯示已經人工建檔過
// 的城市(目前為台北、清邁),之後隨資料庫內容擴充,能自動涵蓋的範圍
// 也會跟著擴充,不需要改這支端點的邏輯。
//
// 找不到任何地標時不視為錯誤,直接回傳空陣列(HTTP 200)——地圖移動到
// 還沒建檔的區域是正常情況,不該回錯誤讓前端顯示紅色錯誤訊息。
func (s *Server) handleGeoDistrictsNearby(w http.ResponseWriter, r *http.Request) {
	lat, err := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", "lat 查詢參數缺失或格式錯誤")
		return
	}
	lng, err := strconv.ParseFloat(r.URL.Query().Get("lng"), 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", "lng 查詢參數缺失或格式錯誤")
		return
	}
	// radiusMeters 上限 50000(50km,同 geo.NearbyOptions.RadiusMeters 的
	// 上限,見 places.go 的說明)——這支端點只需要合法 JWT 就能呼叫(見
	// api.go 掛在 internalMux/internalAuth 之後),若不設上限,任何登入
	// 使用者(或洩漏的 token)都能反覆帶超大 radius 觸發大範圍資料庫
	// bounding box 查詢與 Google Places Nearby Search 呼叫(後者直接
	// 計費),故在送出前就夾住,不把「這個查詢半徑是否合理」完全交給
	// 下游(資料庫/第三方 API)判斷。
	const maxRadiusMeters = 50000.0
	radiusMeters := 15000.0
	if raw := r.URL.Query().Get("radius"); raw != "" {
		if parsed, err := strconv.ParseFloat(raw, 64); err == nil && parsed > 0 {
			radiusMeters = parsed
			if radiusMeters > maxRadiusMeters {
				radiusMeters = maxRadiusMeters
			}
		}
	}

	landmarks, err := s.store.ListLandmarksNearby(lat, lng, radiusMeters)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}

	districts := make([]districtResponse, 0, len(landmarks))
	for _, l := range landmarks {
		dr := districtResponse{
			Name:         l.Name,
			Lat:          l.Lat,
			Lng:          l.Lng,
			RadiusMeters: l.RadiusMeters,
			Level:        l.Level,
		}
		if l.Summary != nil {
			dr.Summary = *l.Summary
		}
		if l.PhotoURL != nil {
			dr.LandmarkPhotoURL = *l.PhotoURL
		}
		districts = append(districts, dr)
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)
	// 這支端點每次地圖移動(idle)都會觸發,是 Photo Media 重複呼叫問題
	// 最大的來源(見 SetCache/PhotoCache 的說明)——同一批飯店隨地圖小幅
	// 拖曳反覆落在查詢範圍內時,直接吃快取,不重新下載同一張照片。
	client.SetCache(s.photoCache)
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	ctx = geo.WithCaller(ctx, "handleGeoDistrictsNearby")
	ctx = geo.WithPath(ctx, r.URL.Path)
	hotels := fetchNearbyHotels(ctx, client, lat, lng, radiusMeters)

	writeJSON(w, http.StatusOK, map[string]any{
		"districts": districts,
		"hotels":    hotels,
	})
}

// placeDetailsResponse 是 GET /internal/geo/place-details 回應的單一地點
// 詳細資訊格式,對齊 geo.PlaceDetails(見該型別的完整說明)。
type placeDetailsResponse struct {
	Name     string  `json:"name"`
	Address  string  `json:"address"`
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	Rating   float64 `json:"rating,omitempty"`
	Summary  string  `json:"summary,omitempty"`
	PhotoURL string  `json:"photoUrl,omitempty"`
}

// GET /internal/geo/place-details?placeId={Google Place ID}
//
// 供「使用者點擊地圖上 Google 原生 POI 圖標」情境使用(見
// web/src/GeoOutlineMap.tsx 攔截 map click 事件、停用預設 InfoWindow 後
// 改用這支端點查詳細資料填進自訂的 GeoInfoPanel)。原生 POI 點擊只會
// 拿到一個 placeId,沒有附帶任何名稱/地址/介紹等資料,必須再打這支端點
// 才查得到內容——理由見 geo.GetPlaceDetails 的說明。
//
// 這是「使用者明確點擊、低頻觸發」的動作,跟 handleGeoPlacesNearby 同一種
// 節流考量,不像 handleGeoDistrictsNearby 那樣要顧慮地圖高頻移動觸發大量
// Google API 呼叫成本,故直接即時查 Places API,不查自建資料庫。
// placeDetailsCacheMaxAge 是 handleGeoPlaceDetails 快取結果視為新鮮的
// 上限——原生 POI 點擊是使用者互動觸發、同一個地點短期內可能被反覆點擊
// (例如來回切換比較),但地點的名稱/地址/評分/簡介不會頻繁變動,一天內
// 直接吃快取沒有正確性疑慮,同時能大幅減少 Place Details/Photo Media 的
// 重複呼叫與計費。
const placeDetailsCacheMaxAge = 24 * time.Hour

func (s *Server) handleGeoPlaceDetails(w http.ResponseWriter, r *http.Request) {
	placeID := r.URL.Query().Get("placeId")
	if placeID == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 placeId 查詢參數")
		return
	}

	// 快取命中(且未過期)直接回傳,不打 Google——place_id 是 Places API
	// 對同一地點的穩定識別碼(見 store.GetCachedPlaceDetails 的說明),
	// 這裡把整筆詳細資訊(含已轉換好的照片 data URI)一起存,快取命中時
	// 完全不需要任何額外的 Google API 呼叫。
	if cached, ok, err := s.store.GetCachedPlaceDetails(placeID, placeDetailsCacheMaxAge); err == nil && ok {
		resp := placeDetailsResponse{
			Name:    cached.Name,
			Address: cached.Address,
			Lat:     cached.Lat,
			Lng:     cached.Lng,
			Rating:  cached.Rating,
		}
		if cached.Summary != nil {
			resp.Summary = *cached.Summary
		}
		if cached.PhotoURL != nil {
			resp.PhotoURL = *cached.PhotoURL
		}
		writeJSON(w, http.StatusOK, resp)
		return
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)
	client.SetCache(s.photoCache)
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	ctx = geo.WithCaller(ctx, "handleGeoPlaceDetails")
	ctx = geo.WithPath(ctx, r.URL.Path)

	details, err := client.GetPlaceDetails(ctx, placeID)
	if err != nil {
		if err == geo.ErrNotFound {
			writeErr(w, http.StatusNotFound, "no_match", "查無這個地點的詳細資訊")
			return
		}
		writeErr(w, http.StatusBadGateway, "place_details_failed", err.Error())
		return
	}

	resp := placeDetailsResponse{
		Name:    details.Name,
		Address: details.Address,
		Lat:     details.Lat,
		Lng:     details.Lng,
		Rating:  details.Rating,
		Summary: details.Summary,
	}
	if details.PhotoRef != "" {
		// 圖片下載失敗不影響整體查詢結果——只是沒有照片可顯示,理由同
		// fetchNearbyHotels 等既有端點的處理方式。
		if photoURL, pErr := client.PhotoDataURI(ctx, details.PhotoRef, 400); pErr == nil {
			resp.PhotoURL = photoURL
		}
	}

	// 查詢成功才寫入快取(不論照片是否成功下載都值得快取名稱/地址等
	// 資料)——快取寫入失敗不影響這次回應,只是下次查詢會再打一次
	// Google,不視為這支端點的錯誤。
	var summaryPtr, photoURLPtr *string
	if resp.Summary != "" {
		summaryPtr = &resp.Summary
	}
	if resp.PhotoURL != "" {
		photoURLPtr = &resp.PhotoURL
	}
	_ = s.store.SetCachedPlaceDetails(placeID, resp.Name, resp.Address, resp.Lat, resp.Lng, resp.Rating, summaryPtr, photoURLPtr)

	writeJSON(w, http.StatusOK, resp)
}

// placeResponse 是 GET /internal/geo/places/nearby 回應裡單筆推薦地點的
// 格式——形狀與 hotelResponse 相同(名稱/地址/座標/類型/照片),但語意上
// 是「不限類型的附近推薦地點」而非「飯店」,故另外命名,不直接借用
// hotelResponse 造成語意混淆(即使目前欄位一致)。
type placeResponse struct {
	Name        string  `json:"name"`
	Address     string  `json:"address"`
	Lat         float64 `json:"lat"`
	Lng         float64 `json:"lng"`
	PrimaryType string  `json:"primaryType"`
	PhotoURL    string  `json:"photoUrl,omitempty"`
}

// GET /internal/geo/places/nearby?lat={緯度}&lng={經度}&radius={公尺,選填}
//
// 供地圖上點擊地標(構想 6 地理輪廓底圖,見 GeoOutlineMap.tsx 點擊地標
// 放大範圍後的說明)時使用:以該地標座標為中心,即時查詢 Google Places
// Nearby Search 找附近的推薦景點/餐廳/商店等,不限類型(泛用推薦,同
// internal/wanttools/recommend_nearby.go 的 LLM 工具留空 category 時的
// 行為)。
//
// 這是「使用者明確點擊、低頻觸發」的動作,不像 handleGeoDistrictsNearby
// 那樣要顧慮地圖高頻移動觸發大量 Google API 呼叫成本,故這裡直接即時查
// Places API,不像那支端點只查自建資料庫——兩支端點的節流考量不同,
// 不適合合併成同一支。
//
// 找不到任何地點時不視為錯誤,直接回傳空陣列(HTTP 200)——理由同
// handleGeoDistrictsNearby。
func (s *Server) handleGeoPlacesNearby(w http.ResponseWriter, r *http.Request) {
	lat, err := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", "lat 查詢參數缺失或格式錯誤")
		return
	}
	lng, err := strconv.ParseFloat(r.URL.Query().Get("lng"), 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", "lng 查詢參數缺失或格式錯誤")
		return
	}
	// radiusMeters 上限同 handleGeoDistrictsNearby,理由一致(避免任何
	// 登入使用者反覆帶超大 radius 觸發大範圍、直接計費的 Google API 呼叫)。
	const maxRadiusMeters = 50000.0
	radiusMeters := 1500.0
	if raw := r.URL.Query().Get("radius"); raw != "" {
		if parsed, err := strconv.ParseFloat(raw, 64); err == nil && parsed > 0 {
			radiusMeters = parsed
			if radiusMeters > maxRadiusMeters {
				radiusMeters = maxRadiusMeters
			}
		}
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)
	client.SetCache(s.photoCache)
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	ctx = geo.WithCaller(ctx, "handleGeoPlacesNearby")
	ctx = geo.WithPath(ctx, r.URL.Path)

	places := make([]placeResponse, 0)
	found, err := client.SearchNearby(ctx, lat, lng, &geo.NearbyOptions{
		RadiusMeters:  radiusMeters,
		MaxResults:    20,
		IncludePhotos: true,
	})
	if err == nil {
		for _, p := range found {
			pr := placeResponse{
				Name:        p.Name,
				Address:     p.Address,
				Lat:         p.Lat,
				Lng:         p.Lng,
				PrimaryType: p.PrimaryType,
			}
			if p.PhotoRef != "" {
				if photoURL, pErr := client.PhotoDataURI(ctx, p.PhotoRef, 200); pErr == nil {
					pr.PhotoURL = photoURL
				}
			}
			places = append(places, pr)
		}
	}
	// 查詢失敗不視為整支端點失敗,直接回傳查到的部分(這裡是空陣列)——
	// 理由同 fetchNearbyHotels 的說明,避免因為附加圖層查詢失敗讓使用者
	// 看到紅色錯誤訊息。

	writeJSON(w, http.StatusOK, map[string]any{
		"places": places,
	})
}

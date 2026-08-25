package api

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/pexels"
)

// hotelResponse 是 GET /internal/geo/attractions 與
// GET /internal/geo/attractions/nearby 回應裡單筆飯店的格式,對齊
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

// maxPhotoResults 是「查完清單後,只顯示/查圖片的前幾筆」的上限——
// Nearby Search 本身仍一次查足 MaxResults 筆(涵蓋範圍/相關性排序不受
// 影響),但逐筆下載照片是這支端點耗時的主要來源(見
// server/internal/geo/places.go 的 fetchPhotoAsDataURI,每筆是一次獨立
// 的 HTTP 請求,序列執行、無平行處理),故在圖片查詢前就把清單截斷,
// 同時限制了「要下載幾張圖」與「回傳給前端幾筆資料」,不是只縮減圖片
// 數量、清單本身筆數不變。fetchNearbyHotels 與 handleGeoPlacesNearby
// 共用這個常數,兩處是同一種取捨。
const maxPhotoResults = 3

// fetchNearbyHotels 以指定中心座標做一次 Nearby Search 限定 lodging
// 類型(不細分 hotel/hostel/inn 等子類,泛用即可涵蓋大部分住宿選項),
// 只取前 maxPhotoResults 筆查照片。查詢失敗時回傳空陣列而非 error——
// 飯店只是附加圖層,不應該讓呼叫端的整支 API 因此失敗,見兩個 handler
// 呼叫端的說明。
//
// 照片來源優先序同 handleGeoPlaceDetails 的說明:先試 Pexels(免費/
// 低成本示意圖,經 s.landmarkPhotoURL 落地到 GCS),查無結果或
// client 未注入 Pexels 才 fallback 回 Google Places 真實照片(經
// s.landmarkPhotoURLFromDataURI 落地)——這支函式現在改成 *Server
// 方法,理由是落地 GCS 需要用到 s.photoUploader,套件層級函式(改版前)
// 沒有管道能存取它。呼叫端需自行決定是否透過 client.SetPexelsClient
// 注入 Pexels client(見 handleGeoAttractions/handleGeoAttractionsNearby
// 的呼叫端)。
func (s *Server) fetchNearbyHotels(ctx context.Context, client *geo.Client, lat, lng, radiusMeters float64) []hotelResponse {
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
	if len(found) > maxPhotoResults {
		found = found[:maxPhotoResults]
	}
	for _, h := range found {
		hr := hotelResponse{
			Name:        h.Name,
			Address:     h.Address,
			Lat:         h.Lat,
			Lng:         h.Lng,
			PrimaryType: h.PrimaryType,
		}
		if client.PexelsClient() != nil {
			if photo, ok, pErr := client.PexelsClient().Search(ctx, h.Name); pErr == nil && ok {
				hr.PhotoURL = s.landmarkPhotoURL(ctx, h.PlaceID, photo.ImageURL)
			}
		}
		if hr.PhotoURL == "" && h.PhotoRef != "" {
			// 單張圖片下載失敗不影響這筆飯店資料本身——只是沒有照片
			// 可顯示,理由同分區地標圖的處理方式。
			if photoURL, pErr := client.PhotoDataURI(ctx, h.PlaceID, h.PhotoRef, 200); pErr == nil {
				hr.PhotoURL = s.landmarkPhotoURLFromDataURI(ctx, h.PlaceID, photoURL)
			}
		}
		hotels = append(hotels, hr)
	}
	return hotels
}

// attractionResponse 是 GET /internal/geo/attractions 回應裡單筆景點區域
// 的統一格式——不論資料來自 store.ListAttractionsByCity(人工建檔,見
// model.Attraction)或 geo.SearchCityAttractions(即時查 Google Places 的
// 後備資料),前端拿到的形狀一致,不需要依來源分別處理。Level 只有走
// 資料庫路徑才會有值(1~5,見 model.Attraction 的完整說明);走 Google
// Places 路徑的結果一律不帶 level(前端據此判斷全部顯示,不受縮放層級
// 篩選——這批資料目前沒有分級資訊可用)。
type attractionResponse struct {
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

// GET /internal/geo/attractions?city={城市名稱}
//
// 供地理輪廓底圖(構想 6,見 docs/TRIP_PLANNING_DESIGN_DISCUSSION.md)使用:
// 用 Places API 對「{city} 觀光景點」做一次廣泛文字搜尋,依每筆結果所屬的
// 行政區/次分區分組、算出各區重心座標,不需要 LLM 生成。
//
// 這支端點刻意不依賴 Trip 資料——目前 Trip 型別沒有目的地城市欄位(見
// types.ts 的 Trip),暫由前端提供 city 查詢參數輸入,待之後 Trip 補上
// 目的地城市欄位時再改由後端從 Trip 帶出、前端不需再手動輸入。
//
// 回傳的每個景點區域的 landmarkPhotoUrl 已經是編碼好的 data: URI
// (見 geo.SearchCityAttractions/fetchPhotoAsDataURI 的說明),圖片資料直接
// 內嵌在這支端點的 JSON 回應裡——不再另外開一支圖片代理端點:圖片是
// 隨這支已驗證(internalAuth)的 JSON 回應一起送出,前端透過既有的
// fetch()+Authorization header 拿到即可直接當 <img src> 用,不受
// 瀏覽器 <img> 標籤無法附加自訂驗證 header 的限制,也不需要額外開一支
// 不驗證的公開端點。
func (s *Server) handleGeoAttractions(w http.ResponseWriter, r *http.Request) {
	city := r.URL.Query().Get("city")
	if city == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 city 查詢參數")
		return
	}

	// 兩層 fallback,依優先順序:
	//  1. store.ListAttractionsByCity——人工建檔的正式資料(見
	//     model.Attraction、cmd/cli 的 attraction-add 等指令),含知名度
	//     分級(level),讓前端能依縮放層級篩選顯示粒度。這是最新、最
	//     準確的資料來源。
	//  2. geo.SearchCityAttractions——即時查 Google Places、依 addressComponents
	//     反推分組,涵蓋任何城市但只有官方行政區劃名稱,無法呈現「古城區」
	//     這類觀光慣稱,是完全沒有人工資料時的最終後備。
	//
	// 原本還有第二層 geo.SearchKnownDistricts(手動整理但寫死在程式碼的
	// 少量城市資料,見已刪除的 district_aliases.go)——2026-08 確認
	// 該資料集已清空、對應查表恆回傳 false,是死碼,已隨同移除(見
	// CHANGELOG)。
	var attractions []attractionResponse
	if landmarks, err := s.store.ListAttractionsByCity(city); err == nil && len(landmarks) > 0 {
		for _, l := range landmarks {
			ar := attractionResponse{
				Name:         l.Name,
				Lat:          l.Lat,
				Lng:          l.Lng,
				RadiusMeters: l.RadiusMeters,
				Level:        l.Level,
			}
			if l.Summary != nil {
				ar.Summary = *l.Summary
			}
			if l.PhotoURL != nil {
				ar.LandmarkPhotoURL = *l.PhotoURL
			}
			attractions = append(attractions, ar)
		}
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)
	client.SetCache(s.photoCache)
	client.SetPexelsClient(pexels.New(os.Getenv("PEXELS_API_KEY")))

	// 這支端點會同步下載每個景點區域的地標圖片(見 SearchCityAttractions
	// 內部 fetchPhotoAsDataURI 的呼叫),逐張圖片各自一次 HTTP 請求,故
	// 逾時設寬鬆一些(原本純文字查詢只需要 8 秒)。
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	ctx = geo.WithCaller(ctx, "handleGeoAttractions")
	ctx = geo.WithPath(ctx, r.URL.Path)

	if len(attractions) == 0 {
		geoDistricts, err := client.SearchCityAttractions(ctx, city+" 觀光景點", 20)
		if err != nil {
			if err == geo.ErrNotFound {
				writeErr(w, http.StatusNotFound, "no_match", "查無「"+city+"」相關景點,無法產生地理輪廓")
				return
			}
			writeErr(w, http.StatusBadGateway, "geo_attractions_failed", err.Error())
			return
		}
		attractions = toAttractionResponses(geoDistricts)
	}

	// 飯店圖層:以「所有景點區域重心的平均值」當整座城市的概略中心,
	// 查詢半徑刻意比一般地點推薦(recommend_nearby 預設 1500m)大得多,
	// 因為這裡要涵蓋的是整座城市,不是單一景點周邊。找不到飯店、或
	// 這一步查詢失敗都不視為整體端點失敗(見 fetchNearbyHotels 的說明)。
	hotels := make([]hotelResponse, 0)
	if len(attractions) > 0 {
		var latSum, lngSum float64
		for _, a := range attractions {
			latSum += a.Lat
			lngSum += a.Lng
		}
		centerLat := latSum / float64(len(attractions))
		centerLng := lngSum / float64(len(attractions))
		hotels = s.fetchNearbyHotels(ctx, client, centerLat, centerLng, 15000)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"city":        city,
		"attractions": attractions,
		"hotels":      hotels,
	})
}

// toAttractionResponses 把 geo.District(即時查 Google Places 得到的結果,
// 見 geo.SearchCityAttractions)轉成統一的 attractionResponse 格式。這條路徑
// 的資料沒有知名度分級,Level 固定為 0(json 的 omitempty 讓它不出現在
// 回應裡)。
func toAttractionResponses(in []geo.District) []attractionResponse {
	out := make([]attractionResponse, 0, len(in))
	for _, d := range in {
		out = append(out, attractionResponse{
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

// GET /internal/geo/geocode?query={地名/城市名/關鍵字}&biasLat={緯度,選填}&biasLng={經度,選填}
//
// 供地理輪廓底圖的城市搜尋框使用:把輸入字串解析成一組候選地點清單
// (含座標),不查詢景點區域/飯店資料——這支端點本身只回傳「Text
// Search 查到的候選」,之後畫面上該顯示什麼資料,一律交給
// handleGeoAttractionsNearby 依地圖當時的可視範圍(bounds)另外查詢,
// 兩個關注點刻意分開,不像 handleGeoAttractions 那樣把「找座標」與
// 「查資料」耦合在同一支端點裡。
//
// 這支端點原本設計給「輸入城市/地標名稱,把地圖移過去」這種定位用途
// (查到候選後純粹平移地圖,不代表查詢範圍),但實際使用上已經不只
// 這樣——使用者也會直接輸入「甜點」「拉麵」這類泛用關鍵字,期待查到
// 目前地圖所在區域附近的結果。biasLat/biasLng(前端帶目前地圖中心座標
// 過來)讓這類查詢優先偏向地圖目前所在區域(見 geo.SearchOptions.
// LocationBias 的完整說明)——只是偏向、不是限制,對「京都」這類文字
// 意圖已經很明確的地名查詢幾乎不影響,查到離目前位置很遠但文字上更
// 匹配的地點仍是預期中的行為,不是 bug。缺少這兩個參數時退回不套用
// 位置偏向,查詢行為不受影響。
//
// 改用 geo.Client.Search(Places API (New) Text Search)而非
// geo.Client.Geocode(傳統 Geocoding API):Geocoding API 只回傳單一
// 「最佳匹配」,對城市/觀光區/商圈這類口語化地名(不是門牌地址)常常
// 直接查無結果或答非所問,且沒有候選清單可退——這是實際回報過的體驗
// 問題(規劃分頁很容易找不到地點)。Places Text Search 偏向地標/商家/
// 觀光區查詢,且能回傳多筆候選(見下方 maxGeoGeocodeCandidates),讓
// 使用者自己從地圖上標出來的候選點裡挑對的那一個,不用完全依賴系統
// 猜中「使用者說的到底是哪個地方」。entry_geocode.go 的
// handleGeocodeEntry 是另一支獨立端點,查詢情境是「橋樑/道路」這類
// Places Text Search 支援較弱的地理要素,不受這次變更影響,仍沿用
// Geocoding API(見該檔案的說明)。
//
// maxGeoGeocodeCandidates:對齊 geo.Client.Search 的官方硬性上限(見該
// 函式的說明)——不是額外的節流,單純把後端請求到的候選筆數上限跟
// Google 這支 API 本身能給到的上限拉齊,讓使用者能看到 Text Search
// 排序前 20 名的完整候選清單。
const maxGeoGeocodeCandidates = 20

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

	// biasLat/biasLng:選填,前端(GeoOutlinePanel.tsx)帶目前地圖中心
	// 座標過來——讓「甜點」「apple」這類沒有明確指向單一地點的泛用
	// 關鍵字查詢優先偏向地圖目前所在區域,對「京都」這類文字意圖已經
	// 很明確的地名查詢幾乎不影響(見 geo.SearchOptions.LocationBias 的
	// 完整說明)。缺少或格式錯誤時視為未提供,不套用位置偏向、也不視為
	// 錯誤——這支端點在沒有地圖中心可用的情境下(例如尚未建立地圖)
	// 仍應該能正常查詢。
	var locationBias *geo.LocationBias
	if latRaw, lngRaw := r.URL.Query().Get("biasLat"), r.URL.Query().Get("biasLng"); latRaw != "" && lngRaw != "" {
		if lat, err := strconv.ParseFloat(latRaw, 64); err == nil {
			if lng, err := strconv.ParseFloat(lngRaw, 64); err == nil {
				locationBias = &geo.LocationBias{Lat: lat, Lng: lng}
			}
		}
	}

	places, err := client.Search(ctx, query, &geo.SearchOptions{MaxResults: maxGeoGeocodeCandidates, LocationBias: locationBias})
	if err != nil {
		if err == geo.ErrNotFound {
			writeErr(w, http.StatusNotFound, "no_match", "查無「"+query+"」相關地點")
			return
		}
		writeErr(w, http.StatusBadGateway, "geocode_failed", err.Error())
		return
	}
	if len(places) == 0 {
		writeErr(w, http.StatusNotFound, "no_match", "查無「"+query+"」相關地點")
		return
	}

	// placeId:供前端(GeoOutlinePanel.tsx 的 handleGeocodeCandidateSelect)
	// 拿去換發 GET /internal/geo/place-details,取得完整資訊(含照片,
	// Pexels-first + GCS 落地,跟點地圖上原生 POI 完全同一套流程),不再
	// 只是純定位用的座標——見 geo.Client.Search 的 fieldMask 說明,這裡
	// 選擇性帶出(理論上 Text Search 每筆結果都會有 id,查無則省略此欄位,
	// 前端據此判斷是否要走這條補查流程)。
	candidates := make([]map[string]any, len(places))
	for i, p := range places {
		c := map[string]any{
			"name":    p.Name,
			"address": p.Address,
			"lat":     p.Lat,
			"lng":     p.Lng,
		}
		if p.PlaceID != "" {
			c["placeId"] = p.PlaceID
		}
		candidates[i] = c
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"query":      query,
		"candidates": candidates,
	})
}

// GET /internal/geo/attractions/nearby?lat={緯度}&lng={經度}&radius={公尺,選填}
//
// 供地理輪廓底圖「地圖移動到哪就查哪」使用:前端在地圖平移/縮放停止後
// (idle 事件),以目前地圖中心座標呼叫這支端點,不需要使用者先輸入
// 城市名稱、按查看鈕才能看到資料。
//
// 只查 store.ListAttractionsNearby(人工建檔的正式資料,見
// model.Attraction),刻意不 fallback 到即時查 Google Places(不像
// handleGeoAttractions 那樣有三層 fallback)——地圖移動是高頻互動,若
// 每次移動都即時打 Google Places API,會產生大量非預期的 API 呼叫
// 成本與延遲;只查自建資料庫既快又免費,代價是只能顯示已經人工建檔過
// 的城市(目前為台北、清邁),之後隨資料庫內容擴充,能自動涵蓋的範圍
// 也會跟著擴充,不需要改這支端點的邏輯。
//
// 找不到任何地標時不視為錯誤,直接回傳空陣列(HTTP 200)——地圖移動到
// 還沒建檔的區域是正常情況,不該回錯誤讓前端顯示紅色錯誤訊息。
// maxNearbyRadiusMeters 是所有「以座標為中心、依半徑查附近資料」端點
// 共用的查詢半徑上限(50km,同 geo.NearbyOptions.RadiusMeters 的上限,
// 見 places.go 的說明)——這些端點只需要合法 JWT 就能呼叫(見 api.go
// 掛在 internalMux/internalAuth 之後),若不設上限,任何登入使用者
// (或洩漏的 token)都能反覆帶超大 radius 觸發大範圍資料庫 bounding
// box 查詢與 Google Places Nearby Search 呼叫(後者直接計費),故在
// 送出前就夾住,不把「這個查詢半徑是否合理」完全交給下游(資料庫/
// 第三方 API)判斷。提升到套件層級常數,原本 parseNearbyLatLngRadius
// 與 handleGeoPlacesNearby 各自宣告一份同樣的值,容易改一處漏改另一處。
const maxNearbyRadiusMeters = 50000.0

// parseNearbyLatLngRadius 解析 lat/lng/radius 這三個查詢參數,供
// handleGeoAttractionsNearby、handleGeoAttractionsOnlyNearby 與
// handleGeoPlacesNearby 共用——三支端點都是「以座標為中心、依半徑查
// 附近資料」的形狀,只是後面接的資料源不同(前兩者查自家資料庫,分別
// 額外查即時 Google Places 飯店/純查自家資料庫;後者即時查 Google
// Places Nearby Search),不需要各自重複一份參數解析與夾限邏輯。
// defaultRadius 由呼叫端決定——handleGeoPlacesNearby 是使用者明確點擊
// 類別標籤觸發、範圍通常較小(1500),另兩支是地圖可視範圍查詢、範圍
// 較大(15000),兩者的合理預設值不同,不適合寫死在這支共用函式裡。
func parseNearbyLatLngRadius(r *http.Request, defaultRadius float64) (lat, lng, radiusMeters float64, err error) {
	lat, err = strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	if err != nil {
		return 0, 0, 0, errInvalidLat
	}
	lng, err = strconv.ParseFloat(r.URL.Query().Get("lng"), 64)
	if err != nil {
		return 0, 0, 0, errInvalidLng
	}
	radiusMeters = defaultRadius
	if raw := r.URL.Query().Get("radius"); raw != "" {
		if parsed, err := strconv.ParseFloat(raw, 64); err == nil && parsed > 0 {
			radiusMeters = parsed
			if radiusMeters > maxNearbyRadiusMeters {
				radiusMeters = maxNearbyRadiusMeters
			}
		}
	}
	return lat, lng, radiusMeters, nil
}

var (
	errInvalidLat = fmt.Errorf("lat 查詢參數缺失或格式錯誤")
	errInvalidLng = fmt.Errorf("lng 查詢參數缺失或格式錯誤")
)

// listAttractionResponses 查 store.ListAttractionsNearby 並轉成回應格式,
// 供 handleGeoAttractionsNearby 與 handleGeoAttractionsOnlyNearby 共用。
func (s *Server) listAttractionResponses(lat, lng, radiusMeters float64) ([]attractionResponse, error) {
	landmarks, err := s.store.ListAttractionsNearby(lat, lng, radiusMeters)
	if err != nil {
		return nil, err
	}
	attractions := make([]attractionResponse, 0, len(landmarks))
	for _, l := range landmarks {
		ar := attractionResponse{
			Name:         l.Name,
			Lat:          l.Lat,
			Lng:          l.Lng,
			RadiusMeters: l.RadiusMeters,
			Level:        l.Level,
		}
		if l.Summary != nil {
			ar.Summary = *l.Summary
		}
		if l.PhotoURL != nil {
			ar.LandmarkPhotoURL = *l.PhotoURL
		}
		attractions = append(attractions, ar)
	}
	return attractions, nil
}

func (s *Server) handleGeoAttractionsNearby(w http.ResponseWriter, r *http.Request) {
	lat, lng, radiusMeters, err := parseNearbyLatLngRadius(r, 15000)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}

	attractions, err := s.listAttractionResponses(lat, lng, radiusMeters)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)
	// 這支端點每次使用者按下「搜尋這個區域」都會觸發,是 Photo Media 重複
	// 呼叫問題最大的來源(見 SetCache/PhotoCache 的說明)——同一批飯店隨
	// 地圖小幅拖曳反覆落在查詢範圍內時,直接吃快取,不重新下載同一張照片。
	client.SetCache(s.photoCache)
	client.SetPexelsClient(pexels.New(os.Getenv("PEXELS_API_KEY")))
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	ctx = geo.WithCaller(ctx, "handleGeoAttractionsNearby")
	ctx = geo.WithPath(ctx, r.URL.Path)
	hotels := s.fetchNearbyHotels(ctx, client, lat, lng, radiusMeters)

	writeJSON(w, http.StatusOK, map[string]any{
		"attractions": attractions,
		"hotels":      hotels,
	})
}

// GET /internal/geo/attractions/nearby-only?lat={緯度}&lng={經度}&radius={公尺,選填}
//
// 跟 handleGeoAttractionsNearby 查詢同一份景點區域資料(store.
// ListAttractionsNearby,人工建檔、免費),但刻意不附帶 hotels——後者是
// 即時查 Google Places、直接計費,故 handleGeoAttractionsNearby 才需要
// 收在使用者明確按下「搜尋這個區域」按鈕之後才觸發。這支端點的存在
// 目的正是要繞開那個限制:景點區域本身查詢免費,前端可以單純依地圖
// 可視範圍/縮放自動觸發(idle 事件),不需要等使用者按鈕,只要不會連帶
// 觸發付費的飯店查詢即可——見 web/src/GeoOutlineMap.tsx 的說明。
func (s *Server) handleGeoAttractionsOnlyNearby(w http.ResponseWriter, r *http.Request) {
	lat, lng, radiusMeters, err := parseNearbyLatLngRadius(r, 15000)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}

	attractions, err := s.listAttractionResponses(lat, lng, radiusMeters)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"attractions": attractions,
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
// 節流考量,不像 handleGeoAttractionsNearby 那樣要顧慮地圖高頻移動觸發大量
// Google API 呼叫成本,故直接即時查 Places API,不查自建資料庫。
// placeDetailsCacheMaxAge 是 handleGeoPlaceDetails 快取結果視為新鮮的
// 上限——原生 POI 點擊是使用者互動觸發、同一個地點短期內可能被反覆點擊
// (例如來回切換比較),但地點的名稱/地址/評分/簡介不會頻繁變動,一天內
// 直接吃快取沒有正確性疑慮,同時能大幅減少 Place Details/Photo Media 的
// 重複呼叫與計費。
const placeDetailsCacheMaxAge = 24 * time.Hour

// landmarkPhotoURL 把地圖上點選任意地點查到的 Pexels 示意圖網址落地到
// GCS(見 internal/photostorage 的完整說明),回傳我方 bucket 底下的
// 公開 URL;落地失敗(未設定 GCS_PHOTO_BUCKET、下載/上傳出錯)時降級
// 回傳原始的 sourceURL,不阻擋整體查詢流程——理由同景點區域建檔既有的
// 「照片是輔助欄位」降級慣例(見 maintenance.go 的呼叫端)。這裡跟景點
// 建檔共用同一個 s.photoUploader,只是 objectKey 換成 placeID(這條
// 路徑唯一的穩定識別碼,跟 place_details_cache 的 key 一致),寫入
// place-details/ 前綴(見 UploadDataURI 的說明),不與 attractions/
// 前綴的人工建檔資料混在一起。
func (s *Server) landmarkPhotoURL(ctx context.Context, placeID, sourceURL string) string {
	uploaded, err := s.photoUploader.Upload(ctx, placeID, sourceURL)
	if err != nil {
		return sourceURL
	}
	return uploaded
}

// landmarkPhotoURLFromDataURI 是 landmarkPhotoURL 的 data: URI 版本——
// Google Photo Media 這條路徑(client.PhotoDataURI)回傳的已經是 base64
// 編碼好的圖片資料,不是外部網址,故改呼叫 UploadDataURI(解碼後上傳,
// 不需要另外發 HTTP 請求下載)。落地失敗時降級回傳原始的 data URI,
// 理由同 landmarkPhotoURL。
func (s *Server) landmarkPhotoURLFromDataURI(ctx context.Context, placeID, dataURI string) string {
	uploaded, err := s.photoUploader.UploadDataURI(ctx, placeID, dataURI)
	if err != nil {
		return dataURI
	}
	return uploaded
}

// photoOnlyResponse 是 photoOnly=1 時的回應形狀——只有 photoUrl,不含
// name/address/rating/summary,理由見 handleGeoPlaceDetails 對 photoOnly
// 分支的說明。
type photoOnlyResponse struct {
	PhotoURL string `json:"photoUrl,omitempty"`
}

// textOnlyResponse 是 textOnly=1 時的回應形狀——name/address/rating/
// summary,不含 photoUrl,理由見 handleGeoPlaceDetails 對 textOnly 分支
// 的說明。
type textOnlyResponse struct {
	Name    string  `json:"name"`
	Address string  `json:"address"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	Rating  float64 `json:"rating,omitempty"`
	Summary string  `json:"summary,omitempty"`
}

func (s *Server) handleGeoPlaceDetails(w http.ResponseWriter, r *http.Request) {
	placeID := r.URL.Query().Get("placeId")
	if placeID == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 placeId 查詢參數")
		return
	}
	// photoOnly:供 GeoHotelSidebar.tsx 的搜尋結果清單延遲載入使用(見該
	// 檔案 GeocodeCandidateItem 的說明)——清單一次最多 20 筆候選,每筆
	// 捲進可視範圍就查一次,若比照原生 POI 點擊那樣打 Google
	// GetPlaceDetails(Pro 級,要收費)+ Photo Media,一次搜尋捲完整份
	// 清單的成本太高。這個模式下:
	//   1. 快取命中就沿用完整快取的 photoUrl 欄位(理由同一般模式,不重複
	//      打任何外部 API);
	//   2. 快取未命中時只試 Pexels(免費),用呼叫端傳入的 name 查詢
	//      (清單本來就已經有 Text Search 查到的名稱,不需要為了拿名稱
	//      再多打一次 Google Details),查無結果就回空,不 fallback
	//      Google GetPlaceDetails/Photo Media——這是刻意的成本上限,
	//      「只查圖像」代表只承擔 Pexels 這一種免費查詢的成本,不是
	//      「換一種方式取得同樣完整的資料」。
	//   3. 不寫入 place_details_cache——這個模式下沒有 address/rating/
	//      summary 等完整資料,寫入會讓快取列殘缺不全,之後真正需要完整
	//      資訊時(使用者點選這筆候選,見 handleGeocodeCandidateSelect)
	//      仍會呼叫這支端點的一般模式重新查一次完整內容,兩種模式的
	//      快取各自獨立、互不干擾更安全。
	photoOnly := r.URL.Query().Get("photoOnly") == "1"
	// textOnly:供 GeoOutlinePanel.tsx 的 handleGeocodeCandidateSelect
	// 使用——使用者點選候選後,先打這個模式立即拿到名稱/地址/評分/簡介
	// 開啟資訊卡(此時 photoUrl 還沒有值,前端顯示佔位圖),不必等照片
	// 查完才有畫面反應;照片另外並行呼叫 photoOnly 模式取得,查到後再
	// 補上實際圖片。跟 photoOnly 對稱:快取未命中時完全跳過照片查詢
	// (不打 Pexels/Google Photo Media),也不寫入快取(理由同 photoOnly
	// 分支的說明,這個模式沒有 photoUrl 可安全寫入完整快取列)。
	textOnly := r.URL.Query().Get("textOnly") == "1"

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

		// textOnly 不需要照片,略過下面的 Pexels 補查(理由見 textOnly
		// 宣告處的說明),直接回文字部分。
		if textOnly {
			writeJSON(w, http.StatusOK, textOnlyResponse{
				Name: resp.Name, Address: resp.Address, Lat: resp.Lat, Lng: resp.Lng,
				Rating: resp.Rating, Summary: resp.Summary,
			})
			return
		}

		// 快取命中但當初沒查到照片(PhotoURL 為空)時,單獨補一次
		// Pexels 查詢——只試 Pexels,不重新呼叫 Google GetPlaceDetails
		// (這裡快取命中的整個重點就是不打 Google;快取本身也沒存
		// PhotoRef,見 store.GetCachedPlaceDetails 的說明,無法直接跟
		// Google 換圖,除非重新查一次 Details,那就違背了這裡「命中就
		// 不打 Google」的設計)。Pexels 仍查不到就維持無圖回傳,不視為
		// 錯誤。補到圖時一併更新回快取,下次同一 placeID 命中就不用再
		// 重複查一次 Pexels。photoOnly 模式一樣適用這段補查邏輯——快取
		// 命中的情況下,不論哪種模式,補圖成本都相同(只試 Pexels),
		// 不需要另外區分。
		if resp.PhotoURL == "" {
			pexelsClient := pexels.New(os.Getenv("PEXELS_API_KEY"))
			pctx, pcancel := context.WithTimeout(r.Context(), 5*time.Second)
			if photo, ok, pErr := pexelsClient.Search(pctx, resp.Name); pErr == nil && ok {
				resp.PhotoURL = s.landmarkPhotoURL(pctx, placeID, photo.ImageURL)
				photoURL := resp.PhotoURL
				_ = s.store.SetCachedPlaceDetails(placeID, resp.Name, resp.Address, resp.Lat, resp.Lng, resp.Rating, cached.Summary, &photoURL)
			}
			pcancel()
		}

		if photoOnly {
			writeJSON(w, http.StatusOK, photoOnlyResponse{PhotoURL: resp.PhotoURL})
			return
		}
		writeJSON(w, http.StatusOK, resp)
		return
	}

	if textOnly {
		apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
		client := geo.New(apiKey)
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
		writeJSON(w, http.StatusOK, textOnlyResponse{
			Name: details.Name, Address: details.Address, Lat: details.Lat, Lng: details.Lng,
			Rating: details.Rating, Summary: details.Summary,
		})
		return
	}

	if photoOnly {
		name := r.URL.Query().Get("name")
		if name == "" {
			writeErr(w, http.StatusBadRequest, "invalid_input", "photoOnly 模式缺少 name 查詢參數")
			return
		}
		pexelsClient := pexels.New(os.Getenv("PEXELS_API_KEY"))
		pctx, pcancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer pcancel()
		resp := photoOnlyResponse{}
		if photo, ok, pErr := pexelsClient.Search(pctx, name); pErr == nil && ok {
			resp.PhotoURL = s.landmarkPhotoURL(pctx, placeID, photo.ImageURL)
		}
		writeJSON(w, http.StatusOK, resp)
		return
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)
	client.SetCache(s.photoCache)
	client.SetPexelsClient(pexels.New(os.Getenv("PEXELS_API_KEY")))
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
	// 照片來源優先序同 geo.Client.SearchCityAttractions 的說明:先試
	// Pexels(免費/低成本示意圖),查無結果或未注入時才 fallback 回
	// Google Places 這個地點的真實照片——原生 POI 點擊是使用者互動觸發
	// 的低頻查詢,但 Photo Media API 仍按張數計費,能省則省。
	if client.PexelsClient() != nil {
		if photo, ok, pErr := client.PexelsClient().Search(ctx, details.Name); pErr == nil && ok {
			resp.PhotoURL = s.landmarkPhotoURL(ctx, placeID, photo.ImageURL)
		}
	}
	if resp.PhotoURL == "" && details.PhotoRef != "" {
		// 圖片下載失敗不影響整體查詢結果——只是沒有照片可顯示,理由同
		// fetchNearbyHotels 等既有端點的處理方式。
		if photoURL, pErr := client.PhotoDataURI(ctx, placeID, details.PhotoRef, 400); pErr == nil {
			resp.PhotoURL = s.landmarkPhotoURLFromDataURI(ctx, placeID, photoURL)
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
	// Category:後端封裝過的自訂分類,值域固定是 allowedPlaceTypes 的三個
	// 字串之一(lodging/tourist_attraction/restaurant),查無對應分類時為
	// 空字串(前端據此退回泛用呈現,例如相機圖示)——見 classifyPlaceCategory
	// 的完整說明。前端應該一律讀這個欄位做分類判斷,不要自己再解讀
	// PrimaryType(Google 原始分類,值域是上百種細分類型,如
	// "hotel"/"japanese_restaurant",直接拿來跟 lodging/restaurant 這類
	// 查詢用的類型字面值比對幾乎必定比對失敗,這是實際發生過的 bug)。
	// PrimaryType 保留在回應裡純供除錯/未來需要更細分類時使用,不移除。
	Category string `json:"category,omitempty"`
	PhotoURL string `json:"photoUrl,omitempty"`
}

// classifyPlaceCategory 把 Google Places 回傳的 primaryType(細分類型,如
// "hotel"/"japanese_restaurant"/"museum")歸類成 allowedPlaceTypes 的三個
// 值之一——Google 用 includedTypes: ["lodging"] 查詢時,實際回傳的
// primaryType 幾乎不會直接等於 "lodging" 本身,而是更精確的細分類型,故
// 這裡列舉 Google Places API 底下常見的住宿/餐飲細分類型(參考 Places API
// Table A 的 Lodging/Food and Drink 分類),餐廳額外用 "_restaurant" 結尾
// 的通用規則涵蓋各種料理系(如 japanese_restaurant、italian_restaurant,
// Google 這類細分類型數量很多,窮舉字面值不切實際)。查無對應分類回傳
// 空字串,不強塞一個不精確的分類。
var (
	lodgingPrimaryTypes = map[string]bool{
		"lodging": true, "hotel": true, "motel": true, "resort_hotel": true,
		"extended_stay_hotel": true, "guest_house": true, "bed_and_breakfast": true,
		"hostel": true, "inn": true, "cottage": true, "farmstay": true,
		"campground": true, "rv_park": true, "private_guest_room": true,
	}
	restaurantPrimaryTypes = map[string]bool{
		"restaurant": true, "cafe": true, "bar": true, "bakery": true,
		"meal_takeaway": true, "meal_delivery": true, "fast_food_restaurant": true,
		"food_court": true, "coffee_shop": true,
	}
)

func classifyPlaceCategory(primaryType string) string {
	switch {
	case primaryType == "tourist_attraction":
		return "tourist_attraction"
	case lodgingPrimaryTypes[primaryType]:
		return "lodging"
	case restaurantPrimaryTypes[primaryType] || strings.HasSuffix(primaryType, "_restaurant"):
		return "restaurant"
	default:
		return ""
	}
}

// allowedPlaceTypes 是 handleGeoPlacesNearby 的 type 查詢參數白名單——
// 對齊地圖上方的類別標籤列(飯店/景點/餐廳,見 web/src/GeoOutlineMap.tsx
// 的類別標籤說明),只接受這幾個已知類別,不接受任意字串直接透傳給
// Google——這是目前 UI 唯一會用到的類別集合,收斂輸入範圍比開放任意
// Places API type 字串更安全(雖然無效值頂多讓 Google 回錯誤,不構成
// 注入風險,但沒必要開放超出實際使用情境的輸入),之後 UI 真的需要新
// 類別時再擴充這個白名單即可。
var allowedPlaceTypes = map[string]bool{
	"lodging":            true, // 飯店
	"tourist_attraction": true, // 景點
	"restaurant":         true, // 餐廳
}

// GET /internal/geo/places/nearby?lat={緯度}&lng={經度}&radius={公尺,選填}&type={類別,選填}
//
// 供兩種情境使用:
//  1. 地圖上點擊地標(構想 6 地理輪廓底圖,見 GeoOutlineMap.tsx 點擊地標
//     放大範圍後的說明)——不帶 type,即時查詢 Google Places Nearby
//     Search 找附近的推薦景點/餐廳/商店等,不限類型(泛用推薦,同
//     internal/wanttools/recommend_nearby.go 的 LLM 工具留空 category
//     時的行為)。
//  2. 地圖上方的類別標籤列(飯店/景點/餐廳)——帶 type,限定只查詢該
//     類別,對齊 geo.NearbyOptions.IncludedTypes(見該欄位的說明)。
//
// 這是「使用者明確點擊、低頻觸發」的動作,不像 handleGeoAttractionsNearby
// 那樣要顧慮地圖高頻移動觸發大量 Google API 呼叫成本,故這裡直接即時查
// Places API,不像那支端點只查自建資料庫——兩支端點的節流考量不同,
// 不適合合併成同一支。
//
// 找不到任何地點時不視為錯誤,直接回傳空陣列(HTTP 200)——理由同
// handleGeoAttractionsNearby。
func (s *Server) handleGeoPlacesNearby(w http.ResponseWriter, r *http.Request) {
	// defaultRadius 1500——理由同 handleGeoAttractionsNearby(15000)的
	// 差異說明:這支端點是使用者明確點擊類別標籤觸發的低頻動作,查詢
	// 範圍通常較小,不像地圖可視範圍查詢那樣需要涵蓋大片區域。上限
	// (maxNearbyRadiusMeters)與參數解析邏輯跟另外兩支「以座標為中心
	// 查附近資料」的端點共用,見 parseNearbyLatLngRadius 的完整說明。
	lat, lng, radiusMeters, err := parseNearbyLatLngRadius(r, 1500)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}

	var includedTypes []string
	if placeType := r.URL.Query().Get("type"); placeType != "" {
		if !allowedPlaceTypes[placeType] {
			writeErr(w, http.StatusBadRequest, "invalid_input", "type 參數不支援: "+placeType)
			return
		}
		includedTypes = []string{placeType}
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)
	client.SetCache(s.photoCache)
	client.SetPexelsClient(pexels.New(os.Getenv("PEXELS_API_KEY")))
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	ctx = geo.WithCaller(ctx, "handleGeoPlacesNearby")
	ctx = geo.WithPath(ctx, r.URL.Path)

	places := make([]placeResponse, 0)
	found, err := client.SearchNearby(ctx, lat, lng, &geo.NearbyOptions{
		RadiusMeters:  radiusMeters,
		MaxResults:    20,
		IncludePhotos: true,
		IncludedTypes: includedTypes,
	})
	if err == nil {
		// 只取前 maxPhotoResults 筆顯示/查圖片,理由見該常數的說明。
		if len(found) > maxPhotoResults {
			found = found[:maxPhotoResults]
		}
		for _, p := range found {
			pr := placeResponse{
				Name:        p.Name,
				Address:     p.Address,
				Lat:         p.Lat,
				Lng:         p.Lng,
				PrimaryType: p.PrimaryType,
				Category:    classifyPlaceCategory(p.PrimaryType),
			}
			// 照片來源優先序同 fetchNearbyHotels/handleGeoPlaceDetails 的
			// 說明:先試 Pexels(落地 GCS),查無結果才 fallback Google。
			if client.PexelsClient() != nil {
				if photo, ok, pErr := client.PexelsClient().Search(ctx, p.Name); pErr == nil && ok {
					pr.PhotoURL = s.landmarkPhotoURL(ctx, p.PlaceID, photo.ImageURL)
				}
			}
			if pr.PhotoURL == "" && p.PhotoRef != "" {
				if photoURL, pErr := client.PhotoDataURI(ctx, p.PlaceID, p.PhotoRef, 200); pErr == nil {
					pr.PhotoURL = s.landmarkPhotoURLFromDataURI(ctx, p.PlaceID, photoURL)
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

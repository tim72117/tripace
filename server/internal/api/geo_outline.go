package api

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/tim72117/tripace/internal/apigateway"
	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/photostorage"
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
// 照片來源:Google Places 真實照片(經 s.landmarkPhotoURLFromDataURI
// 落地)——這支函式現在改成 *Server 方法,理由是落地 GCS 需要用到
// s.photoUploader,套件層級函式(改版前)沒有管道能存取它。2026-10:
// 呼叫端(handleGeoAttractions/handleGeoAttractionsNearby)已不再注入
// Pexels client,這支函式不再有 Pexels 示意圖這個來源可用。
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
		if h.PhotoRef != "" {
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

// attractionResponse(景點系統跨端點共用的回應格式)已搬到 geo_types.go
// ——見該檔案開頭的完整說明。

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
// 瀏覽器 <img> 標籤無法附加自訂驗證 header 的限制。
//
// 2026-10:這支端點原計畫比照 handleGeoAttractionsNearby/
// handleGeoAttractionsOnlyNearby 一併新增免登入版(見這兩支的完整說明),
// 但 GET /public/geo/attractions 這個路徑已被 handlePublicGeoAttractions
// (geo_outline_public.go,城市白名單限制查詢範圍)佔用——是完全不同的
// handler,不是這支的公開版本。兩者路徑衝突,需要另外決定路徑或處理
// 方式才能補上這支的公開掛載點,故這支目前仍只掛在
// /internal/geo/attractions(需 JWT),上面那句「不需要額外開一支不驗證
// 的公開端點」的舊說明只是指「圖片不需要另開代理端點」,不代表這支端點
// 整體刻意不開放公開版本——見 api.go Routes() 內
// /public/geo/attractions/nearby 註冊處的對應說明。
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
	// 2026-09:不再查/帶出 landmarkPhotoUrl(舊版曾一度改成批次查
	// photo_assets 內容,對應的 store.ListFreshPhotoAssetURLs 已隨同
	// 移除,但前端(geoAttractionOverlay.ts/useAttractionOverlays.ts)
	// 已經確認完全不讀這個欄位——地圖圖示改成掛載時各自呼叫
	// fetchGeoPlaceDetails 查詢即時內容,不再依賴這支列表端點內嵌照片,
	// 見這兩個檔案的完整說明)——使用者明確要求「完全不要使用
	// landmarkPhotoUrl」,故連
	// 後端這一批查詢/組裝邏輯也一併移除,不留著算好卻沒人讀的欄位。
	if landmarks, err := s.store.ListAttractionsByCity(city); err == nil && len(landmarks) > 0 {
		for _, landmark := range landmarks {
			attractions = append(attractions, toAttractionResponse(landmark))
		}
	}

	// 2026-10:不再注入 Pexels client——使用者明確要求規劃地圖上完全沒建檔過的
	// 城市被臨時搜尋時,不要回退用 Pexels 示意圖頂替。
	// 這支端點是「完全沒有人工建檔資料」時的最終後備
	// (len(attractions) == 0 才會走到下方 SearchCityAttractions),移除
	// Pexels 後會直接 fallback 回 Google Places 該地標的真實照片。
	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)
	client.SetCache(s.photoCache)

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
// d.LandmarkPhotoURL(geo.District 這個即時查詢型別自帶的欄位)刻意不
// 帶進 attractionResponse——2026-09 使用者明確要求「完全不要使用
// landmarkPhotoUrl」,前端已經不讀這個回應欄位(見上方 attractionResponse
// 拿掉 LandmarkPhotoURL 欄位處的完整說明)。這裡不動 geo.District 本身
// 或 geo.SearchCityAttractions 內部是否仍會觸發 Google Photo Media
// 下載這件事(那是即時查詢路徑本身的成本/行為,跟「這支端點的 JSON
// 回應要不要帶這個欄位」是兩個獨立的問題,後者才是這裡要處理的範圍)。
func toAttractionResponses(in []geo.District) []attractionResponse {
	out := make([]attractionResponse, 0, len(in))
	for _, d := range in {
		out = append(out, attractionResponse{
			Name:         d.Name,
			Lat:          d.Lat,
			Lng:          d.Lng,
			PlaceCount:   d.PlaceCount,
			LandmarkName: d.LandmarkName,
			RadiusMeters: d.RadiusMeters,
			Summary:      d.Summary,
		})
	}
	return out
}

// GET /internal/geo/geocode?query={地名/城市名/關鍵字}&mode={bias|restrict,選填}
//
//	&lat={緯度,選填}&lng={經度,選填}&radius={公尺,選填}
//
// 供地理輪廓底圖的三個查地點入口統一使用:城市搜尋框(打字輸入)、地圖
// 上方類別標籤(景點/飯店/餐廳,標籤文字當查詢詞)、「搜尋這個區域」
// 按鈕(沿用搜尋框目前文字)。三者都改走這支端點的 Text Search,不再各自
// 打不同的 Google Places 端點(原本類別標籤與搜尋這個區域走
// handleGeoPlacesNearby/handleGeoAttractionsNearby 的 Nearby Search,見
// 這兩支端點各自的完整說明)——差異只在「查詢文字從哪來」跟「範圍限制
// 參數」,由呼叫端透過 mode 參數告知這次呼叫該用哪種範圍策略,不查詢
// 景點區域/飯店資料本身(這支端點只回傳「Text Search 查到的候選」,畫面
// 上該顯示什麼資料一律交給 handleGeoAttractionsNearby 依地圖可視範圍另外
// 查詢,兩個關注點刻意分開)。
//
// mode 值域:
//   - "bias"(預設,省略也視為此值):城市搜尋框用——兩階段查詢,見下方
//     handleGeoGeocode 函式內的完整說明。lat/lng 選填,當作
//     locationBias 中心(對應原本的 biasLat/biasLng,新版沿用同一組
//     query 參數名稱,不再用 bias 前綴,理由是這組參數現在也給
//     locationRestriction 的矩形中心共用,加 bias 前綴會誤導)。
//   - "restrict":類別標籤/搜尋這個區域用——固定套用 locationRestriction,
//     不做兩階段判斷。lat/lng 必填(矩形中心),radius 選填(矩形半徑,
//     公尺,預設同 parseNearbyLatLngRadius 的既有慣例)。
//
// 改用 geo.Client.Search(Places API (New) Text Search)而非
// geo.Client.Geocode(傳統 Geocoding API):Geocoding API 只回傳單一
// 「最佳匹配」,對城市/觀光區/商圈這類口語化地名(不是門牌地址)常常
// 直接查無結果或答非所問,且沒有候選清單可退——這是實際回報過的體驗
// 問題(規劃分頁很容易找不到地點)。Places Text Search 偏向地標/商家/
// 觀光區查詢,且能回傳多筆候選(見下方 maxGeoGeocodeCandidates),讓
// 使用者自己從地圖上標出來的候選點裡挑對的那一個,不用完全依賴系統
// 猜中「使用者說的到底是哪個地方」。
//
// maxGeoGeocodeCandidates:對齊 geo.Client.Search 的官方硬性上限(見該
// 函式的說明)——不是額外的節流,單純把後端請求到的候選筆數上限跟
// Google 這支 API 本身能給到的上限拉齊,讓使用者能看到 Text Search
// 排序前 20 名的完整候選清單。
const maxGeoGeocodeCandidates = 20

// geoGeocodeDefaultRestrictRadiusMeters 是 mode=restrict 且未帶 radius
// 參數時的預設矩形半徑——對齊地圖上方類別標籤原本查詢附近地點的既有
// 預設值(1500m),類別標籤/搜尋這個區域都是「使用者明確操作觸發、查詢
// 範圍通常不需要很大」的情境,理由與原本一致;bias 模式進入第二階段
// (多筆候選、改用 locationRestriction 收斂)時也沿用同一個預設值。
const geoGeocodeDefaultRestrictRadiusMeters = 1500.0

// geoGeocodeCandidateResponse 是 handleGeoGeocode 回應裡單筆候選地點的
// 格式——原本用 map[string]any 手動組,改成強型別 struct 較不容易漏
// 欄位/打錯 key。
//
// 2026-10:徹底移除 photoUrl 相容欄位——這支端點 2026-08 起已經不再
// 同步查照片,原本的 PhotoURL 欄位一律留空字串,是個已確認沒有任何呼叫端
// 在用的死欄位(前端的照片顯示已經完全改走 fetchGeoPlacePhoto 對
// PlaceID 的延遲查詢),故直接移除,不再保留這個永遠空值的欄位。
type geoGeocodeCandidateResponse struct {
	Name    string  `json:"name"`
	Address string  `json:"address"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	PlaceID string  `json:"placeId,omitempty"`
}

// geoGeocodeCandidateResponses 把 geo.Search 的結果轉成
// geoGeocodeCandidateResponse 清單——handleGeoGeocode 兩階段查詢的三個回傳點
// (bias 命中 1 筆、bias 查無、restriction 收斂後的最終結果)共用同一個
// 轉換,抽成這支函式避免三處各寫一份。
//
// 2026-10:移除原本的背景照片預熱。它每次搜尋後
// 最多下載 3 張照片並上傳 GCS,寫進沒有任何讀取端的表(place_pexels_photos,該表已移除),
// 前端的照片顯示是走 fetchGeoPlacePhoto 對 placeId 的延遲查詢,與它無關。
func (s *Server) geoGeocodeCandidateResponses(places []geo.Place) []geoGeocodeCandidateResponse {
	// placeId:供前端(GeoOutlinePanel.tsx 的 handleGeocodeCandidateSelect)
	// 拿去換發 GET /internal/geo/place-details,取得完整資訊(含照片,
	// Pexels-first + GCS 落地,跟點地圖上原生 POI 完全同一套流程),不再
	// 只是純定位用的座標——見 geo.Client.Search 的 fieldMask 說明,這裡
	// 選擇性帶出(理論上 Text Search 每筆結果都會有 id,查無則省略此欄位,
	// 前端據此判斷是否要走這條補查流程)。
	// 這支端點不查照片——2026-10 已把這裡一律留空的 photoUrl 相容欄位整個從
	// geoGeocodeCandidateResponse 移除。
	candidates := make([]geoGeocodeCandidateResponse, len(places))
	for i, p := range places {
		candidates[i] = geoGeocodeCandidateResponse{
			Name:    p.Name,
			Address: p.Address,
			Lat:     p.Lat,
			Lng:     p.Lng,
			PlaceID: p.PlaceID,
		}
	}
	return candidates
}

func (s *Server) handleGeoGeocode(w http.ResponseWriter, r *http.Request) {
	if !s.throttleGeoQueryByUser(w, r) {
		return
	}
	query := r.URL.Query().Get("query")
	if query == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 query 查詢參數")
		return
	}

	// mode:見這支端點的完整說明——"restrict"(類別標籤/搜尋這個區域)固定
	// 套用 locationRestriction;其餘值(含空字串/未帶)一律視為 "bias"
	// (城市搜尋框)的兩階段查詢,不對不明的 mode 值回錯誤,理由同這支
	// 端點原本對缺少 biasLat/biasLng 的寬容處理——未知輸入退回最寬鬆的
	// 既有行為,不是拒絕請求。
	mode := r.URL.Query().Get("mode")

	// lat/lng/radius:選填(bias 模式)或必填(restrict 模式,見下方各自
	// 分支的檢查)。lat/lng 在 bias 模式下當 locationBias 中心(對應原本的
	// biasLat/biasLng 參數,新版沿用同一組座標語意,只是不再限定只能用在
	// locationBias);在 restrict 模式下當 locationRestriction 矩形中心。
	// radius 只有 restrict 模式使用(bias 模式的 locationBias 半徑固定用
	// geo.Client.Search 內建的預設值,理由同原本既有行為——bias 模式不需要
	// 精確控制半徑,只是「往這個方向偏」)。格式錯誤或缺少時視為未提供,
	// 不視為錯誤——理由同原本 biasLat/biasLng 的既有處理方式,這支端點在
	// 沒有座標可用的情境下(例如尚未建立地圖)仍應該能正常查詢。
	var centerLat, centerLng float64
	var hasCenterLatLng bool
	if latRaw, lngRaw := r.URL.Query().Get("lat"), r.URL.Query().Get("lng"); latRaw != "" && lngRaw != "" {
		if lat, err := strconv.ParseFloat(latRaw, 64); err == nil {
			if lng, err := strconv.ParseFloat(lngRaw, 64); err == nil {
				centerLat, centerLng = lat, lng
				hasCenterLatLng = true
			}
		}
	}

	// 2026-10:不再注入 Pexels client——使用者明確要求規劃地圖上完全沒建檔過的
	// 城市被臨時搜尋時,不要回退用 Pexels 示意圖頂替。
	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := s.newGeoGeocodeClient(apiKey)
	client.SetCache(s.photoCache)

	// 逾時原本是 5 秒(純文字查詢,不含照片處理),後來因為曾經同步處理
	// 照片查詢拉長到 10 秒。2026-08 起照片查詢已經移除,不再計入這支
	// handler 本身回應的耗時,但仍維持 10 秒——這個逾時現在保護 client.Search 最多兩次
	// Text Search 查詢(bias 模式的兩階段,見下方),10 秒對純文字查詢仍是
	// 合理的寬限值。
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	ctx = geo.WithCaller(ctx, "handleGeoGeocode")
	ctx = geo.WithPath(ctx, r.URL.Path)

	if mode == "restrict" {
		// restrict 模式:類別標籤/搜尋這個區域用,固定套用
		// locationRestriction,不做兩階段判斷——查詢文字(景點/飯店/餐廳
		// 標籤文字,或搜尋框既有文字)已經確定,範圍限制才是這裡的重點,
		// 不需要像 bias 模式那樣先試探性查一次判斷意圖。
		if !hasCenterLatLng {
			writeErr(w, http.StatusBadRequest, "invalid_input", "mode=restrict 需要 lat/lng 查詢參數")
			return
		}
		radiusMeters := geoGeocodeDefaultRestrictRadiusMeters
		if raw := r.URL.Query().Get("radius"); raw != "" {
			if parsed, err := strconv.ParseFloat(raw, 64); err == nil && parsed > 0 {
				radiusMeters = parsed
				if radiusMeters > maxNearbyRadiusMeters {
					radiusMeters = maxNearbyRadiusMeters
				}
			}
		}
		rect := geo.RectFromCenterRadius(centerLat, centerLng, radiusMeters)
		places, err := client.Search(ctx, query, &geo.SearchOptions{
			MaxResults:          maxGeoGeocodeCandidates,
			LocationRestriction: &rect,
			IncludePhotos:       true,
		})
		if err != nil {
			if err == geo.ErrNotFound {
				writeErr(w, http.StatusNotFound, "no_match", "查無「"+query+"」相關地點")
				return
			}
			writeErr(w, http.StatusBadGateway, "geocode_failed", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"query":      query,
			"candidates": s.geoGeocodeCandidateResponses(places),
		})
		return
	}

	// bias 模式(預設,城市搜尋框):兩階段查詢——
	//   1. 先用 locationBias(只偏向、不排除範圍外結果)查一次。
	//   2. 依這次結果筆數判斷查詢意圖:
	//      - 剛好 1 筆:文字意圖已經夠明確(bias 沒有排除任何結果,能收斂
	//        到唯一解代表 Google 對這個查詢的信心已經足夠),直接採用,
	//        不需要再查一次。
	//      - 0 筆:直接回查無結果,不重試——locationRestriction 只會讓
	//        結果更少,重試不會有幫助。
	//      - 多筆:文字意圖不夠明確(bias 沒有收斂出唯一解),改用
	//        locationRestriction(強制限制在目前地圖矩形範圍內)重新查一次,
	//        回傳這次的結果——這是實際用 curl 對 Google API 驗證過的行為
	//        (見這支函式所在檔案開頭以外的設計討論):locationRestriction
	//        會排除範圍外結果,但也可能讓「範圍內文字碰巧相符但語意完全
	//        不相關」的結果混進來(例如地圖在京都、搜尋「東京」,
	//        locationRestriction 會回傳店名含「東京」兩字但實際在京都的
	//        無關店家);locationBias 則能正確回傳真正的「東京」這類跨
	//        範圍地名查詢(不受偏向範圍干擾,精準回傳 1 筆正確結果)。用
	//        「bias 查詢的結果筆數」判斷查詢意圖是明確地名(用 bias 的
	//        結果)還是模糊關鍵字(需要 restriction 收斂),就是這兩階段
	//        設計的理由。
	//
	// 這整套判斷收在這支 handler 內部完成,單一 HTTP 請求進來、最多觸發
	// 兩次 Google API 呼叫、只回傳一次 HTTP 回應——前端呼叫端不需要知道
	// 背後的兩階段細節,行為對前端而言就是「打一次 API,拿到正確結果」。
	var locationBias *geo.LocationBias
	if hasCenterLatLng {
		locationBias = &geo.LocationBias{Lat: centerLat, Lng: centerLng}
	}

	places, err := client.Search(ctx, query, &geo.SearchOptions{
		MaxResults:    maxGeoGeocodeCandidates,
		LocationBias:  locationBias,
		IncludePhotos: true,
	})
	if err != nil {
		if err == geo.ErrNotFound {
			writeErr(w, http.StatusNotFound, "no_match", "查無「"+query+"」相關地點")
			return
		}
		writeErr(w, http.StatusBadGateway, "geocode_failed", err.Error())
		return
	}

	// 剛好 1 筆或沒有可用地圖中心(無法組出 locationRestriction 矩形,
	// 只能沿用 bias 這次的結果)時直接採用,不進入第二階段。
	if len(places) == 1 || !hasCenterLatLng {
		writeJSON(w, http.StatusOK, map[string]any{
			"query":      query,
			"candidates": s.geoGeocodeCandidateResponses(places),
		})
		return
	}

	// 多筆候選:改用 locationRestriction 收斂,以目前地圖中心座標為矩形
	// 中心——半徑沿用 restrict 模式同一個預設值,這裡沒有呼叫端傳入的
	// radius 可用(bias 模式的 query 參數不含 radius,見上方參數說明),
	// 固定用預設值收斂即可,不需要額外開放這個維度給城市搜尋框呼叫端
	// 控制。
	rect := geo.RectFromCenterRadius(centerLat, centerLng, geoGeocodeDefaultRestrictRadiusMeters)
	restrictedPlaces, err := client.Search(ctx, query, &geo.SearchOptions{
		MaxResults:          maxGeoGeocodeCandidates,
		LocationRestriction: &rect,
		IncludePhotos:       true,
	})
	if err != nil {
		if err == geo.ErrNotFound {
			writeErr(w, http.StatusNotFound, "no_match", "查無「"+query+"」相關地點")
			return
		}
		writeErr(w, http.StatusBadGateway, "geocode_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"query":      query,
		"candidates": s.geoGeocodeCandidateResponses(restrictedPlaces),
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
	// 2026-09:不再查/帶出 landmarkPhotoUrl,理由同 handleGeoAttractions
	// 同一次修正的完整說明——前端已確認完全不讀這個欄位,連同批次查詢
	// photo_assets 這段邏輯一併移除。
	attractions := make([]attractionResponse, 0, len(landmarks))
	for _, landmark := range landmarks {
		attractions = append(attractions, toAttractionResponse(landmark))
	}
	return attractions, nil
}

// GET /internal/geo/attractions/nearby?lat={緯度}&lng={經度}&radius={公尺,選填,預設 15000}
//
// 回傳 {"attractions": [...], "hotels": [...]} 兩個陣列——attractions 是
// 人工建檔的景點區域(store.ListAttractionsNearby,免費,格式見
// listAttractionResponses),hotels 是即時查 Google Places Nearby Search
// 附近住宿(geo.Client.SearchNearby,經 fetchNearbyHotels,計費、含照片
// Pexels-first + Google fallback,見該函式的完整說明)。
//
// 目前(2026-08)前端已無任何呼叫端——「搜尋這個區域」按鈕原本呼叫這支
// 端點取得 hotels,已改走 handleGeoGeocode(mode=restrict,Text Search),
// 不再需要這支端點的座標+半徑 Nearby Search 語意。故意保留不刪:
//  1. hotels 部分沿用的 fetchNearbyHotels 仍被其他情境使用(見該函式的
//     說明),不是這支端點獨有的邏輯,清理風險低但也沒有立即必要。
//  2. 這支端點的「座標+半徑查詢範圍內的飯店」語意,適合日後暴露成 LLM
//     可呼叫的工具(對齊 internal/onagenttools/geocode.go、
//     internal/onagenttools/recommend_nearby.go 的既有 BackendDispatch 模式
//     ——LLM 決定要幫使用者查「這附近有什麼飯店」時,直接呼叫這支端點
//     形狀的邏輯最直覺,不需要重新設計參數)。若之後要接上,可以比照
//     geocode.go 的寫法,在 internal/onagenttools 新增一個獨立的
//     dispatch handler,內部呼叫這支端點背後同一組 s.fetchNearbyHotels/
//     listAttractionResponses,不需要更動這支 HTTP 端點本身。
//
// 2026-10:新增免登入版 GET /public/geo/attractions/nearby(見 api.go
// Routes() 內該路由的註冊處說明),複用這支 handler 本身、不重寫邏輯。
// 這支端點會觸發計費的 fetchNearbyHotels,公開版疊加比一般查詢端點
// 嚴格許多的 IP 節流(withGeoAttractionsIPThrottle,見
// geoAttractionsIPRateLimiter 欄位的完整說明)。
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
	// 2026-10:不再注入 Pexels client——使用者明確要求規劃地圖上完全沒建檔過的
	// 城市被臨時搜尋時,不要回退用 Pexels 示意圖頂替。
	client.SetCache(s.photoCache)
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
//
// 2026-10:新增免登入版 GET /public/geo/attractions/nearby-only(見
// api.go Routes() 內該路由的註冊處說明),複用這支 handler 本身、不
// 重寫邏輯。這支端點完全不觸發外部 API(純查資料庫),是風險最低的
// 一支,公開版沿用既有的 withGeoQueryIPThrottle(跟
// /public/geo/plan-ai/* 那組共用同一個節流池/規則,300 次/60 秒)。
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
//
// 最終顯示的照片欄位一律由 applyPhotoAssetsAsSource(見該函式的完整
// 說明)決定 photo_assets 目前的內容。
//
// 2026-10:徹底移除 PhotoURL 欄位本身——這個欄位原本是 GooglePhotoURLs
// 合併後的第一張,供還沒改用多圖欄位的舊呼叫端過渡期間兼容,但前端
// useAttractionOverlays.ts/AttractionInfoPanel.tsx 已經全部改讀
// GooglePhotoURLs 清單判斷「有沒有圖」(見該檔案的完整說明),這個相容
// 欄位已經沒有任何呼叫端在用。applyPhotoAssetsAsSource/photoOnlyResponse/
// photoAssetsOnlyResponse 這些原本共用 PhotoURL 賦值的內部用途,一併
// 改成只操作 GooglePhotoURLs。
//
// PhotoRefreshPending:這次查詢有沒有觸發背景補圖(見
// decidePlacePhotoRefreshIndex 的完整說明)。前端(photoRetry.ts 的
// PHOTO_RETRY_* 重試機制)原本不論後端這次實際有沒有觸發補圖,一律固定
// 重試 3 次、每次間隔 2 秒——這個旗標讓前端可以只在真的有背景補圖在
// 跑的時候才繼續輪詢,沒有觸發就不用浪費 3 次重試等一個不會有結果的
// 查詢。true 代表這次有觸發(不論最終是否真的補到,查無照片/下載失敗
// 不會讓前端事後得知,維持既有的背景任務不回報結果給原始請求的設計)。
type placeDetailsResponse struct {
	Name                string   `json:"name"`
	Address             string   `json:"address"`
	Lat                 float64  `json:"lat"`
	Lng                 float64  `json:"lng"`
	Rating              float64  `json:"rating,omitempty"`
	Summary             string   `json:"summary,omitempty"`
	GooglePhotoURLs     []string `json:"googlePhotoUrls,omitempty"`
	PhotoRefreshPending bool     `json:"photoRefreshPending"`
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
// placeDetailsRowExistenceMaxAge 是 handleGeoPlaceDetails 快取命中分支
// 判斷「這一列 place_details_cache 資料是否還算存在、值得沿用」的上限
// ——只要地點在 30 天內曾被查詢過,這一列就仍然值得當「快取命中」處理
// (文字欄位是否需要重新查詢由下面獨立的 placeDetailsCacheMaxAge/
// textStale 判斷式決定,不受這個常數影響);超過 30 天完全沒人查詢的
// 冷門地點,才真的整批視為未命中,走 fetchAndCachePlaceDetails 從頭
// 查起。這個值本身沒有精確計算依據,30 天是取整、易記、夠寬鬆的選擇。
const placeDetailsRowExistenceMaxAge = 30 * 24 * time.Hour

// placeDetailsCacheMaxAge 是 handleGeoPlaceDetails 快取結果視為新鮮的
// 上限——原生 POI 點擊是使用者互動觸發、同一個地點短期內可能被反覆點擊
// (例如來回切換比較),但地點的名稱/地址/評分/簡介不會頻繁變動,一天內
// 直接吃快取沒有正確性疑慮,同時能大幅減少 Place Details/Photo Media 的
// 重複呼叫與計費。
const placeDetailsCacheMaxAge = 24 * time.Hour

// placeDetailsDegradedResponseMaxAge 是 buildDegradedPlaceDetailsResponse
// 讀取快取時傳給 store.GetCachedPlaceDetails 的 maxAge——刻意選一個極大
// 的時長(10 年),讓「這一列是否存在」實質上成為 GetCachedPlaceDetails
// 唯一會生效的判斷依據(見該函式 now().Sub(FetchedAt) > maxAge 的判斷式,
// maxAge 越大這個條件越不可能為真)。降級情境下,舊資料(不論多舊)都
// 好過完全沒有資料或直接回錯誤給使用者,不應該讓這裡的讀取因為「快取
// 已經過期」而白白放棄一筆其實還有參考價值的資料。
const placeDetailsDegradedResponseMaxAge = 10 * 365 * 24 * time.Hour

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
//
// 參數命名為 objectKey(而非 placeID)——這支函式本身不對這個字串做
// 任何跟 place 相關的邏輯,只是原封不動轉交給 UploadDataURI 當 GCS
// 物件路徑的一部分,呼叫端決定要不要在裡面帶入 photo_index(見
// googlePlacePhotoObjectKey 的完整說明,漸進補圖多張情境必須帶,單張
// 情境的既有呼叫端則直接傳 placeID 本身維持原行為不變)。
func (s *Server) landmarkPhotoURLFromDataURI(ctx context.Context, objectKey, dataURI string) string {
	uploaded, err := s.photoUploader.UploadDataURI(ctx, objectKey, dataURI)
	if err != nil {
		return dataURI
	}
	return uploaded
}

// photoAssetExpiry 是 syncPhotoAssetInBackground 寫入 photo_assets 時採用
// 的有效期,對齊 cmd/migrate-photo-assets 遷移工具的既有門檻(7 天,見
// photoAssetRow 的完整說明)——兩者是同一張表的兩種寫入來源(一次性遷移
// vs. 這裡的持續背景補圖),理當共用同一個新鮮度承諾,不需要各自訂一個
// 不同的數字。
// 2026-10:這個常數現在只是「預設值」的文件與既有測試的對照——實際寫入時用的是
// Server.PhotoAssetExpiry()(可用 CLI 的 geo-setting 調整,見 photo_max_count.go),
// 預設值與這個常數相同。
const photoAssetExpiry = 7 * 24 * time.Hour

// applyPhotoAssetsAsSource 用 photo_assets(見 store.ListFreshPhotoAssetURLsForPlace
// 的完整說明)無條件決定 resp 最終要顯示給使用者看的照片欄位——
// handleGeoPlaceDetails 的三個回傳點(快取命中分支、
// buildDegradedPlaceDetailsResponse、fetchAndCachePlaceDetails)在呼叫
// 這支函式之前,都各自需要從 google_place_photos 組出中繼變數(供
// syncPhotoAssetInBackground 補圖節奏等既有邏輯使用),但那些中繼變數
// 組出來的 GooglePhotoURLs 不再是最終回應——這支函式呼叫後一律覆寫成
// photo_assets 的內容,查無時清空,不留任何舊表資料。
//
// 2026-09 重構(原名 overrideWithPhotoAssets):使用者明確要求「應該要
// 跟點選附近景點一樣的流程」「不要再有資料庫的回退步驟」——原本這裡
// 查無 photo_assets 紀錄時會原封不動保留 resp 既有的(來自 google_
// place_photos 舊表的)照片欄位,讓使用者仍然看到一張圖,但這正是使用者
// 要拿掉的「資料庫回退」:舊表資料一旦被拿來顯示,使用者就分不清楚看到
// 的是「即時查到的照片」還是「這張舊表殘留的過期內容」(真實案例:清除
// photo_assets 後前端仍顯示圖片,查證發現是 google_place_photos 這張
// 舊表在墊底)。現在查無 photo_assets 時明確清空成 nil/空字串,前端
// 顯示 placeholder,不會再誤以為看到的是最新資料。
func (s *Server) applyPhotoAssetsAsSource(resp *placeDetailsResponse, placeID string) {
	photoURLs, err := s.store.ListFreshPhotoAssetURLsForPlace(placeID)
	if err != nil || len(photoURLs) == 0 {
		resp.GooglePhotoURLs = nil
		return
	}
	resp.GooglePhotoURLs = photoURLs
}

// freshPhotoIndexStates 查 photo_assets,組出 decidePlacePhotoRefreshIndex
// 需要的 fresh []bool——逐一查 [0, upTo) 範圍內每個 index 的
// usage="full" 紀錄是否存在且未過期。upTo 是 photoCapForClickCount 算
// 出的上限,正常情況下是個位數(只有每 100 次點擊才 +1),逐一查詢的
// 成本可忽略,不需要為了這個小範圍另外設計一支一次撈全部的聚合查詢。
func (s *Server) freshPhotoIndexStates(placeID string, upTo int) []bool {
	fresh := make([]bool, upTo)
	now := time.Now()
	for i := 0; i < upTo; i++ {
		asset, ok, err := s.store.GetPhotoAsset(placeID, i, "full")
		if err != nil || !ok {
			continue
		}
		fresh[i] = asset.ExpiresAt == nil || asset.ExpiresAt.After(now)
	}
	return fresh
}

// backgroundFillPlacePhoto 背景下載 indexToFetch 這張照片並寫入
// photo_assets——2026-10 新補圖節奏下,取代舊的
// downloadGooglePlacePhotoInBackground/refreshGooglePlacePhotoInBackground
// 兩支各自處理「快取未命中」「快取命中」的背景函式,統一成一支:
//
//   - knownPhotoRefs 不為 nil 時(快取未命中路徑,呼叫端剛同步呼叫過
//     GetPlaceDetails,details.PhotoRefs 已經在手上),直接用這份清單,
//     不重打一次 Google。
//   - knownPhotoRefs 為 nil 時(快取命中、判斷需要補圖的路徑),先呼叫
//     GetPlaceDetails 取得這次的 PhotoRefs——不是舊版用的窄 field mask
//     ListPlacePhotoRefs,理由見該呼叫點的完整說明:兩者是同一個
//     Enterprise 計費等級,改用完整版同時可以順便把
//     place_details_cache 的文字欄位(name/address/rating/summary)
//     一併刷新,不需要再靠獨立的 24 小時 textStale 機制另外重查一次。
//
// 不再寫 google_place_photos/UpdatePlacePhotoProgress 這些舊計數器相關
// 的表/欄位——2026-10 新節奏不依賴這些欄位決定要不要補圖(見
// decidePlacePhotoRefreshIndex 的完整說明,判斷依據已經改成直接查
// photo_assets 的新鮮度),繼續寫入只會維護著不再被讀取的死資料。
//
// 用 context.Background() 而非呼叫端的 ctx、不回傳任何結果給原始
// HTTP 請求——理由同舊版 syncPhotoAssetInBackground/
// refreshGooglePlacePhotoInBackground 的一貫說明:這是背景任務,不該因
// 為使用者提早關閉頁面就被取消,執行結果也只會反映在下一次查詢,不影響
// 這次已經送出的回應。
func (s *Server) backgroundFillPlacePhoto(placeID, requestPath string, indexToFetch int, knownPhotoRefs []string) {
	// 2026-10 去重:同一個地點同一張照片正在補的時候,後到的請求不要再各自啟動一次。
	// 原本沒有任何去重——領頭請求還在補第 0 張時,後到的命中請求(沒有照片參照)
	// 也各自啟動補圖、各自再打一次 places.get 與 Photo Media(實機冷啟動 10 個
	// 地點打了 20 次 photoMedia,mock 並發測試 6 個請求打了 3 次 places.get)。
	// 用 LoadOrStore 搶佔,搶不到就直接放棄:正在補的那個會把照片補好,下一次
	// 請求自然看得到。
	fillKey := fmt.Sprintf("%s#%d", placeID, indexToFetch)
	if _, loaded := s.photoFillInFlight.LoadOrStore(fillKey, struct{}{}); loaded {
		return
	}
	go func() {
		defer s.photoFillInFlight.Delete(fillKey)
		// 搶到標記之後再確認一次:呼叫端判斷「這張還缺」到這裡搶到標記之間有一段
		// 時間差,別的補圖可能剛好在這段時間完成並釋放了標記(它寫入照片之後才釋放)。
		// 不再確認的話,這個請求會把剛補好的照片再補一次(多打一次 places.get 與
		// Photo Media)。
		if a, ok, err := s.store.GetPhotoAsset(placeID, indexToFetch, "full"); err == nil && ok &&
			(a.ExpiresAt == nil || a.ExpiresAt.After(time.Now())) {
			return
		}
		// 儲存服務(GCS)壞掉時在花錢之前就跳過:後面的 places.get 與 photoMedia
		// 都計費,而上傳失敗的結果會被丟掉、下次請求又重來(見 internal/storagehealth)。
		// 探測用獨立的 context,不吃下面 15 秒補圖逾時的額度。
		if s.photoStorageBreaker != nil && !s.photoStorageBreaker.Allow(context.Background()) {
			return
		}
		apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
		client := s.newPlaceDetailsClient(apiKey)
		pctx, pcancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer pcancel()
		pctx = geo.WithCaller(pctx, "handleGeoPlaceDetails")
		pctx = geo.WithPath(pctx, requestPath)

		refs := knownPhotoRefs
		if refs == nil {
			// GetPlaceDetailsFresh 而不是 GetPlaceDetails:這裡要的是最新的照片參照
			// (有時效、不進統一快取),命中快取只會拿到沒有參照的文字資料。
			details, err := client.GetPlaceDetailsFresh(pctx, placeID)
			if err != nil {
				log.Printf("backgroundFillPlacePhoto: GetPlaceDetails 失敗 place_id=%s: %v", placeID, err)
				return
			}
			var summaryPtr *string
			if details.Summary != "" {
				summaryPtr = &details.Summary
			}
			_ = s.store.SetCachedPlaceDetails(placeID, details.Name, details.Address, details.Lat, details.Lng, details.Rating, summaryPtr)
			refs = details.PhotoRefs
			// 這是少數幾個會拿到 Google 完整照片清單的時刻——記下實際張數,之後
			// 的補圖判斷就不會再去追一個不存在的索引(見 effectivePhotoCap)。
			// 照片後來變多時,下一次有索引過期而重新走到這裡,張數會自動更新。
			s.recordPlacePhotoCount(placeID, len(refs))
		}
		if indexToFetch < 0 || indexToFetch >= len(refs) {
			// Google 實際照片數比這次算出的 cap 還少(地點本身沒有那麼
			// 多張照片)——沒有東西可補,不是錯誤,靜默結束。
			return
		}

		photoURL, pErr := client.PhotoDataURIUnrestricted(pctx, placeID, refs[indexToFetch], 400)
		if pErr != nil {
			log.Printf("backgroundFillPlacePhoto: PhotoDataURIUnrestricted 失敗 place_id=%s index=%d: %v", placeID, indexToFetch, pErr)
			return
		}
		objectKey := "bg-" + googlePlacePhotoObjectKey(placeID, indexToFetch)
		gcsURL, err := s.photoUploader.UploadDataURI(pctx, objectKey, photoURL)
		if err != nil {
			log.Printf("backgroundFillPlacePhoto: 上傳 GCS 失敗 place_id=%s index=%d: %v", placeID, indexToFetch, err)
			// 只有 GCS 這一端的失敗才算儲存異常;圖片格式不對之類的單張問題不算。
			if s.photoStorageBreaker != nil && photostorage.IsStorageFailure(err) {
				s.photoStorageBreaker.Failure(err)
			}
			return
		}
		if s.photoStorageBreaker != nil {
			s.photoStorageBreaker.Success()
		}
		now := time.Now()
		expiresAt := now.Add(s.PhotoAssetExpiry())
		if err := s.store.UpsertPhotoAsset(model.PhotoAsset{
			PlaceID:    placeID,
			PhotoIndex: indexToFetch,
			Usage:      "full",
			Source:     "google",
			GCSURL:     gcsURL,
			FetchedAt:  now,
			ExpiresAt:  &expiresAt,
		}); err != nil {
			log.Printf("backgroundFillPlacePhoto: 寫入 photo_assets 失敗 place_id=%s index=%d: %v", placeID, indexToFetch, err)
		}
	}()
}

// photoAssetsOnlyResponse 是 GET /internal/geo/place-photo-assets 的回應
// 形狀——只有照片欄位,理由見該端點的完整說明。2026-10 拿掉 PhotoURL,
// 理由同 placeDetailsResponse 的完整說明:前端(useThemeAttractionSelection.ts/
// photoRetry.ts)已經全部改讀 GooglePhotoURLs 清單,這個相容欄位已經
// 沒有任何呼叫端在用。
type photoAssetsOnlyResponse struct {
	GooglePhotoURLs []string `json:"googlePhotoUrls,omitempty"`
}

// GET /internal/geo/place-photo-assets?placeId={Google Place ID}
//
// 純讀 photo_assets 目前狀態,不觸發任何點擊計數/漸進補圖決策——供前端
// 「查完地點詳情發現沒有照片,原地重試幾次看背景補圖是否已經完成」這種
// 情境使用(見 web/src/planning/explore/useThemeAttractionSelection.ts
// fetchPoiContent 的 PHOTO_RETRY_* 完整說明)。
//
// 這支端點刻意跟 handleGeoPlaceDetails 完全分開,不是後者的一個查詢
// 參數變形(對照 photoOnly=1 的 photoOnlyResponse——那條路徑快取未命中時
// 甚至會先重打一次 Google Place Details 刷新文字快取,見
// handleGeoPlaceDetails 該分支的完整說明,不是真正零副作用的純讀)。
// 這裡只呼叫 applyPhotoAssetsAsSource 讀一次 photo_assets(單一
// SELECT,見該函式的完整說明),不呼叫 IncrementPlaceClickCount、不呼叫
// 任何 Google API、不觸發任何背景 goroutine——重試幾次都不會意外把
// 漸進補圖節奏往前推、也不會被 apigateway.RateLimiter 的
// places.photoMedia 限流計入(因為根本不會打到那支 API)。
//
// 查無 photo_assets 紀錄時(從未查過這個 placeID、或背景補圖仍在進行中
// 尚未寫入)一律回傳兩個欄位皆空的 200,不是 404——這裡的語意是「目前
// 沒有可顯示的照片」,不是「這個地點不存在」,呼叫端(fetchPoiContent)
// 據此判斷要不要再排下一輪重試。
func (s *Server) handleGeoPlacePhotoAssets(w http.ResponseWriter, r *http.Request) {
	placeID := r.URL.Query().Get("placeId")
	if placeID == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 placeId 查詢參數")
		return
	}
	var resp placeDetailsResponse
	s.applyPhotoAssetsAsSource(&resp, placeID)
	writeJSON(w, http.StatusOK, photoAssetsOnlyResponse{
		GooglePhotoURLs: resp.GooglePhotoURLs,
	})
}

// handlePublicGeoPlacePhotoAssets(這支的免登入公開版)已搬到
// geo_outline_public.go——見該檔案開頭對「把訪客可達的公開端點集中成
// 獨立檔案」的完整說明。這裡維持登入版核心邏輯本體不動。

// googlePlacePhotoObjectKey 組出漸進補圖機制專用的 GCS objectKey——
// place-details/{placeID}{ext} 這個既有物件路徑格式(見
// photostorage.UploadDataURI 的說明)原本假設「同一個 placeID 只對應
// 一張照片,重查會覆蓋舊物件」,這在單張照片時代(fetchPhotosForCandidates/
// fetchNearbyHotels 等既有呼叫端,查候選景點清單/飯店照片時每個地點
// 只存一張)成立;但漸進補圖機制下,同一個 placeID 現在會依序累積多張
// 不同 index 的照片,若仍只用 placeID 當 objectKey,每次補圖都會覆寫
// 到同一個 GCS 物件,造成 google_place_photos 表裡不同 photo_index
// 的紀錄全部指向同一張(最後上傳那張)實際圖片內容——這是實測清水寺
// 補到 3 張照片後,3 筆紀錄的 photo_url 完全相同時發現的真實 bug。
// 加上 "-{index}" 尾綴讓每個 index 各自落在獨立的物件路徑,不再互相
// 覆寫;仍以 placeID 開頭,同一地點的所有照片仍聚在同一個物件路徑
// 前綴下,方便之後需要時人工核對/批次清理。
func googlePlacePhotoObjectKey(placeID string, photoIndex int) string {
	return placeID + "-" + strconv.Itoa(photoIndex)
}

// photoOnlyResponse 是 photoOnly=1 時的回應形狀——只有照片欄位,不含
// name/address/rating/summary,理由見 handleGeoPlaceDetails 對 photoOnly
// 分支的說明。2026-10 徹底移除 photoUrl 相容欄位,改成跟其餘端點一致的
// googlePhotoUrls 多圖清單——前端 fetchGeoPlacePhoto 的呼叫端(見
// GeoListItemCard.tsx/GeoOutlinePanel.tsx 等)同步改讀這個欄位的第一張。
type photoOnlyResponse struct {
	GooglePhotoURLs []string `json:"googlePhotoUrls,omitempty"`
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
	if !s.throttleGeoQueryByUser(w, r) {
		return
	}
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
	//   2. 快取未命中時(2026-09 移除 Pexels 讀圖來源後)直接回空,不
	//      fallback Google GetPlaceDetails/Photo Media——這是刻意的成本
	//      上限,不為了補一張圖多付一次 Enterprise 級查詢的成本。
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
	// (不打 Google Photo Media),也不寫入快取(理由同 photoOnly
	// 分支的說明,這個模式沒有 photoUrl 可安全寫入完整快取列)。
	textOnly := r.URL.Query().Get("textOnly") == "1"

	// 快取命中(且未過期)直接回傳,不打 Google——place_id 是 Places API
	// 對同一地點的穩定識別碼(見 store.GetCachedPlaceDetails 的說明),
	// 這裡把整筆詳細資訊(含已轉換好的照片 data URI)一起存,快取命中時
	// 完全不需要任何額外的 Google API 呼叫。
	//
	// 這裡改傳 placeDetailsRowExistenceMaxAge(30 天,只判斷「這一列還算
	// 不算存在」)而非 placeDetailsCacheMaxAge(24 小時,文字欄位新鮮度
	// 門檻)當這一層的判斷依據——兩者各自服務獨立的新鮮度保證,不能共用
	// 同一個門檻讓其中一個吃掉另一個的判斷空間:若沿用 24 小時,文字
	// 欄位是否需要重新整批查詢(下面的 textStale)就會永遠為 false,
	// 失去獨立判斷的意義。
	if cached, ok, err := s.store.GetCachedPlaceDetails(placeID, placeDetailsRowExistenceMaxAge); err == nil && ok {
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

		// textStale 為 true 時,這一列的 name/address/rating/summary 已經
		// 超過 placeDetailsCacheMaxAge(24 小時)沒更新,需要重新打一次
		// 完整的 GetPlaceDetails 更新文字欄位——這跟下面補圖節奏的判斷
		// (photoCapForClickCount/decidePlacePhotoRefreshIndex)是兩個
		// 獨立判斷,各自求值、各自視需要各打各的 Google API,不互相
		// 牽制對方能不能執行。
		//
		// 2026-10:有效期改吃統一快取的設定(geo.DetailsCacheMaxAge,可用 CLI 的
		// geo-setting placeDetailsCacheHours 調整)。原本寫死 24 小時的常數
		// placeDetailsCacheMaxAge,把設定調成 720 小時想省錢時,命中的列一超過
		// 24 小時仍會每次重打 Google。
		if textStale := time.Since(cached.FetchedAt) > geo.DetailsCacheMaxAge(); textStale {
			apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
			client := s.newPlaceDetailsClient(apiKey)
			tctx, tcancel := context.WithTimeout(r.Context(), 10*time.Second)
			tctx = geo.WithCaller(tctx, "handleGeoPlaceDetails")
			tctx = geo.WithPath(tctx, r.URL.Path)
			// 文字重查失敗不影響這次回應——沿用快取現有的文字欄位繼續
			// 回應,只是這次沒能刷新,下次點擊會再嘗試,理由同這支
			// handler 既有的「失敗就略過、繼續用現有資料回應」慣例。這裡
			// 刻意不特別檢查 dErr 是否為 apigateway.ErrRateLimited——這個
			// 分支本來就是「任何錯誤都吞掉、沿用現有快取」,已經自然符合
			// 這次成本控制設計要求的「限流拒絕不當作錯誤回應給前端,改
			// 讀現有快取降級」,不需要額外的特殊分支。下面 ListPlacePhotoRefs/
			// PhotoDataURI 的錯誤處理是同一種既有慣例,同樣不需要改動。
			// 文字已超過 placeDetailsCacheMaxAge,明確要新資料:用 Fresh 繞過統一快取
			// 的讀取(結果仍會寫回快取)。
			if details, dErr := client.GetPlaceDetailsFresh(tctx, placeID); dErr == nil {
				resp.Name, resp.Address, resp.Lat, resp.Lng, resp.Rating, resp.Summary =
					details.Name, details.Address, details.Lat, details.Lng, details.Rating, details.Summary
				var summaryPtr *string
				if resp.Summary != "" {
					summaryPtr = &resp.Summary
				}
				_ = s.store.SetCachedPlaceDetails(placeID, resp.Name, resp.Address, resp.Lat, resp.Lng, resp.Rating, summaryPtr)
				// Fresh 一定帶回完整照片參照:順便更正已記下的實際張數。否則 Google
				// 某次暫時回空清單記成 0 之後,就沒有任何路徑能修正它(0 → 不補圖)。
				s.recordPlacePhotoCount(placeID, len(details.PhotoRefs))
			}
			tcancel()
		}

		// textOnly 不需要照片,略過下面的照片查詢/補查,直接回文字部分。
		if textOnly {
			writeJSON(w, http.StatusOK, textOnlyResponse{
				Name: resp.Name, Address: resp.Address, Lat: resp.Lat, Lng: resp.Lng,
				Rating: resp.Rating, Summary: resp.Summary,
			})
			return
		}

		// photoOnly 模式——2026-09 移除 Pexels 讀圖來源:一律以 photo_assets
		// (applyPhotoAssetsAsSource,見該函式的完整說明)決定要回應的
		// googlePhotoUrls,不再嘗試補查 Pexels。
		if photoOnly {
			s.applyPhotoAssetsAsSource(&resp, placeID)
			writeJSON(w, http.StatusOK, photoOnlyResponse{GooglePhotoURLs: resp.GooglePhotoURLs})
			return
		}

		// 一般模式快取命中:最終顯示的照片一律由 applyPhotoAssetsAsSource
		// 決定 photo_assets 目前的內容(見該函式的完整說明)。
		//
		// 2026-10 新補圖節奏(取代舊的「點擊節奏 OR 時間」雙觸發判斷,見
		// photoCapForClickCount/decidePlacePhotoRefreshIndex 的完整
		// 說明)——每次點擊都判斷,但判斷依據只看本地 photo_assets 的
		// 新鮮度狀態(freshPhotoIndexStates,一組小範圍的索引查詢,不打
		// 任何 Google API),不重新確認 Google 實際有幾張照片:
		//
		//   - cap 範圍 [0, photoCapForClickCount(clickCount)) 內若有缺或
		//     過期的 index,才觸發背景補圖(backgroundFillPlacePhoto)
		//     ——這個背景任務內部才會真的打 GetPlaceDetails(Enterprise
		//     級查詢)+ PhotoDataURIUnrestricted 下載,只有真的要補圖時
		//     才付這筆費用。
		//   - cap 範圍內已經全部新鮮,完全不觸發任何背景任務、不打任何
		//     Google API——這是最常見的路徑,必須維持零成本。
		//
		// PhotoRefreshPending 這次同步回傳給呼叫端(見該欄位的完整
		// 說明),讓前端知道要不要繼續輪詢等待補圖結果,不用固定重試
		// 3 次卻不知道後端這次到底有沒有真的觸發。
		clickCount, clickErr := s.store.IncrementPlaceClickCount(placeID)
		if clickErr == nil {
			if shouldFetch, indexToFetch := s.decidePhotoRefresh(placeID, clickCount); shouldFetch {
				resp.PhotoRefreshPending = true
				s.backgroundFillPlacePhoto(placeID, r.URL.Path, indexToFetch, nil)
			}
		}

		// 2026-09 移除 Pexels 讀圖來源——最終顯示給使用者看的照片欄位一律
		// 由 applyPhotoAssetsAsSource 決定 photo_assets 目前的內容。
		s.applyPhotoAssetsAsSource(&resp, placeID)
		writeJSON(w, http.StatusOK, resp)
		return
	}

	if textOnly {
		apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
		// 2026-10:原本直接 geo.New(apiKey),繞過可注入的工廠(測試無法替換成假
		// gateway)。改走 newPlaceDetailsClient 跟其他地點詳情呼叫點一致;正式環境
		// 它預設就是 geo.New,會自動帶上統一快取——未命中時結果寫進快取,連點
		// 同一個地點不再每次都付費。
		client := s.newPlaceDetailsClient(apiKey)
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

	// photoOnly 模式、快取完全未命中(連 place_details_cache 的列都還
	// 不存在,理由同上面 photoOnly 分支的說明)——2026-09 移除 Pexels 讀圖
	// 來源後,這裡不再有低成本的補圖管道可查(不能打 Google Photo Media,
	// 理由同這支 handler 一貫的成本控制設計),直接回空,交給呼叫端
	// (GeoHotelSidebar.tsx 的延遲載入清單)顯示 placeholder,下一次查詢
	// (例如使用者真的點選這筆候選、走一般模式)才有機會真正補上照片。
	if photoOnly {
		name := r.URL.Query().Get("name")
		if name == "" {
			writeErr(w, http.StatusBadRequest, "invalid_input", "photoOnly 模式缺少 name 查詢參數")
			return
		}
		writeJSON(w, http.StatusOK, photoOnlyResponse{})
		return
	}

	// tryClaimPlaceDetailsInFlight 用 placeID 當 key,判斷這次請求是否
	// 搶到「處理這個地點」的權利(見 Server.placeDetailsInFlight 與
	// tryClaimPlaceDetailsInFlight 的完整說明)——搶到的請求(claimed
	// 為 true)才會真正執行 fetchAndCachePlaceDetails(打 Google、寫入
	// 快取),沒搶到代表已經有其他並發請求正在處理同一個 placeID,
	// 這次直接視為「被丟棄」,不等待、不共享結果,改走下面的降級邏輯
	// (讀現有快取,見 buildDegradedPlaceDetailsResponse)。
	//
	// r.Context() 不能直接傳給 fetchAndCachePlaceDetails:若這個
	// context 因為使用者提早關閉頁面而被取消,不該連帶讓這次「代表這個
	// placeID 在跑」的查詢中途中斷、卻仍佔用著 in-flight 標記——故改用
	// 獨立於任何單一請求的 context.Background() 搭配自己的逾時,理由同
	// 上方各處「獨立於請求 context」的說明。
	if claimed := s.tryClaimPlaceDetailsInFlight(placeID); claimed {
		defer s.releasePlaceDetailsInFlight(placeID)
		resp, err := s.fetchAndCachePlaceDetails(context.Background(), r.URL.Path, placeID)
		if err != nil {
			// ErrRateLimited(apigateway 依 endpoint 的拒絕型限流,見該
			// sentinel error 的說明)發生在 fetchAndCachePlaceDetails 內部
			// 呼叫 client.GetPlaceDetails/ListPlacePhotoRefs/PhotoDataURI
			// 任何一個的當下——這跟「被丟棄」是同一類「這次沒能取得新
			// 資料」的情況,一律不當作錯誤回應給前端,改走降級邏輯。
			if errors.Is(err, apigateway.ErrRateLimited) {
				writeDegradedPlaceDetails(w, s.buildDegradedPlaceDetailsResponse(r.Context(), placeID))
				return
			}
			if err == geo.ErrNotFound {
				writeErr(w, http.StatusNotFound, "no_match", "查無這個地點的詳細資訊")
				return
			}
			writeErr(w, http.StatusBadGateway, "place_details_failed", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, resp)
		return
	}

	// 沒搶到:同一 placeID 已經有其他並發請求在處理中,這次直接丟棄,
	// 不等待對方完成——降級成「盡量用現有快取回應」,理由與行為細節見
	// buildDegradedPlaceDetailsResponse 的說明。
	writeDegradedPlaceDetails(w, s.buildDegradedPlaceDetailsResponse(r.Context(), placeID))
}

// 主題介紹頁/訪客分享頁用的免登入公開端點(handlePublicGeoPlaceDetails/
// handlePublicGeoAttractions)與它們專屬的 publicAttractionsCityAllowlist、
// handleGeoAttractionsByCity 都已搬到 geo_outline_public.go——見該檔案開頭
// 對「把訪客可達的公開端點集中成獨立檔案」的完整說明。這裡維持登入版
// 核心邏輯(handleGeoPlaceDetails 等)不動,那批公開端點只是委派給它們。

// tryClaimPlaceDetailsInFlight 嘗試搶到「處理這個 placeID」的權利——用
// sync.Map.LoadOrStore 確保「檢查是否已存在」與「標記為存在」是單一
// 原子操作(見 Server.placeDetailsInFlight 的完整說明)。回傳 true 代表
// 這次呼叫是第一個搶到的(loaded 為 false,呼叫端必須之後呼叫
// releasePlaceDetailsInFlight 釋放);回傳 false 代表已經有其他請求正在
// 處理同一個 placeID,這次呼叫端不應該執行查詢。
//
// 抽成獨立方法(不直接在 handler 內操作 placeDetailsInFlight 欄位)是為了
// 讓測試能單獨驗證「兩個並發呼叫,第一個回傳 true、第二個回傳 false」這種
// 情境,不需要真的發兩個並發 HTTP 請求、也不需要真的觸發
// fetchAndCachePlaceDetails 才能測試搶佔邏輯本身。
func (s *Server) tryClaimPlaceDetailsInFlight(placeID string) (claimed bool) {
	_, loaded := s.placeDetailsInFlight.LoadOrStore(placeID, struct{}{})
	return !loaded
}

// releasePlaceDetailsInFlight 移除 placeID 的 in-flight 標記——只有
// tryClaimPlaceDetailsInFlight 回傳 true 的那個呼叫端負責呼叫這個方法
// (見該函式的說明),且不論 fetchAndCachePlaceDetails 成功或失敗都要
// 呼叫(handler 用 defer 呼叫,見上方呼叫點),避免查詢失敗時這個 placeID
// 的標記卡住不會被清除,導致之後所有對這個 placeID 的請求永遠被丟棄。
func (s *Server) releasePlaceDetailsInFlight(placeID string) {
	s.placeDetailsInFlight.Delete(placeID)
}

// buildDegradedPlaceDetailsResponse 是 handleGeoPlaceDetails 一般模式的
// 降級路徑——不論是同一 placeID 被其他並發請求佔用(tryClaimPlaceDetailsInFlight
// 回傳 false)、還是 fetchAndCachePlaceDetails 內部被 apigateway
// 的拒絕型限流擋下(ErrRateLimited),都不當作錯誤回應給前端,而是盡量
// 用現有資料組一個可以顯示的回應:
//
//  1. 先讀 s.store.GetCachedPlaceDetails(不限制新鮮度,maxAge 傳
//     0 等同不檢查是否過期——見該函式簽章,傳 0 代表任何存在的列都算
//     命中)——降級情境下,舊資料好過完全沒有資料或直接回錯誤給使用者,
//     這個地點過去查過的名稱/地址/評分/簡介仍然有參考價值。
//  2. 若有快取列,一併用 applyPhotoAssetsAsSource 從 photo_assets
//     補上照片欄位,格式對齊一般模式的 placeDetailsResponse(前端不需要
//     額外處理「這是降級回應」的特殊格式)。
//  3. 若完全沒有任何快取資料(這個 placeID 第一次被查詢、且剛好被丟棄
//     或限流擋下)——回傳一個只有 placeId 的最小回應(其餘欄位皆為零值/
//     空字串),讓前端至少能顯示卡片本身(以 placeId 為標題佔位),不是
//     整支 API 回 500 或無回應。這裡選擇「回一個內容空但結構完整的
//     placeDetailsResponse」而非另外定義一個「暫時無法取得資料」的新
//     狀態欄位——理由是前端目前處理 placeDetailsResponse 的方式本來就是
//     依欄位是否為空決定要不要顯示(見各欄位 json:",omitempty"),沿用
//     同一個回應形狀不需要前端另外處理一種新的錯誤/待重試狀態,使用者
//     體驗上等同「這個地點的詳細資訊還在補齊中」,重新整理或稍後再次
//     點擊會重新觸發查詢。
func (s *Server) buildDegradedPlaceDetailsResponse(ctx context.Context, placeID string) placeDetailsResponse {
	resp := placeDetailsResponse{}

	// GetCachedPlaceDetails 的 maxAge 語意是「距今超過這個時長就視為
	// 未命中」(見該函式的說明,now().Sub(FetchedAt) > maxAge 時回傳
	// ok=false)——傳 0 會讓幾乎任何存在的列都被判定為「已過期」而回傳
	// ok=false,跟這裡「不論新鮮度、只要列存在就要拿來用」的降級意圖恰好
	// 相反。故改傳 placeDetailsDegradedResponseMaxAge(見該常數的說明),
	// 一個刻意選得極大的時長,讓「列是否存在」實質上成為唯一的判斷依據。
	cached, ok, err := s.store.GetCachedPlaceDetails(placeID, placeDetailsDegradedResponseMaxAge)
	if err != nil || !ok {
		// 完全沒有快取資料可用——回傳空殼回應,理由見上方函式說明第 3 點。
		return resp
	}

	resp.Name = cached.Name
	resp.Address = cached.Address
	resp.Lat = cached.Lat
	resp.Lng = cached.Lng
	resp.Rating = cached.Rating
	if cached.Summary != nil {
		resp.Summary = *cached.Summary
	}

	// 2026-09 移除 Pexels 讀圖來源——最終顯示給使用者看的照片欄位一律由
	// applyPhotoAssetsAsSource 決定 photo_assets 目前的內容。
	s.applyPhotoAssetsAsSource(&resp, placeID)

	return resp
}

// writeDegradedPlaceDetails 把降級回應寫出——固定回 HTTP 200(不是錯誤
// 狀態碼),理由見 buildDegradedPlaceDetailsResponse 的說明:這個路徑
// 刻意不當作錯誤處理,前端拿到的是格式正常、但可能欄位不全的
// placeDetailsResponse,不需要另外處理錯誤分支。抽成獨立函式只是避免
// 兩個呼叫點(搶到但降級、沒搶到直接降級)重複同一行 writeJSON 呼叫。
func writeDegradedPlaceDetails(w http.ResponseWriter, resp placeDetailsResponse) {
	writeJSON(w, http.StatusOK, resp)
}

// fetchAndCachePlaceDetails 是 handleGeoPlaceDetails 一般模式的實際查詢
// 邏輯——查 Google Place Details、下載 Google 照片、寫入快取,回傳組好
// 的回應。抽成獨立函式是為了讓 singleflight.Do 能包住整段查詢+寫入過程
// (見呼叫端的說明),不是為了重用。
func (s *Server) fetchAndCachePlaceDetails(ctx context.Context, requestPath, placeID string) (placeDetailsResponse, error) {
	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := s.newPlaceDetailsClient(apiKey)
	client.SetCache(s.photoCache)
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	ctx = geo.WithCaller(ctx, "handleGeoPlaceDetails")
	ctx = geo.WithPath(ctx, requestPath)

	details, err := client.GetPlaceDetails(ctx, placeID)
	if err != nil {
		return placeDetailsResponse{}, err
	}

	resp := placeDetailsResponse{
		Name:    details.Name,
		Address: details.Address,
		Lat:     details.Lat,
		Lng:     details.Lng,
		Rating:  details.Rating,
		Summary: details.Summary,
	}

	// 這裡先寫入一次 SetCachedPlaceDetails,才接著呼叫
	// IncrementPlaceClickCount——順序是刻意的,不能顛倒:
	// IncrementPlaceClickCount 對「place_id 在 place_details_cache 裡
	// 還不存在」的情況會直接回傳 clickCount=0、且完全不遞增任何欄位
	// (見該函式的說明,UPDATE 語句在沒有符合條件的列時單純不生效,不會
	// 自己 insert 一列)。走到這支函式代表快取未命中或已過期,對「這個
	// 地點第一次被查詢」的情境而言,place_details_cache 這時通常還沒有
	// 這個 place_id 的列,若在這裡才呼叫 IncrementPlaceClickCount,會
	// 因為列不存在而永遠拿到 clickCount=0、且這次點擊不會被真正記錄
	// 進資料庫,之後每次「快取未命中」的查詢都會重複發生同樣的問題。
	// 故先用 SetCachedPlaceDetails 確保這一列已經存在(即使是覆寫既有
	// 過期列也無妨),IncrementPlaceClickCount 才能穩定命中同一列、正確
	// 累加 click_count。
	var summaryPtr *string
	if resp.Summary != "" {
		summaryPtr = &resp.Summary
	}
	//
	// 2026-10 統一快取:GetPlaceDetails 命中快取時(FromCache)資料本來就是從
	// 這一列讀出來的,不該再寫回——寫回會把 fetched_at 重設成現在,讓這份資料
	// 看起來永遠新鮮(快取永遠不過期)。未命中時 geo 層的快取已經寫過一次;
	// 這裡保留一次寫入是為了沒有掛統一快取的 client(測試注入的假 gateway)
	// 仍能確保這一列存在,內容相同、重複寫入無害。
	if !details.FromCache {
		_ = s.store.SetCachedPlaceDetails(placeID, resp.Name, resp.Address, resp.Lat, resp.Lng, resp.Rating, summaryPtr)
	}

	// 2026-10 新補圖節奏(見 photoCapForClickCount/decidePlacePhotoRefreshIndex
	// 的完整說明)——這裡是這個地點第一次被查詢的情境,details.PhotoRefs
	// 已經隨上面的 GetPlaceDetails 一起拿到,不需要為了判斷要不要補圖
	// 再多打一次 Google。cap 範圍內(通常是 1 張,見 photoCapForClickCount
	// 對 clickCount<10 的說明)若查無新鮮紀錄,觸發背景下載——這是「初次
	// 查詢只下載第一張,不再一次下載到某個固定上限」的既有設計延續。
	//
	// 2026-09:使用者明確要求「地圖上主題點/精選點也要跟點選附近景點
	// 一樣的流程」(改成每個點都呼叫這支端點,見呼叫端 useAttractionOverlays.ts
	// 的完整說明)——這代表快取未命中(第一次查詢某個 place)的情境會
	// 遠比過去頻繁發生。這裡原本把「向 Google 查 Photo Media 下載一張
	// 圖+上傳 GCS」整段寫在 writeJSON 之前同步執行,踩的正是快取命中
	// 分支已經修過的同一種延遲問題——故同樣拆開:GetPlaceDetails(文字
	// 資訊)維持同步,讓呼叫端能立即拿到文字資料顯示;真正耗時的 Photo
	// 下載+上傳 GCS 改成背景 goroutine(backgroundFillPlacePhoto),這次
	// 回應不等它完成,沒有照片可顯示時交給 applyPhotoAssetsAsSource 用
	// 現有(可能是空的)photo_assets 資料決定回應內容,下一次查詢才會
	// 看到新照片。
	// 剛從 Google 拿到完整照片清單,先記下實際張數(見 recordPlacePhotoCount)
	// ——必須在判斷之前記,判斷才會用到這次最新的張數。0 也要記:確認這個
	// 地點沒有照片,之後就不會再為了「有沒有照片」去問 Google。
	//
	// 只在真的從 Google 拿到清單時才記:命中快取(FromCache)時 PhotoRefs 一定是
	// nil(照片參照有時效,不進快取),這時 len 是 0 不代表「沒有照片」,誤記成 0
	// 會讓這個地點之後永遠不補圖。
	if !details.FromCache {
		s.recordPlacePhotoCount(placeID, len(details.PhotoRefs))
	}

	clickCount, _ := s.store.IncrementPlaceClickCount(placeID)
	// len(details.PhotoRefs)==0 時這個地點在 Google 端根本沒有任何照片
	// (非錯誤,見 GetPlaceDetails 的完整說明——沒有 photos[] 時
	// PhotoRefs 維持零值 nil)——不需要觸發任何背景任務,也不該把零值
	// nil 傳給 backgroundFillPlacePhoto 當作「已經查過、確定沒有照片」
	// 的 knownPhotoRefs(該函式用 nil 判斷「呼叫端還沒查過,要自己查」,
	// 兩種情況在型別層級上無法區分,故在這裡提前判斷掉,不讓空清單流
	// 進那支函式造成語意混淆)。
	//
	// 2026-10 統一快取:命中快取(FromCache)時 PhotoRefs 也是 nil,但意義不同——
	// 不是「沒有照片」而是「這次沒查」。此時照常用 decidePhotoRefresh 判斷(它
	// 看已記下的實際張數與 photo_assets 新鮮度),需要補圖時把 nil 傳給背景任務,
	// 由它自己用 GetPlaceDetailsFresh 取得最新的照片參照。
	if details.FromCache || len(details.PhotoRefs) > 0 {
		if shouldFetch, indexToFetch := s.decidePhotoRefresh(placeID, clickCount); shouldFetch {
			resp.PhotoRefreshPending = true
			// 未命中時 details.PhotoRefs 已經在手上(這次 GetPlaceDetails 同步
			// 查詢的結果),直接傳給背景任務,不需要讓它再打一次 Google;
			// 命中快取時是 nil,背景任務會自己取。
			s.backgroundFillPlacePhoto(placeID, requestPath, indexToFetch, details.PhotoRefs)
		}
	}

	// 2026-09 移除 Pexels 讀圖來源——這裡原本會同步查一次 Pexels、寫進
	// place_pexels_photos(該表已移除;供之後點擊判斷 hasExistingPexelsPhoto/漸進補圖
	// 節奏使用),但最終顯示給使用者看的照片欄位一律由 applyPhotoAssetsAsSource
	// 決定,Pexels 這段查詢從未真正影響過回應內容,拿掉不改變任何使用者
	// 可見行為。
	s.applyPhotoAssetsAsSource(&resp, placeID)

	return resp, nil
}

// photoCapForClickCount 計算目前允許補到的張數上限——2026-10 新補圖
// 節奏(取代舊的 shouldAddGooglePlacePhoto 點擊節奏公式),使用者明確
// 指定:
//   - clickCount < 10 時,上限是 1 張(「無圖就補第一張」)。
//   - clickCount 落在 [10, 100) 時,上限是 2 張。
//   - 之後每多 100 次點擊,上限 +1 張(clickCount=100 時上限 3、
//     clickCount=200 時上限 4,以此類推)。
//
// 純函式,不涉及資料庫/隨機數,給定同樣輸入永遠回傳同樣結果。
func photoCapForClickCount(clickCount int64) int {
	if clickCount < 10 {
		return 1
	}
	return 2 + int(clickCount/100)
}

// decidePlacePhotoRefreshIndex 從 [0, photoCapForClickCount(clickCount))
// 範圍內,找第一個「缺或過期」的 index,決定這次點擊要不要補圖、補哪個
// index——純函式,不查資料庫:fresh 由呼叫端依 photo_assets 查詢結果
// 組好傳入(fresh[i] 為 true 代表 index i 目前存在且未過期),長度可以
// 小於 cap,超出切片長度的 index 視同缺(未新鮮),跟「存在但過期」走
// 同一套判斷,呼叫端不需要另外分辨兩種狀態。
//
// 2026-10 取代舊的 shouldAddGooglePlacePhoto/resetPhotoProgressOnTargetChange/
// decidePlacePhotoAction(依賴 newPhotoCount/googlePhotoTargetCount 計數器,
// 追上目標後即使照片已經過期也永遠不會重新整新,見該問題在清水寺照片
// 全數過期卻未觸發補圖的既有診斷記錄)——新機制直接檢查實際新鮮度,不
// 依賴計數器,過期照片到了 cap 範圍內就會被掃到、依序換新。
//
// 回傳值:
//   - shouldFetch:這次是否該真的去下載一張照片。
//   - indexToFetch:shouldFetch 為 true 時,要補的 photo_index;
//     shouldFetch 為 false 時固定回傳 -1,代表這個值不適用。
func decidePlacePhotoRefreshIndex(clickCount int64, fresh []bool) (shouldFetch bool, indexToFetch int) {
	// 舊簽章:不知道該點實際張數、不設全域最大值,行為與加入張數記錄之前完全
	// 相同(保留給既有測試與不需要這兩個參數的呼叫端)。
	return decidePlacePhotoRefreshIndexWithCount(clickCount, nil, math.MaxInt, fresh)
}

// effectivePhotoCap 算出「這個地點目前最多該有幾張新鮮照片」,取三個參數的
// 最小值(2026-10,使用者明確要求):
//
//		min(點擊數決定的上限, 該點在 Google 上實際有的張數, 全域「照片最大張數」設定)
//
//	  - photoCount 為 nil 代表還不知道實際張數(沒查過),不能當成 0,否則第一次
//	    請求就永遠補不了——此時只由另外兩個參數決定。
//	  - photoCount 為 0 代表確認這個地點沒有照片,有效上限為 0,完全不補。
//
// 為什麼要有後兩個參數:補圖判斷只看「上限範圍內每個索引有沒有新鮮的
// photo_assets」,地點實際照片數少於上限時,多出來的索引永遠沒有紀錄、永遠
// 被判成「缺」,每次請求都白打一次 places.get 卻什麼都補不到(用 mock 重現:
// 6 次請求打 6 次)。全域最大值則給點擊數公式(2+點擊/100,原本沒有上限)
// 一個天花板,讓運維能用 CLI 控制 Google Place Photos 的成本。
func effectivePhotoCap(clickCount int64, photoCount *int, maxCount int) int {
	c := photoCapForClickCount(clickCount)
	if photoCount != nil && *photoCount < c {
		c = *photoCount
	}
	if maxCount < c {
		c = maxCount
	}
	if c < 0 {
		c = 0
	}
	return c
}

// decidePlacePhotoRefreshIndexWithCount 是 decidePlacePhotoRefreshIndex 加上
// 「實際張數」與「全域最大張數」兩個參數的版本:有效上限(effectivePhotoCap)
// 範圍內若有缺或過期的索引才補;到達有效上限且都新鮮就不補——補圖與
// 重讀地點資訊(places.get)都不會被觸發。
func decidePlacePhotoRefreshIndexWithCount(clickCount int64, photoCount *int, maxCount int, fresh []bool) (shouldFetch bool, indexToFetch int) {
	capN := effectivePhotoCap(clickCount, photoCount, maxCount)
	for i := 0; i < capN; i++ {
		isFresh := i < len(fresh) && fresh[i]
		if !isFresh {
			return true, i
		}
	}
	return false, -1
}

// handleGeoPlacesNearby(GET /internal/geo/places/nearby)、其專屬的
// placeResponse/classifyPlaceCategory/allowedPlaceTypes 已於 2026-08
// 隨「地圖三個查地點入口統一改走 handleGeoGeocode」這次改動一併移除——
// 地圖上方類別標籤(景點/飯店/餐廳)原本是這支端點(client.SearchNearby,
// Nearby Search)唯一的前端呼叫端,改走 handleGeoGeocode(mode=restrict,
// Text Search)後,已確認 grep 全專案不再有任何呼叫端使用這支端點/前端
// fetchGeoPlacesNearby,故視為死代碼一併清理(見 CHANGELOG)。
// client.SearchNearby 本身不受影響、繼續保留——fetchNearbyHotels(供
// handleGeoAttractionsNearby/handleGeoAttractions 使用)與
// internal/onagenttools 的 recommend_nearby LLM 工具
// 仍是這個函式現存的呼叫端。

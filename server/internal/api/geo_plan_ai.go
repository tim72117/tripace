package api

import (
	"context"
	"errors"
	"log"
	"math"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/tim72117/tripace/internal/apigateway"
	"github.com/tim72117/tripace/internal/geo"
	"gorm.io/gorm"
)

// geo_plan_ai.go — plan-ai(AI 規劃行程)專用的查詢端點,服務正式功能
// (web/src/trip-plan/TripPlanPage.tsx)透過 web/src/plan-core/
// attractionTools.ts 這層 onagent 工具資料層發出的查詢:search_attraction/
// add_attraction 工具,以及 insertAttractionAfter 的背景反查/交通預估。
//
// 2026-09:這批端點原本掛在 /public/geo/* 免登入路徑上——任何訪客都能
// 呼叫,等於把「消耗 Google Places 計費配額」這件事開放給任何人,且無法
// 跟正式功能的流量分開限流或個別關閉。現已全部搬到需登入的
// /internal/geo/plan-ai/*(掛 internalAuth,見 api.go 該區塊的完整說明)。
//
// 註:另有一個「AI 規劃時間軸試作原型」(寫死腳本 + 模擬推論 WebSocket,
// handlePlanSimWS)也共用這批端點與 plan-core 資料層,但它不在這個分支上
// ——保存在 plan-ai-sim 分支,見 api.go 路由註冊處的說明。這個檔案裡若有
// 註解提到 AIPlanTimelinePage.tsx,指的就是那個原型(歷史沿革說明)。
//
// 不屬於這裡的:
//   - handlePublicGeoPlaceDetails/handlePublicGeoPlacePhotoAssets/
//     handlePublicGeoAttractions(主題介紹頁/訪客分享頁用的**真正免登入**
//     公開端點)——目前在 geo_outline.go,跟這裡需登入的端點是兩套不同
//     東西,不要混淆(另有一個把那批分離成獨立檔案的改動在
//     wip/tainan-chikan-and-server-changes 分支)。
//   - handleGeoPlaceDetails 等登入後正式規劃地圖功能——見 geo_outline.go。
//
// publicPlaceSearchEndpoint 是 Server.planAiRateLimiter 用的
// RateLimiter key(見該欄位在 api.go Server struct 上的完整說明)——這裡
// 不沿用 geo 套件內部 "places.searchText" 那個字串,是因為這個 key 保護
// 的是「這支公開端點本身」的呼叫頻率,不是 Google API 那個 endpoint 分類
// 概念,兩者刻意分開,即使實務上一次成功呼叫最終仍會觸發一次
// "places.searchText" 的 Google API 呼叫。
const publicPlaceSearchEndpoint = "public.placeSearch"

// GET /internal/geo/plan-ai/place-search?query={文字}
//
// 通用地名文字查詢——供 plan-core/attractionTools.ts 的 search_attraction
// 工具(見該檔案的完整說明)查詢任意地名取得座標,不限於資料庫裡已人工
// 建檔的固定景點池。
// 跟 handlePublicGeoAttractions(查整個城市清單)是互補而非取代的關係:
// 那支端點只能查白名單城市裡已建檔的固定資料,這支端點能查任意地名,
// 但只回傳最相關的第一筆結果(不像 handleGeoGeocode 那樣可能回傳多筆
// 候選讓使用者手動挑選)——「查地名取得座標、再依座標算鄰近」這個流程
// 只需要一個確定的錨點座標,不需要候選列表 UI。
//
// 刻意不重用 handleGeoGeocode(那支端點的 bias/restrict 兩階段判斷邏輯
// 是為了登入後正式規劃地圖的搜尋框設計的,行為遠比這裡需要的複雜),
// 改直接呼叫 geo.Client.Search 最簡單的單次查詢模式,固定 MaxResults:1
// (只要最相關的一筆,不需要 Search 其餘 opts 如 LocationBias/
// LocationRestriction)。
//
// 需登入(掛在 internalAuth 底下,見 api.go 的 /internal/geo/plan-ai/*
// 區塊)。但登入不等於成本可控——這支端點最終會觸發真實計費的 Google Text
// Search API 呼叫,且呼叫時機由 LLM 自主決定(可能迴圈重試),故仍套用
// planAiRateLimiter 做全域拒絕型限流(見該欄位的完整說明),把關
// 順序是「先檢查限流,通過才真的呼叫 Google API」,被拒絕的請求完全不會
// 產生任何外部 API 呼叫或費用。
func (s *Server) handlePublicGeoPlaceSearch(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("query")
	if query == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 query 查詢參數")
		return
	}

	if !s.planAiRateLimiter.Allow(publicPlaceSearchEndpoint) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited", "查詢過於頻繁,請稍後再試")
		return
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := s.newGeoGeocodeClient(apiKey)
	client.SetCache(s.photoCache)

	// 逾時對齊 handleGeoGeocode 的單階段查詢成本(這裡只有一次 Search
	// 呼叫,不像該 handler 的 bias 模式可能兩階段查詢,5 秒已足夠寬裕)。
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	ctx = geo.WithCaller(ctx, "handlePublicGeoPlaceSearch")
	ctx = geo.WithPath(ctx, r.URL.Path)

	// geo.Client.Search 查無結果時回傳 geo.ErrNotFound(不是空陣列+nil
	// error,見該錯誤的定義處)——這是正常的「查無此地」情境,不是查詢
	// 失敗,回應 200 + found:false 讓前端能區分「查詢本身出錯」(502)
	// 與「查詢成功但沒有這個地方」(200,found:false)兩種不同語意,呼叫端
	// (attractionTools.ts 的 search_attraction)才能據此決定接下來的行為
	// (例如查無結果時提示使用者換個關鍵字,而非當成系統錯誤處理)。
	// Region 固定 "tw"——這支端點目前唯一的呼叫端(AIPlanTimelinePage.tsx
	// 的 search_attraction 工具)只服務台南行程情境,不帶任何地理偏向時
	// 純文字查詢完全依賴 Google 對伺服器來源的地理判斷,實測發現查「安平
	// 古堡」這類全台可能有同名或近似字號店家的查詢會命中完全不相關地區
	// 的結果(例如台北的店家)——加上 regionCode 讓 Google 明確偏向台灣
	// 地區的結果,是最低成本的修正,不需要額外引入 LocationBias 座標
	// 偏向(那需要一個參考座標,這支端點的呼叫情境目前沒有「使用者已經
	// 看著哪張地圖」這種既有上下文可以取用,見 handleGeoGeocode 的
	// LocationBias 用法對比)。
	places, err := client.Search(ctx, query, &geo.SearchOptions{MaxResults: 1, Region: "tw"})
	if errors.Is(err, geo.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"found": false})
		return
	}
	if err != nil {
		writeErr(w, http.StatusBadGateway, "search_failed", err.Error())
		return
	}
	if len(places) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"found": false})
		return
	}

	p := places[0]
	writeJSON(w, http.StatusOK, map[string]any{
		"found":   true,
		"name":    p.Name,
		"address": p.Address,
		"lat":     p.Lat,
		"lng":     p.Lng,
		"placeId": p.PlaceID,
	})
}

// nearbyAttractionSearchEndpoint 是 Server.planAiRateLimiter
// 用的 RateLimiter key——這支端點會在資料庫候選不足時觸發 Google Nearby
// Search(計費呼叫),理由與獨立限流的完整說明見 api.go Server struct 上
// 對應欄位的註解,對稱 publicPlaceSearchEndpoint 的既有模式。
const nearbyAttractionSearchEndpoint = "public.nearbyAttractionSearch"

// allowedNearbyAttractionTypes 是 handlePublicGeoAttractionSearch 的
// types 查詢參數允許傳入的 Google Places 官方地點類型白名單——使用者
// 明確要求「排幾個觀光會用到的類別讓 LLM 選」「用固定選單讓 LLM 選」,
// 這裡收斂成一份旅遊規劃情境常用的固定子集(景點/文化、餐飲、購物、
// 住宿四大類),不是把 Google 官方將近 200 種類型全部開放——LLM 只需要
// 從這份固定清單裡選,不需要自己判斷/猜測哪些是合法的 Google type
// 字串,也避免呼叫端傳入不在白名單內、但語法上仍是合法字串的值(例如
// 拼錯或用了不相關的類型)進而觸發語意上不合理的查詢結果。傳入不在這份
// 白名單內的值會被直接忽略(見下方 handler 的過濾邏輯),不是回傳錯誤
// ——理由同這支端點既有的「查詢失敗不影響已查到的候選」降級慣例,一個
// 不合法的類型值不該讓整次查詢失敗。
var allowedNearbyAttractionTypes = map[string]bool{
	// 景點/文化
	"tourist_attraction":  true,
	"museum":              true,
	"art_gallery":         true,
	"park":                true,
	"place_of_worship":    true,
	"historical_landmark": true,
	"zoo":                 true,
	"amusement_park":      true,
	// 餐飲
	"restaurant": true,
	"cafe":       true,
	"bakery":     true,
	"bar":        true,
	// 購物
	"shopping_mall": true,
	"market":        true,
	// 住宿
	"lodging": true,
}

// minNearbyAttractionResults 是「資料庫候選數量少於這個門檻時,才觸發
// Google Nearby Search 補點」的判斷基準——使用者明確要求「如果搜尋的
// attraction 少於 10 個,則用 google search nearby 補上不重複的點」。
// 資料庫候選已經達到或超過這個數量時,完全不打 Google API,維持零成本
// (理由同 handleGeoAttractionsByCity 對零成本路徑的既有堅持)。
const minNearbyAttractionResults = 10

// GET /internal/geo/plan-ai/attraction-search?lat={緯度}&lng={經度}
//
// 鄰近景點候選查詢(需登入)——供 plan-core/attractionTools.ts 的 search_attraction 工具
// (見 attractionTools.ts 的完整說明)取得「這個座標附近有哪些可以推薦
// 給使用者的景點」。查詢策略分兩層:
//
//  1. 優先查 store.ListAttractionsNearby——人工建檔的正式資料,免費、
//     資料品質有人工把關(名稱/簡介/分類)。
//  2. 若第一層查到的候選數量少於 minNearbyAttractionResults(10),
//     額外呼叫 geo.Client.SearchNearby(Google Nearby Search)補上
//     資料庫沒有的地點,直到湊滿(或 Google 端本身也沒那麼多結果)。
//     這裡刻意不管資料庫候選是 0 筆還是 9 筆都補到同一個門檻,而非
//     「資料庫完全沒有才查 Google」——使用者明確要求的判斷基準就是
//     「少於 10 個」這個數量門檻本身,不是「有沒有」這個二元判斷。
//
// 去重:比對 place_id——資料庫候選裡已經出現過的 place_id,Google
// Nearby Search 若再查到同一筆(常見,尤其資料庫收錄的多半也是該地區
// 知名地標),不重複加入。資料庫候選裡沒有 place_id 的紀錄(人工建檔
// 時可能沒填)不參與去重比對,但仍正常回傳(只是無法被拿來排除 Google
// 端的重複結果)。
//
// Google 補上的候選一律用同一種回應形狀(attractionResponse)回傳,
// 不含 ID(這批候選沒有資料庫紀錄,理由見下方完整說明)——使用者明確
// 要求「LLM 選擇的時候用 placeId」:不管候選來自資料庫還是 Google,
// 前端/LLM 只需要認得同一個 placeId 欄位當識別碼,不需要知道兩種來源
// 的差異,也不需要為 Google 補的候選另外發明一種臨時 id 機制——這是
// 回顧「用 id 讓 LLM 傳、不用完整資料」這個既有設計的核心精神後確認的
// 方向(見 attractionTools.ts 開頭「2026-09 第三次重構」的完整說明:
// id 應該是給後端統一查詢用的引用,不該讓前端/LLM 自己解析或另外維護
// 一套對應關係)。之後 add_attraction 收到這個 placeId,呼叫
// GET /internal/geo/plan-ai/place-details-any 查詢時,該端點內部本來就會先查一次
// store.GetAttractionByPlaceID(見 handlePublicGeoPlaceDetailsAny 的
// 完整說明)——查得到就優先用資料庫資料,查不到才 fallback 查 Google,
// 不需要這裡另外記住「這個 placeId 是從 Google 查來的」這件事。
//
// 需登入(掛在 internalAuth 底下)。但登入不等於成本可控——這支端點在
// 資料庫候選不足時會觸發真實計費的 Google Nearby Search API 呼叫,且呼叫
// 時機由 LLM 自主決定,故仍套用獨立的
// planAiRateLimiter 做全域拒絕型限流(見該欄位的完整
// 說明),把關順序是「先檢查限流,通過才真的呼叫 Google API」。
func (s *Server) handlePublicGeoAttractionSearch(w http.ResponseWriter, r *http.Request) {
	lat, latErr := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lng, lngErr := strconv.ParseFloat(r.URL.Query().Get("lng"), 64)
	if latErr != nil || lngErr != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少或不合法的 lat/lng 查詢參數")
		return
	}

	// types:選填、逗號分隔的地點類型清單(如 "restaurant,cafe"),只在
	// Google Nearby Search 補點那段生效(見下方呼叫 client.SearchNearby
	// 處)——資料庫候選(store.ListAttractionsNearby)本身沒有依類型篩選
	// 的概念,不受這個參數影響,理由是資料庫這批是人工建檔的固定精選
	// 資料,數量有限,不該因為使用者這次想找的類型跟其中某幾筆不符就
	// 被排除,只有「不足額才觸發」的 Google 補點這一段才需要依類型限縮
	// 搜尋範圍。不在 allowedNearbyAttractionTypes 白名單內的值直接忽略
	// (見該常數的完整說明),不視為錯誤。
	var includedTypes []string
	if rawTypes := r.URL.Query().Get("types"); rawTypes != "" {
		for _, t := range strings.Split(rawTypes, ",") {
			t = strings.TrimSpace(t)
			if allowedNearbyAttractionTypes[t] {
				includedTypes = append(includedTypes, t)
			}
		}
	}

	landmarks, err := s.store.ListAttractionsNearby(lat, lng, 3000)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}

	// isTheme===true 的紀錄是「主題點」(散策羅盤用語,見
	// model.Attraction.IsTheme 的完整說明)——使用者點開後會揭露周邊
	// 精選點的錨點,本身不是可以直接加入行程的單一站點,對齊正式散策
	// 羅盤功能(DesktopLayout.tsx nearbyAttractions 的既有
	// `.filter((a) => !a.isTheme)`)一貫的排除規則。這支端點原本沒有
	// 這層過濾,導致 /plan-ai 的 search_attraction 工具查詢結果會混入
	// 主題點(例如「赤崁・府城」跟它底下的精選點「赤崁樓」同時出現),
	// LLM 沒有能力分辨兩者語意不同,可能把主題點當成單一景點加入行程。
	attractions := make([]attractionResponse, 0, len(landmarks))
	knownPlaceIDs := make(map[string]bool, len(landmarks))
	for _, landmark := range landmarks {
		if landmark.IsTheme {
			continue
		}
		ar := toAttractionResponse(landmark)
		if landmark.PlaceID != nil {
			knownPlaceIDs[*landmark.PlaceID] = true
		}
		attractions = append(attractions, ar)
	}

	if len(attractions) < minNearbyAttractionResults {
		if !s.planAiRateLimiter.Allow(nearbyAttractionSearchEndpoint) {
			// 限流拒絕不當作錯誤回應——維持已經查到的資料庫候選,只是
			// 這次沒能用 Google 補滿,理由同 handleGeoPlaceDetails 對
			// apigateway.ErrRateLimited 的既有降級慣例:呼叫端拿到的仍是
			// 格式正常、可用的候選清單,只是筆數可能不到 10 筆。
			writeJSON(w, http.StatusOK, map[string]any{"attractions": attractions})
			return
		}

		apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
		client := s.newGeoGeocodeClient(apiKey)
		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		ctx = geo.WithCaller(ctx, "handlePublicGeoAttractionSearch")
		ctx = geo.WithPath(ctx, r.URL.Path)

		nearby, nErr := client.SearchNearby(ctx, lat, lng, &geo.NearbyOptions{
			RadiusMeters:  3000,
			MaxResults:    minNearbyAttractionResults,
			IncludedTypes: includedTypes,
		})
		cancel()
		// 查詢失敗不影響已經查到的資料庫候選——這是加值補強,不是這支
		// 端點的核心價值,失敗就維持資料庫候選的既有結果回傳,理由同
		// search_attraction 工具本身對鄰近候選查詢失敗的既有降級慣例。
		if nErr == nil {
			for _, p := range nearby {
				if len(attractions) >= minNearbyAttractionResults {
					break
				}
				if p.PlaceID == "" || knownPlaceIDs[p.PlaceID] {
					continue
				}
				knownPlaceIDs[p.PlaceID] = true
				attractions = append(attractions, attractionResponse{
					Name:    p.Name,
					Lat:     p.Lat,
					Lng:     p.Lng,
					PlaceID: p.PlaceID,
				})
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"attractions": attractions})
}

// GET /internal/geo/plan-ai/attraction/{id}
//
// 用資料庫 id 查單筆已建檔景點(store.GetAttraction,需登入)——供
// /plan-ai 的 search_attraction/add_attraction 工具使用(見
// attractionTools.ts 的完整說明):2026-09 使用者明確要求
// 「search_attraction 不用完整資訊,LLM 只送 attraction id 就好,前端會
// 用 attraction id 走點選附近景點那樣的流程」,對齊散策羅盤「點選附近
// 景點」(useThemeAttractionSelection.ts 的 fetchPoiContent)的兩段式
// 查詢:先用 attraction 本身資料(這支端點回傳的 name/summary)當底,
// 呼叫端(AIPlanTimelinePage.tsx 的 insertAttractionAfter)再視這筆資料
// 是否帶 placeId 決定要不要另外呼叫 GET /internal/geo/plan-ai/place-details-any
// 查 Google 補強——不是這支端點自己做這個補強,職責分開:這支端點只
// 單純查表,不含任何外部 API 呼叫,不受任何限流保護,因為查表不需要。
//
// photoUrl 是例外:雖然這支端點整體是「單純查表」,但這裡查的是
// photo_assets(而非 attractions.PhotoURL),理由見下方 photoUrl 組裝處
// 的完整說明——使用者明確要求前端不該再取用 attraction 人工建檔時可能
// 帶入的 Pexels 示意圖網址。
//
// id 不存在時回傳 404(不是 200+found:false)——跟 place-details-any 的
// found:false 語意不同:那支端點查的是「這個 placeId 在 Google 那邊存不
// 存在」,查無此地是正常的外部世界狀態;這支端點查的是「呼叫端傳來的 id
// 有沒有對應到我們自己資料庫裡的一筆紀錄」,查無紀錄代表呼叫端傳了一個
// 過期或錯誤的 id,是呼叫端該處理的錯誤情境,用標準 HTTP 404 語意更清楚。
func (s *Server) handlePublicGeoAttractionByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少景點 id")
		return
	}

	a, err := s.store.GetAttraction(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		writeErr(w, http.StatusNotFound, "not_found", "查無這個景點")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal_error", "查詢景點資料失敗")
		return
	}

	resp := map[string]any{
		"id":   a.ID,
		"name": a.Name,
		"lat":  a.Lat,
		"lng":  a.Lng,
	}
	if a.Summary != nil {
		resp["summary"] = *a.Summary
	}
	// 2026-09:photoUrl 改成只查 photo_assets(見
	// store.GetFreshPhotoAssetURL/photoAssetRow 的完整說明,理由同
	// handlePublicGeoPlaceDetailsAny 的同一次修正)——不再回傳
	// a.PhotoURL,那個欄位可能只是建檔當下沒指定 -photo-url 時自動補的
	// Pexels 示意圖(見 model.Attraction.PhotoURL 的完整說明),使用者
	// 明確要求前端不該再取用這種示意圖網址。a.PlaceID 有值時才查得到
	// (photo_assets 用 place_id 當識別鍵),沒有 place_id 的 attraction
	// (例如未曾對應到 Google 地點的人工建檔資料)一律不帶 photoUrl。
	if a.PlaceID != nil {
		if gcsURL, pOk, pErr := s.store.GetFreshPhotoAssetURL(*a.PlaceID); pErr == nil && pOk {
			resp["photoUrl"] = gcsURL
		}
	}
	if a.PlaceID != nil {
		resp["placeId"] = *a.PlaceID
	}
	writeJSON(w, http.StatusOK, resp)
}

// transitWalkMetersPerMinute/transitDriveMetersPerMinute/
// transitTransitMetersPerMinute 是模擬預估用的粗略速度換算表,單位公尺/
// 分鐘——2026-09 使用者明確要求「交通預估時間不要讓 AI 推論產生,而是
// 建立兩個點時,前端自己將兩點送到後端,由後端預估時間,先建立模擬
// 預估時間的後端,用假資料」,這幾個常數就是那個「假資料」的具體來源:
// 步行速度比照前端既有的 geoDistance.ts walkMinutesEstimate(日本不動產
// 業界慣例「1 分鐘 = 80 公尺」),開車/大眾運輸是市區平均車速的粗略
// 估計,不是任何真實路網 API 的結果。之後要接上真實的 Google Directions/
// Routes API 時,只需要替換 estimateTransitMinutes 內部的計算方式,不
// 影響這支端點對外的請求/回應形狀。
const (
	transitWalkMetersPerMinute    = 80.0
	transitDriveMetersPerMinute   = 400.0 // 約時速 24km,市區含號誌等候的保守估計
	transitTransitMetersPerMinute = 300.0 // 約時速 18km,含候車/轉乘時間的保守估計
)

// transitEarthRadiusMeters 與前端 geoDistance.ts 的 EARTH_RADIUS_METERS
// 取同一個值,確保兩邊算出來的直線距離一致,不會因為地球半徑常數不同而
// 產生無意義的微小落差。
const transitEarthRadiusMeters = 6371000.0

// haversineMeters 是 geoDistance.ts haversineMeters 的 Go 版本,算法與
// 常數完全對齊(見該檔案的完整說明)——兩點間球面距離,單位公尺。
func haversineMeters(lat1, lng1, lat2, lng2 float64) float64 {
	toRad := func(deg float64) float64 { return deg * math.Pi / 180 }
	dLat := toRad(lat2 - lat1)
	dLng := toRad(lng2 - lng1)
	rLat1 := toRad(lat1)
	rLat2 := toRad(lat2)
	sinDLat := math.Sin(dLat / 2)
	sinDLng := math.Sin(dLng / 2)
	h := sinDLat*sinDLat + math.Cos(rLat1)*math.Cos(rLat2)*sinDLng*sinDLng
	return 2 * transitEarthRadiusMeters * math.Asin(math.Sqrt(h))
}

// estimateTransitMode 依直線距離挑一個看起來合理的預設交通方式,供呼叫端
// 沒有明確指定 mode 查詢參數時使用——不是精確判斷,只是讓模擬資料的
// mode 不會太離譜(例如兩點相距 5 公尺卻顯示「開車」)。對應的 icon 交給
// iconForTransitMode 依這裡選出的 mode 統一決定,不在這裡重複維護一份
// icon 對照表。
func estimateTransitMode(meters float64) (mode string) {
	switch {
	case meters <= 1200:
		return "步行"
	case meters <= 5000:
		return "公車"
	default:
		return "開車"
	}
}

// metersPerMinuteFor 依交通方式回傳對應的模擬速度換算——未知/空字串的
// mode 一律當步行處理(最保守的估計,不會低估交通時間)。
func metersPerMinuteFor(mode string) float64 {
	switch mode {
	case "開車":
		return transitDriveMetersPerMinute
	case "公車", "捷運", "大眾運輸":
		return transitTransitMetersPerMinute
	default:
		return transitWalkMetersPerMinute
	}
}

// iconForTransitMode 回傳交通方式對應的既有 emoji 圖示(對齊
// 模擬腳本(plan-ai-sim 分支的 plan_sim_demo.go)用過的同一組圖示)——跟 estimateTransitMode
// 挑選 mode 用的是同一份對照表,只是這裡反過來:呼叫端已經指定 mode 時,
// icon 要跟著這個 mode 走,不能用「依距離猜的 mode」去配 icon,否則會
// 出現「呼叫端指定開車、卻顯示步行 icon」這種不一致。
func iconForTransitMode(mode string) string {
	switch mode {
	case "開車":
		return "🚗"
	case "公車":
		return "🚌"
	case "捷運":
		return "🚇"
	case "大眾運輸":
		return "🚌"
	default:
		return "🚶"
	}
}

// transitEstimateResponse 是 GET /internal/geo/plan-ai/transit-estimate 的回應
// 形狀——對齊前端 PlanNodeData 的 transit 節點既有欄位(icon/mode/
// minutes/distance,見 planTimeline.ts 的完整說明),呼叫端可以直接把
// 這支端點的回應塞進 transit 節點的資料,不需要額外轉換欄位名稱。
type transitEstimateResponse struct {
	Mode     string `json:"mode"`
	Icon     string `json:"icon"`
	Minutes  int    `json:"minutes"`
	Distance string `json:"distance"`
}

// formatTransitDistance 把公尺數轉成跟模擬腳本(plan-ai-sim 分支的 plan_sim_demo.go)
// 一致的顯示格式——小於 1 公里顯示整數公尺(如「650m」),否則顯示到小數
// 點後一位公里數(如「6.2km」)。
func formatTransitDistance(meters float64) string {
	if meters < 1000 {
		return strconv.Itoa(int(math.Round(meters))) + "m"
	}
	return strconv.FormatFloat(meters/1000, 'f', 1, 64) + "km"
}

// transitEstimateMinDelay/transitEstimateMaxDelay:2026-09 使用者明確
// 要求「路程推估的後端做一點延遲」——目前這支端點是純本地計算(見下方
// 完整說明),回應幾乎是瞬間完成,兩張卡片(新站點本身、緊接著補上的
// 交通卡)在畫面上幾乎同時出現,體感上不像真的在查詢外部資料。加上
// 隨機延遲,模擬真實 API 呼叫的網路往返時間,讓交通卡片的出現節奏更
// 接近之後真的接上 Google Directions/Routes API 時的體驗。原本是
// 300~600ms,使用者後續要求「延遲時間再加長」,改成 800~1500ms——
// 讓查詢正在發生這件事更明顯可感,但不至於讓使用者覺得卡住。
const (
	transitEstimateMinDelay = 800 * time.Millisecond
	transitEstimateMaxDelay = 1500 * time.Millisecond
)

// GET /internal/geo/plan-ai/transit-estimate?fromLat=&fromLng=&toLat=&toLng=&mode=
//
// 兩點間交通方式/時間/距離的模擬預估(需登入)——2026-09 使用者明確
// 要求「交通預估時間不要讓 AI 推論產生,而是建立兩個點時,前端自己將
// 兩點送到後端,由後端預估時間,先建立模擬預估時間的後端,用假資料,
// 移除後端 llm 產生的預估時間信號」:LLM/推論路徑完全不會、也不應該
// 知道這支端點的存在或自己算出交通時間,交通卡片的時間資訊 100% 由
// 前端在插入第二個站點後主動呼叫這裡取得(見 AIPlanTimelinePage.tsx
// insertAttractionAfter 的完整說明——插入 stop 節點且前面已有另一個
// stop 節點時,前端自動呼叫這支端點補上一張 transit 卡片)。
//
// mode 為選填查詢參數——未提供或提供無法辨識的值時,依 estimateTransitMode
// 依直線距離自動挑一個看起來合理的預設值,不會回錯誤(呼叫端不需要
// 保證一定要送對交通方式才能拿到結果)。
//
// 核心計算是純本地(haversine 直線距離 + 固定速度換算表,見上方幾個
// 常數的完整說明),不含任何外部 API 呼叫,故不需要任何限流保護——這是
// 刻意的過渡態:先把「前端建立站點後自動查交通時間」這條資料流打通、
// 驗證行為正確,之後要接上真實的路網 API(Google Directions/Routes 等)
// 時,只需要替換這支函式內部的計算方式,呼叫端的請求/回應形狀不需要
// 跟著改動。故意加的 transitEstimateMinDelay~transitEstimateMaxDelay
// 隨機延遲(見上方常數的完整說明)只影響回應節奏,不影響計算結果本身。
func (s *Server) handlePublicGeoTransitEstimate(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	fromLat, err := strconv.ParseFloat(q.Get("fromLat"), 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", "fromLat 查詢參數缺失或格式錯誤")
		return
	}
	fromLng, err := strconv.ParseFloat(q.Get("fromLng"), 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", "fromLng 查詢參數缺失或格式錯誤")
		return
	}
	toLat, err := strconv.ParseFloat(q.Get("toLat"), 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", "toLat 查詢參數缺失或格式錯誤")
		return
	}
	toLng, err := strconv.ParseFloat(q.Get("toLng"), 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", "toLng 查詢參數缺失或格式錯誤")
		return
	}

	// 延遲放在參數驗證通過之後——無效請求應該立即回錯誤,不需要陪著
	// 使用者等一段沒有意義的延遲。用 select 而非單純 time.Sleep,讓
	// 使用者提早關閉頁面/取消請求時(r.Context() 被取消)能立刻中止,
	// 不會讓這個 goroutine 白白占著資源等完整個延遲時間。
	delay := transitEstimateMinDelay + time.Duration(rand.Int63n(int64(transitEstimateMaxDelay-transitEstimateMinDelay)))
	select {
	case <-time.After(delay):
	case <-r.Context().Done():
		return
	}

	meters := haversineMeters(fromLat, fromLng, toLat, toLng)
	mode := q.Get("mode")
	if mode == "" {
		mode = estimateTransitMode(meters)
	}
	icon := iconForTransitMode(mode)
	minutes := int(math.Round(meters / metersPerMinuteFor(mode)))
	if minutes < 1 {
		minutes = 1
	}

	writeJSON(w, http.StatusOK, transitEstimateResponse{
		Mode:     mode,
		Icon:     icon,
		Minutes:  minutes,
		Distance: formatTransitDistance(meters),
	})
}

// GET /internal/geo/plan-ai/place-details-any?placeId={Google Place ID}
//
// 地點詳情查詢(需登入)——不受 handlePublicGeoPlaceDetails 那套「必須
// 是已建檔 attraction」授權限制(見該函式的完整說明:那支端點是為固定
// 展示頁(散策羅盤等)已知的一批景點設計的),供 /plan-ai(AIPlanTimelinePage.tsx
// 的 add_attraction
// 工具,見 attractionTools.ts 的完整說明)查詢任意 placeID 的名稱/地址/
// 座標/簡介——因為 search_attraction 現在可以查任意地名(見
// handlePublicGeoPlaceSearch),對應的 add_attraction 自然也需要能查
// 任意 placeID,不能被限制在一份固定清單內。
//
// 使用者明確要求「add_attraction 不用送太多資訊,placeId 跟時間就可以,
// 其他資訊由前端再做查詢」——這支端點就是那個「前端再做查詢」的後端
// 支撐:LLM 只需要記住 search_attraction 回傳過的 placeId,不需要把
// name/lat/lng/summary 這些欄位原封不動複製貼回 add_attraction 呼叫,
// 避免座標抄錯或摘要被截斷這類資料重複導致的錯誤(見這次修正前的真實
// log:同一批資料在兩次工具呼叫之間被完整複製一次)。
//
// 2026-09:優先查 attractions 表(見 store.GetAttractionByPlaceID 的完整
// 說明)——已經人工建檔過的地點(place_id 命中,例如赤崁樓這類固定示範
// 點)直接回傳既有的 Name/Summary/PhotoURL,完全不打 Google,不消耗
// Google Places 配額、也不受 defaultRateLimiter 的全域限流影響。查無
// 建檔紀錄時才 fallback 到真的呼叫 client.GetPlaceDetails(對應既有的
// "places.get" Google API endpoint)——這是 search_attraction 可以查
// 任意地名的必然結果,不可能所有使用者臨時提到的地點都事先建檔,這條
// fallback 路徑因此自然受惠於既有的 defaultRateLimiter(見
// geo.RateLimitConfig 的完整說明,cmd/server/main.go 預設 10 秒視窗內
// 最多 1 次),不需要像 planAiRateLimiter 的另外兩個 key 那樣額外設定
// ——這裡刻意跟正式登入使用者點地圖 POI(handleGeoPlaceDetails)共用
// 同一份全域限流額度,是經過評估的簡化取捨:/plan-ai 目前只是展示頁、
// 流量規模小,共用額度的實務影響有限,不需要為了完全隔離兩者的呼叫
// 來源而增加一個新的限流維度,日後若流量真的變大導致互相排擠,再評估
// 是否要在 planAiRateLimiter 上用 SetLimitForKey 為這支端點加一組
// 獨立的 key/視窗。
//
// 兩條路徑回應形狀刻意對齊(found/name/address/lat/lng/summary/
// photoUrl)——attractions 表命中時額外帶上 photoUrl(建檔時存的真實
// 照片,見 model.Attraction.PhotoURL 的完整說明)。
//
// 2026-10(使用者明確要求「AI 規劃版採用一樣的補圖,前端也用一樣的
// 重試機制」):兩條分支都改成套用跟 handleGeoPlaceDetails 完全一致的
// 漸進補圖機制(點擊節奏 OR 7 天時間觸發,見該函式與
// shouldAddGooglePlacePhoto/decidePlacePhotoAction 的完整說明),不再是
// 原本「只唯讀 photo_assets、從不主動補圖」的設計。這是刻意的取捨,
// 使用者已確認接受以下三個隨之而來的行為改變,實作前逐一記錄避免之後
// 誤以為是疏漏:
//  1. 已建檔 attraction 分支原本完全不打 Google(零成本),套用後會
//     跟 Google fallback 分支一樣開始打 Google Photo Media——不再是
//     零成本設計。
//  2. 這裡的 click_count 遞增跟地圖版(handleGeoPlaceDetails)共用
//     同一張 place_details_cache 表、同一把 place_id key,兩邊的點擊
//     次數會混在一起累加,不是獨立計數。
//  3. Google Photo Media 的每日配額(見 cmd/server/main.go 的
//     defaultRateLimiter 設定)跟地圖版共用同一份全域額度,不分開——
//     AI 規劃透過對話可能比地圖版使用者更密集地觸發新地點補圖。
//
// attractions 表命中分支原本沒有 place_details_cache 快取列(這條分支
// 過去完全繞過快取機制),要套用漸進補圖必須先補上這一步:用
// attraction 現有的 Name/CityName/Lat/Lng/Summary 呼叫
// SetCachedPlaceDetails 確保列存在(該函式對已存在的列只更新文字欄位,
// 完全不動 click_count/google_photo_target_count/new_photo_count 三個
// 漸進補圖狀態欄位,見該函式的完整說明,新插入時這三欄交由資料庫
// DEFAULT 決定初始值,GooglePhotoTargetCount 的 DEFAULT 是 sentinel -1)
// ——之後就能比照快取命中分支的判斷邏輯(IncrementPlaceClickCount +
// shouldAddGooglePlacePhoto + 7 天時間)決定要不要觸發
// refreshGooglePlacePhotoInBackground。
func (s *Server) handlePublicGeoPlaceDetailsAny(w http.ResponseWriter, r *http.Request) {
	placeID := r.URL.Query().Get("placeId")
	if placeID == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 placeId 查詢參數")
		return
	}

	if a, err := s.store.GetAttractionByPlaceID(placeID); err == nil {
		resp := map[string]any{
			"found":   true,
			"name":    a.Name,
			"address": a.CityName,
			"lat":     a.Lat,
			"lng":     a.Lng,
			// attractionId:2026-09 使用者明確要求「place-details-any
			// 查詢如果有 attraction 時要一併附上 attraction」——命中
			// 資料庫 attraction 記錄時額外帶上它的資料庫 id,讓呼叫端
			// 知道這個 placeId 對應到哪一筆已建檔景點(例如之後需要
			// 額外顯示分類/主題點狀態等 attraction 專屬資訊時,不需要
			// 再另外用 placeId 反查一次)。Google fallback 路徑(下方)
			// 沒有對應的資料庫紀錄,不帶這個欄位。
			"attractionId": a.ID,
		}
		var summaryPtr *string
		if a.Summary != nil {
			resp["summary"] = *a.Summary
			summaryPtr = a.Summary
		}

		// 見本函式開頭的完整說明:先確保 place_details_cache 有這個
		// place_id 的列,才能讓 IncrementPlaceClickCount 正確累加(否則
		// UPDATE 對不存在的列不生效,永遠拿到零值,見該函式的完整說明)。
		//
		// 2026-10 code review 發現:這裡原本用 `_ =` 完全捨棄錯誤,寫入
		// 失敗時下面的 GetCachedPlaceDetails 會因為列不存在/未更新而
		// 回傳 ok=false,整段點擊/時間觸發的補圖判斷會被靜默跳過,且
		// 沒有任何記錄可供排查——下次查詢若寫入成功會自動恢復,但若某個
		// place_id 持續寫入失敗,會在不知情的狀況下長時間拿不到第一張
		// Google 照片。補上失敗時的記錄,對齊同檔案
		// refreshGooglePlacePhotoInBackground 等既有背景作業的記錄慣例
		// (log.Printf("函式名: 動作 失敗 place_id=...: %v", ...)),
		// 仍然不中斷請求本身——這張快取列寫入失敗不影響這次回應內容
		// (name/summary/lat/lng 已經從 attraction 表直接取得),只是這次
		// 不會觸發背景補圖判斷。
		if err := s.store.SetCachedPlaceDetails(placeID, a.Name, a.CityName, a.Lat, a.Lng, 0, summaryPtr); err != nil {
			log.Printf("handlePublicGeoPlaceDetailsAny: SetCachedPlaceDetails 失敗 place_id=%s: %v", placeID, err)
		}

		if cached, ok, cErr := s.store.GetCachedPlaceDetails(placeID, placeDetailsRowExistenceMaxAge); cErr == nil && ok {
			clickCount, newPhotoCount, previousGoogleTarget, clickErr := s.store.IncrementPlaceClickCount(placeID)
			clickTriggered := clickErr == nil && shouldAddGooglePlacePhoto(clickCount, newPhotoCount, previousGoogleTarget)
			timeTriggered := time.Since(cached.FetchedAt) > placeDetailsTargetRecheckMaxAge
			if clickErr == nil && (clickTriggered || timeTriggered) {
				s.refreshGooglePlacePhotoInBackground(placeID, r.URL.Path, clickCount, newPhotoCount, previousGoogleTarget)
			}
		}

		// 最終顯示的照片一律由 photo_assets 目前的內容決定(見
		// store.ListFreshPhotoAssetURLsForPlace/photoAssetRow 的完整說明)
		// ——查無仍在有效期內的紀錄就不帶 photoUrl,不回退 google_place_
		// photos/attraction.PhotoURL 等舊來源。上面觸發的背景補圖(若有)
		// 不會反映在這次回應,要等下一次查詢才看得到,理由同
		// handleGeoPlaceDetails 快取命中分支的完整說明。
		//
		// 2026-10 補上 googlePhotoUrls:使用者明確要求「ai plan 景點的
		// 照片比照景點介紹卡照片可以多張瀏覽」——地圖版的 PhotoCarousel
		// 元件本來就支援多圖,只是這個端點過去只組單張 photoUrl,前端
		// 即使接上輪播也永遠只會拿到一張圖。改用
		// ListFreshPhotoAssetURLsForPlace 查出同一批 photo_assets 紀錄的
		// 完整清單(跟 applyPhotoAssetsAsSource 用的是同一份資料來源),
		// photoUrl 維持等於清單第一張,向後相容只讀 photoUrl 的舊呼叫端。
		if photoURLs, pErr := s.store.ListFreshPhotoAssetURLsForPlace(placeID); pErr == nil && len(photoURLs) > 0 {
			resp["photoUrl"] = photoURLs[0]
			resp["googlePhotoUrls"] = photoURLs
		}
		writeJSON(w, http.StatusOK, resp)
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		writeErr(w, http.StatusInternalServerError, "internal_error", "查詢景點資料失敗")
		return
	}

	// Google fallback 分支:直接重用 fetchAndCachePlaceDetails(見該函式
	// 的完整說明)——這支函式本來就是 handleGeoPlaceDetails 快取未命中
	// 時呼叫的核心邏輯,完整包含 SetCachedPlaceDetails 寫入快取列、
	// IncrementPlaceClickCount、decidePlacePhotoAction 決定是否補圖、
	// downloadGooglePlacePhotoInBackground 背景下載,跟地圖版的行為
	// 完全一致,不需要在這裡重新实作一份。
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	resp, err := s.fetchAndCachePlaceDetails(ctx, r.URL.Path, placeID)
	if errors.Is(err, geo.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"found": false})
		return
	}
	if errors.Is(err, apigateway.ErrRateLimited) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited", "查詢過於頻繁,請稍後再試")
		return
	}
	if err != nil {
		writeErr(w, http.StatusBadGateway, "place_details_failed", err.Error())
		return
	}

	out := map[string]any{
		"found":   true,
		"name":    resp.Name,
		"address": resp.Address,
		"lat":     resp.Lat,
		"lng":     resp.Lng,
		"summary": resp.Summary,
	}
	// 跟其餘分支一致的慣例:查無照片就完全不帶這個 key,不是帶一個空
	// 字串——呼叫端(TripPlanPage.tsx)用 `details.photoUrl` 是否存在
	// 判斷要不要顯示圖片,空字串跟缺少這個 key 在 JS 的 truthy 判斷上
	// 行為相同,但維持「沒有就不帶」的一致慣例,避免跟 map 序列化後的
	// JSON 欄位存在與否產生混淆。resp 已經由 fetchAndCachePlaceDetails
	// 內部呼叫 applyPhotoAssetsAsSource 設好 GooglePhotoURLs(理由同上面
	// attraction 命中分支新增 googlePhotoUrls 的完整說明),這裡原樣帶出
	// 即可,不需要重新查一次 photo_assets。
	if resp.PhotoURL != "" {
		out["photoUrl"] = resp.PhotoURL
	}
	if len(resp.GooglePhotoURLs) > 0 {
		out["googlePhotoUrls"] = resp.GooglePhotoURLs
	}
	writeJSON(w, http.StatusOK, out)
}

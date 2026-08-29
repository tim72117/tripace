package api

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"
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

// photoCandidate 是「查完地點清單後,要不要幫這筆結果附加照片」這個下游
// 共用步驟(見 fetchPhotosForCandidates)的中介輸入型別——geo.Place(Text
// Search)與 geo.NearbyPlace(Nearby Search)欄位不完全相同(見兩者各自的
// 完整說明),但這段照片查詢邏輯只需要 Name/PlaceID/PhotoRef 三個欄位就能
// 執行,故收斂成這個共同形狀,呼叫端各自把自己的型別轉成這個中介形式
// 再傳入,不需要為了共用這段邏輯而強迫兩個查詢結果型別本身趨同。
type photoCandidate struct {
	Name     string
	PlaceID  string
	PhotoRef string
}

// fetchPhotosForCandidates 是 handleGeoPlacesNearby 原本內嵌的照片查詢邏輯
// 抽出來的共用函式,供 handleGeoPlacesNearby 與 handleGeoGeocode 共用——
// 兩支端點都是「查完一批候選地點後,只想幫前幾筆附加照片」的形狀,邏輯
// 本身原封不動(先試 Pexels,查無結果才 fallback Google Places 真實照片,
// 兩者皆落地存 GCS),只是換了呼叫介面。
//
// 只有前 maxResults 筆會被查詢/填上 PhotoURL,其餘維持空字串——理由見
// maxPhotoResults 的說明:逐筆下載照片是序列執行、無平行處理,是耗時的
// 主要來源,故從候選清單一開始就截斷要查照片的筆數(不影響候選清單本身
// 的筆數,只影響其中幾筆有圖)。單筆查詢失敗不影響其餘候選,也不視為
// 整體失敗——理由同呼叫端既有的降級慣例。
//
// 回傳值是一個 map[候選在輸入 slice 中的 index]photoURL,只包含成功查到
// 照片的筆數;呼叫端依自己的候選型別 index 對照回去、寫入各自回應型別的
// PhotoURL 欄位,避免這支函式需要認識呼叫端的回應型別。
//
// 2026-08 起,handleGeoPlacesNearby/handleGeoGeocode 已經改成呼叫
// warmPlaceDetailsPhotoCache(背景執行、不等待),不再同步呼叫這支函式
// 組回應——這支函式目前保留給還需要同步取得 PhotoURL 才能組回應的呼叫端
// (例如 fetchNearbyHotels 內嵌的同一套邏輯雖然沒有直接呼叫這支函式,但
// 形狀相同,見該函式的說明)。若之後這支函式完全沒有呼叫端了,可以考慮
// 一併移除。
func (s *Server) fetchPhotosForCandidates(ctx context.Context, candidates []photoCandidate, maxResults int, client *geo.Client) map[int]string {
	photoURLs := make(map[int]string)
	limit := len(candidates)
	if limit > maxResults {
		limit = maxResults
	}
	for i := 0; i < limit; i++ {
		c := candidates[i]
		var photoURL string
		// 照片來源優先序:先試 Pexels(落地 GCS),查無結果才 fallback
		// Google——理由見 maxPhotoResults 附近既有呼叫端的說明。
		if client.PexelsClient() != nil {
			if photo, ok, pErr := client.PexelsClient().Search(ctx, c.Name); pErr == nil && ok {
				photoURL = s.landmarkPhotoURL(ctx, c.PlaceID, photo.ImageURL)
			}
		}
		if photoURL == "" && c.PhotoRef != "" {
			if dataURI, pErr := client.PhotoDataURI(ctx, c.PlaceID, c.PhotoRef, 200); pErr == nil {
				photoURL = s.landmarkPhotoURLFromDataURI(ctx, c.PlaceID, dataURI)
			}
		}
		if photoURL != "" {
			photoURLs[i] = photoURL
		}
	}
	return photoURLs
}

// backgroundPhotoWarmTimeout 是 warmPlaceDetailsPhotoCache 背景 goroutine
// 的逾時上限——刻意獨立於觸發它的 HTTP request 的生命週期(見該函式的
// 說明,handler 一旦寫出回應就會返回,r.Context() 會跟著被取消),用
// context.Background() 搭配這個固定逾時,避免背景查詢在某個外部 API
// 掛住時無限期卡住 goroutine、累積資源。30 秒比一般同步查詢的逾時
// (10 秒)寬鬆,因為背景執行不再有使用者等待中的時間壓力,只要不無限期
// 卡住即可。
const backgroundPhotoWarmTimeout = 30 * time.Second

// warmPlaceDetailsPhotoCache 在背景 goroutine 裡查詢候選地點的照片
// (Pexels-first、查無才 fallback Google,同 fetchPhotosForCandidates 的
// 邏輯與 maxResults 截斷規則),查到後寫入 place_details_cache(見
// store.SetCachedPlaceDetails)——目的是預熱快取:前端不使用
// handleGeoPlacesNearby/handleGeoGeocode 回應裡的 photoUrl 欄位(改走
// fetchGeoPlacePhoto 的 photoOnly=1 延遲查詢,見 handleGeoPlaceDetails
// 對 photoOnly 分支的說明),但那條延遲查詢本身是以 placeID 為 key 查
// place_details_cache,快取命中就完全不必再打 Pexels/Google 一次。這支
// 函式讓「使用者稍後真的捲到/點開這個地點」時,大機率已經有現成的快取
// 可用,不需要重新等一次第三方 API。
//
// 呼叫端(handleGeoPlacesNearby/handleGeoGeocode)必須用
// `go s.warmPlaceDetailsPhotoCache(...)` 呼叫,不等待這支函式返回——
// handler 應該在呼叫後立即組裝「無圖」的回應並寫出,不阻塞在這裡等查詢
// 完成,這是這次背景化重構的核心目的。
//
// Context 生命週期:呼叫端必須傳入一個獨立於 r.Context() 的
// context(例如 context.Background()),因為 net/http 會在 handler
// function 返回、回應寫出去之後就取消 r.Context()——這支函式執行時
// handler 已經返回,若沿用 r.Context() 會導致查詢立刻被中斷。這支函式
// 內部另外用 backgroundPhotoWarmTimeout 包一層逾時,確保就算呼叫端真的
// 傳了 context.Background(),也不會無限期執行。
//
// Panic 防護:背景 goroutine 若 panic 且沒有 recover,會直接讓整個
// process 崩潰(不像同步呼叫的 error 可以直接 return 給呼叫端處理)——
// 這支函式最上層用 defer+recover 攔截任何 panic,只記錄、不重新拋出,
// 理由同這個檔案其餘地方「查詢失敗不視為致命錯誤」的一貫慣例:背景照片
// 預熱查詢失敗頂多讓快取沒有預熱到,使用者稍後還是能透過既有的
// fetchGeoPlacePhoto 即時查詢補上,不影響任何人正在等待的回應。
//
// 並行安全:candidates 是呼叫端在呼叫當下就已經組好、傳值進來的獨立
// slice(不是共用的迴圈變數閉包,呼叫端遵循 Go 1.22+ 的每次迭代獨立變數
// 語意,不會有多個 goroutine 共用同一個迴圈變數的經典陷阱——這個專案的
// go.mod 已經是 go 1.26.3);client/store/photoUploader 底層都是連線池化
// 或無共享可變狀態的物件(*gorm.DB、GCS *storage.Client),多個背景
// goroutine 同時呼叫是安全的(見呼叫端各自的說明)。
func (s *Server) warmPlaceDetailsPhotoCache(candidates []photoCandidate, maxResults int, apiKey string) {
	defer func() {
		if rec := recover(); rec != nil {
			// 背景 goroutine 沒有任何管道能把這個 panic 回報給正在等待的
			// HTTP 呼叫端(回應早就已經送出了)——只能靜默記錄,不重新
			// 拋出,避免整個 process 崩潰。
			fmt.Printf("warmPlaceDetailsPhotoCache panic: %v\n", rec)
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), backgroundPhotoWarmTimeout)
	defer cancel()
	ctx = geo.WithCaller(ctx, "warmPlaceDetailsPhotoCache")

	// 這支函式自己建立獨立的 geo.Client/pexels.Client,不沿用呼叫端
	// handler 裡已經建立的那個——理由不是並行安全疑慮(client 本身無
	// 共享可變狀態,見上方並行安全說明),而是避免耦合呼叫端 client 的
	// 生命週期(呼叫端的 ctx 在 handler 返回後就失效,但 client 值本身
	// 沒有綁定 ctx,理論上沿用也不會出錯;這裡仍選擇重新建立,讓這支
	// 函式的輸入介面單純只依賴 apiKey 字串,不需要呼叫端多傳一個
	// *geo.Client 參數,呼叫端程式碼也更清楚「背景查詢是完全獨立的一次
	// 查詢」)。
	client := geo.New(apiKey)
	client.SetCache(s.photoCache)
	client.SetPexelsClient(pexels.New(os.Getenv("PEXELS_API_KEY")))

	limit := len(candidates)
	if limit > maxResults {
		limit = maxResults
	}
	for i := 0; i < limit; i++ {
		c := candidates[i]
		if c.PlaceID == "" {
			// 沒有 PlaceID 就沒有快取鍵可寫,略過——理論上 Text
			// Search/Nearby Search 每筆結果都會有 id,這裡保守處理。
			continue
		}
		var photoURL string
		if client.PexelsClient() != nil {
			if photo, ok, pErr := client.PexelsClient().Search(ctx, c.Name); pErr == nil && ok {
				photoURL = s.landmarkPhotoURL(ctx, c.PlaceID, photo.ImageURL)
			}
		}
		if photoURL == "" && c.PhotoRef != "" {
			if dataURI, pErr := client.PhotoDataURI(ctx, c.PlaceID, c.PhotoRef, 200); pErr == nil {
				photoURL = s.landmarkPhotoURLFromDataURI(ctx, c.PlaceID, dataURI)
			}
		}
		if photoURL == "" {
			// 沒查到照片,沒有任何欄位需要寫回快取——理由同
			// fetchPhotosForCandidates 既有慣例,查無照片不視為錯誤,
			// 單純略過,不佔用一筆殘缺的快取列。
			continue
		}
		s.mergePhotoURLIntoPlaceDetailsCache(c.PlaceID, c.Name, photoURL)
	}
}

// mergePhotoURLIntoPlaceDetailsCache 把背景查到的 photoURL 安全地寫入
// place_details_cache,不覆蓋既有更完整的資料——store.SetCachedPlaceDetails
// 是整列覆寫的 upsert(GORM Save,依 place_id 主鍵覆蓋整列,不是部分欄位
// 更新,見該函式的說明),若這裡直接呼叫 SetCachedPlaceDetails 且傳入
// rating=0、summary=nil,會把「使用者稍早已經點開過這個地點、快取裡已經
// 有的 rating/summary」整個覆蓋掉、造成資料倒退。
//
// 策略:先讀一次既有快取(不管新鮮/過期,只要列存在就代表曾經查過完整
// 資料)——
//   - 若已存在,保留原本的 name/address/lat/lng/rating/summary,只把
//     photoURL 換成這次查到的(除非既有快取本身已經有 photoURL,那就
//     不需要再覆寫,直接跳過,理由同下方說明)。
//   - 若不存在,才寫入這批只有 name/placeID + photoURL 的部分資料——
//     address/lat/lng/rating/summary 這些背景查詢當下沒有的欄位,比照
//     handleGeoPlaceDetails 裡 photoOnly/textOnly 模式「欄位不全時不寫入
//     完整快取列」的既有慣例(見該函式對 photoOnly 分支的說明:「不寫入
//     place_details_cache——這個模式下沒有 address/rating/summary 等
//     完整資料,寫入會讓快取列殘缺不全」)。但這裡的目的（預熱
//     photoOnly 查詢的快取命中）恰好只需要 photoURL 就夠——
//     handleGeoPlaceDetails 的 GetCachedPlaceDetails 命中判斷只要求
//     ok=true(列存在且未過期),不要求其他欄位非空;photoOnly 分支只讀
//     cached.PhotoURL,並不理會 rating/summary 是否為空。故這裡寫入
//     address=""/lat=0/lng=0/rating=0/summary=nil 的部分資料列,不會讓
//     photoOnly 這條路徑的行為出錯,只是這筆快取列本身還不夠完整、不能
//     拿來滿足 textOnly 或一般模式的查詢——那兩種模式仍會照常重新查
//     Google 補齊完整資料,並在查完後用完整資料重新覆寫這一列(見
//     handleGeoPlaceDetails 主流程結尾的 SetCachedPlaceDetails 呼叫),
//     不會有資料一直卡在殘缺狀態。
//
// 這支函式內的「先讀後寫」仍有理論上的 TOCTOU 競態(讀跟寫之間沒有
// transaction 包住,見 store.GetCachedPlaceDetails/SetCachedPlaceDetails
// 的說明)——例如兩個背景 goroutine 同時對同一個 placeID 讀到「尚未
// 存在」,然後都各自寫入,最後一次寫入的會生效,但兩者寫的都是同樣只有
// name+photoURL 的部分資料,不會造成資料遺失(不是「一個寫完整、一個寫
// 殘缺,殘缺的蓋掉完整的」這種情況)。真正需要避免的是「新查到的殘缺
// 資料蓋掉舊的完整資料」,這支函式已經用讀取既有快取來防範。
func (s *Server) mergePhotoURLIntoPlaceDetailsCache(placeID, name, photoURL string) {
	name, address, lat, lng, rating := name, "", 0.0, 0.0, 0.0
	var summary *string

	// maxAge 傳 0 只是為了「找出這一列是否存在」,新鮮度判斷交給真正
	// 使用這筆快取的呼叫端(handleGeoPlaceDetails)自己的 maxAge 決定——
	// 這裡只是要決定寫入策略(保留既有欄位 vs 寫入部分資料),跟這筆快取
	// 本身算不算「新鮮」無關,即使既有快取已經過期,它裡面的
	// rating/summary 仍然是比空值更有參考價值的資料,不應該因為過期就
	// 被空值蓋掉。
	if cached, ok, err := s.store.GetCachedPlaceDetails(placeID, 0); err == nil && ok {
		if cached.PhotoURL != nil && *cached.PhotoURL != "" {
			// 既有快取已經有照片了,不需要再覆寫——理由同
			// handleGeoPlaceDetails 快取命中分支「命中但沒查到照片才
			// 補查」的既有邏輯,對稱地,這裡「已經有照片就不用補」。
			return
		}
		name = cached.Name
		address = cached.Address
		lat = cached.Lat
		lng = cached.Lng
		rating = cached.Rating
		summary = cached.Summary
	}

	photoURLCopy := photoURL
	_ = s.store.SetCachedPlaceDetails(placeID, name, address, lat, lng, rating, summary, &photoURLCopy)
}

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

// geoGeocodeDefaultRestrictRadiusMeters 是 mode=restrict 且未帶 radius
// 參數時的預設矩形半徑——對齊地圖上方類別標籤原本查詢附近地點的既有
// 預設值(1500m),類別標籤/搜尋這個區域都是「使用者明確操作觸發、查詢
// 範圍通常不需要很大」的情境,理由與原本一致;bias 模式進入第二階段
// (多筆候選、改用 locationRestriction 收斂)時也沿用同一個預設值。
const geoGeocodeDefaultRestrictRadiusMeters = 1500.0

// geoGeocodeCandidateResponse 是 handleGeoGeocode 回應裡單筆候選地點的
// 格式——原本用 map[string]any 手動組,新增 photoUrl 欄位後改成強型別
// struct 較不容易漏欄位/打錯 key。
//
// PhotoURL:2026-08 起這支端點不再同步查照片(見 handleGeoGeocode 內
// warmPlaceDetailsPhotoCache 的呼叫說明),這個欄位一律留空(json
// omitempty 讓它直接不出現在回應裡)——保留欄位本身不移除,因為前端
// GeoGeocodeCandidate.photoUrl 目前仍是型別定義的一部分(即使實際上永遠
// 收到空值),前端的照片顯示已經完全改走 fetchGeoPlacePhoto 對 PlaceID
// 的延遲查詢,不依賴這個欄位。
type geoGeocodeCandidateResponse struct {
	Name     string  `json:"name"`
	Address  string  `json:"address"`
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	PlaceID  string  `json:"placeId,omitempty"`
	PhotoURL string  `json:"photoUrl,omitempty"`
}

// geoGeocodeCandidateResponses 把 geo.Search 的結果轉成
// geoGeocodeCandidateResponse 清單,並用 go 關鍵字背景預熱前
// maxPhotoResults 筆的照片快取(見 warmPlaceDetailsPhotoCache 的完整
// 說明)——handleGeoGeocode 兩階段查詢的三個回傳點(bias 命中 1 筆、
// bias 查無、restriction 收斂後的最終結果)都要做同一組「轉回應格式 +
// 背景預熱照片」收尾動作,抽成這支函式避免三處各寫一份。
func (s *Server) geoGeocodeCandidateResponses(places []geo.Place, apiKey string) []geoGeocodeCandidateResponse {
	// 照片處理改成背景執行、不阻塞這支端點的回應(見
	// warmPlaceDetailsPhotoCache 的完整說明)——只取前 maxPhotoResults 筆
	// 查照片,其餘候選不查,理由同該常數的說明。這支端點的回應本身不再
	// 帶 photoUrl(前端改走 fetchGeoPlacePhoto 對 placeId 的延遲查詢,見
	// geoGeocodeCandidateResponse.PhotoURL 欄位的說明),背景查詢的價值
	// 是預熱 place_details_cache,讓那條延遲查詢大機率能直接命中快取、
	// 不必重新打 Pexels/Google。用 go 關鍵字呼叫、不等待,呼叫時傳入的
	// photoCandidates 是這裡新配置的獨立 slice(不是共用的迴圈變數),
	// apiKey 是字串值,goroutine 內部完全不依賴這支 handler 的
	// r.Context()/ctx(那個 ctx 會在這個 handler 返回後被取消,見
	// warmPlaceDetailsPhotoCache 的 Context 生命週期說明)。
	photoCandidates := make([]photoCandidate, len(places))
	for i, p := range places {
		photoCandidates[i] = photoCandidate{Name: p.Name, PlaceID: p.PlaceID, PhotoRef: p.PhotoRef}
	}
	go s.warmPlaceDetailsPhotoCache(photoCandidates, maxPhotoResults, apiKey)

	// placeId:供前端(GeoOutlinePanel.tsx 的 handleGeocodeCandidateSelect)
	// 拿去換發 GET /internal/geo/place-details,取得完整資訊(含照片,
	// Pexels-first + GCS 落地,跟點地圖上原生 POI 完全同一套流程),不再
	// 只是純定位用的座標——見 geo.Client.Search 的 fieldMask 說明,這裡
	// 選擇性帶出(理論上 Text Search 每筆結果都會有 id,查無則省略此欄位,
	// 前端據此判斷是否要走這條補查流程)。
	// PhotoURL 這裡一律留空——照片查詢已經改成上面的背景預熱(見
	// warmPlaceDetailsPhotoCache 的說明),不再同步查完才組這筆回應。
	// 保留 PhotoURL 欄位本身(不整個移除)是因為 geoGeocodeCandidateResponse
	// 是強型別 struct、且前端 GeoGeocodeCandidate.photoUrl 目前仍是「快取
	// 未命中時的即時預覽」這個既有語意的一部分(見該欄位的說明)——只是
	// 這裡不再有值可填,故乾脆不寫入這個欄位,讓它保持 struct 零值(空
	// 字串),json:"photoUrl,omitempty" 讓它在回應裡直接不出現。
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

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := s.newGeoGeocodeClient(apiKey)
	client.SetCache(s.photoCache)
	client.SetPexelsClient(pexels.New(os.Getenv("PEXELS_API_KEY")))

	// 逾時原本是 5 秒(純文字查詢,不含照片處理),後來因為曾經同步處理
	// 照片查詢拉長到 10 秒。2026-08 起照片查詢已經改成背景執行(見
	// warmPlaceDetailsPhotoCache 的呼叫),不再計入這支 handler 本身回應
	// 的耗時,但仍維持 10 秒——這個逾時現在保護 client.Search 最多兩次
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
			"candidates": s.geoGeocodeCandidateResponses(places, apiKey),
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
			"candidates": s.geoGeocodeCandidateResponses(places, apiKey),
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
		"candidates": s.geoGeocodeCandidateResponses(restrictedPlaces, apiKey),
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
//     internal/wanttools/recommend_nearby.go 的既有 BackendDispatch 模式
//     ——LLM 決定要幫使用者查「這附近有什麼飯店」時,直接呼叫這支端點
//     形狀的邏輯最直覺,不需要重新設計參數)。若之後要接上,可以比照
//     geocode.go 的寫法,在 internal/onagenttools 新增一個獨立的
//     dispatch handler,內部呼叫這支端點背後同一組 s.fetchNearbyHotels/
//     listAttractionResponses,不需要更動這支 HTTP 端點本身。
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

// handleGeoPlacesNearby(GET /internal/geo/places/nearby)、其專屬的
// placeResponse/classifyPlaceCategory/allowedPlaceTypes 已於 2026-08
// 隨「地圖三個查地點入口統一改走 handleGeoGeocode」這次改動一併移除——
// 地圖上方類別標籤(景點/飯店/餐廳)原本是這支端點(client.SearchNearby,
// Nearby Search)唯一的前端呼叫端,改走 handleGeoGeocode(mode=restrict,
// Text Search)後,已確認 grep 全專案不再有任何呼叫端使用這支端點/前端
// fetchGeoPlacesNearby,故視為死代碼一併清理(見 CHANGELOG)。
// client.SearchNearby 本身不受影響、繼續保留——fetchNearbyHotels(供
// handleGeoAttractionsNearby/handleGeoAttractions 使用)與
// internal/wanttools、internal/onagenttools 的 recommend_nearby LLM 工具
// 仍是這個函式現存的呼叫端。

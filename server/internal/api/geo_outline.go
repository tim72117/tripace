package api

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/tim72117/tripace/internal/apigateway"
	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/model"
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

	// 這支函式自己建立獨立的 geo.Client,不沿用呼叫端 handler 裡已經建立
	// 的那個——理由不是並行安全疑慮(client 本身無共享可變狀態,見上方
	// 並行安全說明),而是避免耦合呼叫端 client 的生命週期(呼叫端的 ctx
	// 在 handler 返回後就失效,但 client 值本身沒有綁定 ctx,理論上沿用
	// 也不會出錯;這裡仍選擇重新建立,讓這支函式的輸入介面單純只依賴
	// apiKey 字串,不需要呼叫端多傳一個 *geo.Client 參數,呼叫端程式碼
	// 也更清楚「背景查詢是完全獨立的一次查詢」)。
	// 2026-10:不再注入 Pexels client——使用者明確要求規劃地圖上完全
	// 沒建檔過的城市被臨時搜尋時,不要回退用 Pexels 示意圖頂替。
	// geo.Client 內部(places.go)對 pexelsClient == nil 已有防護,會直接
	// fallback 回 Google Places 該地標的真實照片,不需要額外改動
	// geo.Client 本身的邏輯。
	client := geo.New(apiKey)
	client.SetCache(s.photoCache)

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
// place_details_cache 與 place_pexels_photos,不覆蓋既有更完整的資料——
// store.SetCachedPlaceDetails 是整列覆寫的 upsert(GORM Save,依
// place_id 主鍵覆蓋整列,不是部分欄位更新,見該函式的說明),若這裡直接
// 呼叫 SetCachedPlaceDetails 且傳入 rating=0、summary=nil,會把「使用者
// 稍早已經點開過這個地點、快取裡已經有的 rating/summary」整個覆蓋掉、
// 造成資料倒退。
//
// 這支函式只服務 photoOnly 模式的快取預熱(見呼叫端 fetchPhotosForCandidates
// 的說明:只試 Pexels,不 fallback Google GetPlaceDetails/Photo
// Media)——傳入的 photoURL 恆為 Pexels 來源,故寫入 place_pexels_photos
// (index 固定 0,這條路徑一次只查一張)而非 google_place_photos。一般
// 模式(handleGeoPlaceDetails 無參數版本)的雙來源照片由該函式自己在
// 查詢完成後寫入,不經過這支函式。
//
// 策略:先讀一次既有快取(不管新鮮/過期,只要列存在就代表曾經查過完整
// 資料)——
//   - 若已存在,保留原本的 name/address/lat/lng/rating/summary,只把
//     Pexels 照片換成這次查到的(除非既有快取本身已經有 Pexels 照片,
//     那就不需要再覆寫,直接跳過,理由同下方說明)。
//   - 若不存在,才寫入這批只有 name/placeID 的部分資料——
//     address/lat/lng/rating/summary 這些背景查詢當下沒有的欄位,比照
//     handleGeoPlaceDetails 裡 photoOnly/textOnly 模式「欄位不全時不寫入
//     完整快取列」的既有慣例(見該函式對 photoOnly 分支的說明:「不寫入
//     place_details_cache——這個模式下沒有 address/rating/summary 等
//     完整資料,寫入會讓快取列殘缺不全」)。但這裡的目的（預熱
//     photoOnly 查詢的快取命中）恰好只需要照片就夠——
//     handleGeoPlaceDetails 的 GetCachedPlaceDetails 命中判斷只要求
//     ok=true(列存在且未過期),不要求其他欄位非空;photoOnly 分支只讀
//     ListPlacePexelsPhotos,並不理會 rating/summary 是否為空。故這裡
//     寫入 address=""/lat=0/lng=0/rating=0/summary=nil 的部分資料列,
//     不會讓 photoOnly 這條路徑的行為出錯,只是這筆快取列本身還不夠
//     完整、不能拿來滿足 textOnly 或一般模式的查詢——那兩種模式仍會
//     照常重新查 Google 補齊完整資料,並在查完後用完整資料重新覆寫這
//     一列(見 handleGeoPlaceDetails 主流程結尾的 SetCachedPlaceDetails
//     呼叫),不會有資料一直卡在殘缺狀態。
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
		if pexelsPhotos, pErr := s.store.ListPlacePexelsPhotos(placeID); pErr == nil && len(pexelsPhotos) > 0 {
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

	_ = s.store.SetCachedPlaceDetails(placeID, name, address, lat, lng, rating, summary)
	_ = s.store.SetPlacePexelsPhotos(placeID, []string{photoURL}, []string{""})
}

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

	// 2026-10:不再注入 Pexels client——理由同 warmPlaceDetailsPhotoCache
	// 的完整說明,這支端點是「完全沒有人工建檔資料」時的最終後備
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
// 格式——原本用 map[string]any 手動組,改成強型別 struct 較不容易漏
// 欄位/打錯 key。
//
// 2026-10:徹底移除 photoUrl 相容欄位——這支端點 2026-08 起已經不再
// 同步查照片(見 handleGeoGeocode 內 warmPlaceDetailsPhotoCache 的呼叫
// 說明),原本的 PhotoURL 欄位一律留空字串,是個已確認沒有任何呼叫端
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
	// 照片查詢已經改成上面的背景預熱(見 warmPlaceDetailsPhotoCache 的
	// 說明),不再同步查完才組這筆回應——2026-10 已把這裡一律留空的
	// photoUrl 相容欄位整個從 geoGeocodeCandidateResponse 移除。
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

	// 2026-10:不再注入 Pexels client——理由同 warmPlaceDetailsPhotoCache
	// 的完整說明,這支端點的照片背景預熱(見 geoGeocodeCandidateResponses)
	// 移除 Pexels 後會直接 fallback 回 Google Places 真實照片。
	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := s.newGeoGeocodeClient(apiKey)
	client.SetCache(s.photoCache)

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
	// 2026-10:不再注入 Pexels client——理由同 warmPlaceDetailsPhotoCache
	// 的完整說明。
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
	go func() {
		apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
		client := s.newPlaceDetailsClient(apiKey)
		pctx, pcancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer pcancel()
		pctx = geo.WithCaller(pctx, "handleGeoPlaceDetails")
		pctx = geo.WithPath(pctx, requestPath)

		refs := knownPhotoRefs
		if refs == nil {
			details, err := client.GetPlaceDetails(pctx, placeID)
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
			return
		}
		now := time.Now()
		expiresAt := now.Add(photoAssetExpiry)
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
// 情境使用(見 web/src/geo-planning/useThemeAttractionSelection.ts
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

// GET /public/geo/place-photo-assets?placeId={Google Place ID}
//
// handleGeoPlacePhotoAssets 的免登入版——授權機制對齊
// handlePublicGeoPlaceDetails(必須是已建檔的 attraction 才放行,見該
// 函式的完整說明),通過後直接委派給同一個 handler,不重寫第二份純讀
// 邏輯。
func (s *Server) handlePublicGeoPlacePhotoAssets(w http.ResponseWriter, r *http.Request) {
	placeID := r.URL.Query().Get("placeId")
	if _, err := s.store.GetAttractionByPlaceID(placeID); err != nil {
		writeErr(w, http.StatusForbidden, "place_not_allowed", "這個 placeId 不是已建檔的景點,不允許公開查詢")
		return
	}
	s.handleGeoPlacePhotoAssets(w, r)
}

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
		if textStale := time.Since(cached.FetchedAt) > placeDetailsCacheMaxAge; textStale {
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
			if details, dErr := client.GetPlaceDetails(tctx, placeID); dErr == nil {
				resp.Name, resp.Address, resp.Lat, resp.Lng, resp.Rating, resp.Summary =
					details.Name, details.Address, details.Lat, details.Lng, details.Rating, details.Summary
				var summaryPtr *string
				if resp.Summary != "" {
					summaryPtr = &resp.Summary
				}
				_ = s.store.SetCachedPlaceDetails(placeID, resp.Name, resp.Address, resp.Lat, resp.Lng, resp.Rating, summaryPtr)
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
			fresh := s.freshPhotoIndexStates(placeID, photoCapForClickCount(clickCount))
			if shouldFetch, indexToFetch := decidePlacePhotoRefreshIndex(clickCount, fresh); shouldFetch {
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
	// warmPlaceDetailsPhotoCache 的說明。
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

// GET /public/geo/place-details?placeId={Google Place ID}
//
// 免登入版、供登入前的公開展示頁(主題介紹頁,如 JiufenPage.tsx/
// TainanPage.tsx/KiyomizuDemoPage.tsx,見 InteractiveExploreMap.tsx 的
// 呼叫端)查詢固定示範景點的完整資料——只放行已建檔為 attraction 的
// placeId(見下方 handlePublicGeoPlaceDetails 的授權機制說明,取代舊版
// publicPlaceDetailsAllowlist 這份逐一手動維護的靜態白名單)。
//
// 2026-09 重構:直接委派給 handleGeoPlaceDetails(登入後正式規劃功能用
// 的核心邏輯),不再維護一份獨立、跟它漸漸失去同步的簡化實作(使用者
// 明確要求「直接使用 /internal/geo/place-details 的流程元件」)。舊版
// 曾經刻意寫成獨立簡化版,理由是「這支端點只需要一張圖,不需要
// handleGeoPlaceDetails 內建的漸進補圖決策(點擊節奏/7 天時間觸發)這種
// 服務正式規劃體驗的複雜度」——但這個取捨的代價是兩份邏輯各自演進,
// 公開版永遠無法受益於登入版之後任何補圖機制的修正/優化(例如 7 天
// 重新確認 target 等),且兩者都各自查同一張 photo_assets 表卻各寫一份
// 幾乎相同的程式碼。改成直接呼叫同一個 handler 後,公開版與登入版的
// 行為完全一致(含漸進補圖節奏等),差別只在授權層——這裡先做授權檢查,
// 通過才放行呼叫。
//
// 授權機制:2026-09 從固定白名單(publicPlaceDetailsAllowlist,逐一手動
// 列舉允許查詢的 placeID)改成「這個 placeID 必須是已建檔的 attraction
// 才放行」(store.GetAttractionByPlaceID 查得到),不是拿掉授權改成任何
// 人都能查任意 placeId。理由:固定白名單需要每新增一個展示用地點就手動
// 加一行程式碼才會生效(見舊版 publicPlaceDetailsAllowlist 的完整說明:
// 「之後若展示頁新增其他固定景點,需要同步在這裡補上對應的 placeID,
// 不會自動生效」),而這支端點原本服務的場景(主題介紹頁的地圖圖示/
// 詳情卡)本來就只會查已經人工建檔、掛在地圖上的 attraction——用資料庫
// 裡「這筆有沒有建檔」本身當授權依據,取代維護一份逐筆列舉、容易忘記
// 同步更新的靜態清單,新增景點只需要建檔(CLI attraction-add),不需要
// 額外再手動維護這裡的白名單。查無 attraction 紀錄時視為不通過授權,
// 回 403(維持跟舊版白名單未命中時相同的錯誤語意,不是 404——404 是
// 「查了但地點不存在」,403 是「這個查詢請求不被允許」,這裡屬於後者:
// 即使 Google Places 上真的有這個地點,只要沒有建檔就不放行)。
// handleGeoPlaceDetails 本身不含任何授權判斷(授權原本就是外層
// /internal/ mux 掛載時套用的 internalAuth middleware 負責的,見 api.go
// 路由註冊處的說明,handler 函式本體從未依賴呼叫者是否通過 JWT 驗證),
// 故可以在這裡做完授權檢查後直接呼叫它,不會意外繞過或重複套用任何
// 授權邏輯。
//
// 點擊次數/漸進補圖節奏會被公開端點觸發(跟登入版共用同一份
// place_details_cache 點擊計數),這是刻意接受的行為改變——理由同上述
// 「不再維護兩份邏輯」的取捨,「必須是已建檔 attraction」這個授權條件
// 已經限制了能被觸發的 placeId 範圍,不會被濫用成任意觸發計費查詢的
// 入口。
func (s *Server) handlePublicGeoPlaceDetails(w http.ResponseWriter, r *http.Request) {
	placeID := r.URL.Query().Get("placeId")
	if _, err := s.store.GetAttractionByPlaceID(placeID); err != nil {
		writeErr(w, http.StatusForbidden, "place_not_allowed", "這個 placeId 不是已建檔的景點,不允許公開查詢")
		return
	}
	s.handleGeoPlaceDetails(w, r)
}

// publicAttractionsCityAllowlist:GET /public/geo/attractions 只允許查詢
// 這份白名單裡的城市——理由同 publicPlaceDetailsAllowlist,這支端點刻意
// 不掛 internalAuth,供登入前的公開展示頁(web/src/home/KiyomizuDemoPage.tsx/
// YasakaDemoPage.tsx)查詢清水寺/八坂神社周邊精選點的名稱/座標/分類等
// 基本資料,取代原本寫死在 kiyomizuDemoFixture.ts/yasakaDemoFixture.ts
// 的固定 fixture。這裡的白名單是城市層級(不是像 place-details 那樣逐一
// 列出 placeID)——因為 handleGeoAttractionsByCity 本身只走
// store.ListAttractionsByCity(純資料庫查詢,見該 handler 的完整說明,
// 刻意不像 handleGeoAttractions 那樣有 Google Places 即時查詢的 fallback
// 分支),不會觸發任何計費的外部 API 呼叫,城市層級的白名單已經足夠防止
// 這支端點被當成任意查詢資料庫全部城市內容的公開清單端點濫用,不需要
// 逐筆列舉 attraction ID 這麼細的授權粒度。之後若展示頁新增其他城市的
// 固定示範資料,需要同步在這裡補上,不會自動生效。
var publicAttractionsCityAllowlist = map[string]bool{
	"京都":  true,
	"九份":  true, // JiufenPage.tsx 開頭嵌入 KiyomizuDemoPage(參數化為 city prop)
	"台南":  true, // TainanPage.tsx 開頭嵌入 InteractiveExploreMap(參數化為 city prop)
	"定山溪": true, // 北海道定山溪賞楓試做頁(見 docs/research-hokkaido-jozankei-autumn-theme-2026-09.md),同樣是 InteractiveExploreMap 嵌入
}

// handleGeoAttractionsByCity 是 GET /public/geo/attractions 的核心邏輯,
// 也被沒有白名單限制的用途共用(目前只有下面 handlePublicGeoAttractions
// 這一個呼叫端,獨立成函式是為了讓白名單檢查與實際查詢邏輯分開,便於
// 之後有其他需要純資料庫查詢、不含 Google 即時 fallback 的呼叫端加入
// 時直接重用)——刻意不重用 handleGeoAttractions(那支有 Google Places
// SearchCityAttractions 的即時查詢 fallback,見該函式的完整說明:
// 沒有登入驗證的公開端點若間接觸發計費的外部 API 呼叫,等同把這支端點
// 變成任何人都能觸發真實花費的入口,即使城市白名單只收錄「京都」,
// 只要 store.ListAttractionsByCity 查無資料就會落到 fallback,仍然是
// 不可接受的風險),只走 store.ListAttractionsByCity 這一層人工建檔的
// 正式資料,查無資料就回空陣列,不嘗試任何其他資料來源。
func (s *Server) handleGeoAttractionsByCity(city string) ([]attractionResponse, error) {
	landmarks, err := s.store.ListAttractionsByCity(city)
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

// GET /public/geo/attractions?city={城市名稱}
//
// 免登入版的景點區域清單查詢——供登入前的公開展示頁(見
// publicAttractionsCityAllowlist 的完整說明)查詢固定示範城市裡人工
// 建檔的全部景點區域(含主題點與精選點,前端自行依 isTheme 分流,見
// KiyomizuDemoPage.tsx 的既有慣例),取代原本寫死在
// kiyomizuDemoFixture.ts/yasakaDemoFixture.ts 的固定 fixture——資料庫
// 內容更新(改名/補圖/新增精選點/補分類)後,展示頁會自動反映,不需要
// 再手動同步一份重複資料。回應格式與 GET /internal/geo/attractions
// 一致(共用 attractionResponse),差別只在這支端點只查資料庫、不含
// Google Places 即時查詢 fallback(見 handleGeoAttractionsByCity 的
// 完整說明)。
func (s *Server) handlePublicGeoAttractions(w http.ResponseWriter, r *http.Request) {
	city := r.URL.Query().Get("city")
	if !publicAttractionsCityAllowlist[city] {
		writeErr(w, http.StatusForbidden, "city_not_allowed", "這個城市不在公開查詢白名單內")
		return
	}
	attractions, err := s.handleGeoAttractionsByCity(city)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"attractions": attractions})
}

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
	_ = s.store.SetCachedPlaceDetails(placeID, resp.Name, resp.Address, resp.Lat, resp.Lng, resp.Rating, summaryPtr)

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
	clickCount, _ := s.store.IncrementPlaceClickCount(placeID)
	fresh := s.freshPhotoIndexStates(placeID, photoCapForClickCount(clickCount))
	// len(details.PhotoRefs)==0 時這個地點在 Google 端根本沒有任何照片
	// (非錯誤,見 GetPlaceDetails 的完整說明——沒有 photos[] 時
	// PhotoRefs 維持零值 nil)——不需要觸發任何背景任務,也不該把零值
	// nil 傳給 backgroundFillPlacePhoto 當作「已經查過、確定沒有照片」
	// 的 knownPhotoRefs(該函式用 nil 判斷「呼叫端還沒查過,要自己查」,
	// 兩種情況在型別層級上無法區分,故在這裡提前判斷掉,不讓空清單流
	// 進那支函式造成語意混淆)。
	if len(details.PhotoRefs) > 0 {
		if shouldFetch, indexToFetch := decidePlacePhotoRefreshIndex(clickCount, fresh); shouldFetch {
			resp.PhotoRefreshPending = true
			// details.PhotoRefs 已經在手上(這次 GetPlaceDetails 同步
			// 查詢的結果),直接傳給背景任務,不需要讓它再打一次
			// GetPlaceDetails。
			s.backgroundFillPlacePhoto(placeID, requestPath, indexToFetch, details.PhotoRefs)
		}
	}

	// 2026-09 移除 Pexels 讀圖來源——這裡原本會同步查一次 Pexels、寫進
	// place_pexels_photos(供之後點擊判斷 hasExistingPexelsPhoto/漸進補圖
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
	capN := photoCapForClickCount(clickCount)
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
// internal/wanttools、internal/onagenttools 的 recommend_nearby LLM 工具
// 仍是這個函式現存的呼叫端。

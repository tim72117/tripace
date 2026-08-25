// 維運端點(/internal/maintenance/*)——只給 tripace-cli 這類維運工具用,
// 不是產品本身(前端 web app)會呼叫的路徑。跟 geo_outline.go 那批「核心」
// 端點(/internal/geo/*,前端規劃分頁實際依賴、使用者操作會觸發)刻意分開
// 命名空間與檔案,原因:
//
//  1. 語意上是兩種不同的呼叫者——核心端點的呼叫量隨產品真實使用者數量
//     成長,維運端點只有工程師手動執行 CLI 指令時才會被打,呼叫量天生
//     是低頻、人工觸發的。把兩者混在一起,日後看請求統計(見
//     internal/adminconsole 的 request-stats)時很難一眼分辨「這是真的
//     使用者流量」還是「工程師在跑維運指令」。
//  2. 呼叫者的操作介面不同——這裡的 handleMaintenanceGeocode 支援
//     -region 地區限定(對齊 CLI 原本 geocode 子命令的行為),核心的
//     handleGeoGeocode 是前端搜尋框用,不需要這個參數。兩者底層現在都是
//     Places API (New) Text Search(見 handleGeoGeocode 的說明——原本用
//     Geocoding API,只回單一最佳匹配,對城市/觀光區這類口語化地名支援
//     較弱、常查無結果,已改為回傳多筆候選),但刻意不共用同一支端點,
//     避免其中一邊改動時誤傷到另一邊的呼叫端,且回應形狀也不同(見下方)。
//
// 這兩支端點取代原本 tripace-cli 裡「直接在 CLI process 本地建立
// geo.Client、繞過後端」的做法(geocode 子命令)、與「只能在 -db 直連模式
// 下才能用」的做法(attraction-update-photo 子命令)——搬進後端後,兩者都
// 走跟其餘子命令一致的 HTTP + JWT 登入路徑,也因此能被
// apigateway.Gateway 的節流與 geo_api_call_logs 記錄涵蓋到(CLI 直接呼叫
// Google 時,節流雖然仍套用預設值,但因為 CLI 是短命的獨立 process、
// 從未接上 storeGeoCallLogger,呼叫不會被記錄——這是搬進後端要解決的
// 主要原因)。
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/pexels"
)

// GET /internal/maintenance/geocode?place={地名}&region={國碼,選填}&n={候選筆數,選填}
//
// 對齊 tripace-cli 原本 geocode 子命令的行為(見 cmd/cli/geocode.go 移除
// 前的版本):用 Places API Text Search 查詢地名,支援多候選(-n)與地區
// 限定(-region)——handleGeoGeocode 現在也改走同一套 Places API Text
// Search(見該函式的說明),但兩支端點呼叫情境不同,不能互相取代:
// handleGeoGeocode 是前端搜尋框用,固定回傳一組(對齊產品面「候選清單」
// 的呈現需求);這支端點是工程師手動核對地名解析結果、或批次補座標時
// 用 -region/-n 這些維運場景才需要的參數調整候選筆數與地區限定,是純
// CLI 專用的維運工具。
func (s *Server) handleMaintenanceGeocode(w http.ResponseWriter, r *http.Request) {
	place := r.URL.Query().Get("place")
	if place == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 place 查詢參數")
		return
	}
	region := r.URL.Query().Get("region")
	maxN := 1
	if raw := r.URL.Query().Get("n"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			maxN = parsed
		}
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	ctx = geo.WithCaller(ctx, "handleMaintenanceGeocode")
	ctx = geo.WithPath(ctx, r.URL.Path)

	places, err := client.Search(ctx, place, &geo.SearchOptions{Region: region, MaxResults: maxN})
	if err != nil {
		if err == geo.ErrNotFound {
			writeErr(w, http.StatusNotFound, "no_match", "查無「"+place+"」相關地點")
			return
		}
		writeErr(w, http.StatusBadGateway, "geocode_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"query":  place,
		"region": region,
		"places": places,
	})
}

// POST /internal/maintenance/attractions/{id}/update-photo
// Body(選填): { "query": "自訂查詢字串", "source": "google"|"pexels" }
//
// 重新查詢一次該地標的圖片並回寫到資料庫。query 未帶時,用該地標既有的
// CityName+Name 組成預設查詢字串。查無圖片時回傳明確錯誤,不靜默略過
// ——這是使用者主動觸發的單筆操作,呼叫端需要知道這次操作到底有沒有
// 真的取到圖。
//
// source 未帶時預設 "google"(對齊改動前的既有行為,不影響任何既有呼叫
// 端);"pexels" 改走 internal/pexels 查詢示意圖(不是該地點的真實照片,
// 見該套件開頭的定位說明),查到後立刻下載並上傳 GCS(見
// updateAttractionPhotoFromPexels 的完整說明),不直接把 Pexels 原始
// 連結存進資料庫——理由同 handleMaintenanceAttractionAdd 的說明,外部
// 圖床連結的長期可用性不受我方控制。Google 來源已經是 data: URI(見
// updateAttractionPhotoFromGoogle),不經過這道落地手續。兩種來源的
// 底層資料形狀不同(Google 是 data: URI、Pexels 落地後是 GCS 網址),但
// 都透過同一個 UpdateAttractionPhoto 寫回 attractions.photo_url——那個
// 欄位本身就是不透明字串,前端 <img src> 直接用,不需要额外分辨來源。
func (s *Server) handleMaintenanceAttractionUpdatePhoto(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少景點 ID")
		return
	}

	// body 整段可省略(query/source 皆選填),故不用 decode() helper——那個
	// helper 對完全空的 request body 會直接判定失敗,這裡改成盡力解析、
	// 解析不出來就當作沒帶,交給下面的預設值邏輯處理。
	var body struct {
		Query  string `json:"query"`
		Source string `json:"source"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	lm, err := s.store.GetAttraction(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "找不到景點 "+id)
		return
	}
	query := body.Query
	if query == "" {
		query = lm.CityName + " " + lm.Name
	}

	source := body.Source
	if source == "" {
		source = "google"
	}

	var photoURL string
	switch source {
	case "google":
		photoURL, err = s.updateAttractionPhotoFromGoogle(r.Context(), query)
	case "pexels":
		photoURL, err = s.updateAttractionPhotoFromPexels(r.Context(), id, query)
	default:
		writeErr(w, http.StatusBadRequest, "invalid_input", "source 須為 google 或 pexels")
		return
	}
	if err != nil {
		writeErr(w, http.StatusBadGateway, "search_failed", err.Error())
		return
	}
	if photoURL == "" {
		writeErr(w, http.StatusNotFound, "no_photo", "「"+query+"」查無可用照片")
		return
	}

	// 換圖前先清理舊的 GCS 物件(若舊值確實是我方 GCS 物件、且跟新值不同)
	// ——理由同 handleMaintenanceAttractionDelete 清理 GCS 物件的說明,
	// 避免換圖後 bucket 裡留下再也沒有任何資料庫記錄指向的孤兒檔案。
	// s.photoUploader.Delete 內部已經會判斷 lm.PhotoURL 是否真的屬於這個
	// bucket(非 GCS 的外部連結安全 no-op),這裡只需要額外排除「新舊
	// 相同」的情況(-source pexels 重新查到同一張圖時,物件名不變,不該
	// 先刪再蓋,以免中間有極短暫的視窗讀不到圖)。失敗只記錄 warning、
	// 不阻擋這次換圖操作——理由同 attraction-delete 的既有降級慣例。
	if lm.PhotoURL != nil && *lm.PhotoURL != photoURL {
		if err := s.photoUploader.Delete(r.Context(), *lm.PhotoURL); err != nil {
			log.Printf("清理景點 %s 的舊 GCS 照片失敗(不阻擋換圖操作): %v", id, err)
		}
	}

	if err := s.store.UpdateAttractionPhoto(id, photoURL); err != nil {
		writeErr(w, http.StatusInternalServerError, "internal_error", "寫入資料庫失敗: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":     id,
		"query":  query,
		"source": source,
		// 只回報是否成功與圖片長度,不把完整 data URI(Google 來源可能數十
		// KB 的 base64 字串)塞進回應——CLI 輸出是給人看的,理由同原本
		// dbClient 版本的說明。Pexels 來源落地後是 GCS 網址,長度不具參考
		// 意義,但沿用同一個欄位維持回應形狀一致,不需要呼叫端依 source
		// 分岔解析邏輯。
		"photoLength": len(photoURL),
		"status":      "updated",
	})
}

// updateAttractionPhotoFromGoogle 是 handleMaintenanceAttractionUpdatePhoto
// 原本(改動前)的 Google Places 查詢邏輯,原封不動搬進獨立函式——回傳
// data: URI,查無圖片時回傳空字串(非 error),呼叫端據此判斷。這條路徑
// 不經過 photostorage 落地到 GCS——Google Photo Media API 明文禁止長期
// 快取 photo resource name(見 store.photoCacheRow 的完整說明),data:
// URI 本身已經是這個限制下的落地策略,且已經過 s.photoCache 快取,不需要
// 再疊加一層 GCS 落地。
func (s *Server) updateAttractionPhotoFromGoogle(ctx context.Context, query string) (string, error) {
	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)
	client.SetCache(s.photoCache)
	gctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	gctx = geo.WithCaller(gctx, "handleMaintenanceAttractionUpdatePhoto")
	// 用註冊時的 pattern(而非 r.URL.Path 字面路徑)——這條路由含 {id}
	// 路徑變數,若用字面路徑,同一條路由會因為不同地標 ID 被統計成一堆
	// 各自獨立的資料列,見 geo.WithPath 的說明。
	gctx = geo.WithPath(gctx, "/internal/maintenance/attractions/{id}/update-photo")

	place, photoRef, _, _, err := client.SearchLandmarkWithPhoto(gctx, query)
	if err != nil {
		return "", fmt.Errorf("查詢「%s」失敗: %w", query, err)
	}
	if photoRef == "" {
		return "", nil
	}

	photoURL, err := client.PhotoDataURI(gctx, place.PlaceID, photoRef, 400)
	if err != nil {
		return "", fmt.Errorf("下載照片失敗: %w", err)
	}
	return photoURL, nil
}

// updateAttractionPhotoFromPexels 走 internal/pexels 查詢一張示意圖(見
// fetchPexelsPhotoURL 的既有邏輯,這裡改成回傳 error 而非靜默降級——
// 這支端點是使用者主動觸發的單筆操作,查詢失敗需要明確回報,跟
// handleMaintenanceAttractionAdd 建檔時「照片是輔助欄位,失敗不擋整個
// 操作」的降級語意不同)。
//
// 查到 Pexels 圖片網址後,立刻透過 s.photoUploader 下載並上傳 GCS,回傳
// GCS 公開 URL 而非 Pexels 原始連結——理由同 handleMaintenanceAttractionAdd
// 的說明。GCS 上傳失敗(含未設定 GCS_PHOTO_BUCKET 的 ErrNoBucket)時
// 退回 Pexels 原始連結,不讓這支已知會被使用者主動呼叫、預期明確回報
// 成功與否的端點,因為落地失敗而整個操作失敗——落地是加分項,不是這支
// 端點存在的核心目的(核心目的是「查到一張可用的圖」)。
func (s *Server) updateAttractionPhotoFromPexels(ctx context.Context, id, query string) (string, error) {
	apiKey := os.Getenv("PEXELS_API_KEY")
	client := pexels.New(apiKey)
	pctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	photo, ok, err := client.Search(pctx, query)
	if err != nil {
		return "", fmt.Errorf("查詢「%s」失敗: %w", query, err)
	}
	if !ok {
		return "", nil
	}

	if gcsURL, err := s.photoUploader.Upload(ctx, id, photo.ImageURL); err == nil {
		return gcsURL, nil
	}
	return photo.ImageURL, nil
}

// POST /internal/maintenance/attractions
// Body: model.Attraction 的 JSON 形狀(name/cityName/lat/lng/level 必填,
// radiusMeters/summary/photoUrl 選填)。
//
// 對齊 tripace-cli 原本 attraction-add 子命令(-db 模式)的行為(見
// cmd/cli/db.go 移除前的 dbClient.attractionAdd):人工建檔一筆景點區域
// 資料。搬進後端後,不再直連資料庫,理由同本檔案開頭的說明。
//
// PhotoURL 未帶時,自動打 Pexels Search API 查一張示意圖補上(用
// cityName+name 組成查詢字串)——這不是「該地點的真實照片」,只是關鍵字
// 比對到的示意圖(見 internal/pexels 開頭的定位說明),查無結果或未設定
// PEXELS_API_KEY 時不視為錯誤,直接建檔成 PhotoURL 為空,不阻擋整個
// 新增操作——照片只是輔助顯示用途,不是這筆資料的必要欄位。
//
// 不論 PhotoURL 是使用者明確帶入(如貼一個 Google/Pexels 圖片網址)還是
// 上面這段自動查到的 Pexels 結果,最終存進資料庫前都會先下載並上傳到
// GCS(見 s.photoUploader),資料庫存的是我方 GCS 的公開 URL,不是原始
// 外部連結——兩種來源都不受我方控制其長期可用性(圖被刪除、服務下線、
// URL 改版),既然這筆資料是人工建檔、預期長期存在的內容,不該有一半
// 落地一半沒有的不一致。落地邏輯需要 attraction 的 id 當 GCS 物件路徑,
// 故必須先呼叫 CreateAttraction 拿到 id,才能落地,不是建檔前就地下載。
// 落地失敗(含未設定 GCS_PHOTO_BUCKET)時保留原始外部連結,不讓這個
// 加分項的失敗回頭讓已經成功的建檔操作報錯。
func (s *Server) handleMaintenanceAttractionAdd(w http.ResponseWriter, r *http.Request) {
	var in model.Attraction
	if !decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Name) == "" || strings.TrimSpace(in.CityName) == "" || in.Level < 1 || in.Level > 5 {
		writeErr(w, http.StatusBadRequest, "invalid_input", "name、cityName 必填,level 須介於 1~5")
		return
	}

	if in.PhotoURL == nil || strings.TrimSpace(*in.PhotoURL) == "" {
		query := in.CityName + " " + in.Name
		if photoURL := s.fetchPexelsPhotoURL(r.Context(), query); photoURL != "" {
			in.PhotoURL = &photoURL
		}
	}

	res, err := s.store.CreateAttraction(in)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "create_failed", err.Error())
		return
	}

	// data: URI(base64 內嵌圖片)不落地——理由同
	// updateAttractionPhotoFromGoogle 的說明,這種格式本身已經是落地
	// 策略,且不是一個可以下載的網址,photostorage.Upload 對它一定會
	// 下載失敗。目前 fetchPexelsPhotoURL 只會回傳一般 http 網址,不會
	// 觸發這個分支,但使用者可能透過 -photo-url 手動帶入 data: URI
	// (例如日後接上 Google 來源的建檔流程),提前排除、跟 update-photo
	// 的既有規則保持一致,不依賴 Upload 失敗後的降級恰好覆蓋這個情境。
	if res.PhotoURL != nil && strings.TrimSpace(*res.PhotoURL) != "" && !strings.HasPrefix(*res.PhotoURL, "data:") {
		if gcsURL, err := s.photoUploader.Upload(r.Context(), res.ID, *res.PhotoURL); err == nil {
			if err := s.store.UpdateAttractionPhoto(res.ID, gcsURL); err == nil {
				res.PhotoURL = &gcsURL
			}
		}
	}

	writeJSON(w, http.StatusCreated, res)
}

// fetchPexelsPhotoURL 查詢一張 Pexels 示意圖的圖片網址,查無結果、未設定
// PEXELS_API_KEY、或呼叫失敗時一律回傳空字串——這是刻意的靜默降級(同
// handleMaintenanceAttractionAdd 的說明:照片是輔助欄位,不該讓 Pexels
// 查詢失敗擋下整個建檔操作),呼叫端不需要另外處理 error。
//
// 這裡是一次性建檔操作,不接 internal/store 的 GetCachedPexelsPhoto/
// SetCachedPexelsPhoto 快取(那套快取元件與底層儲存留給另一個尚未實作的
// 功能——使用者瀏覽景點時系統即時查詢示意圖——共用,兩者存放的圖片來源
// 與存取元件相同,但這裡的呼叫時機、頻率都不需要透過快取層。
func (s *Server) fetchPexelsPhotoURL(ctx context.Context, query string) string {
	apiKey := os.Getenv("PEXELS_API_KEY")
	client := pexels.New(apiKey)
	pctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	photo, ok, err := client.Search(pctx, query)
	if err != nil || !ok {
		return ""
	}
	return photo.ImageURL
}

// GET /internal/maintenance/attractions?city={城市名}
//
// 對齊 tripace-cli 原本 attraction-list 子命令(-db 模式)的行為(見
// cmd/cli/db.go 移除前的 dbClient.attractionList)。
func (s *Server) handleMaintenanceAttractionList(w http.ResponseWriter, r *http.Request) {
	city := r.URL.Query().Get("city")
	if city == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 city 查詢參數")
		return
	}
	attractions, err := s.store.ListAttractionsByCity(city)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"city": city, "attractions": attractions})
}

// GET /internal/maintenance/attractions/cities
//
// 對齊 tripace-cli 原本 attraction-cities 子命令(-db 模式)的行為(見
// cmd/cli/db.go 移除前的 dbClient.attractionCities)。
func (s *Server) handleMaintenanceAttractionCities(w http.ResponseWriter, r *http.Request) {
	cities, err := s.store.ListAttractionCities()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"cities": cities})
}

// DELETE /internal/maintenance/attractions/{id}
//
// 對齊 tripace-cli 原本 attraction-delete 子命令(-db 模式)的行為(見
// cmd/cli/db.go 移除前的 dbClient.attractionDelete)。
//
// 刪除資料庫記錄前,先查出這筆的 photo_url,若是我方 GCS 的物件(見
// s.photoUploader.Delete 的判斷邏輯——只有真的屬於這個 bucket 的 URL
// 才會發出刪除請求),一併清掉對應的 GCS 物件,避免刪除景點後 bucket
// 裡留下再也沒有任何資料庫記錄指向的孤兒檔案。GCS 刪除失敗只記錄
// warning、不阻擋資料庫記錄的刪除——理由同 photostorage 落地失敗時的
// 既有降級慣例:清理照片是這個操作的加分項,不是核心目的(核心目的是
// 刪除這筆景點區域資料),不該讓一個次要步驟的失敗擋下使用者明確要求
// 的刪除操作。
func (s *Server) handleMaintenanceAttractionDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少景點 ID")
		return
	}

	if a, err := s.store.GetAttraction(id); err == nil && a.PhotoURL != nil {
		if err := s.photoUploader.Delete(r.Context(), *a.PhotoURL); err != nil {
			log.Printf("刪除景點 %s 的 GCS 照片失敗(不阻擋刪除操作): %v", id, err)
		}
	}

	if err := s.store.DeleteAttraction(id); err != nil {
		writeErr(w, http.StatusInternalServerError, "delete_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"deleted": id})
}

// PATCH /internal/maintenance/attractions/{id}/coords
// Body: {"lat": 緯度, "lng": 經度}
//
// 供 tripace-cli 的 attraction-update 指令修正建檔時輸入錯誤的座標(見
// store.UpdateAttractionCoords)。只改座標,不是通用的景點區域編輯端點
// ——理由同 handleMaintenanceAttractionUpdatePhoto 只改照片欄位的說明,
// 未來若要支援更多欄位,應個別新增對應端點,而非讓這支端點的 body 逐漸
// 長成完整的 model.Attraction。
func (s *Server) handleMaintenanceAttractionUpdateCoords(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少景點 ID")
		return
	}
	var in struct {
		Lat float64 `json:"lat"`
		Lng float64 `json:"lng"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := s.store.UpdateAttractionCoords(id, in.Lat, in.Lng); err != nil {
		writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "lat": in.Lat, "lng": in.Lng})
}

// PATCH /internal/maintenance/attractions/{id}/field
// Body: {"field": "name" | "summary", "value": "新內容"}
//
// 供 tripace-cli 的 attraction-update -field -value 指令使用(見
// store.UpdateAttractionField)——通用的單一字串欄位更新端點,取代原本
// 各自獨立的 .../name、.../summary 兩支端點。可更新的欄位由
// store.attractionUpdatableFields 白名單控制,field 不在白名單時
// UpdateAttractionField 回錯誤,這裡轉成 400 而非讓非預期欄位被寫入。
// 同 handleMaintenanceAttractionUpdateCoords 的說明:座標(需要同時更新
// 兩個數字欄位、且有 geocode 查詢邏輯)與照片(有專屬的重新查詢外部服務
// 端點)不適合塞進這個通用機制,維持各自獨立的端點。
func (s *Server) handleMaintenanceAttractionUpdateField(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少景點 ID")
		return
	}
	var in struct {
		Field string `json:"field"`
		Value string `json:"value"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Field == "" || in.Value == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 field 或 value")
		return
	}
	if err := s.store.UpdateAttractionField(id, in.Field, in.Value); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "field": in.Field, "value": in.Value})
}

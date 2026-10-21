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
// (歷史起源——這個檔案最初只有 geocode 與 attraction-update-photo 兩支
// 端點;目前已擴充到景點建檔/查詢、限流規則、field mask 三類維運操作。)
// 那兩支端點取代原本 tripace-cli 裡「直接在 CLI process 本地建立
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
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/tim72117/tripace/internal/adminidentity"
	"github.com/tim72117/tripace/internal/fieldmasks"
	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/model"
	"github.com/tim72117/tripace/internal/ratelimits"
	"github.com/tim72117/tripace/internal/store"
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
	if !s.throttleGeoQueryByUser(w, r) {
		return
	}
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
// Body(選填): { "query": "自訂查詢字串", "placeId": "手動指定要寫入 photo_assets 的 key" }
//
// 重新查詢一次該地標的圖片,寫入 photo_assets(規劃地圖/AI Plan 實際
// 顯示照片時唯一會讀取的來源,見 applyPhotoAssetsAsSource/
// handlePublicGeoPlaceDetailsAny 的完整說明)。query 未帶時,用該地標
// 既有的 CityName+Name 組成預設查詢字串。查無圖片時回傳明確錯誤,不
// 靜默略過——這是使用者主動觸發的單筆操作,呼叫端需要知道這次操作到底
// 有沒有真的取到圖。
//
// 固定走 Google Places 查詢(見 updateAttractionPhotoFromGoogle),回傳
// data: URI——2026-10 使用者明確要求移除 Pexels 來源這個選項(非該
// 地點的真實照片,只是關鍵字比對到的示意圖),這支端點不再接受 source
// 參數挑選來源。
//
// 2026-10:不再更新 attractions.photo_url——使用者明確指出這個欄位
// 已經不再被任何顯示路徑讀取(見 model.Attraction.PhotoURL 的完整
// 說明:2026-09 起規劃地圖/AI Plan 都已改成只讀 photo_assets,不回退
// 讀 photo_url),繼續寫入只會讓這個死欄位看起來像仍在維護、誤導之後
// 的人。
//
// 2026-10 再次修正(code review 抓到的耦合問題):原本這支端點要求
// 這筆地標必須已經透過 attraction set-place-id 登記過 place_id,沒有
// 就直接 400 拒絕——等於把「補照片」跟「補 place_id」這兩個邏輯上
// 獨立的操作綁死,想幫一筆還沒登記 place_id 的地標補圖,得先跑完全
// 不相干的另一個指令。使用者明確要求「place 與 photo 就分離」:這支
// 端點改成 place_id 的來源依優先序決定,不再強制要求資料庫裡已經有值:
//  1. body.PlaceID(呼叫端這次明確帶入的——對齊 attraction set-place-id
//     -place-id 的既有慣例,信任呼叫端輸入,不重新查詢驗證)
//  2. lm.PlaceID(這筆地標資料庫裡原本就登記的,沿用改動前的行為)
//  3. 都沒有時,退回用這次 Google 查詢(query)意外命中的
//     place.PlaceID——這是「只想補圖、根本不在乎/不需要這筆地標的
//     attractions.place_id 欄位有沒有值」這個情境下唯一還能取得的
//     key,不要求呼叫端為了補圖還得先手動查好 place_id。
//
// 三者都查無值(理論上不會發生,Google 查詢結果一定有 PlaceID,除非
// 整個查詢失敗,那會在更早的 photoURL/err 判斷就回傳)時,就只是純粹
// 走到第 3 條用查詢結果本身的 PlaceID,不會真的沒有值可用。
func (s *Server) handleMaintenanceAttractionUpdatePhoto(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少景點 ID")
		return
	}

	// body 整段可省略(query/placeId 皆選填),故不用 decode() helper——
	// 那個 helper 對完全空的 request body 會直接判定失敗,這裡改成盡力
	// 解析、解析不出來就當作沒帶,交給下面的預設值邏輯處理。
	var body struct {
		Query   string `json:"query"`
		PlaceID string `json:"placeId"`
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

	photoURL, place, err := s.updateAttractionPhotoFromGoogle(r.Context(), query)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "search_failed", err.Error())
		return
	}
	if photoURL == "" {
		writeErr(w, http.StatusNotFound, "no_photo", "「"+query+"」查無可用照片")
		return
	}

	// placeID 優先序:body.PlaceID(呼叫端這次明確指定) > lm.PlaceID
	// (資料庫裡原本登記的) > place.PlaceID(這次查詢意外命中的)——見上方
	// 函式說明的完整理由。
	placeID := body.PlaceID
	if placeID == "" && lm.PlaceID != nil {
		placeID = *lm.PlaceID
	}
	if placeID == "" {
		placeID = place.PlaceID
	}

	objectKey := "maintenance-" + placeID
	gcsURL, err := s.photoUploader.UploadDataURI(r.Context(), objectKey, photoURL)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "upload_failed", "上傳照片到 GCS 失敗: "+err.Error())
		return
	}

	now := time.Now()
	expiresAt := now.Add(s.PhotoAssetExpiry())
	if err := s.store.UpsertPhotoAsset(model.PhotoAsset{
		PlaceID:    placeID,
		PhotoIndex: 0,
		Usage:      "full",
		Source:     "google",
		GCSURL:     gcsURL,
		FetchedAt:  now,
		ExpiresAt:  &expiresAt,
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "internal_error", "寫入 photo_assets 失敗: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":      id,
		"placeId": placeID,
		"query":   query,
		"gcsUrl":  gcsURL,
		"status":  "updated",
	})
}

// updateAttractionPhotoFromGoogle 是 handleMaintenanceAttractionUpdatePhoto
// 原本(改動前)的 Google Places 查詢邏輯,原封不動搬進獨立函式——回傳
// data: URI,查無圖片時回傳空字串(非 error),呼叫端據此判斷。這條路徑
// 不經過 photostorage 落地到 GCS——Google Photo Media API 明文禁止長期
// 快取 photo resource name(見 store.photoCacheRow 的完整說明),data:
// URI 本身已經是這個限制下的落地策略,且已經過 s.photoCache 快取,不需要
// 再疊加一層 GCS 落地。
//
// 2026-10:額外回傳查詢命中的 geo.Place(不只是 photoURL)——呼叫端
// (handleMaintenanceAttractionUpdatePhoto)在這筆地標沒有登記 place_id、
// 呼叫端這次也沒有明確指定 placeId 時,需要這裡查到的 place.PlaceID
// 當 photo_assets 的 key,見該函式開頭「2026-10 再次修正」的完整說明。
func (s *Server) updateAttractionPhotoFromGoogle(ctx context.Context, query string) (string, geo.Place, error) {
	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := s.newMaintenancePhotoClient(apiKey)
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
		return "", geo.Place{}, fmt.Errorf("查詢「%s」失敗: %w", query, err)
	}
	if photoRef == "" {
		return "", place, nil
	}

	photoURL, err := client.PhotoDataURI(gctx, place.PlaceID, photoRef, 400)
	if err != nil {
		return "", geo.Place{}, fmt.Errorf("下載照片失敗: %w", err)
	}
	return photoURL, place, nil
}

// POST /internal/maintenance/attractions
// Body: model.Attraction 的 JSON 形狀(name/cityName/lat/lng/level 必填,
// radiusMeters/summary 選填)。
//
// 對齊 tripace-cli 原本 attraction-add 子命令(-db 模式)的行為(見
// cmd/cli/db.go 移除前的 dbClient.attractionAdd):人工建檔一筆景點區域
// 資料。搬進後端後,不再直連資料庫,理由同本檔案開頭的說明。
//
// 不接受任何照片網址輸入(見下方 PhotoURL 相容欄位移除的完整說明)——
// 建檔時不自動補任何示意圖,之後要補照片用 tripace-cli 的
// attraction photo-update(見 handleMaintenanceAttractionUpdatePhoto
// 的完整說明)。
func (s *Server) handleMaintenanceAttractionAdd(w http.ResponseWriter, r *http.Request) {
	var in model.Attraction
	if !decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Name) == "" || strings.TrimSpace(in.CityName) == "" || in.Level < 1 || in.Level > 5 {
		writeErr(w, http.StatusBadRequest, "invalid_input", "name、cityName 必填,level 須介於 1~5")
		return
	}

	// attractions.photo_url 這個相容欄位已經連同資料庫欄位本身徹底移除
	// (見 cmd/migrate-drop-photo-url 的完整說明),建檔請求不再接受任何
	// 照片網址輸入。之後要補照片一律用 attraction photo-update(需要
	// 這筆地標先有 place_id),不透過建檔時夾帶照片網址。
	res, err := s.store.CreateAttraction(in)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "create_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, res)
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

// GET /internal/maintenance/attractions/query?status={狀態名}&city={城市名,選填}
//
// 通用的景點區域「狀態」查詢入口——供 tripace-cli 的
// attraction query -status <狀態名> 指令使用(見該指令的完整說明)。
// 2026-10 新增,目前只支援一種 status 值("no-google-photo"),刻意設計
// 成通用入口(用 status 字串挑選查詢邏輯,而非每種狀態各自開一支獨立
// 端點)——之後要再加其他「核對範圍」查詢(例如之前就有、走 admin 網頁
// 獨立端點的「缺 place_id」查詢,見
// internal/adminconsole/attraction_place_id_check.go)時,只需要在這支
// handler 的 switch 多加一個 case,不需要讓 CLI 再多學一支新端點網址。
// status 不在已知清單時回 400,不是靜默回空陣列——呼叫端需要明確知道
// 「這個狀態名打錯了」還是「這個狀態確實查無結果」兩種情況的差異。
func (s *Server) handleMaintenanceAttractionQuery(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	city := r.URL.Query().Get("city")

	var attractions []model.Attraction
	var err error
	switch status {
	case "no-google-photo":
		attractions, err = s.store.ListAttractionsMissingGooglePhoto(city)
	case "":
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少 status 查詢參數")
		return
	default:
		writeErr(w, http.StatusBadRequest, "invalid_input", "未知的 status "+status+"(目前僅支援 no-google-photo)")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": status, "city": city, "attractions": attractions})
}

// DELETE /internal/maintenance/attractions/{id}
//
// 對齊 tripace-cli 原本 attraction-delete 子命令(-db 模式)的行為(見
// cmd/cli/db.go 移除前的 dbClient.attractionDelete)。
//
// attractions.photo_url 這個相容欄位已經連同資料庫欄位本身徹底移除
// (見 cmd/migrate-drop-photo-url 的完整說明)——刪除這筆景點區域資料
// 前不再需要額外清理 GCS 上的對應照片物件(該欄位從未真的落地圖片到
// 這支端點管得到的物件路徑,見 handleMaintenanceAttractionAdd 的完整
// 說明)。
func (s *Server) handleMaintenanceAttractionDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少景點 ID")
		return
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

// PATCH /internal/maintenance/attractions/{id}/place-id
// Body: {"placeId": "ChIJ..."}
//
// 供 tripace-cli 的 attraction-set-place-id 指令使用(見
// store.UpdateAttractionPlaceID)——讓既有已建檔的景點區域(建檔當下沒有
// 透過 attraction-add -place/-place-id 帶入 place_id)事後補上對應的
// Google place_id,補上後前端(AttractionInfoPanel.tsx)才會開始改用
// 「地點照片漸進補圖機制」的雙來源照片,取代/補強單一的 photo_url。獨立
// 端點而非塞進通用的 .../field(見 handleMaintenanceAttractionUpdateField
// 的白名單機制)——理由同座標/照片各自獨立端點的既有慣例:place_id 允許
// 傳空字串主動清空(見 store.UpdateAttractionPlaceID 的說明),這跟
// attractionUpdatableFields 白名單那組欄位「值本身不可為空」的既有語意
// 不同,不適合共用同一個通用機制。
func (s *Server) handleMaintenanceAttractionUpdatePlaceID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少景點 ID")
		return
	}
	var in struct {
		PlaceID string `json:"placeId"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := s.store.UpdateAttractionPlaceID(id, in.PlaceID); err != nil {
		writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "placeId": in.PlaceID})
}

// PATCH /internal/maintenance/attractions/{id}/theme
// Body: {"isTheme": true}
//
// 供 tripace-cli 的 attraction-set-theme 指令使用(見
// store.UpdateAttractionTheme)——讓既有已建檔的景點區域(is_theme 欄位
// 剛新增時,不論原本 level 是多少,全部預設為 false)也能事後補上正確的
// 「主題點/精選點」分類(散策羅盤用語,見 model.Attraction.IsTheme 欄位
// 註解)。獨立端點而非塞進通用的 .../field(見
// handleMaintenanceAttractionUpdateField 的白名單機制)——理由同
// place-id/coords 各自獨立端點的既有慣例:attractionUpdatableFields 白
// 名單只收字串型欄位,is_theme 是布林型,不適合共用同一個通用機制。
func (s *Server) handleMaintenanceAttractionUpdateTheme(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少景點 ID")
		return
	}
	var in struct {
		IsTheme bool `json:"isTheme"`
	}
	if !decode(w, r, &in) {
		return
	}
	if err := s.store.UpdateAttractionTheme(id, in.IsTheme); err != nil {
		writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "isTheme": in.IsTheme})
}

// requireRateLimitAdmin——限流設定的管理權限檢查。
//
// 2026-10（review 發現）：這兩支端點原本只靠 internalMux 的 internalAuth
// 把關,而 internalAuth 只驗 JWT 簽章、不判斷角色(見 middleware.go 該
// 函式)——任何一個登入使用者的 token 都能通過。限流設定直接關係到
// Google API 的計費額度(把 maxCalls 或 dailyMax 調大就等於拆掉成本
// 保護),不該是一般使用者能改的。
//
// 對照組佐證這是疏漏而非刻意:adminconsole 的同功能端點
// (GET/PUT /admin/api/geo-rate-limits)是用 withAdmin 包起來的,
// 同一件事在那一側有管理權限把關、這一側沒有。
//
// 沿用 api 套件既有的 requireItineraryPageAdmin 模式(email 白名單,
// 見 itinerary_page.go 該函式),不另外發明一套角色模型。也刻意不把整個
// internalMux 改成要管理權限——前端一般使用者依賴其中的
// /internal/geo/*、/internal/plan-ai/* 等端點。
func (s *Server) requireRateLimitAdmin(r *http.Request) bool {
	user, ok := s.requireRealUser(r)
	if !ok {
		return false
	}
	email, err := s.store.GetUserEmail(user.ID)
	if err != nil {
		return false
	}
	return adminidentity.IsAdminEmail(email, s.adminBootstrapEmail)
}

// GET /internal/maintenance/rate-limits
//
// 列出全部可設定的限流規則:登錄表(internal/ratelimits)的靜態定義
// (預設值、說明、超過上限時的行為)配上 geo_rate_limits 表的現值。
// 供 tripace-cli 的 rate-limit list 指令使用。
//
// 2026-10 新增(使用者明確要求「cli 可以列出所有限流設定及個別設定
// 視窗大小」)。在這之前要知道目前生效的限流只能讀程式碼——而程式碼裡
// 的字面值未必等於實際生效值(後台管理介面可能已經改過資料庫)。
//
// 回傳的每一條規則都帶 configured 欄位,標示這條規則是「資料庫有自訂
// 值」還是「仍是預設值」——兩者的後續行為不同(預設值會被啟動參數覆寫,
// 自訂值不會,見 cmd/server/geo_rate_limit.go seedGeoRateLimitsIfEmpty
// 的完整說明),運維時需要分得出來。
func (s *Server) handleMaintenanceRateLimitList(w http.ResponseWriter, r *http.Request) {
	if !s.requireRateLimitAdmin(r) {
		writeErr(w, http.StatusForbidden, "forbidden", "只有管理員可以檢視限流設定")
		return
	}
	rows, err := s.store.ListGeoRateLimits()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	current := make(map[string]store.GeoRateLimit, len(rows))
	for _, row := range rows {
		current[row.Endpoint] = row
	}

	out := make([]map[string]any, 0, len(ratelimits.Registry))
	for _, rule := range ratelimits.Registry {
		item := map[string]any{
			"endpoint":         rule.Endpoint,
			"kind":             string(rule.Kind),
			"desc":             rule.Desc,
			"rejectBehavior":   rule.RejectBehavior,
			"defaultWindowSec": int(rule.DefaultWindow / time.Second),
			"defaultMaxCalls":  rule.DefaultMaxCalls,
			"defaultDailyMax":  rule.DefaultDailyMax,
		}
		// defaultWindowMs——視窗短於 1 秒的規則(nearbyAttractionSearch
		// 是 500ms)用秒表示會變成 0,看起來像「沒有限制」。額外給一個
		// 毫秒欄位,呼叫端顯示時可以挑合適的單位。
		item["defaultWindowMs"] = rule.DefaultWindow.Milliseconds()
		if row, ok := current[rule.Endpoint]; ok {
			item["configured"] = true
			item["windowSec"] = row.WindowSec
			item["maxCalls"] = row.MaxCalls
			item["dailyMax"] = row.DailyMax
			item["usedToday"] = row.UsedToday
		} else {
			item["configured"] = false
		}
		out = append(out, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"rateLimits": out})
}

// PATCH /internal/maintenance/rate-limits/{endpoint}
//
// 修改一條限流規則的視窗長度/上限次數/每日額度。供 tripace-cli 的
// rate-limit set 指令使用(見該指令的完整說明)。
//
// 2026-10 新增,理由同 handleMaintenanceRateLimitList。
//
// endpoint 必須是登錄表裡既有的 key——不接受任意字串:寫入一個沒有任何
// 程式碼會去 Allow 查詢的 key,只會讓 geo_rate_limits 表多一列永遠不
// 生效的設定,而操作者會以為自己設定成功了。
//
// windowSec/windowMs 二選一(都省略代表不改視窗):windowMs 是為了能
// 設定短於 1 秒的視窗(nearbyAttractionSearch 預設 500ms)——只給
// windowSec 的話那條規則無法透過這支端點正確設定(1 秒是最小值,想設
// 500ms 只能傳 0,而 0 的語意是「不改」)。
//
// 改完不需要重啟:cmd/server 的背景重讀迴圈會在
// geoRateLimitRefreshInterval(45 秒)之內把新值套用到實際的限流器
// (見 applyRateLimitsFromStore)。這支端點本身不直接動限流器——那樣
// 會讓「資料庫的值」與「記憶體的值」有兩條各自獨立的更新路徑,兩者
// 不一致時難以判斷哪個才是現況。
func (s *Server) handleMaintenanceRateLimitSet(w http.ResponseWriter, r *http.Request) {
	if !s.requireRateLimitAdmin(r) {
		writeErr(w, http.StatusForbidden, "forbidden", "只有管理員可以修改限流設定")
		return
	}
	endpoint := r.PathValue("endpoint")
	rule := ratelimits.Find(endpoint)
	if rule == nil {
		known := make([]string, 0, len(ratelimits.Registry))
		for _, x := range ratelimits.Registry {
			known = append(known, x.Endpoint)
		}
		writeErr(w, http.StatusBadRequest, "unknown_endpoint",
			"不是登錄表裡的限流 endpoint;可用的有: "+strings.Join(known, ", "))
		return
	}

	var body struct {
		WindowSec *int `json:"windowSec"`
		WindowMs  *int `json:"windowMs"`
		MaxCalls  *int `json:"maxCalls"`
		DailyMax  *int `json:"dailyMax"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", "請求內容不是合法的 JSON")
		return
	}

	// 以目前的值為基底,只覆寫這次有帶的欄位——沒帶的維持原樣,不要被
	// 零值覆寫成「不限制」。資料庫還沒有這條規則時,基底用登錄表的
	// 預設值(對齊 seeding 的語意)。
	windowMs := rule.DefaultWindow.Milliseconds()
	maxCalls := rule.DefaultMaxCalls
	dailyMax := rule.DefaultDailyMax
	rows, err := s.store.ListGeoRateLimits()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	for _, row := range rows {
		if row.Endpoint != endpoint {
			continue
		}
		windowMs = int64(row.WindowSec) * 1000
		maxCalls = row.MaxCalls
		dailyMax = row.DailyMax
	}

	if body.WindowMs != nil {
		windowMs = int64(*body.WindowMs)
	} else if body.WindowSec != nil {
		windowMs = int64(*body.WindowSec) * 1000
	}
	if body.MaxCalls != nil {
		maxCalls = *body.MaxCalls
	}
	if body.DailyMax != nil {
		dailyMax = *body.DailyMax
	}

	if windowMs <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid_input", "視窗長度必須大於 0")
		return
	}
	if maxCalls <= 0 {
		writeErr(w, http.StatusBadRequest, "invalid_input", "上限次數必須大於 0（要完全關閉某個功能請用對應的功能開關，不是把限流設成 0）")
		return
	}
	if dailyMax < 0 {
		writeErr(w, http.StatusBadRequest, "invalid_input", "每日額度不可為負數（0 代表不限制）")
		return
	}

	// UpsertGeoRateLimit 的 windowSec 是整數秒——短於 1 秒的視窗存不
	// 進去。這是既有資料表的欄位型別限制(見 store.GeoRateLimit),
	// 不在這次改動範圍內:遇到這種值直接拒絕並說清楚,不要靜默四捨五入
	// 成 0 秒或 1 秒(前者等於關掉限流、後者悄悄把保護放寬一倍)。
	if windowMs%1000 != 0 {
		writeErr(w, http.StatusBadRequest, "unsupported_window",
			"geo_rate_limits 表的視窗欄位只存整數秒，無法設定不滿整秒的視窗；請改用整數秒，或修改程式碼裡登錄表的預設值")
		return
	}

	if err := s.store.UpsertGeoRateLimit(endpoint, int(windowMs/1000), maxCalls, dailyMax); err != nil {
		writeErr(w, http.StatusInternalServerError, "upsert_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"endpoint":  endpoint,
		"windowSec": int(windowMs / 1000),
		"maxCalls":  maxCalls,
		"dailyMax":  dailyMax,
		// 提醒呼叫端這次修改要等多久才真的生效(見這支 handler 的完整
		// 說明:刻意不直接動限流器)。值讀 ratelimits.RefreshInterval,
		// 不寫死——原本這個數字在三處各寫死一份(review 發現)。
		"appliesWithinSec": int(ratelimits.RefreshInterval / time.Second),
	})
}

// GET /internal/maintenance/field-masks
//
// 列出全部可設定的 Google Places field mask:登錄表(internal/fieldmasks)
// 的靜態定義(每個欄位的計費層級與用途)配上 geo_field_masks 表的現值。
// 供 tripace-cli 的 field-mask list 指令使用。
//
// 2026-10 新增(使用者明確要求「加入可以控制欄位的設定,也讓 cli 可以
// 設定」)。
//
// 為什麼需要這支:field mask 直接決定每次 Places 呼叫的計費層級——
// Google 按「請求裡最高層級的那一個欄位」收費,所以單一欄位
// (editorialSummary)就能讓整個情境從 Pro($17/千次)跳到
// Enterprise + Atmosphere($25/千次,且免費額度從 5,000 降到 1,000)。
// 這些欄位原本寫死在 internal/geo/places.go 的 const 裡,調整只能改
// 程式碼重新部署。
//
// 回傳帶每個欄位的 tier 與 desc,不只欄位名稱:只給名稱的話,調整的人
// 無從判斷哪個該留、哪個可以砍。
func (s *Server) handleMaintenanceFieldMaskList(w http.ResponseWriter, r *http.Request) {
	if !s.requireRateLimitAdmin(r) {
		writeErr(w, http.StatusForbidden, "forbidden", "只有管理員可以檢視 field mask 設定")
		return
	}
	rows, err := s.store.ListGeoFieldMasks()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "list_failed", err.Error())
		return
	}
	current := make(map[string]string, len(rows))
	for _, row := range rows {
		current[row.Key] = row.Fields
	}

	out := make([]map[string]any, 0, len(fieldmasks.Registry))
	for _, sc := range fieldmasks.Registry {
		fields := sc.DefaultFields()
		configured := false
		if raw, ok := current[sc.Key]; ok {
			parsed := []string{}
			for _, f := range strings.Split(raw, ",") {
				if f = strings.TrimSpace(f); f != "" {
					parsed = append(parsed, f)
				}
			}
			if len(parsed) > 0 {
				fields = parsed
				configured = true
			}
		}
		available := make([]map[string]any, 0, len(sc.AllFields()))
		for _, f := range sc.AllFields() {
			available = append(available, map[string]any{
				"name":     f.Name,
				"tier":     string(f.Tier),
				"desc":     f.Desc,
				"required": sc.IsRequired(f.Name),
			})
		}
		out = append(out, map[string]any{
			"key":             sc.Key,
			"endpoint":        sc.Endpoint,
			"desc":            sc.Desc,
			"configured":      configured,
			"fields":          fields,
			"tier":            string(sc.TierOf(fields)),
			"mask":            sc.Mask(fields),
			"defaultFields":   sc.DefaultFields(),
			"availableFields": available,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"fieldMasks": out})
}

// PATCH /internal/maintenance/field-masks/{key}
//
// 修改一個查詢情境要取哪些欄位。供 tripace-cli 的 field-mask set 指令
// 使用(見該指令的完整說明)。
//
// 2026-10 新增,理由同 handleMaintenanceFieldMaskList。
//
// body: { "fields": ["displayName", "location", ...] }
//
// 驗證三件事,全部拒絕而非靜默修正:
//  1. key 必須在登錄表裡——寫一個沒有任何呼叫處會讀的 key 只會讓表多
//     一列永遠不生效的設定,操作者卻以為成功了。
//  2. 每個欄位名稱必須在該情境的登錄表裡。送 Google 不認得的欄位名稱
//     會讓整支 API 回 400,那會讓這個情境的查詢全部失敗——不能讓它有
//     機會被設定進去。
//  3. 必填欄位不可移除。少了名稱/座標,那次查詢等於白花錢。
//
// 改完不需要重啟:cmd/server 的背景重讀迴圈會在 RefreshInterval 之內
// 套用(見 applyFieldMasksFromStore)。這支端點本身不直接改 geo 的
// 覆寫表,理由同 handleMaintenanceRateLimitSet:讓「資料庫的值」與
// 「記憶體的值」只有一條更新路徑。
func (s *Server) handleMaintenanceFieldMaskSet(w http.ResponseWriter, r *http.Request) {
	if !s.requireRateLimitAdmin(r) {
		writeErr(w, http.StatusForbidden, "forbidden", "只有管理員可以修改 field mask 設定")
		return
	}
	key := r.PathValue("key")
	sc := fieldmasks.Find(key)
	if sc == nil {
		known := make([]string, 0, len(fieldmasks.Registry))
		for _, x := range fieldmasks.Registry {
			known = append(known, x.Key)
		}
		writeErr(w, http.StatusBadRequest, "unknown_scenario",
			"不是登錄表裡的查詢情境;可用的有: "+strings.Join(known, ", "))
		return
	}

	var body struct {
		Fields []string `json:"fields"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_input", "請求內容不是合法的 JSON")
		return
	}
	if len(body.Fields) == 0 {
		writeErr(w, http.StatusBadRequest, "invalid_input", "fields 不可為空——至少要有這個情境的必填欄位")
		return
	}

	seen := map[string]bool{}
	fields := make([]string, 0, len(body.Fields))
	for _, f := range body.Fields {
		f = strings.TrimSpace(f)
		if f == "" {
			continue
		}
		if !sc.Knows(f) {
			names := make([]string, 0, len(sc.AllFields()))
			for _, x := range sc.AllFields() {
				names = append(names, x.Name)
			}
			writeErr(w, http.StatusBadRequest, "unknown_field",
				"欄位 "+f+" 不屬於這個情境;可用的有: "+strings.Join(names, ", "))
			return
		}
		if seen[f] {
			continue
		}
		seen[f] = true
		fields = append(fields, f)
	}
	for _, req := range sc.Required {
		if !seen[req.Name] {
			writeErr(w, http.StatusBadRequest, "missing_required_field",
				"必填欄位 "+req.Name+" 不可移除("+req.Desc+")")
			return
		}
	}

	if err := s.store.UpsertGeoFieldMask(key, strings.Join(fields, ",")); err != nil {
		writeErr(w, http.StatusInternalServerError, "upsert_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"key":              key,
		"fields":           fields,
		"tier":             string(sc.TierOf(fields)),
		"mask":             sc.Mask(fields),
		"appliesWithinSec": int(ratelimits.RefreshInterval / time.Second),
	})
}

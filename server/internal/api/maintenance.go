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
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/tim72117/tripace/internal/geo"
	"github.com/tim72117/tripace/internal/model"
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
	expiresAt := now.Add(photoAssetExpiry)
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

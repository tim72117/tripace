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
//  2. 底層呼叫的 Google API 也可能不同——例如這裡的 handleMaintenanceGeocode
//     用 Places API Text Search(支援多候選、地區限定,對齊 CLI 原本
//     geocode 子命令的行為),跟核心的 handleGeoGeocode(用 Geocoding API,
//     只回單一最佳匹配,見該函式的說明)是兩個不同的底層機制,刻意不共用
//     同一支端點,避免其中一邊改動時誤傷到另一邊的呼叫端。
//
// 這兩支端點取代原本 tripace-cli 裡「直接在 CLI process 本地建立
// geo.Client、繞過後端」的做法(geocode 子命令)、與「只能在 -db 直連模式
// 下才能用」的做法(landmark-update-photo 子命令)——搬進後端後,兩者都
// 走跟其餘子命令一致的 HTTP + JWT 登入路徑,也因此能被
// apigateway.Gateway 的節流與 geo_api_call_logs 記錄涵蓋到(CLI 直接呼叫
// Google 時,節流雖然仍套用預設值,但因為 CLI 是短命的獨立 process、
// 從未接上 storeGeoCallLogger,呼叫不會被記錄——這是搬進後端要解決的
// 主要原因)。
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/tim72117/tripace/internal/geo"
)

// GET /internal/maintenance/geocode?place={地名}&region={國碼,選填}&n={候選筆數,選填}
//
// 對齊 tripace-cli 原本 geocode 子命令的行為(見 cmd/cli/geocode.go 移除
// 前的版本):用 Places API Text Search 查詢地名,支援多候選(-n)與地區
// 限定(-region)——這跟核心的 handleGeoGeocode(用 Geocoding API,只回
// 傳單一最佳匹配)是不同的查詢機制,不能互相取代:handleGeoGeocode 是
// 前端搜尋框「把地圖移過去」用的,只需要一組座標;這支端點是工程師手動
// 核對地名解析結果、或批次補座標時要看多個候選比較用的維運工具。
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

// POST /internal/maintenance/landmarks/{id}/update-photo
// Body(選填): { "query": "自訂查詢字串" }
//
// 對齊 tripace-cli 原本 landmark-update-photo 子命令(-db 模式)的行為
// (見 cmd/cli/db.go 移除前的 dbClient.landmarkUpdatePhoto):重新透過
// Google Places 查詢一次該地標的圖片並回寫到資料庫。query 未帶時,用該
// 地標既有的 CityName+Name 組成預設查詢字串。查無圖片時回傳明確錯誤,
// 不靜默略過——這是使用者主動觸發的單筆操作,呼叫端需要知道這次操作
// 到底有沒有真的取到圖(理由同原本 dbClient 版本的說明)。
func (s *Server) handleMaintenanceLandmarkUpdatePhoto(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "缺少地標 ID")
		return
	}

	// body 整段可省略(query 是選填欄位),故不用 decode() helper——那個
	// helper 對完全空的 request body 會直接判定失敗,這裡改成盡力解析、
	// 解析不出來就當作沒帶 query,交給下面的預設值邏輯處理。
	var body struct {
		Query string `json:"query"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	lm, err := s.store.GetAttraction(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "no_match", "找不到地標 "+id)
		return
	}
	query := body.Query
	if query == "" {
		query = lm.CityName + " " + lm.Name
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)
	client.SetCache(s.photoCache)
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	ctx = geo.WithCaller(ctx, "handleMaintenanceLandmarkUpdatePhoto")
	// 用註冊時的 pattern(而非 r.URL.Path 字面路徑)——這條路由含 {id}
	// 路徑變數,若用字面路徑,同一條路由會因為不同地標 ID 被統計成一堆
	// 各自獨立的資料列,見 geo.WithPath 的說明。
	ctx = geo.WithPath(ctx, "/internal/maintenance/landmarks/{id}/update-photo")

	place, photoRef, _, _, err := client.SearchLandmarkWithPhoto(ctx, query)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "search_failed", "查詢「"+query+"」失敗: "+err.Error())
		return
	}
	if photoRef == "" {
		writeErr(w, http.StatusNotFound, "no_photo", "「"+query+"」查無可用照片")
		return
	}

	photoURL, err := client.PhotoDataURI(ctx, place.PlaceID, photoRef, 400)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "photo_fetch_failed", "下載照片失敗: "+err.Error())
		return
	}

	if err := s.store.UpdateAttractionPhoto(id, photoURL); err != nil {
		writeErr(w, http.StatusInternalServerError, "internal_error", "寫入資料庫失敗: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":    id,
		"query": query,
		// 只回報是否成功與圖片長度,不把完整 data URI(可能數十 KB 的
		// base64 字串)塞進回應——CLI 輸出是給人看的,理由同原本
		// dbClient 版本的說明。
		"photoLength": len(photoURL),
		"status":      "updated",
	})
}

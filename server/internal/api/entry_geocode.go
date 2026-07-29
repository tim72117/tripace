package api

import (
	"context"
	"net/http"
	"os"
	"time"

	"github.com/tim72117/tripace/internal/geo"
)

// POST /internal/entries/{id}/geocode
// Body: { "region": "花蓮" }(選填)
//
// 跟既有的 PATCH /internal/entries/{id}/latlng(handleInternalSetLatLng)不同:
// 那支端點要求呼叫端已經知道座標、直接寫入;這支端點一律用這筆 Entry 現有
// 的 Title 當查詢字串,由伺服器端呼叫 Geocoding API(geo.Client.Geocode,與
// internal/wanttools/geocode.go 用同一把 GOOGLE_PLACES_API_KEY,該 key 已
// 額外授權 geocoding-backend.googleapis.com)查出座標後自動寫回
// Entry.Lat/Lng——呼叫端不需要(也不能)另外指定查詢字串,查詢內容一律來自
// 資料庫裡已經存在的資料,避免查詢字串跟實際 entry 內容對不上。
//
// 這裡刻意用 Geocoding API 而非 geo.Client.Search(Places API Text Search):
// 實測 Places API 對「橋樑」「道路」這類地理要素(這批配速表 checkpoint 有
// 不少是這種,例如「光復橋」)支援明顯較弱——「花蓮 光復橋」在 Places API
// 完全查無結果,單查「光復橋」甚至誤配到台北的店家;改用 Geocoding API 後
// 能正確解析(type: route)。詳見 internal/geo/geocode.go 的說明。
//
// region 是唯一的選填參數,用來補充地區範圍輔助消歧義(例如同名地標在不同
// 縣市都有時,「花蓮 大富火車站」比單查「大富火車站」更準確)——直接串接在
// Title 前面組成實際送給 Geocoding API 的查詢字串。
func (s *Server) handleGeocodeEntry(w http.ResponseWriter, r *http.Request) {
	entryID := r.PathValue("id")

	var body struct {
		Region string `json:"region"`
	}
	if !decode(w, r, &body) {
		return
	}

	entry, err := s.store.GetEntry(entryID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "entry_not_found", "找不到此 entry: "+entryID)
		return
	}
	if entry.Title == "" {
		writeErr(w, http.StatusBadRequest, "invalid_input", "此 entry 的 title 為空,無從查詢")
		return
	}

	query := entry.Title
	if body.Region != "" {
		query = body.Region + " " + query
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	result, err := client.Geocode(ctx, query)
	if err != nil {
		if err == geo.ErrNotFound {
			writeErr(w, http.StatusNotFound, "no_match", "查無符合的地點: "+query)
			return
		}
		writeErr(w, http.StatusBadGateway, "geocode_failed", err.Error())
		return
	}

	if err := s.store.SetEntryLatLng(entryID, result.Lat, result.Lng); err != nil {
		writeErr(w, http.StatusInternalServerError, "update_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"entryID": entryID,
		"query":   query,
		"address": result.FormattedAddress,
		"lat":     result.Lat,
		"lng":     result.Lng,
	})
}

// POST /internal/entries/compute-route
// Body: { "entryIDs": ["ent_xxx", "ent_yyy", "ent_zzz"] }(至少 2 筆)
//
// 依序讀取這些 entry,組成 computeRoutes 的 origin(陣列第一筆)/
// intermediates(中間所有筆)/destination(最後一筆),呼叫 Google Routes API
// 算出一條沿真實路網走的路徑,回傳格式與 handlePaceRoute 共用的
// paceRouteResult 一致(encoded polyline + 每段 leg 的起訖座標)。
//
// 每筆 entry 優先用它已經存在的 Lat/Lng(見 routeWaypoint 的說明);沒有
//座標的中間點(不含 origin/destination)一律直接略過、不送進
// computeRoutes,不會 fallback 用 Title 當地址查詢——實測過像「左轉
// 民治街(花52)」「R轉193」這種夾雜轉彎描述/括號代碼、或純轉彎指示的
// title,送給 Geocoding/Routes API 常常查無結果或查到不相關的路段,而且
// 只要 intermediates 裡有任何一個地址解析失敗,Google 就會讓整條路線
// 直接算不出來(回應 HTTP 200 但 routes 陣列是空的,不是「跳過這個點」
// 這種局部錯誤)。與其讓一個查無精確座標的中間點拖垮整條已知路徑,不如
// 直接跳過它,只用真正有把握的座標點定義路線——被跳過的 entryID 會列在
// 回應的 skipped 欄位,呼叫端可以自行決定要不要再另外處理。
//
// origin(第一筆)與 destination(最後一筆)不能被跳過:沒有座標又沒有
// 可用 title 時直接回錯誤,因為整條路徑的起訖點定義依賴它們,跳過就失去
// 意義。
//
// 用途:當一批 checkpoint 裡有幾筆地名模糊,把有把握定位的點一次當作
// computeRoutes 的 origin/intermediates/destination 送出,讓 Google 路線
// 引擎依真實路網幾何找出合理的沿路路徑——這是 entryIDs 陣列的呼叫端
// (例如批次校正配速表 checkpoint 座標)刻意設計成可重用、不寫死特定
// entry 的原因。
//
// 這支端點只回傳路徑結果,不會把 leg 的起訖座標寫回對應 entry 的
// Lat/Lng——是否要把哪個 leg 的座標對應寫回哪個 entry,交由呼叫端自行
// 判斷(例如陣列裡中間那幾筆的座標就是這批 leg 的 startLocation/
// endLocation,呼叫端已經知道對應關係,不需要這支端點代為決定)。
func (s *Server) handleComputeRouteFromEntries(w http.ResponseWriter, r *http.Request) {
	var body struct {
		EntryIDs []string `json:"entryIDs"`
	}
	if !decode(w, r, &body) {
		return
	}
	if len(body.EntryIDs) < 2 {
		writeErr(w, http.StatusBadRequest, "invalid_input", "entryIDs 至少需要 2 筆(起點+終點)")
		return
	}

	type entryPoint struct {
		id       string
		title    string
		waypoint routeWaypoint
		hasLoc   bool
	}
	points := make([]entryPoint, 0, len(body.EntryIDs))
	for _, id := range body.EntryIDs {
		entry, err := s.store.GetEntry(id)
		if err != nil {
			writeErr(w, http.StatusNotFound, "entry_not_found", "找不到此 entry: "+id)
			return
		}
		if entry.Lat != nil && entry.Lng != nil {
			points = append(points, entryPoint{
				id: id, title: entry.Title, hasLoc: true,
				waypoint: routeWaypoint{Lat: *entry.Lat, Lng: *entry.Lng, HasLatLng: true},
			})
			continue
		}
		points = append(points, entryPoint{id: id, title: entry.Title, hasLoc: false})
	}

	// origin/destination 不能跳過:沒座標就退回用 title(至少嘗試,查不到
	// 是 Google API 呼叫失敗、由下面 computeRouteByWaypoints 的錯誤處理
	// 負責回報,不在這裡預先擋掉)。
	first, last := &points[0], &points[len(points)-1]
	for _, p := range []*entryPoint{first, last} {
		if p.hasLoc {
			continue
		}
		if p.title == "" {
			writeErr(w, http.StatusBadRequest, "invalid_input", "起點/終點 entry 沒有座標、title 也為空,無從定位: "+p.id)
			return
		}
		p.waypoint = routeWaypoint{Address: p.title}
	}

	// 中間點:沒座標的直接跳過,不送進 intermediates、也不 fallback 用
	// title——見上方函式註解的說明。
	skipped := make([]string, 0)
	intermediates := make([]routeWaypoint, 0, len(points)-2)
	for _, p := range points[1 : len(points)-1] {
		if !p.hasLoc {
			skipped = append(skipped, p.id)
			continue
		}
		intermediates = append(intermediates, p.waypoint)
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	if apiKey == "" {
		writeErr(w, http.StatusServiceUnavailable, "no_api_key", "未設定 GOOGLE_PLACES_API_KEY")
		return
	}

	titles := make([]string, 0, len(points))
	for _, p := range points {
		titles = append(titles, p.title)
	}

	result, err := computeRouteByWaypoints(r.Context(), apiKey, first.waypoint, intermediates, last.waypoint)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "compute_route_failed", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"entryIDs": body.EntryIDs,
		"titles":   titles,
		"skipped":  skipped,
		"result":   result,
	})
}

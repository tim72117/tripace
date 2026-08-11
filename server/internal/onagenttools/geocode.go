// geocode 是 onagent 平台的 BackendDispatch 型工具,做法比照
// recommend_nearby.go(見該檔案開頭的完整說明):onagent LLM 決定呼叫這個
// 工具時,onagent 伺服器直接 POST 到這支端點,不經過任何瀏覽器分頁,回應在
// 同一次 HTTP 往返內帶回結果。
//
// 沿用跟 want 工具舊版(wanttools/geocode.go)完全相同的 geo.Client +
// GOOGLE_PLACES_API_KEY 查詢模式——同一套底層 Google Places 呼叫、同樣的
// 結果形狀,只是 transport/觸發方式不同(onagent HTTP dispatch,而非 want
// 的行程內工具呼叫)。搬移時額外補上 want 舊版缺漏的空結果防呆(見下方
// len(places) == 0 檢查)——舊版只判斷 err != nil,若 Google API 回傳空
// 陣列但無 error,會直接對空陣列取 places[0],是潛在的 index-out-of-range
// panic,同 recommend_nearby 搬移時修正的問題。
package onagenttools

import (
	"context"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/tim72117/tripace/internal/geo"
)

// HandleGeocode executes the same "resolve place name to coordinates" flow
// as wanttools.GeocodeTool.Call, but driven by onagent's dispatch request
// shape instead of want's types.ToolArguments, and returning directly in
// the response body instead of via ctx.EmitToolResult.
func HandleGeocode(w http.ResponseWriter, r *http.Request) {
	var body DispatchRequest
	if err := decodeJSON(r, &body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_json")
		return
	}
	if body.Args == nil {
		body.Args = map[string]interface{}{}
	}

	place, _ := body.Args["place"].(string)
	place = strings.TrimSpace(place)
	if place == "" {
		writeErr(w, http.StatusBadRequest, "place is required")
		return
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)

	// 5s 對齊 want 舊版(wanttools/geocode.go)的逾時值——geocode 只是單次
	// 地點解析,不像 recommend_nearby 還要再串一次 Nearby Search,不需要
	// recommend_nearby 版本額外預留的 8s headroom。
	gctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	gctx = geo.WithCaller(gctx, "onagenttools.geocode")

	places, err := client.Search(gctx, place, &geo.SearchOptions{MaxResults: 1})
	if err != nil || len(places) == 0 {
		writeErr(w, http.StatusServiceUnavailable, "定位「"+place+"」失敗")
		return
	}
	p := places[0]

	writeOK(w, map[string]any{
		"name":    p.Name,
		"address": p.Address,
		"lat":     p.Lat,
		"lng":     p.Lng,
	})
}

package onagenttools

import (
	"context"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/tim72117/tripace/internal/geo"
)

// maxRadiusMeters 對齊 server/tools/onagent-tools.yaml 裡 radius_meters
// 參數 description 宣稱的上限("最大 50000")——原本這個上限只存在於給 LLM
// 看的文字說明裡,後端完全沒有實際擋值,任何呼叫端(包含未來可能繞過
// onagent、直接打這支端點的請求)傳超過 50000 或負數都會直接送進
// geo.SearchNearby,不是預期行為。
const maxRadiusMeters = 50000

// HandleRecommendNearby executes the same "resolve place name to
// coordinates, then Nearby Search around it" flow as
// wanttools.RecommendNearbyTool.Call, but driven by onagent's dispatch
// request shape instead of want's types.ToolArguments, and returning
// directly in the response body instead of via ctx.EmitToolResult (onagent
// has no want-side result-accumulation mechanism to feed — the whole point
// of BackendDispatch is that the result goes straight back in the HTTP
// response body for onagent to relay to its own LLM).
func HandleRecommendNearby(w http.ResponseWriter, r *http.Request) {
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
	category, _ := body.Args["category"].(string)
	category = strings.TrimSpace(category)
	var radiusMeters float64
	switch v := body.Args["radius_meters"].(type) {
	case float64:
		radiusMeters = v
	case int:
		radiusMeters = float64(v)
	}
	if radiusMeters < 0 || radiusMeters > maxRadiusMeters {
		writeErr(w, http.StatusBadRequest, "radius_meters must be between 0 and 50000")
		return
	}

	apiKey := os.Getenv("GOOGLE_PLACES_API_KEY")
	client := geo.New(apiKey)

	// timeoutMs from the schema config (server/tools/onagent-tools.yaml)
	// governs how long onagent itself waits before treating this call as
	// tool_unavailable — this context timeout just needs to stay safely
	// under that so a slow Google response fails as a clean tripace-side
	// error rather than onagent's own timeout firing first and racing this
	// handler's in-flight Google call. want-tool version uses 8s in-process
	// (no network hop to onagent); this path has an extra hop, so leaving
	// headroom matters more here.
	gctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	gctx = geo.WithCaller(gctx, "onagenttools.recommendNearby")

	center, err := client.Search(gctx, place, &geo.SearchOptions{MaxResults: 1})
	if err != nil || len(center) == 0 {
		writeErr(w, http.StatusServiceUnavailable, "定位「"+place+"」失敗")
		return
	}
	origin := center[0]

	var includedTypes []string
	if category != "" {
		includedTypes = []string{category}
	}

	nearby, err := client.SearchNearby(gctx, origin.Lat, origin.Lng, &geo.NearbyOptions{
		RadiusMeters:  radiusMeters,
		IncludedTypes: includedTypes,
		MaxResults:    10,
	})
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, "查詢「"+place+"」附近景點失敗")
		return
	}

	results := make([]map[string]interface{}, 0, len(nearby))
	for _, p := range nearby {
		results = append(results, map[string]interface{}{
			"name":        p.Name,
			"address":     p.Address,
			"lat":         p.Lat,
			"lng":         p.Lng,
			"primaryType": p.PrimaryType,
		})
	}

	writeOK(w, map[string]any{
		"origin":  map[string]any{"name": origin.Name, "lat": origin.Lat, "lng": origin.Lng},
		"results": results,
	})
}

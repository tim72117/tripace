// Google API(Places/Geocoding)呼叫統計(GET /admin/api/geo-api-stats)。
// 依 endpoint+caller+path 分組回報過去一段時間的呼叫次數/平均耗時/錯誤
// 數,讀取來源是 server/internal/apigateway 的 CallLogger 寫入的
// geo_api_call_logs 表——跟 request_stats.go(inbound,別人打進我們的
// server)是對稱但獨立的一張表,這裡記的是「我們的 server 打出去給
// Google」(outbound),見 store.geoAPICallLogRow 的完整說明。
package adminconsole

import (
	"net/http"
	"strconv"
	"time"

	"github.com/tim72117/tripace/internal/adminauth"
	"github.com/tim72117/tripace/internal/store"
)

// geoAPIStatsResponse 是 GET /admin/api/geo-api-stats 的回應格式。
// Timeline 是按分鐘分桶的呼叫量時間序列(見 store.GeoAPICallStatsTimeline
// 的分桶說明——inbound 的 request-stats 用小時、這裡刻意用分鐘,理由見
// 該函式的說明),供前端畫趨勢折線圖用。
type geoAPIStatsResponse struct {
	SinceHours int                     `json:"sinceHours"`
	Calls      []store.GeoAPICallStats `json:"calls"`
	Timeline   []store.TimelineBucket  `json:"timeline"`
}

// listGeoAPIStats 讀 ?hours= 查詢參數決定統計範圍,規則同 listRequestStats
// (預設 24 小時,最大 168 小時/7 天)。
func (h *Handler) listGeoAPIStats(w http.ResponseWriter, r *http.Request, _ *adminauth.Admin) {
	const defaultHours = 24
	const maxHours = 168

	hours := defaultHours
	if raw := r.URL.Query().Get("hours"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			hours = parsed
			if hours > maxHours {
				hours = maxHours
			}
		}
	}

	since := time.Now().UTC().Add(-time.Duration(hours) * time.Hour)

	calls, err := h.Store.GeoAPICallStatsSince(since)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if calls == nil {
		calls = []store.GeoAPICallStats{}
	}

	timeline, err := h.Store.GeoAPICallStatsTimeline(since)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if timeline == nil {
		timeline = []store.TimelineBucket{}
	}

	writeJSON(w, http.StatusOK, geoAPIStatsResponse{
		SinceHours: hours,
		Calls:      calls,
		Timeline:   timeline,
	})
}

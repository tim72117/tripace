// 請求數量統計(GET /admin/api/request-stats)。依 method+path 分組回報
// 過去一段時間的呼叫次數/平均耗時/錯誤數,讀取來源是
// server/internal/api/middleware.go 的 requestLogging 寫入的
// api_request_logs 表——涵蓋這個 server 收到的所有請求,不限於 Places
// 相關端點,可用來排查任何端點的異常流量(例如本次 Photo Media 重複
// 呼叫問題的根因排查)。
package adminconsole

import (
	"net/http"
	"strconv"
	"time"

	"github.com/tim72117/tripace/internal/adminauth"
	"github.com/tim72117/tripace/internal/store"
)

// requestStatsResponse 是 GET /admin/api/request-stats 的回應格式。
type requestStatsResponse struct {
	SinceHours int                      `json:"sinceHours"`
	Total      int64                    `json:"total"`
	ErrorCount int64                    `json:"errorCount"`
	Paths      []store.PathRequestStats `json:"paths"`
}

// listRequestStats 讀 ?hours= 查詢參數決定統計範圍(預設 24 小時,最大
// 168 小時/7 天——這張表隨流量持續累積,不限制範圍的話單次查詢可能掃描
// 大量歷史資料,拖慢管理後台頁面載入)。
func (h *Handler) listRequestStats(w http.ResponseWriter, r *http.Request, _ *adminauth.Admin) {
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

	paths, err := h.Store.RequestStatsSince(since)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if paths == nil {
		paths = []store.PathRequestStats{}
	}

	total, errorCount, err := h.Store.RequestStatsTotal(since)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, requestStatsResponse{
		SinceHours: hours,
		Total:      total,
		ErrorCount: errorCount,
		Paths:      paths,
	})
}

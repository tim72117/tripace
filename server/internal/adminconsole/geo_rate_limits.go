// Google Places API 限流設定管理(GET/PUT /admin/api/geo-rate-limits)——
// 讓後台管理員能執行期修改 "places.get"/"places.photoMedia" 兩個 endpoint
// 的限速視窗、上限次數、每日額度,取代原本只能透過 cmd/server 啟動
// flag/環境變數設定、改了要重新部署才生效的做法(見
// server/internal/store/geo_rate_limits.go 與
// server/cmd/server/geo_rate_limit.go 的完整說明:寫入這裡的設定由
// cmd/server 的背景 goroutine 定期重讀套用到實際的限流器,不是即時生效,
// 也不是這個套件自己套用——adminconsole/adminserver 這支 binary 刻意
// 不依賴 geo/apigateway 套件,見 cmd/adminserver/main.go 檔頭的完整
// 說明)。
package adminconsole

import (
	"encoding/json"
	"net/http"

	"github.com/tim72117/tripace/internal/adminauth"
	"github.com/tim72117/tripace/internal/store"
)

// geoRateLimitsResponse 是 GET /admin/api/geo-rate-limits 的回應格式。
type geoRateLimitsResponse struct {
	Limits []store.GeoRateLimit `json:"limits"`
}

// listGeoRateLimits 回傳資料庫裡目前已設定的全部限流規則。
func (h *Handler) listGeoRateLimits(w http.ResponseWriter, r *http.Request, _ *adminauth.Admin) {
	limits, err := h.Store.ListGeoRateLimits()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if limits == nil {
		limits = []store.GeoRateLimit{}
	}
	writeJSON(w, http.StatusOK, geoRateLimitsResponse{Limits: limits})
}

// updateGeoRateLimitRequest 是 PUT /admin/api/geo-rate-limits 的請求
// body——單筆更新(不是整批覆蓋),對齊 store.UpsertGeoRateLimit 的單一
// endpoint 語意,前端每次只送使用者實際編輯過的那一列,不需要每次都
// 把全部 endpoint 的設定重新送一次。
type updateGeoRateLimitRequest struct {
	Endpoint  string `json:"endpoint"`
	WindowSec int    `json:"windowSec"`
	MaxCalls  int    `json:"maxCalls"`
	DailyMax  int    `json:"dailyMax"`
}

// updateGeoRateLimit 新增或覆蓋一筆 endpoint 的限流規則——WindowSec/
// MaxCalls 必須是正整數(比照 apigateway.RateLimiter.SetLimitForKey 的
// 既有語意,見該函式說明:window<=0 沒有意義、maxCalls<=0 代表移除
// 限流,兩者都不該從這支管理端點以「合法設定值」的姿態寫入資料庫,
// 避免使用者不小心送出 0 或負數卻誤以為是「調整成很寬鬆的限制」而非
// 「關閉限流」),DailyMax 允許 0 或負數(明確代表「不限制每日額度」,
// 是合法的使用者意圖,見 geoRateLimitRow.DailyMax 欄位的完整說明)。
// Endpoint 不驗證是否為已知的 "places.get"/"places.photoMedia" 兩個
// 字面值——比照後端其餘自由字串欄位(如 model.Attraction.Category)的
// 既有慣例不做列舉白名單檢查,cmd/server 的 applyGeoRateLimitsFromStore
// 只認得這兩個字串,寫入其他字串的資料列會被忽略、不會造成任何錯誤,
// 只是不會生效。
func (h *Handler) updateGeoRateLimit(w http.ResponseWriter, r *http.Request, _ *adminauth.Admin) {
	var req updateGeoRateLimitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	if req.Endpoint == "" {
		http.Error(w, "endpoint is required", http.StatusBadRequest)
		return
	}
	if req.WindowSec <= 0 {
		http.Error(w, "windowSec must be a positive integer", http.StatusBadRequest)
		return
	}
	if req.MaxCalls <= 0 {
		http.Error(w, "maxCalls must be a positive integer", http.StatusBadRequest)
		return
	}

	if err := h.Store.UpsertGeoRateLimit(req.Endpoint, req.WindowSec, req.MaxCalls, req.DailyMax); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	limits, err := h.Store.ListGeoRateLimits()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, geoRateLimitsResponse{Limits: limits})
}

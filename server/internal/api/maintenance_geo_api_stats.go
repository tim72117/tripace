package api

import (
	"net/http"
	"sort"
	"strconv"
	"time"
	_ "time/tzdata" // 容器映像沒有系統時區資料庫時,tz 參數仍可解析 IANA 名稱

	"github.com/tim72117/tripace/internal/store"
)

// GET /internal/maintenance/geo-api-stats
//
// 依日期區間與週期(day/hour)回報對 Google Places/Geocoding 的呼叫次數,
// 供 tripace-cli 的 geo-stats 指令使用。資料來源是 geo_api_call_logs(見
// store.geoAPICallLogRow)——只有「請求筆數」,沒有當時的計費層級。
//
// 查詢參數:
//   - from / to:日期 YYYY-MM-DD,含頭含尾,以 tz 的時區解讀。預設 to=今天、
//     from=to 往前 6 天(共 7 天)。
//   - period:day(預設)或 hour。
//   - tz:IANA 時區名稱,預設 Asia/Taipei。「一天」從哪裡切由它決定。
//
// 回應另含 cache 區塊:地點詳情快取的 hit/miss/shared 次數與命中率(來源
// geo_cache_logs,上線前的日期沒有資料)。
//
// 範圍上限:day 最多 92 天、hour 最多 7 天(hour 的桶數 × endpoint 數會讓
// 回應快速變大)。僅限管理員。
func (s *Server) handleMaintenanceGeoAPIStats(w http.ResponseWriter, r *http.Request) {
	if !s.requireRateLimitAdmin(r) {
		writeErr(w, http.StatusForbidden, "forbidden", "只有管理員可以檢視 Google API 呼叫統計")
		return
	}
	q := r.URL.Query()

	tzName := q.Get("tz")
	if tzName == "" {
		tzName = "Asia/Taipei"
	}
	loc, err := time.LoadLocation(tzName)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_tz", "tz 不是有效的 IANA 時區名稱:"+tzName)
		return
	}

	period := q.Get("period")
	if period == "" {
		period = "day"
	}
	if period != "day" && period != "hour" {
		writeErr(w, http.StatusBadRequest, "bad_period", "period 必須是 day 或 hour")
		return
	}

	const dateLayout = "2006-01-02"
	today := time.Now().In(loc)
	toDate := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, loc)
	if v := q.Get("to"); v != "" {
		toDate, err = time.ParseInLocation(dateLayout, v, loc)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "bad_to", "to 必須是 YYYY-MM-DD")
			return
		}
	}
	fromDate := toDate.AddDate(0, 0, -6)
	if v := q.Get("from"); v != "" {
		fromDate, err = time.ParseInLocation(dateLayout, v, loc)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "bad_from", "from 必須是 YYYY-MM-DD")
			return
		}
	}
	if fromDate.After(toDate) {
		writeErr(w, http.StatusBadRequest, "bad_range", "from 不能晚於 to")
		return
	}
	days := int(toDate.Sub(fromDate).Hours()/24+0.5) + 1
	maxDays := 92
	if period == "hour" {
		maxDays = 7
	}
	if days > maxDays {
		writeErr(w, http.StatusBadRequest, "range_too_long", "週期為 "+period+" 時區間最多 "+strconv.Itoa(maxDays)+" 天")
		return
	}

	buckets, err := s.store.GeoAPICallStatsByPeriod(fromDate, toDate.AddDate(0, 0, 1), loc, period)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	if buckets == nil {
		buckets = []store.GeoAPIPeriodBucket{}
	}

	type total struct {
		Endpoint   string `json:"endpoint"`
		Count      int64  `json:"count"`
		ErrorCount int64  `json:"errorCount"`
	}
	byEndpoint := map[string]*total{}
	for _, b := range buckets {
		t, ok := byEndpoint[b.Endpoint]
		if !ok {
			t = &total{Endpoint: b.Endpoint}
			byEndpoint[b.Endpoint] = t
		}
		t.Count += b.Count
		t.ErrorCount += b.ErrorCount
	}
	totals := make([]total, 0, len(byEndpoint))
	for _, t := range byEndpoint {
		totals = append(totals, *t)
	}
	sort.Slice(totals, func(i, j int) bool { return totals[i].Count > totals[j].Count })

	// 地點詳情快取的命中情形(geo_cache_logs)。hitRate = hit / 全部查詢;
	// shared(搭便車)不算命中,但也沒有另外打 Google,所以單獨列出。
	cacheBuckets, err := s.store.GeoCacheStatsByPeriod("place_details", fromDate, toDate.AddDate(0, 0, 1), loc, period)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	if cacheBuckets == nil {
		cacheBuckets = []store.GeoCachePeriodBucket{}
	}
	cacheTotals := map[string]int64{"hit": 0, "miss": 0, "shared": 0}
	var cacheAll int64
	for _, b := range cacheBuckets {
		cacheTotals[b.Outcome] += b.Count
		cacheAll += b.Count
	}
	hitRate := 0.0
	if cacheAll > 0 {
		hitRate = float64(cacheTotals["hit"]) / float64(cacheAll)
	}

	// 照片儲存(GCS)斷路器的目前狀態:異常時補圖會在花錢之前被跳過。
	photoStorage := map[string]any{"state": "disabled"}
	if s.photoStorageBreaker != nil {
		photoStorage = map[string]any{}
		st := s.photoStorageBreaker.Status()
		photoStorage["state"] = string(st.State)
		photoStorage["skipped"] = st.Skipped
		if st.LastError != "" {
			photoStorage["lastError"] = st.LastError
		}
		if !st.NextProbe.IsZero() {
			photoStorage["nextProbe"] = st.NextProbe.In(loc).Format("2006-01-02 15:04:05")
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"photoStorage": photoStorage,
		"cache": map[string]any{
			"name":    "place_details",
			"totals":  cacheTotals,
			"hitRate": hitRate,
			"buckets": cacheBuckets,
		},
		"from":    fromDate.Format(dateLayout),
		"to":      toDate.Format(dateLayout),
		"period":  period,
		"tz":      tzName,
		"totals":  totals,
		"buckets": buckets,
	})
}

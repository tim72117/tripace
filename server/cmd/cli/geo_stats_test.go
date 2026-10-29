package main

import (
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
)

// geo-stats 的旗標要原樣變成查詢參數;沒帶的旗標不送,交給後端套預設值。
func TestGeoAPIStatsQueryParams(t *testing.T) {
	var gotPath, gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotQuery = r.URL.Path, r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(srv.Close)
	withToken(t, srv.URL, "tok")
	c := newHTTPClient(srv.URL)

	if _, err := c.geoAPIStats("2026-10-20", "2026-10-28", "hour", "UTC"); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/internal/maintenance/geo-api-stats" {
		t.Fatalf("path = %q", gotPath)
	}
	for _, want := range []string{"from=2026-10-20", "to=2026-10-28", "period=hour", "tz=UTC"} {
		if !strings.Contains(gotQuery, want) {
			t.Errorf("query %q 缺 %s", gotQuery, want)
		}
	}

	if _, err := c.geoAPIStats("", "", "day", ""); err != nil {
		t.Fatal(err)
	}
	if gotQuery != "period=day" {
		t.Fatalf("空旗標不該送出,query = %q", gotQuery)
	}
}

// 實際編出 binary 跑一次,確認表格輸出含合計與依週期展開的列。
func TestGeoStatsShowPrintsTable(t *testing.T) {
	bin := buildCLI(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"photoStorage":{"state":"open","skipped":7,"lastError":"403 accountDisabled","nextProbe":"2026-10-29 12:05:00"},"from":"2026-10-20","to":"2026-10-21","period":"day","tz":"Asia/Taipei",
"cache":{"name":"place_details","totals":{"hit":6,"miss":3,"shared":1},"hitRate":0.6,
"buckets":[{"bucket":"2026-10-20","outcome":"hit","count":6},{"bucket":"2026-10-20","outcome":"miss","count":3},{"bucket":"2026-10-20","outcome":"shared","count":1}]},
"totals":[{"endpoint":"places.get","count":5,"errorCount":1},{"endpoint":"places.photoMedia","count":2,"errorCount":0}],
"buckets":[{"bucket":"2026-10-20","endpoint":"places.get","count":3,"errorCount":1},
{"bucket":"2026-10-21","endpoint":"places.get","count":2,"errorCount":0},
{"bucket":"2026-10-21","endpoint":"places.photoMedia","count":2,"errorCount":0}]}`))
	}))
	t.Cleanup(srv.Close)
	withToken(t, srv.URL, "tok")

	out, err := exec.Command(bin, "-api", srv.URL, "geo-stats", "show").CombinedOutput()
	if err != nil {
		t.Fatalf("geo-stats show: %v\n%s", err, out)
	}
	s := string(out)
	for _, want := range []string{"2026-10-20 ~ 2026-10-21", "TOTAL", "7", "PERIOD", "2026-10-20", "2026-10-21", "照片儲存(GCS):異常", "已略過 7 次", "403 accountDisabled", "命中 6(60.0%)", "沒命中 3", "搭便車 1", "HIT%"} {
		if !strings.Contains(s, want) {
			t.Errorf("輸出缺 %q:\n%s", want, s)
		}
	}
}
